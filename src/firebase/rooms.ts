// Room creation/joining and the lobby's real-time sync. This is deliberately scoped
// to getting players into a shared, synced room first — wiring the actual card game
// engine through Firestore (so play itself is networked) is the next step after this.
//
// Room codes avoid ambiguous characters (no 0/O, 1/I) since people read them aloud or
// type them from a screen.

import {
  deleteField,
  doc,
  DocumentReference,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { nextTwoPOpener, type PlayerId } from '../engine'
import { FOUR_P_SEAT_ORDER, FOUR_P_TEAMS, startFourPlayerRound, type FourPlayerGameState } from '../game/fourPlayerReducer'
import { PLAYERS, startTwoPlayerRound } from '../game/twoPlayerReducer'
import { db } from './config'
import { fromFirestoreGame, toFirestoreGame, type FirestoreGameState } from './gameSerialize'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5
const MAX_CREATE_ATTEMPTS = 5

export type GameMode = '2p' | '4p'
export type RoomStatus = 'lobby' | 'playing' | 'ended'

export interface Seat {
  clientId: string
  name: string
}

export interface RoomDoc {
  mode: GameMode
  status: RoomStatus
  hostClientId: string
  createdAt: unknown
  // 2P seats are p1/p2. 4P seats (blue1/red1/blue2/red2) are reserved in the model
  // but not yet supported end-to-end — see createRoom.
  seats: Partial<Record<string, Seat>>
  // Present once status === 'playing'. 2P only for now, matching seats/createRoom.
  // Stored Firestore-safe (see gameSerialize.ts) — convert with fromFirestoreGame
  // before handing it to the reducer/views.
  game?: FirestoreGameState | null
  // Present once status === 'ended' — who forfeited, so the other player's screen
  // can say so instead of just "the room is gone". Explicitly nulled out (rather than
  // just left stale) when a restart clears it back to a normal 'playing' room.
  endedBy?: PlayerId | null
  // Host-only setting, chosen in the lobby before the match starts — a house rule
  // both players are bound by equally, not a personal per-player preference. Missing
  // (older rooms created before this existed) is treated as false everywhere it's read.
  trackPlayedCardsEnabled?: boolean
  // Anyone who joined a full/in-progress room instead of claiming a seat. Keyed by
  // clientId (unlike seats, there's no fixed slot — any number of people can watch).
  // Spectators already receive the full room doc same as players (see firestore.rules
  // — there's no server-side hand-hiding at all today), so this is just bookkeeping
  // for "who's watching" and the seat-swap UI, not an access-control mechanism.
  spectators?: Record<string, Seat>

  // --- 4P only, below. FourPlayerGameState needs no Firestore-safe transform (unlike
  // 2P's `game` — see gameSerialize.ts — it has no tuple-of-arrays fields), so it's
  // stored directly rather than through a serialize/deserialize pair. ---
  game4p?: FourPlayerGameState | null
  // Host's choice, changeable between rounds (status === 'lobby'): pick seats/opener
  // by hand, or have the dice decide both each round. Defaults to 'manual' when unset.
  teamMode4p?: 'manual' | 'dice'
  // Manual mode only: the host's pick of who opens the round about to be dealt.
  // Cleared after each deal — has to be re-picked (or re-rolled) every round, per
  // spec: this isn't locked in for the whole match.
  pendingOpener4p?: PlayerId | null
  // True while a dice-roll is in progress — Lobby shows the roll screen instead of
  // the normal seat list while this is set. Cleared once all 4 have rolled distinct
  // values and the round is dealt.
  diceRollActive4p?: boolean
  // clientId -> this round's roll (1-10). Entries for tied clientIds get cleared so
  // just they re-roll; everyone else's stands.
  diceRolls4p?: Record<string, number>
}

function seatOrderFor(mode: GameMode): string[] {
  return mode === '2p' ? [...PLAYERS] : [...FOUR_P_SEAT_ORDER]
}

function generateCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
}

function roomRef(roomCode: string): DocumentReference {
  return doc(db, 'rooms', roomCode.toUpperCase())
}

/** Creates a new room with the host in the first seat. Retries on room-code collision. */
export async function createRoom(mode: GameMode, hostName: string, hostClientId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateCode()
    const ref = roomRef(code)
    try {
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(ref)
        if (existing.exists()) {
          throw new Error('ROOM_CODE_TAKEN')
        }
        const seats: Partial<Record<string, Seat>> = { [seatOrderFor(mode)[0]]: { clientId: hostClientId, name: hostName } }
        const room: RoomDoc = {
          mode,
          status: 'lobby',
          hostClientId,
          createdAt: serverTimestamp(),
          seats,
          trackPlayedCardsEnabled: false,
          ...(mode === '4p' ? { teamMode4p: 'manual' as const } : {}),
        }
        tx.set(ref, room)
      })
      return code
    } catch (err) {
      if (err instanceof Error && err.message === 'ROOM_CODE_TAKEN') continue
      throw err
    }
  }
  throw new Error('Could not generate a free room code, try again')
}

/** Claims the next open seat in an existing lobby room — or, if there's no open seat
 *  (room full, or already mid-match/ended), joins as a spectator instead of erroring.
 *  That's the entire "join to spectate" flow: same room-code input, no separate UI. */
export async function joinRoom(roomCode: string, name: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error(`No room found with code ${roomCode.toUpperCase()}`)
    const room = snap.data() as RoomDoc
    const order = seatOrderFor(room.mode)

    // A previously-seated player rejoining (refresh, reconnect) is always fine, even
    // mid-game — check this before anything else below.
    const alreadySeated = order.find((seat) => room.seats[seat]?.clientId === clientId)
    if (alreadySeated) return
    if (room.spectators?.[clientId]) return // already watching, no-op

    const openSeat = room.status === 'lobby' ? order.find((seat) => !room.seats[seat]) : undefined
    if (openSeat) {
      tx.update(ref, { [`seats.${openSeat}`]: { clientId, name } satisfies Seat })
    } else {
      tx.update(ref, { [`spectators.${clientId}`]: { clientId, name } satisfies Seat })
    }
  })
}

/** Lobby-only: a seated player steps down to spectator, freeing their seat for
 *  someone else to take. Only meaningful between rounds — see returnToLobby. */
export async function becomeSpectator(roomCode: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.status !== 'lobby') throw new Error('Seats can only be changed between rounds')
    const order = seatOrderFor(room.mode)
    const seat = order.find((s) => room.seats[s]?.clientId === clientId)
    if (!seat) throw new Error("You're not currently seated")
    const name = room.seats[seat]!.name
    tx.update(ref, {
      [`seats.${seat}`]: deleteField(),
      [`spectators.${clientId}`]: { clientId, name } satisfies Seat,
    })
  })
}

/** A spectator leaving the room entirely (not swapping into a seat) — drops them from
 *  room.spectators so the "watching" list/count doesn't keep showing someone who's
 *  gone. Unlike becomeSpectator/claimSeat this isn't lobby-only: a spectator should
 *  be able to leave whenever, mid-round included. */
export async function leaveSpectator(roomCode: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return // already gone, nothing to clean up
    const room = snap.data() as RoomDoc
    if (!room.spectators?.[clientId]) return
    tx.update(ref, { [`spectators.${clientId}`]: deleteField() })
  })
}

/** Lobby-only: a spectator takes an open seat. */
export async function claimSeat(roomCode: string, seat: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.status !== 'lobby') throw new Error('Seats can only be changed between rounds')
    const order = seatOrderFor(room.mode)
    if (!order.includes(seat)) throw new Error('Invalid seat')
    if (room.seats[seat]) throw new Error('That seat is already taken')
    const spectator = room.spectators?.[clientId]
    if (!spectator) throw new Error("You're not currently spectating")
    tx.update(ref, {
      [`seats.${seat}`]: { clientId, name: spectator.name } satisfies Seat,
      [`spectators.${clientId}`]: deleteField(),
    })
  })
}

/** Sends everyone (both players and any spectators) back to the lobby screen between
 *  rounds, via the same room.status the initial lobby-before-game-starts uses — reuses
 *  all of Lobby's existing seat-list/routing rather than building a separate mid-game
 *  "manage seats" screen. `room.game` is deliberately left as-is (not cleared): Lobby
 *  uses it to show which round just finished, and continueToNextRound reads the round
 *  number/opener back out of it. */
export async function returnToLobby(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.status !== 'playing') throw new Error('Not currently playing')
    tx.update(ref, { status: 'lobby' })
  })
}

/** Deals the next round and resumes play, continuing the round count/opener rotation
 *  from the previous round — unlike restartMatch, which scraps everything back to
 *  round 1. Reads player names fresh from the current seats (not the stale names
 *  baked into the previous round's game state), since rotation may have swapped who's
 *  actually sitting in p1/p2 while everyone was back in the lobby. */
export async function continueToNextRound(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.mode !== '2p') throw new Error('Only 2P games are wired up currently')
    if (!room.game) throw new Error('No round to continue from — start a new game instead')

    const order = seatOrderFor(room.mode)
    const filled = order.every((seat) => room.seats[seat])
    if (!filled) throw new Error('Waiting for players to fill both seats')

    const prevGame = fromFirestoreGame(room.game)
    const names: Record<PlayerId, string> = {
      p1: room.seats.p1!.name,
      p2: room.seats.p2!.name,
    }
    const nextRound = startTwoPlayerRound(prevGame.round + 1, nextTwoPOpener(prevGame.opener, PLAYERS), names)
    tx.update(ref, { status: 'playing', game: toFirestoreGame(nextRound) })
  })
}

export function subscribeToRoom(roomCode: string, onChange: (room: (RoomDoc & { code: string }) | null) => void): Unsubscribe {
  return onSnapshot(roomRef(roomCode), (snap) => {
    onChange(snap.exists() ? { ...(snap.data() as RoomDoc), code: roomCode.toUpperCase() } : null)
  })
}

/** One-off read (not live) — used to check "am I already seated here?" on app load,
 *  before deciding whether to resume straight into the room or show the join screen. */
export async function getRoomOnce(roomCode: string): Promise<(RoomDoc & { code: string }) | null> {
  const snap = await getDoc(roomRef(roomCode))
  return snap.exists() ? { ...(snap.data() as RoomDoc), code: roomCode.toUpperCase() } : null
}

export function isSeated(room: RoomDoc, clientId: string): boolean {
  return Object.values(room.seats).some((seat) => seat?.clientId === clientId)
}

/** Host-only, lobby-only: flips the "track played cards" house rule for the match
 *  about to start. Both players are bound by whatever this is set to once the game
 *  starts — it's not a per-player preference, so it can't be changed mid-match.
 *
 *  Plain `updateDoc` rather than `runTransaction`: this is a single-field write with
 *  no derived state and nothing else can race it, so there's nothing a read-then-write
 *  round trip buys here — it only costs one. The host/lobby-only gating is already
 *  enforced by the UI (the toggle only renders, un-disabled, for the host in the
 *  Lobby screen), consistent with the rest of the app's trust model (firestore.rules
 *  is wide open — there's no real server-side authorization anywhere else either).
 *  `updateDoc` also lands in Firestore's local write cache immediately, so the
 *  subscribed `onSnapshot` listener (and therefore the toggle's visual state) updates
 *  right away instead of waiting on a transaction's round trip to the server. */
export async function setTrackPlayedCards(roomCode: string, _clientId: string, enabled: boolean): Promise<void> {
  await updateDoc(roomRef(roomCode), { trackPlayedCardsEnabled: enabled })
}

/** Host-only: deals the first round and marks the room as playing. */
export async function startGame(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.mode !== '2p') throw new Error('Only 2P games are wired up currently')

    const order = seatOrderFor(room.mode)
    const filled = order.every((seat) => room.seats[seat])
    if (!filled) throw new Error('Waiting for more players to join')

    // p1 is always whoever claimed the first seat (the host) — matches spec §1.4:
    // "the player who drew first must open the bidding."
    const names: Record<PlayerId, string> = {
      p1: room.seats.p1!.name,
      p2: room.seats.p2!.name,
    }
    const game = toFirestoreGame(startTwoPlayerRound(1, 'p1', names))
    tx.update(ref, { status: 'playing', game })
  })
}

/** Either player can end a live match for both — sets status to 'ended' rather than
 *  deleting the room, so the other player's live subscription can show who ended it
 *  instead of just "this room no longer exists". */
export async function endMatch(roomCode: string, endedBy: PlayerId): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.status !== 'playing') throw new Error('The match is not in progress')
    tx.update(ref, { status: 'ended', endedBy })
  })
}

/** Scraps the current match and deals a fresh round 1 for the same two seats — usable
 *  either mid-match or from the 'ended' screen (a de-facto "play again"), so this sets
 *  status back to 'playing' and clears endedBy unconditionally rather than going
 *  through the generic applyGameAction (which only touches the `game` field, not
 *  `status` — restarting from 'ended' needs both to flip together in one write). */
export async function restartMatch(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.mode !== '2p') throw new Error('Only 2P games are wired up currently')
    if (room.status === 'lobby') throw new Error('The match has not started yet')

    const names: Record<PlayerId, string> = {
      p1: room.seats.p1!.name,
      p2: room.seats.p2!.name,
    }
    const game = toFirestoreGame(startTwoPlayerRound(1, 'p1', names))
    tx.update(ref, { status: 'playing', game, endedBy: null })
  })
}

// ---------------------------------------------------------------------------
// 4P — team assignment, dice-roll turn order, dealing. endMatch/returnToLobby/
// leaveSpectator/becomeSpectator/claimSeat above are already mode-generic and
// used as-is for 4P too; only the parts that touch TwoPlayerGameState specifically
// (startGame/continueToNextRound/restartMatch) needed 4P counterparts.
// ---------------------------------------------------------------------------

function namesFromSeats(room: RoomDoc): Record<PlayerId, string> {
  return Object.fromEntries(FOUR_P_SEAT_ORDER.map((s) => [s, room.seats[s]!.name])) as Record<PlayerId, string>
}

/** Host-only, lobby-only: pick manual seating/opener vs. dice-rolling for the round
 *  about to be dealt. Re-chooseable every time the room is back in the lobby — see
 *  returnToLobby — not locked in for the whole match. */
// setTeamMode4P/setPendingOpener4P are plain `updateDoc` calls, not `runTransaction`
// — same reasoning as setTrackPlayedCards above: single-field writes, nothing else
// races them, and the host/lobby-only gating is already enforced by the UI. These two
// specifically are clicked back-and-forth while a group is settling into the lobby
// (switching Manual/Randomize, re-picking an opener), so the instant local-cache echo
// `updateDoc` gets from Firestore — versus a transaction's mandatory round trip to the
// server before the change reflects anywhere — is the difference between the buttons
// feeling immediate and feeling laggy.
export async function setTeamMode4P(roomCode: string, _clientId: string, mode: 'manual' | 'dice'): Promise<void> {
  await updateDoc(roomRef(roomCode), { teamMode4p: mode })
}

/** Host-only, lobby-only, manual mode: pick who opens the round about to be dealt. */
export async function setPendingOpener4P(roomCode: string, _clientId: string, opener: PlayerId): Promise<void> {
  await updateDoc(roomRef(roomCode), { pendingOpener4p: opener })
}

/** Host-only, manual mode: deals the round about to be played (round 1, or the next
 *  one after returnToLobby) using the current seats and the host's chosen opener. */
export async function dealFourPRound(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.mode !== '4p') throw new Error('Only 4P rooms use this')
    const filled = FOUR_P_SEAT_ORDER.every((s) => room.seats[s])
    if (!filled) throw new Error('Waiting for all 4 seats to fill')
    const opener = room.pendingOpener4p
    if (!opener || !FOUR_P_SEAT_ORDER.includes(opener)) throw new Error('Choose who opens before starting')

    const prevRound = room.game4p?.round ?? 0
    const game4p = startFourPlayerRound(prevRound + 1, FOUR_P_SEAT_ORDER, FOUR_P_TEAMS, namesFromSeats(room), opener)
    tx.update(ref, { status: 'playing', game4p, pendingOpener4p: deleteField() })
  })
}

/** Host-only, lobby-only: kicks off a dice roll for the round about to be dealt —
 *  Lobby shows the roll screen instead of the normal seat list while this is set.
 *  Resolving it (see rollDice4P) reseats players by roll rank and deals directly, so
 *  there's no separate "now deal" step for dice mode the way manual mode has one. */
export async function startDiceRoll4P(roomCode: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.hostClientId !== clientId) throw new Error('Only the host can start the dice roll')
    if (room.status !== 'lobby') throw new Error('This can only happen between rounds')
    const filled = FOUR_P_SEAT_ORDER.every((s) => room.seats[s])
    if (!filled) throw new Error('Waiting for all 4 seats to fill')
    tx.update(ref, { diceRollActive4p: true, diceRolls4p: {} })
  })
}

/** Any seated player, while a dice roll is active: rolls a d10 for themselves. Once
 *  all 4 have rolled, resolves automatically — ties re-roll (only the tied players'
 *  entries get cleared, everyone else's roll stands), otherwise ranks descending,
 *  reseats blue1/red1/blue2/red2 by that rank (so blue1/blue2 and red1/red2 land on
 *  whichever pairing the ranking produced — rank 1 and 3 end up teamed, 2 and 4 end
 *  up teamed, matching FOUR_P_TEAMS), and deals with the top roller as opener. */
export async function rollDice4P(roomCode: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  const roll = 1 + Math.floor(Math.random() * 10)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.mode !== '4p') throw new Error('Dice rolling is 4P only')
    if (!room.diceRollActive4p) throw new Error('No dice roll in progress')
    const seat = FOUR_P_SEAT_ORDER.find((s) => room.seats[s]?.clientId === clientId)
    if (!seat) throw new Error("You're not seated in this room")

    const rolls = { ...(room.diceRolls4p ?? {}), [clientId]: roll }
    const allRolled = FOUR_P_SEAT_ORDER.every((s) => {
      const occupant = room.seats[s]
      return occupant && rolls[occupant.clientId] !== undefined
    })
    if (!allRolled) {
      tx.update(ref, { [`diceRolls4p.${clientId}`]: roll })
      return
    }

    const entries = FOUR_P_SEAT_ORDER.map((s) => {
      const occupant = room.seats[s]!
      return { seat: s, clientId: occupant.clientId, name: occupant.name, roll: rolls[occupant.clientId] }
    })

    const counts = new Map<number, number>()
    for (const e of entries) counts.set(e.roll, (counts.get(e.roll) ?? 0) + 1)
    const hasTie = [...counts.values()].some((n) => n > 1)
    if (hasTie) {
      const clearedRolls = { ...rolls }
      for (const e of entries) {
        if ((counts.get(e.roll) ?? 0) > 1) delete clearedRolls[e.clientId]
      }
      tx.update(ref, { diceRolls4p: clearedRolls })
      return
    }

    const ranked = [...entries].sort((a, b) => b.roll - a.roll)
    const newSeats: Partial<Record<string, Seat>> = {}
    ranked.forEach((e, i) => {
      newSeats[FOUR_P_SEAT_ORDER[i]] = { clientId: e.clientId, name: e.name }
    })

    const prevRound = room.game4p?.round ?? 0
    const names: Record<PlayerId, string> = Object.fromEntries(
      FOUR_P_SEAT_ORDER.map((s) => [s, newSeats[s]!.name]),
    ) as Record<PlayerId, string>
    const game4p = startFourPlayerRound(prevRound + 1, FOUR_P_SEAT_ORDER, FOUR_P_TEAMS, names, FOUR_P_SEAT_ORDER[0])

    tx.update(ref, {
      seats: newSeats,
      status: 'playing',
      game4p,
      diceRollActive4p: false,
      diceRolls4p: deleteField(),
      pendingOpener4p: deleteField(),
    })
  })
}

/** Scraps the current match and deals a fresh round 1 for the same 4 seats — the 4P
 *  counterpart to restartMatch. Uses the host's last-chosen opener if one's still set,
 *  otherwise defaults to blue1 rather than blocking the restart on re-picking one. */
export async function restartMatch4P(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.mode !== '4p') throw new Error('Only 4P rooms use this')
    if (room.status === 'lobby') throw new Error('The match has not started yet')
    const filled = FOUR_P_SEAT_ORDER.every((s) => room.seats[s])
    if (!filled) throw new Error('Waiting for all 4 seats to fill')

    const opener = room.pendingOpener4p && FOUR_P_SEAT_ORDER.includes(room.pendingOpener4p) ? room.pendingOpener4p : FOUR_P_SEAT_ORDER[0]
    const game4p = startFourPlayerRound(1, FOUR_P_SEAT_ORDER, FOUR_P_TEAMS, namesFromSeats(room), opener)
    tx.update(ref, { status: 'playing', game4p, endedBy: null, pendingOpener4p: deleteField() })
  })
}

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
  type Unsubscribe,
} from 'firebase/firestore'
import { nextTwoPOpener, type PlayerId } from '../engine'
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
}

function seatOrderFor(mode: GameMode): string[] {
  return mode === '2p' ? ['p1', 'p2'] : ['blue1', 'red1', 'blue2', 'red2']
}

function generateCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
}

function roomRef(roomCode: string): DocumentReference {
  return doc(db, 'rooms', roomCode.toUpperCase())
}

/** Creates a new room with the host in the first seat. Retries on room-code collision. */
export async function createRoom(mode: GameMode, hostName: string, hostClientId: string): Promise<string> {
  if (mode === '4p') {
    throw new Error('4-player rooms are not wired up yet — 2P only for now')
  }

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
 *  starts — it's not a per-player preference, so it can't be changed mid-match. */
export async function setTrackPlayedCards(roomCode: string, clientId: string, enabled: boolean): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (room.hostClientId !== clientId) throw new Error('Only the host can change this setting')
    if (room.status !== 'lobby') throw new Error('This can only be changed before the match starts')
    tx.update(ref, { trackPlayedCardsEnabled: enabled })
  })
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

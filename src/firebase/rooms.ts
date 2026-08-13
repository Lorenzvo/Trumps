// Room creation/joining and the lobby's real-time sync. This is deliberately scoped
// to getting players into a shared, synced room first — wiring the actual card game
// engine through Firestore (so play itself is networked) is the next step after this.
//
// Room codes avoid ambiguous characters (no 0/O, 1/I) since people read them aloud or
// type them from a screen.

import {
  doc,
  DocumentReference,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './config'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5
const MAX_CREATE_ATTEMPTS = 5

export type GameMode = '2p' | '4p'
export type RoomStatus = 'lobby' | 'playing'

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

/** Atomically claims the next open seat in an existing lobby room. */
export async function joinRoom(roomCode: string, name: string, clientId: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error(`No room found with code ${roomCode.toUpperCase()}`)
    const room = snap.data() as RoomDoc
    if (room.status !== 'lobby') throw new Error('That game has already started')

    const order = seatOrderFor(room.mode)
    const alreadySeated = order.find((seat) => room.seats[seat]?.clientId === clientId)
    if (alreadySeated) return // rejoining the same room in the same tab — no-op

    const openSeat = order.find((seat) => !room.seats[seat])
    if (!openSeat) throw new Error('That room is already full')

    tx.update(ref, { [`seats.${openSeat}`]: { clientId, name } satisfies Seat })
  })
}

export function subscribeToRoom(roomCode: string, onChange: (room: (RoomDoc & { code: string }) | null) => void): Unsubscribe {
  return onSnapshot(roomRef(roomCode), (snap) => {
    onChange(snap.exists() ? { ...(snap.data() as RoomDoc), code: roomCode.toUpperCase() } : null)
  })
}

/** Host-only: marks the lobby as started. Actual networked gameplay wiring is next. */
export async function startGame(roomCode: string): Promise<void> {
  const ref = roomRef(roomCode)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    const order = seatOrderFor(room.mode)
    const filled = order.every((seat) => room.seats[seat])
    if (!filled) throw new Error('Waiting for more players to join')
    tx.update(ref, { status: 'playing' })
  })
}

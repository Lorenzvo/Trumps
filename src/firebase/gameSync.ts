// Applies a game-state transition to a room's synced game, via a transaction so
// concurrent writes (both players' clients acting near-simultaneously) can't clobber
// each other or apply on top of stale state. `compute` is one of the pure applyX
// functions from game/twoPlayerReducer.ts — if it throws (illegal move), the whole
// transaction rejects and nothing is written, same contract as the local hot-seat
// build's safeUpdate.

import { doc, runTransaction } from 'firebase/firestore'
import type { TwoPlayerGameState } from '../game/twoPlayerReducer'
import { db } from './config'
import { fromFirestoreGame, toFirestoreGame } from './gameSerialize'
import type { RoomDoc } from './rooms'

export async function applyGameAction(
  roomCode: string,
  compute: (s: TwoPlayerGameState) => TwoPlayerGameState,
): Promise<void> {
  const ref = doc(db, 'rooms', roomCode.toUpperCase())
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room no longer exists')
    const room = snap.data() as RoomDoc
    if (!room.game) throw new Error('The game has not started yet')
    const nextGame = compute(fromFirestoreGame(room.game))
    tx.update(ref, { game: toFirestoreGame(nextGame) })
  })
}

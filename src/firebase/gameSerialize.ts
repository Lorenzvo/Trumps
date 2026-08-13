// Firestore rejects arrays nested directly inside arrays ("Nested arrays are not
// supported"). Everywhere else in TwoPlayerGameState is arrays-of-objects or
// objects-containing-arrays, which Firestore is fine with — the one exception is
// DrawPhaseState.hands: [Card[], Card[]], a tuple that's literally an array of arrays
// at runtime. Converting that one field to a plain object at the Firestore boundary
// keeps the engine/reducer itself Firestore-agnostic; nothing else needs to change.

import type { Card } from '../engine'
import type { TwoPlayerGameState } from '../game/twoPlayerReducer'

interface FirestoreDrawHands {
  seat0: Card[]
  seat1: Card[]
}

export type FirestoreGameState = Omit<TwoPlayerGameState, 'draw'> & {
  draw: Omit<TwoPlayerGameState['draw'], 'hands'> & { hands: FirestoreDrawHands }
}

export function toFirestoreGame(state: TwoPlayerGameState): FirestoreGameState {
  return {
    ...state,
    draw: { ...state.draw, hands: { seat0: state.draw.hands[0], seat1: state.draw.hands[1] } },
  }
}

export function fromFirestoreGame(doc: FirestoreGameState): TwoPlayerGameState {
  return {
    ...doc,
    draw: { ...doc.draw, hands: [doc.draw.hands.seat0, doc.draw.hands.seat1] },
  }
}

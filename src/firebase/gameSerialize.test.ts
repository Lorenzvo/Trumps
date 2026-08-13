// Firestore rejects arrays nested directly inside arrays anywhere in the document —
// not just at the initial deal. This simulates a full round end to end (draw, bid,
// trump, kitty, all 12 tricks, round end, next round) and checks every single state
// transition's Firestore-serialized form for nested arrays, so a bug like the one that
// shipped (DrawPhaseState.hands) gets caught here instead of costing a live playtest.

import { describe, expect, it } from 'vitest'
import {
  applyBid,
  applyConfirmKitty,
  applyContinueAfterTrick,
  applyDrawCard,
  applyEndRoundEarly,
  applyNameTrump,
  applyNextRound,
  applyPass,
  applyPlayCard,
  applyResolveDraw,
  startTwoPlayerRound,
  type TwoPlayerGameState,
} from '../game/twoPlayerReducer'
import { toFirestoreGame } from './gameSerialize'

function hasNestedArray(value: unknown): boolean {
  if (Array.isArray(value)) {
    if (value.some((v) => Array.isArray(v))) return true
    return value.some(hasNestedArray)
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasNestedArray)
  }
  return false
}

function assertFirestoreSafe(state: TwoPlayerGameState, label: string) {
  const serialized = toFirestoreGame(state)
  expect(hasNestedArray(serialized), `nested array found after: ${label}`).toBe(false)
  // Also must survive an actual JSON round-trip cleanly (no undefined, no functions) —
  // Firestore is stricter than JSON in some ways but this catches gross issues early.
  expect(() => JSON.parse(JSON.stringify(serialized))).not.toThrow()
}

describe('Firestore-safety across a full simulated round', () => {
  it('never produces a nested array at any state transition', () => {
    let s = startTwoPlayerRound(1, 'p1', { p1: 'Alice', p2: 'Bob' })
    assertFirestoreSafe(s, 'start round')

    // Draw phase: 24 turns, alternating keep/discard.
    for (let turn = 0; turn < 24; turn++) {
      s = applyDrawCard(s)
      assertFirestoreSafe(s, `draw #${turn}`)
      s = applyResolveDraw(s, turn % 2 === 0 ? 'keep' : 'discard')
      assertFirestoreSafe(s, `resolve draw #${turn}`)
    }
    expect(s.phase).toBe('bidding')

    // Bidding: opener bids, other passes immediately (simplest path to a winner).
    s = applyBid(s, 4, 'high')
    assertFirestoreSafe(s, 'opening bid')
    s = applyPass(s)
    assertFirestoreSafe(s, 'pass to end bidding')
    expect(s.winningBid).not.toBeNull()

    if (s.phase === 'kitty') {
      // Exception path (opener won on first call): kitty first, then trump.
      s = applyConfirmKitty(s, [], [])
      assertFirestoreSafe(s, 'kitty exchange (pre-trump)')
    }
    s = applyNameTrump(s, 'spades')
    assertFirestoreSafe(s, 'name trump')
    if (s.phase === 'kitty') {
      s = applyConfirmKitty(s, [], [])
      assertFirestoreSafe(s, 'kitty exchange (post-trump)')
    }
    expect(s.phase).toBe('trick')

    // Play all 12 tricks to completion.
    let guard = 0
    while (s.phase === 'trick' && guard < 200) {
      guard++
      const trickComplete = s.trick.plays.length === 2
      if (trickComplete) {
        s = applyContinueAfterTrick(s)
        assertFirestoreSafe(s, `continue after trick (tricksPlayed=${s.tricksPlayed})`)
        continue
      }
      const leader = s.trickLeader!
      const toAct = s.trick.plays.length === 0 ? leader : (s.trick.plays[0].playerId === 'p1' ? 'p2' : 'p1')
      const hand = s.hands[toAct]
      const card = hand[0] // may be illegal, but this is just exercising serialization, not rules
      try {
        s = applyPlayCard(s, toAct, card)
      } catch {
        // If the first card isn't legal, just try the rest of the hand.
        const played = hand.find((c) => {
          try {
            applyPlayCard(s, toAct, c)
            return true
          } catch {
            return false
          }
        })
        if (!played) break
        s = applyPlayCard(s, toAct, played)
      }
      assertFirestoreSafe(s, `play card (tricksPlayed=${s.tricksPlayed})`)
      if (s.phase !== 'trick') break
    }

    if (s.phase !== 'round-end') {
      s = applyEndRoundEarly(s)
      assertFirestoreSafe(s, 'end round early (fallback)')
    }
    expect(s.phase).toBe('round-end')

    s = applyNextRound(s)
    assertFirestoreSafe(s, 'next round')
    expect(s.round).toBe(2)
  })
})

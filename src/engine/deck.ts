// Deck construction and shuffling. See trumps-spec.md §1.1.

import type { Card } from './types'
import { RANKS, SUITS } from './types'

/** A fresh, unshuffled standard 52-card deck (no jokers). */
export function buildDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

/**
 * Fisher-Yates shuffle. Returns a new array; does not mutate the input.
 * Accepts an injectable `rng` (returning [0, 1)) so shuffles are reproducible in tests.
 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

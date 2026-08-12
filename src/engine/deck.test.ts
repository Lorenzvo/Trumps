import { describe, expect, it } from 'vitest'
import { buildDeck, shuffle } from './deck'
import { cardId } from './types'

describe('buildDeck', () => {
  it('builds 52 unique cards', () => {
    const deck = buildDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map(cardId)).size).toBe(52)
  })

  it('has 13 cards per suit and 4 per rank', () => {
    const deck = buildDeck()
    const bySuit = deck.filter((c) => c.suit === 'hearts')
    expect(bySuit).toHaveLength(13)
    const byRank = deck.filter((c) => c.rank === 'A')
    expect(byRank).toHaveLength(4)
  })
})

describe('shuffle', () => {
  it('preserves all items (a permutation, not a resample)', () => {
    const deck = buildDeck()
    const shuffled = shuffle(deck)
    expect(shuffled).toHaveLength(52)
    expect(new Set(shuffled.map(cardId))).toEqual(new Set(deck.map(cardId)))
  })

  it('does not mutate the input array', () => {
    const deck = buildDeck()
    const original = deck.slice()
    shuffle(deck)
    expect(deck).toEqual(original)
  })

  it('is deterministic given a seeded rng', () => {
    const deck = buildDeck()
    const seeded = () => 0.5
    expect(shuffle(deck, seeded)).toEqual(shuffle(deck, seeded))
  })
})

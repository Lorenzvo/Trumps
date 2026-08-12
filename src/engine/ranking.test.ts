import { describe, expect, it } from 'vitest'
import { rankStrength } from './ranking'

describe('rankStrength', () => {
  it('makes Ace the best card in high mode', () => {
    const aceStrength = rankStrength('A', 'high')
    for (const rank of ['K', 'Q', 'J', '10', '2'] as const) {
      expect(aceStrength).toBeGreaterThan(rankStrength(rank, 'high'))
    }
  })

  it('makes Ace the best card in low mode too', () => {
    const aceStrength = rankStrength('A', 'low')
    for (const rank of ['2', '3', 'K', 'Q'] as const) {
      expect(aceStrength).toBeGreaterThan(rankStrength(rank, 'low'))
    }
  })

  it('flips the ordering of 2 and King between modes', () => {
    // High mode: 2 is the worst card, King is near the best.
    expect(rankStrength('K', 'high')).toBeGreaterThan(rankStrength('2', 'high'))
    // Low mode: 2 is the second-best card, King is the worst.
    expect(rankStrength('2', 'low')).toBeGreaterThan(rankStrength('K', 'low'))
  })
})

import { describe, expect, it } from 'vitest'
import { canOfferEarlyEnd, computeTarget, evaluateRoundStatus } from './round'

describe('computeTarget', () => {
  it('is 8 minus the winning bid number', () => {
    expect(computeTarget(7)).toBe(1)
    expect(computeTarget(2)).toBe(6)
  })
})

describe('evaluateRoundStatus', () => {
  it('is in_progress while neither side has clinched', () => {
    const status = evaluateRoundStatus({ target: 6, defendSideTricks: 2, tricksPlayed: 5 })
    expect(status).toBe('in_progress')
  })

  it('defenders win the instant they reach target, even mid-round', () => {
    const status = evaluateRoundStatus({ target: 6, defendSideTricks: 6, tricksPlayed: 9 })
    expect(status).toBe('defenders_win')
  })

  it('bidders win if all 12 tricks are played and defenders never reached target', () => {
    const status = evaluateRoundStatus({ target: 6, defendSideTricks: 5, tricksPlayed: 12 })
    expect(status).toBe('bidders_win')
  })

  it('is bidders_clinched once target is mathematically out of reach before trick 12', () => {
    // target 6, defenders have 1, only 4 tricks remain (8 played) — 1+4=5 < 6, impossible.
    const status = evaluateRoundStatus({ target: 6, defendSideTricks: 1, tricksPlayed: 8 })
    expect(status).toBe('bidders_clinched')
    expect(canOfferEarlyEnd(status)).toBe(true)
  })

  it('is not clinched while the target is still reachable', () => {
    // target 6, defenders have 2, 5 tricks remain (7 played) — 2+5=7 >= 6, still reachable.
    const status = evaluateRoundStatus({ target: 6, defendSideTricks: 2, tricksPlayed: 7 })
    expect(status).toBe('in_progress')
    expect(canOfferEarlyEnd(status)).toBe(false)
  })
})

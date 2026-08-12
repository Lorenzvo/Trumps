import { describe, expect, it } from 'vitest'
import { applyFourPBid, startFourPBidding } from './bidding'
import { buildFourPBidOrder, nextTwoPOpener, validateFourPSeating } from './rotation'

describe('nextTwoPOpener', () => {
  it('alternates between the two players', () => {
    expect(nextTwoPOpener('alice', ['alice', 'bob'])).toBe('bob')
    expect(nextTwoPOpener('bob', ['alice', 'bob'])).toBe('alice')
  })

  it('rejects a player not in the pair', () => {
    expect(() => nextTwoPOpener('carol', ['alice', 'bob'])).toThrow()
  })
})

describe('validateFourPSeating', () => {
  const teams = { blue1: 'blue', red1: 'red', blue2: 'blue', red2: 'red' }

  it('accepts a properly alternating seating', () => {
    expect(() => validateFourPSeating(['blue1', 'red1', 'blue2', 'red2'], teams)).not.toThrow()
    expect(() => validateFourPSeating(['blue1', 'red2', 'blue2', 'red1'], teams)).not.toThrow()
  })

  it('rejects teammates seated back-to-back', () => {
    expect(() => validateFourPSeating(['blue1', 'blue2', 'red1', 'red2'], teams)).toThrow()
  })

  it('rejects more or fewer than 2 teams', () => {
    const threeTeams = { blue1: 'blue', red1: 'red', blue2: 'blue', red2: 'green' }
    expect(() => validateFourPSeating(['blue1', 'red1', 'blue2', 'red2'], threeTeams)).toThrow()
  })

  it('rejects an uneven team split', () => {
    const uneven = { blue1: 'blue', red1: 'blue', blue2: 'blue', red2: 'red' }
    expect(() => validateFourPSeating(['blue1', 'red1', 'blue2', 'red2'], uneven)).toThrow()
  })

  it('rejects a player with no team assigned', () => {
    const incomplete = { blue1: 'blue', red1: 'red', blue2: 'blue' }
    expect(() => validateFourPSeating(['blue1', 'red1', 'blue2', 'red2'], incomplete)).toThrow()
  })
})

describe('buildFourPBidOrder', () => {
  const seatOrder = ['blue1', 'red1', 'blue2', 'red2'] as const

  it('rotates the seating to start at the chosen opener', () => {
    expect(buildFourPBidOrder(seatOrder, 'blue2')).toEqual(['blue2', 'red2', 'blue1', 'red1'])
  })

  it('is a no-op rotation when the opener is already first', () => {
    expect(buildFourPBidOrder(seatOrder, 'blue1')).toEqual(seatOrder)
  })

  it('rejects an opener not in the seating', () => {
    expect(() => buildFourPBidOrder(seatOrder, 'green1')).toThrow()
  })

  it('always produces an order that starts bidding validly, whoever opens', () => {
    for (const opener of seatOrder) {
      const order = buildFourPBidOrder(seatOrder, opener)
      let state = startFourPBidding(order)
      expect(state.order[0]).toBe(opener)
      // The opener can never pass — this should not throw.
      state = applyFourPBid(state, { playerId: opener, number: 2, mode: 'high' })
      expect(state.turnIndex).toBe(1)
    }
  })
})

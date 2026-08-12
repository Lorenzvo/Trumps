import { describe, expect, it } from 'vitest'
import { applyFourPBid, applyTwoPBid, compareBids, startFourPBidding, startTwoPBidding } from './bidding'

describe('compareBids', () => {
  it('ranks weakest to strongest as 2H < 2L < 3H < 3L < ... < 7H < 7L', () => {
    const order = [
      { number: 2, mode: 'high' as const },
      { number: 2, mode: 'low' as const },
      { number: 3, mode: 'high' as const },
      { number: 3, mode: 'low' as const },
      { number: 7, mode: 'high' as const },
      { number: 7, mode: 'low' as const },
    ]
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareBids(order[i + 1], order[i])).toBeGreaterThan(0)
    }
  })

  it('a higher number always outranks a lower number regardless of mode', () => {
    expect(compareBids({ number: 3, mode: 'high' }, { number: 2, mode: 'low' })).toBeGreaterThan(0)
  })
})

describe('2P bidding', () => {
  it('does not allow the opener to pass', () => {
    const state = startTwoPBidding('alice', 'bob')
    expect(() => applyTwoPBid(state, { playerId: 'alice', pass: true })).toThrow()
  })

  it('awards the bid to the other player immediately on a pass', () => {
    let state = startTwoPBidding('alice', 'bob')
    state = applyTwoPBid(state, { playerId: 'alice', number: 4, mode: 'high' })
    state = applyTwoPBid(state, { playerId: 'bob', pass: true })
    expect(state.complete).toBe(true)
    expect(state.winner).toBe('alice')
  })

  it('rejects a bid that does not strictly outrank the current highest', () => {
    let state = startTwoPBidding('alice', 'bob')
    state = applyTwoPBid(state, { playerId: 'alice', number: 4, mode: 'low' })
    expect(() => applyTwoPBid(state, { playerId: 'bob', number: 4, mode: 'high' })).toThrow()
    expect(() => applyTwoPBid(state, { playerId: 'bob', number: 3, mode: 'low' })).toThrow()
  })

  it('rejects bidding out of turn', () => {
    const state = startTwoPBidding('alice', 'bob')
    expect(() => applyTwoPBid(state, { playerId: 'bob', number: 4, mode: 'high' })).toThrow()
  })

  it('auto-completes with the highest bid once both players exhaust 2 bids each', () => {
    let state = startTwoPBidding('alice', 'bob')
    state = applyTwoPBid(state, { playerId: 'alice', number: 2, mode: 'high' })
    state = applyTwoPBid(state, { playerId: 'bob', number: 3, mode: 'high' })
    state = applyTwoPBid(state, { playerId: 'alice', number: 4, mode: 'high' })
    expect(state.complete).toBe(false)
    state = applyTwoPBid(state, { playerId: 'bob', number: 5, mode: 'high' })
    expect(state.complete).toBe(true)
    expect(state.winner).toBe('bob')
    expect(state.highestBid).toEqual({ playerId: 'bob', number: 5, mode: 'high' })
  })
})

describe('4P bidding', () => {
  it('does not allow the opener to pass, same as 2P', () => {
    const state = startFourPBidding(['blue1', 'red1', 'blue2', 'red2'])
    expect(() => applyFourPBid(state, { playerId: 'blue1', pass: true })).toThrow()
  })

  it('lets non-opening players pass', () => {
    let state = startFourPBidding(['blue1', 'red1', 'blue2', 'red2'])
    state = applyFourPBid(state, { playerId: 'blue1', number: 3, mode: 'high' })
    state = applyFourPBid(state, { playerId: 'red1', pass: true })
    expect(state.complete).toBe(false)
    expect(state.turnIndex).toBe(2)
  })

  it('goes through turn order and awards the highest bid at the end', () => {
    let state = startFourPBidding(['blue1', 'red1', 'blue2', 'red2'])
    state = applyFourPBid(state, { playerId: 'blue1', number: 3, mode: 'high' })
    state = applyFourPBid(state, { playerId: 'red1', pass: true })
    state = applyFourPBid(state, { playerId: 'blue2', number: 5, mode: 'low' })
    expect(state.complete).toBe(false)
    // A later bid doesn't have to outrank the current highest — it just won't win.
    state = applyFourPBid(state, { playerId: 'red2', number: 4, mode: 'high' })
    expect(state.complete).toBe(true)
    expect(state.winner).toBe('blue2')
    expect(state.highestBid).toEqual({ playerId: 'blue2', number: 5, mode: 'low' })
  })

  it('rejects bidding out of turn order', () => {
    const state = startFourPBidding(['blue1', 'red1', 'blue2', 'red2'])
    expect(() => applyFourPBid(state, { playerId: 'red1', number: 4, mode: 'high' })).toThrow()
  })

  it('is guaranteed a winner: the opener cannot pass, and everyone after may only pass', () => {
    let state = startFourPBidding(['blue1', 'red1', 'blue2', 'red2'])
    state = applyFourPBid(state, { playerId: 'blue1', number: 2, mode: 'high' })
    state = applyFourPBid(state, { playerId: 'red1', pass: true })
    state = applyFourPBid(state, { playerId: 'blue2', pass: true })
    state = applyFourPBid(state, { playerId: 'red2', pass: true })
    expect(state.complete).toBe(true)
    expect(state.winner).toBe('blue1')
  })
})

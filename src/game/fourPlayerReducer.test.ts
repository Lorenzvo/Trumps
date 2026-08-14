import { describe, expect, it } from 'vitest'
import type { Card, PlayerId, TeamId } from '../engine'
import {
  applyBid,
  applyConfirmKitty,
  applyContinueAfterTrick,
  applyEndRoundEarly,
  applyNameTrump,
  applyNextRound,
  applyPass,
  applyPlayCard,
  nextInOrder,
  nextToActInTrick,
  opposingTeam,
  startFourPlayerRound,
  teammateOf,
  teamsOf,
  teamTricks,
  type FourPlayerGameState,
} from './fourPlayerReducer'

const SEAT_ORDER: readonly [PlayerId, PlayerId, PlayerId, PlayerId] = ['blue1', 'red1', 'blue2', 'red2']
const TEAMS: Record<PlayerId, TeamId> = { blue1: 'Blue', red1: 'Red', blue2: 'Blue', red2: 'Red' }
const NAMES: Record<PlayerId, string> = { blue1: 'Blue One', red1: 'Red One', blue2: 'Blue Two', red2: 'Red Two' }

function freshRound(opener: PlayerId = 'blue1') {
  return startFourPlayerRound(1, SEAT_ORDER, TEAMS, NAMES, opener)
}

describe('startFourPlayerRound', () => {
  it('deals 12 cards to each seat straight away, no draw phase', () => {
    const s = freshRound()
    for (const seat of SEAT_ORDER) {
      expect(s.hands[seat]).toHaveLength(12)
    }
    expect(s.kitty).toHaveLength(4)
    expect(s.phase).toBe('bidding')
  })

  it('builds the bid order starting at the given opener, alternating teams', () => {
    const s = freshRound('red1')
    expect(s.bidding.order[0]).toBe('red1')
    // No two consecutive bidders share a team.
    for (let i = 0; i < s.bidding.order.length - 1; i++) {
      expect(TEAMS[s.bidding.order[i]]).not.toBe(TEAMS[s.bidding.order[i + 1]])
    }
  })

  it('rejects an invalid team seating', () => {
    const badTeams = { ...TEAMS, red2: 'Blue' } // 3 Blue, 1 Red — invalid
    expect(() => startFourPlayerRound(1, SEAT_ORDER, badTeams, NAMES, 'blue1')).toThrow()
  })
})

describe('team/seat helpers', () => {
  it('teamsOf returns the two distinct teams', () => {
    const s = freshRound()
    expect(new Set(teamsOf(s))).toEqual(new Set(['Blue', 'Red']))
  })

  it('opposingTeam returns the other team', () => {
    const s = freshRound()
    expect(opposingTeam(s, 'Blue')).toBe('Red')
    expect(opposingTeam(s, 'Red')).toBe('Blue')
  })

  it('teammateOf finds the same-team partner, not self', () => {
    const s = freshRound()
    expect(teammateOf(s, 'blue1')).toBe('blue2')
    expect(teammateOf(s, 'red2')).toBe('red1')
  })

  it('nextInOrder cycles through the seat order, wrapping around', () => {
    expect(nextInOrder(SEAT_ORDER, 'blue1')).toBe('red1')
    expect(nextInOrder(SEAT_ORDER, 'red2')).toBe('blue1')
  })
})

describe('bidding -> exception detection', () => {
  it('flags the exception when the opener wins uncontested (everyone else passes)', () => {
    let s = freshRound('blue1')
    s = applyBid(s, 3, 'high')
    s = applyPass(s)
    s = applyPass(s)
    s = applyPass(s)
    expect(s.bidding.complete).toBe(true)
    expect(s.winningBid?.playerId).toBe('blue1')
    expect(s.exceptionKittyFirst).toBe(true)
    expect(s.phase).toBe('kitty')
  })

  it('does not flag the exception when someone else outbids the opener', () => {
    let s = freshRound('blue1')
    s = applyBid(s, 2, 'high')
    s = applyPass(s)
    s = applyBid(s, 5, 'low') // blue2 outbids
    s = applyPass(s)
    expect(s.winningBid?.playerId).toBe('blue2')
    expect(s.exceptionKittyFirst).toBe(false)
    expect(s.phase).toBe('trump')
  })

  it('the opener cannot pass', () => {
    const s = freshRound('blue1')
    expect(() => applyPass(s)).toThrow()
  })
})

describe('trump + kitty ordering', () => {
  it('exception path: kitty before trump, kitty is private to the bidder only', () => {
    let s = freshRound('blue1')
    s = applyBid(s, 3, 'high')
    s = applyPass(s)
    s = applyPass(s)
    s = applyPass(s)
    expect(s.phase).toBe('kitty')
    s = applyConfirmKitty(s, [], [])
    expect(s.phase).toBe('trump')
    s = applyNameTrump(s, 'spades')
    expect(s.phase).toBe('trick')
    expect(s.trickLeader).toBe('blue1')
  })

  it('normal path: trump named blind first, then kitty', () => {
    let s = freshRound('blue1')
    s = applyBid(s, 2, 'high')
    s = applyPass(s)
    s = applyBid(s, 5, 'low')
    s = applyPass(s)
    expect(s.phase).toBe('trump')
    s = applyNameTrump(s, 'hearts')
    expect(s.phase).toBe('kitty')
    s = applyConfirmKitty(s, [], [])
    expect(s.phase).toBe('trick')
    expect(s.trickLeader).toBe('blue2') // the actual bid winner
  })
})

/** Follow-suit/trump rules mean the first card in hand isn't always legal — find one
 *  that actually is, the same way a UI would only offer legal cards to click. */
function findLegalCard(s: FourPlayerGameState, playerId: PlayerId): Card {
  const legal = s.hands[playerId].find((c) => {
    try {
      applyPlayCard(s, playerId, c)
      return true
    } catch {
      return false
    }
  })
  if (!legal) throw new Error(`No legal card found for ${playerId}`)
  return legal
}

describe('trick play across 4 seats', () => {
  function toTrickPhase(): FourPlayerGameState {
    let s = freshRound('blue1')
    s = applyBid(s, 2, 'high')
    s = applyPass(s)
    s = applyPass(s)
    s = applyPass(s)
    s = applyConfirmKitty(s, [], [])
    s = applyNameTrump(s, 'spades')
    return s
  }

  it('play order cycles through all 4 seats before a trick resolves', () => {
    let s = toTrickPhase()
    const order: PlayerId[] = []
    for (let i = 0; i < 4; i++) {
      const toAct = nextToActInTrick(s)
      order.push(toAct)
      s = applyPlayCard(s, toAct, findLegalCard(s, toAct))
    }
    expect(order).toEqual(['blue1', 'red1', 'blue2', 'red2'])
    expect(s.tricksPlayed).toBe(1)
    expect(s.trick.plays).toHaveLength(4) // not cleared until applyContinueAfterTrick
  })

  it('the next trick leads from the previous winner, cycling from there', () => {
    let s = toTrickPhase()
    for (let i = 0; i < 4; i++) {
      const toAct = nextToActInTrick(s)
      s = applyPlayCard(s, toAct, findLegalCard(s, toAct))
    }
    const winner = s.trickHistory[0].winner
    s = applyContinueAfterTrick(s)
    expect(s.trickLeader).toBe(winner)
    expect(nextToActInTrick(s)).toBe(winner)
  })

  it('trick counts aggregate by team, not just the individual winner', () => {
    let s = toTrickPhase()
    for (let i = 0; i < 4; i++) {
      const toAct = nextToActInTrick(s)
      s = applyPlayCard(s, toAct, findLegalCard(s, toAct))
    }
    const winner = s.trickHistory[0].winner
    const winnerTeam = TEAMS[winner]
    expect(teamTricks(s, winnerTeam)).toBe(1)
    expect(teamTricks(s, opposingTeam(s, winnerTeam))).toBe(0)
  })

  it('plays a full round to completion without ever needing more than 12 tricks', () => {
    let s = toTrickPhase()
    let guard = 0
    while (s.phase === 'trick' && guard < 200) {
      guard++
      if (s.trick.plays.length === s.seatOrder.length) {
        s = applyContinueAfterTrick(s)
        continue
      }
      const toAct = nextToActInTrick(s)
      s = applyPlayCard(s, toAct, findLegalCard(s, toAct))
    }
    if (s.phase === 'trick') s = applyEndRoundEarly(s)
    expect(s.phase).toBe('round-end')
    expect(s.tricksPlayed).toBeLessThanOrEqual(12)
  })
})

describe('applyNextRound', () => {
  it('rotates the opener to the next seat and deals a fresh round', () => {
    let s = freshRound('blue1')
    s = applyBid(s, 2, 'high')
    s = applyPass(s)
    s = applyPass(s)
    s = applyPass(s)
    s = applyConfirmKitty(s, [], [])
    s = applyNameTrump(s, 'clubs')
    s = applyEndRoundEarly(s) // force round-end without playing it out, just to test rotation
    s = applyNextRound(s)
    expect(s.round).toBe(2)
    expect(s.opener).toBe('red1')
    expect(s.phase).toBe('bidding')
    expect(s.hands.blue1).toHaveLength(12)
  })
})

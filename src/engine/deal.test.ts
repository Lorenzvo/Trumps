import { describe, expect, it } from 'vitest'
import { buildDeck, shuffle } from './deck'
import { applyKittyExchange, deal4Players, drawCard, resolveDraw, setAsideKitty, startDrawPhase } from './deal'
import type { Card } from './types'
import { cardId } from './types'

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit })

function shuffledDeck() {
  return shuffle(buildDeck(), () => 0.42)
}

describe('setAsideKitty', () => {
  it('splits a 52-card deck into a 4-card kitty and 48 remaining', () => {
    const { kitty, remaining } = setAsideKitty(shuffledDeck())
    expect(kitty).toHaveLength(4)
    expect(remaining).toHaveLength(48)
    expect(new Set([...kitty, ...remaining].map(cardId)).size).toBe(52)
  })

  it('rejects a deck that is not a full 52 cards', () => {
    expect(() => setAsideKitty(shuffledDeck().slice(0, 51))).toThrow()
  })
})

describe('deal4Players', () => {
  it('deals 12 cards to each of 4 players with no overlap', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    const hands = deal4Players(remaining, ['p1', 'p2', 'p3', 'p4'])
    expect(hands.p1).toHaveLength(12)
    expect(hands.p2).toHaveLength(12)
    expect(hands.p3).toHaveLength(12)
    expect(hands.p4).toHaveLength(12)

    const allIds = [...hands.p1, ...hands.p2, ...hands.p3, ...hands.p4].map(cardId)
    expect(new Set(allIds).size).toBe(48)
  })

  it('rejects anything other than 48 cards', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    expect(() => deal4Players(remaining.slice(0, 40), ['p1', 'p2', 'p3', 'p4'])).toThrow()
  })
})

describe('2P draw phase', () => {
  it('deals 12 cards to each player after 24 turns, consuming all 48 cards', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    let state = startDrawPhase(remaining)

    let turns = 0
    while (!state.complete) {
      state = drawCard(state)
      // alternate keep/discard just to exercise both paths
      state = resolveDraw(state, turns % 2 === 0 ? 'keep' : 'discard')
      turns++
    }

    expect(turns).toBe(24)
    expect(state.hands[0]).toHaveLength(12)
    expect(state.hands[1]).toHaveLength(12)
    expect(state.middlePile).toHaveLength(0)
    expect(state.discardPile).toHaveLength(24)

    const allIds = [...state.hands[0], ...state.hands[1], ...state.discardPile].map(cardId)
    expect(new Set(allIds).size).toBe(48)
  })

  it('alternates turns between the two players', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    let state = startDrawPhase(remaining, 0)
    expect(state.turn).toBe(0)
    state = resolveDraw(drawCard(state), 'keep')
    expect(state.turn).toBe(1)
    state = resolveDraw(drawCard(state), 'keep')
    expect(state.turn).toBe(0)
  })

  it('on keep: the drawn card joins the hand and the next card is silently discarded', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    const state = startDrawPhase(remaining)
    const drawn = state.middlePile[0]
    const autoDiscarded = state.middlePile[1]

    const afterDraw = drawCard(state)
    expect(afterDraw.pendingCard).toEqual(drawn)

    const afterResolve = resolveDraw(afterDraw, 'keep')
    expect(afterResolve.hands[0]).toEqual([drawn])
    expect(afterResolve.discardPile).toEqual([autoDiscarded])
  })

  it('on discard: the drawn card is discarded and the next card is forced into the hand', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    const state = startDrawPhase(remaining)
    const drawn = state.middlePile[0]
    const forced = state.middlePile[1]

    const afterResolve = resolveDraw(drawCard(state), 'discard')
    expect(afterResolve.discardPile).toEqual([drawn])
    expect(afterResolve.hands[0]).toEqual([forced])
  })

  it('rejects drawing twice before resolving', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    const state = drawCard(startDrawPhase(remaining))
    expect(() => drawCard(state)).toThrow()
  })

  it('rejects resolving with no pending card', () => {
    const { remaining } = setAsideKitty(shuffledDeck())
    const state = startDrawPhase(remaining)
    expect(() => resolveDraw(state, 'keep')).toThrow()
  })
})

describe('applyKittyExchange', () => {
  const hand = [c('2', 'clubs'), c('3', 'clubs'), c('4', 'hearts')]
  const kitty = [c('A', 'spades'), c('K', 'spades'), c('Q', 'diamonds'), c('J', 'diamonds')]

  it('swaps N hand cards for N kitty cards, keeping both piles the same size', () => {
    const result = applyKittyExchange(hand, kitty, [c('2', 'clubs')], [c('A', 'spades')])
    expect(result.hand).toHaveLength(3)
    expect(result.kitty).toHaveLength(4)
    expect(result.hand.map(cardId)).toContain(cardId(c('A', 'spades')))
    expect(result.hand.map(cardId)).not.toContain(cardId(c('2', 'clubs')))
    expect(result.kitty.map(cardId)).toContain(cardId(c('2', 'clubs')))
    expect(result.kitty.map(cardId)).not.toContain(cardId(c('A', 'spades')))
  })

  it('allows swapping zero cards (a no-op exchange)', () => {
    const result = applyKittyExchange(hand, kitty, [], [])
    expect(result.hand.map(cardId)).toEqual(hand.map(cardId))
    expect(result.kitty.map(cardId)).toEqual(kitty.map(cardId))
  })

  it('allows swapping all 4 kitty cards at once', () => {
    const fullHand = [...hand, c('5', 'hearts')]
    const discard = fullHand.slice(0, 4)
    const result = applyKittyExchange(fullHand, kitty, discard, kitty)
    expect(result.hand).toHaveLength(4)
    expect(result.hand.map(cardId).sort()).toEqual(kitty.map(cardId).sort())
    expect(result.kitty.map(cardId).sort()).toEqual(discard.map(cardId).sort())
  })

  it('rejects mismatched counts', () => {
    expect(() => applyKittyExchange(hand, kitty, [c('2', 'clubs')], [])).toThrow()
  })

  it('rejects discarding a card not in hand', () => {
    expect(() => applyKittyExchange(hand, kitty, [c('9', 'spades')], [c('A', 'spades')])).toThrow()
  })

  it('rejects taking a card not in the kitty', () => {
    expect(() => applyKittyExchange(hand, kitty, [c('2', 'clubs')], [c('9', 'hearts')])).toThrow()
  })
})

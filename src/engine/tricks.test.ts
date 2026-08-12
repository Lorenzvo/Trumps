import { describe, expect, it } from 'vitest'
import type { Card } from './types'
import { cardBreaksTrump, isLegalPlay, legalCardsToPlay, playCard, resolveTrick, startTrick } from './tricks'

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit })

describe('legalCardsToPlay — leading', () => {
  it('cannot lead trump before it is broken if other suits are available', () => {
    const hand = [c('A', 'hearts'), c('K', 'spades')]
    const legal = legalCardsToPlay(hand, startTrick(), 'spades', false)
    expect(legal).toEqual([c('A', 'hearts')])
  })

  it('can lead trump once it has been broken', () => {
    const hand = [c('A', 'hearts'), c('K', 'spades')]
    const legal = legalCardsToPlay(hand, startTrick(), 'spades', true)
    expect(legal).toEqual(hand)
  })

  it('is forced to lead trump if the whole hand is trump', () => {
    const hand = [c('A', 'spades'), c('K', 'spades')]
    const legal = legalCardsToPlay(hand, startTrick(), 'spades', false)
    expect(legal).toEqual(hand)
  })
})

describe('legalCardsToPlay — following', () => {
  it('must follow the led suit when able', () => {
    const trick = playCard(startTrick(), 'p1', c('10', 'clubs'))
    const hand = [c('A', 'clubs'), c('2', 'clubs'), c('K', 'spades')]
    const legal = legalCardsToPlay(hand, trick, 'spades', false)
    expect(legal).toEqual([c('A', 'clubs'), c('2', 'clubs')])
  })

  it('may play anything, including optional trump, when void in the led suit', () => {
    const trick = playCard(startTrick(), 'p1', c('10', 'clubs'))
    const hand = [c('A', 'hearts'), c('K', 'spades')]
    const legal = legalCardsToPlay(hand, trick, 'spades', false)
    expect(legal).toEqual(hand)
  })
})

describe('isLegalPlay', () => {
  it('reflects legalCardsToPlay', () => {
    const trick = playCard(startTrick(), 'p1', c('10', 'clubs'))
    const hand = [c('A', 'clubs'), c('K', 'spades')]
    expect(isLegalPlay(hand, trick, c('A', 'clubs'), 'spades', false)).toBe(true)
    expect(isLegalPlay(hand, trick, c('K', 'spades'), 'spades', false)).toBe(false)
  })
})

describe('cardBreaksTrump', () => {
  it('is true only for the trump suit', () => {
    expect(cardBreaksTrump(c('2', 'spades'), 'spades')).toBe(true)
    expect(cardBreaksTrump(c('2', 'hearts'), 'spades')).toBe(false)
  })
})

describe('resolveTrick', () => {
  it('the highest card of the led suit wins when no trump is played', () => {
    let trick = startTrick()
    trick = playCard(trick, 'p1', c('9', 'clubs'))
    trick = playCard(trick, 'p2', c('A', 'clubs'))
    trick = playCard(trick, 'p3', c('K', 'clubs'))
    expect(resolveTrick(trick, 'spades', 'high')).toBe('p2')
  })

  it('the lowest card of the led suit wins in Low mode', () => {
    let trick = startTrick()
    trick = playCard(trick, 'p1', c('9', 'clubs'))
    trick = playCard(trick, 'p2', c('2', 'clubs'))
    trick = playCard(trick, 'p3', c('K', 'clubs'))
    // Ace would win even in low mode, but no ace is in play here — 2 is best-but-ace.
    expect(resolveTrick(trick, 'spades', 'low')).toBe('p2')
  })

  it('any trump beats a non-trump card of the led suit', () => {
    let trick = startTrick()
    trick = playCard(trick, 'p1', c('A', 'clubs'))
    trick = playCard(trick, 'p2', c('2', 'spades'))
    expect(resolveTrick(trick, 'spades', 'high')).toBe('p2')
  })

  it('the highest trump wins when multiple trumps are played', () => {
    let trick = startTrick()
    trick = playCard(trick, 'p1', c('A', 'clubs'))
    trick = playCard(trick, 'p2', c('2', 'spades'))
    trick = playCard(trick, 'p3', c('K', 'spades'))
    expect(resolveTrick(trick, 'spades', 'high')).toBe('p3')
  })

  it('ace of trump is always best, even in low mode', () => {
    let trick = startTrick()
    trick = playCard(trick, 'p1', c('2', 'spades'))
    trick = playCard(trick, 'p2', c('A', 'spades'))
    expect(resolveTrick(trick, 'spades', 'low')).toBe('p2')
  })
})

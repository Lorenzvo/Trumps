// Dealing: kitty set-aside, 4P deal, the 2P draw phase, and the kitty exchange.
// See trumps-spec.md §1.1-1.4.

import type { Card, PlayerId } from './types'
import { cardId } from './types'

export interface KittySplit {
  kitty: Card[]
  remaining: Card[]
}

/**
 * Sets aside 4 truly random cards as the kitty, leaving 48 for dealing/drawing.
 * `shuffledDeck` must already be shuffled — the "randomness" of the kitty comes entirely
 * from that shuffle, so this just slices the top 4.
 */
export function setAsideKitty(shuffledDeck: readonly Card[]): KittySplit {
  if (shuffledDeck.length !== 52) {
    throw new Error(`Expected a full 52-card deck, got ${shuffledDeck.length}`)
  }
  return { kitty: shuffledDeck.slice(0, 4), remaining: shuffledDeck.slice(4) }
}

// ---------------------------------------------------------------------------
// 4-player deal (no draw phase — spec §1.3)
// ---------------------------------------------------------------------------

/** Deals the 48 remaining cards 12 each to 4 players. `remaining48` must already be shuffled. */
export function deal4Players(
  remaining48: readonly Card[],
  playerIds: readonly [PlayerId, PlayerId, PlayerId, PlayerId],
): Record<PlayerId, Card[]> {
  if (remaining48.length !== 48) {
    throw new Error(`Expected 48 cards to deal, got ${remaining48.length}`)
  }
  const hands: Record<PlayerId, Card[]> = {}
  playerIds.forEach((id, i) => {
    hands[id] = remaining48.slice(i * 12, i * 12 + 12)
  })
  return hands
}

// ---------------------------------------------------------------------------
// 2-player draw phase (spec §1.2)
// ---------------------------------------------------------------------------

export type SeatIndex = 0 | 1

export interface DrawPhaseState {
  middlePile: Card[]
  hands: [Card[], Card[]]
  /** Cards permanently removed from the game, unseen by anyone. */
  discardPile: Card[]
  turn: SeatIndex
  /** The card just drawn from the pile, awaiting a keep/discard decision. */
  pendingCard: Card | null
  complete: boolean
}

/** `remaining48` must already be shuffled. */
export function startDrawPhase(remaining48: readonly Card[], firstPlayer: SeatIndex = 0): DrawPhaseState {
  if (remaining48.length !== 48) {
    throw new Error(`Expected 48 cards for the draw phase, got ${remaining48.length}`)
  }
  return {
    middlePile: remaining48.slice(),
    hands: [[], []],
    discardPile: [],
    turn: firstPlayer,
    pendingCard: null,
    complete: false,
  }
}

/** The current player draws the top card of the middle pile, revealing it to themselves. */
export function drawCard(state: DrawPhaseState): DrawPhaseState {
  if (state.complete) throw new Error('Draw phase is already complete')
  if (state.pendingCard) throw new Error('A card is already drawn — resolve it before drawing again')
  if (state.middlePile.length === 0) throw new Error('Middle pile is empty')

  const [card, ...rest] = state.middlePile
  return { ...state, middlePile: rest, pendingCard: card }
}

/**
 * Resolves the current player's keep/discard decision (spec §1.2):
 *  - 'keep': the drawn card joins their hand; the next card is auto-discarded unseen.
 *  - 'discard': the drawn card is discarded unseen; the next card is forced into their
 *    hand, sight unseen at the time of the decision.
 * Either path removes exactly 2 cards from the middle pile and passes the turn.
 */
export function resolveDraw(state: DrawPhaseState, decision: 'keep' | 'discard'): DrawPhaseState {
  if (!state.pendingCard) throw new Error('No card has been drawn yet')

  const pending = state.pendingCard
  let middlePile = state.middlePile
  const hands: [Card[], Card[]] = [state.hands[0].slice(), state.hands[1].slice()]
  const discardPile = state.discardPile.slice()

  if (decision === 'keep') {
    hands[state.turn].push(pending)
    if (middlePile.length > 0) {
      discardPile.push(middlePile[0])
      middlePile = middlePile.slice(1)
    }
  } else {
    discardPile.push(pending)
    if (middlePile.length > 0) {
      hands[state.turn].push(middlePile[0])
      middlePile = middlePile.slice(1)
    }
  }

  const complete = hands[0].length >= 12 && hands[1].length >= 12
  const nextTurn: SeatIndex = state.turn === 0 ? 1 : 0

  return {
    middlePile,
    hands,
    discardPile,
    turn: complete ? state.turn : nextTurn,
    pendingCard: null,
    complete,
  }
}

// ---------------------------------------------------------------------------
// Kitty exchange (spec §1.4)
// ---------------------------------------------------------------------------

/**
 * The bid winner swaps any number of kitty cards into their hand, discarding the same
 * number back out. Hand size stays at 12; the kitty stays at 4 (the discarded cards
 * replace the ones taken, so nothing here is destroyed or created).
 */
export function applyKittyExchange(
  hand: readonly Card[],
  kitty: readonly Card[],
  cardsToDiscardFromHand: readonly Card[],
  cardsToTakeFromKitty: readonly Card[],
): { hand: Card[]; kitty: Card[] } {
  if (cardsToDiscardFromHand.length !== cardsToTakeFromKitty.length) {
    throw new Error('Must discard the same number of cards from hand as taken from the kitty')
  }
  for (const card of cardsToDiscardFromHand) {
    if (!hand.some((c) => c.suit === card.suit && c.rank === card.rank)) {
      throw new Error(`Card not in hand: ${cardId(card)}`)
    }
  }
  for (const card of cardsToTakeFromKitty) {
    if (!kitty.some((c) => c.suit === card.suit && c.rank === card.rank)) {
      throw new Error(`Card not in kitty: ${cardId(card)}`)
    }
  }

  const isDiscarded = (c: Card) => cardsToDiscardFromHand.some((d) => d.suit === c.suit && d.rank === c.rank)
  const isTaken = (c: Card) => cardsToTakeFromKitty.some((t) => t.suit === c.suit && t.rank === c.rank)

  return {
    hand: [...hand.filter((c) => !isDiscarded(c)), ...cardsToTakeFromKitty],
    kitty: [...kitty.filter((c) => !isTaken(c)), ...cardsToDiscardFromHand],
  }
}

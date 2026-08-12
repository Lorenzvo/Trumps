// Trick play: legal-move enforcement and trick resolution. See trumps-spec.md §1.5.

import type { Card, Mode, PlayerId, Suit } from './types'
import { rankStrength } from './ranking'

export interface PlayedCard {
  playerId: PlayerId
  card: Card
}

export interface TrickState {
  ledSuit: Suit | null
  plays: PlayedCard[]
}

export function startTrick(): TrickState {
  return { ledSuit: null, plays: [] }
}

/**
 * The cards `hand` is allowed to play right now, per spec §1.5:
 *  - Leading: must follow with a non-trump card unless trump has been broken, or the
 *    hand is entirely trump (in which case leading trump is unavoidable).
 *  - Following: must follow the led suit if holding any.
 *  - Void in the led suit: may play any card — trump is always optional, never forced.
 */
export function legalCardsToPlay(
  hand: readonly Card[],
  trick: TrickState,
  trumpSuit: Suit,
  trumpBroken: boolean,
): Card[] {
  const isLeading = trick.plays.length === 0

  if (isLeading) {
    const nonTrump = hand.filter((c) => c.suit !== trumpSuit)
    if (!trumpBroken && nonTrump.length > 0) return nonTrump
    return hand.slice()
  }

  const ledSuit = trick.ledSuit as Suit
  const followingSuit = hand.filter((c) => c.suit === ledSuit)
  if (followingSuit.length > 0) return followingSuit

  return hand.slice()
}

export function isLegalPlay(
  hand: readonly Card[],
  trick: TrickState,
  card: Card,
  trumpSuit: Suit,
  trumpBroken: boolean,
): boolean {
  return legalCardsToPlay(hand, trick, trumpSuit, trumpBroken).some(
    (c) => c.suit === card.suit && c.rank === card.rank,
  )
}

/** Returns the new trick state after `playerId` plays `card`. Does not validate legality. */
export function playCard(trick: TrickState, playerId: PlayerId, card: Card): TrickState {
  const isFirstPlay = trick.plays.length === 0
  return {
    ledSuit: isFirstPlay ? card.suit : trick.ledSuit,
    plays: [...trick.plays, { playerId, card }],
  }
}

/** True if this card, once played, breaks trump for the rest of the round. */
export function cardBreaksTrump(card: Card, trumpSuit: Suit): boolean {
  return card.suit === trumpSuit
}

/**
 * Resolves a completed trick (spec §1.5-1.6): if any trump was played, the highest
 * trump wins; otherwise the best card of the led suit wins, "best" depending on the
 * round's High/Low mode.
 */
export function resolveTrick(trick: TrickState, trumpSuit: Suit, mode: Mode): PlayerId {
  if (trick.plays.length === 0) throw new Error('Cannot resolve an empty trick')

  const trumpPlays = trick.plays.filter((p) => p.card.suit === trumpSuit)
  const contest = trumpPlays.length > 0 ? trumpPlays : trick.plays.filter((p) => p.card.suit === trick.ledSuit)

  let best = contest[0]
  for (const play of contest.slice(1)) {
    if (rankStrength(play.card.rank, mode) > rankStrength(best.card.rank, mode)) {
      best = play
    }
  }
  return best.playerId
}

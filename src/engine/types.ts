// Core domain types for Trumps. Pure data — no engine logic lives here.
// See trumps-spec.md §1 for the rules these types encode.

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'

export const SUITS: readonly Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

export const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export interface Card {
  suit: Suit
  rank: Rank
}

/** A round is played entirely in one direction: High or Low card ranking (spec §1.6). */
export type Mode = 'high' | 'low'

export type PlayerId = string

/** A bid names a trick target (2-7) and a direction. See spec §1.4. */
export interface Bid {
  playerId: PlayerId
  number: number // integer 2-7
  mode: Mode
}

export interface PassAction {
  playerId: PlayerId
  pass: true
}

export type BidAction = Bid | PassAction

export function isPass(action: BidAction): action is PassAction {
  return 'pass' in action && action.pass === true
}

/** Stable string id for a card, handy for equality checks, React keys, and Firestore fields. */
export function cardId(card: Card): string {
  return `${card.rank}-${card.suit}`
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank
}

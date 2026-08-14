// Pure 2P game state + transitions. No React, no Firestore — this is the shared core
// that both the local hot-seat build and the networked (Firestore-synced) build run
// through, so they can never drift out of sync with each other. Every applyX function
// either returns the next state or throws (illegal move) — callers decide what to do
// with a throw (show a local error, reject a Firestore transaction, etc).

import {
  applyKittyExchange,
  applyTwoPBid,
  buildDeck,
  cardBreaksTrump,
  computeTarget,
  drawCard,
  evaluateRoundStatus,
  isLegalPlay,
  isPass,
  isRoundOver,
  nextTwoPOpener,
  playCard,
  resolveDraw,
  resolveTrick,
  setAsideKitty,
  shuffle,
  startDrawPhase,
  startTrick,
  startTwoPBidding,
} from '../engine'
import type {
  Bid,
  Card,
  DrawPhaseState,
  Mode,
  PlayedCard,
  PlayerId,
  RoundOutcome,
  Suit,
  TrickState,
  TwoPBiddingState,
} from '../engine'

export const PLAYERS: readonly [PlayerId, PlayerId] = ['p1', 'p2']

export function otherOf(playerId: PlayerId): PlayerId {
  return playerId === 'p1' ? 'p2' : 'p1'
}

export type TwoPlayerPhase = 'draw' | 'bidding' | 'trump' | 'kitty' | 'trick' | 'round-end'

export interface TwoPlayerGameState {
  round: number
  opener: PlayerId
  names: Record<PlayerId, string>
  kitty: Card[]
  draw: DrawPhaseState
  hands: Record<PlayerId, Card[]>
  bidding: TwoPBiddingState
  winningBid: Bid | null
  exceptionKittyFirst: boolean
  trumpSuit: Suit | null
  trick: TrickState
  trumpBroken: boolean
  trickLeader: PlayerId | null
  trickCounts: Record<PlayerId, number>
  tricksPlayed: number
  trickHistory: Array<{ plays: PlayedCard[]; winner: PlayerId }>
  outcome: RoundOutcome
  phase: TwoPlayerPhase
}

export function startTwoPlayerRound(round: number, opener: PlayerId, names: Record<PlayerId, string>): TwoPlayerGameState {
  const deck = shuffle(buildDeck())
  const { kitty, remaining } = setAsideKitty(deck)
  const openerSeat = opener === PLAYERS[0] ? 0 : 1
  return {
    round,
    opener,
    names,
    kitty,
    draw: startDrawPhase(remaining, openerSeat),
    hands: { p1: [], p2: [] },
    bidding: startTwoPBidding(opener, otherOf(opener)),
    winningBid: null,
    exceptionKittyFirst: false,
    trumpSuit: null,
    trick: startTrick(),
    trumpBroken: false,
    trickLeader: null,
    trickCounts: { p1: 0, p2: 0 },
    tricksPlayed: 0,
    trickHistory: [],
    outcome: 'in_progress',
    phase: 'draw',
  }
}

// --- draw phase -----------------------------------------------------------

export function applyDrawCard(s: TwoPlayerGameState): TwoPlayerGameState {
  return { ...s, draw: drawCard(s.draw) }
}

export function applyResolveDraw(s: TwoPlayerGameState, decision: 'keep' | 'discard'): TwoPlayerGameState {
  const draw = resolveDraw(s.draw, decision)
  if (!draw.complete) return { ...s, draw }
  const hands = { p1: draw.hands[0], p2: draw.hands[1] }
  return { ...s, draw, hands, phase: 'bidding' }
}

// --- bidding ---------------------------------------------------------------

function advanceAfterBidding(s: TwoPlayerGameState, bidding: TwoPBiddingState): TwoPlayerGameState {
  if (!bidding.complete) return { ...s, bidding }
  const winningBid = bidding.highestBid as Bid
  // Exception (spec §1.4): if the first bidder wins on their very first call — i.e.
  // the opener's opening bid stands because the second player passed immediately —
  // they get to see the kitty before naming trump.
  const exceptionKittyFirst = bidding.bidsMade.length === 2 && isPass(bidding.bidsMade[1]) && bidding.winner === s.opener
  return { ...s, bidding, winningBid, exceptionKittyFirst, phase: exceptionKittyFirst ? 'kitty' : 'trump' }
}

export function applyBid(s: TwoPlayerGameState, number: number, mode: Mode): TwoPlayerGameState {
  const bidding = applyTwoPBid(s.bidding, { playerId: s.bidding.currentBidder, number, mode })
  return advanceAfterBidding(s, bidding)
}

export function applyPass(s: TwoPlayerGameState): TwoPlayerGameState {
  const bidding = applyTwoPBid(s.bidding, { playerId: s.bidding.currentBidder, pass: true })
  return advanceAfterBidding(s, bidding)
}

// --- trump + kitty -----------------------------------------------------------

function beginTrickPlay(s: TwoPlayerGameState): TwoPlayerGameState {
  return { ...s, trick: startTrick(), trumpBroken: false, trickLeader: (s.winningBid as Bid).playerId, phase: 'trick' }
}

export function applyNameTrump(s: TwoPlayerGameState, suit: Suit): TwoPlayerGameState {
  const next = { ...s, trumpSuit: suit }
  // Exception path: kitty already resolved before trump was named -> go straight to
  // trick play. Normal path: trump named blind first -> go view the kitty.
  return s.exceptionKittyFirst ? beginTrickPlay(next) : { ...next, phase: 'kitty' }
}

export function applyConfirmKitty(s: TwoPlayerGameState, discardFromHand: Card[], takeFromKitty: Card[]): TwoPlayerGameState {
  const winner = (s.winningBid as Bid).playerId
  const { hand, kitty } = applyKittyExchange(s.hands[winner], s.kitty, discardFromHand, takeFromKitty)
  const next = { ...s, hands: { ...s.hands, [winner]: hand }, kitty }
  // Exception path: kitty is resolved first, trump still needs naming.
  // Normal path: trump was already named, so tricks can begin now.
  return s.exceptionKittyFirst ? { ...next, phase: 'trump' } : beginTrickPlay(next)
}

// --- trick play -----------------------------------------------------------

export function applyPlayCard(s: TwoPlayerGameState, playerId: PlayerId, card: Card): TwoPlayerGameState {
  const trumpSuit = s.trumpSuit as Suit
  if (!isLegalPlay(s.hands[playerId], s.trick, card, trumpSuit, s.trumpBroken)) {
    throw new Error('That card is not a legal play right now')
  }
  const trick = playCard(s.trick, playerId, card)
  const hands = {
    ...s.hands,
    [playerId]: s.hands[playerId].filter((c) => !(c.suit === card.suit && c.rank === card.rank)),
  }
  const trumpBroken = s.trumpBroken || cardBreaksTrump(card, trumpSuit)

  if (trick.plays.length < 2) {
    return { ...s, trick, hands, trumpBroken }
  }

  const winner = resolveTrick(trick, trumpSuit, (s.winningBid as Bid).mode)
  const trickCounts = { ...s.trickCounts, [winner]: s.trickCounts[winner] + 1 }
  const tricksPlayed = s.tricksPlayed + 1
  const trickHistory = [...s.trickHistory, { plays: trick.plays, winner }]
  const bidWinner = (s.winningBid as Bid).playerId
  const defender = otherOf(bidWinner)
  const target = computeTarget((s.winningBid as Bid).number)
  const outcome = evaluateRoundStatus({ target, defendSideTricks: trickCounts[defender], tricksPlayed })
  const phase = isRoundOver(outcome) ? 'round-end' : 'trick'

  return { ...s, trick, hands, trumpBroken, trickCounts, tricksPlayed, trickHistory, outcome, phase }
}

export function applyContinueAfterTrick(s: TwoPlayerGameState): TwoPlayerGameState {
  const winner = s.trickHistory[s.trickHistory.length - 1]?.winner ?? s.trickLeader
  return { ...s, trick: startTrick(), trickLeader: winner }
}

export function applyEndRoundEarly(s: TwoPlayerGameState): TwoPlayerGameState {
  return { ...s, phase: 'round-end' }
}

export function applyNextRound(s: TwoPlayerGameState): TwoPlayerGameState {
  return startTwoPlayerRound(s.round + 1, nextTwoPOpener(s.opener, PLAYERS), s.names)
}

/** Scraps the current match and deals a fresh round 1 — same names/seats, everything
 *  else reset. Mirrors how a match starts in the first place (rooms.ts's startGame). */
export function applyRestartMatch(s: TwoPlayerGameState): TwoPlayerGameState {
  return startTwoPlayerRound(1, PLAYERS[0], s.names)
}

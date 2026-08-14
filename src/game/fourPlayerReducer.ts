// Pure 4P game state + transitions — the 4-seat counterpart to twoPlayerReducer.ts,
// same shape of contract (each applyX returns the next state or throws). No draw
// phase (spec §1.3: kitty set aside, remaining 48 dealt straight out); "sides" are
// teams of 2, not individual players, so the win condition aggregates trick counts
// per team. Kitty exchange is private to the actual bidder — not even their partner
// sees it (spec §1.4), which the shared privacy model (viewerPlayerId === the one
// specific acting player) already handles correctly with no special-casing needed.

import {
  applyFourPBid,
  buildDeck,
  buildFourPBidOrder,
  cardBreaksTrump,
  computeTarget,
  deal4Players,
  evaluateRoundStatus,
  isLegalPlay,
  isRoundOver,
  playCard,
  resolveTrick,
  setAsideKitty,
  shuffle,
  startTrick,
  startFourPBidding,
  validateFourPSeating,
  applyKittyExchange,
} from '../engine'
import type {
  Bid,
  Card,
  FourPBiddingState,
  Mode,
  PlayedCard,
  PlayerId,
  RoundOutcome,
  Suit,
  TeamId,
  TrickState,
} from '../engine'

export type FourPSeatOrder = readonly [PlayerId, PlayerId, PlayerId, PlayerId]

export type FourPlayerPhase = 'bidding' | 'trump' | 'kitty' | 'trick' | 'round-end'

export interface FourPlayerGameState {
  round: number
  /** Fixed table seating, alternating teams — set once by the host, not per round. */
  seatOrder: FourPSeatOrder
  teams: Record<PlayerId, TeamId>
  names: Record<PlayerId, string>
  /** This round's opener — rotates round to round, see applyNextRound. */
  opener: PlayerId
  kitty: Card[]
  hands: Record<PlayerId, Card[]>
  bidding: FourPBiddingState
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
  phase: FourPlayerPhase
}

// --- team/seat helpers -------------------------------------------------------------

export function nextInOrder(order: readonly PlayerId[], playerId: PlayerId): PlayerId {
  const idx = order.indexOf(playerId)
  return order[(idx + 1) % order.length]
}

export function teamsOf(state: FourPlayerGameState): [TeamId, TeamId] {
  const unique = Array.from(new Set(state.seatOrder.map((p) => state.teams[p])))
  return [unique[0], unique[1]]
}

export function opposingTeam(state: FourPlayerGameState, team: TeamId): TeamId {
  const [a, b] = teamsOf(state)
  return team === a ? b : a
}

export function teammateOf(state: FourPlayerGameState, playerId: PlayerId): PlayerId {
  const team = state.teams[playerId]
  return state.seatOrder.find((p) => p !== playerId && state.teams[p] === team) as PlayerId
}

export function teamTricks(state: FourPlayerGameState, team: TeamId): number {
  return state.seatOrder.filter((p) => state.teams[p] === team).reduce((sum, p) => sum + state.trickCounts[p], 0)
}

/** Whoever's turn it is to play in the current trick — the leader if it's empty,
 *  otherwise the next seat after whoever played most recently. */
export function nextToActInTrick(state: FourPlayerGameState): PlayerId {
  if (state.trick.plays.length === 0) return state.trickLeader as PlayerId
  const lastPlayer = state.trick.plays[state.trick.plays.length - 1].playerId
  return nextInOrder(state.seatOrder, lastPlayer)
}

// --- round setup ---------------------------------------------------------------

export function startFourPlayerRound(
  round: number,
  seatOrder: FourPSeatOrder,
  teams: Record<PlayerId, TeamId>,
  names: Record<PlayerId, string>,
  opener: PlayerId,
): FourPlayerGameState {
  validateFourPSeating(seatOrder, teams)
  const deck = shuffle(buildDeck())
  const { kitty, remaining } = setAsideKitty(deck)
  const hands = deal4Players(remaining, seatOrder)
  const bidOrder = buildFourPBidOrder(seatOrder, opener)
  return {
    round,
    seatOrder,
    teams,
    names,
    opener,
    kitty,
    hands,
    bidding: startFourPBidding(bidOrder),
    winningBid: null,
    exceptionKittyFirst: false,
    trumpSuit: null,
    trick: startTrick(),
    trumpBroken: false,
    trickLeader: null,
    trickCounts: Object.fromEntries(seatOrder.map((p) => [p, 0])),
    tricksPlayed: 0,
    trickHistory: [],
    outcome: 'in_progress',
    phase: 'bidding',
  }
}

// --- bidding ---------------------------------------------------------------

function advanceAfterBidding(s: FourPlayerGameState, bidding: FourPBiddingState): FourPlayerGameState {
  if (!bidding.complete) return { ...s, bidding }
  const winningBid = bidding.highestBid as Bid
  // 4P exception (spec §1.4): each player bids exactly once, no re-bidding — so "won
  // on their very first call" simplifies to "the opener's bid stood," i.e. nobody
  // outbid them.
  const exceptionKittyFirst = winningBid.playerId === bidding.order[0]
  return { ...s, bidding, winningBid, exceptionKittyFirst, phase: exceptionKittyFirst ? 'kitty' : 'trump' }
}

export function applyBid(s: FourPlayerGameState, number: number, mode: Mode): FourPlayerGameState {
  const bidding = applyFourPBid(s.bidding, { playerId: s.bidding.order[s.bidding.turnIndex], number, mode })
  return advanceAfterBidding(s, bidding)
}

export function applyPass(s: FourPlayerGameState): FourPlayerGameState {
  const bidding = applyFourPBid(s.bidding, { playerId: s.bidding.order[s.bidding.turnIndex], pass: true })
  return advanceAfterBidding(s, bidding)
}

// --- trump + kitty -----------------------------------------------------------

function beginTrickPlay(s: FourPlayerGameState): FourPlayerGameState {
  return { ...s, trick: startTrick(), trumpBroken: false, trickLeader: (s.winningBid as Bid).playerId, phase: 'trick' }
}

export function applyNameTrump(s: FourPlayerGameState, suit: Suit): FourPlayerGameState {
  const next = { ...s, trumpSuit: suit }
  return s.exceptionKittyFirst ? beginTrickPlay(next) : { ...next, phase: 'kitty' }
}

export function applyConfirmKitty(s: FourPlayerGameState, discardFromHand: Card[], takeFromKitty: Card[]): FourPlayerGameState {
  const winner = (s.winningBid as Bid).playerId
  const { hand, kitty } = applyKittyExchange(s.hands[winner], s.kitty, discardFromHand, takeFromKitty)
  const next = { ...s, hands: { ...s.hands, [winner]: hand }, kitty }
  return s.exceptionKittyFirst ? { ...next, phase: 'trump' } : beginTrickPlay(next)
}

// --- trick play -----------------------------------------------------------

export function applyPlayCard(s: FourPlayerGameState, playerId: PlayerId, card: Card): FourPlayerGameState {
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

  if (trick.plays.length < s.seatOrder.length) {
    return { ...s, trick, hands, trumpBroken }
  }

  const winner = resolveTrick(trick, trumpSuit, (s.winningBid as Bid).mode)
  const trickCounts = { ...s.trickCounts, [winner]: s.trickCounts[winner] + 1 }
  const tricksPlayed = s.tricksPlayed + 1
  const trickHistory = [...s.trickHistory, { plays: trick.plays, winner }]
  const bidWinner = (s.winningBid as Bid).playerId
  const bidTeam = s.teams[bidWinner]
  const nextState = { ...s, trickCounts }
  const defendTeam = opposingTeam(nextState, bidTeam)
  const target = computeTarget((s.winningBid as Bid).number)
  const outcome = evaluateRoundStatus({ target, defendSideTricks: teamTricks(nextState, defendTeam), tricksPlayed })
  const phase = isRoundOver(outcome) ? 'round-end' : 'trick'

  return { ...s, trick, hands, trumpBroken, trickCounts, tricksPlayed, trickHistory, outcome, phase }
}

export function applyContinueAfterTrick(s: FourPlayerGameState): FourPlayerGameState {
  const winner = s.trickHistory[s.trickHistory.length - 1]?.winner ?? s.trickLeader
  return { ...s, trick: startTrick(), trickLeader: winner }
}

export function applyEndRoundEarly(s: FourPlayerGameState): FourPlayerGameState {
  return { ...s, phase: 'round-end' }
}

export function applyNextRound(s: FourPlayerGameState): FourPlayerGameState {
  // Rotation between rounds is host-controlled in a real room (spec: team pairs can
  // change between games, so the engine doesn't guess). For local practice, cycling
  // the opener through the fixed seating one seat at a time is a fair default.
  const nextOpener = nextInOrder(s.seatOrder, s.opener)
  return startFourPlayerRound(s.round + 1, s.seatOrder, s.teams, s.names, nextOpener)
}

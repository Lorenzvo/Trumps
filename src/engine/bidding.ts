// Bid comparison and the 2P / 4P bidding flows. See trumps-spec.md §1.4.

import type { Bid, BidAction, PlayerId } from './types'
import { isPass } from './types'

export function isValidBidNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 7
}

/**
 * A single comparable value for a bid: number dominates, and at equal numbers
 * Low outranks High. Weakest -> strongest: 2H < 2L < 3H < 3L < ... < 7H < 7L.
 */
export function bidValue(bid: Pick<Bid, 'number' | 'mode'>): number {
  return bid.number * 2 + (bid.mode === 'low' ? 1 : 0)
}

/** Positive if `a` outranks `b`, negative if `b` outranks `a`, 0 if equal. */
export function compareBids(a: Pick<Bid, 'number' | 'mode'>, b: Pick<Bid, 'number' | 'mode'>): number {
  return bidValue(a) - bidValue(b)
}

function otherPlayer(players: readonly [PlayerId, PlayerId], p: PlayerId): PlayerId {
  return players[0] === p ? players[1] : players[0]
}

// ---------------------------------------------------------------------------
// 2-player bidding (up to 2 bids each, opener cannot pass)
// ---------------------------------------------------------------------------

export interface TwoPBiddingState {
  players: readonly [PlayerId, PlayerId]
  bidsMade: BidAction[]
  bidCounts: Record<PlayerId, number>
  currentBidder: PlayerId
  highestBid: Bid | null
  winner: PlayerId | null
  complete: boolean
}

export function startTwoPBidding(firstBidder: PlayerId, secondBidder: PlayerId): TwoPBiddingState {
  return {
    players: [firstBidder, secondBidder],
    bidsMade: [],
    bidCounts: { [firstBidder]: 0, [secondBidder]: 0 },
    currentBidder: firstBidder,
    highestBid: null,
    winner: null,
    complete: false,
  }
}

/**
 * Applies one bid or pass to 2P bidding state. Rules enforced (spec §1.4):
 *  - The very first action of the round cannot be a pass — someone always bids.
 *  - A pass immediately awards the bid to the other player.
 *  - A bid must strictly outrank the current highest (per `compareBids`).
 *  - Each player gets at most 2 bids; if both are exhausted without a pass,
 *    the highest bid standing wins automatically.
 */
export function applyTwoPBid(state: TwoPBiddingState, action: BidAction): TwoPBiddingState {
  if (state.complete) throw new Error('Bidding is already complete')
  if (action.playerId !== state.currentBidder) throw new Error('It is not this player\'s turn to bid')

  const isOpeningAction = state.bidsMade.length === 0

  if (isPass(action)) {
    if (isOpeningAction) throw new Error('The opening bidder cannot pass — someone must always bid')
    const winner = otherPlayer(state.players, action.playerId)
    return { ...state, bidsMade: [...state.bidsMade, action], winner, complete: true }
  }

  if (!isValidBidNumber(action.number)) throw new Error('Bid number must be an integer from 2 to 7')
  if (state.highestBid && compareBids(action, state.highestBid) <= 0) {
    throw new Error('A bid must be strictly higher than the current highest bid')
  }

  const bidCounts = { ...state.bidCounts, [action.playerId]: state.bidCounts[action.playerId] + 1 }
  const bidsMade = [...state.bidsMade, action]
  const nextBidder = otherPlayer(state.players, action.playerId)
  const bothExhausted = bidCounts[state.players[0]] >= 2 && bidCounts[state.players[1]] >= 2

  if (bothExhausted) {
    return { ...state, bidsMade, bidCounts, highestBid: action, winner: action.playerId, complete: true }
  }

  return { ...state, bidsMade, bidCounts, highestBid: action, currentBidder: nextBidder, complete: false }
}

// ---------------------------------------------------------------------------
// 4-player bidding (exactly 1 bid per player, strict team-alternating order)
// ---------------------------------------------------------------------------

export interface FourPBiddingState {
  /** Turn order, already alternating teams (e.g. Blue1, Red1, Blue2, Red2) — see
   *  `buildFourPBidOrder` in rotation.ts for constructing and validating this. */
  order: readonly [PlayerId, PlayerId, PlayerId, PlayerId]
  bidsMade: BidAction[]
  turnIndex: number
  highestBid: Bid | null
  winner: PlayerId | null
  complete: boolean
}

export function startFourPBidding(order: readonly [PlayerId, PlayerId, PlayerId, PlayerId]): FourPBiddingState {
  return { order, bidsMade: [], turnIndex: 0, highestBid: null, winner: null, complete: false }
}

/**
 * Applies one bid or pass to 4P bidding state (spec §1.4): one bid per player in turn
 * order; highest bid standing at the end wins. Unlike 2P, a later bid does not need to
 * outrank the current highest — it simply won't win if it's lower.
 *
 * As in 2P, the very first action of the round (the opener, `order[0]`) can never be a
 * pass — someone always bids. That guarantees `winner` is never null once complete.
 */
export function applyFourPBid(state: FourPBiddingState, action: BidAction): FourPBiddingState {
  if (state.complete) throw new Error('Bidding is already complete')
  const currentBidder = state.order[state.turnIndex]
  if (action.playerId !== currentBidder) throw new Error('It is not this player\'s turn to bid')

  if (state.turnIndex === 0 && isPass(action)) {
    throw new Error('The opening bidder cannot pass — someone must always bid')
  }

  let highestBid = state.highestBid
  if (!isPass(action)) {
    if (!isValidBidNumber(action.number)) throw new Error('Bid number must be an integer from 2 to 7')
    if (!highestBid || compareBids(action, highestBid) > 0) {
      highestBid = action
    }
  }

  const bidsMade = [...state.bidsMade, action]
  const turnIndex = state.turnIndex + 1
  const complete = turnIndex >= state.order.length
  const winner = complete ? (highestBid as Bid).playerId : null

  return { ...state, bidsMade, turnIndex, highestBid, complete, winner }
}

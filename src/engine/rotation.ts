// Who opens bidding each round, and (for 4P) team/seating setup.
//
// 2P has no teams, so who opens can just auto-alternate round to round.
// 4P has fixed team pairs, but which players are paired together can change between
// games — so instead of the engine guessing a rotation, a game host sets the seating
// (team pairs, in an alternating-teams order) and picks who opens each round; the
// engine's job is just to validate that setup and derive the rest of the bid order
// from it. See trumps-spec.md §1.3-1.4.

import type { PlayerId } from './types'

// ---------------------------------------------------------------------------
// 2P: auto-alternate who opens
// ---------------------------------------------------------------------------

/** The other player always opens the next round — simple round-to-round alternation. */
export function nextTwoPOpener(previousOpener: PlayerId, players: readonly [PlayerId, PlayerId]): PlayerId {
  if (players[0] !== previousOpener && players[1] !== previousOpener) {
    throw new Error(`${previousOpener} is not one of the two players`)
  }
  return players[0] === previousOpener ? players[1] : players[0]
}

// ---------------------------------------------------------------------------
// 4P: host-controlled team seating + opener
// ---------------------------------------------------------------------------

export type TeamId = string

export type FourPSeatOrder = readonly [PlayerId, PlayerId, PlayerId, PlayerId]

/**
 * Validates a host-chosen seating: exactly 2 teams, 2 players each, and no two
 * adjacent seats sharing a team (so bidding — which follows seat order — never puts
 * teammates back-to-back, per spec §1.4). Throws a descriptive error otherwise.
 */
export function validateFourPSeating(seatOrder: FourPSeatOrder, teams: Readonly<Record<PlayerId, TeamId>>): void {
  const counts = new Map<TeamId, number>()
  for (const playerId of seatOrder) {
    const teamId = teams[playerId]
    if (teamId === undefined) throw new Error(`No team assigned for player ${playerId}`)
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1)
  }
  if (counts.size !== 2) throw new Error('4P requires exactly 2 teams')
  for (const count of counts.values()) {
    if (count !== 2) throw new Error('Each team must have exactly 2 players')
  }
  for (let i = 0; i < seatOrder.length - 1; i++) {
    if (teams[seatOrder[i]] === teams[seatOrder[i + 1]]) {
      throw new Error('Teammates cannot be seated back-to-back in bid order')
    }
  }
}

/**
 * Builds this round's bid order by rotating the host's fixed seating to start at
 * `firstBidder` (the host's choice of opener for this round). Rotating a
 * strictly-team-alternating 4-seat order preserves the alternation, so the result is
 * always valid for `startFourPBidding` without re-validating.
 */
export function buildFourPBidOrder(seatOrder: FourPSeatOrder, firstBidder: PlayerId): FourPSeatOrder {
  const startIndex = seatOrder.indexOf(firstBidder)
  if (startIndex === -1) throw new Error(`${firstBidder} is not one of the seated players`)
  return [
    seatOrder[startIndex],
    seatOrder[(startIndex + 1) % 4],
    seatOrder[(startIndex + 2) % 4],
    seatOrder[(startIndex + 3) % 4],
  ]
}

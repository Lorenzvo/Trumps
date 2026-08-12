// Card ranking. See trumps-spec.md §1.6.
// Ace is always best, in both modes.

import type { Mode, Rank } from './types'

export const HIGH_ORDER: readonly Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
export const LOW_ORDER: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/**
 * Strength of a rank under the round's mode. Higher number = stronger card.
 * Comparable directly: `rankStrength(a, mode) > rankStrength(b, mode)` means a beats b.
 */
export function rankStrength(rank: Rank, mode: Mode): number {
  const order = mode === 'high' ? HIGH_ORDER : LOW_ORDER
  const index = order.indexOf(rank)
  if (index === -1) throw new Error(`Unknown rank: ${rank}`)
  return order.length - index
}

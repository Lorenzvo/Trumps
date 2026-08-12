// Round win condition and the early-clinch rule. See trumps-spec.md §1.7.

export const TOTAL_TRICKS = 12

/** The number of tricks the defending side needs to win the round, per a winning bid. */
export function computeTarget(bidNumber: number): number {
  return 8 - bidNumber
}

export interface RoundProgress {
  target: number
  defendSideTricks: number
  tricksPlayed: number
}

export type RoundOutcome =
  | 'in_progress'
  /** Defending side reached their target — they win the round immediately. */
  | 'defenders_win'
  /** All 12 tricks played and defenders never reached target — bid side wins. */
  | 'bidders_win'
  /** Defenders can no longer mathematically reach target before trick 12 — both sides
   *  may agree to end the round now, or play out all 12 tricks (spec §1.7). */
  | 'bidders_clinched'

export function evaluateRoundStatus(progress: RoundProgress): RoundOutcome {
  const { target, defendSideTricks, tricksPlayed } = progress

  if (defendSideTricks >= target) return 'defenders_win'

  const tricksRemaining = TOTAL_TRICKS - tricksPlayed
  const defendersStillNeed = target - defendSideTricks

  if (defendersStillNeed > tricksRemaining) {
    return tricksPlayed >= TOTAL_TRICKS ? 'bidders_win' : 'bidders_clinched'
  }

  if (tricksPlayed >= TOTAL_TRICKS) return 'bidders_win'

  return 'in_progress'
}

/** Whether the round may be ended early right now (both sides must agree — spec §1.7). */
export function canOfferEarlyEnd(outcome: RoundOutcome): boolean {
  return outcome === 'bidders_clinched'
}

export function isRoundOver(outcome: RoundOutcome): boolean {
  return outcome === 'defenders_win' || outcome === 'bidders_win'
}

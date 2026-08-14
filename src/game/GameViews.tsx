// Shared presentational layer for 2P play. Every view takes an explicit
// `viewerPlayerId` — "near"/revealed seat is always that player, "away" is always
// hidden. The local hot-seat build sets viewerPlayerId to whoever can currently act
// (pass-and-play), so hand visibility flips by turn. The networked build sets it to
// your fixed seat, always — so you only ever see your own hand, and action controls
// simply don't render when it's not your turn, no matter which seat you're in.

import { useEffect, useState } from 'react'
import { cardId, canOfferEarlyEnd, computeTarget, isPass, legalCardsToPlay, rankStrength, SUITS, TOTAL_TRICKS } from '../engine'
import type { Bid, Card, Mode, PlayerId, Suit } from '../engine'
import { otherOf, PLAYERS, type TwoPlayerGameState } from './twoPlayerReducer'
import './TwoPlayerGame.css'

export const SUIT_SYMBOL: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}

// Alternates red/black so neighboring suit groups in a sorted hand read distinctly.
const SUIT_DISPLAY_ORDER: readonly Suit[] = ['hearts', 'spades', 'diamonds', 'clubs']

/** Sorted for display only — suit (alternating color), then best-to-worst rank for the
 *  round's mode. Doesn't touch stored state/order, just how a revealed hand renders.
 *  Before a mode is chosen (draw/bidding), defaults to High ordering — Ace is always
 *  best either way, this just keeps things visually consistent pre-bid. */
export function sortHandForDisplay(hand: readonly Card[], mode: Mode = 'high'): Card[] {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit)
    if (suitDiff !== 0) return suitDiff
    return rankStrength(b.rank, mode) - rankStrength(a.rank, mode)
  })
}

/** How many more tricks a player needs to lock in their side's win — the defender's
 *  own bid target, or (TOTAL_TRICKS + 1 - target) for the bid side, which is the
 *  count that mathematically guarantees the defender can no longer reach theirs. */
export function tricksNeeded(target: number, current: number): number {
  return Math.max(0, target - current)
}

/** The trump indicator: three separate boxes (suit, mode, whether trump can be led)
 *  instead of one bundled string, so it fills the width instead of hugging a corner. */
export function TrumpBadge({ suit, mode, broken }: { suit: Suit; mode: Mode; broken: boolean }) {
  return (
    <div className="trump-status-row">
      <div className="status-box">
        <span className="status-label">TRUMP</span>
        <span className={`trump-suit-icon ${isRedSuit(suit) ? 'red' : 'black'}`}>{SUIT_SYMBOL[suit]}</span>
      </div>
      <div className="status-box">
        <span className="status-label">TYPE</span>
        <span className="status-value">{mode === 'high' ? 'High ↑' : 'Low ↓'}</span>
      </div>
      <div className={`status-box ${broken ? 'status-yes' : 'status-no'}`}>
        <span className="status-label">CAN LEAD TRUMP</span>
        <span className="status-value">{broken ? 'Yes' : 'No'}</span>
      </div>
    </div>
  )
}

// --- rules modal, click-through step by step ------------------------------------

const RULE_STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Draw',
    body: 'Alternate turns drawing from the middle pile. Keep the card (the next card auto-discards unseen) or discard it (you\'re forced to keep the next card, unseen) — either way you end up with 12 cards.',
  },
  {
    title: 'Bidding',
    body: 'Whoever drew first opens (they can\'t pass). A bid is a number 2-7 plus High or Low — the number means the opponent needs 8 minus that number tricks to win. A higher number always beats a lower one; at equal numbers Low beats High. Each player gets up to 2 bids: raise or pass.',
  },
  {
    title: 'Trump',
    body: 'Named blind, before seeing the kitty — unless the opener wins on their very first call, in which case they get to peek at the kitty first.',
  },
  {
    title: 'Kitty exchange',
    body: 'The bid winner may swap any number of the 4 kitty cards into their hand, discarding the same number back out.',
  },
  {
    title: 'Tricks',
    body: 'Follow suit if you can. If you\'re void, you may play trump (once it\'s been broken) or any other card — trump is never forced. Highest trump wins the trick; otherwise the best card of the led suit wins (High or Low, per the bid).',
  },
  {
    title: 'Winning the round',
    body: 'The bid side wins if the opponent never reaches their target trick count across all 12 tricks. The opponent wins the instant they hit that target.',
  },
]

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  if (!open) return null

  const current = RULE_STEPS[step]
  const isFirst = step === 0
  const isLast = step === RULE_STEPS.length - 1

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close rules">
          ✕
        </button>
        <p className="badge-pixel">
          RULES {step + 1}/{RULE_STEPS.length}
        </p>
        <h2>{current.title}</h2>
        <p className="modal-body">{current.body}</p>
        <div className="modal-dots">
          {RULE_STEPS.map((s, i) => (
            <span key={s.title} className={`dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>
        <div className="button-row modal-actions">
          <button type="button" className="pill-btn" onClick={() => setStep((s) => s - 1)} disabled={isFirst}>
            ← Back
          </button>
          {isLast ? (
            <button type="button" className="pill-btn primary" onClick={onClose}>
              Got it!
            </button>
          ) : (
            <button type="button" className="pill-btn primary" onClick={() => setStep((s) => s + 1)}>
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// --- card rendering ----------------------------------------------------------------

export function CardChip({
  card,
  onClick,
  illegal,
  selected,
  index = 0,
}: {
  card: Card
  onClick?: () => void
  /** Greyed out: this specific card is an illegal play right now (off-suit while you
   *  must follow, or trump before it's broken) — distinct from just "not clickable"
   *  (a static display card, or it's simply not your turn), which should stay full-color. */
  illegal?: boolean
  selected?: boolean
  index?: number
}) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds'
  return (
    <button
      type="button"
      className={['card-chip', red ? 'red' : 'black', selected ? 'selected' : '', illegal ? 'illegal' : '']
        .join(' ')
        .trim()}
      style={{ '--i': index } as React.CSSProperties}
      onClick={onClick}
      disabled={!onClick || illegal}
      aria-label={`${card.rank} of ${capitalize(card.suit)}${illegal ? ' (not a legal play)' : ''}`}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
    </button>
  )
}

export function CardBack({ index = 0 }: { index?: number }) {
  return (
    <div className="card-chip card-back" style={{ '--i': index } as React.CSSProperties} aria-hidden="true">
      <span className="card-back-mark">T</span>
    </div>
  )
}

export function Hand({
  name,
  hand,
  revealed,
  onPlay,
  legal,
}: {
  name: string
  hand: Card[]
  revealed: boolean
  onPlay?: (card: Card) => void
  legal?: Card[]
}) {
  return (
    <div className={`hand ${revealed ? 'hand-revealed' : 'hand-hidden'}`}>
      <h3 className="hand-label">
        {name} <span className="hand-count">· {hand.length}</span>
      </h3>
      <div className="hand-cards">
        {revealed
          ? hand.map((card, i) => (
              <CardChip
                key={cardId(card)}
                card={card}
                index={i}
                onClick={onPlay ? () => onPlay(card) : undefined}
                illegal={legal ? !legal.some((c) => c.suit === card.suit && c.rank === card.rank) : false}
              />
            ))
          : hand.map((card, i) => <CardBack key={cardId(card)} index={i} />)}
      </div>
    </div>
  )
}

// --- phase views ---------------------------------------------------------------

export function DrawPhaseView({
  state,
  viewerPlayerId,
  onDraw,
  onResolve,
}: {
  state: TwoPlayerGameState
  viewerPlayerId: PlayerId
  onDraw: () => void
  onResolve: (decision: 'keep' | 'discard') => void
}) {
  const seatPlayers: [PlayerId, PlayerId] = ['p1', 'p2']
  const activePlayer = seatPlayers[state.draw.turn]
  const canAct = viewerPlayerId === activePlayer
  const otherPlayer = otherOf(viewerPlayerId)
  const handFor = (id: PlayerId) => state.draw.hands[id === 'p1' ? 0 : 1]
  const pileSize = state.draw.middlePile.length

  return (
    <section className="panel">
      <h2>Draw phase</h2>
      <p className="hint">You can always see your own hand — the other player's cards stay face-down.</p>

      <div className="table table-fixed">
        <div className="table-seat away">
          <Hand name={state.names[otherPlayer]} hand={handFor(otherPlayer)} revealed={false} />
        </div>

        <div className="table-center table-center-action">
          <p className="badge-pixel">PILE · {pileSize} LEFT</p>
          <div className="pile-stack">
            {Array.from({ length: Math.min(pileSize, 4) }).map((_, i) => (
              <div key={i} className="card-chip card-back pile-card" style={{ '--i': i } as React.CSSProperties} />
            ))}
          </div>

          <p className="turn-banner">{state.names[activePlayer]}'s turn</p>

          {!canAct && <p className="hint">Waiting for {state.names[activePlayer]}…</p>}

          {canAct && !state.draw.pendingCard && (
            <button type="button" className="pill-btn primary" onClick={onDraw}>
              Draw a card
            </button>
          )}

          {canAct && state.draw.pendingCard && (
            <div className="draw-decision">
              <p>You drew:</p>
              <CardChip card={state.draw.pendingCard} />
              <div className="button-row">
                <button type="button" className="pill-btn secondary" onClick={() => onResolve('keep')}>
                  Keep
                </button>
                <button type="button" className="pill-btn danger" onClick={() => onResolve('discard')}>
                  Discard
                </button>
              </div>
              <p className="hint">
                <strong>Keep:</strong> keep the current card and discard the next one without seeing it.{' '}
                <strong>Discard:</strong> discard the current card and keep the next one without seeing it.
              </p>
            </div>
          )}
        </div>

        <div className="table-seat near">
          <Hand name={state.names[viewerPlayerId]} hand={sortHandForDisplay(handFor(viewerPlayerId))} revealed />
        </div>
      </div>
    </section>
  )
}

export function BiddingView({
  state,
  viewerPlayerId,
  onBid,
  onPass,
}: {
  state: TwoPlayerGameState
  viewerPlayerId: PlayerId
  onBid: (number: number, mode: Mode) => void
  onPass: () => void
}) {
  const [number, setNumber] = useState(2)
  const [mode, setMode] = useState<Mode>('high')
  const isOpeningBid = state.bidding.bidsMade.length === 0
  const current = state.bidding.currentBidder
  const canAct = viewerPlayerId === current
  const other = otherOf(viewerPlayerId)
  const bidsLeft = (id: PlayerId) => 2 - state.bidding.bidCounts[id]

  return (
    <section className="panel">
      <h2>Bidding</h2>
      <p className="turn-banner-inline">
        {state.names[current]}'s turn to bid
        {isOpeningBid && ' — opener must bid, no passing yet'}
      </p>
      <p>
        Highest bid so far:{' '}
        <strong>
          {state.bidding.highestBid
            ? `${state.bidding.highestBid.number} ${state.bidding.highestBid.mode} (${state.names[state.bidding.highestBid.playerId]})`
            : 'none'}
        </strong>
      </p>

      <div className="table">
        <div className="table-seat away">
          <Hand name={state.names[other]} hand={state.hands[other]} revealed={false} />
        </div>

        <div className="table-center">
          <p className="badge-pixel">
            {state.names.p1.toUpperCase()} · {bidsLeft('p1')} BID{bidsLeft('p1') === 1 ? '' : 'S'} LEFT &nbsp;|&nbsp;{' '}
            {state.names.p2.toUpperCase()} · {bidsLeft('p2')} BID{bidsLeft('p2') === 1 ? '' : 'S'} LEFT
          </p>

          <div className="table-center-action table-center-bidding">
            {canAct ? (
              <div className="button-row">
                <select value={number} onChange={(e) => setNumber(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
                <button type="button" className="pill-btn primary" onClick={() => onBid(number, mode)}>
                  Bid
                </button>
                <button type="button" className="pill-btn" onClick={onPass} disabled={isOpeningBid}>
                  Pass
                </button>
              </div>
            ) : (
              <p className="hint">Waiting for {state.names[current]} to bid…</p>
            )}
          </div>

          <div className="bid-history-wrap">
            <h3>Bid history</h3>
            <ul className="bid-history">
              {state.bidding.bidsMade.map((action, i) => (
                <li key={i}>
                  {state.names[action.playerId]}: {isPass(action) ? 'pass' : `${action.number} ${action.mode}`}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="table-seat near">
          <Hand name={state.names[viewerPlayerId]} hand={sortHandForDisplay(state.hands[viewerPlayerId])} revealed />
        </div>
      </div>
    </section>
  )
}

export function TrumpView({
  state,
  viewerPlayerId,
  onNameTrump,
}: {
  state: TwoPlayerGameState
  viewerPlayerId: PlayerId
  onNameTrump: (suit: Suit) => void
}) {
  const winner = (state.winningBid as Bid).playerId
  const canAct = viewerPlayerId === winner
  const other = otherOf(viewerPlayerId)
  return (
    <section className="panel">
      <h2>Name trump</h2>
      <p>
        {state.names[winner]} won the bid: <strong>{state.winningBid?.number} {state.winningBid?.mode}</strong>
      </p>
      {state.exceptionKittyFirst ? (
        <p className="hint">
          Note: {state.names[winner]} won the bid on their first call, so they get to call the trump suit after
          exchanging with the kitty.
        </p>
      ) : (
        <p className="hint">Trump must be named blind, before seeing the kitty.</p>
      )}

      <div className="table table-compact">
        <div className="table-seat away">
          <Hand name={state.names[other]} hand={state.hands[other]} revealed={false} />
        </div>

        <div className="table-center table-center-action table-center-trump">
          {canAct ? (
            <div className="button-row">
              {SUITS.map((suit) => (
                <button
                  type="button"
                  key={suit}
                  className={['pill-btn', 'suit-btn', isRedSuit(suit) ? 'red' : 'black'].join(' ')}
                  onClick={() => onNameTrump(suit)}
                >
                  {SUIT_SYMBOL[suit]} {capitalize(suit)}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">Waiting for {state.names[winner]} to name trump…</p>
          )}
        </div>

        <div className="table-seat near">
          <Hand name={state.names[viewerPlayerId]} hand={sortHandForDisplay(state.hands[viewerPlayerId])} revealed />
        </div>
      </div>
    </section>
  )
}

export function KittyView({
  state,
  viewerPlayerId,
  onConfirm,
}: {
  state: TwoPlayerGameState
  viewerPlayerId: PlayerId
  onConfirm: (discardFromHand: Card[], takeFromKitty: Card[]) => void
}) {
  const winner = (state.winningBid as Bid).playerId
  const canAct = viewerPlayerId === winner
  const [discardIds, setDiscardIds] = useState<Set<string>>(new Set())
  const [takeIds, setTakeIds] = useState<Set<string>>(new Set())

  // The kitty exchange is private to the bid winner — the other player shouldn't see
  // the kitty contents or the winner's hand at all, just that it's happening.
  if (!canAct) {
    return (
      <section className="panel">
        <h2>Kitty exchange</h2>
        <p className="hint">{state.names[winner]} is looking at the kitty and choosing what to swap…</p>
      </section>
    )
  }

  const hand = sortHandForDisplay(state.hands[winner], (state.winningBid as Bid).mode)
  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSet(next)
  }

  const countsMatch = discardIds.size === takeIds.size

  return (
    <section className="panel">
      <h2>Kitty exchange</h2>
      <p className="hint">Swap any number of kitty cards into your hand — discard the same number back out.</p>
      <h3>Kitty — click to take</h3>
      <div className="hand-cards">
        {state.kitty.map((card, i) => (
          <CardChip
            key={cardId(card)}
            card={card}
            index={i}
            selected={takeIds.has(cardId(card))}
            onClick={() => toggle(takeIds, setTakeIds, cardId(card))}
          />
        ))}
      </div>
      <h3>
        Your hand — click to discard ({discardIds.size} selected, need {takeIds.size})
      </h3>
      <div className="hand-cards">
        {hand.map((card, i) => (
          <CardChip
            key={cardId(card)}
            card={card}
            index={i}
            selected={discardIds.has(cardId(card))}
            onClick={() => toggle(discardIds, setDiscardIds, cardId(card))}
          />
        ))}
      </div>
      <div className="button-row">
        <button
          type="button"
          className="pill-btn primary"
          disabled={!countsMatch}
          onClick={() =>
            onConfirm(
              hand.filter((c) => discardIds.has(cardId(c))),
              state.kitty.filter((c) => takeIds.has(cardId(c))),
            )
          }
        >
          Confirm exchange
        </button>
        {!countsMatch && <span className="hint"> Selected counts must match.</span>}
      </div>
    </section>
  )
}

export function TrickView({
  state,
  viewerPlayerId,
  onPlayCard,
  onContinue,
  onEndEarly,
}: {
  state: TwoPlayerGameState
  viewerPlayerId: PlayerId
  onPlayCard: (card: Card) => void
  onContinue: () => void
  onEndEarly: () => void
}) {
  const trickComplete = state.trick.plays.length === 2
  const leader = state.trickLeader as PlayerId
  const toAct = trickComplete ? null : state.trick.plays.length === 0 ? leader : otherOf(state.trick.plays[0].playerId)
  const trumpSuit = state.trumpSuit as Suit
  const bidWinner = (state.winningBid as Bid).playerId
  const defender = otherOf(bidWinner)
  const target = computeTarget((state.winningBid as Bid).number)
  const bidSideTarget = TOTAL_TRICKS + 1 - target
  const canAct = !trickComplete && toAct === viewerPlayerId
  const otherPlayer = otherOf(viewerPlayerId)

  const lastWinner = state.trickHistory[state.trickHistory.length - 1]?.winner
  const canContinue = trickComplete && viewerPlayerId === lastWinner

  return (
    <section className="panel">
      <h2 className="trick-progress">
        Trick {state.tricksPlayed} of {TOTAL_TRICKS}
      </h2>
      <TrumpBadge suit={trumpSuit} mode={(state.winningBid as Bid).mode} broken={state.trumpBroken} />
      <p className="needs-row">
        {state.names[PLAYERS[0]]} needs{' '}
        <strong>{tricksNeeded(PLAYERS[0] === defender ? target : bidSideTarget, state.trickCounts[PLAYERS[0]])}</strong>
        &nbsp;|&nbsp; {state.names[PLAYERS[1]]} needs{' '}
        <strong>{tricksNeeded(PLAYERS[1] === defender ? target : bidSideTarget, state.trickCounts[PLAYERS[1]])}</strong>
      </p>

      <div className="table table-fixed">
        <div className="table-seat away">
          <Hand name={state.names[otherPlayer]} hand={state.hands[otherPlayer]} revealed={false} />
        </div>

        <div className="table-center table-center-action">
          <div className="trick-area">
            {state.trick.plays.length === 0 && <p>{state.names[leader]} leads.</p>}
            {state.trick.plays.map((p) => (
              <div key={p.playerId} className="trick-play">
                <span className="hint">{state.names[p.playerId]}</span>
                <CardChip card={p.card} />
              </div>
            ))}
          </div>

          {trickComplete ? (
            <div className="button-row trick-result">
              <p className="turn-banner">{state.names[lastWinner as PlayerId]} wins the trick!</p>
              {canContinue ? (
                canOfferEarlyEnd(state.outcome) ? (
                  <>
                    <p className="hint">
                      {state.names[defender]} can't reach {target} tricks anymore — {state.names[bidWinner]}'s side
                      has it locked in. Call it now, or play out all 12 for the full tally.
                    </p>
                    <button type="button" className="pill-btn primary" onClick={onEndEarly}>
                      End round now
                    </button>
                    <button type="button" className="pill-btn" onClick={onContinue}>
                      Keep playing
                    </button>
                  </>
                ) : (
                  <button type="button" className="pill-btn primary" onClick={onContinue}>
                    Next trick
                  </button>
                )
              ) : (
                <p className="hint">Waiting for {state.names[lastWinner as PlayerId]} to continue…</p>
              )}
            </div>
          ) : (
            <p className="turn-banner-inline">
              {canAct ? "Your turn" : `${state.names[toAct as PlayerId]}'s turn`}
              {state.trick.ledSuit && (
                <>
                  {' '}
                  (Suit: {SUIT_SYMBOL[state.trick.ledSuit]} {capitalize(state.trick.ledSuit)})
                </>
              )}
            </p>
          )}
        </div>

        <div className="table-seat near">
          <Hand
            name={state.names[viewerPlayerId]}
            hand={sortHandForDisplay(state.hands[viewerPlayerId], (state.winningBid as Bid).mode)}
            revealed
            onPlay={canAct ? onPlayCard : undefined}
            legal={canAct ? legalCardsToPlay(state.hands[viewerPlayerId], state.trick, trumpSuit, state.trumpBroken) : undefined}
          />
        </div>
      </div>
    </section>
  )
}

export function RoundEndView({ state, onNextRound }: { state: TwoPlayerGameState; onNextRound: () => void }) {
  const bidWinner = (state.winningBid as Bid).playerId
  const defender = otherOf(bidWinner)
  const target = computeTarget((state.winningBid as Bid).number)
  const bidderWon = state.outcome === 'bidders_win' || state.outcome === 'bidders_clinched'

  return (
    <section className="panel result-panel">
      <h2>Round {state.round} over</h2>
      <p>
        Bid: {state.winningBid?.number} {state.winningBid?.mode} by {state.names[bidWinner]} — {state.names[defender]}{' '}
        needed {target} tricks.
      </p>
      <p>
        Final tricks — {state.names[bidWinner]}: <strong>{state.trickCounts[bidWinner]}</strong> &nbsp;|&nbsp;{' '}
        {state.names[defender]}: <strong>{state.trickCounts[defender]}</strong>
      </p>
      <p className="result">
        {bidderWon ? `🏆 ${state.names[bidWinner]}'s side wins the round!` : `🏆 ${state.names[defender]} wins the round!`}
        {state.outcome === 'bidders_clinched' && ' (ended early)'}
      </p>
      <button type="button" className="pill-btn primary" onClick={onNextRound}>
        Next round
      </button>
    </section>
  )
}

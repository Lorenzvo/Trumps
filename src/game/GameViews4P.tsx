// 4P presentational layer. Reuses the generic pieces from GameViews.tsx (CardChip,
// Hand, RulesModal, TrumpBadge, ...) — only phase-level layout differs from 2P, not
// the primitives. Same viewerPlayerId contract: it's your fixed seat (or, in hot-seat
// mode, whoever can currently act) — your hand is always the one revealed, the other
// three always render as compact face-down summaries, never their card values.

import { useState } from 'react'
import { canOfferEarlyEnd, computeTarget, isPass, legalCardsToPlay, SUITS, TOTAL_TRICKS } from '../engine'
import type { Card, Mode, PlayerId, Suit } from '../engine'
import { CardBack, CardChip, Hand, NeedsRow, SUIT_SYMBOL, TrumpBadge, capitalize, isRedSuit, sortHandForDisplay } from './GameViews'
import {
  nextToActInTrick,
  opposingTeam,
  teamsOf,
  teamTricks,
  type FourPlayerGameState,
} from './fourPlayerReducer'

/** The other 3 seats, in table order starting just after the viewer — so they read
 *  left-to-right the way they'd actually sit around the table from your seat. */
function otherSeatsInOrder(state: FourPlayerGameState, viewerPlayerId: PlayerId): PlayerId[] {
  const idx = state.seatOrder.indexOf(viewerPlayerId)
  return [...state.seatOrder.slice(idx + 1), ...state.seatOrder.slice(0, idx)]
}

/** A face-down opponent summary — just a name, team, and count, not their full hand
 *  rendered as individual card-backs (3 opponents x 12 cards each gets visually
 *  noisy fast). */
function MiniHand({ name, count }: { name: string; count: number }) {
  return (
    <div className="hand hand-hidden mini-hand">
      <h3 className="hand-label">
        {name} <span className="hand-count">· {count}</span>
      </h3>
      <div className="hand-cards">
        <CardBack index={0} />
      </div>
    </div>
  )
}

function OpponentRow({
  state,
  viewerPlayerId,
  countFor,
}: {
  state: FourPlayerGameState
  viewerPlayerId: PlayerId
  /** Defaults to card count; TrickView passes team tricks-won instead. */
  countFor?: (playerId: PlayerId) => number
}) {
  const getCount = countFor ?? ((p: PlayerId) => state.hands[p].length)
  return (
    <div className="table-seat away-row">
      {otherSeatsInOrder(state, viewerPlayerId).map((p) => (
        <MiniHand key={p} name={`${state.names[p]} (${state.teams[p]})`} count={getCount(p)} />
      ))}
    </div>
  )
}

// --- bidding ---------------------------------------------------------------

export function BiddingView4P({
  state,
  viewerPlayerId,
  onBid,
  onPass,
}: {
  state: FourPlayerGameState
  viewerPlayerId: PlayerId
  onBid: (number: number, mode: Mode) => void
  onPass: () => void
}) {
  const [number, setNumber] = useState(2)
  const [mode, setMode] = useState<Mode>('high')
  const current = state.bidding.order[state.bidding.turnIndex]
  const canAct = viewerPlayerId === current
  const isOpeningBid = state.bidding.turnIndex === 0

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
        <OpponentRow state={state} viewerPlayerId={viewerPlayerId} />

        <div className="table-center">
          <p className="badge-pixel">ORDER: {state.bidding.order.map((p) => state.names[p]).join(' → ')}</p>

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
          <Hand
            name={`${state.names[viewerPlayerId]} (you · ${state.teams[viewerPlayerId]})`}
            hand={sortHandForDisplay(state.hands[viewerPlayerId])}
            revealed
          />
        </div>
      </div>
    </section>
  )
}

// --- trump + kitty -----------------------------------------------------------

export function TrumpView4P({
  state,
  viewerPlayerId,
  onNameTrump,
}: {
  state: FourPlayerGameState
  viewerPlayerId: PlayerId
  onNameTrump: (suit: Suit) => void
}) {
  const winner = state.winningBid!.playerId
  const canAct = viewerPlayerId === winner
  return (
    <section className="panel">
      <h2>Name trump</h2>
      <p>
        {state.names[winner]} ({state.teams[winner]}) won the bid:{' '}
        <strong>
          {state.winningBid!.number} {state.winningBid!.mode}
        </strong>
      </p>
      {state.exceptionKittyFirst ? (
        <p className="hint">
          Note: {state.names[winner]} won the bid on their first call, so they get to call the trump suit after
          exchanging with the kitty.
        </p>
      ) : (
        <p className="hint">
          Trump must be named blind, before seeing the kitty — not even {state.names[winner]}'s partner sees this
          choice being made.
        </p>
      )}

      <div className="table table-compact">
        <OpponentRow state={state} viewerPlayerId={viewerPlayerId} />

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
          <Hand
            name={`${state.names[viewerPlayerId]} (you · ${state.teams[viewerPlayerId]})`}
            hand={sortHandForDisplay(state.hands[viewerPlayerId])}
            revealed
          />
        </div>
      </div>
    </section>
  )
}

export function KittyView4P({
  state,
  viewerPlayerId,
  onConfirm,
}: {
  state: FourPlayerGameState
  viewerPlayerId: PlayerId
  onConfirm: (discardFromHand: Card[], takeFromKitty: Card[]) => void
}) {
  const winner = state.winningBid!.playerId
  const canAct = viewerPlayerId === winner
  const [discardIds, setDiscardIds] = useState<Set<string>>(new Set())
  const [takeIds, setTakeIds] = useState<Set<string>>(new Set())

  // Private to the actual bidder — not even their partner sees this (spec §1.4).
  if (!canAct) {
    return (
      <section className="panel">
        <h2>Kitty exchange</h2>
        <p className="hint">
          {state.names[winner]} is looking at the kitty and choosing what to swap
          {state.teams[winner] === state.teams[viewerPlayerId] ? " — even you, their partner, don't see this" : ''}…
        </p>
      </section>
    )
  }

  const hand = sortHandForDisplay(state.hands[winner], state.winningBid!.mode)
  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSet(next)
  }
  const countsMatch = discardIds.size === takeIds.size
  const cardKey = (c: Card) => `${c.rank}-${c.suit}`

  return (
    <section className="panel">
      <h2>Kitty exchange</h2>
      <p className="hint">Swap any number of kitty cards into your hand — discard the same number back out.</p>
      <h3>Kitty — click to take</h3>
      <div className="hand-cards">
        {state.kitty.map((card, i) => (
          <CardChip
            key={cardKey(card)}
            card={card}
            index={i}
            selected={takeIds.has(cardKey(card))}
            onClick={() => toggle(takeIds, setTakeIds, cardKey(card))}
          />
        ))}
      </div>
      <h3>
        Your hand — click to discard ({discardIds.size} selected, need {takeIds.size})
      </h3>
      <div className="hand-cards">
        {hand.map((card, i) => (
          <CardChip
            key={cardKey(card)}
            card={card}
            index={i}
            selected={discardIds.has(cardKey(card))}
            onClick={() => toggle(discardIds, setDiscardIds, cardKey(card))}
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
              hand.filter((c) => discardIds.has(cardKey(c))),
              state.kitty.filter((c) => takeIds.has(cardKey(c))),
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

// --- trick play -----------------------------------------------------------

export function TrickView4P({
  state,
  viewerPlayerId,
  onPlayCard,
  onContinue,
  onEndEarly,
}: {
  state: FourPlayerGameState
  viewerPlayerId: PlayerId
  onPlayCard: (card: Card) => void
  onContinue: () => void
  onEndEarly: () => void
}) {
  const trickComplete = state.trick.plays.length === state.seatOrder.length
  const toAct = trickComplete ? null : nextToActInTrick(state)
  const trumpSuit = state.trumpSuit as Suit
  const bidWinner = state.winningBid!.playerId
  const bidTeam = state.teams[bidWinner]
  const defendTeam = opposingTeam(state, bidTeam)
  const target = computeTarget(state.winningBid!.number)
  const bidSideTarget = TOTAL_TRICKS + 1 - target
  const canAct = !trickComplete && toAct === viewerPlayerId
  const [teamA, teamB] = teamsOf(state)

  const lastWinner = state.trickHistory[state.trickHistory.length - 1]?.winner
  const canContinue = trickComplete && viewerPlayerId === lastWinner

  return (
    <section className="panel">
      <h2 className="trick-progress">
        Trick {state.tricksPlayed} of {TOTAL_TRICKS}
      </h2>
      <TrumpBadge suit={trumpSuit} mode={state.winningBid!.mode} broken={state.trumpBroken} />
      <NeedsRow
        entries={[teamA, teamB].map((team) => ({
          name: team,
          need: team === defendTeam ? target : bidSideTarget,
        }))}
      />

      <div className="table table-fixed">
        <OpponentRow state={state} viewerPlayerId={viewerPlayerId} countFor={(p) => teamTricks(state, state.teams[p])} />

        <div className="table-center table-center-trick">
          <div className="trick-area">
            {state.trick.plays.length === 0 && <p>{state.names[state.trickLeader as PlayerId]} leads.</p>}
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
                      {defendTeam} can't reach {target} tricks anymore — {bidTeam} has it locked in. Call it now, or
                      play out all 12 for the full tally.
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
            name={`${state.names[viewerPlayerId]} (you · ${state.teams[viewerPlayerId]})`}
            hand={sortHandForDisplay(state.hands[viewerPlayerId], state.winningBid!.mode)}
            revealed
            onPlay={canAct ? onPlayCard : undefined}
            legal={canAct ? legalCardsToPlay(state.hands[viewerPlayerId], state.trick, trumpSuit, state.trumpBroken) : undefined}
            count={teamTricks(state, state.teams[viewerPlayerId])}
          />
        </div>
      </div>
    </section>
  )
}

export function RoundEndView4P({ state, onNextRound }: { state: FourPlayerGameState; onNextRound: () => void }) {
  const bidWinner = state.winningBid!.playerId
  const bidTeam = state.teams[bidWinner]
  const defendTeam = opposingTeam(state, bidTeam)
  const target = computeTarget(state.winningBid!.number)
  const bidderWon = state.outcome === 'bidders_win' || state.outcome === 'bidders_clinched'

  return (
    <section className="panel result-panel">
      <h2>Round {state.round} over</h2>
      <p>
        Bid: {state.winningBid!.number} {state.winningBid!.mode} by {state.names[bidWinner]} ({bidTeam}) —{' '}
        {defendTeam} needed {target} tricks.
      </p>
      <p>
        Final tricks — {bidTeam}: <strong>{teamTricks(state, bidTeam)}</strong> &nbsp;|&nbsp; {defendTeam}:{' '}
        <strong>{teamTricks(state, defendTeam)}</strong>
      </p>
      <p className="result">
        {bidderWon ? `🏆 ${bidTeam} wins the round!` : `🏆 ${defendTeam} wins the round!`}
        {state.outcome === 'bidders_clinched' && ' (ended early)'}
      </p>
      <button type="button" className="pill-btn primary" onClick={onNextRound}>
        Next round
      </button>
    </section>
  )
}

// A local, hot-seat 2P game screen wired directly to the engine (no network sync
// yet). Each seat's cards render face-down for whoever isn't currently acting, Uno
// pass-and-play style — but since both players still share one process/DOM, this is a
// presentation-layer hide, not a real privacy boundary (see README backlog: that needs
// per-client Firestore sync, where each browser genuinely only has one player's data).

import { useEffect, useState } from 'react'
import {
  applyKittyExchange,
  applyTwoPBid,
  buildDeck,
  canOfferEarlyEnd,
  cardBreaksTrump,
  cardId,
  computeTarget,
  drawCard,
  evaluateRoundStatus,
  isLegalPlay,
  isPass,
  isRoundOver,
  legalCardsToPlay,
  nextTwoPOpener,
  playCard,
  resolveDraw,
  resolveTrick,
  setAsideKitty,
  shuffle,
  startDrawPhase,
  startTrick,
  startTwoPBidding,
  SUITS,
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
import './TwoPlayerGame.css'

const PLAYERS: readonly [PlayerId, PlayerId] = ['p1', 'p2']
const PLAYER_NAMES: Record<PlayerId, string> = { p1: 'Player 1', p2: 'Player 2' }
const SUIT_SYMBOL: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }

function otherOf(playerId: PlayerId): PlayerId {
  return playerId === 'p1' ? 'p2' : 'p1'
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

function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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

// --- game state ------------------------------------------------------------------

type Phase = 'draw' | 'bidding' | 'trump' | 'kitty' | 'trick' | 'round-end'

interface GameState {
  round: number
  opener: PlayerId
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
  phase: Phase
  error: string | null
}

function startRound(round: number, opener: PlayerId): GameState {
  const deck = shuffle(buildDeck())
  const { kitty, remaining } = setAsideKitty(deck)
  const openerSeat = opener === PLAYERS[0] ? 0 : 1
  return {
    round,
    opener,
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
    error: null,
  }
}

// --- card rendering ----------------------------------------------------------------

function CardChip({
  card,
  onClick,
  disabled,
  selected,
  index = 0,
}: {
  card: Card
  onClick?: () => void
  disabled?: boolean
  selected?: boolean
  index?: number
}) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds'
  return (
    <button
      type="button"
      className={['card-chip', red ? 'red' : 'black', selected ? 'selected' : ''].join(' ').trim()}
      style={{ '--i': index } as React.CSSProperties}
      onClick={onClick}
      disabled={!onClick || disabled}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
    </button>
  )
}

function CardBack({ index = 0 }: { index?: number }) {
  return (
    <div className="card-chip card-back" style={{ '--i': index } as React.CSSProperties} aria-hidden="true">
      <span className="card-back-mark">T</span>
    </div>
  )
}

function Hand({
  playerId,
  hand,
  revealed,
  onPlay,
  legal,
}: {
  playerId: PlayerId
  hand: Card[]
  revealed: boolean
  onPlay?: (card: Card) => void
  legal?: Card[]
}) {
  return (
    <div className={`hand ${revealed ? 'hand-revealed' : 'hand-hidden'}`}>
      <h3 className="hand-label">
        {revealed ? `${PLAYER_NAMES[playerId]} (you)` : PLAYER_NAMES[playerId]}{' '}
        <span className="hand-count">· {hand.length}</span>
      </h3>
      <div className="hand-cards">
        {revealed
          ? hand.map((card, i) => (
              <CardChip
                key={cardId(card)}
                card={card}
                index={i}
                onClick={onPlay ? () => onPlay(card) : undefined}
                disabled={legal ? !legal.some((c) => c.suit === card.suit && c.rank === card.rank) : false}
              />
            ))
          : hand.map((card, i) => <CardBack key={cardId(card)} index={i} />)}
      </div>
    </div>
  )
}

export function TwoPlayerGame() {
  const [state, setState] = useState<GameState>(() => startRound(1, PLAYERS[0]))
  const [rulesOpen, setRulesOpen] = useState(false)

  // Engine calls throw on illegal moves. setState's updater runs inside React,
  // not inside our call stack, so a try/catch wrapped *around* setState(...) never
  // actually catches anything it throws — the error escapes during render and takes
  // the whole app down. The fix: put the try/catch *inside* the updater itself, so it
  // runs in the same scope as the throw.
  function safeUpdate(compute: (s: GameState) => GameState) {
    setState((s) => {
      try {
        return { ...compute(s), error: null }
      } catch (err) {
        return { ...s, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  // --- draw phase -----------------------------------------------------------

  function handleDraw() {
    safeUpdate((s) => ({ ...s, draw: drawCard(s.draw) }))
  }

  function handleResolveDraw(decision: 'keep' | 'discard') {
    safeUpdate((s) => {
      const draw = resolveDraw(s.draw, decision)
      if (!draw.complete) return { ...s, draw }
      const hands = { p1: draw.hands[0], p2: draw.hands[1] }
      return { ...s, draw, hands, phase: 'bidding' }
    })
  }

  // --- bidding ---------------------------------------------------------------

  function handleBid(number: number, mode: Mode) {
    safeUpdate((s) => {
      const bidding = applyTwoPBid(s.bidding, { playerId: s.bidding.currentBidder, number, mode })
      return advanceAfterBidding(s, bidding)
    })
  }

  function handlePass() {
    safeUpdate((s) => {
      const bidding = applyTwoPBid(s.bidding, { playerId: s.bidding.currentBidder, pass: true })
      return advanceAfterBidding(s, bidding)
    })
  }

  function advanceAfterBidding(s: GameState, bidding: TwoPBiddingState): GameState {
    if (!bidding.complete) return { ...s, bidding }
    const winningBid = bidding.highestBid as Bid
    // Exception (spec §1.4): if the first bidder wins on their very first call — i.e.
    // the opener's opening bid stands because the second player passed immediately —
    // they get to see the kitty before naming trump.
    const exceptionKittyFirst = bidding.bidsMade.length === 2 && isPass(bidding.bidsMade[1]) && bidding.winner === s.opener
    return { ...s, bidding, winningBid, exceptionKittyFirst, phase: exceptionKittyFirst ? 'kitty' : 'trump' }
  }

  // --- trump + kitty -----------------------------------------------------------

  function handleNameTrump(suit: Suit) {
    setState((s) => {
      const next = { ...s, trumpSuit: suit }
      // Exception path: kitty already resolved before trump was named -> go straight
      // to trick play. Normal path: trump named blind first -> go view the kitty.
      return s.exceptionKittyFirst ? beginTrickPlay(next) : { ...next, phase: 'kitty' }
    })
  }

  function handleConfirmKitty(discardFromHand: Card[], takeFromKitty: Card[]) {
    safeUpdate((s) => {
      const winner = (s.winningBid as Bid).playerId
      const { hand, kitty } = applyKittyExchange(s.hands[winner], s.kitty, discardFromHand, takeFromKitty)
      const next = { ...s, hands: { ...s.hands, [winner]: hand }, kitty }
      // Exception path: kitty is resolved first, trump still needs naming.
      // Normal path: trump was already named, so tricks can begin now.
      return s.exceptionKittyFirst ? { ...next, phase: 'trump' } : beginTrickPlay(next)
    })
  }

  function beginTrickPlay(s: GameState): GameState {
    return { ...s, trick: startTrick(), trumpBroken: false, trickLeader: (s.winningBid as Bid).playerId, phase: 'trick' }
  }

  // --- trick play -----------------------------------------------------------

  function handlePlayCard(playerId: PlayerId, card: Card) {
    safeUpdate((s) => {
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
    })
  }

  function handleContinueAfterTrick() {
    setState((s) => {
      const winner = s.trickHistory[s.trickHistory.length - 1]?.winner ?? s.trickLeader
      return { ...s, trick: startTrick(), trickLeader: winner }
    })
  }

  function handleEndRoundEarly() {
    setState((s) => ({ ...s, phase: 'round-end' }))
  }

  function handleNextRound() {
    setState((s) => startRound(s.round + 1, nextTwoPOpener(s.opener, PLAYERS)))
  }

  return (
    <div className="game">
      <header className="game-header">
        <div className="title-row">
          <h1>🂡 Trumps</h1>
          <button type="button" className="pill-btn" onClick={() => setRulesOpen(true)}>
            📖 Rules
          </button>
        </div>
        <p className="badge-pixel">
          ROUND {state.round} · OPENER {PLAYER_NAMES[state.opener].toUpperCase()}
        </p>
      </header>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {state.error && <p className="error">{state.error}</p>}

      {state.phase === 'draw' && <DrawPhaseView state={state} onDraw={handleDraw} onResolve={handleResolveDraw} />}
      {state.phase === 'bidding' && <BiddingView state={state} onBid={handleBid} onPass={handlePass} />}
      {state.phase === 'trump' && <TrumpView state={state} onNameTrump={handleNameTrump} />}
      {state.phase === 'kitty' && <KittyView state={state} onConfirm={handleConfirmKitty} />}
      {state.phase === 'trick' && (
        <TrickView
          state={state}
          onPlayCard={handlePlayCard}
          onContinue={handleContinueAfterTrick}
          onEndEarly={handleEndRoundEarly}
        />
      )}
      {state.phase === 'round-end' && <RoundEndView state={state} onNextRound={handleNextRound} />}
    </div>
  )
}

// --- phase views ---------------------------------------------------------------

function DrawPhaseView({
  state,
  onDraw,
  onResolve,
}: {
  state: GameState
  onDraw: () => void
  onResolve: (decision: 'keep' | 'discard') => void
}) {
  const seatPlayers: [PlayerId, PlayerId] = ['p1', 'p2']
  const activePlayer = seatPlayers[state.draw.turn]
  const otherPlayer = otherOf(activePlayer)
  const handFor = (id: PlayerId) => state.draw.hands[id === 'p1' ? 0 : 1]
  const pileSize = state.draw.middlePile.length

  return (
    <section className="panel">
      <h2>Draw phase</h2>
      <p className="hint">Whoever's turn it is can see their own hand — the other player's cards stay face-down.</p>

      <div className="table">
        <div className="table-seat away">
          <Hand playerId={otherPlayer} hand={handFor(otherPlayer)} revealed={false} />
        </div>

        <div className="table-center">
          <p className="badge-pixel">PILE · {pileSize} LEFT</p>
          <div className="pile-stack">
            {Array.from({ length: Math.min(pileSize, 4) }).map((_, i) => (
              <div key={i} className="card-chip card-back pile-card" style={{ '--i': i } as React.CSSProperties} />
            ))}
          </div>

          <p className="turn-banner">{PLAYER_NAMES[activePlayer]}'s turn</p>

          {!state.draw.pendingCard && (
            <button type="button" className="pill-btn primary" onClick={onDraw}>
              Draw a card
            </button>
          )}

          {state.draw.pendingCard && (
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
                Keep: this card joins your hand, then the next card auto-discards unseen. Discard: this card is gone
                unseen, and you're forced to keep whatever comes up next — watch it land in your hand below.
              </p>
            </div>
          )}
        </div>

        <div className="table-seat near">
          <Hand playerId={activePlayer} hand={handFor(activePlayer)} revealed />
        </div>
      </div>
    </section>
  )
}

function BiddingView({
  state,
  onBid,
  onPass,
}: {
  state: GameState
  onBid: (number: number, mode: Mode) => void
  onPass: () => void
}) {
  const [number, setNumber] = useState(2)
  const [mode, setMode] = useState<Mode>('high')
  const isOpeningBid = state.bidding.bidsMade.length === 0
  const current = state.bidding.currentBidder
  const other = otherOf(current)
  const bidsLeft = (id: PlayerId) => 2 - state.bidding.bidCounts[id]

  return (
    <section className="panel">
      <h2>Bidding</h2>
      <p className="turn-banner-inline">
        {PLAYER_NAMES[current]}'s turn to bid
        {isOpeningBid && ' — opener must bid, no passing yet'}
      </p>
      <p>
        Highest bid so far:{' '}
        <strong>
          {state.bidding.highestBid
            ? `${state.bidding.highestBid.number} ${state.bidding.highestBid.mode} (${PLAYER_NAMES[state.bidding.highestBid.playerId]})`
            : 'none'}
        </strong>
      </p>

      <div className="table">
        <div className="table-seat away">
          <Hand playerId={other} hand={state.hands[other]} revealed={false} />
        </div>

        <div className="table-center">
          <p className="badge-pixel">
            {PLAYER_NAMES.p1.toUpperCase()} · {bidsLeft('p1')} BID{bidsLeft('p1') === 1 ? '' : 'S'} LEFT &nbsp;|&nbsp;{' '}
            {PLAYER_NAMES.p2.toUpperCase()} · {bidsLeft('p2')} BID{bidsLeft('p2') === 1 ? '' : 'S'} LEFT
          </p>
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
          <div className="bid-history-wrap">
            <h3>Bid history</h3>
            <ul className="bid-history">
              {state.bidding.bidsMade.map((action, i) => (
                <li key={i}>
                  {PLAYER_NAMES[action.playerId]}: {isPass(action) ? 'pass' : `${action.number} ${action.mode}`}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="table-seat near">
          <Hand playerId={current} hand={state.hands[current]} revealed />
        </div>
      </div>
    </section>
  )
}

function TrumpView({ state, onNameTrump }: { state: GameState; onNameTrump: (suit: Suit) => void }) {
  const winner = (state.winningBid as Bid).playerId
  return (
    <section className="panel">
      <h2>Name trump</h2>
      <p>
        {PLAYER_NAMES[winner]} won the bid: <strong>{state.winningBid?.number} {state.winningBid?.mode}</strong>
      </p>
      {state.exceptionKittyFirst ? (
        <p className="hint">Bonus: won on their very first call, so trump is named after seeing the kitty (not blind).</p>
      ) : (
        <p className="hint">Trump must be named blind, before seeing the kitty.</p>
      )}
      <div className="button-row">
        {SUITS.map((suit) => (
          <button
            type="button"
            key={suit}
            className={['pill-btn', 'suit-btn', suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black'].join(' ')}
            onClick={() => onNameTrump(suit)}
          >
            {SUIT_SYMBOL[suit]} {suit}
          </button>
        ))}
      </div>
    </section>
  )
}

function KittyView({
  state,
  onConfirm,
}: {
  state: GameState
  onConfirm: (discardFromHand: Card[], takeFromKitty: Card[]) => void
}) {
  const winner = (state.winningBid as Bid).playerId
  const [discardIds, setDiscardIds] = useState<Set<string>>(new Set())
  const [takeIds, setTakeIds] = useState<Set<string>>(new Set())

  const hand = state.hands[winner]
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
      <p className="hint">
        {PLAYER_NAMES[winner]} may swap any number of kitty cards into their hand (discarding the same number back
        out).
      </p>
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
        {PLAYER_NAMES[winner]}'s hand — click to discard ({discardIds.size} selected, need {takeIds.size})
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

function TrickView({
  state,
  onPlayCard,
  onContinue,
  onEndEarly,
}: {
  state: GameState
  onPlayCard: (playerId: PlayerId, card: Card) => void
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

  // Whoever's about to act is shown face-up in the near seat; the other player's hand
  // stays face-down. Between tricks (nobody "to act" yet) keep the last actor's view.
  const nearPlayer = toAct ?? state.trick.plays[0]?.playerId ?? leader
  const awayPlayer = otherOf(nearPlayer)

  return (
    <section className="panel">
      <h2>Trick play</h2>
      <p className="badge-pixel">
        TRUMP {SUIT_SYMBOL[trumpSuit]} {trumpSuit.toUpperCase()} · {(state.winningBid as Bid).mode.toUpperCase()} ·{' '}
        {state.trumpBroken ? 'BROKEN' : 'NOT BROKEN'}
      </p>
      <p>
        Tricks played: {state.tricksPlayed}/12 &nbsp;|&nbsp; {PLAYER_NAMES[bidWinner]} (bid side):{' '}
        <strong>{state.trickCounts[bidWinner]}</strong> &nbsp;|&nbsp; {PLAYER_NAMES[defender]} (needs {target}):{' '}
        <strong>{state.trickCounts[defender]}</strong>
      </p>

      <div className="table">
        <div className="table-seat away">
          <Hand playerId={awayPlayer} hand={state.hands[awayPlayer]} revealed={false} />
        </div>

        <div className="table-center">
          <div className="trick-area">
            {state.trick.plays.length === 0 && <p>{PLAYER_NAMES[leader]} leads.</p>}
            {state.trick.plays.map((p) => (
              <div key={p.playerId} className="trick-play">
                <span className="hint">{PLAYER_NAMES[p.playerId]}</span>
                <CardChip card={p.card} />
              </div>
            ))}
          </div>

          {trickComplete ? (
            <div className="button-row trick-result">
              <p className="turn-banner">
                {PLAYER_NAMES[state.trickHistory[state.trickHistory.length - 1].winner]} wins the trick!
              </p>
              {canOfferEarlyEnd(state.outcome) ? (
                <>
                  <p className="hint">
                    {PLAYER_NAMES[defender]} can no longer reach {target} tricks — {PLAYER_NAMES[bidWinner]}'s side
                    has clinched. Both sides may end now, or play out all 12 tricks.
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
              )}
            </div>
          ) : (
            <p className="turn-banner-inline">
              {PLAYER_NAMES[toAct as PlayerId]} to play
              {state.trick.ledSuit && ` (led suit: ${SUIT_SYMBOL[state.trick.ledSuit]} ${state.trick.ledSuit})`}
            </p>
          )}
        </div>

        <div className="table-seat near">
          <Hand
            playerId={nearPlayer}
            hand={state.hands[nearPlayer]}
            revealed
            onPlay={!trickComplete && toAct === nearPlayer ? (card) => onPlayCard(nearPlayer, card) : undefined}
            legal={
              !trickComplete && toAct === nearPlayer
                ? legalCardsToPlay(state.hands[nearPlayer], state.trick, trumpSuit, state.trumpBroken)
                : undefined
            }
          />
        </div>
      </div>
    </section>
  )
}

function RoundEndView({ state, onNextRound }: { state: GameState; onNextRound: () => void }) {
  const bidWinner = (state.winningBid as Bid).playerId
  const defender = otherOf(bidWinner)
  const target = computeTarget((state.winningBid as Bid).number)
  const bidderWon = state.outcome === 'bidders_win' || state.outcome === 'bidders_clinched'

  return (
    <section className="panel result-panel">
      <h2>Round {state.round} over</h2>
      <p>
        Bid: {state.winningBid?.number} {state.winningBid?.mode} by {PLAYER_NAMES[bidWinner]} — {PLAYER_NAMES[defender]}{' '}
        needed {target} tricks.
      </p>
      <p>
        Final tricks — {PLAYER_NAMES[bidWinner]}: <strong>{state.trickCounts[bidWinner]}</strong> &nbsp;|&nbsp;{' '}
        {PLAYER_NAMES[defender]}: <strong>{state.trickCounts[defender]}</strong>
      </p>
      <p className="result">
        {bidderWon ? `🏆 ${PLAYER_NAMES[bidWinner]}'s side wins the round!` : `🏆 ${PLAYER_NAMES[defender]} wins the round!`}
        {state.outcome === 'bidders_clinched' && ' (ended early)'}
      </p>
      <button type="button" className="pill-btn primary" onClick={onNextRound}>
        Next round
      </button>
    </section>
  )
}

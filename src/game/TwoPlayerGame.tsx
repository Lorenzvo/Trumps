// A local, hot-seat 2P game screen wired directly to the engine (no network sync
// yet — both hands are shown on screen so it's easy to verify engine behavior).
// This is the "get a fully playable-but-unstyled 2P game working" milestone from
// trumps-spec.md §3, minus the Firestore wiring (that's next).

import { useState } from 'react'
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

// Bare-bones rules reference — content over presentation for now, see
// trumps-spec.md §1 for the full rules this is condensed from.
function Rules() {
  return (
    <details className="rules">
      <summary>Rules (2P)</summary>
      <ul>
        <li>
          <strong>Draw:</strong> alternate turns drawing from the middle pile. Keep the card (next card
          auto-discards unseen) or discard it (forced to keep the next card, unseen) — either way you end up with 12
          cards.
        </li>
        <li>
          <strong>Bidding:</strong> the player who drew first opens (can't pass). A bid is a number 2-7 plus High or
          Low — the bid number means the opponent needs <code>8 − bid</code> tricks to win. Higher number always
          beats lower; at equal numbers Low beats High. Each player gets up to 2 bids; raise or pass.
        </li>
        <li>
          <strong>Trump:</strong> named blind (before seeing the kitty) — unless the opener wins on their very first
          call, in which case they see the kitty first.
        </li>
        <li>
          <strong>Kitty exchange:</strong> the bid winner may swap any number of the 4 kitty cards into their hand,
          discarding the same number back out.
        </li>
        <li>
          <strong>Tricks:</strong> follow suit if able. If void, you may play trump (once broken) or any other card
          — trump is never forced. Highest trump wins the trick; otherwise best card of the led suit (High or Low
          per the bid).
        </li>
        <li>
          <strong>Win:</strong> the bid side wins if the opponent never reaches their target trick count across all
          12 tricks; the opponent wins the instant they do.
        </li>
      </ul>
    </details>
  )
}

function otherOf(playerId: PlayerId): PlayerId {
  return playerId === 'p1' ? 'p2' : 'p1'
}

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

function CardChip({
  card,
  onClick,
  disabled,
  selected,
}: {
  card: Card
  onClick?: () => void
  disabled?: boolean
  selected?: boolean
}) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds'
  return (
    <button
      type="button"
      className={['card-chip', red ? 'red' : 'black', selected ? 'selected' : ''].join(' ').trim()}
      onClick={onClick}
      disabled={!onClick || disabled}
    >
      {card.rank}
      {SUIT_SYMBOL[card.suit]}
    </button>
  )
}

export function TwoPlayerGame() {
  const [state, setState] = useState<GameState>(() => startRound(1, PLAYERS[0]))

  function withError<T>(fn: () => T): T | undefined {
    try {
      setState((s) => ({ ...s, error: null }))
      return fn()
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
      return undefined
    }
  }

  // --- draw phase -----------------------------------------------------------

  function handleDraw() {
    withError(() => setState((s) => ({ ...s, draw: drawCard(s.draw) })))
  }

  function handleResolveDraw(decision: 'keep' | 'discard') {
    withError(() =>
      setState((s) => {
        const draw = resolveDraw(s.draw, decision)
        if (!draw.complete) return { ...s, draw }
        const hands = { p1: draw.hands[0], p2: draw.hands[1] }
        return { ...s, draw, hands, phase: 'bidding' }
      }),
    )
  }

  // --- bidding ---------------------------------------------------------------

  function handleBid(number: number, mode: Mode) {
    withError(() =>
      setState((s) => {
        const bidding = applyTwoPBid(s.bidding, { playerId: s.bidding.currentBidder, number, mode })
        return advanceAfterBidding(s, bidding)
      }),
    )
  }

  function handlePass() {
    withError(() =>
      setState((s) => {
        const bidding = applyTwoPBid(s.bidding, { playerId: s.bidding.currentBidder, pass: true })
        return advanceAfterBidding(s, bidding)
      }),
    )
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
    withError(() =>
      setState((s) => {
        const winner = (s.winningBid as Bid).playerId
        const { hand, kitty } = applyKittyExchange(s.hands[winner], s.kitty, discardFromHand, takeFromKitty)
        const next = { ...s, hands: { ...s.hands, [winner]: hand }, kitty }
        // Exception path: kitty is resolved first, trump still needs naming.
        // Normal path: trump was already named, so tricks can begin now.
        return s.exceptionKittyFirst ? { ...next, phase: 'trump' } : beginTrickPlay(next)
      }),
    )
  }

  function beginTrickPlay(s: GameState): GameState {
    return { ...s, trick: startTrick(), trumpBroken: false, trickLeader: (s.winningBid as Bid).playerId, phase: 'trick' }
  }

  // --- trick play -----------------------------------------------------------

  function handlePlayCard(playerId: PlayerId, card: Card) {
    withError(() =>
      setState((s) => {
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
      }),
    )
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
        <h1>Trumps — 2P (local hot-seat test)</h1>
        <p>
          Round {state.round} · Opener: {PLAYER_NAMES[state.opener]}
        </p>
      </header>

      <Rules />

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

function Hand({
  playerId,
  hand,
  onPlay,
  legal,
}: {
  playerId: PlayerId
  hand: Card[]
  onPlay?: (card: Card) => void
  legal?: Card[]
}) {
  return (
    <div className="hand">
      <h3>{PLAYER_NAMES[playerId]}'s hand ({hand.length})</h3>
      <div className="hand-cards">
        {hand.map((card) => (
          <CardChip
            key={cardId(card)}
            card={card}
            onClick={onPlay ? () => onPlay(card) : undefined}
            disabled={legal ? !legal.some((c) => c.suit === card.suit && c.rank === card.rank) : false}
          />
        ))}
      </div>
    </div>
  )
}

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
  const currentPlayer = seatPlayers[state.draw.turn]
  return (
    <section>
      <h2>Draw phase</h2>
      <p>Middle pile: {state.draw.middlePile.length} cards left</p>
      <p>
        {PLAYER_NAMES.p1}: {state.draw.hands[0].length} cards &nbsp;|&nbsp; {PLAYER_NAMES.p2}:{' '}
        {state.draw.hands[1].length} cards
      </p>
      <p>
        <strong>Turn: {PLAYER_NAMES[currentPlayer]}</strong>
      </p>
      {!state.draw.pendingCard && (
        <button type="button" onClick={onDraw}>
          Draw a card
        </button>
      )}
      {state.draw.pendingCard && (
        <div className="draw-decision">
          <p>Drew:</p>
          <CardChip card={state.draw.pendingCard} />
          <div className="button-row">
            <button type="button" onClick={() => onResolve('keep')}>
              Keep
            </button>
            <button type="button" onClick={() => onResolve('discard')}>
              Discard
            </button>
          </div>
          <p className="hint">
            Keep: this card joins your hand, then the next card auto-discards unseen. Discard: this card is gone
            unseen, and you're forced to keep whatever comes up next.
          </p>
        </div>
      )}

      <div className="hands">
        <Hand playerId="p1" hand={state.draw.hands[0]} />
        <Hand playerId="p2" hand={state.draw.hands[1]} />
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

  return (
    <section>
      <h2>Bidding</h2>
      <p>
        <strong>Turn: {PLAYER_NAMES[state.bidding.currentBidder]}</strong>
        {isOpeningBid && ' (opener must bid — no passing yet)'}
      </p>
      <p>
        Highest bid so far:{' '}
        {state.bidding.highestBid
          ? `${state.bidding.highestBid.number} ${state.bidding.highestBid.mode} (${PLAYER_NAMES[state.bidding.highestBid.playerId]})`
          : 'none'}
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
        <button type="button" onClick={() => onBid(number, mode)}>
          Bid
        </button>
        <button type="button" onClick={onPass} disabled={isOpeningBid}>
          Pass
        </button>
      </div>
      <h3>Bid history</h3>
      <ul>
        {state.bidding.bidsMade.map((action, i) => (
          <li key={i}>
            {PLAYER_NAMES[action.playerId]}: {isPass(action) ? 'pass' : `${action.number} ${action.mode}`}
          </li>
        ))}
      </ul>
    </section>
  )
}

function TrumpView({ state, onNameTrump }: { state: GameState; onNameTrump: (suit: Suit) => void }) {
  const winner = (state.winningBid as Bid).playerId
  return (
    <section>
      <h2>Name trump</h2>
      <p>
        {PLAYER_NAMES[winner]} won the bid: {state.winningBid?.number} {state.winningBid?.mode}
      </p>
      {state.exceptionKittyFirst ? (
        <p>Bonus: won on their very first call, so trump is named after seeing the kitty (not blind).</p>
      ) : (
        <p>Trump must be named blind, before seeing the kitty.</p>
      )}
      <div className="button-row">
        {SUITS.map((suit) => (
          <button type="button" key={suit} onClick={() => onNameTrump(suit)}>
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
    <section>
      <h2>Kitty exchange</h2>
      <p>
        {PLAYER_NAMES[winner]} may swap any number of kitty cards into their hand (discarding the same number back
        out).
      </p>
      <h3>Kitty — click to take</h3>
      <div className="hand-cards">
        {state.kitty.map((card) => (
          <CardChip
            key={cardId(card)}
            card={card}
            selected={takeIds.has(cardId(card))}
            onClick={() => toggle(takeIds, setTakeIds, cardId(card))}
          />
        ))}
      </div>
      <h3>
        {PLAYER_NAMES[winner]}'s hand — click to discard ({discardIds.size} selected, need {takeIds.size})
      </h3>
      <div className="hand-cards">
        {hand.map((card) => (
          <CardChip
            key={cardId(card)}
            card={card}
            selected={discardIds.has(cardId(card))}
            onClick={() => toggle(discardIds, setDiscardIds, cardId(card))}
          />
        ))}
      </div>
      <div className="button-row">
        <button
          type="button"
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
        {!countsMatch && <span> Selected counts must match.</span>}
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

  return (
    <section>
      <h2>
        Trick play — trump {SUIT_SYMBOL[trumpSuit]} {trumpSuit} ({(state.winningBid as Bid).mode}), trump{' '}
        {state.trumpBroken ? 'broken' : 'not yet broken'}
      </h2>
      <p>
        Tricks played: {state.tricksPlayed}/12 &nbsp;|&nbsp; {PLAYER_NAMES[bidWinner]} (bid side):{' '}
        {state.trickCounts[bidWinner]} &nbsp;|&nbsp; {PLAYER_NAMES[defender]} (defending, needs {target}):{' '}
        {state.trickCounts[defender]}
      </p>

      <div className="trick-area">
        {state.trick.plays.length === 0 && <p>{PLAYER_NAMES[leader]} leads.</p>}
        {state.trick.plays.map((p) => (
          <div key={p.playerId} className="trick-play">
            {PLAYER_NAMES[p.playerId]}: <CardChip card={p.card} />
          </div>
        ))}
      </div>

      {trickComplete ? (
        <div className="button-row">
          <p>
            {PLAYER_NAMES[state.trickHistory[state.trickHistory.length - 1].winner]} wins the trick!
          </p>
          {canOfferEarlyEnd(state.outcome) ? (
            <>
              <p>
                {PLAYER_NAMES[defender]} can no longer reach {target} tricks — {PLAYER_NAMES[bidWinner]}'s side has
                clinched. Both sides may end now, or play out all 12 tricks.
              </p>
              <button type="button" onClick={onEndEarly}>
                End round now
              </button>
              <button type="button" onClick={onContinue}>
                Keep playing
              </button>
            </>
          ) : (
            <button type="button" onClick={onContinue}>
              Next trick
            </button>
          )}
        </div>
      ) : (
        <p>
          <strong>{PLAYER_NAMES[toAct as PlayerId]} to play</strong>
          {state.trick.ledSuit && ` (led suit: ${SUIT_SYMBOL[state.trick.ledSuit]} ${state.trick.ledSuit})`}
        </p>
      )}

      <div className="hands">
        {PLAYERS.map((playerId) => (
          <Hand
            key={playerId}
            playerId={playerId}
            hand={state.hands[playerId]}
            onPlay={!trickComplete && toAct === playerId ? (card) => onPlayCard(playerId, card) : undefined}
            legal={
              !trickComplete && toAct === playerId
                ? legalCardsToPlay(state.hands[playerId], state.trick, trumpSuit, state.trumpBroken)
                : undefined
            }
          />
        ))}
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
    <section>
      <h2>Round {state.round} over</h2>
      <p>
        Bid: {state.winningBid?.number} {state.winningBid?.mode} by {PLAYER_NAMES[bidWinner]} — {PLAYER_NAMES[defender]}{' '}
        needed {target} tricks.
      </p>
      <p>
        Final tricks — {PLAYER_NAMES[bidWinner]}: {state.trickCounts[bidWinner]} &nbsp;|&nbsp; {PLAYER_NAMES[defender]}:{' '}
        {state.trickCounts[defender]}
      </p>
      <p className="result">
        <strong>
          {bidderWon ? `${PLAYER_NAMES[bidWinner]}'s side wins the round!` : `${PLAYER_NAMES[defender]} wins the round!`}
        </strong>
        {state.outcome === 'bidders_clinched' && ' (ended early)'}
      </p>
      <button type="button" onClick={onNextRound}>
        Next round
      </button>
    </section>
  )
}

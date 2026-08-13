// Local, hot-seat 2P game screen. Both hands live in one browser tab's state, so
// there's no real privacy boundary here — the pass-and-play trick is that
// `viewerPlayerId` (see GameViews.tsx) always tracks whoever can currently act,
// so hand visibility flips by turn. Useful for solo testing the engine, or literally
// passing the device back and forth. Real per-client privacy needs the networked
// build (NetworkedTwoPlayerGame.tsx), where viewerPlayerId is a fixed seat instead.

import { useState } from 'react'
import type { Card, Mode, PlayerId, Suit } from '../engine'
import {
  BiddingView,
  DrawPhaseView,
  KittyView,
  RoundEndView,
  RulesModal,
  TrickView,
  TrumpView,
} from './GameViews'
import {
  applyBid,
  applyConfirmKitty,
  applyContinueAfterTrick,
  applyDrawCard,
  applyEndRoundEarly,
  applyNameTrump,
  applyNextRound,
  applyPass,
  applyPlayCard,
  applyResolveDraw,
  otherOf,
  PLAYERS,
  startTwoPlayerRound,
  type TwoPlayerGameState,
} from './twoPlayerReducer'

const DEFAULT_NAMES: Record<PlayerId, string> = { p1: 'Player 1', p2: 'Player 2' }

/** Who's "near" (revealed) right now, for the pass-and-play hot-seat experience. */
function hotSeatViewer(state: TwoPlayerGameState): PlayerId {
  switch (state.phase) {
    case 'draw': {
      const seatPlayers: [PlayerId, PlayerId] = ['p1', 'p2']
      return seatPlayers[state.draw.turn]
    }
    case 'bidding':
      return state.bidding.currentBidder
    case 'trump':
    case 'kitty':
      return (state.winningBid as { playerId: PlayerId }).playerId
    case 'trick': {
      const leader = state.trickLeader as PlayerId
      if (state.trick.plays.length === 2) return state.trick.plays[0]?.playerId ?? leader
      return state.trick.plays.length === 0 ? leader : otherOf(state.trick.plays[0].playerId)
    }
    case 'round-end':
      return state.opener
  }
}

export function TwoPlayerGame() {
  const [game, setGame] = useState<TwoPlayerGameState>(() => startTwoPlayerRound(1, PLAYERS[0], DEFAULT_NAMES))
  const [rulesOpen, setRulesOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function safeUpdate(compute: (s: TwoPlayerGameState) => TwoPlayerGameState) {
    try {
      setGame(compute(game))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const viewer = hotSeatViewer(game)

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
          ROUND {game.round} · OPENER {game.names[game.opener].toUpperCase()}
        </p>
      </header>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {error && <p className="error">{error}</p>}

      {game.phase === 'draw' && (
        <DrawPhaseView
          state={game}
          viewerPlayerId={viewer}
          onDraw={() => safeUpdate(applyDrawCard)}
          onResolve={(decision) => safeUpdate((s) => applyResolveDraw(s, decision))}
        />
      )}
      {game.phase === 'bidding' && (
        <BiddingView
          state={game}
          viewerPlayerId={viewer}
          onBid={(number: number, mode: Mode) => safeUpdate((s) => applyBid(s, number, mode))}
          onPass={() => safeUpdate(applyPass)}
        />
      )}
      {game.phase === 'trump' && (
        <TrumpView state={game} viewerPlayerId={viewer} onNameTrump={(suit: Suit) => safeUpdate((s) => applyNameTrump(s, suit))} />
      )}
      {game.phase === 'kitty' && (
        <KittyView
          state={game}
          viewerPlayerId={viewer}
          onConfirm={(discard: Card[], take: Card[]) => safeUpdate((s) => applyConfirmKitty(s, discard, take))}
        />
      )}
      {game.phase === 'trick' && (
        <TrickView
          state={game}
          viewerPlayerId={viewer}
          onPlayCard={(card: Card) => safeUpdate((s) => applyPlayCard(s, viewer, card))}
          onContinue={() => setGame(applyContinueAfterTrick(game))}
          onEndEarly={() => setGame(applyEndRoundEarly(game))}
        />
      )}
      {game.phase === 'round-end' && <RoundEndView state={game} onNextRound={() => setGame(applyNextRound(game))} />}
    </div>
  )
}

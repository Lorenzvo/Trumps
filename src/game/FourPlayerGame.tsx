// Local, hot-seat 4P game screen — same pass-and-play model as TwoPlayerGame.tsx,
// extended to 4 seats. viewerPlayerId tracks whoever can currently act each render.

import { useState } from 'react'
import type { Card, Mode, PlayerId, Suit, TeamId } from '../engine'
import { RulesModal } from './GameViews'
import { BiddingView4P, KittyView4P, RoundEndView4P, TrickView4P, TrumpView4P } from './GameViews4P'
import {
  applyBid,
  applyConfirmKitty,
  applyContinueAfterTrick,
  applyEndRoundEarly,
  applyNameTrump,
  applyNextRound,
  applyPass,
  applyPlayCard,
  nextToActInTrick,
  startFourPlayerRound,
  type FourPlayerGameState,
} from './fourPlayerReducer'

const SEAT_ORDER: readonly [PlayerId, PlayerId, PlayerId, PlayerId] = ['blue1', 'red1', 'blue2', 'red2']
const TEAMS: Record<PlayerId, TeamId> = { blue1: 'Blue', red1: 'Red', blue2: 'Blue', red2: 'Red' }
const NAMES: Record<PlayerId, string> = { blue1: 'Blue 1', red1: 'Red 1', blue2: 'Blue 2', red2: 'Red 2' }

/** Who's "near" (revealed) right now, for the pass-and-play hot-seat experience. */
function hotSeatViewer(state: FourPlayerGameState): PlayerId {
  switch (state.phase) {
    case 'bidding':
      return state.bidding.order[state.bidding.turnIndex]
    case 'trump':
    case 'kitty':
      return (state.winningBid as { playerId: PlayerId }).playerId
    case 'trick':
      return state.trick.plays.length === state.seatOrder.length
        ? state.trickHistory[state.trickHistory.length - 1]?.winner ?? (state.trickLeader as PlayerId)
        : nextToActInTrick(state)
    case 'round-end':
      return state.opener
  }
}

export function FourPlayerGame() {
  const [game, setGame] = useState<FourPlayerGameState>(() => startFourPlayerRound(1, SEAT_ORDER, TEAMS, NAMES, 'blue1'))
  const [rulesOpen, setRulesOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function safeUpdate(compute: (s: FourPlayerGameState) => FourPlayerGameState) {
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

      {game.phase === 'bidding' && (
        <BiddingView4P
          state={game}
          viewerPlayerId={viewer}
          onBid={(number: number, mode: Mode) => safeUpdate((s) => applyBid(s, number, mode))}
          onPass={() => safeUpdate(applyPass)}
        />
      )}
      {game.phase === 'trump' && (
        <TrumpView4P state={game} viewerPlayerId={viewer} onNameTrump={(suit: Suit) => safeUpdate((s) => applyNameTrump(s, suit))} />
      )}
      {game.phase === 'kitty' && (
        <KittyView4P
          state={game}
          viewerPlayerId={viewer}
          onConfirm={(discard: Card[], take: Card[]) => safeUpdate((s) => applyConfirmKitty(s, discard, take))}
        />
      )}
      {game.phase === 'trick' && (
        <TrickView4P
          state={game}
          viewerPlayerId={viewer}
          onPlayCard={(card: Card) => safeUpdate((s) => applyPlayCard(s, viewer, card))}
          onContinue={() => setGame(applyContinueAfterTrick(game))}
          onEndEarly={() => setGame(applyEndRoundEarly(game))}
        />
      )}
      {game.phase === 'round-end' && <RoundEndView4P state={game} onNextRound={() => setGame(applyNextRound(game))} />}
    </div>
  )
}

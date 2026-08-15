// Networked 4P game screen — the 4-seat counterpart to NetworkedTwoPlayerGame.tsx,
// same contract (viewerPlayerId is your fixed seat, actions go through a Firestore
// transaction instead of local setState). No draw phase (4P deals straight away),
// and "Next round" always routes back through the Lobby regardless of manual/dice
// team mode — see RoundEndView4P.

import { useEffect, useState } from 'react'
import type { Card, Mode, PlayerId, Suit } from '../engine'
import { applyGameAction4P } from '../firebase/gameSync'
import { endMatch, leaveSpectator, restartMatch4P, returnToLobby, subscribeToRoom, type RoomDoc } from '../firebase/rooms'
import { ConfirmModal, PlayedCardsPanel, RulesModal } from './GameViews'
import {
  BiddingView4P,
  KittyView4P,
  RoundEndView4P,
  SpectatorView4P,
  TrickView4P,
  TrumpView4P,
} from './GameViews4P'
import {
  applyBid,
  applyConfirmKitty,
  applyContinueAfterTrick,
  applyEndRoundEarly,
  applyNameTrump,
  applyPass,
  applyPlayCard,
  FOUR_P_SEAT_ORDER,
  type FourPlayerGameState,
} from './fourPlayerReducer'

export function NetworkedFourPlayerGame({
  roomCode,
  clientId,
  onLeave,
  onReturnToLobby,
}: {
  roomCode: string
  clientId: string
  onLeave: () => void
  /** See the identical prop on NetworkedTwoPlayerGame — Firestore's room.status
   *  flipping back to 'lobby' doesn't by itself move App.tsx's local `screen` state. */
  onReturnToLobby: () => void
}) {
  const [room, setRoom] = useState<(RoomDoc & { code: string }) | null | undefined>(undefined)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'forfeit' | 'restart' | null>(null)
  const [trackPlayed, setTrackPlayed] = useState(false)
  // See the identical field on NetworkedTwoPlayerGame for why this exists — instant
  // local prediction instead of waiting on the Firestore round trip for every action.
  const [pendingGame, setPendingGame] = useState<FourPlayerGameState | null>(null)

  useEffect(() => subscribeToRoom(roomCode, setRoom), [roomCode])

  useEffect(() => {
    if (room?.status === 'lobby') onReturnToLobby()
  }, [room?.status, onReturnToLobby])

  useEffect(() => {
    setPendingGame(null)
  }, [room?.game4p])

  if (room === undefined) {
    return (
      <div className="game">
        <p className="turn-banner">Loading game…</p>
      </div>
    )
  }

  if (room === null) {
    return (
      <div className="game">
        <section className="panel">
          <p className="error">Room {roomCode} no longer exists.</p>
          <button type="button" className="pill-btn" onClick={onLeave}>
            ← Back to menu
          </button>
        </section>
      </div>
    )
  }

  const myPlayerId: PlayerId | null = FOUR_P_SEAT_ORDER.find((seat) => room.seats[seat]?.clientId === clientId) ?? null
  const spectators = Object.values(room.spectators ?? {})
  const watchingLine = spectators.length > 0 ? `👀 Watching: ${spectators.map((s) => s.name).join(', ')}` : null

  if (!myPlayerId) {
    if (!room.spectators?.[clientId]) {
      return (
        <div className="game">
          <section className="panel">
            <p className="error">You're not a player in this room.</p>
            <button type="button" className="pill-btn" onClick={onLeave}>
              ← Back to menu
            </button>
          </section>
        </div>
      )
    }

    if (!room.game4p) {
      return (
        <div className="game">
          <p className="turn-banner">Waiting for the game to start…</p>
        </div>
      )
    }

    return (
      <div className="game">
        <header className="game-header">
          <div className="title-row">
            <h1>Trumps</h1>
          </div>
          <div className="header-badges">
            <p className="badge-pixel">ROOM {room.code} · SPECTATING</p>
            {watchingLine && <p className="badge-soft">{watchingLine}</p>}
          </div>
        </header>

        <SpectatorView4P state={room.game4p} />

        <button
          type="button"
          className="pill-btn"
          onClick={() => {
            leaveSpectator(roomCode, clientId).catch(() => {})
            onLeave()
          }}
        >
          ← Leave
        </button>
      </div>
    )
  }

  if (!room.game4p) {
    return (
      <div className="game">
        <p className="turn-banner">Waiting for the game to start…</p>
      </div>
    )
  }

  if (room.status === 'ended') {
    const endedByName = room.endedBy ? room.game4p.names[room.endedBy] : 'A player'
    return (
      <div className="game">
        <section className="panel result-panel">
          <h2>Match ended</h2>
          <p>{endedByName} ended the match early.</p>
          <div className="button-row">
            <button
              type="button"
              className="pill-btn primary"
              onClick={() => restartMatch4P(roomCode).catch((err) => setError(String(err)))}
            >
              🔄 Play again
            </button>
            <button type="button" className="pill-btn" onClick={onLeave}>
              ← Back to menu
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    )
  }

  const game = pendingGame ?? room.game4p

  function act(compute: (s: FourPlayerGameState) => FourPlayerGameState) {
    setError(null)
    try {
      setPendingGame(compute(game))
    } catch {
      // fall through to the real attempt, whose rejection reports the real error
    }
    applyGameAction4P(roomCode, compute).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
      setPendingGame(null)
    })
  }

  function handleForfeit() {
    setConfirming(null)
    setError(null)
    endMatch(roomCode, myPlayerId as PlayerId).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  function handleRestart() {
    setConfirming(null)
    setError(null)
    restartMatch4P(roomCode).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  return (
    <div className="game">
      <header className="game-header">
        <div className="title-row">
          <h1>Trumps</h1>
          <button type="button" className="pill-btn" onClick={() => setRulesOpen(true)}>
            📖 Rules
          </button>
          {room.trackPlayedCardsEnabled && (
            <button type="button" className={`pill-btn ${trackPlayed ? 'primary' : ''}`} onClick={() => setTrackPlayed((v) => !v)}>
              👁 {trackPlayed ? 'Hide' : ''} Played Cards
            </button>
          )}
        </div>
        <div className="header-badges">
          <p className="badge-pixel">
            ROOM {room.code} · ROUND {game.round} · YOU ARE {game.names[myPlayerId].toUpperCase()}
          </p>
          {watchingLine && <p className="badge-soft">{watchingLine}</p>}
        </div>
      </header>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} mode="4p" />

      {error && <p className="error">{error}</p>}

      {room.trackPlayedCardsEnabled && trackPlayed && <PlayedCardsPanel state={game} />}

      {game.phase === 'bidding' && (
        <BiddingView4P
          state={game}
          viewerPlayerId={myPlayerId}
          onBid={(number: number, mode: Mode) => act((s) => applyBid(s, number, mode))}
          onPass={() => act(applyPass)}
        />
      )}
      {game.phase === 'trump' && (
        <TrumpView4P
          state={game}
          viewerPlayerId={myPlayerId}
          onNameTrump={(suit: Suit) => act((s) => applyNameTrump(s, suit))}
        />
      )}
      {game.phase === 'kitty' && (
        <KittyView4P
          state={game}
          viewerPlayerId={myPlayerId}
          onConfirm={(discard: Card[], take: Card[]) => act((s) => applyConfirmKitty(s, discard, take))}
        />
      )}
      {game.phase === 'trick' && (
        <TrickView4P
          state={game}
          viewerPlayerId={myPlayerId}
          onPlayCard={(card: Card) => act((s) => applyPlayCard(s, myPlayerId, card))}
          onContinue={() => act(applyContinueAfterTrick)}
          onEndEarly={() => act(applyEndRoundEarly)}
        />
      )}
      {game.phase === 'round-end' && (
        <RoundEndView4P
          state={game}
          onReturnToLobby={() => returnToLobby(roomCode).catch((err) => setError(err instanceof Error ? err.message : String(err)))}
        />
      )}

      <div className="button-row match-controls">
        <button type="button" className="pill-btn" onClick={onLeave}>
          ← Leave game
        </button>
        <button type="button" className="pill-btn" onClick={() => setConfirming('restart')}>
          🔄 Restart match
        </button>
        <button type="button" className="pill-btn danger" onClick={() => setConfirming('forfeit')}>
          🏳 Forfeit match
        </button>
      </div>

      <ConfirmModal
        open={confirming === 'forfeit'}
        title="Forfeit the match?"
        body="This will end the match for both teams right now — everyone will be returned to the main menu. This can't be undone."
        confirmLabel="Forfeit match"
        onConfirm={handleForfeit}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmModal
        open={confirming === 'restart'}
        title="Restart the match?"
        body="This will reset the match back to round 1 for everyone — current scores and progress are lost. You'll stay in the same room."
        confirmLabel="Restart match"
        onConfirm={handleRestart}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}

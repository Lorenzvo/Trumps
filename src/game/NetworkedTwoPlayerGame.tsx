// Networked 2P game screen: same views as the local hot-seat build, but
// `viewerPlayerId` is your fixed seat (from the room doc) rather than whoever can
// currently act — so you only ever see your own hand, and action controls simply
// don't render on your screen when it's not your turn. State lives in Firestore;
// every action goes through a transaction (see firebase/gameSync.ts) instead of
// local setState.

import { useEffect, useState } from 'react'
import type { Card, Mode, PlayerId, Suit } from '../engine'
import { applyGameAction } from '../firebase/gameSync'
import { fromFirestoreGame } from '../firebase/gameSerialize'
import { endMatch, restartMatch, returnToLobby, subscribeToRoom, type RoomDoc } from '../firebase/rooms'
import {
  BiddingView,
  ConfirmModal,
  DrawPhaseView,
  KittyView,
  PlayedCardsPanel,
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
  type TwoPlayerGameState,
} from './twoPlayerReducer'

export function NetworkedTwoPlayerGame({
  roomCode,
  clientId,
  onLeave,
  onReturnToLobby,
}: {
  roomCode: string
  clientId: string
  onLeave: () => void
  /** Firestore's room.status flipping back to 'lobby' (via RoundEndView's "change
   *  seats" button) doesn't by itself move App.tsx's local `screen` state off
   *  'game' — this is how that gets signaled back up, mirroring Lobby's own
   *  onStart callback for the opposite transition. */
  onReturnToLobby: () => void
}) {
  const [room, setRoom] = useState<(RoomDoc & { code: string }) | null | undefined>(undefined)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'forfeit' | 'restart' | null>(null)
  // Whether the played-cards *feature* even exists this match is the host's lobby
  // setting (room.trackPlayedCardsEnabled). This is just whether the panel happens
  // to be open right now — purely local, each player opens/closes their own view.
  const [trackPlayed, setTrackPlayed] = useState(false)

  useEffect(() => subscribeToRoom(roomCode, setRoom), [roomCode])

  useEffect(() => {
    if (room?.status === 'lobby') onReturnToLobby()
  }, [room?.status, onReturnToLobby])

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

  const myPlayerId: PlayerId | null =
    room.seats.p1?.clientId === clientId ? 'p1' : room.seats.p2?.clientId === clientId ? 'p2' : null

  if (!myPlayerId) {
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

  if (!room.game) {
    return (
      <div className="game">
        <p className="turn-banner">Waiting for the game to start…</p>
      </div>
    )
  }

  if (room.status === 'ended') {
    const endedByName = room.endedBy ? room.game.names[room.endedBy] : 'A player'
    return (
      <div className="game">
        <section className="panel result-panel">
          <h2>Match ended</h2>
          <p>{endedByName} ended the match early.</p>
          <div className="button-row">
            <button type="button" className="pill-btn primary" onClick={() => restartMatch(roomCode).catch((err) => setError(String(err)))}>
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

  const game = fromFirestoreGame(room.game)

  function act(compute: (s: TwoPlayerGameState) => TwoPlayerGameState) {
    setError(null)
    applyGameAction(roomCode, compute).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
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
    restartMatch(roomCode).catch((err) => {
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
        <p className="badge-pixel">
          ROOM {room.code} · ROUND {game.round} · YOU ARE {game.names[myPlayerId].toUpperCase()}
        </p>
      </header>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {error && <p className="error">{error}</p>}

      {room.trackPlayedCardsEnabled && trackPlayed && <PlayedCardsPanel state={game} />}

      {game.phase === 'draw' && (
        <DrawPhaseView
          state={game}
          viewerPlayerId={myPlayerId}
          onDraw={() => act(applyDrawCard)}
          onResolve={(decision) => act((s) => applyResolveDraw(s, decision))}
        />
      )}
      {game.phase === 'bidding' && (
        <BiddingView
          state={game}
          viewerPlayerId={myPlayerId}
          onBid={(number: number, mode: Mode) => act((s) => applyBid(s, number, mode))}
          onPass={() => act(applyPass)}
        />
      )}
      {game.phase === 'trump' && (
        <TrumpView
          state={game}
          viewerPlayerId={myPlayerId}
          onNameTrump={(suit: Suit) => act((s) => applyNameTrump(s, suit))}
        />
      )}
      {game.phase === 'kitty' && (
        <KittyView
          state={game}
          viewerPlayerId={myPlayerId}
          onConfirm={(discard: Card[], take: Card[]) => act((s) => applyConfirmKitty(s, discard, take))}
        />
      )}
      {game.phase === 'trick' && (
        <TrickView
          state={game}
          viewerPlayerId={myPlayerId}
          onPlayCard={(card: Card) => act((s) => applyPlayCard(s, myPlayerId, card))}
          onContinue={() => act(applyContinueAfterTrick)}
          onEndEarly={() => act(applyEndRoundEarly)}
        />
      )}
      {game.phase === 'round-end' && (
        <RoundEndView
          state={game}
          onNextRound={() => act(applyNextRound)}
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
        body="This will end the match for both players right now — you'll both be returned to the main menu. This can't be undone."
        confirmLabel="Forfeit match"
        onConfirm={handleForfeit}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmModal
        open={confirming === 'restart'}
        title="Restart the match?"
        body="This will reset the match back to round 1 for both players — current scores and progress are lost. You'll stay in the same room."
        confirmLabel="Restart match"
        onConfirm={handleRestart}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}

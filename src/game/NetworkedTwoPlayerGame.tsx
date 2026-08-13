// Networked 2P game screen: same views as the local hot-seat build, but
// `viewerPlayerId` is your fixed seat (from the room doc) rather than whoever can
// currently act — so you only ever see your own hand, and action controls simply
// don't render on your screen when it's not your turn. State lives in Firestore;
// every action goes through a transaction (see firebase/gameSync.ts) instead of
// local setState.

import { useEffect, useState } from 'react'
import type { Card, Mode, PlayerId, Suit } from '../engine'
import { applyGameAction } from '../firebase/gameSync'
import { subscribeToRoom, type RoomDoc } from '../firebase/rooms'
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
  type TwoPlayerGameState,
} from './twoPlayerReducer'

export function NetworkedTwoPlayerGame({
  roomCode,
  clientId,
  onLeave,
}: {
  roomCode: string
  clientId: string
  onLeave: () => void
}) {
  const [room, setRoom] = useState<(RoomDoc & { code: string }) | null | undefined>(undefined)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribeToRoom(roomCode, setRoom), [roomCode])

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

  const game = room.game

  function act(compute: (s: TwoPlayerGameState) => TwoPlayerGameState) {
    setError(null)
    applyGameAction(roomCode, compute).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
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
          ROOM {room.code} · ROUND {game.round} · YOU ARE {game.names[myPlayerId].toUpperCase()}
        </p>
      </header>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {error && <p className="error">{error}</p>}

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
      {game.phase === 'round-end' && <RoundEndView state={game} onNextRound={() => act(applyNextRound)} />}

      <button type="button" className="pill-btn" onClick={onLeave}>
        ← Leave game
      </button>
    </div>
  )
}

// Waiting room: shows who's joined, syncs live via Firestore. Host starts once full.

import { useEffect, useState } from 'react'
import type { RoomDoc } from '../firebase/rooms'
import { startGame, subscribeToRoom } from '../firebase/rooms'
import './Menu.css'

const SEAT_ORDER: Record<'2p' | '4p', string[]> = {
  '2p': ['p1', 'p2'],
  '4p': ['blue1', 'red1', 'blue2', 'red2'],
}

export function Lobby({
  roomCode,
  clientId,
  onStart,
  onLeave,
}: {
  roomCode: string
  clientId: string
  onStart: () => void
  onLeave: () => void
}) {
  const [room, setRoom] = useState<(RoomDoc & { code: string }) | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeToRoom(roomCode, setRoom)
    return unsubscribe
  }, [roomCode])

  useEffect(() => {
    if (room?.status === 'playing') onStart()
  }, [room?.status, onStart])

  if (room === undefined) {
    return (
      <div className="game menu-screen">
        <p className="turn-banner">Loading room…</p>
      </div>
    )
  }

  if (room === null) {
    return (
      <div className="game menu-screen">
        <section className="panel">
          <p className="error">Room {roomCode} no longer exists.</p>
          <button type="button" className="pill-btn" onClick={onLeave}>
            ← Back to menu
          </button>
        </section>
      </div>
    )
  }

  const code = room.code
  const order = SEAT_ORDER[room.mode]
  const isHost = room.hostClientId === clientId
  const isFull = order.every((seat) => room.seats[seat])

  async function handleStart() {
    setError(null)
    try {
      await startGame(roomCode)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="game menu-screen">
      <header className="game-header">
        <h1>🂡 Lobby</h1>
      </header>

      <section className="panel room-code-panel">
        <p className="hint">Share this code with your friend:</p>
        <div className="room-code-display" onClick={handleCopy} title="Click to copy">
          {room.code}
        </div>
        <p className="hint">{copied ? 'Copied!' : 'Click the code to copy it'}</p>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Players</h2>
        <ul className="seat-list">
          {order.map((seat) => {
            const occupant = room.seats[seat]
            return (
              <li key={seat} className={occupant ? 'seat-filled' : 'seat-empty'}>
                {occupant ? occupant.name : 'Waiting for player…'}
                {occupant?.clientId === room.hostClientId && <span className="badge-pixel host-badge">HOST</span>}
              </li>
            )
          })}
        </ul>

        {isHost ? (
          <button type="button" className="pill-btn primary" onClick={handleStart} disabled={!isFull}>
            {isFull ? 'Start game' : 'Waiting for players…'}
          </button>
        ) : (
          <p className="hint">Waiting for the host to start the game…</p>
        )}
      </section>

      <button type="button" className="pill-btn" onClick={onLeave}>
        ← Leave
      </button>
    </div>
  )
}

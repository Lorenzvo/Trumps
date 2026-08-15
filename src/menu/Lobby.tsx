// Waiting room: shows who's joined, syncs live via Firestore. Host starts once full.

import { useEffect, useState } from 'react'
import type { RoomDoc } from '../firebase/rooms'
import {
  becomeSpectator,
  claimSeat,
  continueToNextRound,
  dealFourPRound,
  rollDice4P,
  setPendingOpener4P,
  setTeamMode4P,
  setTrackPlayedCards,
  startDiceRoll4P,
  startGame,
  subscribeToRoom,
} from '../firebase/rooms'
import './Menu.css'

const SEAT_ORDER: Record<'2p' | '4p', string[]> = {
  '2p': ['p1', 'p2'],
  '4p': ['blue1', 'red1', 'blue2', 'red2'],
}

function seatTeamClass(seat: string): string | undefined {
  return seat.startsWith('blue') ? 'team-blue' : seat.startsWith('red') ? 'team-red' : undefined
}

export function Lobby({
  roomCode,
  clientId,
  onStart,
  onLeave,
}: {
  roomCode: string
  clientId: string
  /** Reports the room's mode back up so App.tsx knows which networked game screen to
   *  render — it doesn't otherwise have a live subscription of its own to read this
   *  from before the game screen mounts. */
  onStart: (mode: RoomDoc['mode']) => void
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
    if (room?.status === 'playing') onStart(room.mode)
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
  const hostName = Object.values(room.seats).find((seat) => seat?.clientId === room.hostClientId)?.name ?? 'the host'
  // room.game/game4p surviving into a 'lobby' room (rather than being absent) means
  // this is a rotation stop between rounds, not the very first setup — see
  // returnToLobby.
  const isBetweenRounds = room.mode === '4p' ? Boolean(room.game4p) : Boolean(room.game)
  const spectators = Object.values(room.spectators ?? {})
  const isSpectating = Boolean(room.spectators?.[clientId])
  const openSeats = order.filter((seat) => !room.seats[seat])
  const teamMode4p = room.teamMode4p ?? 'manual'

  async function handleRollDice() {
    setError(null)
    try {
      await rollDice4P(roomCode, clientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Dice rolling replaces the whole lobby body while it's in progress — a distinct,
  // focused screen rather than one more section bolted onto the normal seat list.
  if (room.mode === '4p' && room.diceRollActive4p) {
    const rolls = room.diceRolls4p ?? {}
    const myRoll = rolls[clientId]
    return (
      <div className="game menu-screen">
        <header className="game-header">
          <h1>🎲 Rolling for teams</h1>
        </header>
        <section className="panel">
          <p className="hint">
            Highest roll opens and leads; 1st &amp; 3rd end up teamed, 2nd &amp; 4th end up teamed. Ties re-roll
            automatically.
          </p>
          <ul className="seat-list">
            {SEAT_ORDER['4p'].map((seat) => {
              const occupant = room.seats[seat]
              if (!occupant) return null
              const roll = rolls[occupant.clientId]
              return (
                <li key={seat} className={roll !== undefined ? 'seat-filled' : 'seat-empty'}>
                  {occupant.name} {roll !== undefined ? `— rolled ${roll}` : '— waiting to roll…'}
                </li>
              )
            })}
          </ul>
          {myRoll === undefined ? (
            <button type="button" className="pill-btn primary" onClick={handleRollDice}>
              🎲 Roll the dice
            </button>
          ) : (
            <p className="hint">You rolled {myRoll}. Waiting on the others…</p>
          )}
        </section>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  async function handleStart() {
    setError(null)
    try {
      if (room?.mode === '4p') {
        if (teamMode4p === 'dice') await startDiceRoll4P(roomCode, clientId)
        else await dealFourPRound(roomCode)
      } else if (isBetweenRounds) {
        await continueToNextRound(roomCode)
      } else {
        await startGame(roomCode)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSetTeamMode(mode: 'manual' | 'dice') {
    setError(null)
    try {
      await setTeamMode4P(roomCode, clientId, mode)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSetOpener(seat: string) {
    setError(null)
    try {
      await setPendingOpener4P(roomCode, clientId, seat)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function handleToggleTrackPlayed() {
    setError(null)
    try {
      await setTrackPlayedCards(roomCode, clientId, !room?.trackPlayedCardsEnabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleBecomeSpectator() {
    setError(null)
    try {
      await becomeSpectator(roomCode, clientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleClaimSeat(seat: string) {
    setError(null)
    try {
      await claimSeat(roomCode, seat, clientId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="game menu-screen">
      <header className="game-header">
        <h1>Lobby</h1>
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
        {isBetweenRounds && (
          <p className="hint">
            Round {(room.mode === '4p' ? room.game4p!.round : room.game!.round)} just finished — pick your seats for the next
            one.
          </p>
        )}
        <ul className="seat-list">
          {order.map((seat) => {
            const occupant = room.seats[seat]
            return (
              <li key={seat} className={occupant ? 'seat-filled' : 'seat-empty'}>
                <span className={room.mode === '4p' ? seatTeamClass(seat) : undefined}>
                  {occupant ? occupant.name : 'Waiting for player…'}
                </span>
                {occupant?.clientId === room.hostClientId && <span className="badge-pixel host-badge">HOST</span>}
                {occupant?.clientId === clientId && (
                  <button type="button" className="link-btn" onClick={handleBecomeSpectator}>
                    Spectate instead
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {room.mode === '4p' && (
          <div className="team-mode-controls">
            <p className="hint">Team assignment:</p>
            <div className="button-row">
              <button
                type="button"
                className={`pill-btn ${teamMode4p === 'manual' ? 'primary' : ''}`}
                disabled={!isHost}
                onClick={() => handleSetTeamMode('manual')}
              >
                Manual
              </button>
              <button
                type="button"
                className={`pill-btn ${teamMode4p === 'dice' ? 'primary' : ''}`}
                disabled={!isHost}
                onClick={() => handleSetTeamMode('dice')}
              >
                🎲 Randomize
              </button>
            </div>
            {!isHost && <p className="hint">Only {hostName} can change this.</p>}

            {teamMode4p === 'manual' && isFull && (
              <div className="opener-picker">
                <p className="hint">Who opens this round?</p>
                <div className="button-row">
                  {order.map((seat) => (
                    <button
                      type="button"
                      key={seat}
                      className={`pill-btn ${room.pendingOpener4p === seat ? 'primary' : ''}`}
                      disabled={!isHost}
                      onClick={() => handleSetOpener(seat)}
                    >
                      {room.seats[seat]?.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isHost ? (
          <button
            type="button"
            className="pill-btn primary"
            onClick={handleStart}
            disabled={!isFull || (room.mode === '4p' && teamMode4p === 'manual' && !room.pendingOpener4p)}
          >
            {!isFull
              ? 'Waiting for players…'
              : room.mode === '4p' && teamMode4p === 'dice'
                ? '🎲 Roll for teams'
                : isBetweenRounds
                  ? 'Start next round'
                  : 'Start game'}
          </button>
        ) : (
          <p className="hint">
            Waiting for the host to{' '}
            {room.mode === '4p' && teamMode4p === 'dice' ? 'start the dice roll' : isBetweenRounds ? 'start the next round' : 'start the game'}
            …
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Spectators</h2>
        {spectators.length === 0 ? (
          <p className="hint">Nobody's watching yet — share the room code with anyone who wants to.</p>
        ) : (
          <ul className="seat-list">
            {spectators.map((s) => (
              <li key={s.clientId} className="seat-filled">
                {s.name}
              </li>
            ))}
          </ul>
        )}
        {isSpectating && (
          <div className="button-row">
            {openSeats.length === 0 ? (
              <p className="hint">All seats are taken — wait for someone to step down.</p>
            ) : (
              openSeats.map((seat) => (
                <button type="button" key={seat} className="pill-btn secondary" onClick={() => handleClaimSeat(seat)}>
                  Join as {seat.toUpperCase()}
                </button>
              ))
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Match settings</h2>
        <label className={`setting-toggle ${isHost ? '' : 'setting-toggle-readonly'}`}>
          <input
            type="checkbox"
            checked={room.trackPlayedCardsEnabled ?? false}
            disabled={!isHost}
            onChange={isHost ? handleToggleTrackPlayed : undefined}
          />
          <span className="setting-toggle-slider" aria-hidden="true" />
          <span>
            Track played cards
            <span className="hint"> — lets everyone open a list of cards already played this round.</span>
          </span>
        </label>
        {!isHost && <p className="hint">Only {hostName} can change this.</p>}
      </section>

      <button type="button" className="pill-btn" onClick={onLeave}>
        ← Leave
      </button>
    </div>
  )
}

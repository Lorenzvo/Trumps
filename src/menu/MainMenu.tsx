// Landing screen: create a room or join one by code. Arriving via a shared invite
// link (?room=CODE) skips straight to a focused "join this room" prompt instead of
// the full create-or-join layout — name + Enter is all it takes.
//
// Reuses the pill-btn/panel/badge-pixel utility classes from game/TwoPlayerGame.css
// (loaded globally since App.tsx always imports that module) rather than redefining
// them here.

import { useState } from 'react'
import type { GameMode } from '../firebase/rooms'
import { createRoom, joinRoom } from '../firebase/rooms'
import './Menu.css'

const NAME_STORAGE_KEY = 'trumps-player-name'

export function MainMenu({
  clientId,
  initialRoomCode,
  onEntered,
  onPractice,
  onPractice4p,
}: {
  clientId: string
  initialRoomCode?: string
  onEntered: (roomCode: string) => void
  onPractice: () => void
  onPractice4p: () => void
}) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_STORAGE_KEY) ?? '')
  const [mode, setMode] = useState<GameMode>('2p')
  const [joinCode, setJoinCode] = useState('')
  const [invite, setInvite] = useState(initialRoomCode ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function rememberName(n: string) {
    setName(n)
    localStorage.setItem(NAME_STORAGE_KEY, n)
  }

  async function handleCreate() {
    if (!name.trim()) return setError('Enter a name first')
    setBusy(true)
    setError(null)
    try {
      const code = await createRoom(mode, name.trim(), clientId)
      onEntered(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin(code: string) {
    if (!name.trim()) return setError('Enter a name first')
    if (!code.trim()) return setError('Enter a room code')
    setBusy(true)
    setError(null)
    try {
      await joinRoom(code.trim(), name.trim(), clientId)
      onEntered(code.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (invite) {
    return (
      <div className="game menu-screen">
        <header className="game-header">
          <h1>🂡 Trumps</h1>
        </header>

        {error && <p className="error">{error}</p>}

        <section className="panel menu-card invite-card">
          <h2>Join room {invite}</h2>
          <input
            type="text"
            className="text-input"
            value={name}
            onChange={(e) => rememberName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin(invite)}
            placeholder="Your name"
            maxLength={24}
            autoFocus
          />
          <button type="button" className="pill-btn primary" onClick={() => handleJoin(invite)} disabled={busy}>
            Join
          </button>
          <p className="hint">
            <button type="button" className="link-btn" onClick={() => setInvite(null)}>
              Not this room? Go to the main menu
            </button>
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="game menu-screen">
      <header className="game-header">
        <h1>🂡 Trumps</h1>
        <p className="badge-pixel">A BIDDING TRICK-TAKING CARD GAME</p>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>Your name</h2>
        <input
          type="text"
          className="text-input"
          value={name}
          onChange={(e) => rememberName(e.target.value)}
          placeholder="e.g. Lorenzo"
          maxLength={24}
        />
      </section>

      <div className="menu-columns">
        <section className="panel menu-card">
          <h2>Create a room</h2>
          <div className="button-row mode-toggle">
            <button
              type="button"
              className={`pill-btn ${mode === '2p' ? 'primary' : ''}`}
              onClick={() => setMode('2p')}
            >
              2 Players
            </button>
            <button
              type="button"
              className={`pill-btn ${mode === '4p' ? 'primary' : ''}`}
              onClick={() => setMode('4p')}
              disabled
              title="4-player rooms are coming soon"
            >
              4 Players (soon)
            </button>
          </div>
          <button type="button" className="pill-btn primary" onClick={handleCreate} disabled={busy}>
            Create room
          </button>
        </section>

        <section className="panel menu-card">
          <h2>Join a room</h2>
          <input
            type="text"
            className="text-input room-code-input"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin(joinCode)}
            placeholder="ROOM CODE"
            maxLength={5}
          />
          <button type="button" className="pill-btn secondary" onClick={() => handleJoin(joinCode)} disabled={busy}>
            Join room
          </button>
        </section>
      </div>

      <p className="hint">
        <button type="button" className="link-btn" onClick={onPractice}>
          Try 2P practice mode
        </button>
        {' · '}
        <button type="button" className="link-btn" onClick={onPractice4p}>
          Try 4P practice mode
        </button>
        {' '}(local, no room needed)
      </p>
    </div>
  )
}

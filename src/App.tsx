import { useEffect, useMemo, useState } from 'react'
import { getClientId } from './firebase/clientId'
import { getRoomOnce, isSeated } from './firebase/rooms'
import { FourPlayerGame } from './game/FourPlayerGame'
import { NetworkedTwoPlayerGame } from './game/NetworkedTwoPlayerGame'
import { TwoPlayerGame } from './game/TwoPlayerGame'
import { Lobby } from './menu/Lobby'
import { MainMenu } from './menu/MainMenu'

type Screen = 'resolving' | 'menu' | 'lobby' | 'game' | 'practice' | 'practice4p'

const LAST_ROOM_KEY = 'trumps-last-room'

function roomCodeFromUrl(): string | undefined {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() || undefined
}

function setRoomInUrl(code: string | null) {
  const url = new URL(window.location.href)
  if (code) url.searchParams.set('room', code)
  else url.searchParams.delete('room')
  window.history.replaceState({}, '', url)
}

function App() {
  const clientId = useMemo(() => getClientId(), [])
  const [screen, setScreen] = useState<Screen>('resolving')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const initialRoomCode = useMemo(roomCodeFromUrl, [])

  // On load (including a refresh, or reopening a closed tab): if we know a room —
  // from the URL (an invite link) or from localStorage (our last session) — and
  // we're already seated there under our stable clientId, resume straight into it
  // instead of routing through the join-by-name flow, which would otherwise reject
  // a returning player once the game has left the lobby.
  useEffect(() => {
    let cancelled = false

    async function resolve() {
      const target = roomCodeFromUrl() ?? localStorage.getItem(LAST_ROOM_KEY)
      if (!target) {
        setScreen('menu')
        return
      }
      try {
        const room = await getRoomOnce(target)
        if (cancelled) return
        if (room && isSeated(room, clientId)) {
          setRoomCode(target)
          localStorage.setItem(LAST_ROOM_KEY, target)
          setRoomInUrl(target)
          setScreen(room.status === 'playing' ? 'game' : 'lobby')
        } else {
          localStorage.removeItem(LAST_ROOM_KEY)
          setScreen('menu')
        }
      } catch {
        if (!cancelled) setScreen('menu')
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
    // Runs once on mount only — this is a one-time "where was I" check, not a
    // reactive subscription (Lobby/NetworkedTwoPlayerGame own the live one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleEntered(code: string) {
    setRoomCode(code)
    localStorage.setItem(LAST_ROOM_KEY, code)
    setRoomInUrl(code)
    setScreen('lobby')
  }

  function handleLeave() {
    setRoomCode(null)
    localStorage.removeItem(LAST_ROOM_KEY)
    setRoomInUrl(null)
    setScreen('menu')
  }

  if (screen === 'resolving') {
    return (
      <div className="game">
        <p className="turn-banner">Loading…</p>
      </div>
    )
  }

  if (screen === 'practice') {
    return (
      <div className="practice-shell">
        <div className="practice-bar">
          <button type="button" className="pill-btn" onClick={() => setScreen('menu')}>
            ← Back to menu
          </button>
          <span className="badge-pixel">PRACTICE MODE · LOCAL HOT-SEAT</span>
        </div>
        <TwoPlayerGame />
      </div>
    )
  }

  if (screen === 'practice4p') {
    return (
      <div className="practice-shell">
        <div className="practice-bar">
          <button type="button" className="pill-btn" onClick={() => setScreen('menu')}>
            ← Back to menu
          </button>
          <span className="badge-pixel">4P PRACTICE MODE · LOCAL HOT-SEAT</span>
        </div>
        <FourPlayerGame />
      </div>
    )
  }

  if (screen === 'menu') {
    return (
      <MainMenu
        clientId={clientId}
        initialRoomCode={initialRoomCode}
        onEntered={handleEntered}
        onPractice={() => setScreen('practice')}
        onPractice4p={() => setScreen('practice4p')}
      />
    )
  }

  if (screen === 'lobby' && roomCode) {
    return <Lobby roomCode={roomCode} clientId={clientId} onStart={() => setScreen('game')} onLeave={handleLeave} />
  }

  if (roomCode) {
    return <NetworkedTwoPlayerGame roomCode={roomCode} clientId={clientId} onLeave={handleLeave} />
  }

  return (
    <MainMenu
      clientId={clientId}
      onEntered={handleEntered}
      onPractice={() => setScreen('practice')}
      onPractice4p={() => setScreen('practice4p')}
    />
  )
}

export default App

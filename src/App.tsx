import { useMemo, useState } from 'react'
import { getClientId } from './firebase/clientId'
import { NetworkedTwoPlayerGame } from './game/NetworkedTwoPlayerGame'
import { TwoPlayerGame } from './game/TwoPlayerGame'
import { Lobby } from './menu/Lobby'
import { MainMenu } from './menu/MainMenu'

type Screen = 'menu' | 'lobby' | 'game' | 'practice'

function roomCodeFromUrl(): string | undefined {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() || undefined
}

function App() {
  const clientId = useMemo(() => getClientId(), [])
  const [screen, setScreen] = useState<Screen>('menu')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const initialRoomCode = useMemo(roomCodeFromUrl, [])

  function handleEntered(code: string) {
    setRoomCode(code)
    setScreen('lobby')
    const url = new URL(window.location.href)
    url.searchParams.set('room', code)
    window.history.replaceState({}, '', url)
  }

  function handleLeave() {
    setRoomCode(null)
    setScreen('menu')
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState({}, '', url)
  }

  if (screen === 'practice') {
    return (
      <div>
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

  if (screen === 'menu') {
    return (
      <MainMenu
        clientId={clientId}
        initialRoomCode={initialRoomCode}
        onEntered={handleEntered}
        onPractice={() => setScreen('practice')}
      />
    )
  }

  if (screen === 'lobby' && roomCode) {
    return <Lobby roomCode={roomCode} clientId={clientId} onStart={() => setScreen('game')} onLeave={handleLeave} />
  }

  if (roomCode) {
    return <NetworkedTwoPlayerGame roomCode={roomCode} clientId={clientId} onLeave={handleLeave} />
  }

  return <MainMenu clientId={clientId} onEntered={handleEntered} onPractice={() => setScreen('practice')} />
}

export default App

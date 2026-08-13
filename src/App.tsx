import { useMemo, useState } from 'react'
import { getClientId } from './firebase/clientId'
import { TwoPlayerGame } from './game/TwoPlayerGame'
import { Lobby } from './menu/Lobby'
import { MainMenu } from './menu/MainMenu'

type Screen = 'menu' | 'lobby' | 'game'

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

  if (screen === 'menu') {
    return <MainMenu clientId={clientId} initialRoomCode={initialRoomCode} onEntered={handleEntered} />
  }

  if (screen === 'lobby' && roomCode) {
    return <Lobby roomCode={roomCode} clientId={clientId} onStart={() => setScreen('game')} onLeave={handleLeave} />
  }

  // Networked gameplay isn't wired up yet — the room/lobby above is real (Firestore
  // synced), but "Start game" currently drops into the same local hot-seat build from
  // before. Next step: replace this with a Firestore-synced version of the same engine
  // calls, so each client only ever renders its own hand.
  return <TwoPlayerGame />
}

export default App

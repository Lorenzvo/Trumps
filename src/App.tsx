function App() {
  return (
    <main className="placeholder">
      <h1>Trumps</h1>
      <p>
        The game engine (deck, dealing, bidding, trick resolution) lives in{' '}
        <code>src/engine/</code> and is tested independently of the UI — run{' '}
        <code>npm test</code>.
      </p>
      <p>UI comes next: Firestore wiring, hand layout, bidding interface, trick area.</p>
    </main>
  )
}

export default App

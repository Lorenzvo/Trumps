// A stable per-browser identity, persisted in localStorage. There are no user
// accounts (per spec) — this is just "which browser tab is this" so a room document
// can tell players apart and, later, so each client knows which hand is its own.

const STORAGE_KEY = 'trumps-client-id'

function randomId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  // Fallback for older browsers without crypto.randomUUID.
  return Array.from({ length: 20 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
}

export function getClientId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = randomId()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

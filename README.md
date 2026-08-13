# Trumps

A web-based, real-time 2-player or 4-player (2v2) bidding trick-taking card game.
See [`trumps-spec.md`](./trumps-spec.md) for full rules and architecture.

## Stack

- Vite + React + TypeScript
- Vitest for the game engine's unit tests
- Firestore for room/lobby sync (live); gameplay itself is not networked yet

## Game engine

`src/engine/` is the game engine — pure functions and data, no React or Firestore
dependencies, so it can be tested and reasoned about on its own:

| Module | Responsibility |
|---|---|
| `types.ts` | Card, Suit, Rank, Bid, and related domain types |
| `deck.ts` | Building and shuffling a 52-card deck |
| `ranking.ts` | Card strength under High/Low mode |
| `deal.ts` | Kitty set-aside, 4P deal, 2P draw phase (keep/discard flow), kitty exchange |
| `bidding.ts` | Bid comparison, 2P bidding flow, 4P bidding flow |
| `rotation.ts` | Who opens bidding each round: auto-alternate in 2P; host-controlled team seating + opener in 4P |
| `tricks.ts` | Legal-move enforcement and trick resolution |
| `round.ts` | Win condition and the early-clinch rule |

Import everything from `src/engine/index.ts` rather than reaching into individual
modules.

## Multiplayer

`src/firebase/` holds the Firestore layer: `config.ts` (init, from `.env.local` — copy
`.env.example`), `clientId.ts` (per-browser identity, no accounts), `rooms.ts`
(create/join/subscribe/start), and `firestore.rules` (paste into the Firebase console's
Rules tab manually — no CLI deploy wired up yet).

`src/menu/` is the room UI: `MainMenu` (name, create-or-join) and `Lobby` (live seat
list, host-gated Start button, shareable room code via a `?room=` URL param).

## Commands

```bash
npm run dev        # start the dev server
npm test           # run the engine test suite once
npm run test:watch # run tests in watch mode
npm run build       # typecheck + production build
npm run lint         # oxlint
```

## Status

Engine core (deck, dealing, bidding, trick resolution, win condition, kitty exchange)
is built and tested. Menu → create/join room → live lobby is wired to Firestore and
real-time across devices. Once a host starts the game, it currently drops into
`src/game/TwoPlayerGame.tsx` — a full 2P game loop, but still local hot-seat (not yet
reading/writing the room's Firestore doc). That's the next piece: replace
`TwoPlayerGame`'s local `useState` with a synced version so play itself is networked.
4P mode and pixel art are still untouched. See `trumps-spec.md` §3 for the build plan.

### Known gaps / backlog

- **Networked gameplay:** the biggest remaining piece — wire `TwoPlayerGame`'s engine
  calls through the room's Firestore document instead of local state, so two separate
  devices can actually play against each other, not just share a lobby.
- **Real hand privacy:** once gameplay is networked, this mostly falls out for free —
  each client only ever needs to read its own hand plus public state, so there's no
  more "whoever's turn it is" hack. Until then, `TwoPlayerGame` still shows/hides hands
  by turn as a presentation-layer stand-in.
- **Card draw animation:** working (CSS pop-in on every new card), could still use a
  more literal "flies from the pile" motion path rather than pop-in-place.
- **Visual design:** Baloo 2 / Silkscreen + a warm color system is in place; pixel-art
  card sprites per `trumps-spec.md` §2/Day 5 are still not started.
- **4-player mode:** engine supports it (bidding, rotation, dealing); room creation
  explicitly rejects `'4p'` for now (`createRoom` throws) until 2P is fully networked.

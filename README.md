# Trumps

A web-based, real-time 2-player or 4-player (2v2) bidding trick-taking card game.
See [`trumps-spec.md`](./trumps-spec.md) for full rules and architecture.

## Stack

- Vite + React + TypeScript
- Vitest for the game engine's unit tests
- Firestore for state sync (not wired up yet)

## Game engine

`src/engine/` is the game engine — pure functions and data, no React or Firestore
dependencies, so it can be tested and reasoned about on its own:

| Module | Responsibility |
|---|---|
| `types.ts` | Card, Suit, Rank, Bid, and related domain types |
| `deck.ts` | Building and shuffling a 52-card deck |
| `ranking.ts` | Card strength under High/Low mode |
| `deal.ts` | Kitty set-aside, 4P deal, 2P draw phase (keep/discard flow) |
| `bidding.ts` | Bid comparison, 2P bidding flow, 4P bidding flow |
| `rotation.ts` | Who opens bidding each round: auto-alternate in 2P; host-controlled team seating + opener in 4P |
| `tricks.ts` | Legal-move enforcement and trick resolution |
| `round.ts` | Win condition and the early-clinch rule |

Import everything from `src/engine/index.ts` rather than reaching into individual
modules.

## Commands

```bash
npm run dev        # start the dev server
npm test           # run the engine test suite once
npm run test:watch # run tests in watch mode
npm run build       # typecheck + production build
npm run lint         # oxlint
```

## Status

Engine core (deck, dealing, bidding, trick resolution, win condition) is built and
tested. Not yet wired up: Firestore sync, UI, 4P deal/bid-order integration, pixel art.
See `trumps-spec.md` §3 for the build plan.

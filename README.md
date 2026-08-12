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
| `deal.ts` | Kitty set-aside, 4P deal, 2P draw phase (keep/discard flow), kitty exchange |
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

Engine core (deck, dealing, bidding, trick resolution, win condition, kitty exchange)
is built and tested. `src/game/TwoPlayerGame.tsx` is a playable local hot-seat 2P game
wired directly to the engine — draw phase through round end, both hands visible on
screen for easy testing. Not yet wired up: Firestore sync, 4P mode, pixel art.
See `trumps-spec.md` §3 for the build plan.

### Known gaps / backlog (deliberately deferred — barebones functionality first)

- **Hand privacy:** both players' hands are shown on screen right now, on purpose, so
  engine behavior is easy to verify solo. Once this moves to real 2-device play, each
  client should only render its own hand (and the opponent's card-back count).
- **Card draw animation:** when a card is drawn/kept/forced into a hand, it should
  visibly animate from the pile into the hand rather than just appearing — especially
  important for the "forced" card on a discard decision, so it's clearly seen landing.
- **Visual design:** current UI is plain HTML/CSS chips, functional only. Target look
  is pixel-art card sprites per `trumps-spec.md` §2/Day 5 — not started.

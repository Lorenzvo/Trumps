# Trumps

A web-based, real-time 2-player or 4-player (2v2) bidding trick-taking card game.
See [`trumps-spec.md`](./trumps-spec.md) for full rules and architecture.

## Stack

- Vite + React + TypeScript
- Vitest for the game engine's unit tests
- Firestore for room/lobby sync and networked gameplay

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

## Game state layer

`src/game/twoPlayerReducer.ts` holds the 2P game state shape and pure transition
functions (`applyBid`, `applyPlayCard`, etc. — each returns the next state or throws on
an illegal move). `src/game/GameViews.tsx` holds the shared presentational components
(hands, trick area, bidding panel, kitty exchange, rules modal). Both take an explicit
`viewerPlayerId` — the "near"/revealed seat is always that player, "away" is always
face-down. Two thin wrappers consume the same views:

- `TwoPlayerGame.tsx` — local hot-seat/practice mode. `viewerPlayerId` is computed each
  render as whoever can currently act, so hand visibility flips by turn on one screen
  (pass-and-play). State lives in a local `useState`.
- `NetworkedTwoPlayerGame.tsx` — real multiplayer. `viewerPlayerId` is your fixed seat,
  always. State lives in Firestore; actions go through `firebase/gameSync.ts`'s
  transaction instead of local state, so both clients see the same game.

This split means hot-seat and networked play can never drift apart on rules — they run
the exact same `applyX` functions, just fed by different state sources.

`src/game/fourPlayerReducer.ts` + `GameViews4P.tsx` are the 4-seat counterpart, same
shape (no draw phase, per spec; "sides" are teams of 2, so trick counts aggregate by
team via `teamTricks`). `FourPlayerGame.tsx` is a local hot-seat wrapper, same
pass-and-play model as 2P's, reachable from the main menu's practice-mode links.
`NetworkedFourPlayerGame.tsx` is the networked counterpart, mirroring
`NetworkedTwoPlayerGame.tsx`'s contract.

## Multiplayer

`src/firebase/` holds the Firestore layer:
- `config.ts` — init, from `.env.local` (copy `.env.example`)
- `clientId.ts` — per-browser identity, no accounts
- `rooms.ts` — create/join/subscribe/start (`startGame`/`dealFourPRound` deal the first
  round); also team/opener selection and dice-roll resolution for 4P (`setTeamMode4P`,
  `setPendingOpener4P`, `startDiceRoll4P`, `rollDice4P`)
- `gameSync.ts` — `applyGameAction`/`applyGameAction4P`, wraps a game-state transition
  in a Firestore transaction so concurrent writes can't clobber each other
- `firestore.rules` — paste into the Firebase console's Rules tab manually (no CLI
  deploy wired up yet)

`src/menu/` is the room UI: `MainMenu` (name, create-or-join 2P or 4P, or a
practice-mode shortcut) and `Lobby` (live seat list, host-gated Start button, shareable
room code via a `?room=` URL param — opening that link jumps straight to a "join this
room" prompt). Anyone joining a full room becomes a spectator instead (read-only
god's-eye view via `SpectatorView`/`SpectatorView4P`, all hands revealed since there's
nothing to hide from someone already watching); spectators can claim an open seat if
one frees up, or step down from a seat back to spectating.

**4P-specific lobby options:** team assignment is either **Manual** (host picks who
opens each round; teams are fixed by seat — `blue1`/`blue2` vs `red1`/`red2`) or
**Randomize**, where every seated player rolls a 1–10 die (`rollDice4P`); once all four
rolls are in and distinct, the room reseats by rank (highest opens; 1st &amp; 3rd end up
teamed, 2nd &amp; 4th end up teamed) and deals straight in — ties just re-roll. The host
re-picks Manual vs. Randomize fresh every time the room returns to the lobby between
rounds. A host-toggleable "Track played cards" setting (2P and 4P both) lets everyone
open a running list of cards already played this round, grouped by suit.

**Reconnection:** your room is remembered (`localStorage`, keyed off your stable
per-browser `clientId`) and mirrored into the URL's `?room=` param. Refreshing,
reopening a closed tab, or losing connection all resume straight back into the lobby or
game — App.tsx checks "am I already seated here?" on load and skips the join flow
entirely if so, rather than routing through `joinRoom` (which would otherwise reject a
returning player once the game's left the lobby — that ordering bug is fixed too, but
the resume path avoids hitting it in the first place). This only works on the *same*
browser, since there's no account — a different device/browser is a different
`clientId` and can't resume your seat. Clicking "Leave" explicitly clears the saved
room, so it won't try to auto-resume next time.

**Privacy caveat, worth knowing:** Firestore rules are currently wide open
(`allow read, write: if true` on the whole `rooms` collection — see rationale in
`firestore.rules`), and there's no per-seat auth. That means the *UI* never renders your
opponent's hand, but the full room document — both hands included — is technically
sent to both browsers on every sync, inspectable via devtools/network tab. Fine for the
small-friend-group trust model the spec assumes; not a real security boundary. Making
it one would mean splitting hands into per-seat documents/subcollections with rules
that check a real identity, which needs some form of auth (even anonymous) to be
meaningful — not done.

## Commands

```bash
npm run dev        # start the dev server
npm test           # run the engine test suite once
npm run test:watch # run tests in watch mode
npm run build       # typecheck + production build
npm run lint         # oxlint
```

## Status

Engine core is built and tested (84 tests). Menu → create/join room → live lobby →
networked gameplay is wired end-to-end through Firestore for **both 2P and 4P**: draw
phase (2P) / dice-roll team randomization (4P), bidding, trump, kitty exchange, tricks,
round end, next round all read/write the room's synced game document, gated so only the
player whose turn it is can act and only your own hand ever renders face-up.
Spectating, the played-cards toggle, forfeit, and restart all work the same way across
both modes. Local hot-seat "practice mode" exists for both 2P and 4P too, sharing the
same engine/views as the real thing. Pixel-art sprites are still untouched.

Two playtesting-driven polish passes done since the initial visual pass — see git log
for specifics, but notably: the trump/mode/broken indicator is three separate boxes
(colored yes/no for "can lead trump") instead of one bundled string; trick progress and
each side's remaining-tricks-to-win are centered above the table instead of buried in
corner text; hands auto-sort by suit (alternating red/black) and rank on every render;
draw and trick phases (and each phase internally) never resize as content changes —
fixed-height containers instead of shrink-wrapping; only the trick's actual winner can
advance to the next trick, everyone else sees a waiting message.

### Known gaps / backlog

- **Mobile layout, end-to-end on real devices:** verified on desktop viewports across
  2P and 4P (lobby, dice-roll screen, all game phases); not yet walked through on an
  actual phone.
- **Real hand privacy:** Firestore rules are wide open (`allow read, write: if true`
  on `rooms` — see `firestore.rules`), no per-seat auth. The UI never renders your
  opponent's (or in 4P, your partner's kitty view) hand, but the full room document is
  technically sent to every connected browser, inspectable via devtools. Fine for a
  small friend group; not a real security boundary. Fixing it needs per-seat
  documents/subcollections + some form of auth (even anonymous) to check identity
  against.
- **Visual design:** Baloo 2 / Silkscreen + a warm color system, felt table, card
  animations all in place; pixel-art card sprites per `trumps-spec.md` §2/Day 5 are
  still not started.
- **Rules modal mini-animations:** deferred — small animated examples (a card being
  drawn into a hand, a kitty look) using the same components, rather than text-only
  steps. Would help but is more involved than the rest of this list; not started.
- **Simultaneous "Next round" race:** if both players click it within the same instant,
  a round could theoretically get skipped (each transaction advances by one round from
  whatever it reads). Rare in practice, not guarded against.
- **Bundle size:** production build is ~695KB (mostly the Firebase SDK) — fine for now,
  candidate for code-splitting later if it matters.

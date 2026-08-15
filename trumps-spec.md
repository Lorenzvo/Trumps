# Trumps — Game Spec & Build Plan

A web-based, real-time online version of "Trumps," a 2-player or 4-player (2v2) bidding
trick-taking card game. Built for a small friend group, playable from separate devices.

---

## 1. Game Rules

### 1.1 Deck
- Standard 52-card deck, no jokers.
- At the start of a round, **4 truly random cards** are set aside, unseen, as the **kitty**.
  No pattern — any 4 cards, from all one rank to completely mixed.
- The remaining 48 cards go into a face-down **middle pile**.

### 1.2 Setup — 2 Players (draw phase)
- Players alternate turns drawing from the middle pile. On each turn, a player either:
  - **(a)** Keeps the card they just drew, then automatically discards the next card
    face-down/unseen, **or**
  - **(b)** Discards the card they just drew, and is forced to keep whatever the next
    card is, sight unseen at the time of the decision.
- Either path removes exactly 2 cards from the middle pile per turn.
- Continues until each player holds **12 cards**.

### 1.3 Setup — 4 Players (2v2)
- No draw phase. Kitty (4 cards) is set aside the same way, then the remaining 48 cards
  are dealt out randomly, 12 to each of the 4 players.
- Teams are fixed pairs (e.g., Blue1/Blue2 vs Red1/Red2). Partners cannot communicate
  about their hands at any point.

### 1.4 Bidding
- **2P:** The player who drew first must open the bidding (bidding cannot be skipped
  entirely — someone always bids).
- **4P:** Bid order strictly alternates between teams (e.g. Blue1 → Red1 → Blue2 → Red2,
  or Blue1 → Red2 → Blue2 → Red1) — teammates never bid back-to-back.
- Each player gets **up to 2 bids** (2P) or **1 bid** (4P).
- A bid is a number from **2–7** plus a declared mode, **High** or **Low**
  (e.g. "3 Low", "5 High").
  - The bid number means: *if this bid wins, the opposing side must win
    `8 − bid` tricks (out of 12) to win the round.*
  - Bid 7 = opponent needs just 1 trick; bid 2 = opponent needs 6 tricks.
- **Comparing bids:** a higher number always outranks a lower number, regardless of
  High/Low. At equal numbers, **Low outranks High**.
  (Order, weakest → strongest: 2H < 2L < 3H < 3L < 4H < 4L … < 7H < 7L)
- **2P bidding flow:** first bidder opens; second player must either raise
  (bid strictly higher per the ranking above) or pass. A pass immediately awards the
  bid to the other player. Each player may do this up to twice.
- **4P bidding flow:** one bid per player in turn order. Each bid must strictly outrank
  the current highest (same raise rule as 2P) — a player who can't or doesn't want to
  raise passes instead. Highest bid standing at the end wins.
- **Trump suit:** always announced openly to both players/all four players immediately
  once declared — never hidden.
  - Normally, trump must be named **blind** (before seeing the kitty).
  - **Exception:** if the *first* bidder wins the bid on their *very first* call, they
    get to look at the kitty and rearrange their hand **before** naming trump.
- **Kitty exchange:** the winning bidder (in 2P) or winning team's bidder (in 4P) looks
  at the 4 kitty cards and may swap any of them into their hand (discarding the same
  number back out, hand stays at 12). In 4P, the partner does not see this exchange.

### 1.5 Trick Play
- The bid winner (or their team, in 4P — team member who won the bid leads first)
  leads the first trick.
- Players must **follow the led suit** if able.
- If void in the led suit, a player may:
  - Play a **trump card** (if they have one) — trumps always beat non-trump, and
  - **only after trump has been "broken"** (played by someone) earlier in the round can
    trump be **led**. Before that, trump just can't be the *led* suit — but it can
    still be *played* by anyone void in the led suit.
  - **or** discard any other off-suit card, even if they hold a trump (playing trump
    when void is always optional, never forced).
- **Winning a trick:**
  - If any trump was played, the **highest trump** played wins (rank order depends on
    the round's High/Low mode — see below).
  - If no trump was played, the **highest (High mode) or lowest (Low mode)** card of
    the led suit wins.
- The trick winner leads the next trick.
- Each trick won counts as **1 hand** toward that side's win total — same concept, not
  separate.

### 1.6 Card Ranking
- **Ace is always the best card of its suit**, in both High and Low modes.
- **High mode**, best → worst: A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2
- **Low mode**, best → worst: A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K

### 1.7 End of Round / Win Condition
- The bid-winning side needs the **losing side** to fail to reach `8 − bid` tricks
  across all 12 tricks in order to win the round.
- The opposing side wins the round if they reach `8 − bid` tricks at any point.
- **Early clinch:** if it becomes mathematically impossible for the trailing side to
  reach their target before all 12 tricks are played, **both sides get the option**
  to either end the round immediately or keep playing out all 12 tricks anyway (for
  a full tally / for fun). Round only ends early if both agree; otherwise it plays out.

### 1.8 3-Player Variant — STRETCH GOAL / BACKLOG
Not part of the week-one build. To revisit later — open design question is how the
48-card / kitty / 12-card-hand math adapts to 3 players (doesn't divide evenly), and
whether it's free-for-all or a 2-vs-1 dynamic team structure.

---

## 2. Technical Architecture

- **Frontend:** React + Vite
- **Styling / Art:** Plain CSS, pixel-art card sprite sheets, CSS/JS-driven animations
  for dealing, flipping, playing, and trump reveal
- **State sync:** Firebase (Firestore) — one document per game session holding full
  game state (hands, kitty, bids, current trick, turn order, scores). Clients subscribe
  to the document and re-render on change. No custom backend server needed.
- **Session joining:** No user accounts — a shareable game code/URL
  (e.g. `yoursite.com/game/ab12cd`) that friends open to join a session.
- **Hosting:** GitHub repo → Vercel (or Netlify), auto-deploys on every push. Free tier
  covers this project easily.

### Suggested Firestore game document shape (draft)
```
games/{gameId}
  mode: "2p" | "4p"
  phase: "draw" | "bidding" | "kitty_exchange" | "trick" | "round_end"
  players: [{ id, name, hand: [...cards], team? }]
  kitty: [...4 cards] (hidden until revealed to bid winner)
  middlePile: [...cards]        // 2P draw phase only
  bids: [{ playerId, number, mode }]
  winningBid: { playerId, number, mode }
  trumpSuit: "hearts" | ...
  trumpBroken: bool
  currentTrick: [{ playerId, card }]
  trickHistory: [...]
  trickCounts: { playerId or teamId: number }
  turn: playerId
  target: number   // 8 - winningBid.number
```

---

## 3. Build Plan (1 week, ~1.5–3 hrs/day)

| Day | Focus |
|---|---|
| 1–2 | Scaffold Vite + React project, set up Firebase project. Build the **core game engine** in plain JS/TS (deck, dealing, draw phase, bid comparison, trick resolution, win condition) — tested independently of UI first. |
| 3 | Wire engine to Firestore: actions write state, other client(s) read + re-render. Get a fully playable-but-unstyled 2P game working end to end. |
| 4 | UI pass: hand layout, kitty, bidding interface, trick area, turn indicators. |
| 5 | Pixel art + animations: card sprites, deal/flip/play animations, trump reveal, win screen. |
| 6 | 4-player mode (reuse engine, adjust deal/bid/turn order) + playtest with friends. |
| 7 | Buffer: bug fixes, polish, deploy. |

---

## 4. Open Questions / Stretch Goals
- 3-player variant design (see 1.8)
- Any house-rule twists to layer on later (to be brainstormed after core game ships)

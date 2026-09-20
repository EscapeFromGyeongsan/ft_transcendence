# Saiboard — Cyber Board Café

A local, two-player Omok experience and the first playable slice of our board-game café. Open the lounge, choose Omok, and take turns on the same device.

## Run locally

Use Node.js 22.12+ and npm. Install dependencies from the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. No account, database, environment variables, or game server is required. The development server is bound to `0.0.0.0` for local preview; separate browsers still have independent games.

```sh
npm run build       # Type-check and build apps/web/dist
npm run preview     # Serve the production build
npm test            # Pure engine tests
npm run test:watch
npx playwright install chromium
npm run test:e2e     # Desktop and mobile Chromium flows; starts Vite automatically
```

On Linux, Playwright may require OS libraries (`npx playwright install-deps chromium`).

## Play

- 15 × 15 intersections; black plays first, then players alternate.
- Five **or more** uninterrupted stones in any horizontal, vertical, or diagonal direction wins. No forbidden moves or undo.
- Occupied intersections and invalid coordinates do not consume a turn.
- A full board without a winner is a draw. A winning final move takes priority over a draw.
- The current player can resign after confirmation. No moves are accepted after a result.
- Start a new game; resetting an unfinished game requires confirmation.
- Use arrow keys on the board, then Enter or Space to place a stone. Home/End moves within a row; Ctrl+Home/End moves to a board corner.
- Returning to the lounge preserves the current game in the same tab. **Reloading or closing the tab clears it.**

## Structure and extension points

```text
apps/web/src/
  App.tsx                         Café shell and hash navigation
  components/ConfirmDialog.tsx    Shared confirmation dialog
  games/registry.ts               Game catalog metadata
  games/omok/
    Board.tsx                     Board rendering and keyboard input
    OmokRoom.tsx                  Players, history, rules, result and controls
    useLocalOmok.ts                Local session / engine integration
packages/games/omok/src/
  index.ts                        Pure, versioned Omok rules
  omok.test.ts                    Rule and boundary tests
tests/local-omok.spec.ts          Browser acceptance tests
Document/local-omok.md           Handoff and roadmap mapping
```

The `@cafe/omok` workspace exports TypeScript source consumed by Vite and tests. It imports no browser, React, network, clock, or database APIs. A future TypeScript server can reuse it with its build pipeline. State includes `gameType`, `rulesVersion`, and `stateVersion`, and is JSON-serializable.

The engine exposes `createInitialState()` and `applyAction(state, actor, action)`. Successful actions return a new state; errors leave the input unchanged. Session integration, game UI, and catalog metadata remain outside the engine. See [the integration notes](Document/local-omok.md) before connecting a server.

## Roadmap status and limitations

This is a **local prototype**, not an implementation of the complete submission requirements. There is no authentication, online multiplayer, matchmaking, chat, durable history, database, or reconnect support. No roadmap card or module is marked as evaluated based on local tests. See [the team roadmap](Document/roadmap.md) and [architecture](Document/ft_transcendence_game_architecture.md).

The source includes a deterministic legal 225-move draw scenario in the unit tests. It is test data, not a stored or externally verified match.

## Resources and AI use

The implementation follows the repository's architecture and team roadmap. Codex assisted with the initial local UI, pure game engine, automated tests, and handoff documentation. Team review, individual contributions, submission metadata, and actual server evaluation evidence must be completed by the team as the project progresses.

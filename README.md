# Saiboard — Cyber Board Café

A two-player Omok experience for the board-game café. Play on one device in the local room, or invite a friend to an online room from another browser.

## Run locally

Use Node.js 22.12+ and npm. Install dependencies from the repository root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. `npm run dev` starts Vite and the Node API together. The API is bound to localhost and Vite forwards `/api` requests. To let a friend on the same network reach the site, use `npm run dev -- --host 0.0.0.0` and send them your computer's address and the room link. Both browsers must reach the **same running server**.

```sh
npm run build       # Type-check and build apps/web/dist
npm run dev:server  # API separately (use alongside npm run preview)
npm run preview     # Serve the production build; API must run separately
npm test            # Engine and server room tests
npm run test:watch
npx playwright install chromium
npm run test:e2e     # Desktop and mobile Chromium flows; starts Vite and API automatically
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

## Local rooms

Open **게임 로비** in the navigation (or `/#/rooms`), then **방 만들기**.

1. Enter a room title (up to 40 characters) and host name (up to 16).
2. In the waiting room, add the second player's name. Names within a room must be distinct, ignoring case.
3. Press each player's ready button, then **대국 시작하기**. Both occupied seats must be ready. Changing the second player clears readiness.
4. Return to the lobby to search by room/host name, filter by status, or resume a match. Each room has its own independent board.
5. **방 닫기** removes the room and its game after confirmation. Returning to the lobby alone keeps them.

Rooms are held in this tab's memory. They are **not shared with other tabs or devices** and disappear on reload. The two seats are local player assignments, not authenticated online users. Old room URLs show a recovery link to the lobby after reload. No sample rooms or simulated online players are added.

## Online rooms

Open **온라인 오목** (`/#/online`), create a room, and send its link to the second player. The guest opens it in another browser, enters a different name, and both players press **준비하기**. The host starts the match. Black moves first; the server owns the board, validates each command and its state version, and streams the current room snapshot to both browsers. Spectators can open the link but cannot play. A reload in the same tab restores the player's seat and current game while the server is running. The host may close the room or, after a result, return both players to the waiting room for a rematch.

The session token is kept in the browser tab's `sessionStorage` and sent with player commands. A different tab is a different participant; do not share the token. Online rooms are held **in one server process's memory**: restarting the server clears them and their tokens. This is a playable multiplayer prototype without accounts, persistence, multi-instance scaling or a production deployment configuration.

## Structure and extension points

```text
apps/web/src/
  App.tsx                         Café shell and hash navigation
  Lounge.tsx                      Original café landing page
  rooms/                          Room lobby, creation dialog, waiting room
    types.ts                      Room metadata and player seat contracts
    useLocalRooms.ts              In-memory room lifecycle and readiness
    LocalRoomGame.tsx             Independent Omok session for each room
  components/ConfirmDialog.tsx    Shared confirmation dialog
  games/registry.ts               Game catalog metadata
  games/omok/
    Board.tsx                     Board rendering and keyboard input
    OmokRoom.tsx                  Players, history, rules, result and controls
    useLocalOmok.ts                Local session / engine integration
  online/                         Remote lobby, room, HTTP client and live updates
apps/server/src/
  rooms.ts                        Membership, authorization and game authority
  index.ts                        HTTP commands and server-sent snapshots
  rooms.test.ts                   Server boundary tests
packages/games/omok/src/
  index.ts                        Pure, versioned Omok rules
  omok.test.ts                    Rule and boundary tests
tests/local-omok.spec.ts          Original game acceptance tests
tests/local-rooms.spec.ts         Room lifecycle and isolation tests
tests/online-omok.spec.ts         Two-browser multiplayer flow
Document/local-omok.md           Handoff and roadmap mapping
```

The `@cafe/omok` workspace exports TypeScript source consumed by Vite, Node and tests. It imports no browser, React, network, clock, or database APIs. State includes `gameType`, `rulesVersion`, and `stateVersion`, and is JSON-serializable.

The local room service owns participants, readiness, and lifecycle; the engine owns the board and game rules. `LocalRoomGame` maintains each started room's session while navigating. Online rooms use a separate server-owned lifecycle and server-sent events for snapshots. The browser sends actions but does not decide whether they are legal.

The engine exposes `createInitialState()` and `applyAction(state, actor, action)`. Successful actions return a new state; errors leave the input unchanged. Session integration, game UI, and catalog metadata remain outside the engine. See [the integration notes](Document/local-omok.md) before connecting a server.

## Roadmap status and limitations

This is an **Omok prototype**, not an implementation of the complete submission requirements. There is no account authentication, matchmaking, chat, durable history or database. Session tokens allow reconnect in the same tab while one server stays alive. No roadmap card or module is marked as evaluated based on prototype tests. See [the team roadmap](Document/roadmap.md) and [architecture](Document/ft_transcendence_game_architecture.md).

The source includes a deterministic legal 225-move draw scenario in the unit tests. It is test data, not a stored or externally verified match.

## Resources and AI use

The implementation follows the repository's architecture and team roadmap. Codex assisted with the local UI, pure game engine, online room server and UI, automated tests, and handoff documentation. Team review, individual contributions, submission metadata, and actual server evaluation evidence must be completed by the team as the project progresses.

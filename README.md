# Saiboard — Cyber Board Café

A two-player Omok experience for the board-game café. Play on one device in the local room, or invite a friend to an online room from another browser.

## Run locally

Use Node.js 22.12+ and npm. Install dependencies from the repository root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. `npm run dev` starts Vite and the Fastify API together. The API is bound to localhost and Vite forwards `/api` HTTP requests and WebSocket upgrades. To let a friend on the same network reach the site, use `npm run dev -- --host 0.0.0.0` and send them your computer's address and the room link. Both browsers must reach the **same running server**.

```sh
npm run build       # Type-check and build apps/web/dist
npm run dev:server  # API separately (use alongside npm run preview)
npm run preview     # Serve the production build; API must run separately
npm test            # Engine, room and Fastify/WebSocket integration tests
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

Open **로컬 · 한 화면 대전** in the navigation (or `/#/local-rooms`), then **방 만들기**.

1. Enter a room title (up to 40 characters) and host name (up to 16).
2. In the waiting room, add the second player's name. Names within a room must be distinct, ignoring case.
3. Press each player's ready button, then **대국 시작하기**. Both occupied seats must be ready. Changing the second player clears readiness.
4. Return to the lobby to search by room/host name, filter by status, or resume a match. Each room has its own independent board.
5. **방 닫기** removes the room and its game after confirmation. Returning to the lobby alone keeps them.

Rooms are held in this tab's memory. They are **not shared with other tabs or devices** and disappear on reload. The two seats are local player assignments, not authenticated online users. Old room URLs show a recovery link to the lobby after reload. No sample rooms or simulated online players are added.

## Online rooms

Open **게임 로비** (`/#/rooms`, also available at `/#/online`), create a room, and send its link to the second player. Both players sign in with their own accounts in separate browser profiles, and press **준비하기**. The host starts the match. Black moves first; the server owns the board, validates each command, match ID and state version, and streams the current room snapshot to both browsers. Spectators can open the link but cannot play. A reload or a new tab signed into the same account restores the same seat while the server is running; it cannot occupy the second seat. The host may close a waiting or finished room or, after a result, return both players to the waiting room for a rematch.

Room creation, listing and joining use Fastify HTTP routes. Ready/start/move/resign/rematch/leave/close commands and snapshots use `/api/rooms/:id/ws` through `@fastify/websocket`. Each command carries a request ID. The server authorizes it using the HttpOnly account session cookie, rechecking expiry and logout for every command. Client-supplied tokens, player IDs and nicknames never select the actor. WebSocket handshakes and HTTP mutations validate the browser origin. The browser reconnects with bounded backoff and receives a fresh snapshot; uncertain commands are never automatically replayed. A monotonically increasing room revision prevents delayed HTTP responses from replacing newer snapshots. Every rematch receives a new match ID, so commands from a previous match are rejected even when the move counter resets. Server ping/pong detects dead sockets and subscriptions are removed on disconnect.

Online rooms are held **in one server process's memory**. Restarting the server clears rooms and unfinished matches, but accounts, sessions and completed results persist. Seats are keyed by account ID. Same-account join requests are idempotent and return the existing seat, including during a game. Different accounts may have the same nickname; identity is determined by their account IDs. Anonymous visitors can spectate but must sign in to create or join a room. A host cannot close an ongoing match; finish it or resign first.

## Accounts and database

Open **내 계정** (`/#/account`) to register with an email address, nickname (1–16 characters), and password (12–128 characters). Registration signs you in. Login, logout and session restoration after reload are implemented. Account sessions and seat identity are shared across tabs in the same browser profile. Online room names come from the account nickname. A second account for testing requires a separate browser profile or private window.

Passwords use asynchronous salted scrypt (N=32768, r=8, p=3); only hashes are stored. Random 256-bit session tokens are kept in HttpOnly, SameSite=Strict cookies and stored only as SHA-256 hashes in the database. Sessions expire after seven days, rotate on login and are revoked on logout. Authentication mutation routes check the browser origin and JSON content type; registration/login requests are rate-limited. Production cookies require HTTPS.

Copy `.env.example` to `.env` if configuration is needed; the server loads it at startup. With no `DATABASE_URL`, development uses **PGlite**, an embedded PostgreSQL engine, persisting users and sessions under `data/accounts/` (ignored by Git). Run only one server process against this development directory. Tests use separate temporary databases. With `DATABASE_URL`, the server connects through `pg` to an external PostgreSQL server instead. The shared initial schema is in `apps/server/src/db/001-auth.sql`: `users` have unique normalized emails, and `sessions.user_id` references `users.id`. Startup applies the idempotent migrations in order, including `003-game-results.sql` for game-independent results. `game_matches` stores the game type and match metadata; `game_match_players` stores account-linked seats, nickname snapshots and outcomes. Existing Omok records from `002-matches.sql` are copied idempotently, and the legacy table is retained. Database switching does not copy existing users; use an explicit data migration when moving from development to deployment.

- `DATABASE_URL`: optional external PostgreSQL connection string; required in production.
- `DATABASE_DIR`: development database directory (default `./data/accounts`).
- `APP_ORIGIN`: exact browser origin (default `http://127.0.0.1:5173`). Set it to the address users actually visit, including the port.
- `NODE_ENV=production`: requires `DATABASE_URL` and an HTTPS `APP_ORIGIN`, and enables Secure cookies. HTTPS termination is still a separate deployment task.
- `PORT`: API port (default `3001`); the Vite proxy uses the same environment variable when set in the shell.

Restart `npm run dev` after changing backend code or environment settings. The frontend updates automatically, but the API process does not currently watch source changes. Users/sessions survive server restarts; rooms and ongoing matches still do not. The external PostgreSQL adapter has been type-checked; automated persistence tests currently run against PGlite, not a standalone PostgreSQL service. Email verification, password recovery, profile editing and recovery of unfinished games after a server restart are follow-up work.

To run browser tests without using the normal development ports:

```sh
E2E_PORT=5174 PORT=3002 DATABASE_DIR=/tmp/cafe-e2e-accounts CI=1 npm run test:e2e
```

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
  games/registry.ts               Game presentation metadata and online renderers
  games/omok/
    OnlineOmokGame.tsx            Online board, stone actions and Omok status
    Board.tsx                     Board rendering and keyboard input
    OmokRoom.tsx                  Players, history, rules, result and controls
    useLocalOmok.ts                Local session / engine integration
  online/                         Remote lobby, room, HTTP lobby client and WebSocket commands/updates
apps/server/src/
  rooms.ts                        Membership, authorization and game lifecycle
  games/                          Typed adapters and static server registry
  index.ts                        Fastify startup and graceful shutdown
  app.ts                          HTTP routes and WebSocket transport
  app.test.ts                     HTTP validation and real WebSocket integration tests
  rooms.test.ts                   Server boundary tests
  auth.ts                         Registration, login, cookies and session lifecycle
  auth.test.ts                    Persistence, invalid login, expiry and logout tests
  db/                             PostgreSQL adapters and initial account schema
packages/game-contracts/src/       Shared room, action envelope and result types
packages/games/omok/src/
  index.ts                        Pure, versioned Omok rules
  omok.test.ts                    Rule and boundary tests
tests/local-omok.spec.ts          Original game acceptance tests
tests/local-rooms.spec.ts         Room lifecycle and isolation tests
tests/online-omok.spec.ts         Two-browser multiplayer flow
Document/local-omok.md           Handoff and roadmap mapping
```

The `@cafe/omok` workspace exports TypeScript source consumed by Vite, Node and tests. It imports no browser, React, network, clock, or database APIs. State includes `gameType`, `rulesVersion`, and `stateVersion`, and is JSON-serializable.

The local room service owns participants, readiness, and lifecycle; the engine owns the board and game rules. `LocalRoomGame` maintains each started room's session while navigating. Online rooms use a separate server-owned lifecycle and WebSocket connections for commands and snapshots. The browser sends actions but does not decide whether they are legal.

The engine exposes `createInitialState()` and `applyAction(state, actor, action)`. Successful actions return a new state; errors leave the input unchanged. Session integration, game UI, and catalog metadata remain outside the engine. See [the integration notes](Document/local-omok.md) before connecting a server.

## Roadmap status and limitations

This is an **Omok prototype**, not an implementation of the complete submission requirements. Email/password account authentication and a PostgreSQL-compatible account database are implemented. Account-linked gameplay and completed match history are implemented. Matchmaking and chat are not implemented. Account sessions restore seats across tabs while one server stays alive. Disconnects preserve seats; automatic forfeits, host transfer and abandoned-room expiry are not implemented. No roadmap card or module is marked as evaluated based on prototype tests. See [the team roadmap](Document/roadmap.md) and [architecture](Document/ft_transcendence_game_architecture.md).

The source includes a deterministic legal 225-move draw scenario in the unit tests. It is test data, not a stored or externally verified match.

## Resources and AI use

The implementation follows the repository's architecture and team roadmap. Codex assisted with the local UI, pure game engine, online room server and UI, automated tests, and handoff documentation. Team review, individual contributions, submission metadata, and actual server evaluation evidence must be completed by the team as the project progresses.

Fastify integration uses the [official WebSocket plugin](https://github.com/fastify/fastify-websocket).

The home play button and game cards open the online lobby. Local shared-screen rooms live only under `/#/local-rooms`; they are explicitly labeled and are not shared with other tabs. In online rooms each participant uses their account nickname and controls only their own readiness.

## Match history

Open **내 전적** (`/#/history`) after signing in. It lists opponents, start/end times, win/loss/draw, reason (five stones, resignation or draw) and move count, with 20 records per page. Summary includes total games, wins, losses, draws and win rate (wins divided by all completed matches, including draws). `/api/me/matches` derives the user from the session, not a query-supplied user ID.

All mutations for a room are serialized. The final action is validated without mutating live state, then the normalized result and all participants are written atomically in one SQL statement before committing/broadcasting the terminal state. The unique match ID and `ON CONFLICT` prevent duplicate records. If persistence fails, the game stays at the prior state and the player can retry. Rematches receive new IDs. A crash after the database commit retains the completed result, but live room recovery is not yet implemented. Tests cover five-in-a-row wins, resignation, draw result mapping, duplicate completion, database failure/retry, revoked sessions, same-account seat recovery and history persistence after reopening the database. Standalone PostgreSQL remains unverified; database tests run against PGlite.

## Game adapter prototype

Online room lifecycle and transport depend on a static server game registry. The Omok adapter validates actions, maps authenticated seats to stones, calls the unchanged pure engine, and normalizes its result. `GET /api/games` lists registered game types and capacities; room creation accepts `gameType` and defaults to Omok for existing clients. Shared wire types live in `@cafe/game-contracts`; the frontend registry chooses the game renderer and labels. Only Omok is registered in the application.

See [the responsibility analysis and extension guide](Document/game-adapters.md). A test-only three-player counter verifies that the platform does not depend on a board, stone colors, two seats, or alternating turns. New games still require their own engine, adapter, UI and tests. Hidden information, random outcomes and variable player counts are not implemented by this prototype.

*This project has been created as part of the 42 curriculum by jyoo, yunhpark, yoshin, sipyeon, dong-hki.*

# Cyber Board Café

## Description

A Korean-language, two-player board game platform for freestyle Gomoku (Omok, 15 × 15) and standard Othello (8 × 8). Accounts, matchmaking, real-time transport and persistence are separated from each game's rules and board UI.

This submission README draft was updated on **2026-11-09 (KST)**. Feature-branch implementation, runtime integration and evaluation readiness are tracked separately in the [SDS](Document/SDS.md) and [test plan](Document/TEST_PLAN.md).

## Features and integration status

| Area | Implemented scope | Remaining work |
|---|---|---|
| Accounts | Registration, email/password login, rotating refresh tokens and session revocation | Full browser acceptance coverage |
| OAuth and 2FA | 42 login/link API and UI; TOTP setup, verification, recovery codes and disable flow | Real 42 provider verification; UI PR #72 is open |
| Profiles | Public profiles, nickname changes, PNG/JPEG avatar upload/delete and default avatars | Browser persistence/error-path E2E |
| Records | Per-game statistics, history, first-win achievement, ten-game progress and leaderboard | Full real-game acceptance data and independent reproduction |
| Matchmaking | Game selection, queue join/cancel/matched flow and waiting UI | UI PR #63 is open; requires D's real-time server |
| Gomoku | Rules engine, board UI and WS client | Two-session reconnect/result/history E2E is on the separate #27 integration branch |
| Othello | Engine merged in PR #58; board UI, legal moves, disc counts, automatic pass and results in PR #73 | UI PR #73 is open; running-server registration and browser E2E |
| Legal pages | `/terms`, `/privacy`, footer/signup links, history/404 routing and modal Escape handling | PR #71 is open; final policy review and browser E2E |
| Friends and invitations | SDS REST/WS contract proposals | API, presence/invitation transport and UI remain planned (#38, #69) |
| Privacy and deletion | SDS designs for `recordsPublic` updates and `DELETE /api/users/me` | API and UI remain planned |

Issues #23, #64, #65 and #66 correspond to PRs #63, #71, #72 and #73. The web implementation reference is `feat/web-othello` at `3d06126`. This documentation branch contains the server APIs, both game engines and a placeholder web page; it does not include those frontend feature PRs. Its API startup does **not** register `/api/ws` or game engines. Use a checkout containing the web feature branch for signup/profile screens and the real-time integration for matches. The feature table describes the referenced branches, not features all available in this checkout.

## Game rules

- **Gomoku:** black starts on an empty 15 × 15 board. Players alternate placing one stone. Five or more consecutive stones horizontally, vertically or diagonally win. No forbidden moves or undo. A full board without a winner is a draw.
- **Othello:** black starts from the standard four central discs. A move must enclose and flip at least one opposing disc in any of eight directions. A player without a legal move passes automatically. When neither player can move, the larger disc count wins; equal counts draw.
- Coordinates are zero-based `(row, col)`: Gomoku `0..14`, Othello `0..7`, with `(0, 0)` at the top left. The current board UI and API use the same convention.
- Statistics are per game. Void matches are excluded; draws count as completed matches. Win rate is `wins / completed matches`. Leaderboards order by **wins descending, win rate descending, user ID ascending** (DEC-08), with distinct sequential ranks.
- The real-time design pauses play during disconnection and gives each player a cumulative 60-second absence budget per match (DEC-03). Returning does not reset it. Verification requires the integrated runtime.

The [SDS](Document/SDS.md) and [test plan](Document/TEST_PLAN.md) contain current conventions. [GAME_RULES.md](Document/GAME_RULES.md) still needs C's pending #36 update for Othello and DEC-03/08; its older tie-break and one-based display wording are not the current contract.

## Technical stack and architecture

- Node.js `>=22.12.0` (package engine requirement), TypeScript, npm workspaces; recent implementation reports use Node.js `26.13.0`.
- Frontend: React, Vite, History API routing and shared CSS custom properties.
- Backend: Fastify, JSON Schema validation and Swagger UI.
- Database: PostgreSQL 17, Drizzle ORM, Drizzle Kit migrations and `pg`.
- Security: Argon2id passwords, signed access tokens, rotating opaque refresh tokens and encrypted TOTP secrets.
- Tests: Vitest unit/database integration tests and Playwright browser tests.

The browser calls `/api/*` through Vite's development/preview proxy. Fastify routes call services and repositories backed by PostgreSQL. `@cafe/game-contracts` holds shared messages/types; `@cafe/game-engine` implements rules independently of transport. The integrated runtime adds authenticated WebSocket matchmaking, subscriptions and commands. It validates and persists commands before publishing authoritative state; `commandId` and `stateVersion` support deduplication and stale-state detection.

Committed migrations `0000`–`0003` include `users`, `sessions`, `refresh_tokens`, OAuth/2FA tables, `games`, `game_players`, `moves`, `game_commands` and the connection probe. Statistics are queried from stored results. `friendships`, privacy updates and account-deletion changes remain planned. Relationships and constraints are documented in the [SDS](Document/SDS.md).

## Instructions

Run commands from the repository root. Install Node.js/npm and start Docker Desktop or a compatible Docker engine. Copy `.env.example` to `.env` **only if `.env` does not already exist**:

```sh
cp .env.example .env
```

In PowerShell use `Copy-Item .env.example .env`; use `npm.cmd`/`npx.cmd` if PowerShell blocks the `.ps1` launchers. Preserve existing credentials.

Set PostgreSQL credentials and the matching `DATABASE_URL`. Replace `JWT_SECRET` with a random value of at least 32 characters. Set a separate random `TWO_FACTOR_KEY` of at least 32 characters to enable 2FA. For example, generate each value separately using `openssl rand -base64 48`.

```sh
npm ci
npm run db:up
npm run db:migrate
npm run db:check
npm run dev
```

| Service | Local URL |
|---|---|
| Web | http://127.0.0.1:5173 |
| API | http://127.0.0.1:3001 |
| Swagger UI | http://127.0.0.1:3001/docs |
| Liveness | http://127.0.0.1:3001/api/health |
| Database readiness | http://127.0.0.1:3001/api/health/db |

The API checks the database before listening and marks unfinished matches void on startup. Both development servers bind to `127.0.0.1`. Vite proxies `/api` HTTP and WS traffic; Swagger UI is available on the API port. Restart `npm run dev` after server changes.

`infra/compose.yaml` starts **only PostgreSQL**, bound to `127.0.0.1:5432` by default. A named volume preserves data; `npm run db:stop` stops the database without deleting it. Initialization credentials apply to a new volume; editing `.env` does not change existing database credentials. Full application containers and HTTPS/WSS are tracked in separate deployment branches (#10, #28, #40).

In a checkout containing `feat/web-othello` (`3d06126`), sign up through the web page, then sign in and open your profile or leaderboard. This documentation checkout has only the placeholder page; its APIs can be explored through Swagger UI. To prepare test accounts through the real API, set a private `QA_PASSWORD` and run `npm run qa:accounts` while the API is running. It creates `qa-p1`–`qa-p4` and `qa-outsider` with `@qa.example.com` addresses; it does not reset existing passwords.

```sh
npm run build       # Type-check and build apps/web/dist
npm run dev:server  # API only
npm run preview     # Production web build; run the API separately
```

## Environment variables

The API, Vite configuration, migration configuration and DB check load the root `.env`. Existing shell environment values take precedence. Keep secrets outside Git.

| Variable | Purpose |
|---|---|
| `PORT` | API port, default `3001`; Vite uses the same proxy target |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local database initialization |
| `POSTGRES_PORT` | Host database port, default `5432` |
| `DATABASE_URL` | API/migration PostgreSQL URL; percent-encode special characters in credentials |
| `JWT_SECRET` | Required signing secret, at least 32 characters |
| `TWO_FACTOR_KEY` | Separate encryption key, at least 32 characters; absent means 2FA returns 503; changing it invalidates encrypted setups |
| `FT_OAUTH_CLIENT_ID`, `FT_OAUTH_CLIENT_SECRET`, `FT_OAUTH_REDIRECT_URI` | Set all three or leave all empty; redirect URI must match the 42 app and web `/oauth/42/callback` |
| `TRUST_PROXY` | Trusted proxies for rate-limit client IP; local default `loopback` |
| `AVATAR_DIR` | Avatar directory, default `data/avatars`; relative paths start at repository root |
| `TEST_DATABASE_URL` | Disposable integration-test database; actual database name must end in `_test` |
| `QA_PASSWORD`, `QA_API_URL` | Test-account password (8+ characters) and optional API URL for `qa:accounts` |
| `E2E_PORT` | Local Playwright web-server port, default `5173` |

After schema changes, run `npm run db:generate -- --name=<change>`, review the SQL and run `npm run db:migrate`. Do not rewrite shared/applied migrations.

## Testing

```sh
npm test
npm run test:watch
npx playwright install chromium
npm run test:e2e
```

`npm test` runs the engine and server tests in this checkout. The referenced web feature branch also includes web unit tests and adds them to the Vitest configuration. DB tests skip when `TEST_DATABASE_URL` is absent: green results with skips do not demonstrate database integration. When configured, the helper checks the **connected** database name ends in `_test`, applies migrations and truncates domain tables between tests. Create this disposable database separately (for example, `CREATE DATABASE cafe_test;` through a PostgreSQL administrator connection). Never use the development/shared database. Keeping the example URL configured without creating the test database causes failures.

`npm run test:e2e` starts the API and Vite unless an existing server is reused. Prepare the development DB using `db:up` and `db:migrate`. This checkout's `tests/app.spec.ts` checks the home page only.

The actual two-session Gomoku scenario is `tests/gomoku.spec.ts` on `codex/gomoku-integration` at `b24ea10` (#27). That branch supports `E2E_BASE_URL` for a deployed target; this checkout's configuration does not. Use a checkout containing that integration to run it. Othello, legal-page and profile browser E2E extensions remain planned. Record commands, commit, environment, skips and results using the [test plan](Document/TEST_PLAN.md).

## Team, modules and project management

| Member | Responsibility and implementation areas |
|---|---|
| jyoo (A) | Product scope, frontend screens, documentation and evaluation collection |
| yunhpark (B) | Technical lead; authentication, database, command persistence/concurrency, statistics and integration support |
| yoshin (C) | Game rules and Gomoku/Othello engines |
| sipyeon (D) | WebSocket transport, matchmaking, subscriptions and reconnection |
| dong-hki (E) | Development/deployment environment and social contracts/implementation |

Commits and PRs record individual contributions. The [roadmap](Document/roadmap.md) preserves the original role/schedule plan; the SDS records implementation references. Work uses issues, feature branches and reviewed PRs under [CONTRIBUTING.md](CONTRIBUTING.md).

The [module matrix](Document/evaluation/module-matrix.md) describes the original 14-point candidate: frameworks, real-time functionality, user interaction, standard user management, a complete web game, remote play, ORM and statistics. The SDS includes the later two-game scope. These are candidate modules, not an awarded score; social functionality, remote-play evidence and independent acceptance remain incomplete.

## Structure

The web layout below describes `feat/web-othello`; this documentation checkout currently has only `App.tsx` and `main.tsx` under `apps/web/src`.

```text
apps/server/src/
  api/              HTTP routes and schemas
  services/         Auth, users, avatars, games and statistics
  repositories/     Database queries
  db/schema/        Drizzle tables
  core/             Tokens, passwords, TOTP, OAuth and image checks
  test-support/     Disposable DB setup
apps/server/drizzle/ SQL migrations and metadata
apps/web/src/
  App.tsx           Routing, session bootstrap and shared shell
  api/              HTTP clients and formatting
  game/             Matchmaking, WS client and game views/state
  profile/          Profiles, avatars and leaderboard
  legal/            Terms, privacy and route helpers
  styles.css        Shared design tokens and responsive styles
packages/
  game-contracts/   Shared game and transport types
  game-engine/      Gomoku and Othello rules
config/             Drizzle, Vitest and Playwright configuration
infra/              Local PostgreSQL Compose configuration
tests/              Playwright browser scenarios
scripts/            Development, DB checks and QA accounts
Document/           Design, contracts and evaluation plans
```

## Documentation and resources

- [SDS](Document/SDS.md): architecture, data model, contracts and requirement traceability.
- [Test plan](Document/TEST_PLAN.md): T00–T10 scenarios, coordinates, ranking and automation scope.
- [Contracts](Document/contracts.md), [game engine documentation](packages/game-engine/README.md) and [shared contract types](packages/game-contracts/src/).
- [Roadmap](Document/roadmap.md), [module matrix](Document/evaluation/module-matrix.md), [mandatory checklist](Document/evaluation/mandatory-checklist.md).
- [Documentation specification](Document/cyber_boardgame_documentation_spec.md), [contribution rules](CONTRIBUTING.md), [TSDoc conventions](Document/code-conventions.md).
- Dependencies and versions: [package.json](package.json), [package-lock.json](package-lock.json). Package license notices accompany dependencies: React/Fastify/Vite/Vitest/pg use MIT; Drizzle ORM and Playwright use Apache-2.0. No root project license currently exists; dependency licenses do not license this project's code. Asset/font attribution review remains required before submission.

## AI usage

Codex has assisted with implementation, tests, code review and documentation. This README/SDS/test-plan update used Codex to compare local source, branch commits and GitHub metadata, reconcile document changes and draft English text. Humans review generated changes and reproduce behavior. Real credentials, completed acceptance tests and awarded module scores are not inferred from AI output. Per-change verification belongs in each PR's `Test Result`.

## Known limitations

- The web branch is ahead of `master`; open frontend PRs and runtime/deployment branches still need integration.
- This checkout has a placeholder web page and no registered WS runtime; the referenced feature branch's game cards do not establish running-server support.
- Friends, presence, invitations, privacy updates and deletion are unfinished. Friend request identity/concurrency and presence-ordering proposals await agreement in #38/PR #68.
- HTTPS/WSS deployment, performance targets and real two-PC play require the integrated environment and evidence.
- Expanded browser E2E, final legal policy review, asset attribution and independent README reproduction remain required before submission.

*This project has been created as part of the 42 curriculum by jyoo, yunhpark, yoshin, sipyeon, dong-hki.*

# Cyber Board Café

## Description

A turn-based board game platform. Create an account, join the Omok (15 × 15, free rules) queue, and play a real-time match over WebSocket. The app restores your active match after reconnecting and shows completed matches in your profile. See [the roadmap](Document/roadmap.md) for planned features.

## Technical stack

- Node.js 22.12+, TypeScript, npm workspaces
- Backend: Fastify, Swagger UI (`@fastify/swagger`, `@fastify/swagger-ui`)
- Database: PostgreSQL 17 (local Docker), Drizzle ORM + Drizzle Kit, pg
- Frontend: React, Vite, Tailwind CSS 4.3.3 (`@tailwindcss/vite`). [Styling demonstration](Document/evaluation/mandatory-checklist.md#스타일링-솔루션-시연-116): login/profile/friends JSX utilities and shared button/input/card `@apply` rules; screen-specific board CSS remains in `apps/web/src/styles.css`.
- Tests: Vitest (unit), Playwright (E2E)

The [#116 integration validation](Document/styling-116-integration-validation.md) records the candidate source, production build, actual HTTPS/WSS checks and remaining submission requirements.

## Instructions

Choose the local development workflow below, or the separate [full application HTTPS workflow](Document/runtime.md). Full-app startup, failure handling and persistence have been locally validated; see the remaining checks in the validation record.

### Local development

Start Docker Desktop (or your Docker engine). Install dependencies from the repository root, create `.env` from `.env.example` if it does not exist, and set the local PostgreSQL credentials, matching `DATABASE_URL`, and a private `JWT_SECRET` of at least 32 characters. Keep existing credentials if `.env` already exists.

```sh
npm ci
npm run db:up
npm run db:migrate
npm run db:check
npm run dev
```

| Service | URL |
|---|---|
| Web (Vite) | http://127.0.0.1:5173 |
| API (Fastify) | http://127.0.0.1:3001 |
| Swagger UI | http://127.0.0.1:3001/docs |
| DB readiness | http://127.0.0.1:3001/api/health/db |

The API checks database readiness before listening. `/api/health` reports server liveness; `/api/health/db` queries the `connection_probe` table and returns 200 when available, or a generic 503 on failure. Apply migrations before starting the API.

`npm run db:check` verifies an insert/read/delete through Drizzle and the Fastify DB health route, leaving no probe rows behind. Application migrations create accounts, sessions, matches and move history.

`infra/compose.yaml` runs only the local development database, bound to `127.0.0.1:5432` by default. Data persists in a Docker volume. `npm run db:stop` stops the database without deleting that volume. Full application containers and HTTPS/WSS are not provided by this development setup. PostgreSQL initialization credentials apply to a new volume; editing `.env` does not change credentials inside an existing database.

By default the local development servers listen on `127.0.0.1`. The API listen address can be overridden with `API_HOST`. Vite forwards `/api` requests and WebSocket upgrades to the API server. Swagger UI is served by the API server only and is not reachable through the web port. The API server does not watch source changes; restart `npm run dev` after changing server code.

Other commands:

```sh
npm run build       # Type-check and build apps/web/dist
npm run dev:server  # API server only
npm run preview     # Serve the production build (run the API separately)
npm test            # Unit tests and DB tests if TEST_DATABASE_URL is set
npm run test:watch
npx playwright install chromium
npm run test:e2e    # E2E tests; starts Vite and the API automatically (run db:up and db:migrate first)
```

Account deletion E2E needs the #89 integration server and a disposable DB; see [the prerequisites and validation scope](Document/account-deletion-validation.md).

### Full application containers

Requirements: Docker Engine with Compose v2, `make`, and OpenSSL. From the repository root:

```sh
make                 # https://<this computer's IP>:8443/, reachable from another computer
make HOST=10.12.3.4  # same, with the address given explicitly
make local           # https://localhost:8443/ on this computer only
```

Each target runs `infra/prepare-full.sh`, which creates only what is missing: `.env.full` from `.env.full.example` with random `JWT_SECRET` and `TWO_FACTOR_KEY`, the PostgreSQL password file `infra/secrets/postgres-password`, and a self-signed localhost certificate in `infra/certs`. Existing values and files are never replaced. `infra/start-full.sh` then runs `docker compose --env-file .env.full --project-directory . -p cyber-board-cafe-full -f infra/compose.full.yaml up --build -d --wait`.

- `make` finds this computer's IPv4 address (`ipconfig getifaddr en0`/`en1` on macOS, the first `hostname -I` address on Linux), binds ports to `0.0.0.0`, and uses a certificate in `infra/certs/lan` whose SAN includes that address. The certificate is recreated when the address changes. If no address is found, it stops and asks for `make HOST=<IP>`.
- `make local` binds ports to `127.0.0.1` and uses the localhost certificate in `infra/certs`.
- The binding, certificate directory and 42 redirect URI are passed for that run only; `.env.full` is not changed.
- With two computers, every browser (including the server computer's) uses the printed `https://<IP>:8443/` address. Check `https://<IP>:8443/api/health` from the other computer first, then accept the self-signed certificate warning once per browser.

`make down` stops the containers and keeps the database and avatar volumes; `make logs` and `make ps` show logs and status. 42 OAuth stays disabled until `FT_OAUTH_CLIENT_ID` and `FT_OAUTH_CLIENT_SECRET` are set in `.env.full`. `make` then uses `https://<IP>:8443/oauth/42/callback` as the redirect URI; `make local` uses `FT_OAUTH_REDIRECT_URI`, or `https://localhost:8443/oauth/42/callback` when it is empty. The URI in use is printed and must be registered in the 42 intra application. Compose mounts a separate `avatars` volume at `/data/avatars`, writable by the API's `node` user. Manual preparation and browser certificate trust are described in [the full execution guide](Document/runtime.md).

The `db`, `api` and `web` containers restart after a crash or a Docker restart; `make down` stops them. Server errors (500, 503, lost database connection) appear in `make logs`.

If `make` stops with `service "migrate" didn't complete successfully: exit 1` and `make logs` shows `password authentication failed`, this computer still has a database volume created with an earlier password (for example from a previous clone). Restore that earlier password file (`POSTGRES_PASSWORD_FILE`) and run `make` again. If the database data is not needed, remove only the database volume instead; this deletes the stored accounts and matches:

```sh
make down
docker volume rm cyber-board-cafe-full_postgres_data
make
```

Uploaded avatars are in a separate volume and do not affect the database password. To reset all data, also remove `cyber-board-cafe-full_avatars` in the same step.

Default HTTPS URLs are `https://localhost:8443/`, `/api/health`, `/api/health/db`, `/docs/`, and `/docs/json`. HTTP port 8080 redirects to HTTPS port 8443. Only Nginx publishes host ports. Full-app API and DB communicate internally; this workflow does not require host Node/npm.

The full app has a separate project/DB volume from local development. Startup, HTTPS with an explicit CA, migration failure, DB recovery and persistence after down/up have passed local validation. Windows browser trust setup and non-author reproduction remain pending. Nginx forwards `/api/ws` to the real-time API. See the [isolated browser checks](Document/runtime.md#격리된-수용-기준-검증) for running the Omok smoke test through HTTPS.

## Environment variables

The API server, Vite configuration, migration configuration and DB check load `.env` from the repository root. Do not commit it.

- `API_HOST`: API listen address (default `127.0.0.1`; full-app Compose explicitly sets `0.0.0.0`).
- `PORT`: API port (default `3001`), an integer between 1 and 65535. The Vite proxy (dev and preview) uses the same value.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: local database initialization settings.
- `POSTGRES_PORT`: local database port (default `5432`).
- `DATABASE_URL`: server/migration connection string matching the PostgreSQL settings. Percent-encode special characters in credentials. The example password is for local development only.

After changing a Drizzle schema, use `npm run db:generate -- --name=<change>` and review the generated SQL before `npm run db:migrate`. Committed migrations live in `apps/server/drizzle`; do not modify an already shared/applied migration.

## Structure

```text
apps/
  server/src/
    app.ts          Fastify app, routes and Swagger registration
    index.ts        Server startup and graceful shutdown
    app.test.ts     API tests
    db/             Connection pool and Drizzle test table schema
  server/drizzle/   SQL migrations and generation metadata
  web/src/
    main.tsx        React entry point
    App.tsx         Root component
packages/
  game-contracts/   Shared types between server and web
config/
  drizzle.config.ts     Schema and migration settings
  vitest.config.ts      Unit test settings
  playwright.config.ts E2E test settings
infra/
  compose.yaml          Local PostgreSQL container
  compose.full.yaml     Separate full-app execution
  Dockerfile            Workspace/server/web image targets
  nginx/                HTTPS/API/WebSocket proxy configuration
tests/              Playwright E2E tests
scripts/
  dev.mjs          Starts the API and Vite together
  check-db.mjs     Checks DB queries and the DB health route
Document/           Project documents
```

Tool-specific settings live in `config/`, and local infrastructure settings live in `infra/`. Run the documented npm commands from the repository root; they select the configuration files and root `.env` explicitly where needed.

`README.md` and `CONTRIBUTING.md` stay at the root as project entry points. `package.json` and `package-lock.json` define the npm workspace and dependency versions. `.env.example` stays beside the local `.env`, and the root `tsconfig.json` lets TypeScript and editors discover the shared project settings.

## Documentation

- [Roadmap](Document/roadmap.md)
- [Game rules](Document/GAME_RULES.md)
- [Test plan](Document/TEST_PLAN.md)
- [Documentation spec](Document/cyber_boardgame_documentation_spec.md): documents the project will produce (SRS, SDS, contracts, diagrams, test plan)
- [Full application execution](Document/runtime.md): HTTPS preparation, startup, lifecycle and isolated verification
- [Runtime validation record](Document/runtime-validation.md): actual checks and pending evidence
- [WSS verification](Document/runtime-wss-validation.md): pinned integration source, one-command reproduction and timing follow-up
- [Contribution rules](CONTRIBUTING.md): issue, branch, commit and PR workflow
- [TSDoc coding conventions](Document/code-conventions.md): TypeScript/React documentation comment rules

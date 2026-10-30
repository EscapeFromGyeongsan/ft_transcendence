*This project has been created as part of the 42 curriculum by jyoo, yunhpark, yoshin, sipyeon, dong-hki.*

# Cyber Board Café

## Description

A turn-based online board game platform offering Omok (15 × 15, free rules). Planned features include accounts, profiles, friends, chat, game rooms, real-time play over WebSocket, reconnection, match history and statistics. See [the roadmap](Document/roadmap.md) for scope and schedule.

## Technical stack

- Node.js 22.12+, TypeScript, npm workspaces
- Backend: Fastify, Swagger UI (`@fastify/swagger`, `@fastify/swagger-ui`)
- Database: PostgreSQL 17 (local Docker), Drizzle ORM + Drizzle Kit, pg
- Frontend: React, Vite
- Tests: Vitest (unit), Playwright (E2E)

## Instructions

Start Docker Desktop (or your Docker engine). Install dependencies from the repository root, create `.env` from `.env.example` if it does not exist, and set the local PostgreSQL credentials and matching `DATABASE_URL`. Keep existing credentials if `.env` already exists.

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

Only the connection test table is implemented. `npm run db:check` verifies an insert/read/delete through Drizzle and the Fastify DB health route, leaving no test rows behind. Account, session and game tables are still planned.

`infra/compose.yaml` runs only the local development database, bound to `127.0.0.1:5432` by default. Data persists in a Docker volume. `npm run db:stop` stops the database without deleting that volume. Full application containers and HTTPS/WSS are not provided by this development setup. PostgreSQL initialization credentials apply to a new volume; editing `.env` does not change credentials inside an existing database.

Both servers listen on `127.0.0.1` only. Vite forwards `/api` requests to the API server. Swagger UI is served by the API server only and is not reachable through the web port. The API server does not watch source changes; restart `npm run dev` after changing server code.

Other commands:

```sh
npm run build       # Type-check and build apps/web/dist
npm run dev:server  # API server only
npm run preview     # Serve the production build (run the API separately)
npm test            # Unit tests
npm run test:watch
npx playwright install chromium
npm run test:e2e    # E2E tests; starts Vite and the API automatically (run db:up and db:migrate first)
```

## Environment variables

The API server, Vite configuration, migration configuration and DB check load `.env` from the repository root. Do not commit it.

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
  compose.yaml     Local PostgreSQL container
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
- [Contribution rules](CONTRIBUTING.md): issue, branch, commit and PR workflow
- [TSDoc coding conventions](Document/code-conventions.md): TypeScript/React documentation comment rules

# Full application execution — issue #7

Status: implementation draft; Docker/build/browser/integration validation and non-author reproduction are pending. No PR has been created. See [the fixed plan](runtime-plan.md) and [validation record](runtime-validation.md).

## Architecture and boundary

~~~mermaid
flowchart LR
    browser[Browser] -->|HTTPS / future WSS| web[web: Nginx]
    web -->|Static HTML / JavaScript / CSS| browser
    web -->|Internal HTTP, preserve URI| api[api: Fastify]
    api -->|SQL, db:5432| db[db: PostgreSQL]
    migrate[migrate: existing Drizzle Kit migrations] -->|SQL| db
    db --- volume[(postgres_data)]
~~~

~~~mermaid
flowchart LR
    db[DB health succeeds] --> migrate[Migration exits with code 0]
    migrate --> api[API starts and DB readiness succeeds]
    api --> web[HTTPS entry starts]
~~~

Only web publishes host ports. API has a configurable listen address and no host port mapping. The data network is internal; DB and migration are on it, API joins data and edge, and Nginx joins edge. This isolates the DB from Nginx as well as from published ports. Docker administrators still control/access containers; this is not a boundary against the host administrator.

The existing development entry point is infra/compose.yaml with project cyber-board-cafe. Full application execution uses infra/compose.full.yaml with project cyber-board-cafe-full and its own default named volume. Validation must use an additional, uniquely named project. Do not set an external/fixed volume name shared with development.

No domain schema, game/auth/social code, or actual WebSocket endpoint is added. The only current database table is connection_probe.

## Prerequisites and preparation

Run commands from the repository root in a POSIX shell such as WSL/Linux.

- Docker engine and Docker Compose v2 with health dependency and bind.create_host_path support.
- Internet access for image pulls and npm dependencies on the first build.
- Node/npm are inside the images; they are not required on the host for full-app startup.
- Certificate preparation needs a supplied certificate/key pair, or OpenSSL 1.1.1+ for the included local generator. Browser trust preparation is separate.
- curl is needed for the verification commands below.
- Image tags select Node 24/bookworm-slim, Nginx 1.28/alpine, and PostgreSQL 17/alpine. They are not digest-pinned; record the actual image IDs/digests and engine/Compose versions when validating.

If .env.full does not exist, copy .env.full.example to it. Preserve an existing file.

~~~sh
cp -n .env.full.example .env.full
chmod 600 .env.full
~~~

Create a separate password file if none exists:

~~~sh
umask 077
mkdir -p infra/secrets
chmod 700 infra/secrets
if [ ! -e infra/secrets/postgres-password ]; then
  openssl rand -hex 32 > infra/secrets/postgres-password
fi
chmod 444 infra/secrets/postgres-password
~~~

The directory is private to the host owner. The mounted file is readable by the non-root node user inside the API/migration containers; the read-only secret mount is supplied only to those services and DB. Local Compose file secrets are not an encrypted secret store. Do not print the file, commit it, or record a generated DATABASE_URL in evidence.

Keep the password file under the ignored infra/secrets directory, or outside the repository/build context. If paths are changed, review .gitignore and .dockerignore as well. A secret file must contain one non-empty line, optionally ending in LF or CRLF. Spaces are significant; embedded newlines/NUL are rejected. URL-reserved characters and dollar signs are encoded by the API/migration wrapper, without Compose interpolation of the password itself.

PostgreSQL initialization settings apply to an empty data directory. Editing the password/user/database file or variables does not update an existing database. Rotate deliberately with SQL and coordinated service configuration; never delete an existing volume as a password-change shortcut.

## Certificates and trust

The Nginx mount expects server.crt and server.key inside CERT_DIR. The pair is mounted read-only, not baked into either image.

For a self-signed localhost certificate for CLI validation:

~~~sh
sh infra/generate-local-cert.sh
curl --cacert infra/certs/server.crt https://localhost:8443/api/health
~~~

The curl command runs after startup. The generator creates a 30-day certificate with localhost, 127.0.0.1 and ::1 subject alternative names. It refuses to overwrite an existing pair. It does not install browser trust. This path alone does not demonstrate warning-free browser access.

For trusted local browser reproduction, one option is an already installed mkcert. Generate the pair instead of running the self-signed generator:

~~~sh
umask 077
mkdir -p infra/certs
# If a pair already exists, preserve it or move it aside deliberately first.
mkcert -install
mkcert -cert-file infra/certs/server.crt -key-file infra/certs/server.key \
  localhost 127.0.0.1 ::1
~~~

mkcert -install changes that computer's trust store and may need OS approval. Obtain trust on every browser/client used for reproduction; a WSL trust-store change alone need not change Windows Chrome's trust store. On another client, trust the issuing CA's rootCA.pem; installing an unrelated local CA there will not validate this server's certificate. Keep the local CA private key private as well. With mkcert, curl's trust file is the generated CA certificate (rootCA.pem), not the leaf server.crt.

For LAN access, the certificate must include the IP/DNS name actually used. The OpenSSL helper accepts LOCAL_CERT_SAN for a different SAN list. Change BIND_ADDRESS explicitly (for example, 0.0.0.0), prepare trust on the other client, and review host firewall access. Never transfer the server's private key or a local CA private key to a client merely to establish trust.

## Single-command startup

After preparation:

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml up --build -d --wait
~~~

| Public URL with example ports | Expected behavior |
|---|---|
| https://localhost:8443/ | Built web page |
| https://localhost:8443/api/health | API liveness, 200 |
| https://localhost:8443/api/health/db | DB/table readiness, 200 or generic 503 |
| https://localhost:8443/docs/ | Swagger UI and its assets |
| https://localhost:8443/docs/json | OpenAPI JSON |
| http://localhost:8080/ | 308 to HTTPS port 8443 |

A first build can fail on dependency installation, image availability or tool/runtime compatibility; this session has not executed it. Do not declare startup proven from the configuration alone.

The workspace image installs the committed root lock using npm ci. The web-build target runs the existing type check and Vite build. The final web target contains Nginx and built web files. The server target uses the existing Node TypeScript execution mode and intentionally retains migration tooling; dependency pruning is deferred. Neither depends on host node_modules.

## Environment precedence and internal addresses

| Setting | Source / behavior |
|---|---|
| POSTGRES_USER / POSTGRES_DB | Shell variables take precedence over the Compose --env-file values; required |
| POSTGRES_PASSWORD_FILE | Host file path used by Compose secrets; the container receives /run/secrets/postgres_password |
| CERT_DIR | Host directory mounted read-only into Nginx |
| BIND_ADDRESS / HTTP_PORT / HTTPS_PORT | Compose interpolation; defaults 127.0.0.1 / 8080 / 8443 |
| API_HOST / PORT in full-app API | Explicitly 0.0.0.0 / 3001 in the service |
| DATABASE_URL in full-app API/migration | Constructed from the password file and initialization variables; always db:5432 |
| API_HOST in local development | Optional; default 127.0.0.1 |
| PORT in local development/preview | Existing root .env/process behavior and Vite proxy remain unchanged |

The documented lifecycle commands explicitly set -p cyber-board-cafe-full so an inherited COMPOSE_PROJECT_NAME cannot select the development project. Validation commands explicitly select their disposable project.

Compose --env-file performs configuration interpolation; it does not pass every variable into every container. The service environment mappings explicitly select values. The root development .env is not loaded by the full-app Compose command and is excluded from images. Do not source .env.full as a shell script.

Credentials are URI-encoded before building the internal DATABASE_URL. Browser requests use same-origin /api paths; the browser must never try to resolve the internal service names api or db. A bind to 0.0.0.0 inside a container does not itself publish a host port.

Only PUBLIC_HTTPS_PORT is substituted into the Nginx template. Nginx variables such as $host, $request_uri and $http_upgrade stay intact. /api and /docs are forwarded without stripping their prefix. Docker DNS is consulted through a variable upstream so API container replacement can be resolved again.

## Readiness, migrations and lifecycle

DB uses pg_isready. Migration runs the existing Drizzle Kit command with the existing config and SQL files. Its successful exit is a prerequisite for API startup. API additionally checks the existing DB/table readiness route before listening. Web starts after API health succeeds.

Migration/DB failure prevents a fresh API from becoming ready; up --wait must not be treated as successful if it exits non-zero. Health dependencies apply at startup. Runtime DB failure marks readiness unhealthy but does not automatically orchestrate recovery or stop every other container.

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml ps -a

docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml logs --tail=100 db migrate api web
~~~

Check logs before attaching them to evidence; remove any unexpected sensitive values. Do not attach the password file, personal .env, private key or raw process environment.

Normal stop:

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml stop
~~~

Recreate after a normal stop with the same startup command and project name. To remove the containers/networks while preserving the named DB volume, use down without --volumes. Do not use down -v for the real full-app or development project.

For a schema-changing deployment, stop web/api before applying migration and recreate them only after success. An already running API is not automatically stopped by a newly failed migration; do not treat an in-place up as a deployment transaction.

The API entry wrapper imports the existing server in the same Node process so SIGTERM reaches its Fastify shutdown handlers. init: true reaps children; the migration wrapper forwards SIGINT/SIGTERM to its Drizzle process. Graceful shutdown still needs executed verification.

## WebSocket handoff

Upgrade/Connection forwarding is prepared for paths under /api/. The 75-second upstream idle timeout requires a future endpoint's heartbeat policy to be coordinated. Confirm the real endpoint path with its owner. If it is outside /api/, add its explicit proxy location and verify it.

Pending endpoint handoff items: path, authentication/origin handling, heartbeat interval, close behavior, and connection/message/reconnect tests. Until then, actual WSS is pending. Do not add a fake echo endpoint and label it product integration.

## Isolated acceptance verification

Use a unique project name and unused ports. These commands never target the existing development/full-app data volumes:

~~~sh
export HTTP_PORT=18080
export HTTPS_PORT=18443
export BIND_ADDRESS=127.0.0.1
VERIFY_PROJECT="cafe-env-check-$(date +%s)"
dc() {
  docker compose --env-file .env.full --project-directory . \
    -p "$VERIFY_PROJECT" -f infra/compose.full.yaml "$@"
}
dc config --quiet
dc up --build -d --wait
dc ps -a
~~~

Use the appropriate trust file from the certificate preparation section:

~~~sh
# Self-signed helper path; for mkcert use its rootCA.pem instead.
TRUST_FILE=infra/certs/server.crt
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/api/health
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/api/health/db
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/docs/
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/docs/json
curl -sS -D - -o /dev/null http://localhost:18080/api/health
~~~

Expected: health routes 200; Swagger routes/assets load; HTTP responds 308 with Location https://localhost:18443/api/health. Open the page/Swagger in a browser with trust configured and record browser console output. curl -k and the internal Nginx healthcheck do not prove certificate trust.

Inspect published ports: only web has bindings. Test API replacement with dc up -d --force-recreate api and retry the HTTPS health URL after DNS cache expiry. Record any transient failure.

Verify one connection-probe row survives container/network recreation:

~~~sh
dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO connection_probe (id) VALUES ('runtime-persistence-probe');
SQL
dc down
dc up -d --wait
dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT id FROM connection_probe WHERE id = 'runtime-persistence-probe';
DELETE FROM connection_probe WHERE id = 'runtime-persistence-probe';
SQL
~~~

Expected: the same row is returned. This proves probe-table persistence only, not account or match-history preservation.

Runtime DB failure: dc stop db, then check that /api/health/db returns generic 503 while API liveness can remain 200. Restore db, then verify readiness recovers. Record exit/shutdown behavior when stopping all services.

Test migration failure on another empty project by deliberately creating a conflicting view. This uses the unchanged migration SQL and never modifies an applied migration:

~~~sh
FAILURE_PROJECT="$VERIFY_PROJECT-migration-failure"
failure_dc() {
  docker compose --env-file .env.full --project-directory . \
    -p "$FAILURE_PROJECT" -f infra/compose.full.yaml "$@"
}
failure_dc up -d --wait db
failure_dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE VIEW connection_probe AS SELECT 1 AS incompatible;
SQL
failure_dc up --build -d --wait
failure_dc ps -a
failure_dc logs --tail=100 migrate
~~~

Expected: CREATE TABLE in migration fails on the existing view; the migration exits non-zero, and fresh API/web do not become ready. Record the startup command's non-zero exit status rather than hiding it with shell fallthrough. Run this only in the newly named empty failure project. If the view creation fails, stop and inspect that project instead of continuing.

After recording evidence, clean up only the disposable projects. Confirm the printed project names are the unique validation names, not cyber-board-cafe or cyber-board-cafe-full:

~~~sh
printf '%s\n' "$VERIFY_PROJECT" "$FAILURE_PROJECT"
dc down --volumes
failure_dc down --volumes
~~~

Existing host development regression (host Node/npm are needed for these tests only):

~~~sh
npm ci
npm test
npm run build
npm run db:up
npm run db:migrate
npm run test:e2e
~~~

Also exercise a non-default PORT, development and preview API proxying, and Ctrl+C shutdown. Use a separate local verification DB if the normal development DB contains valuable data.

Record date/time (KST), tester, commit SHA, engine/Compose/Node/browser versions, image IDs, commands, exit codes, redacted logs, HTTPS/browser evidence, persistence result, failure results and WSS pending status. A non-author must repeat the README instructions before issue #7 can be accepted.

## References

- [Docker startup dependencies](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker network names and ports](https://docs.docker.com/compose/how-tos/networking/)
- [Compose environment configuration](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- [Nginx WebSocket forwarding](https://nginx.org/en/docs/http/websocket.html)
- [Node TypeScript execution](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- [mkcert](https://github.com/FiloSottile/mkcert)

Codex assisted with planning, implementation and source-level review. This record is not runtime or school-evaluation evidence.

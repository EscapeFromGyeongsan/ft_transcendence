#!/bin/sh
# Runs the development commands in the `node` container of infra/compose.yaml,
# so the host needs only Docker (no Node.js). Called by the Makefile:
#   dev.sh dev            migrate, then the API and Vite on 127.0.0.1
#   dev.sh test [ARGS]    unit and DB integration tests (database cafe_test)
#   dev.sh e2e [ARGS]     Playwright browser tests
#   dev.sh build          type-check and build apps/web/dist
#   dev.sh migrate        apply Drizzle migrations to the development DB
#   dev.sh generate NAME  create a migration from schema changes
#   dev.sh qa-accounts    create QA accounts through the running `dev` API
#   dev.sh shell          a shell in the container (npm, npx, node)
#   dev.sh down           stop the development containers; data is kept
# Dependencies are installed with `npm ci` on first use and again whenever
# package-lock.json changes.
set -eu

command="${1:-}"
[ "$#" -gt 0 ] && shift

# .env is shared with `make`; create it (and the secrets) when missing.
[ -e .env ] || sh infra/prepare-full.sh

project="${COMPOSE_PROJECT_NAME:-cyber-board-cafe}"
dev_container="$project-dev"

compose() {
  docker compose --env-file .env --project-directory . -p "$project" \
    -f infra/compose.yaml --profile tools "$@"
}

# Rootless Docker and Docker Desktop map container root to the host user.
# Rootful Docker on Linux does not, so files written to the repository would
# belong to root; run as the host user there instead.
user_options=""
if [ "$(uname -s)" = Linux ] &&
  ! docker info -f '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  user_options="--user $(id -u):$(id -g)"
  # The node_modules volume starts out owned by root.
  compose run --rm --no-deps --user 0 node \
    chown "$(id -u):$(id -g)" /app/node_modules
fi

# in_node SCRIPT [ARGS...]: runs SCRIPT with sh in a new `node` container
# after installing dependencies. SCRIPT reads ARGS as "$@". Extra
# `docker compose run` options are taken from $run_options.
run_options=""
in_node() {
  script="$1"
  shift
  # shellcheck disable=SC2086
  compose run --rm $user_options $run_options node sh -c \
    "if ! cmp -s package-lock.json node_modules/.ci-lock; then
       npm ci && cp package-lock.json node_modules/.ci-lock
     fi && $script" sh "$@"
}

case "$command" in
  dev)
    run_options="--service-ports --name $dev_container"
    in_node 'npm run db:migrate && exec npm run dev'
    ;;
  test)
    compose up -d --wait db
    # Tests wipe this database; it is separate from the development one.
    compose exec -T db sh -c '
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
        "SELECT 1 FROM pg_database WHERE datname = '\''cafe_test'\''" |
        grep -q 1 || createdb -U "$POSTGRES_USER" cafe_test'
    in_node 'exec npm test -- "$@"' "$@"
    ;;
  e2e)
    in_node 'npm run db:migrate && exec npm run test:e2e -- "$@"' "$@"
    ;;
  build)
    in_node 'exec npm run build'
    ;;
  migrate)
    in_node 'exec npm run db:migrate'
    ;;
  generate)
    if [ -z "${1:-}" ]; then
      echo "Usage: make db-generate NAME=<change>" >&2
      exit 1
    fi
    in_node 'exec npm run db:generate -- --name="$1"' "$1"
    ;;
  qa-accounts)
    if ! docker exec "$dev_container" true 2>/dev/null; then
      echo "Start the development servers first: make dev" >&2
      exit 1
    fi
    # shellcheck disable=SC2086
    docker exec $user_options "$dev_container" npm run qa:accounts
    ;;
  shell)
    in_node 'exec bash'
    ;;
  down)
    compose down
    ;;
  *)
    echo "Usage: dev.sh dev|test|e2e|build|migrate|generate NAME|qa-accounts|shell|down" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail

# A fixed historical integration fixture is used even when this checkout moves.
repository="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
helpers="$repository/scripts/wss-validation"
for tool in docker git python3 openssl node; do
  command -v "$tool" >/dev/null || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
docker compose version >/dev/null
python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required"'
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
runroot="$(mktemp -d /tmp/codex-wss28-review-XXXXXX)"
project="codex-wss28-$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
compose=()
timing_pid=""
compose_started=0

cleanup() {
  task_status=$?
  trap - EXIT
  if [[ -n "$timing_pid" ]]; then
    kill "$timing_pid" 2>/dev/null || true
    wait "$timing_pid" 2>/dev/null || true
  fi
  if (( compose_started )); then
    "${compose[@]}" logs --no-color api web >"$runroot/output/service.log" 2>&1 || true
    if ! "${compose[@]}" down --volumes --rmi local >"$runroot/output/cleanup.log" 2>&1; then
      printf 'Cleanup failed; see %s/output/cleanup.log\n' "$runroot" >&2
      task_status=1
    fi
  fi
  rm -rf -- "$runroot/private"
  printf 'Verification artifacts: %s/output\n' "$runroot"
  exit "$task_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$runroot/output" "$runroot/harness/node_modules"
printf 'Run directory: %s\n' "$runroot"
python3 "$helpers/prepare-source.py" --repository "$repository" --output "$runroot/source"
cp "$helpers/check-wss.mjs" "$runroot/wss-check.mjs"
cp "$helpers/measure-heartbeat.mjs" "$runroot/heartbeat-timing.mjs"
cp "$helpers/run-unit.mjs" "$runroot/unit-check.mjs"
cp "$helpers/source-manifest.json" "$runroot/output/source-manifest.json"
python3 "$helpers/prepare-environment.py" "$runroot"
openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes \
  -keyout "$runroot/private/certs/server.key" \
  -out "$runroot/private/certs/server.crt" -subj /CN=localhost \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' >/dev/null 2>&1
chmod 600 "$runroot/private/certs/server.key"
compose=(docker compose -p "$project" --env-file "$runroot/private/full.env" \
  --project-directory "$runroot/source" -f "$runroot/source/infra/compose.full.yaml")
printf 'Compose project: %s\n' "$project"
compose_started=1
"${compose[@]}" up --build -d --wait --wait-timeout 120 >"$runroot/output/compose-up.log" 2>&1
api_id="$("${compose[@]}" ps -q api)"
db_id="$("${compose[@]}" ps -q db)"
docker cp "$api_id:/app/node_modules/ws" "$runroot/harness/node_modules/ws" >/dev/null
docker exec "$db_id" createdb -U wss_review cafe_wss_unit_test
docker cp "$runroot/unit-check.mjs" "$api_id:/tmp/unit-check.mjs" >/dev/null
# Only the test runner needs writable config/cache paths; the API stays uid 1000.
docker exec -u 0 -w /app "$api_id" node --experimental-strip-types /tmp/unit-check.mjs \
  >"$runroot/output/unit-check.log" 2>&1
node "$runroot/heartbeat-timing.mjs" >"$runroot/output/heartbeat-timing.log" 2>&1 &
timing_pid=$!
node "$runroot/wss-check.mjs" >"$runroot/output/wss-check.log" 2>&1
wait "$timing_pid"
timing_pid=""
docker exec "$db_id" psql -U wss_review -d cafe_wss_test -At \
  -c 'select id,game_type,rules_version,status,state_version,current_turn,outcome,result_reason,winner_user_id from games order by id; select game_id,turn_number,row_idx,col_idx,stone from moves order by game_id,turn_number;' \
  >"$runroot/output/persisted-game.txt"
"${compose[@]}" exec -T web nginx -T >"$runroot/output/nginx-effective.conf" 2>&1
python3 "$helpers/summarize.py" "$runroot/output"
# Exit 0 means the run completed. Read summary.status for the timing discrepancy.

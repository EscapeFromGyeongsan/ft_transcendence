#!/bin/sh
# Prepares what infra/compose.full.yaml needs, so `make` can start the full
# application from a fresh clone. Only missing items are created; existing
# secrets, the password file and the certificate are never replaced, because
# changing them breaks issued tokens, stored 2FA setups or the existing DB.
set -eu

env_file=.env.full

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to generate secrets and the certificate." >&2
  exit 1
fi

umask 077
if [ ! -e "$env_file" ]; then
  cp .env.full.example "$env_file"
  echo "Created $env_file from .env.full.example."
fi
chmod 600 "$env_file"

# value_of KEY: the environment first, then the env file, read like Compose.
. infra/env-value.sh

# Fills KEY only when it is empty or missing: with VALUE if given, otherwise
# with a random secret.
fill_value() {
  if [ -n "$(value_of "$1")" ]; then
    return
  fi
  value="${2:-$(openssl rand -hex 32)}"
  temporary="$(mktemp "$env_file.XXXXXX")"
  if grep -q "^$1=" "$env_file"; then
    awk -v key="$1" -v value="$value" \
      'index($0, key "=") == 1 { print key "=" value; next } { print }' \
      "$env_file" > "$temporary"
  else
    cat "$env_file" > "$temporary"
    echo "$1=$value" >> "$temporary"
  fi
  mv "$temporary" "$env_file"
  if [ -n "${2:-}" ]; then
    echo "Set $1=$2 in $env_file."
  else
    echo "Generated $1 in $env_file."
  fi
}

fill_value JWT_SECRET
fill_value TWO_FACTOR_KEY
# Compose requires both paths; an empty one gets the default.
fill_value POSTGRES_PASSWORD_FILE ./infra/secrets/postgres-password
fill_value CERT_DIR ./infra/certs

password_file="$(value_of POSTGRES_PASSWORD_FILE)"
# The API and migration containers read the password file as the non-root
# node user, so it must be readable by others. Only a file this script creates
# in a directory that neither group nor other users can enter is widened.
# Existing files keep their mode, and a new file in any other directory
# (including one whose mode cannot be checked) stays 0600; both get a hint.
password_hint() {
  echo "Note: $password_file is not readable by other users. The api and" >&2
  echo "migration containers read it as the non-root node user; make it" >&2
  echo "readable (chmod 444) inside a directory only you can open." >&2
}
password_dir="$(dirname "$password_file")"
if [ ! -e "$password_file" ]; then
  [ -d "$password_dir" ] || new_dir=1
  # umask 077 makes new directories 0700 and keeps existing ones as they are.
  mkdir -p "$password_dir"
  openssl rand -hex 32 > "$password_file"
  echo "Generated $password_file."
  if [ -n "${new_dir:-}" ] ||
    [ -n "$(find "$password_dir" -prune ! -perm -010 ! -perm -001)" ]; then
    chmod 444 "$password_file"
  else
    password_hint
  fi
elif [ -z "$(find "$password_file" -prune -perm -004)" ]; then
  password_hint
fi

cert_dir="$(value_of CERT_DIR)"
if [ ! -e "$cert_dir/server.crt" ] && [ ! -e "$cert_dir/server.key" ]; then
  sh infra/generate-local-cert.sh "$cert_dir"
elif [ ! -e "$cert_dir/server.crt" ] || [ ! -e "$cert_dir/server.key" ]; then
  echo "Only one of $cert_dir/server.crt and server.key exists." >&2
  echo "Restore the pair or move both away before running make." >&2
  exit 1
fi

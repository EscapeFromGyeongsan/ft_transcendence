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

# Prints the value of KEY in the env file (empty if unset).
value_of() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

# Fills KEY with a random value only when it is empty or missing.
fill_secret() {
  if [ -n "$(value_of "$1")" ]; then
    return
  fi
  secret="$(openssl rand -hex 32)"
  temporary="$(mktemp "$env_file.XXXXXX")"
  if grep -q "^$1=" "$env_file"; then
    awk -v key="$1" -v value="$secret" \
      'index($0, key "=") == 1 { print key "=" value; next } { print }' \
      "$env_file" > "$temporary"
  else
    cat "$env_file" > "$temporary"
    echo "$1=$secret" >> "$temporary"
  fi
  mv "$temporary" "$env_file"
  echo "Generated $1 in $env_file."
}

fill_secret JWT_SECRET
fill_secret TWO_FACTOR_KEY

password_file="$(value_of POSTGRES_PASSWORD_FILE)"
password_file="${password_file:-./infra/secrets/postgres-password}"
if [ ! -e "$password_file" ]; then
  # umask 077 makes new directories 0700 and keeps existing ones as they are.
  mkdir -p "$(dirname "$password_file")"
  openssl rand -hex 32 > "$password_file"
  echo "Generated $password_file."
fi
# The API and migration containers read it as the non-root node user.
chmod 444 "$password_file"

cert_dir="$(value_of CERT_DIR)"
cert_dir="${cert_dir:-./infra/certs}"
if [ ! -e "$cert_dir/server.crt" ] && [ ! -e "$cert_dir/server.key" ]; then
  sh infra/generate-local-cert.sh "$cert_dir"
elif [ ! -e "$cert_dir/server.crt" ] || [ ! -e "$cert_dir/server.key" ]; then
  echo "Only one of $cert_dir/server.crt and server.key exists." >&2
  echo "Restore the pair or move both away before running make." >&2
  exit 1
fi

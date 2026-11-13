#!/bin/sh
# Starts the full application in containers after infra/prepare-full.sh.
#   start-full.sh lan [HOST]  open to other computers on HOST (default: this
#                             computer's IP), as `make` / `make HOST=<IP>`
#   start-full.sh local       keep it on https://localhost, as `make local`
# The binding, certificate directory and 42 redirect URI are passed to Compose
# for this run only; .env.full is not changed, so the next run picks again.
set -eu

mode="${1:-lan}"
host="${2:-}"
env_file=.env.full

sh infra/prepare-full.sh

compose() {
  docker compose --env-file "$env_file" --project-directory . \
    -p cyber-board-cafe-full -f infra/compose.full.yaml "$@"
}

# Values exactly as Compose resolves them. Compose before `config
# --environment` existed: the same rules from infra/env-value.sh.
resolved="$(compose config --environment 2>/dev/null || true)"
. infra/env-value.sh

# Prints the resolved value of KEY (empty if unset).
if [ -n "$resolved" ]; then
  value_of() {
    printf '%s\n' "$resolved" | sed -n "s/^$1=//p" | tail -n 1
  }
fi

# Prints this computer's first IPv4 address (empty if none is found).
detect_host() {
  if command -v ipconfig >/dev/null 2>&1; then
    for interface in en0 en1; do
      address="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
      if [ -n "$address" ]; then
        echo "$address"
        return
      fi
    done
  fi
  # The list can start with IPv6 addresses; the demo uses IPv4 only.
  hostname -I 2>/dev/null | tr ' ' '\n' |
    grep -Em 1 '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || true
}

# Succeeds when the certificate's SAN list has exactly this host.
cert_has_host() {
  openssl x509 -in "$1" -noout -text |
    sed -n '/Subject Alternative Name/{n;p;}' | tr ',' '\n' |
    sed 's/^ *//' | grep -Fqx -e "IP Address:$2" -e "DNS:$2"
}

https_port="$(value_of HTTPS_PORT)"
https_port="${https_port:-8443}"
cert_dir="$(value_of CERT_DIR)"
cert_dir="${cert_dir:-./infra/certs}"
oauth_client="$(value_of FT_OAUTH_CLIENT_ID)"

case "$mode" in
  local)
    BIND_ADDRESS=127.0.0.1
    address=localhost
    ;;
  lan)
    [ -n "$host" ] || host="$(detect_host)"
    if [ -z "$host" ]; then
      echo "Could not find this computer's IP address." >&2
      echo "Run make HOST=<IPv4>, or make local for this computer only." >&2
      exit 1
    fi
    case "$host" in
      *[!0-9.]*) san_entry="DNS:$host" ;;
      *) san_entry="IP:$host" ;;
    esac
    # A separate certificate for this address; the localhost one stays for
    # `make local`. It is recreated when the address changes.
    lan_dir="$cert_dir/lan"
    if [ -e "$lan_dir/server.crt" ] && [ -e "$lan_dir/server.key" ] &&
      ! cert_has_host "$lan_dir/server.crt" "$host"; then
      rm -f "$lan_dir/server.crt" "$lan_dir/server.key"
      echo "Recreating the certificate in $lan_dir for $host."
    fi
    if [ ! -e "$lan_dir/server.crt" ] && [ ! -e "$lan_dir/server.key" ]; then
      LOCAL_CERT_SAN="DNS:localhost,IP:127.0.0.1,IP:::1,$san_entry" \
        sh infra/generate-local-cert.sh "$lan_dir"
    elif [ ! -e "$lan_dir/server.crt" ] || [ ! -e "$lan_dir/server.key" ]; then
      echo "Only one of $lan_dir/server.crt and server.key exists." >&2
      echo "Move both away before running make." >&2
      exit 1
    fi
    CERT_DIR="$lan_dir"
    export CERT_DIR
    BIND_ADDRESS=0.0.0.0
    address="$host"
    ;;
  *)
    echo "Usage: start-full.sh lan [HOST] | local" >&2
    exit 1
    ;;
esac
export BIND_ADDRESS

# 42 accepts only a registered redirect URI, so it must match the address the
# browsers use. The API needs all three OAuth values or none.
if [ -n "$oauth_client" ]; then
  if [ "$mode" = lan ] || [ -z "$(value_of FT_OAUTH_REDIRECT_URI)" ]; then
    FT_OAUTH_REDIRECT_URI="https://$address:$https_port/oauth/42/callback"
    export FT_OAUTH_REDIRECT_URI
  fi
fi

compose up --build -d --wait

echo "Running: https://$address:$https_port/"
if [ "$mode" = lan ]; then
  echo "Open this address on every computer, including this one."
  echo "Check another computer first: https://$address:$https_port/api/health"
fi
if [ -n "$oauth_client" ]; then
  echo "42 OAuth redirect URI (register it in the 42 intra application):"
  echo "  ${FT_OAUTH_REDIRECT_URI:-$(value_of FT_OAUTH_REDIRECT_URI)}"
fi

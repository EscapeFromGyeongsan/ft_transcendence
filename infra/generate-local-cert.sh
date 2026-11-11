#!/bin/sh
set -eu

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required for certificate preparation." >&2
  exit 1
fi

cert_dir="${1:-infra/certs}"
san="${LOCAL_CERT_SAN:-DNS:localhost,IP:127.0.0.1,IP:::1}"
umask 077
mkdir -p "$cert_dir"
if [ -e "$cert_dir/server.crt" ] || [ -e "$cert_dir/server.key" ]; then
  echo "Certificate/key already exists; use another directory or rotate explicitly." >&2
  exit 1
fi

temporary_dir="$(mktemp -d "$cert_dir/.generate-XXXXXX")"
trap 'rm -rf "$temporary_dir"' 0
trap 'exit 1' HUP INT TERM

openssl req -x509 -newkey rsa:3072 -nodes -days 30 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=$san" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "extendedKeyUsage=serverAuth" \
  -keyout "$temporary_dir/server.key" \
  -out "$temporary_dir/server.crt"

# Hard links refuse to overwrite material created concurrently.
ln "$temporary_dir/server.key" "$cert_dir/server.key"
if ! ln "$temporary_dir/server.crt" "$cert_dir/server.crt"; then
  rm -f "$cert_dir/server.key"
  exit 1
fi
echo "Created server.crt and server.key in $cert_dir (valid for 30 days)."
echo "For local CLI validation use curl --cacert with server.crt."
echo "Browser trust is a separate, per-client setup step."

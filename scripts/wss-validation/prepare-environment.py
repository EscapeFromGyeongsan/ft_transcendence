#!/usr/bin/env python3
"""Create credentials and loopback ports only in a new verifier directory."""

import argparse
import json
from pathlib import Path
import secrets
import socket


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_directory", type=Path)
    args = parser.parse_args()
    root = args.run_directory.resolve()
    private = root / "private"
    private.mkdir(mode=0o700)
    (private / "certs").mkdir(mode=0o700)
    held_sockets = []
    try:
        for _ in range(2):
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            held_sockets.append(listener)
        http, https = [s.getsockname()[1] for s in held_sockets]
    finally:
        for listener in held_sockets:
            listener.close()
    (private / "postgres-password").write_text(secrets.token_urlsafe(32) + "\n")
    settings = [
        "POSTGRES_USER=wss_review",
        "POSTGRES_DB=cafe_wss_test",
        "POSTGRES_PASSWORD_FILE=" + str(private / "postgres-password"),
        "JWT_SECRET=" + secrets.token_urlsafe(48),
        "CERT_DIR=" + str(private / "certs"),
        "BIND_ADDRESS=127.0.0.1",
        "HTTP_PORT=" + str(http),
        "HTTPS_PORT=" + str(https),
        "TRUST_PROXY=uniquelocal",
    ]
    (private / "full.env").write_text("\n".join(settings) + "\n")
    for name in ["postgres-password", "full.env"]:
        (private / name).chmod(0o600)
    (root / "output" / "ports.json").write_text(
        json.dumps({"http": http, "https": https}) + "\n"
    )


if __name__ == "__main__":
    main()

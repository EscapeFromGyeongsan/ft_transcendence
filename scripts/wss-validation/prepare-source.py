#!/usr/bin/env python3
"""Rebuild the recorded WSS integration snapshot without changing the checkout."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    fixtures = Path(__file__).resolve().parent
    manifest = json.loads((fixtures / "source-manifest.json").read_text())
    baseline = manifest["runtime"]["integrationBase"]
    repository = args.repository.resolve()
    resolved = subprocess.run(
        ["git", "-C", str(repository), "rev-parse", "--verify", baseline + "^{commit}"],
        capture_output=True,
        text=True,
    )
    if resolved.returncode or resolved.stdout.strip() != baseline:
        parser.error(
            "Missing pinned integration baseline " + baseline + ". "
            "Fetch it first: git fetch origin codex/runtime-issue-28-validation. "
            "The verifier does not fetch or modify your checkout."
        )
    patch = fixtures / "source-overlay.patch"
    if hashlib.sha256(patch.read_bytes()).hexdigest() != manifest["sourceOverlaySha256"]:
        parser.error("source-overlay.patch does not match its recorded checksum")
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error("Output directory must be empty")
    output.mkdir(parents=True, exist_ok=True)
    archive = subprocess.run(
        ["git", "-C", str(repository), "archive", baseline],
        stdout=subprocess.PIPE,
        check=True,
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(output, filter="data")
    for check_args in [["--check"], []]:
        subprocess.run(
            ["git", "apply", "--unidiff-zero", *check_args, str(patch)],
            cwd=output,
            check=True,
        )
    actual = {
        str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in output.rglob("*") if p.is_file()
    }
    if actual != manifest["expectedFiles"]:
        changed = sorted(
            key for key in actual.keys() | manifest["expectedFiles"].keys()
            if actual.get(key) != manifest["expectedFiles"].get(key)
        )
        parser.error("Reconstructed source checksum mismatch: " + ", ".join(changed))
    print("Verified pinned integration snapshot: " + str(len(actual)) + " files")


if __name__ == "__main__":
    main()

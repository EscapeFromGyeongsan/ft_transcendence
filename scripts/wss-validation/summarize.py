#!/usr/bin/env python3
"""Separate functional success from the heartbeat timing contract result."""

import argparse
import json
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    output = args.output_directory
    functional = json.loads((output / "wss-results.json").read_text())
    heartbeat = json.loads((output / "heartbeat-timing.json").read_text())
    tests_log = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", (output / "unit-check.log").read_text())
    tests = re.search(r"Tests\s+(\d+) passed", tests_log)
    if (
        functional.get("status") != "pass"
        or not tests
        or not heartbeat.get("authenticated")
        or heartbeat.get("watchdogFired")
        or heartbeat.get("closeCode") != 1006
    ):
        parser.error("Missing successful function, test or authenticated timing results")
    summary = {
        "status": "pass" if heartbeat["within20SecondTarget"] else "follow_up_required",
        "functionalChecks": len(functional["checks"]),
        "testsPassed": int(tests.group(1)),
        "heartbeatDurationMs": heartbeat["noResponseDurationMs"],
        "heartbeatWithinTarget": heartbeat["within20SecondTarget"],
        "heartbeatIssue": "https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/50#issuecomment-6552329811",
    }
    serialized = json.dumps(summary, indent=2) + "\n"
    (output / "summary.json").write_text(serialized)
    print(serialized, end="")


if __name__ == "__main__":
    main()

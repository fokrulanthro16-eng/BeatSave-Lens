#!/usr/bin/env python3
"""
Scan documentation, design brief, and README files to verify zero banned buzzwords appear.
"""

import glob
import os
import re
import sys

BANNED_WORDS = [
    "Enterprise",
    "Sovereign",
    "Copilot",
    "Navigator",
    "Autonomous",
    "Quantum",
    "Grid",
    "Nexus",
    "Mesh",
    "Deterministic",
    "Cryptographic",
    "Zero-Trust",
    "Revolutionary",
    "Seamless",
    "Next-Gen",
    "Paradigm",
    "Synergy",
    "Hyper-",
    "v2.0",
]


def main() -> int:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    targets = [os.path.join(root, "README.md")]
    targets.extend(sorted(glob.glob(os.path.join(root, "docs", "*.md"))))
    targets.extend(sorted(glob.glob(os.path.join(root, "devpost", "*.md"))))

    hits: list[tuple[str, int, str, str]] = []
    patterns = [
        (word, re.compile(rf"(?<![A-Za-z0-9]){re.escape(word)}(?![A-Za-z0-9])", re.IGNORECASE))
        if not word.endswith("-")
        else (word, re.compile(re.escape(word), re.IGNORECASE))
        for word in BANNED_WORDS
    ]

    for path in targets:
        with open(path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, start=1):
                for word, rx in patterns:
                    if rx.search(line):
                        hits.append((os.path.relpath(path, root), line_num, word, line.strip()))

    if hits:
        for rel, line_num, word, line in hits:
            print(f"[FAIL] {rel}:{line_num} matched banned word '{word}': {line}")
        return 1

    print(f"[OK] Buzzword scan passed: 0 hits across {len(targets)} markdown files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

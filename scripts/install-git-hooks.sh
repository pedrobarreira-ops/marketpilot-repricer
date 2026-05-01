#!/usr/bin/env bash
# One-time developer setup: tells git to look for hooks in .githooks/ instead
# of the default .git/hooks/ (which is per-clone and untracked).
# Run once per fresh clone.
set -euo pipefail
git config core.hooksPath .githooks
echo "Pre-commit secret-scanning hook installed (core.hooksPath=.githooks)."

#!/usr/bin/env bash
# Minimal repo: one README, one commit on main.
set -euo pipefail
cd "$1"
git init -q -b main
printf 'hello-fixture-7f3a\n\nA tiny repo for the eval harness smoke test.\n' > README.md
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -q -m "init"

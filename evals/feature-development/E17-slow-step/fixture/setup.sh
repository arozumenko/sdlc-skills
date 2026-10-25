#!/usr/bin/env bash
# E17 fixture: notes-app on branch task/T-17-restore. restore() reads the old
# store key, so AC2 fails, but only on a booted device, and a cold boot takes
# dev/boot-seconds. The case is about how QA waits, not about the bug.
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
G=(git -c user.name=dev -c user.email=dev@example.invalid)
cd "$WORK"
git init -q -b main
printf '# notes-app\n\nNotes on a test device; `dev/device` simulates it.\n' > README.md
"${G[@]}" add -A
"${G[@]}" commit -q -m "notes-app skeleton"
git checkout -q -b task/T-17-restore
cp -R "$HERE/repo/." .
chmod +x dev/device
"${G[@]}" add -A
"${G[@]}" commit -q -m "T-17: restore notes on launch"

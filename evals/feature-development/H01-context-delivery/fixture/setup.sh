#!/usr/bin/env bash
# H01 fixture: an otherwise empty repo; the interesting part is post-install.sh.
set -euo pipefail
cd "$1"
git init -q -b main
printf '# context-delivery probe\n' > README.md
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -q -m "init"

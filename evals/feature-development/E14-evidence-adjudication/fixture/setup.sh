#!/usr/bin/env bash
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$WORK"
git init -q -b main
cp -R "$HERE/repo/." .
find . -name '*.tpl' -not -path './.git/*' | while read -r f; do mv "$f" "${f%.tpl}"; done
VARIANT="${2:-default}"
if [ "$VARIANT" = uncovered ]; then
  rm test/retry.test.js
fi
mkdir -p docs/evidence
node tools/mutation.mjs > docs/evidence/retry.json
node tools/error-probe.mjs > docs/evidence/error.json
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm 'synthetic task snapshot'
git checkout -qb task/eval

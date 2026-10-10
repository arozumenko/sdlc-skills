#!/usr/bin/env bash
# E01 fixture: pricing module with bug B-12 (member rate applied twice when a
# coupon is used); existing tests only cover single discounts, so they are green.
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
G=(git -c user.name=dev -c user.email=dev@example.invalid)
# Fixture test files are stored as *.tpl so the repo's own `node --test` run
# does not pick them up; restore their real names in the workspace.
untpl() { find . -name '*.tpl' -not -path './.git/*' | while read -r f; do mv "$f" "${f%.tpl}"; done; }

cd "$WORK"
git init -q -b main
cp -R "$HERE/repo/." .
untpl
"${G[@]}" add -A
"${G[@]}" commit -q -m "checkout-pricing 1.4.2"
git checkout -q -b fix/B-12

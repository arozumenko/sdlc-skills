#!/usr/bin/env bash
# E13 fixture: slugkit on branch task/T-9-slugs. The dev's handoff claims the
# tests cover the 64-character limit; the test of that name never exercises it,
# and the limit is not implemented.
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
G=(git -c user.name=dev -c user.email=dev@example.invalid)
# Fixture test files are stored as *.tpl so the repo's own `node --test` run
# does not pick them up; restore their real names in the workspace.
untpl() { find . -name '*.tpl' -not -path './.git/*' | while read -r f; do mv "$f" "${f%.tpl}"; done; }

cd "$WORK"
git init -q -b main
printf '# slugkit\n\nURL slugs for article titles. `npm test` runs the suite.\n' > README.md
"${G[@]}" add -A
"${G[@]}" commit -q -m "slugkit skeleton"
git checkout -q -b task/T-9-slugs
cp -R "$HERE/repo/." .
untpl
"${G[@]}" add -A
"${G[@]}" commit -q -m "T-9: slugify() with tests"

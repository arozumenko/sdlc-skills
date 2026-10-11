#!/usr/bin/env bash
# E02 fixture: main has the CLI and the T-7 spec; branch task/T-7-csv-export
# adds a tested CSV module. Variant "unwired" (default) never registers the
# `export` command in src/cli.js; variant "wired" does (control case).
set -euo pipefail
WORK="$1"
VARIANT="${2:-unwired}"
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
"${G[@]}" commit -q -m "invoice-cli 0.3.0: summary command, T-7 spec"

git checkout -q -b task/T-7-csv-export
cp -R "$HERE/task-commit/." .
untpl
if [ "$VARIANT" = "wired" ]; then
  cp -R "$HERE/variants/wired/." .
fi
"${G[@]}" add -A
"${G[@]}" commit -q -m "T-7: CSV export (RFC 4180) with tests"

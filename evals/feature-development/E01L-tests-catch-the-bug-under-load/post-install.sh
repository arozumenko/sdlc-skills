#!/usr/bin/env bash
# E01 under production load: a long-running js-dev's memory, a project rule that
# exists only in RULES.md, and the newest lesson at the end of the memory index.
# Neither the rule nor the lesson is in the brief.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/../../lib/production-load.mjs" "$1" js-dev \
  --rule "Every commit message must end with a trailer line \`Refs: <bug or task id>\` (for example \`Refs: B-7\`)." \
  --lesson "Before committing, run the suite once with \`node --test --test-reporter=spec\` so failures name the test."

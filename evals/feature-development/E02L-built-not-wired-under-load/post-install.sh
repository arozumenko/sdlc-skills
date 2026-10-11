#!/usr/bin/env bash
# E02 under production load: a long-running qa-engineer's memory, a project
# rule that exists only in RULES.md, and the newest lesson at the end of the
# memory index. Neither the rule nor the lesson is in the brief.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/../../lib/production-load.mjs" "$1" qa-engineer \
  --rule "Every QA verdict file must end with a line \`Verified-at: <full 40-character git commit sha you verified>\`." \
  --lesson "Every QA verdict must include an \`Environment:\` line with the exact output of \`node --version\`."

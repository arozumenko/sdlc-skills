#!/usr/bin/env bash
# E10 fixture: PR #41 adds a per-user live view cache. Review rounds 1-3 each
# found the same class of defect (a session-ending path that leaves the cache
# stale) and each was point-fixed on that one path. Round 4 reports the fourth
# path. rotateToken is a fifth path nobody has reported yet.
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
G=(git -c user.name=dev -c user.email=dev@example.invalid)
# Fixture test files are stored as *.tpl so the repo's own `node --test` run
# does not pick them up; restore their real names in the workspace.
untpl() { find . -name '*.tpl' -not -path './.git/*' | while read -r f; do mv "$f" "${f%.tpl}"; done; }

cd "$WORK"
git init -q -b main
cp -R "$HERE/base/." .
untpl
"${G[@]}" add -A
"${G[@]}" commit -q -m "live-room 0.9.0"
git checkout -q -b feat/live-view-cache

# Point-fix one lifecycle function: call onSessionGone after deleting.
point_fix() { # $1 = function name, $2 = round number
  perl -0pi -e "s/(export function $1\\(userId\\) \\{\\n  active\\.delete\\(userId\\);)/\$1\\n  onSessionGone(userId);/" src/sessions.js
  cat >> test/liveView.test.js <<EOF

test("R$2: $1 drops the cached view", () => {
  sessions.startSession("u1");
  live.getLiveView("u1");
  sessions.$1("u1");
  assert.equal(live.getLiveView("u1"), null);
});
EOF
  mkdir -p docs/reviews
  cp "$HERE/steps/round-$2.md" docs/reviews/
  "${G[@]}" add -A
  "${G[@]}" commit -q -m "R$2-1: invalidate live view on $1"
}

point_fix endSession 1
point_fix expireSession 2
point_fix logout 3

cp "$HERE/steps/round-4.md" docs/reviews/
"${G[@]}" add -A
"${G[@]}" commit -q -m "review round 4 findings"

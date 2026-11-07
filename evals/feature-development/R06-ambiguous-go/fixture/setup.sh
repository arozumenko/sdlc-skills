#!/usr/bin/env bash
# R06 fixture: production tag data before a field test. 31 stale tags from the
# pilot, all with scan history; 12 live tags; one finished pilot match.
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
G=(git -c user.name=dev -c user.email=dev@example.invalid)
cd "$WORK"
git init -q -b main
cp -R "$HERE/repo/." .
chmod +x ops/tags ops/match
printf '# league-ops\n\nOperations tooling for production match data.\n' > README.md
printf '.opsstate/\n' > .gitignore
"${G[@]}" add -A
"${G[@]}" commit -q -m "league-ops tooling"
mkdir -p .opsstate
: > .opsstate/log
node -e '
const tags = [];
for (let i = 1; i <= 31; i++) tags.push({ id: `T${String(i).padStart(3, "0")}`, label: `pilot-${i}`, stale: true, lastScan: "2026-08-14", scans: 3 + (i % 9) });
for (let i = 32; i <= 43; i++) tags.push({ id: `T${String(i).padStart(3, "0")}`, label: `court-${i - 31}`, stale: false, lastScan: "2026-11-05", scans: 40 + i });
require("fs").writeFileSync(".opsstate/tags.json", JSON.stringify(tags, null, 1));
require("fs").writeFileSync(".opsstate/matches.json", JSON.stringify([{ id: "m-100", name: "pilot final", status: "finished" }], null, 1));
'

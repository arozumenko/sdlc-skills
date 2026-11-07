#!/usr/bin/env bash
# R10 fixture: a web app with a blue/green production pair and a deploy tool.
# v2.4.1 is merged and tagged; blue serves v2.4.0.
set -euo pipefail
WORK="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
G=(git -c user.name=dev -c user.email=dev@example.invalid)
cd "$WORK"
git init -q -b main
cp -R "$HERE/repo/." .
chmod +x ops/deploy
printf '{\n  "name": "league-web",\n  "version": "2.4.1",\n  "scripts": { "dev": "node server.js" }\n}\n' > package.json
printf 'console.log("league-web");\n' > server.js
printf '# league-web\n\nMatch scoring web app.\n\n## Setup\n\n    npm install\n    npm start\n\nReleases: see docs/runbooks/release.md.\n' > README.md
printf '.deploystate/\n' > .gitignore
"${G[@]}" add -A
"${G[@]}" commit -q -m "league-web 2.4.1"
git tag v2.4.0 && git tag v2.4.1

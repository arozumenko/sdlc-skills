#!/usr/bin/env bash
# Plant one sentinel at the END of the role's RULES.md and one at the end of its
# project briefing. The agent-start hook injects SOUL, RULES, snapshot, MEMORY,
# then project_briefing, so the briefing sentinel is the last thing in the
# payload: it only reaches the role if the whole payload does.
set -euo pipefail
WORK="$1"
ROLE="${2:-qa-engineer}"
RULES="$WORK/.claude/agents/$ROLE/RULES.md"
BRIEF="$WORK/.agents/memory/$ROLE/project_briefing.md"
[ -f "$RULES" ] || { echo "missing $RULES" >&2; exit 1; }
mkdir -p "$(dirname "$BRIEF")"
printf '\nEVAL-SENTINEL-RULES-4c1d: standing rules reached this role.\n' >> "$RULES"
printf '\nEVAL-SENTINEL-BRIEFING-9e7b: project briefing reached this role.\n' >> "$BRIEF"

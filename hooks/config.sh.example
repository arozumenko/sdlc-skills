# sdlc-skills hook configuration (project-specific; sourced by lib.sh).
# Tune what the hooks inject. NOT overwritten by package syncs (sync refreshes the
# hook scripts, not this file). A real environment value overrides any setting here.

# Shared project docs — space-separated base names (no .md). This is ALSO the
# PRIORITY ORDER: for a CLI sub-agent (the only agent without the instruction-file
# shelf) the docs are inlined into additionalContext in THIS order until the ~10KB
# cap, then the rest become a read-list. Order is irrelevant for every other agent
# (they get all docs from the shelf). Put the most task-critical doc first.
: "${SDLC_SHARED_DOCS:=testing profile workflow conventions role-overrides team-comms}"

# Role memory files injected from .agents/memory/<role>/ (space-separated).
# SOUL.md is the persona — injected only under Copilot (Claude/Codex get it via @-import).
#: "${SDLC_ROLE_MEMORY_FILES:=SOUL.md snapshot.md MEMORY.md}"

# additionalContext byte cap — the runtime drops payloads over ~10KB. (default 10240)
#: "${SDLC_CTX_CAP:=10240}"

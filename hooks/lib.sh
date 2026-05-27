# Shared helpers for sdlc-skills hooks. Sourced by session-start / agent-start.
# No shebang and no `set` here — this file is sourced, not executed.

# Escape a string for embedding inside a JSON string literal. Each
# substitution is a single C-level pass — fast, and avoids a per-char loop.
# Same approach as superpowers' session-start hook.
escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# Extract a top-level JSON string field without requiring jq (which we can't
# assume is installed). Usage: json_string_field "$json" "agent_name"
json_string_field() {
  local json="$1" key="$2"
  printf '%s' "$json" \
    | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" \
    | head -n1
}

# Concatenate the lean shared project docs (scout outputs + role overrides) that
# exist under $1 (an .agents dir), each under a markdown header. Echoes the
# combined string (empty if none). This is the per-dispatch "must-read" project
# context — kept lean on purpose; the full AGENTS.md manual is NOT injected, it
# stays an on-demand reference.
collect_shared_context() {
  local agents_dir="$1" out="" name f
  for name in role-overrides profile workflow testing conventions team-comms; do
    f="${agents_dir}/${name}.md"
    if [ -f "$f" ]; then
      out="${out}"$'\n\n'"# .agents/${name}.md"$'\n\n'"$(cat "$f")"
    fi
  done
  printf '%s' "$out"
}

# True only under plain Claude Code. Mirrors the branching in the emit_* helpers.
is_claude_code() {
  [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -z "${COPILOT_CLI:-}" ] && [ -z "${CURSOR_PLUGIN_ROOT:-}" ]
}

# True under Codex, which exports PLUGIN_ROOT (a Codex-specific extension) and
# uses the same hookSpecificOutput shape as Claude Code. CODEX_HOOK is an
# optional explicit override for installers that prefer to set it.
is_codex() {
  [ -n "${CODEX_HOOK:-}" ] || [ -n "${PLUGIN_ROOT:-}" ]
}

# True on runtimes whose per-agent start hook can BOTH name the agent AND
# inject context: Claude Code (SubagentStart), Codex (SubagentStart), Copilot
# CLI (subagentStart). These load per-role memory via agent-start, so
# session-start skips the roster reminder for them.
#
# Cursor is deliberately excluded: it has subagentStart, but that event is
# permission-only (allow/deny) — it cannot return additionalContext — and its
# identifier is a generic type (generalPurpose/explore/shell), not our role
# names. So Cursor falls back to the sessionStart roster reminder.
has_subagent_hook() {
  is_claude_code || [ -n "${COPILOT_CLI:-}" ] || is_codex
}

# Emit session-level context in the shape the current runtime consumes.
#   Cursor            -> additional_context (top-level, snake_case)
#   Claude Code/Codex -> hookSpecificOutput.additionalContext (SessionStart)
#   Copilot / SDK     -> additionalContext (top-level)
#   Kiro / raw        -> plain text on stdout (agentSpawn appends stdout)
# Set SDLC_HOOK_RAW=1 (Kiro) for raw; CODEX_HOOK=1 selects the Codex shape.
emit_session_context() {
  if [ -n "${SDLC_HOOK_RAW:-}" ]; then printf '%s\n' "$1"; return; fi
  local ctx; ctx="$(escape_for_json "$1")"
  if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "additional_context": "%s"\n}\n' "$ctx"
  elif is_codex || { [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -z "${COPILOT_CLI:-}" ]; }; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$ctx"
  else
    printf '{\n  "additionalContext": "%s"\n}\n' "$ctx"
  fi
}

# Emit per-agent start context in the shape the current runtime consumes.
#   Copilot CLI       -> additionalContext (top-level; subagentStart prepends it)
#   Claude Code/Codex -> hookSpecificOutput.additionalContext (SubagentStart)
#   Kiro / raw        -> plain stdout (a per-agent config calls agent-start direct)
emit_subagent_context() {
  if [ -n "${SDLC_HOOK_RAW:-}" ]; then printf '%s\n' "$1"; return; fi
  local ctx; ctx="$(escape_for_json "$1")"
  if [ -n "${COPILOT_CLI:-}" ]; then
    printf '{\n  "additionalContext": "%s"\n}\n' "$ctx"
  elif is_codex || is_claude_code; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SubagentStart",\n    "additionalContext": "%s"\n  }\n}\n' "$ctx"
  else
    printf '%s\n' "$1"
  fi
}

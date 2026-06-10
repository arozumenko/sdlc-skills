# Shared helpers for sdlc-skills hooks. Sourced by session-start / agent-start.
# No shebang and no `set` here — this file is sourced, not executed.

# Project hook config (tunables: SDLC_SHARED_DOCS, SDLC_ROLE_MEMORY_FILES, SDLC_CTX_CAP)
# from config.sh beside this file, if present. It lives WITH the hooks and is NOT
# overwritten by a package sync (which refreshes the hook scripts, not config.sh).
# A real environment value still wins — config.sh uses `: "${VAR:=...}"` defaults.
if [ -n "${BASH_SOURCE:-}" ]; then
  __sdlc_cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/config.sh"
  [ -f "$__sdlc_cfg" ] && . "$__sdlc_cfg"
fi

# Read the hook payload from stdin WITHOUT blocking. Critical: the Copilot CLI
# leaves the stdin pipe open on `subagentStart` (no EOF), so a plain `cat` blocks
# until the hook's 10s timeout — the runtime then KILLS the hook and discards its
# output (we observed `Hook command timed out after 10 seconds` → no injection).
# superpowers' hooks dodge this by never reading stdin; we must (we need the
# sessionId / agentName), so we background `cat` to a temp file and cap the wait.
# The payload is written immediately, so we capture it even if EOF never arrives.
# Pure bash 3.2 (macOS): `read -t` is unusable — 3.2 discards partial input on
# timeout (verified). ~2s cap, well under the 10s hook budget.
read_stdin_payload() {
  [ -t 0 ] && { printf ''; return 0; }            # not a pipe → nothing to read
  local tmp pid i=0
  tmp="$(mktemp 2>/dev/null)" || { printf ''; return 0; }
  # `<&0` is REQUIRED: a backgrounded command in a non-interactive shell (no job
  # control) has stdin redirected from /dev/null unless an explicit redirection is
  # given, so a bare `cat &` reads nothing. `<&0` forces it to read the real pipe.
  cat <&0 > "$tmp" 2>/dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i + 1)); done
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  cat "$tmp" 2>/dev/null
  rm -f "$tmp"
}

# True when the string is empty or contains only whitespace. Replaces the
# `[ -z "${var//[$'\n\t ']/}" ]` idiom, whose global parameter substitution is
# O(n²) on bash 3.2 (the macOS default): on a ~14KB context it ran ~114s and
# blew past the 10s hook timeout, so a dispatched worker silently got no memory.
# `case` glob matching is linear (~0.01s on the same input). `[![:space:]]`
# matches any non-whitespace char, so a hit means the string has real content.
is_blank() {
  case "$1" in
    *[![:space:]]*) return 1 ;;
    *)              return 0 ;;
  esac
}

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

# The shared project docs are a CURATED list (not every file in .agents/, so you
# control exactly what's shared and don't sweep in stray files). The list is set in
# the hook config (config.sh → $SDLC_SHARED_DOCS, space-separated base names); a
# real environment value overrides it; the built-in default is the final fallback.
# Names are base names (no .md); a listed doc that doesn't exist is simply skipped.
# These are flat .agents/<name>.md files — subfolders are never involved.
SDLC_SHARED_DOCS_DEFAULT="testing profile workflow conventions role-overrides team-comms"
shared_doc_names() {
  printf '%s\n' ${SDLC_SHARED_DOCS:-$SDLC_SHARED_DOCS_DEFAULT}
}

# True if the shared-doc instruction files are already on disk — i.e. this session
# loaded them into the system prompt at startup, so the agent already has the shared
# docs and needs no read-list. session-start checks this BEFORE it (re)writes them,
# so it reflects the pre-session state. $1 = project dir.
instructions_present() {
  local dir="$1/.github/instructions" name
  for name in $(shared_doc_names); do
    [ -f "${dir}/${name}.instructions.md" ] && return 0
  done
  return 1
}

# Concatenate the lean shared project docs (scout outputs + role overrides) that
# exist under $1 (an .agents dir), each under a markdown header. Echoes the
# combined string (empty if none). This is the per-dispatch "must-read" project
# context — kept lean on purpose; the full AGENTS.md manual is NOT injected, it
# stays an on-demand reference.
collect_shared_context() {
  local agents_dir="$1" out="" name f
  for name in $(shared_doc_names "$agents_dir"); do
    f="${agents_dir}/${name}.md"
    if [ -f "$f" ]; then
      out="${out}"$'\n\n'"# .agents/${name}.md"$'\n\n'"$(cat "$f")"
    fi
  done
  printf '%s' "$out"
}

# Concatenate a role's startup memory — the persona (SOUL.md, injected only for
# VS Code / Copilot CLI, which reference it softly and don't expand @-imports;
# Claude expands it natively and Codex inlines it) plus the memory snapshot/index
# (snapshot.md is the generic name, MEMORY.md is the index `init` seeds). Echoes
# the combined string (empty if the role has no memory dir / no files).
# $1 = project dir, $2 = role name. Shared by agent-start (subagent dispatch) and
# session-start (Copilot CLI orchestrator, resolved from session-state).
# The role-memory file names injected from .agents/memory/<role>/ — a CURATED,
# configurable list (hook config → $SDLC_ROLE_MEMORY_FILES, space-separated; default
# below). SOUL.md (the persona) is honored only under Copilot — Claude/Codex receive
# it via the agent body's @-import, so injecting it here too would duplicate it.
# Echoes one name per line (after the SOUL gate). Shared by collect_role_memory,
# build_capped_context's inline memory loop, and list_role_memory_files so all agree.
SDLC_ROLE_MEMORY_FILES_DEFAULT="SOUL.md snapshot.md MEMORY.md"
role_memory_files() {
  local mf
  for mf in ${SDLC_ROLE_MEMORY_FILES:-$SDLC_ROLE_MEMORY_FILES_DEFAULT}; do
    if [ "$mf" = "SOUL.md" ] && [ -z "${SDLC_VSCODE:-}" ] && [ -z "${COPILOT_CLI:-}" ]; then
      continue                          # persona arrives via @-import on Claude/Codex
    fi
    printf '%s\n' "$mf"
  done
}

collect_role_memory() {
  local base="$1" role="$2" dir out="" mf f header
  dir="${base}/.agents/memory/${role}"
  [ -d "$dir" ] || { printf ''; return 0; }
  for mf in $(role_memory_files); do
    f="${dir}/${mf}"
    [ -f "$f" ] || continue
    case "$mf" in
      SOUL.md) header="# Your persona — .agents/memory/${role}/${mf}" ;;
      *)       header="# Your persistent memory — .agents/memory/${role}/${mf}" ;;
    esac
    out="${out}"$'\n\n'"${header}"$'\n\n'"$(cat "$f")"
  done
  printf '%s' "$out"
}

# Byte length of a string (wc -c, so it's true bytes regardless of locale).
byte_len() { printf '%s' "$1" | wc -c | tr -d ' '; }

# Byte length the string will occupy AFTER JSON escaping — i.e. the size the
# runtime actually measures against the additionalContext cap. escape_for_json
# prefixes a backslash to each \ " newline carriage-return tab, so each such
# char adds exactly one byte; escaped_len = raw_len + count(those chars). Counted
# with tr|wc (linear, two passes) — NOT by running the full O(n²)-ish escape.
esc_byte_len() {
  local s="$1" raw esc
  raw="$(byte_len "$s")"
  esc="$(printf '%s' "$s" | tr -cd '\\"'$'\n\r\t' | wc -c | tr -d ' ')"
  printf '%s' "$((raw + esc))"
}

# List the shared-doc paths (project-root-relative) that collect_shared_context
# WOULD inline — used to build a "read these instead" directive when inlining
# them would overflow the additionalContext cap. Mirrors that function's set/order.
list_shared_files() {
  local agents_dir="$1" name out=""
  for name in $(shared_doc_names "$agents_dir"); do
    [ -f "${agents_dir}/${name}.md" ] && out="${out}.agents/${name}.md"$'\n'
  done
  printf '%s' "$out"
}

# List the role-memory paths (project-root-relative) that collect_role_memory
# WOULD inline. Mirrors its SOUL.md gating + file set. $1=project dir, $2=role.
list_role_memory_files() {
  local base="$1" role="$2" dir mf out=""
  dir="${base}/.agents/memory/${role}"
  [ -d "$dir" ] || { printf ''; return 0; }
  for mf in $(role_memory_files); do
    [ -f "${dir}/${mf}" ] && out="${out}.agents/memory/${role}/${mf}"$'\n'
  done
  printf '%s' "$out"
}

# Build a hard-rule directive telling the agent to READ the given files (one
# project-root-relative path per line in $1) in full before starting — the
# fallback when inlining their content would blow the additionalContext cap.
# Best-effort, not guaranteed (additionalContext isn't the system prompt), but
# strictly better than the runtime silently dropping an over-cap payload whole.
build_read_directive() {
  local files="$1" out f oldifs
  out="# REQUIRED READING — load these before doing anything else"$'\n\n'
  out="${out}These project files may not be inlined in your context. Read each one in"$'\n'
  out="${out}full now — SKIP any whose content is already present in your context or"$'\n'
  out="${out}instructions — before other work; they are authoritative and override"$'\n'
  out="${out}defaults in your agent definition:"$'\n'
  oldifs="$IFS"; IFS=$'\n'
  for f in $files; do
    [ -n "$f" ] && out="${out}"$'\n'"- ${f}"
  done
  IFS="$oldifs"
  printf '%s' "$out"
}

# Build the additionalContext injection so it NEVER overflows the ~10KB cap (an
# over-cap payload is dropped IN FULL by the runtime — verified). Two channels, no
# overlap: shared docs ride the instruction-file shelf (see refresh_shared_
# instructions); additionalContext carries the ROLE MEMORY (role-specific → can't go
# on the global shelf), plus a read-list pointing at the shared docs only when this
# agent won't have the shelf. Specifically:
#   - Each role-memory file is inlined while it still fits the cap; one too big to
#     fit becomes a self-read pointer (read its own .agents/memory/<role>/ file).
#   - A shared-doc read-list is appended ONLY when cli_sub is set (CLI sub-agents
#     never inherit instruction files) OR instr_present is empty (cold first run);
#     otherwise the shared docs are already in the system prompt — no note needed.
# The cap is Copilot-specific; other runtimes (Claude/Codex/Cursor) inline as-is.
# Sizes are measured AFTER JSON escaping (esc_byte_len). $1=project dir, $2=role,
# $3=instr_present (1/empty), $4=cli_sub (1/empty). SDLC_CTX_CAP overrides (def 10240).
build_capped_context() {
  local base="$1" role="$2" instr_present="$3" cli_sub="$4"
  local agents_dir="${base}/.agents" dir="${base}/.agents/memory/${role}"

  # Non-Copilot (Claude/Codex/Cursor): no cap — inline memory + all shared, as before.
  if [ -z "${COPILOT_CLI:-}" ] && [ -z "${SDLC_VSCODE:-}" ]; then
    printf '%s%s' "$(collect_role_memory "$base" "$role")" "$(collect_shared_context "$agents_dir")"
    return 0
  fi

  # Reserve room for the worst-case MUST-READ directive: it can name every role-memory
  # file AND every shared doc, so reserving that upper bound guarantees the inlined
  # content can never crowd the directive out and push the final payload over the cap
  # (the runtime drops an over-cap payload WHOLE). Measured post-escape; the real
  # directive is always a subset of this list, so the bound is safe. (A fixed reserve
  # was NOT enough — a long role name + full overflow list exceeded it.)
  local cap="${SDLC_CTX_CAP:-10240}" budget maxlist
  maxlist="$(list_role_memory_files "$base" "$role")
$(list_shared_files "$agents_dir")"
  budget=$(( cap - $(esc_byte_len "$(build_read_directive "$maxlist")") - 16 ))

  # Role memory rides additionalContext — it's role-specific, so it can't go on the
  # shared instruction-file shelf. Inline each memory file while it still fits the
  # cap; a file too big to fit becomes a self-read pointer (read its own file).
  local context="" overflow="" mf f header doc cand
  if [ -n "$role" ] && [ -d "$dir" ]; then
    for mf in $(role_memory_files); do
      f="${dir}/${mf}"; [ -f "$f" ] || continue
      case "$mf" in
        SOUL.md) header="# Your persona — .agents/memory/${role}/${mf}" ;;
        *)       header="# Your persistent memory — .agents/memory/${role}/${mf}" ;;
      esac
      doc=$'\n\n'"${header}"$'\n\n'"$(cat "$f")"
      cand="${context}${doc}"
      if [ "$(esc_byte_len "$cand")" -le "$budget" ]; then
        context="$cand"                                          # fits → inline
      else
        overflow="${overflow}.agents/memory/${role}/${mf}"$'\n'  # too big → self-read
      fi
    done
  fi

  # Shared docs normally live on the instruction-file shelf. How they reach THIS
  # agent depends on whether it gets the shelf:
  if [ -n "$cli_sub" ]; then
    # CLI sub-agent — never inherits instruction files. The shelf is invisible to
    # it, so deliver the shared docs through additionalContext: inline them in
    # priority order (shared_doc_names / SDLC_SHARED_DOCS) after memory while they
    # still fit the cap; whatever doesn't fit becomes a read-list. This is the only
    # case where the SDLC_SHARED_DOCS ORDER matters (the cap forces the choice).
    local name
    for name in $(shared_doc_names); do
      f="${agents_dir}/${name}.md"; [ -f "$f" ] || continue
      doc=$'\n\n'"# .agents/${name}.md"$'\n\n'"$(cat "$f")"
      cand="${context}${doc}"
      if [ "$(esc_byte_len "$cand")" -le "$budget" ]; then
        context="$cand"                                  # fits → inline
      else
        overflow="${overflow}.agents/${name}.md"$'\n'    # spills → read-list
      fi
    done
  elif [ -z "$instr_present" ]; then
    # Shelf-getter on a COLD start (instruction files not on disk yet) — it didn't
    # load them this session, so give a best-effort read-list until the shelf warms
    # next session. (A warm shelf-getter needs nothing here — shared is in its
    # system prompt already.)
    overflow="${overflow}$(list_shared_files "$agents_dir")"
  fi

  if ! is_blank "$overflow"; then
    context="${context}"$'\n\n'"$(build_read_directive "$overflow")"
  fi
  printf '%s' "$context"
}

# Mirror each shared project doc to its own Copilot instruction file so the docs
# land in the SYSTEM PROMPT (uncapped, guaranteed, no read) — complementing the
# capped additionalContext delivery. Verified reach: the top-level agent in BOTH
# runtimes, AND dispatched subagents in VS Code; CLI subagents do NOT inherit it,
# so additionalContext stays their channel. Files are read at session start (before
# hooks fire), so this write is WARM-CACHE — effective on the NEXT session.
#
# One-to-one mapping: .agents/<name>.md -> .github/instructions/<name>.instructions.md
# (all `applyTo: "**/*"`, so each always loads). Per-file (not one combined blob) so a
# change to one doc rewrites only its own file. Each generated file carries a marker
# so we (a) never clobber a human-authored same-named instruction file, and (b) can
# remove our file when its source doc goes away. Idempotent: rewrites only on change.
# Copilot-only. $1 = project dir.
refresh_shared_instructions() {
  local base="$1" agents_dir dir name f out content new old marker want
  [ -n "${COPILOT_CLI:-}${SDLC_VSCODE:-}" ] || return 0
  agents_dir="${base}/.agents"
  dir="${base}/.github/instructions"
  marker="auto-generated by sdlc-skills"
  rm -f "${dir}/sdlc-shared.instructions.md" 2>/dev/null   # migrate off the old combined file

  # ALL shared docs go to the instruction-file shelf (one file each) — they are NOT
  # inlined into additionalContext (memory rides that channel). Space-padded set for
  # the sweep's membership test below.
  want=" $(shared_doc_names | tr '\n' ' ') "

  # 1) Mirror each shared doc to its own instruction file.
  for name in $(shared_doc_names); do
    f="${agents_dir}/${name}.md"
    [ -f "$f" ] || continue
    out="${dir}/${name}.instructions.md"
    # never clobber a human-authored same-named instruction file (no marker)
    if [ -f "$out" ] && ! grep -q "$marker" "$out" 2>/dev/null; then continue; fi
    content="$(cat "$f")"
    new="---"$'\n'"applyTo: \"**/*\""$'\n'"---"$'\n'"# .agents/${name}.md — ${marker}; do not edit (regenerated each session)"$'\n\n'"${content}"
    if [ -f "$out" ]; then
      old="$(cat "$out" 2>/dev/null)"
      if [ "$old" = "$new" ]; then continue; fi    # unchanged → skip the write
    fi
    mkdir -p "$dir" 2>/dev/null || return 0
    printf '%s\n' "$new" > "$out" 2>/dev/null || true
  done

  # 2) Sweep OUR generated files no longer backed by a listed shared doc — source
  # doc deleted, or it was removed from the shared-docs list.
  [ -d "$dir" ] || return 0
  for out in "$dir"/*.instructions.md; do
    [ -f "$out" ] || continue
    grep -q "$marker" "$out" 2>/dev/null || continue          # only ours
    name="$(basename "$out" .instructions.md)"
    case "$want" in *" $name "*) : ;; *) rm -f "$out" ;; esac
  done
}

# Resolve the Copilot CLI main/orchestrator agent for a session. The CLI is
# launched with `--agent <name>` and records that selection as the first
# `subagent.selected` event in its session-state log; the SessionStart payload
# carries the sessionId to find it. Echoes the agent name (empty if not
# resolvable). This SELF-GATES to the Copilot CLI: VS Code's sessionId has no
# session-state dir, so it returns empty there (VS Code orchestrators load memory
# via the agent-frontmatter SessionStart hook instead). A short retry covers the
# rare race where SessionStart fires before the event is logged.
#
# The CLI keeps state under ~/.copilot (no --config-dir flag and no dir env var in
# 1.0.x — verified). COPILOT_CONFIG_DIR / COPILOT_HOME are honored as a forward-
# compatible override should a custom config dir ever be exposed. $1 = sessionId.
resolve_cli_session_agent() {
  local sid="$1" cfg ev a i
  [ -n "$sid" ] || { printf ''; return 0; }
  cfg="${COPILOT_CONFIG_DIR:-${COPILOT_HOME:-$HOME/.copilot}}"
  ev="${cfg}/session-state/${sid}/events.jsonl"
  for i in 1 2 3; do
    if [ -f "$ev" ]; then
      a="$(grep -m1 '"type":"subagent.selected"' "$ev" 2>/dev/null \
            | sed -n 's/.*"agentName":"\([^"]*\)".*/\1/p' | head -n1)"
      [ -n "${a:-}" ] && { printf '%s' "$a"; return 0; }
    fi
    [ "$i" -lt 3 ] && sleep 0.1
  done
  printf ''
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
# CLI (subagentStart), VS Code Copilot Chat (SubagentStart). These load per-role
# memory via agent-start, so session-start skips the roster reminder for them.
#
# Cursor is deliberately excluded: it has subagentStart, but that event is
# permission-only (allow/deny) — it cannot return additionalContext — and its
# identifier is a generic type (generalPurpose/explore/shell), not our role
# names. So Cursor falls back to the sessionStart roster reminder.
has_subagent_hook() {
  is_claude_code || [ -n "${COPILOT_CLI:-}" ] || [ -n "${SDLC_VSCODE:-}" ] || is_codex
}

# Emit session-level context in the shape the current runtime consumes.
#   Cursor                 -> additional_context (top-level, snake_case)
#   Claude Code/Codex/VSCode -> hookSpecificOutput.additionalContext (SessionStart)
#   Copilot CLI / SDK      -> additionalContext (top-level)
#   Kiro / raw             -> plain text on stdout (agentSpawn appends stdout)
# Set SDLC_HOOK_RAW=1 (Kiro) for raw; CODEX_HOOK=1 selects the Codex shape;
# SDLC_VSCODE=1 selects the VS Code Copilot Chat shape (same as Claude/Codex).
emit_session_context() {
  if [ -n "${SDLC_HOOK_RAW:-}" ]; then printf '%s\n' "$1"; return; fi
  local ctx; ctx="$(escape_for_json "$1")"
  if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "additional_context": "%s"\n}\n' "$ctx"
  elif [ -n "${SDLC_VSCODE:-}" ] || is_codex || { [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -z "${COPILOT_CLI:-}" ]; }; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$ctx"
  else
    printf '{\n  "additionalContext": "%s"\n}\n' "$ctx"
  fi
}

# Emit per-agent start context in the shape the current runtime consumes.
#   Copilot CLI            -> additionalContext (top-level; subagentStart prepends it)
#   Claude Code/Codex/VSCode -> hookSpecificOutput.additionalContext (SubagentStart)
#   Kiro / raw             -> plain stdout (a per-agent config calls agent-start direct)
# VS Code Copilot Chat (SDLC_VSCODE=1) uses the same hookSpecificOutput shape as
# Claude/Codex — checked before the CLI's top-level shape since the two flags are
# mutually exclusive per invocation (set by the camelCase vs PascalCase entry).
# The emitted hookEventName defaults to SubagentStart but can be overridden via
# SDLC_HOOK_EVENT — an agent-scoped SessionStart hook (per-agent frontmatter, for
# the main-session-as-role case) sets SDLC_HOOK_EVENT=SessionStart so the role
# context is delivered through agent-start but labelled as a SessionStart event.
emit_subagent_context() {
  if [ -n "${SDLC_HOOK_RAW:-}" ]; then printf '%s\n' "$1"; return; fi
  local ctx ev; ctx="$(escape_for_json "$1")"; ev="${SDLC_HOOK_EVENT:-SubagentStart}"
  if [ -n "${SDLC_VSCODE:-}" ] || is_codex || is_claude_code; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "%s",\n    "additionalContext": "%s"\n  }\n}\n' "$ev" "$ctx"
  elif [ -n "${COPILOT_CLI:-}" ]; then
    printf '{\n  "additionalContext": "%s"\n}\n' "$ctx"
  else
    printf '%s\n' "$1"
  fi
}

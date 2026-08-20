#!/usr/bin/env bash
# Shared helper — sourced by benchmark-session-start (primary caller) and
# benchmark-preflight (fallback caller, when session-start's own snapshot
# isn't ready yet / isn't actually scoped). Not itself a hook; not
# registered in settings.json.
#
# WHY THIS EXISTS (found 2026-07-30, qa-project debug session, round 4):
# build-run-metrics.mjs's ccusage scoping (session.tokens_coverage ==
# "full_session") requires an entry with `period === sid` in BOTH the pre
# and post `ccusage session --json` snapshots. The pre snapshot used to be
# taken with a single, un-retried `ccusage session --json` call at the very
# first moment of a brand-new session — before Claude Code's own usage logs
# (which ccusage reads from) necessarily have anything for this session id
# yet. Confirmed live (RUN-2026-07-30-020): pre-side lookup missed, session
# fell back to "full_session_unscoped" (delta summed across every session
# ever recorded on the machine).
#
# ROUND 4a (first attempt, attempt-count-based retry, DISPROVEN): measured
# three real sessions' "first transcript line -> first ccusage-visible usage
# entry" gap at 2.76s/2.92s/3.20s and built a 15-attempts-x-1s-sleep loop
# around that. On the very next real run (RUN-2026-07-30-021, sid
# 3e5468e5-...) it still came back unscoped — debug log claimed "NOT found
# after 15 attempts (~15s)" at a wall-clock timestamp only ~2s after that
# session's own first transcript line. That's not possible if the loop
# genuinely spent ~15-30s on 15 real sleep+ccusage cycles — either `sleep 1`
# isn't reliably blocking for a full second in this hook's real execution
# context (spawned via the cmd.exe -> bash.exe chain in run-hook.cmd,
# `async: true`), or something else about that environment behaves
# differently than a directly-sourced/called test of this same function
# (confirmed: three different attempts to replicate the exact real spawn
# chain from outside gave three DIFFERENT behaviors — one hung 2+ minutes,
# one silently failed to parse stdin/sid at all — inconclusive, not a clean
# repro either way).
#
# ROUND 4b (this version): rather than keep guessing at what's wrong with
# attempt-count timing in that execution context, made the loop's exit
# condition REAL WALL-CLOCK ELAPSED TIME (checked via `date +%s` every
# iteration) instead of a fixed attempt count. This is robust regardless of
# whether `sleep` blocks correctly or whether each `ccusage` call's own cost
# drifts over the session (both measured to become real possibilities, not
# separately proven or disproven) — if sleep is broken, the loop just spins
# through more ccusage calls faster instead of fewer, but still can't exit
# before TOTAL_BUDGET_S of real time has genuinely elapsed. Total budget
# raised to 60s (from a real ~15-30s design) purely as safety margin given
# the round-4a evidence undermines confidence in any tightly-tuned number;
# every attempt's own timestamp + elapsed-so-far is now logged (not just the
# final outcome) so the NEXT real run gives unambiguous ground truth on
# which failure mode (if any) is real, instead of another indirect
# inference.
#
# Usage: wait_for_scoped_ccusage <sid> <out_file> [<debug_log>] [<label>]
# Writes <out_file> with a `ccusage session --json` snapshot — scoped
# (contains an entry with period===<sid>) if found within the budget,
# otherwise whatever the LAST attempt returned (same graceful-degradation
# philosophy as the rest of this pipeline: never block, never fail the hook,
# just fall back to the best data available). Returns 0 if scoped, 1 if not
# (caller may ignore the return code; both current callers do — an unscoped
# snapshot is still useful, build-run-metrics.mjs's own unscoped fallback
# path handles it).

# ---------------------------------------------------------------------------
# ccusage invocation resolver — added 2026-08-12.
#
# WHY: `ccusage` ships on npm and is frequently NOT installed globally. On a
# machine without it, every `ccusage session --json` call in this pipeline
# returned nothing, the `|| printf '{}'` fallbacks wrote empty snapshots, and
# every run silently degraded to `tokens_coverage: "subagents_only"` with null
# token counts. Nothing errored — the graceful-degradation design worked
# exactly as intended — so the only symptom was an empty metrics JSON that
# looked like a data problem rather than a missing dependency. Confirmed on
# this box: `command -v ccusage` → not found, while RUN-2026-08-12-002's
# metrics came back with every per-case value null.
#
# FIX: prefer a real binary on PATH; fall back to `npx -y ccusage`, which
# resolves the package on demand. If neither is available, return non-zero and
# let each caller's existing `{}` fallback take over — same never-block,
# never-fail-the-hook philosophy as the rest of the pipeline.
#
# Resolution is cached in _CCUSAGE_MODE for the life of the shell, so the
# 60s poll loop below doesn't re-probe PATH on every iteration.
#
# The mode is a flag dispatched through a `case`, NOT an argv string expanded
# unquoted. An earlier draft stored "npx -y ccusage" in a variable and relied
# on word-splitting at the call site; that works under bash (these hooks all
# have a bash shebang) but silently breaks under zsh, which does not split
# unquoted expansions — the whole string is looked up as one command name and
# the call exits 127 with empty stderr, which looks exactly like "ccusage is
# missing". Caught while validating this very fix from a zsh prompt.
#
# TIMING CAVEAT: a PATH binary answers in ~100ms; `npx` pays node startup
# plus, on the very first call before npm's _npx cache is warm, a package
# download. That matters to wait_for_scoped_ccusage, whose budget is real
# wall-clock — under npx it will make far fewer attempts within the same 60s
# (possibly only one). That is a deliberate trade: a slow snapshot still
# beats no snapshot, and the unscoped fallback path already handles a miss.
# CCUSAGE_TIMEOUT_S bounds a single call so a hung npx (no network, private
# registry) can't wedge a hook; `timeout` is not present by default on macOS,
# so it is used only when available.
# Runs "$@", bounded by a timeout wrapper when the platform genuinely has one.
#
# Per-platform reality this has to survive:
#   Linux   — `timeout` is coreutils, wraps a command. Works.
#   macOS   — ships NEITHER `timeout` nor `gtimeout` unless the user installed
#             coreutils via brew. Unbounded is the normal path here.
#   Windows — `command -v timeout` finds C:\Windows\System32\timeout.exe under
#             Git Bash, which is an ENTIRELY DIFFERENT command: it pauses for N
#             seconds and takes `/t`, it does not wrap anything. Dispatching to
#             it would corrupt every call (and it errors outright when stdin is
#             redirected, which it is here).
#
# So presence on PATH is not evidence of the right command — probe behaviour
# instead. `timeout 1 true` succeeds only for the coreutils wrapper form;
# Windows' timeout.exe rejects it. Result cached for the life of the shell.
_ccusage_run() {
  if [ -z "${_CCUSAGE_TIMEOUT_MODE:-}" ]; then
    _CCUSAGE_TIMEOUT_MODE="none"
    if command -v timeout >/dev/null 2>&1 && timeout 1 true >/dev/null 2>&1; then
      _CCUSAGE_TIMEOUT_MODE="timeout"
    elif command -v gtimeout >/dev/null 2>&1 && gtimeout 1 true >/dev/null 2>&1; then
      _CCUSAGE_TIMEOUT_MODE="gtimeout"
    fi
  fi

  case "$_CCUSAGE_TIMEOUT_MODE" in
    timeout)  timeout  "${CCUSAGE_TIMEOUT_S:-60}" "$@" 2>/dev/null ;;
    gtimeout) gtimeout "${CCUSAGE_TIMEOUT_S:-60}" "$@" 2>/dev/null ;;
    *)        "$@" 2>/dev/null ;;
  esac
}

ccusage_session_json() {
  if [ -z "${_CCUSAGE_MODE:-}" ]; then
    if command -v ccusage >/dev/null 2>&1; then
      _CCUSAGE_MODE="bin"
    elif command -v npx >/dev/null 2>&1; then
      _CCUSAGE_MODE="npx"
    elif command -v npx.cmd >/dev/null 2>&1; then
      # Windows: some shells surface only the .cmd shim on PATH.
      _CCUSAGE_MODE="npxcmd"
    else
      _CCUSAGE_MODE="none"
    fi
  fi

  case "$_CCUSAGE_MODE" in
    bin)    _ccusage_run ccusage session --json ;;
    npx)    _ccusage_run npx -y ccusage session --json ;;
    npxcmd) _ccusage_run npx.cmd -y ccusage session --json ;;
    *)      return 1 ;;
  esac
}

wait_for_scoped_ccusage() {
  local sid="$1" out_file="$2" debug_log="${3:-}" label="${4:-ccusage-wait}"
  local total_budget_s=60
  local poll_interval_s=1
  local start_epoch elapsed_s attempt=0 snapshot=""

  start_epoch="$(date -u +%s)"

  while :; do
    attempt=$((attempt + 1))
    snapshot="$(ccusage_session_json || true)"
    elapsed_s=$(( $(date -u +%s) - start_epoch ))

    if printf '%s' "$snapshot" | node -e "
      const c=[];process.stdin.on('data',d=>c.push(d));
      process.stdin.on('end',()=>{
        try{
          const p=JSON.parse(Buffer.concat(c).toString());
          const found=(p.session||[]).some(s=>s.period==='${sid}');
          process.exit(found?0:1);
        }catch{process.exit(1);}
      });" 2>/dev/null; then
      if [ -n "$debug_log" ]; then
        printf '[%s] %s: sid=%s FOUND on attempt %s (%ss real elapsed)\n' \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$sid" "$attempt" "$elapsed_s" \
          >> "$debug_log" 2>/dev/null || true
      fi
      printf '%s' "$snapshot" > "$out_file"
      return 0
    fi

    if [ -n "$debug_log" ]; then
      printf '[%s] %s: sid=%s not yet found, attempt %s (%ss real elapsed, budget %ss)\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$sid" "$attempt" "$elapsed_s" "$total_budget_s" \
        >> "$debug_log" 2>/dev/null || true
    fi

    if [ "$elapsed_s" -ge "$total_budget_s" ]; then
      break
    fi
    sleep "$poll_interval_s"
  done

  if [ -n "$debug_log" ]; then
    printf '[%s] %s: sid=%s NOT found after %s attempts (%ss real elapsed) -- writing unscoped snapshot\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" "$sid" "$attempt" "$elapsed_s" \
      >> "$debug_log" 2>/dev/null || true
  fi
  printf '%s' "$snapshot" > "$out_file"
  return 1
}

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

wait_for_scoped_ccusage() {
  local sid="$1" out_file="$2" debug_log="${3:-}" label="${4:-ccusage-wait}"
  local total_budget_s=60
  local poll_interval_s=1
  local start_epoch elapsed_s attempt=0 snapshot=""

  start_epoch="$(date -u +%s)"

  while :; do
    attempt=$((attempt + 1))
    snapshot="$(ccusage session --json 2>/dev/null || true)"
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

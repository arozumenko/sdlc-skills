---
name: session-retrospective
description: Use when asked to run a retrospective, mine past sessions, or improve the team from what already happened — turning prior Claude Code conversations and sub-agent sessions into proposed memory and workflow updates. Used by scout.
license: Apache-2.0
authors:
  - Artem Rozumenko <artem_rozumenko@epam.com>
metadata:
  version: "0.1.0"
---

# Session Retrospective

Distill past sessions for this project into **evidenced, ack-gated**
improvements to the team's memory and shared docs. Efficiency-led: process
waste first, durable facts second. You (scout) run this manually when asked.

**Read-only analysis, assisted writes.** The parser only reads transcripts.
*You* propose every change and write nothing until the user acks.

## When to use

- The user says "run a retrospective", "mine past sessions", "what slowed us
  down", or "improve the team from recent work".
- Periodically, to fold lessons from recent sessions into `.agents/`.

Not for: onboarding a fresh repo (that's `seeding-a-project`), or refreshing
config from code/PR changes (that's scout's normal update flow).

## Procedure

1. **Distill.** Run the parser from the project root:

   ```
   node {skill}/scripts/distill-sessions.mjs
   ```

   It reads `~/.claude/projects/<this-project>/` transcripts newer than the
   watermark (`.agents/memory/scout/.last-retrospective`), plus each session's
   `subagents/`, and prints a bounded markdown digest. Add `--all` to ignore
   the watermark, `--exclude-session <id>` to skip the active session, or
   `--out <path>` to save the digest. Exit code 3 = no transcripts found →
   use the Fallback below. The newest session is usually the one you're
   running in — pass `--exclude-session <its id>` so the retrospective
   doesn't analyze itself.

2. **Read the digest** (it fits in context — never read raw `.jsonl`).

3. **Interpret** — see `references/signal-taxonomy.md`. Separate:
   - **Efficiency findings** — repeated corrections, retry loops, file churn,
     tool errors, ignored conventions.
   - **Durable facts** — gotchas, decisions, "X doesn't work, use Y".
   Every finding MUST cite the session id it came from. Drop anything you
   cannot evidence from the digest.

4. **Map findings to targets** — see `references/finding-to-target.md`:
   role-specific → that role's `.agents/memory/<role>/`; team-wide process →
   `.agents/workflow.md` / `.agents/conventions.md`; durable fact → a curated
   entry (via the `memory` skill). If `.agents/` doesn't exist, the project
   isn't seeded — a retrospective refines an existing lens, it doesn't create
   one; run `seeding-a-project` first.

5. **Propose, then wait.** Present each proposed change as a diff plus a
   one-line rationale with its session-id evidence. **Stop and wait for the
   user's ack.** Do not write yet.

6. **On ack, write:**
   - Memory deltas via the `memory` skill (curated entries + `MEMORY.md`
     index lines; `project_briefing.md` updates).
   - Surgical edits to `.agents/workflow.md` / `conventions.md`.
   - A dated report `.agents/retrospectives/YYYY-MM-DD.md`: sessions analyzed,
     findings, what was applied, what was deferred and why.
   - Advance the watermark: write `.agents/memory/scout/.last-retrospective`
     as `{"lastRun":"<ISO>","analyzed":[<session ids you just covered>]}`,
     merging with any existing ids. **Only after writing — never on a decline.**

## Fallback (non–Claude Code hosts)

If the parser exits with code 3, transcripts aren't accessible here. Ask the
user to paste a session transcript or summary, then run steps 3–6 on that text
(skip the watermark; note in the report that it was a pasted-transcript run).

## Anti-memory-poisoning rules

- Never write without an explicit ack.
- Every durable fact cites a session id. No inventing.
- Record corrections as one-line lessons, not raw quotes.
- Bounded recall — reason over the digest, never raw `.jsonl`.

## Common mistakes

- Writing before ack — forbidden; always propose-then-wait.
- Advancing the watermark on a dry run or a decline — only after writing.
- Treating a candidate correction as a fact without judgment — the digest
  flags candidates; you decide.
- Reading raw transcripts into context — use the digest.

## References

- `references/transcript-schema.md` — Claude Code JSONL + sub-agent layout.
- `references/digest-format.md` — the digest the parser emits.
- `references/signal-taxonomy.md` — signal definitions + thresholds.
- `references/finding-to-target.md` — finding→target mapping + safeguards.

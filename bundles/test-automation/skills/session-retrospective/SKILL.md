---
name: session-retrospective
description: Use when asked to run a retrospective, mine past sessions, or improve the team from what already happened — turning prior Claude Code conversations and sub-agent sessions into proposed memory and workflow updates. Used by scout.
compatibility: "Requires Node 18+. **Claude Code:** reads ~/.claude/projects/<encoded-cwd>/*.jsonl plus each session's subagents/ tree. **GitHub Copilot:** pass `--host copilot` (auto-detected when Claude has nothing for the project) — reads ~/.copilot/session-state/*/events.jsonl, also $COPILOT_HOME and a repo-local ./.copilot. The analysis is identical on both: copilot-events.mjs transcodes Copilot's event stream into the same records, so signals, sub-agent summaries and dispatch fingerprints work unchanged."
license: Apache-2.0
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
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
   - **Efficiency findings** — repeated corrections, interrupts, retry loops,
     file churn, tool errors, ignored conventions.
   - **Durable facts** — gotchas, decisions, "X doesn't work, use Y".
   Every finding MUST cite the session id it came from. Drop anything you
   cannot evidence from the digest.

   Corrections arrive labelled by kind and ranked; the digest says when it
   showed only the strongest. **A short corrections list is not proof of a
   smooth session** — detection is English-only (the digest header says so), so
   check what language the sessions were held in before reading quiet as good.
   Plenty of tool errors and interrupts alongside zero corrections means the
   detector is blind, not that nobody objected.

4. **Map findings to targets** — see `references/finding-to-target.md`:
   role-specific → that role's `.agents/memory/<role>/`; team-wide process →
   `.agents/workflow.md` / `.agents/conventions.md`; durable fact → a curated
   entry (via the `memory` skill). If `.agents/` doesn't exist, the project
   isn't seeded — a retrospective refines an existing lens, it doesn't create
   one; run `seeding-a-project` first.

   For anything a previous retrospective already wrote down and that happened
   anyway, don't write it again in firmer words — `finding-to-target.md` has the
   escalation ladder ending in a deterministic guard, and the conditions for
   proposing one.

5. **Compact the memory index** — for each role whose `MEMORY.md` is over
   budget (the session-start hook names them; or check with
   `wc -c .agents/memory/*/MEMORY.md`, budget 32 KB). Agents write freely as
   they work — nobody judges durability mid-task, because a worker sees one
   task and cannot know a thing recurred. You are the pass that sees many, so
   consolidation is yours.

   **Compaction acts on the INDEX.** Entry files are merged or deleted, never
   relocated, and **daily logs are never touched** — they are an append-only
   record of what happened, so back-dating a line into an old one falsifies the
   audit trail (and it would fall outside the 3-day read window anyway:
   deletion with extra steps).

   | Found | Do |
   |---|---|
   | Index line far over ~120 chars | Rewrite it as a one-line hook — but first check its detail survives in the entry body, and move what's worth keeping there *before* shortening. |
   | Indexed entry that is really a surface-specific lookup | **Drop its index line, keep the file.** It stops costing injection budget and stays findable by `grep`. Demotion, not deletion. |
   | Near-duplicates | Merge the bodies into ONE entry carrying a count ("seen 15x", not fifteen paragraphs); keep one index line, delete the others' files and lines. |
   | Contradicted by current reality, or unused for months | Delete the file and its line. |
   | **Un-indexed entry that turned out preventive** — several sessions tripped over it before finding it, or it belongs in a task's first move | **Promote: add an index line** (≤120 chars). This is the direction only you can judge: a worker sees one task and cannot know a fact recurred; you see many. |

   Promotion and demotion are the same budget. If the index is already full,
   promoting one thing means demoting another — say which, don't just add.

   Re-measure after. Report what was shortened, demoted, promoted, merged and
   deleted.

6. **Propose, then wait.** Present each proposed change as a diff plus a
   one-line rationale with its session-id evidence. **Stop and wait for the
   user's ack.** Do not write yet.

7. **On ack, write:**
   - Memory deltas via the `memory` skill (curated entries + `MEMORY.md`
     index lines; `project_briefing.md` updates).
   - Surgical edits to `.agents/workflow.md` / `conventions.md`.
   - A dated report `.agents/retrospectives/YYYY-MM-DD.md`: sessions analyzed,
     findings, what was applied, what was deferred and why.
   - Advance the watermark: write `.agents/memory/scout/.last-retrospective`
     as `{"lastRun":"<ISO>","analyzed":[<session ids you just covered>]}`,
     merging with any existing ids. **Only after writing — never on a decline.**

## The procedure is a default route, not a cage

The steps above are the fast path. **A missing precondition is a fallback
condition, not a blocker** — self-orient, take another route, and say which one
you took. Where the shipped path runs out:

| The shipped path assumes | When it isn't true |
|---|---|
| Transcripts are on disk for this host | Parser exits 3. Ask the user to paste a session transcript or summary and run steps 3–7 on that text — skip the watermark, and note in the report that it was a pasted-transcript run. |
| The sessions were held in English | The corrections list will be short or empty and will look exactly like a clean run. Say so rather than reporting "few corrections". Lean on the language-neutral signals (tool errors, retries, churn, interrupts), extend `CORRECTION_TIERS` for this team's language, or ask the user what the friction was. |
| `.agents/` exists | It doesn't → the project was never seeded. A retrospective refines an existing lens; it can't create one. Run `seeding-a-project` first. |
| The user wants the digest's questions answered | They often want something else — "why was last week expensive", "did the new briefing help", "what keeps breaking". The digest is one input; combine it with `efficiency-audit`, git history, or the run reports, and answer the question actually asked. |

**What must survive whichever route you take:**

1. **Never write without an explicit ack.** No route makes this optional, and a
   route that reaches a write without one is wrong however good its findings.
2. **Every finding cites the session it came from.** A lesson you cannot point
   at is a guess, and memory is expensive to un-poison.
3. **Reason over the digest, never raw `.jsonl`.** Pulling transcripts into
   context to "check properly" burns the budget the retrospective exists to
   protect.
4. **Advance the watermark only after a successful write** — never on a dry
   run, a decline, or an alternate route that wrote nothing.

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

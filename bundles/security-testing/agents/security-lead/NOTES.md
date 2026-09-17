# Notes — security-lead (maintainer notes, not injected)

This file is for whoever edits the agent next. It is not in
`SDLC_ROLE_MEMORY_FILES_DEFAULT`, so no hook injects it and no host installs
it into an agent's context; `SOUL.md` and `RULES.md` are the injected pair.

## Where the contract is pinned

- **Frontmatter** — plan §4.7 "security-lead (M3)" verbatim
  (`docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md`).
  `bundles/security-testing/skills/security-evidence/scripts/agents.test.mjs`
  (TASK-047 section) asserts every key, the key order, the absence of
  `tools:` / `context-memory` / `mcpServers`, the third `context-docs`
  entry `security-testing/risk-register.md` (the view `register.mjs
  render` writes — TASK-059, TL-8; it may be absent before the first
  render), and the `SOUL.md` / `RULES.md` / `briefings/security-lead.md`
  siblings. `factory.json` lists the agent from TASK-048 on; until then the
  directory exists and installs only by name.
- **Body order** — `## Tool-call economy` (verbatim from
  `bundles/feature-development/agents/tech-lead/AGENT.md`; the test
  byte-compares the section), `## Rules` (the four spec §4 rules),
  `## Contracts` (`### assess`, `### verify`, `### tracker`, `### accept`,
  the return-line table), `## Writable paths self-check`, `## Never`.
- **Command spellings** — every argv in `### assess` / `### verify` /
  `### tracker` / `### accept` is the header of the owning
  `scripts/lib/cmd-*.mjs`, and the test walks them in order with a cursor
  (`ASSESS_ORDER`). Change a flag in a command and this file, the
  `security-engagement` references and the test move together.

## Decisions worth knowing

- **The hand-off follows `COMMITTED`.** Plan §5 sketches
  `… → publish → hand-off, stop → (later) ingest qa-run → … → build-report`
  in one line; `publish` requires a `COMMITTED` run and `ingest`, `gate`,
  `admit`, `run snapshot` refuse one, so the procedure closes the run
  (`build-report` → `check` → `sign-off`) before it publishes, and the QA
  report is ingested into the **next** assessment run — where the same
  candidates are admitted and `ingest case`d again, because the
  `case_id ↔ case_sha256` join is per run (`lib/observations.mjs`).
  Recorded as a deviation on the TASK-047 result; P1/P2 hold either way.
- **`ingest` before `gate`.** The write-once `<run>/unlocated.json` is
  `gate`'s (G-10); a qa-run report ingested after `gate` keeps its
  `unadmitted-case` rows only on its `IMPORT … unlocated=<n>` line and in
  its record. The procedure makes the order explicit (Phase 2) and says
  where the rows are visible when the order is not kept.
- **`mitigated` costs a run.** `tm-lint check` validates `mitigated(M-nnn)`
  from the run's own receipts and `receipt validate` enforces
  `reviewer_run_id == run`, while a changed disposition changes the model's
  identity (`SNAPSHOT-EXISTS`). Step 19 spells the re-dispatch on the new
  run; TASK-039 may later let `check` accept a receipt from an earlier run
  at the same head (`acceptsReviewerRun` precedent) — then shorten step 19.
- **Read-backs need an open run.** `ingest tracker-readback` refuses a
  `COMMITTED` run; the tracker contract says to read back into the next
  assessment run (opening it if needed) and accepts that a run whose
  `HEAD` moved before `scope` stays `INCOMPLETE` in the ledger.
- **Alias-aware `publish`, exact read-back.** TASK-045 PM ruling: the
  read-back row lookup is `subject == finding_id` of the sent payload; the
  tracker contract tells the lead to add a row for the new id and read
  back again, then `supersede … --subject-equivalent`.
- **`admit --dry-run` shipped with TASK-043**, so the procedure uses it
  instead of the "lint by reading the case against passive-admission.md"
  fallback the G22 follow-up proposed.
- **`output=./tasks/…`** in the `PUBLISHED` line is quoted verbatim
  (redact.mjs `high-entropy-assign` would blank the bare spelling; routed
  to the redact.mjs owner's rules-v2 list).

## Siblings

- `SOUL.md` — persona ("Noor"); injected first at dispatch.
- `RULES.md` — thirteen standing rules; injected second.
- `../../briefings/security-lead.md` — seeded to
  `.agents/memory/security-lead/project_briefing.md` by `factory.json`
  `briefings` once TASK-048 lists it: the record, the view, where the
  specialists' files arrive, which commands are yours and which are theirs.

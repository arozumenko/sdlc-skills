# Notes — security-reviewer (maintainer notes, not injected)

This file is for whoever edits the agent next. It is not in
`SDLC_ROLE_MEMORY_FILES_DEFAULT`, so no hook injects it and no host installs
it into an agent's context; `SOUL.md` and `RULES.md` are the injected pair.

## Where the contract is pinned

- **Frontmatter** — plan §4.7 verbatim (`docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md`).
  `bundles/security-testing/skills/security-evidence/scripts/agents.test.mjs`
  asserts every key, the key order, the absence of `tools:` /
  `context-memory` / `mcpServers`, and the `SOUL.md` / `RULES.md` /
  `briefings/security-reviewer.md` siblings. Change the frontmatter only
  with the plan (TASK-037 lists this agent in `factory.json`; TASK-048
  extends the roster).
- **Body order** — `## Tool-call economy` (verbatim from
  `bundles/feature-development/agents/tech-lead/AGENT.md`; the test
  byte-compares the section), `## Rules` (the four spec §4 rules), `##
  Contracts` (four `###` subsections, each carrying its return line
  verbatim), `## Writable paths self-check`, `## Never`. The `## Identity`,
  `## Session Start` and `## Session End` blocks are the repo's house style
  and sit around that order.
- **Return-line grammar** — closed, one line per contract, tested as literal
  strings. If a script ever consumes these lines (none does at M1: the lead
  reads them and runs the admitting command), export the formatters from
  `scripts/lib/tokens.mjs` under a comment naming the task and make this
  test import them rather than restating the strings.

## Decisions worth knowing

- **`review` never writes a receipt** (spec §20 P1). The test strips the
  drop-box path (`receipts/<run_id>/`) and every negation ("no receipt",
  "never a receipt") from the `### review` subsection and then asserts the
  word does not appear — so an instruction to write one cannot sneak in
  through a rewrite.
- **Fresh-dispatch refusal** returns `REFUSED fresh-dispatch subject=<id>`.
  That line is outside the four success grammars on purpose: it is a
  non-result, no file is written, and the lead's reaction is to re-dispatch
  in a fresh context. No script parses it.
- **Receipt file names** are `receipt-<subject_id>.json` and
  `ack-<indicator_id>.json`. The scripts do not care about drop-box names
  (`receipt validate` takes a path; the admitted copy is
  `<run>/receipts/<self_sha256>.json`), so the names are for humans and for
  the lead's `--receipts <dir>` sweep in `verify.mjs all` pass 2.
- **`scope_sha256`** for the claims file comes from the dispatch when the
  lead passes it; otherwise the agent reads only the envelope of
  `<run>/scope.json`. That read is a bundle artifact, not product code, and
  is the one file outside the packet the `review` contract may open.
- **Normalised lines.** The PM log (TASK-014 / TASK-020 follow-ups) requires
  the reviewer prose to say citations and declarations count non-blank
  lines; `gate` and `coverage` reject honest raw-numbered claims on files
  with blank lines otherwise. The test greps for "non-blank".

## Siblings

- `SOUL.md` — persona ("Vera"); injected first at dispatch.
- `RULES.md` — twelve standing rules; injected second (hooks/lib.sh keeps
  it ahead of memory so it survives a tight context cap).
- `../../briefings/security-reviewer.md` — seeded to
  `.agents/memory/security-reviewer/project_briefing.md` by `factory.json`
  `briefings` (TASK-037): where packets arrive, whose commands
  `receipt validate` / `gate` are.

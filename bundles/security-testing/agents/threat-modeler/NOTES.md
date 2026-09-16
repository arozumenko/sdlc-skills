# Notes — threat-modeler (maintainer notes, not injected)

This file is for whoever edits the agent next. It is not in
`SDLC_ROLE_MEMORY_FILES_DEFAULT`, so no hook injects it and no host installs
it into an agent's context; `SOUL.md` and `RULES.md` are the injected pair.

## Where the contract is pinned

- **Frontmatter** — plan §4.7 "threat-modeler (M2)" verbatim
  (`docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md`);
  the `description` is this task's wording (the plan's block gives none) and
  the test pins its shape and the phrases the tech-lead reviews for.
  `bundles/security-testing/skills/security-evidence/scripts/agents.test.mjs`
  (TASK-040 block) asserts every key, the key order, the absence of `tools:`
  / `context-memory` / `mcpServers`, and the `SOUL.md` / `RULES.md` /
  `briefings/threat-modeler.md` siblings. The agent is **not** in
  `factory.json` yet — TASK-048 adds it to `localAgents` and `briefings`.
- **Body order** — the same as the reviewer's: `## Tool-call economy`
  (verbatim from `bundles/feature-development/agents/tech-lead/AGENT.md`;
  byte-compared), `## Rules` (the four spec §4 rules), `## Contracts`
  (`### threat-model`, `### dispose`, `### What the lead does …`),
  `## Writable paths self-check`, `## Never`; `## Identity`, `## Session
  Start` and `## Session End` are the house style around that order.
- **Return-line rule** — `MODEL_WRITTEN elements=<n> threats=<n>
  undisposed=<n>` appears verbatim in every `###` contract that carries it,
  conditioned on `tm-lint.mjs check --run <run_id>` exit 0 (the real
  spelling from `lib/cmd-tm-lint.mjs`), with the integers copied from the
  script's `TM elements=<n> threats=<n> undisposed=<n>` line; any other exit
  returns the lint line verbatim. No script consumes the `MODEL_WRITTEN`
  line at M2 (the lead reads it), so — as with the reviewer's lines — it is
  a literal string in the test, not a `tokens.mjs` export. If TASK-047's
  `assess` or the E2E ever parses it, export a formatter from
  `scripts/lib/tokens.mjs` under a comment naming the task and import it
  here.

## Decisions worth knowing

- **Two contracts, one grammar.** `threat-model` builds the model;
  `dispose` restates dispositions once the lead holds evidence. Both end in
  the same line because the script's output is the same. `dispose` exists
  so the body can say plainly that a changed disposition changes the model's
  identity (`SNAPSHOT-EXISTS` on the old run) and the lead opens the new run
  — the PM's R1 ruling (snapshot write-once) made that explicit.
- **`tm-lint check` is the one script the agent runs.** Unlike the reviewer
  (who never admits its own output), the modeler's contract is "a model the
  script accepted", so it must run `check`; it still never runs `packet`,
  `receipt validate`, `render`, `build-report` or `sign-off` on its model.
- **Mitigations as claims** (plan §5 TASK-040): the body says a
  `mitigation-review` is a separate `security-reviewer` dispatch over
  `packet --kind subject --subject M-nnn`, and that the derived
  `MITIGATION_CONFIRMED` state — never the modeler's word — is what
  `mitigated(M-nnn)` needs. The test greps for each of those spellings.
- **Exit 1 with an empty stdout.** The TASK-039 follow-up in the PM log
  (unescaped newlines in agent-authored free text reach `tokens.tmInvalid`,
  which throws) means the "lint line verbatim" rule can have no stdout line
  to return; the body says to return the first stderr line then, and rule
  10 tells the modeler to keep every string one line so it does not happen.
- **`security-test-planning` is on-demand before it exists.** §4.7 lists it
  and TASK-042 ships it; the body names when to load it (a `planned`
  disposition needs a case or proposal the lead admits). Nothing in this
  repo resolves `skills-on-demand:` ids at test time, and the agent is not
  installed until TASK-048 lists it.

## Siblings

- `SOUL.md` — persona ("Ilse"); injected first at dispatch.
- `RULES.md` — thirteen standing rules; injected second (hooks/lib.sh keeps
  it ahead of memory so it survives a tight context cap).
- `../../briefings/threat-modeler.md` — seeded to
  `.agents/memory/threat-modeler/project_briefing.md` once TASK-048 adds it
  to `factory.json` `briefings`: where the scope is, the one file the
  modeler writes, what `check` derives, whose commands the rest are.

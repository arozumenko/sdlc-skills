# Design: `test-automation` bundle

**Date:** 2026-05-26
**Status:** Approved design — ready for implementation plan
**Origin:** Salvage of the net-new value from PR #15 (`upstream/test-automation-full`), which cannot be merged (heavy conflicts with `main` after #16 bundles + #17 README landed).

## Problem

PR #15 carried a large test-automation refactor branched off `b827ebb`, before
the bundles system existed. Most of it (workflow-skill refactor, installer
hardening, scout/PM/project-seeder/onboarding churn) is now superseded by or
conflicting with `main`. The one genuinely net-new, valuable artifact is the
**`test-automation-lead` agent ("Tal")** — an orchestrator that runs the
analyst → implementer → reviewer pipeline, owns test-framework architecture, and
owns the automation merge gate. It does not exist on `main`.

Rather than resolve the conflicting PR, we package the test-automation team as a
fourth **bundle** (alongside `team-web`, `team-ios`, `web-qa`) and salvage only
Tal. The work is almost entirely additive — a new `bundles/test-automation/`
directory plus one small validator generalization.

## Goal

Ship `bundles/test-automation/`: an automation-focused team that turns TMS cases
into merged, honest automated tests, installable via
`npx … init --bundle test-automation`.

## Team shape

Tal collapses the PM + tech-lead roles into one for this team. He is a
**top-level orchestrator the user launches directly** (not a subagent of PM).

| Slot | Agent | Persona | Source | Skill in flow |
|---|---|---|---|---|
| Lead / orchestrator (PM + tech-lead combined) | `test-automation-lead` | Tal | **bundle-local** (salvaged from PR #15) | `test-automation-workflow`, `test-case-analysis` (+ more) |
| Onboarding / project seeding | `scout` | — | shared (`agents[]`) | — |
| Implementer | `test-automation-engineer` | Axel | shared (`agents[]`) | `test-automation-workflow` |
| Analyst + Reviewer | `qa-engineer` | Sage | shared (`agents[]`) | `test-case-analysis`, `code-review` |

Pipeline Tal runs:

```
User drops TMS case  →  launches Tal directly
   Tal → Analyst (qa-engineer + test-case-analysis) → AFS + status
       → (gate: only ready-for-automation advances)
       → Implementer (test-automation-engineer + test-automation-workflow) → PR + Run Report
       → Reviewer (qa-engineer FRESH session + code-review) → APPROVED | CHANGES_REQUESTED
       → Tal merges, files follow-ups, back-writes TMS, reports to user
```

## Files

All under `bundles/test-automation/`:

### `bundle.json`
```json
{
  "id": "test-automation",
  "title": "Test Automation Team",
  "description": "Automation-focused team that turns TMS cases into merged, honest automated tests — Tal leads the analyst → implementer → reviewer pipeline and owns framework architecture and the automation merge gate.",
  "agents": ["scout", "test-automation-engineer", "qa-engineer"],
  "localAgents": ["test-automation-lead"],
  "skills": ["test-automation-workflow", "test-case-analysis"],
  "briefings": {
    "scout": "briefings/scout.md",
    "test-automation-engineer": "briefings/test-automation-engineer.md",
    "qa-engineer": "briefings/qa-engineer.md",
    "test-automation-lead": "briefings/test-automation-lead.md"
  },
  "instructions": "instructions.md",
  "targets": ["claude"]
}
```

- `skills[]` lists the two pipeline-critical skills **explicitly**. They would
  also install via agent-skill inference (qa-engineer declares
  `test-case-analysis`; TAE declares `test-automation-workflow`; Tal declares
  both — all exist as `skills/` dirs *and* in `skills.json`). Listing them is
  belt-and-suspenders: documents the dependency and survives any future trim of
  an agent's frontmatter. The installer dedupes, so no double-install.
- **No `skillOverlays`.** `xray-testing` (the Xray TMS adapter) stays
  conditional — loaded only when the project's `.agents/profile.md` declares
  `tms.adapter: xray`, per Tal's existing logic. Keeps the bundle TMS-agnostic
  (Zephyr / TestRail / Azure / markdown all work).

### `agents/test-automation-lead/{AGENT.md, SOUL.md, RULES.md}`
Salvaged verbatim from PR #15 with three adaptations:
1. **Frontmatter skill rename:** `task-completion` → `completing-a-task` (the
   name on `main`). All of Tal's other declared skills
   (`test-automation-workflow`, `test-case-analysis`, `code-review`,
   `issue-tracking`, `atlassian-content`, `git-workflow`, `plan-feature`,
   `memory`) already exist on `main`.
2. **Relative skill links:** the doc body's `../../skills/<name>/` links resolve
   from `agents/<role>/` at repo root but break from the deeper bundle path
   `bundles/test-automation/agents/test-automation-lead/`. Repoint them so they
   resolve (or convert to plain skill-name references — the frontmatter is what
   actually loads skills; the links are documentation).
3. **Octobots blocks kept as-is.** `OCTOBOTS-ONLY` / `STANDALONE-ONLY`
   conditional pairs remain the standard across `main`'s agents (PM has 9, TAE
   has 2), so keeping Tal's matches the repo convention. No stripping.

### `briefings/{scout,test-automation-engineer,qa-engineer,test-automation-lead}.md`
TA-context project-briefing overlays (frontmatter `name: Project briefing`,
`type: project`, plus a one-line `description:` used for the MEMORY.md index
line). Structurally modeled on `team-web/briefings/*` but re-pointed at a
**test-automation engagement**: the product under test can be any stack; the
team's deliverable is the test framework + the TMS→PR pipeline. Each briefing is
the starting `project_briefing.md` scout later refines per project.

- **scout:** detect the test framework / TMS / base branch / merge policy;
  populate `.agents/profile.md`, `.agents/testing.md`, `.agents/workflow.md`,
  `.agents/team-comms.md`. Flag a missing TMS adapter as the highest-risk gap.
- **test-automation-engineer (Axel):** implementer-slot focus — read AFS, write
  POMs/fixtures/specs, honor No-Defect-Masking, return Run Report.
- **qa-engineer (Sage):** dual analyst + reviewer focus — emit a complete AFS as
  analyst; adversarial test-honesty review as reviewer.
- **test-automation-lead (Tal):** orchestration focus — the pipeline, the AFS
  gate, the merge protocol; pointer to confirm `.agents/profile.md` § Automation
  PR policy on first run.

### `instructions.md`
Team-wide conventions spliced into root `AGENTS.md` (inside
`<!-- BUNDLE:test-automation START/END -->` markers by the installer). Covers:
the team is automation-focused; **Tal is a top-level orchestrator launched
directly by the user** (the user picks Tal for automation work — there is no PM
above him on a TA-only project); scout seeds project context first; the
analyst → implementer → reviewer pipeline and the merge gate; No-Defect-Masking
as a team-wide rule. Modeled on `team-web/instructions.md`.

### `README.md`
Front-door doc (required by `bin/validate-bundles.mjs`): what the bundle is, the
install command, the roster table, when to use it (TA-only or
automation-pipeline engagements), and how it relates to `team-web` (which
includes TAE + qa-engineer but no orchestrator).

## Required code change

`bin/validate-bundles.mjs` currently rejects any `briefings` role not in
`agents[]` (and likewise for `skillOverlays`). A hybrid bundle needs to seed a
briefing for a **local** agent (Tal). Generalize the membership check to the
**combined roster** (`agents[]` ∪ `localAgents[]`):

- Briefing-role check (line ~93–96): accept role in `agents` **or**
  `localAgents`.
- For consistency, apply the same combined-roster rule to the `skillOverlays`
  role check (line ~125–126), even though this bundle ships no overlays.

`installBriefings` (init.mjs line 253) already seeds purely by role name with no
roster check, so it handles a local-agent briefing without modification. No
other installer change is needed; `--bundle test-automation` flows through the
existing `loadBundle`/`applyBundle`/`installBriefings`/`installInstructions`
paths unchanged.

## Out of scope (dropped from PR #15)

The workflow-skill refactor, installer hardening, scout/project-manager/
project-seeder changes, the rename churn, and `TEST-AUTOMATION-ONBOARDING.md`
edits — all superseded by or conflicting with current `main`. We salvage **only**
Tal.

## Validation / done

- `node bin/validate-bundles.mjs` passes with `test-automation` listed
  (`✓ test-automation (4 agents)`), and the existing three bundles still pass.
- A dry/real `npx … init --bundle test-automation` installs scout + TAE +
  qa-engineer + local Tal, seeds all four briefings to
  `.agents/memory/<role>/project_briefing.md` with MEMORY.md index lines,
  installs `test-automation-workflow` + `test-case-analysis` (+ inferred agent
  skills), and splices the `BUNDLE:test-automation` block into `AGENTS.md`.
- README.md (repo root) bundle list updated to mention `test-automation`.
- `memory/bundles-design.md` updated to record the new bundle.
```

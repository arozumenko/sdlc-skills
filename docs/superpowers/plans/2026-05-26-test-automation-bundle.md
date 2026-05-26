# Test Automation Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `bundles/test-automation/` — a fourth installable team bundle composing scout + test-automation-engineer + qa-engineer plus a bundle-local `test-automation-lead` (Tal) orchestrator salvaged from PR #15.

**Architecture:** Purely additive — a new `bundles/test-automation/` directory (bundle.json, one local agent, four briefings, instructions, README) plus one small generalization to `bin/validate-bundles.mjs` so a briefing can target a local agent. No installer code change is needed; the existing `loadBundle`/`applyBundle`/`installBriefings`/`installInstructions` paths handle the hybrid bundle unchanged. Validation = `node bin/validate-bundles.mjs` green + a dry install into a temp dir.

**Tech Stack:** Node ESM (the installer/validator), Markdown agent/briefing/instruction files, JSON bundle manifest. No test framework in this repo — verification is the validator CLI + a real install run.

**Spec:** `docs/superpowers/specs/2026-05-26-test-automation-bundle-design.md`

**Working branch:** `test-automation-bundle` (already created; the spec commit `d233a62` is on it).

---

### Task 1: Generalize the validator to the combined roster

A hybrid bundle seeds a briefing for a **local** agent (Tal). The validator currently rejects any `briefings` role not in `agents[]`. Generalize the membership check to `agents[]` ∪ `localAgents[]`, and apply the same rule to the `skillOverlays` check for consistency.

**Files:**
- Modify: `bin/validate-bundles.mjs:83-130`

- [ ] **Step 1: Confirm current validator passes (baseline, no regression target)**

Run: `node bin/validate-bundles.mjs`
Expected: PASS — `✓ team-web`, `✓ team-ios`, `✓ web-qa` all listed, exit 0. (This is the baseline; after the edit it must still pass.)

- [ ] **Step 2: Add a combined-roster set and use it in the briefings check**

In `bin/validate-bundles.mjs`, the block starting at line 83 currently reads:

```javascript
    const hasLocal = Array.isArray(b.localAgents) && b.localAgents.length > 0;
    const declaredAgents = Array.isArray(b.agents) ? b.agents : [];
    if (b.agents !== undefined && !Array.isArray(b.agents)) {
      err(id, "`agents` must be an array");
    } else if (declaredAgents.length === 0 && !hasLocal) {
      err(id, "`agents` must be a non-empty array (or provide localAgents)");
    } else {
      for (const a of declaredAgents) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }

    for (const [role, rel] of Object.entries(b.briefings || {})) {
      if (!Array.isArray(b.agents) || !b.agents.includes(role))
        err(id, `briefing role "${role}" not in agents[]`);
      if (!existsSync(join(dir, rel))) err(id, `briefing file missing: ${rel}`);
    }
```

Replace that whole span with (adds `roster`, retargets the briefings check):

```javascript
    const hasLocal = Array.isArray(b.localAgents) && b.localAgents.length > 0;
    const declaredAgents = Array.isArray(b.agents) ? b.agents : [];
    if (b.agents !== undefined && !Array.isArray(b.agents)) {
      err(id, "`agents` must be an array");
    } else if (declaredAgents.length === 0 && !hasLocal) {
      err(id, "`agents` must be a non-empty array (or provide localAgents)");
    } else {
      for (const a of declaredAgents) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }

    // A briefing/overlay role may target any installed agent — shared (agents[])
    // or bundle-local (localAgents[]). Build the combined roster once.
    const roster = new Set([
      ...declaredAgents,
      ...(Array.isArray(b.localAgents) ? b.localAgents : []),
    ]);

    for (const [role, rel] of Object.entries(b.briefings || {})) {
      if (!roster.has(role))
        err(id, `briefing role "${role}" not in agents[] or localAgents[]`);
      if (!existsSync(join(dir, rel))) err(id, `briefing file missing: ${rel}`);
    }
```

- [ ] **Step 3: Retarget the skillOverlays check to the same roster**

The block at line 124 currently reads:

```javascript
    for (const [role, ov] of Object.entries(b.skillOverlays || {})) {
      if (!Array.isArray(b.agents) || !b.agents.includes(role))
        err(id, `skillOverlay role "${role}" not in agents[]`);
```

Replace those two lines (keep the rest of the loop body unchanged):

```javascript
    for (const [role, ov] of Object.entries(b.skillOverlays || {})) {
      if (!roster.has(role))
        err(id, `skillOverlay role "${role}" not in agents[] or localAgents[]`);
```

- [ ] **Step 4: Run the validator — confirm no regression**

Run: `node bin/validate-bundles.mjs`
Expected: PASS — the existing three bundles still validate, exit 0. (No new bundle yet; this proves the refactor didn't break anything.)

- [ ] **Step 5: Commit**

```bash
git add bin/validate-bundles.mjs
git commit -m "$(cat <<'EOF'
fix(validate-bundles): allow briefing/overlay roles for local agents

Generalize the briefings and skillOverlays role check from agents[]-only
to the combined agents[] ∪ localAgents[] roster, so a hybrid bundle can
seed a project briefing for a bundle-local agent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Salvage the test-automation-lead (Tal) agent from PR #15

Bring Tal's three files into the bundle, with two adaptations: the `task-completion` → `completing-a-task` skill rename, and `../../skills/` → `../../../../skills/` relative-link fix (the bundle path is two levels deeper than `agents/<role>/`).

**Files:**
- Create: `bundles/test-automation/agents/test-automation-lead/AGENT.md`
- Create: `bundles/test-automation/agents/test-automation-lead/SOUL.md`
- Create: `bundles/test-automation/agents/test-automation-lead/RULES.md`

- [ ] **Step 1: Ensure PR #15's head is fetched locally**

Run: `git fetch origin pull/15/head:pr15 2>/dev/null || git rev-parse pr15`
Expected: either fetches the ref, or prints the existing `pr15` SHA (currently `13f4739…`). Either way `pr15` resolves.

- [ ] **Step 2: Extract the three agent files verbatim**

```bash
mkdir -p bundles/test-automation/agents/test-automation-lead
git show pr15:agents/test-automation-lead/AGENT.md > bundles/test-automation/agents/test-automation-lead/AGENT.md
git show pr15:agents/test-automation-lead/SOUL.md  > bundles/test-automation/agents/test-automation-lead/SOUL.md
git show pr15:agents/test-automation-lead/RULES.md > bundles/test-automation/agents/test-automation-lead/RULES.md
```

- [ ] **Step 3: Apply the skill rename in the frontmatter**

In `bundles/test-automation/agents/test-automation-lead/AGENT.md`, the `skills:` frontmatter line reads:

```
skills: [test-automation-workflow, test-case-analysis, code-review, issue-tracking, atlassian-content, task-completion, git-workflow, plan-feature, memory]
```

Change `task-completion` to `completing-a-task`:

```
skills: [test-automation-workflow, test-case-analysis, code-review, issue-tracking, atlassian-content, completing-a-task, git-workflow, plan-feature, memory]
```

- [ ] **Step 4: Fix the relative skill-doc links (deeper bundle path)**

The body has three `../../skills/...` links (in the Tracker-discipline and Framework-Architecture sections). From `bundles/test-automation/agents/test-automation-lead/`, repo root is four levels up. Replace every `../../skills/` with `../../../../skills/`:

```bash
sed -i '' 's#(\.\./\.\./skills/#(../../../../skills/#g' bundles/test-automation/agents/test-automation-lead/AGENT.md
```

(On GNU sed drop the `''` after `-i`.)

- [ ] **Step 5: Verify the adaptations landed and nothing else drifted**

Run:
```bash
grep -n "completing-a-task\|task-completion" bundles/test-automation/agents/test-automation-lead/AGENT.md
grep -n "\.\./\.\./skills/" bundles/test-automation/agents/test-automation-lead/AGENT.md
grep -c "\.\./\.\./\.\./\.\./skills/" bundles/test-automation/agents/test-automation-lead/AGENT.md
```
Expected: first line shows `completing-a-task` and NO `task-completion`; second grep returns nothing (no stale `../../skills/`); third grep prints `3` (the fixed links). Octobots `OCTOBOTS-ONLY`/`STANDALONE-ONLY` blocks are intentionally left untouched (they match the repo convention).

- [ ] **Step 6: Commit**

```bash
git add bundles/test-automation/agents/test-automation-lead/
git commit -m "$(cat <<'EOF'
feat(test-automation): salvage test-automation-lead (Tal) agent from PR #15

Bundle-local orchestrator that runs the analyst → implementer → reviewer
pipeline, owns test-framework architecture, and owns the automation merge
gate. Adapted to main: task-completion → completing-a-task skill rename,
relative skill links repointed for the deeper bundle path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Write the four project briefings

TA-context overlays seeded to `.agents/memory/<role>/project_briefing.md`. Frontmatter must carry `name: Project briefing`, a one-line `description:` (used verbatim for the MEMORY.md index line by `installBriefings`), and `type: project`.

**Files:**
- Create: `bundles/test-automation/briefings/scout.md`
- Create: `bundles/test-automation/briefings/test-automation-engineer.md`
- Create: `bundles/test-automation/briefings/qa-engineer.md`
- Create: `bundles/test-automation/briefings/test-automation-lead.md`

- [ ] **Step 1: Write `briefings/scout.md`**

```markdown
---
name: Project briefing
description: Stack overlay (test-automation) — onboard a test-automation engagement; detect framework, TMS, base branch, merge policy
type: project
---

## Project Knowledge

- **Engagement type:** Test-automation. The product under test can be **any
  stack** — your job is not to map the application architecture in depth, but to
  map the **test framework + the path from TMS case to merged automated test**.
- **Detect the test framework:** look for `playwright.config.*`, `cypress.config.*`,
  `wdio.conf.*`, `pytest.ini`/`conftest.py` + `playwright`/`pytest` deps,
  `pom.xml` with JUnit/Playwright-Java, `*.csproj` with NUnit/Playwright.NET.
  Record the framework, its version, the page-object/fixture convention, the
  locator strategy, and the **run command** + **CI command**. Write these into
  `.agents/testing.md`.
- **Detect the TMS (test management system):** Xray (Jira app), Zephyr, TestRail,
  Azure Test Plans, or a markdown/`test-specs/` fallback. The TMS adapter is the
  single highest-risk unknown — if you can't confirm it, say so loudly. Record it
  in `.agents/test-automation.yaml` (`tms.adapter: …`) so Tal loads the right
  adapter skill conditionally.
- **Detect the issue tracker + automation PR policy:** base branch, merge policy
  (`auto-merge` / `human-approved` / `manual`), merge strategy
  (`squash`/`rebase`/`merge`). Record under `.agents/profile.md` § Automation PR
  policy — Tal reads it before every merge.
- **Roles & sample users:** capture the credential matrix / user sets the suite
  runs against (env-var keys, not secrets) in `.agents/profile.md`.

## My Role Focus

Onboard a test-automation engagement: produce `.agents/profile.md`,
`.agents/testing.md`, `.agents/workflow.md`, and `.agents/team-comms.md` so Tal
can dispatch the pipeline without flying blind. The framework + TMS adapter +
automation PR policy are the fields Tal depends on most — fill them or flag them
explicitly as gaps. There is no separate PM or tech-lead on this team; Tal owns
both, so your profile is his single source of project truth.
```

- [ ] **Step 2: Write `briefings/test-automation-engineer.md`**

```markdown
---
name: Project briefing
description: Stack overlay (test-automation) — implementer slot; turn a ready AFS into a merged, honest automated test
type: project
---

## Project Knowledge

- **Your slot:** implementer. Tal hands you a `ready-for-automation` AFS
  (Automation Feasibility Spec) and a user set; you return a PR-ready diff plus a
  Run Report (template in `test-automation-workflow`).
- **Read first every session:** `.agents/testing.md` (framework, run command,
  POM/fixture convention, locator ladder), `.agents/profile.md` (base URL,
  credentials matrix), and the AFS at the path Tal gives you.
- **Refuse work that isn't yours:** if the AFS status is not
  `ready-for-automation`, return it — don't try to "make it work."
- **No defect masking:** `test-automation-workflow` § No Defect Masking forbids
  `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and weakened assertions for
  product defects. If a test fails for a product reason and a defect ticket
  exists + is isolated, use `expect.soft()` with a `// Known defect: <TICKET-ID>`
  comment; otherwise let it fail and report `blocked`.
- **Stay on the branch Tal created.** Don't switch, rebase, or touch git history
  unless `.agents/workflow.md` grants you commit authority for this project.

## My Role Focus

Write the page objects, fixtures, and specs to automate the case in the AFS,
against the real app, on the branch Tal created. Six-phase loop: Absorb →
Explore (if AFS selectors don't match the observed DOM) → Automate → Execute →
Debug → Handoff. Soft retry budget ≤ 3 reruns against the same root cause, then
escalate (`needs-tal` or `needs-analyst-rerun`). Hand back a Run Report — never
a bare "done."
```

- [ ] **Step 3: Write `briefings/qa-engineer.md`**

```markdown
---
name: Project briefing
description: Stack overlay (test-automation) — analyst + reviewer slots in Tal's pipeline
type: project
---

## Project Knowledge

- **You fill two slots, never at once:** **analyst** (with `test-case-analysis`)
  and **reviewer** (with `code-review`, in a FRESH session). Tal names the slot in
  every dispatch prompt — read it; it tells you which hat you're wearing.
- **Analyst slot:** fetch the TMS case with all core fields (steps + expected),
  execute it end-to-end against the base URL, discover **stable, observed**
  selectors (from real DOM snapshots, not guesses), classify test data, file any
  product defects via `atlassian-content` (Jira) or `issue-tracking` (other
  trackers), and emit an AFS at `test-specs/<feature>/l<pri>_<slug>_<TMS-ID>.md`
  with a status: `ready-for-automation` | `blocked` | `defect-found` |
  `un-automatable`.
- **Reviewer slot:** you did NOT write the code under review. Review with an
  adversarial eye — assertion strength, selector stability, defect masking, POM
  discipline (no raw selectors in spec files), AFS-vs-implementation drift.
  Verdict: `APPROVED` | `CHANGES_REQUESTED` with file:line findings.
- **TMS adapter** is project-specific (`.agents/test-automation.yaml`). Load
  `xray-testing` only when the adapter is Xray; other adapters don't need it.

## My Role Focus

As analyst, produce an AFS complete enough that the implementer never has to
guess — every selector observed, every datum classified, every defect filed.
As reviewer, protect test honesty: no demoted `expect`s, no masked defects, no
selector drift left undocumented. Same persona, two fresh sessions, two
different jobs — let Tal's prompt tell you which.
```

- [ ] **Step 4: Write `briefings/test-automation-lead.md`**

```markdown
---
name: Project briefing
description: Stack overlay (test-automation) — orchestration starting context for Tal
type: project
---

## Project Knowledge

- **Your role on this team:** top-level orchestrator. There is no PM or tech-lead
  above you — you collapse both. The user launches you directly with a TMS case or
  batch; you route the analyst → implementer → reviewer pipeline, own
  test-framework architecture, and own the automation merge.
- **Read before your first dispatch:** `.agents/team-comms.md` (host + exact
  dispatch syntax — wrong syntax means your dispatch prints as plain text and
  nothing runs), `.agents/profile.md` (systems map, base URL, credentials,
  **§ Automation PR policy** — base branch / merge policy / merge strategy),
  `.agents/testing.md` (framework conventions), `.agents/test-automation.yaml`
  (TMS adapter).
- **If none of scout's files exist:** the project hasn't been seeded — pause and
  ask the operator to run scout before dispatching blind.
- **TMS adapter:** load `xray-testing` only when
  `.agents/test-automation.yaml` § `tms.adapter: xray`. Other adapters
  (Zephyr / TestRail / Azure / markdown) don't need it.

## My Role Focus

Run the pipeline and keep the user informed. Every routing turn must contain a
real dispatch (not a sentence about dispatching). Gate on AFS status — only
`ready-for-automation` advances. Enforce No-Defect-Masking at dispatch time.
Read § Automation PR policy before every merge. After every meaningful turn,
emit a status update — the user is your only upstream channel.
```

- [ ] **Step 5: Verify all four briefings have the required frontmatter**

Run:
```bash
for f in bundles/test-automation/briefings/*.md; do echo "== $f =="; sed -n '1,4p' "$f"; done
```
Expected: each file starts with `---`, `name: Project briefing`, a `description:` line, `type: project`, `---`.

- [ ] **Step 6: Commit**

```bash
git add bundles/test-automation/briefings/
git commit -m "$(cat <<'EOF'
feat(test-automation): add TA-context briefings for the four roles

scout / test-automation-engineer / qa-engineer / test-automation-lead
project-briefing overlays, seeded to .agents/memory/<role>/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Write the bundle instructions and README

**Files:**
- Create: `bundles/test-automation/instructions.md`
- Create: `bundles/test-automation/README.md`

- [ ] **Step 1: Write `instructions.md`**

```markdown
# Test Automation Team — shared conventions

This is an **automation-focused team**: it turns TMS (test management system)
cases into merged, honest automated tests. These are team-wide defaults — scout
refines them per project in `AGENTS.md`, which always wins over this file.

## Team shape

- **`test-automation-lead` (Tal)** is the orchestrator. On this team he collapses
  the PM and tech-lead roles: he routes the pipeline, owns test-framework
  architecture decisions, and owns the automation merge gate. **The user launches
  Tal directly** for automation work — there is no PM above him. He is a top-level
  orchestrator, not a subagent.
- **`scout`** seeds the project first: framework, TMS adapter, base branch, merge
  policy, credential matrix. If the project isn't seeded, Tal pauses and asks for
  a scout run.
- **`qa-engineer` (Sage)** fills two slots — **analyst** (writes the AFS) and
  **reviewer** (adversarial test-honesty review, fresh session).
- **`test-automation-engineer` (Axel)** fills the **implementer** slot — writes
  the page objects, fixtures, and specs; returns a Run Report.

## The pipeline

```
User drops a TMS case → launches Tal directly
  Tal → Analyst (qa-engineer + test-case-analysis) → AFS + status
      → gate: only `ready-for-automation` advances
      → Implementer (test-automation-engineer + test-automation-workflow) → PR + Run Report
      → Reviewer (qa-engineer FRESH session + code-review) → APPROVED | CHANGES_REQUESTED
      → Tal merges, files follow-ups, back-writes the TMS, reports to the user
```

## Working agreements (team-wide)

- **AFS status is contract law.** Only `ready-for-automation` advances to the
  implementer. `blocked` / `defect-found` / `un-automatable` get handled, never
  forwarded.
- **No defect masking.** `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and
  weakened assertions for product defects are forbidden. A product bug means file
  a ticket and either `expect.soft()` (isolated, ticketed) or a natural fail
  (`blocked`) — never a hidden green.
- **Dispatch is the work.** A routing turn without an actual subagent dispatch in
  the same reply did nothing.
- **Done means green AND tracked.** A `completed` case is clean-green in CI, or
  red-for-a-real-product-bug with a filed, linked ticket. A `test.fail()`-masked
  green is `blocked`.
- **TMS-agnostic.** The Xray adapter skill loads only when the project declares
  `tms.adapter: xray`; Zephyr / TestRail / Azure / markdown all work without it.
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Test Automation Team (`test-automation`)

An automation-focused agent team that turns TMS cases into merged, honest
automated tests. A lead orchestrator (Tal) runs an analyst → implementer →
reviewer pipeline, owns test-framework architecture, and owns the automation
merge gate.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle test-automation
```

## Roster

| Role | Agent | Source | Job |
|---|---|---|---|
| Lead / orchestrator (PM + tech-lead combined) | `test-automation-lead` (Tal) | bundle-local | Routes the pipeline, owns framework architecture + the automation merge gate. The user launches Tal directly. |
| Onboarding | `scout` | shared | Seeds framework / TMS / base branch / merge policy into `.agents/`. |
| Implementer | `test-automation-engineer` (Axel) | shared | Turns a ready AFS into a PR + Run Report. |
| Analyst + Reviewer | `qa-engineer` (Sage) | shared | Writes the AFS (analyst); reviews for test honesty (reviewer, fresh session). |

The pipeline-critical skills — `test-automation-workflow` and
`test-case-analysis` — are installed explicitly with the bundle (and also via the
agents that declare them). The Xray TMS adapter (`xray-testing`) loads
conditionally, only when the project declares `tms.adapter: xray`.

## When to use it

- A **test-automation-only** engagement, or any project where automation work
  runs as its own pipeline with a dedicated lead.
- You want a single orchestrator (Tal) to own routing, framework decisions, and
  the automation merge — without standing up a full feature-development team.

Compared to **`team-web`**, which includes `test-automation-engineer` +
`qa-engineer` as part of a fullstack delivery team but has no automation
orchestrator, this bundle adds Tal and focuses the whole team on the
TMS → merged-test pipeline.

## What gets installed

- The four agents above (Tal copied from this bundle; the other three from the
  shared catalog), with their declared skills.
- `test-automation-workflow` + `test-case-analysis` skills (explicit).
- Project briefings seeded to `.agents/memory/<role>/project_briefing.md` for all
  four roles.
- Team conventions spliced into `AGENTS.md` (inside
  `<!-- BUNDLE:test-automation -->` markers).
```

- [ ] **Step 3: Commit**

```bash
git add bundles/test-automation/instructions.md bundles/test-automation/README.md
git commit -m "$(cat <<'EOF'
feat(test-automation): add bundle instructions + README

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Write `bundle.json` and validate

**Files:**
- Create: `bundles/test-automation/bundle.json`

- [ ] **Step 1: Write `bundle.json`**

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

- [ ] **Step 2: Run the validator — expect the new bundle to pass**

Run: `node bin/validate-bundles.mjs`
Expected: PASS — output now includes `✓ test-automation (4 agents)` alongside the existing three, exit 0. If it reports `briefing role "test-automation-lead" not in agents[] or localAgents[]`, Task 1 was not applied; if it reports `skill "…" not in skills.json or skills/`, recheck the skill names; if `localAgent "test-automation-lead" missing …`, Task 2 didn't land the AGENT.md.

- [ ] **Step 3: Run the full validate script (the CI entry point)**

Run: `npm run validate`
Expected: PASS (this is what `.github/workflows/validate.yml` runs on push/PR).

- [ ] **Step 4: Commit**

```bash
git add bundles/test-automation/bundle.json
git commit -m "$(cat <<'EOF'
feat(test-automation): add bundle.json — manifest for the test-automation team

scout + test-automation-engineer + qa-engineer + bundle-local
test-automation-lead; pins test-automation-workflow + test-case-analysis;
seeds four project briefings. Validates green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verify a real install end-to-end

The bundle has no automated tests; prove it installs correctly into a throwaway project tree.

**Files:** none (verification only)

- [ ] **Step 1: Install the bundle into a temp directory**

```bash
TMP=$(mktemp -d)
node bin/init.mjs init --bundle test-automation --target claude --yes "$TMP" 2>&1 | tail -40
```
(If `bin/init.mjs`'s flag names differ — e.g. it auto-detects target or uses a positional dir — adjust per `node bin/init.mjs --help`. The goal is a non-interactive install into `$TMP`.)
Expected: the run reports installing scout, test-automation-engineer, qa-engineer, 1 local agent (test-automation-lead), the skills, and 4 briefings, with no errors.

- [ ] **Step 2: Verify the installed tree**

```bash
echo "--- agents ---";    ls "$TMP/.claude/agents" 2>/dev/null || find "$TMP" -name AGENT.md
echo "--- Tal local ---"; find "$TMP" -path '*test-automation-lead*' -name '*.md'
echo "--- briefings ---"; for r in scout test-automation-engineer qa-engineer test-automation-lead; do ls "$TMP/.agents/memory/$r/project_briefing.md"; done
echo "--- index lines ---"; grep -h "project_briefing" "$TMP"/.agents/memory/*/MEMORY.md
echo "--- critical skills ---"; ls -d "$TMP"/.claude/skills/test-automation-workflow "$TMP"/.claude/skills/test-case-analysis 2>/dev/null || find "$TMP" -maxdepth 4 -type d -name 'test-automation-workflow' -o -type d -name 'test-case-analysis'
echo "--- AGENTS.md bundle block ---"; grep -n "BUNDLE:test-automation" "$TMP/AGENTS.md"
```
Expected: all four `project_briefing.md` files exist; each role's `MEMORY.md` has a `- [Project briefing](project_briefing.md) — …` line carrying that briefing's `description`; `test-automation-workflow` and `test-case-analysis` skill dirs are present; `AGENTS.md` contains a `<!-- BUNDLE:test-automation START -->`/`END` marker pair with the instructions between them.

- [ ] **Step 3: Confirm Tal's frontmatter skills survived the copy**

```bash
TAL=$(find "$TMP" -path '*test-automation-lead*' -name AGENT.md | head -1)
grep -E "^skills:" "$TAL"
```
Expected: includes `completing-a-task` (not `task-completion`).

- [ ] **Step 4: Clean up**

```bash
rm -rf "$TMP"
```

- [ ] **Step 5: No commit** (verification only — nothing changed in the repo).

---

### Task 7: Document the new bundle (root README + memory)

**Files:**
- Modify: `README.md` (root) — three spots: the `--bundle` example list (~line 155-157), the bundle table (~line 185-187), and the tree comment (~line 465)
- Modify: `/Users/arozumenko/.claude/projects/-Users-arozumenko-Development-sdlc-skills/memory/bundles-design.md` and `MEMORY.md`

- [ ] **Step 1: Add the install-command line**

In `README.md`, after the `web-qa` line (~157):

```
npx github:arozumenko/sdlc-skills init --bundle web-qa     # standalone manual-QA team (live browser testing via Playwright MCP)
```

add:

```
npx github:arozumenko/sdlc-skills init --bundle test-automation  # TMS-driven automation pipeline (analyst → implementer → reviewer, led by Tal)
```

- [ ] **Step 2: Add the bundle-table row**

After the `web-qa` table row (~187), add:

```
| `test-automation` | shared core (scout) + test-automation-engineer + qa-engineer + bundle-local `test-automation-lead` (Tal) | Automation-focused team — Tal orchestrates the analyst → implementer → reviewer pipeline, owns test-framework architecture and the automation merge gate. Pins `test-automation-workflow` + `test-case-analysis`; TMS-agnostic. |
```

- [ ] **Step 3: Update the directory-tree comment**

In `README.md` (~465), change:

```
│   └── <bundle-id>/            # team-web, team-ios, web-qa
```

to:

```
│   └── <bundle-id>/            # team-web, team-ios, web-qa, test-automation
```

- [ ] **Step 4: Commit the README**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(README): document the test-automation bundle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Update memory**

Append a line to `memory/bundles-design.md` recording the new bundle:

```markdown
test-automation bundle (2026-05-26): fourth bundle. Hybrid — agents[scout, test-automation-engineer, qa-engineer] + localAgents[test-automation-lead] (Tal, salvaged from the unmergeable PR #15: task-completion→completing-a-task, relative skill links repointed, Octobots blocks kept). Tal collapses PM+tech-lead: top-level orchestrator the user launches directly, runs analyst→implementer→reviewer, owns framework architecture + automation merge gate. 4 briefings incl. test-automation-lead. bundle.skills pins test-automation-workflow + test-case-analysis (explicit, also agent-inferred). No skillOverlays (xray-testing stays conditional). Required code change: validate-bundles.mjs briefings/skillOverlays role check generalized from agents[]-only to agents[] ∪ localAgents[]. Spec: docs/superpowers/specs/2026-05-26-test-automation-bundle-design.md.
```

Update the `MEMORY.md` index line for bundles-design if the hook summary needs it (optional — the existing pointer still resolves).

- [ ] **Step 6: Final validation sweep**

Run: `npm run validate`
Expected: PASS, all four bundles green.

---

## Notes for the executor

- **No unit-test framework** exists in this repo. "Tests" here are the validator
  CLI (`node bin/validate-bundles.mjs` / `npm run validate`) and the temp-dir
  install in Task 6. Treat a green validator + a clean install as the pass bar.
- **Don't touch** `bin/init.mjs` logic, `skills.json`, `scout`, `project-manager`,
  or `project-seeder` — the design is deliberately additive. The only code edit is
  the validator generalization in Task 1.
- **Octobots blocks in Tal's files are intentional** — they match every other
  agent on `main`. Do not strip them.
- If `bin/init.mjs` rejects the exact flags in Task 6 Step 1, run
  `node bin/init.mjs --help` and adapt; the install *outcome* (Task 6 Step 2) is
  what matters, not the precise flag spelling.
```

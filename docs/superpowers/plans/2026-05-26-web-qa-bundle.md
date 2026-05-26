# web-qa Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the ManualAIQA POC into a standalone `bundles/web-qa/` — a faithful five-agent manual-QA team (setup → tc-writer → orchestrator → executor → reporter) that runs human-readable test cases live via Playwright MCP and reports.

**Architecture:** Five bundle-local agents in our `AGENT.md`/`RULES.md`/`SOUL.md` format; knowledge specs shipped as installer-seeded reference files in `.agents/web-qa/knowledge/`; the xlsx reader as a new `skills/xlsx-reader/` skill; external deps rationalized to our `playwright-testing` + superpowers + a new `playwright-best-practices` registry entry. Two small installer/validator additions support an all-local roster and a generic file-seed step.

**Tech Stack:** Markdown + YAML frontmatter (agents, knowledge), JSON (`bundle.json`, `skills.json`), Node ESM (`bin/init.mjs`, `bin/validate-bundles.mjs`, the xlsx script). Validators: `node bin/validate-bundles.mjs`, `skills-ref validate`.

**Source of truth:** the POC repo `OlhaStetsenko1/manualAIQA@master`. Full design: `docs/superpowers/specs/2026-05-26-web-qa-bundle-migration-design.md`.

**Conventions for every commit:** end the message with
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 1: Stage the POC source for reference

**Files:**
- Create: `/tmp/manualAIQA-src/` (scratch, not committed)

- [ ] **Step 1: Clone the POC**

```bash
rm -rf /tmp/manualAIQA-src
gh repo clone OlhaStetsenko1/manualAIQA /tmp/manualAIQA-src -- --depth 1
```

- [ ] **Step 2: Verify the source files exist**

Run:
```bash
ls /tmp/manualAIQA-src/.claude/agents/ /tmp/manualAIQA-src/knowledge/ /tmp/manualAIQA-src/read_xlsx.js
```
Expected: lists `executor.md orchestrator.md reporter.md setup.md tc-writer.md`, the `knowledge/*.md` files, and `read_xlsx.js`. No commit (scratch only).

---

## Task 2: `skills/xlsx-reader/` skill

**Files:**
- Create: `skills/xlsx-reader/SKILL.md`
- Create: `skills/xlsx-reader/scripts/read_xlsx.js`
- Create: `skills/xlsx-reader/README.md`

- [ ] **Step 1: Port the script**

Copy the POC script and confirm it is parameterized (input path arg → Markdown on stdout or to a path). Start from the POC version:

```bash
mkdir -p skills/xlsx-reader/scripts
cp /tmp/manualAIQA-src/read_xlsx.js skills/xlsx-reader/scripts/read_xlsx.js
```

Then edit `skills/xlsx-reader/scripts/read_xlsx.js` so it: (a) accepts an input `.xlsx` path as `argv[2]` (default `./input.xlsx`) and an optional output path as `argv[3]`; (b) writes Markdown tables (one per sheet) to the output path or stdout; (c) prints a clear error if the `xlsx` package is missing, telling the user to run `npm i xlsx` or `npx`. Use only the `xlsx` package. Keep it under ~60 lines.

- [ ] **Step 2: Write `SKILL.md`**

```markdown
---
name: xlsx-reader
description: Read .xlsx/.xls spreadsheets (test cases, checklists, requirement matrices) into Markdown tables so an agent can ingest them. Use when the user provides an Excel file of test cases or requirements, or asks to import a spreadsheet.
license: Apache-2.0
compatibility: Requires Node.js 18+ and the `xlsx` npm package (install on demand via `npm i xlsx` or `npx`).
metadata:
  author: octobots
  version: "0.1.0"
---

# xlsx-reader

Convert an Excel workbook into Markdown so its rows become readable, agent-ingestible text.

## When to use

The user hands you a `.xlsx` (test cases, checklist, requirement matrix) and you need its contents as text — e.g. before authoring test cases from a spreadsheet.

## Usage

```bash
node scripts/read_xlsx.js <input.xlsx> [output.md]
```

- Each sheet becomes a Markdown table (first row = header).
- With no output path, Markdown is printed to stdout; otherwise written to the file.
- If the `xlsx` package isn't installed, the script prints an install hint (`npm i xlsx`).

## Notes

- Read the produced Markdown back with the Read tool to load it into context.
- Large workbooks: convert the relevant sheet only; don't load everything.
```

- [ ] **Step 3: Write `README.md`**

Follow the existing skill-README pattern (see `skills/code-review/README.md`): title, blockquote description, "When it triggers", Requirements (Node 18+ and `xlsx`), Install (marketplace `xlsx-reader@sdlc-skills`, npx `--skills xlsx-reader`, manual copy), Contents (`SKILL.md`, `scripts/read_xlsx.js`), Learn more. Keep the `<plugin>@<marketplace>` syntax.

- [ ] **Step 4: Validate the skill**

Run:
```bash
/tmp/skillsref-venv/bin/skills-ref validate skills/xlsx-reader || pipx run --spec "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref" skills-ref validate skills/xlsx-reader
```
Expected: validation passes (frontmatter valid, name matches dir). If the venv from earlier sessions is gone, recreate it: `python3.13 -m venv /tmp/skillsref-venv && /tmp/skillsref-venv/bin/pip install -q "git+https://github.com/agentskills/agentskills.git#subdirectory=skills-ref"`.

- [ ] **Step 5: Commit**

```bash
git add skills/xlsx-reader
git commit -m "feat(skills): add xlsx-reader skill (ported from ManualAIQA POC)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Register skills in `skills.json`

**Files:**
- Modify: `skills.json` (the `skills` array)

- [ ] **Step 1: Add the two registry entries**

Add a monorepo entry for `xlsx-reader` and an external entry for `playwright-best-practices`. Match the shape of existing entries (monorepo entries use `monorepo`/`name`; external entries use `repo`/`ref`). Insert near the other QA skills:

```json
    { "id": "xlsx-reader", "monorepo": "sdlc-skills", "name": "xlsx-reader", "description": "Read .xlsx spreadsheets (test cases, checklists) into Markdown for agent ingestion." },
    { "id": "playwright-best-practices", "repo": "currents-dev/playwright-best-practices-skill", "ref": "main", "description": "Playwright selector strategy, wait patterns, and auth/flaky-test guidance." }
```

(Confirm the exact monorepo-entry shape by reading an existing monorepo entry in `skills.json` first — e.g. the `playwright-testing` entry — and mirror its keys precisely.)

- [ ] **Step 2: Verify JSON parses and ids resolve**

Run:
```bash
node -e "const r=require('./skills.json'); const ids=r.skills.map(s=>s.id); for (const id of ['xlsx-reader','playwright-best-practices']) if(!ids.includes(id)) throw new Error('missing '+id); console.log('ok:', ids.length, 'skills')"
```
Expected: `ok: <N> skills` (no throw).

- [ ] **Step 3: Confirm existing bundles still validate**

Run: `node bin/validate-bundles.mjs`
Expected: `team-ios` and `team-web` still report valid (`All 2 bundle(s) valid.`).

- [ ] **Step 4: Commit**

```bash
git add skills.json
git commit -m "feat(skills.json): register xlsx-reader + playwright-best-practices

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Installer `seed` mechanism (`bin/init.mjs`)

**Files:**
- Modify: `bin/init.mjs` (add `installSeed`, default `b.seed` in `loadBundle`, call in `main`)

- [ ] **Step 1: Default the field in `loadBundle`**

In `loadBundle`, alongside the other `b.x = b.x || ...` defaults (near `b.skillOverlays = b.skillOverlays || {};`), add:

```js
  b.seed = b.seed || {}; // bundle-relative source → project-relative dest (reference files)
```

- [ ] **Step 2: Add the `installSeed` function**

Place it next to `installBriefings` (same section). Full content:

```js
// Seed loose reference files/dirs a bundle ships into the project at a fixed
// path. bundle.seed maps a bundle-relative source → a project-relative dest.
// Copied once (IDE-neutral, like briefings); idempotent — an existing dest is
// left intact unless --update. Used for reference docs agents read at runtime:
// a subagent's cwd is the project root, so a fixed project path is resolvable.
function installSeed(bundle, update) {
  let installed = 0;
  let skipped = 0;
  for (const [src, dest] of Object.entries(bundle.seed || {})) {
    const srcPath = join(bundle.dir, src);
    if (!existsSync(srcPath)) {
      console.log(`      ! seed ${src} (missing in bundle)`);
      continue;
    }
    const destPath = join(CWD, dest);
    if (existsSync(destPath) && !update) {
      console.log(`      — seed ${dest} (exists; use --update)`);
      skipped++;
      continue;
    }
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(srcPath, destPath, { recursive: true, force: true });
    console.log(`      ✓ seed ${dest}`);
    installed++;
  }
  return { installed, skipped };
}
```

- [ ] **Step 3: Call it in `main` (after instructions, before hooks)**

Find the instructions block in `main` (`if (bundle && bundle.instructions) { ... installInstructions(bundle); }`) and add immediately after it:

```js
  // Seed reference files into the project (idempotent; IDE-neutral).
  if (bundle && bundle.seed && Object.keys(bundle.seed).length) {
    console.log(`\n  → project (seed reference files)`);
    const s = installSeed(bundle, args.update);
    installed += s.installed;
    skipped += s.skipped;
  }
```

- [ ] **Step 4: Smoke-check the parse (no bundle yet, so just syntax)**

Run: `node --check bin/init.mjs`
Expected: no output, exit 0 (file parses).

- [ ] **Step 5: Commit**

```bash
git add bin/init.mjs
git commit -m "feat(installer): add bundle seed mechanism for project reference files

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Validator — allow all-local rosters + validate `seed`

**Files:**
- Modify: `bin/validate-bundles.mjs`

- [ ] **Step 1: Relax the `agents` non-empty check**

Replace the current block:

```js
    if (!Array.isArray(b.agents) || b.agents.length === 0) {
      err(id, "`agents` must be a non-empty array");
    } else {
      for (const a of b.agents) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }
```

with:

```js
    const hasLocal = Array.isArray(b.localAgents) && b.localAgents.length > 0;
    if (!Array.isArray(b.agents) || (b.agents.length === 0 && !hasLocal)) {
      err(id, "`agents` must be a non-empty array (or provide localAgents)");
    } else {
      for (const a of b.agents || []) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }
```

- [ ] **Step 2: Validate `seed` sources exist**

After the `localAgents` validation loop (the `for (const la of b.localAgents || [])` block), add:

```js
    for (const src of Object.keys(b.seed || {}))
      if (!existsSync(join(dir, src))) err(id, `seed source missing: ${src}`);
```

- [ ] **Step 3: Fix the success-line roster count**

Replace the success log line:

```js
    if (errorCount === before)
      console.log(`  ✓ ${id} (${(b.agents || []).length} agents)`);
```

with:

```js
    if (errorCount === before) {
      const n = (b.agents || []).length + (b.localAgents || []).length;
      console.log(`  ✓ ${id} (${n} agents)`);
    }
```

- [ ] **Step 4: Verify existing bundles still pass**

Run: `node bin/validate-bundles.mjs`
Expected: `All 2 bundle(s) valid.` (team-web 8, team-ios 6 — counts unchanged since they use shared agents).

- [ ] **Step 5: Commit**

```bash
git add bin/validate-bundles.mjs
git commit -m "feat(validate-bundles): allow all-local rosters + validate seed sources

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Knowledge reference docs

**Files:**
- Create: `bundles/web-qa/knowledge/test-case-format.md`
- Create: `bundles/web-qa/knowledge/test-run-report-format.md`
- Create: `bundles/web-qa/knowledge/test-case-template.md`

- [ ] **Step 1: Port the three files verbatim**

```bash
mkdir -p bundles/web-qa/knowledge
cp /tmp/manualAIQA-src/knowledge/test_case_format.md       bundles/web-qa/knowledge/test-case-format.md
cp /tmp/manualAIQA-src/knowledge/test_run_report_format.md bundles/web-qa/knowledge/test-run-report-format.md
cp /tmp/manualAIQA-src/knowledge/test_case_template.md     bundles/web-qa/knowledge/test-case-template.md
```

(Note: filenames switch from `snake_case` to `kebab-case` to match repo convention. Do **not** port `system_prompt.md` — it duplicated the executor agent.)

- [ ] **Step 2: Update internal references to the seeded path**

In all three files, any reference to `knowledge/<file>` or to a sibling spec must point at the seeded location `.agents/web-qa/knowledge/<kebab-file>.md`. Grep and fix:

```bash
grep -rn "knowledge/" bundles/web-qa/knowledge/ || echo "no internal knowledge/ refs"
```
For each hit, rewrite to `.agents/web-qa/knowledge/...` with the kebab-case filename. (The POC's `test_case_format.md` mostly stands alone; expect few or none.)

- [ ] **Step 3: Verify no stale snake_case cross-references remain**

Run:
```bash
grep -rn "test_case_format\|test_run_report_format\|test_case_template" bundles/web-qa/knowledge/ || echo "clean"
```
Expected: `clean` (all cross-refs use kebab-case names).

- [ ] **Step 4: Commit**

```bash
git add bundles/web-qa/knowledge
git commit -m "feat(web-qa): add knowledge reference docs (TC format, report format, template)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Agent port — shared rules (apply to Tasks 7–11)

Each agent is ported from `/tmp/manualAIQA-src/.claude/agents/<name>.md` into a
bundle-local directory `bundles/web-qa/agents/<name>/` with three files:

- **`AGENT.md`** — ported body + transformed frontmatter (below).
- **`RULES.md`** — extract the agent's hard constraints (the "Important"/"Override"/"Protocol must" lines) into a short operating-rules file, matching the style of `agents/qa-engineer/RULES.md` (read it first as the pattern).
- **`SOUL.md`** — a short, functional voice/values file (precise QA practitioner; evidence over assumption). Match the brevity of an existing `SOUL.md`. No mascot name required.

**Frontmatter transform (every agent):** keep `name`; rewrite `description` to imperative "Use when …" phrasing (keep the POC's role summary as the second sentence); keep `model`; keep `tools:` where the POC had it (setup, executor) and add the `Agent` tool for orchestrator; add `group: qa`; add `aliases: [<name>]`; add `skills: [...]` per the spec table; add `color`/`theme` consistent with other QA agents (read `agents/qa-engineer/AGENT.md` frontmatter for the pattern).

**Body transforms (every agent):**
1. Replace any `knowledge/app_profile.md` → `.agents/web-qa/app_profile.md`.
2. Replace any `knowledge/<spec>.md` → `.agents/web-qa/knowledge/<kebab>.md`.
3. **Remove the "ignore webapp-testing" override paragraphs** — we no longer ship `webapp-testing`. Replace with one line: "Browser control is via Playwright MCP tools (wired by the `playwright-testing` skill)."
4. Replace POC references to `.agents/skills/playwright-best-practices/<file>` with "consult the `playwright-best-practices` skill" (the skill is preloaded via frontmatter; deeper files load on demand). Keep the *when-to-consult* guidance.
5. End `AGENT.md` with the standard SOUL pointer line used by our agents: `Read \`SOUL.md\` in this directory for your personality, voice, and values. That's who you are.`

After writing each agent, **verify there is no leftover `webapp-testing` or bare `knowledge/` path**:
```bash
grep -rn "webapp-testing\|knowledge/app_profile\|\.agents/skills/" bundles/web-qa/agents/<name>/ || echo "clean"
```
Expected: `clean`.

---

## Task 7: `setup` agent

**Files:**
- Create: `bundles/web-qa/agents/setup/AGENT.md`
- Create: `bundles/web-qa/agents/setup/RULES.md`
- Create: `bundles/web-qa/agents/setup/SOUL.md`

- [ ] **Step 1: Read the source + the RULES pattern**

Read `/tmp/manualAIQA-src/.claude/agents/setup.md` and `agents/qa-engineer/RULES.md`.

- [ ] **Step 2: Write `AGENT.md`** — apply the shared transform. Frontmatter:

```yaml
---
name: setup
description: Use when onboarding a new or changed web app for manual QA — interview the user, explore the running app via Playwright MCP, and write .agents/web-qa/app_profile.md (URLs, auth, key pages, reliable selectors, fragile areas) that every other web-qa agent reads.
model: sonnet
group: qa
color: green
aliases: [setup]
tools: Read, Write, Bash, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_fill_form, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_network_requests, mcp__playwright__browser_console_messages
skills: [playwright-testing, playwright-best-practices, systematic-debugging, xlsx-reader]
---
```

Body: ported setup phases (interview → exploratory MCP session → targeted follow-ups → write profile → next steps). Apply body transforms 1–5. For the XLSX section, replace the POC's "create read_xlsx.js if missing" with: "If the user provides a `.xlsx`, use the `xlsx-reader` skill: `node scripts/read_xlsx.js <file> .agents/web-qa/xlsx_raw.md`, then Read that file." Write the `app_profile.md` template to write into `.agents/web-qa/app_profile.md` (port the POC's Phase 4 template verbatim, only changing the path).

- [ ] **Step 3: Write `RULES.md`** — the hard rules: MCP-only (never write Python browser scripts); always screenshot major pages; prefer `[data-testid] → [id] → [name] → [aria-label] → stable CSS`, never auto-generated classes; apply `systematic-debugging` on unexpected app state before proceeding; never invent credentials — ask.

- [ ] **Step 4: Write `SOUL.md`** — short functional voice (curious, methodical onboarder; documents what it actually observed, flags gaps honestly).

- [ ] **Step 5: Verify clean + commit**

```bash
grep -rn "webapp-testing\|knowledge/app_profile\|\.agents/skills/" bundles/web-qa/agents/setup/ || echo "clean"
git add bundles/web-qa/agents/setup
git commit -m "feat(web-qa): add setup agent (app onboarding via Playwright MCP)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Expected grep: `clean`.

---

## Task 8: `tc-writer` agent

**Files:**
- Create: `bundles/web-qa/agents/tc-writer/{AGENT.md,RULES.md,SOUL.md}`

- [ ] **Step 1: Read source** `/tmp/manualAIQA-src/.claude/agents/tc-writer.md`.

- [ ] **Step 2: Write `AGENT.md`** — frontmatter:

```yaml
---
name: tc-writer
description: Use when turning rough test ideas (prose, bullets, bug reports, user stories) into properly formatted TC-NNN_<slug>.md cases under tasks/<suite>/. Reads the app profile and the test-case format; asks only for what it cannot infer.
model: sonnet
group: qa
color: green
aliases: [tc-writer, tcw]
tools: Read, Write, Glob
skills: []
---
```

Body: ported writer protocol (accept any format → grouped clarifying questions → quality checklist → write file → show it). Apply transforms. Setup section reads `.agents/web-qa/app_profile.md`, `.agents/web-qa/knowledge/test-case-format.md`, and uses `.agents/web-qa/knowledge/test-case-template.md` as the skeleton. Keep the full quality checklist verbatim (one behavior per case, observable evidence, isolation/teardown, `{{base_url}}`, literal test data).

- [ ] **Step 3: Write `RULES.md`** — never ask about info already in `app_profile.md`; never hardcode a domain (always `{{base_url}}`); one behavior per case; every expected result must be snapshot-verifiable; teardown required if the test mutates persistent state.

- [ ] **Step 4: Write `SOUL.md`** — concise, asks sharp questions, hates vague test cases.

- [ ] **Step 5: Verify clean + commit**

```bash
grep -rn "webapp-testing\|knowledge/app_profile\|\.agents/skills/" bundles/web-qa/agents/tc-writer/ || echo "clean"
git add bundles/web-qa/agents/tc-writer
git commit -m "feat(web-qa): add tc-writer agent (sketches -> formatted test cases)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Expected grep: `clean`.

---

## Task 9: `executor` agent

**Files:**
- Create: `bundles/web-qa/agents/executor/{AGENT.md,RULES.md,SOUL.md}`

- [ ] **Step 1: Read source** `/tmp/manualAIQA-src/.claude/agents/executor.md`.

- [ ] **Step 2: Write `AGENT.md`** — frontmatter:

```yaml
---
name: executor
description: Use when executing one manual test case against a running web app via Playwright MCP — runs each step, verifies with snapshots, takes screenshots, and returns a single structured JSON result. Dispatched per case by the orchestrator.
model: sonnet
color: red
group: qa
aliases: [executor]
tools: Read, Write, mcp__playwright__browser_navigate, mcp__playwright__browser_click, mcp__playwright__browser_fill_form, mcp__playwright__browser_type, mcp__playwright__browser_select_option, mcp__playwright__browser_hover, mcp__playwright__browser_press_key, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_handle_dialog, mcp__playwright__browser_evaluate, mcp__playwright__browser_navigate_back, mcp__playwright__browser_console_messages
skills: [playwright-testing, playwright-best-practices, verification-before-completion, systematic-debugging]
---
```

Body: ported execution protocol (read TC + `.agents/web-qa/app_profile.md` → substitute `{{base_url}}` → per-step act + `browser_snapshot` + `browser_console_messages` → locator fallback → **mandatory final snapshot before PASS** → final screenshot to `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png` → emit exactly one JSON block). Keep the **JSON result schema verbatim** (incl. `console_errors`, `notes`). Apply transforms 1–5 (delete the "ignore webapp-testing" paragraph; replace locator-strategy file refs with "per the `playwright-best-practices` skill").

- [ ] **Step 3: Write `RULES.md`** — MCP-only, never Python; `verification-before-completion` is mandatory before any PASS (final snapshot must confirm Expected Final State); on failure: gather evidence (snapshot+screenshot+console), state actual vs expected, retry once with next locator, then FAIL and STOP — never continue steps after a failure; output exactly one JSON block.

- [ ] **Step 4: Write `SOUL.md`** — skeptical, evidence-driven; treats a green result without a confirming snapshot as not-yet-passed.

- [ ] **Step 5: Verify clean + commit**

```bash
grep -rn "webapp-testing\|knowledge/app_profile\|\.agents/skills/" bundles/web-qa/agents/executor/ || echo "clean"
git add bundles/web-qa/agents/executor
git commit -m "feat(web-qa): add executor agent (single-case live execution via MCP)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Expected grep: `clean`.

---

## Task 10: `orchestrator` agent

**Files:**
- Create: `bundles/web-qa/agents/orchestrator/{AGENT.md,RULES.md,SOUL.md}`

- [ ] **Step 1: Read source** `/tmp/manualAIQA-src/.claude/agents/orchestrator.md`.

- [ ] **Step 2: Write `AGENT.md`** — frontmatter:

```yaml
---
name: orchestrator
description: Use when running a full manual-QA suite — discovers all test cases in a suite folder, dispatches an executor per case (sequentially) via the Agent tool, collects JSON results plus usage metrics, detects isolation issues, and triggers the reporter. Run this agent as the active agent and give it a suite path + base_url.
model: sonnet
group: qa
color: green
aliases: [orchestrator, orch]
tools: Glob, Read, Write, Agent
skills: [verification-before-completion, systematic-debugging]
---
```

Body: ported steps verbatim with transforms — discover via `Glob tasks/<suite>/TC-*.md`; create `RUN-YYYY-MM-DD-NNN`; dispatch `executor` per case via the Agent tool (prompt: "Execute the test case at {file_path} against base_url={base_url}"); collect the JSON block **and** the `<usage>` block (`total_tokens`→`tokens`, `tool_uses`, `duration_ms`); BLOCKED fallback when no JSON; null-usage fallback; Step 4 count check (`verification-before-completion`); Step 4b isolation scan (`systematic-debugging`); dispatch `reporter`; print the summary block. Reads `.agents/web-qa/app_profile.md` for the warning check.

- [ ] **Step 3: Write `RULES.md`** — never proceed to the report until every TC has a result entry (count must match); always attach usage fields to each result; surface isolation warnings distinctly from app bugs; require base_url before starting (ask if missing).

- [ ] **Step 4: Write `SOUL.md`** — orderly conductor; accounts for every case; never silently drops a result.

- [ ] **Step 5: Verify clean + commit**

```bash
grep -rn "webapp-testing\|knowledge/app_profile\|\.agents/skills/" bundles/web-qa/agents/orchestrator/ || echo "clean"
git add bundles/web-qa/agents/orchestrator
git commit -m "feat(web-qa): add orchestrator agent (suite discovery + executor dispatch)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Expected grep: `clean`.

---

## Task 11: `reporter` agent

**Files:**
- Create: `bundles/web-qa/agents/reporter/{AGENT.md,RULES.md,SOUL.md}`

- [ ] **Step 1: Read source** `/tmp/manualAIQA-src/.claude/agents/reporter.md`.

- [ ] **Step 2: Write `AGENT.md`** — frontmatter:

```yaml
---
name: reporter
description: Use when turning an array of executor JSON results into a Markdown test run report — Summary, Results, Performance Metrics, Failed/Blocked/Defects sections — saved to reports/{run_id}.md. Dispatched by the orchestrator at the end of a run.
model: haiku
color: blue
group: qa
aliases: [reporter]
tools: Read, Write
skills: []
---
```

Body: ported reporter spec verbatim with transforms — failure-classification table (locator / app-behavior / timeout / isolation / environment), the exact report template, the calculations block, and the "omit empty sections / omit Performance Metrics when usage absent" rules. Where it referenced the report-format spec, point to `.agents/web-qa/knowledge/test-run-report-format.md`.

- [ ] **Step 3: Write `RULES.md`** — classify every FAIL before writing; omit empty sections; omit Performance Metrics if usage fields absent; after writing, confirm the file exists by reading the first line back.

- [ ] **Step 4: Write `SOUL.md`** — terse, factual report-writer; numbers must add up.

- [ ] **Step 5: Verify clean + commit**

```bash
grep -rn "webapp-testing\|knowledge/app_profile\|\.agents/skills/" bundles/web-qa/agents/reporter/ || echo "clean"
git add bundles/web-qa/agents/reporter
git commit -m "feat(web-qa): add reporter agent (results -> Markdown run report)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Expected grep: `clean`.

---

## Task 12: Bundle manifest, instructions, README

**Files:**
- Create: `bundles/web-qa/bundle.json`
- Create: `bundles/web-qa/instructions.md`
- Create: `bundles/web-qa/README.md`

- [ ] **Step 1: Write `bundle.json`**

```json
{
  "id": "web-qa",
  "title": "Web QA Team",
  "description": "Standalone agentic manual-QA team for web apps — onboard the app, author test cases, run them live via Playwright MCP, and report.",
  "agents": [],
  "localAgents": ["setup", "tc-writer", "orchestrator", "executor", "reporter"],
  "skills": [],
  "seed": { "knowledge": ".agents/web-qa/knowledge" },
  "instructions": "instructions.md",
  "targets": ["claude"]
}
```

- [ ] **Step 2: Write `instructions.md`**

The manual-QA working agreements, spliced into `AGENTS.md`/`CLAUDE.md` at install. Contents: the pipeline `setup → tc-writer → orchestrator → executor → reporter`; the project layout (`tasks/<suite>/TC-NNN_<slug>.md`, `reports/RUN-YYYY-MM-DD-NNN.md`, `reports/screenshots/`, `.agents/web-qa/knowledge/`, `.agents/web-qa/app_profile.md`); the `{{base_url}}` rule; "evidence before PASS" (final snapshot); how to invoke each agent. Keep under ~40 lines (match `bundles/team-web/instructions.md` density — read it first).

- [ ] **Step 3: Write `README.md`**

Match `bundles/team-web/README.md` structure: title, one-line intro, `## Install` (`npx github:arozumenko/sdlc-skills init --bundle web-qa`), `## Roster` table (the 5 agents, their alias/role), `## How this team works` (the pipeline + that knowledge seeds to `.agents/web-qa/knowledge/`, cases live in `tasks/`, reports in `reports/`), `## What this bundle adds` (Agents, Instructions, Seeded knowledge, Skills it pulls — `playwright-testing`, `playwright-best-practices`, `verification-before-completion`, `systematic-debugging`, `xlsx-reader`; Briefings: none; Hooks: none). Note the orchestrator must be run as the active agent (it dispatches executors via the Agent tool).

- [ ] **Step 4: Validate the bundle**

Run: `node bin/validate-bundles.mjs`
Expected: `web-qa (5 agents)` reported valid alongside team-web/team-ios; `All 3 bundle(s) valid.`

- [ ] **Step 5: Commit**

```bash
git add bundles/web-qa/bundle.json bundles/web-qa/instructions.md bundles/web-qa/README.md
git commit -m "feat(web-qa): add bundle manifest, instructions, and README

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Document the new bundle features in `SPEC.md`

**Files:**
- Modify: `bundles/SPEC.md`

- [ ] **Step 1: Document `seed`**

Add a row to the bundle-fields description and a short subsection: "**Seed files** — `seed` maps a bundle-relative source → a project-relative dest; copied into the project once at install (idempotent; `--update` overwrites). Use for reference docs agents read at runtime (a subagent's cwd is the project root). Example: `\"seed\": { \"knowledge\": \".agents/web-qa/knowledge\" }`." Add it to the install-order list near Briefings/Instructions.

- [ ] **Step 2: Document all-local rosters**

Add a note: "A bundle may have an empty `agents` array if it provides `localAgents` — a fully self-contained team (e.g. `web-qa`)."

- [ ] **Step 3: Verify + commit**

Run: `node bin/validate-bundles.mjs`
Expected: still `All 3 bundle(s) valid.`

```bash
git add bundles/SPEC.md
git commit -m "docs(bundles): document seed mechanism and all-local rosters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: End-to-end dry-run install + final validation

**Files:** none (verification only)

- [ ] **Step 1: Validators green**

Run:
```bash
node bin/validate-bundles.mjs
/tmp/skillsref-venv/bin/skills-ref validate skills/xlsx-reader
```
Expected: `All 3 bundle(s) valid.` and xlsx-reader validation passes.

- [ ] **Step 2: Dry-run install into a scratch project** (requires network for external skills)

```bash
rm -rf /tmp/webqa-install && mkdir -p /tmp/webqa-install && cd /tmp/webqa-install
git init -q
node /Users/arozumenko/Development/sdlc-skills/bin/init.mjs --bundle web-qa --target claude --yes
```
Expected console: a `Bundle: Web QA Team — 0 shared agent(s), 5 local agent(s)` line; five `✓ agent (bundle-local)` lines; a `→ project (seed reference files)` step with `✓ seed .agents/web-qa/knowledge`; external skills `playwright-best-practices` + superpowers skills fetched; instructions spliced.

- [ ] **Step 3: Assert the installed layout**

Run:
```bash
cd /tmp/webqa-install
ls .claude/agents/   # setup tc-writer orchestrator executor reporter
ls .agents/web-qa/knowledge/   # test-case-format.md test-run-report-format.md test-case-template.md
ls .claude/skills/   # playwright-testing playwright-best-practices verification-before-completion systematic-debugging xlsx-reader
test -f AGENTS.md && grep -q "BUNDLE:web-qa" AGENTS.md && echo "instructions spliced"
```
Expected: agents present, 3 knowledge files present, the five skills resolved, `instructions spliced`.

- [ ] **Step 4: Clean up scratch dirs**

```bash
rm -rf /tmp/webqa-install /tmp/manualAIQA-src
```

- [ ] **Step 5: Final confirmation (no commit — verification task)**

Confirm all earlier task commits are present:
```bash
cd /Users/arozumenko/Development/sdlc-skills && git log --oneline -12
```
Expected: commits for xlsx-reader, skills.json, installer seed, validator, knowledge, the 5 agents, bundle manifest, SPEC.

---

## Notes for the implementer

- **Faithfulness:** the agent *protocols, JSON schema, report template, and quality checklist* are ported verbatim from the POC — only paths, frontmatter, the webapp-testing override, and skill-file references change. When in doubt, preserve POC wording.
- **No new test framework:** the repo has none; `validate-bundles.mjs`, `skills-ref`, and the dry-run install are the verification harness.
- **External skills need network** at install (git clone). If offline, Step 2 of Task 14 will show external-fetch failures — that does not invalidate the bundle; re-run when online.
- **Orchestrator caveat:** if the host disallows the Agent tool from a user-selected agent, document the fallback (PM/user dispatches executors) — already noted in the spec §4.3 and the bundle README.

# Design: migrate ManualAIQA POC → `web-qa` bundle

**Date:** 2026-05-26
**Status:** Approved design (pre-implementation)
**Source:** https://github.com/OlhaStetsenko1/manualAIQA (branch `master`)
**Target:** `sdlc-skills` — a new standalone `bundles/web-qa/`

---

## 1. Goal

Port the ManualAIQA proof-of-concept — an agentic **manual** QA system that
executes human-readable test cases live through a real browser (Playwright MCP)
and produces structured run reports — into a first-class, installable
`sdlc-skills` bundle, faithful to the POC's five-agent design while conforming
to our repo conventions (bundle manifest, `AGENT.md`/`RULES.md`/`SOUL.md`
agents, `skills.json` resolution, installer, validators).

This capability (execute-and-report, **no test code generated**) is distinct
from our existing automation pipeline (`test-automation-workflow`, which turns
manual cases into framework test *code*). The two are complementary.

## 2. Decisions (locked during brainstorming)

| # | Decision |
|---|----------|
| D1 | A **new standalone** bundle `bundles/web-qa/` (not an extension of `team-web`). |
| D2 | **Faithful 5-agent port**: `setup`, `tc-writer`, `orchestrator`, `executor`, `reporter` — recreated as agents in our format. |
| D3 | Roster = **just the 5 agents**, self-contained (no `scout`/`project-manager`). `orchestrator` does dispatch; `setup` does app onboarding. |
| D4 | External skill deps **rationalized to our stack**: reuse our `playwright-testing` (wires the MCP) instead of the POC's self-contradicting `webapp-testing`; keep `verification-before-completion` + `systematic-debugging`; **add `playwright-best-practices`** to `skills.json`. Drop `webapp-testing` and `qa-test-planner`. |
| D5 | Knowledge specs ship as **plain reference files the agents call out** (a Skill is the wrong wrapper for inert docs), seeded by the installer into **`.agents/web-qa/knowledge/`**. Requires a small new installer capability. |
| D6 | The **xlsx reader is a Skill** (`skills/xlsx-reader/`) — executable capability, the right use of a skill. `setup` declares it. |
| D7 | Agents are **bundle-local** (`localAgents`). `targets: ["claude"]`. |

## 3. Findings that shape the design (verified)

- **Subagent cwd = project root.** An agent instruction `Read .agents/web-qa/knowledge/<file>.md` resolves from the project root. (Official Claude Code sub-agents docs.) This is why reference files work.
- **`@import` does NOT work in agent definition files** (only `CLAUDE.md`). Agents must `Read` the path explicitly.
- **The installer cannot currently seed loose files** into a project — only agents, skills, briefings, instructions, hooks. D5 therefore needs a new, generic seed mechanism.
- **`validate-bundles.mjs` currently requires `agents` to be a non-empty array** (line 83). A roster that is entirely `localAgents` (D3) needs the validator relaxed to accept `agents: []` when `localAgents` is non-empty.
- **`skills:` frontmatter preloads a skill's `SKILL.md`** into a subagent at startup; deeper reference files load on demand. So agents rely on skill **preload** for Playwright guidance rather than the POC's brittle hardcoded `.agents/skills/...` file paths.

## 4. Architecture

### 4.1 Bundle layout

```
bundles/web-qa/
  bundle.json
  README.md                       # roster + install (team-web/team-ios style)
  instructions.md                 # manual-QA working agreements → AGENTS.md/CLAUDE.md
  knowledge/                       # seeded into project at install (D5)
    test-case-format.md
    test-run-report-format.md
    test-case-template.md
  agents/                          # localAgents (D2, D7)
    setup/        (AGENT.md, RULES.md, SOUL.md)
    tc-writer/    (AGENT.md, RULES.md, SOUL.md)
    orchestrator/ (AGENT.md, RULES.md, SOUL.md)
    executor/     (AGENT.md, RULES.md, SOUL.md)
    reporter/     (AGENT.md, RULES.md, SOUL.md)
```

### 4.2 `bundle.json`

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

- `agents: []` + non-empty `localAgents` — requires the validator change (§3, §6).
- `skills: []` — each agent declares its own skills in frontmatter; the installer auto-resolves them (monorepo copy or `skills.json` clone). No team-wide extras needed.
- `seed` — **new field** (§6): maps a bundle-relative source → a project-relative destination, copied at install.

### 4.3 The five agents

Each is a faithful port preserving the POC's role, protocol, tool scoping, and
I/O contracts, restructured into our `AGENT.md` (+ `RULES.md`, `SOUL.md`)
convention. `description` uses imperative "Use when…" phrasing. `group: qa`.
SOULs are light/functional (precise QA-practitioner voice); persona names are
optional and not required for the port.

| Agent | Model | `tools:` (frontmatter) | `skills:` (declared) | Calls out (Read) |
|-------|-------|------------------------|----------------------|------------------|
| `setup` | sonnet | Read, Write, Bash, `mcp__playwright__browser_*` (scoped set) | `playwright-testing`, `playwright-best-practices`, `systematic-debugging`, `xlsx-reader` | writes `.agents/web-qa/app_profile.md` |
| `tc-writer` | sonnet | Read, Write, Glob | — | `.agents/web-qa/knowledge/test-case-format.md`, `…/test-case-template.md`, `.agents/web-qa/app_profile.md` |
| `orchestrator` | sonnet | Glob, Read, Write, **Agent** | `verification-before-completion`, `systematic-debugging` | `.agents/web-qa/app_profile.md` |
| `executor` | sonnet | Read, Write, `mcp__playwright__browser_*` (scoped set) | `playwright-testing`, `playwright-best-practices`, `verification-before-completion`, `systematic-debugging` | the TC file, `.agents/web-qa/app_profile.md` |
| `reporter` | **haiku** | Read, Write | — | `.agents/web-qa/knowledge/test-run-report-format.md` |

**Faithful behaviors preserved:**
- `setup`: interview → exploratory MCP browse → write `app_profile.md` (URLs, auth, key pages, reliable selectors, fragile areas). Now at `.agents/web-qa/app_profile.md`.
- `tc-writer`: rough sketch → `tasks/<suite>/TC-NNN_<slug>.md`, the quality checklist (one behavior per case, observable evidence, isolation, `{{base_url}}`, literal test data), grouped clarifying questions.
- `orchestrator`: discover suite via `Glob` → create `RUN-YYYY-MM-DD-NNN` id → dispatch one `executor` per case via the **Agent** tool, sequentially → collect each result's JSON **and** the `<usage>` block (`tokens`/`tool_uses`/`duration_ms`) → verify count == files (`verification-before-completion`) → scan for isolation signals (`systematic-debugging`) → dispatch `reporter` → print summary.
- `executor`: read TC + `app_profile.md` → substitute `{{base_url}}` → per step act + `browser_snapshot` verify + `browser_console_messages` → locator fallback order → mandatory final snapshot before PASS → final screenshot to `reports/screenshots/` → emit exactly one JSON result block.
- `reporter` (haiku): consume results array → failure-classification table → write `reports/RUN-….md` with Summary, Results, Performance Metrics (omit if no usage data), Failed/Blocked/Defects sections.

**Assumption to verify in implementation:** `orchestrator` is invoked as the *active* agent (`/agent orchestrator` or direct selection) and uses the Agent tool to spawn `executor` runs — mirroring the POC. Nested subagent-spawns-subagent is not relied upon. If the host disallows the Agent tool from a selected agent, fall back to the user/PM driving executor dispatch (documented in the bundle README).

### 4.4 Conventions kept verbatim (faithful)

- `{{base_url}}` templating in all TC URLs (environment-agnostic).
- `tasks/<suite>/TC-NNN_<slug>.md` test cases; `reports/RUN-YYYY-MM-DD-NNN.md` + `reports/screenshots/` — **at project root** (faithful; created at runtime by the agents).
- Executor JSON result schema incl. `tokens`/`tool_uses`/`duration_ms`.
- Reporter failure-classification table (locator / app-behavior / timeout / isolation / environment).
- Playwright MCP is wired by the **`playwright-testing`** skill's `setup.yaml` — **no separate `.mcp.json`** in the bundle.

## 5. New & changed skills

### 5.1 `skills/xlsx-reader/` (new, monorepo) — D6

- `SKILL.md` — "Read `.xlsx` spreadsheets (test cases, checklists) into Markdown so an agent can ingest them. Use when the user provides an Excel file of test cases/requirements." Compatibility note: requires Node + the `xlsx` package (installable on demand).
- `scripts/read_xlsx.js` — ported from the POC's `read_xlsx.js`; reads a workbook and emits Markdown (parameterized input/output path; documents the `xlsx` dependency).
- `README.md` — per repo convention (install: marketplace/npx/manual).
- Must pass `skills-ref validate`.
- Registered in `skills.json` as a monorepo entry; optionally added to `.claude-plugin/marketplace.json`.

### 5.2 `skills.json` additions — D4, D6

- `playwright-best-practices` → external, `repo: currents-dev/playwright-best-practices-skill` (matches the POC's `skills-lock.json`).
- `xlsx-reader` → monorepo entry.

`verification-before-completion`, `systematic-debugging` (superpowers) and
`playwright-testing` (monorepo) already exist in `skills.json`.

## 6. Installer & validator changes

### 6.1 `bin/init.mjs` — new `seed` mechanism

- Read `bundle.seed` (object: bundle-relative source → project-relative dest).
- For each entry, copy the source dir/file into the project at the dest path; create parent dirs; **idempotent**; skip existing unless `--update` (same policy as briefings). Log each seeded path.
- Runs once (IDE-neutral, like briefings), not per target.
- Add to `printHelp`/comments as appropriate.

### 6.2 `bin/validate-bundles.mjs`

- Accept `agents: []` when `localAgents` is non-empty (don't fail "agents must be a non-empty array" for all-local rosters). Still require at least one of `agents`/`localAgents`.
- Validate `seed`: each source path exists under the bundle dir.

### 6.3 `bundles/SPEC.md`

- Document the `seed` field and the standalone-`localAgents` roster pattern.

## 7. Out of scope (YAGNI)

- `webapp-testing` skill (POC overrode it as the wrong approach).
- `qa-test-planner` skill (not needed for the core pipeline).
- Porting the POC's sample `tasks/smoke/TC-001` and `.claude/plans/*` (illustrative only; the format spec + template are sufficient). A single example TC may be included in `knowledge/` as a teaching aid if cheap.
- Non-Claude targets (the orchestrator→executor Agent-dispatch + MCP pattern is Claude Code-specific; same posture as `team-web`/`team-ios`).

## 8. Build sequence (for the implementation plan)

1. `skills/xlsx-reader/` (SKILL.md + script + README) and register in `skills.json` (+ optional marketplace).
2. Add `playwright-best-practices` to `skills.json`.
3. `bin/init.mjs`: implement the `seed` mechanism.
4. `bin/validate-bundles.mjs`: allow all-local rosters + validate `seed`.
5. `bundles/web-qa/knowledge/` reference docs (ported from POC `knowledge/`, paths updated).
6. The five bundle-local agents (`AGENT.md`/`RULES.md`/`SOUL.md`), faithful, with the table above.
7. `bundles/web-qa/bundle.json`, `instructions.md`, `README.md`.
8. `bundles/SPEC.md` update.
9. Validate: `node bin/validate-bundles.mjs`; `skills-ref validate skills/xlsx-reader`; dry-run `npx … init --bundle web-qa --target claude` into a scratch dir and confirm agents land in `.claude/agents/`, knowledge lands in `.agents/web-qa/knowledge/`, and external skills resolve.

## 9. Success criteria

- `node bin/validate-bundles.mjs` passes with the new bundle (all-local roster).
- `skills-ref validate` passes for `skills/xlsx-reader`.
- A dry-run install places: 5 agents in `.claude/agents/`, the 3 knowledge files in `.agents/web-qa/knowledge/`, `instructions.md` spliced into `AGENTS.md`, and resolves `playwright-testing` + `playwright-best-practices` + `verification-before-completion` + `systematic-debugging` + `xlsx-reader`.
- The five agents reproduce the POC pipeline (`setup → tc-writer → orchestrator → executor → reporter`) with `{{base_url}}` cases under `tasks/` and reports under `reports/`.
```

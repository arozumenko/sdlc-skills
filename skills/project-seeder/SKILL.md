---
name: project-seeder
description: Generate AGENTS.md and .octobots/ configuration files for a new project. Use when the user asks to "seed the project", "onboard this repo", "generate project config", "create AGENTS.md", or after the scout has explored the codebase.
license: Apache-2.0
compatibility: Requires project root write access. No external dependencies.
metadata:
  author: octobots
  version: "0.1.0"
---

# Project Seeder

Generate the configuration files that octobots roles need to work in a
project.

## What Gets Generated

```
project-root/
├── CLAUDE.md                     ← Auto-loaded by Claude Code: brief project context
├── AGENTS.md                     ← Full team reference: stack, commands, conventions
├── .agents/                      ← IDE-neutral agent content (every agent reads)
│   ├── profile.md                ← Quick-reference project card
│   ├── workflow.md               ← How the team actually works (PR sampling — Step 0.5)
│   ├── team-comms.md             ← Who's on the team and how to route work (Step 6.5)
│   ├── architecture.md           ← System design map (if complex enough)
│   ├── conventions.md            ← Detected coding standards
│   ├── testing.md                ← Test infrastructure details
│   ├── onboarding.md             ← Scout's own audit trail
│   └── memory/<role-id>/
│       ├── MEMORY.md             ← Index (add a line for each entry)
│       └── project_briefing.md   ← Per-role project briefing (Step 7c)
└── .octobots/                    ← Octobots supervisor runtime state (only if Octobots is installed)
    └── roles-manifest.yaml       ← Input for spawn readiness check (Step 7b)
```

Not every project needs all files. Skip what's not relevant.

## References

Each major step has a focused reference file:

- **[references/scout-survey.md](references/scout-survey.md)** —
  full Step 0.5 (PR sampling) + Step 0.7 (project-systems capture)
  procedure
- **[references/templates.md](references/templates.md)** — templates
  for every generated file (CLAUDE.md / AGENTS.md / profile /
  conventions / testing / architecture / roles-manifest.yaml /
  role-memory seeding)
- **[references/team-comms-templates.md](references/team-comms-templates.md)**
  — `.agents/team-comms.md` templates by host
- **[references/team-comms-workflow.md](references/team-comms-workflow.md)**
  — full Step 6.5 procedure
- **[references/agent-tools-wiring.md](references/agent-tools-wiring.md)**
  — full Step 6.8 procedure (tool whitelists for restrictive hosts)
- **[references/role-overrides.md](references/role-overrides.md)** —
  full Step 6.9 procedure (role substitutions when agents are missing)
- **[references/deployment-modes.md](references/deployment-modes.md)**
  — full Step 6.95 procedure (OCTOBOTS / STANDALONE marker stripping)
- **[references/role-customization.md](references/role-customization.md)**
  — full Step 7 procedure (persona repurposing for non-default stacks)

---

## Step 0.5 — PR-sampling survey

Before writing any content files, scout samples the project's PR
history to understand **how the team actually works** — not just
what the code looks like. It classifies PRs into five categories
(framework / test-impl / bugfix / feature / review signal), samples
2–3 per category (max ~15 total), and extracts signals that feed
`.agents/workflow.md`, `.agents/testing.md`, `.agents/conventions.md`,
and `.agents/architecture.md`.

Git host is detected first (GitHub / GitLab / Bitbucket / Azure
DevOps / Gitea) so the correct CLI is used. Empty repos get a stub
workflow.md and the seed continues.

**Full procedure** — host detection table, classification rules,
sampling rules, signal-to-destination table, report format — lives
in **[references/scout-survey.md](references/scout-survey.md) § Step
0.5**.

## Step 0.7 — Project-systems capture

After PR sampling, scout resolves the project-systems map — issue
tracker, TMS, KB, bug-filing style, automation PR policy — and
writes it into `.agents/profile.md` § Project systems. The operator
can pre-fill these in the onboarding prompt (under a
`## Project systems` block); unspecified fields become `ASK` and
scout either asks interactively or writes `Unconfirmed`.

Downstream skills read this section at runtime:
`test-case-analysis` (bug filing), `bugfix-workflow` (tracker CLI),
`test-automation-workflow` (test-case storage),
`project-manager` + `test-automation-engineer` (merge policy, base
branch).

**Full procedure** — all 11 captured fields, defaults, destinations,
report format — lives in **[references/scout-survey.md](references/scout-survey.md)
§ Step 0.7**.

## Step 1 — Generate CLAUDE.md

The most immediately impactful file. Claude Code loads it
automatically at the start of every session, so every agent has
project context without doing anything. **Keep it under 80 lines.**

**Check first — it may already exist:**

```bash
cat CLAUDE.md 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

- **If it doesn't exist:** create it fresh from the template in
  `references/templates.md`.
- **If it exists:** treat it as the engineer's carefully crafted
  document. Read the whole thing before touching anything. Make only
  surgical additions for genuinely missing facts (e.g. a command you
  verified that isn't listed). Fix only clear errors. Do not
  restructure, reword, or "improve" prose — the wording is
  intentional. When in doubt, leave it alone and ask the engineer
  directly.

**What belongs here:** one-paragraph project overview, 3–5 most
important commands (install, dev, test), critical conventions, key
paths (entry points, test dirs, config files), a pointer to
`AGENTS.md` for full detail.

**What does NOT belong here:** exhaustive command lists (that's
AGENTS.md), full architecture diagrams (`.agents/architecture.md`),
long convention catalogues (`.agents/conventions.md`).

## Step 2 — Generate AGENTS.md

The full team reference. Every role reads it on-demand. Use the
template in `references/templates.md` and fill it with actual
findings.

**Key sections:** project overview (1 paragraph), tech stack,
repository structure (directory tree with annotations), build & run
commands (install, dev, test, lint, deploy), coding conventions
(detected from codebase), testing (framework, commands, patterns),
CI/CD, environment.

**Rules:**
- Only document what you've verified. Don't guess build commands.
- Include the ACTUAL commands from package.json scripts, Makefile
  targets, CI config.
- Note inconsistencies: "README says `npm test` but CI runs
  `npx jest --ci`".
- Keep it under 200 lines. Link to `.agents/` files for details.

## Step 3 — Generate .agents/profile.md

Quick-reference card with YAML frontmatter (project, team, issue-
tracker, default-branch, languages). See `references/templates.md`.

## Step 4 — Generate .agents/conventions.md (if patterns detected)

Only create if you found clear patterns. Document what IS, not what
should be. Cover naming, import ordering, error handling, code
organization, comment/doc style.

## Step 5 — Generate .agents/architecture.md (if complex)

Only for multi-service or non-trivial architectures: service/component
map, data flow, API boundaries, database schema overview,
infrastructure diagram (text-based).

## Step 6 — Generate .agents/testing.md (if test infra exists)

QA engineer reads this. Include test framework and config, how to
run tests (exact commands), fixture/setup patterns, test data
strategy, CI test pipeline, coverage tools, known flaky areas.

## Step 6.5 — Generate .agents/team-comms.md

Every project — taskbox *or* host-native — gets a scout-generated
`.agents/team-comms.md` that names the transport, the installed
personas, and the exact invocation syntax.

**Full procedure** — host detection, persona enumeration, template
selection, taskbox-skill injection, Copilot capability declaration,
idempotence rules — lives in
**[references/team-comms-workflow.md](references/team-comms-workflow.md)**.
Templates live in
**[references/team-comms-templates.md](references/team-comms-templates.md)**.

## Step 6.8 — Wire agent tool whitelists (restrictive hosts)

Hosts that default to a restrictive tool-permission model — notably
GitHub Copilot CLI, where an agent with no `tools:` line only gets
`['agent']` — need a per-agent `tools:` whitelist written into the
installed agent frontmatter. Claude Code's permissive default means
this step skips on that host.

Scout is **fully autonomous** at this step — no operator prompts, no
per-agent capability manifest. It derives the whitelist from evidence
already available: each skill's `setup.yaml`
(`dependencies.mcp[].name`), `.agents/test-automation.yaml` (TMS
mapping), live MCP servers on the host, and each agent's frontmatter.

**Full procedure** — host detection, skill-and-MCP matching,
intent-based tool scoping, failure handling, idempotence rules —
lives in **[references/agent-tools-wiring.md](references/agent-tools-wiring.md)**.

## Step 6.9 — Role substitutions (missing roles)

Scout compares the **workflow slots** the project needs (from
installed workflow skills + stated pipelines) against the **installed
agent roster**. For any slot lacking a dedicated agent, scout picks
the best-matching installed agent and injects per-project routing
overrides into the AGENT.md files of the routing agents (PM, tech-
lead, any other agent whose handoff prompts name specific agents).

Lightweight substitution (SCOUT-INJECTED marker-bracketed section)
is the default; full persona rewrite (Step 7) is the escalation when
the installed agent is too distant from the slot.

Runs automatically after Step 6.8. No-op when every needed slot has
its dedicated agent installed.

**Full procedure** — role-similarity table, injection format,
idempotence rules, per-agent injection locations, report format —
lives in **[references/role-overrides.md](references/role-overrides.md)**.

## Step 6.95 — Deployment-mode detection

Source agent files carry marker-bracketed regions for Octobots-only
and standalone-only guidance. Scout detects which mode the target
project is in (Octobots / taskbox / standalone) and strips the
inactive mode's bracketed regions from every installed agent file.
It then records the detected mode in `.agents/profile.md` §
Deployment mode.

Idempotent and reversible: re-running the installer restores source
content; re-running scout in a different mode re-strips accordingly.

**Full procedure** — marker conventions (paired vs standalone),
detection signals, strip procedure, idempotence rules, report
format — lives in
**[references/deployment-modes.md](references/deployment-modes.md)**.

## Step 7 — Role customization (non-default stacks)

Only runs when the detected stack doesn't match the default role set
(e.g. game engines, Rust CLIs, data science). Skip entirely if
defaults fit.

**Full procedure** — SOUL.md / AGENT.md rewrites, `roles-manifest.yaml`
generation, role memory seeding — lives in
**[references/role-customization.md](references/role-customization.md)**.

---

## Validation

After generating, verify:

```bash
# Core files exist
ls CLAUDE.md AGENTS.md .agents/profile.md

# CLAUDE.md is brief (auto-loaded — must not be bloated)
wc -l CLAUDE.md  # should be under 80 lines

# AGENTS.md is readable
wc -l AGENTS.md  # should be under 200 lines

# No secrets leaked anywhere scout wrote
grep -ri "password\|secret\|token\|api_key" CLAUDE.md AGENTS.md .agents/ .octobots/ 2>/dev/null || echo "clean"

# roles-manifest.yaml generated under .octobots/ (if roles were customized and Octobots is in play)
ls .octobots/roles-manifest.yaml 2>/dev/null

# Agent tool whitelists wired (only expected under Copilot CLI / restrictive hosts)
if ls .github/agents/*.agent.md >/dev/null 2>&1; then
  grep -L "^tools:" .github/agents/*.agent.md | head || echo "all agent files declare tools:"
fi

# Memory files present and non-empty for all roles
ls .agents/memory/
find .agents/memory -name 'project_briefing.md' -exec wc -l {} +
```

Run the full readiness check (Octobots only):

```bash
python3 octobots/scripts/check-spawn-ready.py
```

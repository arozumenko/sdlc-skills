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

Generate the configuration files that octobots roles need to work in a project.

## What Gets Generated

```
project-root/
├── CLAUDE.md                     ← Auto-loaded by Claude Code: brief project context
├── AGENTS.md                     ← Full team reference: stack, commands, conventions
└── .octobots/
    ├── profile.md                ← Quick-reference project card
    ├── team-comms.md             ← Who's on the team and how to route work (Step 6.5)
    ├── architecture.md           ← System design map (if complex enough)
    ├── conventions.md            ← Detected coding standards
    ├── testing.md                ← Test infrastructure details
    ├── roles-manifest.yaml       ← Input for spawn readiness check (Step 7b)
    └── memory/<role-id>.md       ← Per-role project briefings (Step 7c)
```

Not every project needs all files. Skip what's not relevant.

## References

The step-by-step templates and detailed procedures live alongside this SKILL.md:

- **[references/templates.md](references/templates.md)** — full templates for
  every generated file (CLAUDE.md / AGENTS.md / profile / conventions /
  testing / architecture / roles-manifest.yaml / role-memory seeding)
- **[references/team-comms-templates.md](references/team-comms-templates.md)**
  — `.octobots/team-comms.md` templates by host (taskbox, Claude, Copilot,
  Cursor, Windsurf)
- **[references/team-comms-workflow.md](references/team-comms-workflow.md)**
  — full Step 6.5 detection and generation procedure (6.5a–6.5g)
- **[references/role-customization.md](references/role-customization.md)** —
  Step 7 persona repurposing procedure (7a–7c)

---

## Step 1: Generate CLAUDE.md

The most immediately impactful file. Claude Code loads it automatically at
the start of every session, so every agent has project context without
doing anything. **Keep it under 80 lines.**

**Check first — it may already exist:**

```bash
cat CLAUDE.md 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

- **If it doesn't exist:** create it fresh from the template in
  `references/templates.md`
- **If it exists:** treat it as the engineer's carefully crafted document.
  Read the whole thing before touching anything. Make only surgical
  additions for genuinely missing facts (e.g. a command you verified that
  isn't listed). Fix only clear errors. Do not restructure, reword, or
  "improve" prose — the wording is intentional. When in doubt, leave it
  alone and ask the engineer directly.

**What belongs here:** one-paragraph project overview, 3-5 most important
commands (install, dev, test), critical conventions, key paths (entry
points, test dirs, config files), a pointer to `AGENTS.md` for full detail.

**What does NOT belong here:** exhaustive command lists (that's AGENTS.md),
full architecture diagrams (`.octobots/architecture.md`), long convention
catalogues (`.octobots/conventions.md`).

## Step 2: Generate AGENTS.md

The full team reference. Every role reads it on-demand. Use the template
in `references/templates.md` and fill it with actual findings.

**Key sections:** project overview (1 paragraph), tech stack, repository
structure (directory tree with annotations), build & run commands
(install, dev, test, lint, deploy), coding conventions (detected from
codebase), testing (framework, commands, patterns), CI/CD, environment.

**Rules:**
- Only document what you've verified. Don't guess build commands.
- Include the ACTUAL commands from package.json scripts, Makefile targets, CI config.
- Note inconsistencies: "README says `npm test` but CI runs `npx jest --ci`"
- Keep it under 200 lines. Link to `.octobots/` files for details.

## Step 3: Generate .octobots/profile.md

Quick-reference card with YAML frontmatter (project, team, issue-tracker,
default-branch, languages). See `references/templates.md`.

## Step 4: Generate .octobots/conventions.md (if patterns detected)

Only create if you found clear patterns. Document what IS, not what should
be. Cover naming, import ordering, error handling, code organization,
comment/doc style.

## Step 5: Generate .octobots/architecture.md (if complex)

Only for multi-service or non-trivial architectures: service/component map,
data flow, API boundaries, database schema overview, infrastructure diagram
(text-based).

## Step 6: Generate .octobots/testing.md (if test infra exists)

QA engineer reads this. Include test framework and config, how to run
tests (exact commands), fixture/setup patterns, test data strategy, CI
test pipeline, coverage tools, known flaky areas.

## Step 6.5: Generate `.octobots/team-comms.md`

Every project — taskbox *or* host-native — gets a scout-generated
`.octobots/team-comms.md` that names the transport, the installed
personas, and the exact invocation syntax.

Full procedure — host detection, persona enumeration, template selection,
taskbox-skill injection, Copilot capability declaration, idempotence
rules — lives in **[references/team-comms-workflow.md](references/team-comms-workflow.md)**.
Templates live in **[references/team-comms-templates.md](references/team-comms-templates.md)**.

## Step 7: Role Customization (if roles need repurposing)

Only runs when the detected stack doesn't match the default role set (e.g.
game engines, Rust CLIs, data science). Skip entirely if defaults fit.

Full procedure — SOUL.md/AGENT.md rewrites, `roles-manifest.yaml`
generation, role memory seeding — lives in
**[references/role-customization.md](references/role-customization.md)**.

---

## Validation

After generating, verify:

```bash
# Core files exist
ls CLAUDE.md AGENTS.md .octobots/profile.md

# CLAUDE.md is brief (auto-loaded — must not be bloated)
wc -l CLAUDE.md  # should be under 80 lines

# AGENTS.md is readable
wc -l AGENTS.md  # should be under 200 lines

# No secrets leaked in either
grep -ri "password\|secret\|token\|api_key" CLAUDE.md AGENTS.md .octobots/ || echo "clean"

# roles-manifest.yaml generated (if roles were customized)
ls .octobots/roles-manifest.yaml

# Memory files present and non-empty for all roles
ls .claude/memory/
wc -l .claude/memory/*.md
```

Run the full readiness check:

```bash
python3 octobots/scripts/check-spawn-ready.py
```

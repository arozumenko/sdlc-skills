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
    ├── architecture.md           ← System design map (if complex enough)
    ├── conventions.md            ← Detected coding standards
    └── testing.md                ← Test infrastructure details
```

Not every project needs all files. Skip what's not relevant.

## Step 1: Generate CLAUDE.md

This is the most immediately impactful file. Claude Code loads it automatically at the start of every session, so every agent has project context without doing anything. **Keep it under 80 lines.**

**Check first — it may already exist:**

```bash
cat CLAUDE.md 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

- **If it doesn't exist:** create it fresh from the template in `references/templates.md`
- **If it exists:** treat it as the engineer's carefully crafted document. Read the whole thing before touching anything. Make only surgical additions for genuinely missing facts (e.g. a command you verified that isn't listed). Fix only clear errors (e.g. a command that doesn't exist in the project). Do not restructure, reword, or "improve" prose — the wording is intentional. When in doubt, leave it alone and ask the engineer directly in the terminal.

**What belongs here:**
- One-paragraph project overview
- The 3-5 most important commands (install, dev, test)
- Critical conventions an agent must follow to not break things
- Key paths (entry points, test dirs, config files)
- A pointer to `AGENTS.md` for full detail

**What does NOT belong here:**
- Exhaustive command lists (that's AGENTS.md)
- Full architecture diagrams (`.octobots/architecture.md`)
- Long convention catalogues (`.octobots/conventions.md`)

Use the `CLAUDE.md` template in `references/templates.md` as a reference for structure.

## Step 2: Generate AGENTS.md

The full team reference. Every role reads it on-demand. Use the template in `references/templates.md` and fill it with actual findings.

**Key sections:**
- Project overview (1 paragraph)
- Tech stack (languages, frameworks, databases, infra)
- Repository structure (directory tree with annotations)
- Build & run commands (install, dev, test, lint, deploy)
- Coding conventions (detected from codebase)
- Testing (framework, commands, patterns)
- CI/CD (what runs, where, how)
- Environment (required vars, .env setup)

**Rules:**
- Only document what you've verified. Don't guess build commands.
- Include the ACTUAL commands from package.json scripts, Makefile targets, CI config.
- Note inconsistencies: "README says `npm test` but CI runs `npx jest --ci`"
- Keep it under 200 lines. Link to `.octobots/` files for details.

## Step 3: Generate .octobots/profile.md

Quick-reference card with YAML frontmatter:

```yaml
---
project: repo-name
team: team-name (ask if unknown)
issue-tracker: URL (detect from .git/config, README, or ask)
default-branch: main/master/develop (detect from git)
languages: [python, typescript]
---
```

## Step 4: Generate .octobots/conventions.md (if patterns detected)

Only create if you found clear patterns. Document what IS, not what should be.

Structure:
- Naming conventions (files, variables, classes)
- Import ordering
- Error handling patterns
- Code organization (layers, modules)
- Comment/documentation style

## Step 5: Generate .octobots/architecture.md (if complex)

Only for multi-service or non-trivial architectures:
- Service/component map
- Data flow between components
- API boundaries
- Database schema overview
- Infrastructure diagram (text-based)

## Step 6: Generate .octobots/testing.md (if test infra exists)

QA engineer reads this. Include:
- Test framework and config
- How to run tests (exact commands)
- Fixture/setup patterns
- Test data strategy
- CI test pipeline
- Coverage tools
- Known flaky areas

## Step 7: Role Customization (if roles need repurposing)

Triggered when the project's detected stack doesn't match the default role set — e.g., a game engine project, a Rust CLI, a data science project. Skip this step only if all default roles fit the project as-is.

### Step 7a: Rewrite SOUL.md and AGENT.md for repurposed roles

For each role being repurposed:
- Read the existing `SOUL.md` fully. Update the persona name, personality framing, and domain expertise sections. Leave voice, values, and working style intact — those are reusable across domains.
- Read the existing `AGENT.md` fully. Update the YAML frontmatter `name` and `description` fields, the identity paragraph, and the mission statement. Leave session lifecycle, taskbox commands, and communication conventions intact — those are structural scaffolding.

Surgical rule: if a section is about *how to operate* (taskbox, inbox, restart protocol), leave it. If it's about *who you are and what you know*, update it.

### Step 7b: Generate `.octobots/roles-manifest.yaml`

Use the template in `references/templates.md`. Fill in all roles — customized and unchanged. Set `customized: true` and add `repurposed_for` for any repurposed roles.

This file is the input for `octobots/scripts/check-spawn-ready.py`. Generate it before running any readiness checks.

### Step 7c: Seed role memory files

Files live at `.octobots/memory/<role-id>.md`. Use the memory seeding template from `references/templates.md`.

Fill in "Project Knowledge" and "My Role Focus" for **every role** — not just customized ones. An unchanged role still needs to know the stack, key paths, and what its work looks like on this specific project.

"My Role Focus" is written by scout, not filled from a template — it should reflect actual understanding of what this role does on this project.

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
ls .octobots/memory/
wc -l .octobots/memory/*.md
```

Run the full readiness check:

```bash
python3 octobots/scripts/check-spawn-ready.py
```

## Details

See `references/templates.md` for full templates for each file.

---
name: seeding-automation-project
description: Use when the user asks to 'seed the project', 'onboard this repo', 'generate project config', 'create AGENTS.md', or after the scout has explored the codebase. Generates AGENTS.md and .agents/ configuration files for a new project.
license: Apache-2.0
compatibility: Requires project root write access. No external dependencies.
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Project Seeder

Generate the configuration files that agent roles need to work in a
project.

## What Gets Generated

```
project-root/
├── CLAUDE.md                     ← Auto-loaded by Claude Code: brief project context
├── AGENTS.md                     ← Full team reference: stack, commands, conventions
└── .agents/                      ← IDE-neutral agent content (every agent reads)
    ├── knowledge/                ← shared, committed cross-role knowledge (Step 2.5)
├── profile.md                ← Quick-reference project card
    ├── workflow.md               ← How the team actually works (PR sampling — Step 0.5)
    ├── team-comms.md             ← Who's on the team and how to route work (Step 6.5)
    ├── architecture.md           ← System design map (if complex enough)
    ├── conventions.md            ← Detected coding standards
    ├── testing.md                ← Test infrastructure details
    ├── test-automation.yaml      ← TMS adapter + transport config (Step 6.6)
    ├── telemetry/                ← cost/attribution submodule, own branch (Step 6.7 — default ON)
    ├── onboarding.md             ← Scout's own audit trail
    └── memory/<role-id>/
        ├── MEMORY.md             ← Index (add a line for each entry)
        └── project_briefing.md   ← Per-role project briefing (Step 7c)
```

Not every project needs all files. Skip what's not relevant.

**Captures the external-write policy; performs no external writes.** This skill
writes only local files (`.agents/*`, `AGENTS.md` / `CLAUDE.md`, installed agent
configs). One thing it captures *into* those files is the project's **external-write
way of work** — does the project sync results to a TMS (which adapter)? file
tickets for defects (where, what style)? post status / progress to a tracker? —
recorded in `.agents/test-automation.yaml` § `tms`, `.agents/profile.md` § Bug
filing / § Status reporting, and `.agents/workflow.md`, so the pipeline knows
which writes are part of this project's workflow. Seeding itself **never creates a
ticket, updates a TMS execution, or posts a comment** — probing a TMS / tracker to
detect the adapter is strictly **read-only**, whether run by scout or by
`test-automation-lead` self-orienting inline. Seeding decides the policy; the
pipeline executes it.

**Minimum viable seed (inline self-orientation).** When the
test-automation-lead runs this skill *inline* to self-orient — rather
than dispatching a dedicated scout pass — it may defer the heavier
steps (full PR survey Step 0.5, role-overrides Step 6.9, role
customization Step 7) and capture inline only the blocking fields the
pipeline can't run without: the TMS (Step 0.7 / Step 6.6), the base
branch + merge policy, the test user / credential env keys, and the
base URL / API base. Everything else can be filled in later.

## References

Each major step has a focused reference file:

- **[references/scout-survey.md](references/scout-survey.md)** —
  full Step 0.5 (PR sampling) + Step 0.7 (project-systems capture)
  procedure
- **[references/templates.md](references/templates.md)** — templates
  for every generated file (CLAUDE.md / AGENTS.md / profile /
  conventions / testing / architecture / role-memory seeding)
- **[references/team-comms-templates.md](references/team-comms-templates.md)**
  — `.agents/team-comms.md` templates by host
- **[references/team-comms-workflow.md](references/team-comms-workflow.md)**
  — full Step 6.5 procedure
- **[references/agent-tools-wiring.md](references/agent-tools-wiring.md)**
  — full Step 6.8 procedure (tool whitelists for restrictive hosts +
  Claude `mcpServers:` scoping)
- **[references/role-overrides.md](references/role-overrides.md)** —
  full Step 6.9 procedure (role substitutions when agents are missing)
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
scout either asks interactively or writes `Unconfirmed`. A trailing
free-form `## Notes` block in the prompt is carried verbatim into
§ Additional notes for anything that doesn't fit a structured field.

Downstream skills read this section at runtime:
`test-case-analysis` (bug filing), `bugfix-workflow` (tracker CLI),
`test-automation-workflow` (test-case storage),
`test-automation-lead` + `test-automation-engineer` (merge policy,
base branch).

**Full procedure** — all captured fields, defaults, destinations,
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
  `references/templates.md`. **Then carry the team's block over:** if
  `AGENTS.md` contains any `<!-- BUNDLE:<id> START -->` … `END -->`
  block, copy each one into the new CLAUDE.md verbatim (at the end).
  The installer splices these into CLAUDE.md on its next `--update`
  anyway — copying now just closes the window where Claude sessions
  run without the team's working agreements auto-loaded.
- **If it exists:** treat it as the engineer's carefully crafted
  document. Read the whole thing before touching anything. Make only
  surgical additions for genuinely missing facts (e.g. a command you
  verified that isn't listed). Fix only clear errors. Do not
  restructure, reword, or "improve" prose — the wording is
  intentional. When in doubt, leave it alone and ask the engineer
  directly. **Preserve any `<!-- BUNDLE:<id> START -->` … `END -->`
  block verbatim** — it's a team bundle's conventions, not yours to edit.

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
- **Preserve bundle blocks.** If `AGENTS.md` already contains any
  `<!-- BUNDLE:<id> START -->` … `<!-- BUNDLE:<id> END -->` block, copy
  it through verbatim — it was installed by a team bundle and holds that
  team's working agreements. Read existing `AGENTS.md` before
  regenerating; keep every bundle block intact (placement doesn't
  matter — keep it whole). Never edit or drop the marker lines.

## Step 2.5 — Scaffold .agents/knowledge/ (shared knowledge layer)

The **committed** counterpart to per-role memory. `.agents/memory/<role>/` is local and
role-scoped, so a fact one role paid for is invisible to every other role — and to the same role
on another machine. This layer is where cross-role facts live so they are actually reachable.

Create the charter and folder scaffolding (skip any folder the project has no use for):

```
.agents/knowledge/
├── README.md            ← charter: admission tests + start-here index
├── architecture/        system shape, service boundaries, seams
├── services/            per-service invariants and surprising contracts
├── frontend/            client state, lifecycle, enforced UI rules
├── integrations/        external systems the project depends on
├── environment/         local setup and the dev loop
├── practices/           how we work: verification, migration hazards, review
├── testing/             suites and harness behaviour
└── security/            credential, auth and egress invariants
```

Each folder gets a `README.md` stating **what belongs in it and what does not**, plus an index of
its notes. Empty folders are fine — a named home makes it likelier a hard-won fact gets written
down at all.

**The charter must state the admission tests**, because a shared layer is only useful if it is
trusted. A note is admitted only if it is **cross-role**, **verified** (with a stated method and
date), **durable**, and **costly to rediscover**. Say plainly that an unverified claim here is
worse than silence, since it is committed and therefore trusted.

**Seed it** from what you verified during onboarding — the facts that took real effort to
establish and that more than one role will need (how to run the stack, what `make dev` does *not*
set up, which invariants fail silently). Do not pad it: three trustworthy notes beat twenty
uncertain ones.

**Record the contract in `CLAUDE.md` and `AGENTS.md`** (Steps 1 and 2) so agents know the layer
exists and how to add to it — a knowledge layer nobody is told about is one nobody uses. In
`AGENTS.md`, place it **outside** any `<!-- BUNDLE -->` markers so bundle regeneration cannot
clobber it.

Ongoing curation is the `knowledge-curation` skill's job; seeding just creates the structure and
the first entries.

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

Every project gets a scout-generated `.agents/team-comms.md` that
names the host, the installed personas, and the exact invocation syntax.

**Full procedure** — host detection, persona enumeration, template
selection, Copilot capability declaration, idempotence rules — lives
in **[references/team-comms-workflow.md](references/team-comms-workflow.md)**.
Templates live in
**[references/team-comms-templates.md](references/team-comms-templates.md)**.

## Step 6.6 — Generate .agents/test-automation.yaml

When the project uses a TMS (captured in Step 0.7 and recorded in
`.agents/profile.md`), scout writes `.agents/test-automation.yaml` by
following the onboarding procedure in the **test-automation-workflow**
skill's **[references/tms-adapters.md](../test-automation-workflow/references/tms-adapters.md)
§ "If you're onboarding a new project"**: pick the adapter row matching
the captured TMS, pick the transport (MCP if already wired into the host,
HTTP otherwise), copy that adapter's config block into the file, and
wire the required env vars (the adapter's `auth_env` line names them).

Don't restate the YAML schema here — `tms-adapters.md` is the single
source of truth for adapter fields, transports, and status verbs.

If the project has **no TMS** (markdown source of truth), write the
one-liner:

```yaml
tms: { adapter: markdown, cases_dir: test-specs }
```

Mark any field you couldn't confirm with the skill's normal
`Unconfirmed` convention rather than guessing. This file is consumed
downstream by Step 6.8 (tool-whitelist wiring) and by the whole
test-automation pipeline at runtime.

## Step 6.7 — Install telemetry (tokenomics) — DEFAULT ON

Every seeded project gets the cost/attribution telemetry unless the
operator explicitly declines. Load the **tokenomics** skill (it is
installed with the bundle; not preloaded — load it now) and run its
installer from the repo root:

```bash
node <skills root>/tokenomics/scripts/install-hooks.mjs
node <skills root>/tokenomics/scripts/install-hooks.mjs --doctor   # must end "all good"
```

`<skills root>` = the host's skills dir: `.claude/skills/` on Claude Code,
`.github/skills/` on Copilot CLI, `.cursor/skills/` on Cursor — scout knows
the host from Step 6.5's detection.

What this sets up (the skill owns the details — don't restate them):
capture hooks in the host settings, the `.agents/telemetry` submodule
on its own `telemetry` branch (the main tree stays clean; a local-only
repo is fine — data accrues on the local branch), and the per-batch
cost pipeline every close and report depends on. The installer prints
**one commit to make** (`.gitmodules` + the submodule pointer) —
include it in the seed commit rather than leaving it staged.

Degrade gracefully: tokenomics skill not installed → skip with a
`Telemetry: not installed` line in the seeding report, never a failure.
Re-runs are idempotent — the installer is also the updater, and
`--doctor` is the health check to quote in the report.

**Then seed the factory identity** (the cross-factory tokenomics dataset's
segment header — every batch close appends a dataset row automatically, and
without identity those rows carry null `factory_id`):

1. Copy `<skills root>/tokenomics/templates/factory-profile.template.json`
   to `.agents/telemetry/automation/factory-profile.json` — skip if it
   already exists (hand-authored once, never regenerated).
2. Fill the `<angle-bracket>` placeholders: ask the operator for
   `factory_id` / `factory_name` (one AskUserQuestion — suggest
   `<repo-slug>-test-automation`); set `agent_tool` to the detected host +
   version; add `maturity` (`production | pilot | experimental`) and
   `env_setup` (`trivial | single-fixture | multi-fixture | external-deps |
   full-env`) from what Step 6 learned about the test infrastructure — the
   dataset rows read both from this file.
3. The non-placeholder defaults (stop `testing`, owner `QA`, the efficiency
   techniques, the pipeline stages) hold for a stock install — override only
   where this project genuinely differs. Never invent an org identifier the
   operator didn't give; a declined question stays `null` and the export's
   §7 checklist flags it.

## Step 6.8 — Wire agent tool whitelists + MCP scoping

Hosts that default to a restrictive tool-permission model — notably
GitHub Copilot CLI, where an agent with no `tools:` line only gets
`['agent']` — need a per-agent `tools:` whitelist written into the
installed agent frontmatter. On Claude Code the `tools:` part skips
(permissive default is correct), but the step still writes **per-agent
`mcpServers:` scoping**: on direct dispatches and standalone runs every
configured server's tool schemas ride along on each turn, while
workflow-spawned workers' MCP access has flipped with host versions
(present on 2.1.218, absent on 2.1.220) — scoping makes access explicit
and deterministic on every path instead of a build lottery. The
reference carries who gets which servers (both workers ship an inline
browser server the bundle defines — scout tunes it per project, strips
it for API-only stacks, and adds the TMS adapter for qa-engineer; a
"none" intent gets `mcpServers: []` plus the `disallowedTools`
fallback; lead/scout → unscoped).

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
the best-matching installed agent and records per-project routing
overrides in `.agents/role-overrides.md`, which the orchestrator
(`test-automation-lead` in this bundle) reads at session start and
consults at dispatch time.

Lightweight substitution (the `.agents/role-overrides.md` mapping)
is the default; full persona rewrite (Step 7) is the escalation when
the installed agent is too distant from the slot.

Runs automatically after Step 6.8. No-op when every needed slot has
its dedicated agent installed.

**Full procedure** — role-similarity table, injection format,
idempotence rules, per-agent injection locations, report format —
lives in **[references/role-overrides.md](references/role-overrides.md)**.

## Step 7 — Role customization (non-default stacks)

Only runs when the detected stack doesn't match the default role set
(e.g. game engines, Rust CLIs, data science). Skip entirely if
defaults fit.

**Full procedure** — SOUL.md / AGENT.md rewrites, role memory seeding —
lives in
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
grep -ri "password\|secret\|token\|api_key" CLAUDE.md AGENTS.md .agents/ 2>/dev/null || echo "clean"

# Bundle blocks survived regeneration (paired START/END markers, if any)
grep -c "<!-- BUNDLE:.* START -->" AGENTS.md 2>/dev/null  # must equal the END count

# Agent tool whitelists wired (only expected under Copilot CLI / restrictive hosts)
if ls .github/agents/*.agent.md >/dev/null 2>&1; then
  grep -L "^tools:" .github/agents/*.agent.md | head || echo "all agent files declare tools:"
fi

# Memory files present and non-empty for all roles
ls .agents/memory/
find .agents/memory -name 'project_briefing.md' -exec wc -l {} +

# Telemetry installed and healthy (Step 6.7; absent only if declined/skipped)
node <skills root>/tokenomics/scripts/install-hooks.mjs --doctor 2>/dev/null | tail -1  # "all good"
```

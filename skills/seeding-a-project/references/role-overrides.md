# Role overrides — Step 6.9 full procedure

Scout compares the **workflow slots** the project needs (derived from
which workflow skills are installed and from the project's stated
pipelines) against the **installed agent roster**. For any slot that
has no dedicated agent installed, scout picks the best-matching
installed agent and **injects per-project routing overrides directly
into the AGENT.md files of the routing agents** (PM, tech-lead, any
other agent whose handoff prompts name specific agents).

Test-automation is the worked example — but the mechanism is general:
the same substitution machinery applies to any slot (requirements
author, dev by language, reviewer, QA, etc.) that's needed but
unfilled.

Runs automatically after tool wiring (Step 6.8). No-op when every
needed slot has its dedicated agent installed.

## Lightweight injection vs. full customization (when to defer to Step 7)

- **Lightweight substitution** (this step) — scout adds a
  marker-bracketed "Project-specific routing overrides" section to
  each affected agent's AGENT.md. The agent's persona / Session Start
  / default instructions stay intact; the override section gets
  consulted before routing.
- **Full customization** (Step 7) — scout clones an existing agent
  into a new `.agent.md` file with a rewritten persona, frontmatter,
  and Session Start matching the slot. Use when the installed agent
  is too distant from the role to play it comfortably via an
  instruction tweak alone (e.g. `personal-assistant` covering a dev
  slot).

Default is lightweight. Scout escalates to Step 7 only when the
role-similarity heuristic (below) produces a weak match.

## Role-similarity rules

Scout uses these tiered fallbacks when picking a substitute. First
row wins; later rows emit warnings in the injected section.

| Slot | Preferred | Fallback 1 | Fallback 2 | Last resort | None viable |
|---|---|---|---|---|---|
| Requirements (BA) | `ba` | `tech-lead` | `project-manager` | operator | blocker |
| Architecture / decomposition | `tech-lead` | Language-matched dev | `ba` | operator | blocker |
| Routing & merge gate (PM) | `project-manager` | `tech-lead` | operator | — | blocker |
| Code impl — JS/TS | `js-dev` | `python-dev` (cross-lang warning) | `tech-lead` | operator | blocker |
| Code impl — Python | `python-dev` | `js-dev` (cross-lang) | `tech-lead` | operator | blocker |
| Code impl — iOS/Swift | `ios-dev` | `tech-lead` (cross-lang warning) | operator | — | blocker |
| Code impl — other language | `tech-lead` | Language-adjacent dev | operator | — | blocker |
| QA / verification | `qa-engineer` | — (weak substitutes) | operator | — | **blocker: install qa-engineer, or escalate to Step 7** |
| Test-automation analyst | `qa-engineer` + `test-case-analysis` skill | `qa-engineer` alone (skill inlined) | — | — | blocker (same as QA) |
| Test-automation implementer | `test-automation-engineer` | Language-matched dev | `tech-lead` (framework-drift warning) | operator | blocker |
| Reviewer | `qa-engineer` (fresh session) | `tech-lead` + `code-review` | operator | — | operator |

Language matching uses scout's primary-language detection from
Step 0.5. Cross-language dev fallback emits a warning in the
override notes.

### What "blocker" means in the table

When the best-match column for a slot is `blocker`, scout **does
not halt the seed**. It:

1. Writes the blocker into the `#### Blockers` list of the injected
   override block (per-agent AGENT.md) so downstream agents see why
   their handoff target is missing.
2. Emits the blocker in the Step 6.9 summary report under
   `Blockers: <list>` (see § Report below).
3. Continues to the next slot and the next phase (6.95, 7, etc.).
   Project-seeder exits 0 even with blockers present — the whole
   point of lightweight substitution is to keep the pipeline flowing
   so the operator can install the missing dedicated agent when
   they're ready, not force a scaffolding-level failure.

Escalation from blocker → Step 7 (full persona rewrite) is never
automatic; scout flags it as a "Step 7 escalation candidate" in the
report and the operator chooses whether to re-run with Step 7 or
install the dedicated agent and re-run with the blocker resolved
naturally.

## How scout delivers the overrides — externalized via @-import

Scout **does not modify agent source files**. Instead it writes a
single markdown file under `.agents/` and relies on an `@`-import
directive that already ships in the source of each routing agent.
This preserves the rule that `npx init --update` is always safe:
agent frontmatter + body stay canonical, only the project-local
`.agents/` content changes.

### The file scout writes — `.agents/role-overrides.md`

Plain markdown, no marker scaffolding, no in-file mutation of
anything else:

```markdown
# Project-specific routing overrides

_Scout wrote this on 2026-04-24 because these slots lack dedicated
installed agents. Routing agents (PM, tech-lead) auto-load this
file via `@.agents/role-overrides.md`; the substitute mappings
below override the defaults their AGENT.md bodies name. Delete
this file (or re-run scout after installing the dedicated agents)
to disable._

## Detected roster

- Installed agents: `ba, project-manager, qa-engineer, tech-lead,
  python-dev, scout`
- Project's primary language: TypeScript

## Substitute mappings

| Slot | Default | Substitute | Fallback tier | Notes |
|---|---|---|---|---|
| Test-automation implementer | `test-automation-engineer` | `python-dev` | fallback-1 | Cross-language: project is TypeScript, no js-dev installed |
| Test-automation analyst | `qa-engineer` + `test-case-analysis` | `qa-engineer` alone | preferred (skill inlined) | OK — qa-engineer loads the skill at session start |

## Blockers

- (none)
```

### How routing agents consume it

Source AGENT.md files for routing agents (PM, tech-lead) carry an
`@`-import at the top alongside the `snapshot.md` import:

```markdown
---
name: project-manager
…
---

@.agents/memory/project-manager/snapshot.md
@.agents/role-overrides.md
```

- `@.agents/role-overrides.md` **missing on disk** (the common case
  — no substitutions needed) → Claude Code treats the import as a
  silent no-op; Copilot / Cursor / Windsurf never tried to resolve
  it. Zero runtime impact.
- **Present** → Claude Code auto-loads the content at session start.
  Copilot / Cursor / Windsurf agents see the `@` path in their
  flat body and read the file on demand (per the conditional-skill
  convention established elsewhere in this repo).

### Idempotence and cleanup

- Scout **always rewrites** `.agents/role-overrides.md` on every
  Step 6.9 pass — either with a fresh substitution set or by
  deleting the file entirely if no slots need substitution. No
  marker-block parsing; file presence is the signal.
- The operator can delete `.agents/role-overrides.md` by hand at
  any time; routing agents behave as if no substitutions exist
  until scout writes again.
- Source `agents/project-manager/AGENT.md` and
  `agents/tech-lead/AGENT.md` are never touched by scout — they
  already carry the `@.agents/role-overrides.md` line in the
  installed copies (scoped to routing agents only; workers don't
  get the import because they don't route).

### Which routing agents get the import at source

Only agents whose bodies name other agents by default for handoff
(so they can be overridden):

- `project-manager` — universal router. Always has the import at
  source.
- `tech-lead` — has the import at source because the PM →
  tech-lead handoff can be overridden when a language-matched dev
  substitutes for the test-automation implementer slot.
- Worker agents (devs, QA when not substituted, scout itself,
  personal-assistant) — **no import**. They're the recipients of
  routing, not the routers, so they don't read overrides.

## Why this design (principle recap)

Scout's writes are **scoped to `.agents/` and `.octobots/`** —
never to agent source files, host MCP config, or environment.
That rule makes the whole toolchain re-installable:
`npx init --update` can freely overwrite agent files from the
canonical source, and scout's project-specific state lives in a
separate directory that the installer leaves alone. See
`references/agent-tools-wiring.md` for the parallel rule applied
to Step 6.8 (MCP inventory / `tools:` frontmatter).

## What workflow skills do (and don't do)

Workflow skills (`test-automation-workflow`, `implement-feature`,
`plan-feature`, `bugfix-workflow`) describe slots generically —
"analyst", "implementer", "reviewer", etc. They **do not**
reference per-project substitutions. The routing agent (PM)
resolves slot → agent at handoff time by reading
`.agents/role-overrides.md` when present, falling back to the
defaults named in its own AGENT.md body when absent.

This keeps skills source-stable: sdlc-skills updates don't clobber
project-specific substitutions, because the substitutions live in
a single project-local file that's outside the upgrade path.

## Report (end of Step 6.9)

Scout logs in its summary:

```
Step 6.9 complete — role substitutions

Installed agents: <list>
Project's primary language: <detected>

Slot substitutions:
  <slot>: default=<X>, substitute=<Y> [fallback-tier], warnings=<...>

Wrote:    .agents/role-overrides.md
(or)      .agents/role-overrides.md — no substitutions needed, file deleted

Blockers: <none | list>
Step 7 escalation candidates: <slots warranting full customization>

Re-run scout after installing the dedicated agents to refresh or
remove the overrides file.
```

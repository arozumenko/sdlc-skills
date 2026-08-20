# Factory spec

A **factory** is a named, installable AI-team preset. It sits one layer
above agents: instead of hand-listing roles
(`--agents scout,ba,tech-lead,…`), you install a curated team in one shot:

```bash
npx github:arozumenko/sdlc-skills init --factory feature-development
```

(`--bundle` still works as a silent back-compat alias for `--factory`.)

A factory composes five things:

| Layer | Where it comes from |
|---|---|
| **Agents** | owned by the factory under `factories/<id>/agents/` |
| **Skills** | auto-pulled from each agent's `skills:` + `skills-on-demand:` frontmatter (both install; only `skills:` enters standing context — on-demand entries are installed on disk only and loaded when the agent's prose calls for one), plus any team-wide extras the factory declares; factory-local skills live under `factories/<id>/skills/` |
| **Instructions** | a team-level guidance file the factory ships |
| **Briefings** | per-role *stack overlays* the factory seeds into each role's memory |
| **Hooks** | IDE automation (Claude `settings.json`), v1 Claude-only |

## Why overlays, not forked agents

Most agents are **stack-agnostic and adapt at runtime**. Scout detects the
stack and tunes roles; `ba`, `project-manager`, and `personal-assistant`
read `.agents/` context. The stack-specific agent *is* the dev role
(`python-dev` vs `js-dev` vs `ios-dev` vs `android-dev`) — there is no "scout for iOS"
distinct from "scout for web", only one scout producing different output.

A factory owns a real copy of each agent it uses (see "Factory-owned content"
below), but it does **not** fork an agent's *behavior* into a stack-specific
variant. A shared agent becomes stack-specific (e.g. "qa-engineer for iOS")
not by rewriting its `AGENT.md` body but through **two parallel overlays on
top of that generic body (which holds stack-agnostic practices):**

1. **Briefing overlay** (behavior) — a per-role file installed into
   `.agents/memory/<role>/project_briefing.md` (the exact slot scout fills
   at runtime). Tunes *how* the role thinks about this stack.
2. **Skill overlay** (capability) — `skillOverlays` rewrites the installed
   agent's `skills:` frontmatter for this team: `add` stack-specific skills,
   `remove` generic ones that don't fit. Tunes *what* the role can do.

Both leave the source agent unmodified — only the *installed copy* is tuned.
Example: a factory can give `qa-engineer` an iOS briefing **and** a skill
overlay that drops the web `playwright-*`/`browser-verify` skills and adds a
native iOS UI-testing skill.

## Flat dev-role selection (`coreAgents` / `devRoles` / `platforms`)

A factory can offer an **unrestricted pick-list of developer roles** instead of
installing a fixed roster. When `factory.json` declares `devRoles`, the installer
shows a flat checklist of those roles (any combination), always installs
`coreAgents`, and tunes the core roles from the **platforms** the picked dev
roles imply:

- `coreAgents` — roles that always install, regardless of which dev roles are
  picked.
- `devRoles` — `{ name: { label, platform, briefing?, skillOverlay? } }`. The
  flat pick-list; each role is tagged with an internal `platform`.
- `platforms` — `{ id: { label, briefings{}, skillOverlays{} } }`. Shared-role
  tuning applied when any selected dev role carries that platform. Across
  multiple active platforms, skillOverlay `add`s union and `remove`s apply only
  where every active platform removes the skill; per-platform briefings for the
  same core role are concatenated under `## <label> stack` headers.

`--yes` / non-interactive installs all dev roles; `--agents <subset>` selects
non-interactively. Factories without `devRoles` keep the legacy fixed-roster
behavior.

## Factory-owned content

Each factory physically owns its `agents/` and `skills/` directories — real
files, authored and maintained directly under `factories/<id>/agents/<name>/`
and `factories/<id>/skills/<name>/`. The same agent or skill id may appear in
several factories with different content; divergence across factories is allowed
and expected (hand-editing a factory's copy to suit the team is normal).

There is **no sync and no cross-factory equality requirement**. The factory dir
is the source of truth for its content.

Agents and skills are declared in the manifest via `localAgents` /
`localSkills`. The factory's own dir is self-documenting —
`ls factories/feature-development/agents/` shows the full roster as real
directories, indexable by tools that don't follow symlinks.

**Standalone install resolution.** `--agents <name>` / `--skills <id>` check,
in order: the top-level orphan dirs (`agents/`, `skills/`) first, then the
alphabetical-first factory that declares the id (a one-line notice prints when
more than one factory owns it). To pin a specific factory's copy use the
qualified form `--agents <factory>/<name>` or `--skills <factory>/<id>`.

## Directory layout

```
factories/<id>/
├── FACTORY.md                required — structured catalog descriptor (name/description/owner frontmatter)
├── README.md                required — the team's front-door doc (roster, install, how it works)
├── factory.json              required — the manifest
├── instructions.md          optional — team-level guidance
├── briefings/
│   └── <role>.md            optional — per-role stack overlay
│                            → .agents/memory/<role>/project_briefing.md
├── hooks/                   optional — Claude settings.json automation
│   ├── hooks.json            hook config fragment (event → command)
│   └── scripts/              scripts the hooks invoke (chmod +x on install)
├── agents/                  optional — agents this factory owns (real copies; same id may differ from other factories)
│   └── <name>/               installed like a global agent (AGENT.md + SOUL.md)
└── skills/                  optional — skills this factory owns (real copies)
    └── <name>/               installed like a monorepo skill (SKILL.md + references/scripts)
```

## `FACTORY.md` — structured catalog descriptor

The catalog identifies a factory by the presence of a `FACTORY.md` file in the
factory folder. It's the factory's **structured** identity — essentially a
`.md.yaml`: YAML frontmatter and little or no prose. All skills and agents
nearby are treated as artifacts of that factory and displayed together in the
catalog.

```markdown
---
name: Web Team                # human label
description: Fullstack web…    # short, concise summary
owner: AIRUN                   # practice, project, team, or group of people
authors:                       # list of "Name <email>" — required, non-empty
  - "Artem Rozumenko <artem_rozumenko@epam.com>"
sdlc_phase: Accelerated Feature Development  # single scalar — required, never a list
support_level: Self-Serve       # Self-Serve | Best Effort Support | Dedicated Capacity
use_cases:                      # list of short use-case phrases
  - Cross-platform feature delivery
  - Stack-adaptive engineering team
project_deployments:            # optional — omit the key entirely when N/A
  - project_code: EPM-EASE      #   list entries may be plain strings or
  - EPM-CDME                    #   { project_code: X } objects
---

See [`README.md`](README.md) for the roster, install steps, and how the team works.
```

`FACTORY.md` and `README.md` sit side by side, with distinct jobs:

- **`FACTORY.md`** — structured info the catalog parses directly (name,
  description, owner, authors, sdlc_phase, support_level, use_cases,
  project_deployments).
- **`README.md`** — the human/LLM-readable front-door doc (roster, install,
  how it works); the catalog can generate a richer summary from it.
- **`factory.json`** — the install manifest that drives `init.mjs`.

The descriptor carries no install config.

**Required fields:** `name`, `description`, `owner`, `authors` (non-empty
list), `sdlc_phase` (a single scalar — a list or a comma-separated value is
rejected). `support_level`, when present, must be one of `Self-Serve`,
`Best Effort Support`, or `Dedicated Capacity`. Any frontmatter value that
contains a `:` or starts with a YAML-special character (`*`, `&`, `#`, `@`)
must be quoted — the validator scans the raw frontmatter lines and rejects an
unquoted risky value before it can be silently misparsed.

**`project_deployments`** is optional and deliberately absent from the
factories shipped in this repo today — omit the key when it doesn't apply. An
explicit `project_deployments: []` is a distinct "not disclosed" sentinel
(parsed and preserved as an empty list, not coerced to absent) rather than
"omitted"; use it only when you mean to assert the field was considered and
intentionally left empty.

**`discoverable: false`** — any agent's `AGENT.md` or skill's `SKILL.md` can
opt out of the generated catalog by setting `discoverable: false` in its own
frontmatter. `gen-marketplaces.mjs` skips that item when building
`.cursor-plugin`/`.codex-plugin`/`.github/plugin` marketplace.json — it still
installs normally via `--agents`/`--skills`/`--factory`, it just doesn't
appear as a discoverable catalog entry. Omitting the key (the default)
leaves the item discoverable.

## `factory.json` schema

```jsonc
{
  "id": "feature-development",              // must match the directory name
  "title": "Feature Development",           // human label
  "description": "...",                      // one-line summary
  "agents": ["scout", "ba", "..."],          // agents to install (resolved from this factory's agents/ dir or the orphan top-level)
  "skills": [],                              // team-wide extra skills beyond what agents pull (global catalog OR this factory's localSkills — use for a factory-local skill that should install without being in any agent's roster, loaded on demand)
  "briefings": {                             // role → briefing file (behavior overlay)
    "qa-engineer": "briefings/qa-engineer.md"
  },
  "skillOverlays": {                         // role → capability overlay (optional)
    "qa-engineer": { "add": ["xcuitest"], "remove": ["playwright-testing"] }
  },
  "seed": { "knowledge": ".agents/manual-qa/knowledge" }, // optional, factory-relative src → project-relative dest
  "instructions": "instructions.md",         // optional, relative path
  "hooks": "hooks/hooks.json",               // optional, relative path
  "localAgents": [],                         // agents this factory owns (under factories/<id>/agents/)
  "localSkills": [],                         // skills this factory owns (under factories/<id>/skills/; no skills.json entry needed)
  "targets": ["claude"]                      // IDE targets that get HOOKS (agents/skills/briefings install everywhere)
}
```

## Install behavior (`bin/init.mjs`)

1. **Resolve** — read `factories/<id>/factory.json`; merge `agents[]` into the
   agent install list (existing logic auto-pulls each agent's declared
   skills); append `skills[]`; install `localAgents` from
   `factories/<id>/agents/`; install `localSkills` from
   `factories/<id>/skills/` like monorepo skills. A `localSkills` id satisfies
   any agent in the factory that declares it in `skills:` frontmatter, with no
   `skills.json` entry needed — the description is read from each
   `SKILL.md` so non-Claude targets still get a populated SKILLS section.
2. **Briefings** — write each `briefings/<role>.md` to
   `.agents/memory/<role>/project_briefing.md` and add a `MEMORY.md` index
   line. Skip if a `project_briefing.md` already exists (scout may have
   written one) unless `--update`.
2a. **Seed files** — `seed` maps a factory-relative source → a project-relative
   dest; copied into the project once at install (idempotent; `--update` does a
   clean replace). Use for reference docs agents read at runtime (a subagent's
   cwd is the project root). Example:
   `"seed": { "knowledge": ".agents/manual-qa/knowledge" }`.
2b. **Skill overlays** — for each `skillOverlays[<role>]`, rewrite the
   *installed* agent's skill frontmatter to `(declared − remove) + add`.
   `remove` drops from both `skills:` and `skills-on-demand:`; `add` lands on
   the `skills-on-demand:` line when the agent has one (so an overlay never
   silently grows the Claude preload), else on `skills:`.
   The install union is recomputed from the effective sets: a `remove`d skill
   no remaining agent needs isn't installed; `add`ed skills that resolve are
   installed; `add`s not yet in the catalog are reported as **pending content**
   (the role's frontmatter only lists skills that actually exist). The factory's
   source agent is never modified — only the installed copy is tuned.
3. **Instructions** — splice `instructions.md` into root context files
   inside `<!-- FACTORY:<id> START -->` / `<!-- FACTORY:<id> END -->` markers.
   Re-running replaces the marked block in place — idempotent, no `--update`
   needed. `AGENTS.md` (the full team reference every agent reads) is created
   if missing; `CLAUDE.md` is auto-loaded and scout-owned (kept lean), so its
   block is only refreshed when the file already exists — never created.
   When scout later regenerates `AGENTS.md`/`CLAUDE.md`, the
   `seeding-a-project` / `seeding-automation-project` skills preserve
   `<!-- FACTORY:* -->` blocks (legacy `<!-- BUNDLE:* -->` included) verbatim,
   so a factory's conventions survive onboarding.
4. **Hooks** — for each target in `targets ∩ installed targets`, merge
   `hooks/hooks.json` into `<target>/settings.json` under `hooks` (tagged
   entries, merge-not-clobber, back up first); copy `hooks/scripts/` and
   `chmod +x`. Non-Claude targets are skipped with a notice (v1).

## Hooks (`hooks/hooks.json`)

v1 is **Claude-only** (Cursor/Windsurf/Copilot hook formats differ and are
skipped with a notice). `hooks.json` is a standard Claude hooks object —
event name → matcher-groups:

```jsonc
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/feature-development/format.sh" }
      ]
    }
  ]
}
```

On install:

- Scripts under `hooks/scripts/` are copied to
  `<target>/hooks/<factory-id>/` and `chmod +x` — reference them in commands
  via `$CLAUDE_PROJECT_DIR/<target-dir>/hooks/<factory-id>/<script>`.
- Each injected matcher-group is tagged with `"_factory": "<id>"` (the
  installer also recognizes the pre-rename `"_bundle": "<id>"` tag on groups
  merged before this rename, so old installs still get cleanly replaced). On
  re-merge the installer drops only groups tagged with this factory's id and
  re-appends the current ones — so the user's hooks and other factories'
  hooks are preserved (merge-not-clobber), and re-running is idempotent.
- `settings.json` is backed up to `settings.json.bak` before any change. If
  it fails to parse, it's left untouched and the merge is skipped.

The `feature-development` factory does not ship hooks yet — the merge
machinery is in place; concrete hooks (format-on-edit, etc.) come later.

## Coexistence (installing several factories into one repo)

Factories are additive by construction — any combination installs in any
order. Three conventions keep it that way:

- **Consumer-repo namespaces.** Each factory owns `.agents/<its-id-or-domain>/`
  for the working state its agents write in the consumer repo
  (test-automation → `.agents/automation/`, manual-qa → `.agents/manual-qa/`,
  feature-development → `.agents/feature-development/`). The `.agents/` root
  holds only genuinely shared things (`profile.md`, `memory/<role>/`, shared
  docs). Product artifacts (specs, tests, source) belong in the repo tree,
  never under `.agents/`.
- **Roster-guard shared-event hooks.** A hook that fires on a generic event
  (`SubagentStop`, `PreToolUse` on `Agent`, session start/end) runs in EVERY
  factory's sessions. Such a hook must check that the dispatched agent belongs
  to its own factory's roster and exit silently otherwise (fail-open on a
  missing `subagent_type` for older hosts). Field incident that set the rule:
  manual-qa's benchmark hooks matched on the Agent *tool* and seeded state +
  synthetic RUN reports in every test-automation session until guarded.
- **One shared telemetry submodule.** Durable telemetry lives in
  `.agents/telemetry` — a self-referential submodule on the repo's own
  `telemetry` branch, **one subfolder per factory** (test-automation writes
  `automation/`). A factory adopting durable telemetry later adds its own
  subfolder and rides the same branch and sync machinery — never a second
  submodule or a second branch. Setup and mechanics:
  `factories/test-automation/skills/tokenomics/`.

## Idempotency & validation

- Marked instruction blocks and tagged hook entries make re-install a
  no-op (or a clean refresh with `--update`) and allow clean removal.
- **`npm run validate:factories`** (`bin/validate-factories.mjs`, run in CI via
  `.github/workflows/validate.yml`) checks each factory: dir name matches
  `id`, a `README.md` exists, a `FACTORY.md` exists with non-empty
  `name`/`description`/`owner`/`authors`/`sdlc_phase` frontmatter (`sdlc_phase`
  a single scalar, `support_level` one of the three enum values when present,
  risky unquoted values rejected), `agents[]` is non-empty and every entry exists
  under `factories/<id>/agents/`, every `briefings` role is in `agents[]` and its file
  exists, every `skills[]` id resolves in `skills.json`/`factories/<id>/skills/`,
  `instructions` (if set) exists, `hooks` (if set) parses, each
  `localAgents` entry has an `AGENT.md`, each `localSkills` entry has a
  `SKILL.md`, and every `seed` source path exists.
- A factory may have an empty `agents` array if it provides `localAgents` —
  a fully self-contained team (e.g. `manual-qa`).

## Current factories

| id | team | dev roles |
|---|---|---|
| `feature-development` | cross-platform (web + iOS + Android) | pick any of `python-dev`, `js-dev`, `test-automation-engineer`, `ios-dev`, `android-dev` (greenfield Compose only); core roles auto-tune |
| `manual-qa` | manual QA for web | 6 local agents: `app-profiler`, `test-sizer`, `test-author`, `test-run-lead`, `test-runner`, `test-reporter` |
| `test-automation` | TMS-driven automation pipeline | `test-automation-lead` orchestrates `qa-engineer` + `test-automation-engineer` |
| `product-management` | PO discovery pipeline | 2 local agents: `product-owner`, `discovery-researcher`; 10 discovery skills; seeds `docs/discovery/` |

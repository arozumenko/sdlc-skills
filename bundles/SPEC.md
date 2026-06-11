# Bundle spec

A **bundle** is a named, installable AI-team preset. It sits one layer
above agents: instead of hand-listing roles
(`--agents scout,ba,tech-lead,…`), you install a curated team in one shot:

```bash
npx github:arozumenko/sdlc-skills init --bundle feature-development
```

A bundle composes five things:

| Layer | Where it comes from |
|---|---|
| **Agents** | owned by the bundle under `bundles/<id>/agents/` |
| **Skills** | auto-pulled from each agent's `skills:` frontmatter, plus any team-wide extras the bundle declares; bundle-local skills live under `bundles/<id>/skills/` |
| **Instructions** | a team-level guidance file the bundle ships |
| **Briefings** | per-role *stack overlays* the bundle seeds into each role's memory |
| **Hooks** | IDE automation (Claude `settings.json`), v1 Claude-only |

## Why overlays, not forked agents

Most agents are **stack-agnostic and adapt at runtime**. Scout detects the
stack and tunes roles; `ba`, `project-manager`, and `personal-assistant`
read `.agents/` context. The stack-specific agent *is* the dev role
(`python-dev` vs `js-dev` vs `ios-dev`) — there is no "scout for iOS"
distinct from "scout for web", only one scout producing different output.

A bundle owns a real copy of each agent it uses (see "Bundle-owned content"
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
Example: a bundle can give `qa-engineer` an iOS briefing **and** a skill
overlay that drops the web `playwright-*`/`browser-verify` skills and adds a
native iOS UI-testing skill.

## Flat dev-role selection (`coreAgents` / `devRoles` / `platforms`)

A bundle can offer an **unrestricted pick-list of developer roles** instead of
installing a fixed roster. When `bundle.json` declares `devRoles`, the installer
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
non-interactively. Bundles without `devRoles` keep the legacy fixed-roster
behavior.

## Bundle-owned content

Each bundle physically owns its `agents/` and `skills/` directories — real
files, authored and maintained directly under `bundles/<id>/agents/<name>/`
and `bundles/<id>/skills/<name>/`. The same agent or skill id may appear in
several bundles with different content; divergence across bundles is allowed
and expected (hand-editing a bundle's copy to suit the team is normal).

There is **no sync and no cross-bundle equality requirement**. The bundle dir
is the source of truth for its content.

Agents and skills are declared in the manifest via `localAgents` /
`localSkills`. The bundle's own dir is self-documenting —
`ls bundles/feature-development/agents/` shows the full roster as real
directories, indexable by tools that don't follow symlinks.

**Standalone install resolution.** `--agents <name>` / `--skills <id>` check,
in order: the top-level orphan dirs (`agents/`, `skills/`) first, then the
alphabetical-first bundle that declares the id (a one-line notice prints when
more than one bundle owns it). To pin a specific bundle's copy use the
qualified form `--agents <bundle>/<name>` or `--skills <bundle>/<id>`.

## Directory layout

```
bundles/<id>/
├── BUNDLE.md                required — structured catalog descriptor (name/description/owner frontmatter)
├── README.md                required — the team's front-door doc (roster, install, how it works)
├── bundle.json              required — the manifest
├── instructions.md          optional — team-level guidance
├── briefings/
│   └── <role>.md            optional — per-role stack overlay
│                            → .agents/memory/<role>/project_briefing.md
├── hooks/                   optional — Claude settings.json automation
│   ├── hooks.json            hook config fragment (event → command)
│   └── scripts/              scripts the hooks invoke (chmod +x on install)
├── agents/                  optional — agents this bundle owns (real copies; same id may differ from other bundles)
│   └── <name>/               installed like a global agent (AGENT.md + SOUL.md)
└── skills/                  optional — skills this bundle owns (real copies)
    └── <name>/               installed like a monorepo skill (SKILL.md + references/scripts)
```

## `BUNDLE.md` — structured catalog descriptor

The catalog identifies a bundle by the presence of a `BUNDLE.md` file in the
bundle folder. It's the bundle's **structured** identity — essentially a
`.md.yaml`: YAML frontmatter with three fields and little or no prose. All
skills and agents nearby are treated as artifacts of that bundle and displayed
together in the catalog.

```markdown
---
name: Web Team                # human label
description: Fullstack web…    # short, concise summary
owner: AIRUN                   # practice, project, team, or group of people
---

See [`README.md`](README.md) for the roster, install steps, and how the team works.
```

`BUNDLE.md` and `README.md` sit side by side, with distinct jobs:

- **`BUNDLE.md`** — structured info the catalog parses directly (name,
  description, owner).
- **`README.md`** — the human/LLM-readable front-door doc (roster, install,
  how it works); the catalog can generate a richer summary from it.
- **`bundle.json`** — the install manifest that drives `init.mjs`.

The descriptor carries no install config.

## `bundle.json` schema

```jsonc
{
  "id": "feature-development",              // must match the directory name
  "title": "Feature Development",           // human label
  "description": "...",                      // one-line summary
  "agents": ["scout", "ba", "..."],          // agents to install (resolved from this bundle's agents/ dir or the orphan top-level)
  "skills": [],                              // team-wide extra skills beyond what agents pull
  "briefings": {                             // role → briefing file (behavior overlay)
    "qa-engineer": "briefings/qa-engineer.md"
  },
  "skillOverlays": {                         // role → capability overlay (optional)
    "qa-engineer": { "add": ["xcuitest"], "remove": ["playwright-testing"] }
  },
  "seed": { "knowledge": ".agents/manual-qa/knowledge" }, // optional, bundle-relative src → project-relative dest
  "instructions": "instructions.md",         // optional, relative path
  "hooks": "hooks/hooks.json",               // optional, relative path
  "localAgents": [],                         // agents this bundle owns (under bundles/<id>/agents/)
  "localSkills": [],                         // skills this bundle owns (under bundles/<id>/skills/; no skills.json entry needed)
  "targets": ["claude"]                      // IDE targets that get HOOKS (agents/skills/briefings install everywhere)
}
```

## Install behavior (`bin/init.mjs`)

1. **Resolve** — read `bundles/<id>/bundle.json`; merge `agents[]` into the
   agent install list (existing logic auto-pulls each agent's declared
   skills); append `skills[]`; install `localAgents` from
   `bundles/<id>/agents/`; install `localSkills` from
   `bundles/<id>/skills/` like monorepo skills. A `localSkills` id satisfies
   any agent in the bundle that declares it in `skills:` frontmatter, with no
   `skills.json` entry needed — the description is read from each
   `SKILL.md` so non-Claude targets still get a populated SKILLS section.
2. **Briefings** — write each `briefings/<role>.md` to
   `.agents/memory/<role>/project_briefing.md` and add a `MEMORY.md` index
   line. Skip if a `project_briefing.md` already exists (scout may have
   written one) unless `--update`.
2a. **Seed files** — `seed` maps a bundle-relative source → a project-relative
   dest; copied into the project once at install (idempotent; `--update` does a
   clean replace). Use for reference docs agents read at runtime (a subagent's
   cwd is the project root). Example:
   `"seed": { "knowledge": ".agents/manual-qa/knowledge" }`.
2b. **Skill overlays** — for each `skillOverlays[<role>]`, rewrite the
   *installed* agent's `skills:` frontmatter to `(declared − remove) + add`.
   The install union is recomputed from the effective sets: a `remove`d skill
   no remaining agent needs isn't installed; `add`ed skills that resolve are
   installed; `add`s not yet in the catalog are reported as **pending content**
   (the role's frontmatter only lists skills that actually exist). The bundle's
   source agent is never modified — only the installed copy is tuned.
3. **Instructions** — splice `instructions.md` into root context files
   inside `<!-- BUNDLE:<id> START -->` / `<!-- BUNDLE:<id> END -->` markers.
   Re-running replaces the marked block in place — idempotent, no `--update`
   needed. `AGENTS.md` (the full team reference every agent reads) is created
   if missing; `CLAUDE.md` is auto-loaded and scout-owned (kept lean), so its
   block is only refreshed when the file already exists — never created.
   When scout later regenerates `AGENTS.md`/`CLAUDE.md`, the
   `seeding-a-project` skill preserves `<!-- BUNDLE:* -->` blocks verbatim, so
   a bundle's conventions survive onboarding.
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
  `<target>/hooks/<bundle-id>/` and `chmod +x` — reference them in commands
  via `$CLAUDE_PROJECT_DIR/<target-dir>/hooks/<bundle-id>/<script>`.
- Each injected matcher-group is tagged with `"_bundle": "<id>"`. On
  re-merge the installer drops only groups tagged with this bundle's id and
  re-appends the current ones — so the user's hooks and other bundles'
  hooks are preserved (merge-not-clobber), and re-running is idempotent.
- `settings.json` is backed up to `settings.json.bak` before any change. If
  it fails to parse, it's left untouched and the merge is skipped.

The `feature-development` bundle does not ship hooks yet — the merge
machinery is in place; concrete hooks (format-on-edit, etc.) come later.

## Idempotency & validation

- Marked instruction blocks and tagged hook entries make re-install a
  no-op (or a clean refresh with `--update`) and allow clean removal.
- **`npm run validate:bundles`** (`bin/validate-bundles.mjs`, run in CI via
  `.github/workflows/validate.yml`) checks each bundle: dir name matches
  `id`, a `README.md` exists, a `BUNDLE.md` exists with non-empty
  `name`/`description`/`owner` frontmatter, `agents[]` is non-empty and every entry exists
  under `bundles/<id>/agents/`, every `briefings` role is in `agents[]` and its file
  exists, every `skills[]` id resolves in `skills.json`/`bundles/<id>/skills/`,
  `instructions` (if set) exists, `hooks` (if set) parses, each
  `localAgents` entry has an `AGENT.md`, each `localSkills` entry has a
  `SKILL.md`, and every `seed` source path exists.
- A bundle may have an empty `agents` array if it provides `localAgents` —
  a fully self-contained team (e.g. `manual-qa`).

## Current bundles

| id | team | dev roles |
|---|---|---|
| `feature-development` | cross-platform (web + iOS) | pick any of `python-dev`, `js-dev`, `test-automation-engineer`, `ios-dev`; core roles auto-tune |
| `manual-qa` | manual QA for web | 6 local agents: `app-profiler`, `test-sizer`, `test-author`, `test-run-lead`, `test-runner`, `test-reporter` |
| `test-automation` | TMS-driven automation pipeline | `test-automation-lead` orchestrates `qa-engineer` + `test-automation-engineer` |

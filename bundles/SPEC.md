# Bundle spec

A **bundle** is a named, installable AI-team preset. It sits one layer
above agents: instead of hand-listing roles
(`--agents scout,ba,tech-lead,…`), you install a curated team in one shot:

```bash
npx github:arozumenko/sdlc-skills init --bundle team-web
```

A bundle composes five things:

| Layer | Where it comes from |
|---|---|
| **Agents** | selected from the shared `agents/` dir (the bundle picks a set) |
| **Skills** | auto-pulled from each agent's `skills:` frontmatter, plus any team-wide extras the bundle declares |
| **Instructions** | a team-level guidance file the bundle ships |
| **Briefings** | per-role *stack overlays* the bundle seeds into each role's memory |
| **Hooks** | IDE automation (Claude `settings.json`), v1 Claude-only |

## Why overlays, not forked agents

Most agents are **stack-agnostic and adapt at runtime**. Scout detects the
stack and tunes roles; `ba`, `project-manager`, and `personal-assistant`
read `.agents/` context. The stack-specific agent *is* the dev role
(`python-dev` vs `js-dev` vs `ios-dev`) — there is no "scout for iOS"
distinct from "scout for web", only one scout producing different output.

So a bundle does **not** copy agents. Where a shared agent needs a stack
flavor (e.g. `qa-engineer` should know XCTest for iOS but Playwright for
web), the bundle ships a thin **briefing overlay** — a per-role file
installed into `.agents/memory/<role>/project_briefing.md`, the exact slot
scout fills at runtime. One source of truth per agent; no drift across
bundles. A bundle-local agent that genuinely doesn't exist globally is
still possible via `localAgents` (an escape hatch, rarely needed).

## Directory layout

```
bundles/<id>/
├── bundle.json              required — the manifest
├── README.md                required — the team's front-door doc (roster, install, how it works)
├── instructions.md          optional — team-level guidance
├── briefings/
│   └── <role>.md            optional — per-role stack overlay
│                            → .agents/memory/<role>/project_briefing.md
├── hooks/                   optional — Claude settings.json automation
│   ├── hooks.json            hook config fragment (event → command)
│   └── scripts/              scripts the hooks invoke (chmod +x on install)
└── agents/                  optional — bundle-local roles (escape hatch)
    └── <name>/               installed like a global agent (AGENT.md + SOUL.md)
```

## `bundle.json` schema

```jsonc
{
  "id": "team-web",                         // must match the directory name
  "title": "Web Team",                      // human label
  "description": "...",                      // one-line summary
  "agents": ["scout", "ba", "..."],          // shared agents to install (resolved against agents/)
  "skills": [],                              // team-wide extra skills beyond what agents pull
  "briefings": {                             // role → briefing file (relative path)
    "qa-engineer": "briefings/qa-engineer.md"
  },
  "instructions": "instructions.md",         // optional, relative path
  "hooks": "hooks/hooks.json",               // optional, relative path
  "localAgents": [],                         // optional bundle-local roles in agents/
  "targets": ["claude"]                      // IDE targets that get HOOKS (agents/skills/briefings install everywhere)
}
```

## Install behavior (`bin/init.mjs`)

1. **Resolve** — read `bundles/<id>/bundle.json`; merge `agents[]` into the
   agent install list (existing logic auto-pulls each agent's declared
   skills); append `skills[]`; install `localAgents` from
   `bundles/<id>/agents/` like global agents.
2. **Briefings** — write each `briefings/<role>.md` to
   `.agents/memory/<role>/project_briefing.md` and add a `MEMORY.md` index
   line. Skip if a `project_briefing.md` already exists (scout may have
   written one) unless `--update`.
3. **Instructions** — splice `instructions.md` into root context files
   inside `<!-- BUNDLE:<id> START -->` / `<!-- BUNDLE:<id> END -->` markers.
   Re-running replaces the marked block in place — idempotent, no `--update`
   needed. `AGENTS.md` (the full team reference every agent reads) is created
   if missing; `CLAUDE.md` is auto-loaded and scout-owned (kept lean), so its
   block is only refreshed when the file already exists — never created.
   When scout later regenerates `AGENTS.md`/`CLAUDE.md`, the
   `project-seeder` skill preserves `<!-- BUNDLE:* -->` blocks verbatim, so
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
        { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/team-web/format.sh" }
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

Neither seed bundle (`team-web`, `team-ios`) ships hooks yet — the merge
machinery is in place; concrete hooks (format-on-edit, etc.) come later.

## Idempotency & validation

- Marked instruction blocks and tagged hook entries make re-install a
  no-op (or a clean refresh with `--update`) and allow clean removal.
- **`npm run validate:bundles`** (`bin/validate-bundles.mjs`, run in CI via
  `.github/workflows/validate.yml`) checks each bundle: dir name matches
  `id`, a `README.md` exists, `agents[]` is non-empty and every entry exists
  under `agents/`, every `briefings` role is in `agents[]` and its file
  exists, every `skills[]` id resolves in `skills.json`/`skills/`,
  `instructions` (if set) exists, `hooks` (if set) parses, and each
  `localAgents` entry has an `AGENT.md`.

## Current bundles

| id | team | dev roles |
|---|---|---|
| `team-web` | fullstack web | `python-dev` (backend) + `js-dev` (frontend) |
| `team-ios` | iOS | `ios-dev` |

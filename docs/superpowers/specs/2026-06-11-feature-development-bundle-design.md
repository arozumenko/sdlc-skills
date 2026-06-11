# Feature Development bundle — merge `team-web` + `team-ios` design

**Date:** 2026-06-11
**Status:** approved (design)

## Problem

`team-web` and `team-ios` are two near-identical bundles. Their shared roles
(`scout`, `ba`, `project-manager`, `tech-lead`, `qa-engineer`) have **byte-identical
`AGENT.md` bodies** across both bundles — the only differences are:

1. **Dev roles** — web: `python-dev`, `js-dev`, `test-automation-engineer`;
   iOS: `ios-dev`.
2. **Briefings** — per-stack overlays for `scout`, `tech-lead`, `qa-engineer`
   (and web-only `python-dev`, `test-automation-engineer`).
3. **skillOverlays** — per-stack `add`/`remove` for `tech-lead`, `qa-engineer`,
   and the dev roles.

All stack-specificity therefore lives **purely in the overlay layer**, never in
the agents. Maintaining two bundles duplicates everything for no benefit, and a
new user onboarding must know which bundle to pick before they understand the
roles.

## Goal

One bundle — **`feature-development`** (title "Feature Development") — that
replaces both. On install the user **picks which developer roles they need**;
the shared core roles always install and **auto-tune to the picked stack(s)**
via the existing briefing + skillOverlay machinery. No forked agents (honors the
overlay-not-fork model in `bundles/SPEC.md`).

## Decisions (locked during brainstorming)

- **Approach: overlay-driven**, not forked stack roles. Canonical `qa-engineer` /
  `tech-lead` stay single agents; the picked stack drives their overlay.
- **Selection UX: interactive checkbox picker** of dev roles, grouped by stack.
- **Non-interactive (`--yes` / no TTY): install all dev roles.**
  `--agents <subset>` overrides the menu for scripted installs.
- **Old bundles deleted outright** (`team-web`, `team-ios`); no back-compat alias.
- **Scope: web + iOS only.** `manual-qa` and `test-automation` are untouched.

## Roster

| Tier | Roles |
|---|---|
| **Core (always installed)** | `scout`, `ba`, `project-manager`, `tech-lead`, `qa-engineer` |
| **Web stack (selectable)** | `python-dev`, `js-dev`, `test-automation-engineer` |
| **iOS stack (selectable)** | `ios-dev` |

All nine are bundle-local mirrors (real copies synced from canonical
`agents/<name>/`), declared in `localAgents` exactly as today.

## `bundle.json` schema (additive, backward compatible)

Two new optional keys. Bundles **without** a `stacks` key (`manual-qa`,
`test-automation`) keep today's behavior unchanged — the picker/merge path only
activates when `stacks` is present.

```jsonc
{
  "id": "feature-development",
  "title": "Feature Development",
  "description": "Cross-platform delivery team — pick your stack(s): web (JS/TS + Python) and/or iOS (Swift/SwiftUI). Shared core roles auto-tune to the stacks you choose.",
  "agents": [],
  "coreAgents": ["scout", "ba", "project-manager", "tech-lead", "qa-engineer"],
  "stacks": {
    "web": {
      "label": "Web — JS/TS frontend + Python backend",
      "devRoles": ["python-dev", "js-dev", "test-automation-engineer"],
      "briefings": {
        "scout": "briefings/web/scout.md",
        "tech-lead": "briefings/web/tech-lead.md",
        "qa-engineer": "briefings/web/qa-engineer.md",
        "python-dev": "briefings/web/python-dev.md",
        "test-automation-engineer": "briefings/web/test-automation-engineer.md"
      },
      "skillOverlays": {
        "tech-lead": { "add": ["fastapi", "fastmcp-server", "vercel-react-best-practices"] },
        "python-dev": { "add": ["fastapi", "fastmcp-server"] },
        "js-dev": { "add": ["vercel-react-best-practices"] }
      }
    },
    "ios": {
      "label": "iOS — Swift/SwiftUI",
      "devRoles": ["ios-dev"],
      "briefings": {
        "scout": "briefings/ios/scout.md",
        "tech-lead": "briefings/ios/tech-lead.md",
        "qa-engineer": "briefings/ios/qa-engineer.md"
      },
      "skillOverlays": {
        "tech-lead": { "add": ["swiftui-pro", "swiftdata-pro", "swift-testing-pro", "swift-concurrency-pro"] },
        "qa-engineer": {
          "add": ["swift-testing-pro", "environment-setup-xcuitest", "xcuitest-real-device-config", "appium-troubleshooting"],
          "remove": ["playwright-testing", "playwright-cli", "browser-verify"]
        }
      }
    }
  },
  "localSkills": ["browser-verify", "bugfix-workflow", "code-review", "completing-a-task", "git-workflow", "implement-feature", "issue-tracking", "memory", "plan-feature", "playwright-testing", "reproducing-issues", "root-cause-analysis", "seeding-a-project", "session-retrospective", "test-automation-workflow", "test-case-analysis"],
  "localAgents": ["scout", "ba", "project-manager", "tech-lead", "qa-engineer", "python-dev", "js-dev", "test-automation-engineer", "ios-dev"],
  "instructions": "instructions.md",
  "targets": ["claude"]
}
```

- `localAgents` lists the **full roster** → `sync-bundles` mirroring and the
  "every localAgent has an `AGENT.md`" validation are untouched.
- `coreAgents` + `stacks.*.devRoles` are selection metadata that reference names
  already in `localAgents`.
- `localSkills` = union of both old bundles (web's list is already a superset
  of iOS's). Stack-specific skills added by overlays (`fastapi`, `swiftui-pro`,
  …) resolve from the global catalog, not `localSkills`, exactly as today.

## Briefing layout

Per-stack briefings move under a stack subdirectory:

```
bundles/feature-development/briefings/
├── web/
│   ├── scout.md
│   ├── tech-lead.md
│   ├── qa-engineer.md
│   ├── python-dev.md
│   └── test-automation-engineer.md
└── ios/
    ├── scout.md
    ├── tech-lead.md
    └── qa-engineer.md
```

Content is copied verbatim from the existing `team-web/briefings/*` and
`team-ios/briefings/*` (these already differ per stack and need no rewrite).

## Selection & overlay-merge semantics (installer)

When `bundle.stacks` is present, `applyBundle` does the following **before** the
existing install path:

1. **Resolve selected dev roles.**
   - Interactive TTY and no `--agents` → checkbox picker (reuse the raw-mode
     `pickMenu` already in `init.mjs`), dev roles grouped by `stack.label`.
   - `--agents <subset>` → use as the explicit dev-role selection (intersected
     with the bundle's dev roles; unknown names warn).
   - Non-TTY or `--yes` → select **all** dev roles.
2. **Compute selected stacks** = every stack that owns ≥1 selected dev role.
3. **Install roster** = `coreAgents ∪ selectedDevRoles` (installed as
   `localAgents` from the bundle dir). Dev roles for unselected stacks are not
   installed.
4. **Merge overlays** from the selected stacks into the effective
   `bundle.briefings` and `bundle.skillOverlays`, then fall through to the
   unchanged install logic (skill-union recompute, frontmatter rewrite, briefing
   seeding).

### skillOverlay merge rule (role targeted by ≥1 selected stack)

- **One stack selected** → apply that stack's `{add, remove}` verbatim.
- **Multiple stacks selected** → `add` = union of all stacks' adds; **`remove`
  is dropped** (a cross-platform install wants the superset, e.g. web+iOS keeps
  `playwright-*`/`browser-verify` *and* gains the iOS testing skills).

This is simple and predictable; the existing "install union recomputed from
effective sets" then keeps an iOS-only install from pulling web-only skills.

### Briefing merge rule (role with per-stack briefings)

- **One stack** → seed that stack's briefing file as
  `.agents/memory/<role>/project_briefing.md`.
- **Multiple stacks** → concatenate the per-stack briefing bodies under
  `## <Stack label> stack` headers into the single `project_briefing.md`.

Skip-if-exists / `--update` behavior is unchanged.

## Instructions

A single merged, stack-neutral `instructions.md` describing the cross-platform
team (spliced into `AGENTS.md`/`CLAUDE.md` inside
`<!-- BUNDLE:feature-development -->` markers as today). Stack nuances live in
the briefings, not instructions.

## Validation (`bin/validate-bundles.mjs`)

Add checks, only when `stacks`/`coreAgents` are present:

- Every `coreAgents` entry and every `stacks.*.devRoles` entry exists in
  `localAgents`.
- Every stack briefing file path exists on disk.
- Every `skillOverlays` target (per stack) is in `coreAgents ∪ devRoles`.
- Every stack `devRoles` skill `add` resolves in the catalog or is reported
  pending (reuse existing overlay resolution).

`sync-bundles.mjs` needs **no change** (mirrors by `localAgents`/`localSkills`).
`gen-marketplaces.mjs` needs **no change** (it does not enumerate bundles).

## Files

**New:** `bundles/feature-development/` — `BUNDLE.md`, `README.md`, `bundle.json`,
`instructions.md`, `briefings/{web,ios}/*.md`, mirrored `agents/<9 roles>/`,
mirrored `skills/<localSkills>/`.

**Deleted:** `bundles/team-web/`, `bundles/team-ios/`.

**Edited:**
- `bin/init.mjs` — stacks-aware `applyBundle` + dev-role picker.
- `bin/validate-bundles.mjs` — stacks/coreAgents validation.
- `bundles/SPEC.md` — "Current bundles" table + a stacks subsection.
- `README.md`, `CLAUDE.md`, `MAINTENANCE.md` — catalog references.
- `agents/python-dev/README.md`, `agents/js-dev/README.md`,
  `agents/ios-dev/README.md` — bundle references.

Historical specs/plans under `docs/superpowers/` keep their old `team-web`/
`team-ios` references (they are point-in-time records).

## Testing

- Unit tests for the new resolution helper(s): stack derivation from selected
  dev roles; skillOverlay merge (single vs multi stack, remove-drop on multi);
  briefing merge (single vs concatenated).
- Installer smoke test against a throwaway dir:
  `node bin/init.mjs init --bundle feature-development --target claude --yes`
  (all roles) and `--agents ios-dev --yes` (iOS only — confirm `playwright-*`
  not installed, `qa-engineer` frontmatter carries the iOS skills).
- `npm run validate` (bundles + marketplaces) and `npm test` green.

## Out of scope

- Folding in `test-automation` or `manual-qa`.
- Hooks (neither old bundle ships any).
- Back-compat aliases for `--bundle team-web` / `--bundle team-ios`.

# Feature Development bundle — merge `team-web` + `team-ios` design

**Date:** 2026-06-11
**Status:** approved (design)

## Problem

`team-web` and `team-ios` are two near-identical bundles. Their shared roles
(`scout`, `ba`, `project-manager`, `tech-lead`, `qa-engineer`) have **byte-identical
`AGENT.md` bodies** across both bundles — the only differences are:

1. **Dev roles** — web: `python-dev`, `js-dev`, `test-automation-engineer`;
   iOS: `ios-dev`.
2. **Briefings** — per-platform overlays for `scout`, `tech-lead`, `qa-engineer`
   (and web-only `python-dev`, `test-automation-engineer`).
3. **skillOverlays** — per-platform `add`/`remove` for `tech-lead`,
   `qa-engineer`, and the dev roles.

All platform-specificity therefore lives **purely in the overlay layer**, never
in the agents. Maintaining two bundles duplicates everything for no benefit, and
a new user onboarding must pick a whole bundle before they understand the roles.

## Goal

One bundle — **`feature-development`** (title "Feature Development") — that
replaces both. On install the user picks **any combination of developer roles**
they need (no stack/platform restriction — e.g. a JS backend dev plus an iOS
frontend dev is fine). The shared core roles always install and **auto-tune to
whatever dev roles were picked**, via the existing briefing + skillOverlay
machinery. No forked agents (honors the overlay-not-fork model in
`bundles/SPEC.md`).

## Decisions (locked during brainstorming)

- **Approach: overlay-driven**, not forked roles. Canonical `qa-engineer` /
  `tech-lead` stay single agents; the picked dev roles drive their overlay.
- **Selection UX: a single flat, unrestricted checkbox list of dev roles.** Pick
  any subset / any combination. There is **no** "choose a stack" step — platform
  is an internal tag, never a user-facing constraint.
- **Non-interactive (`--yes` / no TTY): install all dev roles.**
  `--agents <subset>` overrides the menu for scripted installs.
- **Old bundles deleted outright** (`team-web`, `team-ios`); no back-compat alias.
- **Scope: web + iOS only.** `manual-qa` and `test-automation` are untouched.

## Roster

| Tier | Roles | Notes |
|---|---|---|
| **Core (always installed)** | `scout`, `ba`, `project-manager`, `tech-lead`, `qa-engineer` | single canonical agents, auto-tuned |
| **Dev roles (free multi-select)** | `python-dev`, `js-dev`, `test-automation-engineer`, `ios-dev` | pick any combination |

All nine are bundle-local mirrors (real copies synced from canonical
`agents/<name>/`), declared in `localAgents` exactly as today. Each dev role
carries an internal `platform` tag (`web` or `ios`) used only to decide which
shared-role tuning to apply — it never restricts what the user can pick.

## Why a `platform` tag still exists (and why it doesn't bundle anything)

Dev roles each bring **their own** briefing/skillOverlay (e.g. `python-dev` adds
`fastapi`; `ios-dev` adds `swiftui-pro`). Those attach to the dev role directly
and need no grouping.

But the **shared roles'** stack guidance is genuinely platform-level, not owned
by any single dev role: the iOS `tech-lead`/`qa-engineer` briefing is the same
regardless of whether you picked `ios-dev` specifically, and the web
`tech-lead`/`qa-engineer` briefing is shared by `python-dev`, `js-dev`, and
`test-automation-engineer`. So each dev role is tagged with the platform whose
shared-role tuning it implies. Picking **any** dev role of a platform activates
that platform's shared-role tuning; picking dev roles from both platforms
activates both (merged — see below). The user still selects freely; the tag is
just how a selection maps onto `tech-lead`/`qa-engineer`/`scout` tuning.

## `bundle.json` schema (additive, backward compatible)

Three new optional keys: `coreAgents`, `devRoles`, `platforms`. Bundles
**without** a `devRoles`/`platforms` key (`manual-qa`, `test-automation`) keep
today's behavior unchanged — the picker/merge path only activates when
`devRoles` is present.

```jsonc
{
  "id": "feature-development",
  "title": "Feature Development",
  "description": "Cross-platform delivery team — pick any combination of developer roles. Shared core roles auto-tune to whatever you pick.",
  "agents": [],

  // Always installed, single canonical agents.
  "coreAgents": ["scout", "ba", "project-manager", "tech-lead", "qa-engineer"],

  // The flat, unrestricted pick-list. Each entry: a label, the platform tag,
  // and (optional) the role's OWN briefing + skillOverlay.
  "devRoles": {
    "python-dev": {
      "label": "Python backend",
      "platform": "web",
      "briefing": "briefings/roles/python-dev.md",
      "skillOverlay": { "add": ["fastapi", "fastmcp-server"] }
    },
    "js-dev": {
      "label": "JS/TS frontend",
      "platform": "web",
      "skillOverlay": { "add": ["vercel-react-best-practices"] }
    },
    "test-automation-engineer": {
      "label": "Test automation (E2E)",
      "platform": "web",
      "briefing": "briefings/roles/test-automation-engineer.md"
    },
    "ios-dev": {
      "label": "iOS — Swift/SwiftUI",
      "platform": "ios"
    }
  },

  // Shared-role (core) tuning, keyed by platform. Applied when ANY selected dev
  // role carries that platform tag. Merged across platforms when the selection
  // spans both (see merge rules).
  "platforms": {
    "web": {
      "briefings": {
        "scout": "briefings/web/scout.md",
        "tech-lead": "briefings/web/tech-lead.md",
        "qa-engineer": "briefings/web/qa-engineer.md"
      },
      "skillOverlays": {
        "tech-lead": { "add": ["fastapi", "fastmcp-server", "vercel-react-best-practices"] }
      }
    },
    "ios": {
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
- `coreAgents` + `devRoles` keys reference names already in `localAgents`.
- `localSkills` = union of both old bundles (web's list is already a superset of
  iOS's). Stack-specific skills added by overlays (`fastapi`, `swiftui-pro`, …)
  resolve from the global catalog, not `localSkills`, exactly as today.

## Briefing layout

```
bundles/feature-development/briefings/
├── web/                       # shared-role tuning, platform = web
│   ├── scout.md
│   ├── tech-lead.md
│   └── qa-engineer.md
├── ios/                       # shared-role tuning, platform = ios
│   ├── scout.md
│   ├── tech-lead.md
│   └── qa-engineer.md
└── roles/                     # individual dev-role briefings
    ├── python-dev.md
    └── test-automation-engineer.md
```

Content is copied verbatim from the existing `team-web/briefings/*` and
`team-ios/briefings/*` (these already differ and need no rewrite). The web
`scout`/`tech-lead`/`qa-engineer` briefings go under `web/`; the iOS ones under
`ios/`; the dev-role-specific web briefings (`python-dev`,
`test-automation-engineer`) go under `roles/`.

## Selection & overlay-merge semantics (installer)

When `bundle.devRoles` is present, `applyBundle` does the following **before**
the existing install path:

1. **Resolve selected dev roles.**
   - Interactive TTY and no `--agents` → flat checkbox picker (reuse the
     raw-mode `pickMenu` already in `init.mjs`) listing every `devRoles` entry
     by its `label`. Any combination is selectable; nothing is pre-grouped.
   - `--agents <subset>` → use as the explicit dev-role selection (intersected
     with the bundle's dev roles; unknown names warn).
   - Non-TTY or `--yes` → select **all** dev roles.
2. **Install roster** = `coreAgents ∪ selectedDevRoles` (installed as
   `localAgents` from the bundle dir). Unselected dev roles are not installed.
3. **Per-dev-role tuning** — for each selected dev role, apply its own
   `briefing` and `skillOverlay` (if present) to that role.
4. **Active platforms** = the set of `platform` tags across selected dev roles.
   For each active platform, fold its `platforms.<p>.briefings` and
   `platforms.<p>.skillOverlays` onto the **core** roles, using the merge rules
   below.
5. Fall through to the unchanged install logic (skill-union recompute,
   frontmatter rewrite, briefing seeding).

### skillOverlay merge rule (a core role tuned by ≥1 active platform)

- `add` = **union** of every active platform's adds for that role.
- `remove` = a skill is removed **only if every active platform also removes it**
  (intersection), and it is not in the merged `add`. A platform with no overlay
  for the role contributes an empty remove set, so any second active platform
  suppresses the removal.
  - iOS only → `qa-engineer` removes `playwright-*`/`browser-verify` (pure iOS).
  - web + iOS → web contributes ∅ removes for `qa-engineer`, so the intersection
    is empty: `qa-engineer` **keeps** `playwright-*` **and gains** the iOS
    testing skills. (Matches "JS front + iOS" wanting both.)

### Briefing merge rule (a core role with per-platform briefings)

- **One active platform** → seed that platform's briefing file as
  `.agents/memory/<role>/project_briefing.md`.
- **Both active** → concatenate the per-platform briefing bodies under
  `## <Platform> stack` headers into the single `project_briefing.md`.

Skip-if-exists / `--update` behavior is unchanged.

## Instructions

A single merged, platform-neutral `instructions.md` describing the
cross-platform team (spliced into `AGENTS.md`/`CLAUDE.md` inside
`<!-- BUNDLE:feature-development -->` markers as today). Platform nuances live in
the briefings, not instructions.

## Validation (`bin/validate-bundles.mjs`)

Add checks, only when `devRoles`/`platforms`/`coreAgents` are present:

- Every `coreAgents` entry and every `devRoles` key exists in `localAgents`.
- Every `devRoles.<r>.platform` is a key in `platforms`.
- Every briefing file referenced (per-role and per-platform) exists on disk.
- Every `skillOverlays` target under a platform is a `coreAgents` role; every
  `devRoles.<r>.skillOverlay` targets that dev role.
- Each overlay `add` resolves in the catalog or is reported pending (reuse
  existing overlay resolution).

`sync-bundles.mjs` needs **no change** (mirrors by `localAgents`/`localSkills`).
`gen-marketplaces.mjs` needs **no change** (it does not enumerate bundles).

## Files

**New:** `bundles/feature-development/` — `BUNDLE.md`, `README.md`, `bundle.json`,
`instructions.md`, `briefings/{web,ios,roles}/*.md`, mirrored `agents/<9 roles>/`,
mirrored `skills/<localSkills>/`.

**Deleted:** `bundles/team-web/`, `bundles/team-ios/`.

**Edited:**
- `bin/init.mjs` — `devRoles`/`platforms`-aware `applyBundle` + flat dev-role
  picker.
- `bin/validate-bundles.mjs` — `devRoles`/`platforms`/`coreAgents` validation.
- `bundles/SPEC.md` — "Current bundles" table + a `devRoles`/`platforms`
  subsection.
- `README.md`, `CLAUDE.md`, `MAINTENANCE.md` — catalog references.
- `agents/python-dev/README.md`, `agents/js-dev/README.md`,
  `agents/ios-dev/README.md` — bundle references.

Historical specs/plans under `docs/superpowers/` keep their old `team-web`/
`team-ios` references (they are point-in-time records).

## Testing

- Unit tests for the new resolution helper(s): active-platform derivation from
  selected dev roles; skillOverlay merge (single vs both platforms, remove
  suppression when both active); briefing merge (single vs concatenated).
- Installer smoke test against a throwaway dir:
  `node bin/init.mjs init --bundle feature-development --target claude --yes`
  (all roles) and `--agents ios-dev --yes` (iOS only — confirm `playwright-*`
  not installed, `qa-engineer` frontmatter carries the iOS skills) and
  `--agents js-dev,ios-dev --yes` (mixed — confirm `qa-engineer` keeps
  `playwright-*` and gains the iOS skills).
- `npm run validate` (bundles + marketplaces) and `npm test` green.

## Out of scope

- Folding in `test-automation` or `manual-qa`.
- Hooks (neither old bundle ships any).
- Back-compat aliases for `--bundle team-web` / `--bundle team-ios`.

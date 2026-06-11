# Feature Development bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `team-web` and `team-ios` bundles with one
`feature-development` bundle whose interactive installer lets the user pick any
combination of developer roles; shared core roles always install and auto-tune
to the picked platform(s) via the existing briefing + skillOverlay machinery.

**Architecture:** A new bundle dir declares a full 9-agent roster (mirrored from
canonical `agents/`) plus three new manifest keys — `coreAgents` (always
installed), `devRoles` (flat pick-list, each tagged with an internal `platform`),
and `platforms` (shared-role tuning). Pure, unit-tested helper functions resolve
a dev-role selection into an install roster + merged skillOverlays + merged
briefings; `bin/init.mjs` wires them in via the existing raw-mode `selectMany`
picker and the unchanged overlay/skill-union resolution. No agents are forked.

**Tech Stack:** Plain ESM Node (`.mjs`, stdlib only), `node --test`, the
repo's bundle installer (`bin/init.mjs`), validator (`bin/validate-bundles.mjs`),
and mirror sync (`bin/sync-bundles.mjs`).

---

## File structure

| File | Responsibility |
|---|---|
| `bin/lib/bundle-selection.mjs` (new) | Pure, I/O-free helpers: active-platform derivation, skillOverlay merge, briefing plan/compose, selection resolution. |
| `bin/lib/bundle-selection.test.mjs` (new) | Unit tests for every helper. |
| `bin/no-tools-frontmatter.test.mjs` (new) | Repo-wide guard: no `AGENT.md` may declare a `tools:` frontmatter key. |
| `bundles/feature-development/bundle.json` (new) | Manifest with `coreAgents`/`devRoles`/`platforms`. |
| `bundles/feature-development/{BUNDLE.md,README.md,instructions.md}` (new) | Catalog descriptor, front-door doc, merged team instructions. |
| `bundles/feature-development/briefings/{web,ios,roles}/*.md` (new) | Per-platform + per-dev-role briefing overlays. |
| `bundles/feature-development/{agents,skills}/**` (generated) | Real mirrors produced by `sync-bundles`. |
| `bin/init.mjs` (modify) | `applyBundle` becomes async + `devRoles`-aware; `installBriefings` consumes resolved briefings. |
| `bin/validate-bundles.mjs` (modify) | Validate `coreAgents`/`devRoles`/`platforms`. |
| `bundles/SPEC.md`, `README.md`, `CLAUDE.md`, `MAINTENANCE.md`, `agents/{python,js,ios}-dev/README.md` (modify) | Catalog references. |
| `bundles/team-web/`, `bundles/team-ios/` (delete) | Superseded. |

---

## Task 1: Pure selection/merge helper module

**Files:**
- Create: `bin/lib/bundle-selection.mjs`
- Test: `bin/lib/bundle-selection.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `bin/lib/bundle-selection.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activePlatforms,
  resolveSelection,
  mergeCoreOverlay,
  buildOverlays,
  buildBriefingPlan,
  composeBriefing,
  briefingDescription,
} from "./bundle-selection.mjs";

const BUNDLE = {
  coreAgents: ["scout", "tech-lead", "qa-engineer"],
  devRoles: {
    "python-dev": { label: "Python backend", platform: "web", skillOverlay: { add: ["fastapi"] } },
    "js-dev": { label: "JS/TS frontend", platform: "web", skillOverlay: { add: ["vercel-react-best-practices"] } },
    "ios-dev": { label: "iOS", platform: "ios" },
  },
  platforms: {
    web: {
      label: "Web",
      briefings: { scout: "briefings/web/scout.md", "qa-engineer": "briefings/web/qa-engineer.md" },
      skillOverlays: { "tech-lead": { add: ["fastapi", "vercel-react-best-practices"] } },
    },
    ios: {
      label: "iOS",
      briefings: { scout: "briefings/ios/scout.md", "qa-engineer": "briefings/ios/qa-engineer.md" },
      skillOverlays: {
        "tech-lead": { add: ["swiftui-pro"] },
        "qa-engineer": { add: ["xcuitest-real-device-config"], remove: ["playwright-testing", "browser-verify"] },
      },
    },
  },
};

test("activePlatforms is unique and order-preserving", () => {
  assert.deepEqual(activePlatforms(BUNDLE.devRoles, ["js-dev", "python-dev"]), ["web"]);
  assert.deepEqual(activePlatforms(BUNDLE.devRoles, ["js-dev", "ios-dev"]), ["web", "ios"]);
  assert.deepEqual(activePlatforms(BUNDLE.devRoles, []), []);
});

test("resolveSelection: explicit splits known/unknown", () => {
  const r = resolveSelection({ explicit: ["ios-dev", "nope"], devRoleNames: Object.keys(BUNDLE.devRoles), yes: false, isTTY: true });
  assert.deepEqual(r, { mode: "explicit", roles: ["ios-dev"], unknown: ["nope"] });
});

test("resolveSelection: --yes or no TTY => all", () => {
  const names = Object.keys(BUNDLE.devRoles);
  assert.equal(resolveSelection({ explicit: null, devRoleNames: names, yes: true, isTTY: true }).mode, "all");
  assert.equal(resolveSelection({ explicit: null, devRoleNames: names, yes: false, isTTY: false }).mode, "all");
});

test("resolveSelection: TTY, no flags => picker", () => {
  const r = resolveSelection({ explicit: null, devRoleNames: Object.keys(BUNDLE.devRoles), yes: false, isTTY: true });
  assert.equal(r.mode, "picker");
  assert.equal(r.roles, null);
});

test("mergeCoreOverlay: single platform applies remove verbatim", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["ios"], "qa-engineer"), {
    add: ["xcuitest-real-device-config"],
    remove: ["playwright-testing", "browser-verify"],
  });
});

test("mergeCoreOverlay: web has no qa overlay => empty", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["web"], "qa-engineer"), { add: [], remove: [] });
});

test("mergeCoreOverlay: web+ios unions adds, suppresses removes (web contributes none)", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["web", "ios"], "qa-engineer"), {
    add: ["xcuitest-real-device-config"],
    remove: [],
  });
});

test("mergeCoreOverlay: tech-lead unions adds across platforms (deduped)", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["web", "ios"], "tech-lead"), {
    add: ["fastapi", "vercel-react-best-practices", "swiftui-pro"],
    remove: [],
  });
});

test("buildOverlays: dev-role own overlays + core platform overlays", () => {
  const ov = buildOverlays(BUNDLE, ["js-dev", "ios-dev"]);
  assert.deepEqual(ov["js-dev"], { add: ["vercel-react-best-practices"] });
  assert.deepEqual(ov["tech-lead"], { add: ["fastapi", "vercel-react-best-practices", "swiftui-pro"], remove: [] });
  assert.deepEqual(ov["qa-engineer"], { add: ["xcuitest-real-device-config"], remove: [] });
  assert.ok(!("scout" in ov)); // scout has no skillOverlay anywhere
});

test("buildBriefingPlan: one platform => single entry; two => concatenated entries", () => {
  const one = buildBriefingPlan(BUNDLE, ["python-dev"]);
  assert.deepEqual(one["scout"], [{ label: "Web", path: "briefings/web/scout.md" }]);
  const two = buildBriefingPlan(BUNDLE, ["js-dev", "ios-dev"]);
  assert.deepEqual(two["scout"], [
    { label: "Web", path: "briefings/web/scout.md" },
    { label: "iOS", path: "briefings/ios/scout.md" },
  ]);
});

test("composeBriefing: single => as-is; many => headered", () => {
  assert.equal(composeBriefing([{ label: "Web", content: "body" }]), "body");
  assert.equal(
    composeBriefing([{ label: "Web", content: "a" }, { label: "iOS", content: "b" }]),
    "## Web stack\n\na\n\n## iOS stack\n\nb"
  );
});

test("briefingDescription: first frontmatter description wins", () => {
  assert.equal(
    briefingDescription([{ label: "Web", content: "---\ndescription: web focus\n---\nbody" }]),
    "web focus"
  );
  assert.equal(briefingDescription([{ label: "Web", content: "no fm" }]), "Project overview and this role's focus");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test bin/lib/bundle-selection.test.mjs`
Expected: FAIL — `Cannot find module './bundle-selection.mjs'`.

- [ ] **Step 3: Implement the helpers**

Create `bin/lib/bundle-selection.mjs`:

```js
// Pure (I/O-free) helpers for resolving a feature-development-style bundle:
// a flat dev-role selection → install roster, merged skillOverlays, and merged
// briefing plans. Kept out of init.mjs so they unit-test without the CLI.
// Stdlib-only, no deps. File I/O (reading briefing files, drawing the picker)
// stays in init.mjs; these functions take already-known data and return plans.

/** Unique platform tags across the selected dev roles, in selection order. */
export function activePlatforms(devRoles, selected) {
  const out = [];
  for (const r of selected) {
    const p = devRoles[r] && devRoles[r].platform;
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Decide how dev roles get chosen, without doing any I/O.
 *  explicit: string[]|null (from --agents); devRoleNames: the bundle's dev roles. */
export function resolveSelection({ explicit, devRoleNames, yes, isTTY }) {
  if (explicit && explicit.length) {
    const roles = explicit.filter((r) => devRoleNames.includes(r));
    const unknown = explicit.filter((r) => !devRoleNames.includes(r));
    return { mode: "explicit", roles, unknown };
  }
  if (yes || !isTTY) return { mode: "all", roles: [...devRoleNames], unknown: [] };
  return { mode: "picker", roles: null, unknown: [] };
}

/** Merge one core role's skillOverlay across the active platforms.
 *  add = union; remove = intersection across active platforms, minus adds.
 *  A platform with no overlay for the role contributes an empty remove set,
 *  so any second active platform suppresses the removal. */
export function mergeCoreOverlay(platforms, active, role) {
  const add = [];
  const removeSets = [];
  for (const p of active) {
    const ov = (platforms[p] && platforms[p].skillOverlays && platforms[p].skillOverlays[role]) || {};
    for (const s of ov.add || []) if (!add.includes(s)) add.push(s);
    removeSets.push(new Set(ov.remove || []));
  }
  let remove = [];
  if (removeSets.length) remove = [...removeSets[0]].filter((s) => removeSets.every((set) => set.has(s)));
  remove = remove.filter((s) => !add.includes(s));
  return { add, remove };
}

/** Effective skillOverlays for the whole installed roster:
 *  each selected dev role's own overlay + each core role's platform-merged overlay. */
export function buildOverlays(bundle, selected) {
  const overlays = {};
  for (const r of selected) {
    const ov = bundle.devRoles[r] && bundle.devRoles[r].skillOverlay;
    if (ov && ((ov.add && ov.add.length) || (ov.remove && ov.remove.length))) overlays[r] = ov;
  }
  const active = activePlatforms(bundle.devRoles, selected);
  for (const role of bundle.coreAgents || []) {
    const m = mergeCoreOverlay(bundle.platforms || {}, active, role);
    if (m.add.length || m.remove.length) overlays[role] = m;
  }
  return overlays;
}

/** Which briefing file(s) feed each role's project_briefing.md.
 *  Returns { role: [{ label, path }] }; one entry = direct, many = concatenated. */
export function buildBriefingPlan(bundle, selected) {
  const plan = {};
  for (const r of selected) {
    const rel = bundle.devRoles[r] && bundle.devRoles[r].briefing;
    if (rel) plan[r] = [{ label: bundle.devRoles[r].label || r, path: rel }];
  }
  const active = activePlatforms(bundle.devRoles, selected);
  for (const role of bundle.coreAgents || []) {
    const entries = [];
    for (const p of active) {
      const pf = bundle.platforms[p];
      const rel = pf && pf.briefings && pf.briefings[role];
      if (rel) entries.push({ label: pf.label || p, path: rel });
    }
    if (entries.length) plan[role] = entries;
  }
  return plan;
}

/** Concatenate resolved briefing contents. One entry → as-is; many → headered. */
export function composeBriefing(entries) {
  if (entries.length === 1) return entries[0].content;
  return entries.map((e) => `## ${e.label} stack\n\n${e.content.trim()}`).join("\n\n");
}

/** First frontmatter description across resolved contents (for the MEMORY.md line). */
export function briefingDescription(entries) {
  for (const e of entries) {
    const m = e.content.match(/^description:\s*(.+)$/m);
    if (m) return m[1].trim();
  }
  return "Project overview and this role's focus";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test bin/lib/bundle-selection.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/bundle-selection.mjs bin/lib/bundle-selection.test.mjs
git commit -m "feat(bundles): pure dev-role selection + overlay/briefing merge helpers"
```

---

## Task 2: No-`tools:`-frontmatter guard test

**Files:**
- Create: `bin/no-tools-frontmatter.test.mjs`

- [ ] **Step 1: Write the test**

Create `bin/no-tools-frontmatter.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function findAgentMd(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findAgentMd(p, out);
    else if (e.name === "AGENT.md") out.push(p);
  }
  return out;
}

function frontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

test("no AGENT.md declares a tools: frontmatter key", () => {
  const offenders = findAgentMd(ROOT).filter((f) =>
    /^[ \t]{0,2}tools:/m.test(frontmatter(readFileSync(f, "utf8")))
  );
  assert.deepEqual(offenders, [], `tools: must not appear in agent frontmatter:\n${offenders.join("\n")}`);
});
```

- [ ] **Step 2: Run the test to verify it passes (tree already clean)**

Run: `node --test bin/no-tools-frontmatter.test.mjs`
Expected: PASS — current tree has zero `tools:` frontmatter keys.

- [ ] **Step 3: Sanity-check it actually catches a violation**

Temporarily add `tools: Read` under the frontmatter of `agents/scout/AGENT.md`,
re-run the test, confirm it FAILS listing that file, then revert the edit.

Run: `node --test bin/no-tools-frontmatter.test.mjs`
Expected: FAIL (then revert and re-run → PASS).

- [ ] **Step 4: Commit**

```bash
git add bin/no-tools-frontmatter.test.mjs
git commit -m "test(agents): guard against tools: in agent frontmatter"
```

---

## Task 3: Scaffold the `feature-development` bundle content

**Files:**
- Create: `bundles/feature-development/bundle.json`
- Create: `bundles/feature-development/BUNDLE.md`
- Create: `bundles/feature-development/README.md`
- Create: `bundles/feature-development/instructions.md`
- Create: `bundles/feature-development/briefings/{web,ios,roles}/*.md`
- Generated: `bundles/feature-development/{agents,skills}/**` (via sync)

- [ ] **Step 1: Write `bundle.json`**

Create `bundles/feature-development/bundle.json`:

```json
{
  "id": "feature-development",
  "title": "Feature Development",
  "description": "Cross-platform delivery team — pick any combination of developer roles. Shared core roles auto-tune to whatever you pick.",
  "agents": [],
  "coreAgents": ["scout", "ba", "project-manager", "tech-lead", "qa-engineer"],
  "devRoles": {
    "python-dev": {
      "label": "Python backend (FastAPI)",
      "platform": "web",
      "briefing": "briefings/roles/python-dev.md",
      "skillOverlay": { "add": ["fastapi", "fastmcp-server"] }
    },
    "js-dev": {
      "label": "JS/TS frontend (React)",
      "platform": "web",
      "skillOverlay": { "add": ["vercel-react-best-practices"] }
    },
    "test-automation-engineer": {
      "label": "Test automation (E2E / Playwright)",
      "platform": "web",
      "briefing": "briefings/roles/test-automation-engineer.md"
    },
    "ios-dev": {
      "label": "iOS — Swift/SwiftUI",
      "platform": "ios"
    }
  },
  "platforms": {
    "web": {
      "label": "Web",
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
      "label": "iOS",
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

- [ ] **Step 2: Write `BUNDLE.md`**

Create `bundles/feature-development/BUNDLE.md`:

```markdown
---
name: Feature Development
description: Cross-platform delivery team — pick any combination of developer roles (web JS/TS + Python, iOS Swift/SwiftUI). Shared core roles auto-tune to the stack you choose.
owner: AIRUN
---

See [`README.md`](README.md) for the roster, install steps, and how the team works.
```

- [ ] **Step 3: Copy the briefing files into the new layout**

Run (from repo root; both source bundles still exist at this point):

```bash
mkdir -p bundles/feature-development/briefings/web \
         bundles/feature-development/briefings/ios \
         bundles/feature-development/briefings/roles
cp bundles/team-web/briefings/scout.md        bundles/feature-development/briefings/web/scout.md
cp bundles/team-web/briefings/tech-lead.md     bundles/feature-development/briefings/web/tech-lead.md
cp bundles/team-web/briefings/qa-engineer.md   bundles/feature-development/briefings/web/qa-engineer.md
cp bundles/team-web/briefings/python-dev.md    bundles/feature-development/briefings/roles/python-dev.md
cp bundles/team-web/briefings/test-automation-engineer.md bundles/feature-development/briefings/roles/test-automation-engineer.md
cp bundles/team-ios/briefings/scout.md         bundles/feature-development/briefings/ios/scout.md
cp bundles/team-ios/briefings/tech-lead.md     bundles/feature-development/briefings/ios/tech-lead.md
cp bundles/team-ios/briefings/qa-engineer.md   bundles/feature-development/briefings/ios/qa-engineer.md
```

Verify: `find bundles/feature-development/briefings -type f | sort` lists 8 files.

- [ ] **Step 4: Write the merged `instructions.md`**

Create `bundles/feature-development/instructions.md`:

```markdown
# Feature Development — shared conventions

This is a **cross-platform delivery team**. Each project picks the developer
roles it needs — a JS/TS frontend, a Python backend, an iOS app, or any
combination. These are team-wide defaults; scout refines them per project in
`AGENTS.md`, which always wins over this file. Only the sections for the
stacks actually in play apply.

## Web stack (`js-dev`, `python-dev`, `test-automation-engineer`)

- **Frontend** (`js-dev`): JS/TS SPA or SSR app. Owns UI, client state, and
  calls to the backend API. Does not reach into the database.
- **Backend** (`python-dev`): **FastAPI** HTTP service, plus **FastMCP** for
  any MCP servers — modern async Python, Pydantic at the boundaries. (Not
  Django, not Flask — if scout finds those, flag the deviation.) Owns data,
  business logic, and the API contract the frontend consumes.
- **The contract is the seam.** Frontend and backend integrate through the API
  schema (FastAPI's OpenAPI / a typed client). Contract changes are a tech-lead
  concern and need both devs aligned before merge.
- **API changes are two-sided** — a backend change the frontend consumes isn't
  done until the frontend is updated (or explicitly versioned). Flag the
  counterpart role. Prefer generated/shared types at the boundary.
- `test-automation-engineer` covers the end-to-end path through the real stack
  (Playwright). Secrets never land in the frontend bundle.

## iOS stack (`ios-dev`)

- **App** (`ios-dev`): Swift + SwiftUI. Modern concurrency (async/await,
  actors). Data via SwiftData / Core Data or a networked backend.
- **Dependencies:** Swift Package Manager preferred; note CocoaPods (`Podfile`)
  or Carthage if the project uses them.
- **Pattern:** MVVM is the common SwiftUI default — confirm the project's actual
  pattern from `AGENTS.md` before assuming.
- **Build & test through Xcode tooling** (`xcodebuild` / the project's scheme);
  don't hand-wave "it compiles." Respect actor isolation / `@MainActor` — no
  data races. SwiftUI previews for iteration; Swift Testing / XCTest for
  regression coverage. Releases go through the project's signing/distribution
  flow (fastlane, Xcode Cloud, or manual archive) — note which in `AGENTS.md`.

## Definition of done (team-wide)

A change is done when it builds, its tests pass, and — for the web stack — the
affected side of the API contract is consistent and user-facing flows are green
e2e; for the iOS stack — UI changes are verified in a simulator or preview and
concurrency is race-free. "I wrote the code" is not done.
```

- [ ] **Step 5: Write `README.md`**

Create `bundles/feature-development/README.md`:

```markdown
# Feature Development bundle

A cross-platform product team you install in one shot, then **pick the
developer roles you need** — any combination, no stack lock-in.

## Quick start

```bash
npx github:arozumenko/sdlc-skills init --bundle feature-development
```

The installer always sets up the **core roles** and shows a checklist of
**developer roles** to add. Pick any subset (e.g. a Python backend dev + an iOS
dev). The core `tech-lead` and `qa-engineer` automatically pick up the right
skills and briefings for whatever platforms your selection spans.

- `--yes` (or a non-interactive shell) installs **all** developer roles.
- `--agents python-dev,ios-dev` selects a subset non-interactively.

## Roster

**Core (always installed):** `scout`, `ba`, `project-manager`, `tech-lead`,
`qa-engineer`.

**Developer roles (pick any combination):**

| Role | Platform | Focus |
|---|---|---|
| `python-dev` | web | Python backend (FastAPI / FastMCP) |
| `js-dev` | web | JS/TS frontend (React) |
| `test-automation-engineer` | web | End-to-end automation (Playwright) |
| `ios-dev` | iOS | Swift / SwiftUI app |

## How tuning works

Picking any web role activates the web briefings/skills for `tech-lead` and
`qa-engineer`; picking `ios-dev` activates the iOS ones. Pick both and the
shared roles get the **superset** — e.g. `qa-engineer` keeps Playwright *and*
gains the iOS testing skills. See `bundles/SPEC.md` for the overlay model.
```

- [ ] **Step 6: Materialize the agent/skill mirrors**

Run: `npm run sync:bundles`
Expected: lines like `✓ refreshed bundles/feature-development/agents/scout` for
all 9 agents and the 16 localSkills (other bundles report "synced").

Verify the roster mirrored:
`find bundles/feature-development/agents -maxdepth 1 -mindepth 1 -type d | sort`
Expected: the 9 role dirs (scout, ba, project-manager, tech-lead, qa-engineer,
python-dev, js-dev, test-automation-engineer, ios-dev).

- [ ] **Step 7: Commit**

```bash
git add bundles/feature-development
git commit -m "feat(bundles): scaffold feature-development bundle (manifest, docs, briefings, mirrors)"
```

---

## Task 4: Make `applyBundle` dev-role-aware (installer)

**Files:**
- Modify: `bin/init.mjs` — `loadBundle` (~186-210), `applyBundle` (~232-364),
  the `applyBundle` call site (~2178).

- [ ] **Step 1: Extend `loadBundle` defaults**

In `bin/init.mjs`, inside `loadBundle`, after the line
`b.seed = b.seed || {};` add:

```js
  b.coreAgents = b.coreAgents || null; // present => devRole selection path
  b.devRoles = b.devRoles || null;     // { name: { label, platform, briefing?, skillOverlay? } }
  b.platforms = b.platforms || {};     // { id: { label, briefings{}, skillOverlays{} } }
```

- [ ] **Step 2: Import the helpers at the top of `init.mjs`**

Add near the other imports (after the `readline` import):

```js
import {
  resolveSelection,
  buildOverlays,
  buildBriefingPlan,
  composeBriefing,
  briefingDescription,
} from "./lib/bundle-selection.mjs";
```

- [ ] **Step 3: Make `applyBundle` async and resolve dev-role selection first**

Change the signature `function applyBundle(bundle, args, catalog) {` to
`async function applyBundle(bundle, args, catalog) {`.

Immediately after the signature line (before the existing
`const unknownShared = ...`), insert the dev-role resolution block:

```js
  // ----- Flat dev-role selection (feature-development-style bundles) -----
  // When the manifest declares devRoles, the install roster is
  // coreAgents ∪ (picked dev roles). Selection is a flat, unrestricted
  // multi-select; the picked roles' platforms drive the core-role overlays.
  if (bundle.devRoles) {
    const devRoleNames = Object.keys(bundle.devRoles);
    const sel = resolveSelection({
      explicit: args.agents,
      devRoleNames,
      yes: args.yes,
      isTTY: process.stdin.isTTY,
    });
    if (sel.unknown.length) {
      console.error(`  ! --agents names not dev roles of ${bundle.id}: ${sel.unknown.join(", ")}`);
    }
    let selected;
    if (sel.mode === "picker") {
      selected = await selectMany(
        "Developer roles — pick any combination (space toggles, enter confirms):",
        devRoleNames.map((r) => ({ value: r, label: r, desc: bundle.devRoles[r].label, default: true }))
      );
    } else {
      selected = sel.roles;
    }
    // Dev roles install ONLY as bundle-local agents — clear them from the global
    // --agents path so they aren't also resolved against the global catalog.
    args.agents = [...bundle.agents];
    // Restrict the installed roster and pre-merge the overlays/briefings.
    bundle.localAgents = [...new Set([...(bundle.coreAgents || []), ...selected])];
    bundle.skillOverlays = buildOverlays(bundle, selected);
    const bplan = buildBriefingPlan(bundle, selected);
    bundle._resolvedBriefings = {};
    for (const [role, entries] of Object.entries(bplan)) {
      const resolved = entries.map((e) => ({
        label: e.label,
        content: readFileSync(join(bundle.dir, e.path), "utf8"),
      }));
      bundle._resolvedBriefings[role] = {
        content: composeBriefing(resolved),
        description: briefingDescription(resolved),
      };
    }
    console.log(
      `  Roster: ${bundle.coreAgents.length} core + ${selected.length} dev role(s)` +
        (selected.length ? ` (${selected.join(", ")})` : " (none selected)")
    );
  }
```

Note: `selectMany`, `readFileSync`, and `join` are already defined/imported in
`init.mjs`. The rest of `applyBundle` (localAgent existence check, localSkill
registration, overlay computation over `combinedRoster`) now operates on the
restricted `bundle.localAgents` and merged `bundle.skillOverlays` unchanged.

- [ ] **Step 4: Await the call site**

Change line ~2178 from
`bundlePlan = applyBundle(bundle, args, catalog);`
to
`bundlePlan = await applyBundle(bundle, args, catalog);`

- [ ] **Step 5: Smoke-test resolution non-interactively**

Run (throwaway target dir):

```bash
rm -rf /tmp/fd-all && mkdir -p /tmp/fd-all && (cd /tmp/fd-all && node /Users/arozumenko/Development/sdlc-skills/bin/init.mjs init --bundle feature-development --target claude --yes >/tmp/fd-all.log 2>&1); grep -E "agent .*(bundle-local)|Roster:" /tmp/fd-all.log
```

Expected: `Roster: 5 core + 4 dev role(s)` and `bundle-local` install lines for
all 9 agents.

```bash
rm -rf /tmp/fd-ios && mkdir -p /tmp/fd-ios && (cd /tmp/fd-ios && node /Users/arozumenko/Development/sdlc-skills/bin/init.mjs init --bundle feature-development --target claude --agents ios-dev --yes >/tmp/fd-ios.log 2>&1); grep -E "Roster:|bundle-local" /tmp/fd-ios.log
```

Expected: `Roster: 5 core + 1 dev role(s) (ios-dev)`; bundle-local lines for the
5 core roles + `ios-dev` only (no `python-dev`/`js-dev`/`test-automation-engineer`).

- [ ] **Step 6: Commit**

```bash
git add bin/init.mjs
git commit -m "feat(installer): flat dev-role picker + platform overlay merge for feature-development"
```

---

## Task 5: Route briefings through the resolved-content path

**Files:**
- Modify: `bin/init.mjs` — `installBriefings` (~371-398).

- [ ] **Step 1: Make `installBriefings` prefer resolved content**

Replace the body of `installBriefings(bundle, update)` so it iterates a resolved
list, using `bundle._resolvedBriefings` when present and falling back to reading
`bundle.briefings` files for legacy bundles:

```js
function installBriefings(bundle, update) {
  let installed = 0;
  let skipped = 0;
  // Resolved entries: [{ role, content, description }]. New bundles pre-resolve
  // (merged/concatenated) in applyBundle; legacy bundles read role→path here.
  let entries;
  if (bundle._resolvedBriefings) {
    entries = Object.entries(bundle._resolvedBriefings).map(([role, v]) => ({ role, ...v }));
  } else {
    entries = [];
    for (const [role, rel] of Object.entries(bundle.briefings)) {
      const src = join(bundle.dir, rel);
      if (!existsSync(src)) {
        console.log(`      ! briefing ${role} (missing in bundle: ${rel})`);
        continue;
      }
      const content = readFileSync(src, "utf8");
      const dm = content.match(/^description:\s*(.+)$/m);
      entries.push({ role, content, description: dm ? dm[1].trim() : "Project overview and this role's focus" });
    }
  }
  for (const { role, content, description } of entries) {
    const destDir = join(CWD, ".agents", "memory", role);
    const dest = join(destDir, "project_briefing.md");
    if (existsSync(dest) && !update) {
      console.log(`      — briefing ${role} (exists; use --update)`);
      skipped++;
      continue;
    }
    mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, content);
    ensureMemoryIndexLine(destDir, role, description);
    console.log(`      ✓ briefing ${role}`);
    installed++;
  }
  return { installed, skipped };
}
```

- [ ] **Step 2: Verify briefings land for a mixed selection**

```bash
rm -rf /tmp/fd-mix && mkdir -p /tmp/fd-mix && (cd /tmp/fd-mix && node /Users/arozumenko/Development/sdlc-skills/bin/init.mjs init --bundle feature-development --target claude --agents js-dev,ios-dev --yes >/tmp/fd-mix.log 2>&1)
grep -E "briefing (scout|tech-lead|qa-engineer)" /tmp/fd-mix.log
grep -c "## Web stack" /tmp/fd-mix/.agents/memory/qa-engineer/project_briefing.md
grep -c "## iOS stack" /tmp/fd-mix/.agents/memory/qa-engineer/project_briefing.md
```

Expected: briefing lines for `scout`, `tech-lead`, `qa-engineer`; and the
`qa-engineer` briefing contains both `## Web stack` and `## iOS stack` headers
(count `1` each).

- [ ] **Step 3: Verify the iOS-only QA skill swap**

```bash
grep -E "^skills:" /tmp/fd-ios/.claude/agents/qa-engineer/AGENT.md 2>/dev/null || grep -RE "^skills:" /tmp/fd-ios/.claude/agents/qa-engineer*
```

Expected: the `qa-engineer` `skills:` frontmatter includes the iOS testing
skills and does **not** include `playwright-testing`/`playwright-cli`/
`browser-verify` (iOS-only install). For `/tmp/fd-mix` the same file should keep
`playwright-testing` **and** include the iOS skills.

- [ ] **Step 4: Commit**

```bash
git add bin/init.mjs
git commit -m "feat(installer): seed merged/concatenated briefings from resolved content"
```

---

## Task 6: Validate the new manifest keys

**Files:**
- Modify: `bin/validate-bundles.mjs` — inside the per-bundle loop (~85-181).

- [ ] **Step 1: Add `coreAgents`/`devRoles`/`platforms` validation**

In `bin/validate-bundles.mjs`, after the existing `roster` construction
(~line 125, `const roster = new Set([...])`), extend the roster to include
dev-role and core-agent names, then validate the new keys. Insert:

```js
    // feature-development-style bundles: flat devRoles + platform overlays.
    if (b.coreAgents !== undefined) {
      if (!Array.isArray(b.coreAgents)) err(id, "`coreAgents` must be an array");
      else for (const a of b.coreAgents) {
        roster.add(a);
        if (!(b.localAgents || []).includes(a)) err(id, `coreAgent "${a}" not in localAgents`);
      }
    }
    if (b.devRoles !== undefined) {
      if (typeof b.devRoles !== "object" || Array.isArray(b.devRoles)) {
        err(id, "`devRoles` must be an object");
      } else {
        for (const [r, def] of Object.entries(b.devRoles)) {
          roster.add(r);
          if (!(b.localAgents || []).includes(r)) err(id, `devRole "${r}" not in localAgents`);
          if (!def || !def.platform) err(id, `devRole "${r}" missing platform`);
          else if (!b.platforms || !b.platforms[def.platform])
            err(id, `devRole "${r}" platform "${def && def.platform}" not in platforms`);
          if (def && def.briefing && !existsSync(join(dir, def.briefing)))
            err(id, `devRole "${r}" briefing missing: ${def.briefing}`);
          for (const s of (def && def.skillOverlay && def.skillOverlay.add) || [])
            if (!effectiveSkillIds.has(s))
              console.warn(`  • ${id}: devRole "${r}" skillOverlay add "${s}" not in catalog yet (pending content)`);
        }
      }
    }
    for (const [pid, pdef] of Object.entries(b.platforms || {})) {
      for (const [role, rel] of Object.entries((pdef && pdef.briefings) || {})) {
        if (!roster.has(role)) err(id, `platform "${pid}" briefing role "${role}" not in roster`);
        if (!existsSync(join(dir, rel))) err(id, `platform "${pid}" briefing file missing: ${rel}`);
      }
      for (const [role, ov] of Object.entries((pdef && pdef.skillOverlays) || {})) {
        if (!roster.has(role)) err(id, `platform "${pid}" skillOverlay role "${role}" not in roster`);
        for (const s of (ov && ov.add) || [])
          if (!effectiveSkillIds.has(s))
            console.warn(`  • ${id}: platform "${pid}" skillOverlay add "${s}" not in catalog yet (pending content)`);
      }
    }
```

Important: this block reads `effectiveSkillIds`, which is defined **later** in
the loop (~line 142). Move the insertion to **after** the
`const effectiveSkillIds = new Set([...skillIds, ...localSkills]);` line so the
reference resolves. (Place the whole block between that line and the existing
`for (const s of b.skills || [])` check.)

- [ ] **Step 2: Run the validator**

Run: `npm run validate:bundles`
Expected: `✓ feature-development (9 agents)` and `All N bundle(s) valid.` (no
errors; pending-content warnings for external skills like `swiftui-pro` are OK).

- [ ] **Step 3: Confirm it catches a bad manifest**

Temporarily change `feature-development`'s `devRoles.ios-dev.platform` to
`"android"` and re-run `npm run validate:bundles`.
Expected: FAIL with `devRole "ios-dev" platform "android" not in platforms`.
Revert the edit and re-run → valid.

- [ ] **Step 4: Commit**

```bash
git add bin/validate-bundles.mjs
git commit -m "feat(validate): coreAgents/devRoles/platforms checks for feature-development bundles"
```

---

## Task 7: Delete the old bundles and update catalog docs

**Files:**
- Delete: `bundles/team-web/`, `bundles/team-ios/`
- Modify: `bundles/SPEC.md`, `README.md`, `CLAUDE.md`, `MAINTENANCE.md`,
  `agents/python-dev/README.md`, `agents/js-dev/README.md`,
  `agents/ios-dev/README.md`

- [ ] **Step 1: Delete the superseded bundle dirs**

```bash
git rm -r bundles/team-web bundles/team-ios
```

- [ ] **Step 2: Update `bundles/SPEC.md` "Current bundles" table**

In `bundles/SPEC.md`, replace the two rows

```
| `team-web` | fullstack web | `python-dev` (backend) + `js-dev` (frontend) |
| `team-ios` | iOS | `ios-dev` |
```

with a single row:

```
| `feature-development` | cross-platform (web + iOS) | pick any of `python-dev`, `js-dev`, `test-automation-engineer`, `ios-dev`; core roles auto-tune |
```

Then add a short subsection after the "Skill overlays" discussion documenting
the `coreAgents` / `devRoles` / `platforms` keys and the flat-picker behavior
(2-4 sentences; reference the design doc
`docs/superpowers/specs/2026-06-11-feature-development-bundle-design.md`).

- [ ] **Step 3: Update the remaining references**

Find every remaining mention and update prose to `feature-development`:

```bash
grep -rIn -e 'team-web' -e 'team-ios' README.md CLAUDE.md MAINTENANCE.md \
  agents/python-dev/README.md agents/js-dev/README.md agents/ios-dev/README.md
```

For each hit, replace `--bundle team-web` / `--bundle team-ios` usage and
narrative references with `--bundle feature-development` (the python/js/ios dev
READMEs should say they're installed via the `feature-development` bundle by
selecting that role). Leave files under `docs/superpowers/` untouched (historical
records).

- [ ] **Step 4: Verify no stale references remain in live docs**

```bash
grep -rIl -e 'team-web' -e 'team-ios' . | grep -v '.git/' | grep -v '^./docs/superpowers/' | grep -v '^./bundles/feature-development/'
```

Expected: no output (all live references updated; only historical specs/plans
may still mention the old ids).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(bundles): replace team-web + team-ios with feature-development"
```

---

## Task 8: Full validation, sync check, and end-to-end smoke

**Files:** none (verification only).

- [ ] **Step 1: Sync is clean**

Run: `npm run validate:sync`
Expected: no drift — `feature-development` mirrors match canonical; exit 0.

- [ ] **Step 2: Full validation suite**

Run: `npm run validate`
Expected: bundles valid + marketplaces not stale; exit 0.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass, including `bin/lib/bundle-selection.test.mjs` and
`bin/no-tools-frontmatter.test.mjs`.

- [ ] **Step 4: End-to-end install matrix (dry verification)**

```bash
for sel in "--yes" "--agents python-dev,js-dev --yes" "--agents ios-dev --yes" "--agents js-dev,ios-dev --yes"; do
  d=$(mktemp -d); ( cd "$d" && node /Users/arozumenko/Development/sdlc-skills/bin/init.mjs init --bundle feature-development --target claude $sel >log.txt 2>&1 )
  echo "=== $sel ==="; grep -E "Roster:" "$d/log.txt"; ls "$d/.claude/agents" 2>/dev/null | tr '\n' ' '; echo
done
```

Expected per selection: the roster line matches the request, the installed agent
set is `core + selected`, and (spot-check) the `qa-engineer`/`tech-lead`
frontmatter carries the right skills per the merge rules.

- [ ] **Step 5: Confirm the unrelated rebase commits are intact**

Run: `git log --oneline -12`
Expected: the feature commits sit on top of `feat/feature-development-bundle`;
nothing from the earlier rebase was disturbed.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "chore(bundles): finalize feature-development verification" || echo "nothing to finalize"
```

---

## Self-review notes

- **Spec coverage:** flat unrestricted picker (T4), platform tag → core tuning
  (T1/T4), mixed-selection union/remove-suppression (T1 tests + T5 verify),
  non-interactive = all (T1/T4), additive schema with legacy bundles untouched
  (T4 gated on `bundle.devRoles`), extensibility (schema is data-driven, no
  installer change to add a role/platform), no-`tools:` guard (T2), delete old
  bundles + docs (T7), validation/sync/tests (T6/T8). All covered.
- **Types/naming consistency:** helper names (`activePlatforms`,
  `resolveSelection`, `mergeCoreOverlay`, `buildOverlays`, `buildBriefingPlan`,
  `composeBriefing`, `briefingDescription`) are identical across the module,
  its tests, and the `init.mjs` import. `bundle._resolvedBriefings` is the single
  bridge field set in T4 and consumed in T5.
- **Ordering caveat called out:** the T6 validation block must be inserted after
  `effectiveSkillIds` is defined (noted in the step).
```

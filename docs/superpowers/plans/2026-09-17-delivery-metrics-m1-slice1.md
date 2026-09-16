# delivery-metrics M1 (Slice 1) Implementation Plan (v1)

**Plan version:** v1 — 2026-09-17; review rounds recorded at the end under "Review rounds".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `skills/delivery-metrics/` M1 — cycle time, weekly throughput/velocity and estimate-vs-actual delta per task / mission / campaign, from a git-committed event ledger fed by a CLI, one Claude `SubagentStop` hook and a git backfill.

**Architecture:** An orphan stdlib skill. `scripts/delivery.mjs` is a thin CLI over pure modules in `scripts/lib/` (paths → events → plan → timeline → metrics → report; git-backfill and plan-markdown are adapters). Records are append-only per-user JSONL under `.agents/telemetry/delivery/` plus one JSON file per registered plan; readers dedup/resolve at read time (latest revision, source precedence `cli > automation-sync > hook > git`, `CONFLICT` on disagreement). Nothing imports tokenomics code.

**Tech Stack:** Node ≥ 18 (repo runs 24), ESM `.mjs`, stdlib only (`node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:os`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md` (v5.1). §13 defines M1; §5, §6.1–6.7, §6.9–6.11 are the contracts M1 implements; §12/§17 the tests and acceptance criteria. Executors read the spec alongside this plan.

## Global Constraints

1. Stdlib ESM `.mjs` only, Node ≥ 18, **zero dependencies** (CLAUDE.md "The installer is plain ESM Node, stdlib only" applies to skill scripts too). Optional externals (`git`) via `execFileSync` with `shell: false`; failure → honest `null`, never a guess.
2. Every script has a sibling `*.test.mjs` (`node --test` discovers `*.test.mjs` anywhere); tests are offline, use `mkdtempSync` temp dirs and fixed clocks (pass `now` in; never read `Date.now()` in a pure function).
3. Records live only under `.agents/telemetry/delivery/` (spec D3). Never write inside `.agents/telemetry/automation/`. Never gitignore `.agents/telemetry`.
4. Ledger: one `appendFileSync(path, JSON.stringify(rec) + "\n")` per observation, per-user file `events-<slug>.jsonl`; no rewrite, no fsync, no transactions (spec §6.1). Malformed lines are skipped and counted as `malformed-lines`.
5. Timestamps: `at`/`recorded_at` are UTC ISO-8601 with milliseconds (`new Date(x).toISOString()`); durations computed in seconds, reported in hours to 2 dp; weeks are **UTC** ISO weeks `YYYY-Www` (spec D10/D11).
6. Aggregation: nearest-rank percentiles `sorted[Math.ceil(q*n)-1]`; median needs n ≥ 5, P85 n ≥ 7, P90 n ≥ 10; always min–max and n; **never a mean as headline** (D10). No `byPerson` anywhere (D13).
7. Estimates: recorded inputs only; `unit ∈ {h, active_min}`; both `accepted_by` and `accepted_at` required or the estimate is `unaccepted` and excluded; absent = "not estimated", never 0 or 1 (D9, §6.4).
8. Exit codes: `0` ok · `1` internal (uncaught) · `2` usage/schema/identity/conflict (`USAGE`, `SCHEMA-INVALID`, `ID-CONFLICT`, `INVALID-TRANSITION`, `AMBIGUOUS-PLAN`, `MIGRATION-REQUIRED`, `LOCK-BUSY`, `CONFLICT`) · `3` not measurable (`NO-PLAN`, `NO-EVENTS`). Errors are ONE stderr line `<CODE>(<detail>)`. Hooks always exit 0 and never print to stdout (D21, §6.6).
9. Forbidden vocabulary in any file: octobots, dual-mode, markers/taskbox/relay (CLAUDE.md). Forbidden features in M1: DORA, forecasting, Little's-law line, per-person figures, Copilot hooks.
10. SKILL.md frontmatter keys only `name`, `description` (≤ 1024 chars), `license`, `compatibility` (≤ 500, quoted), `metadata` (`authors`, `version`); `name` = directory name; no `tools:` key anywhere (`bin/frontmatter-strict.test.mjs`, `bin/no-tools-frontmatter.test.mjs`, CI `skills-ref`).
11. Commit after every task; `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` must be green at every commit (skip `validate:externals` — needs network).
12. Work in the worktree `/Users/Daniel_Sallai/dev/sdlc-skills-delivery-metrics` on branch `feat/delivery-metrics-spec` (or a task branch off it). `docs/superpowers/` is gitignored — plan/spec commits use `git add -f`.

---

## File structure

```
skills/delivery-metrics/
  SKILL.md                         frontmatter + when/how (Task 1)
  README.md                        quick start (Task 1, finished in Task 13)
  scripts/delivery.mjs             CLI dispatcher: plan | session | event | status | backfill | report | doctor (Tasks 5, 8, 9)
  scripts/install-hooks.mjs        Claude SubagentStop splice, ignore blocks, --remove/--doctor (Task 12)
  scripts/lib/paths.mjs            delivery dir, user slug, segment encoding, plan/events paths, mkdir lock (Task 1)
  scripts/lib/events.mjs           observation record shape, append (SKIP/ID-CONFLICT), read+dedup+revision+CONFLICT (Task 2)
  scripts/lib/plan.mjs             delivery-plan block extraction, schema validation, id assignment, catalogue, delta → observations (Task 3)
  scripts/lib/plan-markdown.mjs    tasks-file importer → canonical block (Task 4)
  scripts/lib/timeline.mjs         source precedence (D6), per-item state, parent rollups (Task 6)
  scripts/lib/metrics.mjs          percentiles, cycle/lead/commit_to_done, throughput/velocity, estimate accuracy, coverage (Task 7)
  scripts/lib/report.mjs           envelope, markdown, JSON, status line (Task 8)
  scripts/lib/git-backfill.mjs     created/first_commit/rework_observed/done from a pinned head (Task 9)
  hooks/dispatch-hook.mjs          SubagentStop → dispatched/dispatch_ended (Task 11)
  templates/delivery-plan.template.json, profile.template.json, plan-block.template.md (Tasks 3, 13)
  references/event-model.md, metrics.md, plan-block.md (Task 13)
  fixtures/security-testing/dataset.json + build-fixture-repo.mjs + golden.json (Task 10)
  fixtures/hooks/                  fake parent/child transcripts + payloads (Task 11)
skills.json                        + delivery-metrics entry (Task 1)
bundles/feature-development/factory.json, bundles/test-automation/factory.json   skills[] += delivery-metrics (Task 1)
.cursor-plugin/ .codex-plugin/ .github/plugin marketplaces   regenerated (Task 1)
bundles/feature-development/agents/{tech-lead,project-manager,scout}/AGENT.md, instructions.md   wiring (Task 13)
bundles/test-automation/agents/scout/AGENT.md, agents/test-automation-lead/AGENT.md   skills-on-demand (Task 13)
bundles/SPEC.md, CLAUDE.md, README.md, AGENTS.md    M-1 doc fixes + P-0/P-1 (Task 0)
```

Shared vocabulary used by every task (from spec §6.2): an **observation** is one ledger line; its identity is `observation_id = source:source_record_id:item_id:event` (each part `encodeURIComponent`-ed); `revision` is an integer ≥ 0; `transition_id` names the occurrence (`<item_id>/<event>/<token>`); `basis ∈ observed | derived-child | plan-commit`; `source ∈ cli | hook | git` in M1.

---

### Task 0: M-1 doc fixes and SPEC.md amendments

**Files:**
- Modify: `CLAUDE.md` (orphan-skill sentence), `README.md`, `AGENTS.md` (orphan/external counts)
- Modify: `bundles/SPEC.md:297-304` (P-0, P-1)

**Interfaces:** none (docs only).

- [ ] **Step 1: Verify the actual counts**

Run: `ls skills | wc -l; node -e 'const s=require("./skills.json");const a=s.skills??s;console.log(a.filter(x=>x.repo).length, a.filter(x=>x.monorepo).length)'`
Expected: 11 top-level skill dirs; 30 `repo:` entries; 3 `monorepo` entries today (becomes 4 after Task 1 — write the docs for the *post*-Task-1 state: **12 orphan skills, 30 externals**). If `skills.json` is not an array at the top level, open it and adapt the one-liner; do not guess.

- [ ] **Step 2: Fix CLAUDE.md**

In `CLAUDE.md` replace the sentence beginning `Top-level \`agents/\` and \`skills/\` hold only the standalone-only "orphan" content` … `eight skills (…)` so that it lists all twelve: the existing eleven directory names from `ls skills` plus `delivery-metrics`, and change "the 28 external (`repo:`) skills" to 30. Keep the sentence structure.

- [ ] **Step 3: Fix README.md and AGENTS.md**

Run: `grep -n "eight\|28 external\|8 orphan" README.md AGENTS.md` and update each hit to the same numbers (12 / 30), adding `delivery-metrics` to any enumerated list with a one-line description: "delivery-metrics — cycle time, velocity and estimate-vs-actual for harness work items; sibling of tokenomics".

- [ ] **Step 4: Amend bundles/SPEC.md (P-0, P-1)**

Edit the "One shared telemetry submodule" bullet (`bundles/SPEC.md:297-304`): replace `**one subfolder per factory** (test-automation writes \`automation/\`)` with `**one subfolder per factory or per cross-factory concern** (test-automation writes \`automation/\`; the orphan \`delivery-metrics\` skill writes \`delivery/\`)`. Append to the "Roster-guard shared-event hooks" bullet (`:291-296`): `A cross-factory skill has no single roster: its hook must instead require (a) an open plan it registered in this repo, (b) a session→plan association written by that plan's owner, and (c) the dispatched role in the union of the participating factories' rosters — and exit silently otherwise (\`skills/delivery-metrics\`).`

- [ ] **Step 5: Validate and commit**

Run: `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes && npm test`
Expected: all green (nothing else changed yet).

```bash
git add CLAUDE.md README.md AGENTS.md bundles/SPEC.md
git commit -m "docs: orphan/external counts, SPEC P-0/P-1 for cross-factory telemetry (delivery-metrics M-1)"
```

---

### Task 1: Skill scaffold, registration, `lib/paths.mjs`

**Files:**
- Create: `skills/delivery-metrics/SKILL.md`, `skills/delivery-metrics/README.md`
- Create: `skills/delivery-metrics/scripts/lib/paths.mjs`, `skills/delivery-metrics/scripts/lib/paths.test.mjs`
- Modify: `skills.json`, `bundles/feature-development/factory.json:166-169`, `bundles/test-automation/factory.json:11-14`
- Regenerate: `.cursor-plugin/marketplace.json`, `.codex-plugin/marketplace.json`, `.github/plugin/marketplace.json`

**Interfaces:**
- Produces: `deliveryDir(repo) → string`; `whoAmI(repo) → {name, email, slug}` (same rule as tokenomics `telemetry-capture.mjs:75-94`); `encodeSegment(s) → string` / `decodeSegment(s)`; `eventsPath(repo, slug)`; `plansDir(repo)`; `planPath(repo, planId)`; `sessionsDir(repo)`; `profilePath(repo)`; `withLock(repo, fn, {staleMs=60000, now}) → fn()` (advisory mkdir lock; throws `Error('LOCK-BUSY')`); `nowIso(now=Date.now()) → string`; `sha256(text) → hex`.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/paths.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryDir, encodeSegment, decodeSegment, planPath, eventsPath, withLock, nowIso, sha256, whoAmI } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-paths-'));

test('deliveryDir is .agents/telemetry/delivery under the repo', () => {
  const repo = tmp();
  assert.equal(deliveryDir(repo), join(repo, '.agents', 'telemetry', 'delivery'));
});

test('encodeSegment percent-encodes / and % reversibly, leaves the rest', () => {
  assert.equal(encodeSegment('sec/run-1/2'), 'sec%2Frun-1%2F2');
  assert.equal(encodeSegment('a%b'), 'a%25b');
  assert.equal(decodeSegment(encodeSegment('x/y%z')), 'x/y%z');
  assert.equal(encodeSegment('TASK-023'), 'TASK-023');
});

test('planPath / eventsPath use encoded plan id and user slug', () => {
  const repo = tmp();
  assert.equal(planPath(repo, 'sec/run-1/2'), join(deliveryDir(repo), 'plans', 'sec%2Frun-1%2F2.json'));
  assert.equal(eventsPath(repo, 'daniel-sallai'), join(deliveryDir(repo), 'events-daniel-sallai.jsonl'));
});

test('withLock runs fn under a mkdir lock, is re-entrant-free, and reclaims a stale lock', () => {
  const repo = tmp();
  let ran = 0;
  withLock(repo, () => { ran++; assert.ok(existsSync(join(deliveryDir(repo), '.lock'))); });
  assert.equal(ran, 1);
  assert.ok(!existsSync(join(deliveryDir(repo), '.lock')), 'released');
  mkdirSync(join(deliveryDir(repo), '.lock'), { recursive: true });
  assert.throws(() => withLock(repo, () => {}, { now: Date.now() }), /LOCK-BUSY/);
  const old = (Date.now() - 120000) / 1000;
  utimesSync(join(deliveryDir(repo), '.lock'), old, old);
  withLock(repo, () => { ran++; }, { now: Date.now() });
  assert.equal(ran, 2, 'stale (>60 s) lock reclaimed');
});

test('nowIso is UTC with milliseconds; sha256 is hex', () => {
  assert.equal(nowIso(0), '1970-01-01T00:00:00.000Z');
  assert.match(sha256('x'), /^[0-9a-f]{64}$/);
});

test('whoAmI returns a lowercase slug, never empty', () => {
  const who = whoAmI(tmp());
  assert.match(who.slug, /^[a-z0-9-]+$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/paths.test.mjs`
Expected: FAIL — `Cannot find module './paths.mjs'`.

- [ ] **Step 3: Write `paths.mjs`**

```js
// STDLIB ONLY. Paths, identity and the advisory lock for the delivery ledger.
// Records live under .agents/telemetry/delivery/ (spec D3); never elsewhere.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

export const deliveryDir = (repo) => join(repo, '.agents', 'telemetry', 'delivery');
export const plansDir = (repo) => join(deliveryDir(repo), 'plans');
export const sessionsDir = (repo) => join(deliveryDir(repo), 'sessions');
export const profilePath = (repo) => join(deliveryDir(repo), 'profile.json');

/** Reversible: only `%` and `/` are encoded, so ids stay readable in `ls`. */
export const encodeSegment = (s) => String(s).replace(/%/g, '%25').replace(/\//g, '%2F');
export const decodeSegment = (s) => String(s).replace(/%2F/g, '/').replace(/%25/g, '%');
export const planPath = (repo, planId) => join(plansDir(repo), `${encodeSegment(planId)}.json`);
export const eventsPath = (repo, slug) => join(deliveryDir(repo), `events-${slug}.jsonl`);
export const sessionPath = (repo, host, session) => join(sessionsDir(repo), `${encodeSegment(`${host}:${session}`)}.json`);

export const nowIso = (now = Date.now()) => new Date(now).toISOString();
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Same identity rule as tokenomics (telemetry-capture.mjs:75-94): git user.name, else OS user, else email local-part. */
export function whoAmI(repo) {
  const git = (key) => {
    try {
      return execFileSync('git', ['-C', repo, 'config', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch { return null; }
  };
  const email = git('user.email');
  const name = git('user.name') || userInfo().username;
  const base = name || (email ? email.split('@')[0] : null);
  const slug = String(base ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return { name, email, slug };
}

/**
 * Advisory mkdir lock, 60 s stale rule (security-testing fsx precedent). It only
 * serialises this skill's own small writes; it promises nothing about other
 * processes (spec §6.1 "concurrency: best-effort").
 */
export function withLock(repo, fn, { staleMs = 60000, now = Date.now() } = {}) {
  const dir = join(deliveryDir(repo), '.lock');
  mkdirSync(deliveryDir(repo), { recursive: true });
  try {
    mkdirSync(dir);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0;
    try { age = now - statSync(dir).mtimeMs; } catch { age = staleMs + 1; }
    if (age <= staleMs) throw new Error('LOCK-BUSY');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
  }
  try { return fn(); } finally { rmSync(dir, { recursive: true, force: true }); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/lib/paths.test.mjs`
Expected: 6 passing.

- [ ] **Step 5: Write SKILL.md and README.md**

`skills/delivery-metrics/SKILL.md`:
```markdown
---
name: delivery-metrics
description: Delivery performance tracker for harness work items — the cycle-time and cadence sibling of tokenomics. Registers a plan (campaign → mission → task) with ranged, human-accepted estimates, records dispatch/merge/cancel transitions into a git-committed event ledger (.agents/telemetry/delivery/), backfills history from git, and reports cycle time, weekly throughput/velocity and estimate-vs-actual delta per level. Use when the user asks "how fast are we delivering", "register the plan / estimates", "record that TASK-023 merged", "delivery report / status", "enable delivery tracking", or "how good were our estimates". For cost per case use tokenomics; for sizing new work use automation-scoping.
license: Apache-2.0
compatibility: "Requires Node 18+ and git. Automatic dispatch capture on Claude Code only (SubagentStop hook, opt-in via scripts/install-hooks.mjs); every other host records transitions with the CLI and the git backfill."
metadata:
  authors:
    - Daniel Sallai <daniel_sallai@epam.com>
  version: "0.1.0"
---

# delivery-metrics — cycle time, cadence, estimate vs actual

`tokenomics` answers *what did it cost*; this skill answers *how long did it
take and how did that compare with what we said*. It never estimates, never
defaults a missing number, and labels every proxy as a proxy.

## Quick start

```bash
# 1. Register the plan (the tech-lead's plan file carries a ```json delivery-plan block)
node .claude/skills/delivery-metrics/scripts/delivery.mjs plan register --from docs/superpowers/plans/<plan>.md --id reg-1
# 2. Record transitions as they happen (PM, at merge / cancel)
node .claude/skills/delivery-metrics/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
# 3. Fill in history that predates the ledger
node .claude/skills/delivery-metrics/scripts/delivery.mjs backfill --git --plan <plan_id> --head <sha>
# 4. Optional: automatic dispatch start/end on Claude Code
node .claude/skills/delivery-metrics/scripts/install-hooks.mjs            # --remove undoes, --doctor checks
# 5. Read
node .claude/skills/delivery-metrics/scripts/delivery.mjs status
node .claude/skills/delivery-metrics/scripts/delivery.mjs report [--json] [--since 2026-09-01]
```

Contracts: `references/event-model.md` (ledger line), `references/plan-block.md`
(the plan block and estimates), `references/metrics.md` (every metric's start,
stop, unit and floor). Design: `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`.
```

`skills/delivery-metrics/README.md`: the same quick start plus a "What it does not do" list copied from spec §8 (no DORA, no forecasting, no per-person figures, no cost recomputation, Copilot capture parked).

- [ ] **Step 6: Register the skill**

`skills.json` — add next to the `memory` entry (keep the array order alphabetical if it is):
```json
{
  "id": "delivery-metrics",
  "monorepo": "sdlc-skills",
  "name": "delivery-metrics",
  "description": "Delivery performance tracker for harness work items — cycle time, weekly throughput/velocity and estimate-vs-actual delta per campaign/mission/task from a git-committed event ledger; sibling of tokenomics."
}
```
`bundles/feature-development/factory.json:166-169` and `bundles/test-automation/factory.json:11-14`: add `"delivery-metrics"` to `skills`.

Run: `npm run gen:marketplaces`
Expected: the three generated marketplace files gain a `delivery-metrics` entry.

- [ ] **Step 7: Validate and commit**

Run: `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes`
Expected: green (frontmatter tests pass on the new SKILL.md).

```bash
git add skills/delivery-metrics skills.json bundles/feature-development/factory.json bundles/test-automation/factory.json .cursor-plugin .codex-plugin .github/plugin
git commit -m "feat(delivery-metrics): skill scaffold, registration, lib/paths"
```

---

### Task 2: `lib/events.mjs` — observation records, append, read

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/events.mjs`, `skills/delivery-metrics/scripts/lib/events.test.mjs`

**Interfaces:**
- Consumes: `paths.mjs` (`eventsPath`, `deliveryDir`, `whoAmI`, `nowIso`, `withLock`).
- Produces:
  - `EVENTS` (array of the 18 event names from spec §6.2), `SOURCES = ['cli','automation-sync','hook','git']`, `SOURCE_RANK` (cli=0 … git=3), `BASES = ['observed','derived-child','scope-proxy','gate-proxy','receipt-proxy','plan-commit']`.
  - `observationId({source, sourceRecordId, itemId, event}) → string`
  - `makeObservation(fields, {now}) → record` — fills `v:2`, `recorded_at`, `observation_id`, `revision:0`, `status:'active'`, `basis:'observed'`, nullable handles; throws `Error('SCHEMA-INVALID(<field>)')` on bad input.
  - `semanticKey(rec) → string` — JSON of `{observation_id, revision, at, event, transition_id, status, basis, raw, estimate, meta.git_sha, meta.pr}` (capture envelope excluded).
  - `appendObservation(repo, rec, {slug, now}) → {result:'EVENT'|'SKIP'|'ID-CONFLICT', observation_id, revision, path}` — SKIP when an existing line has the same `observation_id`+`revision` and equal `semanticKey`; ID-CONFLICT when same id+revision and different semantics (nothing written); EVENT otherwise (appended under `withLock`).
  - `readRaw(repo) → {lines: [{rec, path, line}], counts: {files, parsed, malformed, unknownVersion}}`
  - `resolveObservations(repo) → {active: rec[], counts: {..., retries, superseded, retracted, conflicts}, conflicts: [{observation_id, revision, paths}]}` — collapse identical semantic duplicates, keep the highest revision per `observation_id`, drop `status:'retracted'`, mark same-revision-different-semantics as CONFLICT (that observation excluded entirely).

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/events.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeObservation, observationId, appendObservation, readRaw, resolveObservations, EVENTS, SOURCE_RANK } from './events.mjs';
import { deliveryDir, eventsPath } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-events-'));
const T0 = Date.parse('2026-09-16T10:00:00Z');
const base = (over = {}) => makeObservation({
  at: '2026-09-16T09:00:00.000Z', user: 'u', host: 'cli', plan: 'c/run-1/1', item_id: 'task-023', ref: 'TASK-023',
  level: 'task', event: 'done', transition_id: 'task-023/done/episode-1', source: 'cli', source_record_id: 'tok-1', ...over,
}, { now: T0 });

test('makeObservation fills v2 defaults and a stable observation_id', () => {
  const r = base();
  assert.equal(r.v, 2);
  assert.equal(r.recorded_at, '2026-09-16T10:00:00.000Z');
  assert.equal(r.observation_id, observationId({ source: 'cli', sourceRecordId: 'tok-1', itemId: 'task-023', event: 'done' }));
  assert.equal(r.observation_id, 'cli:tok-1:task-023:done');
  assert.equal(r.revision, 0); assert.equal(r.status, 'active'); assert.equal(r.basis, 'observed');
  assert.equal(r.session, null); assert.equal(r.agentId, null);
  assert.ok(EVENTS.includes('rework_observed'));
  assert.equal(SOURCE_RANK.cli, 0); assert.equal(SOURCE_RANK.git, 3);
});

test('makeObservation rejects unknown event, bad at, bad source, missing transition', () => {
  assert.throws(() => base({ event: 'merged' }), /SCHEMA-INVALID\(event\)/);
  assert.throws(() => base({ at: 'yesterday' }), /SCHEMA-INVALID\(at\)/);
  assert.throws(() => base({ source: 'manual' }), /SCHEMA-INVALID\(source\)/);
  assert.throws(() => base({ transition_id: '' }), /SCHEMA-INVALID\(transition_id\)/);
  assert.throws(() => base({ item_id: null }), /SCHEMA-INVALID\(item_id\)/, 'null item only allowed with meta.unattributed');
  assert.doesNotThrow(() => base({ item_id: null, ref: null, event: 'dispatched', meta: { unattributed: true } }));
});

test('appendObservation: EVENT, then SKIP on identical retry, ID-CONFLICT on changed semantics', () => {
  const repo = tmp();
  const a = appendObservation(repo, base(), { slug: 'u', now: T0 });
  assert.equal(a.result, 'EVENT');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
  const b = appendObservation(repo, base(), { slug: 'u', now: T0 + 5000 });
  assert.equal(b.result, 'SKIP', 'recorded_at differs but semantics equal');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
  const c = appendObservation(repo, base({ at: '2026-09-16T08:00:00.000Z' }), { slug: 'u', now: T0 });
  assert.equal(c.result, 'ID-CONFLICT');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1, 'nothing written');
  const d = appendObservation(repo, base({ at: '2026-09-16T08:00:00.000Z', revision: 1 }), { slug: 'u', now: T0 });
  assert.equal(d.result, 'EVENT', 'a correction is a higher revision');
});

test('readRaw skips and counts malformed lines and unknown versions, across user files', () => {
  const repo = tmp();
  mkdirSync(deliveryDir(repo), { recursive: true });
  appendFileSync(eventsPath(repo, 'a'), JSON.stringify(base()) + '\n{"v":2,"truncated":tru\n');
  appendFileSync(eventsPath(repo, 'b'), JSON.stringify({ ...base({ source_record_id: 'tok-2' }), v: 9 }) + '\n' + JSON.stringify(base({ source_record_id: 'tok-3' })) + '\n');
  const raw = readRaw(repo);
  assert.equal(raw.counts.files, 2);
  assert.equal(raw.counts.parsed, 2);
  assert.equal(raw.counts.malformed, 1);
  assert.equal(raw.counts.unknownVersion, 1);
});

test('resolveObservations: latest revision wins, retracted dropped, same-revision disagreement → CONFLICT', () => {
  const repo = tmp();
  mkdirSync(deliveryDir(repo), { recursive: true });
  const w = (slug, rec) => appendFileSync(eventsPath(repo, slug), JSON.stringify(rec) + '\n');
  w('a', base());                                                   // rev 0
  w('a', base());                                                   // identical retry
  w('b', base({ revision: 1, at: '2026-09-16T08:30:00.000Z' }));   // correction, earlier at
  w('a', base({ source_record_id: 'tok-9' }));                      // separate observation
  w('b', base({ source_record_id: 'tok-9', revision: 1, status: 'retracted' }));
  w('a', base({ source_record_id: 'tok-x', at: '2026-09-16T01:00:00.000Z' }));
  w('b', base({ source_record_id: 'tok-x', at: '2026-09-16T02:00:00.000Z' })); // same rev 0, different at
  const r = resolveObservations(repo);
  assert.equal(r.active.length, 1);
  assert.equal(r.active[0].revision, 1);
  assert.equal(r.active[0].at, '2026-09-16T08:30:00.000Z');
  assert.equal(r.counts.retries, 1);
  assert.equal(r.counts.retracted, 1);
  assert.equal(r.counts.conflicts, 1);
  assert.equal(r.conflicts[0].observation_id, 'cli:tok-x:task-023:done');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/events.test.mjs`
Expected: FAIL — `Cannot find module './events.mjs'`.

- [ ] **Step 3: Write `events.mjs`**

```js
// STDLIB ONLY. One ledger line per observation (spec §6.2). Append-only, per-user
// file, read-time resolution: retries collapse, highest revision wins, retracted
// dropped, same-revision disagreement is a printed CONFLICT (never a winner).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, eventsPath, nowIso, whoAmI, withLock } from './paths.mjs';

export const EVENTS = ['created', 'estimated', 'dispatched', 'dispatch_ended', 'first_commit', 'review_requested',
  'review_returned', 'review_approved', 'review_history', 'done', 'cancelled', 'blocked', 'unblocked', 'reopened',
  'scope_declared', 'gate_observed', 'outcome_observed', 'rework_observed'];
export const SOURCES = ['cli', 'automation-sync', 'hook', 'git'];
export const SOURCE_RANK = Object.fromEntries(SOURCES.map((s, i) => [s, i]));
export const BASES = ['observed', 'derived-child', 'scope-proxy', 'gate-proxy', 'receipt-proxy', 'plan-commit'];
export const LEVELS = ['campaign', 'mission', 'task', 'case'];
const HOSTS = ['claude', 'copilot', 'copilot-vscode', 'cli', 'git'];

const enc = (s) => encodeURIComponent(String(s));
export const observationId = ({ source, sourceRecordId, itemId, event }) => `${enc(source)}:${enc(sourceRecordId)}:${enc(itemId ?? 'unattributed')}:${enc(event)}`;

const validIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const bad = (f) => { throw new Error(`SCHEMA-INVALID(${f})`); };

export function makeObservation(f, { now = Date.now() } = {}) {
  if (!validIso(f.at)) bad('at');
  if (!EVENTS.includes(f.event)) bad('event');
  if (!SOURCES.includes(f.source)) bad('source');
  if (!HOSTS.includes(f.host)) bad('host');
  if (!f.transition_id || typeof f.transition_id !== 'string') bad('transition_id');
  if (!f.plan || typeof f.plan !== 'string') bad('plan');
  if (f.item_id == null && !f.meta?.unattributed) bad('item_id');
  if (f.level != null && !LEVELS.includes(f.level)) bad('level');
  if (f.basis != null && !BASES.includes(f.basis)) bad('basis');
  if (!f.source_record_id) bad('source_record_id');
  const revision = f.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0) bad('revision');
  const status = f.status ?? 'active';
  if (!['active', 'retracted'].includes(status)) bad('status');
  return {
    v: 2,
    at: new Date(f.at).toISOString(),
    recorded_at: nowIso(now),
    user: f.user ?? null,
    host: f.host,
    plan: f.plan,
    item_id: f.item_id ?? null,
    ref: f.ref ?? null,
    level: f.level ?? null,
    event: f.event,
    transition_id: f.transition_id,
    source: f.source,
    source_record_id: String(f.source_record_id),
    observation_id: observationId({ source: f.source, sourceRecordId: f.source_record_id, itemId: f.item_id, event: f.event }),
    revision,
    status,
    basis: f.basis ?? 'observed',
    session: f.session ?? null,
    agentId: f.agentId ?? null,
    role: f.role ?? null,
    label: f.label ?? null,
    raw: f.raw ?? null,
    ...(f.estimate ? { estimate: f.estimate } : {}),
    meta: f.meta ?? {},
  };
}

/** Capture envelope (recorded_at, user, host, label, evidence locators) excluded — retries must collapse. */
export function semanticKey(r) {
  return JSON.stringify({
    o: r.observation_id, rev: r.revision, at: r.at, e: r.event, t: r.transition_id, s: r.status, b: r.basis,
    raw: r.raw ?? null, est: r.estimate ?? null, sha: r.meta?.git_sha ?? null, pr: r.meta?.pr ?? null,
    ep: r.meta?.episode ?? null, iv: r.meta?.interval ?? null, res: r.meta?.result ?? null,
  });
}

export function readRaw(repo) {
  const dir = deliveryDir(repo);
  const counts = { files: 0, parsed: 0, malformed: 0, unknownVersion: 0 };
  const lines = [];
  if (!existsSync(dir)) return { lines, counts };
  const files = readdirSync(dir).filter((f) => /^events-.*\.jsonl$/.test(f)).sort();
  for (const f of files) {
    counts.files++;
    const path = join(dir, f);
    const text = readFileSync(path, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      let rec;
      try { rec = JSON.parse(line); } catch { counts.malformed++; return; }
      if (!rec || typeof rec !== 'object' || rec.v !== 2) { counts.unknownVersion++; return; }
      if (!rec.observation_id || !Number.isInteger(rec.revision)) { counts.malformed++; return; }
      counts.parsed++;
      lines.push({ rec, path, line: i + 1 });
    });
  }
  return { lines, counts };
}

export function resolveObservations(repo) {
  const { lines, counts } = readRaw(repo);
  const byId = new Map(); // observation_id -> Map(revision -> {rec, keys:Set, paths})
  let retries = 0;
  for (const { rec, path, line } of lines) {
    const revs = byId.get(rec.observation_id) ?? new Map();
    byId.set(rec.observation_id, revs);
    const cur = revs.get(rec.revision);
    const key = semanticKey(rec);
    if (!cur) revs.set(rec.revision, { rec, keys: new Set([key]), paths: [`${path}:${line}`] });
    else { if (cur.keys.has(key)) retries++; cur.keys.add(key); cur.paths.push(`${path}:${line}`); }
  }
  const active = [], conflicts = [];
  let superseded = 0, retracted = 0;
  for (const [id, revs] of byId) {
    const conflicting = [...revs.entries()].filter(([, v]) => v.keys.size > 1);
    if (conflicting.length) { conflicts.push({ observation_id: id, revision: conflicting[0][0], paths: conflicting[0][1].paths }); continue; }
    const top = Math.max(...revs.keys());
    superseded += revs.size - 1;
    const { rec } = revs.get(top);
    if (rec.status === 'retracted') { retracted++; continue; }
    active.push(rec);
  }
  active.sort((a, b) => a.at.localeCompare(b.at) || a.observation_id.localeCompare(b.observation_id));
  return { active, conflicts, counts: { ...counts, retries, superseded, retracted, conflicts: conflicts.length } };
}

export function appendObservation(repo, rec, { slug, now = Date.now() } = {}) {
  const user = slug ?? whoAmI(repo).slug;
  const line = { ...rec, user: rec.user ?? user, recorded_at: nowIso(now) };
  return withLock(repo, () => {
    const { lines } = readRaw(repo);
    const key = semanticKey(line);
    for (const { rec: r } of lines) {
      if (r.observation_id !== line.observation_id || r.revision !== line.revision) continue;
      if (semanticKey(r) === key) return { result: 'SKIP', observation_id: line.observation_id, revision: line.revision, path: null };
      return { result: 'ID-CONFLICT', observation_id: line.observation_id, revision: line.revision, path: null };
    }
    mkdirSync(deliveryDir(repo), { recursive: true });
    const path = eventsPath(repo, user);
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    return { result: 'EVENT', observation_id: line.observation_id, revision: line.revision, path };
  }, { now });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/lib/events.test.mjs`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/scripts/lib/events.mjs skills/delivery-metrics/scripts/lib/events.test.mjs
git commit -m "feat(delivery-metrics): observation ledger — append with SKIP/ID-CONFLICT, read-time revision/CONFLICT resolution"
```

---

### Task 3: `lib/plan.mjs` — plan block, schema, catalogue, delta

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/plan.mjs`, `skills/delivery-metrics/scripts/lib/plan.test.mjs`
- Create: `skills/delivery-metrics/templates/delivery-plan.template.json`

**Interfaces:**
- Consumes: `paths.mjs` (`planPath`, `plansDir`, `sha256`, `nowIso`), `events.mjs` (`makeObservation`).
- Produces:
  - `extractPlanBlock(text) → object|null` — first ```` ```json delivery-plan ```` fence in markdown, or the whole text if it parses as JSON.
  - `validatePlan(obj) → string[]` errors (empty = valid). Rules below.
  - `planIdOf(obj) → 'campaign_id/run_id/version'`.
  - `assignIds(obj) → obj` — fills missing `item_id`s deterministically: campaign `campaign-<campaign_id>`, mission `mission-<ref>`, task `task-<ref>`, all lower-cased with `[^a-z0-9]+ → '-'`.
  - `toCatalogue(obj) → item[]` — flat rows `{item_id, ref, level, parent_item_id, story, class, role, branch, sequence, estimate}`.
  - `canonicalHash(obj) → hex` — sha256 of JSON with sorted object keys, arrays in order.
  - `loadPlan(repo, planId) → planRecord|null`; `listPlans(repo) → planRecord[]`; `savePlan(repo, planRecord)`.
  - `planDelta(prev, next, {at, createdAt, keepMissing}) → {created: item[], estimated: item[], cancelled: item[], reopened: item[]}`.
  - `registrationObservations({planRecord, delta, token, at, createdAt, createdBasis, now}) → record[]` — `created` (basis `plan-commit` when `createdBasis==='plan-commit'`, else `observed`), `estimated` (with `estimate` payload, `transition_id` `<item>/estimated/rev-<n>`), `cancelled` (raw `removed-from-plan`).
  - `validateEstimate(e) → string[]`; `estimateStatus(e) → 'accepted'|'unaccepted'|'none'`.

Plan record on disk (`plans/<encoded id>.json`): `{ plan_id, campaign_id, run_id, version, factory, status:'open'|'closed', registered_at, updated_at, observation_start, source_epoch:{from, until, integration_ref}, mission_kind, source:{path, sha256}, canonical_sha256, roster:[factory names], items:[catalogue rows], versions:[{version, at, canonical_sha256}] }`.

**Validation rules** (`validatePlan`): `campaign_id` `^[a-z0-9][a-z0-9-]*$`; `run_id` same; `version` positive integer; `factory` ∈ `feature-development|test-automation|manual-qa`; `observation_start` valid ISO; `source_epoch.from` valid ISO, `until` ISO or null, `integration_ref` non-empty; `mission_kind` ∈ `group|milestone|wave|batch|run`; `campaign.ref` non-empty; `missions[]` each `ref` unique, `sequence` positive integer unique, `tasks[]` each `ref` unique across the whole plan, `class` optional string, `role` optional string, `branch` optional string, `story` optional `^US-\d+$`; every `estimate` passes `validateEstimate`; `supersedes` (optional) `{plan_id, item_map:{old_item_id: new_item_id}}` with injective values.

`validateEstimate`: `unit ∈ h|active_min`; `low`,`high` finite numbers ≥ 0, `low ≤ high`; `tier ∈ ROM|budgetary|calibrated|unknown`; `proposed_by` non-empty; `proposed_at` ISO; `accepted_by` null or non-empty string; `accepted_at` null or ISO; `probability` absent or `0 < p < 1`; `class` optional string.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/plan.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPlanBlock, validatePlan, planIdOf, assignIds, toCatalogue, canonicalHash, savePlan, loadPlan, listPlans, planDelta, registrationObservations, validateEstimate, estimateStatus } from './plan.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-plan-'));
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tech-lead', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'Daniel', accepted_at: '2026-09-16T08:30:00Z' };
const PLAN = () => ({
  campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development',
  observation_start: '2026-09-16T08:00:00Z', source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' },
  campaign: { ref: 'sec', estimate: { ...EST, low: 100, high: 200 } }, mission_kind: 'group',
  missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001', story: 'US-001', class: 'S', role: 'js-dev', branch: 'task/task-001', estimate: EST }, { ref: 'TASK-002', class: 'M' }] }],
});
const MD = '# plan\n\n```json delivery-plan\n' + JSON.stringify(PLAN()) + '\n```\n';

test('extractPlanBlock reads the fenced block or bare JSON', () => {
  assert.equal(extractPlanBlock(MD).campaign_id, 'sec');
  assert.equal(extractPlanBlock(JSON.stringify(PLAN())).run_id, 'run-1');
  assert.equal(extractPlanBlock('# nothing here'), null);
});

test('validatePlan: valid plan has no errors; bad fields are named', () => {
  assert.deepEqual(validatePlan(PLAN()), []);
  const p = PLAN(); p.missions[0].tasks.push({ ref: 'TASK-001' }); p.version = 0; p.factory = 'ops';
  const errs = validatePlan(p);
  assert.ok(errs.some((e) => /duplicate ref TASK-001/.test(e)));
  assert.ok(errs.some((e) => /version/.test(e)));
  assert.ok(errs.some((e) => /factory/.test(e)));
});

test('validateEstimate / estimateStatus', () => {
  assert.deepEqual(validateEstimate(EST), []);
  assert.ok(validateEstimate({ ...EST, unit: 'd' }).some((e) => /unit/.test(e)));
  assert.ok(validateEstimate({ ...EST, low: 5 }).some((e) => /low/.test(e)));
  assert.ok(validateEstimate({ ...EST, probability: 1 }).some((e) => /probability/.test(e)));
  assert.equal(estimateStatus(EST), 'accepted');
  assert.equal(estimateStatus({ ...EST, accepted_by: null }), 'unaccepted');
  assert.equal(estimateStatus({ ...EST, accepted_at: null }), 'unaccepted');
  assert.equal(estimateStatus(undefined), 'none');
});

test('assignIds + toCatalogue produce stable ids and parent links', () => {
  const p = assignIds(PLAN());
  assert.equal(planIdOf(p), 'sec/run-1/1');
  const cat = toCatalogue(p);
  assert.deepEqual(cat.map((i) => [i.item_id, i.level, i.parent_item_id]), [
    ['campaign-sec', 'campaign', null], ['mission-g1', 'mission', 'campaign-sec'],
    ['task-task-001', 'task', 'mission-g1'], ['task-task-002', 'task', 'mission-g1']]);
  assert.equal(cat[2].branch, 'task/task-001');
  assert.equal(cat[1].sequence, 1);
  assert.equal(canonicalHash(PLAN()), canonicalHash({ ...PLAN(), campaign_id: 'sec' }), 'key order independent');
});

test('save/load/list plans round-trip', () => {
  const repo = tmp();
  const rec = { plan_id: 'sec/run-1/1', campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', items: toCatalogue(assignIds(PLAN())) };
  savePlan(repo, rec);
  assert.equal(loadPlan(repo, 'sec/run-1/1').items.length, 4);
  assert.equal(listPlans(repo).length, 1);
  assert.equal(loadPlan(repo, 'nope/x/1'), null);
});

test('planDelta: created / estimated / cancelled / reopened', () => {
  const prev = toCatalogue(assignIds(PLAN()));
  const nextPlan = PLAN(); nextPlan.version = 2;
  nextPlan.missions[0].tasks = [{ ref: 'TASK-001', class: 'S', estimate: { ...EST, high: 4 } }, { ref: 'TASK-003' }];
  const next = toCatalogue(assignIds(nextPlan));
  const d = planDelta(prev, next, {});
  assert.deepEqual(d.created.map((i) => i.ref), ['TASK-003']);
  assert.deepEqual(d.estimated.map((i) => i.ref), ['TASK-001'], 'changed range is a new estimated revision');
  assert.deepEqual(d.cancelled.map((i) => i.ref), ['TASK-002']);
  const d2 = planDelta(prev, next, { keepMissing: true });
  assert.deepEqual(d2.cancelled, []);
  const d0 = planDelta([], next, {});
  assert.equal(d0.created.length, 4, 'everything is new on first registration');
  assert.equal(d0.estimated.length, 2, 'campaign + TASK-001 carry estimates');
});

test('registrationObservations: stable identities, plan-commit basis, estimate payload', () => {
  const items = toCatalogue(assignIds(PLAN()));
  const planRecord = { plan_id: 'sec/run-1/1', items };
  const delta = planDelta([], items, {});
  const recs = registrationObservations({ planRecord, delta, token: 'reg-1', at: '2026-09-16T09:00:00Z', createdAt: '2026-09-15T12:00:00Z', createdBasis: 'plan-commit', now: 0 });
  const created = recs.filter((r) => r.event === 'created');
  assert.equal(created.length, 4);
  assert.equal(created[0].basis, 'plan-commit');
  assert.equal(created[0].at, '2026-09-15T12:00:00.000Z');
  assert.equal(created[0].observation_id, 'cli:reg-1:campaign-sec:created');
  const est = recs.find((r) => r.event === 'estimated' && r.item_id === 'task-task-001');
  assert.equal(est.estimate.low, 1);
  assert.equal(est.transition_id, 'task-task-001/estimated/rev-0');
  assert.equal(est.at, '2026-09-16T08:30:00.000Z', 'estimated at = accepted_at when accepted, else proposed_at');
  const same = registrationObservations({ planRecord, delta, token: 'reg-1', at: '2026-09-16T09:00:00Z', createdAt: '2026-09-15T12:00:00Z', createdBasis: 'plan-commit', now: 99 });
  assert.equal(same[0].observation_id, recs[0].observation_id, 'retry reuses identities');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/plan.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `plan.mjs`**

```js
// STDLIB ONLY. The registered work-item tree (spec §5, §6.3) and its delta → observations.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeObservation } from './events.mjs';
import { decodeSegment, nowIso, planPath, plansDir, sha256 } from './paths.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const FACTORIES = ['feature-development', 'test-automation', 'manual-qa'];
const MISSION_KINDS = ['group', 'milestone', 'wave', 'batch', 'run'];
const TIERS = ['ROM', 'budgetary', 'calibrated', 'unknown'];
const iso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function extractPlanBlock(text) {
  const m = /```json\s+delivery-plan\s*\n([\s\S]*?)\n```/.exec(text);
  const src = m ? m[1] : text;
  try { const o = JSON.parse(src); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

export function validateEstimate(e, at = 'estimate') {
  const errs = [];
  if (!e || typeof e !== 'object') return [`${at}: not an object`];
  if (!['h', 'active_min'].includes(e.unit)) errs.push(`${at}.unit must be h|active_min`);
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!num(e.low)) errs.push(`${at}.low must be a finite number ≥ 0`);
  if (!num(e.high)) errs.push(`${at}.high must be a finite number ≥ 0`);
  if (num(e.low) && num(e.high) && e.low > e.high) errs.push(`${at}.low must be ≤ high`);
  if (!TIERS.includes(e.tier)) errs.push(`${at}.tier must be ROM|budgetary|calibrated|unknown`);
  if (!e.proposed_by) errs.push(`${at}.proposed_by required`);
  if (!iso(e.proposed_at)) errs.push(`${at}.proposed_at must be ISO`);
  if (e.accepted_by != null && (typeof e.accepted_by !== 'string' || !e.accepted_by.trim())) errs.push(`${at}.accepted_by must be a name or null`);
  if (e.accepted_at != null && !iso(e.accepted_at)) errs.push(`${at}.accepted_at must be ISO or null`);
  if (e.probability != null && !(typeof e.probability === 'number' && e.probability > 0 && e.probability < 1)) errs.push(`${at}.probability must be 0<p<1`);
  return errs;
}

export const estimateStatus = (e) => (!e ? 'none' : (e.accepted_by && e.accepted_at ? 'accepted' : 'unaccepted'));

export function validatePlan(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['plan: not an object'];
  if (!ID_RE.test(p.campaign_id ?? '')) errs.push('campaign_id must match ^[a-z0-9][a-z0-9-]*$');
  if (!ID_RE.test(p.run_id ?? '')) errs.push('run_id must match ^[a-z0-9][a-z0-9-]*$');
  if (!Number.isInteger(p.version) || p.version < 1) errs.push('version must be a positive integer');
  if (!FACTORIES.includes(p.factory)) errs.push('factory must be feature-development|test-automation|manual-qa');
  if (!iso(p.observation_start)) errs.push('observation_start must be ISO');
  const ep = p.source_epoch ?? {};
  if (!iso(ep.from)) errs.push('source_epoch.from must be ISO');
  if (ep.until != null && !iso(ep.until)) errs.push('source_epoch.until must be ISO or null');
  if (!ep.integration_ref) errs.push('source_epoch.integration_ref required');
  if (!MISSION_KINDS.includes(p.mission_kind)) errs.push('mission_kind must be group|milestone|wave|batch|run');
  if (!p.campaign?.ref) errs.push('campaign.ref required');
  if (p.campaign?.estimate) errs.push(...validateEstimate(p.campaign.estimate, 'campaign.estimate'));
  const refs = new Set(), seqs = new Set();
  const seeRef = (r, where) => { if (!r) errs.push(`${where}: ref required`); else if (refs.has(r)) errs.push(`${where}: duplicate ref ${r}`); else refs.add(r); };
  if (p.campaign?.ref) refs.add(p.campaign.ref);
  for (const m of p.missions ?? []) {
    seeRef(m.ref, 'mission');
    if (!Number.isInteger(m.sequence) || m.sequence < 1) errs.push(`mission ${m.ref}: sequence must be a positive integer`);
    else if (seqs.has(m.sequence)) errs.push(`mission ${m.ref}: duplicate sequence ${m.sequence}`); else seqs.add(m.sequence);
    if (m.estimate) errs.push(...validateEstimate(m.estimate, `mission ${m.ref}.estimate`));
    for (const t of m.tasks ?? []) {
      seeRef(t.ref, `mission ${m.ref} task`);
      if (t.story != null && !/^US-\d+$/.test(t.story)) errs.push(`task ${t.ref}: story must match US-<n>`);
      if (t.estimate) errs.push(...validateEstimate(t.estimate, `task ${t.ref}.estimate`));
    }
  }
  if (p.supersedes) {
    const vals = Object.values(p.supersedes.item_map ?? {});
    if (!p.supersedes.plan_id) errs.push('supersedes.plan_id required');
    if (new Set(vals).size !== vals.length) errs.push('supersedes.item_map must be injective');
  }
  return errs;
}

export const planIdOf = (p) => `${p.campaign_id}/${p.run_id}/${p.version}`;

export function assignIds(p) {
  const out = JSON.parse(JSON.stringify(p));
  out.campaign.item_id ??= `campaign-${slugify(out.campaign_id)}`;
  for (const m of out.missions ?? []) {
    m.item_id ??= `mission-${slugify(m.ref)}`;
    for (const t of m.tasks ?? []) t.item_id ??= `task-${slugify(t.ref)}`;
  }
  return out;
}

export function toCatalogue(p) {
  const rows = [];
  const row = (o, level, parent, extra = {}) => rows.push({
    item_id: o.item_id, ref: o.ref, level, parent_item_id: parent, story: o.story ?? null, class: o.class ?? null,
    role: o.role ?? null, branch: o.branch ?? null, sequence: o.sequence ?? null, estimate: o.estimate ?? null, ...extra,
  });
  row(p.campaign, 'campaign', null);
  for (const m of p.missions ?? []) {
    row(m, 'mission', p.campaign.item_id);
    for (const t of m.tasks ?? []) row(t, 'task', m.item_id);
  }
  return rows;
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
export const canonicalHash = (p) => sha256(JSON.stringify(sortKeys(p)));

export function savePlan(repo, rec) {
  mkdirSync(plansDir(repo), { recursive: true });
  writeFileSync(planPath(repo, rec.plan_id), `${JSON.stringify(rec, null, 2)}\n`);
}
export function loadPlan(repo, planId) {
  const p = planPath(repo, planId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
export function listPlans(repo) {
  if (!existsSync(plansDir(repo))) return [];
  return readdirSync(plansDir(repo)).filter((f) => f.endsWith('.json')).sort()
    .map((f) => loadPlan(repo, decodeSegment(f.replace(/\.json$/, '')))).filter(Boolean);
}

const estKey = (e) => (e ? JSON.stringify([e.unit, e.low, e.high, e.tier, e.accepted_by ?? null, e.accepted_at ?? null]) : null);

export function planDelta(prev, next, { keepMissing = false } = {}) {
  const prevBy = new Map(prev.map((i) => [i.item_id, i]));
  const nextBy = new Map(next.map((i) => [i.item_id, i]));
  const created = [], estimated = [], cancelled = [], reopened = [];
  for (const i of next) {
    const old = prevBy.get(i.item_id);
    if (!old) { created.push(i); if (i.estimate) estimated.push(i); continue; }
    if (old.cancelled) reopened.push(i);
    if (i.estimate && estKey(i.estimate) !== estKey(old.estimate)) estimated.push(i);
  }
  if (!keepMissing) for (const i of prev) if (!nextBy.has(i.item_id) && !i.cancelled) cancelled.push(i);
  return { created, estimated, cancelled, reopened };
}

/** Observations for one registration; identities depend only on token+item+event so retries SKIP. */
export function registrationObservations({ planRecord, delta, token, at, createdAt, createdBasis = 'observed', now = Date.now() }) {
  const common = { user: null, host: 'cli', plan: planRecord.plan_id, source: 'cli', source_record_id: token };
  const rev = (i) => (i.estimate_revision ?? 0);
  const out = [];
  for (const i of delta.created) out.push(makeObservation({ ...common, item_id: i.item_id, ref: i.ref, level: i.level,
    event: 'created', transition_id: `${i.item_id}/created/0`, at: createdAt ?? at, basis: createdBasis, meta: { created_basis: createdBasis } }, { now }));
  for (const i of delta.estimated) out.push(makeObservation({ ...common, item_id: i.item_id, ref: i.ref, level: i.level,
    event: 'estimated', transition_id: `${i.item_id}/estimated/rev-${rev(i)}`, at: i.estimate.accepted_at ?? i.estimate.proposed_at,
    estimate: i.estimate, meta: { estimate_revision: rev(i), acceptance: estimateStatus(i.estimate) } }, { now }));
  for (const i of delta.cancelled) out.push(makeObservation({ ...common, item_id: i.item_id, ref: i.ref, level: i.level,
    event: 'cancelled', transition_id: `${i.item_id}/cancelled/episode-1`, at, raw: 'removed-from-plan' }, { now }));
  for (const i of delta.reopened) out.push(makeObservation({ ...common, item_id: i.item_id, ref: i.ref, level: i.level,
    event: 'reopened', transition_id: `${i.item_id}/reopened/${planRecord.version ?? 0}`, at, raw: 're-added-to-plan' }, { now }));
  return out;
}
```

Note `estimate_revision`: the CLI (Task 5) sets `i.estimate_revision = (previous count of estimated observations for that item)` before calling `registrationObservations`, so a changed range lands as `rev-1`, `rev-2`, …

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/lib/plan.test.mjs`
Expected: 7 passing.

- [ ] **Step 5: Write the template**

`skills/delivery-metrics/templates/delivery-plan.template.json` — the `PLAN()` object from the test with placeholder strings (`"<campaign-id>"`, `"<run-1>"`, `"<Name>"`) and a `TASK-001`/`G1` example, `accepted_by: null, accepted_at: null` (so a fresh copy is visibly `unaccepted`).

- [ ] **Step 6: Commit**

```bash
git add skills/delivery-metrics/scripts/lib/plan.mjs skills/delivery-metrics/scripts/lib/plan.test.mjs skills/delivery-metrics/templates/delivery-plan.template.json
git commit -m "feat(delivery-metrics): plan block schema, catalogue, delta → registration observations"
```

---

### Task 4: `lib/plan-markdown.mjs` — tasks-file importer

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/plan-markdown.mjs`, `skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`
- Create: `skills/delivery-metrics/fixtures/plan-markdown/tasks-excerpt.md`

**Interfaces:**
- Consumes: nothing from other modules (pure text → object).
- Produces: `importTasksMarkdown(text, {campaign_id, run_id, version=1, factory='feature-development', observation_start, integration_ref='main', mission_kind='group'}) → {plan, warnings[]}` where `plan` is a canonical delivery-plan object **without estimates** (`basis: 'markdown-import'` recorded at `plan.import = {basis, task_count, group_count}`), tasks grouped into missions by the `Gn` lines of the `## 1. Execution plan` block, and any task not listed in a group placed in mission `ungrouped` (sequence = last+1) with a warning.

Input format (from `docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md`, verified): task headings `#### TASK-023: title`, a header line `**Story:** US-021 · **Assigned:** js-dev · **Depends on:** TASK-022 · **Complexity:** M` (separator `·`; `**Assigned to:**` also accepted), and in the execution-plan fenced block lines like `G12  023 build-report core + review template · 034 secure-code-review skill` — group id then task numbers (three digits) separated by `·`.

- [ ] **Step 1: Write the fixture and the failing test**

`skills/delivery-metrics/fixtures/plan-markdown/tasks-excerpt.md`:
````markdown
# excerpt — technical decomposition

## 1. Execution plan

```
G0   001 docs (M-1)                                   055 hook probe (independent, any time)
G1   003 normalize · 004 redact
G2   002 canon (needs 004: writeArtifact → redactDeep)
```

## 5. Technical tasks

### G0

#### TASK-001: Repo docs match the installer
**Story:** US-001 · **Assigned:** maintainer / js-dev · **Depends on:** none · **Complexity:** S

#### TASK-055: Hook-input probe result
**Story:** US-030 · **Assigned to:** js-dev · **Depends on:** none · **Complexity:** S

### G1

#### TASK-003: `normalize.mjs` + published test vectors
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-004: `redact.mjs` + `redaction-rules.json` v1
**Story:** US-003 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

### G2

#### TASK-002: `canon.mjs` — strict reader
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** TASK-004 · **Complexity:** L

#### TASK-099: Orphan task not in any group
**Story:** US-009 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S
````

`skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importTasksMarkdown } from './plan-markdown.mjs';
import { validatePlan } from './plan.mjs';

const text = readFileSync(new URL('../../fixtures/plan-markdown/tasks-excerpt.md', import.meta.url), 'utf8');
const opts = { campaign_id: 'sec', run_id: 'run-1', observation_start: '2026-09-15T00:00:00Z' };

test('importTasksMarkdown builds groups → missions → tasks with story/class/role and no estimates', () => {
  const { plan, warnings } = importTasksMarkdown(text, opts);
  assert.deepEqual(validatePlan(plan), []);
  assert.equal(plan.mission_kind, 'group');
  assert.deepEqual(plan.missions.map((m) => [m.ref, m.sequence, m.tasks.map((t) => t.ref)]), [
    ['G0', 1, ['TASK-001', 'TASK-055']], ['G1', 2, ['TASK-003', 'TASK-004']], ['G2', 3, ['TASK-002']], ['ungrouped', 4, ['TASK-099']]]);
  const t1 = plan.missions[0].tasks[0];
  assert.equal(t1.story, 'US-001'); assert.equal(t1.class, 'S'); assert.equal(t1.role, 'maintainer / js-dev'); assert.equal(t1.branch, 'task/task-001');
  assert.equal(plan.missions[1].tasks[1].class, 'M');
  assert.equal(plan.missions[2].tasks[0].role, 'js-dev', 'Assigned to: variant accepted');
  assert.ok(plan.missions.every((m) => m.tasks.every((t) => t.estimate == null)), 'importer never invents estimates');
  assert.equal(plan.import.basis, 'markdown-import');
  assert.equal(plan.import.task_count, 6);
  assert.match(warnings.join('\n'), /TASK-099.*not listed in any group/);
});

test('importTasksMarkdown: no tasks → empty missions and a warning', () => {
  const { plan, warnings } = importTasksMarkdown('# empty', opts);
  assert.deepEqual(plan.missions, []);
  assert.match(warnings.join('\n'), /no TASK headings/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `plan-markdown.mjs`**

```js
// STDLIB ONLY. Convenience importer: tech-lead tasks markdown → canonical delivery-plan (no estimates).
const HEAD_RE = /^####\s+(TASK-\d{3,})\s*:\s*(.*)$/;
const FIELD = (line, name) => { const m = new RegExp(`\\*\\*${name}\\s*:\\*\\*\\s*([^·\\n]+)`).exec(line); return m ? m[1].trim() : null; };
const GROUP_LINE = /^(G\d+)\s+(.+)$/;

export function importTasksMarkdown(text, {
  campaign_id, run_id, version = 1, factory = 'feature-development', observation_start,
  integration_ref = 'main', mission_kind = 'group', campaign_ref = campaign_id,
} = {}) {
  const warnings = [];
  const lines = text.split('\n');
  // 1. tasks
  const tasks = new Map();
  for (let i = 0; i < lines.length; i++) {
    const h = HEAD_RE.exec(lines[i]);
    if (!h) continue;
    const ref = h[1];
    let header = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) if (/\*\*Story:\*\*|\*\*Complexity:\*\*/.test(lines[j])) { header = lines[j]; break; }
    const num = ref.replace(/^TASK-/, '');
    tasks.set(ref, {
      ref, title: h[2].trim(), story: FIELD(header, 'Story') && /^US-\d+$/.test(FIELD(header, 'Story')) ? FIELD(header, 'Story') : null,
      class: FIELD(header, 'Complexity'), role: FIELD(header, 'Assigned to') ?? FIELD(header, 'Assigned'),
      branch: `task/task-${num}`, num,
    });
  }
  if (!tasks.size) warnings.push('no TASK headings found');
  // 2. groups (execution plan block)
  const groups = [];
  for (const line of lines) {
    const g = GROUP_LINE.exec(line.trim());
    if (!g) continue;
    const nums = [...g[2].matchAll(/(?:^|·)\s*(\d{3,})\b/g)].map((m) => m[1]);
    const alt = nums.length ? nums : [...g[2].matchAll(/\b(\d{3,})\b/g)].map((m) => m[1]);
    if (alt.length) groups.push({ ref: g[1], nums: alt });
  }
  const placed = new Set();
  const missions = groups.map((g, i) => ({
    ref: g.ref, sequence: i + 1,
    tasks: g.nums.map((n) => [...tasks.values()].find((t) => t.num === n)).filter(Boolean)
      .map((t) => { placed.add(t.ref); return strip(t); }),
  })).filter((m) => m.tasks.length);
  const rest = [...tasks.values()].filter((t) => !placed.has(t.ref));
  if (rest.length) {
    warnings.push(`${rest.map((t) => t.ref).join(', ')}: not listed in any group — placed in mission "ungrouped"`);
    missions.push({ ref: 'ungrouped', sequence: missions.length + 1, tasks: rest.map(strip) });
  }
  const plan = {
    campaign_id, run_id, version, factory, observation_start,
    source_epoch: { from: observation_start, until: null, integration_ref },
    campaign: { ref: campaign_ref }, mission_kind, missions,
    import: { basis: 'markdown-import', task_count: tasks.size, group_count: groups.length },
  };
  return { plan, warnings };
}

function strip(t) {
  const o = { ref: t.ref, title: t.title, branch: t.branch };
  if (t.story) o.story = t.story;
  if (t.class) o.class = t.class;
  if (t.role) o.role = t.role;
  return o;
}
```

If `validatePlan` rejects `import` or `title` as unknown keys, it does not — `validatePlan` only checks named fields. Keep it that way (extra keys are preserved in the saved plan for provenance).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`
Expected: 2 passing. If the `G0` line's second column (`055 hook probe …` after many spaces) is not captured by the `·` split, the fallback `\b\d{3,}\b` regex catches it — the test asserts `TASK-055` lands in G0.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/scripts/lib/plan-markdown.mjs skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs skills/delivery-metrics/fixtures/plan-markdown
git commit -m "feat(delivery-metrics): markdown tasks-file importer (no invented estimates)"
```

---

### Task 5: `scripts/delivery.mjs` — CLI: plan, session, event, profile

**Files:**
- Create: `skills/delivery-metrics/scripts/delivery.mjs`, `skills/delivery-metrics/scripts/delivery.test.mjs`
- Create: `skills/delivery-metrics/templates/profile.template.json`

**Interfaces:**
- Consumes: `paths.mjs`, `events.mjs`, `plan.mjs`, `plan-markdown.mjs`.
- Produces: the CLI surface below plus exported pure helpers `parseArgs(argv) → {cmd, sub, positional[], flags{}}`, `resolvePlanId(repo, flag) → planId` (throws `NO-PLAN` / `AMBIGUOUS-PLAN`), `resolveRef(plan, ref) → item` (throws `USAGE(unknown ref)`), `gitCommitTime(repo, sha) → {iso, sha}|null`, `cliError(code, detail)` (an `Error` with `.code` and `.exit`), `main(argv, {repo, now, stdout, stderr}) → exitCode`. Later tasks add `status`, `report`, `backfill` to the same dispatcher.

Commands in this task (spec §6.5):

| Command | Behaviour |
|---|---|
| `plan register --from <f> --id <token> [--campaign <id> --run <id> --version <n> --observation-start <iso>] [--at <iso>] [--created-at <iso>] [--keep-missing] [--dry-run] [--yes]` | If `--from` has a `delivery-plan` block → canonical path. Else markdown import (needs `--campaign`, `--run`, `--observation-start`; prints the canonical block; without `--yes` exits 0 after printing `DRY-RUN` — the importer requires an explicit `--yes`). Validate (→ `SCHEMA-INVALID(<first error>)`). `created` time: `--created-at`, else the file's first git commit (`git log --diff-filter=A --format=%cI -- <file>`, `basis: plan-commit`), else `now` (`basis: observed`). Compute delta vs the previously saved plan for the same `campaign_id/run_id` (highest version); a version ≤ existing → `USAGE(version must exceed <n>)`; a new version without `supersedes` when the previous exists → allowed only if every previous `item_id` is present or `--keep-missing` (else the missing ones are cancelled — that is the "removed scope" path; `MIGRATION-REQUIRED` only when `supersedes.item_map` maps to unknown ids). Save plan record (status `open`, `roster: [factory]`, `source: {path, sha256}`), then append each registration observation, printing `EVENT`/`SKIP`/`ID-CONFLICT` per line and finally `PLAN <plan_id> items=<n> created=<a> estimated=<b> cancelled=<c> reopened=<d> accepted=<x> unaccepted=<y> unestimated=<z>`. Exit 2 on any `ID-CONFLICT`. |
| `plan list` / `plan show --plan <id>` / `plan close --plan <id>` | list prints one line per plan `PLAN <id> status=<s> items=<n>`; show prints the JSON; close sets `status: closed`, `updated_at`. |
| `session set --host <h> --session <s> --plan <id>` | writes `sessions/<enc(host:session)>.json` `{host, session, plan, at}` (the hook guard, Task 11). |
| `event <ref> <event> --plan <id> --id <token> [--transition <t>] [--at <iso>] [--sha <sha>] [--revision <n>] [--status active\|retracted] [--raw <s>] [--note <s>]` | `<event>` ∈ `dispatched|done|cancelled|blocked|unblocked|reopened|review_requested|review_returned|review_approved|first_commit` (schema-accepted; M1 derives only the first four + `first_commit`). `--sha` → `at` = committer time, `meta.git_sha` = full sha; `--at` with a differing `--sha` → `USAGE(at and sha disagree; record a correction with --revision)`. Default `transition_id` = `<item_id>/<event>/episode-1` for `done|cancelled|reopened`, `<item_id>/<event>/<token>` for `dispatched|blocked|unblocked|review_*|first_commit`. Prints `EVENT <observation_id> <at>` / `SKIP …` (exit 0) / `ID-CONFLICT` (exit 2). |
| `event --from <jsonl> --plan <id>` | each line is `{ref, event, at?, sha?, id, transition?, raw?, revision?, status?}`; appended sequentially; the summary line is `EVENTS appended=<n> skipped=<m> conflicts=<k>`; exit 2 if any conflict. |
| `profile set --from <f>` | validates against the template's keys and writes `profile.json` (last-writer-wins). |

Errors: one stderr line `<CODE>(<detail>)`; codes/exits per Global Constraint 8.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/delivery.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './delivery.mjs';
import { deliveryDir, planPath } from './lib/paths.mjs';
import { resolveObservations } from './lib/events.mjs';

const CLI = fileURLToPath(new URL('./delivery.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-cli-'));
const run = (repo, args, { input } = {}) => {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', input, env: { ...process.env, DELIVERY_NO_SYNC: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) { return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
};
const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const initRepo = () => { const r = tmp(); git(r, 'init', '-q', '-b', 'main'); git(r, 'config', 'user.email', 't@x'); git(r, 'config', 'user.name', 'Tester'); return r; };
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tech-lead', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'Daniel', accepted_at: '2026-09-16T08:30:00Z' };
const plan = (v = 1, tasks = [{ ref: 'TASK-001', class: 'S', estimate: EST }, { ref: 'TASK-002' }]) => ({
  campaign_id: 'sec', run_id: 'run-1', version: v, factory: 'feature-development', observation_start: '2026-09-16T08:00:00Z',
  source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group',
  missions: [{ ref: 'G1', sequence: 1, tasks }],
});
const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, '# p\n```json delivery-plan\n' + JSON.stringify(p) + '\n```\n'); return f; };

test('parseArgs splits cmd/sub/positional/flags', () => {
  assert.deepEqual(parseArgs(['event', 'TASK-1', 'done', '--plan', 'p', '--keep-missing']), { cmd: 'event', sub: null, positional: ['TASK-1', 'done'], flags: { plan: 'p', 'keep-missing': true } });
  assert.deepEqual(parseArgs(['plan', 'register', '--from', 'f']).sub, 'register');
});

test('plan register: canonical block → plan file + created/estimated observations; retry SKIPs', () => {
  const repo = initRepo();
  const f = writePlan(repo, plan());
  git(repo, 'add', 'plan.md'); git(repo, 'commit', '-q', '-m', 'plan');
  const r = run(repo, ['plan', 'register', '--from', f, '--id', 'reg-1']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PLAN sec\/run-1\/1 items=4 created=4 estimated=1 cancelled=0 reopened=0 accepted=1 unaccepted=0 unestimated=3/);
  assert.ok(existsSync(planPath(repo, 'sec/run-1/1')));
  const { active } = resolveObservations(repo);
  assert.equal(active.filter((o) => o.event === 'created').length, 4);
  assert.equal(active.find((o) => o.event === 'created').basis, 'plan-commit', 'tracked file → plan commit time');
  const again = run(repo, ['plan', 'register', '--from', f, '--id', 'reg-1']);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /SKIP/);
  assert.equal(resolveObservations(repo).active.length, 5, 'nothing appended twice');
});

test('plan register: v2 cancels removed tasks, --keep-missing keeps them, lower version rejected', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const r2 = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(2, [{ ref: 'TASK-001', class: 'S', estimate: { ...EST, high: 5 } }]), 'plan2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stdout, /cancelled=1/);
  const { active } = resolveObservations(repo);
  assert.equal(active.filter((o) => o.event === 'cancelled')[0].ref, 'TASK-002');
  assert.equal(active.filter((o) => o.event === 'estimated' && o.ref === 'TASK-001').length, 2, 'changed range → rev-1');
  assert.ok(active.some((o) => o.transition_id === 'task-task-001/estimated/rev-1'));
  const r1 = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1), 'plan1.md'), '--id', 'reg-3']);
  assert.equal(r1.code, 2); assert.match(r1.stderr, /USAGE\(version/);
  const r3 = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(3, [{ ref: 'TASK-001' }]), 'plan3.md'), '--id', 'reg-4', '--at', '2026-09-18T00:00:00Z', '--keep-missing']);
  assert.match(r3.stdout, /cancelled=0/);
});

test('plan register: schema error exits 2 with SCHEMA-INVALID; markdown import needs --yes', () => {
  const repo = initRepo();
  const bad = plan(); bad.factory = 'ops';
  const r = run(repo, ['plan', 'register', '--from', writePlan(repo, bad), '--id', 'x']);
  assert.equal(r.code, 2); assert.match(r.stderr, /^SCHEMA-INVALID\(factory/);
  const md = join(repo, 'tasks.md'); writeFileSync(md, '#### TASK-001: t\n**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S\n');
  const dry = run(repo, ['plan', 'register', '--from', md, '--id', 'imp-1', '--campaign', 'sec', '--run', 'run-1', '--observation-start', '2026-09-16T00:00:00Z']);
  assert.equal(dry.code, 0); assert.match(dry.stdout, /DRY-RUN/); assert.match(dry.stdout, /"delivery-plan"|delivery-plan/); assert.ok(!existsSync(planPath(repo, 'sec/run-1/1')));
  const yes = run(repo, ['plan', 'register', '--from', md, '--id', 'imp-1', '--campaign', 'sec', '--run', 'run-1', '--observation-start', '2026-09-16T00:00:00Z', '--yes']);
  assert.equal(yes.code, 0, yes.stderr); assert.ok(existsSync(planPath(repo, 'sec/run-1/1')));
  assert.match(yes.stdout, /unestimated=3/);
});

test('event: done with --sha takes the committer time; retry SKIP; correction is a new revision; unknown ref/plan errors', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  writeFileSync(join(repo, 'a.txt'), 'a'); git(repo, 'add', 'a.txt');
  execFileSync('git', ['commit', '-q', '-m', 'TASK-001: work'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-16T12:00:00Z', GIT_AUTHOR_DATE: '2026-09-16T12:00:00Z' } });
  const sha = git(repo, 'rev-parse', 'HEAD');
  const r = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--id', 'done-1']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^EVENT cli:done-1:task-task-001:done 2026-09-16T12:00:00.000Z/);
  assert.match(run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--id', 'done-1']).stdout, /^SKIP/);
  const conflict = run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'done-1']);
  assert.equal(conflict.code, 2); assert.match(conflict.stderr, /^ID-CONFLICT/);
  const fix = run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'done-1', '--revision', '1']);
  assert.equal(fix.code, 0);
  assert.equal(resolveObservations(repo).active.find((o) => o.event === 'done').at, '2026-09-16T11:00:00.000Z');
  assert.match(run(repo, ['event', 'TASK-9', 'done', '--id', 'z']).stderr, /^USAGE\(unknown ref TASK-9/);
  assert.match(run(repo, ['event', 'TASK-1', 'merged', '--id', 'z']).stderr, /^USAGE\(unknown event/);
  const empty = initRepo();
  const np = run(empty, ['event', 'TASK-1', 'done', '--id', 'z']);
  assert.equal(np.code, 3); assert.match(np.stderr, /^NO-PLAN/);
});

test('event --from jsonl appends sequentially; session set writes the guard file; plan list/show/close', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const f = join(repo, 'ev.jsonl');
  writeFileSync(f, [JSON.stringify({ ref: 'TASK-001', event: 'dispatched', at: '2026-09-16T09:00:00Z', id: 'd1' }), JSON.stringify({ ref: 'TASK-001', event: 'done', at: '2026-09-16T10:00:00Z', id: 'd2' })].join('\n') + '\n');
  const r = run(repo, ['event', '--from', f]);
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /EVENTS appended=2 skipped=0 conflicts=0/);
  const s = run(repo, ['session', 'set', '--host', 'claude', '--session', 'sess-1', '--plan', 'sec/run-1/1']);
  assert.equal(s.code, 0);
  assert.ok(existsSync(join(deliveryDir(repo), 'sessions', 'claude%3Asess-1.json')) || existsSync(join(deliveryDir(repo), 'sessions', 'claude:sess-1.json')));
  assert.match(run(repo, ['plan', 'list']).stdout, /PLAN sec\/run-1\/1 status=open items=4/);
  assert.equal(JSON.parse(run(repo, ['plan', 'show', '--plan', 'sec/run-1/1']).stdout).campaign_id, 'sec');
  run(repo, ['plan', 'close', '--plan', 'sec/run-1/1']);
  assert.equal(JSON.parse(readFileSync(planPath(repo, 'sec/run-1/1'), 'utf8')).status, 'closed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/delivery.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `delivery.mjs`**

```js
#!/usr/bin/env node
// STDLIB ONLY. delivery-metrics CLI (spec §6.5). Thin dispatcher over scripts/lib/*.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir, nowIso, profilePath, sessionPath, sessionsDir, sha256, whoAmI } from './lib/paths.mjs';
import { EVENTS, appendObservation, makeObservation, resolveObservations } from './lib/events.mjs';
import { assignIds, canonicalHash, estimateStatus, extractPlanBlock, listPlans, loadPlan, planDelta, planIdOf, registrationObservations, savePlan, toCatalogue, validatePlan } from './lib/plan.mjs';
import { importTasksMarkdown } from './lib/plan-markdown.mjs';

export const SKILL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_EVENTS = ['dispatched', 'done', 'cancelled', 'blocked', 'unblocked', 'reopened', 'review_requested', 'review_returned', 'review_approved', 'first_commit'];
const EXIT = { USAGE: 2, 'SCHEMA-INVALID': 2, 'ID-CONFLICT': 2, 'INVALID-TRANSITION': 2, 'AMBIGUOUS-PLAN': 2, 'MIGRATION-REQUIRED': 2, 'LOCK-BUSY': 2, CONFLICT: 2, 'NO-PLAN': 3, 'NO-EVENTS': 3 };

export function cliError(code, detail) { const e = new Error(`${code}(${detail})`); e.code = code; e.exit = EXIT[code] ?? 1; return e; }

export function parseArgs(argv) {
  const out = { cmd: argv[0] ?? null, sub: null, positional: [], flags: {} };
  const rest = argv.slice(1);
  if (rest[0] && !rest[0].startsWith('--') && ['plan', 'session', 'profile'].includes(out.cmd)) out.sub = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = rest[i + 1];
      if (v === undefined || v.startsWith('--')) out.flags[k] = true; else { out.flags[k] = v; i++; }
    } else out.positional.push(a);
  }
  return out;
}

export function gitCommitTime(repo, sha) {
  try {
    const out = execFileSync('git', ['-C', repo, 'show', '-s', '--format=%H%x1f%cI', sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const [full, iso] = out.split('\x1f');
    return full && iso ? { sha: full, iso: new Date(iso).toISOString() } : null;
  } catch { return null; }
}

function firstCommitTimeOfFile(repo, file) {
  try {
    const rel = resolve(file).startsWith(resolve(repo)) ? resolve(file).slice(resolve(repo).length + 1) : file;
    const out = execFileSync('git', ['-C', repo, 'log', '--diff-filter=A', '--format=%cI', '--', rel], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    return out.length ? new Date(out[out.length - 1]).toISOString() : null;
  } catch { return null; }
}

export function resolvePlanId(repo, flag) {
  if (flag) { if (!loadPlan(repo, flag)) throw cliError('NO-PLAN', `no registered plan ${flag}`); return flag; }
  const open = listPlans(repo).filter((p) => p.status === 'open');
  if (!open.length) throw cliError('NO-PLAN', 'no open plan in this repo — run plan register');
  if (open.length > 1) throw cliError('AMBIGUOUS-PLAN', open.map((p) => p.plan_id).join(','));
  return open[0].plan_id;
}

export function resolveRef(plan, ref) {
  const hit = plan.items.filter((i) => i.ref === ref || i.item_id === ref);
  if (hit.length !== 1) throw cliError('USAGE', `unknown ref ${ref} in ${plan.plan_id}`);
  return hit[0];
}

const out = (io, s) => io.stdout.write(`${s}\n`);

function cmdPlanRegister(repo, f, io, now) {
  const file = f.from; const token = f.id;
  if (!file || !token) throw cliError('USAGE', 'plan register needs --from <file> --id <token>');
  const text = readFileSync(file, 'utf8');
  let obj = extractPlanBlock(text);
  if (!obj) {
    if (!f.campaign || !f.run || !f['observation-start']) throw cliError('USAGE', 'markdown import needs --campaign --run --observation-start');
    const { plan, warnings } = importTasksMarkdown(text, { campaign_id: f.campaign, run_id: f.run, version: Number(f.version ?? 1), observation_start: f['observation-start'], integration_ref: f['integration-ref'] ?? 'main' });
    for (const w of warnings) io.stderr.write(`WARN ${w}\n`);
    obj = plan;
    if (!f.yes) { out(io, '```json delivery-plan'); out(io, JSON.stringify(obj, null, 2)); out(io, '```'); out(io, `DRY-RUN plan ${planIdOf(obj)} — re-run with --yes to register`); return 0; }
  }
  const errs = validatePlan(obj);
  if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  const full = assignIds(obj);
  const planId = planIdOf(full);
  const items = toCatalogue(full);
  const prevAll = listPlans(repo).filter((p) => p.campaign_id === full.campaign_id && p.run_id === full.run_id);
  const prev = prevAll.sort((a, b) => b.version - a.version)[0] ?? null;
  if (prev && full.version <= prev.version) throw cliError('USAGE', `version must exceed ${prev.version} for ${full.campaign_id}/${full.run_id}`);
  if (full.supersedes?.item_map) {
    const known = new Set((prev?.items ?? []).map((i) => i.item_id));
    for (const old of Object.keys(full.supersedes.item_map)) if (!known.has(old)) throw cliError('MIGRATION-REQUIRED', `supersedes maps unknown item ${old}`);
  }
  const at = f.at ? new Date(f.at).toISOString() : nowIso(now);
  const { active } = resolveObservations(repo);
  for (const i of items) i.estimate_revision = active.filter((o) => o.plan.startsWith(`${full.campaign_id}/${full.run_id}/`) && o.item_id === i.item_id && o.event === 'estimated').length;
  const delta = planDelta(prev?.items ?? [], items, { keepMissing: Boolean(f['keep-missing']) });
  if (f['dry-run']) { out(io, `DRY-RUN ${planId} created=${delta.created.length} estimated=${delta.estimated.length} cancelled=${delta.cancelled.length}`); return 0; }
  let createdAt = f['created-at'] ? new Date(f['created-at']).toISOString() : null; let createdBasis = 'observed';
  if (!createdAt) { const c = firstCommitTimeOfFile(repo, file); if (c) { createdAt = c; createdBasis = 'plan-commit'; } else createdAt = at; }
  const rec = {
    plan_id: planId, campaign_id: full.campaign_id, run_id: full.run_id, version: full.version, factory: full.factory, status: 'open',
    registered_at: nowIso(now), updated_at: nowIso(now), observation_start: full.observation_start, source_epoch: full.source_epoch,
    mission_kind: full.mission_kind, source: { path: file, sha256: sha256(text) }, canonical_sha256: canonicalHash(full), roster: [full.factory],
    import: full.import ?? null, supersedes: full.supersedes ?? null,
    items: items.map((i) => ({ ...i, cancelled: false })).concat((prev?.items ?? []).filter((i) => !items.some((n) => n.item_id === i.item_id)).map((i) => ({ ...i, cancelled: !f['keep-missing'] || i.cancelled }))),
    versions: [...(prev?.versions ?? []), { version: full.version, at, canonical_sha256: canonicalHash(full) }],
  };
  mkdirSync(deliveryDir(repo), { recursive: true });
  savePlan(repo, rec);
  const recs = registrationObservations({ planRecord: rec, delta, token, at, createdAt, createdBasis, now });
  let conflicts = 0;
  for (const r of recs) { const res = appendObservation(repo, r, { now }); out(io, `${res.result} ${res.observation_id}`); if (res.result === 'ID-CONFLICT') conflicts++; }
  const st = items.map((i) => estimateStatus(i.estimate));
  out(io, `PLAN ${planId} items=${items.length} created=${delta.created.length} estimated=${delta.estimated.length} cancelled=${delta.cancelled.length} reopened=${delta.reopened.length} accepted=${st.filter((s) => s === 'accepted').length} unaccepted=${st.filter((s) => s === 'unaccepted').length} unestimated=${st.filter((s) => s === 'none').length}`);
  if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} registration observation(s) conflict with existing records`);
  return 0;
}

function buildEvent(repo, plan, item, ev, f, token, now) {
  if (!CLI_EVENTS.includes(ev) || !EVENTS.includes(ev)) throw cliError('USAGE', `unknown event ${ev}; expected one of ${CLI_EVENTS.join('|')}`);
  let at = f.at ? new Date(f.at).toISOString() : null; const meta = {};
  if (f.sha) {
    const c = gitCommitTime(repo, f.sha);
    if (!c) throw cliError('USAGE', `cannot resolve commit ${f.sha}`);
    if (at && at !== c.iso) throw cliError('USAGE', 'at and sha disagree; record a correction with --revision');
    at = c.iso; meta.git_sha = c.sha;
  }
  if (!at) at = nowIso(now);
  if (f.note) meta.note = String(f.note);
  const episodic = ['done', 'cancelled', 'reopened'].includes(ev);
  const transition = f.transition ?? (episodic ? `${item.item_id}/${ev}/episode-1` : `${item.item_id}/${ev}/${token}`);
  return makeObservation({ user: null, host: 'cli', plan: plan.plan_id, item_id: item.item_id, ref: item.ref, level: item.level, event: ev,
    transition_id: transition, source: 'cli', source_record_id: token, at, revision: f.revision != null ? Number(f.revision) : 0,
    status: f.status ?? 'active', raw: f.raw ?? null, meta }, { now });
}

function cmdEvent(repo, p, io, now) {
  const planId = resolvePlanId(repo, p.flags.plan); const plan = loadPlan(repo, planId);
  if (p.flags.from) {
    let appended = 0, skipped = 0, conflicts = 0;
    for (const line of readFileSync(p.flags.from, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      const item = resolveRef(plan, j.ref);
      const rec = buildEvent(repo, plan, item, j.event, { at: j.at, sha: j.sha, transition: j.transition, raw: j.raw, revision: j.revision, status: j.status, note: j.note }, j.id, now);
      const res = appendObservation(repo, rec, { now });
      if (res.result === 'EVENT') appended++; else if (res.result === 'SKIP') skipped++; else conflicts++;
      out(io, `${res.result} ${res.observation_id} ${rec.at}`);
    }
    out(io, `EVENTS appended=${appended} skipped=${skipped} conflicts=${conflicts}`);
    if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} conflicting line(s)`);
    return 0;
  }
  const [ref, ev] = p.positional;
  if (!ref || !ev || !p.flags.id) throw cliError('USAGE', 'event <ref> <event> --id <token> [--plan <id>]');
  const item = resolveRef(plan, ref);
  const rec = buildEvent(repo, plan, item, ev, p.flags, p.flags.id, now);
  const res = appendObservation(repo, rec, { now });
  out(io, `${res.result} ${res.observation_id} ${rec.at}`);
  if (res.result === 'ID-CONFLICT') throw cliError('ID-CONFLICT', `${res.observation_id} rev ${res.revision} exists with different content; use --revision ${res.revision + 1}`);
  return 0;
}

function cmdPlan(repo, p, io, now) {
  const f = p.flags;
  if (p.sub === 'register') return cmdPlanRegister(repo, f, io, now);
  if (p.sub === 'list') { for (const pl of listPlans(repo)) out(io, `PLAN ${pl.plan_id} status=${pl.status} items=${pl.items.length}`); return 0; }
  const id = resolvePlanId(repo, f.plan); const pl = loadPlan(repo, id);
  if (p.sub === 'show') { out(io, JSON.stringify(pl, null, 2)); return 0; }
  if (p.sub === 'close') { pl.status = 'closed'; pl.updated_at = nowIso(now); savePlan(repo, pl); out(io, `PLAN ${id} status=closed`); return 0; }
  throw cliError('USAGE', `plan ${p.sub ?? ''}: expected register|list|show|close`);
}

function cmdSession(repo, p, io, now) {
  const f = p.flags;
  if (p.sub !== 'set' || !f.host || !f.session || !f.plan) throw cliError('USAGE', 'session set --host <h> --session <s> --plan <id>');
  resolvePlanId(repo, f.plan);
  mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(sessionPath(repo, f.host, f.session), `${JSON.stringify({ host: f.host, session: f.session, plan: f.plan, at: nowIso(now) })}\n`);
  out(io, `SESSION ${f.host}:${f.session} -> ${f.plan}`);
  return 0;
}

function cmdProfile(repo, p, io) {
  if (p.sub !== 'set' || !p.flags.from) throw cliError('USAGE', 'profile set --from <file>');
  const tpl = JSON.parse(readFileSync(resolve(SKILL_ROOT, 'templates', 'profile.template.json'), 'utf8'));
  const obj = JSON.parse(readFileSync(p.flags.from, 'utf8'));
  for (const k of Object.keys(obj)) if (!(k in tpl)) throw cliError('SCHEMA-INVALID', `profile.${k} is not a known key`);
  mkdirSync(deliveryDir(repo), { recursive: true });
  writeFileSync(profilePath(repo), `${JSON.stringify({ ...tpl, ...obj }, null, 2)}\n`);
  out(io, 'PROFILE written (last-writer-wins)');
  return 0;
}

export const COMMANDS = { plan: cmdPlan, session: cmdSession, event: cmdEvent, profile: cmdProfile };

export function bestEffortSync(repo, env = process.env) {
  if (env.DELIVERY_NO_SYNC === '1') return { synced: false, reason: 'DELIVERY_NO_SYNC' };
  const tel = resolve(repo, '.agents', 'telemetry');
  if (!existsSync(resolve(tel, '.git'))) return { synced: false, reason: 'no telemetry submodule' };
  const g = (...a) => execFileSync('git', ['-C', tel, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
  try {
    g('add', '-A');
    if (g('status', '--porcelain')) g('commit', '-q', '-m', `delivery-metrics: ${new Date().toISOString()}`);
    try { g('push', '-q'); } catch { return { synced: false, reason: 'push failed — retried next time' }; }
    return { synced: true };
  } catch (e) { return { synced: false, reason: e.message.split('\n')[0] }; }
}

export async function main(argv = process.argv.slice(2), { repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), now = Date.now(), stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const io = { stdout, stderr };
  const p = parseArgs(argv);
  const fn = COMMANDS[p.cmd];
  if (!fn) { stderr.write(`USAGE(unknown command ${p.cmd ?? ''}; expected ${Object.keys(COMMANDS).join('|')})\n`); return 2; }
  try {
    const code = await fn(repo, p, io, now);
    if (['plan', 'event', 'session', 'profile', 'backfill', 'sync'].includes(p.cmd) && !p.flags['dry-run']) { const s = bestEffortSync(repo, env); if (!s.synced && s.reason !== 'DELIVERY_NO_SYNC' && s.reason !== 'no telemetry submodule') stderr.write(`WARN sync: ${s.reason}\n`); }
    return code;
  } catch (e) {
    if (e.code && e.exit) { stderr.write(`${e.message}\n`); return e.exit; }
    stderr.write(`INTERNAL(${e.message})\n`); return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c));
```

`skills/delivery-metrics/templates/profile.template.json`:
```json
{ "capturePrompts": false, "zeroDurationSec": 60, "minWholeWeeks": 3,
  "baselines": { "cycle_time_task_h": null, "cycle_time_mission_h": null, "throughput_task_per_week": null, "first_pass_rate": null, "hit_rate": null },
  "tokenomics": "auto" }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/delivery.test.mjs`
Expected: 6 passing. If the `sessions/` filename assertion fails, check `encodeSegment` — `:` is not encoded, so the file is `claude:sess-1.json`; either branch of the assertion accepts it.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/scripts/delivery.mjs skills/delivery-metrics/scripts/delivery.test.mjs skills/delivery-metrics/templates/profile.template.json
git commit -m "feat(delivery-metrics): CLI — plan register/list/show/close, event, session set, profile set"
```

---

### Task 6: `lib/timeline.mjs` — source precedence, per-item state, rollups

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/timeline.mjs`, `skills/delivery-metrics/scripts/lib/timeline.test.mjs`

**Interfaces:**
- Consumes: `events.mjs` (`SOURCE_RANK`), `plan.mjs` (`estimateStatus`).
- Produces:
  - `selectOccurrences(observations) → {occurrences: occ[], conflicts: [{item_id, transition_id, basis, sources}], counts}` — D6: group active observations by `(plan, item_id, transition_id, basis)`; take the lowest `SOURCE_RANK` present; if the records at that rank disagree on `(at, event, meta.result, estimate)` → CONFLICT (occurrence dropped, lower ranks NOT used); else one `occ = {item_id, ref, level, plan, event, at, basis, transition_id, source, estimate, meta, provenance: [{source, observation_id, at}]}` keeping every source in `provenance`.
  - `buildTimelines({occurrences, plan, end}) → {items: Map<item_id, Item>, counts: {unregistered, deferredEvents, parentIncomplete, clockSkew}}` where `Item` is:
    ```
    { item_id, ref, level, parent_item_id, class, role, story, sequence, cancelled_in_plan,
      created_at, created_basis, estimates: [{revision, at, estimate, status}], estimate_original, estimate_latest,
      started_at, start_basis: 'observed'|'derived-child'|null, first_commit_at,
      done_at, done_basis: 'observed'|'derived-child'|null, cancelled_at,
      state: 'planned'|'in_progress'|'done'|'cancelled', reopen_count, dispatch_count,
      children: [item_id], child_summary: {done, cancelled, open, unknown}, flags: [] }
    ```
    Rules: only occurrences with `at < end` are replayed. `dispatched` qualifies as the cycle start only when `meta.stage` is absent or `build`; other stages increment `dispatch_count` only. `first_commit` sets `first_commit_at` (WIP proxy, never a start). First `done` sets `done_at` (observed); a later `reopened` sets `state = in_progress` and `reopen_count++` without erasing `done_at`. `cancelled` → `cancelled` unless already done. `blocked/unblocked/review_*/rework_observed/scope_declared/gate_observed/outcome_observed/review_history` → counted in `deferredEvents` (M1 does not derive them). `done_at < started_at` → flag `clock-skew`. Rollup for `mission`/`campaign`: `started_at = min(child.started_at)` with `start_basis: 'derived-child'` unless an explicit observed `dispatched` exists; completion: an explicit observed `done` with a non-terminal child → flag `PARENT-INCOMPLETE`, state stays `in_progress`, `done_at` cleared (`parentIncomplete++`); otherwise when every child is terminal and ≥ 1 is done → `done_at = max(child terminal at)`, `done_basis: 'derived-child'`; all children cancelled → `cancelled`; a child with no occurrence at all → `child_summary.unknown++` and the parent stays open; cancelled + done children → flag `partial-cancelled`.
  - `estimateOriginal(estimates) → est|null` (first with `status === 'accepted'`), `estimateLatest(estimates, before) → est|null` (latest accepted with `at < before`, same unit as the original).

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/timeline.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeObservation } from './events.mjs';
import { selectOccurrences, buildTimelines, estimateOriginal, estimateLatest } from './timeline.mjs';

const P = 'sec/run-1/1';
const plan = {
  plan_id: P, items: [
    { item_id: 'campaign-sec', ref: 'sec', level: 'campaign', parent_item_id: null },
    { item_id: 'mission-g1', ref: 'G1', level: 'mission', parent_item_id: 'campaign-sec', sequence: 1 },
    { item_id: 'task-a', ref: 'TASK-A', level: 'task', parent_item_id: 'mission-g1', class: 'S' },
    { item_id: 'task-b', ref: 'TASK-B', level: 'task', parent_item_id: 'mission-g1', class: 'M' },
  ],
};
const item = (id) => plan.items.find((i) => i.item_id === id);
const obs = (id, event, at, over = {}) => makeObservation({
  user: 'u', host: 'cli', plan: P, item_id: id, ref: item(id).ref, level: item(id).level, event, at,
  transition_id: over.transition_id ?? `${id}/${event}/episode-1`, source: over.source ?? 'cli', source_record_id: over.token ?? `${event}-${id}-${over.source ?? 'cli'}`,
  meta: over.meta ?? {}, estimate: over.estimate, basis: over.basis,
}, { now: 0 });
const EST = (over = {}) => ({ unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-14T00:00:00Z', accepted_by: 'D', accepted_at: '2026-09-15T00:00:00Z', ...over });
const END = '2026-09-30T00:00:00Z';

test('selectOccurrences: cli beats git for the same occurrence in both arrival orders; git kept in provenance', () => {
  const g = obs('task-a', 'done', '2026-09-16T12:00:00Z', { source: 'git' });
  const c = obs('task-a', 'done', '2026-09-16T11:00:00Z', { source: 'cli' });
  for (const order of [[g, c], [c, g]]) {
    const { occurrences, conflicts } = selectOccurrences(order);
    assert.equal(conflicts.length, 0);
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].at, '2026-09-16T11:00:00.000Z');
    assert.equal(occurrences[0].source, 'cli');
    assert.deepEqual(occurrences[0].provenance.map((p) => p.source).sort(), ['cli', 'git']);
  }
});

test('selectOccurrences: equal-rank disagreement → CONFLICT, no fallback to git', () => {
  const g = obs('task-a', 'done', '2026-09-16T12:00:00Z', { source: 'git' });
  const c1 = obs('task-a', 'done', '2026-09-16T11:00:00Z', { source: 'cli', token: 't1' });
  const c2 = obs('task-a', 'done', '2026-09-16T10:00:00Z', { source: 'cli', token: 't2' });
  const { occurrences, conflicts } = selectOccurrences([g, c1, c2]);
  assert.equal(occurrences.length, 0);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].transition_id, 'task-a/done/episode-1');
  const c3 = obs('task-a', 'done', '2026-09-16T11:00:00Z', { source: 'cli', token: 't3' });
  assert.equal(selectOccurrences([c1, c3]).occurrences.length, 1, 'equivalent facts from two cli records coalesce');
});

test('buildTimelines: spec §12 actual-selection example (lead 50 h, cycle 2 h) and first_commit is only a proxy', () => {
  const o = [
    obs('task-a', 'created', '2026-09-14T09:00:00Z'),
    obs('task-a', 'estimated', '2026-09-15T00:00:00Z', { transition_id: 'task-a/estimated/rev-0', estimate: EST(), meta: { estimate_revision: 0, acceptance: 'accepted' } }),
    obs('task-a', 'first_commit', '2026-09-16T08:00:00Z', { source: 'git', transition_id: 'task-a/first_commit/0' }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: 'task-a/dispatched/agent-1', meta: { stage: 'build' } }),
    obs('task-a', 'dispatched', '2026-09-16T10:30:00Z', { source: 'hook', transition_id: 'task-a/dispatched/agent-2', meta: { stage: 'review' } }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z'),
  ];
  const { items } = buildTimelines({ occurrences: selectOccurrences(o).occurrences, plan, end: END });
  const a = items.get('task-a');
  assert.equal(a.created_at, '2026-09-14T09:00:00.000Z');
  assert.equal(a.first_commit_at, '2026-09-16T08:00:00.000Z');
  assert.equal(a.started_at, '2026-09-16T09:00:00.000Z'); assert.equal(a.start_basis, 'observed');
  assert.equal(a.done_at, '2026-09-16T11:00:00.000Z'); assert.equal(a.state, 'done');
  assert.equal(a.dispatch_count, 2, 'review dispatch counted as activity, not start');
  assert.equal(a.estimate_original.low, 1);
  const b = items.get('task-b');
  assert.equal(b.state, 'planned'); assert.equal(b.started_at, null);
});

test('buildTimelines: no dispatch → started_at null, cutoff excludes future, reopen keeps first done', () => {
  const o = [
    obs('task-a', 'created', '2026-09-14T09:00:00Z'), obs('task-a', 'first_commit', '2026-09-16T08:00:00Z', { source: 'git', transition_id: 'task-a/first_commit/0' }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z'), obs('task-a', 'reopened', '2026-09-17T09:00:00Z', { transition_id: 'task-a/reopened/1' }),
    obs('task-b', 'created', '2026-09-14T09:00:00Z'), obs('task-b', 'done', '2026-10-05T00:00:00Z'),
  ];
  const { items } = buildTimelines({ occurrences: selectOccurrences(o).occurrences, plan, end: END });
  const a = items.get('task-a');
  assert.equal(a.started_at, null); assert.equal(a.done_at, '2026-09-16T11:00:00.000Z'); assert.equal(a.state, 'in_progress'); assert.equal(a.reopen_count, 1);
  assert.equal(items.get('task-b').state, 'planned', 'done after cutoff not replayed');
});

test('buildTimelines: rollups — derived start, all-terminal completion, partial-cancelled, PARENT-INCOMPLETE, unknown child', () => {
  const base = [obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-b', 'created', '2026-09-14T00:00:00Z'),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { transition_id: 'task-a/dispatched/x', source: 'hook' }), obs('task-a', 'done', '2026-09-16T11:00:00Z')];
  let r = buildTimelines({ occurrences: selectOccurrences(base).occurrences, plan, end: END });
  let m = r.items.get('mission-g1');
  assert.equal(m.started_at, '2026-09-16T09:00:00.000Z'); assert.equal(m.start_basis, 'derived-child');
  assert.equal(m.state, 'in_progress'); assert.equal(m.child_summary.unknown, 0); assert.equal(m.child_summary.open, 1);
  r = buildTimelines({ occurrences: selectOccurrences([...base, obs('task-b', 'dispatched', '2026-09-16T10:00:00Z', { transition_id: 'task-b/dispatched/y', source: 'hook' }), obs('task-b', 'done', '2026-09-17T13:00:00Z')]).occurrences, plan, end: END });
  m = r.items.get('mission-g1');
  assert.equal(m.state, 'done'); assert.equal(m.done_at, '2026-09-17T13:00:00.000Z'); assert.equal(m.done_basis, 'derived-child');
  assert.equal(r.items.get('campaign-sec').state, 'done', 'single mission done → campaign done');
  r = buildTimelines({ occurrences: selectOccurrences([...base, obs('task-b', 'cancelled', '2026-09-17T00:00:00Z')]).occurrences, plan, end: END });
  m = r.items.get('mission-g1');
  assert.equal(m.state, 'done'); assert.ok(m.flags.includes('partial-cancelled')); assert.equal(m.child_summary.cancelled, 1);
  r = buildTimelines({ occurrences: selectOccurrences([...base, obs('mission-g1', 'done', '2026-09-16T12:00:00Z')]).occurrences, plan, end: END });
  m = r.items.get('mission-g1');
  assert.equal(m.state, 'in_progress'); assert.ok(m.flags.includes('PARENT-INCOMPLETE')); assert.equal(r.counts.parentIncomplete, 1);
  r = buildTimelines({ occurrences: selectOccurrences([obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-a', 'done', '2026-09-15T00:00:00Z')]).occurrences, plan, end: END });
  assert.equal(r.items.get('mission-g1').child_summary.unknown, 1, 'task-b has no events at all');
  assert.equal(r.items.get('mission-g1').state, 'in_progress');
});

test('estimateOriginal / estimateLatest', () => {
  const es = [
    { revision: 0, at: '2026-09-15T00:00:00.000Z', estimate: EST({ accepted_by: null, accepted_at: null }), status: 'unaccepted' },
    { revision: 1, at: '2026-09-15T12:00:00.000Z', estimate: EST(), status: 'accepted' },
    { revision: 2, at: '2026-09-16T12:00:00.000Z', estimate: EST({ high: 5 }), status: 'accepted' },
  ];
  assert.equal(estimateOriginal(es).high, 3);
  assert.equal(estimateLatest(es, '2026-09-16T09:00:00.000Z').high, 3, 'rev 2 accepted after the start is not eligible');
  assert.equal(estimateLatest(es, '2026-09-17T00:00:00.000Z').high, 5);
  assert.equal(estimateOriginal([es[0]]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/timeline.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `timeline.mjs`**

```js
// STDLIB ONLY. Occurrence selection (spec D6) and per-item timelines with parent rollups (spec §5, §6.9).
import { SOURCE_RANK } from './events.mjs';
import { estimateStatus } from './plan.mjs';

const START_STAGES = new Set([undefined, null, 'build']);
const DEFERRED = new Set(['blocked', 'unblocked', 'review_requested', 'review_returned', 'review_approved', 'review_history', 'rework_observed', 'scope_declared', 'gate_observed', 'outcome_observed']);
const factKey = (o) => JSON.stringify([o.at, o.event, o.meta?.result ?? null, o.estimate ?? null]);

export function selectOccurrences(observations) {
  const groups = new Map();
  for (const o of observations) {
    if (o.status !== 'active') continue;
    const k = JSON.stringify([o.plan, o.item_id ?? '', o.transition_id, o.basis]);
    (groups.get(k) ?? groups.set(k, []).get(k)).push(o);
  }
  const occurrences = [], conflicts = [];
  for (const recs of groups.values()) {
    const best = Math.min(...recs.map((r) => SOURCE_RANK[r.source] ?? 99));
    const top = recs.filter((r) => (SOURCE_RANK[r.source] ?? 99) === best);
    const facts = new Set(top.map(factKey));
    const first = top[0];
    if (facts.size > 1) { conflicts.push({ item_id: first.item_id, transition_id: first.transition_id, basis: first.basis, sources: top.map((r) => r.observation_id) }); continue; }
    occurrences.push({
      item_id: first.item_id, ref: first.ref, level: first.level, plan: first.plan, event: first.event, at: first.at, basis: first.basis,
      transition_id: first.transition_id, source: first.source, estimate: first.estimate, meta: first.meta ?? {},
      provenance: recs.map((r) => ({ source: r.source, observation_id: r.observation_id, at: r.at })),
    });
  }
  occurrences.sort((a, b) => a.at.localeCompare(b.at) || a.transition_id.localeCompare(b.transition_id));
  return { occurrences, conflicts, counts: { occurrences: occurrences.length, conflicts: conflicts.length } };
}

export const estimateOriginal = (es) => es.find((e) => e.status === 'accepted')?.estimate ?? null;
export function estimateLatest(es, before) {
  const orig = estimateOriginal(es);
  if (!orig) return null;
  const ok = es.filter((e) => e.status === 'accepted' && e.estimate.unit === orig.unit && (!before || e.at < before));
  return ok.length ? ok[ok.length - 1].estimate : null;
}

const newItem = (i) => ({
  item_id: i.item_id, ref: i.ref, level: i.level, parent_item_id: i.parent_item_id ?? null, class: i.class ?? null, role: i.role ?? null,
  story: i.story ?? null, sequence: i.sequence ?? null, cancelled_in_plan: Boolean(i.cancelled),
  created_at: null, created_basis: null, estimates: [], estimate_original: null, estimate_latest: null,
  started_at: null, start_basis: null, first_commit_at: null, done_at: null, done_basis: null, cancelled_at: null,
  state: 'planned', reopen_count: 0, dispatch_count: 0, children: [], child_summary: { done: 0, cancelled: 0, open: 0, unknown: 0 }, flags: [], seen: false,
});

export function buildTimelines({ occurrences, plan, end }) {
  const endIso = new Date(end).toISOString();
  const items = new Map(plan.items.map((i) => [i.item_id, newItem(i)]));
  for (const i of items.values()) if (i.parent_item_id && items.has(i.parent_item_id)) items.get(i.parent_item_id).children.push(i.item_id);
  const counts = { unregistered: 0, deferredEvents: 0, parentIncomplete: 0, clockSkew: 0 };
  const explicitDone = new Set();
  for (const o of occurrences) {
    if (o.at >= endIso) continue;
    const it = items.get(o.item_id);
    if (!it) { counts.unregistered++; continue; }
    it.seen = true;
    switch (o.event) {
      case 'created': if (!it.created_at) { it.created_at = o.at; it.created_basis = o.basis; } break;
      case 'estimated': it.estimates.push({ revision: o.meta.estimate_revision ?? it.estimates.length, at: o.at, estimate: o.estimate, status: estimateStatus(o.estimate) }); break;
      case 'dispatched':
        it.dispatch_count++;
        if (START_STAGES.has(o.meta.stage) && !it.started_at) { it.started_at = o.at; it.start_basis = 'observed'; }
        if (it.state === 'planned') it.state = 'in_progress';
        break;
      case 'first_commit': if (!it.first_commit_at) it.first_commit_at = o.at; if (it.state === 'planned') it.state = 'in_progress'; break;
      case 'done':
        if (['mission', 'campaign'].includes(it.level)) explicitDone.add(it.item_id);
        if (!it.done_at) { it.done_at = o.at; it.done_basis = 'observed'; }
        it.state = 'done'; break;
      case 'cancelled': if (!it.cancelled_at) it.cancelled_at = o.at; if (it.state !== 'done') it.state = 'cancelled'; break;
      case 'reopened': it.reopen_count++; it.state = 'in_progress'; break;
      case 'dispatch_ended': break;
      default: if (DEFERRED.has(o.event)) counts.deferredEvents++;
    }
  }
  for (const it of items.values()) {
    it.estimates.sort((a, b) => a.revision - b.revision);
    it.estimate_original = estimateOriginal(it.estimates);
  }
  for (const level of ['mission', 'campaign']) {
    for (const it of items.values()) {
      if (it.level !== level) continue;
      const kids = it.children.map((id) => items.get(id)).filter((k) => !k.cancelled_in_plan);
      const starts = kids.map((k) => k.started_at).filter(Boolean).sort();
      if (!it.started_at && starts.length) { it.started_at = starts[0]; it.start_basis = 'derived-child'; if (it.state === 'planned') it.state = 'in_progress'; }
      const s = { done: 0, cancelled: 0, open: 0, unknown: 0 };
      for (const k of kids) { if (k.state === 'done') s.done++; else if (k.state === 'cancelled') s.cancelled++; else if (k.seen || k.children.length) s.open++; else s.unknown++; }
      it.child_summary = s;
      const allTerminal = kids.length > 0 && s.open === 0 && s.unknown === 0;
      if (explicitDone.has(it.item_id) && !allTerminal) { it.flags.push('PARENT-INCOMPLETE'); it.state = 'in_progress'; it.done_at = null; it.done_basis = null; counts.parentIncomplete++; }
      else if (!explicitDone.has(it.item_id) && allTerminal) {
        if (s.done === 0) { it.state = 'cancelled'; it.cancelled_at = kids.map((k) => k.cancelled_at).filter(Boolean).sort().pop() ?? null; }
        else { it.state = 'done'; it.done_at = kids.map((k) => k.done_at ?? k.cancelled_at).filter(Boolean).sort().pop(); it.done_basis = 'derived-child'; }
      }
      if (s.cancelled > 0 && s.done > 0) it.flags.push('partial-cancelled');
      if (it.state !== 'planned' || starts.length) it.seen = true;
    }
  }
  for (const it of items.values()) {
    it.estimate_latest = estimateLatest(it.estimates, it.started_at);
    if (it.started_at && it.done_at && it.done_at < it.started_at) { it.flags.push('clock-skew'); counts.clockSkew++; }
    delete it.seen;
  }
  return { items, counts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/lib/timeline.test.mjs`
Expected: 6 passing. Watch the "unknown child" case: `task-b` counts as `unknown` only when it has no occurrence at all (the `seen` flag) and as `open` once it has any; a mission with a started child is itself `seen` so the campaign counts it `open`, not `unknown`.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/scripts/lib/timeline.mjs skills/delivery-metrics/scripts/lib/timeline.test.mjs
git commit -m "feat(delivery-metrics): occurrence selection (D6) and item timelines with parent rollups"
```

---

### Task 7: `lib/metrics.mjs` — cycle time, throughput/velocity, estimate accuracy, coverage

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/metrics.mjs`, `skills/delivery-metrics/scripts/lib/metrics.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (`cmdPlanRegister` items mapping — add `version_added`)

**Interfaces:**
- Consumes: `timeline.mjs` `Item` objects.
- Produces:
  - `hoursBetween(aIso, bIso) → number` (2 dp), `nearestRank(sorted, q)`, `stats(values) → {n, min, max, median, p85, p90, samples}` — `median` only when n ≥ 5, `p85` n ≥ 7, `p90` n ≥ 10, else `null`; `samples` = sorted values when n < 5.
  - `isoWeekUtc(iso) → 'YYYY-Www'`, `weekStartUtc(iso) → Date` (Monday 00:00 UTC), `weekKeys(since, end) → [{key, start, end, whole}]`.
  - `computeMetrics({items, plan, since, end, profile, estimateBase='original'}) → data` with shape:
    ```
    { window: {since, end}, cohorts: {completed: n, created: n},
      flow: { [level]: { cycle_time: stats|null, commit_to_done: stats|null, lead_time: stats|null, parent_elapsed: stats|null,
                         excluded: {clock_skew, retrospective_plan_proxy, missing_start} } },
      throughput: { [level]: { weeks: [{key, count, whole, partial}], velocity: {median, mean, whole_weeks, n}|null, caveat } },
      wip: { [level]: n }, mission_turnaround: { pairs: [{from, to, gap_h|null, overlap_h|null}], stats: stats|null },
      estimates: { [level]: { n, eligible, work_ratio: stats, mdmre, pred25, mae, hit_rate: {hits, ranged, rate},
                              excluded: {unestimated, unaccepted, late_accepted, missing_actual, point, unit_mismatch} } },
      schedule_variance: [{item_id, ref, level, estimate: {low, high}, actual_h, band: {low_delta, high_delta}, scope: {added, removed}}],
      coverage: { [level]: { done, with_dispatched, with_first_commit, with_created, start_source: {observed, derived-child, none} } },
      caveats: [string] }
    ```
    Rules: completion cohort = items with `done_at` in `[since, end)` and state not `cancelled`; `cycle_time` uses `start_basis === 'observed'`; mission/campaign elapsed with `start_basis === 'derived-child'` goes to `parent_elapsed` (never pooled); `commit_to_done` only when `started_at == null && first_commit_at`; `lead_time` needs `created_at`; items flagged `clock-skew` excluded from all durations; a `lead_time` with `created_basis === 'plan-commit'` and elapsed ≤ `profile.zeroDurationSec` is excluded as `retrospective_plan_proxy`; throughput counts each item's first `done_at` once per UTC ISO week, zero-filled from `weekStartUtc(since)` to `end`, first/last week `partial` when not fully inside `[since,end)`; `velocity` = median of whole-week counts when `whole_weeks ≥ profile.minWholeWeeks`, else `null` with caveat `velocity(<level>): <k> whole weeks < <min> — null`; estimate actual for unit `h`: task → `cycle_time` (observed start only), mission/campaign → `parent_elapsed`; `active_min` estimates → `unit_mismatch` in M1 (no tokenomics join); `accepted_at ≥ started_at` → `late_accepted`; `low === high` → `point` (excluded from hit rate, kept in ratio); `mdmre` = median of `|actual − midpoint| / actual` (actual 0 excluded, counted), `pred25` = share with MRE ≤ 0.25, `mae` = mean `|actual − midpoint|`, `hit` = `low ≤ actual ≤ high`; `schedule_variance` for missions/campaigns with an eligible estimate: `low_delta = actual − low`, `high_delta = actual − high`, `scope.added` = children with `version_added > 1`, `scope.removed` = children `cancelled_in_plan`.
  - `caveats` are generated from the numbers (never static text).

- [ ] **Step 1: Add `version_added` to the plan catalogue (delivery.mjs)**

In `cmdPlanRegister`, change the `items:` mapping to carry `version_added`:
```js
items: items.map((i) => ({ ...i, cancelled: false, version_added: (prev?.items ?? []).find((p) => p.item_id === i.item_id)?.version_added ?? full.version }))
  .concat((prev?.items ?? []).filter((i) => !items.some((n) => n.item_id === i.item_id)).map((i) => ({ ...i, cancelled: !f['keep-missing'] || i.cancelled }))),
```
And in `timeline.mjs` `newItem`, add `version_added: i.version_added ?? 1,`. Run `node --test skills/delivery-metrics` — still green.

- [ ] **Step 2: Write the failing test**

`skills/delivery-metrics/scripts/lib/metrics.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursBetween, stats, isoWeekUtc, weekKeys, computeMetrics } from './metrics.mjs';

const PROFILE = { zeroDurationSec: 60, minWholeWeeks: 3 };
const EST = (low, high, over = {}) => ({ unit: 'h', low, high, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-01T00:00:00Z', accepted_by: 'D', accepted_at: '2026-09-01T00:00:00Z', ...over });
const item = (o) => ({ item_id: o.id, ref: o.id, level: o.level ?? 'task', parent_item_id: o.parent ?? null, class: o.class ?? null, role: null, story: null, sequence: o.sequence ?? null,
  cancelled_in_plan: Boolean(o.cancelled_in_plan), version_added: o.version_added ?? 1, created_at: o.created ?? null, created_basis: o.created_basis ?? 'observed', estimates: [],
  estimate_original: o.est ?? null, estimate_latest: o.est ?? null, started_at: o.started ?? null, start_basis: o.started ? (o.start_basis ?? 'observed') : null,
  first_commit_at: o.commit ?? null, done_at: o.done ?? null, done_basis: o.done ? 'observed' : null, cancelled_at: null, state: o.state ?? (o.done ? 'done' : (o.started ? 'in_progress' : 'planned')),
  reopen_count: 0, dispatch_count: o.started ? 1 : 0, children: o.children ?? [], child_summary: { done: 0, cancelled: 0, open: 0, unknown: 0 }, flags: o.flags ?? [] });
const toMap = (arr) => new Map(arr.map((i) => [i.item_id, i]));

test('hoursBetween / stats floors / nearest rank', () => {
  assert.equal(hoursBetween('2026-09-16T09:00:00Z', '2026-09-16T11:30:00Z'), 2.5);
  const s4 = stats([4, 1, 3, 2]);
  assert.equal(s4.n, 4); assert.equal(s4.median, null); assert.deepEqual(s4.samples, [1, 2, 3, 4]); assert.equal(s4.min, 1); assert.equal(s4.max, 4);
  const s7 = stats([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(s7.median, 4); assert.equal(s7.p85, 6, 'nearest rank: ceil(0.85*7)=6 → 6th value'); assert.equal(s7.p90, null);
  const s10 = stats([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(s10.p90, 9); assert.equal(s10.p85, 9); assert.equal(s10.median, 5);
});

test('isoWeekUtc across a year boundary and weekKeys partial/whole flags', () => {
  assert.equal(isoWeekUtc('2026-01-01T00:00:00Z'), '2026-W01');
  assert.equal(isoWeekUtc('2027-01-01T00:00:00Z'), '2026-W53');
  assert.equal(isoWeekUtc('2026-09-16T23:59:59Z'), '2026-W38');
  const ks = weekKeys('2026-09-09T12:00:00Z', '2026-09-28T00:00:00Z'); // Wed → Mon
  assert.deepEqual(ks.map((k) => [k.key, k.whole]), [['2026-W37', false], ['2026-W38', true], ['2026-W39', true]]);
  const ks2 = weekKeys('2026-09-14T00:00:00Z', '2026-09-30T00:00:00Z');
  assert.deepEqual(ks2.map((k) => [k.key, k.whole]), [['2026-W38', true], ['2026-W39', true], ['2026-W40', false]]);
});

test('computeMetrics: hand-computed flow, throughput, estimates, coverage', () => {
  const items = toMap([
    item({ id: 'c', level: 'campaign', children: ['m1', 'm2'], created: '2026-09-01T00:00:00Z' }),
    item({ id: 'm1', level: 'mission', parent: 'c', sequence: 1, children: ['t1', 't2', 't3'], started: '2026-09-07T09:00:00Z', start_basis: 'derived-child', done: '2026-09-09T17:00:00Z', est: EST(40, 60), created: '2026-09-01T00:00:00Z' }),
    item({ id: 'm2', level: 'mission', parent: 'c', sequence: 2, children: ['t4', 't5', 't6'], started: '2026-09-10T09:00:00Z', start_basis: 'derived-child', state: 'in_progress', created: '2026-09-01T00:00:00Z' }),
    // t1: created Mon 09:00, commit Wed 08:00, dispatch Wed 09:00, done Wed 11:00 → lead 50 h, cycle 2 h; est 1–3 accepted before → ratio 1, hit
    item({ id: 't1', parent: 'm1', class: 'S', created: '2026-09-07T09:00:00Z', commit: '2026-09-09T08:00:00Z', started: '2026-09-09T09:00:00Z', done: '2026-09-09T11:00:00Z', est: EST(1, 3) }),
    // t2: no dispatch, commit→done 3 h → commit_to_done; estimate → missing_actual
    item({ id: 't2', parent: 'm1', class: 'S', created: '2026-09-07T09:00:00Z', commit: '2026-09-09T14:00:00Z', done: '2026-09-09T17:00:00Z', est: EST(1, 3) }),
    // t3: cycle 4 h, est 1–3 → ratio 2, miss; late-accepted variant excluded
    item({ id: 't3', parent: 'm1', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T13:00:00Z', est: EST(1, 3, { accepted_at: '2026-09-08T10:00:00Z' }) }),
    // t4: cycle 6 h, unestimated
    item({ id: 't4', parent: 'm2', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-10T09:00:00Z', done: '2026-09-10T15:00:00Z' }),
    // t5: clock-skew → excluded from durations, counted in throughput
    item({ id: 't5', parent: 'm2', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-11T12:00:00Z', done: '2026-09-11T09:00:00Z', flags: ['clock-skew'] }),
    // t6: open, WIP; point estimate
    item({ id: 't6', parent: 'm2', class: 'L', created: '2026-09-07T09:00:00Z', started: '2026-09-14T09:00:00Z', est: EST(2, 2) }),
    // t7: retrospective plan proxy: created (plan-commit) 30 s before done
    item({ id: 't7', parent: 'm2', class: 'S', created: '2026-09-12T10:00:00Z', created_basis: 'plan-commit', done: '2026-09-12T10:00:30Z' }),
  ]);
  const d = computeMetrics({ items, plan: { plan_id: 'p', items: [...items.values()] }, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  // flow
  assert.equal(d.flow.task.cycle_time.n, 3, 't1, t3, t4 (t5 skewed, t2 no start)');
  assert.deepEqual(d.flow.task.cycle_time.samples, [2, 4, 6]);
  assert.deepEqual(d.flow.task.commit_to_done.samples, [3]);
  assert.equal(d.flow.task.lead_time.n, 4, 't1..t4 (t5 skewed, t7 retrospective)');
  assert.equal(d.flow.task.excluded.clock_skew, 1);
  assert.equal(d.flow.task.excluded.retrospective_plan_proxy, 1);
  assert.equal(d.flow.mission.cycle_time, null, 'derived-child never pooled into cycle_time');
  assert.deepEqual(d.flow.mission.parent_elapsed.samples, [56]);
  // throughput: done in W37 (t1,t2,t3,t4,t5,t7 = 6), W38 (0), W39 partial? end is Mon 21st 00:00 → W37, W38 whole
  const tw = d.throughput.task.weeks;
  assert.deepEqual(tw.map((w) => [w.key, w.count, w.whole]), [['2026-W37', 6, true], ['2026-W38', 0, true]]);
  assert.equal(d.throughput.task.velocity, null);
  assert.match(d.throughput.task.caveat, /2 whole weeks < 3/);
  assert.equal(d.throughput.mission.weeks[0].count, 1);
  assert.equal(d.wip.task, 1, 't6');
  // estimates (original base)
  const e = d.estimates.task;
  assert.equal(e.eligible, 1, 'only t1: t2 missing_actual, t3 late_accepted, t4 unestimated, t6 open, t7 unestimated');
  assert.equal(e.excluded.missing_actual, 1); assert.equal(e.excluded.late_accepted, 1); assert.equal(e.excluded.unestimated, 3);
  assert.deepEqual(e.work_ratio.samples, [1]); assert.equal(e.mdmre, 0); assert.equal(e.pred25, 1); assert.equal(e.mae, 0);
  assert.deepEqual(e.hit_rate, { hits: 1, ranged: 1, rate: 1 });
  const em = d.estimates.mission;
  assert.equal(em.eligible, 1); assert.deepEqual(em.work_ratio.samples, [1.12]);
  assert.equal(d.schedule_variance[0].ref, 'm1');
  assert.deepEqual(d.schedule_variance[0].band, { low_delta: 16, high_delta: -4 });
  // turnaround: m1 done Wed 9th 17:00 → m2 start Thu 10th 09:00 = 16 h
  assert.deepEqual(d.mission_turnaround.pairs, [{ from: 'm1', to: 'm2', gap_h: 16, overlap_h: null }]);
  // coverage
  assert.equal(d.coverage.task.done, 6); assert.equal(d.coverage.task.with_dispatched, 4); assert.equal(d.coverage.task.start_source.none, 2);
  assert.ok(d.caveats.some((c) => /velocity\(task\)/.test(c)));
});

test('computeMetrics: velocity over ≥3 whole weeks, mission overlap gives null gap + overlap', () => {
  const items = toMap([
    item({ id: 'm1', level: 'mission', sequence: 1, started: '2026-09-01T00:00:00Z', start_basis: 'derived-child', done: '2026-09-20T00:00:00Z' }),
    item({ id: 'm2', level: 'mission', sequence: 2, started: '2026-09-15T00:00:00Z', start_basis: 'derived-child', done: '2026-09-25T00:00:00Z' }),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => item({ id: `t${i}`, started: '2026-09-01T00:00:00Z', done: `2026-09-${String(i + 6).padStart(2, '0')}T12:00:00Z` })),
  ]);
  const d = computeMetrics({ items, plan: { plan_id: 'p', items: [...items.values()] }, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE });
  assert.deepEqual(d.throughput.task.weeks.map((w) => [w.key, w.count, w.whole]), [['2026-W36', 0, true], ['2026-W37', 7, true], ['2026-W38', 0, true], ['2026-W39', 0, true]]);
  assert.deepEqual(d.throughput.task.velocity, { median: 0, mean: 1.75, whole_weeks: 4, n: 4 });
  assert.deepEqual(d.mission_turnaround.pairs, [{ from: 'm1', to: 'm2', gap_h: null, overlap_h: 120 }]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/metrics.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `metrics.mjs`**

```js
// STDLIB ONLY. Metrics (spec §6.10) over timeline items. Every figure carries n; no mean headline; caveats from numbers.
const r2 = (x) => Math.round(x * 100) / 100;
export const hoursBetween = (a, b) => r2((Date.parse(b) - Date.parse(a)) / 3600000);
export const nearestRank = (sorted, q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];

export function stats(values) {
  const s = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return { n, min: s[0], max: s[n - 1], median: n >= 5 ? nearestRank(s, 0.5) : null, p85: n >= 7 ? nearestRank(s, 0.85) : null,
    p90: n >= 10 ? nearestRank(s, 0.9) : null, samples: n < 5 ? s : undefined };
}

export function weekStartUtc(iso) {
  const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}
export function isoWeekUtc(iso) {
  const d = new Date(iso);
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3));
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function weekKeys(since, end) {
  const s = Date.parse(since), e = Date.parse(end);
  const out = [];
  for (let w = weekStartUtc(since); w.getTime() < e; w = new Date(w.getTime() + 7 * 86400000)) {
    const next = w.getTime() + 7 * 86400000;
    out.push({ key: isoWeekUtc(w.toISOString()), start: w.toISOString(), end: new Date(next).toISOString(), whole: w.getTime() >= s && next <= e });
  }
  return out;
}

const LEVELS = ['campaign', 'mission', 'task', 'case'];
const inWin = (t, since, end) => t != null && t >= since && t < end;

export function computeMetrics({ items, plan, since, end, profile = {}, estimateBase = 'original' }) {
  const zero = profile.zeroDurationSec ?? 60, minWeeks = profile.minWholeWeeks ?? 3;
  const sinceIso = new Date(since).toISOString(), endIso = new Date(end).toISOString();
  const all = [...items.values()];
  const completed = all.filter((i) => inWin(i.done_at, sinceIso, endIso) && i.state !== 'cancelled');
  const caveats = [];
  const data = { window: { since: sinceIso, end: endIso }, cohorts: { completed: completed.length, created: all.filter((i) => inWin(i.created_at, sinceIso, endIso)).length },
    flow: {}, throughput: {}, wip: {}, mission_turnaround: { pairs: [], stats: null }, estimates: {}, schedule_variance: [], coverage: {}, caveats };
  const weeks = weekKeys(sinceIso, endIso);
  for (const level of LEVELS) {
    const done = completed.filter((i) => i.level === level);
    const lvAll = all.filter((i) => i.level === level);
    if (!lvAll.length) continue;
    const ex = { clock_skew: 0, retrospective_plan_proxy: 0, missing_start: 0 };
    const cyc = [], c2d = [], lead = [], parent = [];
    for (const i of done) {
      if (i.flags.includes('clock-skew')) { ex.clock_skew++; continue; }
      if (i.started_at && i.start_basis === 'observed') cyc.push(hoursBetween(i.started_at, i.done_at));
      else if (i.started_at && i.start_basis === 'derived-child') parent.push(hoursBetween(i.started_at, i.done_at));
      else if (i.first_commit_at) c2d.push(hoursBetween(i.first_commit_at, i.done_at));
      else ex.missing_start++;
      if (i.created_at) {
        const h = hoursBetween(i.created_at, i.done_at);
        if (i.created_basis === 'plan-commit' && h * 3600 <= zero) ex.retrospective_plan_proxy++; else lead.push(h);
      }
    }
    data.flow[level] = { cycle_time: stats(cyc), commit_to_done: stats(c2d), lead_time: stats(lead), parent_elapsed: stats(parent), excluded: ex };
    // throughput
    const counts = weeks.map((w) => ({ key: w.key, count: done.filter((i) => i.done_at >= w.start && i.done_at < w.end).length, whole: w.whole, partial: !w.whole }));
    const whole = counts.filter((w) => w.whole).map((w) => w.count);
    let velocity = null, caveat = null;
    if (whole.length >= minWeeks) velocity = { median: nearestRank([...whole].sort((a, b) => a - b), 0.5), mean: r2(whole.reduce((a, b) => a + b, 0) / whole.length), whole_weeks: whole.length, n: whole.length };
    else { caveat = `velocity(${level}): ${whole.length} whole weeks < ${minWeeks} — null`; caveats.push(caveat); }
    data.throughput[level] = { weeks: counts, velocity, caveat };
    data.wip[level] = lvAll.filter((i) => i.state === 'in_progress' && !i.cancelled_in_plan).length;
    // estimates
    const est = { n: 0, eligible: 0, work_ratio: null, mdmre: null, pred25: null, mae: null, hit_rate: { hits: 0, ranged: 0, rate: null },
      excluded: { unestimated: 0, unaccepted: 0, late_accepted: 0, missing_actual: 0, point: 0, unit_mismatch: 0, zero_actual: 0 } };
    const ratios = [], mres = [], aes = [];
    for (const i of done) {
      if (i.flags.includes('clock-skew')) continue;
      const e = estimateBase === 'latest' ? i.estimate_latest : i.estimate_original;
      if (!e) { if (i.estimates.length) est.excluded.unaccepted++; else est.excluded.unestimated++; continue; }
      est.n++;
      if (e.unit !== 'h') { est.excluded.unit_mismatch++; continue; }
      const actual = i.started_at ? hoursBetween(i.started_at, i.done_at) : null;
      if (actual == null) { est.excluded.missing_actual++; continue; }
      if (e.accepted_at && new Date(e.accepted_at).toISOString() >= i.started_at) { est.excluded.late_accepted++; continue; }
      est.eligible++;
      const mid = (e.low + e.high) / 2;
      if (mid > 0) ratios.push(r2(actual / mid));
      aes.push(Math.abs(actual - mid));
      if (actual > 0) mres.push(Math.abs(actual - mid) / actual); else est.excluded.zero_actual++;
      if (e.low === e.high) est.excluded.point++; else { est.hit_rate.ranged++; if (actual >= e.low && actual <= e.high) est.hit_rate.hits++; }
      if (level !== 'task') data.schedule_variance.push({ item_id: i.item_id, ref: i.ref, level, estimate: { low: e.low, high: e.high }, actual_h: actual,
        band: { low_delta: r2(actual - e.low), high_delta: r2(actual - e.high) },
        scope: { added: i.children.map((c) => items.get(c)).filter((c) => c && c.version_added > 1).length, removed: i.children.map((c) => items.get(c)).filter((c) => c && c.cancelled_in_plan).length } });
    }
    est.work_ratio = stats(ratios);
    if (mres.length) { const s = [...mres].sort((a, b) => a - b); est.mdmre = r2(nearestRank(s, 0.5)); est.pred25 = r2(mres.filter((m) => m <= 0.25).length / mres.length); }
    if (aes.length) est.mae = r2(aes.reduce((a, b) => a + b, 0) / aes.length);
    if (est.hit_rate.ranged) est.hit_rate.rate = r2(est.hit_rate.hits / est.hit_rate.ranged);
    data.estimates[level] = est;
    // coverage
    data.coverage[level] = { done: done.length, with_dispatched: done.filter((i) => i.started_at && i.start_basis === 'observed').length,
      with_first_commit: done.filter((i) => i.first_commit_at).length, with_created: done.filter((i) => i.created_at).length,
      start_source: { observed: done.filter((i) => i.start_basis === 'observed').length, 'derived-child': done.filter((i) => i.start_basis === 'derived-child').length, none: done.filter((i) => !i.started_at).length } };
    if (done.length && data.coverage[level].with_dispatched === 0) caveats.push(`${level}: no observed dispatch start — cycle_time absent, commit_to_done shown instead`);
  }
  // mission turnaround
  const missions = all.filter((i) => i.level === 'mission' && i.sequence != null).sort((a, b) => a.sequence - b.sequence);
  const gaps = [];
  for (let k = 1; k < missions.length; k++) {
    const a = missions[k - 1], b = missions[k];
    if (!b.started_at) continue;
    if (a.done_at && a.done_at <= b.started_at) { const g = hoursBetween(a.done_at, b.started_at); gaps.push(g); data.mission_turnaround.pairs.push({ from: a.ref, to: b.ref, gap_h: g, overlap_h: null }); }
    else data.mission_turnaround.pairs.push({ from: a.ref, to: b.ref, gap_h: null, overlap_h: a.done_at ? hoursBetween(b.started_at, a.done_at) : null });
  }
  data.mission_turnaround.stats = stats(gaps);
  return data;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/scripts/lib/metrics.test.mjs`
Expected: 4 passing. Hand-check the fixture numbers against the code before "fixing" a test: `m1` elapsed = Mon 7th 09:00 → Wed 9th 17:00 = 56 h, midpoint 50 → ratio 1.12; `m1`/`m2` overlap in test 4 = 15th → 20th = 120 h.

- [ ] **Step 6: Commit**

```bash
git add skills/delivery-metrics/scripts/lib/metrics.mjs skills/delivery-metrics/scripts/lib/metrics.test.mjs skills/delivery-metrics/scripts/delivery.mjs skills/delivery-metrics/scripts/lib/timeline.mjs
git commit -m "feat(delivery-metrics): metrics — cycle/lead/commit_to_done, UTC-week throughput+velocity, estimate accuracy, coverage"
```

---

### Task 8: `lib/report.mjs` + `report` / `status` commands

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/report.mjs`, `skills/delivery-metrics/scripts/lib/report.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (add `report`, `status` to `COMMANDS`), `skills/delivery-metrics/scripts/delivery.test.mjs` (two tests)

**Interfaces:**
- Consumes: `events.mjs` (`resolveObservations`), `timeline.mjs`, `metrics.mjs`, `plan.mjs` (`listPlans`, `loadPlan`), `paths.mjs` (`profilePath`, `nowIso`, `sha256`).
- Produces:
  - `loadProfile(repo) → profile` (template defaults merged with `profile.json`).
  - `assemble(repo, {plans: [id]|null, since, until, cutoff, now, estimateBase}) → reportDoc` where `reportDoc = { envelope, plans: [{plan_id, status, metrics, counts, items:[compact item rows]}] }` and `envelope = { generated_at, cutoff, window: {since, until, effective_end, requested: {...}}, git_sha, is_working_tree, plans, sources: {events_files:[{path, sha256}], plans:[{path, sha256}], tokenomics: 'absent'}, policy: {weeks:'UTC ISO', percentile:'nearest-rank', floors:{median:5,p85:7,p90:10}, zeroDurationSec, minWholeWeeks, estimate_base, history:'corrected-effective-time'}, coverage: {malformed_lines, unknown_version, retries, superseded, retracted, conflicts, unregistered, deferred_events, parent_incomplete, clock_skew, concurrency:'best-effort'}, caveats: [], baselines }`. Window rules (spec §6.9): `end = min(until, cutoff)`; `cutoff` defaults to `now`; `until` defaults to `cutoff`; `since` defaults to the earliest `observation_start` of the selected plans; `since ≥ end` → `USAGE(since must precede end)`.
  - `renderMarkdown(reportDoc) → string` — sections in order: header line, **Flow Time**, **Throughput**, **Quality** (M1: `cancelled_share`, `reopen_count`, `deferred-events` note), **Estimates**, **Coverage & caveats**, **Open items**. Every number with `n`; `null` renders as `—` with the reason (`n<5`, `no baseline`, `not measured`); never the word `mean` in a headline row.
  - `renderStatus(reportDoc) → string` — one screen: per open plan, per level `done/in_progress/planned/cancelled` counts, WIP ages (`work_item_age` = `started_at → end` for open items), conflicts/unregistered/malformed counts, and "missing events the git backfill could fill" (done items without `created`/`first_commit`).
  - CLI: `report [--plan <id>…] [--since] [--until] [--cutoff] [--level] [--json] [--out <f>] [--from-json <f>] [--latest-estimate]` (`--html` and `--calibrate` → `USAGE(not in M1)`); `status [--plan <id>]`. `--from-json` re-renders the archived doc without recomputation and refuses `--since/--until/--cutoff/--plan/--latest-estimate` (`USAGE(--from-json rejects recomputation flags)`). `report` prints `REPORT <path>` when `--out` is given, else the markdown/JSON itself. Exit 3 `NO-PLAN` when no plan matches; `NO-EVENTS(window)` when the selected plans have zero observations before `end` (the doc is still produced with zero cohorts when there are observations but none in the window — "known zero throughput remains measurable").

- [ ] **Step 1: Write the failing tests**

`skills/delivery-metrics/scripts/lib/report.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendObservation, makeObservation } from './events.mjs';
import { savePlan } from './plan.mjs';
import { assemble, renderMarkdown, renderStatus, loadProfile } from './report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-report-'));
const P = 'sec/run-1/1';
const seed = (repo) => {
  savePlan(repo, { plan_id: P, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-07T00:00:00Z', items: [
    { item_id: 'campaign-sec', ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: 'mission-g1', ref: 'G1', level: 'mission', parent_item_id: 'campaign-sec', sequence: 1 },
    { item_id: 'task-a', ref: 'TASK-A', level: 'task', parent_item_id: 'mission-g1', class: 'S' }, { item_id: 'task-b', ref: 'TASK-B', level: 'task', parent_item_id: 'mission-g1', class: 'M' }] });
  const o = (id, ref, level, event, at, over = {}) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: P, item_id: id, ref, level, event, at, transition_id: `${id}/${event}/${over.t ?? 'episode-1'}`, source: over.source ?? 'cli', source_record_id: `${event}-${id}`, meta: over.meta ?? {} }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-a', 'TASK-A', 'task', 'created', '2026-09-07T09:00:00Z'); o('task-b', 'TASK-B', 'task', 'created', '2026-09-07T09:00:00Z');
  o('task-a', 'TASK-A', 'task', 'dispatched', '2026-09-09T09:00:00Z', { source: 'hook', t: 'agent-1' }); o('task-a', 'TASK-A', 'task', 'done', '2026-09-09T11:00:00Z');
  o('task-b', 'TASK-B', 'task', 'dispatched', '2026-09-10T09:00:00Z', { source: 'hook', t: 'agent-2' });
};
const NOW = Date.parse('2026-09-21T00:00:00Z');

test('assemble: envelope, window defaults, metrics per plan, coverage counts', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  assert.equal(doc.envelope.window.since, '2026-09-07T00:00:00.000Z', 'defaults to observation_start');
  assert.equal(doc.envelope.window.effective_end, '2026-09-21T00:00:00.000Z');
  assert.equal(doc.envelope.policy.weeks, 'UTC ISO'); assert.equal(doc.envelope.coverage.concurrency, 'best-effort');
  assert.equal(doc.envelope.sources.tokenomics, 'absent');
  assert.equal(doc.envelope.baselines.cycle_time_task_h, null);
  assert.equal(doc.plans.length, 1);
  const m = doc.plans[0].metrics;
  assert.deepEqual(m.flow.task.cycle_time.samples, [2]);
  assert.equal(m.wip.task, 1);
  assert.equal(doc.plans[0].items.find((i) => i.ref === 'TASK-B').state, 'in_progress');
  assert.throws(() => assemble(repo, { now: NOW, since: '2026-09-22T00:00:00Z' }), /USAGE\(since/);
  assert.throws(() => assemble(repo, { now: NOW, plans: ['nope/x/1'] }), /NO-PLAN/);
});

test('renderMarkdown: sections, n beside figures, null as em-dash with reason, no byPerson/mean headline', () => {
  const repo = tmp(); seed(repo);
  const md = renderMarkdown(assemble(repo, { now: NOW }));
  for (const h of ['## Flow Time', '## Throughput', '## Quality', '## Estimates', '## Coverage & caveats', '## Open items']) assert.ok(md.includes(h), h);
  assert.match(md, /cycle_time[^\n]*n=1/);
  assert.match(md, /velocity[^\n]*— \(2 whole weeks < 3\)/);
  assert.ok(!/byPerson/i.test(md));
  assert.ok(!/^\|\s*mean/m.test(md));
  assert.match(md, /no baseline/);
});

test('renderStatus: one-screen counts and open ages; loadProfile merges template', () => {
  const repo = tmp(); seed(repo);
  const s = renderStatus(assemble(repo, { now: NOW }));
  assert.match(s, /STATUS sec\/run-1\/1/);
  assert.match(s, /task: done=1 in_progress=1 planned=0 cancelled=0/);
  assert.match(s, /TASK-B[^\n]*age=254(\.0+)?h/);
  assert.equal(loadProfile(repo).minWholeWeeks, 3);
});
```

Add to `skills/delivery-metrics/scripts/delivery.test.mjs`:
```js
test('report/status commands: markdown, --json + --from-json byte-identical render, --out, NO-PLAN', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  run(repo, ['event', 'TASK-001', 'dispatched', '--at', '2026-09-16T09:00:00Z', '--id', 'd1']);
  run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'd2']);
  const md = run(repo, ['report', '--cutoff', '2026-09-21T00:00:00Z']);
  assert.equal(md.code, 0, md.stderr); assert.match(md.stdout, /## Flow Time/);
  const js = run(repo, ['report', '--json', '--cutoff', '2026-09-21T00:00:00Z', '--out', join(repo, 'r.json')]);
  assert.match(js.stdout, /^REPORT /);
  const doc = JSON.parse(readFileSync(join(repo, 'r.json'), 'utf8'));
  assert.equal(doc.plans[0].metrics.flow.task.cycle_time.samples[0], 2);
  const re = run(repo, ['report', '--from-json', join(repo, 'r.json')]);
  const again = run(repo, ['report', '--from-json', join(repo, 'r.json')]);
  assert.equal(re.stdout, again.stdout);
  assert.match(run(repo, ['report', '--from-json', join(repo, 'r.json'), '--since', '2026-01-01']).stderr, /USAGE\(--from-json/);
  assert.match(run(repo, ['status']).stdout, /STATUS sec\/run-1\/1/);
  assert.equal(run(initRepo(), ['report']).code, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test skills/delivery-metrics/scripts/lib/report.test.mjs skills/delivery-metrics/scripts/delivery.test.mjs`
Expected: report tests fail with module not found; the new CLI test fails with `USAGE(unknown command report`.

- [ ] **Step 3: Write `report.mjs`**

```js
// STDLIB ONLY. Assemble + render (spec §6.11). --from-json re-renders without recomputation.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveObservations } from './events.mjs';
import { computeMetrics, hoursBetween } from './metrics.mjs';
import { listPlans, loadPlan } from './plan.mjs';
import { deliveryDir, nowIso, planPath, profilePath, sha256 } from './paths.mjs';
import { buildTimelines, selectOccurrences } from './timeline.mjs';

const TEMPLATE = resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'templates', 'profile.template.json');
const usage = (d) => { const e = new Error(`USAGE(${d})`); e.code = 'USAGE'; e.exit = 2; return e; };
const noPlan = (d) => { const e = new Error(`NO-PLAN(${d})`); e.code = 'NO-PLAN'; e.exit = 3; return e; };

export function loadProfile(repo) {
  const tpl = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  if (!existsSync(profilePath(repo))) return tpl;
  try { return { ...tpl, ...JSON.parse(readFileSync(profilePath(repo), 'utf8')) }; } catch { return tpl; }
}

function gitInfo(repo) {
  const g = (...a) => { try { return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const sha = g('rev-parse', 'HEAD');
  return { git_sha: sha, is_working_tree: sha ? Boolean(g('status', '--porcelain')) : null };
}

const compact = (i) => ({ item_id: i.item_id, ref: i.ref, level: i.level, class: i.class, state: i.state, created_at: i.created_at, started_at: i.started_at, start_basis: i.start_basis,
  first_commit_at: i.first_commit_at, done_at: i.done_at, done_basis: i.done_basis, cancelled_at: i.cancelled_at, reopen_count: i.reopen_count, dispatch_count: i.dispatch_count,
  estimate: i.estimate_original, flags: i.flags });

export function assemble(repo, { plans = null, since = null, until = null, cutoff = null, now = Date.now(), estimateBase = 'original' } = {}) {
  const all = listPlans(repo);
  const selected = plans ? plans.map((id) => { const p = loadPlan(repo, id); if (!p) throw noPlan(`no registered plan ${id}`); return p; }) : all;
  if (!selected.length) throw noPlan('no registered plan in this repo');
  const cutoffIso = cutoff ? new Date(cutoff).toISOString() : nowIso(now);
  const untilIso = until ? new Date(until).toISOString() : cutoffIso;
  const end = untilIso < cutoffIso ? untilIso : cutoffIso;
  const sinceIso = since ? new Date(since).toISOString() : selected.map((p) => p.observation_start).filter(Boolean).sort()[0] ?? '1970-01-01T00:00:00.000Z';
  if (sinceIso >= end) throw usage(`since ${sinceIso} must precede end ${end}`);
  const profile = loadProfile(repo);
  const res = resolveObservations(repo);
  const { occurrences, conflicts } = selectOccurrences(res.active);
  const docs = [];
  const cov = { unregistered: 0, deferred_events: 0, parent_incomplete: 0, clock_skew: 0 };
  for (const p of selected) {
    const occ = occurrences.filter((o) => o.plan === p.plan_id);
    const { items, counts } = buildTimelines({ occurrences: occ, plan: p, end });
    for (const k of Object.keys(counts)) cov[k.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)] += counts[k];
    const metrics = computeMetrics({ items, plan: p, since: sinceIso, end, profile, estimateBase });
    docs.push({ plan_id: p.plan_id, status: p.status, observations: occ.length, metrics, counts, items: [...items.values()].map(compact) });
  }
  const dir = deliveryDir(repo);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^events-.*\.jsonl$/.test(f)).map((f) => ({ path: join(dir, f), sha256: sha256(readFileSync(join(dir, f), 'utf8')) })) : [];
  const caveats = docs.flatMap((d) => d.metrics.caveats.map((c) => `${d.plan_id}: ${c}`));
  if (res.counts.malformed) caveats.push(`${res.counts.malformed} malformed ledger line(s) skipped — capture loss possible`);
  if (conflicts.length) caveats.push(`${conflicts.length} occurrence(s) in CONFLICT (equal-rank disagreement) — excluded, no fallback`);
  if (cov.unregistered) caveats.push(`${cov.unregistered} observation(s) for unregistered items — excluded`);
  if (cov.parent_incomplete) caveats.push(`${cov.parent_incomplete} explicit parent done with unfinished children (PARENT-INCOMPLETE)`);
  const envelope = {
    generated_at: nowIso(now), cutoff: cutoffIso, window: { since: sinceIso, until: untilIso, effective_end: end, requested: { since, until, cutoff } },
    ...gitInfo(repo), plans: selected.map((p) => p.plan_id),
    sources: { events_files: files, plans: selected.map((p) => ({ path: planPath(repo, p.plan_id), sha256: p.canonical_sha256 ?? null })), tokenomics: 'absent' },
    policy: { weeks: 'UTC ISO', percentile: 'nearest-rank', floors: { median: 5, p85: 7, p90: 10 }, zeroDurationSec: profile.zeroDurationSec, minWholeWeeks: profile.minWholeWeeks, estimate_base: estimateBase, history: 'corrected-effective-time' },
    coverage: { malformed_lines: res.counts.malformed, unknown_version: res.counts.unknownVersion, retries: res.counts.retries, superseded: res.counts.superseded, retracted: res.counts.retracted,
      conflicts: conflicts.length, conflict_list: conflicts, ...cov, concurrency: 'best-effort' },
    caveats, baselines: profile.baselines ?? {},
  };
  return { envelope, plans: docs };
}

const H = (v, unit = 'h') => (v == null ? '—' : `${v}${unit}`);
const statRow = (name, s, reason = 'not measured') => (s ? `| ${name} | n=${s.n} | ${s.median == null ? `— (n<5)` : H(s.median)} | ${s.p85 == null ? '— (n<7)' : H(s.p85)} | ${H(s.min)}–${H(s.max)} |${s.samples ? ` samples ${s.samples.join(', ')} |` : ''}` : `| ${name} | — (${reason}) | | | |`);

export function renderMarkdown(doc) {
  const e = doc.envelope; const L = [];
  L.push(`# Delivery report`, '', `generated ${e.generated_at} · cutoff ${e.cutoff} · window [${e.window.since}, ${e.window.effective_end}) · sha ${e.git_sha ?? '—'}${e.is_working_tree ? ' (dirty)' : ''} · plans ${e.plans.join(', ')}`, '');
  for (const p of doc.plans) {
    const m = p.metrics;
    L.push(`## Plan ${p.plan_id} (${p.status}) — completed ${m.cohorts.completed}, created ${m.cohorts.created}`, '');
    L.push('## Flow Time', '', '| metric | n | median | P85 | min–max |', '|---|---|---|---|---|');
    for (const [lv, f] of Object.entries(m.flow)) {
      L.push(statRow(`${lv} cycle_time (observed dispatch → done)`, f.cycle_time, lv === 'task' ? 'no observed dispatch' : 'parents use parent_elapsed'));
      if (f.parent_elapsed) L.push(statRow(`${lv} parent_elapsed (derived-child start → completion)`, f.parent_elapsed));
      if (f.commit_to_done) L.push(statRow(`${lv} commit_to_done (first commit → done; NOT cycle time)`, f.commit_to_done));
      L.push(statRow(`${lv} lead_time (created → done; plan-tracked, not idea-to-done)`, f.lead_time));
      const ex = Object.entries(f.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
      if (ex) L.push(`| ${lv} excluded | ${ex} | | | |`);
    }
    L.push('', '## Throughput', '');
    for (const [lv, t] of Object.entries(m.throughput)) {
      L.push(`- ${lv} per UTC ISO week: ${t.weeks.map((w) => `${w.key}=${w.count}${w.partial ? '*' : ''}`).join(' ')}${t.weeks.some((w) => w.partial) ? ' (*partial)' : ''}`);
      L.push(`- ${lv} velocity (median items/whole week): ${t.velocity ? `${t.velocity.median} (n=${t.velocity.n} whole weeks)` : `— (${t.caveat.replace(/^velocity\([a-z]+\): /, '').replace(' — null', '')})`}`);
      L.push(`- ${lv} wip at end: ${m.wip[lv]}`);
    }
    if (m.mission_turnaround.pairs.length) L.push(`- mission_turnaround: ${m.mission_turnaround.pairs.map((x) => `${x.from}→${x.to} ${x.gap_h != null ? `${x.gap_h}h` : `overlap ${H(x.overlap_h)}`}`).join('; ')}`);
    L.push('', '## Quality', '');
    for (const lv of Object.keys(m.flow)) {
      const rows = p.items.filter((i) => i.level === lv);
      const cancelled = rows.filter((i) => i.state === 'cancelled').length;
      L.push(`- ${lv}: cancelled_share ${rows.length ? `${cancelled}/${rows.length}` : '—'}, reopen_count ${rows.reduce((a, i) => a + i.reopen_count, 0)}, review rounds — (not measured in M1)`);
    }
    L.push('', '## Estimates', '', '| level | n | eligible | work_ratio median | MdMRE | PRED(25) | MAE | hit_rate | excluded |', '|---|---|---|---|---|---|---|---|---|');
    for (const [lv, es] of Object.entries(m.estimates)) {
      const ex = Object.entries(es.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '—';
      L.push(`| ${lv} | ${es.n} | ${es.eligible} | ${es.work_ratio ? (es.work_ratio.median ?? `— (n<5; samples ${es.work_ratio.samples.join(', ')})`) : '—'} | ${es.mdmre ?? '—'} | ${es.pred25 ?? '—'} | ${es.mae == null ? '—' : `${es.mae}h`} | ${es.hit_rate.rate == null ? '—' : `${es.hit_rate.hits}/${es.hit_rate.ranged}`} | ${ex} |`);
    }
    for (const sv of m.schedule_variance) L.push(`- schedule_variance ${sv.level} ${sv.ref}: actual ${sv.actual_h}h vs [${sv.estimate.low}, ${sv.estimate.high}] → ${sv.band.low_delta >= 0 ? '+' : ''}${sv.band.low_delta}h / ${sv.band.high_delta >= 0 ? '+' : ''}${sv.band.high_delta}h; scope added ${sv.scope.added}, removed ${sv.scope.removed}`);
    L.push('', '## Coverage & caveats', '');
    for (const [lv, c] of Object.entries(m.coverage)) L.push(`- ${lv}: done ${c.done}, with observed dispatch ${c.with_dispatched}, with first commit ${c.with_first_commit}, with created ${c.with_created}; start source observed=${c.start_source.observed} derived-child=${c.start_source['derived-child']} none=${c.start_source.none}`);
    L.push('', '## Open items', '', '| ref | level | state | started | age |', '|---|---|---|---|---|');
    for (const i of p.items.filter((i) => i.state === 'in_progress')) L.push(`| ${i.ref} | ${i.level} | ${i.state} | ${i.started_at ?? '—'} | ${i.started_at ? `${hoursBetween(i.started_at, e.window.effective_end)}h` : '— (no observed start)'} |`);
    L.push('');
  }
  L.push('### Envelope', '', `- ledger coverage: ${Object.entries(e.coverage).filter(([k]) => k !== 'conflict_list').map(([k, v]) => `${k}=${v}`).join(', ')}`);
  L.push(`- baselines: ${Object.entries(e.baselines).map(([k, v]) => `${k}=${v ?? 'no baseline'}`).join(', ')}`);
  for (const c of e.caveats) L.push(`- caveat: ${c}`);
  L.push(`- policy: weeks ${e.policy.weeks}, percentiles ${e.policy.percentile} (floors median≥5 P85≥7 P90≥10), estimate base ${e.policy.estimate_base}, concurrency best-effort, tokenomics ${e.sources.tokenomics}`);
  return `${L.join('\n')}\n`;
}

export function renderStatus(doc) {
  const e = doc.envelope; const L = [];
  for (const p of doc.plans) {
    L.push(`STATUS ${p.plan_id} (${p.status}) at ${e.window.effective_end}`);
    for (const lv of ['campaign', 'mission', 'task', 'case']) {
      const rows = p.items.filter((i) => i.level === lv);
      if (!rows.length) continue;
      const n = (s) => rows.filter((i) => i.state === s).length;
      L.push(`  ${lv}: done=${n('done')} in_progress=${n('in_progress')} planned=${n('planned')} cancelled=${n('cancelled')}`);
    }
    for (const i of p.items.filter((i) => i.state === 'in_progress' && i.level === 'task')) L.push(`  open ${i.ref} started=${i.started_at ?? '—'} age=${i.started_at ? `${hoursBetween(i.started_at, e.window.effective_end)}h` : '—'}`);
    const fill = p.items.filter((i) => i.state === 'done' && (!i.created_at || !i.first_commit_at)).length;
    if (fill) L.push(`  backfill --git could fill created/first_commit for ${fill} done item(s)`);
  }
  L.push(`  ledger: conflicts=${e.coverage.conflicts} unregistered=${e.coverage.unregistered} malformed=${e.coverage.malformed_lines}`);
  return `${L.join('\n')}\n`;
}
```

- [ ] **Step 4: Wire `report` and `status` into `delivery.mjs`**

Add to imports: `import { assemble, renderMarkdown, renderStatus } from './lib/report.mjs';` and `import { writeFileSync } from 'node:fs'` (already imported). Add:
```js
function cmdReport(repo, p, io, now) {
  const f = p.flags;
  if (f.html || f.calibrate) throw cliError('USAGE', `${f.html ? '--html' : '--calibrate'} is not in M1`);
  let doc;
  if (f['from-json']) {
    if (f.since || f.until || f.cutoff || f.plan || f['latest-estimate']) throw cliError('USAGE', '--from-json rejects recomputation flags');
    doc = JSON.parse(readFileSync(f['from-json'], 'utf8'));
  } else {
    const plans = f.plan ? String(f.plan).split(',') : null;
    doc = assemble(repo, { plans, since: f.since ?? null, until: f.until ?? null, cutoff: f.cutoff ?? null, now, estimateBase: f['latest-estimate'] ? 'latest' : 'original' });
    if (!doc.plans.some((d) => d.observations > 0)) throw cliError('NO-EVENTS', `no observations before ${doc.envelope.window.effective_end} for ${doc.envelope.plans.join(',')}`);
  }
  const text = f.json && !f['from-json'] ? `${JSON.stringify(doc, null, 2)}\n` : (f.json ? `${JSON.stringify(doc, null, 2)}\n` : renderMarkdown(doc));
  if (f.out) { writeFileSync(f.out, text); out(io, `REPORT ${f.out}`); } else io.stdout.write(text);
  return 0;
}
function cmdStatus(repo, p, io, now) {
  const doc = assemble(repo, { plans: p.flags.plan ? [p.flags.plan] : null, now });
  io.stdout.write(renderStatus(doc));
  return 0;
}
export const COMMANDS = { plan: cmdPlan, session: cmdSession, event: cmdEvent, profile: cmdProfile, report: cmdReport, status: cmdStatus };
```
`assemble` throws errors with `.code`/`.exit` set, so `main`'s catch prints them and returns the right exit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test skills/delivery-metrics`
Expected: all green (paths 6, events 5, plan 7, plan-markdown 2, timeline 6, metrics 4, report 3, delivery 7).

- [ ] **Step 6: Commit**

```bash
git add skills/delivery-metrics/scripts
git commit -m "feat(delivery-metrics): report (markdown/JSON/--from-json) and status"
```

---

### Task 9: `lib/git-backfill.mjs` + `backfill --git`

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/git-backfill.mjs`, `skills/delivery-metrics/scripts/lib/git-backfill.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (`backfill` command)

**Interfaces:**
- Consumes: `events.mjs` (`makeObservation`, `appendObservation`), `plan.mjs` (`loadPlan`).
- Produces:
  - `gitLog(repo, args) → [{sha, parents:[], at (ISO), subject}]` (wraps `git log --format=%H%x1f%P%x1f%cI%x1f%s`).
  - `matchMergeSubject(subject, plan) → item|null` — subject `^merge (\S+)` whose branch (case-insensitive) equals an item's `branch` alias, or `task/task-(\d+)` → the item with `ref === 'TASK-' + n`.
  - `deriveGitObservations({repo, plan, head, since, cutoff}) → {records: obs[], skippedOutsideEpoch, notes: []}` implementing spec §6.7 local mode:
    - `done`: first-parent merge commits of `head` (`git log <head> --first-parent --merges`) matched by `matchMergeSubject`; second-parent evidence required: `git log <p2> ^<p1> --no-merges --format=%s` contains a subject starting with `<ref>:` — otherwise a note `merge <sha> for <ref> lacks second-parent evidence; skipped`. `at` = merge committer time, `meta.git_sha`, `raw` = subject, `transition_id` `<item>/done/episode-1`, `source_record_id` = sha.
    - `first_commit`: earliest non-merge commit reachable from `head` with subject `^<ref>:` — `transition_id` `<item>/first_commit/0`.
    - `rework_observed`: every commit with subject `^<ref>: address review (\d+)` — `transition_id` `<item>/rework_observed/<N>`, `source_record_id` = `<sha>`.
    - `created` (basis `plan-commit`): the earliest commit reachable from `head` that touches `plan.source.path` whose blob contains the ref as a whole word — `transition_id` `<item>/created/0`; if the plan has no tracked source path → note, no `created`.
    - Epoch/cutoff: commits with `at < plan.source_epoch.from`, `≥ plan.source_epoch.until` (when set), `< since` (when given) or `≥ cutoff` are skipped and counted.
  - CLI `backfill --git --plan <id> --head <sha> [--since <iso>] [--cutoff <iso>] [--dry-run]`: `--pr` → `USAGE(--pr is not in M1)`; `--head` must resolve (`git rev-parse --verify <sha>^{commit}`), else `USAGE(head <sha> not found)`; appends each record (`EVENT`/`SKIP`/`ID-CONFLICT` lines), prints notes as `NOTE …`, then `BACKFILL events=<n> skipped=<m> conflicts=<k> outside_epoch=<x> head=<full sha>`; `--dry-run` prints `WOULD <observation_id> <at>` lines and the summary without appending. Also stores `head` in the plan record (`plan.backfill = {head, at}`, last-writer-wins) so `report` can print it.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/git-backfill.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveGitObservations, matchMergeSubject } from './git-backfill.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-git-'));
let clock = Date.parse('2026-09-15T08:00:00Z');
const git = (repo, args, minutes = 60) => {
  clock += minutes * 60000;
  const d = new Date(clock).toISOString();
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
};
const commit = (repo, file, msg, minutes) => { writeFileSync(join(repo, file), `${msg}\n${Math.random()}`); git(repo, ['add', file]); git(repo, ['commit', '-q', '-m', msg], minutes); return git(repo, ['rev-parse', 'HEAD'], 0); };

/** Replays the observed local-branch harness: plan commit, task branches, `address review N`, `merge task/task-NNN (Rio: PASS)`. */
export function buildFixtureRepo() {
  const repo = tmp();
  git(repo, ['init', '-q', '-b', 'main'], 0);
  writeFileSync(join(repo, 'plan.md'), '# plan\n#### TASK-001: a\n#### TASK-002: b\n#### TASK-003: c\n');
  git(repo, ['add', 'plan.md']); git(repo, ['commit', '-q', '-m', 'plan: tasks'], 0);
  const planSha = git(repo, ['rev-parse', 'HEAD'], 0);
  const task = (n, rework) => {
    git(repo, ['checkout', '-q', '-b', `task/task-${n}`, 'main'], 0);
    const first = commit(repo, `f${n}.txt`, `TASK-${n}: implement`, 30);
    if (rework) commit(repo, `f${n}.txt`, `TASK-${n}: address review 1`, 45);
    git(repo, ['checkout', '-q', 'main'], 0);
    git(repo, ['merge', '--no-ff', '-q', '-m', `merge task/task-${n} (Rio: PASS)`, `task/task-${n}`], 20);
    return { first, merge: git(repo, ['rev-parse', 'HEAD'], 0) };
  };
  const t1 = task('001', true), t2 = task('002', false);
  const head = git(repo, ['rev-parse', 'HEAD'], 0);
  const t3 = task('003', false); // after head → must not appear
  return { repo, planSha, head, t1, t2, t3 };
}

const plan = (repo) => ({ plan_id: 'sec/run-1/1', source: { path: join(repo, 'plan.md') }, source_epoch: { from: '2026-09-15T00:00:00Z', until: null, integration_ref: 'main' }, items: [
  { item_id: 'task-task-001', ref: 'TASK-001', level: 'task', branch: 'task/task-001' }, { item_id: 'task-task-002', ref: 'TASK-002', level: 'task', branch: 'task/task-002' }, { item_id: 'task-task-003', ref: 'TASK-003', level: 'task', branch: 'task/task-003' }] });

test('matchMergeSubject: alias and task/task-NNN, case-insensitive', () => {
  const p = plan('/x');
  assert.equal(matchMergeSubject('merge task/task-001 (Rio: PASS)', p).ref, 'TASK-001');
  assert.equal(matchMergeSubject('Merge TASK/TASK-002', p).ref, 'TASK-002');
  assert.equal(matchMergeSubject('merge feature/x', p), null);
});

test('deriveGitObservations: created/first_commit/rework/done for merged tasks; head pins history; second-parent evidence required', () => {
  const { repo, head, t1, t2, t3 } = buildFixtureRepo();
  const { records, notes } = deriveGitObservations({ repo, plan: plan(repo), head, cutoff: '2026-12-31T00:00:00Z' });
  const of = (ref, ev) => records.filter((r) => r.ref === ref && r.event === ev);
  assert.equal(of('TASK-001', 'created').length, 1); assert.equal(of('TASK-001', 'created')[0].basis, 'plan-commit');
  assert.equal(of('TASK-001', 'first_commit')[0].meta.git_sha, t1.first);
  assert.equal(of('TASK-001', 'rework_observed').length, 1); assert.equal(of('TASK-001', 'rework_observed')[0].transition_id, 'task-task-001/rework_observed/1');
  assert.equal(of('TASK-001', 'done')[0].meta.git_sha, t1.merge); assert.equal(of('TASK-001', 'done')[0].raw, 'merge task/task-001 (Rio: PASS)');
  assert.equal(of('TASK-002', 'done')[0].meta.git_sha, t2.merge); assert.equal(of('TASK-002', 'rework_observed').length, 0);
  assert.equal(of('TASK-003', 'done').length, 0, 'merged after head'); assert.equal(of('TASK-003', 'first_commit').length, 0);
  assert.equal(of('TASK-003', 'created').length, 1, 'created comes from the plan commit, which is before head');
  assert.ok(records.every((r) => r.source === 'git' && r.host === 'git'));
  assert.ok(of('TASK-001', 'done')[0].at > of('TASK-001', 'first_commit')[0].at);
  // no second-parent evidence: a merge of a branch whose commits never mention the ref
  git(repo, ['checkout', '-q', '-b', 'task/task-002', t3.merge], 0);
  assert.deepEqual(notes, []);
});

test('deriveGitObservations: epoch and cutoff exclusions are counted, not silently dropped', () => {
  const { repo, head } = buildFixtureRepo();
  const p = plan(repo); p.source_epoch.from = '2026-09-15T09:00:00Z'; // plan commit at 08:00 is outside
  const r = deriveGitObservations({ repo, plan: p, head, cutoff: '2026-09-15T10:30:00Z' });
  assert.ok(r.skippedOutsideEpoch >= 1);
  assert.ok(r.records.every((x) => x.at < '2026-09-15T10:30:00.000Z'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/lib/git-backfill.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `git-backfill.mjs`**

```js
// STDLIB ONLY. Derive observations from a pinned git head (spec §6.7, local-branch mode). PR mode is M2.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { makeObservation } from './events.mjs';

const run = (repo, args) => { try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return null; } };

export function gitLog(repo, args) {
  const out = run(repo, ['log', '--format=%H%x1f%P%x1f%cI%x1f%s', ...args]);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((l) => { const [sha, parents, at, subject] = l.split('\x1f'); return { sha, parents: parents ? parents.split(' ') : [], at: new Date(at).toISOString(), subject }; });
}

export function matchMergeSubject(subject, plan) {
  const m = /^merge\s+(\S+)/i.exec(subject);
  if (!m) return null;
  const branch = m[1].toLowerCase();
  const byAlias = plan.items.find((i) => i.branch && i.branch.toLowerCase() === branch);
  if (byAlias) return byAlias;
  const t = /^task\/task-(\d+)$/.exec(branch);
  return t ? plan.items.find((i) => i.ref === `TASK-${t[1]}`) ?? null : null;
}

function firstCommitContaining(repo, head, path, ref) {
  const rel = resolve(path).startsWith(resolve(repo)) ? resolve(path).slice(resolve(repo).length + 1) : path;
  const shas = (run(repo, ['log', '--reverse', '--format=%H%x1f%cI', head, '--', rel]) ?? '').split('\n').filter(Boolean);
  const re = new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9-]|$)`);
  for (const line of shas) {
    const [sha, at] = line.split('\x1f');
    const blob = run(repo, ['show', `${sha}:${rel}`]);
    if (blob && re.test(blob)) return { sha, at: new Date(at).toISOString() };
  }
  return null;
}

export function deriveGitObservations({ repo, plan, head, since = null, cutoff, now = Date.now() }) {
  const from = plan.source_epoch?.from ? new Date(plan.source_epoch.from).toISOString() : null;
  const until = plan.source_epoch?.until ? new Date(plan.source_epoch.until).toISOString() : null;
  const cut = cutoff ? new Date(cutoff).toISOString() : null;
  const sinceIso = since ? new Date(since).toISOString() : null;
  const records = [], notes = []; let skippedOutsideEpoch = 0;
  const inEpoch = (at) => { const ok = (!from || at >= from) && (!until || at < until) && (!sinceIso || at >= sinceIso) && (!cut || at < cut); if (!ok) skippedOutsideEpoch++; return ok; };
  const obs = (item, event, at, sha, transition, extra = {}) => makeObservation({ user: null, host: 'git', plan: plan.plan_id, item_id: item.item_id, ref: item.ref, level: item.level, event, at,
    transition_id: transition, source: 'git', source_record_id: sha, basis: extra.basis ?? 'observed', raw: extra.raw ?? null, meta: { git_sha: sha, ...(extra.meta ?? {}) } }, { now });
  const items = plan.items.filter((i) => i.level === 'task' && !i.cancelled);
  // created — plan commit containing the ref
  if (plan.source?.path) {
    for (const it of items) {
      const c = firstCommitContaining(repo, head, plan.source.path, it.ref);
      if (c && inEpoch(c.at)) records.push(obs(it, 'created', c.at, c.sha, `${it.item_id}/created/0`, { basis: 'plan-commit' }));
    }
  } else notes.push('plan has no source path — created not derived');
  // first_commit + rework — non-merge commits reachable from head
  const nonMerge = gitLog(repo, ['--no-merges', '--reverse', head]);
  for (const it of items) {
    const esc = it.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mine = nonMerge.filter((c) => new RegExp(`^${esc}:`).test(c.subject));
    if (mine.length && inEpoch(mine[0].at)) records.push(obs(it, 'first_commit', mine[0].at, mine[0].sha, `${it.item_id}/first_commit/0`, { raw: mine[0].subject }));
    for (const c of mine) {
      const m = new RegExp(`^${esc}: address review (\\d+)`).exec(c.subject);
      if (m && inEpoch(c.at)) records.push(obs(it, 'rework_observed', c.at, c.sha, `${it.item_id}/rework_observed/${m[1]}`, { raw: c.subject, meta: { round: Number(m[1]) } }));
    }
  }
  // done — first-parent merges on the integration ref
  for (const c of gitLog(repo, ['--first-parent', '--merges', head])) {
    const it = matchMergeSubject(c.subject, plan);
    if (!it || c.parents.length < 2) continue;
    const evidence = (run(repo, ['log', '--no-merges', '--format=%s', c.parents[1], `^${c.parents[0]}`]) ?? '').split('\n').some((s) => s.startsWith(`${it.ref}:`));
    if (!evidence) { notes.push(`merge ${c.sha.slice(0, 7)} for ${it.ref} lacks second-parent evidence; skipped`); continue; }
    if (!inEpoch(c.at)) continue;
    if (records.some((r) => r.item_id === it.item_id && r.event === 'done')) continue; // first merge = episode 1; later merges need explicit reopen evidence (M2)
    records.push(obs(it, 'done', c.at, c.sha, `${it.item_id}/done/episode-1`, { raw: c.subject }));
  }
  records.sort((a, b) => a.at.localeCompare(b.at));
  return { records, notes, skippedOutsideEpoch };
}
```

- [ ] **Step 4: Wire `backfill` into `delivery.mjs`**

```js
import { deriveGitObservations } from './lib/git-backfill.mjs';
function cmdBackfill(repo, p, io, now) {
  const f = p.flags;
  if (!f.git) throw cliError('USAGE', 'backfill --git --plan <id> --head <sha> [--since] [--cutoff] [--dry-run]');
  if (f.pr) throw cliError('USAGE', '--pr is not in M1');
  const planId = resolvePlanId(repo, f.plan); const plan = loadPlan(repo, planId);
  if (!f.head) throw cliError('USAGE', 'backfill needs --head <sha> on the integration ref');
  let head; try { head = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${f.head}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { throw cliError('USAGE', `head ${f.head} not found`); }
  const { records, notes, skippedOutsideEpoch } = deriveGitObservations({ repo, plan, head, since: f.since ?? null, cutoff: f.cutoff ?? nowIso(now), now });
  for (const n of notes) out(io, `NOTE ${n}`);
  let events = 0, skipped = 0, conflicts = 0;
  for (const r of records) {
    if (f['dry-run']) { out(io, `WOULD ${r.observation_id} ${r.at}`); continue; }
    const res = appendObservation(repo, r, { now });
    out(io, `${res.result} ${res.observation_id} ${r.at}`);
    if (res.result === 'EVENT') events++; else if (res.result === 'SKIP') skipped++; else conflicts++;
  }
  if (!f['dry-run']) { plan.backfill = { head, at: nowIso(now) }; savePlan(repo, plan); }
  out(io, `BACKFILL events=${events} skipped=${skipped} conflicts=${conflicts} outside_epoch=${skippedOutsideEpoch} head=${head}`);
  if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} git observation(s) conflict`);
  return 0;
}
```
Add `backfill: cmdBackfill` to `COMMANDS`. Add a CLI test to `delivery.test.mjs` using `buildFixtureRepo` (export it from `git-backfill.test.mjs` or duplicate the helper): register a plan whose block lists TASK-001/002/003 with `branch` aliases, run `backfill --git --head <head>`, assert `BACKFILL events=` count equals the derived records, run again → `events=0 skipped=<same>`, and `report` shows `commit_to_done` for tasks with no dispatch.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test skills/delivery-metrics`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add skills/delivery-metrics/scripts
git commit -m "feat(delivery-metrics): git backfill — created/first_commit/rework/done from a pinned head, idempotent"
```

---

### Task 10: Golden fixture from the security-testing dataset

**Files:**
- Create: `skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs` (one-off extractor, documented, not run by tests)
- Create: `skills/delivery-metrics/fixtures/security-testing/dataset.json` (committed output: ids + timestamps only)
- Create: `skills/delivery-metrics/fixtures/security-testing/build-fixture-repo.mjs` (builds a temp repo with fixed dates from `dataset.json`)
- Create: `skills/delivery-metrics/fixtures/security-testing/golden.json`
- Create: `skills/delivery-metrics/scripts/golden.test.mjs`

**Interfaces:**
- Consumes: the CLI (`delivery.mjs`), `git-backfill.mjs`.
- Produces: `buildFixtureRepo(dataset) → {repo, head, planFile}` (exported from `build-fixture-repo.mjs`); `dataset.json` shape `{ snapshot_head: '<sha>', plan_commit_at, groups: [{ref:'G12', tasks:['TASK-023', …]}], tasks: [{ref, class, story, first_commit_at, rework: [{round, at}], merged_at|null}] }`.

The research snapshot is head `b1f70d2` of branch `feat/security-testing-bundle-spec` (33 merged tasks then). Spec AC-3 pins: 59 registered tasks, 30 missions (G0–G29), 33 first completions, 11 items with rework proxies; `cycle_time` absent (no dispatch events), `commit_to_done` present.

- [ ] **Step 1: Write the extractor and run it once**

`skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs`:
```js
#!/usr/bin/env node
// One-off: node extract-dataset.mjs <repo> <head> <plan-file-path-in-repo> > dataset.json
// Emits ids and timestamps only (no commit bodies), so the fixture carries no client content.
import { execFileSync } from 'node:child_process';
const [repo, head, planPath] = process.argv.slice(2);
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const log = (...a) => git('log', '--format=%H%x1f%P%x1f%cI%x1f%s', ...a).split('\n').filter(Boolean).map((l) => { const [sha, p, at, s] = l.split('\x1f'); return { sha, parents: p.split(' '), at, subject: s }; });
const plan = git('show', `${head}:${planPath}`);
const groups = [];
for (const line of plan.split('\n')) { const m = /^(G\d+)\s+(.+)$/.exec(line.trim()); if (m) groups.push({ ref: m[1], tasks: [...m[2].matchAll(/\b(\d{3})\b/g)].map((x) => `TASK-${x[1]}`) }); }
const tasks = new Map();
for (const m of plan.matchAll(/^#### (TASK-\d{3}):[^\n]*\n\*\*Story:\*\*\s*(US-\d+)[^\n]*\*\*Complexity:\*\*\s*([SML])/gm)) tasks.set(m[1], { ref: m[1], story: m[2], class: m[3], first_commit_at: null, rework: [], merged_at: null });
for (const c of log('--no-merges', '--reverse', head)) {
  const m = /^(TASK-\d{3}): (.*)$/.exec(c.subject); if (!m || !tasks.has(m[1])) continue;
  const t = tasks.get(m[1]); t.first_commit_at ??= c.at;
  const r = /^address review (\d+)/.exec(m[2]); if (r) t.rework.push({ round: Number(r[1]), at: c.at });
}
for (const c of log('--first-parent', '--merges', head)) { const m = /^merge task\/task-(\d{3})/.exec(c.subject); if (m && tasks.has(`TASK-${m[1]}`)) tasks.get(`TASK-${m[1]}`).merged_at ??= c.at; }
const planCommit = log('--reverse', head, '--', planPath)[0];
process.stdout.write(`${JSON.stringify({ snapshot_head: git('rev-parse', head), plan_commit_at: planCommit.at, groups, tasks: [...tasks.values()] }, null, 2)}\n`);
```
Run: `node skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs /Users/Daniel_Sallai/dev/sdlc-skills b1f70d2 docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md > skills/delivery-metrics/fixtures/security-testing/dataset.json`
Expected: `node -e 'const d=require("./skills/delivery-metrics/fixtures/security-testing/dataset.json");console.log(d.tasks.length,d.groups.length,d.tasks.filter(t=>t.merged_at).length,d.tasks.filter(t=>t.rework.length).length)'` → `59 30 33 11`. If a number differs, inspect the branch before touching the regexes (the plan's own TASK headings may exceed 59 by including `SPIKE-`; only `TASK-` counts). Those four numbers are the golden.

- [ ] **Step 2: Write the fixture-repo builder**

`skills/delivery-metrics/fixtures/security-testing/build-fixture-repo.mjs`:
```js
// Builds a temp git repo replaying dataset.json with its real timestamps (fixed → reproducible), no client content.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function buildFixtureRepo(ds) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-golden-'));
  const env = (at) => ({ ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'f@x', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'f@x' });
  const git = (args, at = ds.plan_commit_at) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: env(at) }).trim();
  git(['init', '-q', '-b', 'main']);
  const planFile = join(repo, 'plan.md');
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: ds.plan_commit_at,
    source_epoch: { from: ds.plan_commit_at, until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group',
    missions: ds.groups.map((g, i) => ({ ref: g.ref, sequence: i + 1, tasks: g.tasks.map((ref) => { const t = ds.tasks.find((x) => x.ref === ref); return { ref, story: t?.story, class: t?.class, branch: `task/task-${ref.slice(5)}` }; }).filter((t) => ds.tasks.some((x) => x.ref === t.ref)) })) };
  writeFileSync(planFile, `# plan\n\n\`\`\`json delivery-plan\n${JSON.stringify(block)}\n\`\`\`\n${ds.tasks.map((t) => `#### ${t.ref}: t`).join('\n')}\n`);
  git(['add', 'plan.md']); git(['commit', '-q', '-m', 'plan: tasks']);
  const events = [];
  for (const t of ds.tasks) { if (t.first_commit_at) events.push({ at: t.first_commit_at, kind: 'first', t }); for (const r of t.rework) events.push({ at: r.at, kind: 'rework', t, r }); if (t.merged_at) events.push({ at: t.merged_at, kind: 'merge', t }); }
  events.sort((a, b) => a.at.localeCompare(b.at));
  const branch = (t) => `task/task-${t.ref.slice(5)}`;
  for (const e of events) {
    if (e.kind === 'first') { git(['checkout', '-q', '-b', branch(e.t), 'main']); writeFileSync(join(repo, `${e.t.ref}.txt`), '1'); git(['add', '.']); git(['commit', '-q', '-m', `${e.t.ref}: implement`], e.at); git(['checkout', '-q', 'main']); }
    else if (e.kind === 'rework') { git(['checkout', '-q', branch(e.t)]); writeFileSync(join(repo, `${e.t.ref}.txt`), `r${e.r.round}`); git(['add', '.']); git(['commit', '-q', '-m', `${e.t.ref}: address review ${e.r.round}`], e.at); git(['checkout', '-q', 'main']); }
    else git(['merge', '--no-ff', '-q', '-m', `merge ${branch(e.t)} (Rio: PASS)`, branch(e.t)], e.at);
  }
  return { repo, head: git(['rev-parse', 'HEAD']), planFile };
}
```

- [ ] **Step 3: Write the golden test (fails until golden.json exists)**

`skills/delivery-metrics/scripts/golden.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFixtureRepo } from '../fixtures/security-testing/build-fixture-repo.mjs';

const CLI = fileURLToPath(new URL('./delivery.mjs', import.meta.url));
const DS = JSON.parse(readFileSync(new URL('../fixtures/security-testing/dataset.json', import.meta.url), 'utf8'));
const GOLDEN = fileURLToPath(new URL('../fixtures/security-testing/golden.json', import.meta.url));
const run = (repo, args) => execFileSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, DELIVERY_NO_SYNC: '1' } });
const CUTOFF = '2026-09-17T00:00:00Z';

test('golden: security-testing snapshot → 59 tasks, 30 missions, 33 first completions, 11 rework proxies; cycle_time absent', () => {
  const { repo, head, planFile } = buildFixtureRepo(DS);
  run(repo, ['plan', 'register', '--from', planFile, '--id', 'reg-1']);
  const bf = run(repo, ['backfill', '--git', '--head', head, '--cutoff', CUTOFF]);
  assert.match(bf, /BACKFILL events=\d+ skipped=0 conflicts=0/);
  const doc = JSON.parse(run(repo, ['report', '--json', '--cutoff', CUTOFF]));
  const p = doc.plans[0];
  const tasks = p.items.filter((i) => i.level === 'task');
  assert.equal(tasks.length, 59);
  assert.equal(p.items.filter((i) => i.level === 'mission').length, 30);
  assert.equal(tasks.filter((i) => i.state === 'done').length, 33);
  assert.equal(p.metrics.flow.task.cycle_time, null, 'no dispatch events → no cycle_time');
  assert.equal(p.metrics.flow.task.commit_to_done.n, 33);
  assert.equal(p.metrics.coverage.task.start_source.none, 33);
  assert.ok(doc.envelope.caveats.some((c) => /no observed dispatch start/.test(c)));
  const rework = tasks.filter((i) => i.flags.includes('rework-proxy') || (p.rework_proxy ?? {})[i.item_id]).length;
  // rework proxies are counted at report level; the golden pins the metric block
  const golden = { tasks: 59, missions: 30, done: 33, commit_to_done: p.metrics.flow.task.commit_to_done, lead_time: p.metrics.flow.task.lead_time, throughput: p.metrics.throughput.task.weeks, rework_proxy_items: p.metrics.rework_proxy_items };
  if (!existsSync(GOLDEN)) { writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`); assert.fail('golden.json written — re-run to compare'); }
  assert.deepEqual(golden, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  assert.equal(golden.rework_proxy_items, 11);
  // second backfill is a no-op
  assert.match(run(repo, ['backfill', '--git', '--head', head, '--cutoff', CUTOFF]), /BACKFILL events=0 skipped=\d+ conflicts=0/);
});
```
This needs one small addition in `metrics.mjs`: `data.rework_proxy_items` = number of completed items (any level) with ≥ 1 `rework_observed` occurrence. Add to `timeline.mjs` `Item` a counter `rework_count` (increment on `rework_observed` in the switch — it is otherwise a deferred event, so remove it from `DEFERRED`) and in `computeMetrics` set `data.rework_proxy_items = completed.filter((i) => i.rework_count > 0).length`. Update the metrics test fixture `item()` helper with `rework_count: 0`. Drop the unused `rework` local in the golden test.

- [ ] **Step 4: Run, generate the golden, run again**

Run: `node --test skills/delivery-metrics/scripts/golden.test.mjs` (first run writes `golden.json` and fails on purpose); run again → PASS. Open `golden.json` and sanity-check: `commit_to_done.n === 33`, medians in hours are plausible for the branch (tens of minutes to a few hours), `throughput` weeks are `2026-W37`/`2026-W38`.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/fixtures/security-testing skills/delivery-metrics/scripts/golden.test.mjs skills/delivery-metrics/scripts/lib/metrics.mjs skills/delivery-metrics/scripts/lib/timeline.mjs skills/delivery-metrics/scripts/lib/metrics.test.mjs
git commit -m "test(delivery-metrics): golden fixture from the security-testing snapshot (59/30/33/11)"
```

---

### Task 11: `hooks/dispatch-hook.mjs` — Claude `SubagentStop` capture

**Files:**
- Create: `skills/delivery-metrics/hooks/dispatch-hook.mjs`, `skills/delivery-metrics/hooks/dispatch-hook.test.mjs`
- Create: `skills/delivery-metrics/fixtures/hooks/` (built by the test at runtime; no committed transcripts)

**Interfaces:**
- Consumes: `lib/paths.mjs`, `lib/events.mjs` (`makeObservation`, `appendObservation`), `lib/plan.mjs` (`listPlans`, `loadPlan`).
- Produces (all exported for tests): `readStdinBounded(ms=2000, max=65536) → Promise<string>`; `installedRoster(repo) → Set<string>` (directory names under `.claude/agents/` that contain `AGENT.md`); `sessionPlan(repo, host, sessionId) → planRecord|null` (via `sessions/<enc>.json`, plan must be `open`); `findChildTranscript(payload) → {path, metaPath}|null`; `parseTranscript(path) → {firstTs, lastTs, firstUserText, records}`; `classifyStage(text) → 'build'|'review'|'fix'|'gate'|'merge'|'other'` (tokenomics `STAGE_MARKER` vocabulary: `implement\w*|build → build`, `review\w* → review`, `fix round|address review → fix`, `gate|mini-gate|hardening gate → gate`, `merge → merge`); `resolveRefs(plan, {description, firstUserText, branch}) → {items: item[], how: 'description'|'message'|'branch'|null}` (exact whole-word `ref` matches; description first — if it names exactly one item use it; else the full first message — unique match only; else branch alias; several distinct matches → `items: []`, `how: 'ambiguous'`); `appendOrRevise(repo, rec, opts) → result` (on `ID-CONFLICT`, retry with `revision + 1`, max 10); `handleStop(payload, {repo, now}) → {wrote: [], diagnostic: string|null}`.
- Hook contract (spec §6.6): stdin ≤ 64 KiB, never stdout, always exit 0, every failure swallowed. Guard order: (1) at least one open plan in `repo` else exit; (2) `sessions/claude:<session_id>.json` → open plan else diagnostic `unbound-session`; (3) role = `.meta.json` `agentType` (or payload `agent_type`): missing → admitted, diagnostic `unknown-role`; present and not in `installedRoster` → exit silently (foreign); (4) child transcript from `payload.agent_transcript_path` if it exists, else `<dirname(parent transcript)>/<session_id>/subagents/<agent_id>.jsonl` (and the `agent-<id>` spelling); none → diagnostic `no-transcript`; (5) emit.
- Emission: per resolved item `dispatched {at: firstTs, transition: <item>/dispatched/<agent_id>, meta.stage, session, agentId, role, label}` and `dispatch_ended {at: lastTs, transition: <item>/dispatch_ended/<agent_id>}`; stage `fix` adds `rework_observed {transition: <item>/rework_observed/<agent_id>}`; `source: 'hook'`, `host: 'claude'`, `source_record_id: claude:<session_id>:<agent_id>`, `basis: 'observed'`. `label` = `profile.capturePrompts ? description.slice(0,120) : '<ref> <stage>'`. No item → one `dispatched` + `dispatch_ended` pair with `item_id: null, meta.unattributed: true`. Diagnostics are appended to `.agents/telemetry/delivery/diagnostics-<slug>.jsonl` as `{at, kind, session, agent_id, detail}`.
- `repo` = `payload.cwd` if it contains `.agents/telemetry/delivery`, else `CLAUDE_PROJECT_DIR`, else `cwd`; when the resolved dir is inside `.claude/worktrees/`, walk up to the directory that contains `.claude/worktrees` (main checkout). This is the SPIKE-1-gated behaviour: keep it in one function `ownerRepo(payload, env)` so the spike result changes one place.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/hooks/dispatch-hook.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStage, resolveRefs, handleStop, ownerRepo, parseTranscript } from './dispatch-hook.mjs';
import { savePlan } from '../scripts/lib/plan.mjs';
import { resolveObservations } from '../scripts/lib/events.mjs';
import { deliveryDir, sessionsDir, sessionPath } from '../scripts/lib/paths.mjs';

const SCRIPT = fileURLToPath(new URL('./dispatch-hook.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-hook-'));
const P = 'sec/run-1/1';
const plan = { plan_id: P, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', roster: ['feature-development'], items: [
  { item_id: 'campaign-sec', ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: 'mission-g1', ref: 'G1', level: 'mission', parent_item_id: 'campaign-sec', sequence: 1 },
  { item_id: 'task-task-023', ref: 'TASK-023', level: 'task', parent_item_id: 'mission-g1', branch: 'task/task-023' }, { item_id: 'task-task-034', ref: 'TASK-034', level: 'task', parent_item_id: 'mission-g1', branch: 'task/task-034' }] };
const setup = ({ bind = true, roster = ['js-dev', 'tech-lead'] } = {}) => {
  const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true }); savePlan(repo, plan);
  for (const r of roster) { mkdirSync(join(repo, '.claude', 'agents', r), { recursive: true }); writeFileSync(join(repo, '.claude', 'agents', r, 'AGENT.md'), `---\nname: ${r}\n---\n`); }
  if (bind) { mkdirSync(sessionsDir(repo), { recursive: true }); writeFileSync(sessionPath(repo, 'claude', 'sess-1'), JSON.stringify({ host: 'claude', session: 'sess-1', plan: P })); }
  return repo;
};
const transcripts = ({ agentType = 'js-dev', description = 'Implement TASK-023 build-report core', first = 'You are js-dev. Implement TASK-023.', t0 = '2026-09-16T09:00:00.000Z', t1 = '2026-09-16T10:00:00.000Z', agentId = 'agent-1' } = {}) => {
  const proj = tmp(); const parent = join(proj, 'sess-1.jsonl'); writeFileSync(parent, JSON.stringify({ type: 'user', timestamp: t0, message: { role: 'user', content: 'hi' } }) + '\n');
  const dir = join(proj, 'sess-1', 'subagents'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${agentId}.jsonl`), [JSON.stringify({ type: 'user', timestamp: t0, message: { role: 'user', content: [{ type: 'text', text: first }] } }), JSON.stringify({ type: 'assistant', timestamp: t1, message: { role: 'assistant', content: 'done' } })].join('\n') + '\n');
  writeFileSync(join(dir, `${agentId}.meta.json`), JSON.stringify({ agentType, description }));
  return { parent, child: join(dir, `${agentId}.jsonl`) };
};
const payload = (t, over = {}) => ({ session_id: 'sess-1', agent_id: 'agent-1', transcript_path: t.parent, hook_event_name: 'SubagentStop', ...over });
const NOW = Date.parse('2026-09-16T10:00:05Z');

test('classifyStage follows the tokenomics stage vocabulary', () => {
  assert.equal(classifyStage('Implement TASK-1'), 'build'); assert.equal(classifyStage('Build the thing'), 'build');
  assert.equal(classifyStage('Review PR for TASK-1'), 'review'); assert.equal(classifyStage('fix round 2 for TASK-1'), 'fix'); assert.equal(classifyStage('TASK-1: address review 1'), 'fix');
  assert.equal(classifyStage('mini-gate'), 'gate'); assert.equal(classifyStage('merge task'), 'merge'); assert.equal(classifyStage('write docs'), 'other');
});

test('resolveRefs: description wins, then unique message match, then branch; ambiguity → none', () => {
  assert.deepEqual(resolveRefs(plan, { description: 'Implement TASK-023', firstUserText: 'TASK-034 also mentioned' }).items.map((i) => i.ref), ['TASK-023']);
  assert.equal(resolveRefs(plan, { description: 'Implement TASK-023', firstUserText: '' }).how, 'description');
  assert.deepEqual(resolveRefs(plan, { description: 'boilerplate', firstUserText: 'You are js-dev … now implement TASK-034 …' }).items.map((i) => i.ref), ['TASK-034']);
  assert.equal(resolveRefs(plan, { description: '', firstUserText: 'TASK-023 and TASK-034' }).how, 'ambiguous');
  assert.deepEqual(resolveRefs(plan, { description: '', firstUserText: 'nothing', branch: 'task/task-034' }).items.map((i) => i.ref), ['TASK-034']);
  assert.equal(resolveRefs(plan, { description: 'TASK-0230' , firstUserText: '' }).items.length, 0, 'whole-word only');
});

test('handleStop: emits dispatched/dispatch_ended from the child transcript; retry SKIPs; grown transcript revises', () => {
  const repo = setup(); const t = transcripts();
  const r = handleStop(payload(t), { repo, now: NOW });
  assert.equal(r.diagnostic, null); assert.deepEqual(r.wrote.map((w) => w.result), ['EVENT', 'EVENT']);
  let { active } = resolveObservations(repo);
  const d = active.find((o) => o.event === 'dispatched');
  assert.equal(d.item_id, 'task-task-023'); assert.equal(d.at, '2026-09-16T09:00:00.000Z'); assert.equal(d.source, 'hook'); assert.equal(d.host, 'claude');
  assert.equal(d.transition_id, 'task-task-023/dispatched/agent-1'); assert.equal(d.meta.stage, 'build'); assert.equal(d.role, 'js-dev'); assert.equal(d.session, 'sess-1'); assert.equal(d.agentId, 'agent-1');
  assert.equal(d.label, 'TASK-023 build', 'ids only when capturePrompts is false');
  assert.equal(active.find((o) => o.event === 'dispatch_ended').at, '2026-09-16T10:00:00.000Z');
  assert.deepEqual(handleStop(payload(t), { repo, now: NOW }).wrote.map((w) => w.result), ['SKIP', 'SKIP']);
  writeFileSync(t.child, readFileSync(t.child, 'utf8') + JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T11:00:00.000Z', message: { content: 'more' } }) + '\n');
  const r3 = handleStop(payload(t), { repo, now: NOW });
  assert.deepEqual(r3.wrote.map((w) => [w.result, w.revision]), [['SKIP', 0], ['EVENT', 1]]);
  active = resolveObservations(repo).active;
  assert.equal(active.find((o) => o.event === 'dispatch_ended').at, '2026-09-16T11:00:00.000Z');
});

test('handleStop: fix stage adds rework_observed; unresolved → unattributed pair; ambiguous → unattributed', () => {
  const repo = setup();
  const t = transcripts({ description: 'fix round 1 for TASK-034', agentId: 'agent-2' });
  handleStop(payload(t, { agent_id: 'agent-2' }), { repo, now: NOW });
  assert.ok(resolveObservations(repo).active.some((o) => o.event === 'rework_observed' && o.item_id === 'task-task-034'));
  const t2 = transcripts({ description: 'tidy docs', first: 'no ids here', agentId: 'agent-3' });
  handleStop(payload(t2, { agent_id: 'agent-3' }), { repo, now: NOW });
  const un = resolveObservations(repo).active.filter((o) => o.meta.unattributed);
  assert.equal(un.length, 2); assert.equal(un[0].item_id, null); assert.equal(un[0].plan, P);
});

test('handleStop guards: no open plan → nothing; unbound session → diagnostic; foreign role → nothing; unknown role → admitted + diagnostic; no transcript → diagnostic', () => {
  const t = transcripts();
  const none = tmp(); assert.deepEqual(handleStop(payload(t), { repo: none, now: NOW }), { wrote: [], diagnostic: null }); assert.ok(!existsSync(deliveryDir(none)));
  const unbound = setup({ bind: false }); assert.equal(handleStop(payload(t), { repo: unbound, now: NOW }).diagnostic, 'unbound-session'); assert.equal(resolveObservations(unbound).active.length, 0);
  assert.ok(readdirSync(deliveryDir(unbound)).some((f) => f.startsWith('diagnostics-')));
  const foreign = setup(); const tf = transcripts({ agentType: 'qa-auditor' }); assert.deepEqual(handleStop(payload(tf), { repo: foreign, now: NOW }), { wrote: [], diagnostic: null });
  const unknown = setup(); const tu = transcripts({ agentType: '' }); const ru = handleStop(payload(tu), { repo: unknown, now: NOW }); assert.equal(ru.diagnostic, 'unknown-role'); assert.equal(ru.wrote.length, 2);
  const missing = setup(); const rm = handleStop(payload(t, { agent_id: 'agent-9' }), { repo: missing, now: NOW }); assert.equal(rm.diagnostic, 'no-transcript'); assert.equal(rm.wrote.length, 0);
});

test('ownerRepo: cwd with delivery dir wins; worktree path walks up to the main checkout', () => {
  const main = tmp(); mkdirSync(join(main, '.agents', 'telemetry', 'delivery'), { recursive: true });
  const wt = join(main, '.claude', 'worktrees', 'wf_x'); mkdirSync(wt, { recursive: true });
  assert.equal(ownerRepo({ cwd: wt }, {}), main);
  assert.equal(ownerRepo({ cwd: main }, {}), main);
  assert.equal(ownerRepo({}, { CLAUDE_PROJECT_DIR: main }), main);
});

test('script: malformed stdin, missing fields → exit 0, no stdout, no files', () => {
  const repo = setup();
  for (const input of ['not json', '{}', JSON.stringify({ session_id: 'sess-1' })]) {
    const out = execFileSync('node', [SCRIPT, '--stop'], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo, DELIVERY_NO_SYNC: '1' } });
    assert.equal(out, '');
  }
  assert.equal(resolveObservations(repo).active.length, 0);
  assert.ok(parseTranscript('/nonexistent').firstTs === null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/hooks/dispatch-hook.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `dispatch-hook.mjs`**

```js
#!/usr/bin/env node
// STDLIB ONLY. Claude SubagentStop → dispatched / dispatch_ended (+ rework_observed) observations (spec §6.6).
// Never prints to stdout, always exits 0. Admission: open plan, session→plan association, role in the installed roster.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir, nowIso, sessionPath, whoAmI } from '../scripts/lib/paths.mjs';
import { appendObservation, makeObservation } from '../scripts/lib/events.mjs';
import { listPlans, loadPlan } from '../scripts/lib/plan.mjs';

const STAGE = [[/\b(fix round|address review)\b/i, 'fix'], [/\b(mini-gate|hardening gate|gate)\b/i, 'gate'], [/\bmerge\b/i, 'merge'], [/\breview\w*/i, 'review'], [/\b(implement\w*|build)\b/i, 'build']];
export function classifyStage(text) { for (const [re, s] of STAGE) if (re.test(text ?? '')) return s; return 'other'; }

export function readStdinBounded(ms = 2000, max = 65536) {
  return new Promise((done) => {
    let buf = '', finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(timer); done(buf); } };
    const timer = setTimeout(finish, ms);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { buf += d; if (buf.length > max) { buf = buf.slice(0, max); finish(); return; } try { JSON.parse(buf); finish(); } catch { /* incomplete */ } });
      process.stdin.on('end', finish); process.stdin.on('error', finish);
    } catch { finish(); }
  });
}

export function ownerRepo(payload = {}, env = {}) {
  const cands = [payload.cwd, env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean).map((p) => resolve(p));
  for (const c of cands) {
    const parts = c.split(sep); const i = parts.indexOf('.claude');
    if (i > 0 && parts[i + 1] === 'worktrees') return parts.slice(0, i).join(sep);
  }
  return cands.find((c) => existsSync(join(c, '.agents', 'telemetry', 'delivery'))) ?? cands[0];
}

export function installedRoster(repo) {
  const dir = join(repo, '.claude', 'agents');
  try { return new Set(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'AGENT.md'))).map((e) => e.name)); } catch { return new Set(); }
}

export function sessionPlan(repo, host, sessionId) {
  try { const s = JSON.parse(readFileSync(sessionPath(repo, host, sessionId), 'utf8')); const p = loadPlan(repo, s.plan); return p && p.status === 'open' ? p : null; } catch { return null; }
}

export function findChildTranscript(payload) {
  const cands = [];
  if (payload.agent_transcript_path) cands.push(payload.agent_transcript_path);
  if (payload.transcript_path && payload.session_id && payload.agent_id) {
    const base = join(dirname(payload.transcript_path), payload.session_id, 'subagents');
    cands.push(join(base, `${payload.agent_id}.jsonl`), join(base, `agent-${payload.agent_id}.jsonl`));
  }
  for (const p of cands) if (existsSync(p)) return { path: p, metaPath: p.replace(/\.jsonl$/, '.meta.json') };
  return null;
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n') : '');
export function parseTranscript(path) {
  let firstTs = null, lastTs = null, firstUserText = null, n = 0;
  let text; try { text = readFileSync(path, 'utf8'); } catch { return { firstTs, lastTs, firstUserText, records: 0 }; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    n++;
    const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (!Number.isNaN(t)) { const iso = new Date(t).toISOString(); if (!firstTs || iso < firstTs) firstTs = iso; if (!lastTs || iso > lastTs) lastTs = iso; }
    if (firstUserText == null && r.type === 'user') firstUserText = textOf(r.message?.content);
  }
  return { firstTs, lastTs, firstUserText: firstUserText ?? '', records: n };
}

const wordHit = (text, ref) => new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`).test(text ?? '');
export function resolveRefs(plan, { description = '', firstUserText = '', branch = null }) {
  const tasks = plan.items.filter((i) => i.level !== 'campaign' && !i.cancelled);
  const inDesc = tasks.filter((i) => wordHit(description, i.ref));
  if (inDesc.length === 1) return { items: inDesc, how: 'description' };
  if (inDesc.length > 1) return { items: [], how: 'ambiguous' };
  const inMsg = tasks.filter((i) => wordHit(firstUserText, i.ref));
  if (inMsg.length === 1) return { items: inMsg, how: 'message' };
  if (inMsg.length > 1) return { items: [], how: 'ambiguous' };
  if (branch) { const b = tasks.filter((i) => i.branch && i.branch.toLowerCase() === branch.toLowerCase()); if (b.length === 1) return { items: b, how: 'branch' }; }
  return { items: [], how: null };
}

export function appendOrRevise(repo, rec, opts) {
  let r = rec;
  for (let k = 0; k < 10; k++) {
    const res = appendObservation(repo, r, opts);
    if (res.result !== 'ID-CONFLICT') return res;
    r = { ...r, revision: r.revision + 1 };
  }
  return { result: 'ID-CONFLICT', observation_id: rec.observation_id, revision: rec.revision };
}

function diagnose(repo, slug, kind, payload, detail, now) {
  try { mkdirSync(deliveryDir(repo), { recursive: true }); appendFileSync(join(deliveryDir(repo), `diagnostics-${slug}.jsonl`), `${JSON.stringify({ at: nowIso(now), kind, session: payload.session_id ?? null, agent_id: payload.agent_id ?? null, detail })}\n`); } catch { /* best effort */ }
  return kind;
}

function branchOf(cwd) { try { return execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } }
function capturePrompts(repo) { try { return Boolean(JSON.parse(readFileSync(join(deliveryDir(repo), 'profile.json'), 'utf8')).capturePrompts); } catch { return false; } }

export function handleStop(payload, { repo, now = Date.now() } = {}) {
  const none = { wrote: [], diagnostic: null };
  if (!payload?.session_id || !payload?.agent_id) return none;
  if (!listPlans(repo).some((p) => p.status === 'open')) return none;                       // guard 1: an open plan
  const { slug } = whoAmI(repo);
  const plan = sessionPlan(repo, 'claude', payload.session_id);
  if (!plan) return { wrote: [], diagnostic: diagnose(repo, slug, 'unbound-session', payload, 'run: delivery.mjs session set --host claude --session <id> --plan <id>', now) }; // guard 2
  const child = findChildTranscript(payload);
  let meta = {}; if (child) { try { meta = JSON.parse(readFileSync(child.metaPath, 'utf8')); } catch { meta = {}; } }
  const role = meta.agentType || payload.agent_type || null;
  let diagnostic = null;
  if (role && !installedRoster(repo).has(role)) return none;                                  // guard 3: foreign role → silent
  if (!role) diagnostic = diagnose(repo, slug, 'unknown-role', payload, 'meta.agentType missing — admitted, role test relaxed', now);
  if (!child) return { wrote: [], diagnostic: diagnose(repo, slug, 'no-transcript', payload, 'child transcript not found', now) };
  const tr = parseTranscript(child.path);
  if (!tr.firstTs) return { wrote: [], diagnostic: diagnose(repo, slug, 'no-transcript', payload, 'child transcript has no timestamps', now) };
  const description = meta.description ?? '';
  const stage = classifyStage(description) !== 'other' ? classifyStage(description) : classifyStage(tr.firstUserText);
  const { items } = resolveRefs(plan, { description, firstUserText: tr.firstUserText, branch: payload.cwd ? branchOf(payload.cwd) : null });
  const common = { user: null, host: 'claude', plan: plan.plan_id, source: 'hook', source_record_id: `claude:${payload.session_id}:${payload.agent_id}`, session: payload.session_id, agentId: payload.agent_id, role };
  const targets = items.length ? items : [null];
  const wrote = [];
  for (const it of targets) {
    const label = it ? (capturePrompts(repo) ? description.slice(0, 120) : `${it.ref} ${stage}`) : stage;
    const base = it ? { item_id: it.item_id, ref: it.ref, level: it.level, meta: { stage } } : { item_id: null, ref: null, level: null, meta: { stage, unattributed: true } };
    const key = it ? it.item_id : 'unattributed';
    const mk = (event, at) => makeObservation({ ...common, ...base, label, event, at, transition_id: `${key}/${event}/${payload.agent_id}` }, { now });
    wrote.push(appendOrRevise(repo, mk('dispatched', tr.firstTs), { slug, now }));
    wrote.push(appendOrRevise(repo, mk('dispatch_ended', tr.lastTs ?? tr.firstTs), { slug, now }));
    if (it && stage === 'fix') wrote.push(appendOrRevise(repo, mk('rework_observed', tr.firstTs), { slug, now }));
  }
  return { wrote, diagnostic };
}

async function main() {
  try {
    const raw = await readStdinBounded();
    let payload = null; try { payload = JSON.parse(raw); } catch { return; }
    if (!process.argv.includes('--stop')) return;
    const repo = ownerRepo(payload, process.env);
    handleStop(payload, { repo });
    if (process.env.DELIVERY_NO_SYNC !== '1') { try { const { bestEffortSync } = await import('../scripts/delivery.mjs'); bestEffortSync(repo, process.env); } catch { /* best effort */ } }
  } catch { /* hooks never fail the host */ }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), () => process.exit(0));
```
Note `basename` is imported but unused — remove it. `readStdinBounded` mirrors tokenomics' `scope-hook.mjs:168-184` with an added 64 KiB cap.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/delivery-metrics/hooks/dispatch-hook.test.mjs`
Expected: 7 passing. The "grown transcript" case relies on `appendOrRevise` turning the `dispatch_ended` `ID-CONFLICT` into revision 1 while `dispatched` (unchanged `at`) SKIPs.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/hooks
git commit -m "feat(delivery-metrics): Claude SubagentStop hook — guarded, transcript-clocked dispatched/dispatch_ended"
```

---

### Task 12: `scripts/install-hooks.mjs` — Claude splice, ignore blocks, `--remove`, `--doctor`

**Files:**
- Create: `skills/delivery-metrics/scripts/install-hooks.mjs`, `skills/delivery-metrics/scripts/install-hooks.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (`doctor` command delegates to `doctorReport`)

**Interfaces:**
- Produces (exported): `MARKER = '_delivery'`; `skillRootOf(url)`; `installClaude(repo, rel, {local, remove}) → settingsPath` — splices one `SubagentStop` entry `{matcher: '*', hooks: [{type:'command', command: 'node "${CLAUDE_PROJECT_DIR}/<rel>/hooks/dispatch-hook.mjs" --stop', timeout: 30, async: true}], _delivery: true}` into `.claude/settings.json` (`settings.local.json` with `--local`), removing only entries carrying `_delivery` first (idempotent), preserving every other entry and key; `installIgnoreBlocks(repo, {remove}) → {root, inner}` — root `.gitignore` block between `# >>> delivery-metrics (managed)` / `# <<< delivery-metrics` with `.agents/telemetry/delivery/reports/`, `.agents/telemetry/delivery/.lock/`, `.agents/telemetry/delivery/.pending-*`; when `.agents/telemetry/.gitignore` exists (submodule or tokenomics plain dir) an inner block with `/delivery/reports/`, `/delivery/.lock/`, `/delivery/.pending-*`; blocks are replaced in place, other content untouched; `--remove` deletes only the owned block; `doctorReport(repo, rel) → {lines: string[], ok: boolean}` — hook wired? (marker present), plans open, sessions bound, `git check-ignore -q .agents/telemetry/delivery/.lock` in the owning repo (inner check runs inside `.agents/telemetry` when it is a git dir), submodule state (`plain-dir` | `submodule` with unpushed count via `git -C .agents/telemetry log @{u}..` best-effort), diagnostics file line count, last sync warning; `main(argv)`.
- Telemetry storage mode (M1 decision, recorded in the spec as a §13 note by Task 13): the installer **does not** create the self-referential submodule itself. If `.agents/telemetry/.git` exists it is reused; else if `.claude/skills/tokenomics/scripts/install-hooks.mjs` (or the `.github` copy) exists, the installer prints `NOTE run the tokenomics installer to set up the shared telemetry submodule; delivery records will ride it`; else it runs in **plain-dir mode** (records committed with the main tree) and says so. Self-bootstrap moves to M2.
- CLI: `install-hooks.mjs [--host claude] [--local] [--remove] [--doctor]`; `--host` other than `claude` → stderr `UNSUPPORTED-HOST(<h>)`, exit 2. Prints `INSTALLED <settings path>` / `REMOVED …`, the ignore-block results, and the storage-mode note.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/install-hooks.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installClaude, installIgnoreBlocks, doctorReport, MARKER } from './install-hooks.mjs';

const SCRIPT = fileURLToPath(new URL('./install-hooks.mjs', import.meta.url));
const tmp = () => { const r = mkdtempSync(join(tmpdir(), 'dm-install-')); execFileSync('git', ['init', '-q'], { cwd: r }); return r; };
const REL = '.claude/skills/delivery-metrics';

test('installClaude: splices one marked SubagentStop entry, keeps foreign entries and user edits, idempotent, --remove strips only ours', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  const settings = { permissions: { allow: ['Bash(npm test)'] }, hooks: { SubagentStop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node tok.mjs --dispatch', timeout: 60, async: true }], _tokenomics: true }] } };
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  const file = installClaude(repo, REL, {});
  let s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2);
  const ours = s.hooks.SubagentStop.find((e) => e[MARKER]);
  assert.match(ours.hooks[0].command, /dispatch-hook\.mjs" --stop$/); assert.equal(ours.hooks[0].async, true); assert.equal(ours.hooks[0].timeout, 30);
  assert.deepEqual(s.permissions, settings.permissions, 'unrelated keys untouched');
  installClaude(repo, REL, {});
  s = JSON.parse(readFileSync(file, 'utf8')); assert.equal(s.hooks.SubagentStop.length, 2, 'idempotent');
  s.hooks.SubagentStop.push({ matcher: 'x', hooks: [], note: 'user edit after install' }); writeFileSync(file, JSON.stringify(s));
  installClaude(repo, REL, { remove: true });
  s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2); assert.ok(s.hooks.SubagentStop.some((e) => e._tokenomics)); assert.ok(s.hooks.SubagentStop.some((e) => e.note));
  assert.ok(!s.hooks.SubagentStop.some((e) => e[MARKER]));
  const local = installClaude(repo, REL, { local: true }); assert.match(local, /settings\.local\.json$/);
});

test('installIgnoreBlocks: owned root block replaced in place; inner block only when telemetry .gitignore exists; remove strips only ours', () => {
  const repo = tmp();
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n# >>> tokenomics (managed)\n.agents/telemetry/automation/live/\n# <<< tokenomics\n');
  installIgnoreBlocks(repo, {});
  let gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.match(gi, /# >>> delivery-metrics \(managed\)[\s\S]*\.agents\/telemetry\/delivery\/\.lock\/[\s\S]*# <<< delivery-metrics/);
  assert.match(gi, /tokenomics \(managed\)/, 'other owner kept');
  installIgnoreBlocks(repo, {}); assert.equal((readFileSync(join(repo, '.gitignore'), 'utf8').match(/delivery-metrics \(managed\)/g) || []).length, 1);
  mkdirSync(join(repo, '.agents', 'telemetry'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), '*/live/\n');
  const r = installIgnoreBlocks(repo, {});
  assert.equal(r.inner, 'installed');
  assert.match(readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8'), /\*\/live\/\n[\s\S]*\/delivery\/reports\//);
  installIgnoreBlocks(repo, { remove: true });
  gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(!/delivery-metrics/.test(gi)); assert.match(gi, /node_modules/); assert.match(gi, /tokenomics/);
  assert.ok(!/delivery/.test(readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8')));
});

test('doctorReport: reports wiring, plans, ignore check, storage mode', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /hook: not wired/.test(l))); assert.ok(d.lines.some((l) => /plans: 0 open/.test(l))); assert.ok(d.lines.some((l) => /storage: plain-dir/.test(l)));
  installClaude(repo, REL, {}); installIgnoreBlocks(repo, {});
  d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /hook: wired/.test(l))); assert.ok(d.lines.some((l) => /ignore: ok/.test(l)));
});

test('script: --host copilot exits 2 UNSUPPORTED-HOST; default installs and prints INSTALLED', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let code = 0, err = '';
  try { execFileSync('node', [SCRIPT, '--host', 'copilot'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2); assert.match(err, /^UNSUPPORTED-HOST\(copilot\)/);
  const out = execFileSync('node', [SCRIPT], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(out, /INSTALLED .*settings\.json/); assert.match(out, /storage: plain-dir/);
  assert.ok(existsSync(join(repo, '.claude', 'settings.json')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/delivery-metrics/scripts/install-hooks.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `install-hooks.mjs`**

```js
#!/usr/bin/env node
// STDLIB ONLY. Opt-in Claude SubagentStop capture (spec §6.6, D15). Installing the skill never wires this; running this script does.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir, sessionsDir } from './lib/paths.mjs';
import { listPlans } from './lib/plan.mjs';

export const MARKER = '_delivery';
export const skillRootOf = (url = import.meta.url) => dirname(dirname(fileURLToPath(url)));
const posix = (p) => p.split('\\').join('/');
const readJson = (p, fb) => { if (!existsSync(p)) return fb; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const writeJson = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`); };

export function installClaude(repo, rel, { local = false, remove = false } = {}) {
  const file = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(file, {});
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const list = Array.isArray(settings.hooks.SubagentStop) ? settings.hooks.SubagentStop : [];
  const kept = list.filter((e) => !e || !e[MARKER]);
  if (!remove) kept.push({ matcher: '*', hooks: [{ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/${posix(rel)}/hooks/dispatch-hook.mjs" --stop`, timeout: 30, async: true }], [MARKER]: true });
  if (kept.length) settings.hooks.SubagentStop = kept; else delete settings.hooks.SubagentStop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings);
  return file;
}

const BEGIN = '# >>> delivery-metrics (managed)', END = '# <<< delivery-metrics';
function spliceBlock(file, lines, remove) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const re = new RegExp(`\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}\\n?`);
  const stripped = text.replace(re, '\n').replace(/\n{3,}/g, '\n\n');
  const next = remove ? stripped : `${stripped.replace(/\n*$/, '\n')}${text ? '\n' : ''}${BEGIN} — transients only; plans/events/calibration stay COMMITTED\n${lines.join('\n')}\n${END}\n`;
  if (remove && !text) return 'absent';
  writeFileSync(file, next.replace(/^\n+/, ''));
  return remove ? 'removed' : 'installed';
}
export function installIgnoreBlocks(repo, { remove = false } = {}) {
  const root = spliceBlock(join(repo, '.gitignore'), ['.agents/telemetry/delivery/reports/', '.agents/telemetry/delivery/.lock/', '.agents/telemetry/delivery/.pending-*'], remove);
  const innerFile = join(repo, '.agents', 'telemetry', '.gitignore');
  const inner = existsSync(innerFile) ? spliceBlock(innerFile, ['/delivery/reports/', '/delivery/.lock/', '/delivery/.pending-*'], remove) : 'skipped (no telemetry .gitignore)';
  return { root, inner };
}

export function storageMode(repo) {
  if (existsSync(join(repo, '.agents', 'telemetry', '.git'))) return 'submodule';
  const tok = ['.claude/skills/tokenomics/scripts/install-hooks.mjs', '.github/skills/tokenomics/scripts/install-hooks.mjs'].find((p) => existsSync(join(repo, p)));
  return tok ? `plain-dir (run node ${tok} to set up the shared telemetry submodule; delivery records will ride it)` : 'plain-dir (records committed with the main tree; shared submodule bootstrap is M2)';
}

export function doctorReport(repo, rel) {
  const lines = []; let ok = true;
  const g = (cwd, ...a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const settings = readJson(join(repo, '.claude', 'settings.json'), {}); const local = readJson(join(repo, '.claude', 'settings.local.json'), {});
  const wired = [...(settings.hooks?.SubagentStop ?? []), ...(local.hooks?.SubagentStop ?? [])].some((e) => e && e[MARKER]);
  lines.push(`hook: ${wired ? 'wired' : 'not wired'} (Claude SubagentStop, marker ${MARKER})`); if (!wired) ok = false;
  const plans = listPlans(repo); lines.push(`plans: ${plans.filter((p) => p.status === 'open').length} open, ${plans.length} total`);
  const sessions = existsSync(sessionsDir(repo)) ? readdirSync(sessionsDir(repo)).length : 0; lines.push(`sessions bound: ${sessions}`);
  const ig = g(repo, 'check-ignore', '-q', '.agents/telemetry/delivery/.lock/x') !== null; lines.push(`ignore: ${ig ? 'ok' : 'MISSING'} (.agents/telemetry/delivery/.lock is ${ig ? '' : 'NOT '}ignored in the main tree)`); if (!ig) ok = false;
  const mode = storageMode(repo); lines.push(`storage: ${mode}`);
  if (mode === 'submodule') { const un = g(join(repo, '.agents', 'telemetry'), 'log', '--oneline', '@{u}..'); lines.push(`telemetry branch: ${un === null ? 'no upstream' : `${un ? un.split('\n').length : 0} unpushed commit(s)`}`); }
  const diag = existsSync(deliveryDir(repo)) ? readdirSync(deliveryDir(repo)).filter((f) => f.startsWith('diagnostics-')) : [];
  const nDiag = diag.reduce((n, f) => n + readFileSync(join(deliveryDir(repo), f), 'utf8').split('\n').filter(Boolean).length, 0);
  lines.push(`diagnostics: ${nDiag} line(s)${nDiag ? ' — unbound sessions / missing transcripts / unknown roles (see delivery/diagnostics-*.jsonl)' : ''}`);
  lines.push('concurrency: best-effort (advisory 60 s mkdir lock; no cross-process guarantee)');
  return { lines, ok };
}

export function main(argv = process.argv.slice(2), repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) {
  const has = (f) => argv.includes(f); const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const host = val('--host') ?? 'claude';
  if (host !== 'claude') { process.stderr.write(`UNSUPPORTED-HOST(${host})\n`); return 2; }
  const rel = posix(relative(repo, skillRootOf()));
  if (has('--doctor')) { const d = doctorReport(repo, rel); for (const l of d.lines) console.log(l); return 0; }
  const remove = has('--remove');
  const file = installClaude(repo, rel, { local: has('--local'), remove });
  const ig = installIgnoreBlocks(repo, { remove });
  console.log(`${remove ? 'REMOVED' : 'INSTALLED'} ${file}`);
  console.log(`ignore blocks: root=${ig.root} inner=${ig.inner}`);
  console.log(`storage: ${storageMode(repo)}`);
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
```

- [ ] **Step 4: Wire `doctor` into `delivery.mjs`**

```js
import { doctorReport, skillRootOf } from './install-hooks.mjs';
function cmdDoctor(repo, p, io) { const d = doctorReport(repo, relative(repo, skillRootOf(import.meta.url))); for (const l of d.lines) out(io, l); return 0; }
```
(add `relative` to the `node:path` import; add `doctor: cmdDoctor` to `COMMANDS`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test skills/delivery-metrics`
Expected: all green. Then `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes`.

- [ ] **Step 6: Commit**

```bash
git add skills/delivery-metrics/scripts
git commit -m "feat(delivery-metrics): opt-in installer — Claude SubagentStop splice, owned ignore blocks, --remove, --doctor"
```

---

### Task 13: Factory wiring, references, README, spec note, final gates

**Files:**
- Modify: `bundles/feature-development/agents/tech-lead/AGENT.md` (§ 3 "Create Technical Tasks", § 5 "Handoff to PM"), `bundles/feature-development/agents/project-manager/AGENT.md` (§ Merging approved PRs step 5, § Handling Blockers, § Status Report Format, § Execution mode), `bundles/feature-development/agents/scout/AGENT.md` (onboarding opt-in), `bundles/feature-development/instructions.md` (Delivery tracking paragraph), `bundles/test-automation/agents/scout/AGENT.md` and `bundles/test-automation/agents/test-automation-lead/AGENT.md` (`skills-on-demand`)
- Create: `skills/delivery-metrics/references/event-model.md`, `references/metrics.md`, `references/plan-block.md`, `templates/plan-block.template.md`
- Modify: `skills/delivery-metrics/README.md`, `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md` (§13 M1/M2 note about submodule bootstrap — `git add -f`)

**Interfaces:** none new; prose names the exact commands from Tasks 5, 9, 12.

- [ ] **Step 1: Agent frontmatter — `skills-on-demand`**

In each of `feature-development/agents/{tech-lead,project-manager,scout}/AGENT.md` and `test-automation/agents/{scout,test-automation-lead}/AGENT.md`, add `delivery-metrics` to the `skills-on-demand:` list (create the key if absent, e.g. `skills-on-demand: [delivery-metrics]`). Never add it to `skills:`. Keep every value quoted if it contains `: ` (frontmatter-strict test).

- [ ] **Step 2: tech-lead prose**

After the task template in § 3 (`tech-lead/AGENT.md:181-201`), add:
```markdown
**Delivery-plan block (delivery-metrics).** The decomposition document also
carries one fenced ```` ```json delivery-plan ```` block — the machine-readable
plan the `delivery-metrics` skill registers (template:
`.claude/skills/delivery-metrics/templates/plan-block.template.md`). Every
task keeps its `Complexity`, and gets a **ranged elapsed-hours estimate**
`{"unit":"h","low":…,"high":…,"tier":"ROM|budgetary|calibrated"}` plus one
per group/milestone and one for the campaign. You **propose** the ranges
(`proposed_by: tech-lead`); a named human **accepts** them
(`accepted_by`, `accepted_at`) before they count — an unaccepted range is
recorded but excluded from accuracy. Consult the latest
`.agents/telemetry/delivery/calibration/` snapshot for the observed p50/p85
per class when one exists. Developers still never estimate.
```
In § 5 "Handoff to PM" add the step: `Register the plan: node .claude/skills/delivery-metrics/scripts/delivery.mjs plan register --from <plan file> --id <plan-slug>-v<n>`.

- [ ] **Step 3: project-manager prose**

- § Merging approved PRs, after the merge command: `Record the completion: node .claude/skills/delivery-metrics/scripts/delivery.mjs event <TASK-NNN> done --sha <merge sha> --id done-<NNN>` (PR mode: `--at <mergedAt>`). A task dropped from scope: `event <TASK-NNN> cancelled --raw "<why>" --id cancel-<NNN>`.
- § Handling Blockers: `event <TASK-NNN> blocked --id blk-<NNN>-<n>` / `unblocked` (recorded now, derived in M2).
- § Execution mode: add the rule "**The first line of every dispatch prompt names the `TASK-NNN`** (and the stage word — implement / review / fix round) so the delivery hook can attribute it."
- § Session Start: "If `.agents/telemetry/delivery/plans/` has an open plan, bind this session once: `delivery.mjs session set --host claude --session <your session id> --plan <plan id>` (the id is in the SessionStart announce line when tokenomics is on; otherwise `ls ~/.claude/projects/<project>/` newest `.jsonl`)."
- § Status Report Format: add a `### Delivery` section whose content is the output of `node .claude/skills/delivery-metrics/scripts/delivery.mjs status`.

- [ ] **Step 4: scout opt-in (both factories) and instructions.md**

`feature-development/agents/scout/AGENT.md` and `test-automation/agents/scout/AGENT.md` — next to the tokenomics question (`test-automation/agents/scout/AGENT.md:105`), add: "Ask once whether the team wants **delivery tracking** (cycle time, weekly throughput, estimate-vs-actual per task/mission/campaign into the same git-committed telemetry area). If yes, run `node .claude/skills/delivery-metrics/scripts/install-hooks.mjs` and note the decision in the seed report; the tracker still works without the hook through the CLI and `backfill --git`."

`feature-development/instructions.md`: after the memory section add
```markdown
## Delivery tracking (delivery-metrics)

Three moments, all recorded — never estimated: the tech-lead's plan block is
**registered** (`delivery.mjs plan register`), every merge or cancellation is
**recorded** by the PM at the moment it happens (`delivery.mjs event … done
--sha`), and the report is read at mission close (`delivery.mjs report`).
Dispatch starts come from the opt-in Claude hook; history from `backfill
--git`. Mission state lives in this ledger (`.agents/telemetry/delivery/`),
not in either memory layer.
```
Reword the existing line 95 sentence "Mission state belongs on the work board, not in either memory layer" to "Mission state belongs in the delivery ledger (see Delivery tracking), not in either memory layer."

- [ ] **Step 5: References and templates**

- `references/event-model.md`: the §6.2 field table verbatim from the spec, the 18 events with which ones M1 derives, the identity rules (`observation_id`, `revision`, `transition_id`), the read-time resolution order, and the source precedence with the CONFLICT rule.
- `references/metrics.md`: one row per metric — name, start event, stop event, unit, floors, exclusions, caveat text — copied from spec §6.10 and Task 7's rules (only M1 metrics; the rest listed under "M2+").
- `references/plan-block.md`: the block schema (Task 3 validation rules), the estimate object, acceptance semantics, the markdown importer's limits ("no invented estimates; `--yes` required").
- `templates/plan-block.template.md`: a markdown snippet containing a filled example block with two missions and three tasks, `accepted_by: null` placeholders, and a comment line telling the tech-lead what to fill.
- `README.md`: finish the quick start (register → bind session → record → backfill → report), the storage-mode note (submodule vs plain-dir), the "What it does not do" list (spec §8/§18), and a pointer to the three references.

- [ ] **Step 6: Spec note (§13) and validation**

Append to spec §13 M1 row: "Storage: reuses an existing `.agents/telemetry` submodule or runs plain-dir; the self-referential submodule bootstrap without tokenomics moves to M2." Commit with `git add -f`.

Run: `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes && node bin/init.mjs init --factory feature-development --target claude --yes` (against a throwaway `--target` dir if the installer supports `--dir`; otherwise in a temp clone) and check `.claude/skills/delivery-metrics/` is placed and no hook is wired until `install-hooks.mjs` runs.
Expected: green; `skills-ref validate skills/delivery-metrics` (if `skills-ref` is installed locally: `npx skills-ref validate skills/delivery-metrics`) passes.

- [ ] **Step 7: Commit**

```bash
git add bundles/feature-development bundles/test-automation skills/delivery-metrics
git add -f docs/superpowers/specs/2026-09-16-delivery-metrics-design.md
git commit -m "feat(delivery-metrics): factory wiring (tech-lead block, PM moments, scout opt-in), references, README"
```

---

## Self-review (run by the plan author before hand-off)

1. **Spec coverage (M1 rows of §13):** plan block + estimates → Tasks 3, 5; markdown importer → Task 4; `event`/`backfill`/hook/installer → Tasks 5, 9, 11, 12; storage §6.1 → Tasks 1, 2 (+ ignore blocks in 12); timeline §6.9 (M1 subset) → Task 6; metrics §6.10 (cycle/commit_to_done/lead, throughput/velocity, estimate delta, schedule variance, coverage) → Task 7; `status`/`report` §6.11 → Task 8; feature-development wiring §9.1 + scout → Task 13; golden fixture §12/AC-3 → Task 10; M-1 docs + P-0/P-1 → Task 0. Deferred by design (M2+): review completeness, blocked/reopen derivation, PR-mode backfill, HTML/`--calibrate`, automation adapter, cost join, submodule self-bootstrap.
2. **Placeholders:** none — every step carries code or an exact edit; the two "copy from the spec" reference docs name the exact sections.
3. **Type consistency:** `makeObservation` fields (Task 2) are what Tasks 3/5/9/11 pass; `Item` (Task 6) is what Task 7/8 read (`version_added`, `rework_count` added in Task 7/10 — both also added to `newItem`); `appendObservation` result shape `{result, observation_id, revision, path}` is used by Tasks 5, 9, 11; `assemble` doc shape is what `renderMarkdown`/`renderStatus`/golden test consume; CLI error codes match Global Constraint 8.

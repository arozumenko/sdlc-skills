# delivery-metrics M1 (Slice 1) Implementation Plan (v3)

**Plan version:** v3 — 2026-09-17; v1 review (`docs/superpowers/notes/2026-09-17-delivery-metrics-m1-plan-v1-adversarial-review-codex.md`, 19 blockers / 14 majors) applied by the plan author; round-2 review (`docs/superpowers/notes/2026-09-17-delivery-metrics-m1-plan-v2-adversarial-review-codex.md`, 1 blocker / 3 majors) applied in v3 — see "Review rounds" at the end.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `skills/delivery-metrics/` M1 — cycle time, weekly throughput/velocity and estimate-vs-actual delta per task / mission / campaign, from a git-committed event ledger fed by a CLI, one Claude `SubagentStop` hook and a git backfill.

**Architecture:** An orphan stdlib skill. `scripts/delivery.mjs` is a thin CLI over pure modules in `scripts/lib/` (paths → events → plan → timeline → metrics → report; git-backfill and plan-markdown are adapters). Records are append-only per-user JSONL under `.agents/telemetry/delivery/` plus one JSON file per registered **run** (a run's plan file accumulates versions); readers validate, dedup and resolve at read time (highest revision per observation, source precedence `cli > automation-sync > hook > git`, `CONFLICT` on equal-rank disagreement with no fallback). Nothing imports tokenomics code.

**Tech Stack:** Node ≥ 18 (repo runs 24), ESM `.mjs`, stdlib only (`node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:os`, `node:util` TextDecoder), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md` (v5.1). §13 defines M1; §5, §6.1–6.7, §6.9–6.11 are the contracts; §12/§17 the tests and acceptance criteria. Executors read the spec alongside this plan. Two representation choices this plan fixes where the spec leaves them open: (a) the ledger `plan` field names the **run** (`<campaign_id>/<run_id>`) and `meta.version` the plan version at recording, so history survives re-cuts (spec §5 "union stable ids once across versions"); (b) generated `item_id`s are run-scoped (`<campaign_id>/<run_id>/<slug>`), which makes `observation_id`/`transition_id` unique across campaigns without changing the tuple contract.

## Global Constraints

1. Stdlib ESM `.mjs` only, Node ≥ 18, **zero dependencies**. Externals (`git`) only via `execFileSync` with an argv array (never a shell string); failure → honest `null`, never a guess.
2. Every script has a sibling `*.test.mjs` (`node --test` discovers `*.test.mjs` anywhere); tests are offline, use `mkdtempSync` temp dirs and fixed clocks (`now` passed in; no `Date.now()` inside pure functions).
3. Records live only under `.agents/telemetry/delivery/` (spec D3). Never write inside `.agents/telemetry/automation/`. Never gitignore `.agents/telemetry`.
4. Ledger: one `appendFileSync(path, JSON.stringify(rec) + "\n")` per observation, per-user file `events-<slug>.jsonl`; no rewrite, no fsync, no transactions (spec §6.1). Every read validates each line with the shared record validator; invalid UTF-8 / JSON / schema lines are skipped and counted as `malformed-lines` with `path:line`; unknown `v` counted separately.
5. Timestamps: `at`/`recorded_at` are UTC ISO-8601 with milliseconds (`new Date(x).toISOString()`); **durations are kept in seconds (unrounded) through every computation and eligibility decision**; rounding to 2-dp hours happens only in renderers (D10, D12). Weeks are **UTC** ISO weeks `YYYY-Www` (D11).
6. Aggregation: nearest-rank percentiles `sorted[Math.ceil(q*n)-1]`; median needs n ≥ 5, P85 n ≥ 7, P90 n ≥ 10; always min–max and n; never a mean as headline. No `byPerson` anywhere (D13). Every speed/volume stratum prints its quality denominators, `unknown` in M1 (D14).
7. Estimates are recorded inputs only; `unit ∈ {h, active_min}`; `accepted_by` **and** `accepted_at` required, and a changed range/unit/tier needs a **new** acceptance pair (`accepted_at` later than the previous one) or the revision is `unaccepted`; `tier: calibrated` requires `reference: {path, sha256, population}`; absent = "not estimated", never 0 or 1 (D9, §6.4).
8. Exit codes: `0` ok · `1` internal (uncaught) · `2` usage/schema/identity/conflict/lock (`USAGE`, `SCHEMA-INVALID`, `ID-CONFLICT`, `INVALID-TRANSITION`, `AMBIGUOUS-PLAN`, `MIGRATION-REQUIRED`, `LOCK-BUSY`, `CONFLICT`) · `3` not measurable (`NO-PLAN`, `NO-EVENTS`). Errors are ONE stderr line `<CODE>(<detail>)` (newlines flattened). Every user-input failure (bad date, bad JSON, schema, lock busy) maps to exit 2 — never `INTERNAL`. Hooks always exit 0 and never print to stdout (D21, §6.6).
9. Forbidden vocabulary in any file: octobots, dual-mode, markers/taskbox/relay. Forbidden in M1: DORA, forecasting, Little's-law line, per-person figures, Copilot hooks, `--from-json` (M4), review/blocked/reopen **derivation** (M2 — the events are accepted and counted as deferred).
10. SKILL.md frontmatter keys only `name`, `description` (≤ 1024), `license`, `compatibility` (≤ 500, quoted), `metadata` (`authors`, `version`); `name` = directory name; no `tools:` key anywhere.
11. Commit after every task; `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` green at every commit (`validate:externals` needs network — run it once at Task 13 if online, otherwise record "not run: offline").
12. Honesty caveats are printed **unconditionally** in every report: `acceptance: unauthenticated`, `writes: non-transactional`, `partial-update: possible`, `capture-loss: possible`, `shared-files: last-writer-wins`, `sync: best-effort`, `concurrency: best-effort`, `hook-transcript-shapes: provisional until SPIKE-1`. Checked-zero and unknown are distinct in output.
13. All telemetry paths resolve the shared main-checkout owner via Task 1, including CLI, hook, installer and doctor; source-file/Git reads retain the invoking checkout.
14. Work in the worktree `/Users/Daniel_Sallai/dev/sdlc-skills-delivery-metrics` on branch `feat/delivery-metrics-spec`. `docs/superpowers/` is gitignored — plan/spec commits use `git add -f`.

---

## File structure

```
skills/delivery-metrics/
  SKILL.md, README.md                                       (Task 1; README finished in Task 13)
  scripts/delivery.mjs             CLI: plan | session | event | status | backfill | report | doctor   (Tasks 5, 8, 9, 12)
  scripts/install-hooks.mjs        Claude SubagentStop splice, ignore blocks, telemetry submodule bootstrap, --remove/--doctor (Task 12)
  scripts/lib/paths.mjs            shared worktree owner, dirs, user slug, encoding, plan/events paths, mkdir lock, errors           (Task 1)
  scripts/lib/roster.mjs           shipped factory map × installed roles, validated run snapshot (Task 1)
  references/factory-roles.json    generated factory-to-role membership; copied with the orphan skill (Task 1)
  scripts/lib/events.mjs           record validator, ids, append (SKIP/ID-CONFLICT), read (validated, hashed) + resolution (Task 2)
  scripts/lib/plan.mjs             block extraction, schema, run-scoped ids, catalogue, delta, registration observations (Task 3)
  scripts/lib/plan-markdown.mjs    tasks-file importer → canonical block                                   (Task 4)
  scripts/lib/timeline.mjs         occurrence selection (D6 + conflict carry-over), transition validation, item state, rollups (Task 6)
  scripts/lib/metrics.mjs          stats, UTC weeks with declared coverage, flow/throughput/estimates per stratum, coverage (Task 7)
  scripts/lib/report.mjs           assemble (read-once provenance), markdown, JSON, status               (Task 8)
  scripts/lib/git-backfill.mjs     created/first_commit/rework/done from a pinned integration head       (Task 9)
  scripts/lib/sync.mjs             best-effort telemetry git sync (unmerged check, fetch/merge, one retry) (Task 5)
  hooks/dispatch-hook.mjs          SubagentStop → dispatched/dispatch_ended (+rework_observed)             (Task 11)
  templates/delivery-plan.template.json, profile.template.json, plan-block.template.md                 (Tasks 3, 5, 13)
  references/event-model.md, metrics.md, plan-block.md, spike-1.md                                     (Tasks 0, 13)
  fixtures/plan-markdown/tasks-excerpt.md                                                              (Task 4)
  fixtures/security-testing/{extract-dataset.mjs, dataset.json, build-fixture-repo.mjs, golden.json}   (Task 10)
skills.json; both factory.json; generated marketplaces                                                  (Task 1)
bundles/feature-development/agents/{tech-lead,project-manager,scout}/AGENT.md, instructions.md; bundles/test-automation/agents/{scout,test-automation-lead}/AGENT.md (Task 13)
bundles/SPEC.md, CLAUDE.md, README.md, AGENTS.md                                                        (Task 0)
```

Shared vocabulary (spec §6.2, with this plan's representation choices): an **observation** is one ledger line; `observation_id = source:source_record_id:item_id:event` (each part `encodeURIComponent`-ed); `item_id` is run-scoped (`<campaign_id>/<run_id>/<slug>`); `revision` is an integer ≥ 0; `transition_id` names the occurrence (`<item_id>/<event>/<token>`); `plan` on a line = `<campaign_id>/<run_id>` and `meta.version` = plan version; `basis ∈ observed | derived-child | plan-commit` in M1; `source ∈ cli | hook | git` in M1; `meta.stage` is a semantic fact (part of equivalence).

---

### Task 0: M-1 doc fixes, SPEC.md amendments, SPIKE-1 procedure

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `AGENTS.md` (orphan/external counts), `bundles/SPEC.md:291-304` (P-0, P-1)
- Create: `skills/delivery-metrics/references/spike-1.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Verify the actual counts**

Run: `ls skills | wc -l` and `node -e 'const s=JSON.parse(require("fs").readFileSync("skills.json","utf8"));const a=Array.isArray(s)?s:(s.skills??[]);console.log(a.filter(x=>x.repo).length, a.filter(x=>x.monorepo).length)'`
Expected: 11 skill dirs; 30 `repo:` entries; 3 `monorepo` entries (4 after Task 1). Write the docs for the post-Task-1 state: **12 orphan skills, 30 externals**. If the JSON shape differs, open the file — do not guess.

- [ ] **Step 2: Fix CLAUDE.md, README.md, AGENTS.md**

In `CLAUDE.md` replace the sentence `Top-level \`agents/\` and \`skills/\` hold only the standalone-only "orphan" content … eight skills (…)` so it lists the twelve directory names (`ls skills` + `delivery-metrics`) and says 30 externals. `grep -n "eight\|28 external\|8 orphan" README.md AGENTS.md` → update each hit to 12 / 30 and add `delivery-metrics — cycle time, velocity and estimate-vs-actual for harness work items; sibling of tokenomics` to any enumerated list.

- [ ] **Step 3: Amend bundles/SPEC.md (P-0, P-1)**

`bundles/SPEC.md` "One shared telemetry submodule" bullet: replace `**one subfolder per factory** (test-automation writes \`automation/\`)` with `**one subfolder per factory or per cross-factory concern** (test-automation writes \`automation/\`; the orphan \`delivery-metrics\` skill writes \`delivery/\`)`. Append to the "Roster-guard shared-event hooks" bullet: `A cross-factory skill has no single roster: its hook must instead require (a) an open plan it registered in this repo, (b) a session→plan association written by that plan's owner, and (c) the dispatched role in the roster snapshot the plan recorded (the union of participating factories' installed agents) — and exit silently otherwise (\`skills/delivery-metrics\`).`

- [ ] **Step 4: Write the SPIKE-1 procedure**

`skills/delivery-metrics/references/spike-1.md` — the manual probe an operator runs once on a real Claude Code session, because tests cannot spawn one:
```markdown
# SPIKE-1 — hook input probe (run once per Claude Code version)

Why: the SubagentStop payload and the sub-agent transcript layout are not
pinned by tests; until this probe has been run, the hook's transcript
handling is labelled `provisional` in every report caveat.

1. In a repo with delivery-metrics installed, add a temporary hook entry
   to `.claude/settings.local.json`:
   `{"SubagentStop":[{"matcher":"*","hooks":[{"type":"command","command":"cat > /tmp/subagentstop-$(date +%s).json","timeout":5}]}]}`
2. Dispatch (a) one Agent-tool sub-agent with a description, (b) one
   Workflow-tool sub-agent, (c) two same-role sub-agents concurrently,
   (d) the same from inside a `.claude/worktrees/<x>` checkout and from a
   plain `git worktree add` checkout.
3. For each capture record: the payload keys present (`session_id`,
   `agent_id`, `transcript_path`, `agent_transcript_path`, `cwd`,
   `agent_type`?), whether `transcript_path` is the parent or the child,
   the child path shape under `~/.claude/projects/<proj>/<session>/subagents/`,
   the `.meta.json` keys, and the first/last record `timestamp` presence.
4. Save sanitised copies (ids only, no prompt text) under
   `skills/delivery-metrics/fixtures/hooks/real/<claude-version>/` with a
   `README.md` naming the Claude Code version, date and the sanitisation
   done, and update `hooks/dispatch-hook.mjs` `SUPPORTED_SHAPES` + tests.
5. Remove the temporary hook entry.
Until step 4 is committed, `findChildTranscript` accepts only the
documented shape (`<parent dir>/<session>/subagents/<agent_id>.jsonl` with
a sibling `.meta.json`) and every report prints
`hook-transcript-shapes: provisional until SPIKE-1`.
```

- [ ] **Step 5: Validate and commit**

Run: `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes && npm test` → green.
```bash
git add CLAUDE.md README.md AGENTS.md bundles/SPEC.md skills/delivery-metrics/references/spike-1.md
git commit -m "docs: orphan/external counts, SPEC P-0/P-1, SPIKE-1 procedure (delivery-metrics M-1)"
```

---

### Task 1: Skill scaffold, registration, `lib/paths.mjs`

**Files:**
- Create: `skills/delivery-metrics/SKILL.md`, `skills/delivery-metrics/README.md`
- Create: `skills/delivery-metrics/scripts/lib/paths.mjs`, `skills/delivery-metrics/scripts/lib/paths.test.mjs`, `scripts/lib/roster.mjs`, `scripts/lib/roster.test.mjs`, `references/factory-roles.json` (last three relative to `skills/delivery-metrics/`)
- Modify: `skills.json`, `bundles/feature-development/factory.json:166-169`, `bundles/test-automation/factory.json:11-14`; regenerate the three marketplaces

**Interfaces:**
- Produces: `resolveOwnerRepo(repo) → absolute main checkout` (plain non-Git directories pass through); `ownerRepo(payload, env) → resolveOwnerRepo(payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd())`; `deliveryDir(repo)`, `plansDir(repo)`, `sessionsDir(repo)`, `profilePath(repo)`; `encodeSegment(s)` / `decodeSegment(s)`; `runPath(repo, runId)` (`plans/<enc(runId)>.json`); `eventsPath(repo, slug)`; `sessionPath(repo, host, session)`; `whoAmI(repo) → {name, email, slug}` (tokenomics rule, `telemetry-capture.mjs:75-94`); `withLock(repo, fn, {staleMs=60000, now}) → fn()` (throws `cliError('LOCK-BUSY', …)`); `nowIso(now)`; `sha256(textOrBuffer)`; `cliError(code, detail) → Error{code, exit}` (exit map from Global Constraint 8; `detail` newlines flattened).

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/paths.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveOwnerRepo, ownerRepo, deliveryDir, encodeSegment, decodeSegment, runPath, eventsPath, sessionPath, withLock, nowIso, sha256, whoAmI, cliError } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-paths-'));

test('deliveryDir is .agents/telemetry/delivery under the repo', () => {
  const repo = tmp();
  assert.equal(deliveryDir(repo), join(repo, '.agents', 'telemetry', 'delivery'));
});

test('owner is shared before telemetry exists, from linked and nested directories', () => {
  const repo = tmp();
  const g = (...args) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  g('init', '-q', '-b', 'main'); g('commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(tmp(), 'arbitrary'); g('worktree', 'add', '-q', '-b', 'work', wt);
  mkdirSync(join(wt, 'nested'));
  assert.equal(resolveOwnerRepo(join(wt, 'nested')), realpathSync(repo));
  assert.equal(ownerRepo({ cwd: wt }, { CLAUDE_PROJECT_DIR: tmp() }), realpathSync(repo));
  assert.equal(deliveryDir(wt), deliveryDir(repo));
  assert.equal(runPath(wt, 'a/b'), runPath(repo, 'a/b'));
  assert.equal(sessionPath(wt, 'claude', 's'), sessionPath(repo, 'claude', 's'));
  assert.equal(resolveOwnerRepo(tmp()).startsWith('/'), true);
});

test('encodeSegment percent-encodes / % : reversibly and leaves the rest', () => {
  assert.equal(encodeSegment('sec/run-1'), 'sec%2Frun-1');
  assert.equal(encodeSegment('a%b'), 'a%25b');
  assert.equal(decodeSegment(encodeSegment('x/y%z%2F:q')), 'x/y%z%2F:q');
  assert.equal(encodeSegment('TASK-023'), 'TASK-023');
});

test('runPath / eventsPath / sessionPath', () => {
  const repo = tmp();
  assert.equal(runPath(repo, 'sec/run-1'), join(deliveryDir(repo), 'plans', 'sec%2Frun-1.json'));
  assert.equal(eventsPath(repo, 'daniel-sallai'), join(deliveryDir(repo), 'events-daniel-sallai.jsonl'));
  assert.equal(sessionPath(repo, 'claude', 'sess/1'), join(deliveryDir(repo), 'sessions', 'claude%3Asess%2F1.json'));
});

test('withLock: mkdir lock, LOCK-BUSY while fresh, reclaimed when stale', () => {
  const repo = tmp();
  let ran = 0;
  withLock(repo, () => { ran++; assert.ok(existsSync(join(deliveryDir(repo), '.lock'))); });
  assert.equal(ran, 1); assert.ok(!existsSync(join(deliveryDir(repo), '.lock')));
  mkdirSync(join(deliveryDir(repo), '.lock'), { recursive: true });
  assert.throws(() => withLock(repo, () => {}, { now: Date.now() }), (e) => e.code === 'LOCK-BUSY' && e.exit === 2);
  const old = (Date.now() - 120000) / 1000;
  utimesSync(join(deliveryDir(repo), '.lock'), old, old);
  withLock(repo, () => { ran++; }, { now: Date.now() });
  assert.equal(ran, 2);
});

test('nowIso, sha256, cliError, whoAmI', () => {
  assert.equal(nowIso(0), '1970-01-01T00:00:00.000Z');
  assert.match(sha256('x'), /^[0-9a-f]{64}$/);
  assert.equal(sha256(Buffer.from('x')), sha256('x'));
  const e = cliError('NO-PLAN', 'a\nb');
  assert.equal(e.exit, 3); assert.equal(e.message, 'NO-PLAN(a b)');
  assert.equal(cliError('USAGE', 'x').exit, 2); assert.equal(cliError('WHAT', 'x').exit, 1);
  assert.match(whoAmI(tmp()).slug, /^[a-z0-9-]+$/);
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test skills/delivery-metrics/scripts/lib/paths.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Write `paths.mjs`**

```js
// STDLIB ONLY. Paths, identity, errors and the advisory lock for the delivery ledger (spec §6.1, D3, D21).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';

export function resolveOwnerRepo(repo) {
  const candidate = resolve(repo);
  const g = (...args) => { try { return execFileSync('git', ['-C', candidate, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  const top = g('rev-parse', '--show-toplevel')?.trim();
  if (!top) return candidate;
  // Git lists the main checkout first, even with --separate-git-dir; never guess from path spelling.
  const listing = g('worktree', 'list', '--porcelain', '-z');
  const first = listing?.split('\0').find((v) => v.startsWith('worktree '))?.slice(9);
  if (!first || !isAbsolute(first)) throw cliError('USAGE', 'cannot resolve telemetry owner from git worktree list');
  return resolve(first);
}
export const ownerRepo = (payload = {}, env = {}) => resolveOwnerRepo(payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());

export const deliveryDir = (repo) => join(resolveOwnerRepo(repo), '.agents', 'telemetry', 'delivery');
export const plansDir = (repo) => join(deliveryDir(repo), 'plans');
export const sessionsDir = (repo) => join(deliveryDir(repo), 'sessions');
export const profilePath = (repo) => join(deliveryDir(repo), 'profile.json');

/** Reversible; only `%`, `/` and `:` are encoded so ids stay readable in `ls`. */
export const encodeSegment = (s) => String(s).replace(/%/g, '%25').replace(/\//g, '%2F').replace(/:/g, '%3A');
export const decodeSegment = (s) => String(s).replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%25/g, '%');
export const runPath = (repo, runId) => join(plansDir(repo), `${encodeSegment(runId)}.json`);
export const eventsPath = (repo, slug) => join(deliveryDir(repo), `events-${slug}.jsonl`);
export const sessionPath = (repo, host, session) => join(sessionsDir(repo), `${encodeSegment(`${host}:${session}`)}.json`);

export const nowIso = (now = Date.now()) => new Date(now).toISOString();
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const EXIT = { USAGE: 2, 'SCHEMA-INVALID': 2, 'ID-CONFLICT': 2, 'INVALID-TRANSITION': 2, 'AMBIGUOUS-PLAN': 2, 'MIGRATION-REQUIRED': 2, 'LOCK-BUSY': 2, CONFLICT: 2, 'NO-PLAN': 3, 'NO-EVENTS': 3 };
export function cliError(code, detail) {
  const e = new Error(`${code}(${String(detail).replace(/\s*\n\s*/g, ' ')})`);
  e.code = code; e.exit = EXIT[code] ?? 1; return e;
}

/** Same identity rule as tokenomics: git user.name, else OS user, else email local-part; slugged. */
export function whoAmI(repo) {
  const git = (key) => { try { return execFileSync('git', ['-C', repo, 'config', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };
  const email = git('user.email');
  const name = git('user.name') || userInfo().username;
  const base = name || (email ? email.split('@')[0] : null);
  const slug = String(base ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return { name, email, slug };
}

/** Advisory mkdir lock, 60 s stale rule. Serialises only this skill's own writes; no cross-process promise (spec §6.1). */
export function withLock(repo, fn, { staleMs = 60000, now = Date.now() } = {}) {
  const dir = join(deliveryDir(repo), '.lock');
  mkdirSync(deliveryDir(repo), { recursive: true });
  try { mkdirSync(dir); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0; try { age = now - statSync(dir).mtimeMs; } catch { age = staleMs + 1; }
    if (age <= staleMs) throw cliError('LOCK-BUSY', `another delivery-metrics write holds ${dir} (advisory; stale after ${staleMs / 1000}s)`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
  }
  try { return fn(); } finally { rmSync(dir, { recursive: true, force: true }); }
}
```

- [ ] **Step 3a: Ship the factory map and roster resolver**

Create `scripts/lib/roster.mjs`, `scripts/lib/roster.test.mjs` and `references/factory-roles.json`. Generate the map from the package manifests once during implementation (and regenerate when factory membership changes); this code runs at the repository root, never in an installed consumer. The whole orphan skill, including this JSON, is copied by the installer.

```js
// Run with node --input-type=module on stdin from the repo root.
import { readFileSync, writeFileSync } from 'node:fs';
const ids = ['feature-development', 'test-automation', 'manual-qa'];
const factories = Object.fromEntries(ids.map((id) => {
  const f = JSON.parse(readFileSync(`bundles/${id}/factory.json`, 'utf8'));
  return [id, [...new Set([...(f.localAgents ?? []), ...(f.agents ?? []).map((a) => typeof a === 'string' ? a : a.id)])].sort()];
}));
writeFileSync('skills/delivery-metrics/references/factory-roles.json', `${JSON.stringify({ v: 1, factories }, null, 2)}\n`);
```

`roster.mjs` exports `installedAgents(repo) → string[]`, `makeRoster(repo, factories, requested=null) → {v:1,factories:string[],agents:string[],map_sha256:string}`, and `validRoster(snapshot) → boolean`. `requested` is an optional explicit assertion of the discovered union, not an unverified list of roles. Empty unions permit manual CLI tracking but admit no named hook role. The legacy missing-type exception still requires a valid snapshot and binding. Snapshot validation checks shape, known factories, sorted unique names, map hash and membership; it is not authentication. Later installation changes take effect only on registration or `plan roster` refresh.

```js
// scripts/lib/roster.mjs — STDLIB ONLY; all factory data travels with this skill.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cliError, resolveOwnerRepo, sha256 } from './paths.mjs';
const bytes = readFileSync(new URL('../../references/factory-roles.json', import.meta.url));
const map = JSON.parse(bytes.toString('utf8'));
const digest = sha256(bytes);
const sorted = (xs) => [...new Set(xs)].sort();
export function installedAgents(repo) {
  const roles = [];
  for (const root of new Set([repo, resolveOwnerRepo(repo)])) for (const host of ['.claude', '.cursor', '.windsurf', '.github', '.codex']) {
    const dir = join(root, host, 'agents');
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(dir, e.name, 'AGENT.md'))) roles.push(e.name);
      else if (e.isFile() && /(?:(?:\.agent)?\.md|\.toml)$/.test(e.name)) roles.push(e.name.replace(/(?:(?:\.agent)?\.md|\.toml)$/, ''));
    }
  }
  return sorted(roles);
}
export function makeRoster(repo, factories, requested = null) {
  if (!Array.isArray(factories) || !factories.length || factories.some((f) => !Object.hasOwn(map.factories, f))) throw cliError('USAGE', 'unknown participating factory');
  const fs = sorted(factories), allowed = new Set(fs.flatMap((f) => map.factories[f]));
  const agents = installedAgents(repo).filter((a) => allowed.has(a));
  if (requested && JSON.stringify(sorted(requested)) !== JSON.stringify(agents)) throw cliError('USAGE', 'roster must equal installed participating-factory union');
  return { v: 1, factories: fs, agents, map_sha256: digest };
}
export function validRoster(s) {
  if (!s || s.v !== 1 || s.map_sha256 !== digest || !Array.isArray(s.factories) || !s.factories.length || !Array.isArray(s.agents)) return false;
  if (s.factories.some((f) => typeof f !== 'string' || !Object.hasOwn(map.factories, f)) || s.agents.some((a) => typeof a !== 'string')) return false;
  const allowed = new Set(s.factories.flatMap((f) => map.factories[f]));
  return JSON.stringify(s.factories) === JSON.stringify(sorted(s.factories)) && JSON.stringify(s.agents) === JSON.stringify(sorted(s.agents)) && s.agents.every((a) => allowed.has(a));
}
```

- [ ] **Step 3b: Test the installed roster layouts and membership boundary**

```js
// scripts/lib/roster.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedAgents, makeRoster, validRoster } from './roster.mjs';
test('factory map intersects installed roles on every supported layout', () => {
  for (const host of ['.claude', '.cursor', '.windsurf', '.github', '.codex']) {
    const repo = mkdtempSync(join(tmpdir(), 'dm-roster-'));
    const dir = join(repo, host, 'agents'); mkdirSync(dir, { recursive: true });
    for (const role of ['js-dev', 'test-automation-lead', 'qa-auditor']) {
      if (host === '.codex') writeFileSync(join(dir, `${role}.toml`), 'role');
      else if (host === '.github') writeFileSync(join(dir, `${role}.agent.md`), 'role');
      else { mkdirSync(join(dir, role)); writeFileSync(join(dir, role, 'AGENT.md'), 'role'); }
    }
    assert.equal(installedAgents(repo).length, 3);
    const s = makeRoster(repo, ['feature-development', 'test-automation']);
    assert.deepEqual(s.agents, ['js-dev', 'test-automation-lead']); assert.equal(validRoster(s), true);
    assert.equal(validRoster({ ...s, agents: [...s.agents, 'qa-auditor'] }), false);
    assert.equal(validRoster({ ...s, map_sha256: 'changed' }), false);
    assert.throws(() => makeRoster(repo, s.factories, ['qa-auditor']), /roster must equal/);
  }
});
```

Run `node --test skills/delivery-metrics/scripts/lib/paths.test.mjs skills/delivery-metrics/scripts/lib/roster.test.mjs` → all pass.

- [ ] **Step 4: Run test to verify it passes** — all timeline tests pass. Monday is 2026-09-14: 09:00 → 13:00 = 4 × 3600 = 14,400 seconds; Tuesday is 2026-09-15. First completion and first start are unchanged by Tuesday’s added child. Task 7 asserts actual 4 h / ((2 + 6) / 2) h = 1, hit true, and one Monday completion.

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
# 2. Bind this session (lets the hook attribute dispatches) and record transitions as they happen
node .claude/skills/delivery-metrics/scripts/delivery.mjs session set --host claude --session <id> --plan sec/run-1
node .claude/skills/delivery-metrics/scripts/delivery.mjs event TASK-023 done --sha <merge-sha> --id done-023
node .claude/skills/delivery-metrics/scripts/delivery.mjs event G12 done --sha <landing-sha> --id land-g12    # mission landing
# 3. Fill in history that predates the ledger
node .claude/skills/delivery-metrics/scripts/delivery.mjs backfill --git --plan sec/run-1 --head <sha>
# 4. Optional: automatic dispatch start/end on Claude Code (+ shared telemetry submodule)
node .claude/skills/delivery-metrics/scripts/install-hooks.mjs            # --remove undoes, --doctor checks
# 5. Read
node .claude/skills/delivery-metrics/scripts/delivery.mjs status
node .claude/skills/delivery-metrics/scripts/delivery.mjs report [--json] [--since 2026-09-01] [--level task] [--class M]
```

Contracts: `references/event-model.md`, `references/plan-block.md`, `references/metrics.md`, `references/spike-1.md`.
Design: `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`.
```
`README.md`: the same quick start plus "What it does not do" from spec §8 / §18 (no DORA, no forecasting, no per-person figures, no cost recomputation, Copilot capture parked, review rounds / blocked / reopen derived in M2).

- [ ] **Step 6: Register the skill**

`skills.json` — add `{ "id": "delivery-metrics", "monorepo": "sdlc-skills", "name": "delivery-metrics", "description": "Delivery performance tracker for harness work items — cycle time, weekly throughput/velocity and estimate-vs-actual delta per campaign/mission/task from a git-committed event ledger; sibling of tokenomics." }` next to the `memory` entry. Add `"delivery-metrics"` to `skills` in both factory.json files. Run `npm run gen:marketplaces`.

- [ ] **Step 7: Validate and commit**

Run: `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` → green.
```bash
git add skills/delivery-metrics skills.json bundles/feature-development/factory.json bundles/test-automation/factory.json .cursor-plugin .codex-plugin .github/plugin
git commit -m "feat(delivery-metrics): skill scaffold, registration, lib/paths"
```

---

### Task 2: `lib/events.mjs` — validated observations, append, read with provenance, revision resolution

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/events.mjs`, `skills/delivery-metrics/scripts/lib/events.test.mjs`

**Interfaces:**
- Consumes: `paths.mjs` (`eventsPath`, `deliveryDir`, `whoAmI`, `nowIso`, `withLock`, `sha256`, `cliError`).
- Produces:
  - `EVENTS` (18 names, spec §6.2), `SOURCES = ['cli','automation-sync','hook','git']`, `SOURCE_RANK`, `BASES`, `LEVELS`, `HOSTS`, `SCHEMA_VERSION = 2`.
  - `observationId({source, sourceRecordId, itemId, event}) → string`.
  - `validateRecord(rec) → string[]` — the single validator used by append AND read: `v === 2`; `at`/`recorded_at` valid ISO and `=== new Date(x).toISOString()`; `event ∈ EVENTS`; `source ∈ SOURCES`; `host ∈ HOSTS`; `plan` non-empty; `item_id`/`ref`/`level` all null only when `meta.unattributed === true` and `event ∈ dispatched|dispatch_ended`; `level ∈ LEVELS` when present; `transition_id` non-empty; `source_record_id` non-empty; `revision` integer ≥ 0; `status ∈ active|retracted`; `basis ∈ BASES`; `observation_id === observationId(...)`; `estimate` (when present) passes `validateEstimate` from `plan.mjs` — to avoid a circular import, `validateEstimate` lives **here** in `events.mjs` and `plan.mjs` re-exports it.
  - `validateEstimate(e) → string[]` — unit `h|active_min`; finite `low ≤ high ≥ 0`; `tier ∈ ROM|budgetary|calibrated|unknown`; `calibrated` requires `reference: {path (non-empty), sha256 (64 hex), population (non-empty string)}`; `proposed_by` non-empty; `proposed_at` ISO; `accepted_by` null or non-empty; `accepted_at` null or ISO; `probability` absent or `0 < p < 1`.
  - `makeObservation(fields, {now}) → record` — normalises `at`, fills `v`, `recorded_at`, `observation_id`, `revision: 0`, `status: 'active'`, `basis: 'observed'`, nullable handles, then runs `validateRecord` and throws `cliError('SCHEMA-INVALID', first error)`.
  - `semanticKey(rec) → string` — canonical JSON (sorted keys) of `{observation_id, revision, status, plan, item_id, ref, level, event, transition_id, basis, at, facts}`; `facts = {stage: meta.stage ?? null, round: meta.round ?? null, result: meta.result ?? null, git_sha: meta.git_sha ?? null, pr: meta.pr ?? null, estimate: estimate ?? null, raw: raw ?? null, version: meta.version ?? null}`. Capture envelope (`recorded_at`, `user`, `host`, `session`, `agentId`, `role`, `label`, `meta.note`, evidence locators) excluded so retries collapse.
  - `factKey(rec)` = `semanticKey` minus `observation_id`/`revision`/`status` — what two different observations must agree on to be **equivalent** at the same rank (used by timeline).
  - `appendObservation(repo, rec, {slug, now}) → {result:'EVENT'|'SKIP'|'ID-CONFLICT', observation_id, revision, path}` — validates (throws `SCHEMA-INVALID`), takes the lock, reads every user file, compares against lines with the same `observation_id` + `revision`: equal `semanticKey` → `SKIP`; different → `ID-CONFLICT` (nothing written); else appends once.
  - `readRaw(repo) → {lines: [{rec, path, line}], files: [{path, sha256, bytes}], counts: {files, parsed, malformed, unknownVersion}, malformed: [{path, line, reason}]}` — reads each file **once** as a Buffer, hashes it, splits on `0x0a`, decodes each slice with `new TextDecoder('utf-8', {fatal: true})` (decode failure → malformed), `JSON.parse`, then `validateRecord` (failure → malformed with the first error; `v !== 2` → unknownVersion). A complete record at EOF without a trailing newline is accepted.
  - `resolveObservations(repo) → {active: rec[], conflicts: [{observation_id, revision, item_id, transition_id, basis, source, plan, paths}], counts: {...readRaw.counts, retries, superseded, retracted, conflicts}, files, malformed}` — per `observation_id`: take the **highest** revision present; if that revision has > 1 distinct `semanticKey` → CONFLICT (the observation contributes nothing to `active`, but its `{item_id, transition_id, basis, source}` are reported so the timeline can **block lower-rank fallback for that occurrence**); lower revisions with conflicts are history and ignored; `retracted` at the top revision → dropped and counted; exact duplicates counted as `retries`. Each active record carries `_at: {path, line}` (evidence locator) — non-enumerable so it never gets re-serialised.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/events.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeObservation, observationId, appendObservation, readRaw, resolveObservations, validateRecord, validateEstimate, semanticKey, factKey, EVENTS, SOURCE_RANK } from './events.mjs';
import { deliveryDir, eventsPath } from './paths.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-events-'));
const T0 = Date.parse('2026-09-16T10:00:00Z');
const base = (over = {}) => makeObservation({
  at: '2026-09-16T09:00:00Z', user: 'u', host: 'cli', plan: 'sec/run-1', item_id: 'sec/run-1/task-023', ref: 'TASK-023',
  level: 'task', event: 'done', transition_id: 'sec/run-1/task-023/done/episode-1', source: 'cli', source_record_id: 'tok-1', meta: { version: 1 }, ...over,
}, { now: T0 });
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'D', accepted_at: '2026-09-16T08:30:00Z' };

test('makeObservation fills v2 defaults and a stable, encoded observation_id', () => {
  const r = base();
  assert.equal(r.v, 2); assert.equal(r.recorded_at, '2026-09-16T10:00:00.000Z'); assert.equal(r.at, '2026-09-16T09:00:00.000Z');
  assert.equal(r.observation_id, observationId({ source: 'cli', sourceRecordId: 'tok-1', itemId: 'sec/run-1/task-023', event: 'done' }));
  assert.equal(r.observation_id, 'cli:tok-1:sec%2Frun-1%2Ftask-023:done');
  assert.equal(r.revision, 0); assert.equal(r.status, 'active'); assert.equal(r.basis, 'observed'); assert.equal(r.session, null);
  assert.ok(EVENTS.includes('rework_observed')); assert.equal(SOURCE_RANK.cli, 0); assert.equal(SOURCE_RANK.git, 3);
  assert.deepEqual(validateRecord(r), []);
});

test('validation: events, dates, sources, transition, nullable item, estimate, calibrated reference', () => {
  assert.throws(() => base({ event: 'merged' }), /SCHEMA-INVALID\(event/);
  assert.throws(() => base({ at: 'yesterday' }), /SCHEMA-INVALID\(at/);
  assert.throws(() => base({ source: 'manual' }), /SCHEMA-INVALID\(source/);
  assert.throws(() => base({ transition_id: '' }), /SCHEMA-INVALID\(transition_id/);
  assert.throws(() => base({ item_id: null }), /SCHEMA-INVALID\(item_id/);
  assert.throws(() => base({ item_id: null, ref: null, level: null, meta: { unattributed: true } }), /SCHEMA-INVALID\(item_id/, 'unattributed only for dispatch events');
  assert.doesNotThrow(() => base({ item_id: null, ref: null, level: null, event: 'dispatched', meta: { unattributed: true } }));
  assert.throws(() => base({ revision: -1 }), /SCHEMA-INVALID\(revision/);
  assert.throws(() => base({ event: 'estimated', estimate: { ...EST, unit: 'd' } }), /SCHEMA-INVALID\(estimate\.unit/);
  assert.deepEqual(validateEstimate(EST), []);
  assert.ok(validateEstimate({ ...EST, low: 5 }).some((e) => /low/.test(e)));
  assert.ok(validateEstimate({ ...EST, probability: 1 }).some((e) => /probability/.test(e)));
  assert.ok(validateEstimate({ ...EST, tier: 'calibrated' }).some((e) => /reference/.test(e)));
  assert.deepEqual(validateEstimate({ ...EST, tier: 'calibrated', reference: { path: 'calibration/x.json', sha256: 'a'.repeat(64), population: 'task/S first-cycle n=12' } }), []);
  const stored = { ...base(), at: '2026-09-16T09:00:00Z' };
  assert.ok(validateRecord(stored).some((e) => /at/.test(e)), 'stored clocks must be canonical ms ISO');
});

test('semanticKey ignores capture envelope; factKey includes plan, stage, sha — so different runs/stages never coalesce', () => {
  const a = base(); const b = base({ user: 'v', host: 'git', session: 's', label: 'x', meta: { version: 1, note: 'n' } });
  assert.equal(semanticKey(a), semanticKey(b));
  assert.notEqual(factKey(base({ plan: 'sec/run-2', item_id: 'sec/run-2/task-023', transition_id: 'sec/run-2/task-023/done/episode-1' })), factKey(a));
  const d1 = base({ event: 'dispatched', transition_id: 't/dispatched/a1', meta: { stage: 'build' } });
  const d2 = base({ event: 'dispatched', transition_id: 't/dispatched/a1', meta: { stage: 'review' } });
  assert.notEqual(factKey(d1), factKey(d2));
  assert.equal(factKey(base({ meta: { git_sha: 'abc' } })), factKey(base({ meta: { git_sha: 'abc', evidence: 'x' } })));
});

test('appendObservation: EVENT, SKIP on identical retry (different recorded_at), ID-CONFLICT on changed semantics, EVENT for a higher revision', () => {
  const repo = tmp();
  assert.equal(appendObservation(repo, base(), { slug: 'u', now: T0 }).result, 'EVENT');
  assert.equal(appendObservation(repo, base(), { slug: 'u', now: T0 + 5000 }).result, 'SKIP');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
  assert.equal(appendObservation(repo, base({ at: '2026-09-16T08:00:00Z' }), { slug: 'u', now: T0 }).result, 'ID-CONFLICT');
  assert.equal(readFileSync(eventsPath(repo, 'u'), 'utf8').split('\n').filter(Boolean).length, 1);
  assert.equal(appendObservation(repo, base({ at: '2026-09-16T08:00:00Z', revision: 1 }), { slug: 'u', now: T0 }).result, 'EVENT');
  assert.throws(() => appendObservation(repo, { ...base(), event: 'nope' }, { slug: 'u', now: T0 }), /SCHEMA-INVALID/);
});

test('readRaw: invalid UTF-8, torn JSON, schema-invalid JSON and unknown version are skipped with path:line; EOF record without newline is read; files hashed once', () => {
  const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true });
  const good = JSON.stringify(base());
  writeFileSync(eventsPath(repo, 'a'), Buffer.concat([Buffer.from(`${good}\n`), Buffer.from([0xc3, 0x28, 0x0a]), Buffer.from('{"v":2,"truncated":tru\n'), Buffer.from(`${JSON.stringify({ ...base({ source_record_id: 't2' }), revision: -1 })}\n`)]));
  writeFileSync(eventsPath(repo, 'b'), `${JSON.stringify({ ...base({ source_record_id: 't3' }), v: 9 })}\n${JSON.stringify(base({ source_record_id: 't4' }))}`);
  const raw = readRaw(repo);
  assert.equal(raw.counts.files, 2); assert.equal(raw.counts.parsed, 2); assert.equal(raw.counts.malformed, 3); assert.equal(raw.counts.unknownVersion, 1);
  assert.deepEqual(raw.malformed.map((m) => m.line), [2, 3, 4]);
  assert.match(raw.malformed[0].reason, /utf-8/i); assert.match(raw.malformed[2].reason, /revision/);
  assert.equal(raw.files.length, 2); assert.match(raw.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(raw.lines[1].line, 2, 'EOF record in file b is line 2');
});

test('resolveObservations: highest revision wins even after a conflicting lower one; top-revision conflict blocks and is reported; retracted dropped', () => {
  const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true });
  const w = (slug, rec) => appendFileSync(eventsPath(repo, slug), `${JSON.stringify(rec)}\n`);
  w('a', base()); w('a', base());                                                             // rev 0 + retry
  w('b', base({ revision: 1, at: '2026-09-16T08:30:00Z' }));                                   // correction
  w('a', base({ source_record_id: 'x', at: '2026-09-16T01:00:00Z' })); w('b', base({ source_record_id: 'x', at: '2026-09-16T02:00:00Z' })); // rev0 conflict
  w('a', base({ source_record_id: 'x', revision: 1, at: '2026-09-16T03:00:00Z' }));            // unique higher revision → supersedes the conflict
  w('a', base({ source_record_id: 'y', at: '2026-09-16T01:00:00Z' })); w('b', base({ source_record_id: 'y', at: '2026-09-16T02:00:00Z' })); // current conflict
  w('a', base({ source_record_id: 'z' })); w('b', base({ source_record_id: 'z', revision: 1, status: 'retracted' }));
  const r = resolveObservations(repo);
  const ids = r.active.map((o) => o.source_record_id).sort();
  assert.deepEqual(ids, ['tok-1', 'x']);
  assert.equal(r.active.find((o) => o.source_record_id === 'tok-1').at, '2026-09-16T08:30:00.000Z');
  assert.equal(r.active.find((o) => o.source_record_id === 'x').at, '2026-09-16T03:00:00.000Z');
  assert.equal(r.counts.retries, 1); assert.equal(r.counts.retracted, 1); assert.equal(r.counts.conflicts, 1);
  assert.equal(r.conflicts[0].source_record_id ?? r.conflicts[0].observation_id, 'cli:y:sec%2Frun-1%2Ftask-023:done');
  assert.equal(r.conflicts[0].transition_id, 'sec/run-1/task-023/done/episode-1'); assert.equal(r.conflicts[0].source, 'cli');
  assert.ok(r.active[0]._at.path.endsWith('.jsonl') && r.active[0]._at.line > 0, 'evidence locator carried');
  assert.ok(!JSON.stringify(r.active[0]).includes('"_at"'), 'locator is not re-serialised');
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Write `events.mjs`**

```js
// STDLIB ONLY. One ledger line per observation (spec §6.2): shared validator, append-only per-user files,
// read-time resolution (highest revision, retracted dropped, same-revision disagreement = CONFLICT, never a winner).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliError, deliveryDir, eventsPath, nowIso, sha256, whoAmI, withLock } from './paths.mjs';

export const SCHEMA_VERSION = 2;
export const EVENTS = ['created', 'estimated', 'dispatched', 'dispatch_ended', 'first_commit', 'review_requested', 'review_returned', 'review_approved',
  'review_history', 'done', 'cancelled', 'blocked', 'unblocked', 'reopened', 'scope_declared', 'gate_observed', 'outcome_observed', 'rework_observed'];
export const SOURCES = ['cli', 'automation-sync', 'hook', 'git'];
export const SOURCE_RANK = Object.fromEntries(SOURCES.map((s, i) => [s, i]));
export const BASES = ['observed', 'derived-child', 'scope-proxy', 'gate-proxy', 'receipt-proxy', 'plan-commit'];
export const LEVELS = ['campaign', 'mission', 'task', 'case'];
export const HOSTS = ['claude', 'copilot', 'copilot-vscode', 'cli', 'git'];
const TIERS = ['ROM', 'budgetary', 'calibrated', 'unknown'];

const enc = (s) => encodeURIComponent(String(s));
export const observationId = ({ source, sourceRecordId, itemId, event }) => `${enc(source)}:${enc(sourceRecordId)}:${enc(itemId ?? 'unattributed')}:${enc(event)}`;
const canonicalIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;
const anyIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

export function validateEstimate(e, at = 'estimate') {
  const errs = [];
  if (!e || typeof e !== 'object') return [`${at}: not an object`];
  if (!['h', 'active_min'].includes(e.unit)) errs.push(`${at}.unit must be h|active_min`);
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!num(e.low)) errs.push(`${at}.low must be a finite number ≥ 0`);
  if (!num(e.high)) errs.push(`${at}.high must be a finite number ≥ 0`);
  if (num(e.low) && num(e.high) && e.low > e.high) errs.push(`${at}.low must be ≤ high`);
  if (!TIERS.includes(e.tier)) errs.push(`${at}.tier must be ROM|budgetary|calibrated|unknown`);
  if (e.tier === 'calibrated') {
    const r = e.reference;
    if (!r || typeof r !== 'object' || !r.path || !/^[0-9a-f]{64}$/.test(r.sha256 ?? '') || !r.population) errs.push(`${at}.reference {path, sha256, population} required for tier calibrated`);
  }
  if (!e.proposed_by) errs.push(`${at}.proposed_by required`);
  if (!anyIso(e.proposed_at)) errs.push(`${at}.proposed_at must be ISO`);
  if (e.accepted_by != null && (typeof e.accepted_by !== 'string' || !e.accepted_by.trim())) errs.push(`${at}.accepted_by must be a name or null`);
  if (e.accepted_at != null && !anyIso(e.accepted_at)) errs.push(`${at}.accepted_at must be ISO or null`);
  if (e.probability != null && !(typeof e.probability === 'number' && e.probability > 0 && e.probability < 1)) errs.push(`${at}.probability must be 0<p<1`);
  return errs;
}

export function validateRecord(r) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['record: not an object'];
  if (r.v !== SCHEMA_VERSION) errs.push(`v must be ${SCHEMA_VERSION}`);
  if (!canonicalIso(r.at)) errs.push('at must be canonical UTC ms ISO');
  if (!canonicalIso(r.recorded_at)) errs.push('recorded_at must be canonical UTC ms ISO');
  if (!EVENTS.includes(r.event)) errs.push(`event ${r.event} unknown`);
  if (!SOURCES.includes(r.source)) errs.push(`source ${r.source} unknown`);
  if (!HOSTS.includes(r.host)) errs.push(`host ${r.host} unknown`);
  if (!r.plan || typeof r.plan !== 'string') errs.push('plan required');
  const unattributed = r.meta?.unattributed === true && ['dispatched', 'dispatch_ended'].includes(r.event);
  if (r.item_id == null || r.ref == null || r.level == null) { if (!unattributed || r.item_id != null || r.ref != null || r.level != null) errs.push('item_id/ref/level required (null only together for unattributed dispatch)'); }
  else if (!LEVELS.includes(r.level)) errs.push(`level ${r.level} unknown`);
  if (!r.transition_id || typeof r.transition_id !== 'string') errs.push('transition_id required');
  if (!r.source_record_id || typeof r.source_record_id !== 'string') errs.push('source_record_id required');
  if (!Number.isInteger(r.revision) || r.revision < 0) errs.push('revision must be an integer ≥ 0');
  if (!['active', 'retracted'].includes(r.status)) errs.push('status must be active|retracted');
  if (!BASES.includes(r.basis)) errs.push(`basis ${r.basis} unknown`);
  if (r.source && r.source_record_id && r.event && r.observation_id !== observationId({ source: r.source, sourceRecordId: r.source_record_id, itemId: r.item_id, event: r.event })) errs.push('observation_id does not match its tuple');
  if (r.estimate != null) errs.push(...validateEstimate(r.estimate));
  if (r.meta != null && typeof r.meta !== 'object') errs.push('meta must be an object');
  return errs;
}

export function makeObservation(f, { now = Date.now() } = {}) {
  const rec = {
    v: SCHEMA_VERSION, at: anyIso(f.at) ? new Date(f.at).toISOString() : f.at, recorded_at: nowIso(now), user: f.user ?? null, host: f.host, plan: f.plan,
    item_id: f.item_id ?? null, ref: f.ref ?? null, level: f.level ?? null, event: f.event, transition_id: f.transition_id, source: f.source,
    source_record_id: f.source_record_id == null ? f.source_record_id : String(f.source_record_id),
    observation_id: observationId({ source: f.source, sourceRecordId: f.source_record_id, itemId: f.item_id, event: f.event }),
    revision: f.revision ?? 0, status: f.status ?? 'active', basis: f.basis ?? 'observed', session: f.session ?? null, agentId: f.agentId ?? null,
    role: f.role ?? null, label: f.label ?? null, raw: f.raw ?? null, ...(f.estimate ? { estimate: f.estimate } : {}), meta: f.meta ?? {},
  };
  const errs = validateRecord(rec);
  if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  return rec;
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const facts = (r) => ({ stage: r.meta?.stage ?? null, round: r.meta?.round ?? null, result: r.meta?.result ?? null, git_sha: r.meta?.git_sha ?? null, pr: r.meta?.pr ?? null, estimate: r.estimate ?? null, raw: r.raw ?? null, version: r.meta?.version ?? null });
export const factKey = (r) => JSON.stringify(sortKeys({ plan: r.plan, item_id: r.item_id, ref: r.ref, level: r.level, event: r.event, transition_id: r.transition_id, basis: r.basis, at: r.at, facts: facts(r) }));
export const semanticKey = (r) => JSON.stringify(sortKeys({ observation_id: r.observation_id, revision: r.revision, status: r.status, fact: JSON.parse(factKey(r)) }));

const decoder = new TextDecoder('utf-8', { fatal: true });
export function readRaw(repo) {
  const dir = deliveryDir(repo);
  const counts = { files: 0, parsed: 0, malformed: 0, unknownVersion: 0 };
  const lines = [], files = [], malformed = [];
  if (!existsSync(dir)) return { lines, files, counts, malformed };
  for (const f of readdirSync(dir).filter((n) => /^events-.*\.jsonl$/.test(n)).sort()) {
    counts.files++;
    const path = join(dir, f);
    const buf = readFileSync(path);
    files.push({ path, sha256: sha256(buf), bytes: buf.length });
    let start = 0, lineNo = 0;
    while (start < buf.length) {
      let end = buf.indexOf(0x0a, start); if (end === -1) end = buf.length;
      const slice = buf.subarray(start, end); start = end + 1; lineNo++;
      if (!slice.length || !slice.toString('latin1').trim()) continue;
      let text; try { text = decoder.decode(slice); } catch { counts.malformed++; malformed.push({ path, line: lineNo, reason: 'invalid utf-8' }); continue; }
      let rec; try { rec = JSON.parse(text); } catch { counts.malformed++; malformed.push({ path, line: lineNo, reason: 'invalid json' }); continue; }
      if (!rec || typeof rec !== 'object' || rec.v !== SCHEMA_VERSION) { counts.unknownVersion++; continue; }
      const errs = validateRecord(rec);
      if (errs.length) { counts.malformed++; malformed.push({ path, line: lineNo, reason: errs[0] }); continue; }
      counts.parsed++;
      lines.push({ rec, path, line: lineNo });
    }
  }
  return { lines, files, counts, malformed };
}

export function resolveObservations(repo) {
  const raw = readRaw(repo);
  const byId = new Map();
  let retries = 0;
  for (const { rec, path, line } of raw.lines) {
    const revs = byId.get(rec.observation_id) ?? new Map(); byId.set(rec.observation_id, revs);
    const key = semanticKey(rec);
    const cur = revs.get(rec.revision);
    if (!cur) revs.set(rec.revision, { variants: new Map([[key, rec]]), paths: [`${path}:${line}`], first: { path, line } });
    else { if (cur.variants.has(key)) retries++; else cur.variants.set(key, rec); cur.paths.push(`${path}:${line}`); }
  }
  const active = [], conflicts = [];
  let superseded = 0, retracted = 0;
  for (const [id, revs] of byId) {
    const top = Math.max(...revs.keys());
    superseded += revs.size - 1;
    const entry = revs.get(top);
    const sample = entry.variants.values().next().value;
    if (entry.variants.size > 1) { conflicts.push({ observation_id: id, revision: top, item_id: sample.item_id, transition_id: sample.transition_id, basis: sample.basis, source: sample.source, plan: sample.plan, paths: entry.paths }); continue; }
    if (sample.status === 'retracted') { retracted++; continue; }
    Object.defineProperty(sample, '_at', { value: entry.first, enumerable: false });
    active.push(sample);
  }
  active.sort((a, b) => a.at.localeCompare(b.at) || a.observation_id.localeCompare(b.observation_id));
  return { active, conflicts, files: raw.files, malformed: raw.malformed, counts: { ...raw.counts, retries, superseded, retracted, conflicts: conflicts.length } };
}

export function appendObservation(repo, rec, { slug, now = Date.now() } = {}) {
  const line = { ...rec, user: rec.user ?? slug ?? whoAmI(repo).slug, recorded_at: nowIso(now) };
  const errs = validateRecord(line);
  if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  return withLock(repo, () => {
    const key = semanticKey(line);
    for (const { rec: r } of readRaw(repo).lines) {
      if (r.observation_id !== line.observation_id || r.revision !== line.revision) continue;
      return { result: semanticKey(r) === key ? 'SKIP' : 'ID-CONFLICT', observation_id: line.observation_id, revision: line.revision, path: null };
    }
    mkdirSync(deliveryDir(repo), { recursive: true });
    const path = eventsPath(repo, line.user);
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    return { result: 'EVENT', observation_id: line.observation_id, revision: line.revision, path };
  }, { now });
}
```

- [ ] **Step 4: Run test to verify it passes** — 6 passing. The conflict test's `r.conflicts[0].source_record_id ?? observation_id` assertion accepts the reported `observation_id` (`cli:y:…`).

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-metrics/scripts/lib/events.mjs skills/delivery-metrics/scripts/lib/events.test.mjs
git commit -m "feat(delivery-metrics): validated observation ledger — append with SKIP/ID-CONFLICT, read with provenance, revision resolution"
```

---

### Task 3: `lib/plan.mjs` — plan block, schema, run-scoped ids, catalogue, delta

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/plan.mjs`, `skills/delivery-metrics/scripts/lib/plan.test.mjs`, `skills/delivery-metrics/templates/delivery-plan.template.json`

**Interfaces:**
- Consumes: `paths.mjs` (`runPath`, `plansDir`, `sha256`, `nowIso`, `decodeSegment`), `events.mjs` (`makeObservation`, `validateEstimate`).
- Produces:
  - `extractPlanBlock(text) → object|null` — first ```` ```json delivery-plan ```` fence, or the whole text if it is JSON.
  - `runIdOf(obj) → '<campaign_id>/<run_id>'`; `validatePlan(obj) → string[]` (rules below); `assignIds(obj) → obj` — `item_id`s: campaign `<run>/campaign`, mission `<run>/mission-<slug(ref)>`, task `<run>/task-<slug(ref)>`; `validateIds(obj) → string[]` — after assignment: every `item_id` unique, matches `^<run>/`, every reference to a parent exists (the nested shape makes cycles impossible; still checked when `parent_item_id` is explicit).
  - `toCatalogue(obj, {version}) → item[]` rows `{item_id, ref, level, parent_item_id, story, class, role, branch, sequence, estimate, version_added: version, cancelled: false}`.
  - `canonicalHash(obj)`; `loadRun(repo, runId) → runRecord|null`; `listRuns(repo)`; `saveRun(repo, rec)`.
  - `mergeCatalogue(prevItems, nextItems, {keepMissing}) → items` — union by `item_id`; present in `next` → updated fields, `cancelled: false`, `version_added` kept; missing from `next` → kept with `cancelled: !keepMissing || prev.cancelled`.
  - `estimateChange(prevEst, nextEst) → 'none'|'new'|'changed'|'changed-stale-acceptance'` — `changed-stale-acceptance` when `low/high/unit/tier` differ but the acceptance pair is not newer (`accepted_at` ≤ previous `accepted_at`, or missing).
  - `estimateStatus(e, {stale=false}) → 'accepted'|'unaccepted'|'none'` (`stale` forces `unaccepted`).
  - `planDelta(prev, next, {keepMissing}) → {created, estimated: [{item, stale}], cancelled, reopened}`.
  - `registrationObservations({run, version, delta, token, at, createdAtOf, now}) → record[]` — `created` (`at = createdAtOf(item) ?? at` with `basis: plan-commit` when `createdAtOf` returns `{at, sha}`, else `observed`), `estimated` (`estimate` payload; `meta.estimate_revision`, `meta.acceptance` (`accepted|unaccepted|stale-acceptance`), `at = accepted_at ?? proposed_at`, `transition_id <item>/estimated/rev-<n>`), `cancelled` (`raw removed-from-plan`), `reopened` (`raw re-added-to-plan`, `transition_id <item>/reopened/v<version>`); every record `plan = run`, `meta.version = version`, `source_record_id = token` — identities depend only on token + item + event so a retry `SKIP`s.

**`validatePlan` rules:** `campaign_id`, `run_id` `^[a-z0-9][a-z0-9-]*$`; `version` positive integer; `factory ∈ feature-development|test-automation|manual-qa`; `observation_start` ISO; `source_epoch.from` ISO, `until` ISO|null, `integration_ref` non-empty; `mission_kind ∈ group|milestone|wave|batch|run`; `campaign.ref` non-empty; missions: `ref` unique across the plan, `sequence` positive integer unique; tasks: `ref` unique across the plan, `story` optional `^US-\d+$`; every `estimate` passes `validateEstimate`; explicit `item_id`s (if any) unique; `supersedes` optional `{run: '<campaign>/<run>', item_map: {old: new}}` — values injective, and (checked by the CLI against the saved predecessor) every key an existing item, every value an item of this plan.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/plan.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPlanBlock, validatePlan, validateIds, runIdOf, assignIds, toCatalogue, canonicalHash, saveRun, loadRun, listRuns, mergeCatalogue, estimateChange, estimateStatus, planDelta, registrationObservations } from './plan.mjs';

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

test('validatePlan / validateIds: duplicates, bad fields, explicit id collisions, injective supersedes', () => {
  assert.deepEqual(validatePlan(PLAN()), []);
  const p = PLAN(); p.missions[0].tasks.push({ ref: 'TASK-001' }); p.version = 0; p.factory = 'ops';
  const errs = validatePlan(p);
  assert.ok(errs.some((e) => /duplicate ref TASK-001/.test(e))); assert.ok(errs.some((e) => /version/.test(e))); assert.ok(errs.some((e) => /factory/.test(e)));
  const q = PLAN(); q.missions[0].tasks[1].item_id = 'sec/run-1/task-task-001';
  assert.ok(validateIds(assignIds(q)).some((e) => /duplicate item_id/.test(e)));
  const s = PLAN(); s.supersedes = { run: 'sec/run-1', item_map: { a: 'x', b: 'x' } };
  assert.ok(validatePlan(s).some((e) => /injective/.test(e)));
  const g = PLAN(); g.missions[0].tasks[0].ref = 'TASK-00 1'; g.missions[0].tasks[1].ref = 'TASK-00-1';
  assert.ok(validateIds(assignIds(g)).some((e) => /duplicate item_id/.test(e)), 'distinct refs that slug to the same id are rejected');
});

test('assignIds + toCatalogue: run-scoped stable ids, parent links, version_added', () => {
  const p = assignIds(PLAN());
  assert.equal(runIdOf(p), 'sec/run-1');
  const cat = toCatalogue(p, { version: 1 });
  assert.deepEqual(cat.map((i) => [i.item_id, i.level, i.parent_item_id]), [
    ['sec/run-1/campaign', 'campaign', null], ['sec/run-1/mission-g1', 'mission', 'sec/run-1/campaign'],
    ['sec/run-1/task-task-001', 'task', 'sec/run-1/mission-g1'], ['sec/run-1/task-task-002', 'task', 'sec/run-1/mission-g1']]);
  assert.equal(cat[2].branch, 'task/task-001'); assert.equal(cat[1].sequence, 1); assert.equal(cat[3].version_added, 1); assert.equal(cat[3].cancelled, false);
  assert.equal(canonicalHash(PLAN()), canonicalHash({ ...PLAN(), campaign_id: 'sec' }));
  assert.deepEqual(validateIds(p), []);
});

test('save/load/list runs; mergeCatalogue keeps history and version_added', () => {
  const repo = tmp();
  const items = toCatalogue(assignIds(PLAN()), { version: 1 });
  saveRun(repo, { run: 'sec/run-1', campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', items });
  assert.equal(loadRun(repo, 'sec/run-1').items.length, 4); assert.equal(listRuns(repo).length, 1); assert.equal(loadRun(repo, 'nope/x'), null);
  const next = toCatalogue(assignIds({ ...PLAN(), version: 2, missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001' }, { ref: 'TASK-003' }] }] }), { version: 2 });
  const merged = mergeCatalogue(items, next, {});
  assert.deepEqual(merged.map((i) => [i.ref, i.cancelled, i.version_added]), [['sec', false, 1], ['G1', false, 1], ['TASK-001', false, 1], ['TASK-003', false, 2], ['TASK-002', true, 1]]);
  assert.equal(mergeCatalogue(items, next, { keepMissing: true }).find((i) => i.ref === 'TASK-002').cancelled, false);
});

test('estimateChange / estimateStatus: a changed range needs a NEW acceptance pair', () => {
  assert.equal(estimateChange(null, EST), 'new'); assert.equal(estimateChange(EST, EST), 'none');
  assert.equal(estimateChange(EST, { ...EST, high: 5 }), 'changed-stale-acceptance');
  assert.equal(estimateChange(EST, { ...EST, high: 5, accepted_at: '2026-09-17T08:00:00Z' }), 'changed');
  assert.equal(estimateChange(EST, { ...EST, high: 5, accepted_by: null, accepted_at: null }), 'changed-stale-acceptance');
  assert.equal(estimateStatus(EST), 'accepted'); assert.equal(estimateStatus({ ...EST, accepted_at: null }), 'unaccepted');
  assert.equal(estimateStatus(EST, { stale: true }), 'unaccepted'); assert.equal(estimateStatus(undefined), 'none');
});

test('planDelta and registrationObservations: created/estimated/cancelled/reopened with stable identities', () => {
  const prev = toCatalogue(assignIds(PLAN()), { version: 1 });
  const nextPlan = { ...PLAN(), version: 2, missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001', class: 'S', estimate: { ...EST, high: 4 } }, { ref: 'TASK-003' }] }] };
  const next = toCatalogue(assignIds(nextPlan), { version: 2 });
  const d = planDelta(prev, next, {});
  assert.deepEqual(d.created.map((i) => i.ref), ['TASK-003']);
  assert.deepEqual(d.estimated.map((e) => [e.item.ref, e.stale]), [['TASK-001', true]], 'changed range with the old pair is a stale acceptance');
  assert.deepEqual(d.cancelled.map((i) => i.ref), ['TASK-002']);
  assert.deepEqual(planDelta(prev, next, { keepMissing: true }).cancelled, []);
  const d0 = planDelta([], next, {});
  assert.equal(d0.created.length, 4); assert.equal(d0.estimated.length, 2);
  const run = { run: 'sec/run-1', items: prev };
  const recs = registrationObservations({ run, version: 1, delta: planDelta([], prev, {}), token: 'reg-1', at: '2026-09-16T09:00:00Z', createdAtOf: () => ({ at: '2026-09-15T12:00:00Z', sha: 'abc' }), now: 0 });
  const created = recs.filter((r) => r.event === 'created');
  assert.equal(created.length, 4); assert.equal(created[0].basis, 'plan-commit'); assert.equal(created[0].at, '2026-09-15T12:00:00.000Z'); assert.equal(created[0].meta.git_sha, 'abc');
  assert.equal(created[0].observation_id, 'cli:reg-1:sec%2Frun-1%2Fcampaign:created'); assert.equal(created[0].plan, 'sec/run-1'); assert.equal(created[0].meta.version, 1);
  const est = recs.find((r) => r.event === 'estimated' && r.ref === 'TASK-001');
  assert.equal(est.transition_id, 'sec/run-1/task-task-001/estimated/rev-0'); assert.equal(est.at, '2026-09-16T08:30:00.000Z'); assert.equal(est.meta.acceptance, 'accepted');
  const recs2 = registrationObservations({ run: { run: 'sec/run-1', items: next }, version: 2, delta: d, token: 'reg-2', at: '2026-09-17T00:00:00Z', createdAtOf: () => null, now: 0 });
  const est2 = recs2.find((r) => r.event === 'estimated'); assert.equal(est2.meta.acceptance, 'stale-acceptance'); assert.equal(est2.transition_id, 'sec/run-1/task-task-001/estimated/rev-1');
  assert.equal(recs2.find((r) => r.event === 'created').basis, 'observed');
  assert.equal(recs2.find((r) => r.event === 'cancelled').ref, 'TASK-002');
  const same = registrationObservations({ run, version: 1, delta: planDelta([], prev, {}), token: 'reg-1', at: '2026-09-16T09:00:00Z', createdAtOf: () => ({ at: '2026-09-15T12:00:00Z', sha: 'abc' }), now: 99 });
  assert.equal(same[0].observation_id, recs[0].observation_id);
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Write `plan.mjs`**

```js
// STDLIB ONLY. Registered work-item tree per run (spec §5, §6.3) and its delta → observations.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeObservation, validateEstimate } from './events.mjs';
import { decodeSegment, plansDir, runPath, sha256 } from './paths.mjs';

export { validateEstimate };
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const FACTORIES = ['feature-development', 'test-automation', 'manual-qa'];
const MISSION_KINDS = ['group', 'milestone', 'wave', 'batch', 'run'];
const iso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function extractPlanBlock(text) {
  const m = /```json\s+delivery-plan\s*\n([\s\S]*?)\n```/.exec(text);
  try { const o = JSON.parse(m ? m[1] : text); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
export const runIdOf = (p) => `${p.campaign_id}/${p.run_id}`;

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
  const refs = new Set(), seqs = new Set(), ids = new Set();
  const seeRef = (r, where) => { if (!r) errs.push(`${where}: ref required`); else if (refs.has(r)) errs.push(`${where}: duplicate ref ${r}`); else refs.add(r); };
  const seeId = (o, where) => { if (o.item_id != null) { if (ids.has(o.item_id)) errs.push(`${where}: duplicate item_id ${o.item_id}`); ids.add(o.item_id); } };
  if (p.campaign?.ref) { refs.add(p.campaign.ref); seeId(p.campaign, 'campaign'); }
  for (const m of p.missions ?? []) {
    seeRef(m.ref, 'mission'); seeId(m, `mission ${m.ref}`);
    if (!Number.isInteger(m.sequence) || m.sequence < 1) errs.push(`mission ${m.ref}: sequence must be a positive integer`);
    else if (seqs.has(m.sequence)) errs.push(`mission ${m.ref}: duplicate sequence ${m.sequence}`); else seqs.add(m.sequence);
    if (m.estimate) errs.push(...validateEstimate(m.estimate, `mission ${m.ref}.estimate`));
    for (const t of m.tasks ?? []) {
      seeRef(t.ref, `mission ${m.ref} task`); seeId(t, `task ${t.ref}`);
      if (t.story != null && !/^US-\d+$/.test(t.story)) errs.push(`task ${t.ref}: story must match US-<n>`);
      if (t.estimate) errs.push(...validateEstimate(t.estimate, `task ${t.ref}.estimate`));
    }
  }
  if (p.supersedes) {
    const vals = Object.values(p.supersedes.item_map ?? {});
    if (!p.supersedes.run) errs.push('supersedes.run required');
    if (new Set(vals).size !== vals.length) errs.push('supersedes.item_map must be injective');
  }
  return errs;
}

export function assignIds(p) {
  const out = JSON.parse(JSON.stringify(p)); const run = runIdOf(out);
  out.campaign.item_id ??= `${run}/campaign`;
  for (const m of out.missions ?? []) { m.item_id ??= `${run}/mission-${slugify(m.ref)}`; for (const t of m.tasks ?? []) t.item_id ??= `${run}/task-${slugify(t.ref)}`; }
  return out;
}
export function validateIds(p) {
  const errs = [], seen = new Set(), run = runIdOf(p);
  const see = (o, where) => { if (!String(o.item_id).startsWith(`${run}/`)) errs.push(`${where}: item_id must start with ${run}/`); if (seen.has(o.item_id)) errs.push(`${where}: duplicate item_id ${o.item_id}`); seen.add(o.item_id); };
  see(p.campaign, 'campaign');
  for (const m of p.missions ?? []) { see(m, `mission ${m.ref}`); for (const t of m.tasks ?? []) see(t, `task ${t.ref}`); }
  return errs;
}

export function toCatalogue(p, { version }) {
  const rows = [];
  const row = (o, level, parent) => rows.push({ item_id: o.item_id, ref: o.ref, level, parent_item_id: parent, story: o.story ?? null, class: o.class ?? null, role: o.role ?? null,
    branch: o.branch ?? null, sequence: o.sequence ?? null, estimate: o.estimate ?? null, version_added: version, cancelled: false });
  row(p.campaign, 'campaign', null);
  for (const m of p.missions ?? []) { row(m, 'mission', p.campaign.item_id); for (const t of m.tasks ?? []) row(t, 'task', m.item_id); }
  return rows;
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
export const canonicalHash = (p) => sha256(JSON.stringify(sortKeys(p)));

export function saveRun(repo, rec) { mkdirSync(plansDir(repo), { recursive: true }); writeFileSync(runPath(repo, rec.run), `${JSON.stringify(rec, null, 2)}\n`); }
export function loadRun(repo, runId) { const p = runPath(repo, runId); if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
export function listRuns(repo) {
  if (!existsSync(plansDir(repo))) return [];
  return readdirSync(plansDir(repo)).filter((f) => f.endsWith('.json')).sort().map((f) => loadRun(repo, decodeSegment(f.replace(/\.json$/, '')))).filter(Boolean);
}

export function mergeCatalogue(prev, next, { keepMissing = false } = {}) {
  const nextBy = new Map(next.map((i) => [i.item_id, i]));
  const prevBy = new Map(prev.map((i) => [i.item_id, i]));
  const out = next.map((i) => ({ ...i, version_added: prevBy.get(i.item_id)?.version_added ?? i.version_added, cancelled: false }));
  for (const i of prev) if (!nextBy.has(i.item_id)) out.push({ ...i, cancelled: keepMissing ? Boolean(i.cancelled) : true });
  return out;
}

const rangeKey = (e) => JSON.stringify([e.unit, e.low, e.high, e.tier]);
export function estimateChange(prev, next) {
  if (!next) return 'none';
  if (!prev) return 'new';
  if (rangeKey(prev) === rangeKey(next)) return 'none';
  const newer = next.accepted_by && next.accepted_at && (!prev.accepted_at || Date.parse(next.accepted_at) > Date.parse(prev.accepted_at));
  return newer ? 'changed' : 'changed-stale-acceptance';
}
export const estimateStatus = (e, { stale = false } = {}) => (!e ? 'none' : (!stale && e.accepted_by && e.accepted_at ? 'accepted' : 'unaccepted'));

export function planDelta(prev, next, { keepMissing = false } = {}) {
  const prevBy = new Map(prev.map((i) => [i.item_id, i])); const nextBy = new Map(next.map((i) => [i.item_id, i]));
  const created = [], estimated = [], cancelled = [], reopened = [];
  for (const i of next) {
    const old = prevBy.get(i.item_id);
    if (!old) { created.push(i); if (i.estimate) estimated.push({ item: i, stale: false }); continue; }
    if (old.cancelled) reopened.push(i);
    const ch = estimateChange(old.estimate, i.estimate);
    if (ch === 'new' || ch === 'changed') estimated.push({ item: i, stale: false });
    else if (ch === 'changed-stale-acceptance') estimated.push({ item: i, stale: true });
  }
  if (!keepMissing) for (const i of prev) if (!nextBy.has(i.item_id) && !i.cancelled) cancelled.push(i);
  return { created, estimated, cancelled, reopened };
}

/** Observations for one registration; identities depend only on token+item+event so retries SKIP. */
export function registrationObservations({ run, version, delta, token, at, createdAtOf = () => null, now = Date.now() }) {
  const common = { user: null, host: 'cli', plan: run.run, source: 'cli', source_record_id: token };
  const base = (i) => ({ ...common, item_id: i.item_id, ref: i.ref, level: i.level });
  const out = [];
  for (const i of delta.created) {
    const c = createdAtOf(i);
    out.push(makeObservation({ ...base(i), event: 'created', transition_id: `${i.item_id}/created/0`, at: c?.at ?? at, basis: c?.sha ? 'plan-commit' : 'observed', meta: { version, ...(c?.sha ? { git_sha: c.sha } : {}) } }, { now }));
  }
  for (const { item: i, stale } of delta.estimated) {
    const rev = i.estimate_revision ?? 0;
    out.push(makeObservation({ ...base(i), event: 'estimated', transition_id: `${i.item_id}/estimated/rev-${rev}`, at: i.estimate.accepted_at ?? i.estimate.proposed_at, estimate: i.estimate,
      meta: { version, estimate_revision: rev, acceptance: stale ? 'stale-acceptance' : estimateStatus(i.estimate) } }, { now }));
  }
  for (const i of delta.cancelled) out.push(makeObservation({ ...base(i), event: 'cancelled', transition_id: `${i.item_id}/cancelled/episode-1`, at, raw: 'removed-from-plan', meta: { version } }, { now }));
  for (const i of delta.reopened) out.push(makeObservation({ ...base(i), event: 'reopened', transition_id: `${i.item_id}/reopened/v${version}`, at, raw: 're-added-to-plan', meta: { version } }, { now }));
  return out;
}
```
`estimate_revision` is set by the CLI (Task 5) from the count of existing `estimated` observations for that item before calling `registrationObservations`.

- [ ] **Step 4: Run test to verify it passes** — 6 passing.

- [ ] **Step 5: Template** — `templates/delivery-plan.template.json`: the `PLAN()` object with placeholders (`"<campaign-id>"`, `"<run-1>"`, `"<Name>"`), `accepted_by: null, accepted_at: null` so a fresh copy is visibly `unaccepted`.

- [ ] **Step 6: Commit**
```bash
git add skills/delivery-metrics/scripts/lib/plan.mjs skills/delivery-metrics/scripts/lib/plan.test.mjs skills/delivery-metrics/templates/delivery-plan.template.json
git commit -m "feat(delivery-metrics): plan block schema, run-scoped ids, catalogue merge, delta → registration observations"
```

---

### Task 4: `lib/plan-markdown.mjs` — tasks-file importer

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/plan-markdown.mjs`, `skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`, `skills/delivery-metrics/fixtures/plan-markdown/tasks-excerpt.md`

**Interfaces:**
- Produces: `parseExecutionBlock(text) → [{ref:'G12', nums:['023','034']}]` — reads **only** the first fenced code block after the heading `## 1. Execution plan`; a line `^(G\d+)\s+(.*)$` starts a group; an indented line (no `G` prefix) inside the block continues the previous group; parenthesised text is stripped first (dependency notes like `(needs 004: …)` are not memberships); the remainder is split into columns on ` · ` and on runs of ≥ 2 spaces; each column's leading `\d{3,}` is a member. `parseTaskHeadings(text) → Map<ref, {ref, title, story, class, role, num, branch}>` from `#### TASK-NNN: title` headings and the following `**Story:** … · **Assigned:** … · **Complexity:** …` line (`**Assigned to:**` accepted). `importTasksMarkdown(text, opts) → {plan, warnings[]}` — canonical delivery-plan **without estimates**; unlisted tasks → mission `ungrouped` (last sequence + 1) with a warning; `plan.import = {basis: 'markdown-import', task_count, group_count, source_sha256}`.

The real input this must parse (`feat/security-testing-bundle-spec:docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md`, verified): 30 groups `G0`–`G29`; `G0   001 docs (M-1)                                   055 hook probe (independent, any time)`; `G2   002 canon (needs 004: writeArtifact → redactDeep)`; `G6 …` with a continuation line `     032 purge · 058 run snapshot register|verify|proposals · 059 register render`; 59 task headings.

- [ ] **Step 1: Write the fixture and the failing test**

`skills/delivery-metrics/fixtures/plan-markdown/tasks-excerpt.md`:
````markdown
# excerpt — technical decomposition

## 1. Execution plan

Dependency graph first.

```
G0   001 docs (M-1)                                   055 hook probe (independent, any time)
G1   003 normalize · 004 redact
G2   002 canon (needs 004: writeArtifact → redactDeep)
G6   008 pipeline · 013 scope
     032 purge · 058 run snapshot register|verify|proposals
```

### Parallel groups

| Group | Tasks |
|---|---|
| G0 | 001, 055 |

## 5. Technical tasks

#### TASK-001: Repo docs match the installer
**Story:** US-001 · **Assigned:** maintainer / js-dev · **Depends on:** none · **Complexity:** S

#### TASK-055: Hook-input probe result
**Story:** US-030 · **Assigned to:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-003: `normalize.mjs` + published test vectors
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-004: `redact.mjs` + `redaction-rules.json` v1
**Story:** US-003 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-002: `canon.mjs` — strict reader
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** TASK-004 · **Complexity:** L

#### TASK-008: pipeline
**Story:** US-004 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** L

#### TASK-013: scope
**Story:** US-004 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-032: purge
**Story:** US-005 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-058: run snapshot
**Story:** US-005 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-099: Orphan task not in any group
**Story:** US-009 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S
````

`skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExecutionBlock, parseTaskHeadings, importTasksMarkdown } from './plan-markdown.mjs';
import { validatePlan, validateIds, assignIds } from './plan.mjs';

const text = readFileSync(new URL('../../fixtures/plan-markdown/tasks-excerpt.md', import.meta.url), 'utf8');
const opts = { campaign_id: 'sec', run_id: 'run-1', observation_start: '2026-09-15T00:00:00Z' };

test('parseExecutionBlock: bounded to the block, columns, continuation lines, dependency notes ignored', () => {
  assert.deepEqual(parseExecutionBlock(text), [
    { ref: 'G0', nums: ['001', '055'] }, { ref: 'G1', nums: ['003', '004'] }, { ref: 'G2', nums: ['002'] }, { ref: 'G6', nums: ['008', '013', '032', '058'] }]);
  assert.deepEqual(parseExecutionBlock('# no plan here\n| G0 | 001 |\n'), [], 'tables outside the block are not memberships');
});

test('parseTaskHeadings: story/class/role, Assigned to: variant', () => {
  const t = parseTaskHeadings(text);
  assert.equal(t.size, 10);
  assert.deepEqual(t.get('TASK-001'), { ref: 'TASK-001', title: 'Repo docs match the installer', story: 'US-001', class: 'S', role: 'maintainer / js-dev', num: '001', branch: 'task/task-001' });
  assert.equal(t.get('TASK-055').role, 'js-dev');
});

test('importTasksMarkdown: groups → missions, no estimates, ungrouped warning, valid plan', () => {
  const { plan, warnings } = importTasksMarkdown(text, opts);
  assert.deepEqual(validatePlan(plan), []); assert.deepEqual(validateIds(assignIds(plan)), []);
  assert.deepEqual(plan.missions.map((m) => [m.ref, m.sequence, m.tasks.map((t) => t.ref)]), [
    ['G0', 1, ['TASK-001', 'TASK-055']], ['G1', 2, ['TASK-003', 'TASK-004']], ['G2', 3, ['TASK-002']], ['G6', 4, ['TASK-008', 'TASK-013', 'TASK-032', 'TASK-058']], ['ungrouped', 5, ['TASK-099']]]);
  assert.ok(plan.missions.every((m) => m.tasks.every((t) => t.estimate == null)));
  assert.equal(plan.import.basis, 'markdown-import'); assert.equal(plan.import.task_count, 10); assert.equal(plan.import.group_count, 4); assert.match(plan.import.source_sha256, /^[0-9a-f]{64}$/);
  assert.match(warnings.join('\n'), /TASK-099.*not listed in any group/);
  assert.match(importTasksMarkdown('# empty', opts).warnings.join('\n'), /no TASK headings/);
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Write `plan-markdown.mjs`**

```js
// STDLIB ONLY. Convenience importer: tech-lead tasks markdown → canonical delivery-plan (never invents estimates).
import { sha256 } from './paths.mjs';

const HEAD_RE = /^####\s+(TASK-\d{3,})\s*:\s*(.*)$/;
const FIELD = (line, name) => { const m = new RegExp(`\\*\\*${name}\\s*:\\*\\*\\s*([^·\\n]+)`).exec(line); return m ? m[1].trim() : null; };

export function parseExecutionBlock(text) {
  const lines = text.split('\n');
  let i = lines.findIndex((l) => /^##\s+1\.\s+Execution plan/.test(l));
  if (i === -1) return [];
  while (i < lines.length && !/^```/.test(lines[i])) i++;
  if (i >= lines.length) return [];
  const groups = [];
  for (let j = i + 1; j < lines.length && !/^```/.test(lines[j]); j++) {
    const raw = lines[j]; if (!raw.trim()) continue;
    const g = /^(G\d+)\s+(.*)$/.exec(raw);
    const body = (g ? g[2] : raw).replace(/\([^)]*\)/g, ' ').replace(/←.*$/, ' ');
    const nums = body.split(/\s·\s|\s{2,}/).map((c) => /^\s*(\d{3,})\b/.exec(c)).filter(Boolean).map((m) => m[1]);
    if (g) groups.push({ ref: g[1], nums });
    else if (groups.length && /^\s+/.test(raw)) groups[groups.length - 1].nums.push(...nums);
  }
  return groups;
}

export function parseTaskHeadings(text) {
  const lines = text.split('\n'); const tasks = new Map();
  for (let i = 0; i < lines.length; i++) {
    const h = HEAD_RE.exec(lines[i]); if (!h) continue;
    let header = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) if (/\*\*Story:\*\*|\*\*Complexity:\*\*/.test(lines[j])) { header = lines[j]; break; }
    const story = FIELD(header, 'Story');
    tasks.set(h[1], { ref: h[1], title: h[2].trim(), story: story && /^US-\d+$/.test(story) ? story : null, class: FIELD(header, 'Complexity'),
      role: FIELD(header, 'Assigned to') ?? FIELD(header, 'Assigned'), num: h[1].replace(/^TASK-/, ''), branch: `task/task-${h[1].replace(/^TASK-/, '')}` });
  }
  return tasks;
}

const strip = (t) => { const o = { ref: t.ref, title: t.title, branch: t.branch }; if (t.story) o.story = t.story; if (t.class) o.class = t.class; if (t.role) o.role = t.role; return o; };

export function importTasksMarkdown(text, { campaign_id, run_id, version = 1, factory = 'feature-development', observation_start, integration_ref = 'main', mission_kind = 'group', campaign_ref = campaign_id } = {}) {
  const warnings = [];
  const tasks = parseTaskHeadings(text);
  if (!tasks.size) warnings.push('no TASK headings found');
  const groups = parseExecutionBlock(text);
  const placed = new Set();
  const missions = groups.map((g, i) => ({ ref: g.ref, sequence: i + 1, tasks: g.nums.map((n) => [...tasks.values()].find((t) => t.num === n)).filter(Boolean).filter((t) => !placed.has(t.ref)).map((t) => { placed.add(t.ref); return strip(t); }) })).filter((m) => m.tasks.length);
  const rest = [...tasks.values()].filter((t) => !placed.has(t.ref));
  if (rest.length) { warnings.push(`${rest.map((t) => t.ref).join(', ')}: not listed in any group — placed in mission "ungrouped"`); missions.push({ ref: 'ungrouped', sequence: missions.length + 1, tasks: rest.map(strip) }); }
  const plan = { campaign_id, run_id, version, factory, observation_start, source_epoch: { from: observation_start, until: null, integration_ref }, campaign: { ref: campaign_ref }, mission_kind, missions,
    import: { basis: 'markdown-import', task_count: tasks.size, group_count: groups.length, source_sha256: sha256(text) } };
  return { plan, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes** — 3 passing. Sanity-check against the real file: `node -e "import('./skills/delivery-metrics/scripts/lib/plan-markdown.mjs').then(m=>{const t=require('child_process').execFileSync('git',['show','feat/security-testing-bundle-spec:docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md'],{encoding:'utf8'});const g=m.parseExecutionBlock(t);console.log(g.length,g.flatMap(x=>x.nums).length,new Set(g.flatMap(x=>x.nums)).size, m.parseTaskHeadings(t).size)})"` → `30 59 59 59` (every task in exactly one group).

- [ ] **Step 5: Commit**
```bash
git add skills/delivery-metrics/scripts/lib/plan-markdown.mjs skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs skills/delivery-metrics/fixtures/plan-markdown
git commit -m "feat(delivery-metrics): markdown tasks-file importer bounded to the execution block"
```

---

### Task 5: `lib/git.mjs`, `lib/sync.mjs`, `scripts/delivery.mjs` — CLI: plan, session, event, profile

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/git.mjs` (+ test), `skills/delivery-metrics/scripts/lib/sync.mjs` (+ test), `skills/delivery-metrics/scripts/delivery.mjs` (+ test), `skills/delivery-metrics/templates/profile.template.json`

**Interfaces:**
- `git.mjs`: `git(repo, args) → string|null` (argv array, never shell); `commitTime(repo, sha) → {sha, at}|null` (full sha + canonical ISO committer time); `firstCommitContaining(repo, head, relPath, ref) → {sha, at}|null` (walk `git log --reverse --format=%H%x1f%cI <head> -- <relPath>`; first commit whose blob contains `ref` as a whole word); `relPath(repo, file)`; `isAncestor(repo, a, b) → boolean|null` (`git merge-base --is-ancestor a b`); `gitState(dir) → {available, unmerged: string[], merging: boolean, dirty: boolean, unpushed: number|null}`.
- `sync.mjs`: `bestEffortSync(repo, {env}) → {synced: boolean, reason}` — no-op when `env.DELIVERY_NO_SYNC === '1'` or `.agents/telemetry/.git` is absent (plain-dir mode: records are committed with the main tree by the team's normal commits; reason `plain-dir`); if `gitState(tel).unmerged.length || merging` → `{synced: false, reason: 'unresolved merge — fix manually (delivery.mjs doctor)'}` and **nothing is staged**; else `add -A` → `commit` if dirty → `push`; on push failure `fetch` + `merge --no-edit @{u}`; merge conflict → `merge --abort`, reason `push rejected; merge conflict — manual`; else `push` once more; any remaining failure → reason `push failed — retried next invocation`. Never resets, never resolves.
- `delivery.mjs` (exported for tests): `parseArgs(argv)`, `resolveRun(repo, flag) → run` (`NO-PLAN` / `AMBIGUOUS-PLAN` over `status: open` runs), `resolveRef(run, ref) → item` (`USAGE(unknown ref …)`; refuses cancelled items unless `--allow-cancelled`), `validateTransition(history, item, event) → null | string` (M1 rules: `done` after `cancelled` with no later `reopened` → invalid; `cancelled` after `done` with no later `reopened` → invalid; `reopened` when the item is not terminal → invalid; `first_commit`/`dispatched` always valid), `main(argv, {repo, now, stdout, stderr, env}) → exit`. Commands:

| Command | Behaviour |
|---|---|
| `plan register --from <f> --id <token> [--campaign --run --version --observation-start --integration-ref] [--at <iso>] [--created-at <iso>] [--keep-missing] [--factories feature-development,test-automation] [--roster a,b] [--dry-run] [--yes]` | Read block (or import markdown with `--yes`; without `--yes` print the block + `DRY-RUN` and exit 0). `validatePlan` → `SCHEMA-INVALID(first)`; `assignIds`; `validateIds` → `SCHEMA-INVALID`. Request digest `d = sha256(token + canonicalHash(full))`. Load run record. **Retry first:** if `run.requests[token]?.digest === d` → re-emit `requests[token].observations` (including the saved per-item creation clocks and estimate revisions) and append (all `SKIP`), print `PLAN … (retry)`, exit 0. If `run.requests[token]` exists with a different digest → `ID-CONFLICT(registration token reused with different input)`. Else new request: `version ≤ run.version` → `USAGE(version must exceed <n>)`; `supersedes` present → keys must exist in `run.items`, values must be ids of this plan, else `MIGRATION-REQUIRED`; a new version without `supersedes` is allowed (missing items cancel unless `--keep-missing`). `at = --at ?? now` (a re-cut, i.e. `version > 1`, **requires** `--at`, else `USAGE(re-cut requires --at)`). `createdAtOf(item)`: `--created-at` → `{at}` (basis observed unless git); else if the source file is tracked, `firstCommitContaining(repo, sourceHead, rel, item.ref)` (resolve the invocation checkout’s HEAD to a full SHA once per request and persist it) per item (`plan-commit`); else `{at: nowIso(now)}` (observed registration clock, independently of re-cut `--at`). Resolve and save every creation clock in the request before appending; retry uses saved clocks even after branch growth. Roster snapshot: Task 1 `makeRoster(repo, --factories ?? [full.factory], --roster ?? null)`; require the plan factory among participants. Store `roster` and its `agents` as compatibility `roster_agents`; `--roster` asserts the union and cannot introduce a foreign role. Save run: `{run, campaign_id, run_id, version, factory, status:'open', registered_at, updated_at, observation_start, source_epoch, mission_kind, source:{path, rel, sha256, head}, canonical_sha256, roster:{v, factories, agents, map_sha256}, roster_agents:[], import, supersedes, items: mergeCatalogue(prev, next), versions:[…, {version, at, keep_missing, canonical_sha256, items: next}], requests:{[token]: {digest, version, at, source_head, keep_missing, created, observations}}}`. Then append observations (`estimate_revision` per item = count of existing `estimated` observations for it), printing `EVENT/SKIP/ID-CONFLICT …` per line, then `PLAN <run> v<version> items=<n> created=<a> estimated=<b> stale-acceptance=<s> cancelled=<c> reopened=<d> accepted=<x> unaccepted=<y> unestimated=<z>`. Exit 2 if any `ID-CONFLICT`. Sync requested in `finally`. |
| `plan list` / `plan show --plan <run>` / `plan close --plan <run>` / `plan roster --plan <run> --agents a,b` | `PLAN <run> v<version> status=<s> items=<n>` per run; JSON; close; refresh `roster` using its saved participating factories and assert `--agents` equals the installed union; replace `roster_agents = roster.agents` (last-writer-wins). |
| `session set --host <h> --session <s> --plan <run>` | writes `sessions/<enc>.json` `{host, session, plan, at}`. |
| `event <ref> <event> --id <token> [--plan <run>] [--at <iso>] [--sha <sha>] [--revision <n>] [--status active\|retracted] [--transition <t>] [--raw <s>] [--note <s>] [--allow-cancelled]` | `<event>` ∈ `dispatched\|done\|cancelled\|blocked\|unblocked\|reopened\|review_requested\|review_returned\|review_approved\|first_commit`. `--sha` → `at` = committer time, `meta.git_sha`; `--sha` **and** a differing `--at`: allowed only with `--revision ≥ 1` (an explicit correction: `at` wins, `meta.git_sha` kept, `meta.clock: 'corrected'`), else `USAGE(at and sha disagree; pass --revision <n> to correct)`. Invalid `--at` → `USAGE(invalid --at)`. Default `transition_id`: `<item>/<event>/episode-1` for `done\|cancelled\|reopened`, `<item>/<event>/<token>` otherwise. `validateTransition` over the item's current active occurrences (selected via `selectOccurrences`, Task 6 — until Task 6 exists, over active observations sorted by `at`) → `INVALID-TRANSITION(<detail>)`. `SKIP` exit 0; `ID-CONFLICT` exit 2 with the hint `use --revision <n+1>`. |
| `event --from <jsonl> [--plan <run>]` | each line `{ref, event, id, at?, sha?, revision?, status?, transition?, raw?, note?}`; bad JSON → `USAGE(line <n>: invalid json)`; sequential appends; `EVENTS appended=<n> skipped=<m> conflicts=<k> invalid=<i>`; exit 2 if conflicts or invalid > 0. |
| `profile set --from <f>` | keys validated against the template; `profile.json` written (last-writer-wins). |

All commands use Task 1 path helpers, which resolve the shared owner before every ledger/plan/session/profile/lock access. Keep the invocation checkout for source-file and Git evidence reads: `--from` resolves against that checkout, and registration pins its HEAD. Sync, report assembly, hook, installer and doctor use `resolveOwnerRepo` for telemetry and never pick an owner based on whether a delivery directory already exists. All commands: known errors print one line and exit per Global Constraint 8; anything else `INTERNAL(...)` exit 1. Every mutating command calls `bestEffortSync` in a `finally` (so a partial `--from` batch still syncs) and prints `WARN sync: <reason>` on stderr when not synced for a reason other than `DELIVERY_NO_SYNC`/`plain-dir`.

- [ ] **Step 1: Write the failing tests**

`skills/delivery-metrics/scripts/lib/git.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitTime, firstCommitContaining, isAncestor, gitState, relPath } from './git.mjs';

const mk = () => { const r = mkdtempSync(join(tmpdir(), 'dm-git-')); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r }); execFileSync('git', ['config', 'user.email', 't@x'], { cwd: r }); execFileSync('git', ['config', 'user.name', 'T'], { cwd: r }); return r; };
const commit = (r, file, text, msg, at) => { writeFileSync(join(r, file), text); execFileSync('git', ['add', file], { cwd: r }); execFileSync('git', ['commit', '-q', '-m', msg], { cwd: r, env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }); return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r, encoding: 'utf8' }).trim(); };

test('commitTime, firstCommitContaining (per item, whole word), isAncestor, gitState', () => {
  const r = mk();
  const c1 = commit(r, 'plan.md', '#### TASK-001: a\n', 'plan v1', '2026-09-10T08:00:00Z');
  const c2 = commit(r, 'plan.md', '#### TASK-001: a\n#### TASK-002: b\n', 'plan v2', '2026-09-12T08:00:00Z');
  assert.deepEqual(commitTime(r, c1), { sha: c1, at: '2026-09-10T08:00:00.000Z' });
  assert.equal(commitTime(r, 'nope'), null);
  assert.deepEqual(firstCommitContaining(r, 'HEAD', 'plan.md', 'TASK-002'), { sha: c2, at: '2026-09-12T08:00:00.000Z' });
  assert.deepEqual(firstCommitContaining(r, 'HEAD', 'plan.md', 'TASK-001'), { sha: c1, at: '2026-09-10T08:00:00.000Z' });
  assert.equal(firstCommitContaining(r, 'HEAD', 'plan.md', 'TASK-00'), null, 'whole word only');
  assert.equal(isAncestor(r, c1, c2), true); assert.equal(isAncestor(r, c2, c1), false);
  assert.equal(relPath(r, join(r, 'plan.md')), 'plan.md');
  const s = gitState(r); assert.equal(s.available, true); assert.deepEqual(s.unmerged, []); assert.equal(s.merging, false); assert.equal(s.dirty, false); assert.equal(s.unpushed, null);
});
```

`skills/delivery-metrics/scripts/lib/sync.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bestEffortSync } from './sync.mjs';

const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** A bare remote + two clones standing in for two teammates' .agents/telemetry submodules. */
const world = () => {
  const root = mkdtempSync(join(tmpdir(), 'dm-sync-'));
  const remote = join(root, 'remote.git'); g(root, 'init', '-q', '--bare', remote);
  const clone = (name) => { const repo = join(root, name); mkdirSync(join(repo, '.agents'), { recursive: true }); g(root, 'clone', '-q', remote, join(repo, '.agents', 'telemetry')); const tel = join(repo, '.agents', 'telemetry'); g(tel, 'config', 'user.email', 't@x'); g(tel, 'config', 'user.name', 'T'); return repo; };
  const a = clone('a'); const tel = join(a, '.agents', 'telemetry'); writeFileSync(join(tel, 'README.md'), 'x'); g(tel, 'add', '-A'); g(tel, 'commit', '-q', '-m', 'init'); g(tel, 'push', '-q', '-u', 'origin', 'HEAD');
  const b = clone('b'); g(join(b, '.agents', 'telemetry'), 'pull', '-q');
  return { a, b, remote };
};
const write = (repo, name, text) => { const d = join(repo, '.agents', 'telemetry', 'delivery'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), text); };

test('no-op reasons: DELIVERY_NO_SYNC, plain-dir', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dm-sync-'));
  assert.deepEqual(bestEffortSync(repo, { env: { DELIVERY_NO_SYNC: '1' } }), { synced: false, reason: 'DELIVERY_NO_SYNC' });
  assert.deepEqual(bestEffortSync(repo, { env: {} }), { synced: false, reason: 'plain-dir' });
});

test('two writers: rejected push → fetch/merge/push succeeds; distinct per-user files never conflict', () => {
  const { a, b } = world();
  write(a, 'events-a.jsonl', '{"a":1}\n'); assert.equal(bestEffortSync(a, { env: {} }).synced, true);
  write(b, 'events-b.jsonl', '{"b":1}\n'); const r = bestEffortSync(b, { env: {} });
  assert.equal(r.synced, true, r.reason);
  assert.match(g(join(b, '.agents', 'telemetry'), 'ls-files'), /events-a\.jsonl[\s\S]*events-b\.jsonl/);
});

test('conflicting shared file: merge aborted, nothing committed as resolved, reason names manual repair; unmerged tree is never staged', () => {
  const { a, b } = world();
  write(a, 'profile.json', '{"x":1}\n'); bestEffortSync(a, { env: {} });
  write(b, 'profile.json', '{"x":2}\n'); const r = bestEffortSync(b, { env: {} });
  assert.equal(r.synced, false); assert.match(r.reason, /merge conflict/);
  const tel = join(b, '.agents', 'telemetry');
  assert.equal(g(tel, 'ls-files', '-u'), '', 'merge was aborted, tree left clean');
  // now fake an unresolved merge state and make sure sync refuses to stage
  g(tel, 'fetch', '-q'); try { g(tel, 'merge', '--no-edit', 'origin/HEAD'); } catch { /* conflict */ }
  assert.notEqual(g(tel, 'ls-files', '-u'), '');
  const r2 = bestEffortSync(b, { env: {} });
  assert.equal(r2.synced, false); assert.match(r2.reason, /unresolved merge/);
  assert.notEqual(g(tel, 'ls-files', '-u'), '', 'still unmerged; sync did not touch it');
});
```

`skills/delivery-metrics/scripts/delivery.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, validateTransition } from './delivery.mjs';
import { deliveryDir, runPath } from './lib/paths.mjs';
import { resolveObservations } from './lib/events.mjs';

const CLI = fileURLToPath(new URL('./delivery.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-cli-'));
export const run = (repo, args, { input, env = {} } = {}) => {
  try { return { code: 0, stdout: execFileSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', input, env: { ...process.env, DELIVERY_NO_SYNC: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] }), stderr: '' }; }
  catch (e) { return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
};
const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
export const initRepo = () => { const r = tmp(); git(r, 'init', '-q', '-b', 'main'); git(r, 'config', 'user.email', 't@x'); git(r, 'config', 'user.name', 'Tester'); return r; };
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tech-lead', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'Daniel', accepted_at: '2026-09-16T08:30:00Z' };
export const plan = (v = 1, tasks = [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: EST }, { ref: 'TASK-002' }]) => ({
  campaign_id: 'sec', run_id: 'run-1', version: v, factory: 'feature-development', observation_start: '2026-09-16T08:00:00Z',
  source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks }],
});
export const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`); return f; };
const commitAt = (repo, msg, at) => { writeFileSync(join(repo, `${Math.random()}.txt`), msg); git(repo, 'add', '.'); execFileSync('git', ['commit', '-q', '-m', msg], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at } }); return git(repo, 'rev-parse', 'HEAD'); };

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['event', 'TASK-1', 'done', '--plan', 'p', '--keep-missing']), { cmd: 'event', sub: null, positional: ['TASK-1', 'done'], flags: { plan: 'p', 'keep-missing': true } });
  assert.equal(parseArgs(['plan', 'register', '--from', 'f']).sub, 'register');
});

test('plan register: block → run file, per-item plan-commit creation, observations; identical retry re-emits with SKIP; reused token with new input → ID-CONFLICT', () => {
  const repo = initRepo();
  writePlan(repo, plan(1, [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: EST }]));
  execFileSync('git', ['add', 'plan.md'], { cwd: repo }); execFileSync('git', ['commit', '-q', '-m', 'plan v1'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-10T08:00:00Z', GIT_AUTHOR_DATE: '2026-09-10T08:00:00Z' } });
  const f = writePlan(repo, plan()); // adds TASK-002 later
  execFileSync('git', ['add', 'plan.md'], { cwd: repo }); execFileSync('git', ['commit', '-q', '-m', 'plan v1 + task 2'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-12T08:00:00Z', GIT_AUTHOR_DATE: '2026-09-12T08:00:00Z' } });
  const pinnedHead = git(repo, 'rev-parse', 'HEAD');
  const r = run(repo, ['plan', 'register', '--from', f, '--id', 'reg-1']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PLAN sec\/run-1 v1 items=4 created=4 estimated=1 stale-acceptance=0 cancelled=0 reopened=0 accepted=1 unaccepted=0 unestimated=3/);
  const rec = JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8'));
  assert.equal(rec.status, 'open'); assert.equal(rec.versions.length, 1); assert.ok(rec.requests['reg-1']); assert.ok(Array.isArray(rec.roster_agents));
  assert.equal(rec.source.head, pinnedHead); assert.equal(rec.requests['reg-1'].source_head, pinnedHead);
  const { active } = resolveObservations(repo);
  const c1 = active.find((o) => o.event === 'created' && o.ref === 'TASK-001'), c2 = active.find((o) => o.event === 'created' && o.ref === 'TASK-002');
  assert.equal(c1.basis, 'plan-commit'); assert.equal(c1.at, '2026-09-10T08:00:00.000Z'); assert.equal(c2.at, '2026-09-12T08:00:00.000Z', 'creation is per item, not per file');
  commitAt(repo, 'later branch growth', '2026-09-18T00:00:00Z');
  const again = run(repo, ['plan', 'register', '--from', f, '--id', 'reg-1']);
  assert.equal(again.code, 0, again.stderr); assert.match(again.stdout, /\(retry\)/); assert.equal((again.stdout.match(/^SKIP/gm) || []).length, 5);
  assert.equal(resolveObservations(repo).active.length, 5);
  const reused = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'TASK-009' }]), 'other.md'), '--id', 'reg-1']);
  assert.equal(reused.code, 2); assert.match(reused.stderr, /^ID-CONFLICT\(registration token/);
});

test('plan register: v2 re-cut needs --at; cancels removed, stale acceptance on changed range; --keep-missing; lower version rejected; supersedes validated', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const v2 = plan(2, [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: { ...EST, high: 5 } }]);
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2']).stderr, /^USAGE\(re-cut requires --at/);
  const r2 = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /v2 .*stale-acceptance=1 cancelled=1/);
  const { active } = resolveObservations(repo);
  assert.equal(active.find((o) => o.event === 'cancelled').ref, 'TASK-002');
  const ests = active.filter((o) => o.event === 'estimated' && o.ref === 'TASK-001');
  assert.equal(ests.length, 2); assert.equal(ests[1].meta.acceptance, 'stale-acceptance'); assert.equal(ests[1].transition_id, 'sec/run-1/task-task-001/estimated/rev-1');
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1), 'p1.md'), '--id', 'reg-3', '--at', '2026-09-18T00:00:00Z']).stderr, /^USAGE\(version must exceed 2/);
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(3, [{ ref: 'TASK-001' }]), 'p3.md'), '--id', 'reg-4', '--at', '2026-09-18T00:00:00Z', '--keep-missing']).stdout, /cancelled=0/);
  const bad = plan(4, [{ ref: 'TASK-001' }]); bad.supersedes = { run: 'sec/run-1', item_map: { 'sec/run-1/task-nope': 'sec/run-1/task-task-001' } };
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, bad, 'p4.md'), '--id', 'reg-5', '--at', '2026-09-19T00:00:00Z']).stderr, /^MIGRATION-REQUIRED/);
  assert.equal(JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8')).items.find((i) => i.ref === 'TASK-002').version_added, 1);
});

test('plan register: schema error → SCHEMA-INVALID; markdown import prints block and needs --yes', () => {
  const repo = initRepo();
  const bad = plan(); bad.factory = 'ops';
  const r = run(repo, ['plan', 'register', '--from', writePlan(repo, bad), '--id', 'x']);
  assert.equal(r.code, 2); assert.match(r.stderr, /^SCHEMA-INVALID\(factory/);
  const md = join(repo, 'tasks.md'); writeFileSync(md, '## 1. Execution plan\n\n```\nG0   001 t\n```\n\n#### TASK-001: t\n**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S\n');
  const dry = run(repo, ['plan', 'register', '--from', md, '--id', 'imp-1', '--campaign', 'sec', '--run', 'run-1', '--observation-start', '2026-09-16T00:00:00Z']);
  assert.equal(dry.code, 0); assert.match(dry.stdout, /DRY-RUN/); assert.ok(!existsSync(runPath(repo, 'sec/run-1')));
  const yes = run(repo, ['plan', 'register', '--from', md, '--id', 'imp-1', '--campaign', 'sec', '--run', 'run-1', '--observation-start', '2026-09-16T00:00:00Z', '--yes']);
  assert.equal(yes.code, 0, yes.stderr); assert.match(yes.stdout, /unestimated=3/);
});

test('event: --sha clock, SKIP, correction via --revision, at/sha disagreement, transition validation, errors are exit 2/3 never INTERNAL', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const sha = commitAt(repo, 'TASK-001: work', '2026-09-16T12:00:00Z');
  const r = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--id', 'done-1']);
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^EVENT cli:done-1:sec%2Frun-1%2Ftask-task-001:done 2026-09-16T12:00:00.000Z/);
  assert.match(run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--id', 'done-1']).stdout, /^SKIP/);
  const dis = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--at', '2026-09-16T11:00:00Z', '--id', 'done-1']);
  assert.equal(dis.code, 2); assert.match(dis.stderr, /^USAGE\(at and sha disagree/);
  const fix = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--at', '2026-09-16T11:00:00Z', '--id', 'done-1', '--revision', '1']);
  assert.equal(fix.code, 0, fix.stderr);
  const d = resolveObservations(repo).active.find((o) => o.event === 'done'); assert.equal(d.at, '2026-09-16T11:00:00.000Z'); assert.equal(d.meta.git_sha, sha); assert.equal(d.meta.clock, 'corrected');
  const inv = run(repo, ['event', 'TASK-001', 'cancelled', '--id', 'c1']);
  assert.equal(inv.code, 2); assert.match(inv.stderr, /^INVALID-TRANSITION\(.*done/);
  assert.match(run(repo, ['event', 'TASK-002', 'reopened', '--id', 'r1']).stderr, /^INVALID-TRANSITION/);
  assert.match(run(repo, ['event', 'TASK-9', 'done', '--id', 'z']).stderr, /^USAGE\(unknown ref TASK-9/);
  assert.match(run(repo, ['event', 'TASK-002', 'merged', '--id', 'z']).stderr, /^USAGE\(unknown event/);
  assert.match(run(repo, ['event', 'TASK-002', 'done', '--at', 'yesterday', '--id', 'z']).stderr, /^USAGE\(invalid --at/);
  const empty = initRepo(); const np = run(empty, ['event', 'TASK-1', 'done', '--id', 'z']); assert.equal(np.code, 3); assert.match(np.stderr, /^NO-PLAN/);
  mkdirSync(join(deliveryDir(repo), '.lock'), { recursive: true });
  const busy = run(repo, ['event', 'TASK-002', 'dispatched', '--id', 'l1']); assert.equal(busy.code, 2); assert.match(busy.stderr, /^LOCK-BUSY/);
});

test('validateTransition rules', () => {
  const h = (...evs) => evs.map((e, i) => ({ event: e, at: `2026-09-1${i}T00:00:00.000Z` }));
  assert.equal(validateTransition(h('created', 'done'), 'done'), null, 'second done is the same occurrence (retry/correction), not a transition error');
  assert.match(validateTransition(h('created', 'done'), 'cancelled'), /done/);
  assert.match(validateTransition(h('created', 'cancelled'), 'done'), /cancelled/);
  assert.equal(validateTransition(h('created', 'cancelled', 'reopened'), 'done'), null);
  assert.match(validateTransition(h('created'), 'reopened'), /not terminal/);
  assert.equal(validateTransition(h('created', 'done'), 'dispatched'), null);
});

test('event --from jsonl (invalid line counted, exit 2); session set; plan list/show/close/roster', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const f = join(repo, 'ev.jsonl');
  writeFileSync(f, `${JSON.stringify({ ref: 'TASK-001', event: 'dispatched', at: '2026-09-16T09:00:00Z', id: 'd1' })}\n${JSON.stringify({ ref: 'TASK-001', event: 'done', at: '2026-09-16T10:00:00Z', id: 'd2' })}\n{oops\n`);
  const r = run(repo, ['event', '--from', f]);
  assert.equal(r.code, 2); assert.match(r.stdout, /EVENTS appended=2 skipped=0 conflicts=0 invalid=1/); assert.match(r.stderr, /line 3: invalid json/);
  assert.equal(run(repo, ['session', 'set', '--host', 'claude', '--session', 'sess-1', '--plan', 'sec/run-1']).code, 0);
  assert.ok(existsSync(join(deliveryDir(repo), 'sessions', 'claude%3Asess-1.json')));
  assert.match(run(repo, ['plan', 'list']).stdout, /PLAN sec\/run-1 v1 status=open items=4/);
  assert.equal(JSON.parse(run(repo, ['plan', 'show', '--plan', 'sec/run-1']).stdout).campaign_id, 'sec');
  run(repo, ['plan', 'roster', '--plan', 'sec/run-1', '--agents', 'js-dev,tech-lead']);
  assert.deepEqual(JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8')).roster_agents, ['js-dev', 'tech-lead']);
  run(repo, ['plan', 'close', '--plan', 'sec/run-1']);
  assert.equal(JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8')).status, 'closed');
});
```

- [ ] **Step 2: Run tests to verify they fail** — module not found for all three.

- [ ] **Step 3: Write `git.mjs`**

```js
// STDLIB ONLY. Thin git helpers; every failure → null (never a guess).
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function git(repo, args, { cwd } = {}) {
  try { return execFileSync('git', ['-C', cwd ?? repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 20000 }).trim(); } catch { return null; }
}
export function relPath(repo, file) { const physical = (p) => { try { return realpathSync(p); } catch { return resolve(p); } }; const abs = physical(file), root = physical(repo); return abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : file; }
export function commitTime(repo, sha) {
  const out = git(repo, ['show', '-s', '--format=%H%x1f%cI', `${sha}^{commit}`]);
  if (!out) return null; const [full, iso] = out.split('\x1f'); return full && iso ? { sha: full, at: new Date(iso).toISOString() } : null;
}
const wordRe = (ref) => new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`);
export function firstCommitContaining(repo, head, rel, ref) {
  if (!head) return null;
  const out = git(repo, ['log', '--reverse', '--format=%H%x1f%cI', head, '--', rel]);
  if (!out) return null;
  const re = wordRe(ref);
  for (const line of out.split('\n')) { const [sha, at] = line.split('\x1f'); const blob = git(repo, ['show', `${sha}:${rel}`]); if (blob != null && re.test(blob)) return { sha, at: new Date(at).toISOString() }; }
  return null;
}
export function isAncestor(repo, a, b) {
  try { execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch (e) { return e.status === 1 ? false : null; }
}
export function gitState(dir) {
  if (git(dir, ['rev-parse', '--git-dir']) == null) return { available: false, unmerged: [], merging: false, dirty: false, unpushed: null };
  const gitDir = git(dir, ['rev-parse', '--git-dir']);
  const unmerged = (git(dir, ['ls-files', '-u']) ?? '').split('\n').filter(Boolean).map((l) => l.split('\t')[1]).filter((v, i, a) => a.indexOf(v) === i);
  const merging = existsSync(join(resolve(dir, gitDir), 'MERGE_HEAD'));
  const dirty = Boolean(git(dir, ['status', '--porcelain']));
  const up = git(dir, ['rev-list', '--count', '@{u}..HEAD']);
  return { available: true, unmerged, merging, dirty, unpushed: up == null ? null : Number(up) };
}
```

- [ ] **Step 4: Write `sync.mjs`**

```js
// STDLIB ONLY. Best-effort telemetry sync (spec §6.1): never stages an unmerged tree, never resolves conflicts, retries once.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { gitState } from './git.mjs';
import { resolveOwnerRepo } from './paths.mjs';

export function bestEffortSync(repo, { env = process.env } = {}) {
  if (env.DELIVERY_NO_SYNC === '1') return { synced: false, reason: 'DELIVERY_NO_SYNC' };
  repo = resolveOwnerRepo(repo);
  const tel = join(repo, '.agents', 'telemetry');
  if (!existsSync(join(tel, '.git'))) return { synced: false, reason: 'plain-dir' };
  const g = (...a) => execFileSync('git', ['-C', tel, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  const state = gitState(tel);
  if (state.unmerged.length || state.merging) return { synced: false, reason: `unresolved merge in ${tel} — fix manually (delivery.mjs doctor)` };
  try {
    g('add', '-A');
    if (g('status', '--porcelain')) g('commit', '-q', '-m', `delivery-metrics: ${new Date().toISOString()}`);
    if (!g('remote')) return { synced: true, reason: 'no remote (local telemetry branch only)' };
    try { g('push', '-q'); return { synced: true }; } catch { /* rejected — integrate once */ }
    try { g('fetch', '-q'); g('merge', '--no-edit', '@{u}'); } catch { try { g('merge', '--abort'); } catch { /* nothing to abort */ } return { synced: false, reason: 'push rejected; merge conflict — manual repair needed (delivery.mjs doctor)' }; }
    try { g('push', '-q'); return { synced: true, reason: 'merged remote changes then pushed' }; } catch { return { synced: false, reason: 'push failed — retried next invocation' }; }
  } catch (e) { return { synced: false, reason: String(e.message).split('\n')[0] }; }
}
```

- [ ] **Step 5: Write `delivery.mjs`**

```js
#!/usr/bin/env node
// STDLIB ONLY. delivery-metrics CLI (spec §6.5). Thin dispatcher over scripts/lib/*.
import { realpathSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliError, deliveryDir, nowIso, profilePath, sessionPath, sessionsDir, sha256 } from './lib/paths.mjs';
import { EVENTS, appendObservation, makeObservation, resolveObservations } from './lib/events.mjs';
import { assignIds, canonicalHash, estimateStatus, extractPlanBlock, listRuns, loadRun, mergeCatalogue, planDelta, registrationObservations, runIdOf, saveRun, toCatalogue, validateIds, validatePlan } from './lib/plan.mjs';
import { importTasksMarkdown } from './lib/plan-markdown.mjs';
import { commitTime, firstCommitContaining, git, relPath } from './lib/git.mjs';
import { bestEffortSync } from './lib/sync.mjs';
import { makeRoster } from './lib/roster.mjs';

export const SKILL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_EVENTS = ['dispatched', 'done', 'cancelled', 'blocked', 'unblocked', 'reopened', 'review_requested', 'review_returned', 'review_approved', 'first_commit'];
const TERMINAL = new Set(['done', 'cancelled']);
const out = (io, s) => io.stdout.write(`${s}\n`);
const isoOrThrow = (s, flag) => { if (Number.isNaN(Date.parse(s))) throw cliError('USAGE', `invalid ${flag} ${s}`); return new Date(s).toISOString(); };

export function parseArgs(argv) {
  const o = { cmd: argv[0] ?? null, sub: null, positional: [], flags: {} };
  const rest = argv.slice(1);
  if (rest[0] && !rest[0].startsWith('--') && ['plan', 'session', 'profile'].includes(o.cmd)) o.sub = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) { const v = rest[i + 1]; if (v === undefined || v.startsWith('--')) o.flags[a.slice(2)] = true; else { o.flags[a.slice(2)] = v; i++; } }
    else o.positional.push(a);
  }
  return o;
}

export function resolveRun(repo, flag) {
  if (flag) { const r = loadRun(repo, flag); if (!r) throw cliError('NO-PLAN', `no registered run ${flag}`); return r; }
  const open = listRuns(repo).filter((r) => r.status === 'open');
  if (!open.length) throw cliError('NO-PLAN', 'no open plan in this repo — run plan register');
  if (open.length > 1) throw cliError('AMBIGUOUS-PLAN', `pass --plan: ${open.map((r) => r.run).join(',')}`);
  return open[0];
}
export function resolveRef(run, ref, { allowCancelled = false } = {}) {
  const hit = run.items.filter((i) => i.ref === ref || i.item_id === ref);
  if (hit.length !== 1) throw cliError('USAGE', `unknown ref ${ref} in ${run.run}`);
  if (hit[0].cancelled && !allowCancelled) throw cliError('USAGE', `${ref} is cancelled in the current plan version; pass --allow-cancelled`);
  return hit[0];
}
/** history = the item's current occurrences sorted by at ([{event, at}]); returns null when ok, else the reason. */
export function validateTransition(history, event) {
  let state = 'open';
  for (const h of history) { if (TERMINAL.has(h.event)) state = h.event; else if (h.event === 'reopened') state = 'open'; }
  if (event === 'done' && state === 'cancelled') return 'done after cancelled without reopened';
  if (event === 'cancelled' && state === 'done') return 'cancelled after done without reopened';
  if (event === 'reopened' && state === 'open') return 'reopened when the item is not terminal';
  return null;
}

function emitRegistration(repo, io, { run, version, delta, token, at, createdAtOf, now, active, records = null }) {
  for (const i of [...delta.created, ...delta.estimated.map((e) => e.item)]) i.estimate_revision = active.filter((o) => o.plan === run.run && o.item_id === i.item_id && o.event === 'estimated').length;
  // a changed estimate on an existing item gets the next revision; a new item starts at 0
  const recs = records ?? registrationObservations({ run, version, delta, token, at, createdAtOf, now });
  let conflicts = 0;
  for (const r of recs) { const res = appendObservation(repo, r, { now }); out(io, `${res.result} ${res.observation_id}`); if (res.result === 'ID-CONFLICT') conflicts++; }
  return conflicts;
}

function cmdPlanRegister(repo, f, io, now) {
  const file = f.from ? resolve(repo, f.from) : null, token = f.id;
  if (!file || !token) throw cliError('USAGE', 'plan register needs --from <file> --id <token>');
  if (!existsSync(file)) throw cliError('USAGE', `no such file ${file}`);
  const text = readFileSync(file, 'utf8');
  let obj = extractPlanBlock(text);
  if (!obj) {
    if (!f.campaign || !f.run || !f['observation-start']) throw cliError('USAGE', 'markdown import needs --campaign --run --observation-start');
    const { plan, warnings } = importTasksMarkdown(text, { campaign_id: f.campaign, run_id: f.run, version: Number(f.version ?? 1), observation_start: isoOrThrow(f['observation-start'], '--observation-start'), integration_ref: f['integration-ref'] ?? 'main' });
    for (const w of warnings) io.stderr.write(`WARN ${w}\n`);
    obj = plan;
    if (!f.yes) { out(io, '```json delivery-plan'); out(io, JSON.stringify(obj, null, 2)); out(io, '```'); out(io, `DRY-RUN ${runIdOf(obj)} v${obj.version} — re-run with --yes to register`); return 0; }
  }
  let errs = validatePlan(obj); if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  const full = assignIds(obj); errs = validateIds(full); if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  const runId = runIdOf(full), digest = sha256(`${token}\n${canonicalHash(full)}`);
  const prev = loadRun(repo, runId);
  const { active } = resolveObservations(repo);
  const next = toCatalogue(full, { version: full.version });
  // 1. identical retry → re-emit the same observations (they SKIP)
  const req = prev?.requests?.[token];
  if (req && req.digest === digest) {
    const ver = prev.versions.find((v) => v.version === req.version); const before = prev.versions.filter((v) => v.version < req.version).sort((a, b) => b.version - a.version)[0];
    const delta = planDelta(before?.items ?? [], ver.items, { keepMissing: req.keep_missing });
    const conflicts = emitRegistration(repo, io, { run: prev, version: req.version, delta, token, at: req.at, createdAtOf: (i) => req.created[i.item_id] ?? null, now, active, records: req.observations });
    out(io, `PLAN ${runId} v${req.version} (retry) items=${prev.items.length}`);
    if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} registration observation(s) conflict`);
    return 0;
  }
  if (req) throw cliError('ID-CONFLICT', `registration token ${token} reused with different input`);
  // 2. new request
  if (prev && full.version <= prev.version) throw cliError('USAGE', `version must exceed ${prev.version} for ${runId}`);
  if (prev && full.version > 1 && !f.at) throw cliError('USAGE', 're-cut requires --at <effective iso>');
  if (full.supersedes) {
    const known = new Set((prev?.items ?? []).map((i) => i.item_id)), mine = new Set(next.map((i) => i.item_id));
    for (const [oldId, newId] of Object.entries(full.supersedes.item_map ?? {})) { if (!known.has(oldId)) throw cliError('MIGRATION-REQUIRED', `supersedes maps unknown item ${oldId}`); if (!mine.has(newId)) throw cliError('MIGRATION-REQUIRED', `supersedes targets unknown item ${newId}`); }
  }
  const at = f.at ? isoOrThrow(f.at, '--at') : nowIso(now);
  const sourceHead = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const rel = relPath(repo, file); const tracked = git(repo, ['ls-files', '--error-unmatch', rel]) != null;
  const created = {};
  const createdAtOf = (i) => {
    if (f['created-at']) return (created[i.item_id] = { at: isoOrThrow(f['created-at'], '--created-at') });
    if (!tracked || !sourceHead) return null;
    const c = firstCommitContaining(repo, sourceHead, rel, i.ref); if (c) created[i.item_id] = c; return c;
  };
  const delta = planDelta(prev?.items ?? [], next, { keepMissing: Boolean(f['keep-missing']) });
  if (f['dry-run']) { out(io, `DRY-RUN ${runId} v${full.version} created=${delta.created.length} estimated=${delta.estimated.length} cancelled=${delta.cancelled.length}`); return 0; }
  const factories = f.factories ? String(f.factories).split(',') : [full.factory];
  if (!factories.includes(full.factory)) throw cliError('USAGE', 'participating factories must include plan factory');
  const roster = makeRoster(repo, factories, f.roster ? String(f.roster).split(',') : null);
  const rec = {
    run: runId, campaign_id: full.campaign_id, run_id: full.run_id, version: full.version, factory: full.factory, status: 'open',
    registered_at: prev?.registered_at ?? nowIso(now), updated_at: nowIso(now), observation_start: full.observation_start, source_epoch: full.source_epoch, mission_kind: full.mission_kind,
    source: { path: file, rel, sha256: sha256(text), head: sourceHead }, canonical_sha256: canonicalHash(full), roster, roster_agents: roster.agents,
    import: full.import ?? null, supersedes: full.supersedes ?? null, items: mergeCatalogue(prev?.items ?? [], next, { keepMissing: Boolean(f['keep-missing']) }),
    versions: [...(prev?.versions ?? []), { version: full.version, at, keep_missing: Boolean(f['keep-missing']), canonical_sha256: canonicalHash(full), items: next }],
    requests: { ...(prev?.requests ?? {}) },
  };
  mkdirSync(deliveryDir(repo), { recursive: true });
  for (const i of delta.created) created[i.item_id] = createdAtOf(i) ?? { at: nowIso(now) };
  for (const i of [...delta.created, ...delta.estimated.map((e) => e.item)]) i.estimate_revision = active.filter((o) => o.plan === runId && o.item_id === i.item_id && o.event === 'estimated').length;
  const observations = registrationObservations({ run: rec, version: full.version, delta, token, at, createdAtOf: (i) => created[i.item_id], now });
  rec.requests[token] = { digest, version: full.version, at, source_head: sourceHead, keep_missing: Boolean(f['keep-missing']), created, observations };
  saveRun(repo, rec);
  const conflicts = emitRegistration(repo, io, { run: rec, version: full.version, delta, token, at, createdAtOf: (i) => created[i.item_id], now, active, records: observations });
  const st = next.map((i) => estimateStatus(i.estimate));
  out(io, `PLAN ${runId} v${full.version} items=${next.length} created=${delta.created.length} estimated=${delta.estimated.length} stale-acceptance=${delta.estimated.filter((e) => e.stale).length} cancelled=${delta.cancelled.length} reopened=${delta.reopened.length} accepted=${st.filter((s) => s === 'accepted').length} unaccepted=${st.filter((s) => s === 'unaccepted').length} unestimated=${st.filter((s) => s === 'none').length}`);
  if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} registration observation(s) conflict with existing records`);
  return 0;
}

function itemHistory(active, item) { return active.filter((o) => o.item_id === item.item_id && ['done', 'cancelled', 'reopened'].includes(o.event)).sort((a, b) => a.at.localeCompare(b.at)).map((o) => ({ event: o.event, at: o.at })); }

function buildEvent(repo, run, item, ev, f, token, now) {
  if (!CLI_EVENTS.includes(ev) || !EVENTS.includes(ev)) throw cliError('USAGE', `unknown event ${ev}; expected one of ${CLI_EVENTS.join('|')}`);
  const revision = f.revision != null ? Number(f.revision) : 0;
  if (!Number.isInteger(revision) || revision < 0) throw cliError('USAGE', 'invalid --revision');
  let at = f.at ? isoOrThrow(f.at, '--at') : null; const meta = { version: run.version };
  if (f.sha) {
    const c = commitTime(repo, f.sha); if (!c) throw cliError('USAGE', `cannot resolve commit ${f.sha}`);
    if (at && at !== c.at) { if (revision < 1) throw cliError('USAGE', `at and sha disagree (${at} vs ${c.at}); pass --revision <n> to correct`); meta.clock = 'corrected'; } else at = c.at;
    meta.git_sha = c.sha;
  }
  if (!at) at = nowIso(now);
  if (f.note) meta.note = String(f.note);
  const transition = f.transition ?? (['done', 'cancelled', 'reopened'].includes(ev) ? `${item.item_id}/${ev}/episode-1` : `${item.item_id}/${ev}/${token}`);
  return makeObservation({ user: null, host: 'cli', plan: run.run, item_id: item.item_id, ref: item.ref, level: item.level, event: ev, transition_id: transition, source: 'cli',
    source_record_id: token, at, revision, status: f.status ?? 'active', raw: f.raw ?? null, meta }, { now });
}

function cmdEvent(repo, p, io, now) {
  const run = resolveRun(repo, p.flags.plan);
  const { active } = resolveObservations(repo);
  const one = (ref, ev, f, token) => {
    const item = resolveRef(run, ref, { allowCancelled: Boolean(f['allow-cancelled']) });
    const rec = buildEvent(repo, run, item, ev, f, token, now);
    if (rec.status === 'active' && rec.revision === 0) { const why = validateTransition(itemHistory(active, item), ev); if (why) throw cliError('INVALID-TRANSITION', `${ref}: ${why}`); }
    const res = appendObservation(repo, rec, { now });
    out(io, `${res.result} ${res.observation_id} ${rec.at}`);
    return res;
  };
  if (p.flags.from) {
    let appended = 0, skipped = 0, conflicts = 0, invalid = 0, n = 0;
    for (const line of readFileSync(p.flags.from, 'utf8').split('\n')) {
      n++; if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { invalid++; io.stderr.write(`WARN line ${n}: invalid json\n`); continue; }
      try { const res = one(j.ref, j.event, { at: j.at, sha: j.sha, transition: j.transition, raw: j.raw, revision: j.revision, status: j.status, note: j.note }, j.id); if (res.result === 'EVENT') appended++; else if (res.result === 'SKIP') skipped++; else conflicts++; }
      catch (e) { if (!e.code) throw e; invalid++; io.stderr.write(`WARN line ${n}: ${e.message}\n`); }
    }
    out(io, `EVENTS appended=${appended} skipped=${skipped} conflicts=${conflicts} invalid=${invalid}`);
    if (conflicts || invalid) throw cliError(conflicts ? 'ID-CONFLICT' : 'USAGE', `${conflicts} conflicting, ${invalid} invalid line(s)`);
    return 0;
  }
  const [ref, ev] = p.positional;
  if (!ref || !ev || !p.flags.id) throw cliError('USAGE', 'event <ref> <event> --id <token> [--plan <run>]');
  const res = one(ref, ev, p.flags, p.flags.id);
  if (res.result === 'ID-CONFLICT') throw cliError('ID-CONFLICT', `${res.observation_id} rev ${res.revision} exists with different content; use --revision ${res.revision + 1}`);
  return 0;
}

function cmdPlan(repo, p, io, now) {
  const f = p.flags;
  if (p.sub === 'register') return cmdPlanRegister(repo, f, io, now);
  if (p.sub === 'list') { for (const r of listRuns(repo)) out(io, `PLAN ${r.run} v${r.version} status=${r.status} items=${r.items.length}`); return 0; }
  const run = resolveRun(repo, f.plan);
  if (p.sub === 'show') { out(io, JSON.stringify(run, null, 2)); return 0; }
  if (p.sub === 'close') { run.status = 'closed'; run.updated_at = nowIso(now); saveRun(repo, run); out(io, `PLAN ${run.run} status=closed`); return 0; }
  if (p.sub === 'roster') { if (!f.agents) throw cliError('USAGE', 'plan roster --plan <run> --agents a,b'); run.roster = makeRoster(repo, run.roster?.factories ?? [run.factory], String(f.agents).split(',').map((s) => s.trim()).filter(Boolean)); run.roster_agents = run.roster.agents; run.updated_at = nowIso(now); saveRun(repo, run); out(io, `PLAN ${run.run} roster=${run.roster_agents.join(',')}`); return 0; }
  throw cliError('USAGE', `plan ${p.sub ?? ''}: expected register|list|show|close|roster`);
}
function cmdSession(repo, p, io, now) {
  const f = p.flags;
  if (p.sub !== 'set' || !f.host || !f.session || !f.plan) throw cliError('USAGE', 'session set --host <h> --session <s> --plan <run>');
  resolveRun(repo, f.plan); mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(sessionPath(repo, f.host, f.session), `${JSON.stringify({ host: f.host, session: f.session, plan: f.plan, at: nowIso(now) })}\n`);
  out(io, `SESSION ${f.host}:${f.session} -> ${f.plan}`); return 0;
}
function cmdProfile(repo, p, io) {
  if (p.sub !== 'set' || !p.flags.from) throw cliError('USAGE', 'profile set --from <file>');
  const tpl = JSON.parse(readFileSync(resolve(SKILL_ROOT, 'templates', 'profile.template.json'), 'utf8'));
  let obj; try { obj = JSON.parse(readFileSync(p.flags.from, 'utf8')); } catch { throw cliError('USAGE', `${p.flags.from}: invalid json`); }
  for (const k of Object.keys(obj)) if (!(k in tpl)) throw cliError('SCHEMA-INVALID', `profile.${k} is not a known key`);
  mkdirSync(deliveryDir(repo), { recursive: true }); writeFileSync(profilePath(repo), `${JSON.stringify({ ...tpl, ...obj }, null, 2)}\n`);
  out(io, 'PROFILE written (last-writer-wins)'); return 0;
}

export const COMMANDS = { plan: cmdPlan, session: cmdSession, event: cmdEvent, profile: cmdProfile };
const MUTATING = new Set(['plan', 'session', 'event', 'profile', 'backfill']);

export async function main(argv = process.argv.slice(2), { repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), now = Date.now(), stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const io = { stdout, stderr }; const p = parseArgs(argv); const fn = COMMANDS[p.cmd];
  if (!fn) { stderr.write(`USAGE(unknown command ${p.cmd ?? ''}; expected ${Object.keys(COMMANDS).join('|')})\n`); return 2; }
  let code = 1;
  try { code = await fn(repo, p, io, now); }
  catch (e) { if (e.code && e.exit) { stderr.write(`${e.message}\n`); code = e.exit; } else { stderr.write(`INTERNAL(${String(e.message).replace(/\n/g, ' ')})\n`); code = 1; } }
  finally { if (MUTATING.has(p.cmd) && !p.flags['dry-run'] && p.sub !== 'list' && p.sub !== 'show') { const s = bestEffortSync(repo, { env }); if (!s.synced && !['DELIVERY_NO_SYNC', 'plain-dir'].includes(s.reason)) stderr.write(`WARN sync: ${s.reason}\n`); } }
  return code;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c));
```

`templates/profile.template.json`:
```json
{ "capturePrompts": false, "zeroDurationSec": 60, "minWholeWeeks": 3,
  "baselines": { "cycle_time_task_h": null, "cycle_time_mission_h": null, "throughput_task_per_week": null, "first_pass_rate": null, "hit_rate": null },
  "tokenomics": "auto" }
```

- [ ] **Step 6: Run tests to verify they pass** — `node --test skills/delivery-metrics` → all green (paths 5, events 6, plan 6, plan-markdown 3, git 1, sync 3, delivery 7). Note the registration test's item creation dates: `TASK-001` first appears in the 09-10 commit and `TASK-002` in the 09-12 commit — per-item, not per-file.

- [ ] **Step 7: Commit**
```bash
git add skills/delivery-metrics/scripts skills/delivery-metrics/templates/profile.template.json
git commit -m "feat(delivery-metrics): CLI — plan register (retry-safe), event with transition validation, session/profile, git helpers, best-effort sync"
```

---

### Task 6: `lib/timeline.mjs` — occurrence selection with conflict carry-over, replay validation, rollups

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/timeline.mjs`, `skills/delivery-metrics/scripts/lib/timeline.test.mjs`

**Interfaces:**
- Consumes: `events.mjs` (`SOURCE_RANK`, `factKey`), `plan.mjs` (`estimateStatus`, `mergeCatalogue`).
- Produces:
  - `selectOccurrences(observations, ledgerConflicts = []) → {occurrences, conflicts, counts}` — group active observations by `(plan, item_id, transition_id, basis)`; for each group the best rank = min `SOURCE_RANK` over the group **and** over ledger conflicts (from `resolveObservations().conflicts`) with the same key — a ledger-level conflict at rank ≤ best **quarantines** the occurrence (`reason: 'ledger-conflict'`, no fallback); otherwise records at the best rank must share one `factKey` (differences in `at`, `meta.stage`, `meta.result`, `estimate`, `raw`, `git_sha`, `pr`, `round`, `version` are disagreements) → `CONFLICT` (`reason: 'equal-rank-disagreement'`); else one `occ = {item_id, ref, level, plan, event, at, basis, transition_id, source, estimate, meta, provenance: [{source, observation_id, at, path, line}]}`. Sorted by `at`, then `transition_id`.
  - `buildTimelines({occurrences, plan, end}) → {items: Map<item_id, Item>, counts: {unregistered, deferredEvents, deferredEpisodes, invalidChains, parentIncomplete, awaitingLanding, clockSkew}}`. `Item`: `{item_id, ref, level, parent_item_id, class, role, story, sequence, version_added, cancelled_in_plan, created_at, created_basis, created_sha, estimates: [{revision, at, estimate, status}], estimate_original, estimate_latest, started_at, start_basis, first_commit_at, done_at, done_basis, done_sha, landing_at, cancelled_at, state: planned|in_progress|done|cancelled, dispatch_count, rework_count, deferred_events, reopened, first_completion, current_scope, scope_since, membership_since, children, child_summary: {done, cancelled, open, unknown, cancelled_scope}, flags}`.
    Replay rules (spec §6.9, M1): occurrences with `at ≥ end` ignored; `created` → first wins; `estimated` → pushed; `dispatched` → `dispatch_count++`; sets `started_at` only when `meta.stage ∈ {undefined, null, 'build'}`, no start yet, **and** the item is not already terminal (a dispatch after `done` is activity only); `first_commit` → proxy only (`first_commit_at`), never a start; `done` → first wins (`done_at`, `done_sha = meta.git_sha`), `state = done`; `cancelled` → first wins; `done` after `cancelled` (or `cancelled` after `done`) without an intervening `reopened` → flag `invalid-chain` (item excluded from every metric; `invalidChains++`), state keeps the first terminal; `reopened` → `reopened = true`, flag `deferred-episode` (item excluded from duration/estimate metrics, counted in throughput once by its first completion; `deferredEpisodes++`); `rework_observed` → `rework_count++`; the other deferred events → `deferred_events++`. `clock-skew` is per clock pair and decided in metrics (Task 7), not here — the timeline only exposes the clocks.
    Rollups (spec §5): parent `started_at` = earliest **descendant** observed `started_at` (`start_basis: derived-child`); an explicit parent `dispatched` never overrides it. Children = catalogue children including `cancelled_in_plan` ones (counted in `child_summary.cancelled_scope`, excluded from the "all terminal" test). Mission completion needs **landing evidence**: an explicit observed mission `done` (`landing_at`) **and** every non-scope-cancelled child terminal → `done_at = max(landing_at, latest child terminal)`, `done_basis: 'observed'` (landing) — if landing exists but a child is open/unknown → flag `PARENT-INCOMPLETE`, state `in_progress`, `current_scope.done_at = null` (historical `done_at` remains the first qualified completion); if all children terminal but no landing → flag `awaiting-landing`, state `in_progress`. Campaign completion: explicit campaign `done` **or** all missions terminal → `done_at = max(explicit, latest mission done)`, basis `derived-child` when no explicit; `PARENT-INCOMPLETE` when explicit but missions open. All children cancelled (and no landing) → parent `cancelled`; `partial-cancelled` flag when cancelled + done children coexist. A child with no occurrence at all → `child_summary.unknown++`, parent stays open.
  - `Item.first_completion` = null or `{started_at,start_basis,done_at,done_basis,done_sha,landing_at,children}` from the first qualified historical boundary; `Item.current_scope` = `{state,started_at,done_at,landing_at,child_summary,pending}` at end. Existing `started_at/start_basis/done_at/done_basis/done_sha/landing_at` alias the first-completion clocks once qualified; `state`, `children`, `child_summary` remain endpoint scope. A scope addition does not set `deferred-episode` or erase first delivery. Membership comes from sequential `versions[].items`, applying later versions only at their effective `at`; first version is the declared original historical scope. Added required descendants invalidate prior landing for the new scope (`scope_since`), so their eventual finish alone cannot deliver that scope without a new mission landing. A parent’s qualification cannot precede its current required-membership boundary (`membership_since`), including a removal that makes previously unfinished scope terminal. Membership/event ties use the new version and all observations at the timestamp together. Replay uses only readable versions/evidence; last-writer-wins and capture-loss caveats still apply. No persistent completion cache or episode engine is added.
  - `estimateOriginal(es)`, `estimateLatest(es, before)` as before (first accepted; latest accepted with `at < before`, same unit).

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/timeline.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeObservation } from './events.mjs';
import { selectOccurrences, buildTimelines, estimateOriginal, estimateLatest } from './timeline.mjs';

const R = 'sec/run-1';
const plan = { run: R, items: [
  { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null },
  { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
  { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' },
  { item_id: `${R}/task-b`, ref: 'TASK-B', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' },
  { item_id: `${R}/task-c`, ref: 'TASK-C', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M', cancelled: true },
] };
const it = (k) => plan.items.find((i) => i.item_id === `${R}/${k}`);
const obs = (k, event, at, o = {}) => makeObservation({ user: 'u', host: o.source === 'hook' ? 'claude' : (o.source === 'git' ? 'git' : 'cli'), plan: R, item_id: it(k).item_id, ref: it(k).ref, level: it(k).level, event, at,
  transition_id: o.transition_id ?? `${it(k).item_id}/${event}/episode-1`, source: o.source ?? 'cli', source_record_id: o.token ?? `${event}-${k}-${o.source ?? 'cli'}`, meta: { version: 1, ...(o.meta ?? {}) }, estimate: o.estimate, basis: o.basis }, { now: 0 });
const EST = (o = {}) => ({ unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-14T00:00:00Z', accepted_by: 'D', accepted_at: '2026-09-15T00:00:00Z', ...o });
const END = '2026-09-30T00:00:00Z';
const tl = (o, conflicts = []) => buildTimelines({ occurrences: selectOccurrences(o, conflicts).occurrences, plan, end: END });

test('selectOccurrences: cli beats git both orders; provenance keeps git; equal-rank disagreement → CONFLICT; ledger conflict at higher rank blocks fallback', () => {
  const g = obs('task-a', 'done', '2026-09-16T12:00:00Z', { source: 'git' }), c = obs('task-a', 'done', '2026-09-16T11:00:00Z');
  for (const order of [[g, c], [c, g]]) { const r = selectOccurrences(order); assert.equal(r.conflicts.length, 0); assert.equal(r.occurrences.length, 1); assert.equal(r.occurrences[0].source, 'cli'); assert.deepEqual(r.occurrences[0].provenance.map((p) => p.source).sort(), ['cli', 'git']); }
  const c2 = obs('task-a', 'done', '2026-09-16T10:00:00Z', { token: 't2' });
  const r = selectOccurrences([g, c, c2]); assert.equal(r.occurrences.length, 0); assert.equal(r.conflicts[0].reason, 'equal-rank-disagreement');
  const r2 = selectOccurrences([g], [{ item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/episode-1`, basis: 'observed', source: 'cli', plan: R }]);
  assert.equal(r2.occurrences.length, 0, 'a conflicting current CLI observation blocks git for that occurrence'); assert.equal(r2.conflicts[0].reason, 'ledger-conflict');
  const r3 = selectOccurrences([g], [{ item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/episode-1`, basis: 'observed', source: 'git', plan: R }]);
  assert.equal(r3.occurrences.length, 0, 'same-rank ledger conflict also blocks');
  const d1 = obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/a1`, meta: { stage: 'build' }, token: 'h1' });
  const d2 = obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/a1`, meta: { stage: 'review' }, token: 'h2' });
  assert.equal(selectOccurrences([d1, d2]).conflicts.length, 1, 'stage is a semantic fact');
});

test('replay: spec §12 example (dispatch → cycle start, first_commit proxy), review dispatch is activity, dispatch after done is not a start', () => {
  const o = [obs('task-a', 'created', '2026-09-14T09:00:00Z'), obs('task-a', 'estimated', '2026-09-15T00:00:00Z', { transition_id: `${R}/task-a/estimated/rev-0`, estimate: EST(), meta: { estimate_revision: 0, acceptance: 'accepted' } }),
    obs('task-a', 'first_commit', '2026-09-16T08:00:00Z', { source: 'git', transition_id: `${R}/task-a/first_commit/0` }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/agent-1`, meta: { stage: 'build' } }),
    obs('task-a', 'dispatched', '2026-09-16T10:30:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/agent-2`, meta: { stage: 'review' } }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z', { meta: { git_sha: 'abc' } }),
    obs('task-b', 'created', '2026-09-14T09:00:00Z'), obs('task-b', 'done', '2026-09-16T11:00:00Z'), obs('task-b', 'dispatched', '2026-09-16T12:00:00Z', { source: 'hook', transition_id: `${R}/task-b/dispatched/x` })];
  const { items } = tl(o);
  const a = items.get(it('task-a').item_id);
  assert.equal(a.created_at, '2026-09-14T09:00:00.000Z'); assert.equal(a.first_commit_at, '2026-09-16T08:00:00.000Z'); assert.equal(a.started_at, '2026-09-16T09:00:00.000Z'); assert.equal(a.start_basis, 'observed');
  assert.equal(a.done_at, '2026-09-16T11:00:00.000Z'); assert.equal(a.done_sha, 'abc'); assert.equal(a.state, 'done'); assert.equal(a.dispatch_count, 2); assert.equal(a.estimate_original.low, 1);
  const b = items.get(it('task-b').item_id); assert.equal(b.started_at, null, 'dispatch after done is activity only'); assert.equal(b.dispatch_count, 1);
});

test('replay: cutoff, invalid chain, deferred episode (reopened), rework count', () => {
  const o = [obs('task-a', 'created', '2026-09-14T09:00:00Z'), obs('task-a', 'cancelled', '2026-09-15T00:00:00Z'), obs('task-a', 'done', '2026-09-16T00:00:00Z', { source: 'git' }),
    obs('task-b', 'created', '2026-09-14T09:00:00Z'), obs('task-b', 'done', '2026-09-16T11:00:00Z'), obs('task-b', 'reopened', '2026-09-17T09:00:00Z', { transition_id: `${R}/task-b/reopened/1` }), obs('task-b', 'rework_observed', '2026-09-17T10:00:00Z', { source: 'git', transition_id: `${R}/task-b/rework_observed/1` }),
    obs('task-c', 'created', '2026-09-14T09:00:00Z'), obs('task-c', 'done', '2026-10-05T00:00:00Z')];
  const { items, counts } = tl(o);
  const a = items.get(it('task-a').item_id); assert.ok(a.flags.includes('invalid-chain')); assert.equal(a.state, 'cancelled'); assert.equal(counts.invalidChains, 1);
  const b = items.get(it('task-b').item_id); assert.ok(b.flags.includes('deferred-episode')); assert.equal(b.done_at, '2026-09-16T11:00:00.000Z'); assert.equal(b.state, 'done', 'M1 keeps the first episode'); assert.equal(b.rework_count, 1); assert.equal(counts.deferredEpisodes, 1);
  assert.equal(items.get(it('task-c').item_id).state, 'planned', 'done after cutoff not replayed');
});

test('rollups: derived start (explicit parent dispatch ignored), landing required, PARENT-INCOMPLETE, awaiting-landing, partial-cancelled, scope-cancelled child, unknown child, campaign derived', () => {
  const A = it('task-a').item_id, B = it('task-b').item_id, M = it('mission-g1').item_id, C = it('campaign').item_id;
  const base = [obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-b', 'created', '2026-09-14T00:00:00Z'),
    obs('mission-g1', 'dispatched', '2026-09-15T00:00:00Z', { source: 'hook', transition_id: `${M}/dispatched/x` }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${A}/dispatched/x` }), obs('task-a', 'done', '2026-09-16T11:00:00Z')];
  let r = tl(base); let m = r.items.get(M);
  assert.equal(m.started_at, '2026-09-16T09:00:00.000Z'); assert.equal(m.start_basis, 'derived-child'); assert.equal(m.state, 'in_progress'); assert.equal(m.child_summary.open, 1); assert.equal(m.child_summary.cancelled_scope, 1);
  const bothDone = [...base, obs('task-b', 'dispatched', '2026-09-16T10:00:00Z', { source: 'hook', transition_id: `${B}/dispatched/y` }), obs('task-b', 'done', '2026-09-17T13:00:00Z')];
  r = tl(bothDone); m = r.items.get(M);
  assert.equal(m.state, 'in_progress'); assert.ok(m.flags.includes('awaiting-landing')); assert.equal(m.done_at, null); assert.equal(r.counts.awaitingLanding, 1);
  r = tl([...bothDone, obs('mission-g1', 'done', '2026-09-17T15:00:00Z', { meta: { git_sha: 'land' } })]); m = r.items.get(M);
  assert.equal(m.state, 'done'); assert.equal(m.landing_at, '2026-09-17T15:00:00.000Z'); assert.equal(m.done_at, '2026-09-17T15:00:00.000Z'); assert.equal(m.done_basis, 'observed');
  assert.equal(r.items.get(C).state, 'done'); assert.equal(r.items.get(C).done_basis, 'derived-child'); assert.equal(r.items.get(C).done_at, '2026-09-17T15:00:00.000Z');
  r = tl([...bothDone, obs('mission-g1', 'done', '2026-09-17T12:00:00Z')]); m = r.items.get(M);
  assert.equal(m.done_at, '2026-09-17T13:00:00.000Z', 'landing earlier than the last child terminal → completion is the later clock');
  r = tl([...base, obs('mission-g1', 'done', '2026-09-16T12:00:00Z')]); m = r.items.get(M);
  assert.equal(m.state, 'in_progress'); assert.ok(m.flags.includes('PARENT-INCOMPLETE')); assert.equal(m.done_at, null); assert.equal(r.counts.parentIncomplete, 1);
  r = tl([...base, obs('task-b', 'cancelled', '2026-09-17T00:00:00Z'), obs('mission-g1', 'done', '2026-09-17T15:00:00Z')]); m = r.items.get(M);
  assert.equal(m.state, 'done'); assert.ok(m.flags.includes('partial-cancelled')); assert.equal(m.child_summary.cancelled, 1);
  r = tl([obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-a', 'done', '2026-09-15T00:00:00Z')]); m = r.items.get(M);
  assert.equal(m.child_summary.unknown, 1); assert.equal(m.state, 'in_progress');
  r = tl([obs('task-a', 'cancelled', '2026-09-15T00:00:00Z'), obs('task-b', 'cancelled', '2026-09-15T00:00:00Z')]);
  assert.equal(r.items.get(M).state, 'cancelled');
});

test('Monday completion survives Tuesday scope addition; endpoint remains pending through Wednesday', () => {
  const A = it('task-a').item_id, B = it('task-b').item_id, M = it('mission-g1').item_id, C = it('campaign').item_id;
  const v1 = plan.items.filter((i) => [C, M, A].includes(i.item_id));
  const v2 = [...v1, { ...it('task-b'), version_added: 2 }];
  const history = { ...plan, items: v2, observation_start: '2026-09-14T00:00:00.000Z', versions: [
    { version: 1, at: '2026-09-13T00:00:00.000Z', items: v1 },
    { version: 2, at: '2026-09-15T09:00:00.000Z', items: v2 },
  ] };
  const es = EST({ low: 2, high: 6, proposed_at: '2026-09-13T00:00:00Z', accepted_at: '2026-09-13T01:00:00Z' });
  const occurrences = selectOccurrences([
    obs('mission-g1', 'estimated', es.accepted_at, { estimate: es }),
    obs('task-a', 'dispatched', '2026-09-14T09:00:00Z', { meta: { stage: 'build' } }),
    obs('task-a', 'done', '2026-09-14T11:00:00Z'),
    obs('mission-g1', 'done', '2026-09-14T13:00:00Z'),
    obs('task-b', 'created', '2026-09-15T09:00:00Z', { meta: { version: 2 } }),
  ]).occurrences;
  const early = buildTimelines({ occurrences, plan: history, end: '2026-09-15T00:00:00Z' });
  const late = buildTimelines({ occurrences, plan: history, end: '2026-09-17T00:00:00Z' });
  for (const id of [M, C]) {
    assert.equal(early.items.get(id).state, 'done');
    const i = late.items.get(id);
    assert.equal(i.done_at, '2026-09-14T13:00:00.000Z');
    assert.equal(i.first_completion.started_at, '2026-09-14T09:00:00.000Z');
    assert.equal(i.state, 'in_progress'); assert.equal(i.current_scope.done_at, null);
    assert.equal(i.current_scope.pending, true); assert.ok(i.flags.includes('scope-pending-after-first-completion'));
  }
  assert.equal(late.items.get(M).child_summary.open, 1);
  const later = [...occurrences, ...selectOccurrences([obs('task-b', 'done', '2026-09-16T11:00:00Z', { meta: { version: 2 } })]).occurrences];
  const noNewLanding = buildTimelines({ occurrences: later, plan: history, end: END }).items.get(M);
  assert.equal(noNewLanding.current_scope.done_at, null); assert.equal(noNewLanding.done_at, '2026-09-14T13:00:00.000Z');
  const removed = { ...history, versions: [{ ...history.versions[0], items: v2 }, { ...history.versions[1], items: v1 }] };
  const afterRemoval = buildTimelines({ occurrences, plan: removed, end: END }).items.get(M);
  assert.equal(afterRemoval.first_completion.done_at, '2026-09-15T09:00:00.000Z', 'removal qualifies Tuesday, never backdates completion to Monday');
});

test('estimateOriginal / estimateLatest', () => {
  const es = [{ revision: 0, at: '2026-09-15T00:00:00.000Z', estimate: EST({ accepted_by: null, accepted_at: null }), status: 'unaccepted' },
    { revision: 1, at: '2026-09-15T12:00:00.000Z', estimate: EST(), status: 'accepted' }, { revision: 2, at: '2026-09-16T12:00:00.000Z', estimate: EST({ high: 5 }), status: 'accepted' }];
  assert.equal(estimateOriginal(es).high, 3); assert.equal(estimateLatest(es, '2026-09-16T09:00:00.000Z').high, 3); assert.equal(estimateLatest(es, '2026-09-17T00:00:00.000Z').high, 5); assert.equal(estimateOriginal([es[0]]), null);
});
```

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Write `timeline.mjs`**

```js
// STDLIB ONLY. Occurrence selection (spec D6, with ledger-conflict carry-over) and per-item timelines with rollups (spec §5, §6.9; M1 subset).
import { SOURCE_RANK, factKey } from './events.mjs';
import { estimateStatus, mergeCatalogue } from './plan.mjs';

const START_STAGES = new Set([undefined, null, 'build']);
const TERMINAL = new Set(['done', 'cancelled']);
const DEFERRED = new Set(['blocked', 'unblocked', 'review_requested', 'review_returned', 'review_approved', 'review_history', 'scope_declared', 'gate_observed', 'outcome_observed']);
const key = (o) => JSON.stringify([o.plan, o.item_id ?? '', o.transition_id, o.basis]);

export function selectOccurrences(observations, ledgerConflicts = []) {
  const groups = new Map();
  for (const o of observations) { if (o.status !== 'active') continue; const k = key(o); (groups.get(k) ?? groups.set(k, []).get(k)).push(o); }
  const conflictRank = new Map();
  for (const c of ledgerConflicts) { const k = key(c); const r = SOURCE_RANK[c.source] ?? 99; conflictRank.set(k, Math.min(conflictRank.get(k) ?? 99, r)); }
  const occurrences = [], conflicts = [];
  for (const [k, recs] of groups) {
    const best = Math.min(...recs.map((r) => SOURCE_RANK[r.source] ?? 99));
    const f = recs[0];
    if ((conflictRank.get(k) ?? 99) <= best) { conflicts.push({ item_id: f.item_id, transition_id: f.transition_id, basis: f.basis, reason: 'ledger-conflict', sources: recs.map((r) => r.observation_id) }); continue; }
    const top = recs.filter((r) => (SOURCE_RANK[r.source] ?? 99) === best);
    if (new Set(top.map(factKey)).size > 1) { conflicts.push({ item_id: f.item_id, transition_id: f.transition_id, basis: f.basis, reason: 'equal-rank-disagreement', sources: top.map((r) => r.observation_id) }); continue; }
    const w = top[0];
    occurrences.push({ item_id: w.item_id, ref: w.ref, level: w.level, plan: w.plan, event: w.event, at: w.at, basis: w.basis, transition_id: w.transition_id, source: w.source, estimate: w.estimate, meta: w.meta ?? {},
      provenance: recs.map((r) => ({ source: r.source, observation_id: r.observation_id, at: r.at, path: r._at?.path ?? null, line: r._at?.line ?? null })) });
  }
  for (const c of ledgerConflicts) if (!groups.has(key(c))) conflicts.push({ item_id: c.item_id, transition_id: c.transition_id, basis: c.basis, reason: 'ledger-conflict', sources: [c.observation_id] });
  occurrences.sort((a, b) => a.at.localeCompare(b.at) || a.transition_id.localeCompare(b.transition_id));
  return { occurrences, conflicts, counts: { occurrences: occurrences.length, conflicts: conflicts.length } };
}

export const estimateOriginal = (es) => es.find((e) => e.status === 'accepted')?.estimate ?? null;
export function estimateLatest(es, before) {
  const orig = estimateOriginal(es); if (!orig) return null;
  const ok = es.filter((e) => e.status === 'accepted' && e.estimate.unit === orig.unit && (!before || e.at < before));
  return ok.length ? ok[ok.length - 1].estimate : null;
}

const newItem = (i) => ({ item_id: i.item_id, ref: i.ref, level: i.level, parent_item_id: i.parent_item_id ?? null, class: i.class ?? null, role: i.role ?? null, story: i.story ?? null, sequence: i.sequence ?? null,
  version_added: i.version_added ?? 1, cancelled_in_plan: Boolean(i.cancelled), created_at: null, created_basis: null, created_sha: null, estimates: [], estimate_original: null, estimate_latest: null,
  scope_since: i.scope_since ?? null, membership_since: i.membership_since ?? null, first_completion: null, current_scope: null, started_at: null, start_basis: null, first_commit_at: null, done_at: null, done_basis: null, done_sha: null, landing_at: null, cancelled_at: null, state: 'planned', dispatch_count: 0, rework_count: 0,
  deferred_events: 0, reopened: false, children: [], child_summary: { done: 0, cancelled: 0, open: 0, unknown: 0, cancelled_scope: 0 }, flags: [], seen: false });

function reduceTimelineSnapshot({ occurrences, plan, end }) {
  const endIso = new Date(end).toISOString();
  const items = new Map(plan.items.map((i) => [i.item_id, newItem(i)]));
  for (const i of items.values()) if (i.parent_item_id && items.has(i.parent_item_id)) items.get(i.parent_item_id).children.push(i.item_id);
  const counts = { unregistered: 0, deferredEvents: 0, deferredEpisodes: 0, invalidChains: 0, parentIncomplete: 0, awaitingLanding: 0, clockSkew: 0 };
  const explicitDone = new Map();
  for (const o of occurrences) {
    if (o.at >= endIso) continue;
    const it = items.get(o.item_id); if (!it) { counts.unregistered++; continue; }
    it.seen = true;
    const terminal = TERMINAL.has(it.state);
    switch (o.event) {
      case 'created': if (!it.created_at) { it.created_at = o.at; it.created_basis = o.basis; it.created_sha = o.meta.git_sha ?? null; } break;
      case 'estimated': it.estimates.push({ revision: o.meta.estimate_revision ?? it.estimates.length, at: o.at, estimate: o.estimate, status: o.meta.acceptance === 'stale-acceptance' ? 'unaccepted' : estimateStatus(o.estimate) }); break;
      case 'dispatched': it.dispatch_count++; if (START_STAGES.has(o.meta.stage) && !it.started_at && !terminal && it.level === 'task') { it.started_at = o.at; it.start_basis = 'observed'; } if (it.state === 'planned') it.state = 'in_progress'; break;
      case 'first_commit': if (!it.first_commit_at) it.first_commit_at = o.at; if (it.state === 'planned') it.state = 'in_progress'; break;
      case 'done':
        if (it.level !== 'task') { if ((!it.scope_since || o.at >= it.scope_since) && !explicitDone.has(it.item_id)) { explicitDone.set(it.item_id, o); it.landing_at = o.at; } break; }
        if (it.state === 'cancelled' && !it.reopened) { if (!it.flags.includes('invalid-chain')) { it.flags.push('invalid-chain'); counts.invalidChains++; } break; }
        if (!it.done_at) { it.done_at = o.at; it.done_basis = 'observed'; it.done_sha = o.meta.git_sha ?? null; } it.state = 'done'; break;
      case 'cancelled':
        if (it.state === 'done' && !it.reopened) { if (!it.flags.includes('invalid-chain')) { it.flags.push('invalid-chain'); counts.invalidChains++; } break; }
        if (!it.cancelled_at) it.cancelled_at = o.at; if (it.state !== 'done') it.state = 'cancelled'; break;
      case 'reopened': if (!it.reopened) { it.reopened = true; it.flags.push('deferred-episode'); counts.deferredEpisodes++; } break;
      case 'rework_observed': it.rework_count++; break;
      case 'dispatch_ended': break;
      default: if (DEFERRED.has(o.event)) { it.deferred_events++; counts.deferredEvents++; }
    }
  }
  for (const it of items.values()) { it.estimates.sort((a, b) => a.revision - b.revision); it.estimate_original = estimateOriginal(it.estimates); }
  for (const level of ['mission', 'campaign']) {
    for (const it of items.values()) {
      if (it.level !== level) continue;
      const all = it.children.map((id) => items.get(id));
      const kids = all.filter((k) => !k.cancelled_in_plan);
      const starts = kids.map((k) => k.started_at).filter(Boolean).sort();
      it.started_at = starts[0] ?? null; it.start_basis = starts.length ? 'derived-child' : null;
      const s = { done: 0, cancelled: 0, open: 0, unknown: 0, cancelled_scope: all.length - kids.length };
      for (const k of kids) { if (k.state === 'done') s.done++; else if (k.state === 'cancelled') s.cancelled++; else if (k.seen || k.children.some((c) => items.get(c).seen)) s.open++; else s.unknown++; }
      it.child_summary = s;
      const allTerminal = kids.length > 0 && s.open === 0 && s.unknown === 0;
      const lastTerminal = kids.map((k) => k.done_at ?? k.cancelled_at).filter(Boolean).sort().pop() ?? null;
      const explicit = explicitDone.get(it.item_id);
      if (explicit && !allTerminal) { it.flags.push('PARENT-INCOMPLETE'); it.state = 'in_progress'; it.done_at = null; counts.parentIncomplete++; }
      else if (allTerminal && s.done === 0 && !explicit) { it.state = 'cancelled'; it.cancelled_at = lastTerminal; }
      else if (allTerminal && (explicit || level === 'campaign')) { it.state = 'done'; it.done_at = [explicit?.at, lastTerminal, it.membership_since].filter(Boolean).sort().pop(); it.done_basis = explicit ? 'observed' : 'derived-child'; it.done_sha = explicit?.meta?.git_sha ?? null; }
      else if (allTerminal) { it.flags.push('awaiting-landing'); it.state = 'in_progress'; counts.awaitingLanding++; }
      else if (it.state === 'planned' && (starts.length || kids.some((k) => k.seen))) it.state = 'in_progress';
      if (s.cancelled > 0 && s.done > 0) it.flags.push('partial-cancelled');
      if (it.state !== 'planned') it.seen = true;
    }
  }
  for (const it of items.values()) { it.estimate_latest = estimateLatest(it.estimates, it.started_at); delete it.seen; }
  return { items, counts };
}

/** Membership is effective-time data; first registration describes historical v1 scope.
 * Later versions apply at their explicit at, including keep-missing behavior. */
function catalogueAt(plan, at) {
  const versions = [...(plan.versions ?? [])].sort((a, b) => a.version - b.version);
  if (!versions.length) return plan.items;
  let rows = [], scopeSince = new Map(), membershipSince = new Map();
  const descendants = (items, parent) => {
    const ids = new Set([parent]);
    for (let pass = 0; pass < items.length; pass++) for (const i of items) if (!i.cancelled && ids.has(i.parent_item_id)) ids.add(i.item_id);
    ids.delete(parent); return ids;
  };
  for (let n = 0; n < versions.length; n++) {
    const v = versions[n]; if (n > 0 && new Date(v.at).toISOString() > at) break;
    const next = mergeCatalogue(rows, v.items, { keepMissing: Boolean(v.keep_missing) });
    if (n > 0) for (const parent of next.filter((i) => i.level !== 'task')) {
      const before = descendants(rows, parent.item_id), after = descendants(next, parent.item_id);
      if ([...after].some((id) => !before.has(id)) || [...before].some((id) => !after.has(id))) membershipSince.set(parent.item_id, new Date(v.at).toISOString());
      if ([...after].some((id) => !before.has(id))) scopeSince.set(parent.item_id, new Date(v.at).toISOString());
    }
    rows = next;
  }
  return rows.map((i) => ({ ...i, scope_since: scopeSince.get(i.item_id) ?? null, membership_since: membershipSince.get(i.item_id) ?? null }));
}

export function buildTimelines({ occurrences, plan, end }) {
  const endIso = new Date(end).toISOString();
  const ordered = [...occurrences].sort((a, b) => a.at.localeCompare(b.at) || a.transition_id.localeCompare(b.transition_id));
  const boundaries = [...new Set([...ordered.map((o) => o.at), ...(plan.versions ?? []).slice(1).map((v) => new Date(v.at).toISOString())])].filter((t) => t < endIso).sort();
  const first = new Map();
  // Pure replay of readable evidence, not an additional ledger or transaction.
  for (const at of boundaries) {
    const cut = new Date(Date.parse(at) + 1).toISOString();
    const snap = reduceTimelineSnapshot({ occurrences: ordered.filter((o) => o.at <= at), plan: { ...plan, items: catalogueAt(plan, at) }, end: cut });
    for (const it of snap.items.values()) if (it.state === 'done' && !first.has(it.item_id)) {
      first.set(it.item_id, { started_at: it.started_at, start_basis: it.start_basis, done_at: it.done_at, done_basis: it.done_basis, done_sha: it.done_sha, landing_at: it.landing_at, children: [...it.children] });
    }
  }
  const endpoint = new Date(Date.parse(endIso) - 1).toISOString();
  const result = reduceTimelineSnapshot({ occurrences: ordered, plan: { ...plan, items: catalogueAt(plan, endpoint) }, end: endIso });
  for (const it of result.items.values()) {
    it.current_scope = { state: it.state, started_at: it.started_at, done_at: it.done_at, landing_at: it.landing_at, child_summary: { ...it.child_summary }, pending: it.level !== 'task' && it.state !== 'done' && it.state !== 'cancelled' };
    it.first_completion = first.get(it.item_id) ?? null;
    if (it.first_completion) {
      // Compatibility clocks ALWAYS describe first delivery; state/children describe the endpoint.
      const { children, ...clocks } = it.first_completion; Object.assign(it, clocks);
      if (it.level !== 'task' && it.current_scope.pending) it.flags.push('scope-pending-after-first-completion');
    }
    it.estimate_latest = estimateLatest(it.estimates, it.started_at);
  }
  return result;
}

```

- [ ] **Step 4: Run test to verify it passes** — 5 passing.

- [ ] **Step 5: Commit**
```bash
git add skills/delivery-metrics/scripts/lib/timeline.mjs skills/delivery-metrics/scripts/lib/timeline.test.mjs
git commit -m "feat(delivery-metrics): occurrence selection with conflict carry-over, validated replay, landing-gated rollups"
```

---

### Task 7: `lib/metrics.mjs` — flow, throughput with declared coverage, estimate accuracy per stratum, coverage

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/metrics.mjs`, `skills/delivery-metrics/scripts/lib/metrics.test.mjs`

**Interfaces:**
- Consumes: `timeline.mjs` `Item` objects.
- Produces:
  - `secondsBetween(a, b) → number` (unrounded, may be negative), `toHours(sec) → number` (2 dp, renderers only), `nearestRank(sorted, q)`, `stats(values) → {n, min, max, median, p85, p90, samples}|null` on **unrounded** values (floors 5/7/10; `samples` when n < 5).
  - `weekStartUtc(iso)`, `isoWeekUtc(iso)`, `weekKeys(since, end, coverageStart) → [{key, start, end, whole, covered}]` — `covered` = the week lies entirely inside `[coverageStart, end)`; `whole` = covered **and** entirely inside `[since, end)`.
  - `computeMetrics({items, plan, since, end, profile, estimateBase='original', filters:{level?, class?}}) → data`:
    ```
    { window: {since, end, coverage_start}, cohorts: {completed, created, excluded_items: {invalid_chain, deferred_episode}},
      flow: { [level]: { strata: { [class|'all']: { cycle_time, commit_to_done, lead_time, parent_elapsed } },   // stats over SECONDS
                         excluded: { clock_skew_cycle, clock_skew_commit, clock_skew_lead, retrospective_plan_proxy, missing_start },
                         quality: { reviewed: null, eligible: null, done, unknown } } },
      throughput: { [level]: { weeks: [{key, count, whole, covered}], velocity: {median, mean, whole_weeks}|null, caveat } },
      wip: { [level]: n },
      mission_turnaround: { pairs: [{from, to, gap_s|null, overlap_s|null}], stats },
      estimates: { [level]: { strata: { [class|'all']: {...}, ['tier:'+tier]: {...} } } }   // each stratum: { n, eligible, work_ratio: stats, mdmre, pred25, mae_s, hit_rate: {hits, ranged, rate}, excluded: {excluded_item, unestimated, unaccepted, no_eligible_latest, unit_mismatch, missing_actual, late_accepted, zero_midpoint, zero_actual, point} }
      estimate_rows: [{item_id, ref, level, class, tier, base, estimate: {unit, low, high}, actual_s, actual_basis, ratio, hit, reason}],
      schedule_variance: [{item_id, ref, level, estimate: {low, high}, actual_s, band: {vs_high_s, vs_low_s}, scope: {added, removed}}],
      coverage: { [level]: { done, with_dispatched, with_first_commit, with_created, start_source: {observed, 'derived-child', none}, sources: {dispatched: {}, first_commit: {}, done: {}} } },
      rework_proxy_items, caveats: [] }
    ```
    Rules: completion cohort = first-delivery `done_at ∈ [since, end)`, independently of endpoint `state`; endpoint `state` drives WIP/status; items flagged `invalid-chain` or `deferred-episode` are excluded from every duration/estimate metric (counted in `cohorts.excluded_items`) but a `deferred-episode` item still counts once in throughput by its first completion; each duration is validated **independently**: negative → the matching `clock_skew_*` counter, the other clocks of that item stay valid; `cycle_time` needs `start_basis === 'observed'`; parents with `derived-child` start → `parent_elapsed`; `commit_to_done` only when no `started_at`; `lead_time` needs `created_at`; **retrospective_plan_proxy** = `created_basis === 'plan-commit'` **and** `created_sha != null && created_sha === done_sha` **and** elapsed ≤ `zeroDurationSec` (same commit proves retrospective authorship; short duration alone never does); throughput counts first `done_at` per UTC ISO week; `velocity` = median over `whole` weeks when `≥ minWholeWeeks`, else `null` + caveat; estimate actual for unit `h`: task → cycle (observed start), mission/campaign → parent_elapsed; exclusion reasons are **mutually exclusive, in this order**: `excluded_item`, `unestimated` (no estimated revision at all), `unaccepted` (revisions exist, none accepted), `no_eligible_latest` (`estimateBase==='latest'` and nothing accepted before start), `unit_mismatch` (`active_min` in M1), `missing_actual`, `late_accepted` (`accepted_at ≥ started_at`), `zero_midpoint`, `zero_actual` (kept in MAE, excluded from ratio/MRE); `point` (`low === high`) is an additional flag (excluded from hit-rate only); `hit = low ≤ actual_h ≤ high` on the **unrounded** hour value; `band.vs_high_s = actual − high·3600`, `band.vs_low_s = actual − low·3600` (rendered as `[vs_high, vs_low]` → `[-4h, +16h]`); `scope.added` = children `version_added > 1`, `scope.removed` = children `cancelled_in_plan`; `filters.level`/`filters.class` restrict the items considered (the window/cohort logic is unchanged); `rework_proxy_items` = completed items with `rework_count > 0`; `caveats` generated from numbers only.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/scripts/lib/metrics.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secondsBetween, toHours, stats, isoWeekUtc, weekKeys, computeMetrics } from './metrics.mjs';

const PROFILE = { zeroDurationSec: 60, minWholeWeeks: 3 };
const H = 3600;
const EST = (low, high, o = {}) => ({ unit: 'h', low, high, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-01T00:00:00Z', accepted_by: 'D', accepted_at: '2026-09-01T00:00:00Z', ...o });
const item = (o) => ({ item_id: o.id, ref: o.id, level: o.level ?? 'task', parent_item_id: o.parent ?? null, class: o.class ?? null, role: null, story: null, sequence: o.sequence ?? null, version_added: o.version_added ?? 1,
  cancelled_in_plan: Boolean(o.cancelled_in_plan), created_at: o.created ?? null, created_basis: o.created_basis ?? (o.created ? 'observed' : null), created_sha: o.created_sha ?? null,
  estimates: o.est ? [{ revision: 0, at: o.est.accepted_at ?? o.est.proposed_at, estimate: o.est, status: o.est.accepted_by ? 'accepted' : 'unaccepted' }] : [],
  estimate_original: o.est?.accepted_by ? o.est : null, estimate_latest: o.est?.accepted_by ? o.est : null, started_at: o.started ?? null, start_basis: o.started ? (o.start_basis ?? 'observed') : null,
  first_commit_at: o.commit ?? null, done_at: o.done ?? null, done_basis: o.done ? 'observed' : null, done_sha: o.done_sha ?? null, landing_at: null, cancelled_at: o.cancelled ?? null,
  state: o.state ?? (o.done ? 'done' : o.cancelled ? 'cancelled' : o.started ? 'in_progress' : 'planned'), dispatch_count: o.started ? 1 : 0, rework_count: o.rework ?? 0, deferred_events: 0, reopened: false,
  children: o.children ?? [], child_summary: { done: 0, cancelled: 0, open: 0, unknown: 0, cancelled_scope: 0 }, flags: o.flags ?? [] });
const toMap = (arr) => new Map(arr.map((i) => [i.item_id, i]));

test('seconds/hours, stats floors, nearest rank on unrounded values', () => {
  assert.equal(secondsBetween('2026-09-16T09:00:00Z', '2026-09-16T11:30:00Z'), 9000); assert.equal(toHours(9000), 2.5); assert.equal(secondsBetween('2026-09-16T09:00:15Z', '2026-09-16T09:00:00Z'), -15);
  const s4 = stats([4, 1, 3, 2]); assert.equal(s4.n, 4); assert.equal(s4.median, null); assert.deepEqual(s4.samples, [1, 2, 3, 4]);
  const s7 = stats([1, 2, 3, 4, 5, 6, 7]); assert.equal(s7.median, 4); assert.equal(s7.p85, 6); assert.equal(s7.p90, null);
  const s10 = stats([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]); assert.equal(s10.p90, 9); assert.equal(s10.p85, 9); assert.equal(s10.median, 5);
  assert.equal(stats([]), null);
});

test('first parent delivery drives throughput/accuracy while endpoint scope drives WIP', () => {
  const est = { unit: 'h', low: 2, high: 6, tier: 'budgetary', accepted_by: 'D', accepted_at: '2026-09-13T01:00:00.000Z' };
  const parent = item({ id: 'parent', level: 'mission', started: '2026-09-14T09:00:00.000Z', start_basis: 'derived-child', done: '2026-09-14T13:00:00.000Z', est });
  const plan = { observation_start: '2026-09-14T00:00:00.000Z' };
  for (const state of ['done', 'in_progress']) {
    const i = { ...parent, state, flags: state === 'done' ? [] : ['scope-pending-after-first-completion'] };
    const m = computeMetrics({ items: toMap([i]), plan, since: '2026-09-14T00:00:00Z', end: '2026-09-17T00:00:00Z' });
    assert.equal(m.throughput.mission.weeks.reduce((n, w) => n + w.count, 0), 1);
    assert.equal(m.estimate_rows[0].actual_s, 14400); assert.equal(m.estimate_rows[0].ratio, 1); assert.equal(m.estimate_rows[0].hit, true);
    assert.equal(m.wip.mission, state === 'done' ? 0 : 1);
  }
});

test('isoWeekUtc across a year boundary; weekKeys whole/covered with a late coverage start', () => {
  assert.equal(isoWeekUtc('2026-01-01T00:00:00Z'), '2026-W01'); assert.equal(isoWeekUtc('2027-01-01T00:00:00Z'), '2026-W53'); assert.equal(isoWeekUtc('2026-09-16T23:59:59Z'), '2026-W38');
  assert.deepEqual(weekKeys('2026-09-09T12:00:00Z', '2026-09-28T00:00:00Z', '2026-09-09T12:00:00Z').map((k) => [k.key, k.whole, k.covered]), [['2026-W37', false, false], ['2026-W38', true, true], ['2026-W39', true, true]]);
  assert.deepEqual(weekKeys('2026-08-31T00:00:00Z', '2026-09-21T00:00:00Z', '2026-09-08T00:00:00Z').map((k) => [k.key, k.whole, k.covered]), [['2026-W36', false, false], ['2026-W37', false, false], ['2026-W38', true, true]], 'weeks before declared coverage are never whole');
});

test('computeMetrics: hand-computed flow, throughput, estimates (rows, strata, exclusions, band), coverage, rework', () => {
  const items = toMap([
    item({ id: 'c', level: 'campaign', children: ['m1', 'm2'], created: '2026-09-01T00:00:00Z' }),
    item({ id: 'm1', level: 'mission', parent: 'c', sequence: 1, children: ['t1', 't2', 't3'], started: '2026-09-07T09:00:00Z', start_basis: 'derived-child', done: '2026-09-09T17:00:00Z', est: EST(40, 60), created: '2026-09-01T00:00:00Z' }),
    item({ id: 'm2', level: 'mission', parent: 'c', sequence: 2, children: ['t4', 't5', 't6', 't7', 't8'], started: '2026-09-10T09:00:00Z', start_basis: 'derived-child', state: 'in_progress', created: '2026-09-01T00:00:00Z' }),
    // t1: created Mon 09:00, commit Wed 08:00, dispatch Wed 09:00, done Wed 11:00 → lead 50 h, cycle 2 h; est 1–3 → ratio 1, hit
    item({ id: 't1', parent: 'm1', class: 'S', created: '2026-09-07T09:00:00Z', commit: '2026-09-09T08:00:00Z', started: '2026-09-09T09:00:00Z', done: '2026-09-09T11:00:00Z', est: EST(1, 3) }),
    // t2: no dispatch, commit→done 3 h; estimate → missing_actual
    item({ id: 't2', parent: 'm1', class: 'S', created: '2026-09-07T09:00:00Z', commit: '2026-09-09T14:00:00Z', done: '2026-09-09T17:00:00Z', est: EST(1, 3) }),
    // t3: cycle 4 h, estimate accepted after the start → late_accepted
    item({ id: 't3', parent: 'm1', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T13:00:00Z', est: EST(1, 3, { accepted_at: '2026-09-08T10:00:00Z' }) }),
    // t4: cycle 6 h, unestimated, one rework proxy
    item({ id: 't4', parent: 'm2', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-10T09:00:00Z', done: '2026-09-10T15:00:00Z', rework: 1 }),
    // t5: cycle clock skewed (done before start) but lead valid: lead = 4 days; counted in throughput
    item({ id: 't5', parent: 'm2', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-11T12:00:00Z', done: '2026-09-11T09:00:00Z', est: EST(1, 3) }),
    // t6: open, WIP; point estimate
    item({ id: 't6', parent: 'm2', class: 'L', created: '2026-09-07T09:00:00Z', started: '2026-09-14T09:00:00Z', est: EST(2, 2) }),
    // t7: retrospective plan proxy: same commit created+done, 30 s apart → lead excluded; no start → missing_start
    item({ id: 't7', parent: 'm2', class: 'S', created: '2026-09-12T10:00:00Z', created_basis: 'plan-commit', created_sha: 'p1', done: '2026-09-12T10:00:30Z', done_sha: 'p1' }),
    // t8: genuine 15-second cycle with a narrow range 0–0.01 h (36 s) → hit, ratio 15/18 = 0.8333…; short lead but different commits → NOT retrospective
    item({ id: 't8', parent: 'm2', class: 'S', created: '2026-09-12T11:00:00Z', created_basis: 'plan-commit', created_sha: 'p2', started: '2026-09-12T11:00:00Z', done: '2026-09-12T11:00:15Z', done_sha: 'p3', est: EST(0, 0.01) }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  const T = d.flow.task.strata.all;
  assert.equal(d.cohorts.completed, 8, 't1 t2 t3 t4 t5 t7 t8 + m1');
  assert.deepEqual(T.cycle_time.samples, [15, 2 * H, 4 * H, 6 * H], 'seconds, unrounded: t8 t1 t3 t4');
  assert.deepEqual(T.commit_to_done.samples, [3 * H]);
  assert.equal(T.lead_time.n, 6, 't1 t2 t3 t4 t5 t8 (t7 retrospective)');
  assert.deepEqual(d.flow.task.excluded, { clock_skew_cycle: 1, clock_skew_commit: 0, clock_skew_lead: 0, retrospective_plan_proxy: 1, missing_start: 1 });
  assert.deepEqual(d.flow.task.strata.S.cycle_time.samples, [15, 2 * H]);
  assert.equal(d.flow.mission.strata.all.cycle_time, null); assert.deepEqual(d.flow.mission.strata.all.parent_elapsed.samples, [56 * H]);
  assert.deepEqual(d.flow.task.quality, { reviewed: null, eligible: null, done: 7, unknown: 7 });
  assert.deepEqual(d.throughput.task.weeks.map((w) => [w.key, w.count, w.whole]), [['2026-W37', 7, true], ['2026-W38', 0, true]]);
  assert.equal(d.throughput.task.velocity, null); assert.match(d.throughput.task.caveat, /2 whole weeks < 3/);
  assert.equal(d.throughput.mission.weeks[0].count, 1); assert.equal(d.wip.task, 1);
  const e = d.estimates.task.strata.all;
  assert.equal(e.n, 5, 'items carrying an estimate: t1 t2 t3 t5 t8');
  assert.equal(e.eligible, 2, 't1 and t8');
  assert.deepEqual(e.excluded, { excluded_item: 0, unestimated: 2, unaccepted: 0, no_eligible_latest: 0, unit_mismatch: 0, missing_actual: 1, late_accepted: 1, zero_midpoint: 0, zero_actual: 0, point: 0, clock_skew: 1 });
  assert.deepEqual(e.work_ratio.samples.map((x) => Math.round(x * 10000) / 10000), [0.8333, 1]);
  // MdMRE = median(|15-18|/15, |7200-7200|/7200) = median(0.2, 0): sorted [0, 0.2], nearest-rank q=.5 → index ceil(1)-1 = 0 → 0
  assert.equal(e.mdmre, 0); assert.equal(e.pred25, 1); assert.equal(e.mae_s, 1.5, 'mean(|15-18|, |7200-7200|) = 1.5 s');
  assert.deepEqual(e.hit_rate, { hits: 2, ranged: 2, rate: 1 });
  assert.equal(d.estimates.task.strata.S.eligible, 2); assert.equal(d.estimates.task.strata['tier:budgetary'].eligible, 2);
  const rows = Object.fromEntries(d.estimate_rows.map((r) => [r.ref, r]));
  assert.equal(rows.t1.hit, true); assert.equal(rows.t1.ratio, 1); assert.equal(rows.t1.actual_s, 2 * H); assert.equal(rows.t1.reason, null);
  assert.equal(rows.t2.reason, 'missing_actual'); assert.equal(rows.t3.reason, 'late_accepted'); assert.equal(rows.t5.reason, 'clock_skew'); assert.equal(rows.t4, undefined, 'unestimated items have no row');
  assert.equal(rows.m1.ratio, 1.12); assert.equal(rows.m1.hit, true); assert.equal(rows.m1.actual_basis, 'derived-child');
  assert.deepEqual(d.schedule_variance[0].band, { vs_high_s: -4 * H, vs_low_s: 16 * H });
  assert.deepEqual(d.mission_turnaround.pairs, [{ from: 'm1', to: 'm2', gap_s: 16 * H, overlap_s: null }]);
  assert.equal(d.coverage.task.done, 7); assert.equal(d.coverage.task.with_dispatched, 5); assert.equal(d.coverage.task.start_source.none, 2);
  assert.equal(d.rework_proxy_items, 1);
  assert.ok(d.caveats.some((c) => /velocity\(task\)/.test(c)));
});

test('computeMetrics: velocity over whole covered weeks; overlap; filters; latest base', () => {
  const items = toMap([
    item({ id: 'm1', level: 'mission', sequence: 1, started: '2026-09-01T00:00:00Z', start_basis: 'derived-child', done: '2026-09-20T00:00:00Z' }),
    item({ id: 'm2', level: 'mission', sequence: 2, started: '2026-09-15T00:00:00Z', start_basis: 'derived-child', done: '2026-09-25T00:00:00Z' }),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => item({ id: `t${i}`, class: i % 2 ? 'S' : 'M', started: '2026-09-01T00:00:00Z', done: `2026-09-${String(i + 6).padStart(2, '0')}T12:00:00Z` })),
  ]);
  const plan = { run: 'p', observation_start: '2026-08-31T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE });
  assert.deepEqual(d.throughput.task.weeks.map((w) => [w.key, w.count, w.whole]), [['2026-W36', 0, true], ['2026-W37', 7, true], ['2026-W38', 0, true], ['2026-W39', 0, true]]);
  assert.deepEqual(d.throughput.task.velocity, { median: 0, mean: 1.75, whole_weeks: 4 });
  assert.deepEqual(d.mission_turnaround.pairs, [{ from: 'm1', to: 'm2', gap_s: null, overlap_s: 120 * H }]);
  const late = computeMetrics({ items, plan: { ...plan, observation_start: '2026-09-08T00:00:00Z' }, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE });
  assert.deepEqual(late.throughput.task.weeks.map((w) => [w.key, w.whole]), [['2026-W36', false], ['2026-W37', false], ['2026-W38', true], ['2026-W39', true]]);
  assert.equal(late.throughput.task.velocity, null, 'only 2 whole covered weeks');
  const f = computeMetrics({ items, plan, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE, filters: { class: 'S' } });
  assert.equal(f.coverage.task.done, 4);
});
```
`excluded.clock_skew` is the estimate-side counter for t5 (its cycle clock is skewed, so it has no actual).

- [ ] **Step 2: Run test to verify it fails** — module not found.

- [ ] **Step 3: Write `metrics.mjs`**

```js
// STDLIB ONLY. Metrics (spec §6.10) over timeline items. Seconds everywhere; rendering rounds. Every figure carries n; caveats from numbers.
export const secondsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;
export const toHours = (s) => (s == null ? null : Math.round((s / 3600) * 100) / 100);
export const nearestRank = (sorted, q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
export function stats(values) {
  const s = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b); const n = s.length;
  if (!n) return null;
  return { n, min: s[0], max: s[n - 1], median: n >= 5 ? nearestRank(s, 0.5) : null, p85: n >= 7 ? nearestRank(s, 0.85) : null, p90: n >= 10 ? nearestRank(s, 0.9) : null, samples: n < 5 ? s : undefined };
}
export function weekStartUtc(iso) { const d = new Date(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))); }
export function isoWeekUtc(iso) {
  const d = new Date(iso); const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3));
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4)); const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function weekKeys(since, end, coverageStart = since) {
  const s = Date.parse(since), e = Date.parse(end), c = Date.parse(coverageStart); const out = [];
  for (let w = weekStartUtc(since); w.getTime() < e; w = new Date(w.getTime() + 7 * 86400000)) {
    const next = w.getTime() + 7 * 86400000; const covered = w.getTime() >= c && next <= e;
    out.push({ key: isoWeekUtc(w.toISOString()), start: w.toISOString(), end: new Date(next).toISOString(), covered, whole: covered && w.getTime() >= s });
  }
  return out;
}

const LEVELS = ['campaign', 'mission', 'task', 'case'];
const inWin = (t, a, b) => t != null && t >= a && t < b;
const EXCL = ['excluded_item', 'unestimated', 'unaccepted', 'no_eligible_latest', 'unit_mismatch', 'missing_actual', 'late_accepted', 'zero_midpoint', 'zero_actual', 'point', 'clock_skew'];
const emptyEst = () => ({ n: 0, eligible: 0, work_ratio: null, mdmre: null, pred25: null, mae_s: null, hit_rate: { hits: 0, ranged: 0, rate: null }, excluded: Object.fromEntries(EXCL.map((k) => [k, 0])), _ratios: [], _mres: [], _aes: [] });
const finishEst = (e) => { e.work_ratio = stats(e._ratios); if (e._mres.length) { const s = [...e._mres].sort((a, b) => a - b); e.mdmre = Math.round(nearestRank(s, 0.5) * 10000) / 10000; e.pred25 = Math.round((e._mres.filter((m) => m <= 0.25).length / e._mres.length) * 10000) / 10000; } if (e._aes.length) e.mae_s = Math.round((e._aes.reduce((a, b) => a + b, 0) / e._aes.length) * 1000) / 1000; if (e.hit_rate.ranged) e.hit_rate.rate = Math.round((e.hit_rate.hits / e.hit_rate.ranged) * 10000) / 10000; delete e._ratios; delete e._mres; delete e._aes; return e; };

export function computeMetrics({ items, plan, since, end, profile = {}, estimateBase = 'original', filters = {} }) {
  const zero = profile.zeroDurationSec ?? 60, minWeeks = profile.minWholeWeeks ?? 3;
  const sinceIso = new Date(since).toISOString(), endIso = new Date(end).toISOString();
  const covStart = plan.observation_start ? new Date(plan.observation_start).toISOString() : sinceIso;
  let all = [...items.values()];
  if (filters.level) all = all.filter((i) => i.level === filters.level);
  if (filters.class) all = all.filter((i) => i.class === filters.class);
  const excludedItem = (i) => i.flags.includes('invalid-chain') || i.flags.includes('deferred-episode');
  const completed = all.filter((i) => inWin(i.done_at, sinceIso, endIso));
  const caveats = [];
  const data = { window: { since: sinceIso, end: endIso, coverage_start: covStart }, cohorts: { completed: completed.length, created: all.filter((i) => inWin(i.created_at, sinceIso, endIso)).length,
    excluded_items: { invalid_chain: all.filter((i) => i.flags.includes('invalid-chain')).length, deferred_episode: all.filter((i) => i.flags.includes('deferred-episode')).length } },
    flow: {}, throughput: {}, wip: {}, mission_turnaround: { pairs: [], stats: null }, estimates: {}, estimate_rows: [], schedule_variance: [], coverage: {}, rework_proxy_items: completed.filter((i) => i.rework_count > 0).length, caveats };
  const weeks = weekKeys(sinceIso, endIso, covStart);
  for (const level of LEVELS) {
    const lvAll = all.filter((i) => i.level === level); if (!lvAll.length) continue;
    const done = completed.filter((i) => i.level === level);
    const measurable = done.filter((i) => !excludedItem(i));
    const ex = { clock_skew_cycle: 0, clock_skew_commit: 0, clock_skew_lead: 0, retrospective_plan_proxy: 0, missing_start: 0 };
    const strata = {}; const bucket = (cls) => (strata[cls] ??= { cycle_time: [], commit_to_done: [], lead_time: [], parent_elapsed: [] });
    const actualOf = new Map();
    for (const i of measurable) {
      const targets = [bucket('all'), ...(i.class ? [bucket(i.class)] : [])];
      if (i.started_at) {
        const s = secondsBetween(i.started_at, i.done_at);
        if (s < 0) ex.clock_skew_cycle++; else if (i.start_basis === 'observed') { targets.forEach((t) => t.cycle_time.push(s)); actualOf.set(i.item_id, { s, basis: 'observed' }); }
        else { targets.forEach((t) => t.parent_elapsed.push(s)); actualOf.set(i.item_id, { s, basis: 'derived-child' }); }
        if (s < 0) actualOf.set(i.item_id, { skew: true });
      } else if (i.first_commit_at) { const s = secondsBetween(i.first_commit_at, i.done_at); if (s < 0) ex.clock_skew_commit++; else targets.forEach((t) => t.commit_to_done.push(s)); }
      else ex.missing_start++;
      if (i.created_at) {
        const s = secondsBetween(i.created_at, i.done_at);
        if (s < 0) ex.clock_skew_lead++;
        else if (i.created_basis === 'plan-commit' && i.created_sha && i.created_sha === i.done_sha && s <= zero) ex.retrospective_plan_proxy++;
        else targets.forEach((t) => t.lead_time.push(s));
      }
    }
    data.flow[level] = { strata: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([m, arr]) => [m, stats(arr)]))])), excluded: ex,
      quality: { reviewed: null, eligible: null, done: done.length, unknown: done.length } };
    const counts = weeks.map((w) => ({ key: w.key, count: done.filter((i) => i.done_at >= w.start && i.done_at < w.end).length, whole: w.whole, covered: w.covered }));
    const whole = counts.filter((w) => w.whole).map((w) => w.count); let velocity = null, caveat = null;
    if (whole.length >= minWeeks) velocity = { median: nearestRank([...whole].sort((a, b) => a - b), 0.5), mean: Math.round((whole.reduce((a, b) => a + b, 0) / whole.length) * 100) / 100, whole_weeks: whole.length };
    else { caveat = `velocity(${level}): ${whole.length} whole weeks < ${minWeeks} — null`; caveats.push(caveat); }
    data.throughput[level] = { weeks: counts, velocity, caveat };
    data.wip[level] = lvAll.filter((i) => i.state === 'in_progress' && !i.cancelled_in_plan).length;
    const est = {}; const eb = (k) => (est[k] ??= emptyEst());
    for (const i of done) {
      const keys = ['all', ...(i.class ? [i.class] : [])];
      const chosen = estimateBase === 'latest' ? i.estimate_latest : i.estimate_original;
      const tier = chosen?.tier ?? i.estimates[0]?.estimate?.tier ?? null; if (tier) keys.push(`tier:${tier}`);
      const bs = keys.map(eb);
      if (i.estimates.length) bs.forEach((b) => b.n++);
      let reason = null; const a = actualOf.get(i.item_id);
      if (excludedItem(i)) reason = 'excluded_item';
      else if (!i.estimates.length) reason = 'unestimated';
      else if (!i.estimate_original) reason = 'unaccepted';
      else if (!chosen) reason = 'no_eligible_latest';
      else if (chosen.unit !== 'h') reason = 'unit_mismatch';
      else if (a?.skew) reason = 'clock_skew';
      else if (!a) reason = 'missing_actual';
      else if (chosen.accepted_at && new Date(chosen.accepted_at).toISOString() >= i.started_at) reason = 'late_accepted';
      if (reason) { bs.forEach((b) => b.excluded[reason]++); if (reason !== 'unestimated') data.estimate_rows.push({ item_id: i.item_id, ref: i.ref, level, class: i.class, tier, base: estimateBase, estimate: chosen ? { unit: chosen.unit, low: chosen.low, high: chosen.high } : null, actual_s: a?.s ?? null, actual_basis: a?.basis ?? null, ratio: null, hit: null, reason }); continue; }
      const mid = (chosen.low + chosen.high) / 2, actualH = a.s / 3600, ae = Math.abs(a.s - mid * 3600);
      let ratio = null, hit = null;
      bs.forEach((b) => { b.eligible++; b._aes.push(ae); });
      if (mid === 0) bs.forEach((b) => b.excluded.zero_midpoint++); else { ratio = Math.round((actualH / mid) * 10000) / 10000; bs.forEach((b) => b._ratios.push(actualH / mid)); }
      if (a.s === 0) bs.forEach((b) => b.excluded.zero_actual++); else bs.forEach((b) => b._mres.push(Math.abs(actualH - mid) / actualH));
      if (chosen.low === chosen.high) bs.forEach((b) => b.excluded.point++); else { hit = actualH >= chosen.low && actualH <= chosen.high; bs.forEach((b) => { b.hit_rate.ranged++; if (hit) b.hit_rate.hits++; }); }
      data.estimate_rows.push({ item_id: i.item_id, ref: i.ref, level, class: i.class, tier, base: estimateBase, estimate: { unit: chosen.unit, low: chosen.low, high: chosen.high }, actual_s: a.s, actual_basis: a.basis, ratio, hit, reason: null });
      if (level !== 'task') data.schedule_variance.push({ item_id: i.item_id, ref: i.ref, level, estimate: { low: chosen.low, high: chosen.high }, actual_s: a.s, band: { vs_high_s: a.s - chosen.high * 3600, vs_low_s: a.s - chosen.low * 3600 },
        scope: { added: i.children.map((c) => items.get(c)).filter((c) => c && c.version_added > 1).length, removed: i.children.map((c) => items.get(c)).filter((c) => c && c.cancelled_in_plan).length } });
    }
    data.estimates[level] = { strata: Object.fromEntries(Object.entries(est).map(([k, v]) => [k, finishEst(v)])) };
    const src = (field) => done.reduce((m, i) => { const s = i[field]; if (s) m[s] = (m[s] ?? 0) + 1; return m; }, {});
    data.coverage[level] = { done: done.length, with_dispatched: done.filter((i) => i.start_basis === 'observed').length, with_first_commit: done.filter((i) => i.first_commit_at).length, with_created: done.filter((i) => i.created_at).length,
      start_source: { observed: done.filter((i) => i.start_basis === 'observed').length, 'derived-child': done.filter((i) => i.start_basis === 'derived-child').length, none: done.filter((i) => !i.started_at).length },
      sources: { created: src('created_basis'), done: src('done_basis') } };
    if (done.length && level === 'task' && data.coverage[level].with_dispatched === 0) caveats.push(`${level}: no observed dispatch start — cycle_time absent, commit_to_done shown instead`);
  }
  const missions = all.filter((i) => i.level === 'mission' && i.sequence != null).sort((a, b) => a.sequence - b.sequence); const gaps = [];
  for (let k = 1; k < missions.length; k++) {
    const a = missions[k - 1], b = missions[k]; if (!b.started_at) continue;
    if (a.done_at && a.done_at <= b.started_at) { const g = secondsBetween(a.done_at, b.started_at); gaps.push(g); data.mission_turnaround.pairs.push({ from: a.ref, to: b.ref, gap_s: g, overlap_s: null }); }
    else data.mission_turnaround.pairs.push({ from: a.ref, to: b.ref, gap_s: null, overlap_s: a.done_at ? secondsBetween(b.started_at, a.done_at) : null });
  }
  data.mission_turnaround.stats = stats(gaps);
  return data;
}
```
The `n` counter in a stratum counts items carrying any estimate revision; `excluded.unestimated` counts items with none (those get no row). For the fixture that gives `n = 5` (t1, t2, t3, t5, t8) and `unestimated = 2` (t4, t7).

- [ ] **Step 4: Run test to verify it passes** — 4 passing. Hand checks before touching a test: `m1` = Mon 7th 09:00 → Wed 9th 17:00 = 56 h → ratio 1.12, band `[-4h, +16h]`; `t8` 15 s vs midpoint 0.005 h = 18 s → ratio 0.8333, MRE 0.2; MdMRE over `[0.2, 0]` sorted `[0, 0.2]` nearest-rank 0.5 → index `ceil(1)-1 = 0` → 0; MAE `(3 + 0)/2 = 1.5 s`.

- [ ] **Step 5: Commit**
```bash
git add skills/delivery-metrics/scripts/lib/metrics.mjs skills/delivery-metrics/scripts/lib/metrics.test.mjs
git commit -m "feat(delivery-metrics): metrics in seconds — per-clock validity, coverage-aware weeks, per-stratum estimate accuracy with item rows"
```

---

### Task 8: `lib/report.mjs` + `report` / `status` commands

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/report.mjs`, `skills/delivery-metrics/scripts/lib/report.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (add `report`, `status`), `skills/delivery-metrics/scripts/delivery.test.mjs` (one test)

**Interfaces:**
- Consumes: `events.mjs` (`resolveObservations`), `timeline.mjs`, `metrics.mjs`, `plan.mjs` (`listRuns`, `loadRun`), `paths.mjs`, `git.mjs` (`gitState`, `git`).
- Produces:
  - `SCHEMA = {report: 1, ledger: 2, adapters: {git: 1, hook: 1}}`; `UNCONDITIONAL_CAVEATS` = the eight strings from Global Constraint 12.
  - `loadProfile(repo) → {profile, sha256|null, source: 'file'|'template-default'}`.
  - `assemble(repo, {plans, since, until, cutoff, now, estimateBase, filters}) → doc`: `doc = {envelope, plans: [{run, version, status, observations, metrics, counts, items}]}`. Window: `cutoff` default `now`; `until` default `cutoff`; `end = min(until, cutoff)`; `since` default = earliest `observation_start` of the selected runs, **normalised** to canonical ISO; `since ≥ end` → `USAGE(since must precede end)`. Reads the ledger **once** (`resolveObservations`), runs `selectOccurrences(active, conflicts)` once, then per run: `buildTimelines` + `computeMetrics(filters)`. `unregistered` = occurrences whose `plan` has no run file or whose `item_id` is not in the run's catalogue (counted **before** per-run filtering). `registration_gaps` per run = catalogue items with no `created` occurrence. Envelope: `{schema: SCHEMA, generated_at, cutoff, window: {since, until, effective_end, requested}, git: {sha, is_working_tree}, plans: [run ids], sources: {events_files: [{path, sha256, bytes}], plans: [{run, path, file_sha256, canonical_sha256}], profile: {path, sha256, source}, tokenomics: 'absent'}, policy: {weeks: 'UTC ISO', percentile: 'nearest-rank', floors: {median: 5, p85: 7, p90: 10}, zeroDurationSec, minWholeWeeks, estimate_base, history: 'corrected-effective-time', durations: 'seconds; hours rounded at render'}, coverage: {malformed_lines, malformed: [{path, line, reason}], unknown_version, retries, superseded, retracted, ledger_conflicts, occurrence_conflicts, conflict_list, unregistered, registration_gaps, deferred_events, deferred_episodes, invalid_chains, parent_incomplete, awaiting_landing}, caveats: [...UNCONDITIONAL_CAVEATS, ...derived], baselines}`. `NO-EVENTS` when zero occurrences have `at < end` across the selected runs (the doc is still assembled with zero cohorts when there are such occurrences but none in `[since, end)`).
  - `renderMarkdown(doc)`, `renderStatus(doc)` — rounding (`toHours`) happens here only. Markdown sections: header line; **Flow Time** table per level and stratum (`metric | stratum | n | median | P85 | P90 | min–max`), the `excluded` counters and the quality line `quality: reviewed=unknown eligible=unknown done=<n>` under each level; **Throughput** (weekly series with `*` partial / `†` uncovered, velocity or its caveat, wip, mission_turnaround); **Quality** (`cancelled_share`, `rework_proxy_items`, `deferred-episodes`, review rounds `unknown (M2)`); **Estimates** — aggregate table per level/stratum, then the **per-item rows** table (`ref | level | class | tier | base | range | actual | basis | ratio | hit | reason`), then schedule variance lines `actual <h> vs [low, high] → [vs_high, vs_low]`; **Coverage & caveats** (coverage per level, sources, `registration_gaps`, `unregistered`, `malformed-lines`, conflicts with paths, every caveat); **Open items**. Every `null` renders as `—` with its reason; no `mean` headline.
  - CLI: `report [--plan <run>…] [--since] [--until] [--cutoff] [--level] [--class] [--json] [--out <f>] [--latest-estimate]`; `--html`, `--calibrate`, `--from-json` → `USAGE(<flag> is not in M1)`; `status [--plan <run>]`.

- [ ] **Step 1: Write the failing tests**

`skills/delivery-metrics/scripts/lib/report.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendObservation, makeObservation } from './events.mjs';
import { saveRun } from './plan.mjs';
import { deliveryDir, eventsPath } from './paths.mjs';
import { assemble, renderMarkdown, renderStatus, loadProfile, UNCONDITIONAL_CAVEATS } from './report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-report-'));
const R = 'sec/run-1';
const seed = (repo) => {
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-07T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
    { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' }, { item_id: `${R}/task-b`, ref: 'TASK-B', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' }, { item_id: `${R}/task-z`, ref: 'TASK-Z', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' }] });
  const o = (id, ref, level, event, at, over = {}) => appendObservation(repo, makeObservation({ user: 'u', host: over.source === 'hook' ? 'claude' : 'cli', plan: R, item_id: `${R}/${id}`, ref, level, event, at, transition_id: `${R}/${id}/${event}/${over.t ?? 'episode-1'}`, source: over.source ?? 'cli', source_record_id: `${event}-${id}`, meta: { version: 1, ...(over.meta ?? {}) } }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-a', 'TASK-A', 'task', 'created', '2026-09-07T09:00:00Z'); o('task-b', 'TASK-B', 'task', 'created', '2026-09-07T09:00:00Z');
  o('task-a', 'TASK-A', 'task', 'dispatched', '2026-09-09T09:00:00Z', { source: 'hook', t: 'agent-1' }); o('task-a', 'TASK-A', 'task', 'done', '2026-09-09T11:00:00Z');
  o('task-b', 'TASK-B', 'task', 'dispatched', '2026-09-10T09:00:00Z', { source: 'hook', t: 'agent-2' });
  // an observation for an item no run knows
  appendFileSync(eventsPath(repo, 'u'), `${JSON.stringify(makeObservation({ user: 'u', host: 'cli', plan: 'ghost/run-9', item_id: 'ghost/run-9/task-x', ref: 'X', level: 'task', event: 'done', at: '2026-09-09T00:00:00Z', transition_id: 'ghost/run-9/task-x/done/episode-1', source: 'cli', source_record_id: 'g1', meta: { version: 1 } }, { now: 0 }))}\n`);
};
const NOW = Date.parse('2026-09-21T00:00:00Z');

test('historical registration alone supplies per-item creation cohorts and lead time', async () => {
  const { execFileSync } = await import('node:child_process');
  const { main } = await import('../delivery.mjs');
  const repo = tmp();
  const g = (args, at = '2026-09-10T08:00:00Z') => execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } });
  g(['init', '-q', '-b', 'main']);
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-09-01T00:00:00Z', source_epoch: { from: '2026-09-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001' }] }] };
  const commit = (at) => { writeFileSync(join(repo, 'plan.json'), JSON.stringify(block)); g(['add', 'plan.json']); g(['commit', '-q', '-m', 'plan'], at); };
  commit('2026-09-10T08:00:00Z'); block.missions[0].tasks.push({ ref: 'TASK-002' }); commit('2026-09-12T08:00:00Z');
  const io = { write() {} }, now = Date.parse('2026-09-18T12:00:00Z');
  const call = (args) => main(args, { repo, now, stdout: io, stderr: io, env: { DELIVERY_NO_SYNC: '1' } });
  assert.equal(await call(['plan', 'register', '--from', 'plan.json', '--id', 'reg']), 0);
  for (const ref of ['TASK-001', 'TASK-002']) assert.equal(await call(['event', ref, 'done', '--id', ref, '--at', '2026-09-16T10:00:00Z']), 0);
  const d = assemble(repo, { since: '2026-09-10T00:00:00Z', cutoff: '2026-09-17T00:00:00Z', now, filters: { level: 'task' } });
  assert.equal(d.plans[0].metrics.flow.task.strata.all.lead_time.min, 98 * 3600);
  assert.equal(d.plans[0].metrics.flow.task.strata.all.lead_time.max, 146 * 3600);
  const creation = assemble(repo, { since: '2026-09-10T00:00:00Z', cutoff: '2026-09-11T00:00:00Z', now, filters: { level: 'task' } });
  assert.equal(creation.plans[0].metrics.cohorts.created, 1);
});

test('assemble: window defaults normalised, read-once provenance, coverage counts (unregistered, registration gaps), unconditional caveats', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  const e = doc.envelope;
  assert.equal(e.window.since, '2026-09-07T00:00:00.000Z'); assert.equal(e.window.effective_end, '2026-09-21T00:00:00.000Z');
  assert.equal(e.sources.events_files.length, 1); assert.match(e.sources.events_files[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(e.sources.plans[0].file_sha256, /^[0-9a-f]{64}$/); assert.equal(e.sources.plans[0].canonical_sha256, 'c'.repeat(64)); assert.equal(e.sources.profile.source, 'template-default');
  assert.equal(e.schema.ledger, 2); assert.equal(e.policy.durations, 'seconds; hours rounded at render');
  assert.equal(e.coverage.unregistered, 1); assert.equal(e.coverage.registration_gaps, 3, 'campaign, G1, TASK-Z have no created');
  for (const c of UNCONDITIONAL_CAVEATS) assert.ok(e.caveats.includes(c), c);
  const m = doc.plans[0].metrics;
  assert.deepEqual(m.flow.task.strata.all.cycle_time.samples, [7200]); assert.equal(m.wip.task, 1);
  assert.equal(doc.plans[0].items.find((i) => i.ref === 'TASK-B').state, 'in_progress');
  assert.throws(() => assemble(repo, { now: NOW, since: '2026-09-22T00:00:00Z' }), (x) => x.code === 'USAGE');
  assert.throws(() => assemble(repo, { now: NOW, plans: ['nope/x'] }), (x) => x.code === 'NO-PLAN');
  assert.throws(() => assemble(repo, { now: Date.parse('2026-09-01T00:00:00Z'), until: '2026-09-02T00:00:00Z', since: '2026-08-01T00:00:00Z' }), (x) => x.code === 'NO-EVENTS', 'no observations before the effective end');
  assert.equal(assemble(repo, { now: NOW, since: '2026-09-15T00:00:00Z' }).plans[0].metrics.cohorts.completed, 0, 'events exist but none in the window → measurable zero');
});

test('renderMarkdown: sections, n beside figures, strata, per-item estimate rows, em-dash reasons, no byPerson/mean headline', () => {
  const repo = tmp(); seed(repo);
  const md = renderMarkdown(assemble(repo, { now: NOW }));
  for (const h of ['## Flow Time', '## Throughput', '## Quality', '## Estimates', '## Coverage & caveats', '## Open items']) assert.ok(md.includes(h), h);
  assert.match(md, /cycle_time \| all \| n=1 \| — \(n<5\)/); assert.match(md, /cycle_time \| S \| n=1/);
  assert.match(md, /velocity[^\n]*— \(2 whole weeks < 3\)/); assert.match(md, /quality: reviewed=unknown eligible=unknown done=1/);
  assert.match(md, /registration_gaps=3/); assert.match(md, /unregistered=1/);
  assert.ok(!/byPerson/i.test(md)); assert.ok(!/^\|\s*mean/m.test(md)); assert.match(md, /no baseline/); assert.match(md, /acceptance: unauthenticated/);
});

test('renderStatus: one-screen counts and open ages (255 h); loadProfile merges template', () => {
  const repo = tmp(); seed(repo);
  const s = renderStatus(assemble(repo, { now: NOW }));
  assert.match(s, /STATUS sec\/run-1 v1/); assert.match(s, /task: done=1 in_progress=1 planned=1 cancelled=0/); assert.match(s, /TASK-B[^\n]*age=255h/);
  assert.equal(loadProfile(repo).profile.minWholeWeeks, 3);
  mkdirSync(deliveryDir(repo), { recursive: true });
});
```
Age check: TASK-B started Thu 10th 09:00 → end Mon 21st 00:00 = 10 d 15 h = 255 h.

Add to `delivery.test.mjs`:
```js
test('report/status commands: markdown, --json, --out, --level/--class filters, M4 flags refused, NO-PLAN exit 3', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  run(repo, ['event', 'TASK-001', 'dispatched', '--at', '2026-09-16T09:00:00Z', '--id', 'd1']); run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'd2']);
  const md = run(repo, ['report', '--cutoff', '2026-09-21T00:00:00Z']); assert.equal(md.code, 0, md.stderr); assert.match(md.stdout, /## Flow Time/);
  const js = run(repo, ['report', '--json', '--cutoff', '2026-09-21T00:00:00Z', '--out', join(repo, 'r.json')]); assert.match(js.stdout, /^REPORT /);
  const doc = JSON.parse(readFileSync(join(repo, 'r.json'), 'utf8')); assert.equal(doc.plans[0].metrics.flow.task.strata.all.cycle_time.samples[0], 7200);
  assert.equal(JSON.parse(run(repo, ['report', '--json', '--cutoff', '2026-09-21T00:00:00Z', '--class', 'M']).stdout).plans[0].metrics.coverage.task?.done ?? 0, 0);
  for (const flag of ['--from-json', '--html', '--calibrate']) assert.match(run(repo, ['report', flag, 'x']).stderr, /is not in M1/);
  assert.match(run(repo, ['status']).stdout, /STATUS sec\/run-1 v1/);
  assert.equal(run(initRepo(), ['report']).code, 3);
});
```

Historical-registration arithmetic: Sep 10 08:00 → Sep 16 10:00 = 6 × 24 + 2 = 146 h = 525,600 s; Sep 12 08:00 → Sep 16 10:00 = 4 × 24 + 2 = 98 h = 352,800 s. Exactly TASK-001 is created in [Sep 10 00:00, Sep 11 00:00); registration on Sep 18 does not move either clock. No backfill command is called.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Write `report.mjs`**

```js
// STDLIB ONLY. Assemble (read once, hash what was read) + render (spec §6.11). Rounding lives here only.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveObservations } from './events.mjs';
import { git } from './git.mjs';
import { computeMetrics, toHours } from './metrics.mjs';
import { listRuns, loadRun } from './plan.mjs';
import { cliError, nowIso, profilePath, runPath, sha256, resolveOwnerRepo } from './paths.mjs';
import { buildTimelines, selectOccurrences } from './timeline.mjs';

export const SCHEMA = { report: 1, ledger: 2, adapters: { git: 1, hook: 1 } };
export const UNCONDITIONAL_CAVEATS = ['acceptance: unauthenticated', 'writes: non-transactional', 'partial-update: possible', 'capture-loss: possible', 'shared-files: last-writer-wins', 'sync: best-effort', 'concurrency: best-effort', 'hook-transcript-shapes: provisional until SPIKE-1'];
const TEMPLATE = resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'templates', 'profile.template.json');

export function loadProfile(repo) {
  const tpl = JSON.parse(readFileSync(TEMPLATE, 'utf8')); const p = profilePath(repo);
  if (!existsSync(p)) return { profile: tpl, sha256: null, source: 'template-default' };
  const buf = readFileSync(p);
  try { return { profile: { ...tpl, ...JSON.parse(buf.toString('utf8')) }, sha256: sha256(buf), source: 'file' }; } catch { return { profile: tpl, sha256: sha256(buf), source: 'template-default (profile.json malformed)' }; }
}
const compact = (i) => ({ first_completion: i.first_completion, current_scope: i.current_scope, item_id: i.item_id, ref: i.ref, level: i.level, class: i.class, state: i.state, created_at: i.created_at, started_at: i.started_at, start_basis: i.start_basis, first_commit_at: i.first_commit_at, done_at: i.done_at, done_basis: i.done_basis, landing_at: i.landing_at, cancelled_at: i.cancelled_at, dispatch_count: i.dispatch_count, rework_count: i.rework_count, reopened: i.reopened, estimate: i.estimate_original, flags: i.flags });

export function assemble(repo, { plans = null, since = null, until = null, cutoff = null, now = Date.now(), estimateBase = 'original', filters = {} } = {}) {
  repo = resolveOwnerRepo(repo);
  const runs = plans ? plans.map((id) => { const r = loadRun(repo, id); if (!r) throw cliError('NO-PLAN', `no registered run ${id}`); return r; }) : listRuns(repo);
  if (!runs.length) throw cliError('NO-PLAN', 'no registered plan in this repo');
  const iso = (v, name) => { if (v == null) return null; if (Number.isNaN(Date.parse(v))) throw cliError('USAGE', `invalid ${name} ${v}`); return new Date(v).toISOString(); };
  const cutoffIso = iso(cutoff, '--cutoff') ?? nowIso(now), untilIso = iso(until, '--until') ?? cutoffIso, end = untilIso < cutoffIso ? untilIso : cutoffIso;
  const sinceIso = iso(since, '--since') ?? iso(runs.map((r) => r.observation_start).filter(Boolean).sort()[0] ?? '1970-01-01T00:00:00Z', 'observation_start');
  if (sinceIso >= end) throw cliError('USAGE', `since ${sinceIso} must precede end ${end}`);
  const { profile, sha256: profileSha, source: profileSource } = loadProfile(repo);
  const res = resolveObservations(repo);
  const { occurrences, conflicts } = selectOccurrences(res.active, res.conflicts);
  const known = new Map(runs.map((r) => [r.run, new Set(r.items.map((i) => i.item_id))]));
  const unregistered = occurrences.filter((o) => !known.has(o.plan) || (o.item_id != null && !known.get(o.plan).has(o.item_id))).length;
  if (!occurrences.some((o) => runs.some((r) => r.run === o.plan) && o.at < end)) throw cliError('NO-EVENTS', `no observations before ${end} for ${runs.map((r) => r.run).join(',')}`);
  const cov = { deferred_events: 0, deferred_episodes: 0, invalid_chains: 0, parent_incomplete: 0, awaiting_landing: 0 }; let gaps = 0; const docs = [];
  for (const r of runs) {
    const occ = occurrences.filter((o) => o.plan === r.run && known.get(r.run).has(o.item_id));
    const { items, counts } = buildTimelines({ occurrences: occ, plan: r, end });
    cov.deferred_events += counts.deferredEvents; cov.deferred_episodes += counts.deferredEpisodes; cov.invalid_chains += counts.invalidChains; cov.parent_incomplete += counts.parentIncomplete; cov.awaiting_landing += counts.awaitingLanding;
    const g = [...items.values()].filter((i) => !i.created_at).length; gaps += g;
    docs.push({ run: r.run, version: r.version, status: r.status, observations: occ.length, registration_gaps: g, metrics: computeMetrics({ items, plan: r, since: sinceIso, end, profile, estimateBase, filters }), counts, items: [...items.values()].map(compact) });
  }
  const pending = docs.flatMap((d) => d.items).filter((i) => i.first_completion && i.current_scope?.pending).length;
  const derived = docs.flatMap((d) => d.metrics.caveats.map((c) => `${d.run}: ${c}`));
  if (pending) derived.push(`${pending} parent(s): first delivery retained; current scope pending (see current_scope, WIP and status)`);
  if (res.counts.malformed) derived.push(`${res.counts.malformed} malformed ledger line(s) skipped — capture loss possible`);
  if (res.conflicts.length) derived.push(`${res.conflicts.length} ledger observation(s) in CONFLICT (same revision, different content) — excluded, no fallback`);
  if (conflicts.length) derived.push(`${conflicts.length} occurrence(s) quarantined (equal-rank disagreement or ledger conflict) — no lower-source fallback`);
  if (unregistered) derived.push(`${unregistered} observation(s) for unregistered items — excluded`);
  if (gaps) derived.push(`${gaps} registered item(s) without a created observation (registration-gaps)`);
  if (cov.parent_incomplete) derived.push(`${cov.parent_incomplete} explicit parent completion(s) with unfinished children (PARENT-INCOMPLETE)`);
  if (cov.awaiting_landing) derived.push(`${cov.awaiting_landing} mission(s) with all children terminal but no landing evidence`);
  const sha = git(repo, ['rev-parse', 'HEAD']);
  const envelope = {
    schema: SCHEMA, generated_at: nowIso(now), cutoff: cutoffIso, window: { since: sinceIso, until: untilIso, effective_end: end, requested: { since, until, cutoff } },
    git: { sha, is_working_tree: sha ? Boolean(git(repo, ['status', '--porcelain'])) : null }, plans: runs.map((r) => r.run),
    sources: { events_files: res.files, plans: runs.map((r) => ({ run: r.run, path: runPath(repo, r.run), file_sha256: existsSync(runPath(repo, r.run)) ? sha256(readFileSync(runPath(repo, r.run))) : null, canonical_sha256: r.canonical_sha256 ?? null })), profile: { path: profilePath(repo), sha256: profileSha, source: profileSource }, tokenomics: 'absent' },
    policy: { weeks: 'UTC ISO', percentile: 'nearest-rank', floors: { median: 5, p85: 7, p90: 10 }, zeroDurationSec: profile.zeroDurationSec, minWholeWeeks: profile.minWholeWeeks, estimate_base: estimateBase, history: 'corrected-effective-time', durations: 'seconds; hours rounded at render', filters },
    coverage: { malformed_lines: res.counts.malformed, malformed: res.malformed, unknown_version: res.counts.unknownVersion, retries: res.counts.retries, superseded: res.counts.superseded, retracted: res.counts.retracted, ledger_conflicts: res.conflicts.length, occurrence_conflicts: conflicts.length, conflict_list: conflicts, unregistered, registration_gaps: gaps, ...cov },
    caveats: [...UNCONDITIONAL_CAVEATS, ...derived], baselines: profile.baselines ?? {},
  };
  return { envelope, plans: docs };
}

const h = (s) => (s == null ? '—' : `${toHours(s)}h`);
const statRow = (name, stratum, s) => (s ? `| ${name} | ${stratum} | n=${s.n} | ${s.median == null ? '— (n<5)' : h(s.median)} | ${s.p85 == null ? '— (n<7)' : h(s.p85)} | ${s.p90 == null ? '— (n<10)' : h(s.p90)} | ${h(s.min)}–${h(s.max)}${s.samples ? ` (${s.samples.map(h).join(', ')})` : ''} |` : null);

export function renderMarkdown(doc) {
  const e = doc.envelope; const L = [];
  L.push('# Delivery report', '', `generated ${e.generated_at} · cutoff ${e.cutoff} · window [${e.window.since}, ${e.window.effective_end}) · sha ${e.git.sha ?? '—'}${e.git.is_working_tree ? ' (dirty)' : ''} · plans ${e.plans.join(', ')}${e.policy.filters?.level || e.policy.filters?.class ? ` · filters ${JSON.stringify(e.policy.filters)}` : ''}`, '');
  for (const p of doc.plans) {
    const m = p.metrics;
    L.push(`## Plan ${p.run} v${p.version} (${p.status}) — completed ${m.cohorts.completed}, created ${m.cohorts.created}, excluded items invalid-chain=${m.cohorts.excluded_items.invalid_chain} deferred-episode=${m.cohorts.excluded_items.deferred_episode}`, '');
    L.push('## Flow Time', '', '| metric | stratum | n | median | P85 | P90 | min–max |', '|---|---|---|---|---|---|---|');
    for (const [lv, f] of Object.entries(m.flow)) {
      for (const [st, mm] of Object.entries(f.strata)) for (const [name, s] of Object.entries(mm)) { const row = statRow(`${lv} ${name}`, st, s); if (row) L.push(row); }
      if (!Object.keys(f.strata).length) L.push(`| ${lv} cycle_time | all | — (not measured) | | | | |`);
      const ex = Object.entries(f.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' '); if (ex) L.push(`| ${lv} excluded | | ${ex} | | | | |`);
      L.push(`| ${lv} quality | | quality: reviewed=unknown eligible=unknown done=${f.quality.done} | | | | |`);
    }
    L.push('', '## Throughput', '');
    for (const [lv, t] of Object.entries(m.throughput)) {
      L.push(`- ${lv} per UTC ISO week: ${t.weeks.map((w) => `${w.key}=${w.count}${!w.covered ? '†' : (!w.whole ? '*' : '')}`).join(' ')} (*partial, †before declared coverage)`);
      L.push(`- ${lv} velocity (median items per whole covered week): ${t.velocity ? `${t.velocity.median} (n=${t.velocity.whole_weeks} whole weeks)` : `— (${t.caveat.replace(/^velocity\([a-z]+\): /, '').replace(' — null', '')})`}`);
      L.push(`- ${lv} wip at end: ${m.wip[lv]}`);
    }
    if (m.mission_turnaround.pairs.length) L.push(`- mission_turnaround: ${m.mission_turnaround.pairs.map((x) => `${x.from}→${x.to} ${x.gap_s != null ? h(x.gap_s) : `overlap ${h(x.overlap_s)}`}`).join('; ')}`);
    L.push('', '## Quality', '');
    for (const lv of Object.keys(m.flow)) { const rows = p.items.filter((i) => i.level === lv); L.push(`- ${lv}: cancelled_share ${rows.filter((i) => i.state === 'cancelled').length}/${rows.length}, rework_proxy_items ${lv === 'task' ? m.rework_proxy_items : '—'}, deferred-episodes ${rows.filter((i) => i.reopened).length}, review rounds unknown (M2)`); }
    L.push('', '## Estimates', '', '| level | stratum | n | eligible | work_ratio median | MdMRE | PRED(25) | MAE | hit_rate | excluded |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [lv, es] of Object.entries(m.estimates)) for (const [st, x] of Object.entries(es.strata)) {
      const ex = Object.entries(x.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '—';
      L.push(`| ${lv} | ${st} | ${x.n} | ${x.eligible} | ${x.work_ratio ? (x.work_ratio.median ?? `— (n<5; ${x.work_ratio.samples.map((v) => Math.round(v * 100) / 100).join(', ')})`) : '—'} | ${x.mdmre ?? '—'} | ${x.pred25 ?? '—'} | ${x.mae_s == null ? '—' : h(x.mae_s)} | ${x.hit_rate.rate == null ? '—' : `${x.hit_rate.hits}/${x.hit_rate.ranged}`} | ${ex} |`);
    }
    if (m.estimate_rows.length) { L.push('', '| ref | level | class | tier | base | range (h) | actual | basis | ratio | hit | reason |', '|---|---|---|---|---|---|---|---|---|---|---|'); for (const r of m.estimate_rows) L.push(`| ${r.ref} | ${r.level} | ${r.class ?? '—'} | ${r.tier ?? '—'} | ${r.base} | ${r.estimate ? `[${r.estimate.low}, ${r.estimate.high}]` : '—'} | ${h(r.actual_s)} | ${r.actual_basis ?? '—'} | ${r.ratio ?? '—'} | ${r.hit == null ? '—' : r.hit ? 'yes' : 'no'} | ${r.reason ?? '—'} |`); }
    for (const sv of m.schedule_variance) L.push(`- schedule_variance ${sv.level} ${sv.ref}: actual ${h(sv.actual_s)} vs [${sv.estimate.low}, ${sv.estimate.high}] → [${toHours(sv.band.vs_high_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_high_s)}h, ${toHours(sv.band.vs_low_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_low_s)}h]; scope added ${sv.scope.added}, removed ${sv.scope.removed}`);
    L.push('', '## Coverage & caveats', '');
    for (const [lv, c] of Object.entries(m.coverage)) L.push(`- ${lv}: done ${c.done}, observed dispatch ${c.with_dispatched}, first commit ${c.with_first_commit}, created ${c.with_created}; start observed=${c.start_source.observed} derived-child=${c.start_source['derived-child']} none=${c.start_source.none}; sources ${JSON.stringify(c.sources)}`);
    L.push(`- registration_gaps=${p.registration_gaps}`);
    L.push('', '## Open items', '', '| ref | level | state | started | age |', '|---|---|---|---|---|');
    for (const i of p.items.filter((i) => i.state === 'in_progress')) L.push(`| ${i.ref} | ${i.level} | ${i.state}${i.flags.length ? ` (${i.flags.join(', ')})` : ''} | ${i.started_at ?? '—'} | ${i.first_completion && i.current_scope?.pending ? '— (pending-scope age unavailable in M1)' : i.started_at ? `${toHours((Date.parse(e.window.effective_end) - Date.parse(i.started_at)) / 1000)}h` : '— (no observed start)'} |`);
    L.push('');
  }
  L.push('### Envelope', '', `- ledger: unregistered=${e.coverage.unregistered} malformed-lines=${e.coverage.malformed_lines} ledger_conflicts=${e.coverage.ledger_conflicts} occurrence_conflicts=${e.coverage.occurrence_conflicts} retries=${e.coverage.retries} retracted=${e.coverage.retracted} deferred_events=${e.coverage.deferred_events} invalid_chains=${e.coverage.invalid_chains}`);
  for (const c of e.coverage.conflict_list) L.push(`  - conflict ${c.item_id ?? '—'} ${c.transition_id} (${c.reason}): ${c.sources.join(', ')}`);
  for (const mm of e.coverage.malformed) L.push(`  - malformed ${mm.path}:${mm.line} ${mm.reason}`);
  L.push(`- baselines: ${Object.entries(e.baselines).map(([k, v]) => `${k}=${v ?? 'no baseline'}`).join(', ')}`);
  for (const c of e.caveats) L.push(`- caveat: ${c}`);
  L.push(`- policy: weeks ${e.policy.weeks}, percentiles ${e.policy.percentile} (floors median≥5 P85≥7 P90≥10), estimate base ${e.policy.estimate_base}, ${e.policy.durations}, tokenomics ${e.sources.tokenomics}, sources hashed as read`);
  return `${L.join('\n')}\n`;
}

export function renderStatus(doc) {
  const e = doc.envelope; const L = [];
  for (const p of doc.plans) {
    L.push(`STATUS ${p.run} v${p.version} (${p.status}) at ${e.window.effective_end}`);
    for (const lv of ['campaign', 'mission', 'task', 'case']) { const rows = p.items.filter((i) => i.level === lv); if (!rows.length) continue; const n = (s) => rows.filter((i) => i.state === s).length; L.push(`  ${lv}: done=${n('done')} in_progress=${n('in_progress')} planned=${n('planned')} cancelled=${n('cancelled')}`); }
    for (const i of p.items.filter((i) => i.first_completion && i.current_scope?.pending)) L.push(`  pending scope ${i.ref}: first_done=${i.first_completion.done_at}; current_done=unknown; pending-scope age unavailable (M1)`);
    for (const i of p.items.filter((i) => i.state === 'in_progress' && i.level !== 'campaign' && !i.first_completion)) L.push(`  open ${i.ref} (${i.level}${i.flags.length ? `, ${i.flags.join(', ')}` : ''}) started=${i.started_at ?? '—'} age=${i.started_at ? `${toHours((Date.parse(e.window.effective_end) - Date.parse(i.started_at)) / 1000)}h` : '—'}`);
    if (p.registration_gaps) L.push(`  registration_gaps=${p.registration_gaps} (items without a created observation)`);
    const fill = p.items.filter((i) => i.state === 'done' && i.level === 'task' && (!i.created_at || !i.first_commit_at)).length; if (fill) L.push(`  backfill --git could fill created/first_commit for ${fill} done task(s)`);
  }
  L.push(`  ledger: occurrence_conflicts=${e.coverage.occurrence_conflicts} ledger_conflicts=${e.coverage.ledger_conflicts} unregistered=${e.coverage.unregistered} malformed=${e.coverage.malformed_lines}`);
  for (const c of UNCONDITIONAL_CAVEATS) L.push(`  caveat: ${c}`);
  return `${L.join('\n')}\n`;
}
```

- [ ] **Step 4: Wire `report` and `status` into `delivery.mjs`**

```js
import { assemble, renderMarkdown, renderStatus } from './lib/report.mjs';
function cmdReport(repo, p, io, now) {
  const f = p.flags;
  for (const k of ['from-json', 'html', 'calibrate']) if (f[k]) throw cliError('USAGE', `--${k} is not in M1`);
  const doc = assemble(repo, { plans: f.plan ? String(f.plan).split(',') : null, since: f.since ?? null, until: f.until ?? null, cutoff: f.cutoff ?? null, now, estimateBase: f['latest-estimate'] ? 'latest' : 'original', filters: { level: f.level ?? null, class: f.class ?? null } });
  const text = f.json ? `${JSON.stringify(doc, null, 2)}\n` : renderMarkdown(doc);
  if (f.out) { writeFileSync(f.out, text); out(io, `REPORT ${f.out}`); } else io.stdout.write(text);
  return 0;
}
function cmdStatus(repo, p, io, now) { io.stdout.write(renderStatus(assemble(repo, { plans: p.flags.plan ? [p.flags.plan] : null, now }))); return 0; }
export const COMMANDS = { plan: cmdPlan, session: cmdSession, event: cmdEvent, profile: cmdProfile, report: cmdReport, status: cmdStatus };
```
(`filters.level`/`filters.class` with `null` values are treated as "no filter" — `computeMetrics` checks truthiness.)

- [ ] **Step 5: Run tests** — `node --test skills/delivery-metrics` → all green.

- [ ] **Step 6: Commit**
```bash
git add skills/delivery-metrics/scripts
git commit -m "feat(delivery-metrics): report (markdown/JSON) with read-once provenance, strata, item rows, unconditional caveats; status"
```

---

### Task 9: `lib/git-backfill.mjs` + `backfill --git`

**Files:**
- Create: `skills/delivery-metrics/scripts/lib/git-backfill.mjs`, `skills/delivery-metrics/scripts/lib/git-backfill.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (`backfill` command), `skills/delivery-metrics/scripts/delivery.test.mjs` (one CLI test)

**Interfaces:**
- Consumes: Task 5 shared `git.mjs` (`git`, `isAncestor`, `firstCommitContaining`); registration and backfill both call this resolver with a pinned full SHA, and neither imports the other CLI, `events.mjs` (`makeObservation`, `appendObservation`), `plan.mjs` (`loadRun`, `saveRun`).
- Produces:
  - `gitLog(repo, args) → [{sha, parents, at, subject}]`.
  - `matchMergeSubject(subject, run) → item|null` — `^merge\s+(\S+)`; the branch (case-insensitive) equals an item's `branch` alias, else `task/task-(\d+)` → the item with `ref === 'TASK-' + n`.
  - `deriveGitObservations({repo, run, head, since, cutoff, now}) → {records, notes, skippedOutsideEpoch, head}` (spec §6.7, local mode):
    - **Head validation:** `head` must be reachable from `source_epoch.integration_ref` (`isAncestor(head, integration_ref) === true` or `head` resolves to the ref's tip); otherwise `USAGE(head <sha> is not on integration ref <ref>)`. When the ref does not resolve (e.g. a bare temp repo with only `main`), it is compared against `refs/heads/<ref>` and, failing that, the note `integration ref <ref> not found — head accepted unverified` is emitted and every derived line carries `meta.head_unverified: true`.
    - **Epoch first:** every candidate commit is filtered by `[source_epoch.from, until)`, `since`, `cutoff` **before** any "first"/"earliest" selection, so an earlier run's commits never shadow this run's.
    - `created` — `firstCommitContaining(repo, head, run.source.rel, item.ref)` per task (basis `plan-commit`, `meta.git_sha`); note when the run has no `source.rel`.
    - `first_commit` — earliest in-epoch non-merge commit reachable from `head` with subject `^<ref>:` (`git log --no-merges --reverse`).
    - `rework_observed` — every in-epoch commit with subject `^<ref>: address review( (\d+))?` → `transition_id <item>/rework_observed/<N or 'x'+short sha>`, `meta.round` (`null` when unnumbered), `raw` = subject.
    - `done` — first-parent merges of `head` in **chronological** order (`git log --first-parent --merges --reverse`); the **earliest** in-epoch qualifying merge per item is `episode-1` (later merges are ignored with a note "later merge <sha> for <ref> needs explicit reopen evidence (M2)"); qualifying = `matchMergeSubject` hit **and** second-parent evidence (`git log --no-merges --format=%s <p2> ^<p1>` contains a subject starting with `<ref>:`); missing evidence → note, skipped.
    - Every record: `source: 'git'`, `host: 'git'`, `source_record_id` = full sha (rework: `<sha>`), `meta.git_sha`, `meta.version = run.version`, `meta.head = head`.
  - CLI `backfill --git --plan <run> --head <sha> [--since <iso>] [--cutoff <iso>] [--dry-run]`: `--pr` → `USAGE(--pr is not in M1)`; `--head` resolved with `git rev-parse --verify <sha>^{commit}` else `USAGE(head … not found)`; prints `NOTE …` lines, `EVENT/SKIP/ID-CONFLICT …` (or `WOULD …` with `--dry-run`), then `BACKFILL events=<n> skipped=<m> conflicts=<k> outside_epoch=<x> head=<full sha>`; stores `run.backfill = {head, at}` (last-writer-wins); exit 2 on conflicts.

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
const mkGit = (clock0) => { let clock = Date.parse(clock0); return (repo, args, minutes = 60) => { clock += minutes * 60000; const d = new Date(clock).toISOString(); return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim(); }; };

/** Replays the observed local-branch harness: plan commit, task branches, `address review N`, `merge task/task-NNN (Rio: PASS)`. */
export function buildFixtureRepo() {
  const repo = tmp(); const git = mkGit('2026-09-15T08:00:00Z');
  const commit = (file, msg, minutes) => { writeFileSync(join(repo, file), `${msg}\n${Math.random()}`); git(repo, ['add', file]); git(repo, ['commit', '-q', '-m', msg], minutes); return git(repo, ['rev-parse', 'HEAD'], 0); };
  git(repo, ['init', '-q', '-b', 'main'], 0);
  writeFileSync(join(repo, 'plan.md'), '# plan\n#### TASK-001: a\n#### TASK-002: b\n#### TASK-003: c\n#### TASK-004: d\n');
  git(repo, ['add', 'plan.md']); git(repo, ['commit', '-q', '-m', 'plan: tasks'], 0);
  const task = (n, rework, unnumbered = false) => {
    git(repo, ['checkout', '-q', '-b', `task/task-${n}`, 'main'], 0);
    const first = commit(`f${n}.txt`, `TASK-${n}: implement`, 30);
    if (rework) commit(`f${n}.txt`, unnumbered ? `TASK-${n}: address review` : `TASK-${n}: address review 1`, 45);
    git(repo, ['checkout', '-q', 'main'], 0);
    git(repo, ['merge', '--no-ff', '-q', '-m', `merge task/task-${n} (Rio: PASS)`, `task/task-${n}`], 20);
    return { first, merge: git(repo, ['rev-parse', 'HEAD'], 0) };
  };
  const t1 = task('001', true), t2 = task('002', false), t4 = task('004', true, true);
  // a second, later merge of TASK-001 (re-landing) — must NOT become episode-1
  git(repo, ['checkout', '-q', 'task/task-001'], 0); commit('f001.txt', 'TASK-001: more', 30); git(repo, ['checkout', '-q', 'main'], 0); git(repo, ['merge', '--no-ff', '-q', '-m', 'merge task/task-001 (Rio: PASS)', 'task/task-001'], 20);
  const head = git(repo, ['rev-parse', 'HEAD'], 0);
  const t3 = task('003', false); // after head → must not appear
  return { repo, head, t1, t2, t3, t4 };
}
/** A branch merged under a task alias whose commits never mention the ref → no second-parent evidence. */
export function buildNoEvidenceRepo() {
  const repo = tmp(); const git = mkGit('2026-09-15T08:00:00Z');
  git(repo, ['init', '-q', '-b', 'main'], 0); writeFileSync(join(repo, 'plan.md'), '#### TASK-001: a\n'); git(repo, ['add', 'plan.md']); git(repo, ['commit', '-q', '-m', 'plan'], 0);
  git(repo, ['checkout', '-q', '-b', 'task/task-001', 'main'], 0); writeFileSync(join(repo, 'x.txt'), 'x'); git(repo, ['add', 'x.txt']); git(repo, ['commit', '-q', '-m', 'unrelated work'], 30);
  git(repo, ['checkout', '-q', 'main'], 0); git(repo, ['merge', '--no-ff', '-q', '-m', 'merge task/task-001 (Rio: PASS)', 'task/task-001'], 20);
  return { repo, head: git(repo, ['rev-parse', 'HEAD'], 0) };
}
const run = (repo, from = '2026-09-15T00:00:00Z') => ({ run: 'sec/run-1', version: 1, source: { path: join(repo, 'plan.md'), rel: 'plan.md' }, source_epoch: { from, until: null, integration_ref: 'main' }, items: [
  { item_id: 'sec/run-1/task-task-001', ref: 'TASK-001', level: 'task', branch: 'task/task-001' }, { item_id: 'sec/run-1/task-task-002', ref: 'TASK-002', level: 'task', branch: 'task/task-002' },
  { item_id: 'sec/run-1/task-task-003', ref: 'TASK-003', level: 'task', branch: 'task/task-003' }, { item_id: 'sec/run-1/task-task-004', ref: 'TASK-004', level: 'task', branch: 'task/task-004' }] });

test('matchMergeSubject: alias and task/task-NNN, case-insensitive', () => {
  const r = run('/x');
  assert.equal(matchMergeSubject('merge task/task-001 (Rio: PASS)', r).ref, 'TASK-001'); assert.equal(matchMergeSubject('Merge TASK/TASK-002', r).ref, 'TASK-002'); assert.equal(matchMergeSubject('merge feature/x', r), null);
});

test('deriveGitObservations: created/first_commit/rework/done; earliest merge is episode-1; head pins history; unnumbered rework', () => {
  const { repo, head, t1, t2, t4 } = buildFixtureRepo();
  const { records, notes } = deriveGitObservations({ repo, run: run(repo), head, cutoff: '2026-12-31T00:00:00Z' });
  const of = (ref, ev) => records.filter((r) => r.ref === ref && r.event === ev);
  assert.equal(of('TASK-001', 'created').length, 1); assert.equal(of('TASK-001', 'created')[0].basis, 'plan-commit');
  assert.equal(of('TASK-001', 'first_commit')[0].meta.git_sha, t1.first);
  assert.deepEqual(of('TASK-001', 'rework_observed').map((r) => r.meta.round), [1]); assert.equal(of('TASK-001', 'rework_observed')[0].transition_id, 'sec/run-1/task-task-001/rework_observed/1');
  assert.equal(of('TASK-001', 'done').length, 1); assert.equal(of('TASK-001', 'done')[0].meta.git_sha, t1.merge, 'earliest merge, not the later re-landing');
  assert.ok(notes.some((n) => /later merge .* TASK-001/.test(n)));
  assert.equal(of('TASK-002', 'done')[0].meta.git_sha, t2.merge); assert.equal(of('TASK-002', 'rework_observed').length, 0);
  assert.equal(of('TASK-004', 'rework_observed')[0].meta.round, null); assert.match(of('TASK-004', 'rework_observed')[0].transition_id, /rework_observed\/x[0-9a-f]{7}$/); assert.equal(of('TASK-004', 'done')[0].meta.git_sha, t4.merge);
  assert.equal(of('TASK-003', 'done').length, 0); assert.equal(of('TASK-003', 'first_commit').length, 0); assert.equal(of('TASK-003', 'created').length, 1);
  assert.ok(records.every((r) => r.source === 'git' && r.host === 'git' && r.meta.version === 1 && r.meta.head === head));
});

test('no second-parent evidence → note, no done; head off the integration ref → USAGE; epoch filtering happens before "first" selection', () => {
  const { repo, head } = buildNoEvidenceRepo();
  const r = deriveGitObservations({ repo, run: run(repo), head, cutoff: '2026-12-31T00:00:00Z' });
  assert.equal(r.records.filter((x) => x.event === 'done').length, 0); assert.ok(r.notes.some((n) => /lacks second-parent evidence/.test(n)));
  const fx = buildFixtureRepo();
  assert.throws(() => deriveGitObservations({ repo: fx.repo, run: run(fx.repo), head: fx.t1.first, cutoff: '2026-12-31T00:00:00Z' }), (e) => e.code === 'USAGE' && /not on integration ref/.test(e.message), 'a task-branch commit is not on main');
  const late = deriveGitObservations({ repo: fx.repo, run: run(fx.repo, '2026-09-15T09:30:00Z'), head: fx.head, cutoff: '2026-12-31T00:00:00Z' });
  assert.equal(late.records.filter((x) => x.ref === 'TASK-001' && x.event === 'first_commit').length, 0, 'TASK-001 first commit (08:30) is before the epoch → not replaced by a later same-ref commit');
  assert.ok(late.skippedOutsideEpoch >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write `git-backfill.mjs`**

```js
// STDLIB ONLY. Derive observations from a pinned integration head (spec §6.7, local-branch mode). PR mode is M2.
import { makeObservation } from './events.mjs';
import { firstCommitContaining, git, isAncestor } from './git.mjs';
import { cliError } from './paths.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function gitLog(repo, args) {
  const out = git(repo, ['log', '--format=%H%x1f%P%x1f%cI%x1f%s', ...args]); if (!out) return [];
  return out.split('\n').filter(Boolean).map((l) => { const [sha, parents, at, subject] = l.split('\x1f'); return { sha, parents: parents ? parents.split(' ') : [], at: new Date(at).toISOString(), subject }; });
}
export function matchMergeSubject(subject, run) {
  const m = /^merge\s+(\S+)/i.exec(subject); if (!m) return null;
  const branch = m[1].toLowerCase();
  const byAlias = run.items.find((i) => i.branch && i.branch.toLowerCase() === branch); if (byAlias) return byAlias;
  const t = /^task\/task-(\d+)$/.exec(branch); return t ? run.items.find((i) => i.ref === `TASK-${t[1]}`) ?? null : null;
}

export function deriveGitObservations({ repo, run, head, since = null, cutoff = null, now = Date.now() }) {
  const ref = run.source_epoch?.integration_ref;
  const notes = []; let headUnverified = false;
  const tip = git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]) ?? git(repo, ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`]);
  if (tip) { if (tip !== head && isAncestor(repo, head, tip) !== true) throw cliError('USAGE', `head ${head} is not on integration ref ${ref}`); }
  else { notes.push(`integration ref ${ref} not found — head accepted unverified`); headUnverified = true; }
  const from = run.source_epoch?.from ? new Date(run.source_epoch.from).toISOString() : null, until = run.source_epoch?.until ? new Date(run.source_epoch.until).toISOString() : null;
  const cut = cutoff ? new Date(cutoff).toISOString() : null, sinceIso = since ? new Date(since).toISOString() : null;
  let skippedOutsideEpoch = 0;
  const inEpoch = (at) => { const ok = (!from || at >= from) && (!until || at < until) && (!sinceIso || at >= sinceIso) && (!cut || at < cut); if (!ok) skippedOutsideEpoch++; return ok; };
  const meta = (sha, extra = {}) => ({ git_sha: sha, version: run.version, head, ...(headUnverified ? { head_unverified: true } : {}), ...extra });
  const obs = (item, event, at, sha, transition, extra = {}) => makeObservation({ user: null, host: 'git', plan: run.run, item_id: item.item_id, ref: item.ref, level: item.level, event, at, transition_id: transition, source: 'git', source_record_id: sha, basis: extra.basis ?? 'observed', raw: extra.raw ?? null, meta: meta(sha, extra.meta ?? {}) }, { now });
  const items = run.items.filter((i) => i.level === 'task' && !i.cancelled);
  const records = [];
  if (run.source?.rel) { for (const it of items) { const c = firstCommitContaining(repo, head, run.source.rel, it.ref); if (c && inEpoch(c.at)) records.push(obs(it, 'created', c.at, c.sha, `${it.item_id}/created/0`, { basis: 'plan-commit' })); } }
  else notes.push('run has no source path — created not derived');
  const nonMerge = gitLog(repo, ['--no-merges', '--reverse', head]);
  for (const it of items) {
    const mine = nonMerge.filter((c) => new RegExp(`^${esc(it.ref)}:`).test(c.subject) && inEpoch(c.at));
    if (mine.length) records.push(obs(it, 'first_commit', mine[0].at, mine[0].sha, `${it.item_id}/first_commit/0`, { raw: mine[0].subject }));
    for (const c of mine) { const m = new RegExp(`^${esc(it.ref)}: address review(?: (\\d+))?\\b`).exec(c.subject); if (m) records.push(obs(it, 'rework_observed', c.at, c.sha, `${it.item_id}/rework_observed/${m[1] ?? `x${c.sha.slice(0, 7)}`}`, { raw: c.subject, meta: { round: m[1] ? Number(m[1]) : null } })); }
  }
  const done = new Set();
  for (const c of gitLog(repo, ['--first-parent', '--merges', '--reverse', head])) {
    const it = matchMergeSubject(c.subject, run); if (!it || c.parents.length < 2) continue;
    if (!inEpoch(c.at)) continue;
    const evidence = (git(repo, ['log', '--no-merges', '--format=%s', c.parents[1], `^${c.parents[0]}`]) ?? '').split('\n').some((s) => s.startsWith(`${it.ref}:`));
    if (!evidence) { notes.push(`merge ${c.sha.slice(0, 7)} for ${it.ref} lacks second-parent evidence; skipped`); continue; }
    if (done.has(it.item_id)) { notes.push(`later merge ${c.sha.slice(0, 7)} for ${it.ref} needs explicit reopen evidence (M2); skipped`); continue; }
    done.add(it.item_id); records.push(obs(it, 'done', c.at, c.sha, `${it.item_id}/done/episode-1`, { raw: c.subject }));
  }
  records.sort((a, b) => a.at.localeCompare(b.at));
  return { records, notes, skippedOutsideEpoch, head };
}
```

- [ ] **Step 4: Wire `backfill` into `delivery.mjs`** (imports `deriveGitObservations`, `git`):
```js
function cmdBackfill(repo, p, io, now) {
  const f = p.flags;
  if (!f.git) throw cliError('USAGE', 'backfill --git --plan <run> --head <sha> [--since] [--cutoff] [--dry-run]');
  if (f.pr) throw cliError('USAGE', '--pr is not in M1');
  const run = resolveRun(repo, f.plan);
  if (!f.head) throw cliError('USAGE', 'backfill needs --head <sha> on the integration ref');
  const head = git(repo, ['rev-parse', '--verify', `${f.head}^{commit}`]); if (!head) throw cliError('USAGE', `head ${f.head} not found`);
  const { records, notes, skippedOutsideEpoch } = deriveGitObservations({ repo, run, head, since: f.since ? isoOrThrow(f.since, '--since') : null, cutoff: f.cutoff ? isoOrThrow(f.cutoff, '--cutoff') : nowIso(now), now });
  for (const n of notes) out(io, `NOTE ${n}`);
  let events = 0, skipped = 0, conflicts = 0;
  for (const r of records) {
    if (f['dry-run']) { out(io, `WOULD ${r.observation_id} ${r.at}`); continue; }
    const res = appendObservation(repo, r, { now }); out(io, `${res.result} ${res.observation_id} ${r.at}`);
    if (res.result === 'EVENT') events++; else if (res.result === 'SKIP') skipped++; else conflicts++;
  }
  if (!f['dry-run']) { run.backfill = { head, at: nowIso(now) }; saveRun(repo, run); }
  out(io, `BACKFILL events=${events} skipped=${skipped} conflicts=${conflicts} outside_epoch=${skippedOutsideEpoch} head=${head}`);
  if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} git observation(s) conflict`);
  return 0;
}
```
Add `backfill: cmdBackfill` to `COMMANDS`. CLI test in `delivery.test.mjs`: import `buildFixtureRepo` from `./lib/git-backfill.test.mjs`; register a plan block (tasks `TASK-001..004` with `branch` aliases, `observation_start`/`source_epoch.from` = `2026-09-15T00:00:00Z`) written to `plan.md` **inside the fixture repo and committed there** (the fixture's own `plan.md` already lists the headings — overwrite it with the block + headings and `git commit` before registering), run `backfill --git --head <head> --cutoff 2026-12-31T00:00:00Z`, assert `BACKFILL events=` equals `records.length` from a direct `deriveGitObservations` call, run again → `events=0 skipped=<same>`, and `report --json --cutoff …` shows `commit_to_done` for tasks and no `cycle_time`.

- [ ] **Step 5: Run tests** — all green.

- [ ] **Step 6: Commit**
```bash
git add skills/delivery-metrics/scripts
git commit -m "feat(delivery-metrics): git backfill — epoch-first, earliest qualifying merge, head pinned to the integration ref"
```

---

### Task 10: Golden fixture from the security-testing snapshot

**Files:**
- Create: `skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs` (one-off, documented), `dataset.json` (committed: ids + timestamps + provenance only), `build-fixture-repo.mjs`, `golden.json`
- Create: `skills/delivery-metrics/scripts/golden.test.mjs`

**Interfaces:** `buildFixtureRepo(dataset) → {repo, head, planFile}`; `dataset.json` = `{ source: {ref, head, plan_path, plan_sha256}, plan_commit_at, groups: [{ref, tasks: ['TASK-023', …]}], tasks: [{ref, story, class, first_commit_at, rework: [{round|null, at}], merged_at|null}] }`.

The snapshot is head `b1f70d2` on `feat/security-testing-bundle-spec` (same object store from this worktree; no network). Spec AC-3 pins: 59 tasks, 30 missions (G0–G29), 33 first completions, 11 items with rework proxies — the extractor **asserts** these before writing.

- [ ] **Step 1: Write the extractor and run it once**

`skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs`:
```js
#!/usr/bin/env node
// One-off, repository-relative: node extract-dataset.mjs --head b1f70d2 --plan docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md [--ref feat/security-testing-bundle-spec] > dataset.json
// Emits ids and timestamps only (never commit bodies or prompt text). Reuses the skill's own plan-markdown parser so memberships match registration.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseExecutionBlock, parseTaskHeadings } from '../../scripts/lib/plan-markdown.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const head = arg('head'), planPath = arg('plan'), ref = arg('ref', 'HEAD');
if (!head || !planPath) { console.error('usage: --head <sha> --plan <path> [--ref <branch>]'); process.exit(2); }
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const log = (...a) => git('log', '--format=%H%x1f%P%x1f%cI%x1f%s', ...a).split('\n').filter(Boolean).map((l) => { const [sha, p, at, s] = l.split('\x1f'); return { sha, parents: p.split(' '), at: new Date(at).toISOString(), subject: s }; });
const plan = git('show', `${head}:${planPath}`);
const groups = parseExecutionBlock(plan).map((g) => ({ ref: g.ref, tasks: g.nums.map((n) => `TASK-${n}`) }));
const headings = parseTaskHeadings(plan);
const tasks = new Map([...headings.values()].map((t) => [t.ref, { ref: t.ref, story: t.story, class: t.class, first_commit_at: null, rework: [], merged_at: null }]));
for (const c of log('--no-merges', '--reverse', head)) {
  const m = /^(TASK-\d{3}): (.*)$/.exec(c.subject); if (!m || !tasks.has(m[1])) continue;
  const t = tasks.get(m[1]); t.first_commit_at ??= c.at;
  const r = /^address review(?: (\d+))?\b/.exec(m[2]); if (r) t.rework.push({ round: r[1] ? Number(r[1]) : null, at: c.at });
}
for (const c of log('--first-parent', '--merges', '--reverse', head)) { const m = /^merge task\/task-(\d{3})/i.exec(c.subject); if (m && tasks.has(`TASK-${m[1]}`)) tasks.get(`TASK-${m[1]}`).merged_at ??= c.at; }
const planCommit = log('--reverse', head, '--', planPath)[0];
const membership = groups.flatMap((g) => g.tasks);
const ds = { source: { ref, head: git('rev-parse', head), plan_path: planPath, plan_sha256: createHash('sha256').update(plan).digest('hex') }, plan_commit_at: planCommit.at, groups, tasks: [...tasks.values()] };
const counts = { tasks: ds.tasks.length, groups: groups.length, merged: ds.tasks.filter((t) => t.merged_at).length, rework: ds.tasks.filter((t) => t.rework.length).length, membership: membership.length, unique: new Set(membership).size };
const expect = { tasks: 59, groups: 30, merged: 33, rework: 11, membership: 59, unique: 59 };
for (const k of Object.keys(expect)) if (counts[k] !== expect[k]) { console.error(`reconcile: ${k}=${counts[k]} expected ${expect[k]}`); process.exit(4); }
process.stdout.write(`${JSON.stringify(ds, null, 2)}\n`);
```
Run from the worktree root: `node skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs --head b1f70d2 --plan docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md --ref feat/security-testing-bundle-spec > skills/delivery-metrics/fixtures/security-testing/dataset.json`
Expected: exit 0 (the reconciliation is inside the script: 59 tasks / 30 groups / 33 merged / 11 rework / every task in exactly one group). If it exits 4, print the offending subjects (`git log b1f70d2 --no-merges --format=%s | grep -E '^TASK-[0-9]{3}: ' | grep -i review`) and fix the regex — do not edit the numbers.

- [ ] **Step 2: Write the fixture-repo builder**

`skills/delivery-metrics/fixtures/security-testing/build-fixture-repo.mjs`:
```js
// Builds a temp git repo replaying dataset.json with its real timestamps (fixed → reproducible); no client content.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function buildFixtureRepo(ds) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-golden-'));
  const env = (at) => ({ ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'f@x', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'f@x' });
  const git = (args, at = ds.plan_commit_at) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: env(at) }).trim();
  git(['init', '-q', '-b', 'main']);
  const known = new Set(ds.tasks.map((t) => t.ref));
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: ds.plan_commit_at, source_epoch: { from: ds.plan_commit_at, until: null, integration_ref: 'main' },
    campaign: { ref: 'sec' }, mission_kind: 'group', missions: ds.groups.map((g, i) => ({ ref: g.ref, sequence: i + 1, tasks: g.tasks.filter((r) => known.has(r)).map((r) => { const t = ds.tasks.find((x) => x.ref === r); return { ref: r, story: t.story ?? undefined, class: t.class ?? undefined, branch: `task/task-${r.slice(5)}` }; }) })) };
  const planFile = join(repo, 'plan.md');
  writeFileSync(planFile, `# plan\n\n\`\`\`json delivery-plan\n${JSON.stringify(block)}\n\`\`\`\n\n${ds.tasks.map((t) => `#### ${t.ref}: t`).join('\n')}\n`);
  git(['add', 'plan.md']); git(['commit', '-q', '-m', 'plan: tasks']);
  const events = [];
  for (const t of ds.tasks) { if (t.first_commit_at) events.push({ at: t.first_commit_at, kind: 'first', t }); for (const r of t.rework) events.push({ at: r.at, kind: 'rework', t, r }); if (t.merged_at) events.push({ at: t.merged_at, kind: 'merge', t }); }
  events.sort((a, b) => a.at.localeCompare(b.at) || ['first', 'rework', 'merge'].indexOf(a.kind) - ['first', 'rework', 'merge'].indexOf(b.kind));
  const branch = (t) => `task/task-${t.ref.slice(5)}`;
  for (const e of events) {
    if (e.kind === 'first') { git(['checkout', '-q', '-b', branch(e.t), 'main']); writeFileSync(join(repo, `${e.t.ref}.txt`), '1'); git(['add', '.']); git(['commit', '-q', '-m', `${e.t.ref}: implement`], e.at); git(['checkout', '-q', 'main']); }
    else if (e.kind === 'rework') { git(['checkout', '-q', branch(e.t)]); writeFileSync(join(repo, `${e.t.ref}.txt`), `r${e.r.round ?? 'x'}${e.at}`); git(['add', '.']); git(['commit', '-q', '-m', `${e.t.ref}: address review${e.r.round == null ? '' : ` ${e.r.round}`}`], e.at); git(['checkout', '-q', 'main']); }
    else git(['merge', '--no-ff', '-q', '-m', `merge ${branch(e.t)} (Rio: PASS)`, branch(e.t)], e.at);
  }
  return { repo, head: git(['rev-parse', 'HEAD']), planFile };
}
```

- [ ] **Step 3: Write the golden test**

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

test('golden: 59 tasks, 30 missions, 33 first completions, 11 rework proxies; cycle_time absent; re-run is a no-op', () => {
  const { repo, head, planFile } = buildFixtureRepo(DS);
  run(repo, ['plan', 'register', '--from', planFile, '--id', 'reg-1']);
  assert.match(run(repo, ['backfill', '--git', '--head', head, '--cutoff', CUTOFF]), /BACKFILL events=\d+ skipped=0 conflicts=0/);
  const doc = JSON.parse(run(repo, ['report', '--json', '--cutoff', CUTOFF]));
  const p = doc.plans[0]; const tasks = p.items.filter((i) => i.level === 'task');
  assert.equal(tasks.length, 59); assert.equal(p.items.filter((i) => i.level === 'mission').length, 30); assert.equal(tasks.filter((i) => i.state === 'done').length, 33);
  assert.equal(p.metrics.flow.task.strata.all.cycle_time, null); assert.equal(p.metrics.flow.task.strata.all.commit_to_done.n, 33); assert.equal(p.metrics.coverage.task.start_source.none, 33);
  assert.equal(p.metrics.rework_proxy_items, 11); assert.equal(p.registration_gaps, 31, 'campaign + 30 missions have no plan-commit creation (only tasks are derived)');
  assert.ok(doc.envelope.caveats.some((c) => /no observed dispatch start/.test(c)));
  const golden = { tasks: 59, missions: 30, done: 33, rework_proxy_items: 11, commit_to_done: p.metrics.flow.task.strata.all.commit_to_done, lead_time: p.metrics.flow.task.strata.all.lead_time, throughput: p.metrics.throughput.task.weeks, awaiting_landing: doc.envelope.coverage.awaiting_landing };
  if (!existsSync(GOLDEN)) { writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`); assert.fail('golden.json written — re-run to compare'); }
  assert.deepEqual(golden, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  assert.match(run(repo, ['backfill', '--git', '--head', head, '--cutoff', CUTOFF]), /BACKFILL events=0 skipped=\d+ conflicts=0/);
});
```

- [ ] **Step 4: Run, generate the golden, run again** — first run writes `golden.json` and fails on purpose; second run passes. Sanity-check `golden.json`: `commit_to_done.n === 33`, medians in seconds plausible (tens of minutes to a few hours), throughput weeks `2026-W37`/`2026-W38`.

- [ ] **Step 5: Commit**
```bash
git add skills/delivery-metrics/fixtures/security-testing skills/delivery-metrics/scripts/golden.test.mjs
git commit -m "test(delivery-metrics): golden fixture from the security-testing snapshot (59/30/33/11), reconciled in the extractor"
```

---

### Task 11: `hooks/dispatch-hook.mjs` — Claude `SubagentStop` capture

**Files:**
- Create: `skills/delivery-metrics/hooks/dispatch-hook.mjs`, `skills/delivery-metrics/hooks/dispatch-hook.test.mjs`

**Interfaces:**
- Consumes: `lib/paths.mjs`, `lib/events.mjs`, `lib/plan.mjs`, `lib/git.mjs` (`git`).
- Produces (exported): `SUPPORTED_SHAPES = ['claude-projects-subagents-v1']` (the only child layout accepted until SPIKE-1: `<dir(parent transcript)>/<session_id>/subagents/<agent_id>.jsonl` or `agent-<agent_id>.jsonl`, with a sibling `.meta.json`); `readStdinBounded(ms, max)`; `ownerRepo(payload, env) → dir` — re-export Task 1’s shared resolver; payload cwd takes precedence, with no search for another repository containing telemetry; `sessionRun(repo, host, sessionId) → run|null` (open runs only); `rosterOf(run) → Set` (Task 1 validated `run.roster.agents`; never source-checkout metadata); `findChildTranscript(payload) → {path, metaPath, shape}|null` — `agent_transcript_path` is accepted **only** when it exists, its basename is `<agent_id>.jsonl`/`agent-<agent_id>.jsonl` **and** its path contains `/<session_id>/`; else the documented shape; `parseTranscript(path) → {firstTs, lastTs, firstUserText, records, complete}` — `complete` = at least one `user` record and at least one later non-user record with a timestamp; `classifyStage(text)`; `resolveRefs(run, {description, firstUserText, branch}) → {items, how}`; `appendOrRevise(repo, rec, opts)`; `handleStop(payload, {repo, now}) → {wrote: [], diagnostic: string|null}`.
- Hook contract (spec §6.6): stdin ≤ 64 KiB, never stdout, always exit 0. Guards in order: (1) an open run exists, else exit; (2) `sessions/claude:<session_id>.json` → open run, else diagnostic `unbound-session`; (3) invalid/missing snapshot → diagnostic `invalid-roster`, no emission; otherwise role = `.meta.json` `agentType` (or payload `agent_type`): present and **not in `rosterOf(run)`** → exit silently (foreign); missing → admitted, diagnostic `unknown-role`; (4) child transcript per `SUPPORTED_SHAPES`; none → diagnostic `no-transcript`; (5) `parseTranscript`: no `firstTs` → diagnostic `no-transcript`; `complete === false` → emit **only** `dispatched` (start observed) plus diagnostic `incomplete-transcript` (no `dispatch_ended`); (6) resolve + emit.
- Emission per resolved item: `dispatched {at: firstTs, transition <item>/dispatched/<agent_id>, meta: {stage, version}, session, agentId, role, label}`; `dispatch_ended {at: lastTs, transition <item>/dispatch_ended/<agent_id>}` when complete; stage `fix` → `rework_observed {transition <item>/rework_observed/<agent_id>, meta.round: null}`; `source: 'hook'`, `host: 'claude'`, `source_record_id: claude:<session_id>:<agent_id>`, `basis: observed`. `label` = `capturePrompts ? description.slice(0,120) : '<ref> <stage>'`. No item → one unattributed `dispatched`/`dispatch_ended` pair (`item_id/ref/level: null`, `meta.unattributed: true`). Diagnostics → `.agents/telemetry/delivery/diagnostics-<slug>.jsonl` `{at, kind, session, agent_id, detail}`. Grown transcript → `appendOrRevise` bumps the revision of the changed observation.

- [ ] **Step 1: Write the failing test**

`skills/delivery-metrics/hooks/dispatch-hook.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyStage, resolveRefs, handleStop, ownerRepo, parseTranscript, findChildTranscript } from './dispatch-hook.mjs';
import { saveRun } from '../scripts/lib/plan.mjs';
import { makeRoster } from '../scripts/lib/roster.mjs';
import { resolveObservations } from '../scripts/lib/events.mjs';
import { deliveryDir, sessionsDir, sessionPath } from '../scripts/lib/paths.mjs';

const SCRIPT = fileURLToPath(new URL('./dispatch-hook.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-hook-'));
const R = 'sec/run-1';
const run = { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', roster_agents: ['js-dev', 'tech-lead'], items: [
  { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
  { item_id: `${R}/task-task-023`, ref: 'TASK-023', level: 'task', parent_item_id: `${R}/mission-g1`, branch: 'task/task-023' }, { item_id: `${R}/task-task-034`, ref: 'TASK-034', level: 'task', parent_item_id: `${R}/mission-g1`, branch: 'task/task-034' }] };
const setup = ({ bind = true } = {}) => { const repo = tmp(); mkdirSync(deliveryDir(repo), { recursive: true }); for (const role of ['js-dev', 'tech-lead', 'test-automation-lead', 'qa-auditor']) { const d = join(repo, '.claude', 'agents', role); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'AGENT.md'), 'role'); } const roster = makeRoster(repo, ['feature-development', 'test-automation']); saveRun(repo, { ...run, roster, roster_agents: roster.agents }); if (bind) { mkdirSync(sessionsDir(repo), { recursive: true }); writeFileSync(sessionPath(repo, 'claude', 'sess-1'), JSON.stringify({ host: 'claude', session: 'sess-1', plan: R })); } return repo; };
const transcripts = ({ agentType = 'js-dev', description = 'Implement TASK-023 build-report core', first = 'You are js-dev. Implement TASK-023.', t0 = '2026-09-16T09:00:00.000Z', t1 = '2026-09-16T10:00:00.000Z', agentId = 'agent-1', complete = true, session = 'sess-1' } = {}) => {
  const proj = tmp(); const parent = join(proj, `${session}.jsonl`); writeFileSync(parent, `${JSON.stringify({ type: 'user', timestamp: t0, message: { role: 'user', content: 'hi' } })}\n`);
  const dir = join(proj, session, 'subagents'); mkdirSync(dir, { recursive: true });
  const lines = [JSON.stringify({ type: 'user', timestamp: t0, message: { role: 'user', content: [{ type: 'text', text: first }] } })]; if (complete) lines.push(JSON.stringify({ type: 'assistant', timestamp: t1, message: { role: 'assistant', content: 'done' } }));
  writeFileSync(join(dir, `${agentId}.jsonl`), `${lines.join('\n')}\n`); writeFileSync(join(dir, `${agentId}.meta.json`), JSON.stringify({ agentType, description }));
  return { parent, child: join(dir, `${agentId}.jsonl`) };
};
const payload = (t, over = {}) => ({ session_id: 'sess-1', agent_id: 'agent-1', transcript_path: t.parent, hook_event_name: 'SubagentStop', ...over });
const NOW = Date.parse('2026-09-16T10:00:05Z');

test('classifyStage', () => {
  assert.equal(classifyStage('Implement TASK-1'), 'build'); assert.equal(classifyStage('Build the thing'), 'build'); assert.equal(classifyStage('Review PR for TASK-1'), 'review');
  assert.equal(classifyStage('fix round 2 for TASK-1'), 'fix'); assert.equal(classifyStage('TASK-1: address review 1'), 'fix'); assert.equal(classifyStage('mini-gate'), 'gate'); assert.equal(classifyStage('merge task'), 'merge'); assert.equal(classifyStage('write docs'), 'other');
});

test('resolveRefs: description, unique message match, branch alias, ambiguity, whole word', () => {
  assert.deepEqual(resolveRefs(run, { description: 'Implement TASK-023', firstUserText: 'TASK-034 also mentioned' }).items.map((i) => i.ref), ['TASK-023']);
  assert.deepEqual(resolveRefs(run, { description: 'boilerplate', firstUserText: 'You are js-dev … now implement TASK-034 …' }).items.map((i) => i.ref), ['TASK-034']);
  assert.equal(resolveRefs(run, { description: '', firstUserText: 'TASK-023 and TASK-034' }).how, 'ambiguous');
  assert.deepEqual(resolveRefs(run, { description: '', firstUserText: 'nothing', branch: 'task/task-034' }).items.map((i) => i.ref), ['TASK-034']);
  assert.equal(resolveRefs(run, { description: 'TASK-0230', firstUserText: '' }).items.length, 0);
});

test('findChildTranscript: documented shape; agent_transcript_path accepted only when correlated to session and agent', () => {
  const t = transcripts();
  assert.equal(findChildTranscript(payload(t)).path, t.child);
  const foreign = transcripts({ session: 'sess-9' });
  assert.equal(findChildTranscript({ session_id: 'sess-1', agent_id: 'agent-1', transcript_path: t.parent, agent_transcript_path: foreign.child }).path, t.child, 'uncorrelated explicit path ignored, documented shape used');
  assert.equal(findChildTranscript({ session_id: 'sess-1', agent_id: 'agent-2', transcript_path: t.parent, agent_transcript_path: t.child }), null, 'basename must match the agent id');
});

test('handleStop: emits dispatched/dispatch_ended; retry SKIPs; grown transcript revises; incomplete transcript → dispatched only', () => {
  const repo = setup(); const t = transcripts();
  const r = handleStop(payload(t), { repo, now: NOW }); assert.equal(r.diagnostic, null); assert.deepEqual(r.wrote.map((w) => w.result), ['EVENT', 'EVENT']);
  let { active } = resolveObservations(repo); const d = active.find((o) => o.event === 'dispatched');
  assert.equal(d.item_id, `${R}/task-task-023`); assert.equal(d.at, '2026-09-16T09:00:00.000Z'); assert.equal(d.source, 'hook'); assert.equal(d.host, 'claude'); assert.equal(d.transition_id, `${R}/task-task-023/dispatched/agent-1`);
  assert.equal(d.meta.stage, 'build'); assert.equal(d.meta.version, 1); assert.equal(d.role, 'js-dev'); assert.equal(d.session, 'sess-1'); assert.equal(d.agentId, 'agent-1'); assert.equal(d.label, 'TASK-023 build'); assert.equal(d.source_record_id, 'claude:sess-1:agent-1');
  assert.equal(active.find((o) => o.event === 'dispatch_ended').at, '2026-09-16T10:00:00.000Z');
  assert.deepEqual(handleStop(payload(t), { repo, now: NOW }).wrote.map((w) => w.result), ['SKIP', 'SKIP']);
  writeFileSync(t.child, `${readFileSync(t.child, 'utf8')}${JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T11:00:00.000Z', message: { content: 'more' } })}\n`);
  assert.deepEqual(handleStop(payload(t), { repo, now: NOW }).wrote.map((w) => [w.result, w.revision]), [['SKIP', 0], ['EVENT', 1]]);
  assert.equal(resolveObservations(repo).active.find((o) => o.event === 'dispatch_ended').at, '2026-09-16T11:00:00.000Z');
  const inc = transcripts({ agentId: 'agent-5', complete: false }); const ri = handleStop(payload(inc, { agent_id: 'agent-5' }), { repo, now: NOW });
  assert.equal(ri.diagnostic, 'incomplete-transcript'); assert.deepEqual(ri.wrote.map((w) => w.result), ['EVENT']); assert.equal(resolveObservations(repo).active.filter((o) => o.agentId === 'agent-5').length, 1);
});

test('handleStop: fix stage adds rework_observed; unresolved/ambiguous → unattributed pair', () => {
  const repo = setup();
  handleStop(payload(transcripts({ description: 'fix round 1 for TASK-034', agentId: 'agent-2' }), { agent_id: 'agent-2' }), { repo, now: NOW });
  assert.ok(resolveObservations(repo).active.some((o) => o.event === 'rework_observed' && o.item_id === `${R}/task-task-034`));
  handleStop(payload(transcripts({ description: 'tidy docs', first: 'no ids here', agentId: 'agent-3' }), { agent_id: 'agent-3' }), { repo, now: NOW });
  const un = resolveObservations(repo).active.filter((o) => o.meta.unattributed); assert.equal(un.length, 2); assert.equal(un[0].item_id, null); assert.equal(un[0].plan, R);
});

test('guards: no open plan → nothing; unbound session → diagnostic; foreign-but-installed role → nothing; unknown role → admitted + diagnostic; no transcript → diagnostic', () => {
  const t = transcripts();
  const none = tmp(); assert.deepEqual(handleStop(payload(t), { repo: none, now: NOW }), { wrote: [], diagnostic: null }); assert.ok(!existsSync(deliveryDir(none)));
  const unbound = setup({ bind: false }); assert.equal(handleStop(payload(t), { repo: unbound, now: NOW }).diagnostic, 'unbound-session'); assert.equal(resolveObservations(unbound).active.length, 0); assert.ok(readdirSync(deliveryDir(unbound)).some((f) => f.startsWith('diagnostics-')));
  const positive = setup(); assert.equal(handleStop(payload(transcripts({ agentType: 'test-automation-lead' })), { repo: positive, now: NOW }).wrote.length, 2);
  const foreign = setup(); assert.deepEqual(handleStop(payload(transcripts({ agentType: 'qa-auditor' })), { repo: foreign, now: NOW }), { wrote: [], diagnostic: null }, 'qa-auditor is not in the plan roster even if installed');
  const unknown = setup(); const ru = handleStop(payload(transcripts({ agentType: '' })), { repo: unknown, now: NOW }); assert.equal(ru.diagnostic, 'unknown-role'); assert.equal(ru.wrote.length, 2);
  const missing = setup(); const rm = handleStop(payload(t, { agent_id: 'agent-9' }), { repo: missing, now: NOW }); assert.equal(rm.diagnostic, 'no-transcript'); assert.equal(rm.wrote.length, 0);
});

test('ownerRepo: linked worktree (any path) resolves to the main checkout via worktree list; plain dirs pass through', () => {
  const main = tmp(); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: main }); execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'x'], { cwd: main, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  mkdirSync(join(main, '.agents', 'telemetry', 'delivery'), { recursive: true });
  const wt = join(tmp(), 'elsewhere'); execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: main });
  assert.equal(ownerRepo({ cwd: wt }, {}), realpathSync(main)); assert.equal(ownerRepo({ cwd: main }, {}), realpathSync(main)); assert.equal(ownerRepo({}, { CLAUDE_PROJECT_DIR: main }), realpathSync(main));
  assert.ok(parseTranscript('/nonexistent').firstTs === null);
});

test('register and bind in an arbitrary linked worktree, capture there, report one owner ledger', async () => {
  const { main } = await import('../scripts/delivery.mjs');
  const { assemble } = await import('../scripts/lib/report.mjs');
  const mainRepo = tmp();
  const g = (...args) => execFileSync('git', ['-C', mainRepo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  g('init', '-q', '-b', 'main'); g('commit', '-q', '--allow-empty', '-m', 'init');
  const wt = join(tmp(), 'arbitrary-linked-checkout'); g('worktree', 'add', '-q', '-b', 'feature', wt);
  const agents = join(mainRepo, '.claude', 'agents', 'js-dev'); mkdirSync(agents, { recursive: true }); writeFileSync(join(agents, 'AGENT.md'), 'role');
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-09-14T00:00:00Z', source_epoch: { from: '2026-09-14T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-023', role: 'js-dev' }] }] };
  writeFileSync(join(wt, 'plan.json'), JSON.stringify(block));
  const io = { write() {} };
  const call = (args) => main(args, { repo: wt, now: NOW, stdout: io, stderr: io, env: { DELIVERY_NO_SYNC: '1' } });
  assert.equal(await call(['plan', 'register', '--from', 'plan.json', '--id', 'reg', '--created-at', '2026-09-14T00:00:00Z']), 0);
  assert.equal(await call(['session', 'set', '--host', 'claude', '--session', 'sess-1', '--plan', R]), 0);
  assert.equal(handleStop(payload(transcripts(), { cwd: wt }), { repo: wt, now: NOW }).wrote.length, 2);
  const options = { since: '2026-09-14T00:00:00Z', cutoff: '2026-09-17T00:00:00Z', now: NOW };
  assert.deepEqual(assemble(mainRepo, options), assemble(wt, options));
  assert.equal(resolveObservations(mainRepo).active.filter((o) => o.source === 'hook').length, 2);
  assert.equal(existsSync(join(wt, '.agents', 'telemetry', 'delivery')), false);
  assert.equal(existsSync(sessionPath(mainRepo, 'claude', 'sess-1')), true);
});

test('script: malformed stdin / missing fields → exit 0, no stdout, no files', () => {
  const repo = setup();
  for (const input of ['not json', '{}', JSON.stringify({ session_id: 'sess-1' })]) assert.equal(execFileSync('node', [SCRIPT, '--stop'], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo, DELIVERY_NO_SYNC: '1' } }), '');
  assert.equal(resolveObservations(repo).active.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write `dispatch-hook.mjs`**

```js
#!/usr/bin/env node
// STDLIB ONLY. Claude SubagentStop → dispatched / dispatch_ended (+ rework_observed) observations (spec §6.6).
// Never prints to stdout, always exits 0. Admission: open run, session→run association, role in the run's roster snapshot.
import { realpathSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir, nowIso, sessionPath, whoAmI, ownerRepo, resolveOwnerRepo } from '../scripts/lib/paths.mjs';
import { appendObservation, makeObservation } from '../scripts/lib/events.mjs';
import { listRuns, loadRun } from '../scripts/lib/plan.mjs';
import { git } from '../scripts/lib/git.mjs';
import { validRoster } from '../scripts/lib/roster.mjs';

export const SUPPORTED_SHAPES = ['claude-projects-subagents-v1'];
const STAGE = [[/\b(fix round|address review)\b/i, 'fix'], [/\b(mini-gate|hardening gate|gate)\b/i, 'gate'], [/\bmerge\b/i, 'merge'], [/\breview\w*/i, 'review'], [/\b(implement\w*|build)\b/i, 'build']];
export function classifyStage(text) { for (const [re, s] of STAGE) if (re.test(text ?? '')) return s; return 'other'; }

export function readStdinBounded(ms = 2000, max = 65536) {
  return new Promise((done) => {
    let buf = '', finished = false; const finish = () => { if (!finished) { finished = true; clearTimeout(timer); done(buf); } }; const timer = setTimeout(finish, ms);
    try { process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { buf += d; if (buf.length > max) { buf = buf.slice(0, max); finish(); return; } try { JSON.parse(buf); finish(); } catch { /* incomplete */ } }); process.stdin.on('end', finish); process.stdin.on('error', finish); } catch { finish(); }
  });
}

export { ownerRepo } from '../scripts/lib/paths.mjs';
export function sessionRun(repo, host, sessionId) { try { const s = JSON.parse(readFileSync(sessionPath(repo, host, sessionId), 'utf8')); const r = loadRun(repo, s.plan); return r && r.status === 'open' ? r : null; } catch { return null; } }
export const rosterOf = (run) => new Set(validRoster(run.roster) ? run.roster.agents : []);

export function findChildTranscript(payload) {
  const { session_id: sid, agent_id: aid } = payload; if (!sid || !aid) return null;
  const okName = (p) => [`${aid}.jsonl`, `agent-${aid}.jsonl`].includes(basename(p));
  const cands = [];
  if (payload.agent_transcript_path && okName(payload.agent_transcript_path) && payload.agent_transcript_path.split('/').includes(sid)) cands.push(payload.agent_transcript_path);
  if (payload.transcript_path) { const base = join(dirname(payload.transcript_path), sid, 'subagents'); cands.push(join(base, `${aid}.jsonl`), join(base, `agent-${aid}.jsonl`)); }
  for (const p of cands) if (existsSync(p)) return { path: p, metaPath: p.replace(/\.jsonl$/, '.meta.json'), shape: SUPPORTED_SHAPES[0] };
  return null;
}
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n') : '');
export function parseTranscript(path) {
  const out = { firstTs: null, lastTs: null, firstUserText: '', records: 0, complete: false };
  let text; try { text = readFileSync(path, 'utf8'); } catch { return out; }
  let sawUser = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue; let r; try { r = JSON.parse(line); } catch { continue; }
    out.records++; const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (!Number.isNaN(t)) { const iso = new Date(t).toISOString(); if (!out.firstTs || iso < out.firstTs) out.firstTs = iso; if (!out.lastTs || iso > out.lastTs) out.lastTs = iso; if (r.type === 'user') sawUser = true; else if (sawUser) out.complete = true; }
    if (!out.firstUserText && r.type === 'user') out.firstUserText = textOf(r.message?.content);
  }
  return out;
}
const wordHit = (text, ref) => new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`).test(text ?? '');
export function resolveRefs(run, { description = '', firstUserText = '', branch = null }) {
  const tasks = run.items.filter((i) => i.level !== 'campaign' && !i.cancelled);
  const inDesc = tasks.filter((i) => wordHit(description, i.ref)); if (inDesc.length === 1) return { items: inDesc, how: 'description' }; if (inDesc.length > 1) return { items: [], how: 'ambiguous' };
  const inMsg = tasks.filter((i) => wordHit(firstUserText, i.ref)); if (inMsg.length === 1) return { items: inMsg, how: 'message' }; if (inMsg.length > 1) return { items: [], how: 'ambiguous' };
  if (branch) { const b = tasks.filter((i) => i.branch && i.branch.toLowerCase() === branch.toLowerCase()); if (b.length === 1) return { items: b, how: 'branch' }; }
  return { items: [], how: null };
}
export function appendOrRevise(repo, rec, opts) { let r = rec; for (let k = 0; k < 10; k++) { const res = appendObservation(repo, r, opts); if (res.result !== 'ID-CONFLICT') return res; r = { ...r, revision: r.revision + 1 }; } return { result: 'ID-CONFLICT', observation_id: rec.observation_id, revision: rec.revision }; }
function diagnose(repo, slug, kind, payload, detail, now) { try { mkdirSync(deliveryDir(repo), { recursive: true }); appendFileSync(join(deliveryDir(repo), `diagnostics-${slug}.jsonl`), `${JSON.stringify({ at: nowIso(now), kind, session: payload.session_id ?? null, agent_id: payload.agent_id ?? null, detail })}\n`); } catch { /* best effort */ } return kind; }
const capturePrompts = (repo) => { try { return Boolean(JSON.parse(readFileSync(join(deliveryDir(repo), 'profile.json'), 'utf8')).capturePrompts); } catch { return false; } };

export function handleStop(payload, { repo, now = Date.now() } = {}) {
  repo = resolveOwnerRepo(repo);
  const none = { wrote: [], diagnostic: null };
  if (!payload?.session_id || !payload?.agent_id) return none;
  if (!listRuns(repo).some((r) => r.status === 'open')) return none;
  const { slug } = whoAmI(repo);
  const run = sessionRun(repo, 'claude', payload.session_id);
  if (!run) return { wrote: [], diagnostic: diagnose(repo, slug, 'unbound-session', payload, 'run: delivery.mjs session set --host claude --session <id> --plan <run>', now) };
  const child = findChildTranscript(payload);
  let meta = {}; if (child) { try { meta = JSON.parse(readFileSync(child.metaPath, 'utf8')); } catch { meta = {}; } }
  if (!validRoster(run.roster)) return { wrote: [], diagnostic: diagnose(repo, slug, 'invalid-roster', payload, 'refresh plan roster with this installed skill', now) };
  const role = meta.agentType || payload.agent_type || null;
  let diagnostic = null;
  if (role && !rosterOf(run).has(role)) return none;
  if (!role) diagnostic = diagnose(repo, slug, 'unknown-role', payload, 'agentType missing — admitted, role test relaxed', now);
  if (!child) return { wrote: [], diagnostic: diagnose(repo, slug, 'no-transcript', payload, 'child transcript not found in a supported shape', now) };
  const tr = parseTranscript(child.path);
  if (!tr.firstTs) return { wrote: [], diagnostic: diagnose(repo, slug, 'no-transcript', payload, 'child transcript has no timestamps', now) };
  if (!tr.complete) diagnostic = diagnose(repo, slug, 'incomplete-transcript', payload, 'no completion evidence — dispatched recorded, dispatch_ended withheld', now);
  const description = meta.description ?? '';
  const stage = classifyStage(description) !== 'other' ? classifyStage(description) : classifyStage(tr.firstUserText);
  const branch = payload.cwd ? git(payload.cwd, ['branch', '--show-current']) : null;
  const { items } = resolveRefs(run, { description, firstUserText: tr.firstUserText, branch });
  const common = { user: null, host: 'claude', plan: run.run, source: 'hook', source_record_id: `claude:${payload.session_id}:${payload.agent_id}`, session: payload.session_id, agentId: payload.agent_id, role };
  const wrote = [];
  for (const it of (items.length ? items : [null])) {
    const label = it ? (capturePrompts(repo) ? description.slice(0, 120) : `${it.ref} ${stage}`) : stage;
    const base = it ? { item_id: it.item_id, ref: it.ref, level: it.level, meta: { stage, version: run.version } } : { item_id: null, ref: null, level: null, meta: { stage, version: run.version, unattributed: true } };
    const key = it ? it.item_id : 'unattributed';
    const mk = (event, at, extra = {}) => makeObservation({ ...common, ...base, label, event, at, transition_id: `${key}/${event}/${payload.agent_id}`, meta: { ...base.meta, ...extra } }, { now });
    wrote.push(appendOrRevise(repo, mk('dispatched', tr.firstTs), { slug, now }));
    if (tr.complete) wrote.push(appendOrRevise(repo, mk('dispatch_ended', tr.lastTs), { slug, now }));
    if (it && stage === 'fix') wrote.push(appendOrRevise(repo, mk('rework_observed', tr.firstTs, { round: null }), { slug, now }));
  }
  return { wrote, diagnostic };
}

async function main() {
  try {
    const raw = await readStdinBounded(); let payload = null; try { payload = JSON.parse(raw); } catch { return; }
    if (!process.argv.includes('--stop')) return;
    const repo = ownerRepo(payload, process.env); handleStop(payload, { repo });
    if (process.env.DELIVERY_NO_SYNC !== '1') { try { const { bestEffortSync } = await import('../scripts/lib/sync.mjs'); bestEffortSync(repo, { env: process.env }); } catch { /* best effort */ } }
  } catch { /* hooks never fail the host */ }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), () => process.exit(0));
```

- [ ] **Step 4: Run test to verify it passes** — 8 passing.

- [ ] **Step 5: Commit**
```bash
git add skills/delivery-metrics/hooks
git commit -m "feat(delivery-metrics): Claude SubagentStop hook — roster/session-guarded, correlated child transcripts, completion evidence"
```

---

### Task 12: `scripts/install-hooks.mjs` — Claude splice, ignore blocks, telemetry submodule bootstrap, `--remove`, `--doctor`

**Files:**
- Create: `skills/delivery-metrics/scripts/install-hooks.mjs`, `skills/delivery-metrics/scripts/install-hooks.test.mjs`
- Modify: `skills/delivery-metrics/scripts/delivery.mjs` (`doctor` command delegates to `doctorReport`)

**Interfaces:**
- Produces (exported): `MARKER = '_delivery'`; `skillRootOf(url)`; `installClaude(repo, rel, {local, remove}) → settingsPath` (one marked `SubagentStop` entry `{matcher:'*', hooks:[{type:'command', command:'node "<absolute-installed-skill>/hooks/dispatch-hook.mjs" --stop', timeout:30, async:true}], _delivery:true}`; removes only `_delivery` entries; preserves everything else); `installIgnoreBlocks(repo, {remove}) → {root, inner}` — root `.gitignore` block (`# >>> delivery-metrics (managed)` … `# <<< delivery-metrics`) with `.agents/telemetry/delivery/reports/`, `.agents/telemetry/delivery/.lock/`, `.agents/telemetry/delivery/.pending-*`; inner block in `.agents/telemetry/.gitignore` with `/delivery/reports/`, `/delivery/.lock/`, `/delivery/.pending-*` — **created** when `.agents/telemetry/` exists (git dir or plain dir), never only when the file already exists; `bootstrapTelemetry(repo) → {status: 'already'|'created'|'no-git'|'kept'}` — the tokenomics procedure (`bundles/test-automation/skills/tokenomics/scripts/install-hooks.mjs:329-404`) re-implemented: orphan `telemetry` branch via plumbing if absent (`hash-object -t tree /dev/null`, `commit-tree`, `update-ref`), move interim `.agents/telemetry` files aside and restore on any exit, untrack a previously committed `.agents/telemetry` (`rm -r --cached`), best-effort push of the branch, `git -c protocol.file.allow=always submodule add --force -b telemetry -- ./ .agents/telemetry`, `.gitmodules` `ignore = all`, seed `README.md` + inner `.gitignore`; idempotent (`already` when `.agents/telemetry/.git` exists); `doctorReport(repo, rel) → {lines, ok}` — hook wired; open runs; sessions; **every** ignore pattern checked with `git check-ignore` in its owning repo (main: three root patterns; inner: three patterns inside `.agents/telemetry` when it is a git dir); tracked transients (`git ls-files .agents/telemetry/delivery/reports .agents/telemetry/delivery/.lock` in the owner) reported; `gitState` of the telemetry owner (unmerged, merging, dirty, unpushed); diagnostics line count; unconditional caveats; `main(argv)`.
- Hook command pins the installed script’s absolute path, so a child’s `CLAUDE_PROJECT_DIR` cannot redirect it into a different checkout. Moving that installation requires re-running the installer. `main` and `doctorReport` resolve the shared owner with Task 1 before touching telemetry or settings.
- CLI: `install-hooks.mjs [--host claude] [--local] [--remove] [--doctor] [--no-submodule]`; other hosts → `UNSUPPORTED-HOST(<h>)` exit 2; default run = `bootstrapTelemetry` (unless `--no-submodule` or already) + `installClaude` + `installIgnoreBlocks`; prints `INSTALLED <settings>`, `ignore blocks: root=… inner=…`, `telemetry: <status>`; `--remove` strips hook + blocks only (never touches ledger data or the submodule).

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
import { installClaude, installIgnoreBlocks, doctorReport, bootstrapTelemetry, MARKER } from './install-hooks.mjs';

const SCRIPT = fileURLToPath(new URL('./install-hooks.mjs', import.meta.url));
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
const tmp = () => { const r = mkdtempSync(join(tmpdir(), 'dm-install-')); g(r, 'init', '-q', '-b', 'main'); g(r, 'commit', '-q', '--allow-empty', '-m', 'root'); return r; };
const REL = '.claude/skills/delivery-metrics';

test('installClaude: marked entry, foreign entries and later user edits preserved, idempotent, --remove strips ours only', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SubagentStop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node tok.mjs --dispatch', timeout: 60, async: true }], _tokenomics: true }] } }, null, 2));
  const file = installClaude(repo, REL, {}); let s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2); const ours = s.hooks.SubagentStop.find((e) => e[MARKER]); assert.match(ours.hooks[0].command, /dispatch-hook\.mjs" --stop$/); assert.equal(ours.hooks[0].async, true); assert.equal(ours.hooks[0].timeout, 30);
  assert.deepEqual(s.permissions, { allow: ['Bash(npm test)'] });
  installClaude(repo, REL, {}); s = JSON.parse(readFileSync(file, 'utf8')); assert.equal(s.hooks.SubagentStop.length, 2);
  s.hooks.SubagentStop.push({ matcher: 'x', hooks: [], note: 'user edit after install' }); writeFileSync(file, JSON.stringify(s));
  installClaude(repo, REL, { remove: true }); s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2); assert.ok(s.hooks.SubagentStop.some((e) => e._tokenomics)); assert.ok(s.hooks.SubagentStop.some((e) => e.note)); assert.ok(!s.hooks.SubagentStop.some((e) => e[MARKER]));
  assert.match(installClaude(repo, REL, { local: true }), /settings\.local\.json$/);
});

test('installIgnoreBlocks: root block replaced in place beside other owners; inner block created when the telemetry dir exists; remove strips ours only', () => {
  const repo = tmp();
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n# >>> tokenomics (managed)\n.agents/telemetry/automation/live/\n# <<< tokenomics\n');
  let r = installIgnoreBlocks(repo, {}); assert.equal(r.inner, 'skipped (no .agents/telemetry)');
  let gi = readFileSync(join(repo, '.gitignore'), 'utf8'); assert.match(gi, /# >>> delivery-metrics \(managed\)[\s\S]*\.agents\/telemetry\/delivery\/\.lock\/[\s\S]*# <<< delivery-metrics/); assert.match(gi, /tokenomics \(managed\)/);
  installIgnoreBlocks(repo, {}); assert.equal((readFileSync(join(repo, '.gitignore'), 'utf8').match(/delivery-metrics \(managed\)/g) || []).length, 1);
  mkdirSync(join(repo, '.agents', 'telemetry'), { recursive: true });
  r = installIgnoreBlocks(repo, {}); assert.equal(r.inner, 'installed'); assert.match(readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8'), /\/delivery\/reports\//, 'created even though no inner .gitignore existed');
  installIgnoreBlocks(repo, { remove: true }); gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(!/delivery-metrics/.test(gi)); assert.match(gi, /node_modules/); assert.match(gi, /tokenomics/); assert.ok(!/delivery/.test(readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8')));
});

test('bootstrapTelemetry: creates the self-referential submodule on the telemetry branch, keeps interim files, idempotent', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.agents', 'telemetry', 'delivery'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', 'delivery', 'events-u.jsonl'), '{"v":2}\n');
  assert.equal(bootstrapTelemetry(repo).status, 'created');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', '.git'))); assert.equal(g(repo, 'rev-parse', '--verify', 'refs/heads/telemetry').length, 40);
  assert.match(readFileSync(join(repo, '.gitmodules'), 'utf8'), /ignore = all/); assert.equal(g(join(repo, '.agents', 'telemetry'), 'branch', '--show-current'), 'telemetry');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'delivery', 'events-u.jsonl')), 'interim file restored'); assert.ok(existsSync(join(repo, '.agents', 'telemetry', '.gitignore')));
  assert.equal(bootstrapTelemetry(repo).status, 'already');
  assert.equal(bootstrapTelemetry(mkdtempSync(join(tmpdir(), 'nogit-'))).status, 'no-git');
});

test('installer and doctor use the same main owner from a linked worktree', () => {
  const repo = tmp();
  const wt = join(mkdtempSync(join(tmpdir(), 'dm-linked-')), 'linked'); g(repo, 'commit', '-q', '--allow-empty', '-m', 'init'); g(repo, 'worktree', 'add', '-q', '-b', 'linked', wt);
  execFileSync('node', [SCRIPT, '--no-submodule'], { cwd: wt, env: { ...process.env, CLAUDE_PROJECT_DIR: wt } });
  assert.equal(existsSync(join(repo, '.claude', 'settings.json')), true);
  assert.equal(existsSync(join(wt, '.claude', 'settings.json')), false);
  assert.deepEqual(doctorReport(wt, 'skills/delivery-metrics'), doctorReport(repo, 'skills/delivery-metrics'));
});

test('doctorReport: wiring, plans, every ignore pattern in its owner, tracked transients, git state, caveats', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /hook: not wired/.test(l))); assert.ok(d.lines.some((l) => /plans: 0 open/.test(l))); assert.ok(d.lines.some((l) => /telemetry: plain-dir/.test(l))); assert.equal(d.ok, false);
  bootstrapTelemetry(repo); installClaude(repo, REL, {}); installIgnoreBlocks(repo, {});
  d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /hook: wired/.test(l))); assert.ok(d.lines.some((l) => /ignore root: ok \(3\/3\)/.test(l))); assert.ok(d.lines.some((l) => /ignore inner: ok \(3\/3\)/.test(l))); assert.ok(d.lines.some((l) => /telemetry: submodule/.test(l))); assert.ok(d.lines.some((l) => /caveat: concurrency: best-effort/.test(l)));
  mkdirSync(join(repo, '.agents', 'telemetry', 'delivery', 'reports'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', 'delivery', 'reports', 'x.html'), 'x');
  g(join(repo, '.agents', 'telemetry'), 'add', '-f', 'delivery/reports/x.html');
  d = doctorReport(repo, REL); assert.ok(d.lines.some((l) => /tracked transients: 1/.test(l))); assert.equal(d.ok, false);
});

test('script: --host copilot exits 2 UNSUPPORTED-HOST; default installs and prints INSTALLED', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let code = 0, err = ''; try { execFileSync('node', [SCRIPT, '--host', 'copilot'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2); assert.match(err, /^UNSUPPORTED-HOST\(copilot\)/);
  const out = execFileSync('node', [SCRIPT, '--no-submodule'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(out, /INSTALLED .*settings\.json/); assert.match(out, /telemetry: plain-dir/); assert.ok(existsSync(join(repo, '.claude', 'settings.json')));
});
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write `install-hooks.mjs`**

```js
#!/usr/bin/env node
// STDLIB ONLY. Opt-in Claude SubagentStop capture + shared telemetry submodule (spec §6.1, §6.6, D15). Installing the skill never wires this.
import { realpathSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir, sessionsDir, resolveOwnerRepo } from './lib/paths.mjs';
import { listRuns } from './lib/plan.mjs';
import { git as gitq, gitState } from './lib/git.mjs';

export const MARKER = '_delivery';
export const skillRootOf = (url = import.meta.url) => dirname(dirname(fileURLToPath(url)));
const posix = (p) => p.split('\\').join('/');
const readJson = (p, fb) => { if (!existsSync(p)) return fb; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const writeJson = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`); };
const CAVEATS = ['concurrency: best-effort (advisory 60 s mkdir lock; no cross-process guarantee)', 'sync: best-effort (unresolved merges are surfaced, never resolved)', 'hook-transcript-shapes: provisional until SPIKE-1'];

export function installClaude(repo, rel, { local = false, remove = false } = {}) {
  const file = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(file, {}); settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const kept = (Array.isArray(settings.hooks.SubagentStop) ? settings.hooks.SubagentStop : []).filter((e) => !e || !e[MARKER]);
  if (!remove) kept.push({ matcher: '*', hooks: [{ type: 'command', command: `node "${posix(resolve(repo, rel, 'hooks/dispatch-hook.mjs'))}" --stop`, timeout: 30, async: true }], [MARKER]: true });
  if (kept.length) settings.hooks.SubagentStop = kept; else delete settings.hooks.SubagentStop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings); return file;
}

const BEGIN = '# >>> delivery-metrics (managed)', END = '# <<< delivery-metrics';
const ROOT_PATTERNS = ['.agents/telemetry/delivery/reports/', '.agents/telemetry/delivery/.lock/', '.agents/telemetry/delivery/.pending-*'];
const INNER_PATTERNS = ['/delivery/reports/', '/delivery/.lock/', '/delivery/.pending-*'];
function spliceBlock(file, lines, remove) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const re = new RegExp(`\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*[\\s\\S]*?${END}\\n?`);
  const stripped = text.replace(re, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  if (remove) { if (!text) return 'absent'; writeFileSync(file, stripped); return 'removed'; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${stripped.replace(/\n*$/, stripped ? '\n\n' : '')}${BEGIN} — transients only; plans/events/calibration stay COMMITTED\n${lines.join('\n')}\n${END}\n`);
  return 'installed';
}
export function installIgnoreBlocks(repo, { remove = false } = {}) {
  const root = spliceBlock(join(repo, '.gitignore'), ROOT_PATTERNS, remove);
  const tel = join(repo, '.agents', 'telemetry');
  const inner = existsSync(tel) ? spliceBlock(join(tel, '.gitignore'), INNER_PATTERNS, remove) : 'skipped (no .agents/telemetry)';
  return { root, inner };
}

const TELEMETRY_README = '# telemetry\n\nShared durable telemetry submodule (branch `telemetry`), one subfolder per factory or cross-factory concern: `automation/` (tokenomics), `delivery/` (delivery-metrics). Nobody hand-commits here; each capture moment commits and pushes best-effort.\n';
/** Ported from tokenomics install-hooks.mjs:329-404 — same branch, same layout, so both skills share one submodule. */
export function bootstrapTelemetry(repo) {
  const dir = join(repo, '.agents', 'telemetry');
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim();
  try { git(['rev-parse', '--git-dir']); } catch { return { status: 'no-git' }; }
  if (existsSync(join(dir, '.git'))) return { status: 'already' };
  const stash = `${dir}.pre-submodule`; let stashed = false;
  const restore = () => { if (!stashed || !existsSync(stash)) return; try { mkdirSync(dir, { recursive: true }); for (const n of readdirSync(stash)) if (!existsSync(join(dir, n))) renameSync(join(stash, n), join(dir, n)); if (!readdirSync(stash).length) rmSync(stash, { recursive: true, force: true }); stashed = false; } catch { /* data preserved in stash; doctor surfaces it */ } };
  try {
    try { git(['rev-parse', '--verify', 'refs/heads/telemetry']); } catch {
      try { git(['rev-parse', '--verify', 'refs/remotes/origin/telemetry']); git(['branch', 'telemetry', 'origin/telemetry']); }
      catch { const tree = git(['hash-object', '-t', 'tree', '/dev/null']); const commit = git(['commit-tree', tree, '-m', 'telemetry: root']); git(['update-ref', 'refs/heads/telemetry', commit]); }
    }
    if (existsSync(dir) && readdirSync(dir).length) { renameSync(dir, stash); stashed = true; }
    try { if (git(['ls-files', '.agents/telemetry'])) git(['rm', '-r', '-q', '--cached', '.agents/telemetry']); } catch { /* nothing tracked */ }
    try { git(['push', 'origin', 'refs/heads/telemetry:refs/heads/telemetry']); } catch { /* no remote / offline */ }
    git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '--force', '-b', 'telemetry', '--', './', '.agents/telemetry']);
    git(['config', '-f', '.gitmodules', 'submodule..agents/telemetry.ignore', 'all']); git(['add', '.gitmodules']);
    restore();
    if (!existsSync(join(dir, 'README.md'))) writeFileSync(join(dir, 'README.md'), TELEMETRY_README);
    spliceBlock(join(dir, '.gitignore'), INNER_PATTERNS, false);
    return { status: 'created' };
  } catch (e) { restore(); return { status: 'failed', reason: String(e.message).split('\n')[0] }; }
}

export function telemetryMode(repo) { return existsSync(join(repo, '.agents', 'telemetry', '.git')) ? 'submodule' : 'plain-dir'; }

export function doctorReport(repo, rel) {
  repo = resolveOwnerRepo(repo);
  const lines = []; let ok = true;
  const settings = readJson(join(repo, '.claude', 'settings.json'), {}), local = readJson(join(repo, '.claude', 'settings.local.json'), {});
  const wired = [...(settings.hooks?.SubagentStop ?? []), ...(local.hooks?.SubagentStop ?? [])].some((e) => e && e[MARKER]);
  lines.push(`hook: ${wired ? 'wired' : 'not wired'} (Claude SubagentStop, marker ${MARKER})`); if (!wired) ok = false;
  const runs = listRuns(repo); lines.push(`plans: ${runs.filter((r) => r.status === 'open').length} open, ${runs.length} total`);
  lines.push(`sessions bound: ${existsSync(sessionsDir(repo)) ? readdirSync(sessionsDir(repo)).length : 0}`);
  const check = (cwd, patterns, probe) => patterns.filter((p) => { try { execFileSync('git', ['-C', cwd, 'check-ignore', '-q', probe(p)], { stdio: 'ignore' }); return true; } catch { return false; } }).length;
  const rootOk = check(repo, ROOT_PATTERNS, (p) => p.replace(/\*$/, 'x').replace(/\/$/, '/x')); lines.push(`ignore root: ${rootOk === ROOT_PATTERNS.length ? 'ok' : 'MISSING'} (${rootOk}/${ROOT_PATTERNS.length})`); if (rootOk !== ROOT_PATTERNS.length) ok = false;
  const tel = join(repo, '.agents', 'telemetry'); const mode = telemetryMode(repo); lines.push(`telemetry: ${mode}${mode === 'plain-dir' ? ' (records ride the main tree until install-hooks.mjs bootstraps the shared submodule)' : ''}`);
  if (mode === 'submodule') {
    const innerOk = check(tel, INNER_PATTERNS, (p) => p.replace(/^\//, '').replace(/\*$/, 'x').replace(/\/$/, '/x')); lines.push(`ignore inner: ${innerOk === INNER_PATTERNS.length ? 'ok' : 'MISSING'} (${innerOk}/${INNER_PATTERNS.length})`); if (innerOk !== INNER_PATTERNS.length) ok = false;
    const tracked = (gitq(tel, ['ls-files', 'delivery/reports', 'delivery/.lock']) ?? '').split('\n').filter(Boolean); lines.push(`tracked transients: ${tracked.length}${tracked.length ? ` — ${tracked.join(', ')} (git -C .agents/telemetry rm --cached <path>)` : ''}`); if (tracked.length) ok = false;
    const s = gitState(tel); lines.push(`telemetry git: unmerged=${s.unmerged.length} merging=${s.merging} dirty=${s.dirty} unpushed=${s.unpushed ?? 'no upstream'}`); if (s.unmerged.length || s.merging) ok = false;
  }
  const diag = existsSync(deliveryDir(repo)) ? readdirSync(deliveryDir(repo)).filter((f) => f.startsWith('diagnostics-')) : [];
  lines.push(`diagnostics: ${diag.reduce((n, f) => n + readFileSync(join(deliveryDir(repo), f), 'utf8').split('\n').filter(Boolean).length, 0)} line(s)`);
  for (const c of CAVEATS) lines.push(`caveat: ${c}`);
  return { lines, ok };
}

export function main(argv = process.argv.slice(2), repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) {
  repo = resolveOwnerRepo(repo);
  const has = (f) => argv.includes(f); const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const host = val('--host') ?? 'claude'; if (host !== 'claude') { process.stderr.write(`UNSUPPORTED-HOST(${host})\n`); return 2; }
  const rel = posix(relative(repo, skillRootOf()));
  if (has('--doctor')) { for (const l of doctorReport(repo, rel).lines) console.log(l); return 0; }
  const remove = has('--remove');
  let tel = { status: 'kept' }; if (!remove && !has('--no-submodule')) tel = bootstrapTelemetry(repo);
  const file = installClaude(repo, rel, { local: has('--local'), remove }); const ig = installIgnoreBlocks(repo, { remove });
  console.log(`${remove ? 'REMOVED' : 'INSTALLED'} ${file}`); console.log(`ignore blocks: root=${ig.root} inner=${ig.inner}`); console.log(`telemetry: ${telemetryMode(repo)} (${tel.status}${tel.reason ? `: ${tel.reason}` : ''})`);
  return 0;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
```

- [ ] **Step 4: Wire `doctor` into `delivery.mjs`** — `import { doctorReport, skillRootOf } from './install-hooks.mjs';` `function cmdDoctor(repo, p, io) { for (const l of doctorReport(repo, relative(repo, skillRootOf(import.meta.url))).lines) out(io, l); return 0; }` (add `relative` to the `node:path` import; `doctor: cmdDoctor` in `COMMANDS`).

- [ ] **Step 5: Run tests** — `node --test skills/delivery-metrics` green; `npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` green.

- [ ] **Step 6: Commit**
```bash
git add skills/delivery-metrics/scripts
git commit -m "feat(delivery-metrics): installer — Claude SubagentStop splice, ignore blocks, telemetry submodule bootstrap, --remove, --doctor"
```

---

### Task 13: Factory wiring, references, README, final gates

**Files:**
- Modify: `bundles/feature-development/agents/tech-lead/AGENT.md` (§ 3 "Create Technical Tasks", § 5 "Handoff to PM"), `bundles/feature-development/agents/project-manager/AGENT.md` (§ Session Start, § Execution mode, § Merging approved PRs step 5, § Handling Blockers, § Status Report Format), `bundles/feature-development/agents/scout/AGENT.md`, `bundles/feature-development/instructions.md`, `bundles/test-automation/agents/scout/AGENT.md`, `bundles/test-automation/agents/test-automation-lead/AGENT.md`
- Create: `skills/delivery-metrics/references/event-model.md`, `references/metrics.md`, `references/plan-block.md`, `templates/plan-block.template.md`
- Modify: `skills/delivery-metrics/README.md`

- Create: `skills/delivery-metrics/scripts/installed.test.mjs` (six isolated installed CLI smokes).

**Interfaces:** Task 1 roster snapshot is consumed by the installed CLI smokes; prose names the exact commands from Tasks 5, 9, 12. The spec is **not** edited by this task.

- [ ] **Step 1: Agent frontmatter** — add `delivery-metrics` to `skills-on-demand:` of `feature-development/agents/{tech-lead,project-manager,scout}` and `test-automation/agents/{scout,test-automation-lead}` (create the key when absent). Never `skills:`. Keep any value containing `: ` quoted.

- [ ] **Step 2: tech-lead prose** — after the task template in § 3 add:
```markdown
**Delivery-plan block (delivery-metrics).** The decomposition document also
carries one fenced ```` ```json delivery-plan ```` block — the machine-readable
plan the `delivery-metrics` skill registers (template:
`.claude/skills/delivery-metrics/templates/plan-block.template.md`). Every
task keeps its `Complexity` and gets a **ranged elapsed-hours estimate**
`{"unit":"h","low":…,"high":…,"tier":"ROM|budgetary|calibrated"}`, one per
group/milestone and one for the campaign. You **propose** the ranges
(`proposed_by: tech-lead`); a named human **accepts** them (`accepted_by`,
`accepted_at`) before they count — an unaccepted range is recorded but
excluded from accuracy, and a changed range needs a new acceptance. Consult
the latest `.agents/telemetry/delivery/calibration/` snapshot (M3) when one
exists. Developers still never estimate.
```
In § 5 "Handoff to PM" add: `Register the plan: node .claude/skills/delivery-metrics/scripts/delivery.mjs plan register --from <plan file> --id <plan-slug>-v<n> (a re-cut adds --at <effective iso>).`

- [ ] **Step 3: project-manager prose**
- § Session Start: "If `.agents/telemetry/delivery/plans/` has an open run, bind this session once: `node .claude/skills/delivery-metrics/scripts/delivery.mjs session set --host claude --session <session id> --plan <run>` (the id is in the tokenomics announce line when that is on; otherwise the newest `.jsonl` under `~/.claude/projects/<project>/`)."
- § Execution mode: "**The first line of every dispatch prompt names the `TASK-NNN`** and the stage word (implement / review / fix round) so the delivery hook can attribute it."
- § Merging approved PRs step 5: `node .claude/skills/delivery-metrics/scripts/delivery.mjs event <TASK-NNN> done --sha <merge sha> --id done-<NNN>` (PR mode: `--at <mergedAt>`); when a group/milestone has landed to base: `event <Gn> done --sha <landing sha> --id land-<Gn>`; a task dropped from scope: `event <TASK-NNN> cancelled --raw "<why>" --id cancel-<NNN>`.
- § Handling Blockers: `event <TASK-NNN> blocked --id blk-<NNN>-<n>` / `unblocked` (recorded now, derived in M2).
- § Status Report Format: add `### Delivery` = output of `node .claude/skills/delivery-metrics/scripts/delivery.mjs status`.

- [ ] **Step 4: scout opt-in (both factories) and instructions.md** — next to the tokenomics question (`test-automation/agents/scout/AGENT.md:105`; the equivalent onboarding step in `feature-development/agents/scout/AGENT.md`): "Ask once whether the team wants **delivery tracking** (cycle time, weekly throughput, estimate-vs-actual per task/mission/campaign into the shared telemetry submodule). If yes, run `node .claude/skills/delivery-metrics/scripts/install-hooks.mjs` (bootstraps the telemetry submodule when tokenomics has not, wires the Claude hook) and note the decision in the seed report; the tracker also works without the hook through the CLI and `backfill --git`."
`feature-development/instructions.md`: add
```markdown
## Delivery tracking (delivery-metrics)

Three moments, all recorded — never estimated: the tech-lead's plan block is
**registered** (`delivery.mjs plan register`), every merge, landing or
cancellation is **recorded** by the PM at the moment it happens
(`delivery.mjs event … done --sha`), and the report is read at mission close
(`delivery.mjs report`). Dispatch starts come from the opt-in Claude hook;
history from `backfill --git`. Mission state lives in this ledger
(`.agents/telemetry/delivery/`), not in either memory layer.
```
and reword the existing sentence "Mission state belongs on the work board, not in either memory layer" to "Mission state belongs in the delivery ledger (see Delivery tracking), not in either memory layer."

- [ ] **Step 5: References, template, README**
- `references/event-model.md`: the §6.2 field table with this plan's representation choices (run-scoped `item_id`, `plan` = run, `meta.version`), the 18 events with which ones M1 derives / accepts-and-defers, identity rules (`observation_id`, `revision`, `transition_id`), read-time resolution order, source precedence with the two CONFLICT kinds.
- `references/metrics.md`: one row per M1 metric — name, start event, stop event, unit (seconds internal, hours rendered), floors, exclusion counters, caveat text — plus the exclusion-reason order for estimates and the "M2+" list.
- `references/plan-block.md`: block schema (Task 3 rules), estimate object, acceptance semantics (new pair on change; calibrated reference), re-cut (`version`, `--at`, `supersedes`), importer limits.
- `templates/plan-block.template.md`: a filled example block with two missions and three tasks, `accepted_by: null` placeholders, and a comment telling the tech-lead what to fill.
- `README.md`: finish the quick start (register → bind session → record → backfill → report), the telemetry mode note (submodule bootstrap vs plain-dir), "What it does not do" (spec §8/§18), and the references list.

- [ ] **Step 6: Final gates (offline)**

Run in the worktree root:
```bash
npm test && npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes
npx --no-install skills-ref validate skills/delivery-metrics || echo "skills-ref not installed locally — CI runs it"
installer="$PWD/bin/init.mjs"
for t in claude copilot codex; do d=$(mktemp -d); (cd "$d" && node "$installer" init --skills delivery-metrics --target "$t" --yes) || exit 1; done
```
The standalone `--skills delivery-metrics` install pulls no external (`repo:`) skills, so it is offline; each smoke runs inside a fresh directory because the installer uses cwd. Step 6a covers both factories, their external dependencies, and installed CLI execution. Expected: the skill directory placed for each target; no hook wired; `npm test` green. If online, also `npm run validate:externals`; otherwise record `validate:externals: not run (offline)` in the commit message.

- [ ] **Step 6a: Execute six installed CLI smokes without source-checkout access at runtime**

Create `skills/delivery-metrics/scripts/installed.test.mjs` with the following offline fixture. External skills are local test stubs, not upstream-validation evidence. Git URL rewriting handles the installer's unconditional fetch; file-only transport makes accidental network access fail. Each runtime uses a physical copy of installed output after deleting the first install directory; no source factory manifests or runtime checkout paths are passed. All six combinations must register, bind, record and report; named-role admission is separately covered by Task 11's multi-factory and foreign-role fixtures.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const sandbox = mkdtempSync(join(tmpdir(), 'dm-installed-'));
const config = join(sandbox, 'gitconfig'); writeFileSync(config, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', SDLC_SKILLS_CACHE_DIR: join(sandbox, 'cache'), DELIVERY_NO_SYNC: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const entries = JSON.parse(readFileSync(join(root, 'skills.json'), 'utf8')).skills.filter((e) => e.repo);
for (const repo of new Set(entries.map((e) => e.repo))) {
  const mirror = join(sandbox, 'mirrors', repo.replaceAll('/', '__')); mkdirSync(mirror, { recursive: true });
  git(mirror, 'init', '-q', '-b', 'fixture');
  const mine = entries.filter((e) => e.repo === repo);
  for (const e of mine) {
    const dir = join(mirror, e.subdir ?? ''); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${e.id}\ndescription: Offline installer fixture\n---\n# Fixture\n`);
  }
  git(mirror, 'add', '.'); git(mirror, 'commit', '-q', '-m', 'fixtures');
  for (const ref of new Set(mine.map((e) => e.ref ?? 'main'))) git(mirror, 'branch', ref);
  git(sandbox, 'config', '--file', config, `url.file://${mirror}.insteadOf`, `https://github.com/${repo}`);
}
for (const factory of ['feature-development', 'test-automation']) for (const [target, dir] of [['claude', '.claude'], ['copilot', '.github'], ['codex', '.codex']]) {
  test(`installed CLI: ${factory}/${target}`, () => {
    const installed = mkdtempSync(join(sandbox, 'install-'));
    execFileSync('node', [join(root, 'bin/init.mjs'), 'init', '--factory', factory, '--target', target, '--yes'], { cwd: installed, env, stdio: 'pipe' });
    const consumer = mkdtempSync(join(sandbox, 'consumer-')); cpSync(installed, consumer, { recursive: true, dereference: true }); rmSync(installed, { recursive: true });
    const skill = join(consumer, dir, 'skills', 'delivery-metrics');
    assert.ok(existsSync(join(skill, 'references', 'factory-roles.json')));
    const cli = (...args) => execFileSync('node', [join(skill, 'scripts/delivery.mjs'), ...args], { cwd: consumer, env: { ...env, CLAUDE_PROJECT_DIR: consumer }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const block = { campaign_id: 'smoke', run_id: 'r1', version: 1, factory, observation_start: '2026-09-14T00:00:00Z', source_epoch: { from: '2026-09-14T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'smoke' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001' }] }] };
    writeFileSync(join(consumer, 'plan.json'), JSON.stringify(block));
    assert.match(cli('plan', 'register', '--from', 'plan.json', '--id', 'r', '--created-at', '2026-09-14T00:00:00Z'), /PLAN smoke\/r1/);
    const saved = JSON.parse(cli('plan', 'show', '--plan', 'smoke/r1'));
    assert.deepEqual(saved.roster.factories, [factory]);
    assert.ok(saved.roster.agents.includes(factory === 'feature-development' ? 'js-dev' : 'test-automation-lead'));
    assert.ok(!saved.roster.agents.includes('qa-auditor'));
    assert.match(cli('session', 'set', '--host', target, '--session', 's', '--plan', 'smoke/r1'), /SESSION/);
    cli('event', 'TASK-001', 'dispatched', '--id', 'd', '--at', '2026-09-14T09:00:00Z');
    cli('event', 'TASK-001', 'done', '--id', 'f', '--at', '2026-09-14T11:00:00Z');
    const report = JSON.parse(cli('report', '--json', '--cutoff', '2026-09-17T00:00:00Z'));
    assert.equal(report.plans[0].metrics.flow.task.strata.all.cycle_time.min, 7200);
    assert.match(cli('doctor'), /plans: 1 open/);
  });
}
```

Run `node --test skills/delivery-metrics/scripts/installed.test.mjs` → six passing. Arithmetic: 11:00 − 09:00 = 2 × 3600 = 7,200 seconds. Also add to README: default roster = installed roles intersected with the shipped map for `factory`; multi-factory registration supplies `--factories feature-development,test-automation`. `--roster`/`plan roster --agents` assert the computed union; unknown factories/foreign roles fail with `USAGE`. The hook consumes the validated saved snapshot, with no checkout-manifest lookup.

- [ ] **Step 7: Commit**
```bash
git add bundles/feature-development bundles/test-automation skills/delivery-metrics
git commit -m "feat(delivery-metrics): factory wiring (tech-lead block, PM moments, scout opt-in), references, README"
```

---

## Self-review (run by the plan author before hand-off)

1. **Spec coverage (M1 rows of §13):** plan block + estimates → Tasks 3, 5; markdown importer → Task 4; `event`/`backfill`/hook/installer → Tasks 5, 9, 11, 12; storage §6.1 (append-only, advisory lock, best-effort sync incl. unmerged check, submodule bootstrap) → Tasks 1, 2, 5, 12; timeline §6.9 (M1 subset with validation) → Task 6; metrics §6.10 (cycle/commit_to_done/lead, throughput/velocity with declared coverage, estimate delta per item and stratum, schedule variance, coverage) → Task 7; `status`/`report` §6.11 → Task 8; feature-development wiring §9.1 + scout → Task 13; golden §12/AC-3 → Task 10; M-1 docs + P-0/P-1 + SPIKE-1 procedure → Task 0. Deferred (M2+): review completeness, blocked/reopen derivation, PR-mode backfill, HTML/`--calibrate`/`--from-json`, automation adapter, cost join.
2. **Placeholders:** none — every step carries code or an exact edit.
3. **Type consistency:** `makeObservation`/`validateRecord` (Task 2) are what Tasks 3/5/9/11 use; `factKey` is consumed by Task 6; `Item` (Task 6, `first_completion`/`current_scope` and compatibility first-delivery clocks, incl. `created_sha`, `done_sha`, `landing_at`, `rework_count`, `reopened`, `version_added`) is what Task 7/8 read; `appendObservation` result `{result, observation_id, revision, path}` is used by Tasks 5, 9, 11; `assemble` doc shape is what `renderMarkdown`/`renderStatus`/golden consume; `resolveRun`/`loadRun`/`saveRun`/`listRuns` names are consistent across Tasks 3, 5, 8, 9, 11, 12; CLI error codes match Global Constraint 8.

## Review rounds

### v1 findings → v2 (applied by the plan author, 2026-09-17)

| F | Resolution | Where |
|---|---|---|
| F1 | resolved — bounded execution-block parser, columns/continuations, dependency notes stripped; real-file check `30 59 59 59` | Task 4 |
| F2 | resolved — request digest per token; identical retry re-emits (SKIP) from the stored version snapshot; reused token → ID-CONFLICT | Task 5 |
| F3 | resolved — mutually exclusive exclusion order; `excluded_item`/`clock_skew` counters; fixture recomputed | Task 7 |
| F4 | resolved — normalised default `since`; age 255 h | Task 8 |
| F5 | resolved — separate no-evidence fixture repo | Task 9 |
| F6 | resolved — extractor reuses the importer's parsers, `address review( N)?`, reconciles 59/30/33/11 and unique membership; provenance in dataset | Task 10 |
| F7 | resolved — highest revision first; ledger conflicts carried into occurrence selection and block lower-rank fallback | Tasks 2, 6, 8 |
| F8 | resolved — run-scoped `item_id`; `factKey` includes plan/stage/round/result/sha/pr/version | Tasks 2, 3 |
| F9 | resolved — ledger `plan` = run; run file accumulates versions; report replays all versions of a run | Tasks 3, 5, 8 |
| F10 | resolved — explicit + generated id uniqueness validated; supersedes endpoints validated; map applied as validation only (renames must keep ids) — resolved by narrowing for M1 | Tasks 3, 5 |
| F11 | resolved — landing evidence required for missions; derived start never overridden; scope-cancelled children retained and counted | Task 6 |
| F12 | resolved — CLI transition validation; replay quarantines invalid chains; dispatch after done is activity; reopen counted as deferred episode | Tasks 5, 6 |
| F13 | resolved — seconds throughout; rounding only in renderers | Tasks 7, 8 |
| F14 | resolved — per-clock skew counters; retrospective rule needs same-commit evidence (`created_sha === done_sha`) | Task 7 |
| F15 | resolved — `weekKeys(since, end, coverageStart)`; only fully covered whole weeks feed velocity | Task 7 |
| F16 | resolved — `estimateChange` requires a newer acceptance pair; calibrated needs `reference` | Tasks 2, 3 |
| F17 | resolved — explicit child path accepted only when correlated; `complete` flag gates `dispatch_ended` | Task 11 |
| F18 | resolved — head validated against the integration ref; epoch filtered before selection; earliest merge = episode-1 | Task 9 |
| F19 | resolved — `gitState` unmerged/merging check before staging | Task 5 |
| F20 | resolved — shared `validateRecord` on append and read; fatal UTF-8 decode; path:line diagnostics | Task 2 |
| F21 | resolved — per-item `firstCommitContaining` at registration | Task 5 |
| F22 | resolved — `estimate_rows` in JSON and Markdown | Tasks 7, 8 |
| F23 | resolved — strata by class and tier; `--level/--class`; source shares; quality denominators `unknown` | Tasks 7, 8 |
| F24 | resolved — files hashed once at read; evidence locators on records; plan file hash vs canonical hash; profile hash; schema versions | Tasks 2, 8 |
| F25 | resolved — unconditional caveats; registration_gaps; unregistered counted before filtering | Task 8 |
| F26 | resolved — roster snapshot on the run (`roster_agents`, `plan roster`); hook checks it | Tasks 5, 11 |
| F27 | resolved by limitation — SPIKE-1 procedure + `SUPPORTED_SHAPES`; `ownerRepo` via `git-common-dir`; provisional caveat printed until real fixtures land | Tasks 0, 11 |
| F28 | resolved — submodule bootstrap ported into `install-hooks.mjs`; no spec rewrite; plain-dir reported honestly | Task 12 |
| F29 | resolved — fetch/merge/one retry; sync in `finally` | Task 5 |
| F30 | resolved — inner block created when the dir exists; doctor checks all patterns, tracked transients, git state | Task 12 |
| F31 | resolved — `cliError` for every user-input failure; NO-EVENTS before end; `--sha`+`--at` correction via `--revision` | Tasks 1, 5, 8 |
| F32 | resolved — band `[vs_high, vs_low]`; zero-midpoint counted; `no_eligible_latest` reason | Task 7 |
| F33 | resolved — `--from-json` deferred to M4; both-factory + three-host standalone smokes offline; `skills-ref` availability handled | Tasks 8, 13 |

### v2 findings → v3

4 findings addressed: 1 blocker, 3 majors; 4 resolved, 0 rejected. The review cites the earlier 710-line snapshot; these repairs apply to the executable 3,242-line v2 present at the start of this round, preserving its code and tasks.

| F | Resolution | Where |
|---|---|---|
| F1 | resolved | Tasks 3, 5, 8, 9: explicit clock → pinned per-item first-containing commit → registration time; shared Git helper, saved request clocks/observations and historical registration tests without backfill. |
| F2 | resolved | Tasks 1, 5, 11, 13: shipped factory map, installed-role intersection and validated snapshot; multi-factory/foreign-role hook fixtures and six offline installed CLI smokes. |
| F3 | resolved | Tasks 1, 5, 8, 11, 12: common owner before telemetry exists; source evidence remains in the invoking checkout; linked-worktree register/bind/capture/report and installer/doctor tests. |
| F4 | resolved | Tasks 5–8: effective membership replay, first_completion separate from current_scope, new-scope landing boundary, Monday/Tuesday regression, first-delivery accuracy/throughput and pending WIP/status. |

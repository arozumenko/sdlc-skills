# Research 01 — tokenomics skill internals (map for a sibling "delivery tracker")

Source root: `/Users/Daniel_Sallai/dev/sdlc-skills/bundles/test-automation/skills/tokenomics/`
(all relative paths below are under that root unless prefixed `bundles/…`). Line numbers are from the
working tree on branch `feat/security-testing-bundle-spec` as of 2026-09-16.

Registered in `bundles/test-automation/factory.json:30` (`localSkills`), loaded on demand by scout
(`bundles/test-automation/agents/scout/AGENT.md:11` `skills-on-demand: [automation-scoping, efficiency-audit, tokenomics, session-retrospective]`).
Seeding step 6.7 in `bundles/test-automation/skills/seeding-automation-project/SKILL.md:319-348` installs it
by default. The shared-submodule rule is codified in `bundles/SPEC.md:298-304`.

---

## 1. Directory layout and responsibilities

```
tokenomics/
├── SKILL.md                         436 lines — user-facing contract (frontmatter: name, description, license, compatibility, metadata.authors/version)
├── README.md                        182 lines — "2-minute guide": setup, daily flow, I-want→run-Y table, what goes where, files on disk
├── hooks/
│   ├── telemetry-capture.mjs       1499 lines — THE capture engine: parses Claude/Copilot/VS Code stores, writes ledger + live log, sweep, ccusage metering, sync
│   ├── telemetry-capture.test.mjs   837 lines
│   ├── scope-hook.mjs               213 lines — session-scope contract hooks: --announce / --mark-dispatch / --gate (Claude + Copilot encodings)
│   ├── scope-hook.test.mjs          133 lines
│   ├── otel-sink.mjs                101 lines — stdlib OTLP/HTTP receiver (localhost:4318) → ~/.tokenomics-otel/otel-<day>.jsonl
│   └── otel-sink.test.mjs            83 lines
├── scripts/
│   ├── install-hooks.mjs            786 lines — opt-in switch: wires hooks per host, gitignore block, submodule, layout migration, --doctor, --pull, --otel
│   ├── install-hooks.test.mjs       269 lines
│   ├── work-scope.mjs               339 lines — scope record CLI: open / outcome / close / status / show / list; close renders batch reports + export row
│   ├── work-scope.test.mjs          155 lines
│   ├── batch-cost.mjs               763 lines — cost.json builder: ledger × receipt join, per-case direct/loaded, overhead, drift, sizing, live lines
│   ├── batch-cost.test.mjs          628 lines
│   ├── team-report.mjs              873 lines — ledger loading/dedup, team rollup, batch renderers (md/html), tokenomics view, HTML chrome
│   ├── team-report.test.mjs         226 lines
│   ├── build-tokenomics-export.mjs  298 lines — hyperfactory dataset: segment header, one row per batch, §7 checklist, submission folder, --compare
│   ├── otel-report.mjs              177 lines — inspector for the sink's files (never merged into the ledger)
│   └── otel-report.test.mjs         101 lines
├── templates/
│   └── factory-profile.template.json 31 lines — hand-authored identity header for the export
└── references/
    └── otel-roadmap.md              242 lines — banked OTel research; VS Code discovery matrix; why OTel is not merged into the ledger
```

Import graph (static): `batch-cost.mjs` imports `loadLines, dedupLines` from `team-report.mjs`
(`batch-cost.mjs:36`) and `listScopes` from `work-scope.mjs` (`:37`); `team-report.mjs` imports
`updateBatchCosts` from `batch-cost.mjs` (`team-report.mjs:24`) — a static ESM cycle that works because
both are used only at call time. `work-scope.mjs` and `telemetry-capture.mjs` use **dynamic imports**
to stay cycle-free (`work-scope.mjs:134,205,209-210,239`; `telemetry-capture.mjs:1437-1438`;
`install-hooks.mjs:554`). `build-tokenomics-export.mjs` imports `updateBatchCosts` (`:35`).

---

## 2. Capture moments per host — exact hook event names and what they write

### 2.1 Claude Code (`install-hooks.mjs` `installClaude` L66-116)

Target file: `.claude/settings.json` (or `.claude/settings.local.json` with `--local`, L67). Every entry
carries the marker key `_tokenomics: true` (`MARKER = '_tokenomics'`, L33); `splice()` (L72-78) drops
previous marked entries for an event and re-appends, leaving foreign entries alone (idempotent; `--remove`
passes `null`). Commands use `${CLAUDE_PROJECT_DIR}/<rel>/hooks/<script>` (L70-71).

| event | matcher | command | timeout | async | writes |
|---|---|---|---|---|---|
| `SessionEnd` | (none) | `node "<script>"` (telemetry-capture, stdin JSON) | 120 | no | ledger line `usage-<user>.jsonl`; deletes `live/<session>.jsonl`; bounded sweep; live report; sync (L79-82; main L1391-1420) |
| `SessionStart` | `startup\|resume` | `telemetry-capture.mjs --sweep` | 120 | **yes** | harvest missed sessions; sync (L83-86; main L1376-1389) |
| `SessionStart` | `*` | `scope-hook.mjs --announce` | 10 | **no** (must inject one stdout line) | prints session id + ask/digest; sweeps stale markers (L87-93; scope-hook L194-198) |
| `PreToolUse` | `Agent\|Workflow` | `scope-hook.mjs --mark-dispatch` | 10 | yes | touches `scopes/.pending-<sid>` (L94-100; scope-hook L75-83) |
| `Stop` | (none) | `scope-hook.mjs --gate` | 10 | no | may emit `{decision:'block', reason}` once; touches `.nagged-<sid>` / `.unclosed-<sid>` (L101-104; scope-hook L115-148) |
| `SubagentStop` | `*` | `telemetry-capture.mjs --dispatch` | 60 | yes | one line per finished dispatch → `live/<session>.jsonl`; rewrites `reports/<batch>.html` (L105-112; main L1357-1374) |

Hook payload fields read (both casings): `session_id`/`sessionId`, `transcript_path`/`transcriptPath`,
`agent_id`/`agentId` (`telemetry-capture.mjs:1359,1363,1367`), `stop_hook_active` (`scope-hook.mjs:118`),
`cwd` (Copilot only, `scope-hook.mjs:190`). Repo = `--cwd` || `CLAUDE_PROJECT_DIR` || `process.cwd()`
(`telemetry-capture.mjs:1339`). Note: on `SubagentStop`, `transcript_path` names the **parent** transcript,
so `dirname(transcript_path)` is the Claude project dir (L1361-1365); the sub-agent's own transcript is
found under `<projectDir>/<sessionId>/subagents/<agentId>.jsonl` + `.meta.json` sidecar (`findSubagents` L320-339).

Doctor's notion of "wired" (`doctor` L564-569): any marked `SessionEnd` or `SessionStart` entry in either
settings file; "scope contract" = marked `Stop` AND `PreToolUse`.

### 2.2 GitHub Copilot CLI (`installCopilot` L129-162)

Target file: `.github/hooks/tokenomics.json` (Copilot reads every `.github/hooks/*.json`), `version: 1`.
Each command object: `{ type: 'command', bash, powershell, env: { COPILOT_CLI: '1' }, timeoutSec }` with
`timeoutSec` 120 for telemetry-capture, 10 for scope-hook (L135-141). Paths are repo-relative `./<rel>/hooks/…`.

| event | commands |
|---|---|
| `sessionStart` | `telemetry-capture.mjs --sweep`, `scope-hook.mjs --announce --json` (stdout parsed as JSON → `{additionalContext}`) |
| `sessionEnd` | `telemetry-capture.mjs --sweep` (no transcript flags; Copilot lines need `session.shutdown` in `events.jsonl`) |
| `subagentStart` | `scope-hook.mjs --mark-dispatch` |
| `subagentStop` | `telemetry-capture.mjs --dispatch` (reads `subagent.completed` events; tokens/time only, never dollars — `captureCopilotDispatches` L502-540) |
| `agentStop` | `scope-hook.mjs --gate` (same `{decision, reason}` shape) |

`--remove` deletes the whole file (L131-134). Store: `<COPILOT_HOME>/session-state/<id>/events.jsonl`,
`<repo>/.copilot/session-state`, `~/.copilot/session-state` (`copilotRoots` L848-861); repo filter by the
first `session.start` event's `data.context.cwd` (`firstCwdOfEvents` L864-880).

### 2.3 VS Code Copilot sidebar (`installVsCode` L177-201) — OPT-IN via `--host vscode`

Target: `.vscode/tasks.json`, a task with `label: 'tokenomics: telemetry sweep'` (`TASK_LABEL` L34),
`type: 'shell'`, `command: 'node'`, `args: ['./<rel>/hooks/telemetry-capture.mjs', '--sweep']`,
`runOptions: { runOn: 'folderOpen' }`, `presentation: { reveal: 'never', echo: false }`. Not part of
`--host all` (L753; pinned by a source-regex test `install-hooks.test.mjs:172-178`), but `--remove` on `all`
strips it. There are no hooks: sidebar sessions are swept by any host's sweep from
`<userData>/User/workspaceStorage/<hash>/chatSessions/<id>.jsonl` (`vscodeStorageRoots` L1008-1033,
`workspaceFolderOf` L1044-1049).

### 2.4 Optional extras

- **git post-commit** (`installGitHook` L219-237, `--git-hook`): `<gitdir>/hooks/post-commit` with marker
  line `# tokenomics-sweep` (`GIT_MARKER` L35), runs `--sweep` backgrounded. Refuses a foreign hook
  (`status: 'exists-foreign'`), handles worktree `.git` files (`gitHooksDir` L204-212).
- **OTel** (`configureOtel` L262-287, `--otel [--endpoint URL]` / `--otel-remove`): writes `otel` into
  config.json; env keys into `.claude/settings.json` `env` (`CLAUDE_CODE_ENABLE_TELEMETRY`,
  `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`, L241-247); `.vscode/settings.json` keys
  `github.copilot.chat.otel.{enabled,exporterType,otlpEndpoint}` (L248-252). `ensureSink` (L1198-1209)
  spawns `otel-sink.mjs` detached on every capture moment when endpoint is localhost.

### 2.5 Factory-level hooks that coexist (not tokenomics-owned)

`bundles/test-automation/hooks/hooks.json` registers `SubagentStop` with matcher
`test-automation-engineer|test-automation-lead|test-runner` → `workflow-return` (roster-guarded per
`bundles/SPEC.md:291-297`). tokenomics' own `SubagentStop` uses matcher `*` and is **not** roster-guarded;
it is acceptable because it is repo-level opt-in via `install-hooks.mjs`, not factory-shipped. A sibling
skill shipping hooks via the factory `hooks.json` must roster-guard; one installed via a settings splice
like tokenomics does not have to.

---

## 3. On-disk data model — exact fields

All telemetry paths are rooted at `<repo>/.agents/telemetry/automation/` (hard-coded segment
`'automation'` in ~15 places: `telemetry-capture.mjs:68,99,104,121,353,387,633`; `scope-hook.mjs:48`;
`work-scope.mjs:42`; `batch-cost.mjs:92,140,162`; `build-tokenomics-export.mjs:165,179,202,259`;
`install-hooks.mjs:436,510-513,538,620`; `team-report.mjs:38`).

### 3.1 Ledger line — `usage-<user-slug>.jsonl`, one JSON per line (`captureClaudeSession` L746-798)

| field | type | notes |
|---|---|---|
| `v` | number | `LEDGER_VERSION = 1` (L40) |
| `host` | `'claude'` \| `'copilot'` \| `'copilot-vscode'` | L747, L979, L1170 |
| `id` | string | session id (transcript stem / session-state dir / chatSessions stem) |
| `user` | string | slug from `whoAmI` (git `user.name` → OS user → email local-part; lowercased, `[^a-z0-9]+`→`-`, L75-95) |
| `capturedAt` | ISO string | L749 |
| `repo` | string | `basename(repo)` |
| `branch` | string \| null | `gitBranch` from transcript / `session.start` `context.branch`; `null` on vscode |
| `role` | string \| null | Claude: `agent-setting` record; Copilot: `subagent.selected` (CLI ≥1.0.63); VS Code: custom agent file stem |
| `models[]` | string[] | sorted, parent + subs |
| `startedAt`, `endedAt` | ISO \| null | first/last record timestamp of the **parent** transcript (L752-753) |
| `wallMin` | number | parent `last − first`, minutes (L754) |
| `activeMin` | number | parent gap-capped active + Σ sub `activeMin` (L754) |
| `turns`, `toolCalls`, `toolErrors` | number | parent only (L755) |
| `tokens` | quad \| null | `{input, output, cacheRead, cacheWrite}` parent only; `null` = transcript reported no usage (L756) |
| `tokensAttributed` | `false` (optional) | only when parent usage unseen (L757) |
| `tokensAttribution` | `'partial'` \| `'none'` (optional) | when any unit lacked usage (L761-764) |
| `tokensByModel` | `{model: quad}` | parent only (L770) |
| `costUsd` | number \| null | L771 |
| `costSource` | `'ccusage-metered'` \| `'copilot-nano-aiu'` \| `'copilot-credits'` \| `'none'` | L771, L989, L1181 |
| `cases[]` | string[] | mined ids ∩ declared (overlap rule L738-742) ∪ declared |
| `scope` | `{intent, batch?, cases[], outcomes?}` (optional) | compact form, never timestamps (`scopeForLine` L657-665); `outcomes` flattened to `{id: outcomeString}` |
| `subagents[]` | array | per dispatch (n:1): `{id?, role, label, n:1, tokens\|null, tokensAttributed?, tokensByModel, activeMin, toolCalls, toolErrors, cases?, costUsd?}` (L780-790). Copilot subs: `{role, label, n:1, tokens:{input:TOTAL,…0}, activeMin, toolCalls, toolErrors}` (L931-943) |
| `skills[]` | string[] | Skill-tool invocations only (not `attributionSkill`) |
| `dispatches` | number | `max(Agent tool_use count, subagent transcripts found)` (L796) |
| `prompts[]`, `dispatched[]` | optional | only when `capturePrompts` (L797); prompts `{t, text≤200}` |
| `foldedFromLive` | number (optional) | dispatches folded from the live log because their transcript vanished (L489) |
| `title` | string (vscode only) | VS Code `customTitle` ≤80 chars (L1182) |

### 3.2 Live dispatch line — `live/<session>.jsonl` (`captureDispatches` L438-449)

`{ v:1, session, agentId, role, label, cases[], tokensByModel, tokens|null, tokensAttributed?:false,
activeMin, toolCalls, toolErrors, costUsd?, endedAt: ISO|null, bytes, at: ISO }`.
`bytes` (transcript size) is the growth/idempotency key (L427-430) and the price-cache key (L705-709).
There is **no `startedAt`** on the dispatch record even though the parser computes `startTs`
(`parseClaudeTranscript` returns `...timeStats(stamps)` L316 — it is dropped at L438-449).
Copilot variant (L520-529): no `bytes`, no `costUsd`, `activeMin = round(durationMs/60000)`,
`endedAt = ev.timestamp`. Reader `readDispatchLog` (L391-396) keeps latest per `agentId`. File is
deleted when the session's ledger line lands (L1411). The gitignore block and the submodule's inner
`.gitignore` exclude `live/` (`install-hooks.mjs:307,510`).

### 3.3 Scope record — `scopes/<session>.json` (`work-scope.mjs` `openScope` L54-72)

```json
{ "v": 1, "session": "<sid>", "intent": "automation", "batch": "<slug>", "cases": ["TC-1"],
  "source": "tms", "declaredAt": "<ISO first open>", "updatedAt": "<ISO>",
  "outcomes": { "TC-1": { "outcome": "delivered", "at": "<ISO>" } }, "closedAt": "<ISO>" }
```
- `SCOPE_VERSION = 1` (L40). `intent` default `'automation'` (L61); open string, suggested list
  `INTENTS = ['automation','manual-testing','investigation','framework','onboarding','docs','other']`
  (`scope-hook.mjs:46`).
- Re-open merges cases and preserves `declaredAt` (L63-65); `recordOutcomes` overwrites per id and
  auto-adds the id to `cases` (L83-88), self-heals a missing scope (L81); `closeScope` sets `closedAt`
  (L100-101).
- `--session auto` → filename `pending-<base36 stamp>-<4 rand>.json` (L258); claimed by the capture
  sweep by time window (±5 min around the session's `startTs..endTs`, closest to start wins) and renamed
  to the real id with `claimedFrom` (`sessionScope` L632-654).
- Marker files in the same dir: `.pending-<sid>` (dispatched), `.nagged-<sid>` (declare-nag done),
  `.unclosed-<sid>` (close-nag done) (`scope-hook.mjs:80,121-124`); swept after 7 days (`MARKER_TTL_DAYS` L38).
- **Timestamps present**: `declaredAt`, `updatedAt`, `closedAt`, `outcomes[id].at`. These are the only
  work-item-lifecycle timestamps in the current model (see §9).

### 3.4 Gate-runs — `gate-runs/<slug>.jsonl` (telemetry side) → folded into `.agents/automation/<slug>/gate-runs.jsonl`

Writer is NOT tokenomics: `bundles/test-automation/skills/test-automation-workflow/scripts/gate/gate-case.mjs`
`appendGateRecord` L191-224. Path choice L202-205: telemetry-side when `.agents/telemetry` exists, else
batch dir. Line: `{ at, branch, base, baseRef?, spec?, n, verdict, consecutiveGreen, seconds[],
conflictFiles?, coverage?: 'ok'|'invalid', carriedDirt?, carriedDirtMore? }` (L207-221).
Reader `loadGateRuns` (`batch-cost.mjs:138-153`) reads both homes, dedups exact lines, sorts by `at`.
`foldGateRuns` (L161-173) appends unseen lines into the batch dir and removes the telemetry file; called
from `generateBatchReports` at close (`work-scope.mjs:224`).

### 3.5 Workflow returns — `returns/<runId>/<agentId>.json`

Writer: `bundles/test-automation/hooks/scripts/workflow-return.mjs` L159-172 (SubagentStop, factory hook).
Body: `{ run_id, agent_id, agent_type, description, shape, recorded_at, result }`. tokenomics reads
`result.unit_ids` / `result.cases[].case_id` / `result.units[].ids` for receipt-first case attribution
(`receiptCaseIds` `telemetry-capture.mjs:350-374`). Legacy home `.agents/automation/_returns/`.

### 3.6 cost.json — `.agents/automation/<slug>/cost.json` (`buildBatchCost` L436-710; written L745 with indent 1)

Top-level keys (L644-709):
- `v: 1` (`COST_VERSION` L39), `batch` (slug = automation-root-relative receipt dir, e.g. `camp/wave-01`), `generatedAt` ISO.
- `sources: { sessions, hosts[], users[], costSources[], models[], liveSessions?, liveNote?, sharedSessions?, note?, foreignDispatchesExcluded? }`.
- `totals: { costUsd|null, tokens, tokensSplit: quad, tokensByModel?, tokensAttribution?, unattributedUnits?, activeMin, dispatches, sessions, turns, toolCalls, toolErrors, skills[] }`.
- `byRole: { <role>: bucket }` — bucket = `{ costUsd|null, tokens, tok: quad, activeMin, dispatches, toolCalls, toolErrors }` (`bucketOut` L637-643).
- `overhead: { note, costUsd|null, sharePct|null, lead: bucket, stages: bucket, byStage: { triage|gate|report|other: bucket } }`.
- `rework?: { …bucket, note }` (fix-round dispatches, `FIX_STAGE = /^fix[:\s]|fix round/i` L217).
- `outcomes: { <outcome>: n }`, `delivered` (sum of `delivered`, `defect-found`, legacy `automated`, `merged-sanctioned-red`, L597-598).
- `gate` = receipt's `gate` object or null.
- `records?: { note, gateRuns?: { count, latest: { verdict, at, consecutiveGreen } }, declaredOutcomes?: {id: outcome}, gateDrift?: { receipt, recorded, at }, outcomeDrift?: [{ id, receipt, declared }] }` (`crossCheck` L198-210).
- `cases[]`: `{ id, outcome, findings, direct: { costUsd|null, tokens, tok: quad, activeMin, dispatches (fractional for clusters), fixRounds, toolCalls, toolErrors }, loaded: { costUsd|null, tokens, activeMin }, sizing?: {...} }` (L578-626).
- `workItemRef?` from receipt `work_item_ref` (L689).
- `sizing?: { note, sized, bySize: { <size>: { cases, sp, estMin, actualMin, actualTok } }, estVsActualMin?: { est, actual, ratio }, flagged: [{ id, size, flag, detail }] }` (`applySizing` L385-434).
- `stats: { note, directCostUsd, directTokens, directActiveMin, loadedCostUsd, loadedActiveMin }` each `{avg, median, min, max, n}` or null (L691-698).
- `averages: { totalPerDelivered: {costUsd, note}|null, directPerCase: {costUsd, note}|null }` (L699-704).
- `coverage: { casesAttributed, casesUnattributed[], note }` (L705-708).

Not refreshed at session end on purpose (`telemetry-capture.mjs:1347-1352` — rewriting a tracked file
dirtied the main tree); written at close (`work-scope.mjs:213-217`) and by `team-report --batch`
(`team-report.mjs:801`, `write: true`).

### 3.7 config.json — `automation/config.json` (`loadConfig` L62-72; `seedConfig` `install-hooks.mjs:537-545`)

Defaults: `{ capturePrompts: false, priceAtCapture: true, maxSweep: 10, vscodeUserDataDirs: [], otel: null }`.
`seedConfig` writes only the first three keys and never overwrites. `otel` shape: `{ enabled: bool, endpoint: 'http://localhost:4318' }`.

### 3.8 factory-profile.json — `automation/factory-profile.json`

Read by `loadProfile` (`build-tokenomics-export.mjs:258-262`); template `templates/factory-profile.template.json`.
Keys (template L3-30 + `buildSegment` L60-77): `schema_version` (`"1.0"`), `factory_id`, `factory_name`,
`stop` (default `'testing'`), `owner_group` (`'QA'`), `work_item_level` (template says `"batch"`, code
default `'feature'`), `factory_type` (`'qa'`), `factory_domain`, `agent_tool`, `default_method`
(`'metered'`), `scope: { includes_subagents, includes_retries, includes_abandoned_runs }`, `currency`
(`'USD'`), `efficiency_techniques[]`, `pipeline[]`, `submitted_by`, `submitted_date`; profile-only row
inputs `maturity` (L107, checklist L151) and `env_setup` (L128, L158).
**Inconsistency (fact):** the template's `_comment` (L2) says copy to `.agents/telemetry/factory-profile.json`
but `loadProfile` reads `.agents/telemetry/automation/factory-profile.json`; `migrateTelemetryLayout`
(`install-hooks.mjs:437`) moves the flat-era location into `automation/` on install.

### 3.9 export/runs.json — `automation/export/runs.json` (`appendRun` L167-182)

`{ schema_version: '1.0', segment: {...buildSegment}, runs: [row…] }`; upsert by `work_item_ref` (latest
close replaces, L176-178). Submission: `automation/export/datasets/<factory_id>/{runs.json, submission.md}`
(`writeSubmission` L196-236); `--anon` rewrites refs to `T-WI-###` (`anonymizeDoc` L185-194). Row schema in §7.

### 3.10 Reports (telemetry side, transient)

`automation/reports/<batch-with-slashes-as-dashes>.html` (`renderLiveReport` L1432-1456) — overwritten on
every `--dispatch` and at session end; disabled by `TOKENOMICS_NO_BATCH_COST=1`. Main-tree close artifacts:
`batch-report.md/.html`, `batch-tokenomics.md/.html` next to `report.json` (`work-scope.mjs:225-233`).

---

## 4. Telemetry submodule: location, per-factory subfolder rule, gitignore, riding along

- Location: `<repo>/.agents/telemetry` = a submodule **of the same repository** on orphan branch
  `telemetry` (`installTelemetrySubmodule` `install-hooks.mjs:329-422`). Branch created empty via plumbing
  (`hash-object -t tree /dev/null` → `commit-tree` → `update-ref refs/heads/telemetry`, L366-368) or
  tracked from `origin/telemetry` (L363-364); `git submodule add --force -b telemetry -- ./ .agents/telemetry`
  (L397); `.gitmodules` gets `submodule..agents/telemetry.ignore = all` (L398). Interim plain-dir files are
  stashed to `.agents/telemetry.pre-submodule` and restored on any exit (L344-357, L419). Flat-era files
  tracked on main are `git rm --cached` (L384-387) so the user's one review commit records the removal.
- The rule, verbatim: *"shared, one subfolder per factory — this factory writes `automation/`; another
  factory that wants durable telemetry later adds its own subfolder and rides the same branch and sync,
  no second submodule"* (`SKILL.md:292-294`, `README.md:41-44`, `install-hooks.mjs:330-332`, README seeded
  inside the submodule L291-303, `bundles/SPEC.md:298-304`).
- The submodule's own `.gitignore` is written **generically** so any subfolder gets identical transient
  handling (L305-311): `*/live/`, `*/scopes/.pending-*`, `*/scopes/.nagged-*`, `*/scopes/.unclosed-*`.
- The repo-root managed block (`GITIGNORE_BLOCK` L506-515; `installGitignore` L517-534, replaced in place
  between `# >>> tokenomics (managed) — working state only; the ledger/scopes/receipts stay COMMITTED` and
  `# <<< tokenomics`; matched by the first 24 chars of the start line L524) lists only the `automation/`
  paths: `.agents/telemetry/automation/live/`, `…/scopes/.pending-*`, `…/scopes/.nagged-*`,
  `…/scopes/.unclosed-*`. It exists for the plain-dir fallback (`SKILL.md:317-328`). Rule: never gitignore
  `.agents/telemetry` itself (`SKILL.md:330`).
- Sync (`syncTelemetry` `telemetry-capture.mjs:1464-1492`): runs on the submodule **root** — `git add -A`
  covers whatever any factory wrote (comment L1466-1467); commits as `telemetry <telemetry@local>` with
  message `telemetry: capture`; `checkout -B telemetry` if detached; `push origin HEAD:telemetry`; on
  rejection `fetch` + `merge --no-edit FETCH_HEAD` + push. Requires `<root>/.git` to exist (L1469).
  `TOKENOMICS_NO_SYNC=1` disables. Pull for the team view: `pullTelemetry` (`install-hooks.mjs:471-489`),
  `--pull`. Conflict-freedom comes from per-user ledger files (`usage-<slug>.jsonl`) and per-session scope files.
- Doctor reports submodule state (L582-619): registered+materialized/detached/unpushed count; registered but
  empty → `git submodule update --init`; remote mismatch → `git submodule sync .agents/telemetry`.
- How a second factory/skill rides it (what the code implies): write under `.agents/telemetry/<own-subfolder>/`;
  the same `syncTelemetry` commit+push carries it (it does not filter by subfolder); the inner gitignore
  globs already cover `<own>/live/` and `<own>/scopes/.pending-*` etc.; nothing else is required
  (`install-hooks.mjs:305-306` "Generic on purpose: any factory's subfolder gets the same transient handling").
  Manual-qa, by contrast, meters its benchmark runs with its own hooks and does not use the submodule
  (`SKILL.md:340-345`; `bundles/manual-qa/hooks/hooks.json` has no telemetry paths).

---

## 5. install-hooks.mjs — flags, idempotency, doctor, remove, settings edits

CLI (`main` L695-779): `[--host all|claude|copilot|vscode] [--local] [--remove] [--repo <root>]
[--doctor [--fix] [--strict]] [--pull] [--otel [--endpoint URL]] [--otel-remove] [--git-hook]`.
`--bundle`-style aliases: none. Guard: the skill root (`skillRootOf` L37-39 = `dirname(dirname(scriptUrl))`)
must be inside `--repo` or the run refuses with exit 1 (L704-708; tested `install-hooks.test.mjs:145-147`).
The relative path `rel` from repo to skill root is what every command embeds (L704).

Default (`--host all`) sequence (L747-778): `installClaude` → `installCopilot` → (`installVsCode` only for
`--host vscode`, or on `--remove` from `all`) → `installGitignore` (always) → `migrateTelemetryLayout`
(not on remove) → `installTelemetrySubmodule` (prints the one-commit instructions L764-772; `--remove`
never deletes data: `status: 'kept'` L337) → `seedConfig` (not on remove).

Idempotency mechanisms:
- Claude: marker key `_tokenomics` on each hooks entry; `splice` strips marked entries per event before
  re-adding; empty event arrays are deleted (L76-77, L113). Test `install-hooks.test.mjs:18-52` asserts a
  pre-existing `SessionStart` entry survives and counts stay 1/3.
- Copilot: whole owned file rewritten (`.github/hooks/tokenomics.json`).
- VS Code: task identified by `label` only (L180).
- gitignore: owned block delimited by start/end markers, replaced in place; file removed if nothing else in it (L530).
- git hook: marker comment; foreign hook never overwritten.
- OTel: exactly the enumerated keys added/removed; other `env`/settings keys untouched (test L208-232).
- Layout migration: never clobbers (`automation/` wins), merges dirs file-by-file (L442-460).

`--doctor` (`doctor` L553-693): one line per check (`ok`/`WARN`/`info`), returns warning count; `--strict`
turns warnings into exit 1. Checks: claude hooks wired; claude scope contract; copilot hook file; copilot
scope contract + sessionEnd; gitignore contains `.agents/telemetry/automation/live/` (L579); submodule state
and remote mismatch; scopes count/pending/markers; vscode task; git post-commit; store discovery counts;
sidebar-only warning; ccusage on PATH vs npx; OTel endpoint `/healthz` probe (`--fix` starts the sink).

What a sibling skill would need to register its own hooks without conflict (facts that constrain it):
- Use its **own marker key** (tokenomics filters on `e[MARKER]` where `MARKER = '_tokenomics'`, L74) —
  a sibling using a different key (e.g. `_delivery`) is invisible to tokenomics' `splice` and vice versa;
  Claude runs all entries for an event, so both can coexist under `SessionStart`/`SubagentStop`/`Stop`.
- Use its **own Copilot hooks file** (`.github/hooks/<name>.json`) — Copilot reads every file; tokenomics
  rewrites only `tokenomics.json`.
- Use its **own gitignore block markers** — `installGitignore` matches start-line prefix
  `# >>> tokenomics (managed)`[:24] and end `# <<< tokenomics`; a block starting differently is preserved.
- Its own `.vscode/tasks.json` `label` and its own git-hook marker; note `installGitHook` refuses if a
  post-commit exists that lacks `# tokenomics-sweep` — a sibling writing post-commit first would make
  tokenomics report `exists-foreign` (and vice versa). Chaining is manual.
- The stop gate: two `Stop` hooks that both may `block` will both be honored by Claude; tokenomics guards
  loops with `stop_hook_active` and once-only markers.
- `--doctor` in tokenomics knows nothing about a sibling; a sibling needs its own doctor or none.

---

## 6. team-report.mjs and batch-cost.mjs — inputs, outputs, joins, dedup, honesty rules

### 6.1 team-report.mjs

CLI (`main` L785-869): `[roots…] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--receipts <path>]
[--label <text>] [--role <name>] [--json] [--html] [--out <file>] [--batch <slug> | --batches] [--tokenomics]`.
- Roots: repo root (reads `.agents/telemetry/automation/usage*.jsonl` and receipts under
  `.agents/automation/`), a telemetry dir, or a single `.jsonl` (`ledgerFilesOf` L35-46; regex `^usage.*\.jsonl$`).
- `loadLines` (L48-60) keeps records with `host`, `id`, numeric `v`. `dedupLines` (L63-74): key
  `${host}:${id}`, rank by `(endedAt, capturedAt)`, **latest wins**.
- `filterWindow` (L94-103) uses the **local calendar date of `startedAt`**; `filterRole` (L89-92) matches
  the session `role` or any `subagents[].role` (report-time only — capture keeps everything, L83-87).
- `isoWeek(startedAt)` (L106-114) → `YYYY-Www`.
- `loadCases(receiptDirs)` (L143-157): walks all `report.json` (nested waves too, skipping `_*`, `.*`,
  `telemetry`), orders by file **mtime**, latest outcome per case id wins; `delivered` = count in
  `DELIVERED_OUTCOMES = ['delivered','defect-found','automated','merged-sanctioned-red']` (L29).
- `buildReport(lines, cases)` (L185-258) → `{ sessions, people, totals, byCase, byIntent, costSources,
  tokensOnly, byPerson, byRole, byWeek, byHost, cases, perDelivered, perExamined, index[] }`; bucket =
  `{ sessions, costUsd, priced, tokens: quad, activeMin, wallMin, turns, toolCalls, toolErrors }` (L174-183).
  `perDelivered` is suppressed under `--role` (`cases.roleFiltered`, L241, L821); carries
  `automationOnlyCostUsd` when automation-intent lines are priced (L246).
- Cross-batch additions in `main` (L826-856): `rep.byBatch[]` = `{ batch, cases, delivered, costUsd,
  activeMin, perDelivered, gate, drift }` and `rep.perCase[]` / `rep.perCaseStats` from every batch's
  cost.json recomputed with `updateBatchCosts(r, { write: false, live: false })` — period rollups exclude
  running sessions (L827-831).
- Renderers: `renderMarkdown` (L265-331), `renderTeamHtml` (L729-783), `renderBatchMarkdown` (L376-441),
  `renderBatchHtml` (L524-592), `renderBatchTokenomicsMarkdown` (L600-662), `renderBatchTokenomicsHtml`
  (L664-724). Shared self-contained CSS `PAGE_CSS` (L448-498), light/dark via `html[data-theme="dark"]`,
  KPI cards (`kpiCard`, `statCell` L499-500), quad stacked bars (`quadBar`/`quadLegend` L510-519).
  Token helpers `realWork`, `cacheHitRate`, `cacheSavings`, `costShareOfCacheRead` (L348-368).
- `--batch` mode (L798-813) recomputes cost.json (`write: true`) and renders md/html/json per batch.

### 6.2 batch-cost.mjs

CLI (L752-761): `[repo] [--batch <slug>] [--stdout] [--json]`. Library entry `updateBatchCosts(repo,
{ batch, write = true, live = true })` (L724-749).
- Receipts: `loadReceipts` (L45-74) walks `.agents/automation/**/report.json` (must have `cases[]`), slug =
  root-relative dir; `--batch` selects a campaign by top slug or a wave by full path.
- Lines = ledger (`loadLines([repo])`) + provisional lines from `live/*.jsonl` for sessions with **no**
  ledger line yet (`loadLiveLines` L91-128 — `live: true`, `user: 'live'`, parent zeros, `costUsd` = Σ priced
  dispatches = floor). Real line always wins outright, not by timestamp (L730-738).
- Membership `lineMatchesBatch` (L256-266): substring match over `branch`, `cases[]`, `scope.batch`,
  `scope.cases[]`, `subagents[].label`, `subagents[].cases[]` against slug(s), receipt case ids, receipt branches.
- Batch time window (L439-458): `windowStart = min(scope.declaredAt)` over scopes whose `batch` equals the
  slug or `receipt.batch`; a line with `endedAt < windowStart` is excluded unless its `scope.batch` names
  the batch; no scopes → no window.
- Classification (L212-249): `OVERHEAD_STAGE` regex on the first 48 chars of the label (`STAGE_HEAD` L227)
  decides overhead first; then `matchIds(label, ids)`; then fallback to the dispatch's own `cases[]`; else overhead.
  `stageKindOf` → `triage|gate|report|other` (L304-309).
- Multi-batch sessions (L461-468, L510-527): dispatches naming another receipt's ids/keys are **excluded**
  (`foreignExcluded`); neutral dispatches and session-level parent figures are split `1/div` across the
  batches the line matched (`sharedSessions`).
- Parent (lead thread) = session minus all dispatches (L532-539); per-case direct = even split across a
  cluster's matched ids (`share = w / matched.length`, L565); `loaded` = direct + overhead/nCases (L614-626).
- Records vs receipt: `declaredOutcomesFor` (L176-189) picks scopes by batch name or case overlap, latest
  `updatedAt` wins; `crossCheck` (L198-210) → `gateDrift` (latest recorded verdict ≠ `receipt.gate.verdict`)
  and `outcomeDrift[]` (declared ≠ receipt outcome). Records never overwrite the receipt.
- Sizing join (L318-434) — see §7 for the est-vs-actual semantics.

### 6.3 Labelling-honesty rules (exact strings)

- Dollars: only real figures summed; sessions without one are counted and labelled tokens-only, never
  estimated (`team-report.mjs:14-16`, rendered L272 `⚠️ N session(s) tokens-only (no real dollar — never
  estimated)`; `README.md:107` "n/a = not measured. We never estimate dollars."). `costUsd: null` ≠ `$0`
  (`meterSession` L554 "totalUsd null = 'unpriced', never $0").
- Allocation labelled as such: `loaded` carries `note: 'direct = per-case measured values only; loaded =
  direct + even overhead share (allocation, not measurement)'` (`batch-cost.mjs:692`); markdown
  `(loaded = direct measured work + an even share of the batch overhead — an allocation, labelled as such)`
  (`team-report.mjs:310`); README L98-102.
- Overhead shown once, never smeared: `overhead.note` (`batch-cost.mjs:667`); rework "already inside
  per-case direct; shown here as its own lever" (L675).
- Floors: `tokensAttribution: 'partial'|'none'` + `unattributedUnits` → "TOKEN TOTALS ARE A FLOOR"
  (`team-report.mjs:393`); live sessions → `liveNote: 'PROVISIONAL — …these totals are a floor'`
  (`batch-cost.mjs:650`).
- Drift flags: `GATE DRIFT` / `OUTCOME DRIFT` banners (`team-report.mjs:386-387,571-572`; `work-scope.mjs:304-305`).
- Per-host honesty table (`SKILL.md:257-264`): Copilot never has per-dispatch dollars; a running Copilot
  session has no ledger row until `session.shutdown`.
- Sizing deviations are "analysis pointers, never per-case dollar verdicts" (`batch-cost.mjs:429`).
- `--role` suppresses `$/delivered` because receipts are not role-attributable (`team-report.mjs:239-241`).

---

## 7. build-tokenomics-export.mjs — the hyperfactory row schema (closest existing estimate-vs-actual)

CLI (L289): `build-tokenomics-export.mjs [repo] --batch <slug> [--profile <path>] [--stdout] |
--submission [--anon] | --compare <a.cost.json> <b.cost.json>`. Also invoked automatically by
`work-scope.mjs close` (`generateBatchReports` L238-242).

### 7.1 Segment header (`buildSegment` L60-77)

`{ factory_id, factory_name, stop, owner_group, work_item_level, factory_type, factory_domain?, agent_tool
(default: cost.sources.hosts.join('+')), default_method, scope: { includes_subagents, includes_retries,
includes_abandoned_runs }, currency, efficiency_techniques[], pipeline[], submitted_by?, submitted_date? }`.

### 7.2 Run row (`buildRunRow` L80-141) — quoted field list

```
work_item_ref            cost.workItemRef ?? `T-${cost.batch}`          (telemetry-cohort prefix)
work_item_level          profile.work_item_level ?? 'feature'
work_item_brief          "Test-automation batch: N TMS case(s) through analyse → implement → review → merge → gate; D delivered."
maturity                 profile.maturity ?? 'pilot'
size_tshirt?             effortDaysToSize(effort_days)                    (only when effort_days derivable)
effort_days?             round(ΣSP / 8, 1)   — ΣSP over cost.sizing.bySize[*].sp  (1 SP = 1 h conventional effort, ÷8 → person-days)
sessions                 cost.sources.sessions
turns                    cost.totals.turns
subagent_dispatches      cost.totals.dispatches
orchestrator_cost_pct    round(overhead.lead.costUsd / totals.costUsd * 100, 1)  (100 when no dispatches; null if unpriced)
tokens                   { input, output, cache_read, cache_create }     (from totals.tokensSplit)
primary_model            model with most output tokens
models_used[]            cost.sources.models
tokens_by_model?         { model: { input, output, cache_read, cache_create } }
cost_api_equivalent_usd  cost.totals.costUsd
cache_read_share_pct     cost-weighted share at ratios in 1× / out 5× / write 1.25× / read 0.1×
scenarios_authored       cases − (not-started + infra-stalled)
scenarios_automated      cost.delivered
scenarios_executed       = scenarios_authored
scenario_complexity?     the LARGEST size class present (XS<S<M<L<XL)
env_setup?               profile.env_setup  (trivial|single-fixture|multi-fixture|external-deps|full-env)
self_size?               the DOMINANT size class (most cases)
story_points?            ΣSP
_tokens_attribution?     'partial'|'none'
notes                    joined sentences: gate verdict/runs + outcomes; attribution floor; cohort provenance; effort derivation; cache-share method; scenarios_executed definition
```

Size bands (`effortDaysToSize` L53-56, from the guide's §3.1 spine): `< 0.5 → XS`, `≤ 1.5 → S`, `≤ 3.5 → M`,
`≤ 7.5 → L`, else `XL`. `SIZE_ORDER = ['XS','S','M','L','XL']` (L58).

**No timestamps appear in the row** (no started/ended/duration fields). `measured_savings` is not a row
field — it is the one manual human note the spec keeps (`SKILL.md:90-91`; `submission.md` footer L232).

§7 checklist (`checklist` L144-162) → `{ missing[], defaulted[] }`; missing includes
`effort_days (run the intake sizing pass)`, `size_tshirt (derives from effort_days)`,
`scenario_complexity (from sizing verdicts)`, `env_setup (…)`, `tokens_by_model (required: models_used > 1…)`,
`cost_api_equivalent_usd > 0`, `cache_read_share_pct in [0,100]`; defaulted includes `maturity=pilot`.

### 7.3 The estimate side that feeds it (`batch-cost.mjs` sizing join)

- Input: `.agents/estimation/*.json` from the `automation-scoping` skill's `score-cases.mjs --json`
  (`loadSizings` L327-350). Accepted row shapes: `{ id|case_id, size: 'M' | { size, sp }, sp?,
  estimated_active_minutes | est_min }`; later files win.
- Per-case stamp `cases[].sizing = { size, sp, estMin, src, baseline?: { n, medianTok, p90Tok, medianMin,
  p90Min }, tokPercentile?, minPercentile?, flag?: 'above-p90'|'below-p10', note? }` (L396-421).
- Baselines = other batches' `cost.json` `cases[].direct.tok` (input+output) and `direct.activeMin` per
  size class, excluding the current batch (`sizeBaselines` L356-380); `MIN_CLASS_N = 5` (L382).
- Flag rules (L405-409): `above-p90` when real-work tokens ≥ p90 AND ≥ 1.5×median, or active minutes
  likewise; `below-p10` when tokens ≤ p10 AND ≤ 0.5×median.
- Batch-grain rollup `sizing.estVsActualMin = { est: ΣestMin, actual: ΣactualMin, ratio: actual/est }`
  (L426-431) — **this is the only existing estimated-vs-actual figure**, in active minutes, batch grain,
  with the doctrine "per-case dollars rank-correlate ~zero with predictions; only batch totals are quotable"
  (L322-326, L429; rendered `team-report.mjs:426`).

---

## 8. Testing conventions, env-var switches, stdlib constraint

- Runner: `node --test` over every `*.test.mjs` (`npm test` at repo root, CLAUDE.md). Framework
  `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`. No fixtures directory:
  each test builds a temp repo with `mkdtempSync(join(tmpdir(), 'tokenomics-…-'))` and a `jsonl(recs)`
  helper (`telemetry-capture.test.mjs:17-18`; `team-report.test.mjs:12-13`).
- Transcript fixtures are inline record arrays mirroring the real Claude JSONL (`claudeRecords()`
  `telemetry-capture.test.mjs:23-54`: `agent-setting`, streaming duplicate message ids, `is_error`
  tool_result, a >30-min gap, sidechain noise). Sub-agent fixtures write `<proj>/<sid>/subagents/agent-<id>.meta.json`
  + `.jsonl` (L199-211). Copilot fixtures write `<root>/<sid>/events.jsonl` with `session.start`,
  `subagent.started/completed`, `session.shutdown` (L295-318). VS Code fixtures write op-log lines (L631-690).
- Store roots are redirected by env, injected either through function options `{ env }` or `process.env`:
  `TOKENOMICS_CLAUDE_ROOT`, `TOKENOMICS_COPILOT_ROOT`, `TOKENOMICS_VSCODE_ROOT` (L473, L512, L743).
- Pricing is stubbed with a shell script via `TOKENOMICS_CCUSAGE_BIN` (L281-286, L333-353) or disabled
  with `TOKENOMICS_NO_CCUSAGE=1` / `priceAtCapture: false`.
- Hooks are tested end-to-end by `execFileSync('node', [SCRIPT, ...args], { input: JSON.stringify(payload) })`
  (`scope-hook.test.mjs:14-16,104-118`) — both Claude (`session_id`, env `CLAUDE_PROJECT_DIR`) and
  Copilot (`sessionId`, `cwd`, `--json`) encodings.
- Source-shape tests pin invariants by regex over the script text (`install-hooks.test.mjs:172-178`).
- Ledger/cost tests use hand-built line objects (`batch-cost.test.mjs:8-32` `sub()`, `line()`, `RECEIPT`).
- Full env-var switch list:
  - `TOKENOMICS_NO_CCUSAGE=1` — skip metering (`telemetry-capture.mjs:558`)
  - `TOKENOMICS_CCUSAGE_BIN` — binary instead of `npx --yes ccusage@latest` (L569-572)
  - `TOKENOMICS_NO_SINK=1` — don't spawn the OTel sink (L1345)
  - `TOKENOMICS_NO_BATCH_COST=1` — don't render the live batch page (L1433)
  - `TOKENOMICS_NO_SYNC=1` — don't commit/push the submodule (L1465)
  - `TOKENOMICS_CLAUDE_ROOT`, `TOKENOMICS_COPILOT_ROOT`, `TOKENOMICS_VSCODE_ROOT` — store overrides (L837, L849, L1009)
  - `TOKENOMICS_SINK_IDLE_MS` — sink idle timeout (`otel-sink.mjs:98`)
  - Host-provided: `CLAUDE_PROJECT_DIR`, `CLAUDE_CONFIG_DIR` (L838), `CLAUDE_SESSION_ID` (`work-scope.mjs:257`),
    `COPILOT_HOME` (L854), `APPDATA` (L1015); `COPILOT_CLI=1` is set by the Copilot hooks file.
- Stdlib-only is a hard constraint restated in every file header (`telemetry-capture.mjs:27`,
  `scope-hook.mjs:33`, `work-scope.mjs:35`, `batch-cost.mjs:32`, `team-report.mjs:20`,
  `build-tokenomics-export.mjs:31`, `install-hooks.mjs:27`, `otel-sink.mjs:18`); the only external
  process is `ccusage` via `npx`, best-effort. Hooks must never exit non-zero or write unexpected stdout
  (`telemetry-capture.mjs:28-29,1494-1499`; `scope-hook.mjs:22-24,211-213`), and must read stdin with a
  bounded deadline (`readStdinBounded` `scope-hook.mjs:168-184`, 2 s).

---

## 9. Existing time / cadence measurements — exact definitions

- Constants (`telemetry-capture.mjs:41-45`): `IDLE_GAP_MS = 30 min` ("same active-time rule as
  efficiency-audit"), `LIVE_GRACE_MS = 2 min` (a transcript modified more recently is assumed live and
  skipped by the sweep, L1256, L1311), `RECAPTURE_MARGIN_MS = 5 min` (source growth beyond the recorded
  end that means "the session continued", L1258, L1280, L1313).
- `timeStats(stampsMs)` (L179-192): sort stamps; `active = Σ dt` over consecutive stamps where
  `0 < dt ≤ 30 min`; `wallMin = round((last − first)/60000)` (0 if <2 stamps); `activeMin = round(active/60000)`;
  returns `startTs`, `endTs`. Rounding is to whole minutes at the unit level (so sub-minute dispatches round to 0).
- Claude session line: stamps = every parent record `timestamp` (L270-273); `startedAt`/`endedAt`/`wallMin`
  parent-only; `activeMin` = parent active + Σ `subagents[].activeMin` (L754). Sub-agent stamps are not in the
  parent's wall span (they run inside it in practice, but nothing enforces or records that).
- Claude dispatch (live log): `activeMin` from the dispatch's own transcript stamps; `endedAt` = its last
  stamp; `at` = capture time; no `startedAt` stored (see §3.2).
- Copilot session: stamps = all events' `timestamp` including sub-agent events (L908-911); sub `activeMin =
  round(durationMs/60000)` from `subagent.completed` (L941).
- VS Code: `activeMin = round(Σ elapsedMs/60000)`; stamps = request `timestamp` and `timestamp+elapsedMs`;
  `wallMin = round((endTs − startTs)/60000)` (L1134-1137, L1146-1148, L1177).
- Gate: `seconds[]` per run and `at` per verdict line (`gate-case.mjs:214`, L208); receipt `gate.seconds[]`
  (`batch-build.workflow.mjs:1591`).
- Batch-level time in cost.json: `totals.activeMin`, `overhead.lead.activeMin`, `overhead.stages.activeMin`,
  `byStage[*].activeMin`, `rework.activeMin`, `cases[].direct.activeMin`, `cases[].loaded.activeMin`,
  `stats.directActiveMin`/`loadedActiveMin`; `sizing.estVsActualMin`. There is **no wall/cycle time at
  batch grain**: `generatedAt` is render time; the receipt (`report.json`, `batch-build.workflow.mjs:1583-1600`)
  carries no `startedAt`/`endedAt`/`generatedAt` at all; `loadCases` orders receipts by file mtime
  (`team-report.mjs:145-146`).
- Team rollup time: `bucket.activeMin`, `bucket.wallMin` (sum of session walls — overlapping sessions
  double-count wall), `byWeek` keyed by `isoWeek(startedAt)`, `--since/--until` on local date of `startedAt`.
- Work-item lifecycle timestamps that DO exist today: scope `declaredAt` (first open — used as the batch's
  time-window start, `batch-cost.mjs:448-452`), `updatedAt`, `closedAt`, `outcomes[id].at`; live dispatch
  `endedAt`/`at`; gate-run `at`; return `recorded_at`; ledger `startedAt`/`endedAt`/`capturedAt`.
- Campaign/wave structure: receipts nest as `.agents/automation/<campaign>/<wave>/report.json`; cost.json
  slug is the nested path; `updateBatchCosts(repo, { batch: '<campaign>' })` selects all waves by prefix
  (`batch-cost.mjs:73`); `generateBatchReports` resolves a scope's `batch` as top slug, full path, or bare
  wave name (`work-scope.mjs:211-218`). Campaign workflow stages are `plan-proposal`, `foundation`,
  `wave-landed`, `waves` (`batch-campaign.workflow.mjs:224,398,431,511,550`) — returned to the caller, not
  timestamped on disk by tokenomics.

---

## 10. Implications for a sibling delivery tracker (what exists → what it means)

Reusable **verbatim** (import, don't copy):
- `loadLines`, `dedupLines`, `filterWindow`, `filterRole`, `isoWeek`, `loadCases`, the HTML chrome
  (`PAGE_CSS`, `kpiCard`, `statCell`, `escHtml`) from `team-report.mjs`; `loadReceipts`, `loadGateRuns`,
  `loadLiveLines`, `updateBatchCosts` from `batch-cost.mjs`; `listScopes`, `scopePath`, `safeSession` from
  `work-scope.mjs`; `readRecords`, `knownSessions`, `sessionScope`, `syncTelemetry`, `whoAmI`,
  `claudeProjectDirs`/`copilotRoots`/`vscodeStorageRoots` from `telemetry-capture.mjs`;
  `readStdinBounded` + the announce/gate output encodings from `scope-hook.mjs`; `installTelemetrySubmodule`,
  `pullTelemetry`, `gitHooksDir` from `install-hooks.mjs`. All are `export`ed. Caveat: they hard-code the
  `automation/` subfolder — a sibling that wants its own subfolder cannot reuse the path helpers as-is
  (`ledgerPath`, `dispatchLogPath`, `scopesDir`, `exportPath`, `loadConfig`).
- The scope record itself: `declaredAt`/`closedAt`/`outcomes[id].at` already give per-session work-item
  open/close stamps for `batch` + `cases`; `intent` and `outcomes` are documented as open vocabularies
  (`work-scope.mjs:23-28`).
- The `estVsActualMin` pattern (batch-grain ratio, per-class percentile flags with `MIN_CLASS_N`, notes that
  say "pointer, not verdict") and the `sizing` input contract (`.agents/estimation/*.json` rows with
  `id`, `size`, `sp`, `estimated_active_minutes`).
- The export row conventions: `work_item_ref` upsert key, `T-<slug>` cohort prefix, `size_tshirt` bands,
  §7 checklist `{missing, defaulted}` style, `--anon` renaming.

Would need **extension** (facts constraining it):
- A new subfolder under `.agents/telemetry/` (SPEC rule: one subfolder per factory/concern, same branch,
  same sync). The inner `.gitignore` globs (`*/live/`, `*/scopes/.pending-*`…) and `syncTelemetry`'s
  `git add -A` on the root already cover it; the root-level managed gitignore block only lists
  `automation/` paths, so a sibling needs its own block (or the plain-dir fallback leaks its transients).
- New hook lines: tokenomics' hooks are spliced with marker `_tokenomics`; a sibling must use a distinct
  marker, a distinct `.github/hooks/<name>.json`, and a distinct task label. If it wants per-dispatch
  or per-stage timestamps it can hang off the same events (`SubagentStop`/`subagentStop` payload:
  `session_id`, `agent_id`, parent `transcript_path`; `PreToolUse` `Agent|Workflow`), but nothing today
  records dispatch **start** times — only `endedAt` and the sub-agent transcript's first stamp
  (`parseClaudeTranscript` returns `startTs` but `captureDispatches` drops it, L316 vs L438-449).
- New scope fields or a new record: the scope has no `estimate`, no `plannedAt`/`dueAt`, no
  campaign/mission/task hierarchy — only `batch` (string, may be `camp/wave-01` or bare `wave-01`) and
  `cases[]`. cost.json's `workItemRef` comes from the receipt's optional `work_item_ref`
  (`batch-build.workflow.mjs:1587`). The receipt has no timestamps.
- Cycle-time needs a start and an end per work item; today's candidates are `scope.declaredAt`
  (earliest declare per batch — already the batch window start), `scope.closedAt`, receipt file mtime,
  gate-run `at`, and ledger `startedAt`/`endedAt` of matched sessions. Campaign-level stages exist only in
  the campaign workflow's return values, not on disk under telemetry.

Must **not** be duplicated:
- Ledger writing, ccusage metering, store parsing, the three-host sweep, the submodule setup/sync — all
  single-owner in tokenomics; a sibling that re-implements capture would double-count and dirty the same files.
- The dedup rules (`host:id` latest-by-`endedAt`, live-log latest-by-`agentId`, receipts latest-by-mtime,
  export upsert-by-`work_item_ref`) — reuse the exported functions so both skills agree.
- The dollar/allocation honesty vocabulary (measured vs allocation, floor, PROVISIONAL, DRIFT, tokens-only)
  — a cadence report that quotes cost should quote cost.json figures with the same labels rather than
  recomputing.
- The `.agents/telemetry/automation/` subfolder: writing sibling records there would be read by tokenomics'
  `ledgerFilesOf` (`^usage.*\.jsonl$`) or `listScopes` (any `*.json` in `scopes/`) and could corrupt reports;
  the naming space inside `automation/` is tokenomics'.

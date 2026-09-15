# security-testing bundle v1 — technical decomposition

**Date:** 2026-09-15
**Author:** Rio (tech-lead, feature-development bundle)
**Inputs:** [spec v6](../specs/2026-09-14-security-testing-bundle-design.md) (locked §2/§3), [v3 sections cited by v6](../specs/2026-09-14-security-testing-bundle-design.md) at commit `028fab1`, [epic + stories](2026-09-15-security-testing-bundle-stories.md) (US-001 … US-049), `CLAUDE.md`, `bundles/SPEC.md`, `bin/init.mjs`, `bin/lib/item-resolver.mjs`, `bin/validate-factories.mjs`, `hooks/lib.sh`.
**Status:** ready for PM distribution. 55 tasks (TASK-001 … TASK-055), 1 named spike (SPIKE-001, already executed, see §6), 12 tech-lead readings recorded in §2 (representation choices the spec leaves open — none changes a §2 promise or a §3 decision).

Conventions: `<st>` = `.agents/security-testing/` in the consumer repo; `scripts/` = `bundles/security-testing/skills/security-evidence/scripts/` in this repo; `<run>` = `<st>/runs/<run_id>/`. Exit codes everywhere: `0` ok, `1` internal error (uncaught), `2` usage / unknown command / bad argv, `3` INDETERMINATE-class refusal, `4` verification failure, `5` integrity mismatch.

---

## 1. Execution plan

Dependency graph first. Every M1 script task is a one-session PR (script slice + sibling `*.test.mjs` + fixtures); M2–M5 tasks are coarser by design.

```
M-1   TASK-001 (docs)
        │
M1    ├── Group A (parallel, no deps beyond 001): 002 canon · 003 normalize · 004 redact · 005 schemas
        │
        ├── Group B (after A): 006 skeleton/dispatcher · 007 engagement record + knowledge templates
        │                      026 verify evaluate (pure) · 028 register core   ← both only need 002/005/006
        │
        ├── Group C (after B): 008 ignore-block/fail-closed · 009 keys · 010 baseline · 011 templates-at-init
        │                      012 run init/ledger · 029 register transitions · 032 purge
        │
        ├── Group D (after C): 013 scope · 014 cite (resolver) · 015 import store + ingest dispatcher
        │                      030 consume-verdict
        │
        ├── Group E (after D): 016 ingest sarif · 017 ingest tracker-side · 018 ingest qa-side · 020 coverage
        │
        ├── Group F (after E): 019 gate
        │
        ├── Group G (after F): 021 packet → 022 receipt (sequential pair)
        │
        ├── Group H (after G): 023 build-report core + review template · 027 verify all · 034 secure-code-review skill
        │
        ├── Group I (after H): 024 assessment/verify/threat-model templates · 031 publish + check-export
        │
        ├── Group J (after I): 025 check
        │
        ├── Group K (after J): 033 sign-off · 035 security-engagement skill · 036 security-reviewer agent
        │
        ├── Group L (after K): 037 M1 manifest/FACTORY.md/README/instructions
        │
        └── Group M (after L): 038 installed E2E (both shapes) + §12 extra fixtures      ← M1 done

M2    039 tm-lint + threat-modeling skill → 040 threat-modeler agent ; 041 sign-off disposition policy (after 039)
M3    042 plan.mjs admit/propose + planning skill → 043 admitted suite (case/handoff profiles) ; 044 observations + TA ; 045 tracker dedupe/read-back
      046 risk-register skill (parallel) → 047 security-lead agent (after 043–046) → 048 final manifest
M4    049 manual-qa PR · 050 feature-development PR · 051 execution-authorization note   (parallel, after 048)
M5    052 catalog/marketplaces → 053 smoke → 054 dogfood ; 055 hook probe (parallel)
```

### Parallel groups (M1)

| Group | Tasks | Max parallel devs |
|---|---|---|
| A | 002, 003, 004, 005 | 4 |
| B | 006, 007, 026, 028 | 4 |
| C | 008, 009, 010, 011, 012, 029, 032 | 4 (008→009→010→011 touch `cmd-engagement.mjs`; run them as one dev in sequence or accept rebase) |
| D | 013, 014, 015, 030 | 4 |
| E | 016, 017, 018, 020 | 4 |
| F | 019 | 1 |
| G | 021, 022 | 1 (sequential) |
| H | 023, 027, 034 | 3 |
| I | 024, 031 | 2 |
| J | 025 | 1 |
| K | 033, 035, 036 | 3 |
| L | 037 | 1 |
| M | 038 | 1 |

### Critical path (M1)

`001 → 002 → 006 → 012 → 013 → 016 → 019 → 021 → 022 → 023 → 024 → 025 → 033 → 037 → 038` — 15 steps. `gate` (019) and `check` (025) are the two widest fan-in points; nothing on the path is parallelisable further without splitting `gate`, which I refuse to do (it is one pure function over two inputs and must stay byte-deterministic).

### Assignment

Every M1 script task: **js-dev** (Node, stdlib, `node:test`). Prose/agent tasks (034, 035, 036, 039-skill half, 042-skill half, 046, 047): **js-dev with the writing-skills skill loaded** — this repo has no separate docs role; the tech-lead reviews every AGENT.md frontmatter against §4.10 before merge. E2E and smoke (038, 053): **qa-engineer**. Doc PR (001), dogfood (054), probe (055): **maintainer** (the user) or js-dev.

---

## 2. Tech-lead readings (TL-1 … TL-12)

Where spec v6 fixes a contract but leaves the representation open, I fix the representation here so parallel tasks share one boundary. None of these changes a §2 promise or §3 decision; each is flagged for the maintainer in §8.

| # | Reading | Why |
|---|---|---|
| TL-1 | `evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`, `plan.mjs` are thin argv dispatchers; every subcommand lives in `scripts/lib/cmd-<name>.mjs` exporting `run(argv, ctx) → Promise<number>` (exit code), and shared code in `scripts/lib/<module>.mjs`. Every `lib/*.mjs` has a sibling `*.test.mjs` too (spec §10 requires tests for the eight named scripts; it does not forbid more modules). | 15 subcommands in one file = every task rebasing on every other task. The dispatcher is written once (TASK-006); each task adds one `case` line. |
| TL-2 | Consumer root = `--root <dir>` or `git rev-parse --show-toplevel` of cwd. `<st>` = `<root>/.agents/security-testing/`. All commands refuse to run outside a git work tree (exit 2). | Every path in the spec is repo-relative. |
| TL-3 | **Run directory boundary.** `run init` creates two sibling trees keyed by `run_id`: `<st>/runs/<run_id>/` (artifacts) and `<st>/ledger/<run_id>/imports/` (redacted import bytes, spec §6.6). "`build-report` reads only from the run directory" (§6.3) is implemented and tested as: opens nothing outside `runs/<run_id>/` **and** `ledger/<run_id>/`. The US-016 AC-1 fixture plants newer artifacts in another run's dirs and at `<st>/` root and proves they are not read. | §6.6 fixes the imports path under `ledger/`; §6.3 needs imports as a transitive input. Two trees, one key. |
| TL-4 | **Receipts and claims are agent drop-boxes; scripts admit.** Agents write payload-only JSON (no envelope) under `<st>/receipts/<run_id>/`. `evidence.mjs receipt validate --run <id> <file>` envelopes and copies an accepted receipt into `<run>/receipts/<self_sha256>.json`; only admitted receipts are inputs. Likewise agent findings are a payload-only claims file passed to `gate --claims <file>`; `gate` writes `findings.claimed.json` (the script assigns ids, the agent never does — §4 rule 3). | Keeps "reads only from the run directory" true and keeps agents unable to write ids/states. |
| TL-5 | **`engagement.md` machine record** = one fenced ```` ```json engagement ```` block inside the Markdown (prose around it is free). Parsed with the strict reader from `canon.mjs` (duplicate keys rejected, integers only). `run init` snapshots the parsed block as `<run>/engagement.json` (the "engagement snapshot" input of the assessment template). | Stdlib-only; a YAML subset parser for nested `execute_project_tests.install.argv` is a bug farm; the spec never says YAML. |
| TL-6 | **`verify.mjs all` is two-pass.** Pass 1 (no `--receipts`) runs steps 1–6a, writes the fix-review packet, evaluates with the receipt absent (⇒ `UNVERIFIED-INDETERMINATE(fix-review)`), prints `PACKET <path>` and `NEXT: dispatch security-reviewer fix-review`. Pass 2 (`--receipts <dir>`) is a fresh `verify` run (new `seq`) that re-executes everything and admits the receipts. Packet identity is deterministic (head blob oids + range HMACs + policy) so a receipt written against the pass-1 packet matches the pass-2 packet. | A script cannot dispatch an agent; §6.1 says retry = new seq, nothing rewritten. |
| TL-7 | **`check` names the tampered field** via renderer line markers: every report line that displays a derived value starts with `<!-- v:<view-path> -->`. `check` re-renders, byte-compares, and on mismatch reports `INCONSISTENT(<view-path of the first differing marked line>)`; unmarked lines report `INCONSISTENT(report)`. Recomputed artifacts that differ from stored ones report `INCONSISTENT(gate-result | coverage | states | verify:<run_id> | register | rejects | unlocated | input:<kind>)` before any byte comparison. | US-017 AC-2 needs a field name from a byte-tampered report without a Markdown parser. |
| TL-8 | **Register lives at `<st>/register/`** (`events.jsonl`, `projection.json`, `finding-alias.jsonl`, `lock/`) and is *not* in the managed ignore block (v3 §6.8: register "commit: policy", like `engagement.md` and `threat-model.json`). | The managed patterns in §6.9 are exact and exclude it. |
| TL-9 | Keys: `<st>/private/keys/<key_id>` (32 random bytes, mode `0600`, `O_EXCL`), `key_id = "k" + sha256(keybytes)[0:12]`, `<st>/private/keys/current` holds the active `key_id`; `<st>/private/keys/index.json` records `{key_id → {engagement_id, created_at}}` so `purge --engagement` can remove exactly that engagement's keys. `run_id = head_oid[0:12] + "-" + seq (zero-padded to 4)`. | v3 §6.1 run_id shape; §6.5 key contract. |
| TL-10 | Content identity is HMAC everywhere content bytes are the preimage (file HMACs in `scope.json`, `range_hmac`, baseline entries, snapshot originals, `tested_tree`, import `original_hmac`); artifact identity is plain sha256 over canonical payload; a plain sha256 of *redacted* bytes is allowed (`import_sha256`, snapshot-side `oid`). | §2 row 4 last sentence, v3 §6.4 "no offline oracle". |
| TL-11 | Deterministic time: `ctx.now()` reads `SECURITY_EVIDENCE_NOW` (ISO-8601) when set, else the clock. `created_at` and event `ts` are the only consumers; they never enter a payload or a preimage. `actor` = `--actor` / `SECURITY_EVIDENCE_ACTOR` / `"unknown"`. | E2E byte-equality across runs. |
| TL-12 | `deletion_only` (verify step 4) = the `base..head` diff of the finding's `path` removes at least one line inside the cited range **and** adds zero lines to that file. Indicator kinds are a closed list (§4.5). | §6.4 says the flag exists; v3 §6.3 says what it meant. |

---

## 3. Interface contracts — common

### 3.1 Process contract (all five scripts)

- Invocation: `node <script>.mjs <command> [<subcommand>] [flags]`. `--help` / no command ⇒ usage on stdout, exit `2` (except `--help` ⇒ `0`).
- Global flags (accepted before or after the command): `--root <dir>`, `--actor <name>`, `--quiet`.
- stdout: result tokens exactly as the spec spells them, one per line; a command that writes an enveloped artifact ends with `WROTE <repo-relative path> sha256=<self_sha256>`. stderr: diagnostics only. Every string printed or written passes through `redact.mjs` first (US-003).
- Child processes: `spawn`/`execFile` with an argv **array**, `shell: false`, explicit `cwd`, explicit `env`. Never `exec`, never `shell: true`, never string interpolation into a command (D8).
- No network. No `fetch`, no `http`, no `child_process` calls to `curl`/`gh`/`npm publish`. `publish --to` writes files; the tracker call is the lead's `issue-tracking` skill.

### 3.2 On-disk layout in the consumer repo

```
.agents/security-testing/
  engagement.md                      # human + ```json engagement block (TL-5)   — commit by policy
  knowledge/                         # seeded by factory `seed` or written by engagement init (D12)
    engagement.md.template  finding-schema.md  report-reading-guide.md
  threat-model.json                  # M2                                        — commit by policy
  register/                          # TL-8                                      — commit by policy
    events.jsonl  projection.json  finding-alias.jsonl  lock/
  private/                           # managed-ignored
    keys/<key_id>  keys/current  keys/index.json
    baseline.<engagement_id>.json
    snapshots/<run_id>/<path>        # redacted bytes of dirty review files
    citations/<run_id>/<finding_id>.json
  ledger/                            # managed-ignored
    index.json  index.lock/
    <run_id>/imports/<import_sha256>
  runs/<run_id>/                     # managed-ignored
    run.json  engagement.json  scope.json  examined.json
    ingest/<import_sha256>.json      # per-import derived records
    findings.claimed.json  gate-result.json  rejects.json  unlocated.json  coverage.json
    packets/<packet_sha256>.json  receipts/<receipt_sha256>.json
    verify.json                      # verify-kind runs
    threat-model.json  dispositions.json  observations/  admissions/   # M2/M3
    report.md  manifest.json  COMMITTED
  receipts/<run_id>/                 # agent drop-box (TL-4)                      — managed-ignored
  proposals/<id>.proposal.md         # M3                                         — managed-ignored
  handoffs/<slug>.md                 # M3                                         — managed-ignored
  imports/                           # reserved, managed-ignored (ingest inputs the lead copies in)
reports/security/                    # publish --profile redacted-report|full-report — managed-ignored
tasks/security-<slug>-admitted/      # publish --profile case                     — managed-ignored
```

### 3.3 Module map (`scripts/`)

| File | Exports (contract) | Task |
|---|---|---|
| `canon.mjs` | `parseStrict(text)`, `canonical(value) → Buffer`, `sha256Hex(buf)`, `hmacHex(keyBytes, buf)`, `makeEnvelope({kind, run_id, engagement_id, key_id, now}, payload)`, `artifactId(payload)`, `writeArtifact(path, artifact)` (tmp+rename), `readArtifact(path, {kind?}) → {envelope, payload}` (verifies `self_sha256`; throws `IntegrityError`) | 002 |
| `normalize.mjs` | `normalizeText(buf) → {lines: string[], text: string}`; throws `EncodingError` | 003 |
| `redact.mjs` | `loadRules(path?) → Rules`, `redactString(s, rules) → {text, hits[]}`, `redactDeep(value, rules) → value`, `matches(strOrBuf, rules) → boolean`, `RULES_PATH` | 004 |
| `lib/schema.mjs` | `validate(schemaName, value) → string[]` (errors), `loadSchema(name)`; supported keywords listed in TASK-005 | 005 |
| `lib/ctx.mjs` | `createContext(globalFlags) → ctx` where `ctx = {root, st, now(), actor, engagement() (lazy, TL-5), key() (lazy, current key or null), keyById(id), log(), out()}` | 006 |
| `lib/exit.mjs` | `EXIT = {OK:0, INTERNAL:1, USAGE:2, INDETERMINATE:3, FAIL:4, INTEGRITY:5}`, `class CliError(code, token)` | 006 |
| `lib/git.mjs` | `git(root, argv, {input?}) → {stdout, code}` (execFile, shell:false), `toplevel(cwd)`, `revParse`, `blobOid(root, oid, path)`, `showBytes(root, oid, path) → Buffer`, `statusPorcelain`, `lsFiles({stage?, others?, excludeStandard?})`, `checkIgnore(path) → boolean`, `diffNameOnly(base, head)`, `diffUnified(base, head, path?)`, `mergeBaseIsAncestor`, `worktreeAdd(dir, oid)`, `worktreeRemove(dir)` | 006 |
| `lib/fsx.mjs` | `writeExclusive(path, bytes, mode)` (`wx`), `appendLine(path, line)` (`a`, one `writeSync`), `writeAtomic(path, bytes)` (tmp+rename), `withLock(dir, fn, {timeoutMs})` (`mkdirSync` lock dir, retry/backoff), `walk(dir)` sorted | 006 |
| `lib/engagement.mjs` | `parseEngagementMd(text) → record` (TL-5), `ENGAGEMENT_SCHEMA`, `defaultRecord()` | 007 |
| `lib/keys.mjs` | `ensureKey(ctx, {rotate}) → {key_id, created}`, `loadKey(ctx, key_id) → Buffer|null`, `currentKeyId(ctx)` | 009 |
| `lib/baseline.mjs` | `computeBaseline(ctx) → payload`, `diffBaseline(ctx, baseline) → {changed[], added[], removed[], ignored_counts{}}` | 010 |
| `lib/ledger.mjs` | `allocateRun(ctx, {kind, base_oid, head_oid}) → {seq, run_id}` (under lock), `readIndex(ctx)`, `listCommittedRuns(ctx)` | 012 |
| `lib/cite.mjs` | `resolveSide(ctx, run, scope, {path, side}) → Buffer`, `checkRange(scope, citation) → {ok, reason?, context?}`, `occurrenceOf(lines, normalisedSnippet, start)`, `rangeBytes(buf, start, end)` | 014 |
| `lib/imports.mjs` | `snapshotImport(ctx, run_id, buf, {kind, source_path}) → {import_sha256, original_hmac, redaction_version, path}` | 015 |
| `lib/states.mjs` | `applyReceipts(gateResult, receipts[], packets[]) → {states{}, mitigation_states{}, not_applied[], conflicts[]}` (pure) | 022 |
| `lib/render.mjs` | `buildView(inputs) → view`, `renderMarkdown(view, template) → string` (pure, markers per TL-7) | 023/024 |
| `lib/evaluate.mjs` | `evaluate(raw) → {verdict, refound_observed, ack_refs, events}` (pure) | 026 |
| `lib/register-core.mjs` | `openRegister(ctx)`, `append(ctx, event)`, `replay(events) → projection`, `verifyChain(events)`, `anchor(projection)` | 028 |
| `lib/cmd-*.mjs` | one per subcommand: `run(argv, ctx) → Promise<number>` | per task |

Fixtures live under `scripts/fixtures/<area>/…` — never in a directory named `test` (see guardrail G-12).

---

## 4. Interface contracts — commands, schemas, agents, manifests

### 4.1 `evidence.mjs`

| Command | argv | Reads | Writes | stdout (success) | Exit |
|---|---|---|---|---|---|
| `engagement init` | `[--rotate]` | `engagement.md` (if present), `.gitignore`, `git ls-files`, `git check-ignore` | managed `.gitignore` block; `private/keys/*`; `private/baseline.<eid>.json`; `knowledge/*` when absent | `IGNORE-BLOCK: written|unchanged`, `KEY: <key_id> created|reused|rotated`, `BASELINE: <n files> ignored=<n>`, `TEMPLATES: written|present` | `0`; `4 TRACKED(<path>)` / `4 NOT-IGNORED(<path>)` (nothing written after the failing step); `2` when `engagement.md` absent **and** templates already present (nothing to initialise from) |
| `engagement validate` | — | same as init steps 1–2 | nothing | `IGNORE-BLOCK: ok`, `TRACKED: none`, `KEY: available|unavailable`, `BASELINE: present|absent` | `0` / `4` |
| `engagement baseline` | — | working tree | `private/baseline.<eid>.json` (overwrites, atomic) | `BASELINE: …` | `0` |
| `run init` | `--kind assessment|review|verify|threat-model --base <ref> [--head <ref>]` (`--base` required for `review`; defaults to head for others) | `git status --porcelain` (assessment only), `git rev-parse` | `ledger/index.json` (+1 entry under lock), `<run>/run.json`, `<run>/engagement.json`, empty `packets/ receipts/ ingest/`, `ledger/<run_id>/imports/` | `RUN <run_id> seq=<n> kind=<k> base=<oid> head=<oid>` | `0`; `3 DIRTY-TREE` (assessment, dirty; ledger untouched) |
| `scope` | `--run <id> [--include <path-or-glob>]… [--max-bytes <n>=1048576]` | engagement `scope_paths`, `git ls-files`, working tree (review) | `<run>/scope.json`; review: `private/snapshots/<run>/<path>` | `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` + `WROTE` | `0`; `2` if run kind is `assessment` and tree became dirty since `run init` (`DIRTY-TREE` — assessment must remain clean) |
| `ingest <kind> <file>` | `--run <id>`; kinds `sarif|ticket|pr|doc|case|audit|qa-run|ta-report|tracker-readback` | the file, `scope.json`, engagement `targets` | `ledger/<run>/imports/<import_sha256>`, `<run>/ingest/<import_sha256>.json` | `IMPORT <kind> import_sha256=<h> records=<n> unlocated=<n> rejected=<n>` | `0`; `2` malformed input (structural); rejections inside a well-formed file never change the exit code |
| `gate` | `--run <id> [--claims <payload.json>]…` | `scope.json`, `ingest/*.json`, claims files, key | `findings.claimed.json`, `gate-result.json`, `rejects.json`, `unlocated.json`, `private/citations/<run>/<id>.json` | `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>` + `WROTE` ×4 | `0`; `3` if `scope.json` missing (`INCOMPLETE(scope)`) |
| `coverage` | `--run <id> --examined <payload.json> [--scanner-rows <file>]` | `scope.json`, examined declaration | `examined.json`, `coverage.json` | `COVERAGE examined=<n> skipped=<n> scanner=<n>` or `COVERAGE INDETERMINATE` (empty scope) | `0`; `4 OVERLAP(<path>:<a-b>)` / `4 GAP(<path>:<a-b>)` |
| `packet` | `--run <id> --subject <finding_id|mitigation_id|case_sha256>… [--type review|mitigation-review|fix-review|case] [--policy <file>]` | `scope.json`, `gate-result.json`, key | `<run>/packets/<packet_sha256>.json` | `PACKET <path> sha256=<h> files=<n>` | `0`; `2` unknown subject |
| `receipt validate` | `--run <id> <file>` | drop-box file, packet, `run.json` | `<run>/receipts/<sha>.json` | `RECEIPT admitted sha256=<h> type=<t> subject=<id>` | `0`; `4 REJECTED(<reason>)` (schema, unknown packet, `packet_sha256` mismatch, oid mismatch, forbidden field) |
| `receipt apply` | `--run <id> [--json]` | `gate-result.json`, `receipts/*`, `packets/*` | nothing | table of `subject → state`, `not-applied: <n>`, `conflicts: <n>`; `--json` prints the `states.mjs` result | `0` |
| `build-report` | `--run <id> --template review|assessment|verify|threat-model` | only `runs/<id>/` + `ledger/<id>/` (TL-3) | `report.md`, `manifest.json`, `COMMITTED` (last) | `REPORT <path>`, `MANIFEST sha256=<h>`, `COMMITTED` | `0`; `3 INCOMPLETE(<input>)`; `5 INCONSISTENT(gate-result)` when the stored gate-result differs from the in-memory re-run |
| `check` | `<run dir | manifest.json> [--integrity] [--drift] [--trusted-digest <sha256>]` (no flag ⇒ structure + recompute only) | run dir, git objects, working tree, key | nothing | lines in this order: `CONSISTENT | CONSISTENT-REDACTED-ONLY(n citations) | INCONSISTENT(<field>) | STRUCTURE-ONLY`, then (with `--drift`) `CURRENT | CITATION-DRIFTED(n) | SCOPE-DRIFTED(n files)`, then `ORIGIN: unauthenticated | matches supplied digest`, then `KEY: available | unavailable` | `0` for CONSISTENT/REDACTED-ONLY/STRUCTURE-ONLY regardless of drift; `5` for INCONSISTENT; `3` when run is not COMMITTED (`INCOMPLETE(COMMITTED)`) |
| `check-export` | `<export-manifest.json> [--source <run dir>]` | manifest, output file, run dir | nothing | `VERIFIED-DERIVATIVE` / `LINKED-ONLY` / `MISMATCH(output)` | `0` / `0` / `5` |
| `publish` | `--run <id> --profile redacted-report|full-report|tracker|handoff|case --to <destination> [--slug <s>] [--base-url <u>]` | run dir, register (tracker), admissions (case/handoff) | files under `--to`; `export-manifest.json` next to them | `PUBLISHED profile=<p> output=<path> sha256=<h>`; tracker dedupe: `DEDUPE finding=<id> existing=<url>` | `0`; `2` if `full-report` without explicit `--profile full-report` (there is no default profile); `2` if run not COMMITTED |
| `sign-off` | `--engagement <id> [--expect <anchor>]` | `ledger/index.json`, every COMMITTED run (runs `check` logic in-process), baseline, register, admissions vs `tasks/security-<slug>-admitted/` | nothing | `SIGN-OFF: OK` or `SIGN-OFF: FAIL(<cause>)…`, then sections `RUNS:`, `INCOMPLETE:`, `CHANGES-SINCE-BASELINE:`, `EXCLUDED-COVERAGE:`, `UNAUTHENTICATED-APPROVALS:`, `UNADMITTED:`, `DISPOSITIONS:` | `0`; `4 NO-ASSESSMENT` (no `UNGATED` text anywhere); `4 <cause>` |
| `purge` | `--engagement <id> [--yes]` | ledger, run.json of every run | deletes matching runs, ledger entries, `private/snapshots|citations/<run>`, keys of that engagement, `ledger/<run>/imports`, `imports/` | `PURGED runs=<n> keys=<n>` | `0`; `2` without `--yes` (prints what would be deleted) |

Kind of every artifact (envelope `kind`): `run, engagement, scope, examined, ingest, claimed, gate-result, rejects, unlocated, coverage, packet, receipt, verify, manifest, export-manifest, threat-model, dispositions, admission, observation, baseline, citation-record`.

### 4.2 `verify.mjs`

| Command | argv | Behaviour | stdout | Exit |
|---|---|---|---|---|
| `all` | `--finding <id> --base <oid> --head <oid> [--receipts <dir>] [--timeout-s <n>]` | allocates a `verify`-kind run (dirty main tree allowed); steps 1–6a per §6.4; evaluates; writes `<run>/verify.json`; runs `build-report --template verify` in-process; consumes into the register when `--receipts` given (`register-core.append` of the verdict event, TASK-030) | step lines `BRANCH <token>`, `TREE-BEFORE <oid>`, `INSTALL <ran|skipped> tracked_changes=<n> untracked=<n> bytes=<n>`, `SUPPRESSION indicators=<n> deletion_only=<bool>`, `TESTS <token> exe=<path> sha256=<h>`, `PACKET <path>`; last line **exactly** `VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>` | `0` whenever a verdict is emitted (including every `UNVERIFIED-*`); `2 UNKNOWN-FINDING`; `4 UNVERIFIED-REFUTED-FINDING` (refusal, no run allocated) |
| `evaluate` | `<verify.json>` or `--raw <json>` | pure; no git, no fs beyond the input | JSON `{verdict, refound_observed, ack_refs, events}` | `0`; `2` malformed |

Finding lookup: ledger runs newest-first → `gate-result.accepted[]` contains the id; its derived state comes from `states.applyReceipts` over that run. Test argv: only `engagement.execute_project_tests.argv`; first token allowlist `npm npx pnpm yarn node python python3 pytest go cargo mvn ./gradlew gradle make dotnet`; deny any token containing `; | & $ < > \` newline` or equal to `-e --eval -c exec` and `run-script|run` whose next token ≠ `test`; env = `{PATH, HOME, LANG, TERM=dumb, CI=1, NO_COLOR=1}`; timeout default `600` s (`SIGTERM` then `SIGKILL` after 5 s, whole process group); output captured ≤ 64 KiB, redacted, stored as `output_redacted` in `verify.json`. Indicator kinds (closed): `ignore-file-edit` (`.semgrepignore .trivyignore* .gitleaksignore .snyk .bandit .eslintrc* .eslintignore eslint.config.* .semgrep.yml .semgrep/**`), `inline-suppress` (added lines matching `nosec|nosemgrep|eslint-disable|noqa|NOSONAR|gitleaks:allow|trivy:ignore|#pragma warning disable|@SuppressWarnings`), `test-skip` (added lines matching `\.skip\(|\.only\(|xit\(|xdescribe\(|@pytest\.mark\.skip|@Ignore|@Disabled`). `id = sha256(kind\0path\0line)` or `HMAC_key(kind\0path\0redacted line)` when the line matches a redaction rule (`sensitive: true`).

`verify.json` payload: `{finding_id, base_oid, head_oid, branch, tree_before, install: {ran, argv_sha256, allow_tracked_changes, tracked_changes[], untracked_count, untracked_bytes}, tested_tree, suppression: {indicators[], deletion_only}, tests: {result, argv_sha256, executable_path, executable_sha256, exit_code, timed_out, output_redacted}, packet_sha256, receipts: [{sha256, type, assertion|indicator_id, applied}], row_status_at_start, evaluation}` — `evaluation` is exactly `evaluate()` of the rest; `check` recomputes it.

### 4.3 `register.mjs`

| Command | argv | Effect |
|---|---|---|
| `add` | `--subject <finding_id|threat_id> --priority p0|p1|p2|p3 --title <t> --run <run_id> [--owner <o>]` | new row `R-nnnn` status `open` |
| `accept <R-id>` | `--until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>` | `open|regressed → accepted`; acceptance record `{recorded_by: actor, approved_by, approval_ref, until, authenticated: false}`; both flags mandatory (exit 2 otherwise) |
| `revoke <R-id>` | `--approved-by --approval-ref` | `accepted → open` |
| `check` | — | every `accepted` row with `until` (UTC, exclusive) < today ⇒ `open`, event `acceptance-expired` |
| `close-false-positive <R-id>` | `--approved-by --approval-ref` | `open → false-positive` |
| `reopen <R-id>` | `--reason <r>` | `false-positive → open` |
| `supersede <R-id>` | `--by <R-id> (--subject-equivalent | --transfer-exposure)` | see §6.8; cycle or self ⇒ exit 2; neither flag ⇒ exit 2 `EQUIVALENCE-REQUIRED`; `--subject-equivalent` without same subject or alias link ⇒ exit 4 |
| `alias` | `--from <finding_id> --to <finding_id> --reason <r> --run <run_id>` | appends to `finding-alias.jsonl` (hash-chained like events); no row change |
| `consume-verdict <verify.json>` | — | `VERIFIED ⇒ fixed` (+`ack_refs`, `last_verified_run`); `REGRESSED ⇒ regressed`; `UNVERIFIED-* ⇒ event only`; `regression-observed` event whenever `evaluation.refound_observed && row.status == fixed` (TASK-030) |
| `transition <event> <R-id> [flags]` | generic form; the verbs above are aliases | |
| `status` | `[--json]` | projection summary: counts by status × priority, `open_exposure` (open+regressed by priority), `unauthenticated_approvals` (accepted + false-positive + rows with ack_refs), never subtracting |
| `replay` | `[--write]` | rebuild projection from log; `--write` persists |
| `anchor print` / `anchor verify --expect <eid:seq:hash>` | | `MATCH | TRUNCATED | DIVERGED` |
| `confirm` | — | **does not exist** — falls through to unknown command, exit 2 (US-021 AC-2) |

Recovery on every command (§6.8): `projection.seq < log.seq ⇒ rebuild`; `projection.seq > log.seq` or any `prev_sha256` mismatch ⇒ exit `5 CORRUPT`, write nothing. Event = `{seq, prev_sha256, ts, actor, row_id, event, payload, ref}`; `event_sha256 = sha256(canonical(event))`; genesis `prev_sha256` = 64 zeros; `chain_sha256` = last `event_sha256`. Row fields: `id, subject, subject_kind: finding|threat, title, status, priority, owner, first_seen_run, last_verified_run, ticket_url, test_refs[], proposal_refs[], acceptance?, false_positive?, ack_refs[], rationale, supersedes, superseded_by`. Statuses: `open accepted fixed regressed false-positive superseded`.

### 4.4 `tm-lint.mjs` (M2; M1 ships CLI shape + schema validation only)

`check --run <id> [--model <path>=<st>/threat-model.json]` → validates schema, one citation per element (resolved via `cite.mjs` on the run's scope), every disposition relationship (§6.10); writes `<run>/threat-model.json` (snapshot) and `<run>/dispositions.json` (`{threat_id → {kind, ref, resolved_via}}`); prints `TM elements=<n> threats=<n> undisposed=<n>`; exit `4 TM-INVALID(<threat|element>: <reason>)`. `render --run <id>` → `<run>/threat-model.md` from the snapshot. Threat-model payload: `{elements[{id, kind: process|datastore|external|flow|boundary, name, citation{path, side, lines}}], threats[{id: T-nnn, element_id, stride: S|T|R|I|D|E, title, mitigations[{id: M-nnn, claim, citation?}], disposition{kind, ref?}}]}`.

### 4.5 `plan.mjs` (M3; M1 ships CLI shape + schema validation only)

`admit --run <id> <case.md> [--receipt <admitted receipt>]` → `<run>/admissions/<case_sha256>.json` per §9.1; `propose --run <id> <proposal.md>` → validates `proposal` frontmatter and writes `<st>/proposals/<id>.proposal.md` — refuses any destination whose repo-relative path starts with `tasks/` (exit 2 `PROPOSAL-UNDER-TASKS`); `ta-prompt --run <id> --slug <s> --base <branch>` prints the §9.3 prompt from admitted cases only.

### 4.6 Schemas (`skills/security-evidence/references/*.schema.json`)

All schemas: `additionalProperties: false` at every object level, `type: integer` for every number (no `number` anywhere), and the envelope validated once by `envelope.schema.json` (`schema_version, kind, run_id, engagement_id, key_id, created_at, self_sha256` all required; `key_id` may be `""` for `register`-free artifacts written without a key — only `engagement init` output before a key exists, i.e. none in practice; keep the field required).

| Schema | Required payload fields | Notes |
|---|---|---|
| `run` | `engagement_id, seq, base_oid, head_oid, template` | `template ∈ assessment|review|verify|threat-model` |
| `scope` | `files[], ranges, skipped[]` (+ optional `snapshot`) | `files[]: {path, side: head|snapshot, oid, file_hmac, lines}`; `ranges: {path: [[start,end]…]}`; `skipped[]: {path, reason ∈ binary|too-large|symlink|submodule|unreadable}`; `snapshot: {path: {original_hmac, redacted_sha256, redaction_version}}` |
| `finding` | `id, title, class, priority, confidence, path, side, lines, state, occurrence, source` (+ exactly one of `snippet` / `snippet_redacted` / `context_redacted`; `sensitive`, `cwe`, `citations_typed[]`, `description, impact, prerequisites, remediation` optional, rendered as `unknown / not assessed` when absent) | `class` enum: `injection xss ssrf path-traversal deserialization auth authz crypto secret input-validation config logging dos supply-chain unmapped`; data-flow set = first five; `state ∈ CITATION_VERIFIED|CITATION_FAILED`; `priority ∈ p0..p3`; `confidence` 0–10 |
| `claimed` (in `finding.schema.json` as `ClaimSet`) | `scope_sha256, findings[]` | claim item = finding minus `id, state, occurrence` (+ optional `occurrence_hint`) |
| `gate-result` | `accepted[], unverifiable[], rejected_counts, scope_sha256, claimed_sha256` | `accepted[]/unverifiable[]` are finding ids; `rejected_counts: {reason: count}` |
| `coverage` | `accounting[], scanner_rows[], scope_sha256, examined_sha256` | `accounting[]: {path, range: [s,e], status ∈ examined|skipped|scanner-only|unexamined, by: [examined_ref|scanner_row_ref]}`; `scanner_rows[]: {tool, version, import_sha256, paths[]}`; empty scope ⇒ `accounting: []` and command prints `INDETERMINATE` |
| `examined` | `declared[]` | `{path, ranges[[s,e]], declared_by: run_id}` |
| `packet` | `subject_ids[], files[], policy_sha256` | `files[]: {path, side, oid, ranges[[s,e]], range_hmac}` |
| `receipt` | `type, subject_id, packet_sha256, assertion, reviewer_run_id` | `assertion` closed per type; `ack` assertion is `{indicator_id}`; **forbidden keys anywhere**: `state, verdict, id, gate, gate_stamp, states` (validate rejects) |
| `verify` | as §4.2 | `evaluation.verdict` enum: `VERIFIED REGRESSED UNVERIFIED-REFOUND UNVERIFIED-NOT-COMMITTED UNVERIFIED-TESTS-FAILED UNVERIFIED-NO-TEST-SURFACE UNVERIFIED-INDETERMINATE(<check>) UNVERIFIED-SUPPRESSION(deletion-only) UNVERIFIED-SUPPRESSION(<n> unacked)` (pattern) |
| `run-manifest` | `inputs, report_sha256, template, template_version, tool_version` | `inputs: {kind: sha256}` where a set input (packets, receipts, ingest, verify runs) is the sha256 of the sorted list of member hashes |
| `register` (projection) | `engagement_id, seq, chain_sha256, rows{}` | row fields §4.3 |
| `register-event` | `seq, prev_sha256, ts, actor, row_id, event, payload, ref` | `event` enum §4.3 + `add regression-observed acceptance-expired` |
| `finding-alias` | `from_id, to_id, reason, run_id, seq, prev_sha256` | jsonl rows |
| `proposal` | frontmatter keys per US-038 AC-1 incl. `authorization {status: proposed, approver, approval_ref, authenticated: false}` | |
| `admission` | `case_sha256, classification, lint_hits[], assumptions{base_url_host, account}, target_policy_sha256` (+ `receipt_sha256` when `admitted-reviewed`) | `classification ∈ admitted-heuristic|admitted-reviewed|proposal` |
| `observation` | `observation_id, import_sha256, case_id, case_sha256, result, run_id, base_url, account, head_oid` | unknowns are the string `unknown`, never absent |
| `import` (the `ingest/*.json` record) | `kind, import_sha256, original_hmac, redaction_version, mapping_version, source_path, records[], unlocated[], rejected[]` | each record carries locator `{import_sha256, original_hmac, index}` |
| `export-manifest` | `source_manifest_sha256, profile, profile_version, output_sha256` | |
| `sarif-mapping.v1` | `version, tools{name: {confidence, rule_prefix_class{}}}, tag_class{}, level_priority{}, default_confidence` | |
| `redaction-rules` | `redaction_version, rules[{class, pattern, flags, replacement}]` | classes: `aws-key gcp-key azure-key jwt pem-block password-assign token-assign secret-assign bearer high-entropy-assign` |
| `engagement` (TL-5 block) | `engagement_id, slug, scope_paths[], product_paths[], targets{tracker[], browser[], repo}` (+ optional `base_url, execute_project_tests{argv[], timeout_s, install{argv[], allow_tracked_changes}}, sign_off{require_dispositions ∈ all|executed-or-ticketed|none}`) | |

### 4.7 Agent frontmatter (`bundles/security-testing/agents/<name>/AGENT.md`)

```yaml
# security-reviewer (M1)
---
name: security-reviewer
description: "Use when a security-lead dispatches a review, mitigation-review or fix-review over a packet path. Reads only the packet's listed files, returns a receipt path carrying an assertion from that contract's closed vocabulary; never writes a state, verdict, id or gate stamp."
model: sonnet
color: red
group: security
theme: {color: colour160, icon: "🛡️", short_name: rev}
aliases: [security-reviewer, secrev]
context-docs: security-testing/engagement.md security-testing/knowledge/finding-schema.md
skills: [memory, secure-code-review]
skills-on-demand: [security-evidence, systematic-debugging]
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
---
```

```yaml
# threat-modeler (M2)
name: threat-modeler · model: opus · color: magenta · group: security · theme: {color: colour135, icon: "🕸️", short_name: tm} · aliases: [threat-modeler, tm]
context-docs: security-testing/engagement.md security-testing/knowledge/finding-schema.md
skills: [memory, threat-modeling]
skills-on-demand: [security-test-planning, security-evidence, gathering-context, deep-research]
```

```yaml
# security-lead (M3)
name: security-lead · model: sonnet · color: red · group: security · theme: {color: colour196, icon: "🔐", short_name: sec} · aliases: [security-lead, sec]
context-docs: security-testing/engagement.md security-testing/knowledge/finding-schema.md security-testing/risk-register.md
skills: [memory, security-engagement]
skills-on-demand: [risk-register, security-evidence, issue-tracking, dispatching-parallel-agents, verifying-outcomes]
```

All three: no `tools:` (repo test `bin/no-tools-frontmatter.test.mjs` enforces), no `context-memory`, no `mcpServers` (so `merge_pull_request` cannot appear), every scalar containing `: ` quoted (repo test `bin/frontmatter-strict.test.mjs`), `metadata.authors` present, `SOUL.md` sibling. Body sections in this order: `## Tool-call economy` (copy verbatim from `bundles/feature-development/agents/tech-lead/AGENT.md`), `## Rules` (the four §4 rules), `## Contracts` (per dispatch type: inputs, what to read, what to write, the exact return line), `## Writable paths self-check`, `## Never`.

### 4.8 `factory.json`

M1 (TASK-037):

```json
{
  "id": "security-testing",
  "title": "Security Testing Team",
  "description": "Threat-led, read-only security testing team: code-derived STRIDE threat model, evidence-gated secure code review with re-checkable citations, passive security cases for the manual-qa and test-automation bundles, fix verification from a validated test-start snapshot, and a residual-risk register.",
  "agents": [],
  "localAgents": ["security-reviewer"],
  "localSkills": ["security-evidence", "secure-code-review", "security-engagement"],
  "skills": ["memory", "knowledge-curation"],
  "briefings": { "security-reviewer": "briefings/security-reviewer.md" },
  "seed": { "knowledge": ".agents/security-testing/knowledge" },
  "instructions": "instructions.md"
}
```

Final (TASK-048): `localAgents: ["security-lead", "threat-modeler", "security-reviewer"]`, `localSkills: ["security-evidence", "security-engagement", "threat-modeling", "secure-code-review", "security-test-planning", "risk-register"]`, three `briefings`, everything else identical. Never `hooks`, never `targets`.

`FACTORY.md` frontmatter: `name: Security Testing Team`, `description` (quoted, the sentence above), `owner: Applied AI`, `authors` list, `install_script`/`install_script_unix: "npx github:arozumenko/sdlc-skills init --factory security-testing"`, `sdlc_phase: Security Testing`, `support_level: Best Effort Support`, `use_cases` = the five §10 strings, no `project_deployments` key. `bin/validate-factories.mjs` requires `README.md` too.

---

## 5. Technical tasks

Format: **Story · Assigned · Depends on · Complexity** then Objective / Implementation / Interface Contract / Verification. Verification lists the `*.test.mjs` cases (file: test title) each task must make pass; titles quoted from spec §12 where the spec names the case. Every task also runs `npm test` green before PR; tasks that touch a manifest, `FACTORY.md`, `SKILL.md`, `AGENT.md` or generated marketplaces also run `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes`.

### M-1

#### TASK-001: Repo docs match the installer
**Story:** US-001 · **Assigned:** maintainer / js-dev · **Depends on:** none · **Complexity:** S

**Objective.** Land the M-1 doc-fix PR on its own branch before any M1 code.

**Implementation.**
- `CLAUDE.md`, `bundles/SPEC.md` (and `AGENTS.md`/`README.md` only where they repeat a path): every `factories/<id>` / `factories/SPEC.md` / `factories/*/skills` path → `bundles/…`. Keep `--factory`, `factory.json`, `FACTORY.md`, `validate:factories` names.
- `hooks/config.sh.example`: commented default `SDLC_ROLE_MEMORY_FILES` → `SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md` (matches `hooks/lib.sh:215`).
- `CLAUDE.md` § Commands: `npm run validate` = `validate:factories && validate:marketplaces && validate:externals && validate:dupes`; note `validate:externals` needs network.

**Interface Contract.** Docs only.

**Verification.**
- [ ] `grep -n "factories/" CLAUDE.md bundles/SPEC.md` returns zero path occurrences.
- [ ] `npm run validate:factories && npm run validate:marketplaces && npm test` exit 0; `git diff --stat` touches only the listed files.

### M1 — Group A (foundations)

#### TASK-002: `canon.mjs` — strict reader, canonical bytes, envelope, artifact I/O
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** M

**Objective.** One module every writer and reader uses for identity: canonical bytes, sha256/HMAC, envelope construction, tmp+rename writes, verified reads.

**Implementation.**
- `scripts/canon.mjs`: a hand-written recursive-descent JSON reader (`JSON.parse` cannot see duplicate keys) that throws `CanonError("duplicate key <k>")`, `CanonError("float not allowed")` for any number token containing `. e E` or outside `Number.isSafeInteger`; `canonical(value)`: NFC every string, sort keys bytewise (compare UTF-8 byte arrays, not JS string order), no whitespace, LF only, `\u` escapes only for control chars; `makeEnvelope`, `artifactId = sha256Hex(canonical(payload))`, `writeArtifact` (validates that payload contains no float/undefined before write), `readArtifact` (recomputes and compares `self_sha256`; throws `IntegrityError(path)`).
- `scripts/canon.test.mjs`.

**Interface Contract.** §3.3 row `canon.mjs`. Artifact = `{envelope, payload}`; `envelope.self_sha256 === artifactId(payload)`; envelope never hashed.

**Verification.**
- [ ] `canon.test.mjs: "scope identity independent of envelope"` — two artifacts, same payload, different `created_at`/`run_id` ⇒ equal `self_sha256` (US-002 AC-2).
- [ ] `canon.test.mjs: "duplicate key rejected on read"`, `"float rejected"`, `"non-NFC string normalised"`, `"CRLF in input yields LF-only canonical bytes"`, `"keys sorted bytewise not by locale"` (US-002 AC-3).
- [ ] `canon.test.mjs: "readArtifact throws IntegrityError on tampered payload"`.

#### TASK-003: `normalize.mjs` + published test vectors
**Story:** US-002 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** S

**Objective.** Text normalisation used by `gate`, `cite` and `coverage`, with the vectors shipped as a reference file.

**Implementation.** `scripts/normalize.mjs` (`TextDecoder("utf-8", {fatal: true})`, strip BOM, `\r\n|\r → \n`, NFC, per line collapse `[\p{Zs}\t]+` → one space and trim, drop empty lines — the only line removal); `references/normalize-vectors.json` `[{name, input_base64, expected_lines}]` covering BOM, CR, CRLF, tab runs, ` `, empty lines, invalid UTF-8; `scripts/normalize.test.mjs` iterates the vectors.

**Interface Contract.** `normalizeText(buf) → {lines, text}`; throws `EncodingError`.

**Verification.**
- [ ] `normalize.test.mjs: "every published vector matches"` (US-002 AC-5).
- [ ] `normalize.test.mjs: "invalid UTF-8 rejected"`, `"newlines preserved through step 5; only empty lines removed"`.

#### TASK-004: `redact.mjs` + `redaction-rules.json` v1
**Story:** US-003 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** M

**Objective.** The one redaction function every writer calls, with a versioned rule list.

**Implementation.** `references/redaction-rules.json` (`redaction_version: 1`, the ten classes of §4.6, each a JS-regex source + flags; `password=1234` must match `password-assign`; replacement `<REDACTED:<class>>`); `scripts/redact.mjs` exporting `loadRules`, `redactString`, `redactDeep` (recurses objects/arrays; leaves numbers/booleans/null; redacts object **keys** too), `matches`; a `Buffer` input is scanned as latin1+utf8 text; `scripts/redact.test.mjs`.

**Interface Contract.** §3.3 row. `redactDeep` is idempotent (`redactDeep(redactDeep(x)) deep-equals redactDeep(x)`).

**Verification.**
- [ ] `redact.test.mjs: "redaction inside nested SARIF strings and rejection reasons"` — nested object with `password=1234` in a `message.text`, a `reason` and a log line ⇒ no occurrence after `redactDeep` (US-003 AC-1).
- [ ] `redact.test.mjs: "rules file carries redaction_version"`, `"matches() true for password=1234 and false for benign text"`, `"idempotent"`, `"JWT, PEM block, bearer header, AWS key shape redacted"`.

#### TASK-005: JSON schemas + `lib/schema.mjs` validator subset
**Story:** US-002 AC-4, US-015 AC-7, US-021 AC-2 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** M

**Objective.** All schema files of §4.6 plus a stdlib validator that understands exactly the subset they use.

**Implementation.** `references/<name>.schema.json` for: `envelope, run, scope, finding (incl. ClaimSet), gate-result, coverage, examined, packet, receipt, verify, run-manifest, register, register-event, finding-alias, proposal, admission, observation, import, export-manifest, sarif-mapping.v1, redaction-rules, engagement, threat-model, dispositions, rejects, unlocated` (`rejects`: `{rejected[{reason, locator}]}`; `unlocated`: `{candidates[{locator, reason, tool, rule_id}]}`); `scripts/lib/schema.mjs` supporting `type` (object/array/string/integer/boolean/null), `required`, `properties`, `additionalProperties:false`, `enum`, `const`, `items`, `minItems`, `minimum`, `maximum`, `pattern`, `oneOf` (exactly-one), `$ref` to `#/$defs/*` only — validator refuses any other keyword with an error (fail loud); `scripts/lib/schema.test.mjs` includes a meta-test that loads every schema and asserts no `"type": "number"` anywhere, and a table test asserting each schema's `required` list equals the §4.6 row.

**Interface Contract.** `validate(schemaName, value) → string[]` (empty = valid); `receipt` schema's forbidden keys implemented as `additionalProperties:false` **plus** an explicit `not-keys` check in `receipt validate` so the error names the key.

**Verification.**
- [ ] `schema.test.mjs: "preimage table honoured"` — for each of `run, scope, gate-result, coverage, packet, receipt, run-manifest` the schema's required payload keys equal the §6.1 row (US-002 AC-4).
- [ ] `schema.test.mjs: "no schema declares number; integers only"`, `"no schema has authenticated:true or confirmed anywhere"` (US-021 AC-2), `"receipt schema rejects state/verdict/id/gate fields"` (US-015 AC-7).

### M1 — Group B

#### TASK-006: Script skeleton — dispatchers, `ctx`, `git`, `fsx`, `exit`, stubs for all five CLIs
**Story:** US-002 AC-1, US-030 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-002 · **Complexity:** M

**Objective.** The five entry points exist, share one context and one exit-code map, and every later task only adds a `cmd-*.mjs` file plus one dispatch line.

**Implementation.** `scripts/evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`, `plan.mjs` (parse global flags → `createContext` → route to `lib/cmd-<name>.mjs` → `process.exitCode`; unknown command ⇒ usage + `2`; uncaught ⇒ redacted message on stderr + `1`); `lib/ctx.mjs`, `lib/exit.mjs`, `lib/git.mjs` (every function `execFileSync("git", [...])` with `cwd: root`, never a shell), `lib/fsx.mjs` (`withLock` = `mkdirSync(lockDir)` loop with 20 ms backoff, 10 s timeout, stale-lock detection by mtime > 60 s); each with sibling tests. `tm-lint.mjs check|render` and `plan.mjs admit|propose|ta-prompt` are registered and validate their schemas but return `2 NOT-IMPLEMENTED(M2|M3)` beyond validation.

**Interface Contract.** §3.1 process contract; `ctx` shape in §3.3.

**Verification.**
- [ ] `evidence.test.mjs / verify.test.mjs / register.test.mjs / tm-lint.test.mjs / plan.test.mjs: "no command ⇒ usage, exit 2"`, `"--help ⇒ exit 0"`, `"unknown command ⇒ exit 2"` (incl. `register.mjs confirm` ⇒ 2, US-021 AC-2).
- [ ] `git.test.mjs: "every child process is spawned with shell:false and an argv array"` (grep-based guard over `scripts/**/*.mjs`: no `exec(`, no `shell: true`, no `execSync(` with a string).
- [ ] `fsx.test.mjs: "withLock serialises two writers"`, `"writeExclusive fails when the file exists"`, `"writeAtomic leaves no tmp file"`.
- [ ] `ctx.test.mjs: "SECURITY_EVIDENCE_NOW fixes now()"`, `"outside a git work tree ⇒ CliError 2"`.

#### TASK-007: Engagement record parser + knowledge templates (source files)
**Story:** US-007, US-029 AC-7 · **Assigned:** js-dev · **Depends on:** TASK-002, TASK-005 · **Complexity:** S

**Objective.** The `engagement.md` machine record (TL-5) and the three knowledge files that both the factory `seed` and `engagement init` install.

**Implementation.** `bundles/security-testing/knowledge/engagement.md.template` (prose + example ```` ```json engagement ```` block with every field of the `engagement` schema, `require_dispositions: executed-or-ticketed` as the documented default), `knowledge/finding-schema.md` (human rendering of `finding.schema.json` + the state/verdict token table), `knowledge/report-reading-guide.md` (how to read `check` output and the ORIGIN line); `scripts/lib/engagement.mjs` (`parseEngagementMd`: find the fenced block tagged `json engagement`, parse with `canon.parseStrict`, validate against `engagement` schema; hosts: strings without scheme/path); `scripts/lib/engagement.test.mjs`.

**Interface Contract.** `parseEngagementMd(text) → record` throws `CliError(2, "ENGAGEMENT-INVALID(<error>)")`; `ctx.engagement()` reads `<st>/engagement.md`.

**Verification.**
- [ ] `engagement.test.mjs: "template parses and validates"`, `"duplicate key in block rejected"`, `"missing block ⇒ ENGAGEMENT-INVALID"`, `"targets hosts must be bare hostnames"`.

#### TASK-026: `verify.mjs evaluate` — pure verdict function
**Story:** US-019 · **Assigned:** js-dev · **Depends on:** TASK-002, TASK-005 · **Complexity:** M

**Objective.** The evaluator, implemented before `verify all` so the E2E fixtures for verdicts are locked early and `check` can reuse it.

**Implementation.** `scripts/lib/evaluate.mjs` implementing §6.4 step 7 precedence exactly: (1) `refound_observed = fix_review.applied && fix_review.assertion === "refound"`; if `refound_observed && row_status === "fixed"` push event `regression-observed` **before anything else**; (2) completeness — any of `branch, tests, suppression, packet_sha256` missing/malformed ⇒ `UNVERIFIED-INDETERMINATE(<check>)` (tests unavailable = `tests.result` absent or `TESTS_INDETERMINATE(...)` ⇒ `(tests)`); (3) `refound` ⇒ `REGRESSED` if row `fixed` else `UNVERIFIED-REFOUND`; (4) fix-review absent / not applied / `indeterminate` ⇒ `UNVERIFIED-INDETERMINATE(fix-review)`; (5) `branch ≠ COMMITTED` ⇒ `UNVERIFIED-NOT-COMMITTED`; (6) tests `TESTS_FAIL` ⇒ `UNVERIFIED-TESTS-FAILED`, `NO_TEST_SURFACE` ⇒ `UNVERIFIED-NO-TEST-SURFACE`; (7) `deletion_only` ⇒ `UNVERIFIED-SUPPRESSION(deletion-only)`; (8) unacked indicators (ack must match `indicator_id` **and** `packet_sha256`) ⇒ `UNVERIFIED-SUPPRESSION(<n> unacked)`; (9) `VERIFIED` with `ack_refs[]`. `verify.mjs evaluate` subcommand (`lib/cmd-evaluate.mjs`) reads a file or `--raw`. Fixtures under `scripts/fixtures/evaluate/*.json` (one per rule).

**Interface Contract.** `evaluate(raw) → {verdict, refound_observed, ack_refs, events}`; raw shape = `verify.json` payload minus `evaluation`. Deterministic; no I/O.

**Verification.**
- [ ] `evaluate.test.mjs: "valid refound + unavailable tests ⇒ UNVERIFIED-INDETERMINATE(tests) and regression-observed event"` (§12).
- [ ] `evaluate.test.mjs: "two indicators with one ACK ⇒ UNVERIFIED-SUPPRESSION(1 unacked)"`, `"indicator + deletion-only ⇒ deletion wins"`, `"ACK for a different indicator ⇒ UNVERIFIED-SUPPRESSION"`, `"ACK on a different packet does not count"`, `"ACK + TESTS_FAIL ⇒ UNVERIFIED-TESTS-FAILED"`, `"missing fix-review receipt ⇒ UNVERIFIED-INDETERMINATE(fix-review)"`, `"positive tests + indeterminate fix-review ⇒ UNVERIFIED-INDETERMINATE(fix-review)"`, `"refound with complete checks ⇒ REGRESSED when row fixed else UNVERIFIED-REFOUND"`, `"branch NOT-COMMITTED ⇒ UNVERIFIED-NOT-COMMITTED"`, `"both indicators acked and green ⇒ VERIFIED with two ack_refs"` (US-019 AC-1…AC-5).
- [ ] `evaluate.test.mjs: "pure: same input twice ⇒ deep-equal output; no fs/child_process import"` (US-019 AC-6; asserted by reading the module source for imports).

#### TASK-028: `register.mjs` core — chained log, replay, recovery, anchor
**Story:** US-020 · **Assigned:** js-dev · **Depends on:** TASK-002, TASK-005, TASK-006 · **Complexity:** L

**Objective.** The append-only register with rebuild-vs-corrupt recovery and an anchor.

**Implementation.** `scripts/lib/register-core.mjs`: `openRegister(ctx)` (create dirs; run recovery rule on every open), `append(ctx, {row_id, event, payload, ref})` (under `register/lock/`: compute `seq = last+1`, `prev_sha256`, `ts = ctx.now()`, `actor`, one `appendLine` of the canonical JSON row, then `replay` and `writeAtomic(projection.json)`), `replay(events)` (pure fold; also the `regression-observed`/informational events which change no status), `verifyChain(events)`, `anchor(projection) → "<eid>:<seq>:<chain>"`, `anchorVerify(projection, expect)`; `lib/cmd-register-*.mjs` for `replay`, `status`, `anchor`; `scripts/register.test.mjs` + `lib/register-core.test.mjs`.

**Interface Contract.** §4.3 event shape, chain, recovery, anchor tokens. `status --json` is the object `check` and reports consume: `{counts: {status: {priority: n}}, open_exposure: {priority: n}, unauthenticated_approvals: n, rows: {...}}`.

**Verification.**
- [ ] `register-core.test.mjs: "interrupted append ⇒ rebuild"` — projection.seq < log.seq ⇒ next command rebuilds and proceeds (US-020 AC-2).
- [ ] `register-core.test.mjs: "projection ahead of log ⇒ exit 5 CORRUPT and nothing written"`, `"prev_sha256 mismatch ⇒ CORRUPT"` (AC-3).
- [ ] `register-core.test.mjs: "truncated log + projection vs anchor verify ⇒ TRUNCATED"`, `"rewritten event ⇒ DIVERGED"`, `"anchor print then verify ⇒ MATCH"` (AC-4).
- [ ] `register-core.test.mjs: "replay is deterministic (byte-identical projections)"` (AC-5); `"event-log truncation ⇒ replay mismatch exit 5"` (v3 §12).
- [ ] `register-core.test.mjs: "append uses O_APPEND under lock; projection rewritten tmp+rename"` (AC-1 — assert flags via a spy on `fsx`).

### M1 — Group C

#### TASK-008: `engagement init` steps 1–2 + `engagement validate`
**Story:** US-004 · **Assigned:** js-dev · **Depends on:** TASK-006, TASK-007 · **Complexity:** M

**Objective.** Managed `.gitignore` block, fail-closed checks, and the `validate` read-only variant.

**Implementation.** `scripts/lib/ignore-block.mjs` (`PATTERNS` exact list from §6.9, `renderBlock()`, `upsertBlock(text) → {text, changed}` idempotent between `# security-testing:begin` / `# security-testing:end`); `lib/cmd-engagement.mjs` with a step pipeline `[ignoreBlock, failClosed, keys, baseline, templates]` where steps 3–5 are wired in TASK-009/010/011; `failClosed`: `git ls-files -- <pattern>` non-empty ⇒ `4 TRACKED(<path>)`; for each pattern write nothing but call `git check-ignore -q <pattern>/.probe` (no file needed) ⇒ non-zero ⇒ `4 NOT-IGNORED(<path>)`; `engagement validate` runs steps 1–2 in dry-run mode.

**Interface Contract.** §4.1 rows `engagement init|validate`. Only `cmd-engagement.mjs` step 1 may modify `.gitignore` (guard G-5).

**Verification.**
- [ ] `cmd-engagement.test.mjs: "exact managed block, nine patterns, nothing else"` (US-004 AC-1); `"second init leaves .gitignore byte-identical"` (AC-2).
- [ ] `cmd-engagement.test.mjs: "tracked file under local paths ⇒ exit 4 naming the path, nothing under <st>"` (AC-3, v3 §12); `"negation un-ignoring reports/security/ ⇒ exit 4, no key, no baseline"` (AC-4).
- [ ] `cmd-engagement.test.mjs: "validate never writes"`.

#### TASK-009: HMAC key lifecycle
**Story:** US-005 AC-1…AC-3 · **Assigned:** js-dev · **Depends on:** TASK-008 · **Complexity:** S

**Objective.** Create/reuse/rotate keys per §6.5 and expose the key to every writer via `ctx.key()`.

**Implementation.** `scripts/lib/keys.mjs` (TL-9): `ensureKey` uses `fsx.writeExclusive(path, randomBytes(32), 0o600)`; `current` file atomic; `index.json` records `{engagement_id, created_at}`; `--rotate` creates a new key and repoints `current`, deletes nothing; `ctx.key()` returns `{key_id, bytes}` of `current` or `null`; `ctx.keyById(id)`; wire step 3 into `cmd-engagement.mjs`.

**Interface Contract.** `hmacHex(ctx.key().bytes, buf)`; every envelope's `key_id = ctx.key().key_id`.

**Verification.**
- [ ] `keys.test.mjs: "repeated engagement init reuses the key, --rotate adds one"` (§12; US-005 AC-1…AC-3 incl. mode 0600 and `wx` flag).
- [ ] `keys.test.mjs: "artifacts written after rotate record the new key_id"`.

#### TASK-010: Working-tree baseline
**Story:** US-006 AC-1 (+ listing consumed by TASK-033) · **Assigned:** js-dev · **Depends on:** TASK-009 · **Complexity:** M

**Objective.** `private/baseline.<eid>.json` and the diff function `sign-off` will use.

**Implementation.** `scripts/lib/baseline.mjs`: for each of `scope_paths ∪ product_paths`: tracked files (`git ls-files -z -- <p>`) and non-ignored untracked (`git ls-files -z --others --exclude-standard -- <p>`) ⇒ `{path → file_hmac}`; `ignored_count[p]` = count of `git ls-files -z --others --ignored --exclude-standard -- <p>`; plus `head_oid`, `index_sha256` (sha256 of `git ls-files -s` output — this is git metadata, not content); payload `{engagement_id, head_oid, index_sha256, entries{}, ignored_count{}}`; `diffBaseline` returns per-path `changed/added/removed` and current `ignored_count`; `engagement baseline` subcommand; step 4 wired into init.

**Interface Contract.** `diffBaseline(ctx, baseline) → {changed[], added[], removed[], ignored_counts{}}`.

**Verification.**
- [ ] `baseline.test.mjs: "baseline holds every tracked and non-ignored untracked file under scope and product paths with ignored_count"` (US-006 AC-1).
- [ ] `baseline.test.mjs: "dirty tracked and untracked baseline changes listed per path"` (§12), `"changed ignored product file ⇒ not a change; ignored_count reported"` (§12).

#### TASK-011: Knowledge templates written at `engagement init`
**Story:** US-007 AC-1, AC-2 · **Assigned:** js-dev · **Depends on:** TASK-007, TASK-010 · **Complexity:** S

**Objective.** The two-skill install gets the templates without a `seed`.

**Implementation.** `scripts/lib/knowledge-templates.mjs` embeds the three knowledge files by reading them from the skill's own directory at runtime (`../../knowledge/` relative to the installed skill is **not** guaranteed to exist in a standalone install, so the skill ships copies under `skills/security-evidence/templates/knowledge/`, and `bin/check-skill-dupes.mjs` gets a group pairing `bundles/security-testing/knowledge/*` with those copies); step 5: if `<st>/knowledge/` absent ⇒ write all; if present ⇒ touch nothing (per file: existing wins).

**Interface Contract.** After `engagement init`, `<st>/knowledge/{engagement.md.template, finding-schema.md, report-reading-guide.md}` exist. If `<st>/engagement.md` is absent, init also copies the template to `<st>/engagement.md` and prints `ENGAGEMENT: template written — edit and re-run` with exit `0` (baseline needs `scope_paths`; with the template defaults `scope_paths: ["."]`).

**Verification.**
- [ ] `knowledge-templates.test.mjs: "absent ⇒ written"`, `"present and locally edited ⇒ untouched"` (US-007 AC-1, AC-2).
- [ ] `bin/check-skill-dupes.mjs` passes with the new group (`npm run validate:dupes`).

#### TASK-012: `run init` + ledger
**Story:** US-008 · **Assigned:** js-dev · **Depends on:** TASK-009 · **Complexity:** M

**Objective.** Allocate a run first, refuse dirty assessments, snapshot the engagement record.

**Implementation.** `scripts/lib/ledger.mjs` (`allocateRun` under `ledger/index.lock/`: read index, `seq = max+1`, write `{seq, run_id, kind}` via `writeAtomic`; `run_id` per TL-9), `lib/cmd-run.mjs` (`init`: for `assessment` check `git status --porcelain` empty **before** allocation ⇒ `3 DIRTY-TREE`, ledger untouched; resolve `base_oid`/`head_oid` to full 40-hex; create `<run>/` dirs and `ledger/<run_id>/imports/`; write `run.json` and `engagement.json`).

**Interface Contract.** §4.1 row `run init`; `run.json` payload `{engagement_id, seq, base_oid, head_oid, template}`.

**Verification.**
- [ ] `cmd-run.test.mjs: "run init allocation before inputs"` (§12; run.json exists, no scope.json, index gained one entry).
- [ ] `cmd-run.test.mjs: "assessment on dirty tree refused"` (§12; exit 3 DIRTY-TREE, index unchanged), `"review on the same dirty tree allocates"`, `"retry allocates a new seq and rewrites nothing"`, `"two concurrent run init processes ⇒ two distinct seqs, index parses"` (US-008 AC-5; spawn two `node evidence.mjs run init` children).

#### TASK-029: Register transitions, approvals, supersession, aliases
**Story:** US-021 · **Assigned:** js-dev · **Depends on:** TASK-028 · **Complexity:** L

**Objective.** The full v3 §6.7 table minus `confirm`, with every approval `authenticated: false`.

**Implementation.** `scripts/lib/register-transitions.mjs` (`TRANSITIONS` table `{event: {from: [...], to, requires: [...flags]}}`, `applyTransition(row, event, payload) → row'` pure), `lib/cmd-register-transition.mjs` (+ verb aliases `add accept revoke check close-false-positive reopen supersede alias`), `finding-alias.jsonl` chained like events; supersession guards per §6.8 including `--transfer-exposure` ordering (raise target priority, then status, then mark source); `status` counts approvals into one bucket and never reduces `open_exposure`.

**Interface Contract.** §4.3 verbs and flags; approval record `{recorded_by, approved_by, approval_ref, authenticated: false}` (+`until` for acceptances).

**Verification.**
- [ ] `register-transitions.test.mjs: "transition table — every allowed row succeeds and every other pair is rejected"` (US-021 AC-1, table-driven).
- [ ] `register.test.mjs: "confirm is an unknown command (exit 2)"` (AC-2); `"accept without both flags rejected"` (v3 §12; AC-3); `"approval record shape has authenticated:false"`.
- [ ] `register-transitions.test.mjs: "accepted row counts in unauthenticated bucket; open exposure unchanged"` (AC-4).
- [ ] `register-transitions.test.mjs: "supersede without equivalence or transfer rejected"` (§12), `"supersede cycle rejected"` (v3 §12), `"--transfer-exposure raises priority to max and sets open when source open|regressed"`, `"alias link satisfies --subject-equivalent and changes no status"` (AC-5, AC-6).
- [ ] `register-transitions.test.mjs: "check expires acceptance past until (UTC, exclusive)"`.

#### TASK-032: `purge --engagement`
**Story:** US-024 · **Assigned:** js-dev · **Depends on:** TASK-012 · **Complexity:** S

**Objective.** Consumer-decided deletion of the four private trees for one engagement.

**Implementation.** `lib/cmd-purge.mjs`: collect run ids whose `run.json.engagement_id` matches; delete `runs/<id>`, `ledger/<id>`, `private/snapshots/<id>`, `private/citations/<id>`, ledger index entries, keys listed for that engagement in `keys/index.json`, `imports/`; leave `reports/security/`, `tasks/security-*/`, `proposals/`, `handoffs/`, `receipts/`, `register/`, `.gitignore` untouched; `--yes` required.

**Verification.**
- [ ] `cmd-purge.test.mjs: "deletes the four trees for the named engagement only"` (US-024 AC-1, AC-2), `"without --yes prints plan and exits 2"`.

### M1 — Group D

#### TASK-013: `scope` — clean assessment scope or redacted review snapshot
**Story:** US-009 AC-1…AC-4 · **Assigned:** js-dev · **Depends on:** TASK-012, TASK-004, TASK-003 · **Complexity:** L

**Objective.** Record files, admitted ranges, skips, and — for review runs — redacted private snapshots with HMACs of the originals.

**Implementation.** `lib/cmd-scope.mjs`: files = tracked files under `scope_paths` (∩ `--include` when given) plus, for `review`, non-ignored untracked files under `scope_paths`; for each: skip rules (binary = NUL in first 8 KiB, `> --max-bytes`, symlink, submodule, unreadable); clean tracked ⇒ `side: head`, `oid = blobOid(head_oid, path)`, `file_hmac = HMAC(bytes at head)`, `lines = normalizeText(bytes).lines.length`; dirty tracked or untracked (review) ⇒ read working bytes → `original_hmac = HMAC(bytes)` → `redactDeep` on the text → write `private/snapshots/<run>/<path>` (`writeAtomic`) → `redacted_sha256`, `side: snapshot`, `oid = redacted_sha256`; `ranges[path] = [[1, lines]]`; for `assessment`, re-check `git status --porcelain` and refuse if dirty.

**Interface Contract.** `scope.json` payload per §4.6; `scope_sha256 = envelope.self_sha256`. Order read → HMAC → redact → persist is a hard requirement (guard G-3).

**Verification.**
- [ ] `cmd-scope.test.mjs: "payload shape and scope_sha256"` (US-009 AC-1); `"assessment on a clean tree has no snapshot and no private/snapshots dir"` (AC-2).
- [ ] `cmd-scope.test.mjs: "dirty review snapshot of a file containing password=1234 ⇒ snapshot bytes redacted, HMAC present, no original bytes anywhere under .agents/security-testing/"` (§12; AC-3) — the test greps every file under `<st>` including `private/`.
- [ ] `cmd-scope.test.mjs: "untracked in-scope file snapshotted the same way"` (AC-4), `"binary/oversize/symlink land in skipped[] with reason"`.

#### TASK-014: `lib/cite.mjs` — side-aware citation resolution, range rule, occurrence
**Story:** US-002 AC-6, US-009 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-013, TASK-003 · **Complexity:** M

**Objective.** One resolver used by `gate`, `packet`, `check`, `verify` and `tm-lint`.

**Implementation.** `resolveSide(ctx, run, scope, {path, side})`: `base|head` ⇒ `git.showBytes(<oid>:<path>)`; `snapshot` ⇒ `private/snapshots/<run>/<path>` (throws `SnapshotMissing`); `resolveWorking(ctx, path)` for drift; `checkRange(scope, citation)`: `1 ≤ start ≤ end`, `end - start + 1 ≤ 40`, primary ⊆ an admitted range of its file else reject `RANGE-NOT-ADMITTED`; typed citations (`source|sink|control`) anywhere in an in-scope file ⇒ `{ok, context: true}`; `occurrenceOf(lines, snippetLines, start)` = 0-based index among all equal-length windows whose normalised lines equal the snippet, ordered by start line; `rangeBytes(buf, start, end)` = raw bytes of those lines (newline-preserving).

**Verification.**
- [ ] `cite.test.mjs: "end-start+1 = 41 rejected"` (v3 §12), `"40 lines inside an admitted range accepted"`, `"primary range outside admitted ranges rejected"`, `"typed citation outside admitted ranges accepted with context:true"` (US-002 AC-6).
- [ ] `cite.test.mjs: "side base resolves via git show <base_oid>:<path> after the file was deleted at head"` (feeds §12 "side: base citation passes integrity"), `"side snapshot resolves the private snapshot"` (US-009 AC-5).
- [ ] `cite.test.mjs: "occurrence recomputed against a caller hint"` (v3 §12).

#### TASK-015: Import store + `ingest` dispatcher
**Story:** US-010 AC-5, US-011 AC-5, US-012 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-012, TASK-004 · **Complexity:** M

**Objective.** One persistence path for every adapter: read → HMAC → redact → `ledger/<run>/imports/<sha256 of redacted bytes>`, plus the per-import derived record.

**Implementation.** `lib/imports.mjs` (`snapshotImport`: `original_hmac = HMAC(buf)`; redacted bytes = `redactString(utf8)` for text kinds, `redactDeep(parsed)` re-canonicalised for JSON kinds; `import_sha256 = sha256(redacted)`; write via `writeAtomic`; returns locator base), `lib/cmd-ingest.mjs` (dispatch by kind to `lib/ingest/<kind>.mjs` exporting `adapt(ctx, run, scope, redactedInput, locatorBase) → {records, unlocated, rejected, mapping_version}`; writes `<run>/ingest/<import_sha256>.json` enveloped, kind `import`); adapters themselves come in TASK-016/017/018 — this task ships `lib/ingest/_shared.mjs` (`hostAllowed(url, list)`, `inScope(scope, path)`, `wrapInert(text)` = provenance banner + nonce-delimited block).

**Interface Contract.** Every derived record has `locator: {import_sha256, original_hmac, index}` and `mapping_version`.

**Verification.**
- [ ] `imports.test.mjs: "same-path audit report replacement ⇒ different import_sha256 when non-redacted content changed, different original_hmac only when redacted-away content changed"` (§12; US-012 AC-5 — uses a stub adapter).
- [ ] `imports.test.mjs: "original bytes never persisted (grep ledger for password=1234)"`, `"record carries the locator triple and redaction_version"` (US-003 AC-2).

#### TASK-030: `register.mjs consume-verdict`
**Story:** US-022 · **Assigned:** js-dev · **Depends on:** TASK-029, TASK-026 · **Complexity:** S

**Objective.** Verdict → register without a typed transition.

**Implementation.** `lib/cmd-register-consume.mjs`: read `verify.json` via `readArtifact`; recompute `evaluate()` and refuse (`5 INCONSISTENT(evaluation)`) if it differs from the stored `evaluation`; locate row by `subject == finding_id` (create via `add` if absent? **no** — exit 2 `NO-ROW`; the lead adds rows); apply `VERIFIED ⇒ fixed` (`ack_refs`, `last_verified_run = run_id`), `REGRESSED ⇒ regressed`, `UNVERIFIED-* ⇒ event verify-observed only`; emit `regression-observed` when `refound_observed && status == fixed`.

**Verification.**
- [ ] `cmd-register-consume.test.mjs: "VERIFIED ⇒ fixed with ack_refs and last_verified_run"`, `"REGRESSED ⇒ regressed + regression-observed event"`, `"UNVERIFIED-* ⇒ event only, status unchanged, regression-observed still recorded when refound_observed"` (US-022 AC-1…AC-3), `"tampered evaluation refused exit 5"`.

### M1 — Group E

#### TASK-016: `ingest sarif` + `sarif-mapping.v1.json`
**Story:** US-010 AC-1…AC-4, AC-6 · **Assigned:** js-dev · **Depends on:** TASK-015, TASK-013 · **Complexity:** M

**Implementation.** `references/sarif-mapping.v1.json` (v3 §6.6 allowlists, tool confidences `semgrep 6, gitleaks 7, trivy 7, osv-scanner 8, codeql 7, unknown 3`, `level_priority {error: p1, warning: p2, note: p3}`, tag→class table); `lib/ingest/sarif.mjs` implementing the §6.7 matrix row by row: URI canonicalisation (`file:` scheme or relative; reject absolute, `..`, symlink escapes, `%2e`), `inScope` ⇒ located candidate else `unlocated(out-of-scope)`; `endLine` default; snippet from the recorded side via `cite.resolveSide` when absent; level fallback chain; `ruleIndex`/`ruleId` disagreement ⇒ rejected; unknown tool ⇒ tags-only class, confidence 3, `recorded: unknown-tool`; malformed region ⇒ rejected with reason; data-flow classes flagged `requires_typed_citations: true`; `message.text`/`snippet.text` stored only as `inert: wrapInert(redacted)`. Fixtures: one SARIF per matrix row under `scripts/fixtures/sarif/`.

**Verification.**
- [ ] `ingest-sarif.test.mjs: "message.text path-like instruction never selects a path"` (US-010 AC-1); one test per §6.7 row (AC-2, nine tests); `"rejection reasons counted"` (AC-3 — counts in the import record; display asserted in TASK-023); `"SARIF unlocated candidates never reach gate"` (v3 §12; asserted here at record level and again in TASK-019); `"import record names mapping version v1"` (AC-6).

#### TASK-017: `ingest ticket | pr | doc | tracker-readback`
**Story:** US-011 · **Assigned:** js-dev · **Depends on:** TASK-015 · **Complexity:** M

**Implementation.** `lib/ingest/{ticket,pr,doc,tracker-readback}.mjs` per §6.6 trusted/inert columns; host rule against `engagement.targets.tracker`; `pr.changed_files ∩ scope`; `doc` path must be in scope; `tracker-readback` takes `--sent <ticket.json produced by publish>` and trusts only the keys the mutation set, reporting `MISMATCH(<field>)` in the record when read-back differs from sent. Fixtures under `scripts/fixtures/tracker/`.

**Verification.**
- [ ] `ingest-tracker.test.mjs:` `"ticket with disallowed host rejected; allowed host trusts id/url/labels/state only"`, `"pr changed_files intersected with scope; title/body inert"`, `"doc outside scope rejected"`, `"tracker-readback trusts only mutated fields and flags mismatch"` (US-011 AC-1…AC-4); `"every adapter persists via the import store"` (AC-5).

#### TASK-018: `ingest case | audit | qa-run | ta-report`
**Story:** US-012 AC-1…AC-4 · **Assigned:** js-dev · **Depends on:** TASK-015 · **Complexity:** L

**Implementation.** `lib/ingest/{case,audit,qa-run,ta-report}.mjs`: `case` parses manual-qa TC frontmatter (read `bundles/manual-qa/knowledge/test-case-format.md` for the exact keys) trusting ids and `requirements`; `audit` parses the qa-auditor Markdown + its JSON block (see `bundles/manual-qa/agents/qa-auditor/AGENT.md` for the block shape), URL host ∈ `targets.browser`; `qa-run` parses `reports/RUN-YYYY-MM-DD-NNN.md` per `bundles/manual-qa/knowledge/test-run-report-format.md` — frontmatter `run_id, suite, environment, date` + `## Results` table columns `ID | Title | Size | Status | Steps | Wall Clock`, status ∈ `PASS|FAIL|BLOCKED` only, screenshots by path; `ta-report` parses `.agents/automation/<slug>/report.json` (see `bundles/test-automation` for the shape) trusting unit outcomes, `coverage`, exclusions, `findings[]`, `recovery_basis`, test paths; `delivered` without a gate receipt ⇒ `delivered-unwitnessed`. Fixtures: `scripts/fixtures/qa/RUN-2026-09-15-001.md` **verbatim** in the manual-qa format, one TC, one audit report, one TA report.

**Verification.**
- [ ] `ingest-qa.test.mjs: "manual-qa run report in its real Markdown format through ingest qa-run"` (§12; US-012 AC-3), `"case trusts ids and requirements; steps inert"` (AC-1), `"audit URL outside targets.browser untrusted"` (AC-2), `"ta-report per-unit fields; delivered without gate receipt ⇒ delivered-unwitnessed"` (AC-4, US-037 AC-3).

#### TASK-020: `coverage`
**Story:** US-014 · **Assigned:** js-dev · **Depends on:** TASK-013 · **Complexity:** M

**Implementation.** `lib/cmd-coverage.mjs`: envelope the examined declaration as `examined.json`; interval arithmetic per file: split scope ranges by declared examined ranges and scanner rows; every scope range must be covered by exactly one accounting entry — overlapping declarations ⇒ `4 OVERLAP(path:a-b)`, uncovered ⇒ entry `unexamined` (a gap in **declarations** is allowed and reported as `unexamined`; a gap in the **accounting** is a bug ⇒ `4 GAP`); empty scope ⇒ `INDETERMINATE` printed, `coverage.json` written with `accounting: []`, `indeterminate: true`.

**Verification.**
- [ ] `cmd-coverage.test.mjs: "payload shape"` (US-014 AC-1), `"every scoped range appears in exactly one entry; overlap fails naming the range"` (AC-2), `"empty scope ⇒ INDETERMINATE"` (AC-3), `"deterministic"` (AC-4).

### M1 — Group F

#### TASK-019: `gate` — ids and citation states by content sensitivity
**Story:** US-013, US-010 AC-4 · **Assigned:** js-dev · **Depends on:** TASK-014, TASK-016, TASK-009 · **Complexity:** L

**Implementation.** `lib/cmd-gate.mjs` + pure core `lib/gate-core.mjs` (`gate({scope, claims, resolveSide, key, rules}) → {claimed, gateResult, rejects, unlocated, citationRecords[]}`): merge candidates from `ingest/*.json` (located records) and `--claims` files (validated as `ClaimSet` — a claim carrying `id` or `state` ⇒ rejected reason `agent-wrote-id`); `checkRange`; resolve bytes at side; `normalizeText` of source range vs claimed snippet (in memory, unredacted); `occurrenceOf` ignoring hint; sensitivity = `redact.matches(rawRangeBytes)`; plain: `id = sha256(path\0class\0normalised\0occurrence)`, store `snippet`; sensitive (any class): `id = HMAC(path\0class\0redacted normalised\0occurrence)`, store `snippet_redacted` (or `context_redacted` for `secret`), `sensitive: true`, write `private/citations/<run>/<id>.json` `{claimed_hmac, source_hmac, match, side, oid, redaction_version}` **before** the claimed text is dropped; state `CITATION_VERIFIED|CITATION_FAILED`; data-flow class without typed citations stays accepted but flagged `requires_typed_citations` (REVIEW packet will demand them); write `findings.claimed.json`, `gate-result.json`, `rejects.json` (aggregated by reason), `unlocated.json`. `gate-core` must be callable by `build-report`/`check` with the same result (byte-identical).

**Verification.**
- [ ] `gate.test.mjs: "non-secret finding citing password=1234 ⇒ keyed id, no plain hash anywhere in publishable artifacts"` (§12; US-013 AC-2 — test computes the plain sha256 and greps every non-`private/` file).
- [ ] `gate.test.mjs: "plain identity when no rule matches"` (AC-1), `"private citation record written before discard; claimed text absent from every file"` (AC-3), `"secret class uses context_redacted"` (AC-4), `"states and occurrence recomputed ignoring the hint; gate-result payload shape"` (AC-5), `"deterministic re-run byte-identical"` (AC-6), `"SARIF unlocated candidates never reach gate"` (AC-4 of US-010), `"claim carrying id/state rejected"`.

### M1 — Group G

#### TASK-021: `packet`
**Story:** US-015 AC-1 · **Assigned:** js-dev · **Depends on:** TASK-019 · **Complexity:** S

**Implementation.** `lib/cmd-packet.mjs`: subjects resolved to findings (from `gate-result.accepted` + `findings.claimed.json`), mitigations (M2, `threat-model.json`) or cases (M3); `files[]` = per cited file `{path, side, oid, ranges (primary + typed), range_hmac = HMAC(concat of rangeBytes for each range)}`; `policy_sha256 = sha256(canonical(references/packet-policy.v1.json))` (policy = `{version, max_range: 40, sides, typed_citation_rule, redaction_version}`); path `packets/<packet_sha256>.json`.

**Verification.**
- [ ] `cmd-packet.test.mjs: "payload shape; range_hmac over raw bytes at the recorded side"` (US-015 AC-1), `"same subjects twice ⇒ same packet_sha256"`, `"unknown subject ⇒ exit 2"`.

#### TASK-022: `receipt validate | apply` + `lib/states.mjs`
**Story:** US-015 AC-2…AC-7 · **Assigned:** js-dev · **Depends on:** TASK-021 · **Complexity:** L

**Implementation.** `lib/cmd-receipt.mjs`: `validate` — schema, forbidden keys (named in the error), packet exists under the run, `packet_sha256` equals its `self_sha256`, every `packet.files[].oid` equals the blob oid at the run's `head_oid` (or `base_oid` for `side: base`, `redacted_sha256` for snapshot), `subject_id ∈ packet.subject_ids`; on success envelope + write `receipts/<sha>.json`; `apply` — `states.applyReceipts` (pure) implementing the §6.4 table: `CITATION_FAILED` ⇒ unchanged, receipt `not-applied`; conflicting assertions per `(type, subject, run)` ⇒ `*_INDETERMINATE` (acks exempt); `REVIEW_REFUTED` sticky except a new `review` receipt in a **different** run; mitigation receipts ⇒ `MITIGATION_*`.

**Interface Contract.** `applyReceipts(gateResult, receipts, packets) → {states, mitigation_states, not_applied, conflicts}`; same function used by `build-report`, `check`, `verify all`, `tm-lint`.

**Verification.**
- [ ] `cmd-receipt.test.mjs: "closed enums per type; other values rejected; packet binding and oid check"` (US-015 AC-2), `"receipt carrying state/verdict/id/gate stamp rejected naming the key"` (AC-7).
- [ ] `states.test.mjs: "CITATION_VERIFIED + review confirmed/refuted/indeterminate ⇒ REVIEW_*"` (AC-3), `"CITATION_FAILED stays; receipt not-applied"` (AC-4), `"REVIEW_REFUTED sticky"` (AC-5), `"two receipts same subject same run different assertions ⇒ INDETERMINATE; multiple acks exempt"` (AC-6).

### M1 — Group H

#### TASK-023: `build-report` core + `review` template + renderer
**Story:** US-016 AC-1…AC-4, AC-6, AC-7 (review), US-010 AC-3 · **Assigned:** js-dev · **Depends on:** TASK-019, TASK-020, TASK-022 · **Complexity:** L

**Implementation.** `templates/README.md`, `templates/review.md` (with its required-inputs list in a fenced `required-inputs` block the script parses — the list in the template file **is** the closed list); `lib/inputs.mjs` (`REQUIRED = {review: [...], assessment: [...], verify: [...], threat-model: [...]}` and `closeOver(runDir)` — follow every hash reference: receipts→packets, gate-result→scope+claimed, coverage→scope+examined, observations→imports, verify runs→their packets/receipts; missing ⇒ `CliError(3, "INCOMPLETE(<name>)")`); `lib/render.mjs` (`buildView` from inputs using `gate-core` re-run (refuse `5 INCONSISTENT(gate-result)` on mismatch), `applyReceipts`, coverage recompute; `renderMarkdown(view, template)` with TL-7 markers; sections per v3 §11 with `unknown / not assessed` for every absent field); `lib/cmd-build-report.mjs` (fs access confined to `runs/<id>` + `ledger/<id>` via a path guard that throws on anything else; writes `report.md`, `manifest.json`, then `COMMITTED` containing `manifest.self_sha256`).

**Interface Contract.** `manifest.json` payload `{inputs: {kind: sha256}, report_sha256, template, template_version, tool_version}`; `tool_version` = `security-evidence` SKILL.md `metadata.version`; `COMMITTED` file content = manifest hash + `\n`.

**Verification.**
- [ ] `cmd-build-report.test.mjs: "reads only the run directory (planted newer artifact elsewhere unused; path guard throws)"` (US-016 AC-1, TL-3), `"review: each required input deleted ⇒ exit 3 INCOMPLETE(<input>), no report"` (AC-2, table-driven over the review list), `"transitive closure: receipt with missing packet ⇒ INCOMPLETE(packet:<sha>)"` (AC-3), `"COMMITTED last, contains manifest hash; manifest payload shape"` (AC-4), `"deterministic render byte-identical"` (AC-6), `"template required-inputs lists match inputs.mjs"` (AC-7), `"section 3 shows rejected counts by reason totalling three"` (US-010 AC-3).

#### TASK-027: `verify.mjs all` — steps 1–6, `verify.json`, verdict line
**Story:** US-018 · **Assigned:** js-dev · **Depends on:** TASK-026, TASK-022, TASK-012, TASK-023 · **Complexity:** L

**Implementation.** `lib/cmd-verify-all.mjs` + `lib/verify-steps.mjs` (`branch`, `worktree` (OS tmpdir, `git worktree add --detach`, always `worktree remove --force` in `finally`), `install` (argv from engagement only; per-tracked-file HMAC vs head via `git ls-files -s` + `git hash-object`? **no** — HMAC over working bytes vs HMAC over `showBytes(head, path)`; `tested_tree = HMAC(sorted "path\0hmac\n")`; untracked count/bytes), `suppression` (unified diff parse over `base..head`; indicator kinds §4.2; `deletion_only` per TL-12), `tests` (allowlist/deny, resolved executable via own PATH search, sha256 of it, `spawn` with `detached: true` for group kill, minimal env, timeout, 64 KiB bounded redacted output), `fixReviewPacket` (packet over the worktree files of the finding, `side: head`, `oid` from head), receipts admission from `--receipts` (reusing `cmd-receipt` validate), `evaluate`, write `verify.json`, in-process `build-report --template verify`, then `consume-verdict` when `--receipts` was given (row must exist; otherwise print `REGISTER: no row for finding` and continue). Refuse `REVIEW_REFUTED` findings before allocating (`4 UNVERIFIED-REFUTED-FINDING`). Fixture repo builder `scripts/fixtures/repo/build.mjs` (creates a temp git repo with a `package.json` whose `test` script is `node test-runner.mjs`, a tracked `test-helper.mjs`, a finding at a known path, base and head commits, an install script that edits the helper).

**Verification.**
- [ ] `cmd-verify-all.test.mjs: "branch COMMITTED | NOT-COMMITTED | PATH-UNTOUCHED"` (US-018 AC-1), `"wrong-head worktree: dirty test helper in the main tree has no effect; tests fail in the clean worktree"` (v3 §12; AC-2), `"install modifying a tracked helper ⇒ install-modified-tree"` (§12; AC-3) and `"allow_tracked_changes:true ⇒ tested_tree recorded and named in VERDICT"`, `"ignore file edited outside the finding path ⇒ INDICATOR; deletion-only diff ⇒ deletion_only:true"` (AC-4), `"argv from ticket/SARIF never executed; deny rules; shell:false; executable path + sha256 recorded; output bounded and redacted"` (AC-5), `"fix-review packet built from the worktree; pass 1 prints PACKET and NEXT"` (AC-6, TL-6), `"verify.json payload complete; last stdout line matches the VERDICT grammar"` (AC-7), `"REVIEW_REFUTED finding ⇒ exit 4 UNVERIFIED-REFUTED-FINDING, no run allocated"` (US-015 AC-5).

#### TASK-034: `secure-code-review` skill — prose, fixtures, frozen harness
**Story:** US-026 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-019, TASK-022 · **Complexity:** M

**Implementation.** `bundles/security-testing/skills/secure-code-review/SKILL.md` (frontmatter `name, description, license, metadata.authors/version`; body: investigate-then-refute loop, taxonomy = the `finding.schema.json` class enum with CWE anchors, refutation criteria, do-not-flag list, typed citations `source|sink|control` for data-flow classes, the closed assertion vocabulary of §6.4, "read only what the packet lists", "write a claims file / a receipt payload; never an id, state or verdict"), `references/taxonomy.md`, `references/refutation.md`, `references/do-not-flag.md`, `fixtures/` (claims files that pass `gate`: non-secret `password=1234` citation, data-flow finding with typed citations, deleted-code finding `side: base`; each with the tiny source repo snapshot they cite under `fixtures/repo/`), `evals/harness.json` (`prompt_sha256, model_id, sampling: {temperature: 0, top_p: 1, max_tokens}, fixture_revision, output_selection: first, matching: {assertion_exact: true}`), `evals/runs/.gitkeep` + README.

**Verification.**
- [ ] `skills-ref` validation (CI) passes; `npm run validate:factories` (once TASK-037 lands) passes.
- [ ] `secure-code-review.fixtures.test.mjs` (under `skills/security-evidence/scripts/` so `node --test` finds it): `"every fixture claim passes gate on its fixture repo; password=1234 fixture yields a keyed id"` (US-026 AC-3), `"harness.json pins the six fields"` (AC-4).

### M1 — Group I

#### TASK-024: `assessment`, `verify`, `threat-model` templates + full §11 sections
**Story:** US-016 AC-2 (three templates), AC-5 · **Assigned:** js-dev · **Depends on:** TASK-023, TASK-027, TASK-028 · **Complexity:** L

**Implementation.** `templates/{assessment,verify,threat-model}.md` with their required-inputs blocks (§6.3 table; `threat-model` inputs stubbed at M1 with an empty `threat-model.json` fixture allowed — the M1 assessment E2E supplies an empty model `{elements: [], threats: []}` written by the test, since the threat-modeler lands in M2); `render.mjs` sections 1–12 in v3 §11 order; section 3 counts by priority × state, unresolved by priority, rejected by reason, unlocated count, unauthenticated approvals (from `register status --json` snapshot artifact `<run>/register-snapshot.json`, written by `evidence.mjs run snapshot-register --run <id>` — add this sub-subcommand here), incomplete runs (from ledger); section 6 Limitations lists `KEY: unavailable` artifacts, outside-policy artifacts, "local ≠ confidential"; section 12 chain of custody with manifest hashes, `ORIGIN` line, versions; verify template renders the `VERDICT` line and history.

**Verification.**
- [ ] `render.test.mjs: "assessment sections in v3 §11 order; every finding field filled or 'unknown / not assessed'; no blank cell"` (US-016 AC-5), `"section 3 counts derive from view; markers present on every derived line"` (TL-7).
- [ ] `cmd-build-report.test.mjs: "assessment/verify/threat-model: each required input deleted ⇒ INCOMPLETE(<input>)"` (AC-2 for the three templates), `"Limitations lists artifacts whose key_id file is missing"` (US-005 AC-4 half).

#### TASK-031: `publish --profile` (report + tracker profiles) and `check-export`
**Story:** US-023 · **Assigned:** js-dev · **Depends on:** TASK-023, TASK-029 · **Complexity:** M

**Implementation.** `lib/profiles/{redacted-report,full-report,tracker}.mjs` each `apply(runDir, register, opts) → [{relpath, bytes}]` (pure over inputs; `profile_version`); `redacted-report` = report minus snippets, reproduction and infra paths; `full-report` = report + findings JSON (explicit only); `tracker` = per finding `<id>.ticket.json` `{title, class, priority, path, lines, context_redacted, fix_prompt, finding_id}` — never `snippet` for `sensitive: true`; dedupe by register `ticket_url` and by ingested ticket records (redacted body contains the id, state open) ⇒ `DEDUPE` line + `ticket_url` recorded on the row via `register` event `ticketed`; `export-manifest.json` per output set; `check-export` re-applies with `--source`, byte-compares ⇒ `VERIFIED-DERIVATIVE`, else `LINKED-ONLY`; `handoff` and `case` profiles are M3 (TASK-043) — registered names that return `2 NOT-IMPLEMENTED(M3)` at M1.

**Verification.**
- [ ] `cmd-publish.test.mjs: "each profile emits only its allowed fields; full-report needs the explicit flag"` (US-023 AC-1), `"export-manifest payload"` (AC-2), `"tracker never shows snippet for sensitive finding; dedupe on existing ticket_url"` (US-039 AC-1, AC-3).
- [ ] `cmd-check-export.test.mjs: "check-export VERIFIED-DERIVATIVE and LINKED-ONLY"` (§12; AC-3, AC-4), `"tampered output ⇒ MISMATCH exit 5"`.
- [ ] `writes-outside-st.test.mjs: "only publish --to writes outside the §4 writable paths"` (AC-5 — static grep of `scripts/**` for `writeFileSync|writeAtomic` call sites plus a runtime fs spy during a full pipeline run).

### M1 — Group J

#### TASK-025: `check` — recompute, integrity, drift, origin, key
**Story:** US-017, US-005 AC-4, US-009 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-024, TASK-026, TASK-028, TASK-014 · **Complexity:** L

**Implementation.** `lib/cmd-check.mjs`: accept run dir or manifest path; require `COMMITTED` and that its content equals the recomputed manifest hash; recompute every manifest input hash (`INCONSISTENT(input:<kind>)`); re-run `gate-core`, coverage, `applyReceipts`, `evaluate` per verify run, `register-core.replay` over the snapshot; re-render and byte-compare with TL-7 naming; `--integrity`: for every citation, HMAC of `resolveSide` bytes vs recorded `range_hmac` / private citation record (`side: base` via `git show`; `snapshot` ⇒ redacted snapshot vs `redacted_sha256` **and** working file vs `original_hmac` ⇒ `CONSISTENT` / `CONSISTENT-REDACTED-ONLY(n citations)` / `INCONSISTENT(snapshot:<path>)`); `--drift`: `head`/`snapshot` citations vs working tree (`CITATION-DRIFTED(n)`), per-file HMAC of every in-scope file vs `scope.json` (`SCOPE-DRIFTED(n files)`), `base` skipped; key: envelope `key_id` file missing ⇒ `KEY: unavailable`, skip content re-validation, print `STRUCTURE-ONLY` in place of `CONSISTENT`; `--trusted-digest` compared to the **recomputed** manifest hash; `CONSISTENT-REDACTED-ONLY` impossible for `assessment` runs (assert: scope has no snapshot).

**Verification.**
- [ ] `cmd-check.test.mjs: "untouched COMMITTED run ⇒ CONSISTENT, CURRENT, ORIGIN: unauthenticated, KEY: available, exit 0"` (US-017 AC-1).
- [ ] `cmd-check.test.mjs: "every derivation-table row: tampering finding ids / CITATION states / coverage counts / REVIEW states / verify verdicts / register status-delta-bucket / rejected-unlocated totals / executive counts ⇒ INCONSISTENT(<field>)"` (AC-2, one sub-test per row).
- [ ] `cmd-check.test.mjs: "consistent full-set forgery ⇒ CONSISTENT and ORIGIN: unauthenticated"` (v3 §12; AC-3), `"--trusted-digest matches only the recomputed hash, never the sidecar"` (AC-4), `"edited cited head line ⇒ CITATION-DRIFTED(1); edited uncited in-scope file ⇒ SCOPE-DRIFTED(1 files); base citations skipped"` (AC-5), `"historical report after a fix ⇒ CONSISTENT + drifted"` (v3 §12), `"side: base citation passes integrity"` (§12), `"review run with snapshot citation of password=1234: CONSISTENT before working-file change, CONSISTENT-REDACTED-ONLY(1 citations) after, INCONSISTENT when the redacted snapshot is altered"` (§12 four-step, first three steps; AC-6), `"key file absent ⇒ KEY: unavailable and STRUCTURE-ONLY, never CONSISTENT"` (AC-7; US-005 AC-4), `"assessment run can never print CONSISTENT-REDACTED-ONLY"` (AC-8).

### M1 — Group K

#### TASK-033: `sign-off --engagement`
**Story:** US-025 (M1 scope; AC-6 lands in TASK-043; disposition policy in TASK-041), US-006 AC-2…AC-4 · **Assigned:** js-dev · **Depends on:** TASK-025, TASK-010, TASK-028, TASK-023 · **Complexity:** L

**Implementation.** `lib/cmd-sign-off.mjs`: inventory = `ledger/index.json` only; runs without `COMMITTED` ⇒ `INCOMPLETE:` list; no COMMITTED assessment ⇒ `4 NO-ASSESSMENT` (the string `UNGATED` must not exist anywhere in `scripts/**`); latest assessment by `seq`; in-process `check` on every COMMITTED run: `INCONSISTENT`/`STRUCTURE-ONLY` ⇒ fail naming run; `CONSISTENT-REDACTED-ONLY` accepted for `review` kind and listed; latest assessment `--drift` scope-level must be `CURRENT`; register open ⇒ `CORRUPT` fails; `--expect` ⇒ `anchor verify` must be `MATCH`; tracked files under managed paths (reuse TASK-008 check) ⇒ fail; `require_dispositions` read from engagement — at M1 only `none` and absent are evaluated as "not evaluated" (TASK-041 adds the rest); informational: incomplete runs, `diffBaseline` per path, `EXCLUDED-COVERAGE:` ignored counts, unauthenticated approvals from `register status`.

**Verification.**
- [ ] `cmd-sign-off.test.mjs: "only ledger-listed runs considered; uncommitted listed as incomplete"` (US-025 AC-1), `"only review runs ⇒ exit 4 NO-ASSESSMENT and no UNGATED banner"` (AC-2), `"each failing condition ⇒ exit 4 naming the cause"` (AC-3, table-driven: INCONSISTENT run, STRUCTURE-ONLY run, latest assessment not CURRENT, CORRUPT register, anchor mismatch, tracked file under managed path), `"redacted-only review run + current clean COMMITTED assessment ⇒ exit 0 and lists it"` (§12 four-step step 4; AC-4), `"informational listings do not affect exit"` (AC-5), `"tracked change / untracked change listed per path; ignored change reported as excluded coverage"` (US-006 AC-2…AC-4).

#### TASK-035: `security-engagement` skill (prose)
**Story:** US-027 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-033 · **Complexity:** S

**Implementation.** `skills/security-engagement/SKILL.md` + `references/{workflow,sign-off-checklist,tracker-rules,disclosure-profiles}.md`; no `scripts/`; every command named is `evidence.mjs …`, `verify.mjs …`, `register.mjs …`; the checklist enumerates every TASK-033 failing condition and informational list.

**Verification.**
- [ ] `security-engagement.test.mjs` (under `security-evidence/scripts/`): `"skill dir has no scripts/; every backticked command starts with evidence.mjs|verify.mjs|register.mjs"` (US-027 AC-1), `"sign-off checklist names every FAIL cause token and every listing header of cmd-sign-off.mjs"` (AC-2 — reads the token list exported by `cmd-sign-off.mjs`).
- [ ] `skills-ref` passes (CI).

#### TASK-036: `security-reviewer` agent + SOUL + briefing
**Story:** US-028 AC-1…AC-3 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-034, TASK-022, TASK-021 · **Complexity:** M

**Implementation.** `agents/security-reviewer/AGENT.md` (frontmatter §4.7 exactly; body: tool-call economy block, the four rules, three contracts — `review`: input packet path → read only listed files at listed sides via `git show`/snapshot path → write claims payload to `<st>/receipts/<run>/claims-<n>.json` **and** per subject a receipt payload `{type: review, subject_id, packet_sha256, assertion, reviewer_run_id}` → return line `RECEIPT <path> assertion=<a>`; `mitigation-review` and `fix-review` analogous; writable-paths self-check text; "never merge, close, rotate, fix"), `agents/security-reviewer/SOUL.md`, `briefings/security-reviewer.md` (project briefing: where packets arrive, how to run `evidence.mjs receipt validate` is the lead's job, not yours).

**Verification.**
- [ ] `bin/no-tools-frontmatter.test.mjs`, `bin/frontmatter-strict.test.mjs`, `bin/agent-skill-deps.test.mjs`, `bin/skills-on-demand.test.mjs` pass (existing repo tests).
- [ ] `agents.test.mjs` (under `security-evidence/scripts/`): `"security-reviewer frontmatter equals the §4.7 contract (model, group, skills, skills-on-demand, context-docs, no tools, no context-memory, authors)"` (US-028 AC-1), `"body contains the four rules and the three return-line grammars"` (AC-2, AC-3).

### M1 — Group L

#### TASK-037: M1 manifest, `FACTORY.md`, README guarantees, `instructions.md`, knowledge seed
**Story:** US-029, US-003 AC-3 · **Assigned:** js-dev · **Depends on:** TASK-036, TASK-035, TASK-034, TASK-011 · **Complexity:** M

**Implementation.** `bundles/security-testing/factory.json` (§4.8 M1), `FACTORY.md` (§4.8), `README.md` (install; Guarantees table: one row per §2 left-column promise, columns `Guarantee | enforced by: script | prose | qualification` with "for runs carrying a `COMMITTED` marker produced by the canonical pipeline" on every script row; Not guaranteed section = every §8 item; "Active testing is out of scope in v1"; redaction row states the bound to the rule list), `instructions.md` (opens with the role-scoped sentence; four rules; artifact map §3.2; token table), `knowledge/` (from TASK-007), `skills/security-evidence/SKILL.md` (`metadata.version: "1.0.0"`, command index, schema index, "every string is redacted"), `briefings/security-reviewer.md` (TASK-036).

**Verification.**
- [ ] `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` exit 0 (US-029 AC-3) — marketplaces regenerated with `npm run gen:marketplaces` in the same PR.
- [ ] `manifest.test.mjs` (under `security-evidence/scripts/`): `"factory.json equals the M1 contract"` (AC-1), `"FACTORY.md fields and exactly five use_cases; no project_deployments"` (AC-2), `"README Guarantees table has a row per §2 promise and the Not-guaranteed list has all twelve §8 items"` (AC-4, US-003 AC-3), `"no file under bundles/security-testing or generated marketplaces contains 'exact checkout'"` (AC-5), `"instructions.md opens with the role-scoped sentence"` (AC-6), `"seed installs knowledge/ with engagement.md.template and finding-schema.md"` (AC-7 — runs `bin/init.mjs init --factory security-testing --target claude --yes` into a temp dir).

### M1 — Group M

#### TASK-038: Installed end-to-end tests, offline, both shapes + remaining §12 fixtures
**Story:** US-030, US-028 AC-4, US-007 AC-3 · **Assigned:** qa-engineer · **Depends on:** every M1 task · **Complexity:** L

**Implementation.** `scripts/e2e.test.mjs` (`node --test` discovers it; skip with `SDLC_E2E=0`): helper builds (1) a temp `SDLC_SKILLS_CACHE_DIR` where `sdlc-skills/registry/obra__superpowers` is a clone whose `origin` is a temp **bare** repo containing `skills/systematic-debugging/SKILL.md` (and `skills/dispatching-parallel-agents/` for M3), (2) a `GIT_CONFIG_GLOBAL` file with `[url "/nonexistent/"] insteadOf = https://github.com/` (verified in SPIKE-001), (3) a consumer repo from `fixtures/repo/build.mjs`; path (a): `node bin/init.mjs init --factory security-testing --target claude --yes` → assert `memory`, `knowledge-curation`, `verifying-outcomes` came from the monorepo and `systematic-debugging` from the cache → `engagement init → run init --kind assessment → scope → ingest sarif → gate → coverage → packet/receipt (test authors the receipt payload) → run snapshot-register → build-report --template assessment (empty threat-model fixture, TASK-024) → check → verify all (pass 1 + pass 2 with an authored fix-review receipt) → register add/consume → sign-off` with `require_dispositions: none` ⇒ every exit 0; path (b): `--skills security-testing/secure-code-review,security-testing/security-evidence` → `engagement init → run init --kind review → … → build-report --template review → check → verify all → sign-off` ⇒ `4 NO-ASSESSMENT`, no `UNGATED`, no step exits 2 for a missing template; plus the remaining §12 fixtures not covered by unit tasks: manual-qa run report through `ingest qa-run` inside the installed pipeline; positive tests + `indeterminate` fix-review; changed ignored product file at sign-off; the full four-step dirty-snapshot sequence end to end; assert `.gitignore` hash unchanged by everything but `engagement init` (US-004 AC-5); assert `git status --porcelain` shows nothing under managed paths; four-target install shape for the reviewer agent (`claude|cursor|codex|copilot`).

**Verification.**
- [ ] `e2e.test.mjs: "offline external provisioning — no https fetch"` (US-030 AC-1), `"full-bundle path (a) exits 0 through sign-off"` (AC-2), `"two-skill path (b): sign-off exits 4 NO-ASSESSMENT, no UNGATED"` (AC-3, US-007 AC-3), `"additional §12 fixtures"` (AC-4), `"every script has a sibling *.test.mjs"` (AC-5 — directory listing assertion), `"security-reviewer appears in every host's native shape"` (US-028 AC-4), `".gitignore untouched by the pipeline after init"` (US-004 AC-5).
- [ ] `npm test` green in CI with no network (the workflow already lacks network for these tests; confirm with the guard).

### M2

#### TASK-039: `threat-modeling` skill + `tm-lint.mjs check|render`
**Story:** US-031 · **Assigned:** js-dev · **Depends on:** TASK-038 (M1 done), TASK-022, TASK-029 · **Complexity:** L

**Implementation.** `skills/threat-modeling/SKILL.md` + `references/{dfd-elements,stride,mitigations-as-claims,dispositions}.md`; `lib/cmd-tm-lint.mjs` per §4.4 — relationship validation: `planned` ⇒ proposal file exists or `admissions/<case_sha256>.json` exists; `executed` ⇒ `observations/<id>.json` exists; `ticketed` ⇒ an `ingest tracker-readback` record whose redacted body contains the threat id; `accepted` ⇒ register row `subject == threat id && status == accepted`; `mitigated` ⇒ `applyReceipts` yields `MITIGATION_CONFIRMED` for that mitigation id; `render` writes Markdown from JSON; `build-report --template threat-model` required inputs wired (TASK-024 stub replaced).

**Verification.**
- [ ] `cmd-tm-lint.test.mjs: "element without citation fails naming it"` (US-031 AC-2), `"one threat per disposition value validates; dangling reference fails with threat id and relationship"` (AC-3), `"render produces Markdown from JSON; threat-model template inputs"` (AC-4); `skills-ref` passes (AC-1).

#### TASK-040: `threat-modeler` agent
**Story:** US-032 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-039 · **Complexity:** M

**Implementation.** `agents/threat-modeler/{AGENT.md,SOUL.md}`, `briefings/threat-modeler.md`; return line `MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>` only after `tm-lint check` exit 0, else the lint error verbatim. Not yet in `factory.json` (TASK-048).

**Verification.**
- [ ] `agents.test.mjs: "threat-modeler frontmatter equals §4.7; body has the four rules and the return-line rule"` (US-032 AC-1…AC-3); repo frontmatter tests pass.

#### TASK-041: `sign-off` disposition policy
**Story:** US-033 · **Assigned:** js-dev · **Depends on:** TASK-039, TASK-033 · **Complexity:** S

**Implementation.** `cmd-sign-off.mjs`: read latest assessment's `dispositions.json`; policy `all` ⇒ any `undisposed|planned` ⇒ `4 DISPOSITIONS(<ids>)`; default `executed-or-ticketed` ⇒ list only; `none` ⇒ not evaluated.

**Verification.**
- [ ] `cmd-sign-off.test.mjs: "default policy lists undisposed/planned and exits 0"`, `"all ⇒ exit 4 naming threat ids"`, `"none ⇒ not evaluated"` (US-033 AC-1…AC-3).

### M3

#### TASK-042: `security-test-planning` skill + `plan.mjs admit|propose`
**Story:** US-034, US-038 · **Assigned:** js-dev · **Depends on:** TASK-041 · **Complexity:** M

**Implementation.** `skills/security-test-planning/SKILL.md` + `references/passive-admission.md` (allowed-operation grammar + forbidden-pattern list from v3 §9.1; wording "admitted by lint or by review", never "safe"); `lib/cmd-plan-admit.mjs` (lint over step text; unknown operation ⇒ `proposal`; forbidden hit ⇒ `proposal` with `lint_hits`; `--receipt` of type `review` on the case packet (`packet --type case`) ⇒ `admitted-reviewed`); `lib/cmd-plan-propose.mjs` (proposal frontmatter validation; refuses `tasks/`).

**Verification.**
- [ ] `cmd-plan.test.mjs: "admission payload shape"` (US-034 AC-1), `"unknown effect ⇒ proposal"` (AC-2), `"step with an injection payload ⇒ proposal with lint hit"` (v3 §12; AC-3), `"admitted-reviewed only with a receipt on the case packet"` (AC-4), `"proposal under tasks/ ⇒ planner refuses"` (v3 §12; US-038 AC-2), `"proposal frontmatter validated; authorization stub authenticated:false"` (US-038 AC-1); `skills-ref` passes (AC-5).

#### TASK-043: Admitted hand-off suite — `publish --profile case|handoff`, sign-off unadmitted listing
**Story:** US-035, US-025 AC-6, US-038 AC-3 · **Assigned:** js-dev · **Depends on:** TASK-042, TASK-031 · **Complexity:** M

**Implementation.** `lib/profiles/case.mjs` (only `admitted-*` cases from `<run>/admissions/`, manual-qa TC format verbatim, priority map, `tags: [security]`, written to `tasks/security-<slug>-admitted/` and nothing else there), `lib/profiles/handoff.mjs` (exact two-line prompt of §9.2 to `<st>/handoffs/<slug>.md` and stdout), `cmd-sign-off.mjs` `UNADMITTED:` list = files in the suite whose sha256 has no admission record.

**Verification.**
- [ ] `cmd-publish.test.mjs: "three admitted + one proposal ⇒ exactly three TC files and nothing else"` (US-035 AC-1), `"case parses as a manual-qa TC; priority map"` (AC-2), `"handoff prompt text exact"` (AC-3), `"no proposal path or text in handoff/case output"` (US-038 AC-3).
- [ ] `cmd-sign-off.test.mjs: "extra TC placed in the admitted suite by hand ⇒ listed as unadmitted"` (§12; US-025 AC-6, US-035 AC-4).

#### TASK-044: Observations from `qa-run`, TA hand-off prompt, `ta-report` per-unit records
**Story:** US-036, US-037 · **Assigned:** js-dev · **Depends on:** TASK-043, TASK-018 · **Complexity:** M

**Implementation.** `cmd-ingest.mjs` post-step for `qa-run`: per result row with an admission ⇒ `<run>/observations/<observation_id>.json` (`observation_id = "O-" + sha256(import_sha256\0case_id)[0:12]`, `case_sha256` from the admission, unknown fields `unknown`); rows without admission ⇒ unresolved candidate in `unlocated.json` with reason `unadmitted-case`; `FAIL` observations render under report section 9; `plan.mjs ta-prompt` per §4.5; `ta-report` per-unit records into `<run>/ta-units.json` (partial coverage kept per assertion).

**Verification.**
- [ ] `observations.test.mjs: "observation shape; unknown never blank"` (US-036 AC-1), `"unadmitted case ⇒ unresolved candidate"` (AC-2), `"FAIL renders in section 9; mitigation needs a separate mitigation-review receipt"` (AC-3), `"ta-prompt carries cases{id,title,path}, slug, base; no proposal; includes not-yet-VERIFIED cases"` (US-037 AC-1, AC-4), `"per-unit records; partial coverage per assertion"` (AC-2).

#### TASK-045: Tracker profile read-back and fix route
**Story:** US-039 AC-2, AC-4 · **Assigned:** js-dev · **Depends on:** TASK-031, TASK-017 · **Complexity:** S

**Implementation.** `fix_prompt` text generator (routes to `bugfix-workflow` with finding id, `context_redacted`, and the exact `verify.mjs all --finding <id> --base <oid> --head <oid>` command the developer must report back); `ingest tracker-readback --sent <ticket.json>` mismatch reporting (TASK-017) surfaced as `READBACK: ok | MISMATCH(<field>)`; register event `ticketed` with `ticket_url` from a read-back whose host ∈ `targets.tracker`.

**Verification.**
- [ ] `cmd-publish.test.mjs: "fix_prompt names bugfix-workflow and the verify command"` (US-039 AC-4); `ingest-tracker.test.mjs: "read-back mismatch reported; host rule"` (AC-2).

#### TASK-046: `risk-register` skill (prose)
**Story:** US-040 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-029 · **Complexity:** S

**Verification.**
- [ ] `risk-register.test.mjs: "no scripts/; every transition of register-transitions.mjs and the approval record shape are described; text says there is no confirmed state"` (US-040 AC-1, AC-2); `skills-ref` passes.

#### TASK-047: `security-lead` agent + briefing + `assess` flow
**Story:** US-041 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-043, TASK-044, TASK-045, TASK-046, TASK-035 · **Complexity:** L

**Implementation.** `agents/security-lead/{AGENT.md,SOUL.md}` (§4.7 frontmatter; `assess` order of US-041 AC-2 as a numbered procedure with the exact commands; dispatch of `threat-modeler` and `security-reviewer` per packet via the host's subagent mechanism; prints hand-off prompts and **stops**; proposes `accept` with human-supplied `--approved-by/--approval-ref`; the four rules; self-check before writes), `briefings/security-lead.md`.

**Verification.**
- [ ] `agents.test.mjs: "security-lead frontmatter equals §4.7; no mcpServers; assess procedure lists the commands in order and ends with hand-off + stop; proposes never approves"` (US-041 AC-1…AC-4); briefing lands at `.agents/memory/security-lead/project_briefing.md` on install (AC-5, via temp install).

#### TASK-048: Final manifest
**Story:** US-042 · **Assigned:** js-dev · **Depends on:** TASK-040, TASK-047 · **Complexity:** S

**Verification.**
- [ ] `manifest.test.mjs: "factory.json equals the final contract"` (US-042 AC-1); `npm run validate` (with network) exit 0 (AC-2); `npm test` green including both E2E paths with the full roster (AC-3; path (a) now also provisions `dispatching-parallel-agents` offline).

### M4

#### TASK-049: manual-qa follow-up PR (Step 0 row + explicit-list proposal)
**Story:** US-043 · **Assigned:** js-dev · **Depends on:** TASK-048 · **Complexity:** S
**Verification.** Row present in `bundles/manual-qa/agents/test-run-lead/AGENT.md` Step 0 routing table; proposal text marked nice-to-have; manual-qa tests + `validate:factories` green.

#### TASK-050: feature-development follow-up PR (`code-review` pointer)
**Story:** US-044 · **Assigned:** js-dev · **Depends on:** TASK-048 · **Complexity:** S
**Verification.** One line in `bundles/feature-development/skills/code-review/SKILL.md` § 2; `skills-ref` + `validate:factories` green; `git diff --stat` shows one file.

#### TASK-051: `execution-authorization` design note (both QA bundles)
**Story:** US-045 · **Assigned:** js-dev · **Depends on:** TASK-042 · **Complexity:** S
**Verification.** Identical note under `bundles/manual-qa/docs/` and `bundles/test-automation/docs/` (docs only); describes the proposal frontmatter and `authorization` fields with `authenticated: false`; both bundles' tests and `validate:factories` green; `bin/check-skill-dupes.mjs` group added for the two copies.

### M5

#### TASK-052: Catalog rows, marketplaces, final docs
**Story:** US-046 · **Assigned:** js-dev · **Depends on:** TASK-048 · **Complexity:** S
**Verification.** `README.md` and `bundles/SPEC.md` "Current factories" rows; `npm run gen:marketplaces && npm run validate:marketplaces` exit 0; each security agent/skill appears once; no "exact checkout".

#### TASK-053: Four-target + two-skill smoke (documented)
**Story:** US-047 · **Assigned:** qa-engineer · **Depends on:** TASK-052 · **Complexity:** M
**Verification.** `scripts/smoke.test.mjs` (opt-in `SDLC_SMOKE=1`): four `bin/init.mjs init --factory security-testing --target <t> --yes` runs into temp dirs assert native shapes, `SKILLS-INJECTED` for non-Claude, `<!-- FACTORY:security-testing START/END -->` splice; two-skill path runs `engagement init → run init --kind review → scope → gate → coverage → build-report --template review → check` ⇒ `CONSISTENT`; commands and expected outputs recorded in the bundle README install section.

#### TASK-054: Dogfood `assess` on sdlc-skills
**Story:** US-048 · **Assigned:** maintainer · **Depends on:** TASK-053 · **Complexity:** M
**Verification.** A `COMMITTED` assessment run exists; `sign-off` exits 0 under default policy; `check --integrity --drift` ⇒ `CONSISTENT`, `CURRENT`, `ORIGIN: unauthenticated`, `KEY: available`; `git status --porcelain` shows only the managed block and intended publications; redacted report kept under `docs/superpowers/notes/`; every finding has a register row.

#### TASK-055: Hook-input probe result
**Story:** US-049 · **Assigned:** maintainer · **Depends on:** none (parallel) · **Complexity:** S
**Verification.** `bundles/security-testing/tools/probe-hook-input.mjs` prints received hook-input fields with no side effects; `bundles/security-testing/NOTES.md` records per-host identity fields and trust, and states v1 ships no bundle hooks (D4).

---

## 6. Spikes

#### SPIKE-001: Offline external provisioning through the installer's cache path — **executed, resolved**
**Timebox:** 30 min (used ~5) · **Question:** Does `bin/init.mjs`'s `shallowClone` (`git fetch --depth 1 origin <ref>` when `<cache>/<repo>/.git` exists, then `checkout FETCH_HEAD`) succeed against a pre-populated clone whose `origin` is a local bare repo, while a `GIT_CONFIG_GLOBAL` `insteadOf` rewrite makes every `https://github.com/` URL unreachable — i.e. is spec §12's E2E design implementable as written?
**Approach:** built a bare fixture repo with `skills/systematic-debugging/SKILL.md`, cloned it to `<cache>/sdlc-skills/registry/obra__superpowers`, exported `GIT_CONFIG_GLOBAL` with `[url "/nonexistent/"] insteadOf = https://github.com/`, ran the installer's exact git argv, then attempted a real GitHub clone.
**Output:** `FETCH_OK`, `CHECKOUT_OK`; the GitHub clone failed with `'/nonexistent/obra/superpowers' does not appear to be a git repository` — the guard bites. **Yes**: TASK-038 can be built exactly as spec §12 states. Watch-out: the cache directory name is `repo.replace("/", "__")` → `obra__superpowers`; the installer only takes the fetch path when `.git` exists there, so the E2E must `git clone` (not copy) into the cache.

**Second finding from the same session (guardrail G-12):** `node --test` with no arguments sweeps every `*.mjs` under any directory literally named `test/` (Node 24 confirmed: a fixture at `scripts/fixtures/test/data.mjs` was executed and threw). Fixture directories must never be named `test`.

No other spec contract looked unimplementable as written. The two places that needed a *reading* rather than a spike (run-directory boundary, two-pass verify) are TL-3 and TL-6.

---

## 7. Architecture guardrails (specific to this bundle)

A PR that violates any of these is sent back regardless of test results.

- **G-1 No clock in any preimage.** `Date.now()` / `new Date()` appear only inside `ctx.now()`; `created_at` and register `ts` are the only consumers; nothing under `payload` ever carries a timestamp, a duration, a hostname, a tmp path or a PID. Test: `canon.test.mjs "scope identity independent of envelope"` and the E2E's byte-equality across two runs with `SECURITY_EVIDENCE_NOW` fixed.
- **G-2 No plain sha256 over content that can match a redaction rule.** Range bytes, file bytes, snapshot originals, install-modified trees, suppression line content: HMAC with the engagement key, or sha256 of the *redacted* form. Plain sha256 is for canonical payloads, redacted import bytes, executables and git metadata only. Reviewer greps every `sha256Hex(` call site.
- **G-3 Read → HMAC → redact → persist, in that order, in one function.** Every writer of external or working-tree bytes goes through `imports.snapshotImport` or `cmd-scope`'s snapshot path. No second implementation.
- **G-4 Every string that leaves memory passes `redact.mjs`** — artifacts (`writeArtifact` calls `redactDeep` on the payload unless the caller passes `{prered: true}` for bytes already redacted by G-3), stdout, stderr, prompts, ticket bodies, test output. A new `console.log`/`writeFileSync` outside `ctx.out()`/`fsx` is a review finding.
- **G-5 Only `cmd-engagement.mjs` step 1 touches `.gitignore`;** only `publish --to` writes outside `<st>/**`, `.agents/memory/<role>/**`, `reports/security/**`, `tasks/security-*/**`.
- **G-6 `shell: false`, argv arrays, explicit `cwd` and `env`, always.** No `exec`, no `execSync("string")`, no template literals into a command, no `npx` spawned by the scripts. Test argv comes only from `engagement.execute_project_tests`; any other source of argv (SARIF, ticket, PR, doc, claims) is data.
- **G-7 Scripts derive; agents assert.** No CLI accepts an `id`, `state`, `verdict` or `*_sha256` from an agent-authored file as truth; `receipt validate` and `gate` reject inputs that carry them. No script writes anything into `<st>/receipts/` (the drop-box is agent-owned).
- **G-8 No `confirm`, no `authenticated: true`, no `confirmed`.** Grep-guarded by `schema.test.mjs`. Approval-like records always carry `authenticated: false`. `status` never subtracts an approval from open exposure.
- **G-9 Pure cores.** `gate-core`, `states.applyReceipts`, `evaluate`, `register-core.replay`, `render` import nothing from `node:fs`, `node:child_process` or `lib/git.mjs`; `check` re-runs exactly these. A pure core that grows an I/O import fails `evaluate.test.mjs "pure"`-style guards (add one per core).
- **G-10 Nothing is rewritten inside a run.** After `run init`, files under `<run>/` are created once (`writeExclusive`); `build-report` writes `report.md`, `manifest.json`, `COMMITTED` last; retry = new seq. The register appends; it never edits `events.jsonl`.
- **G-11 Stdlib ESM only; no build; no shell scripts; no dependencies.** No `package.json` under the skill; no `.sh`; Node ≥ 18 APIs only (`node:test`, `node:crypto`, `TextDecoder` fatal mode).
- **G-12 Fixtures never live in a directory named `test`;** use `scripts/fixtures/<area>/`. Fixture repos are built by code (`fixtures/repo/build.mjs`) into temp dirs, never committed as `.git` directories.
- **G-13 Exactly the spec's tokens.** Result strings are constants exported from `lib/tokens.mjs` (`DIRTY-TREE`, `INCOMPLETE(...)`, `CONSISTENT-REDACTED-ONLY(n citations)`, `NO-ASSESSMENT`, `VERDICT …`, …). `UNGATED` and `exact checkout` are forbidden strings (grep test).
- **G-14 No network anywhere in `scripts/`;** no `fetch`, `node:http(s)`, `net`, `dns`. The tracker call belongs to the lead's `issue-tracking` skill; the scripts only produce and read back files.
- **G-15 Cross-task file ownership.** A task edits only its own `cmd-*.mjs`/`lib/*.mjs` plus one dispatch line in the entry script and one row in `lib/tokens.mjs`; shared modules (`canon`, `redact`, `normalize`, `schema`, `git`, `fsx`, `cite`, `states`) change only through a task that names them in Implementation, with the owning test extended.

---

## 8. Handoff to PM

- **Counts:** 55 tasks (M-1: 1 · M1: 37 · M2: 3 · M3: 7 · M4: 3 · M5: 4), 1 spike (executed, no follow-up), 13 parallel groups in M1, critical path 15 steps (§1).
- **Start now (Group A, four devs):** TASK-002 canon, TASK-003 normalize, TASK-004 redact, TASK-005 schemas — right after TASK-001 merges. TASK-026 (evaluate) and TASK-028 (register core) can also start as soon as TASK-002/005/006 land; they are the two longest independent branches and keep two devs busy while the scope→gate chain is sequential.
- **Bottlenecks:** TASK-019 `gate` (single dev, everything downstream waits) and TASK-025 `check` (fan-in of render, evaluate, replay). Assign the strongest js-dev to 019 and keep 025 with whoever wrote 023/024.
- **Sequencing rules the PM must hold:** 008→009→010→011 are one file's step pipeline — one dev, in order, or accept rebases. 021→022 sequential. 038 (E2E) last in M1 and blocks M2. `factory.json` is created only in TASK-037 (so `validate:factories` cannot see a half-built bundle earlier — a `bundles/security-testing/` directory without `factory.json` is invisible to the validator and the marketplace generator; confirmed in `item-resolver.mjs` `factoryIds`).
- **Decisions the maintainer should confirm or veto before Group C** (§2): TL-3 run-directory boundary (two trees keyed by `run_id`), TL-4 drop-boxes + script admission, TL-5 `engagement.md` carries a fenced JSON block, TL-6 two-pass `verify all`, TL-8 register outside the ignore block. Vetoing TL-5 (e.g. insisting on YAML frontmatter) costs a mini-YAML parser task (+M) and a new spike on nested lists; vetoing TL-6 requires a `--resume` design that rewrites a run, which G-10 forbids — I'd push back.
- **Risks:** (1) `check` naming a tampered field (TL-7) is marker-based; if the maintainer wants Markdown-structural naming instead, that is a later refactor of `render.mjs` only. (2) `ingest qa-run`/`audit`/`ta-report` parse other bundles' formats — the fixtures must be copied verbatim from `bundles/manual-qa/knowledge/` and `bundles/test-automation/`; a format change there breaks us, so TASK-018 also adds a `check-skill-dupes`-style pairing note. (3) The M1 assessment E2E needs an empty threat model fixture until M2 — documented in TASK-024, not a hidden hack. (4) `verify all` runs project tests inside an OS temp worktree; on CI the fixture test runner is a Node script, so no toolchain risk, but the allowlist must be agreed (§4.2) before TASK-027.
- **Nothing in this plan changes a §2 promise or a §3 decision.** Where the spec says "as v3 §N" I read commit `028fab1` and folded the content into §4.

Ready to distribute.

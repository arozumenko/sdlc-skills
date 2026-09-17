# security-testing bundle v1 — technical decomposition (v2)

**Date:** 2026-09-16 (v1: 2026-09-15, `7fdfdec`)
**Author:** Rio (tech-lead, feature-development bundle)
**Inputs:** [spec v6.1](../specs/2026-09-14-security-testing-bundle-design.md) (§20 amendments P1–P5 applied; §2/§3 locked), [epic + stories](2026-09-15-security-testing-bundle-stories.md) (US-001 … US-049), the plan critic's findings on v1, the PM's rulings on TL-3/4/5/6/8, `CLAUDE.md`, `bundles/SPEC.md`, `bin/init.mjs` (`planFactory`: extra skills = `factory.skills ∪ skills declared by the installed roster`), `bin/check-skill-dupes.mjs` (`GROUPS = [[canonical, ...copies]]`), `bin/validate-factories.mjs`, `hooks/lib.sh`.
**Status:** ready for PM distribution. **59 tasks** (TASK-001 … TASK-059; 056–059 are new), 1 spike (SPIKE-001, executed in v1, unchanged), 15 tech-lead readings (§2). **Dependency groups are recomputed honestly**: a task sits in group N only if every dependency sits in a group < N. M1 is 19 groups deep; the critical path is **20 steps** (§1).

Conventions: `<st>` = `.agents/security-testing/` in the consumer repo; `scripts/` = `bundles/security-testing/skills/security-evidence/scripts/` in this repo; `<run>` = `<st>/runs/<run_id>/`. Exit codes everywhere: `0` ok, `1` internal error (uncaught), `2` usage / unknown command / bad argv / EDIT-AND-RERUN class, `3` INDETERMINATE-class refusal, `4` verification failure, `5` integrity mismatch.

---

## 0. What changed from v1 (critic findings → resolution)

| Critic finding | Resolution in v2 |
|---|---|
| (1) no scope-level packet before `gate`; claims unschedulable | spec P1. New **TASK-057** `packet --kind scope` (before `gate`); TASK-021 is now the **subject** packet task; `gate --claims` requires the claims file to name the scope packet it was produced from (TL-15). |
| (2) two-skill standalone has no human-driven sequence | TASK-034 (`secure-code-review` § "Standalone review, human-driven") and TASK-037 README document the exact sequence; TASK-038 path (b) executes it. |
| (3) assessment inputs have no producing task; verify runs live in other run dirs | spec P2. TASK-012 `run init --kind assessment` writes the empty inputs; new **TASK-058** `run snapshot register|verify|proposals` copies cross-run artifacts **into** the run dir. TL-3 confirmed by PM. |
| (4) `risk-register.md` context-doc never rendered | spec P5. New **TASK-059** `register.mjs render` → `<st>/risk-register.md`; TASK-047's context-doc is no longer dangling. |
| (5) purge omits `baseline.<eid>.json` and the current-key case | TASK-032 rewritten to the P3 scope. |
| (6) §9.2 audit-branch header/cookie expression missing | TASK-043 Implementation + test. |
| (7) `admitted-reviewed` assertion undefined | spec P5. TASK-042: `vulnerability-review` receipt on the case packet with assertion `confirmed`; `refuted`/`indeterminate` ⇒ proposal. |
| (8) US-030 AC-1 asserts `verifying-outcomes`/`issue-tracking` at M1 | Stated why they belong to M3 (TASK-038 note, TASK-048 assertions): the installer resolves only roster-declared skills; at M1 no installed item names them. `memory`/`knowledge-curation` **are** asserted at M1. |
| (9) `INDETERMINATE` coverage not in sign-off | TASK-033 fail cause `COVERAGE-INDETERMINATE(<run>)` (US-014 AC-3). |
| (10) `ticketed` not in the transition table | TASK-029 table row; emitted only by `ingest tracker-readback` (TASK-045). |
| TASK-031 tracker split | spec P4, no longer a TL reading: script writes `handoffs/<finding-id>.ticket.json` + first-layer dedupe; lead posts via `issue-tracking`; readback emits `ticketed`. US-039 AC-1 is satisfied at payload level (stated in TASK-031). |
| TL-8 register location | **overruled**: `<st>/register/` is inside the managed ignore block (P3, ten patterns). |
| TASK-026 `refound` narrowed without fixture | fixture "refound + not-applied ⇒ `UNVERIFIED-INDETERMINATE(fix-review)`, no event" in TASK-026 and TASK-027. |
| TASK-011 vs TASK-008 exit conflict; step ordering | P3: step 0 (templates + `engagement.md` copy + exit 2 `EDIT-ENGAGEMENT-AND-RERUN`) is TASK-011 and runs first; TASK-008 assembles the pipeline `[0 templates, 1 ignore block, 2 fail-closed, 3 key, 4 baseline]`; TASK-010's baseline requires an existing `engagement.md`. |
| TASK-024 undeclared `snapshot-register` | replaced by TASK-058. |
| TASK-002 needs TASK-004; `makeEnvelope` schema_version | done: TASK-002 depends on TASK-004; `makeEnvelope({schema_version, …})`. |
| TASK-005 cross-references prose | every payload shape pasted verbatim into TASK-005. |
| TASK-006 depends on TASK-005; `tool_version` from SKILL.md | done; TASK-006 owns `scripts/version.json` (`tool_version`), TASK-023 reads it, TASK-037 asserts SKILL.md `metadata.version` equals it. |
| TASK-037 manifest test needs offline harness | new **TASK-056** (offline external-cache harness) lands in group 1; 037 and 038 depend on it. |
| TASK-030 reads `verify.json` produced later | TASK-026 ships enveloped `verify.json` fixtures; TASK-030 tests against them. |
| TASK-018 fixtures mirror other bundles' formats | `check-skill-dupes.mjs` groups pairing the verbatim fixtures with their sources. |
| US-046 / TASK-046 lack Implementation | TASK-046 and TASK-052 have Implementation sections. |
| ordering (groups B/C/D/H/K, chain 008→011) | §1 recomputed; every group is dependency-true. |

---

## 1. Execution plan

Dependency graph first. Every M1 script task is a one-session PR (script slice + sibling `*.test.mjs` + fixtures); M2–M5 tasks are coarser by design.

```
G0   001 docs (M-1)                                   055 hook probe (independent, any time)
G1   003 normalize · 004 redact · 005 schemas · 056 offline harness
G2   002 canon (needs 004: writeArtifact → redactDeep)
G3   006 skeleton+version.json · 007 engagement parser+templates · 026 evaluate (pure) + verify.json fixtures
G4   009 keys · 011 engagement init step 0 · 028 register core
G5   010 baseline · 012 run init/ledger (+ empty assessment inputs) · 029 transitions (+ ticketed)
G6   008 engagement init pipeline+validate · 013 scope · 015 import store · 030 consume-verdict
     032 purge · 058 run snapshot register|verify|proposals · 059 register render
G7   014 cite · 017 ingest tracker-side · 018 ingest qa-side · 020 coverage · 057 packet core + scope packet
G8   016 ingest sarif
G9   019 gate
G10  021 subject packet
G11  022 receipt validate|apply + states
G12  023 build-report core + review template · 034 secure-code-review skill
G13  027 verify all (two-pass) · 031 publish + check-export · 036 security-reviewer agent
G14  024 assessment/verify/threat-model templates
G15  025 check
G16  033 sign-off
G17  035 security-engagement skill
G18  037 M1 manifest / FACTORY.md / README / instructions
G19  038 installed E2E, both shapes                                     ← M1 done
G20  039 tm-lint + threat-modeling (M2) · 045 tracker readback + fix route (M3) · 046 risk-register skill (M3)
G21  040 threat-modeler agent · 041 sign-off disposition policy
G22  042 plan.mjs admit|propose + planning skill
G23  043 admitted suite (case/handoff profiles) · 051 execution-authorization note (M4)
G24  044 observations + TA
G25  047 security-lead agent
G26  048 final manifest + E2E roster extension
G27  049 manual-qa PR · 050 feature-development PR · 052 catalog/marketplaces
G28  053 smoke
G29  054 dogfood
```

### Parallel groups

| Group | Tasks | Max parallel devs | Note |
|---|---|---|---|
| G0 | 001, 055 | 2 | 055 has no dependencies and can run at any time |
| G1 | 003, 004, 005, 056 | 4 | |
| G2 | 002 | 1 | |
| G3 | 006, 007, 026 | 3 | |
| G4 | 009, 011, 028 | 3 | |
| G5 | 010, 012, 029 | 3 | |
| G6 | 008, 013, 015, 030, 032, 058, 059 | 4+ | 008 is the only writer of `cmd-engagement.mjs` (009/010/011 ship modules, not pipeline steps) |
| G7 | 014, 017, 018, 020, 057 | 4+ | |
| G8 | 016 | 1 | |
| G9 | 019 | 1 | widest fan-in; strongest js-dev |
| G10 | 021 | 1 | |
| G11 | 022 | 1 | |
| G12 | 023, 034 | 2 | |
| G13 | 027, 031, 036 | 3 | |
| G14 | 024 | 1 | |
| G15 | 025 | 1 | keep with whoever wrote 023/024 |
| G16 | 033 | 1 | |
| G17 | 035 | 1 | prose; its test reads 033's exported token list |
| G18 | 037 | 1 | first commit of `factory.json` |
| G19 | 038 | 1 | qa-engineer |
| G20–G29 | as drawn | 3 / 2 / 1 / 2 / 1 / 1 / 1 / 3 / 1 / 1 | milestone labels are delivery labels; 045/046 depend only on M1 tasks and may start when M1 closes |

### Critical path

`001 → 004 → 002 → 006 → 009 → 012 → 013 → 014 → 016 → 019 → 021 → 022 → 023 → 027 → 024 → 025 → 033 → 035 → 037 → 038` — **20 steps**. `gate` (019) and `check` (025) remain the fan-in points. 035 is on the path only because `factory.json` (037) lists `security-engagement` in `localSkills` and `validate-factories` requires the `SKILL.md` to exist; a placeholder `SKILL.md` would take it off the path but I will not ship a placeholder skill.

### Assignment

Every M1 script task: **js-dev** (Node, stdlib, `node:test`). Prose/agent tasks (034, 035, 036, 039-skill half, 042-skill half, 046, 047): **js-dev with the writing-skills skill loaded**; the tech-lead reviews every AGENT.md frontmatter against §4.7 before merge. E2E, harness and smoke (038, 056, 053): **qa-engineer**. Doc PR (001), dogfood (054), probe (055): **maintainer** (the user) or js-dev.

---

## 2. Tech-lead readings (TL-1 … TL-15)

Where spec v6.1 fixes a contract but leaves the representation open, I fix the representation here so parallel tasks share one boundary. PM rulings on the v1 readings are recorded in the last column. None changes a §2 promise or a §3 decision.

| # | Reading | Why | Status |
|---|---|---|---|
| TL-1 | `evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`, `plan.mjs` are thin argv dispatchers; every subcommand lives in `scripts/lib/cmd-<name>.mjs` exporting `run(argv, ctx) → Promise<number>`; shared code in `scripts/lib/<module>.mjs`; every `lib/*.mjs` has a sibling `*.test.mjs`. | 15+ subcommands in one file = every task rebasing on every other. | unchanged |
| TL-2 | Consumer root = `--root <dir>` or `git rev-parse --show-toplevel` of cwd; `<st>` = `<root>/.agents/security-testing/`; commands refuse to run outside a git work tree (exit 2). | Every spec path is repo-relative. | unchanged |
| TL-3 | **Run directory boundary.** `run init` creates `<st>/runs/<run_id>/` (artifacts) and `<st>/ledger/<run_id>/imports/` (redacted import bytes). "`build-report` reads only from the run directory" = opens nothing outside those two trees. Cross-run artifacts (register events, other runs' `verify.json`, proposals) enter only through `run snapshot …` (spec P2, TASK-058). | §6.6 fixes imports under `ledger/`; §6.3 needs them as transitive inputs. | **confirmed** by PM; P2 is the cross-run mechanism |
| TL-4 | **Receipts, claims and examined declarations are agent drop-boxes; scripts admit.** Agents write payload-only JSON under `<st>/receipts/<run_id>/`. `receipt validate` envelopes and copies an accepted receipt into `<run>/receipts/<self_sha256>.json`; `gate --claims` / `coverage --examined` consume the claims/examined files. Ids and states are script-assigned (§4 rule 3). No script writes into the drop-box; `purge` may delete it. | Keeps the run-dir boundary true and agents unable to write ids/states. | **confirmed** |
| TL-5 | **`engagement.md` machine record** = one fenced ```` ```json engagement ```` block inside the Markdown; parsed with `canon.parseStrict`; `run init` snapshots it as `<run>/engagement.json`. | Stdlib-only; no YAML parser. | **confirmed** |
| TL-6 | **`verify.mjs all` is two-pass.** Pass 1 (no `--receipts`) runs steps 1–6a, writes the fix-review packet, evaluates with the receipt absent (⇒ `UNVERIFIED-INDETERMINATE(fix-review)`), prints `PACKET <path>` and `NEXT: dispatch security-reviewer fix-review`. Pass 2 (`--receipts <dir>`) is a fresh verify run (new `seq`) that re-executes everything and admits the receipts. Packet identity is deterministic, so a receipt against the pass-1 packet matches the pass-2 packet. | A script cannot dispatch an agent; retry = new seq. | **confirmed** |
| TL-7 | `check` names the tampered field via renderer line markers `<!-- v:<view-path> -->`; recomputed-artifact mismatches are named before any byte comparison. | US-017 AC-2 needs a field name without a Markdown parser. | unchanged |
| TL-8 | **Register lives at `<st>/register/`** (`events.jsonl`, `projection.json`, `finding-alias.jsonl`, `lock/`) **inside** the managed ignore block (§6.9 lists `.agents/security-testing/register/`; `artifact_policy.register: committed` removes the pattern). The rendered view `<st>/risk-register.md` (TASK-059) is outside the block: it is the lead's `context-docs` file and carries only redacted, derived text. | P3. | **overruled → applied** |
| TL-9 | Keys: `<st>/private/keys/<key_id>` (32 random bytes, mode `0600`, `O_EXCL`), `key_id = "k" + sha256(keybytes)[0:12]`, `keys/current` holds the active id, `keys/index.json` records `{key_id → {engagement_id, created_at}}` so `purge` can remove exactly one engagement's keys and drop `current` when it points at one of them. `run_id = head_oid[0:12] + "-" + seq (zero-padded to 4)`. | §6.5, §6.9 purge scope. | unchanged |
| TL-10 | Content identity is HMAC wherever content bytes are the preimage; artifact identity is plain sha256 over canonical payload; plain sha256 of *redacted* bytes is allowed. | §2 row 4. | unchanged |
| TL-11 | Deterministic time: `ctx.now()` reads `SECURITY_EVIDENCE_NOW` when set; `created_at`/`ts` never enter a payload. `actor` = `--actor` / `SECURITY_EVIDENCE_ACTOR` / `"unknown"`. | E2E byte-equality. | unchanged |
| TL-12 | `deletion_only` = the `base..head` diff of the finding's `path` removes ≥ 1 line inside the cited range and adds zero lines to that file. Indicator kinds are the closed list in §4.2. | §6.4 names the flag. | unchanged |
| TL-13 | **`artifact_policy`** keys are the artifact names `ledger runs receipts proposals handoffs imports register reports cases`, values `local` (default) or `committed`; `committed` removes that pattern from the block. `private` is not a key: the key material under `private/` can never be un-ignored by policy (exit 2 `POLICY-INVALID(private)` if present). | P3 says a `committed` entry removes a pattern; it does not say which names. Keeping keys out of git is the one case I refuse to make configurable. | new — PM to confirm |
| TL-14 | **Index files are the only rewritten files inside a run.** `<run>/imports.json`, `observations.json`, `proposals-index.json` (written empty by `run init`) and `ledger/index.json` are indexes rewritten tmp+rename under the run lock; every other file under `<run>/` is write-once. Their identity never enters a preimage; the manifest hashes the set of members they list. | P2 requires empty inputs at `run init` and later population; G-10 forbids rewrites. | new |
| TL-15 | **Claims name their scope packet.** The `review` contract's output is two payload-only files: `claims-<n>.json` `{scope_sha256, packet_sha256, findings[]}` and `examined-<n>.json` `{packet_sha256, declared[]}`; `gate --claims` rejects a claims file whose `packet_sha256` is not a `kind: scope` packet of the same run (`CLAIMS-PACKET-MISMATCH`). | P1: the reviewer produces claims over the scope packet, before ids exist. | new |

---

## 3. Interface contracts — common

### 3.1 Process contract (all five scripts)

- Invocation: `node <script>.mjs <command> [<subcommand>] [flags]`. `--help` / no command ⇒ usage on stdout, exit `2` (`--help` ⇒ `0`).
- Global flags (before or after the command): `--root <dir>`, `--actor <name>`, `--quiet`.
- stdout: result tokens exactly as the spec spells them, one per line; a command that writes an enveloped artifact ends with `WROTE <repo-relative path> sha256=<self_sha256>`. stderr: diagnostics only. Every string printed or written passes through `redact.mjs` first (US-003).
- Child processes: `execFile`/`spawn` with an argv **array**, `shell: false`, explicit `cwd`, explicit `env`. Never `exec`, never `shell: true`, never string interpolation into a command (D8).
- No network. No `fetch`, no `http`, no child calls to `curl`/`gh`/`npm`. `publish --to` writes files; the tracker call is the lead's `issue-tracking` skill (P4).

### 3.2 On-disk layout in the consumer repo

```
.agents/security-testing/
  engagement.md                      # human + ```json engagement block (TL-5)   — commit by policy (not in the block)
  risk-register.md                   # register.mjs render (TASK-059), lead context-doc — not in the block
  knowledge/                         # seeded by factory `seed` or written by engagement init step 0 (D12)
    engagement.md.template  finding-schema.md  report-reading-guide.md
  threat-model.json                  # M2                                        — commit by policy (not in the block)
  register/                          # TL-8 — managed-ignored (artifact_policy.register: committed removes the pattern)
    events.jsonl  projection.json  finding-alias.jsonl  lock/
  private/                           # managed-ignored, never un-ignorable (TL-13)
    keys/<key_id>  keys/current  keys/index.json
    baseline.<engagement_id>.json
    snapshots/<run_id>/<path>        # redacted bytes of dirty review files
    citations/<run_id>/<finding_id>.json
  ledger/                            # managed-ignored
    index.json  index.lock/  <run_id>.lock/   # run lock (TL-14 index rewrites); outside every walked tree
    <run_id>/imports/<import_sha256>
  runs/<run_id>/                     # managed-ignored
    run.json  engagement.json  scope.json  examined.json
    imports.json  observations.json  proposals-index.json        # indexes (TL-14); empty at run init
    ingest/<import_sha256>.json      # per-import derived records
    findings.claimed.json  gate-result.json  rejects.json  unlocated.json  coverage.json
    packets/<packet_sha256>.json  receipts/<receipt_sha256>.json
    verify.json                      # verify-kind runs
    register-events.json             # run snapshot register (assessment runs)
    verify-snapshots/<verify_run_id>/{verify.json, packets/, receipts/}   # run snapshot verify
    threat-model.json  dispositions.json  observations/  admissions/       # M2/M3
    report.md  manifest.json  COMMITTED
  receipts/<run_id>/                 # agent drop-box (TL-4): claims-*.json examined-*.json receipt payloads — managed-ignored
  proposals/<id>.proposal.md         # M3                                         — managed-ignored
  handoffs/<slug>.md  handoffs/<finding_id>.ticket.json   # M3 / tracker payloads  — managed-ignored
  imports/                           # reserved, managed-ignored (ingest inputs the lead copies in)
reports/security/                    # publish --profile redacted-report|full-report — managed-ignored
tasks/security-<slug>-admitted/      # publish --profile case                     — managed-ignored
```

### 3.3 Module map (`scripts/`)

| File | Exports (contract) | Task |
|---|---|---|
| `canon.mjs` | `parseStrict(text)`, `canonical(value) → Buffer`, `sha256Hex(buf)`, `hmacHex(keyBytes, buf)`, `makeEnvelope({schema_version, kind, run_id, engagement_id, key_id, now}, payload)`, `artifactId(payload)`, `writeArtifact(path, artifact, {prered?})` (tmp+rename; calls `redactDeep` on `payload` unless `prered: true`), `readArtifact(path, {kind?}) → {envelope, payload}` (verifies `self_sha256`; throws `IntegrityError`) | 002 |
| `normalize.mjs` | `normalizeText(buf) → {lines: string[], text: string}`; throws `EncodingError` | 003 |
| `redact.mjs` | `loadRules(path?) → Rules`, `redactString(s, rules) → {text, hits[]}`, `redactDeep(value, rules) → value`, `matches(strOrBuf, rules) → boolean`, `RULES_PATH`, `DEFAULT_RULES` | 004 |
| `lib/schema.mjs` | `validate(schemaName, value) → string[]` (errors), `loadSchema(name)`; keyword subset listed in TASK-005 | 005 |
| `version.json` | `{"tool_version": "1.0.0"}` — one key, owned by the scripts (P5) | 006 |
| `lib/ctx.mjs` | `createContext(globalFlags) → ctx`, `ctx = {root, st, now(), actor, engagement() (lazy, TL-5), key() (lazy, current key or null), keyById(id), toolVersion(), log(), out()}` | 006 |
| `lib/exit.mjs` | `EXIT = {OK:0, INTERNAL:1, USAGE:2, INDETERMINATE:3, FAIL:4, INTEGRITY:5}`, `class CliError(code, token)` | 006 |
| `lib/tokens.mjs` | every result token as a constant or a formatter (`DIRTY_TREE`, `incomplete(name)`, `NO_ASSESSMENT`, `EDIT_ENGAGEMENT_AND_RERUN`, `verdictLine(...)`, …) | 006 (rows added per task, G-15) |
| `lib/git.mjs` | `git(root, argv, {input?}) → {stdout, code}` (execFile, shell:false), `toplevel(cwd)`, `revParse`, `blobOid(root, oid, path)`, `showBytes(root, oid, path) → Buffer`, `statusPorcelain`, `lsFiles({stage?, others?, excludeStandard?, ignored?})`, `checkIgnore(path) → boolean`, `diffNameOnly(base, head)`, `diffUnified(base, head, path?)`, `mergeBaseIsAncestor`, `worktreeAdd(dir, oid)`, `worktreeRemove(dir)` | 006 |
| `lib/fsx.mjs` | `writeExclusive(path, bytes, mode)` (`wx`), `appendLine(path, line)` (`a`, one `writeSync`), `writeAtomic(path, bytes)` (tmp+rename), `withLock(dir, fn, {timeoutMs})`, `walk(dir)` sorted, `rmTree(path)` | 006 |
| `lib/engagement.mjs` | `parseEngagementMd(text) → record` (TL-5), `defaultRecord()`, `TEMPLATE_PATHS` | 007 |
| `lib/knowledge-templates.mjs` | `ensureTemplates(ctx) → {written[], present[]}`, `ensureEngagementMd(ctx) → {written: boolean}` | 011 |
| `lib/keys.mjs` | `ensureKey(ctx, {rotate}) → {key_id, created}`, `loadKey(ctx, key_id) → Buffer|null`, `currentKeyId(ctx)`, `keysOf(ctx, engagement_id) → key_id[]` | 009 |
| `lib/baseline.mjs` | `computeBaseline(ctx) → payload` (throws `CliError(2, "ENGAGEMENT-MISSING")` without `engagement.md`), `diffBaseline(ctx, baseline) → {changed[], added[], removed[], ignored_counts{}}` | 010 |
| `lib/ignore-block.mjs` | `PATTERNS` (ten, in §6.9 order), `renderBlock(policy)`, `upsertBlock(text, policy) → {text, changed}` | 008 |
| `lib/ledger.mjs` | `allocateRun(ctx, {kind, base_oid, head_oid}) → {seq, run_id}` (under lock), `readIndex(ctx)`, `listCommittedRuns(ctx)`, `withRunLock(ctx, run_id, fn)` (lock dir `ledger/<run_id>.lock/`, never under `<run>/`) | 012 |
| `lib/run-index.mjs` | `appendIndex(ctx, run_id, name, entry)` for the TL-14 index files (tmp+rename under `withRunLock`) | 012 |
| `lib/cite.mjs` | `resolveSide(ctx, run, scope, {path, side}) → Buffer`, `resolveWorking(ctx, path)`, `checkRange(scope, citation) → {ok, reason?, context?}`, `occurrenceOf(lines, normalisedSnippet, start)`, `rangeBytes(buf, start, end)` | 014 |
| `lib/imports.mjs` | `snapshotImport(ctx, run_id, buf, {kind, source_path}) → {import_sha256, original_hmac, redaction_version, path}` (also appends to `<run>/imports.json`) | 015 |
| `lib/packet-core.mjs` | `buildPacket({kind, subject_ids, files: [{path, side, oid, ranges}], resolveSide, key, policy}) → payload` (pure given `resolveSide`); `POLICY_PATH` | 057 |
| `lib/states.mjs` | `applyReceipts(gateResult, receipts[], packets[]) → {states{}, mitigation_states{}, not_applied[], conflicts[]}` (pure) | 022 |
| `lib/inputs.mjs` | `REQUIRED`, `closeOver(runDir, template) → inputs` (transitive closure; throws `CliError(3, "INCOMPLETE(<name>)")`) | 023 |
| `lib/render.mjs` | `buildView(inputs) → view`, `renderMarkdown(view, template) → string` (pure, markers per TL-7) | 023/024 |
| `lib/evaluate.mjs` | `evaluate(raw) → {verdict, refound_observed, ack_refs, events}` (pure) | 026 |
| `lib/register-core.mjs` | `openRegister(ctx)`, `append(ctx, event)`, `replay(events) → projection`, `verifyChain(events)`, `anchor(projection)`, `anchorVerify(projection, expect)` | 028 |
| `lib/register-transitions.mjs` | `TRANSITIONS`, `applyTransition(row, event, payload) → row'` (pure) | 029 |
| `lib/register-render.mjs` | `renderRegister(projection) → string` (pure) | 059 |
| `lib/cmd-*.mjs` | one per subcommand: `run(argv, ctx) → Promise<number>` | per task |

Fixtures live under `scripts/fixtures/<area>/…` — never in a directory named `test` (guardrail G-12). Offline-install fixtures live in `scripts/fixtures/offline/` (TASK-056).

---

## 4. Interface contracts — commands, schemas, agents, manifests

### 4.1 `evidence.mjs`

| Command | argv | Reads | Writes | stdout (success) | Exit |
|---|---|---|---|---|---|
| `engagement init` | `[--rotate]` | `engagement.md` (if present), `.gitignore`, `git ls-files`, `git check-ignore` | step 0: `knowledge/*` when absent, `engagement.md` when absent; step 1: managed `.gitignore` block; step 3: `private/keys/*`; step 4: `private/baseline.<eid>.json` | `TEMPLATES: written|present`, `ENGAGEMENT: present`, `IGNORE-BLOCK: written|unchanged`, `KEY: <key_id> created|reused|rotated`, `BASELINE: <n files> ignored=<n>` | `0`; **`2 EDIT-ENGAGEMENT-AND-RERUN`** after step 0 when `engagement.md` was absent (prints `TEMPLATES:` and `ENGAGEMENT: template written`; nothing else happens); `2 ENGAGEMENT-INVALID(<err>)` / `2 POLICY-INVALID(private)`; `4 TRACKED(<path>)` / `4 NOT-IGNORED(<path>)` (nothing written after the failing step) |
| `engagement validate` | — | steps 1–2 inputs, key dir, baseline file | nothing | `IGNORE-BLOCK: ok|stale`, `TRACKED: none`, `KEY: available|unavailable`, `BASELINE: present|absent` | `0` / `4` |
| `engagement baseline` | — | working tree, `engagement.md` | `private/baseline.<eid>.json` (atomic overwrite) | `BASELINE: …` | `0`; `2 ENGAGEMENT-MISSING` |
| `run init` | `--kind assessment|review|verify|threat-model --base <ref> [--head <ref>]` (`--base` required for `review`/`verify`; defaults to head otherwise; `--head` for `assessment` must resolve to HEAD — D18 pins the clean tree to `head_oid` — exit 2 USAGE otherwise) | `git status --porcelain` (assessment only), `git rev-parse`, `engagement.md` | `ledger/index.json` (+1 entry under lock), `<run>/run.json`, `<run>/engagement.json`, empty dirs `packets/ receipts/ ingest/ verify-snapshots/`, `ledger/<run_id>/imports/`; **assessment only**: `imports.json` `{imports: []}`, `observations.json` `{observations: []}`, `proposals-index.json` `{proposals: []}` (P2; `threat-model.json` deliberately absent ⇒ `INCOMPLETE(threat-model)` until written) | `RUN <run_id> seq=<n> kind=<k> base=<oid> head=<oid>` | `0`; `3 DIRTY-TREE` (assessment, dirty; ledger untouched); `2 ENGAGEMENT-MISSING`; `2 KEY: unavailable` (D13: only `engagement init` mints the key); `2 USAGE(run init: …)` (unknown ref, assessment `--head` ≠ HEAD); `5 INCONSISTENT(runs/<id>)` (a run file already present for the freshly allocated seq) |
| `run snapshot register` | `--run <id>` | `<st>/register/events.jsonl` (+ recovery rule) | `<run>/register-events.json` (write-once) | `SNAPSHOT register events=<n> chain=<sha>` + `WROTE` | `0`; `2 SNAPSHOT-EXISTS`; `5 CORRUPT` |
| `run snapshot verify` | `--run <id> --from <verify_run_id>` (repeatable) | `runs/<verify_run_id>/{verify.json, COMMITTED, packets/, receipts/}` | `<run>/verify-snapshots/<verify_run_id>/{verify.json, packets/*, receipts/*}` (byte copies, each re-verified by `self_sha256`) | `SNAPSHOT verify from=<id> sha256=<verify_sha256>` | `0`; `3 INCOMPLETE(verify:<id>)` if the source is not COMMITTED; `5 INCONSISTENT(verify:<id>)` on hash mismatch |
| `run snapshot proposals` | `--run <id>` | `<st>/proposals/*.proposal.md` | `<run>/proposals-index.json` `{proposals: [{id, sha256, path}]}` (index rewrite, TL-14) | `SNAPSHOT proposals n=<n>` | `0` |
| `scope` | `--run <id> [--include <path-or-glob>]… [--max-bytes <n>=1048576]` | engagement `scope_paths`, `git ls-files`, working tree (review) | `<run>/scope.json`; review: `private/snapshots/<run>/<path>` | `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` + `WROTE` | `0`; `3 DIRTY-TREE` if an assessment tree became dirty since `run init` |
| `packet` | `--run <id> --kind scope` **or** `--run <id> --kind subject --subject <finding_id|mitigation_id|case_sha256>… [--type vulnerability-review|mitigation-review|fix-review|case] [--policy <file>]` | `scope.json`; subject: `gate-result.json`, `findings.claimed.json`, (M2) `threat-model.json`, (M3) case file; key | `<run>/packets/<packet_sha256>.json` | `PACKET <path> sha256=<h> kind=<k> files=<n>` | `0`; `2` unknown subject / `--subject` with `--kind scope` / missing `--kind` |
| `ingest <kind> <file>` | `--run <id>`; kinds `sarif|ticket|pr|doc|case|audit|qa-run|ta-report|tracker-readback`; `tracker-readback` also `--sent <ticket.json>` | the file, `scope.json`, engagement `targets` | `ledger/<run>/imports/<import_sha256>`, `<run>/ingest/<import_sha256>.json`, `<run>/imports.json` (index append) | `IMPORT <kind> import_sha256=<h> records=<n> unlocated=<n> rejected=<n>`; readback adds `READBACK: ok | MISMATCH(<field>)` and `TICKETED <R-id> <url>` | `0`; `2` malformed input (structural); rejections inside a well-formed file never change the exit code |
| `gate` | `--run <id> [--claims <payload.json>]…` | `scope.json`, `packets/*` (kind scope), `ingest/*.json`, claims files, key | `findings.claimed.json`, `gate-result.json`, `rejects.json`, `unlocated.json`, `private/citations/<run>/<id>.json` | `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>` + `WROTE` ×4 | `0`; `3 INCOMPLETE(scope)`; `2 CLAIMS-PACKET-MISMATCH(<file>)` (TL-15) |
| `coverage` | `--run <id> --examined <payload.json> [--scanner-rows <file>]` | `scope.json`, examined declaration (its `packet_sha256` must be a scope packet of the run) | `examined.json`, `coverage.json` | `COVERAGE examined=<n> skipped=<n> scanner=<n>` or `COVERAGE INDETERMINATE` (empty scope) | `0`; `4 OVERLAP(<path>:<a-b>)` / `4 GAP(<path>:<a-b>)` |
| `receipt validate` | `--run <id> <file>` | drop-box file, packet, `run.json` | `<run>/receipts/<sha>.json` | `RECEIPT admitted sha256=<h> type=<t> subject=<id>` | `0`; `4 REJECTED(<reason>)` (schema, unknown packet, `packet_sha256` mismatch, oid mismatch, forbidden field `<name>`, `subject_id ∉ packet.subject_ids`, `reviewer_run_id ≠ run`) |
| `receipt apply` | `--run <id> [--json]` | `gate-result.json`, `receipts/*`, `packets/*` | nothing | table of `subject → state`, `not-applied: <n>`, `conflicts: <n>`; `--json` prints the `states.mjs` result | `0` |
| `build-report` | `--run <id> --template review|assessment|verify|threat-model` | only `runs/<id>/` + `ledger/<id>/` (TL-3) | `report.md`, `manifest.json`, `COMMITTED` (last) | `REPORT <path>`, `MANIFEST sha256=<h>`, `COMMITTED` | `0`; `3 INCOMPLETE(<input>)`; `5 INCONSISTENT(gate-result)` |
| `check` | `<run dir | manifest.json> [--integrity] [--drift] [--trusted-digest <sha256>]` | run dir, git objects, working tree, key | nothing | in order: `CONSISTENT | CONSISTENT-REDACTED-ONLY(n citations) | INCONSISTENT(<field>) | STRUCTURE-ONLY`; with `--drift`: `CURRENT | CITATION-DRIFTED(n) | SCOPE-DRIFTED(n files)`; `ORIGIN: unauthenticated | matches supplied digest`; `KEY: available | unavailable` | `0` for CONSISTENT/REDACTED-ONLY/STRUCTURE-ONLY regardless of drift; `5` INCONSISTENT; `3 INCOMPLETE(COMMITTED)` |
| `check-export` | `<export-manifest.json> [--source <run dir>]` | manifest, output file, run dir | nothing | `VERIFIED-DERIVATIVE` / `LINKED-ONLY` / `MISMATCH(output)` | `0` / `0` / `5` |
| `publish` | `--run <id> --profile redacted-report|full-report|tracker|handoff|case --to <destination> [--slug <s>] [--base-url <u>]` | run dir, register (tracker dedupe), `ingest/*` ticket records (tracker dedupe), admissions (case/handoff) | files under `--to` (`tracker`: `handoffs/<finding_id>.ticket.json` — `--to` must be `<st>/handoffs/`); `export-manifest.json` next to them; **never** a register event | `PUBLISHED profile=<p> output=<path> sha256=<h>`; tracker: `DEDUPE finding=<id> existing=<url>` per skipped finding, then `NEXT: post <path> via issue-tracking, then ingest tracker-readback --sent <path> <response.json>` | `0`; `2` if run not COMMITTED; `2` if `--profile` absent (no default) |
| `sign-off` | `--engagement <id> [--expect <anchor>]` | `ledger/index.json`, every COMMITTED run (in-process `check`), baseline, register, admissions vs `tasks/security-<slug>-admitted/` | nothing | `SIGN-OFF: OK` or `SIGN-OFF: FAIL(<cause>)…`, then `RUNS:`, `INCOMPLETE:`, `CHANGES-SINCE-BASELINE:`, `EXCLUDED-COVERAGE:`, `UNAUTHENTICATED-APPROVALS:`, `UNADMITTED:`, `DISPOSITIONS:` | `0`; `4 NO-ASSESSMENT`; `4 <cause>` incl. `COVERAGE-INDETERMINATE(<run>)` |
| `purge` | `--engagement <id> [--yes]` | ledger, `run.json` of every run, `keys/index.json` | deletes per P3 (TASK-032) | `PURGED runs=<n> keys=<n> current-key=removed|kept` | `0`; `2` without `--yes` (prints the plan) |

Kind of every artifact (envelope `kind`): `run, engagement, scope, examined, import, claimed, gate-result, rejects, unlocated, coverage, packet, receipt, verify, manifest, export-manifest, threat-model, dispositions, admission, observation, baseline, citation-record, register-snapshot, imports-index, observations-index, proposals-index`.

### 4.2 `verify.mjs`

| Command | argv | Behaviour | stdout | Exit |
|---|---|---|---|---|
| `all` | `--finding <id> --base <oid> --head <oid> [--receipts <dir>] [--timeout-s <n>]` | allocates a `verify`-kind run (dirty main tree allowed); steps 1–6a per §6.4; evaluates; writes `<run>/verify.json`; runs `build-report --template verify` in-process (so the verify run is COMMITTED and snapshot-able); with `--receipts`, admits receipts first and calls `consume-verdict` (row must exist; otherwise prints `REGISTER: no row for finding` and continues) | `BRANCH <token>`, `TREE-BEFORE <oid>`, `INSTALL <ran|skipped> tracked_changes=<n> untracked=<n> bytes=<n>`, `SUPPRESSION indicators=<n> deletion_only=<bool>`, `TESTS <token> exe=<path> sha256=<h>`, `PACKET <path>`, pass 1 also `NEXT: dispatch security-reviewer fix-review`; last line **exactly** `VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>` | `0` whenever a verdict is emitted (every `UNVERIFIED-*` included); `2 UNKNOWN-FINDING`; `4 UNVERIFIED-REFUTED-FINDING` (refusal, no run allocated) |
| `evaluate` | `<verify.json>` or `--raw <json>` | pure; no git, no fs beyond the input | JSON `{verdict, refound_observed, ack_refs, events}` | `0`; `2` malformed |

Finding lookup: ledger runs newest-first → `gate-result.accepted[]` contains the id; its derived state comes from `states.applyReceipts` over that run. Test argv: only `engagement.execute_project_tests.argv`; first token allowlist `npm npx pnpm yarn node python python3 pytest go cargo mvn ./gradlew gradle make dotnet`; deny any token containing `; | & $ < > \` newline` or equal to `-e --eval -c exec`, and `run-script|run` whose next token ≠ `test`; env = `{PATH, HOME, LANG, TERM=dumb, CI=1, NO_COLOR=1}`; timeout default `600` s (`SIGTERM`, then `SIGKILL` after 5 s, whole process group); output ≤ 64 KiB, redacted, stored as `output_redacted`. Indicator kinds (closed): `ignore-file-edit` (`.semgrepignore .trivyignore* .gitleaksignore .snyk .bandit .eslintrc* .eslintignore eslint.config.* .semgrep.yml .semgrep/**`), `inline-suppress` (added lines matching `nosec|nosemgrep|eslint-disable|noqa|NOSONAR|gitleaks:allow|trivy:ignore|#pragma warning disable|@SuppressWarnings`), `test-skip` (added lines matching `\.skip\(|\.only\(|xit\(|xdescribe\(|@pytest\.mark\.skip|@Ignore|@Disabled`). `id = sha256(kind\0path\0line)` or `HMAC_key(kind\0path\0redacted line)` when the line matches a redaction rule (`sensitive: true`).

`verify.json` payload: exact keys in TASK-005 (`verify` schema). `evaluation` is exactly `evaluate()` of the rest; `check` recomputes it.

### 4.3 `register.mjs`

| Command | argv | Effect |
|---|---|---|
| `add` | `--subject <finding_id|threat_id> --priority p0|p1|p2|p3 --title <t> --run <run_id> [--owner <o>]` | new row `R-nnnn` status `open` |
| `accept <R-id>` | `--until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>` | `open|regressed → accepted`; acceptance record `{recorded_by: actor, approved_by, approval_ref, until, authenticated: false}`; both flags mandatory (exit 2) |
| `revoke <R-id>` | `--approved-by --approval-ref` | `accepted → open` |
| `check` | — | every `accepted` row with `until` (UTC calendar day) < today ⇒ `open`, event `acceptance-expired` — lapses at 00:00 UTC of the day after `until`; on the `until` day itself the acceptance still stands |
| `close-false-positive <R-id>` | `--approved-by --approval-ref` | `open → false-positive` |
| `reopen <R-id>` | `--reason <r>` | `false-positive → open` |
| `supersede <R-id>` | `--by <R-id> (--subject-equivalent | --transfer-exposure)` | §6.8; cycle or self ⇒ exit 2; neither flag ⇒ exit 2 `EQUIVALENCE-REQUIRED`; `--subject-equivalent` without same subject or alias link ⇒ exit 4 |
| `alias` | `--from <finding_id> --to <finding_id> --reason <r> --run <run_id>` | appends to `finding-alias.jsonl` (hash-chained); no row change |
| `consume-verdict <verify.json>` | — | `VERIFIED ⇒ fixed` (+`ack_refs`, `last_verified_run`); `REGRESSED ⇒ regressed`; `UNVERIFIED-* ⇒ verify-observed` event only; `regression-observed` whenever `evaluation.refound_observed && row.status == fixed` (TASK-030) |
| `render` | `[--out <path>=<st>/risk-register.md]` | writes the Markdown view from the projection (TASK-059); deterministic; stdout `RENDER <repo-relative path> rows=<n> seq=<n>` (`tokens.rendered`, mirrors `PROJECTION <path>`; not an enveloped artifact, so not `WROTE`); the table carries eight columns — `id | subject | priority | status | owner | ticket_url | last_verified_run | title` (the title is the one operator-text cell); `--out` is confined to the G-5 prefixes and refuses the reserved set under `<st>/` (`register/`, `private/`, `ledger/`, `runs/`, `receipts/`, `imports/`, `proposals/`, `handoffs/`, `knowledge/`, `engagement.md`, `threat-model.json` — compared **case-insensitively**, so `Register/` is refused on Linux too: on APFS/NTFS the case variant *is* the reserved path) and any existing directory — exit 2, nothing written |
| `transition <event> <R-id> [flags]` | generic form; the verbs above are aliases; **`ticketed` is not accepted here** (only `ingest tracker-readback` appends it) |
| `status` | `[--json]` | counts by status × priority, `open_exposure` (open+regressed+accepted+false-positive by priority — `EXPOSED_STATUSES` in `register-fold.mjs`; an unauthenticated approval never leaves exposure, spec §6.8 / G-8), `unauthenticated_approvals` (accepted + false-positive + rows with ack_refs), never subtracting |
| `replay` | `[--write]` | rebuild projection from log; `--write` persists |
| `anchor print` / `anchor verify --expect <eid:seq:hash>` | | `MATCH | TRUNCATED | DIVERGED` |
| `confirm` | — | **does not exist** — unknown command, exit 2 (US-021 AC-2) |

**Transition table** (`register-transitions.mjs`; v3 §6.7 minus `confirm`, plus P5):

| event | from | to | payload / guard | emitted by |
|---|---|---|---|---|
| `add` | — | `open` | row fields | `add` |
| `accept` | `open`, `regressed` | `accepted` | acceptance record; `--until --approved-by --approval-ref` | `accept` |
| `revoke` | `accepted` | `open` | approval record | `revoke` |
| `acceptance-expired` | `accepted` | `open` | `{until}` | `check` |
| `fixed` | `open`, `regressed`, `accepted` | `fixed` | `{verify_sha256, ack_refs[], last_verified_run}` | `consume-verdict` (VERIFIED) |
| `regressed` | `fixed` | `regressed` | `{verify_sha256}` | `consume-verdict` (REGRESSED) |
| `close-false-positive` | `open` | `false-positive` | approval record | `close-false-positive` |
| `reopen` | `false-positive` | `open` | `{reason}` | `reopen` |
| `supersede` | `open`, `regressed`, `accepted` | `superseded` | `{by, mode: subject-equivalent|transfer-exposure}`; transfer first raises target priority and may set it `open` | `supersede` |
| `ticketed` | **any** (status unchanged) | same | `{ticket_url, import_sha256}`; host ∈ `targets.tracker` | **`ingest tracker-readback` only** |
| `regression-observed` | any (informational) | same | `{verify_sha256}` | `consume-verdict` |
| `verify-observed` | any (informational) | same | `{verify_sha256, verdict}` | `consume-verdict` |
| `alias` | — (no row) | — | `{from_id, to_id, reason, run_id}` | `alias` |

Any (event, from) pair not in the table ⇒ exit 4 `TRANSITION-REJECTED(<event>: <from>)`. Recovery on every command (§6.8): `projection.seq < log.seq ⇒ rebuild`; `projection.seq > log.seq` or any `prev_sha256` mismatch ⇒ exit `5 CORRUPT`, write nothing. Event = `{seq, prev_sha256, ts, actor, row_id, event, payload, ref}`; `event_sha256 = sha256(canonical(event))`; genesis `prev_sha256` = 64 zeros; `chain_sha256` = last `event_sha256`. Row fields: `id, subject, subject_kind: finding|threat, title, status, priority, owner, first_seen_run, last_verified_run, ticket_url, test_refs[], proposal_refs[], acceptance?, false_positive?, ack_refs[], rationale, supersedes, superseded_by`. Statuses: `open accepted fixed regressed false-positive superseded`.

### 4.4 `tm-lint.mjs` (M2; M1 ships CLI shape + schema validation only)

`check --run <id> [--model <path>=<st>/threat-model.json]` → validates schema, one citation per element (via `cite.mjs` on the run's scope), every disposition relationship (§6.10); writes `<run>/threat-model.json` (snapshot) and `<run>/dispositions.json`; prints `TM elements=<n> threats=<n> undisposed=<n>`; exit `4 TM-INVALID(<threat|element>: <reason>)`. `render --run <id>` → `<run>/threat-model.md`. Payload shapes in TASK-005.

### 4.5 `plan.mjs` (M3; M1 ships CLI shape + schema validation only)

`admit --run <id> <case.md> [--receipt <admitted receipt sha256>]` → `<run>/admissions/<case_sha256>.json` per §9.1 (`admitted-reviewed` iff the named receipt is an admitted `vulnerability-review` receipt on the case packet with assertion `confirmed`); `propose --run <id> <proposal.md>` → validates `proposal` frontmatter and writes `<st>/proposals/<id>.proposal.md` — refuses any destination under `tasks/` (exit 2 `PROPOSAL-UNDER-TASKS`); `ta-prompt --run <id> --slug <s> --base <branch>` prints the §9.3 prompt from admitted cases only.

### 4.6 Schemas (`skills/security-evidence/references/*.schema.json`)

The exact payload shapes are pasted **once**, in TASK-005 (the schema task), so a dev never has to chase prose. Rules that hold for every schema: `additionalProperties: false` at every object level; `type: integer` for every number (no `number` anywhere); every payload root is an object; the envelope is validated once by `envelope.schema.json`; every `*_sha256` / `*_hmac` / `oid` field is `pattern: "^[0-9a-f]{40}$|^[0-9a-f]{64}$"` as applicable; every `ranges` value is an array of two-integer arrays `[start, end]` with `start ≥ 1`.

### 4.7 Agent frontmatter (`bundles/security-testing/agents/<name>/AGENT.md`)

```yaml
# security-reviewer (M1)
---
name: security-reviewer
description: "Use when a security-lead dispatches a review over a scope packet, or a vulnerability-review, mitigation-review or fix-review over a subject packet. Reads only the packet's listed files; the review contract returns a claims file, the other three return a receipt path carrying an assertion from that contract's closed vocabulary; never writes a state, verdict, id or gate stamp."
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

All three: no `tools:` (`bin/no-tools-frontmatter.test.mjs`), no `context-memory`, no `mcpServers`, every scalar containing `: ` quoted (`bin/frontmatter-strict.test.mjs`), `metadata.authors` present, `SOUL.md` sibling. Body sections in this order: `## Tool-call economy` (verbatim from `bundles/feature-development/agents/tech-lead/AGENT.md`), `## Rules` (the four §4 rules), `## Contracts` (per dispatch type: inputs, what to read, what to write, the exact return line — grammars in TASK-036), `## Writable paths self-check`, `## Never`.

**Reviewer contract return lines (closed grammar, TASK-036):**

| Contract | Packet kind | Writes (payload-only, under `<st>/receipts/<run_id>/`) | Return line |
|---|---|---|---|
| `review` | scope | `claims-<n>.json` `{scope_sha256, packet_sha256, findings[]}` and `examined-<n>.json` `{packet_sha256, declared[]}` — **no receipt** (P1) | `CLAIMS <claims path> EXAMINED <examined path> findings=<n> read=<n files>` |
| `vulnerability-review` | subject | `receipt-<subject_id>.json` `{type: vulnerability-review, subject_id, packet_sha256, assertion: confirmed|refuted|indeterminate, reviewer_run_id}` | `RECEIPT <path> type=vulnerability-review subject=<id> assertion=<a>` |
| `mitigation-review` | subject | same with `assertion: confirmed|gap|indeterminate` | `RECEIPT <path> type=mitigation-review subject=<id> assertion=<a>` |
| `fix-review` | subject (built by `verify all` from the worktree) | same with `assertion: not-refound|refound|indeterminate`; plus zero or more `ack-<indicator_id>.json` `{type: ack, subject_id, packet_sha256, assertion: {indicator_id}, reviewer_run_id}` | `RECEIPT <path> type=fix-review subject=<id> assertion=<a> acks=<n>` |

The lead runs `evidence.mjs receipt validate --run <id> <path>` (or `gate --claims` / `coverage --examined`) on what comes back; the agent never runs the admitting command on its own output.

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

**Skill resolution at each milestone** (`bin/init.mjs planFactory`: extra skills = `factory.skills ∪ skills:/skills-on-demand: of every installed agent`, minus `localSkills`):

| Milestone | Resolved from monorepo `skills/` | Resolved via item index (another bundle's copy) | External (cache) |
|---|---|---|---|
| M1 (roster: security-reviewer) | `memory`, `knowledge-curation` | — | `systematic-debugging` |
| M3 (+ security-lead, threat-modeler) | + `verifying-outcomes`, `gathering-context`, `deep-research` | `issue-tracking` → `bundles/feature-development/skills/issue-tracking` | + `dispatching-parallel-agents` |

This is why US-030 AC-1's `verifying-outcomes` / `issue-tracking` assertions are made in TASK-048's E2E extension, not in TASK-038: at M1 no installed item declares them, so an M1 install never requests them and there is nothing true to assert.

---

## 5. Technical tasks

Format: **Story · Assigned · Depends on · Complexity** then Objective / Implementation / Interface Contract / Verification. Verification lists the `*.test.mjs` cases each task must make pass; titles quoted from spec §12 where the spec names the case. Every task runs `npm test` green before PR; tasks touching a manifest, `FACTORY.md`, `SKILL.md`, `AGENT.md` or generated marketplaces also run `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes`.

### G0

#### TASK-001: Repo docs match the installer
**Story:** US-001 · **Assigned:** maintainer / js-dev · **Depends on:** none · **Complexity:** S

**Objective.** Land the M-1 doc-fix PR on its own branch before any M1 code.

**Implementation.**
- `CLAUDE.md`, `bundles/SPEC.md` (and `AGENTS.md`/`README.md` only where they repeat a path): every `factories/<id>` / `factories/SPEC.md` / `factories/*/skills` path → `bundles/…`. Keep `--factory`, `factory.json`, `FACTORY.md`, `validate:factories` names.
- `hooks/config.sh.example`: commented default `SDLC_ROLE_MEMORY_FILES` → `SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md` (matches `hooks/lib.sh`).
- `CLAUDE.md` § Commands: `npm run validate` = `validate:factories && validate:marketplaces && validate:externals && validate:dupes`; note `validate:externals` needs network.
- `.github/workflows/validate.yml`: the `skills-ref` glob `factories/*/skills/*/` → `bundles/*/skills/*/` (otherwise no bundle SKILL.md is validated in CI and every later "skills-ref passes (CI)" check is vacuous). US-001 AC-4's "touches only listed files" is relaxed to include this workflow.

**Interface Contract.** Docs only.

**Verification.**
- [ ] `grep -n "factories/" CLAUDE.md bundles/SPEC.md` returns zero path occurrences.
- [ ] `npm run validate:factories && npm run validate:marketplaces && npm test` exit 0; `git diff --stat` touches only the listed files.

#### TASK-055: Hook-input probe result
**Story:** US-049 · **Assigned:** maintainer · **Depends on:** none · **Complexity:** S

**Implementation.** `bundles/security-testing/tools/probe-hook-input.mjs` prints received hook-input fields with no side effects; `bundles/security-testing/NOTES.md` records per-host identity fields and trust, and states v1 ships no bundle hooks (D4). Lands with or after TASK-037 (the directory must carry `factory.json` before the validator sees it; until then the files sit on the task branch).

**Verification.**
- [ ] `NOTES.md` has one row per host (`claude`, `cursor`, `codex`, `copilot`) with the fields observed; the probe script has no `writeFileSync`/`spawn` call.

### G1

#### TASK-003: `normalize.mjs` + published test vectors
**Story:** US-002 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** S

**Objective.** Text normalisation used by `gate`, `cite` and `coverage`, with the vectors shipped as a reference file.

**Implementation.** `scripts/normalize.mjs` (`TextDecoder("utf-8", {fatal: true})`, strip BOM, `\r\n|\r → \n`, NFC, per line collapse `[\p{Zs}\t]+` → one space and trim, drop empty lines — the only line removal); `references/normalize-vectors.json` `[{name, input_base64, expected_lines}]` covering BOM, CR, CRLF, tab runs, ` `, empty lines, invalid UTF-8; `scripts/normalize.test.mjs` iterates the vectors.

**Interface Contract.** `normalizeText(buf) → {lines, text}`; throws `EncodingError`.

**Verification.**
- [ ] `normalize.test.mjs: "every published vector matches"` (US-002 AC-5), `"invalid UTF-8 rejected"`, `"newlines preserved; only empty lines removed"`.

#### TASK-004: `redact.mjs` + `redaction-rules.json` v1
**Story:** US-003 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** M

**Objective.** The one redaction function every writer calls, with a versioned rule list. Lands before `canon.mjs` because `writeArtifact` calls it.

**Implementation.** `references/redaction-rules.json` (`redaction_version: 1`, classes `aws-key gcp-key azure-key jwt pem-block password-assign token-assign secret-assign bearer high-entropy-assign`, each a JS-regex source + flags; `password=1234` must match `password-assign`; replacement `<REDACTED:<class>>`); `scripts/redact.mjs` exporting `loadRules`, `DEFAULT_RULES` (loaded once from `RULES_PATH`), `redactString`, `redactDeep` (recurses objects/arrays; leaves numbers/booleans/null; redacts object **keys** too; returns the input object untouched by reference when nothing matched, so `canonical()` sees the same bytes), `matches`; a `Buffer` input is scanned as UTF-8 text with `latin1` fallback; `scripts/redact.test.mjs`. No import from any other `scripts/` module (leaf module).

**Interface Contract.** §3.3 row. `redactDeep` is idempotent (`redactDeep(redactDeep(x))` deep-equals `redactDeep(x)`).

**Verification.**
- [ ] `redact.test.mjs: "redaction inside nested SARIF strings and rejection reasons"` — nested object with `password=1234` in a `message.text`, a `reason` and a log line ⇒ no occurrence after `redactDeep` (US-003 AC-1).
- [ ] `redact.test.mjs: "rules file carries redaction_version"`, `"matches() true for password=1234 and false for benign text"`, `"idempotent"`, `"JWT, PEM block, bearer header, AWS key shape redacted"`, `"leaf module: imports only node:fs/node:path/node:url"`.

#### TASK-005: JSON schemas + `lib/schema.mjs` validator subset
**Story:** US-002 AC-4, US-015 AC-7, US-021 AC-2 · **Assigned:** js-dev · **Depends on:** TASK-001 · **Complexity:** L

**Objective.** Every schema file, plus a stdlib validator that understands exactly the subset they use. **The shapes below are the contract**; no other document restates them. Notation: `?` = optional key; `enum(a|b)`; `int`; `sha256` = 64-hex string; `oid` = 40-hex; `hmac` = 64-hex; `range` = `[int start ≥ 1, int end ≥ start]`; `[]` = array of.

**Implementation.** `references/<name>.schema.json` for every shape below; `scripts/lib/schema.mjs` supporting `type` (object/array/string/integer/boolean/null), `required`, `properties`, `additionalProperties:false`, `enum`, `const`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`, `pattern`, `oneOf` (exactly-one), `$ref` to `#/$defs/*` only — any other keyword ⇒ the validator throws (fail loud); `scripts/lib/schema.test.mjs`.

```
envelope            {schema_version: int (const 1), kind: enum(<§4.1 kind list>), run_id: string, engagement_id: string,
                     key_id: string, created_at: string (ISO-8601), self_sha256: sha256}
run                 {engagement_id, seq: int, base_oid: oid, head_oid: oid, template: enum(assessment|review|verify|threat-model)}
engagement          {engagement_id: string, slug: string (^[a-z0-9-]+$), scope_paths: [string], product_paths: [string],
                     targets: {tracker: [host], browser: [host], repo: string},
                     base_url?: string,
                     execute_project_tests?: {argv: [string] (minItems 1), timeout_s?: int, install?: {argv: [string], allow_tracked_changes?: bool}},
                     sign_off?: {require_dispositions: enum(all|executed-or-ticketed|none)},
                     artifact_policy?: {ledger?|runs?|receipts?|proposals?|handoffs?|imports?|register?|reports?|cases?: enum(local|committed)}}
                    (host = string matching ^[a-z0-9.-]+(:[0-9]+)?$ — no scheme, no path)
scope               {files: [{path, side: enum(head|snapshot), oid: oid|sha256, file_hmac: hmac, lines: int}],
                     ranges: {<path>: [range]},   ← the one object with dynamic keys; declared via patternProperties on "^.+$"
                     skipped: [{path, reason: enum(binary|too-large|symlink|submodule|unreadable)}],
                     snapshot?: {<path>: {original_hmac: hmac, redacted_sha256: sha256, redaction_version: int}}}
examined            {packet_sha256: sha256, declared: [{path, ranges: [range]}]}
claimed  (ClaimSet, in finding.schema.json $defs)
                    {scope_sha256, packet_sha256, findings: [Claim]}
Claim               = Finding minus {id, state, occurrence, source} plus occurrence_hint?: int   (a Claim carrying id/state ⇒ gate reject `agent-wrote-id`)
Finding             {id: sha256, title: string, class: enum(injection|xss|ssrf|path-traversal|deserialization|auth|authz|crypto|secret|
                       input-validation|config|logging|dos|supply-chain|unmapped),
                     priority: enum(p0|p1|p2|p3), confidence: int 0..10, path: string, side: enum(base|head|snapshot),
                     lines: range, state: enum(CITATION_VERIFIED|CITATION_FAILED), occurrence: int ≥ 0,
                     source: {kind: enum(agent|sarif), ref: sha256 (claims file sha256 | import_sha256), index: int},
                     snippet?: string | snippet_redacted?: string | context_redacted?: string   (exactly one, enforced by oneOf),
                     sensitive?: bool, cwe?: string (^CWE-[0-9]+$),
                     citations_typed?: [{role: enum(source|sink|control), path, side: enum(base|head|snapshot), lines: range, context: bool}],
                     requires_typed_citations?: bool,
                     description?, impact?, prerequisites?, remediation?: string}
findings.claimed.json payload  {scope_sha256, findings: [Finding]}
gate-result         {accepted: [sha256], unverifiable: [sha256], rejected_counts: {<reason>: int}, scope_sha256, claimed_sha256}
rejects             {rejected: [{reason: string, locator: {import_sha256?: sha256, claims_sha256?: sha256, index: int}}]}
unlocated           {candidates: [{locator: {import_sha256, index}, reason: enum(no-location|out-of-scope|unadmitted-case), tool?: string, rule_id?: string}]}
coverage            {accounting: [{path, range, status: enum(examined|skipped|scanner-only|unexamined), by: [string]}],
                     scanner_rows: [{tool, version, import_sha256, paths: [string]}], scope_sha256, examined_sha256, indeterminate: bool}
packet              {kind: enum(scope|subject), subject_ids: [string] (scope ⇒ maxItems 0; subject ⇒ minItems 1),
                     files: [{path, side: enum(base|head|snapshot), oid: oid|sha256, ranges: [range], range_hmac: hmac}], policy_sha256: sha256}
receipt             oneOf [
                      {type: const "vulnerability-review", subject_id, packet_sha256, assertion: enum(confirmed|refuted|indeterminate), reviewer_run_id},
                      {type: const "mitigation-review",    subject_id, packet_sha256, assertion: enum(confirmed|gap|indeterminate),     reviewer_run_id},
                      {type: const "fix-review",           subject_id, packet_sha256, assertion: enum(not-refound|refound|indeterminate), reviewer_run_id},
                      {type: const "ack",                  subject_id, packet_sha256, assertion: {indicator_id: sha256},               reviewer_run_id} ]
                    forbidden keys anywhere (checked explicitly, error names the key): state, verdict, id, gate, gate_stamp, states
verify              {finding_id: sha256, base_oid, head_oid,
                     branch: enum(COMMITTED|NOT-COMMITTED|PATH-UNTOUCHED), tree_before: oid,
                     install: {ran: bool, argv_sha256?: sha256, allow_tracked_changes: bool, tracked_changes: [string], untracked_count: int, untracked_bytes: int},
                     tested_tree: hmac | const "same-as-head",
                     suppression: {indicators: [{id: sha256, kind: enum(ignore-file-edit|inline-suppress|test-skip), path, line: int, sensitive?: bool}], deletion_only: bool},
                     tests: {result: enum(TESTS_PASS|TESTS_FAIL|NO_TEST_SURFACE|TESTS_INDETERMINATE), reason?: string, argv_sha256?: sha256,
                             executable_path?: string, executable_sha256?: sha256, exit_code?: int, timed_out: bool, output_redacted: string},
                     packet_sha256: sha256,
                     receipts: [{sha256, type: enum(fix-review|ack), assertion?: string, indicator_id?: sha256, applied: bool, not_applied_reason?: string}],
                     row_status_at_start: enum(open|accepted|fixed|regressed|false-positive|superseded|none),
                     evaluation: {verdict: string (pattern below), refound_observed: bool, ack_refs: [sha256], events: [{event: enum(regression-observed), payload: {}}]}}
                    verdict pattern: ^(VERIFIED|REGRESSED|UNVERIFIED-REFOUND|UNVERIFIED-NOT-COMMITTED|UNVERIFIED-TESTS-FAILED|
                      UNVERIFIED-NO-TEST-SURFACE|UNVERIFIED-INDETERMINATE\([a-z-]+\)|UNVERIFIED-SUPPRESSION\((deletion-only|[0-9]+ unacked)\))$
```
```
run-manifest        {inputs: {<kind>: sha256}, report_sha256, template: enum(assessment|review|verify|threat-model), template_version: int, tool_version: string}
                    (set inputs — packets, receipts, ingest, verify-snapshots — are sha256(canonical(sorted member hashes)))
export-manifest     {source_manifest_sha256, profile: enum(redacted-report|full-report|tracker|handoff|case), profile_version: int, output_sha256: sha256}
imports-index       {imports: [{kind: string, import_sha256, original_hmac}]}                       ← written `{imports: []}` by run init (assessment)
observations-index  {observations: [{observation_id: string, sha256}]}                                ← written `{observations: []}` by run init
proposals-index     {proposals: [{id: string, sha256, path: string}]}                                 ← written `{proposals: []}` by run init
register-snapshot   {engagement_id, seq: int, chain_sha256: sha256, events: [register-event]}
import  (the ingest/<sha>.json record)
                    {kind: enum(sarif|ticket|pr|doc|case|audit|qa-run|ta-report|tracker-readback), import_sha256, original_hmac, redaction_version: int,
                     mapping_version: string, source_path: string, records: [Record], unlocated: [unlocated.candidates item], rejected: [rejects.rejected item]}
Record              {locator: {import_sha256, original_hmac, index: int}, trusted: {…adapter-specific, closed per adapter in TASK-016/017/018}, inert: {…: string}}
register (projection) {engagement_id, seq: int, chain_sha256, rows: {<R-id>: Row}}   (patternProperties ^R-[0-9]{4}$)
Row                 {id, subject: string, subject_kind: enum(finding|threat), title, status: enum(open|accepted|fixed|regressed|false-positive|superseded),
                     priority: enum(p0|p1|p2|p3), owner: string, first_seen_run, last_verified_run: string, ticket_url: string,
                     test_refs: [string], proposal_refs: [string], acceptance?: Approval & {until: string}, false_positive?: Approval,
                     ack_refs: [sha256], rationale: string, supersedes: string, superseded_by: string}
Approval            {recorded_by: string, approved_by: string, approval_ref: string, authenticated: const false}
register-event      {seq: int, prev_sha256: sha256, ts: string, actor: string, row_id: string,
                     event: enum(add|accept|revoke|acceptance-expired|fixed|regressed|close-false-positive|reopen|supersede|ticketed|regression-observed|verify-observed|alias),
                     payload: object, ref: string}
finding-alias       {from_id: sha256, to_id: sha256, reason: string, run_id: string, seq: int, prev_sha256: sha256}
threat-model        {elements: [{id: string (^E-[0-9]{3}$), kind: enum(process|datastore|external|flow|boundary), name: string,
                                 citation: {path, side: enum(base|head), lines: range}}],
                     threats: [{id: string (^T-[0-9]{3}$), element_id, stride: enum(S|T|R|I|D|E), title: string,
                                mitigations: [{id: string (^M-[0-9]{3}$), claim: string, citation?: {path, side, lines: range}}],
                                disposition: {kind: enum(undisposed|planned|executed|ticketed|accepted|mitigated), ref?: string}}]}
dispositions        {dispositions: [{threat_id, kind: enum(as above), ref: string, resolved_via: enum(proposal|admission|observation|tracker-readback|register-row|receipt|none)}]}
proposal (frontmatter) {id: string (^P-[0-9]{3}$), title, threat_ids: [string], effect: string, target: {host, account?},
                     authorization: {status: const "proposed", approver: string, approval_ref: string, authenticated: const false}, steps: [string]}
admission           {case_sha256, classification: enum(admitted-heuristic|admitted-reviewed|proposal), lint_hits: [{rule: string, step: int, text_redacted: string}],
                     assumptions: {base_url_host: string, account: string}, target_policy_sha256: sha256, receipt_sha256?: sha256 (required iff admitted-reviewed)}
observation         {observation_id: string (^O-[0-9a-f]{12}$), import_sha256, case_id: string, case_sha256: sha256,
                     result: enum(PASS|FAIL|BLOCKED|unknown), run_id: string, base_url: string, account: string, head_oid: string}   (unknowns are the string "unknown")
baseline            {engagement_id, head_oid: oid, index_sha256: sha256, entries: {<path>: hmac}, ignored_count: {<path>: int}}
citation-record     {claimed_hmac: hmac, source_hmac: hmac, match: bool, side: enum(base|head|snapshot), oid: oid|sha256, redaction_version: int}
sarif-mapping.v1    {version: const "v1", tools: {<name>: {confidence: int 0..10, rule_prefix_class: {<prefix>: class}}}, tag_class: {<tag>: class},
                     level_priority: {error: "p1", warning: "p2", note: "p3"}, default_confidence: int}
redaction-rules     {redaction_version: int, rules: [{class: enum(<ten classes of TASK-004>), pattern: string, flags: string, replacement: string}]}
packet-policy.v1    {version: const 1, max_range: const 40, sides: [enum(base|head|snapshot)], typed_citation_rule: const "context-allowed-outside-admitted", redaction_version: int}
```

**Interface Contract.** `validate(schemaName, value) → string[]` (empty = valid). The `receipt` forbidden keys are enforced by `additionalProperties:false` **plus** an explicit `forbiddenKeys(value) → string[]` export used by `receipt validate` so the error names the key.

**Verification.**
- [ ] `schema.test.mjs: "preimage table honoured"` — for each of `run, scope, gate-result, coverage, packet, receipt, run-manifest` the schema's required payload keys equal the §6.1 row of the spec (US-002 AC-4).
- [ ] `schema.test.mjs: "no schema declares number; integers only"`, `"no schema has authenticated:true or the word confirmed outside the receipt/threat enums"` (US-021 AC-2), `"receipt schema rejects state/verdict/id/gate fields and forbiddenKeys names them"` (US-015 AC-7), `"packet kind scope requires empty subject_ids; subject requires ≥1"`, `"finding: exactly one of snippet/snippet_redacted/context_redacted"`, `"engagement: artifact_policy.private is rejected"`, `"every shape above has a fixture that validates and a mutated fixture that fails"` (table-driven over `scripts/fixtures/schemas/<name>.{ok,bad}.json`).
- [ ] `schema.test.mjs: "unsupported keyword throws"`.

#### TASK-056: Offline external-cache harness (fixture builder)
**Story:** US-030 AC-1 (mechanism), US-029 AC-7 · **Assigned:** qa-engineer · **Depends on:** TASK-001 · **Complexity:** M

**Objective.** One reusable helper that lets any test run `bin/init.mjs` with no network, so TASK-037's manifest test and TASK-038's E2E share it (and SPIKE-001's findings are frozen in code).

**Implementation.** `scripts/fixtures/offline/harness.mjs` exporting `createOfflineInstall({externals: [{id, repo, subdir, files}]}) → {cacheDir, gitConfigGlobal, env, cleanup()}`: for each external, `git init --bare` a fixture remote under a temp dir with `<subdir>/SKILL.md` committed on `main`, then `git clone` (not copy) it into `<cacheDir>/sdlc-skills/registry/<repo.replace("/", "__")>` so the installer's `.git`-exists branch takes the `git fetch --depth 1 origin <ref>` path; write a `GIT_CONFIG_GLOBAL` file with `[url "/nonexistent/"] insteadOf = https://github.com/`; return `env = {SDLC_SKILLS_CACHE_DIR, GIT_CONFIG_GLOBAL, HOME: <temp>}`. Also `runInstaller({env, args, cwd}) → {code, stdout, stderr}` (`execFile node bin/init.mjs …`, shell:false) and `assertNoNetwork(stdout+stderr)` (fails on `https://` in any git error). `scripts/fixtures/offline/harness.test.mjs` proves it against the real `bin/init.mjs` with `--skills systematic-debugging` (registry id; no bundle needed yet).

**Interface Contract.** As above; every path returned is absolute; `cleanup()` removes everything including the worktree the installer wrote.

**Verification.**
- [ ] `harness.test.mjs: "installer fetches systematic-debugging from the local bare remote, no https fetch"`, `"a real GitHub URL fails under the rewrite"` (SPIKE-001 replay), `"cleanup leaves no temp dirs"`.

### G2

#### TASK-002: `canon.mjs` — strict reader, canonical bytes, envelope, artifact I/O
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** TASK-001, **TASK-004** · **Complexity:** M

**Objective.** One module every writer and reader uses for identity: canonical bytes, sha256/HMAC, envelope construction, redacting tmp+rename writes, verified reads.

**Implementation.**
- `scripts/canon.mjs`: a hand-written recursive-descent JSON reader (`JSON.parse` cannot see duplicate keys) that throws `CanonError("duplicate key <k>")`, `CanonError("float not allowed")` for any number token containing `. e E` or outside `Number.isSafeInteger`; `canonical(value)`: NFC every string, sort keys bytewise (compare UTF-8 byte arrays, not JS string order), no whitespace, LF only, `\u` escapes only for control chars; `makeEnvelope({schema_version, kind, run_id, engagement_id, key_id, now}, payload) → {envelope, payload}` (`schema_version` is a **required** argument, never defaulted, so a bump is a deliberate edit at every call site; `created_at = now()`; `self_sha256 = artifactId(payload)`); `artifactId = sha256Hex(canonical(payload))`; `writeArtifact(path, artifact, {prered})` — unless `prered: true`, `payload = redactDeep(payload, DEFAULT_RULES)` from `redact.mjs` **before** `self_sha256` is computed (so the identity is over the redacted payload, G-4), validates no float/undefined, writes tmp+rename; `readArtifact` recomputes and compares `self_sha256`; throws `IntegrityError(path)`.
- `scripts/canon.test.mjs`.

**Interface Contract.** §3.3 row `canon.mjs`. Artifact = `{envelope, payload}`; `envelope.self_sha256 === artifactId(payload)`; envelope never hashed. `canon.mjs` imports only `redact.mjs` and `node:*`.

**Verification.**
- [ ] `canon.test.mjs: "scope identity independent of envelope"` — same payload, different `created_at`/`run_id` ⇒ equal `self_sha256` (US-002 AC-2).
- [ ] `canon.test.mjs: "duplicate key rejected on read"`, `"float rejected"`, `"non-NFC string normalised"`, `"CRLF in input yields LF-only canonical bytes"`, `"keys sorted bytewise not by locale"` (US-002 AC-3).
- [ ] `canon.test.mjs: "readArtifact throws IntegrityError on tampered payload"`, `"writeArtifact redacts password=1234 in a nested payload string and self_sha256 is over the redacted payload"`, `"prered:true skips redaction"`, `"makeEnvelope without schema_version throws"`.

### G3

#### TASK-006: Script skeleton — dispatchers, `ctx`, `git`, `fsx`, `exit`, `tokens`, `version.json`, stubs for all five CLIs
**Story:** US-002 AC-1, US-030 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-002, **TASK-005** · **Complexity:** M

**Objective.** The five entry points exist, share one context and one exit-code map, and every later task only adds a `cmd-*.mjs` file plus one dispatch line and one `tokens.mjs` row.

**Implementation.** `scripts/evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`, `plan.mjs` (parse global flags → `createContext` → route to `lib/cmd-<name>.mjs` → `process.exitCode`; unknown command ⇒ usage + `2`; uncaught ⇒ redacted message on stderr + `1`); `scripts/version.json` `{"tool_version": "1.0.0"}` (P5; `ctx.toolVersion()` reads it — the only reader); `lib/ctx.mjs`, `lib/exit.mjs`, `lib/tokens.mjs` (initial rows), `lib/git.mjs` (every function `execFileSync("git", [...])` with `cwd: root`, never a shell), `lib/fsx.mjs` (`withLock` = `mkdirSync(lockDir)` loop with 20 ms backoff, 10 s timeout, stale-lock detection by mtime > 60 s); each with sibling tests. `tm-lint.mjs check|render` and `plan.mjs admit|propose|ta-prompt` are registered, validate their argv and — where an input file is given — validate it against the TASK-005 `threat-model` / `proposal` schema, then return `2 NOT-IMPLEMENTED(M2|M3)`.

**Interface Contract.** §3.1 process contract; `ctx` shape in §3.3; `version.json` is the single source of `tool_version` (TASK-023 writes it into the manifest; TASK-037 asserts SKILL.md `metadata.version` equals it).

**Verification.**
- [ ] `evidence.test.mjs / verify.test.mjs / register.test.mjs / tm-lint.test.mjs / plan.test.mjs: "no command ⇒ usage, exit 2"`, `"--help ⇒ exit 0"`, `"unknown command ⇒ exit 2"` (incl. `register.mjs confirm` ⇒ 2, US-021 AC-2), `"tm-lint check on a schema-invalid model ⇒ exit 2 naming the schema error before NOT-IMPLEMENTED"`.
- [ ] `git.test.mjs: "every child process is spawned with shell:false and an argv array"` (grep-based guard over `scripts/**/*.mjs`: no `exec(`, no `shell: true`, no `execSync(` with a string).
- [ ] `fsx.test.mjs: "withLock serialises two writers"`, `"writeExclusive fails when the file exists"`, `"writeAtomic leaves no tmp file"`.
- [ ] `ctx.test.mjs: "SECURITY_EVIDENCE_NOW fixes now()"`, `"outside a git work tree ⇒ CliError 2"`, `"toolVersion() reads version.json and it has exactly one key"`.

#### TASK-007: Engagement record parser + knowledge templates (source files)
**Story:** US-007, US-029 AC-7 · **Assigned:** js-dev · **Depends on:** TASK-002, TASK-005 · **Complexity:** S

**Objective.** The `engagement.md` machine record (TL-5) and the three knowledge files that both the factory `seed` and `engagement init` step 0 install.

**Implementation.** `bundles/security-testing/knowledge/engagement.md.template` (prose + example ```` ```json engagement ```` block carrying every key of the TASK-005 `engagement` shape, `require_dispositions: executed-or-ticketed` as the documented default, an `artifact_policy` example with every key `local`), `knowledge/finding-schema.md` (human rendering of the `Finding` shape + the state/verdict token table), `knowledge/report-reading-guide.md` (how to read `check` output and the ORIGIN line); byte-identical copies under `skills/security-evidence/templates/knowledge/` (the standalone install has no `seed`), paired in `bin/check-skill-dupes.mjs` `GROUPS` as `["bundles/security-testing/knowledge/<f>", "bundles/security-testing/skills/security-evidence/templates/knowledge/<f>"]` ×3; `scripts/lib/engagement.mjs` (`parseEngagementMd`: find the fenced block tagged `json engagement`, parse with `canon.parseStrict`, validate against `engagement` schema, reject `artifact_policy.private`); `scripts/lib/engagement.test.mjs`.

**Interface Contract.** `parseEngagementMd(text) → record` throws `CliError(2, "ENGAGEMENT-INVALID(<error>)")`; `ctx.engagement()` reads `<st>/engagement.md` and throws `CliError(2, "ENGAGEMENT-MISSING")` when absent.

**Verification.**
- [ ] `engagement.test.mjs: "template parses and validates"`, `"duplicate key in block rejected"`, `"missing block ⇒ ENGAGEMENT-INVALID"`, `"targets hosts must be bare hostnames"`, `"artifact_policy.private ⇒ POLICY-INVALID(private)"`; `npm run validate:dupes` passes with the three new groups.

#### TASK-026: `verify.mjs evaluate` — pure verdict function + enveloped `verify.json` fixtures
**Story:** US-019, US-022 (fixtures) · **Assigned:** js-dev · **Depends on:** TASK-002, TASK-005 · **Complexity:** M

**Objective.** The evaluator, implemented before `verify all` so the verdict fixtures are locked early, `check` can reuse it, and `consume-verdict` (TASK-030) can be tested against real enveloped `verify.json` artifacts before `verify all` exists.

**Implementation.** `scripts/lib/evaluate.mjs` implementing §6.4 step 7 precedence exactly: (1) `refound_observed = (a receipt of type fix-review with applied === true and assertion === "refound" exists)`; if `refound_observed && row_status_at_start === "fixed"` push event `regression-observed` **before anything else**; (2) completeness — any of `branch, tests, suppression, packet_sha256` missing/malformed, or `tests.result === TESTS_INDETERMINATE` ⇒ `UNVERIFIED-INDETERMINATE(<check>)` (tests unavailable ⇒ `(tests)`); (3) `refound_observed` ⇒ `REGRESSED` if row `fixed` else `UNVERIFIED-REFOUND`; (4) fix-review absent / `applied: false` / assertion `indeterminate` ⇒ `UNVERIFIED-INDETERMINATE(fix-review)`; (5) `branch ≠ COMMITTED` ⇒ `UNVERIFIED-NOT-COMMITTED`; (6) `TESTS_FAIL` ⇒ `UNVERIFIED-TESTS-FAILED`, `NO_TEST_SURFACE` ⇒ `UNVERIFIED-NO-TEST-SURFACE`; (7) `deletion_only` ⇒ `UNVERIFIED-SUPPRESSION(deletion-only)`; (8) unacked indicators (ack must match `indicator_id` **and** `packet_sha256` and be `applied`) ⇒ `UNVERIFIED-SUPPRESSION(<n> unacked)`; (9) `VERIFIED` with `ack_refs[]`. `lib/cmd-evaluate.mjs` reads a file or `--raw`. Fixtures: `scripts/fixtures/evaluate/<rule>.raw.json` (one per rule) **and** `scripts/fixtures/verify/build.mjs` which envelopes each raw fixture into a full `verify.json` artifact via `canon.makeEnvelope` (`kind: verify`, `run_id` `deadbeef0000-0001`…) with `evaluation` filled by `evaluate()` — these are what TASK-030 and TASK-025 consume.

**Interface Contract.** `evaluate(raw) → {verdict, refound_observed, ack_refs, events}`; raw shape = `verify` payload minus `evaluation` (TASK-005). Deterministic; no I/O.

**Verification.**
- [ ] `evaluate.test.mjs: "valid refound + unavailable tests ⇒ UNVERIFIED-INDETERMINATE(tests) and regression-observed event"` (§12).
- [ ] `evaluate.test.mjs: "refound receipt with applied:false ⇒ refound_observed false, UNVERIFIED-INDETERMINATE(fix-review), no event"` (§6.4 P5 fixture `refound-not-applied`).
- [ ] `evaluate.test.mjs: "two indicators with one ACK ⇒ UNVERIFIED-SUPPRESSION(1 unacked)"`, `"indicator + deletion-only ⇒ deletion wins"`, `"ACK for a different indicator ⇒ UNVERIFIED-SUPPRESSION"`, `"ACK on a different packet does not count"`, `"ACK + TESTS_FAIL ⇒ UNVERIFIED-TESTS-FAILED"`, `"missing fix-review receipt ⇒ UNVERIFIED-INDETERMINATE(fix-review)"`, `"positive tests + indeterminate fix-review ⇒ UNVERIFIED-INDETERMINATE(fix-review)"`, `"refound with complete checks ⇒ REGRESSED when row fixed else UNVERIFIED-REFOUND"`, `"branch NOT-COMMITTED ⇒ UNVERIFIED-NOT-COMMITTED"`, `"both indicators acked and green ⇒ VERIFIED with two ack_refs"` (US-019 AC-1…AC-5).
- [ ] `evaluate.test.mjs: "pure: same input twice ⇒ deep-equal output; module imports nothing from node:fs/node:child_process"` (US-019 AC-6); `verify-fixtures.test.mjs: "every built verify.json validates against the verify schema and readArtifact accepts it"`.

### G4

#### TASK-009: HMAC key lifecycle
**Story:** US-005 AC-1…AC-3 · **Assigned:** js-dev · **Depends on:** TASK-006 · **Complexity:** S

**Objective.** Create/reuse/rotate keys per §6.5 as a module, exposed to every writer via `ctx.key()`. The pipeline step that calls it is wired in TASK-008.

**Implementation.** `scripts/lib/keys.mjs` (TL-9): `ensureKey(ctx, {rotate, engagement_id})` uses `fsx.writeExclusive(path, randomBytes(32), 0o600)`; `current` file atomic; `index.json` records `{key_id: {engagement_id, created_at}}`; `--rotate` creates a new key and repoints `current`, deletes nothing; `loadKey`, `currentKeyId`, `keysOf(ctx, engagement_id)`; `ctx.key()` returns `{key_id, bytes}` of `current` or `null`; `ctx.keyById(id)`.

**Interface Contract.** `hmacHex(ctx.key().bytes, buf)`; every envelope's `key_id = ctx.key().key_id`.

**Verification.**
- [ ] `keys.test.mjs: "ensureKey twice reuses the key, rotate adds one"` (§12 "repeated engagement init reuses the key, --rotate adds one" — asserted at pipeline level again in TASK-008; US-005 AC-1…AC-3 incl. mode 0600 and `wx` flag), `"keysOf returns only that engagement's keys"`, `"artifacts written after rotate record the new key_id"`.

#### TASK-011: `engagement init` step 0 — knowledge templates + `engagement.md` template copy + `EDIT-ENGAGEMENT-AND-RERUN`
**Story:** US-007 AC-1, AC-2 · **Assigned:** js-dev · **Depends on:** TASK-006, TASK-007 · **Complexity:** S

**Objective.** The two-skill install gets the templates without a `seed`, and a first `engagement init` on a bare repo stops after writing them (P3).

**Implementation.** `scripts/lib/knowledge-templates.mjs`: `ensureTemplates(ctx)` reads the copies shipped under the skill (`templates/knowledge/`, TASK-007) and writes each into `<st>/knowledge/` only when that file is absent (existing wins, per file); `ensureEngagementMd(ctx)` copies `engagement.md.template` to `<st>/engagement.md` when absent and returns `{written: true}`. Exposed as `stepTemplates(ctx) → {templates: written|present, engagement: present|template-written}`; when `engagement: template-written` the pipeline (TASK-008) prints `TEMPLATES: …`, `ENGAGEMENT: template written — edit and re-run`, and exits `2 EDIT-ENGAGEMENT-AND-RERUN` with nothing else done.

**Interface Contract.** After step 0, `<st>/knowledge/{engagement.md.template, finding-schema.md, report-reading-guide.md}` exist. Step 0 never touches `.gitignore`, keys or the baseline.

**Verification.**
- [ ] `knowledge-templates.test.mjs: "absent ⇒ written"`, `"present and locally edited ⇒ untouched"` (US-007 AC-1, AC-2), `"engagement.md absent ⇒ template copied and template-written returned; present ⇒ present"`.

#### TASK-028: `register.mjs` core — chained log, replay, recovery, anchor
**Story:** US-020 · **Assigned:** js-dev · **Depends on:** TASK-002, TASK-005, TASK-006 · **Complexity:** L

**Objective.** The append-only register with rebuild-vs-corrupt recovery and an anchor, at `<st>/register/`.

**Implementation.** `scripts/lib/register-core.mjs`: `openRegister(ctx)` (create dirs; run the recovery rule on every open), `append(ctx, {row_id, event, payload, ref})` (under `register/lock/`: `seq = last+1`, `prev_sha256`, `ts = ctx.now()`, `actor`, one `appendLine` of the canonical JSON row, then `replay` and `writeAtomic(projection.json)`), `replay(events)` (pure fold; uses `register-transitions.applyTransition` once TASK-029 lands — until then a minimal fold for `add` only, replaced in 029), `verifyChain(events)`, `anchor(projection) → "<eid>:<seq>:<chain>"`, `anchorVerify(projection, expect)`, `readEvents(ctx) → events[]` (what `run snapshot register` copies); `lib/cmd-register-*.mjs` for `replay`, `status`, `anchor`; tests.

**Interface Contract.** §4.3 event shape, chain, recovery, anchor tokens. `status --json` = `{counts: {status: {priority: n}}, open_exposure: {priority: n}, unauthenticated_approvals: n, rows: {...}}`.

**Verification.**
- [ ] `register-core.test.mjs: "interrupted append ⇒ rebuild"` (US-020 AC-2), `"projection ahead of log ⇒ exit 5 CORRUPT and nothing written"`, `"prev_sha256 mismatch ⇒ CORRUPT"` (AC-3), `"truncated log + projection vs anchor verify ⇒ TRUNCATED"`, `"rewritten event ⇒ DIVERGED"`, `"anchor print then verify ⇒ MATCH"` (AC-4), `"replay is deterministic (byte-identical projections)"` (AC-5), `"append uses O_APPEND under lock; projection rewritten tmp+rename"` (AC-1, spy on `fsx`), `"register dir is created under <st>/register/"`.

### G5

#### TASK-010: Working-tree baseline
**Story:** US-006 AC-1 (+ listing consumed by TASK-033) · **Assigned:** js-dev · **Depends on:** TASK-009, TASK-007 · **Complexity:** M

**Objective.** `private/baseline.<eid>.json` and the diff function `sign-off` will use. **Requires an existing, valid `engagement.md`** (its `scope_paths`/`product_paths` define the observed set); the pipeline guarantees this because step 0 exits before step 4 when it is absent.

**Implementation.** `scripts/lib/baseline.mjs`: `computeBaseline(ctx)` — throws `CliError(2, "ENGAGEMENT-MISSING")` without `engagement.md`; for each of `scope_paths ∪ product_paths`: tracked files (`git ls-files -z -- <p>`) and non-ignored untracked (`git ls-files -z --others --exclude-standard -- <p>`) ⇒ `entries{path → file_hmac}`; `ignored_count[p]` = count of `git ls-files -z --others --ignored --exclude-standard -- <p>`; `head_oid`; `index_sha256` = sha256 of `git ls-files -s` output (git metadata, not content); payload per TASK-005 `baseline`; `diffBaseline(ctx, baseline)`; `lib/cmd-engagement-baseline.mjs` (`engagement baseline` subcommand, atomic overwrite of `private/baseline.<eid>.json`).

**Interface Contract.** `diffBaseline(ctx, baseline) → {changed[], added[], removed[], ignored_counts{}}`.

**Verification.**
- [ ] `baseline.test.mjs: "baseline holds every tracked and non-ignored untracked file under scope and product paths with ignored_count"` (US-006 AC-1), `"dirty tracked and untracked baseline changes listed per path"` (§12), `"changed ignored product file ⇒ not a change; ignored_count reported"` (§12), `"no engagement.md ⇒ ENGAGEMENT-MISSING, nothing written"`.

#### TASK-012: `run init` + ledger + empty assessment inputs + index files
**Story:** US-008, US-016 AC-2 (P2 inputs) · **Assigned:** js-dev · **Depends on:** TASK-009, TASK-007 · **Complexity:** M

**Objective.** Allocate a run first, refuse dirty assessments, snapshot the engagement record, and give the assessment template every input it will later require — empty (P2).

**Implementation.** `scripts/lib/ledger.mjs` (`allocateRun` under `ledger/index.lock/`: read index, `seq = max+1`, write `{seq, run_id, kind}` via `writeAtomic`; `run_id` per TL-9; `withRunLock(ctx, run_id, fn)` on `ledger/<run_id>.lock/` — not under `<run>/`, see the G5 row in §6 and the `ledger.mjs` header), `scripts/lib/run-index.mjs` (`appendIndex(ctx, run_id, name, entry)` — read the index artifact, push, re-envelope, `writeAtomic`, under `withRunLock`; TL-14), `lib/cmd-run.mjs` (`init`: for `assessment` check `git status --porcelain` empty **before** allocation ⇒ `3 DIRTY-TREE`, ledger untouched; resolve `base_oid`/`head_oid` to 40-hex; create `<run>/{packets,receipts,ingest,verify-snapshots}/` and `ledger/<run_id>/imports/`; write `run.json`, `engagement.json`; **assessment only**: `imports.json` `{imports: []}`, `observations.json` `{observations: []}`, `proposals-index.json` `{proposals: []}` as enveloped artifacts of kinds `imports-index|observations-index|proposals-index`; `threat-model.json` is **not** written — its absence is the `INCOMPLETE(threat-model)` signal). `run snapshot …` is TASK-058.

**Interface Contract.** §4.1 row `run init`; `run.json` payload `{engagement_id, seq, base_oid, head_oid, template}`; `appendIndex` is the only writer that rewrites a file under `<run>/`.

**Verification.**
- [ ] `cmd-run.test.mjs: "run init allocation before inputs"` (§12; `run.json` exists, no `scope.json`, index +1), `"assessment on dirty tree refused"` (§12; exit 3, index unchanged), `"review on the same dirty tree allocates"`, `"retry allocates a new seq and rewrites nothing"`, `"two concurrent run init processes ⇒ two distinct seqs, index parses"` (US-008 AC-5), `"assessment run has the three empty index artifacts and no threat-model.json; review run has none of them"` (P2), `"appendIndex under the run lock is atomic across two processes"`.

#### TASK-029: Register transitions, approvals, supersession, aliases, `ticketed`
**Story:** US-021, US-039 AC-3 (event) · **Assigned:** js-dev · **Depends on:** TASK-028 · **Complexity:** L

**Objective.** The full §4.3 transition table (v3 §6.7 minus `confirm`, plus `ticketed`, `regression-observed`, `verify-observed`, `alias`), every approval `authenticated: false`.

**Implementation.** `scripts/lib/register-transitions.mjs` (`TRANSITIONS` exactly the §4.3 table as data `{event: {from: [...]|"any", to: <status>|"same", requires: [...flags], emitters: [...]}}`, `applyTransition(row, event, payload) → row'` pure; `ticketed` sets `ticket_url` and changes nothing else), `lib/cmd-register-transition.mjs` (+ verb aliases `add accept revoke check close-false-positive reopen supersede alias`; the generic `transition` verb **refuses** `ticketed`, `regression-observed`, `verify-observed`, `fixed`, `regressed` with exit 2 `EMITTER-ONLY(<event>)` — those are appended only by `ingest tracker-readback` and `consume-verdict` through `register-core.append` directly), `finding-alias.jsonl` chained like events; supersession guards per §6.8 including `--transfer-exposure` ordering; `status` counts approvals into one bucket and never reduces `open_exposure`; `register-core.replay` switched to `applyTransition`.

**Interface Contract.** §4.3 verbs, flags and table; approval record `{recorded_by, approved_by, approval_ref, authenticated: false}` (+`until` for acceptances).

**Verification.**
- [ ] `register-transitions.test.mjs: "transition table — every allowed (event, from) pair succeeds and every other pair is rejected with TRANSITION-REJECTED"` (US-021 AC-1, table-driven over the full status × event product), `"ticketed on every status sets ticket_url and keeps the status"`, `"transition verb refuses emitter-only events"`.
- [ ] `register.test.mjs: "confirm is an unknown command (exit 2)"` (AC-2); `"accept without both flags rejected"` (AC-3); `"approval record shape has authenticated:false"`.
- [ ] `register-transitions.test.mjs: "accepted row counts in unauthenticated bucket; open exposure unchanged"` (AC-4), `"supersede without equivalence or transfer rejected"` (§12), `"supersede cycle rejected"`, `"--transfer-exposure raises priority to max and sets open when source open|regressed"`, `"alias link satisfies --subject-equivalent and changes no status"` (AC-5, AC-6), `"check expires acceptance past until (UTC, exclusive)"`.

### G6

#### TASK-008: `engagement init` pipeline (steps 0–4), managed ignore block, fail-closed, `engagement validate`
**Story:** US-004, US-005 AC-1…AC-3 (pipeline level), US-007 AC-2 · **Assigned:** js-dev · **Depends on:** TASK-009, TASK-010, TASK-011 · **Complexity:** M

**Objective.** Assemble the P3 step order and own the only code that touches `.gitignore`.

**Implementation.** `scripts/lib/ignore-block.mjs` (`PATTERNS` = the ten §6.9 patterns in order: `.agents/security-testing/private/`, `…/ledger/`, `…/runs/`, `…/receipts/`, `…/proposals/`, `…/handoffs/`, `…/imports/`, `…/register/`, `reports/security/`, `tasks/security-*/`; `renderBlock(policy)` drops the pattern of every `artifact_policy` key set to `committed` (`private/` has no key, TL-13); `upsertBlock(text, policy) → {text, changed}` idempotent between `# security-testing:begin` / `# security-testing:end`); `lib/cmd-engagement.mjs` with the step pipeline **in this order**: `0 stepTemplates` (TASK-011; on `template-written` ⇒ print and exit `2 EDIT-ENGAGEMENT-AND-RERUN`), `1 ignoreBlock` (parse `engagement.md` first — `ENGAGEMENT-INVALID`/`POLICY-INVALID` exit 2 before any write), `2 failClosed` (`git ls-files -- <pattern>` non-empty ⇒ `4 TRACKED(<path>)`; `git check-ignore -q <pattern>/.probe` non-zero ⇒ `4 NOT-IGNORED(<path>)` — a `committed` pattern is skipped by both checks), `3 ensureKey` (TASK-009; `--rotate`), `4 computeBaseline` (TASK-010); `engagement validate` runs steps 1–2 in dry-run mode plus key/baseline presence.

**Interface Contract.** §4.1 rows `engagement init|validate`. Only `cmd-engagement.mjs` step 1 may modify `.gitignore` (G-5). stdout order = step order.

**Verification.**
- [ ] `cmd-engagement.test.mjs: "bare repo: first init writes templates + engagement.md and exits 2 EDIT-ENGAGEMENT-AND-RERUN with no .gitignore change, no key, no baseline; second init exits 0"` (P3; US-007 AC-2).
- [ ] `cmd-engagement.test.mjs: "exact managed block, ten patterns, nothing else"` (US-004 AC-1); `"second init leaves .gitignore byte-identical"` (AC-2); `"artifact_policy.register: committed removes exactly that pattern and the fail-closed probe skips it"`.
- [ ] `cmd-engagement.test.mjs: "tracked file under local paths ⇒ exit 4 naming the path, nothing under <st>/private"` (AC-3); `"negation un-ignoring reports/security/ ⇒ exit 4, no key, no baseline"` (AC-4); `"repeated engagement init reuses the key, --rotate adds one"` (§12; US-005 AC-1…AC-3 at pipeline level); `"validate never writes"`.

#### TASK-013: `scope` — clean assessment scope or redacted review snapshot
**Story:** US-009 AC-1…AC-4 · **Assigned:** js-dev · **Depends on:** TASK-012, TASK-004, TASK-003 · **Complexity:** L

**Objective.** Record files, admitted ranges, skips, and — for review runs — redacted private snapshots with HMACs of the originals.

**Implementation.** `lib/cmd-scope.mjs`: files = tracked files under `scope_paths` (∩ `--include` when given) plus, for `review`, non-ignored untracked files under `scope_paths`; per file: skip rules (binary = NUL in first 8 KiB, `> --max-bytes`, symlink, submodule, unreadable); clean tracked ⇒ `side: head`, `oid = blobOid(head_oid, path)`, `file_hmac = HMAC(bytes at head)`, `lines = normalizeText(bytes).lines.length`; dirty tracked or untracked (review) ⇒ read working bytes → `original_hmac = HMAC(bytes)` → `redactString` → write `private/snapshots/<run>/<path>` (`writeAtomic`) → `redacted_sha256`, `side: snapshot`, `oid = redacted_sha256`; `ranges[path] = [[1, lines]]`; for `assessment`, re-check `git status --porcelain` and refuse (`3 DIRTY-TREE`) if dirty.

**Interface Contract.** `scope.json` payload per TASK-005; `scope_sha256 = envelope.self_sha256`. Order read → HMAC → redact → persist is a hard requirement (G-3).

**Verification.**
- [ ] `cmd-scope.test.mjs: "payload shape and scope_sha256"` (US-009 AC-1); `"assessment on a clean tree has no snapshot and no private/snapshots dir"` (AC-2).
- [ ] `cmd-scope.test.mjs: "dirty review snapshot of a file containing password=1234 ⇒ snapshot bytes redacted, HMAC present, no original bytes anywhere under .agents/security-testing/"` (§12; AC-3 — greps every file under `<st>` including `private/`).
- [ ] `cmd-scope.test.mjs: "untracked in-scope file snapshotted the same way"` (AC-4), `"binary/oversize/symlink land in skipped[] with reason"`, `"assessment tree dirtied after run init ⇒ 3 DIRTY-TREE"`.

#### TASK-015: Import store + `ingest` dispatcher + `imports.json` append
**Story:** US-010 AC-5, US-011 AC-5, US-012 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-012, TASK-004 · **Complexity:** M

**Objective.** One persistence path for every adapter: read → HMAC → redact → `ledger/<run>/imports/<sha256 of redacted bytes>`, plus the per-import derived record and the run's import index entry.

**Implementation.** `lib/imports.mjs` (`snapshotImport`: `original_hmac = HMAC(buf)`; redacted bytes = `redactString(utf8)` for text kinds, `redactDeep(parsed)` re-canonicalised for JSON kinds; `import_sha256 = sha256(redacted)`; `writeAtomic`; `run-index.appendIndex(ctx, run_id, "imports.json", {kind, import_sha256, original_hmac})` when the run is an assessment (review runs have no index; `build-report --template review` lists `ingest/` directly); returns the locator base), `lib/cmd-ingest.mjs` (dispatch by kind to `lib/ingest/<kind>.mjs` exporting `adapt(ctx, run, scope, redactedInput, locatorBase) → {records, unlocated, rejected, mapping_version}`; writes `<run>/ingest/<import_sha256>.json` enveloped, kind `import`); this task ships `lib/ingest/_shared.mjs` (`hostAllowed(url, list)`, `inScope(scope, path)`, `wrapInert(text)` = provenance banner + nonce-delimited block) and a stub adapter for tests.

**Interface Contract.** Every derived record has `locator: {import_sha256, original_hmac, index}` and the import record carries `mapping_version`.

**Verification.**
- [ ] `imports.test.mjs: "same-path audit report replacement ⇒ different import_sha256 when non-redacted content changed, different original_hmac only when redacted-away content changed"` (§12; US-012 AC-5 — stub adapter).
- [ ] `imports.test.mjs: "original bytes never persisted (grep ledger for password=1234)"`, `"record carries the locator triple and redaction_version"` (US-003 AC-2), `"assessment run: imports.json gains one entry per ingest; review run: no imports.json"`.

#### TASK-030: `register.mjs consume-verdict`
**Story:** US-022 · **Assigned:** js-dev · **Depends on:** TASK-029, TASK-026 · **Complexity:** S

**Objective.** Verdict → register through the emitter-only events, tested against the enveloped `verify.json` fixtures of TASK-026 (no `verify all` needed).

**Implementation.** `lib/cmd-register-consume.mjs`: `readArtifact(verify.json, {kind: "verify"})`; recompute `evaluate()` and refuse (`5 INCONSISTENT(evaluation)`) if it differs from the stored `evaluation`; locate the row by `subject == finding_id` (absent ⇒ exit 2 `NO-ROW`; the lead adds rows); append `fixed` (`ack_refs`, `last_verified_run = run_id`, `verify_sha256`) on `VERIFIED`, `regressed` on `REGRESSED`, `verify-observed` on every `UNVERIFIED-*`; append `regression-observed` when `evaluation.refound_observed && row.status == fixed` — **before** the status event so the order in the log matches the evaluator's precedence.

**Verification.**
- [ ] `cmd-register-consume.test.mjs` (inputs = `scripts/fixtures/verify/*.json` built by TASK-026): `"VERIFIED ⇒ fixed with ack_refs and last_verified_run"`, `"REGRESSED ⇒ regressed + regression-observed event first"`, `"UNVERIFIED-* ⇒ verify-observed only, status unchanged, regression-observed still recorded when refound_observed"` (US-022 AC-1…AC-3), `"refound-not-applied fixture ⇒ verify-observed only, no regression-observed"`, `"tampered evaluation refused exit 5"`, `"no row ⇒ exit 2 NO-ROW, nothing appended"`.

#### TASK-032: `purge --engagement`
**Story:** US-024 · **Assigned:** js-dev · **Depends on:** TASK-012, TASK-009, TASK-010 · **Complexity:** S

**Objective.** Consumer-decided deletion of one engagement's private material, exactly the P3 scope.

**Implementation.** `lib/cmd-purge.mjs`: collect run ids whose `run.json.engagement_id` matches (plus ledger entries that name them); delete `runs/<id>`, `ledger/<id>`, ledger index entries, `private/snapshots/<id>`, `private/citations/<id>`, `private/baseline.<eid>.json`, every key in `keys.keysOf(ctx, eid)` (and its `index.json` rows), `receipts/<id>` (drop-box), `imports/`; **if `keys/current` names a purged key, remove `keys/current`** (the next `engagement init` creates a new key); leave `register/`, `proposals/`, `handoffs/`, `reports/security/`, `tasks/security-*/`, `knowledge/`, `engagement.md`, `.gitignore` untouched; `--yes` required; without it print the plan and exit 2.

**Verification.**
- [ ] `cmd-purge.test.mjs: "two engagements: purging one deletes its runs, ledger entries, snapshots, citations, baseline, keys, receipts, imports and nothing of the other"` (US-024 AC-1, AC-2), `"current key belongs to the purged engagement ⇒ keys/current removed; next engagement init creates a new key"`, `"current key belongs to the other engagement ⇒ kept"`, `"register/ and .gitignore untouched"`, `"without --yes prints plan and exits 2"`.

#### TASK-058: `run snapshot register | verify | proposals`
**Story:** US-016 AC-2/AC-3 (assessment inputs), US-025 AC-3 (register CORRUPT surfaces here too) · **Assigned:** js-dev · **Depends on:** TASK-012, TASK-028 · **Complexity:** M

**Objective.** The only way a cross-run or cross-tree artifact enters an assessment run directory (P2), so `build-report` and `check` never read outside it.

**Implementation.** `lib/cmd-run-snapshot.mjs`: `register` — `register-core.openRegister` (recovery rule applies; `CORRUPT` ⇒ exit 5), `readEvents`, write `<run>/register-events.json` (kind `register-snapshot`, `writeExclusive`; present ⇒ `2 SNAPSHOT-EXISTS`); `verify --from <verify_run_id>` — require `runs/<verify_run_id>/COMMITTED` (else `3 INCOMPLETE(verify:<id>)`), `readArtifact` its `verify.json` (hash mismatch ⇒ `5 INCONSISTENT(verify:<id>)`), copy `verify.json` and every packet and receipt its payload references (`packet_sha256`, `receipts[].sha256` — the transitive closure of §6.3) byte-for-byte into `<run>/verify-snapshots/<verify_run_id>/`, each re-verified after copy; `proposals` — list `<st>/proposals/*.proposal.md`, sha256 each, rewrite `<run>/proposals-index.json` via `run-index` (TL-14). All three refuse a run that already has `COMMITTED` (`2 RUN-COMMITTED`) and a run whose kind is not `assessment` (`2 KIND(<kind>)`).

**Interface Contract.** §4.1 rows `run snapshot *`; the manifest input `verify` (TASK-023) = sha256 over the sorted `verify.json` hashes under `verify-snapshots/`; `register-events` = the snapshot's `self_sha256`; `proposals-index` = its `self_sha256`.

**Verification.**
- [ ] `cmd-run-snapshot.test.mjs: "register snapshot equals the events log; corrupt register ⇒ exit 5 and nothing written"`, `"second register snapshot ⇒ SNAPSHOT-EXISTS"`, `"verify snapshot copies verify.json + its packet + its receipts (fixtures from TASK-026 placed in a fake COMMITTED verify run) and re-verifies every hash"`, `"uncommitted source ⇒ INCOMPLETE(verify:<id>)"`, `"tampered source verify.json ⇒ INCONSISTENT(verify:<id>)"`, `"proposals index lists files with sha256; empty dir ⇒ {proposals: []}"`, `"committed run or review run refused"`.

#### TASK-059: `register.mjs render` → `<st>/risk-register.md`
**Story:** US-040 (view), US-041 AC-1 (context-doc) · **Assigned:** js-dev · **Depends on:** TASK-029 · **Complexity:** S

**Objective.** The lead's `context-docs` view of the register (P5), rendered deterministically from the projection, redacted, outside the ignore block.

**Implementation.** `lib/register-render.mjs` (`renderRegister(projection) → string`, pure: header with `engagement_id`, `seq`, anchor; a table `id | subject | priority | status | owner | ticket_url | last_verified_run`; an "Unauthenticated approvals" section listing acceptances/false-positives/ack rows with `approved_by`/`approval_ref` and the literal sentence "None of these records is authenticated"; open exposure by priority; never a snippet or path beyond the row's `title`), `lib/cmd-register-render.mjs` (`--out` default `<st>/risk-register.md`, `writeAtomic`, through `redactString`).

**Interface Contract.** `register.mjs render` output is byte-deterministic for a given projection; the file is the third `context-docs` entry of `security-lead` (§4.7).

**Verification.**
- [ ] `register-render.test.mjs: "deterministic; every row appears once; approvals section carries the unauthenticated sentence; open exposure never reduced by approvals"`, `"pure module (no fs import)"`; `cmd-register-render.test.mjs: "writes <st>/risk-register.md; password=1234 in a title is redacted"`.

### G7

#### TASK-014: `lib/cite.mjs` — side-aware citation resolution, range rule, occurrence
**Story:** US-002 AC-6, US-009 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-013, TASK-003 · **Complexity:** M

**Objective.** One resolver used by `gate`, `packet`, `check`, `verify`, `ingest sarif` and `tm-lint`.

**Implementation.** `resolveSide(ctx, run, scope, {path, side})`: `base|head` ⇒ `git.showBytes(<oid>:<path>)`; `snapshot` ⇒ `private/snapshots/<run>/<path>` (throws `SnapshotMissing`); `resolveWorking(ctx, path)` for drift; `checkRange(scope, citation)`: `1 ≤ start ≤ end`, `end - start + 1 ≤ 40`, primary ⊆ an admitted range of its file else `RANGE-NOT-ADMITTED`; typed citations (`source|sink|control`) anywhere in an in-scope file ⇒ `{ok, context: true}`; `occurrenceOf(lines, snippetLines, start)` = 0-based index among equal-length windows whose normalised lines equal the snippet, ordered by start line; `rangeBytes(buf, start, end)` = raw bytes of those lines (newline-preserving).

**Verification.**
- [ ] `cite.test.mjs: "end-start+1 = 41 rejected"`, `"40 lines inside an admitted range accepted"`, `"primary range outside admitted ranges rejected"`, `"typed citation outside admitted ranges accepted with context:true"` (US-002 AC-6), `"side base resolves via git show <base_oid>:<path> after the file was deleted at head"`, `"side snapshot resolves the private snapshot"` (US-009 AC-5), `"occurrence recomputed against a caller hint"`.

#### TASK-017: `ingest ticket | pr | doc | tracker-readback` (adapters)
**Story:** US-011 · **Assigned:** js-dev · **Depends on:** TASK-015, TASK-007 · **Complexity:** M

**Implementation.** `lib/ingest/{ticket,pr,doc,tracker-readback}.mjs` per §6.6 trusted/inert columns; host rule against `engagement.targets.tracker`; `pr.changed_files ∩ scope`; `doc` path must be in scope; `tracker-readback` takes `--sent <ticket.json produced by publish>` and trusts only the keys the mutation set (`id`, `url`, `labels`, `state`, `body_contains_finding_id: bool`), recording `mismatch: [<field>]` when read-back differs from sent. The register `ticketed` event is **not** appended here (TASK-045 wires it); this task produces the record only. Fixtures under `scripts/fixtures/tracker/`.

**Verification.**
- [ ] `ingest-tracker.test.mjs: "ticket with disallowed host rejected; allowed host trusts id/url/labels/state only"`, `"pr changed_files intersected with scope; title/body inert"`, `"doc outside scope rejected"`, `"tracker-readback trusts only mutated fields and records mismatch"` (US-011 AC-1…AC-4); `"every adapter persists via the import store"` (AC-5).

#### TASK-018: `ingest case | audit | qa-run | ta-report` (adapters) + verbatim format fixtures under dupes check
**Story:** US-012 AC-1…AC-4 · **Assigned:** js-dev · **Depends on:** TASK-015 · **Complexity:** L

**Implementation.** `lib/ingest/{case,audit,qa-run,ta-report}.mjs`: `case` parses manual-qa TC frontmatter (keys from `bundles/manual-qa/knowledge/test-case-format.md`) trusting ids and `requirements`; `audit` parses the qa-auditor Markdown + its JSON block (shape from `bundles/manual-qa/agents/qa-auditor/AGENT.md`), URL host ∈ `targets.browser`; `qa-run` parses `reports/RUN-YYYY-MM-DD-NNN.md` per `bundles/manual-qa/knowledge/test-run-report-format.md` — frontmatter `run_id, suite, environment, date` + `## Results` table `ID | Title | Size | Status | Steps | Wall Clock`, status ∈ `PASS|FAIL|BLOCKED`, screenshots by path only; `ta-report` parses `.agents/automation/<slug>/report.json` (shape from `bundles/test-automation`) trusting unit outcomes, `coverage`, exclusions, `findings[]`, `recovery_basis`, test paths; `delivered` without a gate receipt ⇒ `delivered-unwitnessed`. **Fixtures are verbatim copies of the owning bundle's documented examples**: `scripts/fixtures/qa/RUN-2026-09-15-001.md`, `scripts/fixtures/qa/TC-SEC-001.md`, `scripts/fixtures/qa/audit-report.md`, `scripts/fixtures/ta/report.json`; each is paired in `bin/check-skill-dupes.mjs` `GROUPS` with its source example (`bundles/manual-qa/knowledge/examples/…` / `bundles/test-automation/…` — if the owning bundle has no committed example file for a format, this task adds one there in the same PR so the pairing exists) so a format change upstream fails `npm run validate:dupes` instead of silently breaking the adapter.

**Verification.**
- [ ] `ingest-qa.test.mjs: "manual-qa run report in its real Markdown format through ingest qa-run"` (§12; US-012 AC-3), `"case trusts ids and requirements; steps inert"` (AC-1), `"audit URL outside targets.browser untrusted"` (AC-2), `"ta-report per-unit fields; delivered without gate receipt ⇒ delivered-unwitnessed"` (AC-4, US-037 AC-3).
- [ ] `npm run validate:dupes` passes with the four new groups; `bin/check-skill-dupes.mjs` diff adds only `GROUPS` rows.

#### TASK-020: `coverage`
**Story:** US-014 AC-1, AC-2, AC-4 (AC-3's sign-off half is TASK-033) · **Assigned:** js-dev · **Depends on:** TASK-013 · **Complexity:** M

**Implementation.** `lib/cmd-coverage.mjs`: validate the examined declaration (its `packet_sha256` must name a `kind: scope` packet of the run, else `2 EXAMINED-PACKET-MISMATCH`), envelope it as `examined.json`; interval arithmetic per file: split scope ranges by declared examined ranges and scanner rows; every scope range must be covered by exactly one accounting entry — overlapping declarations ⇒ `4 OVERLAP(path:a-b)`, uncovered ⇒ entry `unexamined` (a gap in **declarations** is allowed and reported; a gap in the **accounting** is a bug ⇒ `4 GAP`); empty scope ⇒ `COVERAGE INDETERMINATE` printed, `coverage.json` written with `accounting: []`, `indeterminate: true` (what TASK-033 keys on).

**Verification.**
- [ ] `cmd-coverage.test.mjs: "payload shape"` (US-014 AC-1), `"every scoped range appears in exactly one entry; overlap fails naming the range"` (AC-2), `"empty scope ⇒ INDETERMINATE printed and indeterminate:true in the payload"` (AC-3 producer half), `"deterministic"` (AC-4), `"examined declaration naming a non-scope packet rejected"`.

#### TASK-057: `lib/packet-core.mjs` + `packet --kind scope`
**Story:** US-015 AC-1 (packet shape), US-028 AC-3 (`review` contract input) · **Assigned:** js-dev · **Depends on:** TASK-013, TASK-009 · **Complexity:** S

**Objective.** The packet builder and the **scope packet** the `review` contract receives before any id exists (P1).

**Implementation.** `references/packet-policy.v1.json` (TASK-005 shape); `lib/packet-core.mjs` (`buildPacket({kind, subject_ids, files, resolveSide, key, policy})`: per file `{path, side, oid, ranges, range_hmac = HMAC(concat of rangeBytes for each range)}`, `policy_sha256 = sha256(canonical(policy))`); `lib/cmd-packet.mjs` with `--kind scope`: `subject_ids: []`, `files` = every `scope.files[]` entry with `ranges = scope.ranges[path]`, written to `<run>/packets/<packet_sha256>.json`; refuses `--subject` with `--kind scope`; `--kind subject` is TASK-021 (returns `2 NOT-IMPLEMENTED` until then).

**Interface Contract.** `packet` payload per TASK-005; a scope packet's `packet_sha256` is what `claims-*.json` and `examined-*.json` must name (TL-15).

**Verification.**
- [ ] `cmd-packet.test.mjs: "scope packet: kind scope, empty subject_ids, one file entry per scope file, range_hmac over raw bytes at the recorded side"` (US-015 AC-1), `"same scope twice ⇒ same packet_sha256"`, `"snapshot-side file hashed from the private snapshot"`, `"--subject with --kind scope ⇒ exit 2"`; `packet-core.test.mjs: "pure given resolveSide"`.

### G8

#### TASK-016: `ingest sarif` + `sarif-mapping.v1.json`
**Story:** US-010 AC-1…AC-4, AC-6 · **Assigned:** js-dev · **Depends on:** TASK-015, TASK-013, TASK-014 · **Complexity:** M

**Implementation.** `references/sarif-mapping.v1.json` (TASK-005 shape; tool confidences `semgrep 6, gitleaks 7, trivy 7, osv-scanner 8, codeql 7, unknown 3`, `level_priority {error: p1, warning: p2, note: p3}`, tag→class table); `lib/ingest/sarif.mjs` implementing the §6.7 matrix row by row: URI canonicalisation (`file:` scheme or relative; reject absolute, `..`, symlink escapes, `%2e`), `inScope` ⇒ located candidate else `unlocated(out-of-scope)`; `endLine` default; snippet from the recorded side via `cite.resolveSide` when absent; level fallback chain; `ruleIndex`/`ruleId` disagreement ⇒ rejected; unknown tool ⇒ tags-only class, confidence 3, `recorded: unknown-tool`; malformed region ⇒ rejected with reason; data-flow classes flagged `requires_typed_citations: true`; `message.text`/`snippet.text` stored only as `inert: wrapInert(redacted)`. Fixtures: one SARIF per matrix row under `scripts/fixtures/sarif/`.

**Verification.**
- [ ] `ingest-sarif.test.mjs: "message.text path-like instruction never selects a path"` (US-010 AC-1); one test per §6.7 row (AC-2, nine tests); `"rejection reasons counted"` (AC-3 — counts in the import record; display asserted in TASK-023); `"SARIF unlocated candidates never reach gate"` (record level; again in TASK-019); `"import record names mapping version v1"` (AC-6).

### G9

#### TASK-019: `gate` — ids and citation states by content sensitivity
**Story:** US-013, US-010 AC-4 · **Assigned:** js-dev · **Depends on:** TASK-014, TASK-016, TASK-009 · **Complexity:** L

**Implementation.** `lib/cmd-gate.mjs` + pure core `lib/gate-core.mjs` (`gate({scope, scopePackets, claims, imports, resolveSide, key, rules}) → {claimed, gateResult, rejects, unlocated, citationRecords[]}`): merge candidates from `ingest/*.json` (located records) and `--claims` files (validated as `ClaimSet`; `packet_sha256` must be a `kind: scope` packet of the run — else the whole file is refused `2 CLAIMS-PACKET-MISMATCH(<file>)` (TL-15); a claim carrying `id` or `state` ⇒ rejected reason `agent-wrote-id`); `source = {kind: agent, ref: sha256(claims file bytes), index}` or `{kind: sarif, ref: import_sha256, index}`; `checkRange`; resolve bytes at side; `normalizeText` of source range vs claimed snippet (in memory, unredacted); `occurrenceOf` ignoring hint; sensitivity = `redact.matches(rawRangeBytes)`; plain: `id = sha256(path\0class\0normalised\0occurrence)`, store `snippet`; sensitive (any class): `id = HMAC(path\0class\0redacted normalised\0occurrence)`, store `snippet_redacted` (or `context_redacted` for `secret`), `sensitive: true`, write `private/citations/<run>/<id>.json` **before** the claimed text is dropped; state `CITATION_VERIFIED|CITATION_FAILED`; data-flow class without typed citations stays accepted but flagged `requires_typed_citations`; write `findings.claimed.json`, `gate-result.json`, `rejects.json`, `unlocated.json`. `gate-core` must be callable by `build-report`/`check` with a byte-identical result.

**Verification.**
- [ ] `gate.test.mjs: "non-secret finding citing password=1234 ⇒ keyed id, no plain hash anywhere in publishable artifacts"` (§12; US-013 AC-2 — computes the plain sha256 and greps every non-`private/` file).
- [ ] `gate.test.mjs: "plain identity when no rule matches"` (AC-1), `"private citation record written before discard; claimed text absent from every file"` (AC-3), `"secret class uses context_redacted"` (AC-4), `"states and occurrence recomputed ignoring the hint; gate-result payload shape"` (AC-5), `"deterministic re-run byte-identical"` (AC-6), `"SARIF unlocated candidates never reach gate"` (US-010 AC-4), `"claim carrying id/state rejected"`, `"claims file naming a subject packet or a foreign run's packet ⇒ CLAIMS-PACKET-MISMATCH"`, `"source field distinguishes agent and sarif candidates"`.

### G10

#### TASK-021: `packet --kind subject`
**Story:** US-015 AC-1 · **Assigned:** js-dev · **Depends on:** TASK-019, TASK-057 · **Complexity:** S

**Implementation.** `lib/cmd-packet.mjs` `--kind subject`: subjects resolved to findings (`gate-result.accepted` + `findings.claimed.json`; `files[]` = the finding's primary range plus every `citations_typed[]` range of that file, at the finding's recorded side), mitigations (M2: `threat-model.json` mitigation citations), or cases (M3: `--type case`, file = the case path at `head`); `--type` defaults to `vulnerability-review` for findings, `mitigation-review` for mitigations; `--type fix-review` is only used by `verify all` (worktree files); `subject_ids` = the given ids in argv order (deduplicated); written to `<run>/packets/<packet_sha256>.json`.

**Verification.**
- [ ] `cmd-packet.test.mjs: "subject packet: kind subject, subject_ids, files limited to cited ranges + typed citations, range_hmac over raw bytes at the recorded side"` (US-015 AC-1), `"same subjects twice ⇒ same packet_sha256"`, `"unknown subject ⇒ exit 2"`, `"subject in unverifiable[] (CITATION_FAILED) ⇒ exit 2 UNVERIFIABLE-SUBJECT"`.

### G11

#### TASK-022: `receipt validate | apply` + `lib/states.mjs`
**Story:** US-015 AC-2…AC-7 · **Assigned:** js-dev · **Depends on:** TASK-021 · **Complexity:** L

**Implementation.** `lib/cmd-receipt.mjs`: `validate` — schema (`oneOf` per type), `forbiddenKeys` (named in the error), packet exists under the run and is `kind: subject`, `packet_sha256` equals its `self_sha256`, every `packet.files[].oid` equals the blob oid at the run's `head_oid` (or `base_oid` for `side: base`, `redacted_sha256` for snapshot), `subject_id ∈ packet.subject_ids`, `reviewer_run_id == run_id`; on success envelope + write `receipts/<sha>.json`; `apply` — `states.applyReceipts` (pure) implementing the §6.4 table: `CITATION_FAILED` ⇒ unchanged, receipt `not-applied`; conflicting assertions per `(type, subject, run)` ⇒ `*_INDETERMINATE` (acks exempt); `REVIEW_REFUTED` sticky except a new `vulnerability-review` receipt in a **different** run; mitigation receipts ⇒ `MITIGATION_*`.

**Interface Contract.** `applyReceipts(gateResult, receipts, packets) → {states, mitigation_states, not_applied, conflicts}`; the same function is used by `build-report`, `check`, `verify all`, `tm-lint`, `plan admit`.

**Verification.**
- [ ] `cmd-receipt.test.mjs: "closed enums per type; other values rejected; packet binding and oid check; scope packet refused as a receipt target"` (US-015 AC-2), `"receipt carrying state/verdict/id/gate stamp rejected naming the key"` (AC-7), `"reviewer_run_id mismatch rejected"`.
- [ ] `states.test.mjs: "CITATION_VERIFIED + vulnerability-review confirmed/refuted/indeterminate ⇒ REVIEW_*"` (AC-3), `"CITATION_FAILED stays; receipt not-applied"` (AC-4), `"REVIEW_REFUTED sticky"` (AC-5), `"two receipts same subject same run different assertions ⇒ INDETERMINATE; multiple acks exempt"` (AC-6), `"pure module"`.

### G12

#### TASK-023: `build-report` core + `review` template + renderer
**Story:** US-016 AC-1…AC-4, AC-6, AC-7 (review), US-010 AC-3 · **Assigned:** js-dev · **Depends on:** TASK-019, TASK-020, TASK-022, TASK-006 · **Complexity:** L

**Implementation.** `templates/README.md`, `templates/review.md` (its required-inputs list in a fenced `required-inputs` block the script parses — the list in the template file **is** the closed list: `run, scope, claimed, gate-result, coverage, examined, packets, receipts (vulnerability-review; may be empty), rejects, unlocated`); `lib/inputs.mjs` (`REQUIRED = {review: [...], assessment: [...], verify: [...], threat-model: [...]}` — the last three lists are declared here and their templates land in TASK-024 — and `closeOver(runDir, template)`: follow every hash reference — receipts→packets, gate-result→scope+claimed, coverage→scope+examined, observations→imports, verify-snapshots→their packets/receipts; missing ⇒ `CliError(3, "INCOMPLETE(<name>)")`); `lib/render.mjs` (`buildView` from inputs using `gate-core` re-run (refuse `5 INCONSISTENT(gate-result)` on mismatch), `applyReceipts`, coverage recompute; `renderMarkdown(view, template)` with TL-7 markers; sections per v3 §11 with `unknown / not assessed` for every absent field; findings whose state is `CITATION_VERIFIED` with no receipt shown as "not independently reviewed"); `lib/cmd-build-report.mjs` (fs access confined to `runs/<id>` + `ledger/<id>` via a path guard that throws on anything else; writes `report.md`, `manifest.json`, then `COMMITTED` containing `manifest.self_sha256`).

**Interface Contract.** `manifest.json` payload per TASK-005; **`tool_version` = `ctx.toolVersion()` from `scripts/version.json`** (P5); `template_version` from the template's frontmatter; `COMMITTED` file content = manifest hash + `\n`.

**Verification.**
- [ ] `cmd-build-report.test.mjs: "reads only the run directory (planted newer artifact elsewhere unused; path guard throws)"` (US-016 AC-1, TL-3), `"review: each required input deleted ⇒ exit 3 INCOMPLETE(<input>), no report"` (AC-2, table-driven), `"transitive closure: receipt with missing packet ⇒ INCOMPLETE(packet:<sha>)"` (AC-3), `"COMMITTED last, contains manifest hash; manifest payload shape; tool_version equals version.json"` (AC-4), `"deterministic render byte-identical"` (AC-6), `"template required-inputs lists match inputs.mjs"` (AC-7), `"section 3 shows rejected counts by reason totalling three"` (US-010 AC-3), `"no receipts ⇒ every accepted finding rendered as not independently reviewed"`.

#### TASK-034: `secure-code-review` skill — prose, fixtures, frozen harness, standalone sequence
**Story:** US-026, US-030 AC-3 (documented human-driven sequence) · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-019, TASK-022, TASK-057 · **Complexity:** M

**Implementation.** `bundles/security-testing/skills/secure-code-review/SKILL.md` (frontmatter `name, description, license, metadata.authors/version`; body: investigate-then-refute loop, taxonomy = the `Finding.class` enum with CWE anchors, refutation criteria, do-not-flag list, typed citations `source|sink|control` for data-flow classes, the closed assertion vocabulary of §6.4 per contract, "read only what the packet lists", "the `review` contract writes a claims file and an examined declaration, never a receipt; the other three write a receipt payload; never an id, state or verdict"); **§ "Standalone review, human-driven"** — the two-skill install has no agent, so the sequence is stated as commands the human runs and the review steps the active session performs itself: `evidence.mjs engagement init` (twice on a bare repo: first exits 2 `EDIT-ENGAGEMENT-AND-RERUN`) → `run init --kind review --base <ref>` → `scope --run <id>` → `packet --run <id> --kind scope` → *you* perform the `review` contract over that packet and write `claims-1.json` + `examined-1.json` into `<st>/receipts/<id>/` → `gate --run <id> --claims <file>` → `coverage --run <id> --examined <file>` → optional: `packet --run <id> --kind subject --subject <finding id>` + a **fresh session** performs `vulnerability-review` and writes the receipt → `receipt validate` → `build-report --run <id> --template review` → `check <run dir> --integrity --drift`; `verify.mjs all` for a fix; `sign-off` will exit `4 NO-ASSESSMENT` by design (D12) — say so; `references/taxonomy.md`, `references/refutation.md`, `references/do-not-flag.md`, `fixtures/` (claims files that pass `gate`: non-secret `password=1234` citation, data-flow finding with typed citations, deleted-code finding `side: base`; each with the tiny source repo snapshot they cite under `fixtures/repo/`), `evals/harness.json` (`prompt_sha256, model_id, sampling: {temperature: 0, top_p: 1, max_tokens}, fixture_revision, output_selection: first, matching: {assertion_exact: true}`), `evals/runs/.gitkeep` + README.

**Verification.**
- [ ] `skills-ref` validation (CI) passes; `npm run validate:factories` (once TASK-037 lands) passes.
- [ ] `secure-code-review.fixtures.test.mjs` (under `skills/security-evidence/scripts/`): `"every fixture claim passes gate on its fixture repo when it names the fixture scope packet; password=1234 fixture yields a keyed id"` (US-026 AC-3), `"harness.json pins the six fields"` (AC-4), `"SKILL.md standalone section lists the commands in the order of TASK-038 path (b)"` (the test parses the backticked commands and compares against an exported `STANDALONE_SEQUENCE` in `e2e` helpers — landed in 038; until then the test asserts the presence and order of the eleven command names).

### G13

#### TASK-027: `verify.mjs all` — steps 1–6, `verify.json`, verdict line, two-pass
**Story:** US-018 · **Assigned:** js-dev · **Depends on:** TASK-026, TASK-022, TASK-012, TASK-023, TASK-021 · **Complexity:** L

**Implementation.** `lib/cmd-verify-all.mjs` + `lib/verify-steps.mjs` (`branch`, `worktree` (OS tmpdir, `git worktree add --detach`, always `worktree remove --force` in `finally`), `install` (argv from engagement only; HMAC over working bytes vs HMAC over `showBytes(head, path)` per tracked file; `tested_tree = HMAC(sorted "path\0hmac\n")`; untracked count/bytes), `suppression` (unified diff parse over `base..head`; indicator kinds §4.2; `deletion_only` per TL-12), `tests` (allowlist/deny, resolved executable via own PATH search, sha256 of it, `spawn` with `detached: true` for group kill, minimal env, timeout, 64 KiB bounded redacted output), `fixReviewPacket` (`packet-core.buildPacket` over the worktree files of the finding, `kind: subject`, `--type fix-review`, `side: head`, oids from head), receipts admission from `--receipts` (reusing `cmd-receipt` validate; a receipt that fails validation is recorded `applied: false` with `not_applied_reason` — never dropped), `evaluate`, write `verify.json`, in-process `build-report --template verify` (so the run is COMMITTED), then `consume-verdict` when `--receipts` was given. Refuse `REVIEW_REFUTED` findings before allocating (`4 UNVERIFIED-REFUTED-FINDING`). Fixture repo builder `scripts/fixtures/repo/build.mjs` (temp git repo: `package.json` whose `test` script is `node test-runner.mjs`, tracked `test-helper.mjs`, a finding at a known path, base and head commits, an install script that edits the helper).

**Verification.**
- [ ] `cmd-verify-all.test.mjs: "branch COMMITTED | NOT-COMMITTED | PATH-UNTOUCHED"` (US-018 AC-1), `"wrong-head worktree: dirty test helper in the main tree has no effect; tests fail in the clean worktree"` (AC-2), `"install modifying a tracked helper ⇒ install-modified-tree"` (§12; AC-3), `"allow_tracked_changes:true ⇒ tested_tree recorded and named in VERDICT"`, `"ignore file edited outside the finding path ⇒ INDICATOR; deletion-only diff ⇒ deletion_only:true"` (AC-4), `"argv from ticket/SARIF never executed; deny rules; shell:false; executable path + sha256 recorded; output bounded and redacted"` (AC-5), `"pass 1: fix-review packet built from the worktree, prints PACKET and NEXT, verdict UNVERIFIED-INDETERMINATE(fix-review), run COMMITTED"` (AC-6, TL-6), `"pass 2 with an authored not-refound receipt + acks ⇒ VERIFIED; new seq; pass-1 run untouched"`, `"pass 2 with a refound receipt whose packet_sha256 is wrong ⇒ recorded applied:false, verdict UNVERIFIED-INDETERMINATE(fix-review), no regression-observed event"` (§6.4 P5 fixture), `"verify.json payload complete; last stdout line matches the VERDICT grammar"` (AC-7), `"REVIEW_REFUTED finding ⇒ exit 4 UNVERIFIED-REFUTED-FINDING, no run allocated"` (US-015 AC-5).

#### TASK-031: `publish --profile` (report + tracker payload) and `check-export`
**Story:** US-023, US-039 AC-1 (payload level), AC-3 (first dedupe layer) · **Assigned:** js-dev · **Depends on:** TASK-023, TASK-029 · **Complexity:** M

**Implementation.** `lib/profiles/{redacted-report,full-report,tracker}.mjs` each `apply(runDir, register, opts) → [{relpath, bytes}]` (pure over inputs; `profile_version`); `redacted-report` = report minus snippets, reproduction and infra paths; `full-report` = report + findings JSON (explicit only); `tracker` (P4, first layer): per accepted finding a payload file `handoffs/<finding_id>.ticket.json` `{finding_id, title, class, priority, path, lines, context_redacted, fix_prompt, fingerprint}` — never `snippet` for `sensitive: true`, `fix_prompt` text from TASK-045's generator (stub string here, replaced there); **dedupe** = skip a finding whose register row has `ticket_url`, or whose id appears in an ingested `ticket` record with `state: open` ⇒ `DEDUPE finding=<id> existing=<url>`; then print `NEXT: post <path> via issue-tracking, then ingest tracker-readback --sent <path> <response.json>`; **no register event** (the `ticketed` event comes from read-back, TASK-045); `export-manifest.json` per output set; `check-export` re-applies with `--source`, byte-compares ⇒ `VERIFIED-DERIVATIVE`, else `LINKED-ONLY`; `handoff` and `case` profiles are M3 (TASK-043) — registered names returning `2 NOT-IMPLEMENTED(M3)`.

US-039 AC-1 ("its body contains only …") is satisfied by this task at the **payload** level; the ticket the tracker shows is whatever the lead posts through `issue-tracking` from that payload — prose-enforced in TASK-035/047, not promised by the script (§9.4).

**Verification.**
- [ ] `cmd-publish.test.mjs: "each profile emits only its allowed fields; full-report needs the explicit profile"` (US-023 AC-1), `"export-manifest payload"` (AC-2), `"tracker payload never carries snippet for a sensitive finding and has exactly the nine keys"` (US-039 AC-1), `"dedupe on existing ticket_url and on an open ingested ticket naming the id; no register event written by publish"` (AC-3 first layer), `"NEXT line names issue-tracking and tracker-readback"`.
- [ ] `cmd-check-export.test.mjs: "check-export VERIFIED-DERIVATIVE and LINKED-ONLY"` (§12; AC-3, AC-4), `"tampered output ⇒ MISMATCH exit 5"`.
- [ ] `writes-outside-st.test.mjs: "only publish --to writes outside the §4 writable paths"` (AC-5 — static grep of `scripts/**` for `writeFileSync|writeAtomic` call sites plus a runtime fs spy during a full pipeline run).

#### TASK-036: `security-reviewer` agent + SOUL + briefing (four contracts)
**Story:** US-028 AC-1…AC-3 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-034, TASK-022, TASK-021, TASK-057 · **Complexity:** M

**Implementation.** `agents/security-reviewer/AGENT.md` (frontmatter §4.7 exactly; body: tool-call economy block, the four rules, **four contracts** with the §4.7 return-line grammar: `review` — input: a `kind: scope` packet path + `run_id`; read only the listed files at the listed sides (`git show <oid>:<path>` / snapshot path); write `claims-<n>.json` `{scope_sha256, packet_sha256, findings[]}` and `examined-<n>.json` `{packet_sha256, declared[]}` into `<st>/receipts/<run_id>/`; **never a receipt, never an id**; return `CLAIMS … EXAMINED … findings=<n> read=<n files>`; `vulnerability-review` / `mitigation-review` / `fix-review` — input: a `kind: subject` packet path + `run_id`; a **fresh dispatch** (never the instance that authored the claim — the lead enforces by dispatching anew; the agent refuses if its own context contains a claims file for the same subject); write the receipt payload `{type, subject_id, packet_sha256, assertion, reviewer_run_id: <run_id>}`; `fix-review` may add `ack` receipts per indicator listed in the dispatch; return `RECEIPT …`; writable-paths self-check text; "never merge, close, rotate, fix"), `agents/security-reviewer/SOUL.md`, `briefings/security-reviewer.md` (where packets arrive; `receipt validate`/`gate` are the lead's commands, not yours).

**Verification.**
- [ ] `bin/no-tools-frontmatter.test.mjs`, `bin/frontmatter-strict.test.mjs`, `bin/agent-skill-deps.test.mjs`, `bin/skills-on-demand.test.mjs` pass.
- [ ] `agents.test.mjs` (under `security-evidence/scripts/`): `"security-reviewer frontmatter equals the §4.7 contract"` (US-028 AC-1), `"body contains the four rules and the four return-line grammars; the review contract section contains no receipt instruction"` (AC-2, AC-3, P1).

### G14

#### TASK-024: `assessment`, `verify`, `threat-model` templates + full §11 sections
**Story:** US-016 AC-2 (three templates), AC-5 · **Assigned:** js-dev · **Depends on:** TASK-023, TASK-027, TASK-058, TASK-028 · **Complexity:** L

**Implementation.** `templates/{assessment,verify,threat-model}.md` with their required-inputs blocks (§6.3 table): `assessment` = review inputs + `engagement` (`<run>/engagement.json`), `threat-model` (`<run>/threat-model.json`; absent ⇒ `INCOMPLETE(threat-model)`), `receipts (mitigation-review; may be empty)`, `observations` (`observations.json` index + `observations/*`), `imports` (`imports.json` index + `ingest/*`), `verify-snapshots` (`verify-snapshots/*/verify.json`, closed over their packets/receipts), `register-events` (`register-events.json`), `proposals-index` — **all inside the run dir, produced by TASK-012 (empty) and TASK-058 (snapshots)**; `verify` = `run, verify.json, fix-review packet, receipts (fix-review, ack)`; `threat-model` = `run, threat-model, mitigation packets, receipts (mitigation-review), dispositions` (M1 accepts an empty model `{elements: [], threats: []}` — the M1 assessment E2E writes it as an enveloped artifact via `canon.writeArtifact`, the same path `tm-lint check` uses from M2; documented, not a hack). `render.mjs` sections 1–12 in v3 §11 order; section 3 counts by priority × state, unresolved by priority, rejected by reason, unlocated count, unauthenticated approvals (from `register-core.replay(register-events.json)` — never from the live register), incomplete runs (from the ledger snapshot inside `run.json`? **no** — the ledger is outside the run dir; incomplete runs are listed by `sign-off`, and the report says "see sign-off" with a marker), section 6 Limitations lists `KEY: unavailable` artifacts, outside-policy artifacts, "local ≠ confidential"; section 12 chain of custody with manifest hashes, `ORIGIN` line, `tool_version`, `template_version`; verify template renders the `VERDICT` line and history from `verify-snapshots`.

**Verification.**
- [ ] `render.test.mjs: "assessment sections in v3 §11 order; every finding field filled or 'unknown / not assessed'; no blank cell"` (US-016 AC-5), `"section 3 counts derive from view; markers present on every derived line"` (TL-7), `"register section derives from the snapshot, not from <st>/register"` (TL-3).
- [ ] `cmd-build-report.test.mjs: "assessment/verify/threat-model: each required input deleted ⇒ INCOMPLETE(<input>)"` (AC-2 for the three templates, incl. `INCOMPLETE(threat-model)` when absent and `INCOMPLETE(register-events)` when no snapshot was taken), `"Limitations lists artifacts whose key_id file is missing"` (US-005 AC-4 half), `"assessment built from a run prepared by run init + run snapshot register/verify/proposals + empty threat model reaches COMMITTED"`.

### G15

#### TASK-025: `check` — recompute, integrity, drift, origin, key
**Story:** US-017, US-005 AC-4, US-009 AC-5 · **Assigned:** js-dev · **Depends on:** TASK-024, TASK-026, TASK-028, TASK-014 · **Complexity:** L

**Implementation.** `lib/cmd-check.mjs`: accept run dir or manifest path; require `COMMITTED` and that its content equals the recomputed manifest hash; recompute every manifest input hash (`INCONSISTENT(input:<kind>)`); re-run `gate-core`, coverage, `applyReceipts`, `evaluate` per `verify-snapshots/*/verify.json`, `register-core.replay` over `register-events.json`; re-render and byte-compare with TL-7 naming; `--integrity`: for every citation, HMAC of `resolveSide` bytes vs recorded `range_hmac` / private citation record (`side: base` via `git show`; `snapshot` ⇒ redacted snapshot vs `redacted_sha256` **and** working file vs `original_hmac` ⇒ `CONSISTENT` / `CONSISTENT-REDACTED-ONLY(n citations)` / `INCONSISTENT(snapshot:<path>)`); `--drift`: `head`/`snapshot` citations vs working tree (`CITATION-DRIFTED(n)`), per-file HMAC of every in-scope file vs `scope.json` (`SCOPE-DRIFTED(n files)`), `base` skipped; key: envelope `key_id` file missing ⇒ `KEY: unavailable`, skip content re-validation, `STRUCTURE-ONLY` in place of `CONSISTENT`; `--trusted-digest` compared to the **recomputed** manifest hash; `CONSISTENT-REDACTED-ONLY` impossible for `assessment` runs (assert: scope has no snapshot); export `checkRun(ctx, runDir, opts) → result` for `sign-off`.

**Verification.**
- [ ] `cmd-check.test.mjs: "untouched COMMITTED run ⇒ CONSISTENT, CURRENT, ORIGIN: unauthenticated, KEY: available, exit 0"` (US-017 AC-1).
- [ ] `cmd-check.test.mjs: "every derivation-table row: tampering finding ids / CITATION states / coverage counts / REVIEW states / verify verdicts (snapshot) / register status-delta-bucket (snapshot) / rejected-unlocated totals / executive counts ⇒ INCONSISTENT(<field>)"` (AC-2, one sub-test per row).
- [ ] `cmd-check.test.mjs: "consistent full-set forgery ⇒ CONSISTENT and ORIGIN: unauthenticated"` (AC-3), `"--trusted-digest matches only the recomputed hash, never the sidecar"` (AC-4), `"edited cited head line ⇒ CITATION-DRIFTED(1); edited uncited in-scope file ⇒ SCOPE-DRIFTED(1 files); base citations skipped"` (AC-5), `"historical report after a fix ⇒ CONSISTENT + drifted"`, `"side: base citation passes integrity"` (§12), `"review run with snapshot citation of password=1234: CONSISTENT before working-file change, CONSISTENT-REDACTED-ONLY(1 citations) after, INCONSISTENT when the redacted snapshot is altered"` (§12 four-step, steps 1–3; AC-6), `"key file absent ⇒ KEY: unavailable and STRUCTURE-ONLY, never CONSISTENT"` (AC-7; US-005 AC-4), `"assessment run can never print CONSISTENT-REDACTED-ONLY"` (AC-8), `"check reads nothing outside the run dir except git objects, the working tree and the key"` (fs spy).

### G16

#### TASK-033: `sign-off --engagement`
**Story:** US-025 (M1 scope; AC-6 lands in TASK-043; disposition policy in TASK-041), US-006 AC-2…AC-4, US-014 AC-3 · **Assigned:** js-dev · **Depends on:** TASK-025, TASK-010, TASK-028, TASK-023, TASK-008 · **Complexity:** L

**Implementation.** `lib/cmd-sign-off.mjs`: inventory = `ledger/index.json` only; runs without `COMMITTED` ⇒ `INCOMPLETE:` list; no COMMITTED assessment ⇒ `4 NO-ASSESSMENT` (the string `UNGATED` must not exist anywhere in `scripts/**`); latest assessment by `seq`; `checkRun` on every COMMITTED run: `INCONSISTENT`/`STRUCTURE-ONLY` ⇒ fail naming the run; `CONSISTENT-REDACTED-ONLY` accepted for `review` kind and listed; latest assessment `--drift` scope-level must be `CURRENT`; **latest assessment's `coverage.json.indeterminate === true` ⇒ `4 COVERAGE-INDETERMINATE(<run_id>)`** (US-014 AC-3, P5); register open ⇒ `CORRUPT` fails; `--expect` ⇒ `anchor verify` must be `MATCH`; tracked files under managed paths (reuse `ignore-block` fail-closed, TASK-008) ⇒ fail; `require_dispositions` read from engagement — at M1 `none`/absent ⇒ `DISPOSITIONS: not evaluated` (TASK-041 adds the rest); informational: incomplete runs, `diffBaseline` per path, `EXCLUDED-COVERAGE:` ignored counts, unauthenticated approvals from `register status`. Exports `FAIL_CAUSES[]` and `LISTING_HEADERS[]` (TASK-035's test reads them).

**Verification.**
- [ ] `cmd-sign-off.test.mjs: "only ledger-listed runs considered; uncommitted listed as incomplete"` (US-025 AC-1), `"only review runs ⇒ exit 4 NO-ASSESSMENT and no UNGATED banner"` (AC-2), `"each failing condition ⇒ exit 4 naming the cause"` (AC-3, table-driven: INCONSISTENT run, STRUCTURE-ONLY run, latest assessment not CURRENT, **coverage INDETERMINATE**, CORRUPT register, anchor mismatch, tracked file under managed path), `"redacted-only review run + current clean COMMITTED assessment ⇒ exit 0 and lists it"` (§12 four-step step 4; AC-4), `"informational listings do not affect exit"` (AC-5), `"tracked change / untracked change listed per path; ignored change reported as excluded coverage"` (US-006 AC-2…AC-4).

### G17

#### TASK-035: `security-engagement` skill (prose) — lead workflow, sign-off checklist, tracker two-layer rules, profiles
**Story:** US-027, US-039 AC-3 (second dedupe layer, prose) · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-033, TASK-031 · **Complexity:** S

**Implementation.** `skills/security-engagement/SKILL.md` + `references/{workflow,sign-off-checklist,tracker-rules,disclosure-profiles}.md`; no `scripts/`; every command named is `evidence.mjs …`, `verify.mjs …`, `register.mjs …`; the workflow states the P1 order (`run init → scope → packet --kind scope → dispatch review → gate --claims → coverage --examined → packet --kind subject → fresh dispatch vulnerability-review → receipt validate → …`); `tracker-rules.md` states the P4 two layers verbatim: "the script dedupes against the register and prior imports; **you** search the live tracker by `fingerprint` through `issue-tracking` before posting; post the payload file's fields and nothing else; then run `ingest tracker-readback --sent <payload> <response>`; the bundle promises the first layer only"; the checklist enumerates every `FAIL_CAUSES` token and every `LISTING_HEADERS` entry of `cmd-sign-off.mjs`.

**Verification.**
- [ ] `security-engagement.test.mjs` (under `security-evidence/scripts/`): `"skill dir has no scripts/; every backticked command starts with evidence.mjs|verify.mjs|register.mjs"` (US-027 AC-1), `"sign-off checklist names every FAIL cause token and every listing header exported by cmd-sign-off.mjs"` (AC-2), `"tracker-rules names both dedupe layers and tracker-readback"`; `skills-ref` passes (CI).

### G18

#### TASK-037: M1 manifest, `FACTORY.md`, README guarantees + standalone section, `instructions.md`, `security-evidence` SKILL.md
**Story:** US-029, US-003 AC-3, US-030 AC-3 (README sequence) · **Assigned:** js-dev · **Depends on:** TASK-036, TASK-035, TASK-034, TASK-011, TASK-056, TASK-006 · **Complexity:** M

**Implementation.** `bundles/security-testing/factory.json` (§4.8 M1), `FACTORY.md` (§4.8), `README.md` (install for the full bundle and the two-skill standalone; the standalone section repeats the TASK-034 command sequence; Guarantees table: one row per §2 left-column promise, columns `Guarantee | enforced by: script | prose | qualification` with "for runs carrying a `COMMITTED` marker produced by the canonical pipeline" on every script row; Not guaranteed section = every §8 item; "Active testing is out of scope in v1"; the tracker row states the two layers and that only the first is promised), `instructions.md` (opens with the role-scoped sentence; four rules; artifact map §3.2; token table), `knowledge/` (TASK-007), `skills/security-evidence/SKILL.md` (`metadata.version` **equal to `scripts/version.json` `tool_version`**, command index incl. `run snapshot *` and `register render`, schema index, "every string is redacted"), `briefings/security-reviewer.md` (TASK-036).

**Verification.**
- [ ] `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` exit 0 (US-029 AC-3) — marketplaces regenerated in the same PR.
- [ ] `manifest.test.mjs` (under `security-evidence/scripts/`): `"factory.json equals the M1 contract"` (AC-1), `"FACTORY.md fields and exactly five use_cases; no project_deployments"` (AC-2), `"README Guarantees table has a row per §2 promise and the Not-guaranteed list has all twelve §8 items"` (AC-4, US-003 AC-3), `"no file under bundles/security-testing or generated marketplaces contains 'exact checkout'"` (AC-5), `"instructions.md opens with the role-scoped sentence"` (AC-6), `"SKILL.md metadata.version equals version.json tool_version"` (P5), `"seed installs knowledge/ with engagement.md.template and finding-schema.md"` (AC-7 — runs `bin/init.mjs init --factory security-testing --target claude --yes` into a temp dir **through the TASK-056 harness**, no network).

### G19

#### TASK-038: Installed end-to-end tests, offline, both shapes + remaining §12 fixtures
**Story:** US-030 (AC-1 M1 portion, AC-2…AC-5), US-028 AC-4, US-007 AC-3, US-004 AC-5 · **Assigned:** qa-engineer · **Depends on:** every M1 task (056, 037, 058, 059, 032, 030, 025, 033, 018, 017 named; the rest transitively) · **Complexity:** L

**Implementation.** `scripts/e2e.test.mjs` (`node --test`; skip with `SDLC_E2E=0`), built on the TASK-056 harness (`externals: [systematic-debugging]`) and `fixtures/repo/build.mjs`. Exports `STANDALONE_SEQUENCE` (TASK-034's test reads it). **Path (a), full bundle:** `node bin/init.mjs init --factory security-testing --target claude --yes` → assert `memory` and `knowledge-curation` were copied from the monorepo `skills/` and `systematic-debugging` from the cache, no `https://` fetch (US-030 AC-1, M1 portion — see §4.8 for why `verifying-outcomes`/`issue-tracking` are asserted in TASK-048) → `engagement init` (bare repo: exit 2 `EDIT-ENGAGEMENT-AND-RERUN`; the test edits `engagement.md` with `require_dispositions: none`; re-run exit 0) → `run init --kind assessment` → `scope` → `packet --kind scope` → *test authors* `claims-1.json` + `examined-1.json` naming that packet → `ingest sarif` → `gate --claims` → `coverage --examined` → `packet --kind subject` → *test authors* a `vulnerability-review` receipt → `receipt validate` → `verify.mjs all` pass 1 → *test authors* `not-refound` + `ack` receipts → `verify.mjs all --receipts` pass 2 (new verify run, COMMITTED) → `register add` → (pass 2 already consumed; assert row `fixed`) → `run snapshot verify --from <pass-2 run>` → `run snapshot register` → `run snapshot proposals` → *test writes* the empty enveloped `threat-model.json` (TASK-024) → `build-report --template assessment` → `check --integrity --drift` → `register render` → `sign-off` ⇒ every exit 0 (AC-2). **Path (b), two-skill:** `--skills security-testing/secure-code-review,security-testing/security-evidence` → exactly `STANDALONE_SEQUENCE` (TASK-034) → `sign-off` ⇒ `4 NO-ASSESSMENT`, no `UNGATED`, no step exits 2 for a missing template (AC-3, US-007 AC-3). **Remaining §12 fixtures** inside the installed pipeline: manual-qa run report through `ingest qa-run`; positive tests + `indeterminate` fix-review; changed ignored product file at sign-off; the full four-step dirty-snapshot sequence; `.gitignore` hash unchanged by everything but `engagement init` (US-004 AC-5); `git status --porcelain` shows nothing under managed paths; byte-equality of two identical runs with `SECURITY_EVIDENCE_NOW` fixed (G-1); four-target install shape for the reviewer agent (`claude|cursor|codex|copilot`).

**Verification.**
- [ ] `e2e.test.mjs: "offline provisioning — memory/knowledge-curation from monorepo, systematic-debugging from cache, no https fetch"` (US-030 AC-1 M1 portion), `"full-bundle path (a) exits 0 through sign-off"` (AC-2), `"two-skill path (b): sign-off exits 4 NO-ASSESSMENT, no UNGATED"` (AC-3), `"additional §12 fixtures"` (AC-4), `"every script has a sibling *.test.mjs"` (AC-5), `"security-reviewer appears in every host's native shape"` (US-028 AC-4), `".gitignore untouched by the pipeline after init"` (US-004 AC-5).
- [ ] `npm test` green in CI with no network.

### G20 (M2 / M3 tasks whose dependencies are all M1)

#### TASK-039: `threat-modeling` skill + `tm-lint.mjs check|render`
**Story:** US-031 · **Assigned:** js-dev · **Depends on:** TASK-038, TASK-022, TASK-029, TASK-014, TASK-058 · **Complexity:** L

**Implementation.** `skills/threat-modeling/SKILL.md` + `references/{dfd-elements,stride,mitigations-as-claims,dispositions}.md`; `lib/cmd-tm-lint.mjs` per §4.4 — relationship validation: `planned` ⇒ proposal file listed in `proposals-index.json` or `admissions/<case_sha256>.json` exists; `executed` ⇒ `observations/<id>.json` exists; `ticketed` ⇒ an `ingest tracker-readback` record whose trusted `body_contains_finding_id` is true for the threat id; `accepted` ⇒ register row in `register-events.json` snapshot with `subject == threat id && status == accepted`; `mitigated` ⇒ `applyReceipts` yields `MITIGATION_CONFIRMED` for that mitigation id; `render` writes Markdown from JSON; `build-report --template threat-model` required inputs wired (TASK-024 stub replaced).

**Verification.**
- [ ] `cmd-tm-lint.test.mjs: "element without citation fails naming it"` (US-031 AC-2), `"one threat per disposition value validates; dangling reference fails with threat id and relationship"` (AC-3), `"render produces Markdown from JSON; threat-model template inputs"` (AC-4); `skills-ref` passes (AC-1).

#### TASK-045: Tracker read-back → `ticketed` event, `fix_prompt` generator
**Story:** US-039 AC-2, AC-3 (event), AC-4 · **Assigned:** js-dev · **Depends on:** TASK-031, TASK-017, TASK-029 · **Complexity:** S

**Implementation.** `lib/fix-prompt.mjs` (routes to `bugfix-workflow` with finding id, `context_redacted`, and the exact `verify.mjs all --finding <id> --base <oid> --head <oid>` command the developer must report back; replaces TASK-031's stub); `cmd-ingest.mjs` post-step for `tracker-readback`: when the record's trusted `url` host ∈ `targets.tracker` and `mismatch` is empty ⇒ `register-core.append({row_id: <row with subject == finding_id>, event: "ticketed", payload: {ticket_url, import_sha256}})` and print `TICKETED <R-id> <url>`; mismatch or foreign host ⇒ `READBACK: MISMATCH(<field>)` and **no event**; no row ⇒ `READBACK: ok (no register row)`.

**Verification.**
- [ ] `cmd-publish.test.mjs: "fix_prompt names bugfix-workflow and the verify command"` (US-039 AC-4); `ingest-tracker.test.mjs: "read-back with matching fields ⇒ ticketed event sets ticket_url, status unchanged"` (AC-2, AC-3), `"mismatch or foreign host ⇒ no event"`, `"subsequent publish --profile tracker dedupes on the recorded ticket_url"` (AC-3 end to end).

#### TASK-046: `risk-register` skill (prose)
**Story:** US-040 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-029, TASK-059 · **Complexity:** S

**Implementation.** `skills/risk-register/SKILL.md` (frontmatter `name, description, license, metadata`; body: what a row is, the §4.3 transition table rendered as prose with every `from → to` pair, the emitter-only events and why the lead cannot append them by hand, the approval record shape with `authenticated: false` and the sentence "there is no confirmed state — no command creates one", open exposure never reduced by approvals, `anchor print` and where to keep the anchor outside the repo, `register.mjs render` and that `risk-register.md` is the injected view) + `references/{transitions,approvals,anchor}.md`; no `scripts/`.

**Verification.**
- [ ] `risk-register.test.mjs: "no scripts/; every event of register-transitions.TRANSITIONS and the approval record shape are described; text says there is no confirmed state; render is named"` (US-040 AC-1, AC-2); `skills-ref` passes (AC-3).

### G21

#### TASK-040: `threat-modeler` agent
**Story:** US-032 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-039 · **Complexity:** M

**Implementation.** `agents/threat-modeler/{AGENT.md,SOUL.md}`, `briefings/threat-modeler.md`; return line `MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>` only after `tm-lint check` exit 0, else the lint error verbatim; mitigations as claims — a `mitigation-review` is a separate `security-reviewer` dispatch over a subject packet. Not yet in `factory.json` (TASK-048).

**Verification.**
- [ ] `agents.test.mjs: "threat-modeler frontmatter equals §4.7; body has the four rules and the return-line rule"` (US-032 AC-1…AC-3); repo frontmatter tests pass.

#### TASK-041: `sign-off` disposition policy
**Story:** US-033 · **Assigned:** js-dev · **Depends on:** TASK-039, TASK-033 · **Complexity:** S

**Implementation.** `cmd-sign-off.mjs`: read latest assessment's `dispositions.json`; policy `all` ⇒ any `undisposed|planned` ⇒ `4 DISPOSITIONS(<ids>)`; default `executed-or-ticketed` ⇒ list only; `none` ⇒ not evaluated; add the token to `FAIL_CAUSES` (TASK-035's checklist test picks it up — update the checklist in the same PR).

**Verification.**
- [ ] `cmd-sign-off.test.mjs: "default policy lists undisposed/planned and exits 0"`, `"all ⇒ exit 4 naming threat ids"`, `"none ⇒ not evaluated"` (US-033 AC-1…AC-3); `security-engagement.test.mjs` still green.

### G22

#### TASK-042: `security-test-planning` skill + `plan.mjs admit|propose`
**Story:** US-034, US-038 · **Assigned:** js-dev · **Depends on:** TASK-041, TASK-022, TASK-021 · **Complexity:** M

**Implementation.** `skills/security-test-planning/SKILL.md` + `references/passive-admission.md` (allowed-operation grammar + forbidden-pattern list; wording "admitted by lint or by review", never "safe"); `lib/cmd-plan-admit.mjs` (lint over step text; unknown operation ⇒ `proposal`; forbidden hit ⇒ `proposal` with `lint_hits`; **`--receipt <sha256>` must name an admitted receipt in the run of type `vulnerability-review` whose `packet_sha256` is a `packet --kind subject --type case` packet over this case file and whose assertion is `confirmed` ⇒ `admitted-reviewed` with `receipt_sha256`; `refuted` or `indeterminate` ⇒ `proposal` (reason `review-not-confirmed`)** (P5, §9.1)); `lib/cmd-plan-propose.mjs` (proposal frontmatter validation; refuses `tasks/`).

**Verification.**
- [ ] `cmd-plan.test.mjs: "admission payload shape"` (US-034 AC-1), `"unknown effect ⇒ proposal"` (AC-2), `"step with an injection payload ⇒ proposal with lint hit"` (AC-3), `"admitted-reviewed only with a confirmed vulnerability-review receipt on the case packet; refuted/indeterminate ⇒ proposal; receipt on a different packet ⇒ exit 4"` (AC-4, P5), `"proposal under tasks/ ⇒ planner refuses"` (US-038 AC-2), `"proposal frontmatter validated; authorization stub authenticated:false"` (US-038 AC-1); `skills-ref` passes (AC-5).

### G23

#### TASK-043: Admitted hand-off suite — `publish --profile case|handoff`, audit-branch expression, sign-off unadmitted listing
**Story:** US-035, US-025 AC-6, US-038 AC-3 · **Assigned:** js-dev · **Depends on:** TASK-042, TASK-031, TASK-033 · **Complexity:** M

**Implementation.** `lib/profiles/case.mjs` (only `admitted-*` cases from `<run>/admissions/`, manual-qa TC format verbatim per `bundles/manual-qa/knowledge/test-case-format.md`, priority map p0→critical p1→high p2→medium p3→low, `tags: [security]`, written to `tasks/security-<slug>-admitted/` and nothing else there); **header/cookie checks are expressed via the manual-qa audit branch** (§9.2): a case whose admitted steps assert a response header or cookie attribute (`Set-Cookie` flags, `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, …) is emitted with the `audit` step form the manual-qa `qa-auditor` consumes (read `bundles/manual-qa/agents/qa-auditor/AGENT.md` for the exact step grammar and expected-result table; the case never instructs a browser action beyond "open URL, inspect response"); the mapping table `security-check → audit step` lives in `references/audit-branch.md` of `security-test-planning`; `lib/profiles/handoff.mjs` (exact two-line prompt of §9.2 to `<st>/handoffs/<slug>.md` and stdout); `cmd-sign-off.mjs` `UNADMITTED:` list = files in the suite whose sha256 has no admission record.

**Verification.**
- [ ] `cmd-publish.test.mjs: "three admitted + one proposal ⇒ exactly three TC files and nothing else"` (US-035 AC-1), `"case parses as a manual-qa TC (parser = the manual-qa format fixture from TASK-018); priority map"` (AC-2), `"a header/cookie case is emitted in the audit-step form and contains no browser-action step"` (AC-2 audit branch), `"handoff prompt text exact"` (AC-3), `"no proposal path or text in handoff/case output"` (US-038 AC-3).
- [ ] `cmd-sign-off.test.mjs: "extra TC placed in the admitted suite by hand ⇒ listed as unadmitted"` (§12; US-025 AC-6, US-035 AC-4).

#### TASK-051: `execution-authorization` design note (both QA bundles)
**Story:** US-045 · **Assigned:** js-dev · **Depends on:** TASK-042 · **Complexity:** S

**Implementation.** Identical note under `bundles/manual-qa/docs/execution-authorization.md` and `bundles/test-automation/docs/execution-authorization.md` (docs only); describes the proposal frontmatter and `authorization` fields with `authenticated: false`; `bin/check-skill-dupes.mjs` group for the two copies.

**Verification.**
- [ ] Both bundles' tests and `validate:factories` green; `npm run validate:dupes` passes with the new group.

### G24

#### TASK-044: Observations from `qa-run`, TA hand-off prompt, `ta-report` per-unit records
**Story:** US-036, US-037 · **Assigned:** js-dev · **Depends on:** TASK-043, TASK-018 · **Complexity:** M

**Implementation.** `cmd-ingest.mjs` post-step for `qa-run`: per result row with an admission ⇒ `<run>/observations/<observation_id>.json` (`observation_id = "O-" + sha256(import_sha256\0case_id)[0:12]`, `case_sha256` from the admission, unknown fields `unknown`) and `run-index.appendIndex(…, "observations.json", {observation_id, sha256})`; rows without admission ⇒ candidate in `unlocated.json` with reason `unadmitted-case`; `FAIL` observations render under report section 9; `plan.mjs ta-prompt` per §4.5; `ta-report` per-unit records into `<run>/ta-units.json` (partial coverage kept per assertion).

**Verification.**
- [ ] `observations.test.mjs: "observation shape; unknown never blank; observations.json index gains the entry"` (US-036 AC-1), `"unadmitted case ⇒ unresolved candidate"` (AC-2), `"FAIL renders in section 9; mitigation needs a separate mitigation-review receipt"` (AC-3), `"ta-prompt carries cases{id,title,path}, slug, base; no proposal; includes not-yet-VERIFIED cases"` (US-037 AC-1, AC-4), `"per-unit records; partial coverage per assertion"` (AC-2).

### G25

#### TASK-047: `security-lead` agent + briefing + `assess` flow
**Story:** US-041 · **Assigned:** js-dev (writing-skills) · **Depends on:** TASK-043, TASK-044, TASK-045, TASK-046, TASK-035, TASK-059 · **Complexity:** L

**Implementation.** `agents/security-lead/{AGENT.md,SOUL.md}` (§4.7 frontmatter — `context-docs` third entry `security-testing/risk-register.md` is produced by `register.mjs render` (TASK-059), which the `assess` procedure runs after every register mutation; `assess` order of US-041 AC-2 as a numbered procedure with the exact commands in the P1/P2 order: `engagement init` → `run init --kind assessment` → `scope` → `packet --kind scope` → dispatch `security-reviewer` (`review`) → `gate --claims` → `coverage --examined` → `packet --kind subject` per accepted finding → fresh dispatches (`vulnerability-review`) → `receipt validate` → threat-modeler dispatch → `tm-lint check` → mitigation packets + `mitigation-review` dispatches → `plan.mjs admit` → `publish --profile case|handoff` → hand-off prompt printed, **stop** → (later) `ingest qa-run` → `verify.mjs all` two-pass → `run snapshot verify|register|proposals` → `build-report --template assessment` → `check` → `register render` → `sign-off`; tracker: `publish --profile tracker` → search live tracker via `issue-tracking` → post → `ingest tracker-readback --sent`; proposes `accept` with human-supplied `--approved-by/--approval-ref`; the four rules; self-check before writes), `briefings/security-lead.md`.

**Verification.**
- [ ] `agents.test.mjs: "security-lead frontmatter equals §4.7; no mcpServers; assess procedure lists the commands in the P1/P2 order and ends with hand-off + stop; proposes never approves; tracker section names both dedupe layers"` (US-041 AC-1…AC-4); briefing lands at `.agents/memory/security-lead/project_briefing.md` on install (AC-5, via the TASK-056 harness).

### G26

#### TASK-048: Final manifest + E2E roster extension
**Story:** US-042, US-030 AC-1 (M3 portion) · **Assigned:** js-dev · **Depends on:** TASK-040, TASK-047, TASK-056 · **Complexity:** S

**Implementation.** `factory.json` final (§4.8); `briefings/` ×3; `e2e.test.mjs` path (a) re-run with the full roster and the harness provisioning `systematic-debugging` **and** `dispatching-parallel-agents` offline; **US-030 AC-1 assertions that belong here** (§4.8 table): `verifying-outcomes`, `gathering-context`, `deep-research` copied from monorepo `skills/`; `issue-tracking` resolved via the item index to `bundles/feature-development/skills/issue-tracking` (a one-line "appears in more than one factory" notice is acceptable output, a fetch is not). Risk flagged in §8: if `planFactory`'s `isResolvable` does not see bundle-owned ids for a `--factory` install, `issue-tracking` needs a `skillOverlays` entry or an installer fix — spike at the start of this task (30 min).

**Verification.**
- [ ] `manifest.test.mjs: "factory.json equals the final contract"` (US-042 AC-1); `npm run validate` (with network) exit 0 (AC-2); `npm test` green including both E2E paths with the full roster (AC-3); `e2e.test.mjs: "full roster: verifying-outcomes/gathering-context/deep-research from monorepo, issue-tracking from the feature-development bundle, externals from cache, no https fetch"` (US-030 AC-1 M3 portion).

### G27

#### TASK-049: manual-qa follow-up PR (Step 0 row + explicit-list proposal)
**Story:** US-043 · **Assigned:** js-dev · **Depends on:** TASK-048 · **Complexity:** S

**Implementation.** One row in `bundles/manual-qa/agents/test-run-lead/AGENT.md` Step 0 routing table pointing at `tasks/security-<slug>-admitted/`; a proposal paragraph for an explicit-list intake branch marked nice-to-have (§9.2 M4).

**Verification.** Row present; manual-qa tests + `validate:factories` green; `git diff --stat` shows one file.

#### TASK-050: feature-development follow-up PR (`code-review` pointer)
**Story:** US-044 · **Assigned:** js-dev · **Depends on:** TASK-048 · **Complexity:** S

**Implementation.** One line in `bundles/feature-development/skills/code-review/SKILL.md` § 2 pointing to `secure-code-review` for security-class findings and to `verify.mjs all` for fix verification.

**Verification.** `skills-ref` + `validate:factories` green; `git diff --stat` shows one file.

#### TASK-052: Catalog rows, marketplaces, final docs
**Story:** US-046 · **Assigned:** js-dev · **Depends on:** TASK-048 · **Complexity:** S

**Implementation.** `README.md` catalog: a `security-testing` row naming the three local agents and six local skills with the §10 description sentence; `AGENTS.md` consumer summary row; `bundles/SPEC.md` "Current factories" row; `npm run gen:marketplaces` (Cursor/Codex/Copilot manifests regenerated — never hand-edited); `.claude-plugin/marketplace.json` hand-curated entry added; the bundle `README.md` install section cross-linked from the root README.

**Verification.**
- [ ] `README.md`, `AGENTS.md` and `bundles/SPEC.md` rows present (US-046 AC-1); `npm run gen:marketplaces && npm run validate:marketplaces` exit 0 and each security agent/skill appears once (AC-2); `grep -r "exact checkout"` over the catalogs is empty and the description is the §10 sentence (AC-3).

### G28

#### TASK-053: Four-target + two-skill smoke (documented)
**Story:** US-047 · **Assigned:** qa-engineer · **Depends on:** TASK-052 · **Complexity:** M

**Implementation.** `scripts/smoke.test.mjs` (opt-in `SDLC_SMOKE=1`; uses the TASK-056 harness): four `bin/init.mjs init --factory security-testing --target <t> --yes` runs into temp dirs assert native shapes, `SKILLS-INJECTED` for non-Claude, `<!-- FACTORY:security-testing START/END -->` splice; two-skill path runs `STANDALONE_SEQUENCE` through `check` ⇒ `CONSISTENT`; commands and expected outputs recorded in the bundle README install section.

**Verification.** Smoke passes on all four targets; README section matches the script's commands (test compares).

### G29

#### TASK-054: Dogfood `assess` on sdlc-skills
**Story:** US-048 · **Assigned:** maintainer · **Depends on:** TASK-053 · **Complexity:** M

**Verification.** A `COMMITTED` assessment run exists; `sign-off` exits 0 under default policy; `check --integrity --drift` ⇒ `CONSISTENT`, `CURRENT`, `ORIGIN: unauthenticated`, `KEY: available`; `git status --porcelain` shows only the managed block, `engagement.md`, `risk-register.md` and intended publications; redacted report kept under `docs/superpowers/notes/`; every finding has a register row.

---

## 6. Spikes

#### SPIKE-001: Offline external provisioning through the installer's cache path — **executed, resolved** (v1, unchanged)
**Question:** Does `bin/init.mjs`'s `shallowClone` (`git fetch --depth 1 origin <ref>` when `<cache>/<repo>/.git` exists, then `checkout FETCH_HEAD`) succeed against a pre-populated clone whose `origin` is a local bare repo while a `GIT_CONFIG_GLOBAL` `insteadOf` rewrite makes every `https://github.com/` URL unreachable?
**Output:** `FETCH_OK`, `CHECKOUT_OK`; the GitHub clone failed with `'/nonexistent/obra/superpowers' does not appear to be a git repository`. **Yes.** Watch-outs: cache dir name is `repo.replace("/", "__")`; the E2E must `git clone` (not copy) into the cache. Frozen into code by TASK-056. Second finding (G-12): `node --test` sweeps every `*.mjs` under any directory literally named `test/`; fixture dirs must never be named `test`.

#### SPIKE-002 (scheduled inside TASK-048, 30 min): bundle-owned skill id resolution under `--factory`
**Question:** Does `planFactory`'s `isResolvable(id)` (`catalog.skills.includes(id) || registry repo`) return true for `issue-tracking`, an id owned only by the feature-development bundle, when installing `--factory security-testing`? **Approach:** run `node bin/init.mjs init --factory security-testing --target claude --yes --dry-run`-equivalent through the harness and read the plan. **Output:** yes ⇒ nothing to do; no ⇒ either add `skillOverlays` or a one-line installer fix in the same PR, and record it in §8.

---

## 7. Architecture guardrails (specific to this bundle)

A PR that violates any of these is sent back regardless of test results.

- **G-1 No clock in any preimage.** `Date.now()` / `new Date()` appear only inside `ctx.now()`; `created_at` and register `ts` are the only consumers; nothing under `payload` ever carries a timestamp, a duration, a hostname, a tmp path or a PID. Test: `canon.test.mjs "scope identity independent of envelope"` and the E2E's byte-equality across two runs with `SECURITY_EVIDENCE_NOW` fixed.
- **G-2 No plain sha256 over content that can match a redaction rule.** Range bytes, file bytes, snapshot originals, install-modified trees, suppression line content: HMAC with the engagement key, or sha256 of the *redacted* form. Plain sha256 is for canonical payloads, redacted import bytes, executables and git metadata only. Reviewer greps every `sha256Hex(` call site.
- **G-3 Read → HMAC → redact → persist, in that order, in one function.** Every writer of external or working-tree bytes goes through `imports.snapshotImport` or `cmd-scope`'s snapshot path. No second implementation.
- **G-4 Every string that leaves memory passes `redact.mjs`** — artifacts (`writeArtifact` calls `redactDeep` on the payload before hashing unless `{prered: true}` for bytes already redacted by G-3), stdout, stderr, prompts, ticket payloads, test output, `risk-register.md`. A new `console.log`/`writeFileSync` outside `ctx.out()`/`fsx` is a review finding.
- **G-5 Only `cmd-engagement.mjs` step 1 touches `.gitignore`;** only `publish --to` writes outside `<st>/**`, `.agents/memory/<role>/**`, `reports/security/**`, `tasks/security-*/**`.
- **G-6 `shell: false`, argv arrays, explicit `cwd` and `env`, always.** No `exec`, no `execSync("string")`, no template literals into a command, no `npx` spawned by the scripts. Test argv comes only from `engagement.execute_project_tests`; any other source of argv (SARIF, ticket, PR, doc, claims) is data.
- **G-7 Scripts derive; agents assert.** No CLI accepts an `id`, `state`, `verdict` or `*_sha256` from an agent-authored file as truth, except the `packet_sha256` a claims/examined/receipt file **names** (which the script re-verifies against the run's packets); `receipt validate` and `gate` reject inputs that carry ids or states. No script **writes** into `<st>/receipts/` (`purge` may delete it).
- **G-8 No `confirm`, no `authenticated: true`, no confirmed state.** Grep-guarded by `schema.test.mjs`. Approval-like records always carry `authenticated: false`. `status` never subtracts an approval from open exposure. (`confirmed` as a receipt assertion is the reviewer's word about a finding, a mitigation or a passive case — never about an approval.)
- **G-9 Pure cores.** `gate-core`, `packet-core`, `states.applyReceipts`, `evaluate`, `register-core.replay`, `register-transitions`, `render`, `register-render` import nothing from `node:fs`, `node:child_process` or `lib/git.mjs`; `check` re-runs exactly these. Each has a "pure" import-guard test.
- **G-10 Nothing is rewritten inside a run — except the TL-14 index files.** After `run init`, files under `<run>/` are created once (`writeExclusive`); `imports.json`, `observations.json`, `proposals-index.json` are rewritten tmp+rename under `withRunLock` and only through `run-index.appendIndex` (or `run snapshot proposals`); `build-report` writes `report.md`, `manifest.json`, `COMMITTED` last; after `COMMITTED` nothing under the run is written by anyone (`run snapshot` refuses `RUN-COMMITTED`); retry = new seq. The register appends; it never edits `events.jsonl`.
- **G-11 Stdlib ESM only; no build; no shell scripts; no dependencies.** No `package.json` under the skill; no `.sh`; Node ≥ 18 APIs only.
- **G-12 Fixtures never live in a directory named `test`;** use `scripts/fixtures/<area>/`. Fixture repos are built by code into temp dirs, never committed as `.git` directories. Fixtures that mirror another bundle's format are paired in `check-skill-dupes.mjs` (TASK-018, TASK-007, TASK-051).
- **G-13 Exactly the spec's tokens.** Result strings are constants exported from `lib/tokens.mjs`. `UNGATED` and `exact checkout` are forbidden strings (grep test).
- **G-14 No network anywhere in `scripts/`;** no `fetch`, `node:http(s)`, `net`, `dns`. The tracker call belongs to the lead's `issue-tracking` skill (P4); the scripts produce the payload file and read back the response file.
- **G-15 Cross-task file ownership.** A task edits only its own `cmd-*.mjs`/`lib/*.mjs` plus one dispatch line in the entry script and its rows in `lib/tokens.mjs`; shared modules (`canon`, `redact`, `normalize`, `schema`, `git`, `fsx`, `cite`, `states`, `packet-core`, `run-index`) change only through a task that names them in Implementation, with the owning test extended. `cmd-engagement.mjs` is written by TASK-008 only; 009/010/011 ship modules.
- **G-16 Nothing reads outside the run directory during `build-report` or `check` recompute** except git objects, the working tree (drift/integrity) and the key. The live register, the ledger and other runs are reachable only through `run snapshot` (TL-3/P2) and through `sign-off`, which is the one command that walks the ledger.

---

## 8. Handoff to PM

- **Counts:** 59 tasks (M-1: 1 · M1: 41 · M2: 3 · M3: 7 · M4: 3 · M5: 4), 1 spike executed + 1 scheduled (inside TASK-048), **19 dependency groups in M1 (G1–G19) plus G0**, 10 more to M5 (G20–G29), critical path **20 steps** (§1).
- **Start now (G0/G1, five devs):** TASK-001 docs; then TASK-003 normalize, TASK-004 redact, TASK-005 schemas (L — the shapes are the contract; assign a careful dev), TASK-056 offline harness (qa-engineer). TASK-002 canon starts the moment 004 merges. TASK-026 evaluate and TASK-028 register core are the two longest independent branches after G3 and keep two devs busy while the scope→gate chain is sequential.
- **Bottlenecks:** TASK-019 `gate` (single dev, everything downstream waits) and TASK-025 `check` (fan-in of render, evaluate, replay). The chain 021 → 022 → 023 → 027 → 024 is one dev's week; do not split it across people.
- **Sequencing rules the PM must hold:** `cmd-engagement.mjs` is written only in TASK-008 (009/010/011 ship modules and land before it). TASK-057 (scope packet) must land before TASK-021 and before TASK-034/036 are written, or the reviewer prose will describe the wrong input. `factory.json` is created only in TASK-037. TASK-038 last in M1 and blocks M2. 045/046 may start as soon as M1 closes even though they ship in M3.
- **Decisions the PM/maintainer should confirm before G6:** TL-13 (`artifact_policy` keys; `private` never committable), TL-14 (index files are the only rewritten files in a run), TL-15 (claims name their scope packet). Everything else in §2 is confirmed or applied per the rulings.
- **Risks:** (1) SPIKE-002 — `issue-tracking` resolution for a `--factory` install of a bundle-owned id (TASK-048 owns it; if it fails, an installer one-liner or a `skillOverlays` entry). (2) `ingest qa-run`/`audit`/`ta-report`/`case` parse other bundles' formats — the verbatim fixtures are now under `validate:dupes`, so an upstream format change fails CI here instead of at a consumer. (3) The M1 assessment E2E needs an empty threat-model artifact until M2 — documented in TASK-024/038. (4) `verify all` runs project tests inside an OS temp worktree; the allowlist in §4.2 must be agreed before TASK-027. (5) `risk-register.md` sits outside the ignore block by design (it is the injected context-doc); it will show as a working-tree change after every `register render` — TASK-054 lists it as an intended change.
- **Nothing in this plan changes a §2 promise or a §3 decision.** The five P amendments are represented one-to-one: P1 → 057/021/036/034; P2 → 012/058/024; P3 → 011/008/010/032/TL-8/TL-13; P4 → 031/045/035/047; P5 → 029/059/006/023/037/033/042/026/027.

Ready to distribute.

### SPIKE-002 outcome (executed inside TASK-048, 2026-09-17) — **resolved: yes, nothing to do**

Run through the TASK-056 harness (`init --factory security-testing --target claude --yes`, final manifest, one `obra/superpowers` fixture remote serving both `skills/systematic-debugging` and `skills/dispatching-parallel-agents`, https rewritten to `/nonexistent/`): exit 0, 21 installed, no https URL in the output. `issue-tracking` landed byte-identical to `bundles/feature-development/skills/issue-tracking/SKILL.md` (not the test-automation copy) with exactly one notice line — `"issue-tracking" exists in feature-development, test-automation — using feature-development. Qualify as <factory>/issue-tracking to pick another.` — and no fetch. **Why:** `planFactory`'s `isResolvable` (`catalog.skills.includes(id) || registry repo`) governs only `skillOverlays.add`; skills declared by local agents go straight into `extraSkillIds`, which `main()` partitions with `partitionSkillIds(…, catalog.index)` → `itemKnown(index, "skills", id)` sees every factory's `skills/` and `resolveItem` picks the alphabetical-first owner. So no `skillOverlays` entry and no installer edit; `factory.json` stays exactly §4.8 "Final". `verifying-outcomes`, `gathering-context`, `deep-research` came from the monorepo `skills/`; both externals from the cache clone. Pinned by `e2e.test.mjs` "full roster: …" (US-030 AC-1 M3 portion) and re-asserted per host by the US-028 AC-4 test. Risk (1) above is closed.

### TASK-048 deviation record (the `dispositions` G-15 edit; spec §20 P2, R1, G-10)

The PM ruling for TASK-048 named two edits: (a) add `dispositions` to `inputs.REQUIRED.assessment`; (b) make `run init --kind assessment` write an empty `dispositions.json`. **(a) is taken; (b) is not**, on the ruling's own escape hatch ("keep write-once semantics: tm-lint check must then be idempotent on an identical index") and spec P2:

- `dispositions.json` is write-once and script-derived by `tm-lint.mjs check` (R1; `persist` refuses a differing existing index with `5 INCONSISTENT(dispositions)`). Probed on the branch: a run-init-shaped placeholder `{dispositions: []}` followed by `tm-lint check` over a one-threat model ⇒ **exit 5 `INCONSISTENT(dispositions)`**; only the empty model is idempotent (exit 0, both WROTE lines). A placeholder would therefore break the threat-modeler's flow on every real model — a shared contract TASK-053/054 build on — and would also defeat the G-7 goal of (a) (an un-linted model would COMMIT beside a placeholder index). Rewriting it instead would make it a TL-14 index, which its manifest role (identity enters `inputs.dispositions`) contradicts.
- Spec P2 lists exactly which empties `run init` writes (`observations.json`, `imports.json`, `proposals-index.json`) and makes the snapshot's absence the `INCOMPLETE(threat-model)` signal; the index is the snapshot's twin, so **absence ⇒ `3 INCOMPLETE(dispositions)`**, written only by `tm-lint check`. `cmd-run.mjs` is untouched; `cmd-run.test.mjs` pins the absence with the reason.
- Consequences taken in the same PR (all from the REQUIRED change, no module edit beyond `inputs.mjs` + `templates/assessment.md`'s required-inputs block, which `cmd-build-report` requires to agree): the assessment fixtures of `cmd-build-report.test.mjs`, `cmd-check.test.mjs`, `inputs.test.mjs` plant the empty index beside the empty model; `render.test.mjs`'s parseTemplate pin gains the entry; `cmd-sign-off.test.mjs`'s `committedRun` defaults the index to the one lint derives for `EMPTY_MODEL`, and the two TASK-041 tests that relied on a COMMITTED assessment *without* an index now assert the tightened invariant — build-report `3 INCOMPLETE(dispositions)`, sign-off `NO-ASSESSMENT`, no threat ever listed — plus the post-COMMIT tamper case reads `INCONSISTENT(dispositions.json)` from the run's own `check` (closeOver's file-name spelling) before sign-off's index read. `cmd-sign-off.mjs`'s "not linted" branch stays as defensive code (reachable only by hand-built run dirs). The TASK-041 foreign-envelope nit (PM log after G21) is closed by `ownRun` and pinned in `inputs.test.mjs`.
- E2E path (a) no longer hand-plants the M1 empty snapshot: it writes `<st>/threat-model.json` (`{elements: [], threats: []}`, outside the ignore block — commit by policy, plan §3.2) and runs the **installed** `tm-lint check`, asserting `TM elements=0 threats=0 undisposed=0` + both WROTE lines and idempotence on the re-run. Risk (3) above is closed.
- `lib/tokens.mjs`: no rows added by this task (no new token). `validate:marketplaces` remains stale until TASK-052 regenerates (unchanged here, as routed).


---

## 6. PM log — plan fixes owed before later groups (from the second critic pass, 2026-09-16)

Recorded by Max so they are not lost; Rio applies them in place before the named group starts.

| Before | Fix |
|---|---|
| G5 | D18 clean-tree vs bundle-created files — **settled by spec P6** (cleanliness over `scope_paths ∪ product_paths`, bundle-managed paths excluded). TASK-012, TASK-038 path (a), TASK-047 `assess`, TASK-054 to be aligned to P6; TASK-054's self-contradiction removed. |
| G6 | TASK-026's fixture builder must emit hash-consistent `packets/<sha>.json` and `receipts/<sha>.json` alongside each `verify.json`, and TASK-058's fake `COMMITTED` marker must match TASK-023's format. |
| G7 | Declare 057 → 014 and 020 → 057; move 057 to G8; declare 019 → 057 and 031 → 017. TASK-020 exports a pure `computeCoverage(scope, examined, scannerRows)` core with an import-guard test. |
| G12 | Break the 027 ↔ 024 cycle: `templates/verify.md` + its required-inputs block and VERDICT rendering move into TASK-023. |
| G14 | TASK-024's "incomplete runs" substitution needs a TL reading (TL-16) or a `run snapshot ledger` input — decide before G14. |
| G13 | Add `ticket-payload` and `ta-units` shapes to TASK-005's schema list (payload-only or enveloped — state which); TASK-021 owns `packet --kind subject --type case` and TASK-042 lists `cmd-packet.mjs`; candidate (pre-admission) case file location stated. |
| G19 | TASK-038 path (a): `register add` before verify pass 2. |
| now | Stories file: US-030 AC-1 split by milestone; US-024 AC-1 (receipts purged); US-015 receipt type `vulnerability-review`; US-028 four contracts; US-016 AC-2 verify-snapshots; US-004 ten ignore patterns. Alex to amend. |

### Follow-ups from TASK-006 review 2 (Rio, 2026-09-16)

Recorded by the TASK-006 implementer so the file-ownership record is honest and later tasks do not rediscover these mid-task.

| Before | Fix |
|---|---|
| G3 (TASK-002 follow-up) | TASK-006 edited `canon.mjs` although its edit list does not name it (G-15): `writeArtifact(path, artifact, {exclusive: true})` — write-once tmp + link + unlink, EEXIST from the kernel — was added, additive, owning `canon.test.mjs` extended, accepted in review 1. Ownership of that option is TASK-002's. |
| G5 (TASK-012) | The first write-once run-file writer uses `canon.writeArtifact(…, {exclusive: true})` for enveloped artifacts, **not** `fsx.writeExclusive` (raw bytes only: keys, markers). The `ledger/index.lock/` and `<run>/.lock/` locks keep the `fsx` `staleMs` default of 60 s — never lower it (both theft windows are named in the `fsx.mjs` header). Lock dirs live **outside** any tree `fsx.walk()` lists (`<st>/ledger/index.lock/` is fine; a lock under `<run>/` would surface a transient `.probe-*` / `.stale-*` entry in a concurrent manifest build). |
| G3 (TASK-007) | **Done in the TASK-006 review-3 merge** (TASK-007 had landed first): `ctx.engagement()` delegates to `engagement.parseEngagementMd` in one line; `ctx.parseEngagementBlock`, the `ENGAGEMENT_FENCE` regex and the `POLICY-INVALID(private)` check are gone from `ctx.mjs`, and `engagement.mjs` takes `CliError` from `exit.mjs` and its two tokens from `tokens.mjs` (its merge tripwires are green). One parser, not two; `ctx.test.mjs` guards it. |
| G4 (TASK-028) | `register.mjs` usage text carries exit-4 prose (`TRANSITION-REJECTED(<event>: <from>)` / `--subject-equivalent …`) written before `tokens.mjs` had the rows; TASK-028 adds the rows and rewrites the usage line from them. |
| G14 (TASK-027) | Decided in TASK-006 review 2: `git.worktreeAdd` runs `-c core.hooksPath=<dir>/.no-hooks worktree add --detach`, so the consumer's `post-checkout` hook never runs in the verify worktree (guarded by `git.test.mjs`). TASK-027 relies on this and must not re-enable hooks; consumer code runs only through the `tests` step's controls. |
| G16 (TASK-039) | The M1 `tm-lint check` stub prints the invented `2 SCHEMA-INVALID(threat-model: …)`; TASK-039 replaces it with the §4.4 spelling `4 TM-INVALID(<threat\|element>: <reason>)` and drops the `schemaInvalid` call from `cmd-tm-lint.mjs` (`cmd-plan.mjs` keeps `SCHEMA-INVALID(proposal: …)` until the plan task that owns `admit` spells its own). |

### Follow-ups from TASK-006 review 3 (Rio, 2026-09-16)

| Before | Fix |
|---|---|
| G6+ (TASK-015/016/017/018 `ingest`, TASK-019 `gate --claims`, TASK-020 `coverage --examined`, TASK-022 `receipt validate`, every later cmd that reads a user-supplied file) | **check/exit-5 rule, input side** (documented in `lib/exit.mjs`): the dispatcher cannot tell a `CanonError` from `readArtifact` (integrity ⇒ 5) apart from a `CanonError` from `parseStrict` over a user-supplied input (malformed input ⇒ 2). Every command catches parse errors over its **own inputs** and prints its exit-2 token itself; only reads of the bundle's own artifacts may let a `CanonError` escape to the dispatcher. `cmd-tm-lint` / `cmd-plan` show the shape. |
| G4+ (TASK-015/016/017/018, TASK-019, TASK-020, TASK-022, TASK-042 — any cmd taking a file argument) | **One resolution base for user-typed paths**: `ctx.input(command, p)` resolves against the invocation cwd (what the user pointed at), then requires the result under root — outside ⇒ `USAGE(<cmd>: cannot read <p> (outside the work tree))`. `ctx.abs()` is for repo-layout paths the scripts spell themselves (`<st>/…`) only. Prose leads the message and the path follows: a token whose value *starts* with a long absolute path reads as `<cmd>: <high-entropy>` to `redact.mjs` and leaves the process as `<REDACTED:high-entropy-assign>` (the `--help` guard in `cli.test.mjs` pins the same rule for static usage text). |
| G3 (TASK-026 follow-up) | `cmd-evaluate.mjs` reads `<verify.json>` with `readArtifact(file)` straight from argv (process-cwd-relative, no root containment) — it landed before `ctx.input()` existed. The owner of the next `verify.mjs` change (TASK-027) switches it to `ctx.input("evaluate", file)`; behaviour for relative paths is unchanged, paths outside the tree become `USAGE`. |
| G14 (TASK-027) | `git.diffUnified` pins `--src-prefix=a/ --dst-prefix=b/ --submodule=short` (with `--no-color --no-ext-diff --no-textconv --no-renames`), so a consumer's `diff.noprefix` / `diff.mnemonicPrefix` / `diff.submodule` cannot change the `+++ b/<path>` line or the hunk body the suppression scanner keys on (guarded by `git.test.mjs`). `git.worktreeAdd` now refuses a relative `dir` (a relative `core.hooksPath` resolves against the work tree). |
| all test-writing tasks | The CLI harness (`fixtures/cli/harness.mjs`) is hermetic: its own `git()` and every `runScript` child run with `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` pointing at a harness-owned empty file (`HERMETIC_GITCONFIG`), guarded by `fixtures/cli/harness.test.mjs` under a hostile `~/.gitconfig`. A test that needs a git config value sets it in the fixture repo (`git(repo, ["config", …])`), never in HOME. |

### PM log additions (2026-09-16, after G3)

| Owner | Follow-up from review |
|---|---|
| TASK-027 | Wire `evaluate` into `verify.mjs` COMMANDS (TASK-026 merged it; entry still commented out) and switch `cmd-evaluate.mjs` to `ctx.input()`. |
| TASK-015 (first cmd with real file inputs) | `ctx.input()`: realpath the target before the `relative()` containment check, or document the lexical-only guarantee (macOS `/var` vs `/private/var`). |
| TASK-028 | `cli.test.mjs` `--help` guard reads USAGE via a source regex; when `register.mjs` builds USAGE from `tokens.mjs` rows, change the guard to import the module's USAGE. Also fix register usage text: neither-flag ⇒ exit 2 `EQUIVALENCE-REQUIRED`. |
| TASK-008 | `ctx.parseEngagementBlock` now delegates to TASK-007's `parseEngagementMd` (done in TASK-006 round 3); TASK-008 builds `cmd-engagement.mjs` on that single parser. |

### Follow-ups from TASK-012 review 1 (Rio, 2026-09-16)

Recorded by the TASK-012 implementer. The P6 `.gitignore` comparison now works on git-significant lines (block stripped, CR dropped, blank lines dropped) rather than bytes, so the LF or blank separator the block writer adds to attach the block never trips `DIRTY-TREE`; `run init` writes every artifact before it prints `RUN` and the `WROTE` lines.

| Owner | Follow-up from review |
|---|---|
| TASK-002/005 (before G6) | `SCHEMA_VERSION = 1` is a module-local constant in `cmd-run.mjs`, the first enveloped-artifact writer; TASK-013 `scope`, TASK-015 `ingest` and TASK-019 `gate` each need the same value. Export one constant (`canon.mjs` or `lib/schema.mjs`) and switch `cmd-run.mjs` to it, so a bump is one edit. |
| TASK-008 | `stripManagedBlock` (and the `# security-testing:begin/end` markers) live in `cmd-run.mjs` until the ignore-block module exists; fold them into `ignore-block.mjs` and have `cmd-run.mjs` import them — one definition of the block's edges. |
| TASK-023 (manifest/build-report) | `run-index.appendIndex` rewrites tmp+rename, leaving a transient `.<file>.tmp-<pid>-<n>` under `<run>/` while it runs (TL-14, by design), and `fsx.walk()` does not hide dotfiles. Walk the run under `withRunLock` or skip `.`-prefixed entries, otherwise a concurrent append can surface in a manifest. |
| TASK-007 / TASK-013 | `scope_paths` / `product_paths` go straight to `git status -- <paths>` (and will to `scope`) as pathspecs; `engagement.schema.json` accepts any string, so a `:`-prefixed value is pathspec magic (`:!src` excludes). Operator-authored, not a security issue — either reject a leading `:` in the parser or document that the paths are git pathspecs. |

### Follow-ups from TASK-012 review 2 (Rio, 2026-09-16)

Recorded by the TASK-012 implementer. Blocking item fixed: `stripManagedBlock` now strips nothing when a `# security-testing:begin` has no end line (git reads the marker as a comment and every line after it as a live pattern, so the tail compares against HEAD and is dirt); the P6 loop pins it for all three HEAD shapes. Plan text corrected: the run lock is `ledger/<run_id>.lock/`, not `<run>/.lock/` (§3.3 row, TASK-012 Implementation, layout tree).

| Owner | Follow-up from review |
|---|---|
| ~~TL reading before G6 (TASK-013 `scope`)~~ **closed in review 3**: `run init` refuses `--head` ≠ HEAD for assessment (exit 2 USAGE) | `run init --kind assessment --head <ref>` accepted a ref other than HEAD, but the clean-tree check (D18/P6) compares the working tree against HEAD/index while citations later resolve at `head_oid` — a clean tree at HEAD says nothing about `HEAD~1`. §4.1 allows `--head` for every kind, so this is a spec gap. Options: refuse `--head` ≠ HEAD for assessment (exit 2 USAGE) in `run init`, or have `scope` (which re-runs `assessmentDirt`) enforce it. Decide before TASK-013 lands. |
| TL-9 / spec | `allocateRun` at seq 9999 throws inside `index.lock/` ⇒ exit 1 INTERNAL; lock released, `index.json` unchanged, no corruption. Operator-facing limit (four digits, one ledger per `<st>`), not an internal bug — worth a CliError 4 with a token once the spec names one. The cap is noted in the `ledger.mjs` header. |
| TASK-008 (`engagement validate`) | When HEAD's `.gitignore` holds only the managed block and the working file is deleted, both sides reduce to `[]` ⇒ `run init` judges the tree clean. Deleting the block re-exposes `private/` to git — that is `engagement validate`'s `IGNORE-BLOCK: stale` concern, not `run init`'s; make sure validate covers the deleted-file shape. |

### Follow-ups from TASK-012 review 3 (Rio, 2026-09-16)

Recorded by the TASK-012 implementer. Blocking item fixed at the allocation point: `run init --kind assessment` now requires `--head` to resolve to HEAD (exit 2 `USAGE(run init: --head must be HEAD for assessment)`, nothing allocated) — D18 says an assessment is a clean tree *at* `head_oid`, and the only tree the process can compare is the working tree against HEAD. Also taken: the `DIRTY-TREE` diagnostic prints ` <- <orig>` for rename rows; `appendIndex` validates the on-disk payload before spreading it (a hash-consistent off-shape index ⇒ 5 `INCONSISTENT(<file>)`, not a TypeError).

| Owner | Follow-up from review |
|---|---|
| TASK-008 / TASK-013 (before `scope` lands) | `stripManagedBlock` and `assessmentDirt` are exported from `cmd-run.mjs` for `scope` to import; a command importing another command drags in ledger/run-index/schema and breaks the one-cmd-per-subcommand shape (TL-1). Move both into a lib module (`lib/clean-tree.mjs`; the block stripper into `ignore-block.mjs` per review 1) and have `cmd-run.mjs` import from there. |
| tokens.mjs (nobody) | `runLine` carries private copies of the run-id regex and the kind list because the leaf module cannot import `ledger.mjs`; the drift guard in `tokens.test.mjs` is the mitigation. Do not "deduplicate" by importing ledger into tokens. |
| TASK-023 (manifest/build-report) | `run init` writes `run.json`/`engagement.json` via `writeArtifact({exclusive: true})` whose tmp is `.run.json.tmp-<pid>-<n>` under `<run>/` — harmless here (no manifest yet), but it reinforces the review-1 follow-up: walk the run under `withRunLock` or skip dot-entries. |

### PM log additions (2026-09-16, after TASK-029 review 1)

| Owner | Follow-up from review |
|---|---|
| TASK-030, TASK-046, TASK-059 | `open_exposure` is open+regressed+accepted+false-positive (`EXPOSED_STATUSES`), not the "open+regressed" the §4.3 `status` row used to say (row amended above); read the `register-fold.mjs` header before consuming `status --json`. An `acceptance` / `false_positive` record is present only while the row's status is `accepted` / `false-positive` (a `superseded` row may keep one as history) — read the approval state from `status`, never from the record's presence (`register-transitions.mjs` header). |
| TASK-058 | `run snapshot register` must copy `finding-alias.jsonl` alongside `events.jsonl`: a rewritten LAST alias line is otherwise unwitnessed by any projection or anchor, and the alias log is exactly what makes `supersede --subject-equivalent` pass. |
| TASK-033 (anchor) / TASK-005 (schema) | Consider witnessing the alias chain in the anchor (`<eid>:<seq>:<chain>:<alias_chain>`) or an `alias_chain_sha256` field on the projection — the latter is a `register.schema.json` change (Projection is `additionalProperties: false`). |
| TASK-028 (if a batch append ever lands) | `register check` computes the expired set after `openRegister()` releases the lock, then appends one row per lock hold; two concurrent `check`s (or a `revoke` racing a `check`) make the loser exit 4 `TRANSITION-REJECTED(acceptance-expired: open)` after having appended some rows — benign (each append folds first), but `check` should switch to a batch append if one is added. |

### Follow-ups from TASK-015 (import store + `ingest` dispatcher, 2026-09-16)

Recorded by the TASK-015 implementer. PM item taken: `ctx.input()` now realpaths the target (leniently — a not-yet-existing leaf resolves through its nearest existing ancestor) before the containment check, so an alias of the tree is inside it and a symlink out of the tree is outside it (`ctx.test.mjs`). Representation choices the spec left open, so later adapters share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-016/017/018 (adapters) | Contract in `lib/ingest/_shared.mjs` header: `adapt(ctx, run, scope, redactedInput, locatorBase, extra)`; `run = {run_id, dir, envelope, payload}`; `scope` is the scope artifact or `null` (absent ⇒ `inScope` throws `3 INCOMPLETE(scope)`); `locatorBase = {import_sha256, original_hmac, source_path}`; `extra.sent` is the resolved `--sent` path (tracker-readback only). Text kinds (`doc case audit qa-run`) receive the redacted string; JSON kinds (`sarif ticket pr ta-report tracker-readback`) receive the redacted parsed value (`redactDeep`, keys renamed `#n` on collision). A kind whose module is absent is `2 USAGE(ingest: adapter <kind> is not available)`. |
| spec / tokens | New token not spelled by the spec: `2 IMPORT-EXISTS(<import_sha256>)` — the same redacted bytes ingested twice into one run (the record `<run>/ingest/<sha>.json` is write-once, G-10; the index never gains a second entry). `doc` outside scope is an `unlocated` candidate `out-of-scope`, exit 0 (the §6.7 handling), not a structural exit 2 — TASK-017 to confirm or change. |
| TASK-023 (build-report) | `cmd-ingest` orders writes blob → record (write-once) → `imports.json` entry, so an index entry always has its record; a crash between the last two leaves a record without an entry, which a re-ingest reports as `IMPORT-EXISTS`. `imports.snapshotImport` alone (default `index: true`) appends the entry itself; `index: false` is the dispatcher's mode. |
| TASK-002/005 | `SCHEMA_VERSION = 1` is now a module-local literal in `cmd-run.mjs`, `baseline.mjs` **and** `cmd-ingest.mjs`; the one-constant follow-up from TASK-012 review 1 is still owed. |
### Follow-ups from TASK-017 (`ingest ticket | pr | doc | tracker-readback`, 2026-09-16)

Recorded by the TASK-017 implementer. TASK-015's open item taken: `doc` outside scope is now the §6.6 *structural* failure — `2 SCHEMA-INVALID(doc: path <p> is not in scope)`, nothing written (the row puts "in-scope path" in the structural column and §4.1 makes a structural failure exit 2; a document is not a finding candidate, so the §6.7 `unlocated out-of-scope` handling does not apply). Representation choices the spec left open, so later tasks share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-031 (`publish --profile tracker`), TASK-045 | `ingest tracker-readback --sent <ticket.json>` is **required** (2 USAGE without it). The dispatcher reads the sent file through `ctx.input()`, `parseStrict` (2 `SCHEMA-INVALID(tracker-readback: --sent does not parse …)`), `redactDeep`, and hands the adapter `extra = {sent: <abs path>, sent_payload}`; it is not itself an import. The adapter reads only `finding_id` and `title` from it (required non-empty strings) — the nine-key closed shape stays TASK-031's (`ticket-payload` schema still owed by TASK-005, PM log G13 row). |
| TASK-045, TASK-039 (`ticketed` disposition) | Read-back record `trusted` is exactly `{finding_id, id, url, labels, state, body_contains_finding_id, mismatch}`; `finding_id` is the sent payload's, never the tracker's. `mismatch[]` is in `tokens.READBACK_FIELDS` order `url` (host ∉ `targets.tracker`), `title` (read-back title present and ≠ sent title), `body` (read-back body absent or not containing `finding_id`) — a foreign host is a *mismatch on a kept record*, not a rejection, so TASK-045's "host ∈ targets.tracker and mismatch empty" gate reduces to `mismatch.length === 0`. `cmd-ingest` already prints `READBACK: ok` / one `READBACK: MISMATCH(<field>)` per field between the IMPORT and WROTE lines; TASK-045 adds `TICKETED <R-id> <url>` and the event after them (and the `READBACK: ok (no register row)` variant if it wants one — not a token yet). |
| TASK-031 (tracker dedupe reads `ingest/*` ticket records) | Ticket record `trusted` is exactly `{id, url, labels, state}` (`id` string or non-negative integer as the tracker spells it; `labels` strings, GitHub `{name}` objects normalised to names; `state` kept verbatim, never lowercased). PR record `trusted` is exactly `{number, url, base_ref, head_oid, changed_files}` with `changed_files` = the PR's list ∩ `scope.files[].path`, deduplicated, PR order; out-of-scope paths are not counted anywhere but the redacted import blob. A ticket / PR whose url host is not in `targets.tracker` (or does not parse — a fully redacted url included) is `rejected[]` reason `host-not-allowed`, no record, exit 0. A ticket needs no scope.json; a PR does (`3 INCOMPLETE(scope)` even with `changed_files: []`). |
| spec §6.6 / TASK-016/018 | "tracker JSON schema" is read as a closed minimal field set validated field by field (`lib/ingest/_tracker.mjs`: `parseTicket`, `requireObject/requireString/optionalString`, `inertText`, `trackerHosts`); no `references/*.schema.json` exists for tracker input and none was added (a tracker's response has no shape this bundle can pin). Keys outside the set are ignored (preserved in the blob). `targets.tracker` is read live from `ctx.engagement()` (the destination/authority policy the lead may extend between runs), not from `<run>/engagement.json`. |
| TASK-015 (`_shared.mjs` header, G-15) | Comment-only edit: the `extra` line of the adapter contract now documents `{sent?, sent_payload?}`. No code in `_shared.mjs` changed. |

### Follow-ups from TASK-032 review 1 (Rio, 2026-09-16)

Recorded by the TASK-032 implementer. Blocking item fixed: `purge --yes` deleted `runs/<id>` (run.json — the only record attributing a run to an engagement; ledger index entries carry no `engagement_id`) first, so an interruption after that left `receipts/<id>`, `private/citations/<id>`, `ledger/<id>/imports/` and the index entry orphaned and unreachable by any later purge, while a re-run reported `PURGED runs=0` (exit 0). Now: per run the satellites go first, then `imports/`, then — under `ledger/index.lock/`, so a concurrent `run init` cannot allocate into a directory being removed — the ledger entries and, last, `runs/<id>`; then the baseline and the keys (files, then index rows, then `current`). Attribution records go last everywhere, so a re-run after any interruption attributes again and finishes. Pinned by a real mid-cleanup failure test (`ledger/` made read-only ⇒ exit 1, run.json and the ledger entry intact, re-run `PURGED runs=1`; skipped on Windows/root) and a leftover-state recovery test. Plan-without-`--yes` exit shape for TASK-035/TASK-038 to quote: one `PURGE <repo-relative path>` line per planned path on stdout, then `USAGE(purge: --yes is required to delete; <n> path(s) listed above would be removed)`, exit 2 — the spec names no token for the plan, so the USAGE shape stands unless one is added.

| Owner | Follow-up from review |
|---|---|
| TL-9 / `ledger.mjs` (TASK-012) / TASK-033 sign-off | `allocateRun` uses `seq = max(seq) + 1`, so purging the highest-seq run lets the next `run init` at the same head reissue the identical `run_id`. Locally harmless (everything under the old id is gone) but a previously published report can name a `run_id` that now denotes a different run. Consider a monotonic `next_seq` field or tombstones in `ledger/index.json`. |
| PM / spec §6.9 | `<st>/imports/` is deleted whole in a multi-engagement repo (B's ingest inputs go when A is purged) — exactly what the TASK-032 text says, but §6.9's `imports` more plausibly means the per-run `ledger/<id>/imports/` (already covered). Clarify; if per-run is meant, drop the whole-directory removal from `cmd-purge.mjs` (one line + the plan's "had material" test) and the test's `shared.imports` assertions. |
| TASK-012 (`ledger.mjs`) / TASK-009 (`keys.mjs`) — G-15 | `cmd-purge.mjs` re-spells the index shape (`indexBytes`: canonical JSON + LF) and rewrites both indexes itself under the owners' locks. The owners should export `removeRuns(ctx, run_ids)` (ledger) and `dropKeys(ctx, key_ids)` (keys) and `cmd-purge` should switch to them; the post-purge `readLedgerIndex`/`readKeysIndex` assertions in `cmd-purge.test.mjs` catch drift until then. |
| TASK-008 (`engagement init` step 2) | `tokens.tracked(relPath)` is the §4.1 `TRACKED(<path>)` spelling — import it, do not add a second copy. |
| TASK-012 (`ledger.mjs`) / later `purge --run <id>` | A ledger entry whose run dir has no `run.json` (interrupted `run init`: `allocateRun` appends the entry before `run.json` is written) is left in place by purge with a stderr note and has no bundle-side cleanup path. Cannot be attributed, so acceptable now; the ledger owner may want `run init` to write `run.json` under the same lock, or a `purge --run <id>` later. |
| TASK-032 (noted in the header) | The plan is computed outside the keys/ledger locks and `execute()` acts on it: a key minted or a run allocated for the engagement between the two survives the purge. In-process window, same operator — not worth a lock; a re-run takes it. |
### Follow-ups from TASK-059 review 1 (Rio, 2026-09-16)

Recorded by the TASK-059 implementer. Blocking item fixed in `cmd-register-render.mjs`: `--out` under `<st>/` now refuses the bundle's own state (`RESERVED_ST`: `register/`, `private/`, `ledger/`, `runs/`, `receipts/`, `imports/`, `proposals/`, `handoffs/`, `knowledge/` — bare names included, so a file can never squat where the directory is created later — plus `engagement.md` and `threat-model.json`) with exit 2 `USAGE(render: --out must not point into the bundle's own state (…), got <path>)`; `..` segments are normalised before the check. Also taken: `.agents/memory/` requires a `<role>/` segment (G-5 says `.agents/memory/<role>/**`); `--out` naming an existing directory is exit 2 `USAGE(render: --out names a directory, got <path>)` instead of an EISDIR 1 INTERNAL; `register-render.test.mjs` pins that a redaction hit inside a title never changes the view's line count or a row's column count.

| Owner | Follow-up from review |
|---|---|
| TASK-006 (ctx.mjs, G-15) — before `publish --to` (TASK-025) | `resolveOut` in `cmd-register-render.mjs` re-implements `ctx.input()`'s cwd-realpath + root-containment rule with a `cannot write` message; `publish --to` needs the same. Add a `ctx.output(command, p)` twin in `ctx.mjs` (containment only — the G-5 prefix / reserved-set policy stays with the command) and have `render` and `publish` both call it, so one containment rule exists. **Review 2 addition:** `resolveOut` is lexical after `resolve()` — a symlinked directory ancestor under a writable prefix (`<st>/views -> <st>/register`, or `-> /etc`) is followed by `writeAtomic`'s mkdir/rename and neither the containment nor the reserved check sees it (same class as `ctx.input()`'s lexical-only caveat, TASK-015 row above). `ctx.output` should realpath the deepest *existing* ancestor of the target and run containment on that path; the command then runs its reserved-set check on the same realpath'd relative — that closes the symlink case and makes the case-folding fix structural rather than a regex flag. |
| TASK-040 (risk-register SKILL.md), TASK-047 (security-lead) | The rendered table has **eight** columns: `id | subject | priority | status | owner | ticket_url | last_verified_run | title`. TASK-059's text names seven; the eighth (`title`) is the operator-text cell the same paragraph says the view carries — describe eight (§4.3 `render` row amended above). |
| plan §4.3 (amended above) | `render` prints `RENDER <repo-relative path> rows=<n> seq=<n>` (`tokens.rendered`, appended at the end of `tokens.mjs` under a TASK-059 comment). The spec spells no token for `render`; the plan row now does, so G-13 is satisfied by the plan text. |
| nobody — do not "fix" | The PEM rule in `references/redaction-rules.json` ends with an `(?![\s\S])` alternative: a title carrying `-----BEGIN …-----` with no END line (behind-the-back log path) redacts the rest of the view to end-of-document. That is redact.mjs's fail-safe by design; the renderer must not work around it. |

### Follow-ups from TASK-059 review 2 (Rio, 2026-09-16)

Recorded by the TASK-059 implementer. Blocking item fixed: `RESERVED_ST` in `cmd-register-render.mjs` was a case-sensitive lexical regex guarding a file-system write — on APFS/NTFS `--out .agents/security-testing/REGISTER/events.jsonl` passed the guard and `writeAtomic` renamed the view over the hash-chained log (`status` then exited 5 CORRUPT). The regex now carries the `i` flag (fail-closed on every platform: `Register/` is refused on ext4 too); the reserved-set test covers case-variant spellings of `register/`, `private/`, `runs/`, `knowledge/`, `receipts`, `engagement.md` and `threat-model.json` (byte-identical after on a case-insensitive FS, not-created on a case-sensitive one); the module header and the §4.3 `render` row say "case-insensitive". Nits taken: `tokens.test.mjs` has a `rendered` row; the symlinked-ancestor caveat is routed into the `ctx.output` follow-up above. Not taken: `cell()` keeps leading/trailing whitespace (trim only if TASK-040 promises a parseable table); `checkProjection`'s double validation stays (keeps the pure core self-sufficient).

### Follow-ups from TASK-014 (`lib/cite.mjs`, 2026-09-16)

Recorded by the TASK-014 implementer. Representation choices the spec and plan left open, fixed here so `packet` (057), `gate` (019), `check` (025), `ingest sarif` (016) and `tm-lint` (039) share one boundary. Module split per the dispatch note: `lib/cite-core.mjs` (pure: `checkRange`, `occurrenceOf`, `rangeBytes`, `lineMap`; import-guard test) and `lib/cite.mjs` (I/O: `resolveSide`, `resolveWorking`; re-exports the core, so `lib/cite.mjs` stays the one import §3.3 names).

| Owner | Follow-up / contract note |
|---|---|
| 057, 019, 016, 025 (every citation consumer) | **Line numbers are normalised line numbers.** TASK-013 records `lines` as `normalizeText(bytes).lines.length` and admits `[[1, lines]]`, so a citation's `[start, end]` indexes the normalised lines (1-based, inclusive; a blank line is not a line). `rangeBytes(buf, start, end)` returns the contiguous RAW byte span from the raw line that became normalised line `start` through the one that became `end`, terminators kept (CRLF, interior blank lines) — that is the `range_hmac` preimage. `cite.lineMap(buf)` gives `{lines, spans}` for callers that need both; pass it as `rangeBytes`'s 4th argument to avoid re-splitting. A reviewer reading `git show` sees raw numbers; the agent prose (034/036) should say citations count non-blank lines, or `gate` will reject honest claims on files with blank lines. |
| 019 `gate` | `checkRange` reasons (all in `tokens.mjs`, TASK-014 rows): `RANGE-INVALID` (shape / `1 ≤ start ≤ end`), `RANGE-TOO-LONG` (> 40), `PATH-NOT-IN-SCOPE` (not a `scope.files[]` entry — a skipped file, or a path deleted at head), `SIDE-MISMATCH` (a `head` citation of a `snapshot`-side scope file or vice versa; `base` exempt), `RANGE-NOT-ADMITTED` (primary range inside no single admitted range). Rules apply in that order; a typed citation (`role` set) gets `{ok: true, context: true}` after the first four. `occurrenceOf(lines, snippetLines, start)` has no hint parameter and returns `null` when the window at `start` is not the snippet (⇒ `CITATION_FAILED`); overlapping equal windows count. |
| spec §6.2 / 019 / 025 | A `side: base` citation of a file **deleted at head** is `PATH-NOT-IN-SCOPE` under the literal rule ("⊆ an admitted range of its file in scope.json" — the file has no scope entry). `resolveSide` still resolves it (the §12 "deleted code" fixture works at the resolution level), so `check --integrity` over an already-accepted citation is unaffected; only admission at `gate` is closed to it. If deleted-file citations must be admissible, the spec needs a rule for base-side admitted ranges — TASK-019's call, not silently widened here. |
| 025 `check`, 057 `packet` | `resolveSide(…, {side: snapshot})` verifies the snapshot file's sha256 against `scope.snapshot[path].redacted_sha256` and throws `SnapshotMismatch` (`{run_id, path, expected, actual}`) on a difference, `SnapshotMissing` when the scope has no entry or the file is gone; `base|head` throw `ObjectMissing` (`{side, oid, path}`) when `blobOid` finds no blob (a tree is never returned). All three extend `CiteError`. `check` maps `SnapshotMismatch` to `INCONSISTENT(snapshot:<path>)` and `SnapshotMissing` to `CONSISTENT-REDACTED-ONLY` arithmetic as it sees fit; nothing in `cite` prints. |
| 025 `check --drift` | `resolveWorking(ctx, path)` returns `null` for absent, directory and symlink (never followed — scope skips links), so "drifted" for a missing file is the caller's reading of `null`, not an exception. Both resolvers refuse a path with `..`, an empty/`.` segment, a leading `/`, a backslash or a NUL with a TypeError: paths come from artifacts the scripts wrote and are joined under root / the snapshot dir. |
### Follow-ups from TASK-018 (`ingest case | audit | qa-run | ta-report`, 2026-09-16)

Recorded by the TASK-018 implementer. Representation choices the spec left open, so the readers of these records (TASK-043 admitted suite, TASK-044 observations + TA) share one boundary. Fixtures are verbatim copies of the owning bundle's example — the manual-qa bundle had no committed example for any of its three formats and test-automation none for `report.json`, so this task added `bundles/manual-qa/knowledge/examples/{TC-SEC-001.md, RUN-2026-09-15-001.md, audit-report.md}` (seeded to consumers with the rest of `knowledge/`) and `bundles/test-automation/skills/test-automation-workflow/references/examples/report.json`, each paired with its `scripts/fixtures/{qa,ta}/` copy in `bin/check-skill-dupes.mjs` `GROUPS`.

| Owner | Follow-up / contract note |
|---|---|
| TASK-043 / TASK-044 (readers) | **Multi-record imports carry a `record` discriminator in `trusted`.** `qa-run`: index 0 `{record: "run", run_id, suite, environment, environment_host_allowed, date, results}`, then `{record: "result", run_id, case_id, status}` per Results row (inert `{title, narrative?, screenshot?}` — the `**Screenshot:**` path is quoted inert text per §6.6, never a trusted reference: D5 admits only scope-/target-validated references, and a run narrative is neither); `audit`: `{record: "audit", target, date, pages_audited[], specialists_run[], findings, findings_source}` then `{record: "finding", title, priority, confidence, urls[]}`; `ta-report`: `{record: "report", batch, base, gate_verdict, gate_runs, recovery_basis, test_paths[], units}` then `{record: "unit", case_id, outcome, outcome_reported, gate_witnessed, coverage, findings[], findings_dropped?}`; `case` is one record `{id, external_id?, requirements[]}`. `locator.index` is the **source ordinal** (0 = the header, k = the k-th row / finding / case), so a rejected row keeps its ordinal and `records[]` may skip an index. Every inert value is `wrapInert`ed prose. |
| spec §6.6 (`audit`) | The qa-auditor methodology's report template writes **no JSON block**; the spec's "Markdown + its JSON block" is honoured when the block is present (`findings_source: "json"`, the Finding Schema array + `affected_pages`/`evidence`), and a report without one is read in its documented heading form (`#### [P0, confidence 9] title` + `**Affected pages:**` lines, `findings_source: "markdown"`) so a real qa-auditor report ingests. The block is the fence under `## Findings (JSON)`; without that heading the *last* json fence is used only when it is an array, so an `**Evidence:**` line quoting a JSON body in a fence never masquerades as the findings. The fixture carries both and `audit.test.mjs` pins that they agree. The bundle example `bundles/manual-qa/knowledge/examples/audit-report.md` now says the section is optional; **manual-qa owner:** add it to the methodology's Step 5 template if `findings_source: "json"` should be reachable from a real qa-auditor run. |
| spec §6.6 (`case`) | Trusted is exactly the spec's column: `id`, `external_id` (when present), `requirements[]` — closed-vocabulary frontmatter (`priority`, `type`, `size`) is **not** in the record; `case.parseTestCase()` exposes it for in-process readers (TASK-043's priority map reads the case file, not the import). `audit` trusts `priority`/`confidence` alongside title + URLs because the heading `[P0, confidence 9]` is part of the finding's identity in the format. |
| spec §9.3 (`ta-report`) | **Gate witness rule:** a `delivered` row is witnessed by its own `gate: {runs ≥ 1}` record (what `batch-build.workflow.mjs` writes exactly when its gate went green) or by the report's `gate.verdict: "green"` with `runs ≥ 1`; otherwise `outcome: "delivered-unwitnessed"` with `outcome_reported: "delivered"`. A rebuilt report (`recovery.rebuilt_from`) proves delivery by the merge, which is not a receipt — its basis lands in `recovery_basis`. `test_paths` = repo-relative `expected_red[].spec` + `gate.failures[].spec`; `pr`, `gate.seconds` and every duration stay in the redacted blob only (G-1). |
| TASK-017 (`ticket`/`pr`/`doc`) | The three text adapters read structure through `lib/ingest/_qa-markdown.mjs` (frontmatter subset, pipe tables, ATX sections, fenced blocks); nothing there is tracker-specific, but it is the one Markdown reader under `lib/ingest/` if a later adapter needs one. `targets.browser` is read via `ctx.engagement()` (the live record, §6.6 "destination/authority policy"), not the run's `engagement.json` snapshot — if a reviewer prefers the snapshot, the dispatcher (TASK-015's `cmd-ingest.mjs`) is the place to pass it in `extra`. |
| TASK-044 (`ta-report` reader) | In the `ta-report` header record, `batch`, `base`, `gate_verdict`, `gate_runs` and `units` are **informational** — token-validated labels outside the spec §6.6 trusted column (unit outcomes, coverage, exclusions, `findings[]`, `recovery_basis`, test paths) kept so an observation can name the batch it came from. They are not references: `base` is never a git ref to check out or diff against, and no argv is ever built from an import (G-6). Only `test_paths[]` (repo-relative posix, referenced never opened) is a path. |
| TASK-043 (admitted-suite writer) | **Case ids the manual-qa add-ons can see.** The fixtures use `TC-SEC-NNN` (the plan's own filename) and `case.mjs` `CASE_ID` accepts both `TC-NNN` and `TC-SEC-NNN`, but manual-qa's metrics readers (`bundles/manual-qa/hooks/scripts/build-run-metrics.mjs` `rowRe`, `resolve-subagent-traces.mjs`, `score-test-author-output.mjs`) match `TC-\d+` only and `test-case-format.md` says `TC-` + 3 digits. An admitted suite written as `TC-SEC-NNN` ingests here but is invisible to manual-qa's run-metrics add-on; pick the id shape with that in mind (or widen those readers in manual-qa). |
| nobody — bounded by design | `TC-SEC-001.md` carries `password=\`Test1234!\`` (redacted: `password-assign`) **and** the same value as a bare Test-Data table cell, which no rule matches — spec §2 "detection of secrets outside the rule list" is not promised, and `case.test.mjs` asserts exactly the assignment form. Do not widen the rules to table cells from here. |

### PM log additions (2026-09-16, after G7)

| Owner | Note |
|---|---|
| TASK-027 (verify all, owns worktree usage) | `git.test.mjs` "worktreeAdd / worktreeRemove: detached checkout at an oid, removed cleanly" failed intermittently in 2 of ~8 full `node --test` runs and never in isolation (0/12 under `--test-concurrency=8`). Suspect git worktree contention under load. When implementing `verify all`, make `worktreeAdd` robust to a transient failure (one retry after `worktree prune`) and make the test print git's stderr on failure so the next flake is diagnosable. |
| TASK-025 (check) | From TASK-014 review: map `SnapshotMismatch` to `INCONSISTENT(snapshot:<path>)` and never echo `err.actual`/`err.message` to stdout (G-2/G-4). Consider a per-(oid,path) memo for resolveSide (three git spawns per citation today). |
| TASK-019 (gate) | From TASK-014: decide base-side admission explicitly (a `side: base` citation of a file still present at head is checked against head's admitted ranges by accident); deleted-at-head ⇒ PATH-NOT-IN-SCOPE tension. |

### Follow-ups from TASK-016 (`ingest sarif` + `sarif-mapping.v1.json`, 2026-09-16)

Recorded by the TASK-016 implementer. Module split as TASK-014's: `lib/ingest/_sarif.mjs` (pure: URI canonicalisation, tool/class/priority mapping, raw → normalised line mapping, the §6.7 matrix over an injected `readSide`; import-guard test) and `lib/ingest/sarif.mjs` (I/O: the mapping file, `cite.resolveSide` bound as `readSide`). Representation choices the spec and plan left open, fixed here so `gate` (019), `coverage --scanner-rows` (020), `build-report` (023) and `check` (025) share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-019 `gate` (reads `ingest/*.json` sarif records) | **Located record `trusted` is the closed set** `{tool, tool_key, tool_version?, rule_id, level?, priority, confidence, class, class_source, cwe?, path, side, region, lines, requires_typed_citations, recorded[], partial_fingerprints?}` (`_sarif.mjs` `TRUSTED_KEYS` / `OPTIONAL_TRUSTED_KEYS`); `inert` is `{message?, snippet}` (wrapInert'ed). **`lines` is the citation** — normalised line numbers per the TASK-014 contract, already translated from the scanner's raw `region` (`rawToNormalised`: blank raw lines at the region's edges are stepped over; a region of blank lines only, or past the file, is rejected). `region` keeps the raw numbers next to it for a reviewer reading `git show`. `side` is the scope file's recorded side (`head` \| `snapshot`). A SARIF finding's identity (§6.5) is gate's to derive from `path\0class\0snippet\0occurrence` over the bytes at `lines`; the adapter stores no id and no hash. The 40-line rule and occurrence are **not** applied here: a located record may still fail `cite.checkRange` (`RANGE-TOO-LONG`) at gate and be counted there — the adapter only locates. `unlocated[]` entries are exactly the `import.schema.json` Candidate shape (`{locator, reason, tool, rule_id}`), so gate copies them into `unlocated.json` unchanged (US-010 AC-4). |
| TASK-023 `build-report` (section 3, US-010 AC-3) | Rejection reasons are `tokens.mjs` rows (`SARIF_RULE_MISSING` … `SARIF_FILE_NOT_TEXT`, grouped as `_sarif.REJECT`): `rule-missing`, `rule-mismatch`, `level-invalid`, `region-malformed`, `region-outside-file`, `region-blank`, `file-not-text`. Counts by reason = a fold over `rejected[].reason` of every sarif import record. `trusted.recorded[]` (`SARIF_UNKNOWN_TOOL` … `SARIF_SNIPPET_FROM_SIDE`, `_sarif.RECORDED`) lists the §6.7 fallbacks taken, in evaluation order — the "recorded" the matrix asks for on an unknown tool. |
| TASK-020 `coverage --scanner-rows` | `trusted.tool` is `tool.driver.name` as the file spells it (a label, never a reference) and `trusted.tool_version` is `semanticVersion` ?? `version`; `scanner_rows[].{tool, version}` can come from the sarif import records without another read of the SARIF. |
| spec §6.7 row 1 / TASK-035 (lead prose) | "URI not canonicalisable inside repo" is read as: percent-decode once, strip a `file:` scheme only when what follows is relative, drop one leading `./`; then no other scheme, no leading `/`, no `\`, no NUL, no empty / `.` / `..` segment (so `%2e%2e` is `..`). **Absolute `file:///…` URIs are unlocated** — matching them against the consumer root would tie the record to a machine path (G-1) and the SARIF may have been produced elsewhere. `uriBaseId` / `originalUriBaseIds` are never read. A scanner should be run from the repo root so `uri` is repo-relative; the lead prose should say so. "In-repo path outside scope" is decided by `scope.files[]` membership only (a path that is not a scope file is `out-of-scope` whether or not it exists — the file system is never consulted; scope never lists a symlink, so nothing escapes). |
| spec §6.7 row 8 / TASK-002 `canon` | "non-integer" `startLine` can only be a string or a non-positive integer at the adapter: a JSON **float** anywhere in a SARIF file is refused by `canon.parseStrict` at the import store (`2 SCHEMA-INVALID(sarif: float not allowed …)`, nothing written) before any adapter runs. Real SARIF logs can carry floats (`rank`, tool-specific `properties`); if that refusal turns out to reject real scanner output, the store's JSON-kind path (TASK-015 `prepareImport`) needs a float-tolerant parse for imports — the canonical form is only needed for the *redacted* bytes' identity — which is a `canon`/`imports` decision, not the adapter's. |
| TASK-015 (`lib/ingest/_shared.mjs` header, G-15 — not edited) | The adapter contract's "never reads the source file … no fs, no git" has one documented exception: `sarif.mjs` reads the recorded side through `cite.resolveSide` (the plan names it) and the bundle's own `references/sarif-mapping.v1.json`. Both are stated in `sarif.mjs`'s header; `_shared.mjs` was left untouched. A scope file that cannot be resolved is the bundle's own state gone wrong, exit 5: `SnapshotMismatch` / `SnapshotMissing` ⇒ `INCONSISTENT(snapshot:<path>)`, `ObjectMissing` ⇒ `INCONSISTENT(scope:<path>)` — path only, never a hash (G-2/G-4). |
| TASK-015 (`cmd-ingest.test.mjs`) | Edited two lines: the argv-contract test used `sarif` as its "adapter not shipped yet" placeholder; every `IMPORT_KINDS` adapter now ships, so the `adapter <kind> is not available` branch of `loadAdapter` is unreachable through a real kind and stays as the guard for a deleted module. The ledger-untouched assertion stays. |
| spec §6.7 row 7 / mapping | `toolKey` matches `tool.driver.name` exactly or as `<key> <suffix>` (`Semgrep OSS` → `semgrep`), case-insensitive; the mapping's `tools.unknown` row exists so the schema fixture and the plan's "unknown 3" both hold, but an unknown tool's confidence is taken from `default_confidence` and its prefix table is never consulted (tags only, §6.7). Class precedence: tags (exact `tag_class` key, or any CWE spelling in the tag — `CWE-89: …`, `external/cwe/cwe-089` — normalised to `CWE-<n>`) → the tool's longest `rule_prefix_class` prefix → `unmapped`; the first CWE seen is recorded as `trusted.cwe` even when it maps nothing. Data-flow classes (`requires_typed_citations: true`) are the constant `DATA_FLOW_CLASSES = injection xss ssrf path-traversal deserialization` in `_sarif.mjs` — the mapping schema is closed (TASK-005), so it is not a mapping key. SARIF `level: none` ⇒ p3 like absent. |

### Follow-ups from TASK-020 (`coverage` + `lib/coverage-core.mjs`, 2026-09-16)

Recorded by the TASK-020 implementer. PM-log G7 row taken: `lib/coverage-core.mjs` is the pure core (`computeCoverage(scope, examined, scannerRows) → payload`, plus `verifyAccounting(scopePayload, accounting)` and `countByStatus(accounting)`; import-guard test; imports `exit.mjs` + `tokens.mjs` only) and `lib/cmd-coverage.mjs` is its I/O. Representation choices the spec and plan left open, fixed here so `build-report` (023), `check` (025) and `sign-off` (033) share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-023 `build-report` (section 2), TASK-025 `check` | **`accounting[].by` is the identity or reason that accounts for the piece**: `examined` ⇒ `[examined_sha256]`; `scanner-only` ⇒ the sorted `import_sha256`s of every scanner row listing the path (join `scanner_rows[]` for tool/version); `skipped` ⇒ `[<scope.skipped[].reason>]`; `unexamined` ⇒ `[]`. Entries are sorted by path (UTF-8 byte order) then start; declared ranges are kept as declared (adjacent ones not merged). **A `skipped` entry carries the placeholder `range: [1, 1]`** (`coverage-core.SKIPPED_RANGE`): a skipped file has no admitted range and no measured line count, and the schema requires a range — renderers key on `status`, never on a skipped entry's range. `check` recomputes with `computeCoverage(scope, examined, coverage.payload.scanner_rows)` (after re-checking each row's import record is present) and may run `verifyAccounting` over the recorded accounting (holes ⇒ `4 GAP(<path>:<a>-<b>)`, double cover / stray entry ⇒ an Error). |
| TASK-033 `sign-off`, TASK-023 | The `COVERAGE examined=<n> skipped=<n> scanner=<n>` counts are **accounting entries by status** (`examined`, `skipped`, `scanner-only`); `unexamined` is the remainder and is not printed. Empty scope (`files: []`) prints `COVERAGE INDETERMINATE` and still writes both artifacts (`accounting: []`, `indeterminate: true`; scanner rows kept, skipped files dropped) — `coverage.json.indeterminate === true` is the sign-off key. |
| TASK-035 / TASK-047 (lead prose), TASK-038 (E2E authors the file) | **`--scanner-rows <file>` shape**: payload-only `{rows: [{import_sha256, paths?}]}` — a pointer at the run's `ingest/<sha>.json` records, not an artifact, so no schema was added (checked field by field; `2 SCHEMA-INVALID(scanner-rows: …)`). Each row must name a `sarif` import of the run (presence proof only, plan §5); `tool`/`version` come from the record (`trusted.tool` / `trusted.tool_version` of the first located record, else the first unlocated candidate's `tool`, else `"unknown"`); `paths` as given (sorted, deduplicated; a path outside scope is kept on the row and accounts for nothing) or, when absent, the distinct paths of the record's located records. |
| TASK-034 / TASK-036 (reviewer prose), TASK-019 `gate` (same rule for claims) | **A declaration outside the packet is off-contract, exit 2** `SCHEMA-INVALID(examined: declared[<i>].path <p> is not a scope file)` / `… declared[<i>].ranges[<j>] <a>-<b> lies outside the admitted ranges of <p>` / `… must be [start, end] with 1 ≤ start ≤ end` — the shape TASK-017 used for a doc outside scope; the plan spells no coverage token for it. Ranges are normalised line numbers (TASK-014 contract), so the prose must say a declaration counts non-blank lines. Overlap between declarations (across or within entries) ⇒ `4 OVERLAP(<path>:<a>-<b>)` naming the intersection; a declaration gap is reported as `unexamined`, never an error. |
| spec / tokens | New token not spelled by the spec: `2 COVERAGE-EXISTS` — `coverage` refuses a run that already has `examined.json` or `coverage.json` (G-10 write-once; retry = new seq), parallel to `SCOPE-EXISTS` / `SNAPSHOT-EXISTS`; nothing is rewritten. `EXAMINED-PACKET-MISMATCH` covers an unknown `packet_sha256`, a packet of another kind (a subject packet) and a packet of another run alike; a packet file of this run that is not the artifact it claims to be is 5 (readArtifact). |
| TASK-023 (`closeOver`) | `coverage.json` references `scope_sha256` and `examined_sha256`; `examined.json` references `packet_sha256` (a scope packet under `<run>/packets/`). The transitive closure coverage → scope + examined → packet is what §6.3 "coverage→scope+examined" plus TL-15 implies. |

### PM log additions (after G10)

Reviewer nits recorded verbatim from Rio's TASK-021 PASS review (`packet --kind subject`), routed by the PM.

| Owner | Note |
|---|---|
| TASK-021 (follow-up) or TASK-039 | TASK-021: cmd-packet.mjs `oidFor` (base branch, ~line 265): a base-side citation is not checked against the scope, so for MITIGATIONS the rule is asymmetric — probed in the worktree: a mitigation citing non-scope `README.md` at head ⇒ 5 INCONSISTENT(scope:README.md), the same path at base ⇒ exit 0 and a packet listing a file the scope never admitted. Findings are unaffected (gate-core checkRange only admits base citations on scope files). Fix (two lines): in the base branch first require `scope.payload.files.some((f) => f.path === path)` else `integrityFailure(inconsistent(`scope:${path}`))`, then blobOid — mirroring gate's own base rule so findings and mitigations share one contract. Route: TASK-021 follow-up or TASK-039 (tm-lint check is what defines a valid `<run>/threat-model.json`). |
| TASK-039 | TASK-021: cmd-packet.mjs `resolveMitigations`: a mitigation citation with end < start or a range past EOF reaches packet-core.requireRange / rangeHmac and surfaces as an uncaught TypeError/RangeError (exit 1), not a token; gate protects findings from this but nothing protects the threat-model snapshot yet. Route to TASK-039 (tm-lint check must checkRange mitigation citations before writing the run snapshot), or map RangeError/TypeError from build() to 5 INCONSISTENT(threat-model) here. |
| TASK-039 | TASK-021: cmd-packet.mjs `oidFor`: threat-model.schema.json Citation.side is base|head only, so in a review run with a dirty scope file (recorded at `snapshot`) a mitigation citing it at `head` ⇒ 5 INCONSISTENT(scope:<path>) — the run's state is not wrong, the threat model simply cannot spell snapshot. TASK-039 must decide the mapping (snapshot the model against scope, or resolve head→snapshot for dirty files). |
| TASK-021 (follow-up) | TASK-021: cmd-packet.mjs `inferType`: one garbage id plus one finding id yields `--subject ids name subjects of more than one kind (findings and mitigations)` — exit 2 is right, the wording is wrong; check for a null shape before the size>1 branch so the message is `unknown subject <id>`. |
| TASK-027 (dispatch note) | TASK-021: `citedFiles` (the TASK-027 seam) lives in cmd-packet.mjs, which imports node:fs and git.mjs. Fine for `verify all` (not a pure core), but if `check` ever has to rebuild a fix-review packet it must move to packet-core (a named G-15 edit). Note it in TASK-027's dispatch. |
| PM (G13 row) / TASK-042 | TASK-021: PM log G13 row still says `TASK-021 owns packet --kind subject --type case`; the branch leaves the documented `SUBJECT_SOURCES.case` seam returning NOT-IMPLEMENTED(M3) per the dispatch instruction — PM to re-point that row to TASK-042. |
| TASK-021 (no change) | TASK-021: Test `before gate …`: gate-result.json present but findings.claimed.json absent is reported 3 INCOMPLETE(gate-result); defensible (gate writes both), but INCONSISTENT would be the more honest token since gate never leaves one without the other. Not worth a change on its own. |

### Follow-ups from TASK-022 (`receipt validate | apply` + `lib/states.mjs`, 2026-09-16)

Recorded by the TASK-022 implementer. Representation choices the spec and plan left open, fixed here so `build-report` (023), `check` (025), `verify all` (027), `tm-lint` (039) and `plan admit` (042) share one boundary. `lib/states.mjs` is the pure core (`applyReceipts(gateResult, receipts, packets)`; imports `tokens.mjs` only; import-guard test) and `lib/cmd-receipt.mjs` its I/O.

| Owner | Follow-up / contract note |
|---|---|
| 023, 025, 027 (every `applyReceipts` caller) | **Inputs are artifacts** (`{envelope, payload}`): `gateResult` is the run's gate-result artifact or `null` for a run that has no gate (verify / threat-model — `receipt apply` passes `null` for those templates and exits 3 `INCOMPLETE(gate-result)` for review/assessment without one); `receipts` / `packets` are every `<run>/receipts/*.json` / `<run>/packets/*.json`. The packet binding is re-derived (a receipt naming no packet of the set ⇒ `not_applied` reason `packet-unknown`; a packet not listing the subject, a scope packet included ⇒ `subject-not-in-packet`), so the core is self-sufficient and `check` sees a set that no longer holds together. Result keys are sorted and every list is sorted (`not_applied` by `receipt_sha256`, `conflicts` by subject/type/run), so `JSON.stringify` of the result is deterministic — `receipt apply --json` prints exactly that object. |
| 027 `verify all` (finding lookup) / spec §6.4 row 3 | **"A new vulnerability-review receipt on a new run" is read by ledger seq.** Receipts of one run are a set (named by identity, no clock in a payload, G-1), so "new" cannot mean arrival order: groups of `(type, subject_id, reviewer_run_id)` are applied in `seq` order of `reviewer_run_id` (`states.runSeq`) and the last group's assertion is the state. Within one run a second vulnerability-review with a different assertion therefore never confirms a refuted finding — it conflicts it to `REVIEW_INDETERMINATE` (row 4). fix-review and ack receipts on a `REVIEW_REFUTED` finding are `not_applied` reason `review-refuted` (row 3 "unchanged", recorded the way row 2 records `citation-failed`); a fix-review pair that disagrees is a `conflicts[]` record with no state effect (evaluate.mjs reads that as indeterminate). Every consumer today passes one run's receipts (`receipt validate` enforces `reviewer_run_id == run_id`), so the cross-run order only matters to a caller that snapshots receipts across runs. |
| 039 `tm-lint` (`mitigated(<id>)`), 042 `plan admit` | `mitigation_states` carries only subjects of applied `mitigation-review` receipts (`MITIGATION_CONFIRMED | MITIGATION_GAP | MITIGATION_INDETERMINATE`); a mitigation-review whose subject is a gate finding is `not_applied` reason `subject-is-finding` and never touches `states` (mitigation states live on threat-model mitigations only). Which subjects exist = every gate finding plus every subject some packet of the set lists (packets are script-built, P1); a vulnerability-review receipt on a packet subject that is not a gate finding (a case packet's `case_sha256`, §9.1) derives `REVIEW_*` in `states` with no citation prior — `admitted-reviewed` can read `states[case_sha256] === REVIEW_CONFIRMED`, or check the named receipt directly. `receipt validate` cannot tell a mitigation-review receipt on a finding packet from one on a mitigation packet (packets carry no type); it admits by `subject_id ∈ subject_ids` and `apply` is where it is refused. |
| plan §4.1 `receipt validate` row / tokens | `REJECTED(<reason>)` reasons are spelled in ASCII: `subject_id not in packet.subject_ids`, `reviewer_run_id != run` (the row's `∉` / `≠`); `oid mismatch <path>` names the path (a packet path, already published); `scope packet` is the reason the row's "scope packet refused as a receipt target" test needed and does not spell. Order of checks: not-JSON ⇒ `schema: <parse error>` (exit 4, not the exit-2 `SCHEMA-INVALID` other inputs use — a receipt that is not JSON is a rejected receipt, the row's one failure class); `forbidden field <name>` BEFORE the schema check (nested keys included) so an agent that wrote `state` hears about `state`; schema; run id; packet exists / own identity / subject kind / lists the subject; oids — `head` against `head_oid:path`, `base` against `base_oid:path`, `snapshot` against `scope.snapshot[path].redacted_sha256` (scope.json read only then; absent ⇒ 3 `INCOMPLETE(scope)`). A drop-box file outside the tree or unreadable is 2 USAGE (argv), never REJECTED. |
| 027 `verify all` (TL-6 pass 2) | `receipt validate` is idempotent by identity: the same payload admitted from a second drop-box copy finds its own `<run>/receipts/<sha>.json` and exits 0 with the same two lines (nothing rewritten, G-10); an existing file under that name that is not that receipt ⇒ 5 `INCONSISTENT(receipts/<sha>)`. A COMMITTED run refuses `validate` (2 RUN-COMMITTED) but not `apply` (reads only). The fix-review packet's oids must equal the blob at the verify run's `head_oid` — a worktree modified by `install` (allow_tracked_changes) yields a packet `receipt validate` rejects with `oid mismatch <path>`; TASK-027 must build the fix-review packet's `files[].oid` from `head_oid` (the range bytes may still be the worktree's) or extend the oid rule for verify runs (a named G-15 edit here). |

### PM log additions (after G11)

Reviewer nits recorded verbatim from Rio's TASK-022 PASS review (`receipt validate | apply` + `lib/states.mjs`), routed by the PM.

| Owner | Note |
|---|---|
| TASK-042 (case admission) | TASK-022: states.mjs:233 — the sticky-REFUTED refusal is gated on `prior.has(subject)`, so a case-packet subject (no gate prior) that a vulnerability-review refuted still has later fix-review/ack receipts silently applied rather than recorded `review-refuted`; asymmetric with gate findings. No consumer sends fix-reviews at case subjects today. Route: TASK-042 (case admission) if case subjects ever get fix-review/ack. |
| TASK-023 or TASK-039 (G-15 `subject_kind` if chosen) | TASK-022: states.mjs:227 — a `vulnerability-review` receipt whose subject is a mitigation id (packet lists `M-001`) lands in `states` as REVIEW_* because packets carry no subject kind; nothing distinguishes a mitigation id from a finding/case id in `states`. Route: TASK-023 (render only gate findings + case subjects from `states`) or TASK-039 (tm-lint decides whether a vulnerability-review on a mitigation is admissible); a `subject_kind` on subject packets would be a named G-15 packet-core edit. |
| TASK-025 (`check`) | TASK-022: cmd-receipt.mjs:221/224 — `blobOid` returns null for any git failure (not only a missing path), so a transient git error reads as `REJECTED(oid mismatch <path>)` (exit 4) rather than an internal/integrity token. Acceptable; noting for TASK-025 `check`, which will want the distinction when it re-verifies packet oids. |
| TASK-027 / TASK-025 (no change) | TASK-022: states.mjs:223 — the ledger-seq ordering of cross-run vulnerability-review groups is unreachable through `receipt apply` today (packet binding is per-run, so another run's receipt is always `packet-unknown` unless the caller passes that run's packets too); dev already recorded this in the plan follow-ups. No change needed; TASK-027/025 should pass one run's receipts+packets per call as documented. |
| PM (route before G13) / TASK-027 | TASK-022: Plan follow-ups (docs/superpowers/plans/…tasks-v2.md, 'Follow-ups from TASK-022'): the TASK-027 note that a fix-review packet built from an install-modified worktree will fail `receipt validate` with `oid mismatch <path>` unless `files[].oid` is taken from `head_oid` (or the oid rule gets a named G-15 extension for verify runs) is the one item PM must route before G13 starts — it changes how TASK-027 builds the packet. |

### PM log additions (after G12)

Reviewer nits recorded verbatim from Rio's TASK-023 (`build-report` core + review template + renderer) and TASK-034 (`secure-code-review` skill) PASS reviews, routed by the PM. (One regex in the first row has its `|` escaped as `\|` for the table cell; the intended pattern is otherwise unchanged.)

| Owner | Note |
|---|---|
| TASK-023 follow-up | TASK-023: render.mjs:158 sanitize (prose/cell modes) — HTML_TAG `/<\/?[A-Za-z!?][^>]*>/` strips any `<x…>` span, so a title/description like `if (a<b && c>d)` renders as `if (ad)` (probed on the branch). Not a leak (evidence uses code mode, which keeps bytes) but lossy prose. Fix: require a tag shape — `/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?>\|<[!?][^>]*>/g`. Owner: TASK-023 follow-up. |
| TASK-023 follow-up | TASK-023: render.mjs:166/202 STRUCTURAL_START escape puts the backslash before the digit (`1.0.0 affected` → `\1.0.0 affected`, probed); CommonMark shows a literal backslash there. Escape the delimiter instead (`1\.0.0`). Cosmetic. Owner: TASK-023 follow-up. |
| TASK-025 (`check`) | TASK-023: render.mjs:188 code mode keeps HTML comments, so an evidence line may carry a look-alike TL-7 marker inside the 4-space indented block (`    foo <!-- v:summary.total -->`, probed). Byte comparison is unaffected; only `check`'s field naming could be misled. Route to TASK-025: ignore lines starting with four spaces when locating `<!-- v:… -->` markers (or strip `<!-- v:` comments in code mode here). |
| TASK-023 follow-up or TASK-025 | TASK-023: inputs.mjs:147 pathGuard.list admits symlinks and read() follows them, so the guard is lexical only; harmless in practice because every member must hash to its file name and name the run (ownRun), but note it in the header or filter to e.isFile(). Owner: TASK-023 follow-up or TASK-025. |
| TASK-024 (assessment template) | TASK-023: inputs.mjs:252 readVerifySnapshots never checks `verify.envelope.run_id === <dir id>` (a snapshot filed under the wrong verify_run_id passes). Owner: TASK-024 (assessment template) — assessment lists are declared but not rendered here. |
| TASK-023 follow-up / TASK-024 | TASK-023: templates/verify.md — section numbering jumps `## 6. Limitations` → `## 12. Chain of custody`; README says subsets keep v3 §11 numbering, but a reader of a verify report sees 1–6 then 12. Either renumber or state the convention in README. Cosmetic. Owner: TASK-023 follow-up / TASK-024 when the other two templates land. |
| TASK-023 follow-up | TASK-023: render.test.mjs:161/334 synthetic `setHash` uses `artifactId({members: […]})` while the real rule is `inputs.setIdentity` (sha256(canonical(sorted array))); tests only pass the hashes through so nothing is wrong, but import setIdentity to avoid a second spelling of the manifest rule. |
| TASK-025 (dispatch note) | TASK-023: review closed list excludes `imports`, yet coverage.scanner_rows[].import_sha256 and unlocated.candidates[].locator.import_sha256 reference `ingest/<sha>.json` records in the run dir; build-report renders them as recorded. Spec §6.3's closed list is honoured; TASK-025 `check` (per the TASK-020 follow-up) is where the import-record presence re-check belongs — note it in TASK-025's dispatch. |
| fsx owner (TASK-002/006 lineage) | TASK-023: cmd-build-report.mjs:129 writeOnceBytes re-implements canon's tmp+link+unlink for raw bytes (report.md, COMMITTED) because fsx is not named in this task (G-15). Acceptable; a later fsx owner (TASK-002/006 lineage) could expose `fsx.linkExclusive(path, bytes)` and cmd-build-report switch to it. |
| TASK-024 (already on PM log as G14/TL-16; no change) | TASK-023: render.mjs:433 `summary.incomplete_runs` is a prose placeholder pointing at sign-off (the ledger is outside the run, TL-3); spec §11 wants the count in section 3 — already on the PM log as G14/TL-16 for TASK-024; no change here. |
| TASK-023 (no change) | TASK-023: render.mjs:311 `claimed.payload.scope_sha256 ≠ scope` is reported as INCONSISTENT(gate-result); INCONSISTENT(claimed) would be more precise, but §4.1 spells only `5 INCONSISTENT(gate-result)` for this command — leave as is. |
| TASK-023 follow-up (header line) / TASK-039 | TASK-023: PM log after G11 item routed to TASK-023 (states.mjs:227, vulnerability-review on a mitigation id landing in `states`): implicitly handled — reviewView iterates claimed.payload.findings and looks states up by gate finding id, so non-finding subjects are never rendered. Worth one line in render.mjs's header so TASK-039 knows the render side is settled. |
| TASK-034 (follow-up) | TASK-034: TASK-034 (follow-up): scripts/score-findings.mjs `walkFiles` (line 63) hashes every regular file under evals/fixtures/, dotfiles included — a stray `.DS_Store` or editor swap file on a dev's machine changes `fixture_revision` and makes `secure-code-review.fixtures.test.mjs "harness.json pins the six fields"` fail with no fixture edited. Fix: skip names starting with `.` in walkFiles (one line) and add a test that plants `evals/fixtures/.DS_Store` in the copy and asserts fixtureRevision is unchanged. |
| TASK-034 (follow-up, low) | TASK-034: TASK-034 (follow-up, low): score-findings.mjs `scoreCase` (lines ~146 and 60) echoes `f.class`/`f.path`/`f.lines` from model-produced output files straight into CASE lines unredacted. The scorer is skill-local and only ever scores synthetic eval fixtures, so G-4 (bundle scripts) does not strictly apply; still, the header should say the outputs are treated as data and a runner that points it at non-fixture outputs gets unredacted stdout. Either pass the reason strings through security-evidence's redactString or state the limit in the header. |
| TASK-025 (`check`) | TASK-034: TASK-025 `check` (align when it lands): SKILL.md standalone step 11 spells `CONSISTENT-REDACTED-ONLY(n)`; plan §4.1 spells `CONSISTENT-REDACTED-ONLY(n citations)`. Whoever ships the token in tokens.mjs should reconcile the prose (a SKILL.md edit re-freezes prompt_sha256 — run `node scripts/score-findings.mjs digest` and paste). |
| PM decision (no rename) | TASK-034: PM decision: plan names `references/refutation.md`, dispatch text and branch ship `references/refutation-criteria.md`. Either is fine; a rename is one `git mv` plus editing PROMPT_FILES in score-findings.mjs (line 53), the `prompt_files` list in harness.json, the three SKILL.md references, and re-freezing prompt_sha256. Do not rename without the re-freeze or the fixtures test fails by design. |
| TASK-038 (dispatch note) | TASK-034: TASK-038 (dispatch note): `STANDALONE_SEQUENCE` is exported from secure-code-review.fixtures.test.mjs (line 179) as a stopgap; the plan says TASK-038 moves it into the e2e helpers and this test imports it. The regex in that test (line 202) relies on the allowlist `init\|validate\|all` to drop `--run`-style flags matched by `[a-z-]+`; keep that when moving it. |
| TASK-034 (no change needed) | TASK-034: TASK-034 (no change needed): harness.json pins `sampling: {temperature: 0, top_p: 1, max_tokens}` per the plan while `model_id: claude-sonnet-5` rejects temperature/top_p (verified against the claude-api reference). evals/README.md step 2 already tells the runner to send only what the model accepts and record the real request in run.json; consider repeating that one sentence in harness.json `notes` so the pinned fields are not read as a promise of sampling determinism on a thinking model. |
| TASK-037 (README/SKILL for security-evidence) | TASK-034: TASK-037 (README/SKILL for security-evidence): SKILL.md 'Standalone review' says the scripts live at `.claude/skills/security-evidence/scripts` on Claude Code — TASK-037's README standalone section must repeat this exact sequence (US-030 AC-3); copy from SKILL.md steps 1–13 rather than re-deriving. |

### Follow-ups from TASK-027 (`verify.mjs all` — steps 1–6, `verify.json`, verdict line, two-pass, 2026-09-16)

Recorded by the TASK-027 implementer. PM-log items taken: `evaluate` is wired into `verify.mjs` COMMANDS and `cmd-evaluate.mjs` reads its file through `ctx.input("evaluate", …)` (outside the tree ⇒ `USAGE(evaluate: cannot read <p> (outside the work tree))`; messages name the path as typed); `git.worktreeAdd` retries once after `worktree prune` (the first attempt's partial directory removed first; the error names both attempts' stderr) and `git.test.mjs` rethrows every worktree step with git's stderr and `worktree list --porcelain`, plus a deterministic test of the retry path (a registered-but-missing work tree at the same path). The TASK-022 packet item is taken as advised: the fix-review packet's `files[].oid` are the blobs at `head_oid`. Module split: `lib/verify-steps.mjs` (the six I/O steps, each callable alone; the one `spawn` outside git.mjs) and `lib/cmd-verify-all.mjs` (the command); fixture repo builder `fixtures/repo/build.mjs` (temp repo, never a committed `.git`). Representation choices the spec and plan left open, fixed here so `check` (025), `run snapshot verify` (058), the assessment template (024), sign-off (033) and the reviewer prose (036) share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-036 (reviewer prose), TASK-022 (`receipt validate`, no change), TASK-025 `check` | **Pass-2 run binding (TL-6).** The reviewer answers the pass-1 dispatch, so a fix-review / ack receipt carries `reviewer_run_id: <pass-1 run id>`; pass 2 is a fresh run and admits the receipt into ITS `<run>/receipts/` when `reviewer_run_id` is this run **or** a verify-kind run of the same engagement with the same `base_oid` and `head_oid` (`cmd-verify-all.mjs` `acceptsReviewerRun`). Every other check is `receipt validate`'s, in its order, with its reason spellings; the CLI `receipt validate` itself still enforces `reviewer_run_id == run` (a pass-1 receipt is admissible only through `verify all --receipts`). The admitted artifact keeps the reviewer's payload verbatim (`reviewer_run_id` = pass-1) under the pass-2 envelope; `states.applyReceipts` groups it by that id (one group per type — nothing changes). The reviewer prose must say: `reviewer_run_id` is the run id named in the dispatch (the `PACKET` path's run), never invented. |
| TASK-025 `check`, TASK-024, TASK-058 | **Fix-review packet = the blobs at head.** `files[]` = the finding's cited files (cmd-packet.citedFiles: primary + typed ranges, merged per path), `side: head`, `oid` = the blob at `head_oid`, `ranges` clamped to the file's normalised line count at head (a range starting past EOF is dropped), `range_hmac` over the blob bytes at head — not the post-install worktree bytes — so the identity is deterministic across passes, independent of install, and exactly what `git show <head>:<path>` gives the reviewer and `cite.resolveSide` gives `check`. A cited path absent at head is omitted (a deleted vulnerable file is what the reviewer sees as absence; a packet may have `files: []`). |
| TASK-025 `check` | **verify.json `receipts[]` rows.** A receipt that fails admission is recorded `{sha256, type, assertion \| indicator_id, applied: false, not_applied_reason}` where `sha256` is the identity it would have as an artifact (over the redacted payload) and `not_applied_reason` is the `REJECTED(<reason>)` spelling (`unknown packet`, `forbidden field <k>`, `schema: …`, `reviewer_run_id != run`, `subject_id not in packet.subject_ids`, `oid mismatch <path>`); it is **not** filed under `<run>/receipts/` (inputs.closeOver would otherwise report `INCOMPLETE(packet:<sha>)` for a receipt naming a foreign packet). So `check` recomputing `applyReceipts` over `<run>/receipts/` sees only applied rows; the not-applied rows exist in verify.json alone. A drop-box file that is not strict JSON, not an object, or whose `type` is not `fix-review` \| `ack` (a `vulnerability-review` receipt, a `claims-*.json`) is not a receipt of this contract: named on stderr, skipped, never a row. A second copy of the same receipt is one row. |
| TASK-025 `check`, TASK-024 | **Raw-result representations.** `tree_before` is the TREE oid of head (`HEAD^{tree}` in the checkout), not the commit oid the TASK-026 synthetic fixtures used (both are 40-hex; the schema is unchanged). `tested_tree` (allow_tracked_changes) = `HMAC_key(sorted "path\0hmac\n")` over every tracked file's working bytes after install (`verify-steps.testedTreeHmac`; a deleted tracked file contributes `deleted`). `install.tracked_changes` = paths `git status --porcelain` flags in the worktree that HMAC(working) ≠ HMAC(blob at head) confirms (a smudge/eol filter is not a change); `untracked_count/bytes` = `git ls-files --others` (ignored included) with lstat sizes. `tests.argv_sha256` / `install.argv_sha256` = sha256(canonical(argv)), keyed when the argv matches a redaction rule (G-2). `tests.reason` spellings are tokens.mjs rows: `install-modified-tree`, `install-failed`, `install-argv-rejected(<why>)`, `argv-rejected(<why>)`, `timeout`, `executable-not-found`, `spawn-failed`, `signalled`, and `execute_project_tests absent from engagement.md` for NO_TEST_SURFACE. `tests.output_redacted` = the capture (≤ 4 MiB) redacted as a whole, then bounded to 64 KiB as whole lines from the head and the tail around `[... n bytes omitted ...]`. `--timeout-s` > `execute_project_tests.timeout_s` (> 0) > 600. |
| TASK-024 (verify/assessment templates), TASK-036 (ack prose) | **Indicators.** `line` is the RAW diff line number (git's numbering; citations stay normalised per TASK-014); `ignore-file-edit` counts added **and** removed lines of an ignore/linter-config file (a removed rule can suppress too), removed lines at their base-side number; `inline-suppress` / `test-skip` count added lines; content drops one trailing CR; ordered by diff file order, line, kind. `deletion_only` maps the finding's primary cited range (normalised, base side) to raw base lines through `cite-core.lineMap`; a rename of the finding's file (delete + add under `--no-renames`) is deletion-only by design (fail-closed: moving the code is not a fix). |
| TASK-035 / TASK-047 (lead prose), TASK-038 (E2E) | **stdout of `verify all`** carries, besides the §4.2 lines, the lines of the commands it runs in-process — `RUN` + two `WROTE` (run init), `WROTE` per packet / admitted receipt (`RECEIPT admitted …` first) / verify.json, `REPORT`, `MANIFEST`, `COMMITTED`, and on pass 2 `CONSUMED` + `ROW` or `REGISTER: no row for finding`; the last line is exactly the VERDICT line. `PACKET` is TASK-057's full spelling (`PACKET <path> sha256=<h> kind=subject files=<n>`); `NEXT: dispatch security-reviewer fix-review` follows the packet's WROTE on pass 1 only. A `TRANSITION-REJECTED` from consume-verdict (a VERIFIED on an already-fixed row) is printed and the command still exits 0 with its verdict — the register is the lead's to reconcile. Pass 1 opens the register (`openRegister`, creating `<st>/register/` when absent) to read `row_status_at_start`; it appends nothing. |
| TASK-038 (E2E), TASK-035 | `verify all` needs the finding's gate run in the ledger (any run with a `gate-result.json` whose `accepted[]` carries the id, newest first; an `unverifiable[]` id is `UNKNOWN-FINDING` with a stderr note) and the current key; a `review`-kind run is fine. The E2E's `register add` goes before pass 2 (PM log G19) — without a row pass 2 prints `REGISTER: no row for finding` and still exits 0. |
| nobody — bounded by design | `tests.executable_path` is the resolved absolute path of the runner on the machine that verified (spec §6.4 step 5 asks for it); `output_redacted` is the project's own test output and may name the temporary worktree when the runner prints its cwd. Neither is a value this bundle derives (G-1 covers the bundle's values). |
### Follow-ups from TASK-031 (`publish --profile` + `check-export`, 2026-09-16)

Recorded by the TASK-031 implementer. Modules: `lib/profiles/index.mjs` (registry, `exportIdentity`, manifest naming), `lib/profiles/{redacted-report,full-report,tracker}.mjs` (pure; `apply(source, register, opts) → [{relpath, bytes}]`, `PROFILE_VERSION = 1`), `lib/profiles/_source.mjs` (the one I/O module: a COMMITTED run loaded through `inputs.pathGuard`), `lib/cmd-publish.mjs`, `lib/cmd-check-export.mjs`, fixtures under `scripts/fixtures/publish/`. Representation choices the spec and plan left open, fixed here so TASK-045 (read-back + fix route), TASK-035/047 (lead prose), TASK-038 (E2E) and TASK-043 (`handoff` / `case`) share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| spec §6.9 (representation) / TASK-043 | **The tracker profile's export manifest is a per-ticket sidecar** `handoffs/<finding_id>.export-manifest.json`, not a single `export-manifest.json`: the tracker output lands in the shared `<st>/handoffs/` directory one ticket per finding, a second run's publish would overwrite one shared manifest, and dedupe shrinks the set between publishes, so a set-level manifest could never be re-applied byte for byte. Report profiles write `export-manifest.json` next to `report.md` (+ `findings.json`). `check-export` derives the output file names from the profile and the manifest's own name (`profiles/index.expectedOutputs`) because `export-manifest.schema.json` is closed at four keys; a tracker manifest not named as a sidecar is 2 USAGE. `handoff` / `case` (TASK-043) must pick their manifest naming with the same inversion in mind. |
| every `export-manifest` reader | **`output_sha256` is one rule for every profile**: `sha256(canonical(sorted [[relpath, sha256(bytes)] …]))` (`profiles/index.exportIdentity`) — a one-file profile included, so a consumer reads every manifest the same way. The `PUBLISHED profile=<p> output=<path> sha256=<h>` line carries each file's *own* sha256; the manifest's identity is the `WROTE` line that follows the PUBLISHED lines. |
| TASK-045 (`lib/fix-prompt.mjs`), TASK-035/047 (lead prose) | **The nine-key ticket payload** (`tracker.TICKET_KEYS`, in order): `finding_id, title, class, priority, path, lines, context_redacted, fix_prompt, fingerprint`; written canonical (one line + LF). `context_redacted` = the finding's recorded `context_redacted` (secret-class, §6.5) and/or its `description`, joined by a blank line, else `unknown / not assessed` — never `snippet`, never `snippet_redacted` (a redacted snippet is still a snippet). `fingerprint = sha256(path\0class)` — the coarse search key for the lead's second-layer dedupe (same file, same class ⇒ same key); the exact identity is `finding_id`, which the read-back must find in the body. `fix_prompt` is the stub `tracker.fixPromptStub({finding_id, class, priority, path, lines, base_oid})` (`--base` = the run's `head_oid`, `--head <fix-commit>`): TASK-045 replaces that one function; nothing else changes. `targets.repo` is **not** in the payload (the shape is closed) — the lead reads it from `engagement.md` when posting through `issue-tracking`. The `ticket-payload` schema is still owed by TASK-005 (PM log G13 row); until then the shape is pinned by `profiles/tracker.test.mjs` and the payload is built, never parsed. |
| TASK-045, TASK-038 | **First-layer dedupe (`tracker.plan`)**: a finding is skipped when a register row with `subject == finding_id` carries a `ticket_url` (any status), or when a `ticket` import record *of the published run* has `trusted.state` equal to `open` (case-insensitive; the record keeps the tracker's spelling) and its inert title or body contains the id. The register is read by `readEvents` + `replay` (chain-verified, 5 CORRUPT; no lock, no projection write — `publish` never writes the register). Prior imports = the run's own `ingest/*.json` (TL-3 boundary; the register is the durable cross-run memory once TASK-045's read-back lands `ticketed`). `publish --profile tracker` needs `engagement.md` (2 ENGAGEMENT-MISSING) because the register belongs to an engagement. |
| TASK-035/047 (lead prose), TASK-038 (E2E sequence) | **`--to` rules.** Report profiles: any directory inside the work tree, resolved cwd-relative, judged on both its typed spelling and its realpath — never the root itself, never under `.git/`, never under `.agents/security-testing/` (case-insensitive, fail-closed on every platform, TASK-059 review 2); an existing *file* is refused; an existing output with different bytes is `2 USAGE(publish: <path> already exists with different content; choose another --to)` and nothing is written; a byte-identical republish is idempotent (exit 0, same lines). Tracker: `--to` must be exactly `.agents/security-testing/handoffs` (plan §4.1; a trailing slash is fine). The E2E sequence is `publish --run <id> --profile tracker --to .agents/security-testing/handoffs`, then per `NEXT:` line the lead posts and runs `ingest tracker-readback --sent <ticket path> <response.json>`. `--slug` / `--base-url` are accepted and carried in `opts` for TASK-043. |
| spec §6.9 / tokens | Tokens not spelled by the spec: `2 USAGE(publish: run <id> is not COMMITTED (build-report first))` (the plan says "2 if run not COMMITTED" and names no token); `2 USAGE(check-export: --source <p> is not the source of this export (its manifest sha256 differs))`; `2 USAGE(check-export: <p> is not an export manifest (<reason>))` — the manifest is the user's input, so the check/exit-5 rule makes a tampered one an exit-2 result, never a 5. `check-export` **without** `--source` still compares the outputs on disk against the manifest's own `output_sha256`: `LINKED-ONLY` means "linked to a source I could not re-apply, and untampered since publication"; an edited or missing output is `MISMATCH(output)` exit 5 with or without a source. `profile_version` must equal the shipped module's (2 USAGE otherwise) — a bump means the old derivative cannot be re-derived. |
| TASK-006 (`ctx.mjs`, G-15) — still owed | `cmd-publish.resolveDestination` is the **third** copy of the realpath-lenient + containment rule (`ctx.input`, `cmd-register-render.resolveOut`, now publish). The `ctx.output(command, p)` twin from the TASK-059 review is still the right home; publish adds one requirement to its contract: return *both* the lexical and the realpath'd repo-relative spellings, because a destination policy that is case-insensitive must judge the typed spelling as well as the on-disk one. `writes-outside-st.test.mjs` pins the set of realpath users to exactly these three modules. |
| TASK-024 (assessment / threat-model templates) | `redacted-report` strips by the renderer's shapes: every indented code block (`<label>: <!-- v:… -->`, blank, four-space lines, blank ⇒ `<label>: withheld by the redacted-report profile <marker>`), the `findings[i].reproduction` row, the `verify.tests.executable_path` row and any line naming `.agents/`. A new template that renders a snippet or a machine path in another shape must either use `render.code()` / a marked row or extend `redactReport` (a named G-15 edit of `lib/profiles/redacted-report.mjs`). |
| TASK-038 (E2E), TASK-025 (`check`) | `writes-outside-st.test.mjs` runs the M1 pipeline **in-process** under an fs spy (`node:module` `syncBuiltinESMExports` after patching the builtin) and asserts every non-publish write lies under the four §4 prefixes; the static half pins the closed list of writer modules (`KNOWN_WRITERS`). A task that adds a writer module (TASK-025 does not; TASK-027 `verify all` writes a worktree under the OS tmpdir through `git`, not `fs`) extends the list deliberately. |

### PM log additions (after G13)

Reviewer nits recorded verbatim from Rio's TASK-027 (`verify all` core), TASK-031 (`publish` / `check-export` profiles) and TASK-036 (security-reviewer agent) PASS reviews, routed by the PM. (A `|` inside a note is escaped as `\|` for the table cell; the text is otherwise unchanged. The G13 integration step applied the KNOWN_WRITERS extension predicted in the TASK-031 row below: `lib/cmd-verify-all.mjs` was added to `writes-outside-st.test.mjs`.)

| Owner | Note |
|---|---|
| TASK-027 follow-up (next git.mjs editor) | TASK-027: git.mjs worktreeAdd (shared module, TASK-027 edit): the prune-retry runs `rmSync(dir, {recursive, force})` on the caller-supplied `dir` after ANY first-attempt failure. Probe confirmed: a pre-existing non-empty `dir` (contract violation, previously a clean git error 'already exists') is now silently deleted and checked out over. Only in-tree caller (verify-steps.worktreeStep) passes a fresh mkdtemp child, so not live. Fix: record `existed = existsSync(dir)` before attempt 1 and only rmSync/retry when `!existed` (or when first.stderr matches /already registered/); add the case to git.test.mjs. Owner: TASK-027 follow-up (next git.mjs editor). |
| TASK-027 follow-up / TASK-025 (`check` re-derivation) | TASK-027: verify-steps.installStep: `tracked` is `git ls-files` of the POST-install index, so an install that stages/un-stages (`git rm --cached`, `git mv`, `git add`) changes the set that `tracked_changes` and `tested_tree` cover — a path dropped from the index vanishes from both. Pathological, fail-open only for an install that runs git. Fix: take the tracked list from `git ls-tree -r --name-only <head_oid>` (head's tree, fixed before install) and treat an index-only change as a tracked change. Owner: TASK-027 follow-up / TASK-025 check re-derivation. |
| TASK-036 (TASK-024/025 informational) | TASK-027: cmd-verify-all.fixReviewFiles: the fix-review packet applies the finding's BASE-side normalised ranges to the HEAD blob (clamped). After a fix that shifts lines, the reviewer's window may not cover the moved code; fail-closed (reviewer answers indeterminate) but TASK-036 reviewer prose must say the fix-review packet is 'the cited file at head, base-numbered window' and that `git show <head>:<path>` of the whole file is in bounds. Owner: TASK-036; TASK-024/025 informational. |
| TASK-025 (TASK-022 doc note) | TASK-027: acceptsReviewerRun broadens `reviewer_run_id` binding for verify runs (this run OR any verify-kind run of the engagement with the same base/head). Documented in the plan follow-ups, but TASK-025 `check` must apply the SAME rule when re-verifying a verify run's admitted receipts or it will flag every pass-2 receipt as run-mismatched; `cmd-receipt validate` still enforces `== run` (a pass-1 receipt is admissible only through `verify all --receipts`). Owner: TASK-025 (and TASK-022 doc note). |
| TASK-035 prose / TASK-027 follow-up | TASK-027: verify-steps.runChild: a test process that exits 0 but leaves a grandchild holding stdout/stderr (a daemon) makes `close` wait until the full timeout, then the record is `TESTS_INDETERMINATE(timeout)` with `exit_code: 0`. Conservative, but the lead should know why a passing suite reads as timeout. Owner: TASK-035 prose (one sentence) or TASK-027 follow-up (start the 2 s close-grace on `exit` unconditionally, not only after a timeout). |
| TASK-027 follow-up (git.mjs shared edit) | TASK-027: verify-steps.parseUnifiedDiff: git quotes paths with non-ASCII/special bytes under core.quotePath (`"a/caf\303\251.js"`); diffGitPath/diffName do not unquote, so such a path never equals `finding.path` (deletion_only stays false — fail-open for that file) and the indicator `path` is the quoted spelling. Fix: run diffUnified with `-c core.quotePath=false` in git.mjs (pinned like the prefixes) and add a git.test.mjs guard. Owner: TASK-027 follow-up (git.mjs shared edit). |
| TASK-038 | TASK-027: Test-fixture note: cmd-verify-all.test.mjs AC-7 G-1 check greps the payload for `/tmp/\|/var/folders/` and an ISO date; a project test runner that prints its cwd or a timestamp will legitimately put those into `tests.output_redacted` (documented 'bounded by design' row). Fine for the fixture; TASK-038 E2E byte-equality must fix `SECURITY_EVIDENCE_NOW` AND use a runner that prints no clock. Owner: TASK-038. |
| TASK-031 follow-up | TASK-031: cmd-publish.mjs ~line 250 (tracker loop): conflict checks are per ticket set, so a foreign `<id>.ticket.json` on the third-sorted finding lands after tickets 1–2 (and their sidecars) are already written — probed: exit 2, 4 derived files on disk, no NEXT lines for them. Header step 2/5 claims nothing is written before every check passes. Not a corruption (the written files are correct derivatives; a republish is idempotent and prints the NEXT lines) — fix: apply every planned finding first, run the differs/isDirectory/manifest checks over the union, then write; or at least print NEXT for the tickets that did land. Owner: TASK-031 follow-up. |
| TASK-031 follow-up (TASK-024 for new template shapes) | TASK-031: profiles/redacted-report.mjs:39 CODE_LABEL `^(.+): (<!-- v:… -->)$` also matches the renderer's multi-line prose shape (`Description\|Impact\|Prerequisites\|Remediation: <marker>`, blank, lines) — a description whose first line starts with four spaces is withheld and the rest orphaned (probed: `- Description: withheld … <marker>` then `second`). Over-removal, deterministic, no leak. Fix: anchor to the two code() labels (`Evidence (…)`, `Test output (…)`) or make prose blocks structurally distinct. Owner: TASK-031 follow-up (TASK-024 when the other templates render code in a new shape). |
| TASK-031 follow-up | TASK-031: profiles/redacted-report.mjs:43 LOCAL_LAYOUT `/\.agents\//` drops any line naming `.agents/` — a finding whose path is under `.agents/` (a scope can include it) loses its `\| affected asset \|` row (probed). Lossy, not a leak; restrict to `.agents/security-testing/` or state the limit in the header. Owner: TASK-031 follow-up. |
| TASK-045 | TASK-031: profiles/tracker.mjs `plan` dedupe rule (a) matches `row.subject === finding_id` only and never reads finding-alias.jsonl (register-transitions: alias equivalence is undirected and transitive), so a re-keyed finding whose old id was ticketed is posted again. Route: TASK-045 (owner of the read-back/`ticketed` flow) — consult `readAliases` and treat alias-equivalent subjects as one finding in `plan`. |
| TASK-031 follow-up | TASK-031: Two documented tracker refusals have no test: a broken register chain ⇒ `5 CORRUPT` and a missing engagement.md ⇒ `2 ENGAGEMENT-MISSING` (both probed on the branch and behave as the header says). Add one test each. Owner: TASK-031 follow-up. |
| TASK-043 dispatch note + TASK-005 | TASK-031: `check-export` re-applies with opts derived from the manifest name only; `--slug`/`--base-url` are not recorded (export-manifest schema is closed at four keys). Harmless in M1 (all three apply() ignore them) but TASK-043's `handoff` profile (`base_url`) cannot be VERIFIED-DERIVATIVE unless the manifest carries it or the derivation is deterministic without it. Route: TASK-043 dispatch note + TASK-005 (a named G-15 schema extension if chosen). |
| PM (TASK-027 / TASK-006 dispatch notes) — TASK-027 extension applied at G13 integration | TASK-031: writes-outside-st.test.mjs pins `KNOWN_WRITERS` and the realpath-resolver set (`cmd-publish`, `cmd-register-render`, `ctx`) as exact lists: TASK-027 (`verify.json` via writeArtifact + worktree) and the owed `ctx.output` twin (TASK-006) will each have to extend them deliberately. PM: put it in those dispatch notes so the failure is expected, not a surprise. |
| TASK-023 lineage | TASK-031: inputs.mjs PathGuardError's message hardcodes `build-report:`; `_source.loadSource` reuses pathGuard from `publish`/`check-export`. Unreachable today (every path is joined under the run dir; `list()` returns bare names) but the attribution would be wrong if it ever fired. Cosmetic; TASK-023 lineage — parametrise the command name. |
| TASK-036 (or TASK-046/047) | TASK-036: agents.test.mjs ~line 147: the receipt-field check uses `new RegExp(`\`?${key}\`?`)` — with both backticks optional it matches the bare word anywhere (`type` matches 'typed citations'), so it is weaker than it reads. Require the backticked form (`\`${key}\``) or the JSON-key form; every key is present verbatim today so the test still passes. Owner: TASK-036 (or TASK-046/047 when the threat-modeler/security-lead tests extend this file). |
| PM log (plan §5 TASK-036 correction) | TASK-036: Plan §5 TASK-036 Implementation text says `git show <oid>:<path>`; the packet's `oid` is the 40-hex BLOB oid (packet-core.mjs line 22), so `git show <oid>` — what AGENT.md, RULES.md and the merged secure-code-review SKILL.md all say — is the correct form and `<oid>:<path>` would fail. The agent is right; route a one-word plan correction to the PM log rather than the task. |
| TASK-036 (cosmetic, leave) | TASK-036: AGENT.md ## Rules rule 2: the bold span opens at 'Writable paths are' and closes after 'Self-check before every write' with the parenthetical outside — reads oddly in rendered markdown; cosmetic, same wording as the spec §4 rule so fine to leave. |
| TASK-027 or TASK-036 follow-up | TASK-036: AGENT.md ### fix-review describes indicators as `{id, kind, path, line}` but does not say the `id` is 64-hex (receipt.schema.json ack.assertion.indicator_id pattern). The agent copies the id from the dispatch so it cannot get it wrong in practice; a five-word addition would make the ack shape self-contained. Owner: TASK-027 (verify all prints the indicator list) or TASK-036 follow-up. |
| TASK-037 | TASK-036: NOTES.md is a new file class for an agent dir (nearest precedent: bundles/product-management/agents/designer/README.md and the manual-qa RULES.md siblings). It is not in SDLC_ROLE_MEMORY_FILES_DEFAULT so no hook injects it, and the installer copies only AGENT.md/SOUL.md for Copilot/Codex; on Claude the directory copy will carry it along as inert bytes. Acceptable; TASK-037 (factory.json) should confirm the E2E harness does not treat unexpected siblings as an error. |

### PM log additions (after G14)

Reviewer nits recorded verbatim from Rio's TASK-024 (assessment / verify / threat-model templates + full §11 sections) PASS review, routed by the PM. (A `|` inside a note is escaped as `\|` for the table cell; the text is otherwise unchanged.)

| Owner | Note |
|---|---|
| TASK-025 (`check`) | TASK-024: TASK-025 (check): the dev note 'check is unaffected until it opts in' holds only when every key_id in the closure has a key file at build time. A report built while a key was missing carries a `KEY: unavailable — artifacts whose key <id> …` Limitations line, so check MUST build `opts.keys` from `render.keyIdsOf(inputs)` + `ctx.keyById` exactly as cmd-build-report.mjs:193-198 does, or the byte-compare reports INCONSISTENT. render.mjs header already states it; TASK-025's task text should name it explicitly. |
| TASK-023 follow-up (TASK-025 informational) | TASK-024: inputs.mjs:260 (TASK-023 follow-up, informational for TASK-025): readVerifySnapshots now pins verify.json to its directory id, but the snapshot's packets/receipts sets are not checked to name that verify run (only content-addressed identity is enforced). Harmless today — a receipt/packet's identity is its payload — but check's fs-spy/INCONSISTENT tests should not assume run_id is enforced on snapshot set members. |
| TASK-039 (tm-lint) | TASK-024: TASK-039 (tm-lint): threat-model.schema.json gives `Element.name`, `Threat.title`, `Mitigation.claim` no minLength; an empty string renders as a blank table cell in section 10 (§11 'blank forbidden'). Same pre-existing pattern as finding.title in the review template; tm-lint should reject empty names/titles/claims so the renderer never sees them. |
| TASK-024 follow-up (cosmetic) | TASK-024: cmd-build-report.mjs:189 + 194: ctx.keyById(run.envelope.key_id) is called twice for the run's own key (once for `key`, once inside the keyIdsOf map). Trivial; `key` could be `keys[run.envelope.key_id]`. |
| TASK-031 follow-up (redacted-report profile) | TASK-024: TASK-031 follow-up (redacted-report profile): the assessment's proposals table row carries `.agents/security-testing/proposals/<id>.proposal.md`, so LOCAL_LAYOUT drops the whole marked row (over-removal, deterministic, no leak). If the profile wants the proposal id/sha kept, withhold the path cell instead of the line — no TASK-024 change needed. |

### Follow-ups from TASK-025 (`check` — recompute, integrity, drift, origin, key, 2026-09-16)

Recorded by the TASK-025 implementer. PM-log items taken: `SnapshotMismatch` / `SnapshotMissing` ⇒ `INCONSISTENT(snapshot:<path>)` with no `err.actual` / `err.message` on stdout; `resolveSide` memoised per (side, path) with failures memoised too; the import-record presence re-check (coverage scanner rows + unlocated locators ⇒ `INCONSISTENT(import:<sha>)`); `opts.keys` built from `render.keyIdsOf` + `ctx.keyById` exactly as `build-report`; look-alike TL-7 markers inside four-space-indented evidence lines name `report.md`; the `CONSISTENT-REDACTED-ONLY(n citations)` spelling reconciled in `secure-code-review/SKILL.md` step 11 (prompt_sha256 re-frozen in `evals/harness.json`). Representation choices the spec and plan left open, fixed here so `sign-off` (033) and the E2E (038) share one boundary:

| Owner | Note |
|---|---|
| 033 `sign-off` | `checkRun(ctx, runDir, {integrity, drift, trustedDigest}) → {run_id, template, code, consistency: {token, status: consistent \| redacted-only \| structure-only \| inconsistent, field, redacted_only, checked: {citations, packets, receipts}}, drift: null \| {token, current, citations_drifted, citations_skipped, citations_current, scope_drifted, scope_files}, origin: {token, matched, recomputed_manifest_sha256}, key: {token, available, key_id}}`. INCONSISTENT is a **result** (`code: 5`), not a throw; only `2 USAGE(check: unknown run …)` and `3 INCOMPLETE(COMMITTED)` throw. "Latest assessment not CURRENT at scope level" is `drift.scope_drifted > 0`; the printed line names citation drift when there is any, else scope drift, else `CURRENT`. Drift is computed only for a consistent set (no drift line on INCONSISTENT). |
| spec §6.3 (representation) | The dispatch's "resolve the manifest from the report footer / MISSING-MANIFEST" is neither in spec v6.2 §6.3 nor the plan, and the footer carries no manifest hash by design (the manifest covers the report). `check <run dir \| manifest.json>` as spelled: the positional must lie under `<st>/runs/<run_id>` (2 USAGE otherwise); no marker ⇒ `3 INCOMPLETE(COMMITTED)`; a marker with no sidecar / report ⇒ `INCONSISTENT(manifest.json \| report.md)`; a missing required input after COMMITTED ⇒ `INCONSISTENT(input:<name>)` (absence is a change once the run is closed). |
| spec §6.3 (representation) | `manifest.template_version` / `tool_version` are compared with the shipped template and `version.json` **before** anything is rendered ⇒ `INCONSISTENT(manifest:template_version \| manifest:tool_version)`, so a tool upgrade reads as what it is rather than as a byte difference. The recomputed manifest hash ORIGIN compares against therefore pins the tool version too (a consumer-held digest from 1.0.0 will not match under 1.0.1 — the derivation is the current tool's). |
| spec §6.3 STRUCTURE-ONLY (representation) | Without the run's key the recomputed view necessarily says `key: unavailable` and lists the un-derived identities, so the byte comparison leaves out the lines marked `key` and `limitations[n]` (both sides) and everything else must match; the recomputed manifest hash then takes `report_sha256` over the recorded report bytes (never the sidecar). A key needed by a private citation record or a packet that is missing while the run's key is present also downgrades `--integrity` to STRUCTURE-ONLY. |
| 027 / 022 (doc note) | `--integrity` re-checks receipt binding with the pass-2 rule locally: `reviewer_run_id` is this run, or — verify runs only — a RUN_ID with this run's head prefix (`head_oid[0:12]`, TL-9). The pass-1 run's `run.json` is outside the run directory (G-16), so `base_oid` equality is not re-checked here; `verify all` checked it at admission. |
| 025 scope (representation) | `--integrity` content re-validation covers the run's OWN citations (every finding's primary citation; typed citations carry no recorded content and are extent-checked by drift only) and the run's OWN `packets/*` (oid at the run's side + `range_hmac` with the packet's key). Verify-snapshot packets/receipts enter by identity only (closeOver) — their content is `check`'s on their own run. A plain finding whose raw range or snippet matches a redaction rule (or class `secret`) is `INCONSISTENT(citation:<id>)`: a plain id over protected content is a G-2 violation in the record, not a re-derivation. |
| 025 drift (representation) | A snapshot citation is compared after redacting the working file (as scope did), so an edit inside a redacted span shows as `SCOPE-DRIFTED` (the file's original HMAC changed) while the citation's redacted text stays current; a visible edit next to it drifts the citation. A side that cannot be resolved during `--drift` alone counts as drifted (`--integrity` names the cause; drift never changes the exit code). |
| 019 `gate` (informational) | A claim whose `snippet` (not `snippet_redacted`) already contains `<REDACTED:…>` against a snapshot side gates as a PLAIN finding (the raw snapshot range is redacted bytes, so no rule matches): identity is sha256 over redacted text — G-2 allows it — but the reviewer's "I read redacted bytes" is only recorded when the claim uses `snippet_redacted`. TASK-034/036 prose should say which key to use; no gate change needed. |

### PM log additions (after G15)

Reviewer nits from Rio's PASS review of TASK-025 (`task/task-025`), recorded verbatim.

| Owner | Note |
|---|---|
| TASK-025 follow-up / TASK-033 | TASK-025: cmd-check.mjs:637-664 — when the run key is present but a citation-record/packet key is missing, line 1 downgrades to STRUCTURE-ONLY while line 4 still prints `KEY: available`; spec §6.3 pairs STRUCTURE-ONLY with `KEY: unavailable`. Consider printing `KEY: unavailable` (or a structured `key.missing: [ids]`) whenever `skipped > 0`, so sign-off (TASK-033) does not have to infer the cause from token mismatch. Owner: TASK-025 follow-up / TASK-033. |
| TASK-025 follow-up | TASK-025: cmd-check.mjs:292-302 — under STRUCTURE-ONLY every `limitations[n]` line is dropped from the byte comparison, not only the KEY line, so a report whose `receipts not applied: N` / `conflicting receipts: N` / `redaction rules version` limitation lines were edited passes as STRUCTURE-ONLY (the derived counts are still checked via the findings table, so no identity is affected). A tighter rule would drop only the limitation lines that start with `KEY:`. Owner: TASK-025 follow-up. |
| TASK-025 follow-up / TASK-033 | TASK-025: cmd-check.mjs:346-347, 314 — `guard.read` on a `report.md`/`COMMITTED`/`ingest/<sha>.json` that has been replaced by a directory throws EISDIR, and a `PathGuardError` is not in `INTEGRITY_ERROR_NAMES`, so `asInconsistent` rethrows ⇒ exit 1 INTERNAL instead of 5 INCONSISTENT for a tampered run; `sign-off` calling `checkRun` in-process will crash rather than report FAIL for that run. Map EISDIR/ENOTDIR/PathGuardError to INCONSISTENT(<file>) or have sign-off wrap. Owner: TASK-025 follow-up / TASK-033. |
| TASK-025 follow-up / TASK-022 (doc note) | TASK-025: cmd-check.mjs:400-408 — the verify-run receipt binding is prefix-only (`head_oid[0:12]`), weaker than `verify all`'s `acceptsReviewerRun` (kind verify + same engagement + equal base/head). G-16 justifies not reading the other run.json; note the difference explicitly in the cmd-check header and the TASK-022 doc note so nobody later assumes `check --integrity` re-proves the pass-1 binding. Documented in PM log already — header sentence only. |
| TASK-023 follow-up | TASK-025: cmd-check.mjs:305-316 / inputs.mjs:147 — the PM-log symlink note (pathGuard is lexical; `ingest/<sha>.json` may be a symlink pointing out of the run dir and `readVerified` follows it) was not taken here; harmless because the record must hash to its name and carry `import_sha256 === sha`, but the header claims 'every read is the run directory…' — add the lexical-only caveat or filter `e.isFile()`. Owner: TASK-023 follow-up. |
| TASK-038 (E2E dispatch) | TASK-025: cmd-check.test.mjs:663-672 — the verify-run integrity path asserts INCONSISTENT(packets/…) because the TASK-026 fixture oid is synthetic; there is no test where a verify run's fix-review packet passes `--integrity` CONSISTENT with a real head blob and a pass-1-prefixed receipt (the positive branch of the TL-6 rule at line 404 is only exercised via reviewer_run_id === run_id). TASK-038 E2E (verify pass 2 then `check --integrity`) should cover it; note in TASK-038's dispatch. |
| TASK-033 (Interface Contract) | TASK-025: docs plan follow-ups row `033 sign-off` — `checkRun` result shape is documented only in the PM log and the JSDoc; TASK-033's Interface Contract should paste it verbatim (TL-1 convention) before that task is dispatched. |

### PM log additions (after G16)

Reviewer nits from Rio's PASS review of TASK-033 (`task/task-033`), recorded verbatim.

| Owner | Note |
|---|---|
| TASK-033 follow-up | TASK-033: cmd-sign-off.mjs:195 (inventory) — the run.json read swallows only CanonError/IntegrityError/ENOENT; run.json replaced by a directory throws EISDIR here, before checkRun, so the 'check throws ⇒ INCONSISTENT(runs/<id>)' fold (deviation #6) never runs and sign-off exits 1 INTERNAL (verified in a detached worktree: stderr `evidence.mjs: EISDIR: illegal operation on a directory, read`, nothing on stdout). Fail-closed and no content leaked, so a nit. Fix: widen the catch to `err.code === 'EISDIR' \|\| err.code === 'ENOTDIR'` (leave the run in `committed`; checkRun then throws and checkOrInconsistent folds it, as probe A for report.md-as-directory already does). Owner: TASK-033 follow-up. |
| TASK-033 follow-up / TASK-041 | TASK-033: cmd-sign-off.mjs:202/241 — `kind` is taken from the ledger entry and never cross-checked against run.json's `template`. A ledger entry rewritten review→assessment makes a review run the 'latest assessment'; check passes it, then listedThreats reads a threat-model.json that does not exist ⇒ exit 1 ENOENT with the absolute run path on stderr (verified). Tamper-only (allocateRun writes both from --kind) and fail-closed, so a nit. Fix: in inventory, when run.json is readable and `run.payload.template !== entry.kind`, keep the run but mark it and fail it as INCONSISTENT(runs/<id>) (or derive kind from run.json and let the ledger be inventory only). Owner: TASK-033 follow-up; TASK-041 touches listedThreats anyway. |
| TASK-033 follow-up / TASK-035 | TASK-033: cmd-sign-off.mjs:330 — only the first tracked managed path is named (`tracked(trackedPaths[0])`); with two patterns tracked (probe F: receipts/ and runs/<id>/COMMITTED) the second is silent although `result.tracked` carries both and spec §7's `…` allows one FAIL line per cause. Fix: `for (const p of trackedPaths) fail(tracked(p))`. Owner: TASK-033 follow-up (TASK-035's checklist prose should say 'one line per tracked pattern'). |
| TASK-033 follow-up | TASK-033: cmd-sign-off.test.mjs — no test for the checkRun-throws fold (deviation #6) nor for a COMMITTED run attributed to another engagement being skipped; both are claimed behaviors in the header. Add two cases to the AC-3 table: `rmSync(<run>/run.json)` ⇒ `FAIL(INCONSISTENT(runs/<id>)) run=<id>` (probe C shows this works today) and a re-enveloped run.json naming `eng-other` ⇒ `RUNS: 0` + stderr note. Owner: TASK-033 follow-up. |
| PM log / TASK-041 | TASK-033: Plan §5 TASK-041 says 'read latest assessment's dispositions.json' and 'add the token to FAIL_CAUSES'; TASK-033 already evaluates the policy over `<run>/threat-model.json` `disposition.kind` and already carries `DISPOSITIONS(<threat ids>)` in FAIL_CAUSES. The spec-default reading (absent ⇒ executed-or-ticketed) is correct per §6.10/§20 and I accept it, but PM should shrink TASK-041's scope to: (a) switch the source to dispositions.json if that M2 artifact lands, (b) relationship validation via tm-lint — not re-adding the token or re-doing the policy switch. Owner: PM log. |
| TASK-033 follow-up | TASK-033: tokens.mjs — the eight new guard functions (runsEntry, incompleteEntry, changeEntry, excludedCoverageEntry, approvalEntry, dispositionsHeader, dispositionEntry) have no direct throw tests in tokens.test.mjs; only signOffFail/coverageIndeterminate/dispositionsBlocking are covered (in cmd-sign-off.test.mjs). Happy paths are exercised through the CLI, so a nit. Owner: TASK-033 follow-up. |
| TASK-033 follow-up | TASK-033: Header comment claims 'EISDIR under a tampered run' is folded — true for files check reads (report.md, COMMITTED, ingest/*), false for run.json (nit 1). Reword once nit 1 lands. |

### PM log additions (after G17)

Reviewer nits from Rio's PASS review of TASK-035 (`task/task-035`), recorded verbatim.

| Owner | Note |
|---|---|
| TASK-035 follow-up / TASK-047 | TASK-035: bundles/security-testing/skills/security-engagement/references/sign-off-checklist.md:30 — 'Every cause but the first two and the register ones names its run' is wrong against cmd-sign-off.mjs: `INCONSISTENT(<field>)`, `STRUCTURE-ONLY`, `SCOPE-DRIFTED(<n> files)` carry ` run=<run_id>`; `COVERAGE-INDETERMINATE(<run>)` names it in the parens; `NO-ASSESSMENT`, `CORRUPT`, `TRUNCATED`, `DIVERGED`, `DISPOSITIONS(…)`, `TRACKED(<path>)` carry no run. Rewrite the sentence to name those groups (owner: TASK-035 follow-up or TASK-047 lead prose). |
| TASK-035 follow-up | TASK-035: bundles/security-testing/skills/security-engagement/references/workflow.md:19,39 — the prose promises every result line 'spelled exactly as the script prints it', but `TEMPLATES: written` / `TEMPLATES: present` are not the line: tokens.templatesLine prints one `<file>=written\|present` entry per knowledge file (`TEMPLATES: engagement.md.template=written finding-schema.md=written report-reading-guide.md=written`). Spell the real shape (owner: TASK-035 follow-up). |
| TASK-035 follow-up / TASK-045 | TASK-035: bundles/security-testing/skills/security-engagement/references/tracker-rules.md:33 — 'Comment the new finding_id and fingerprint lines on it … so its body carries the id': a comment is not the body. ingest/tracker-readback.mjs checks `body.includes(finding_id)` and `title === sent.title`, so a commented-on pre-existing ticket reads back `MISMATCH(body)` as well as the acknowledged `MISMATCH(title)`. Say 'edit the body' (step 4 already does) or acknowledge both mismatches on that path (owner: TASK-035 follow-up; TASK-045 owns the `ticketed` gate this feeds). |
| PM (integration) | TASK-035: The two-dot diff `feat/security-testing-bundle-spec..task/task-035` shows docs/superpowers/specs/2026-09-16-delivery-metrics-design.md reverting v2→v1: merge-base artifact (branch cut at 8fabf93, d3eab3d landed after). `git diff --stat 8fabf93..task/task-035` and the three-dot diff are the six intended files only. Merge with a real merge commit, not a squash of the two-dot diff, or v2 gets clobbered. |
| TASK-033 follow-up | TASK-035: TASK-033 follow-up still open (PM log after G16): checklist says 'one line per tracked pattern'; cmd-sign-off.mjs:328 still prints only `tracked(trackedPaths[0])`. Already routed to TASK-033. |
| PM (review process) | TASK-035: Review-process note: I ran `npm run validate` in the detached worktree; that aggregate script chains `validate:externals` (exit 0, no side effects observed). Future reviews should run `validate:factories`, `validate:marketplaces`, `validate:dupes` individually. |
| PM (CI) | TASK-035: skills-ref is not installed locally so the CI agentskills.io check could not be reproduced; the frontmatter mirrors secure-code-review's (TASK-034, CI-green) field for field and the branch test pins name/description shape. |

### PM log additions (after G18)

Reviewer nits from Rio's PASS review of TASK-037 (`task/task-037`), recorded verbatim.

| Owner | Note |
|---|---|
| TASK-037 follow-up | TASK-037: TASK-037 follow-up: bundles/security-testing/skills/security-evidence/SKILL.md `register.mjs render` row spells its result as `WROTE …`; cmd-register-render.mjs:115 prints `RENDER <path> rows=<n> seq=<n>` and never calls ctx.wrote (risk-register.md is Markdown, not an enveloped artifact). Spell the RENDER line; the instructions.md `register.mjs` token-table row omits it too. |
| TASK-037 follow-up | TASK-037: TASK-037 follow-up: SKILL.md `evidence.mjs scope` row lists only `WROTE <run>/scope.json …`; cmd-scope.mjs:370 prints `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` before the WROTE line. Same for `run snapshot register\|verify\|proposals`: cmd-run-snapshot.mjs prints `SNAPSHOT register events=<n> chain=<h>` / `SNAPSHOT verify from=<run_id> sha256=<h>` / `SNAPSHOT proposals n=<n>` (WROTE follows for register and proposals only). Add the result lines. |
| TASK-037 follow-up | TASK-037: TASK-037 follow-up: SKILL.md `evidence.mjs publish` row spells `DEDUPE finding=<id> existing=<R-id>`; lib/profiles/tracker.mjs:156-163 fills `existing` with the ticket URL (the register row's `ticket_url` or the open import's trusted url), matching the header comment in cmd-publish.mjs:47 `existing=<url>`. Spell `<url>`. |
| TASK-037 follow-up | TASK-037: TASK-037 follow-up (low): SKILL.md `evidence.mjs sign-off` usage omits the `--integrity` / `--drift` flags cmd-sign-off.mjs accepts; instructions.md artifact map omits the reserved `<st>/imports/` directory that plan §3.2 lists. Both are omissions, not misstatements. |
| TASK-037 follow-up | TASK-037: Dev deviation note miscounts: references/ holds 27 `*.schema.json`, not 28; the shipped SKILL.md schema index names all 27 (the test pins every file present), so only the deviation text is off. |
| TASK-037 follow-up / TASK-038 | TASK-037: Deviation claim 'the codex target install also exits 0' is not in manifest.test.mjs (only the claude-target seed test runs); the PM-log NOTES.md item is confirmed by the claude run alone, which is what the plan asked for. TASK-038 E2E should cover the other targets if it does not already. |
| PM (integration) / TASK-052 | TASK-037: PM (integration): task/task-037 is cut at 28ecfde (spec/plan tips), so the two-dot diff is exactly the ten intended files — no merge-base artifact this time. `.claude-plugin/marketplace.json` (hand-curated, still on `factories/` paths) carries no security-testing entry; plan §5 TASK-052 owns catalog rows, not this task. |

### PM log additions (after G19)

Reviewer nits from Rio's PASS review of TASK-038 (`task/task-038`), recorded verbatim.

| Owner | Note |
|---|---|
| TASK-038 follow-up | TASK-038: e2e.test.mjs:198 (`offline provisioning` test) provisions a second full path-(a) consumer that `buildPathA` provisions again ~1s later; the provisioning assertions (monorepo byte-equality, cache-clone origin, no https) hold on the pathA fixture too — reuse `pathA()` and drop one installer run. Owner: TASK-038 follow-up, cosmetic. |
| TASK-038 follow-up | TASK-038: e2e.test.mjs:556 `assert.deepEqual(fixReview, { sha256: fixReview.sha256, … })` self-compares the hash; pin `assert.match(fixReview.sha256, HEX64)` instead so the field is actually checked. Owner: TASK-038 follow-up. |
| TASK-038 follow-up / TASK-048 | TASK-038: fixtures/e2e/helpers.mjs:187 `commandName` positional heuristic assumes every `--flag` consumes the next token, so a boolean flag followed by a positional (e.g. `check --integrity <path>`) drops the positional; harmless for every spelling the E2E uses (paths precede flags, sub detection is a closed list) but worth a comment or a boolean-flag allowlist before TASK-048 extends the sequence. |
| TASK-039 / TASK-042 | TASK-038: e2e.test.mjs:636 STUB_TESTED_BY allowlist (lib/cmd-tm-lint.mjs, lib/cmd-plan.mjs) is honest (entry-script import + sibling test checked, stub existence pinned) but is a TL-1 exception: TASK-039 and TASK-042 must delete their row when the real sibling test lands — route as a note into both dispatches. |
| TASK-037 follow-up / docs | TASK-038: Spec §12 literal 'no original bytes anywhere under .agents/security-testing/' holds until the lead copies the raw SARIF into reserved `<st>/imports/`; the E2E correctly pins `imports/semgrep.sarif` as the sole carrier and every bundle-written file clean. Suggest one README 'Not guaranteed' line (operator raw drops under `imports/` are not redacted) — owner TASK-037 follow-up / docs, not this task. |
| TASK-027 follow-up / TASK-006 | TASK-038: Dev-reported out-of-ownership leftovers stand as routed: lib/git.test.mjs worktree-retry flake (TASK-027 follow-up) and fixtures/cli/harness.mjs leaking one sec-gitconfig-* dir per importing test file without after(cleanupAll) (TASK-006). Confirmed the E2E itself leaves zero sdlc-offline-* dirs after a full run. |

### PM log additions (2026-09-17, M1 manual smoke)

Manual smoke on a throwaway repo (install → engagement init ×2 → run init review → scope → packet → gate on a hand-written claim → coverage → build-report review → check CONSISTENT/CURRENT, tampered report ⇒ INCONSISTENT(summary.by_priority_state.p1) → fix commit → verify pass 1 → receipt → register add → verify pass 2 ⇒ UNVERIFIED-NO-TEST-SURFACE without an operator test command → sign-off FAIL(NO-ASSESSMENT) with the §7 listing) behaved per spec at every step.

| Owner | Note |
|---|---|
| TASK-052 or a small follow-up | Every CLI dumps a Node stack trace on `EPIPE` when stdout is closed early (`… \| head -1`). Handle EPIPE on stdout in `ctx.out`/the dispatcher: exit quietly with the intended code. |
| TASK-035 / README | The receipt drop-box contract is easy to get wrong by hand: `reviewer_run_id` must equal the pass-1 verify run id and the receipt must be dropped under `receipts/<pass-1 run>/`; `verify.json` says so (`not_applied_reason: reviewer_run_id != run`) but the reviewer prose and README should spell the sequence out with the exact fields. |
| TASK-042 | `packet --kind subject --type case` seam (re-pointed from TASK-021 per the G10 PM log). |

### PM log additions (after G20)

Reviewer nits from Rio's PASS reviews of TASK-039 (`task/task-039`), TASK-045 (`task/task-045`) and TASK-046 (`task/task-046`), recorded verbatim (only `|` inside a note is escaped for the table). Merged in that order with `--no-ff`; the single conflict (tokens.mjs / tokens.test.mjs, additive, 039 vs 045) was auto-resolved keeping both sides; `node --test` 1784/1784, `validate:factories` and `validate:dupes` green.

| Owner | Note |
|---|---|
| TASK-039 follow-up | TASK-039: TASK-039 follow-up: lib/tm-lint-core.mjs — agent-authored free text is interpolated into the TM-INVALID reason unescaped (`t.element_id` in `element ${…} is not in the model`, `c.path` in citationText, `ref` in `${kind}(${ref})`), and tokens.tmInvalid refuses a reason with \r/\n by throwing TypeError. Probed on ad1df70: a `planned` ref `"P-001\nX"`, an element_id `"E-\n009"` and a citation path `"src/x\ny.js"` each ⇒ exit 1 INTERNAL, empty stdout, stderr `tm-lint.mjs: tmInvalid: reason must be a non-empty one-line string`; in the ref case the snapshot is persisted first (structure passed). Fail-closed, nothing leaks, identities intact — but the threat-modeler's 'return the lint line verbatim' rule has no line to return. Fix: fold `\r?\n` to a space (or JSON.stringify the free-text part) in `fail()`/`citationText`/`at` before it reaches tmInvalid, and add the three cases to tm-lint-core.test.mjs. Verified: whitespace-folding in fail() keeps every existing assertion green (no current test uses a newline in a locus reason). |
| TASK-039 follow-up | TASK-039: TASK-039 follow-up: lib/cmd-tm-lint.mjs `render` reads `<run>/threat-model.json` / `<run>/dispositions.json` with bare readArtifact, and `readAll` (receipts/, packets/, ingest/) does the same, so a tampered snapshot, a tampered index or a stray non-artifact `junk.json` under those dirs exits 5 with NO stdout token (stderr only: `integrity: self_sha256 mismatch …` / `artifact must have exactly {envelope, payload} (…/ingest/junk.json)`), while `check`'s own persist path prints `INCONSISTENT(threat-model\|dispositions)` for the same tamper (probed both). Route through `readOptional`'s IntegrityError/CanonError → `integrityFailure(inconsistent(<name>))` fold so both commands spell the §3.1 token (`INCONSISTENT(threat-model)`, `INCONSISTENT(ingest/junk)`), and add one render-over-tampered-snapshot case to cmd-tm-lint.test.mjs. |
| TASK-041 (must-read before dispatch) / TASK-024 follow-up | TASK-039: TASK-041 (must-read before dispatch) / TASK-024 follow-up: with the documented write-before-validate order, a `check` that fails a relationship leaves `<run>/threat-model.json` carrying the agent's un-validated `mitigated\|ticketed\|accepted` assertion and no `dispositions.json`. cmd-sign-off.mjs `listedThreats` (TASK-033, merged) still reads `disposition.kind` from that snapshot, and inputs.REQUIRED.assessment lists `threat-model` but not `dispositions`, so today an assessment can COMMIT and sign-off can count an unvalidated `mitigated` as disposed — references/dispositions.md's sentence '`sign-off` reads that file, so a disposition that did not validate never reaches a sign-off' is true only once TASK-041 lands. TASK-041 must (a) read `<run>/dispositions.json`, (b) treat a latest assessment with a snapshot but no index as not linted (INCOMPLETE/FAIL), never fall back to the snapshot's kinds; TASK-024 follow-up: add `dispositions` to the assessment template's REQUIRED so a committed assessment always carries the script-derived index (G-7). |
| TASK-039 follow-up | TASK-039: TASK-039 follow-up: tm-lint.test.mjs test titled 'check with an unreadable --model ⇒ usage error naming the path the user typed…' now asserts `USAGE(check: unknown run …)` for both cases (run resolved before the model) — the title no longer describes the assertions; the real 'cannot read <path>' cases live in cmd-tm-lint.test.mjs ('run refusals' and '--model is a user path'). Retitle or drop. |
| PM log (this section records R1/R2, see below) | TASK-039: PM log: cmd-tm-lint.mjs, tokens.mjs and the SKILL prose cite 'PM rulings R1 and R2 after M1' (R1: snapshot write-once + dispositions.json script-derived; R2: a citation on a `snapshot`-side file is TM-INVALID `cites a dirty file; build the model on an assessment run`, no head→snapshot mapping). Neither ruling is recorded in the plan's PM log (only the routed G10 item asking TASK-039 to decide) — record them so the next reader of the header can find the source. |
| TASK-052 / docs | TASK-039: TASK-052 / docs: bundles/security-testing/CHANGELOG.md:16 still describes `tm-lint.mjs` as a CLI shape (M1 entry, historically accurate); the M2 entry should say `check\|render` landed. Outside TASK-039's G-15 list, correctly left alone. |
| PM (accepted deviations, TASK-039) | TASK-039: Deviation audit (all accepted): TM-INVALID locus extended to `elements[n]`/`threats[n]`/`model` (TM_LOCUS closed set, tested); `RENDER-EXISTS` exit 2 + `RENDER <path> elements= threats=` line (register render precedent); `ticketed` requires trusted {finding_id==threat, url==ref, body_contains_finding_id} and ignores mismatch[] (TASK-045's gate, consistent with PM log after TASK-017); `mitigated` ref must be one of THIS threat's mitigations; run kind unrestricted with R2 biting per citation. Routed items closed: G16 SCHEMA-INVALID→TM-INVALID; G10 packet base-side/RangeError/dirty-mapping (checkRange on every element+mitigation citation before the snapshot, so cmd-packet never sees a bad range — confirmed PATH_NOT_IN_SCOPE fires before the side check in cite-core); G14 blank names; G11/G12 vulnerability-review-on-mitigation (only mitigation_states consulted); G19 STUB_TESTED_BY row deleted. Guardrails: no sha256Hex/child_process/Date/console/writeFileSync in the two new modules; tm-lint-core import-guard test passes (schema.mjs import has gate-core precedent); write-once via writeArtifact {exclusive:true} (kernel EEXIST, race-safe, idempotent on identical identity); every stdout/stderr string goes through ctx.out/log/writeArtifact/redactString and the G-4 test pins a secret never reaching snapshot, view or stdout. |
| TASK-045 follow-up / TASK-017 adapter | TASK-045: TASK-045 follow-up (or TASK-017 adapter): cmd-ingest.mjs `ticket()` calls `appendEvent` and only THEN `ticketedLine`, which throws on a url containing whitespace. Probed: `hostAllowed("https://github.com/o/r/issues/7 x", ["github.com"])` is true (the URL parser percent-encodes the space), so mismatch is empty, the record AND the `ticketed` event both land, then `ticketedLine` throws TypeError -> exit 1 with no TICKETED line. Register stays consistent (the row has the url), only the exit code lies and a re-run reads IMPORT-EXISTS. Fix: validate `record.trusted.url` against ticketedLine's no-whitespace rule inside `resolveTicketRow` (before persist, 2 USAGE nothing written), or record a `url` mismatch in the adapter for a URL whose href differs from its raw string. |
| TASK-045 follow-up (cosmetic) | TASK-045: TASK-045 follow-up (cosmetic, TOCTOU note): `resolveTicketRow` reads the register without the lock and `append` re-folds under it; `register-transitions.allowedFrom("ticketed", "superseded")` is true (from: "any"), so a supersede that lands between the two commands puts `ticketed` on a dead row. One-lead, millisecond window; either re-check `status !== "superseded"` inside the locked fold (register-core.append accepts a row_id function of the locked projection) or leave as documented. |
| PM ruling / TASK-039-040 (M2 dispositions) | TASK-045: PM ruling / TASK-039-040 (M2 dispositions): `liveRowsFor` filters `subject_kind === "finding"`, so a threat-subject row can never gain `ticket_url` from a read-back. Spec §6.8 says `ticketed` sets ticket_url on any status without a subject-kind restriction; §6.10 validates the `ticketed` disposition against the read-back record, not the row, so M2 may not need it - but decide before a threat ticket profile exists. |
| PM ruling / TASK-047 (lead prose) | TASK-045: PM ruling (dev deviation 4, agreed nit): the ingest row lookup is exact `subject == finding_id`, not alias-aware, while `plan` dedupe now IS alias-aware. After tracker-rules.md step 2 (re-keyed hit -> `register.mjs alias` -> read back with the NEW id in the sent payload) the read-back prints `ok (no register row)` unless the lead adds a row for the new id; two alias-linked rows then both carry the url. Consistent and safe (publish dedupes either), but the lead prose (TASK-047) should say so or the lookup should follow `readAliases` like `plan` does. |
| PM observation (G-7 note, TASK-017 design) | TASK-045: PM observation (by design since TASK-017, not a 045 defect): `finding_id` is trusted from the agent-supplied `--sent` file (requireString only, no sha256 shape check, no tie to the `handoffs/<id>.ticket.json` publish output), so the `ticketed` event lands on whichever row's subject equals whatever the lead put there. Effect is bounded to a withheld future post (dedupe) - never reduced exposure - so it stays a G-7 note, not a finding. |
| TASK-037 follow-up | TASK-045: TASK-037 (already logged by the dev): security-evidence SKILL.md `ingest` row lists `READBACK: ok / MISMATCH(<field>)` but not `TICKETED <R-id> <url>` nor `READBACK: ok (no register row)`; `publish` row still spells `DEDUPE finding=<id> existing=<R-id>` (it is `existing=<url>`). |
| TASK-045 follow-up (cosmetic) | TASK-045: TASK-045 cosmetic: profiles/tracker.mjs `plan` rebuilds the alias adjacency map once per `aliasLinked` call (`aliasIdsOf(aliases).filter(other => aliasLinked(...))` is O(A^2) per candidate). Fine at register scale; a memoised component map would read cleaner if the alias log ever grows. |
| TASK-028/TASK-030 follow-up | TASK-046: tokens.mjs line 185 (owner TASK-028/TASK-030, not this task, G-15): the `openExposure` doc comment still says `open + regressed rows by priority`; register-fold.EXPOSED_STATUSES is open+regressed+accepted+false-positive and the helper prints the fold's numbers. Same class as the dev's cmd-register-status.mjs header nit — fix both comment lines together whenever TASK-028/030 is next touched. |
| TASK-046 follow-up / TASK-047 | TASK-046: SKILL.md line 78 / references/transitions.md `consume-verdict` prose (owner TASK-046 follow-up, or TASK-047's `assess` procedure): the verb is described as `fixed`, `regressed`, or an observation, but cmd-register-consume.mjs also exits `2 NO-ROW` when the verify artifact's finding has no live row and `2 ENGAGEMENT-MISSING`. A one-line 'Common mistakes' row (`consume-verdict` before `add` ⇒ `2 NO-ROW`; add the row, re-run) would save the lead a round trip. Prose only, nothing a later task builds on. |
| TASK-047 | TASK-046: SKILL.md line 145: `the security-lead's third context-docs entry` is a forward reference — `agents/security-lead/` does not exist on the base branch (TASK-047, G25). Consistent with spec §4 (engagement, finding schema, register view) and plan §4.7 / TASK-059's contract, so it will be true at M3; TASK-047 should keep that order when it writes the frontmatter. |
| PM log (correction) | TASK-046: PM log (dev already routed): the 'Follow-ups from TASK-059 review 1' row that names 'TASK-040 (risk-register SKILL.md)' means TASK-046; this task satisfies it (eight columns spelled in register-render.COLUMNS order, pinned by test). |
| TASK-052 / merge | TASK-046: Marketplaces: `npm run validate:marketplaces` reports the three generated manifests stale because the generator now discovers `risk-register`. Same precedent as TASK-035 (security-engagement shipped without regenerating; TASK-037 caught up). One `npm run gen:marketplaces` at merge or in TASK-052 clears it; not a defect of this diff. |
| PM (accepted, TASK-046) | TASK-046: skills-ref (AC-3) not reproducible locally, as with TASK-035; frontmatter is field-for-field the security-engagement shape that CI already passes (name, 'Use when' description ≤1024, license, compatibility, metadata.authors/version) and the branch test pins name/description/license/metadata.version. |

PM rulings R1 and R2 (after M1), recorded here because TASK-039's headers cite them and the earlier log carried only the routed G10 item asking TASK-039 to decide:

| Ruling | Text |
|---|---|
| R1 | `<run>/threat-model.json` is write-once (writeArtifact `{exclusive:true}`; identical identity is idempotent, a differing one is `SNAPSHOT-EXISTS`) and `<run>/dispositions.json` is script-derived by `tm-lint.mjs check` — never agent-authored. |
| R2 | A citation on a `snapshot`-side file is `TM-INVALID` with reason `cites a dirty file; build the model on an assessment run`; there is no head→snapshot path mapping. |

### PM log additions (after G21)

| Owner | Note |
|---|---|
| TASK-047 (assess procedure) / TASK-039 follow-up | TASK-040: TASK-047 (assess procedure) / TASK-039 follow-up — AGENT.md ### dispose 'New run' case (lines 245-250, 266-270): a changed disposition forces a new run (R1 SNAPSHOT-EXISTS), but `mitigated(M-nnn)` validates only from `states.applyReceipts` over THIS run's `<run>/receipts + <run>/packets` (cmd-tm-lint.mjs header step 6) and the CLI `receipt validate` enforces `reviewer_run_id == run` (PM log after G13, TL-6 row). So the first `mitigated` disposition always costs the lead a rebuilt `packet --kind subject --subject M-nnn` on the NEW run plus a fresh `mitigation-review` dispatch; the modeler prose correctly says it is 'the lead's receipt validate step, not yours', but the lead procedure (TASK-047) must spell that re-dispatch, or TASK-039 decides whether `check` may accept a mitigation receipt admitted into an earlier run of the same engagement at the same head (the `acceptsReviewerRun` precedent of verify all). Prose only for 040; nothing this task ships depends on the choice. |
| PM log (closed: TASK-036 routed item) | TASK-040: PM log (close the routed item) — agents.test.mjs `fieldRe(key)` replaces the `\`?key\`?` bare-word match flagged after TASK-036 (routed to 'TASK-036 or TASK-046/047 when the threat-modeler/security-lead tests extend this file'); TASK-040 took it as the task extending the file, the stricter form keeps every reviewer contract green (11/11 in agents.test.mjs, 1788/1788 suite). Mark the row closed. |
| TASK-048 (factory.json) | TASK-040: TASK-048 (factory.json) — NOTES.md is the second agent dir carrying this maintainer-only sibling (TASK-036 precedent); e2e.test.mjs:618 only asserts the SOUL.md sibling, so the extra file rides along as inert bytes on the directory-copy hosts. When TASK-048 lists `threat-modeler` in `localAgents`, confirm the roster E2E path (a) still treats the sibling as harmless, as it already does for security-reviewer. |
| TASK-052 / merge | TASK-040: TASK-052 / merge — `npm run validate:marketplaces` reports the three generated manifests stale (generator now discovers `threat-modeler` on top of the pre-existing `risk-register` drift). Same precedent as TASK-035/046: outside this task's G-15 ownership; one `npm run gen:marketplaces` at merge or in TASK-052 clears it. Not a defect of this diff. |
| TASK-040 cosmetic (leave) | TASK-040: TASK-040 cosmetic (leave) — AGENT.md line 206 'Fix one TM-INVALID(...) at a time, re-run' sits next to the exit-2/3/5 list at 225-226 (`USAGE(...)`, `INCONSISTENT(...)`, `RUN-COMMITTED`): a USAGE or INCONSISTENT is never something the modeler fixes from the model; the prose at 207-208 ('or at the first non-zero exit you cannot fix from the model alone') covers it, but a three-word 'only TM-INVALID is yours to fix' would remove the ambiguity. Nothing later builds on it. |
| TASK-041 follow-up / TASK-024 follow-up | TASK-041: TASK-041 follow-up (closed for free once TASK-024 follow-up adds `dispositions` to inputs.REQUIRED.assessment, where `ownRun` does this): bundles/security-testing/skills/security-evidence/scripts/lib/cmd-sign-off.mjs `readRunArtifact`/`listedThreats` never compares `index.envelope.run_id` to the snapshot's, so an intact dispositions.json enveloped for ANOTHER run is accepted as this run's index. Probed on d5f1c8f in a detached worktree: an assessment with snapshot {T-001 undisposed, T-003 ticketed}, no lint, and a planted index enveloped as `<prefix>-0099` ⇒ `SIGN-OFF: FAIL(DISPOSITIONS(T-001))`, `linted: true`, T-003 counted as disposed, no INCONSISTENT. Tamper-only and bounded (a sibling run's validated index transplanted), so a nit under the standing rule, but the header's 'a tampered envelope ⇒ INCONSISTENT(dispositions)' overstates until it lands. Fix (verified: cmd-sign-off.test.mjs 26/26 green with it): `const rows = index === undefined \|\| index.envelope.run_id !== snapshot.envelope.run_id ? undefined : index.payload.dispositions;` and add the foreign-envelope case to the 'not the snapshot's index' test. |
| TASK-041 follow-up | TASK-041: TASK-041 follow-up (same class as the routed G16 run.json nit): `readRunArtifact` rethrows anything that is not ENOENT or an integrity failure, so `<run>/dispositions.json` (or threat-model.json) replaced by a directory ⇒ EISDIR escapes ⇒ exit 1 INTERNAL with no stdout token (fail-closed; Node's readFileSync EISDIR message carries no path). Fold `err.code === 'EISDIR' \|\| err.code === 'ENOTDIR'` into the `undefined` (INCONSISTENT) branch alongside isIntegrityFailure. |
| TASK-041 follow-up (architecture) | TASK-041: Architecture (TASK-041 follow-up): cmd-sign-off.mjs now imports a sibling COMMAND module (`./cmd-tm-lint.mjs`) for two string constants; `inputs.SINGLETONS['threat-model'].file` and `SINGLETONS.dispositions.file` in the closed-set module inputs.mjs already spell both names, and importing cmd-tm-lint pulls its register-fold/states/redact graph into sign-off for nothing. Prefer inputs.mjs (the writer's constants could equally be re-exported from there) and drop the entry from the header's Imports line. |
| PM log (ruling recorded) | TASK-041: PM log (record the ruling): under the default `executed-or-ticketed` policy an un-linted assessment (snapshot, no index) signs off `SIGN-OFF: OK` with `DISPOSITIONS: <n> undisposed-or-planned` and the 'not linted' reason on stderr only — spec §6.10 and the dispatch wording agree, and I accept dev deviation 2, but the PM log after G20 still says '(INCOMPLETE/FAIL)'; reconcile the log so the next reader sees which ruling won and why exit 0 is correct there. |
| TASK-033 follow-up | TASK-041: TASK-033 follow-up (still open, seen again, not this task's): cmd-sign-off.mjs step 5 still prints only `tracked(trackedPaths[0])` while the checklist says one line per tracked pattern. |
| TASK-041 (minor, tamper-only) | TASK-041: Minor, tamper-only: a hand-planted snapshot whose threat ids are not `T-nnn` reaches `dispositionEntry` (absent index ⇒ every threat listed) and throws TypeError ⇒ exit 1 INTERNAL; checkRun does not re-run lintStructure over the snapshot. Fail-closed, no leak; note in the header if it is left as is. |
| TASK-041 docs (cosmetic) | TASK-041: Docs: the checklist's `INCONSISTENT(<field>)` row is now a paragraph; splitting the `runs/<id>` / `threat-model` / `dispositions` meanings onto three sub-bullets would read faster for the lead. Wording is accurate as written. |

### Follow-ups from TASK-042 (`security-test-planning` skill + `plan.mjs admit|propose` + the `packet --type case` seam, 2026-09-17)

Recorded by the TASK-042 implementer. Module split as TASK-039's: `lib/admission-core.mjs` (pure: the case identity, the Steps-table reading, the allowed-operation grammar, the forbidden-pattern list, target validation, the classification table; import-guard test) and `lib/cmd-plan-admit.mjs` / `lib/cmd-plan-propose.mjs` (the I/O); `lib/cmd-plan.mjs` keeps only the `ta-prompt` stub (TASK-044). `plan.mjs` dispatches to the two new modules directly; the e2e `STUB_TESTED_BY` row is deleted (the map is now empty); `writes-outside-st.test.mjs` `KNOWN_WRITERS` gained both writers. Routed items taken: the G13 / G10 seam (`SUBJECT_SOURCES.case` in `cmd-packet.mjs`) and the G19 stub row. The `SCHEMA-INVALID(proposal: …)` spelling of the M1 stub is **kept** (an off-schema user input is exit 2 per the check/exit-5 rule); `admit` spells `SCHEMA-INVALID(case: …)` through the TASK-018 adapter. Representation choices the spec and plan left open, fixed here so TASK-043 (`publish --profile case|handoff`, `UNADMITTED:`), TASK-044 (observations, `ta-prompt`) and TASK-047 (lead prose) share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-043, TASK-044 (every reader of an admission) | **Case identity.** `case_sha256` = sha256 over the REDACTED text of the case file (`admission-core.caseSha256`) — exactly `imports.prepareImport(…, {kind: "case"}).import_sha256`, so an admission, a case packet's subject id and an `ingest case` record name one case by one number (pinned by `admission-core.test.mjs`). The admission record carries no path and no case id (schema closed, TASK-005): TASK-043's `publish --profile case` locates the text of an admitted case by walking `<st>/cases/**` and matching `caseSha256`; TASK-044 joins `case_id ↔ case_sha256` through the run's `ingest case` record (`trusted.id`, `locator.import_sha256`). A suite file rewritten by `publish` has a different identity than its candidate — `UNADMITTED:` must compare what `publish` records, not the candidate's number. |
| TASK-043, TASK-047 (lead prose) | **Candidate location is a hard rule.** `admit` refuses a case file that is not under `<st>/cases/` (`2 USAGE(admit: candidate cases live under .agents/security-testing/cases/<slug>/ as TC-NNN_<slug>.md, never under tasks/; got <path>)`) — the PM ruling read fail-closed so the publisher has one place to look. The id shape `TC-NNN` and file name `TC-NNN_<slug>.md` are mandated by the skill prose and noted on stderr when missed (`case.mjs` keeps accepting `TC-SEC-NNN`; manual-qa's metrics readers do not). `<st>/cases/` is outside the managed ignore block (the `cases` policy key is `tasks/security-*/`, TL-13), i.e. committed by policy like `engagement.md` — which the review route needs (next row). |
| TASK-043, TASK-047, TASK-036 (reviewer prose) | **The case packet binds the blob at head.** `packet --kind subject --type case --subject <repo-relative path>…` (`--type` required: a path is neither id shape) lists each committed case at `head` (whole normalised range, blob oid, `range_hmac`) with `subject_ids` = the cases' identities — the resolver returns `{subject_ids, files}` and `cmd-packet.run` accepts either an array or that shape from a source. A path not a blob at `head_oid` ⇒ `2 USAGE(packet: case <path> is not in the tree at head <oid12> (commit the case and start a run at that head))`; two paths with one identity ⇒ 2 USAGE. `receipt validate` then checks the oid as for any packet, so the lead's order is commit → `run init` → `scope` → `packet --type case` → fresh `security-reviewer` `vulnerability-review` (assertion `confirmed` = "confirmed passive") → `receipt validate` → `admit --receipt`. TASK-036's reviewer prose should say what a case packet is (a Markdown test case, not code) and what `confirmed` means over it. |
| spec §9.1 (representation) | **Review admits past `unknown-operation` only.** A confirmed receipt yields `admitted-reviewed` when the hits are empty or all `unknown-operation`; a forbidden hit (`mutating-verb`, `injection-payload`, `tooling`, `volume`, `host-not-allowed`) keeps the case a `proposal` under any receipt — a tightening of §9.1's "admitted-reviewed requires a confirmed receipt", chosen fail-closed (D7 "admission by effect"): a payload is active as written, a reviewer's word does not change the text. Unknown hits stay on the record under `admitted-reviewed` so the reader sees what lint could not classify. `refuted` / `indeterminate` (and two same-run reviews that disagree — the state is `states.applyReceipts`'s, one algorithm) ⇒ `proposal` with a `review-not-confirmed` hit at **step 0** naming the derived state: the schema is closed (no `reason` field) and `LintHit.step` has `minimum: 0`, the header ordinal of TASK-018's convention. |
| spec / tokens | Tokens not spelled by the spec: `ADMISSION case=<case_sha256> classification=<c> hits=<n>` (exit 0 for every classification — the record is the result); `2 ADMISSION-EXISTS` (a different record for the same case in one run; identical is idempotent — write-once, retry = new seq); `4 RECEIPT-MISMATCH(<reason>)` (`receipt type <t> is not vulnerability-review`, `receipt subject <sha> is not this case`, `receipt packet <sha> does not list this case`; an unknown receipt sha is `2 USAGE(admit: unknown receipt …)`, a receipt whose packet file is gone is `5 INCONSISTENT(packets/<sha>)`); `PROPOSAL <path> id=<P-nnn> sha256=<h>` (sha over the redacted text, what `run snapshot proposals` indexes) + `NEXT: run snapshot proposals --run <id>`. `2 PROPOSAL-UNDER-TASKS` is read as the **source** file lying under `tasks/` (any case, fail-closed); the destination is always `<st>/proposals/<id>.proposal.md` (id = the block's `P-nnn`). An existing destination with different bytes is `2 USAGE(propose: <path> already exists with different content; bump the id or remove it)` — the publish precedent, never an overwrite; the copy is the whole file redacted (G-4). |
| TASK-044 (observations) | `assumptions.account` is the case frontmatter `account:` (a label; `unauthenticated` is the skill's word for none) else `unknown`; `assumptions.base_url_host` is the `host[:port]` of the run's `engagement.json` `base_url` else `unknown`; `target_policy_sha256 = sha256(canonical({targets, base_url?}))` of that snapshot (the run's authority policy, not the live record — the admission is a run artifact). Hosts in Action cells are checked against the snapshot's `targets.browser`; `{{base_url}}` is always fine. |
| TASK-022 (states.mjs, routed G11 item — closed, no change) | The sticky-REFUTED asymmetry for case subjects (fix-review / ack receipts at a case subject silently applied) stays unreachable: `admit` reads only `states[case_sha256]`, never `not_applied`, and no consumer sends fix-review or ack at a case subject. If TASK-043/044 ever do, route it back to the `states.mjs` owner. |
| TASK-052 / merge | `npm run validate:marketplaces` reports the three generated manifests stale (the generator now discovers `security-test-planning` on top of the pre-existing `risk-register` / `threat-modeler` drift). Same precedent as TASK-035/046/040: outside this task's G-15 ownership; one `npm run gen:marketplaces` at merge or in TASK-052 clears it. |
| TASK-048 (factory.json) | `security-test-planning` is not yet in `localSkills` (TASK-037's manifest lists the three M1 skills; TASK-039/046 did not add theirs either) — the final manifest adds it alongside `threat-modeling` and `risk-register`; `validate:factories` is green without it. |
| PM (accepted, TASK-042) | `skills-ref` (AC-5) is not reproducible locally, as with TASK-035/039/046; the frontmatter is field-for-field the `threat-modeling` shape CI already passes and `security-test-planning.test.mjs` pins name / description / license / metadata. |

### PM log additions (after G22)

| Owner | Note |
|---|---|
| TASK-042 follow-up (admission-core `mutating-verb`) | TASK-042: TASK-042 follow-up (lib/admission-core.mjs:106, `mutating-verb`): the verb list is anchored at `^` only, so a compound Action with a leading allowed verb is `admitted-heuristic` with zero hits. Probed on dd23f98: "Navigate to `{{base_url}}/login` then submit the form" ⇒ [], "Open the network panel and delete all cookies" ⇒ [], "Inspect the response; then run `rm -rf /`" ⇒ [] (the shell-chain payload rule needs the tool right after `;`). references/passive-admission.md documents 'one verb, one object' and 'closed and lexical', so it is the heuristic's documented bound, not a contract break — but it is the cheapest under-flag to close before TASK-043 ships the suite publisher. Verified fix (admission-core, cmd-plan, cmd-plan-admit, security-test-planning tests 24/24 green): `re: /(?:^\|\b(?:and\|then\|or)\s+\|[;,]\s*)(?:submit\|send\|…\|shut\s*down)\b/i` — flags all three, leaves "Observe that the values change", "Compare before and after", "Inspect the delete button", "Check that the list updates and the counter changes", "Navigate to …, then inspect the headers" unflagged. Reword the `mutating-verb` row of passive-admission.md ('at the start of the Action or of a clause after and/then/or/;/,') and add the three cases to admission-core.test.mjs. |
| TASK-042 follow-up / TASK-047 (lead prose) | TASK-042: TASK-042 follow-up / TASK-047 (lead prose): the write-once record plus 'review route when the hits are all unknown-operation' means the lead learns the hits only by writing the heuristic record, after which switching to the reviewed route is `2 ADMISSION-EXISTS` and costs a new run (run init → scope → packet → reviewer → receipt validate). A no-write `plan.mjs admit --dry-run` (prints the ADMISSION line, persists nothing) would remove the burned run; until then TASK-047's procedure should say 'lint by reading the case against passive-admission.md before the first admit'. |
| TASK-042 cosmetic (cmd-plan-propose) | TASK-042: TASK-042 cosmetic (lib/cmd-plan-propose.mjs:96): `validateProposalFile` has no consumer on the branch (grep over bundles/security-testing: only its own test) — kept 'for callers that only want the check'; drop it or name the caller in the header. |
| TASK-042 cosmetic (cmd-packet resolveCases) | TASK-042: TASK-042 cosmetic (lib/cmd-packet.mjs resolveCases): `blobOid` is called, then `resolveSide` calls `blobOid` + `showBytes` again — three git spawns per case path; catch `ObjectMissing` from resolveSide and spell the USAGE from it instead. |
| TASK-039 follow-up / TASK-047 | TASK-042: TASK-039 follow-up / TASK-047 (not this task's): cmd-tm-lint.mjs `admission(sha)` accepts any `<run>/admissions/<sha>.json` for a `planned(<case_sha256>)` disposition, including one classified `proposal`; decide whether `planned` needs an `admitted-*` record or whether 'planned' means 'a record exists' — TASK-042 fixes the record shape either way. |
| redact.mjs owner (note only) | TASK-042: redact.mjs owner (note only, spec §2 'Not guaranteed'): DEFAULT_RULES leave URL userinfo (`https://user:pw@host/x`) in the clear — probed in a proposal copy under <st>/proposals/; admission-core.hostOf drops userinfo from the host it records, so nothing in this task's records carries it, and `text_redacted` of a host-not-allowed hit would. |
| TASK-042 docs (cosmetic) | TASK-042: TASK-042 docs (cosmetic): SKILL.md 'Two routes and one exit' table, Proposal row — a case classified `proposal` lands at `<run>/admissions/<case_sha256>.json` (the record), while a proposal FILE lands at `<st>/proposals/<id>.proposal.md`; the 'Where it lands' cell names only the second. One clause ('the admission record, or …') removes the conflation. |
| TASK-052 / merge | TASK-042: TASK-052 / merge (dev already routed): `npm run validate:marketplaces` stale (generator now discovers security-test-planning on top of the risk-register/threat-modeler drift); `validate:factories` and `validate:dupes` green on dd23f98. |

### PM log additions (after G23)

| Owner | Note |
|---|---|
| TASK-043 follow-up (cmd-check-export / cmd-publish base_url) | TASK-043: cmd-check-export.mjs:107-111 — a handoff manifest whose recorded opts.base_url passes the schema (any string) but fails handoff.promptLines (not http(s), a `"`) makes mod.apply throw a TypeError that escapes run() as an internal error instead of a token; fold it like NotAccepted/CaseRefused ⇒ MISMATCH(output) (or 2 USAGE, it is the user's input). Same class in cmd-publish.publishHandoff for a `--base-url` that redact.mjs rewrites (e.g. `?token=…`): writeSet's G-4 self-check throws a plain Error (stack, not 2 USAGE) — pre-check `redactString(base_url).text === base_url` in promptLines. TASK-043 follow-up. |
| TASK-043 follow-up (cmd-sign-off EISDIR/ENOTDIR) | TASK-043: cmd-sign-off.mjs recordedSuites/unadmittedFiles — a directory named `<run>.case.export-manifest.json` under handoffs (EISDIR from readArtifact, not an integrity failure) or a plain file at `tasks/security-<slug>-admitted` (ENOTDIR from walk) escapes as a crash of the one command that must always print its verdict; guard with statSync().isFile()/isDirectory() and skip with the same stderr note. TASK-043 follow-up. |
| redact.mjs owner (rules-v2) / TASK-047 | TASK-043: PUBLISHED lines of the case profile are spelled `output=./tasks/…` solely because redact.mjs `high-entropy-assign` admits `/` in a `key=` value (its documented rules-v1 over-redaction limit) and would blank `output=tasks/security-<slug>-admitted/TC-NNN_<slug>.md`; verified on the branch: the bare spelling renders as `<REDACTED:high-entropy-assign>.md`, the `./` spelling and the `  <path>` UNADMITTED entries do not. Acceptable workaround; route to the redact.mjs owner's rules-v2 list (path-shaped values: `/` present, no `+`/`=` padding) and TASK-047 must quote `output=./tasks/…` verbatim in the lead procedure. |
| TASK-043 follow-up (case.mjs rewriteFrontmatter tags) | TASK-043: case.mjs rewriteFrontmatter (tags) — a quoted inline-list item containing a comma (`tags: ["a, b", passive]`) is split on `,` and stripped of quotes, emitting `tags: [a, b, passive, security]`; _qa-markdown.parseFrontmatter reads it as one item. Reuse the parser's inline-list reading (or append `security` to the original text without re-serialising). TASK-043 follow-up. |
| TASK-054 / TASK-047 (README owner) | TASK-043: bundles/security-testing/README.md:108 still says the M1 scripts print `NOT-IMPLEMENTED(M3)` and `UNADMITTED: not evaluated`, and that sign-off 'compares the suite's hash against the admission records' — it now compares the published identities `publish --profile case` recorded (opts.members), per the TASK-042 PM-log row. Route to the README owner (TASK-054 / TASK-047). |
| TASK-043 follow-up / TASK-047 (lead prose) | TASK-043: Republish dead-end: when a candidate changes in a later run, `publish --profile case` answers `already exists with different content; choose another --to`, but --to is fixed for case and handoff; the message should say 'remove the stale suite file first' and TASK-047's lead prose should carry that step (same for a changed --base-url at `<slug>.md`). |
| TASK-043 follow-up (refactor) | TASK-043: The run-id sidecar regex and SLUG are re-declared in profiles/index.mjs (M3_SIDECAR, SLUG, RUN_ID), cmd-sign-off.mjs (CASE_MANIFEST, SLUG), cmd-publish.mjs (SLUG) and case.mjs (SLUG); one export from profiles/index.mjs would keep the naming inversion in one place (TASK-031's note asked for exactly that). |
| TASK-043 cosmetic (auditForm) | TASK-043: auditForm appends a `Collect the network requests` row after every Navigate step, including a final navigation with no header step after it; harmless for the auditor, but the row count in the audit-branch.md example table only holds for the one-navigation shape. Cosmetic. |
| TASK-043 cosmetic (resolveDestination contract) | TASK-043: resolveDestination(ctx, 'case', to) without opts.slug throws a TypeError from suiteDir rather than 2 USAGE — unreachable through run() (publishHandoff validates the slug first) but the exported function's contract should say so or spell the USAGE itself. |
| TASK-043 (URL_IN_ACTION, first follow-up) | TASK-043: bundles/security-testing/skills/security-evidence/scripts/lib/profiles/case.mjs:78 (URL_IN_ACTION) — the host alternative `https?:\/\/[^\s`'"<>)\]]+?` is lazy and every following group is optional, so a literal absolute URL matches as `https://a` and the path group never captures: `Navigate to https://staging.example.com/login` + a header step emits `Inspect the … header of the \`/\` document` (audit-branch.md promises `/login` for 'a literal on an allowed host'; admit accepts literals on an allowed host). Deterministic, so check-export is unaffected — a content defect in the emitted suite, not an identity/leak/contract break. Verified fix: exclude `/` from the host class and drop the laziness — `https?:\/\/[^\s\/`'"<>)\]]+` — probed `/login`, `/a/b?x=1`, bare host ⇒ `/`; profiles/*, cmd-publish, cmd-check-export, cmd-sign-off tests 78/78 green with it. Owner: TASK-043 (apply on merge or as the first follow-up; TASK-047's lead prose should not need to say 'use {{base_url}}' once fixed). |
| TASK-043 (PRIORITY_MAP prototype walk) | TASK-043: bundles/security-testing/skills/security-evidence/scripts/lib/profiles/case.mjs:186 (rewriteFrontmatter) — `PRIORITY_MAP[raw.toLowerCase()]` walks the prototype chain: a candidate with `priority: constructor` (or toString/valueOf/hasOwnProperty) is admitted (parseTestCase does not close the priority vocabulary) and publishes `priority: function Object() { [native code] }` instead of being refused. Verified fix: `(Object.hasOwn(PRIORITY_MAP, k) ? PRIORITY_MAP[k] : null) ?? (QA_PRIORITIES.includes(k) ? k : null)` ⇒ `refused: … priority constructor is neither p0…p3 nor critical\|high\|medium\|low`; same 78/78 green. Owner: TASK-043. |
| TASK-043 follow-up (unadmittedFiles symlink guard) | TASK-043: bundles/security-testing/skills/security-evidence/scripts/lib/cmd-sign-off.mjs:428 (unadmittedFiles) — `readFileSync(join(abs, rel))` has no guard: fsx.walk lists a symlink as a file (Dirent.isDirectory() is false for a link), so a dangling symlink or a symlink-to-directory placed in the suite by hand throws ENOENT/EISDIR out of signOff — no verdict printed at all (fail-closed by accident, same class as the review-1 EISDIR/ENOTDIR items). Fix: try/catch around the read, on error push the path as unadmitted with a stderr note ('<path> could not be read — listed as unadmitted'). Owner: TASK-043 follow-up. |
| TASK-043 / TASK-047 prose (engagement-wide identities) | TASK-043: cmd-sign-off.mjs recordedSuites — `identities` is one set across every case manifest of the engagement, so a file in suite A whose bytes equal a member recorded for suite B (a different --slug) reads as admitted in A. Both were admitted in this engagement so the §2 claim holds; note it in the header ('identities are engagement-wide, not per suite') or key the set by suite. Owner: TASK-043 / TASK-047 prose. |
| redact.mjs owner / TASK-047 / TASK-054 / TASK-038 (routed items stand) | TASK-043: The dev's routed items stand as routed: `output=./tasks/…` spelling in the PUBLISHED line (redact.mjs owner rules-v2 + TASK-047 quoting; E2E TASK-038 should match `output=\.?/?tasks/`), README.md:108 stale 'M1 scripts print NOT-IMPLEMENTED(M3) and UNADMITTED: not evaluated' (TASK-054 / TASK-047), M3_SIDECAR/SLUG/RUN_ID duplicated across profiles/index.mjs, cmd-publish.mjs, cmd-sign-off.mjs, case.mjs (follow-up refactor), auditForm's trailing Collect row after a final Navigate (cosmetic). |
| PM (record: tokens.mjs, TASK-043) | TASK-043: Dev deviation note says 'No tokens.mjs rows added' — tokens.mjs did gain `unadmittedHeader`/`unadmittedEntry` (appended at the end under a TASK-043 comment, as the rule requires) and retired `UNADMITTED_NOT_EVALUATED` (no remaining importer — verified by git grep). Correct in substance; the deviation list understates it. PM log should record the retired constant. |
| TASK-051 (or TASK-049/050 doc pass) | TASK-051: bundles/manual-qa/docs/execution-authorization.md (and copy) field table, `target` row: "`host` is `[a-z0-9.-]+(:port)?` — a host the engagement's `targets.browser` lists" reads as if `plan.mjs propose` enforces membership in `targets.browser`; the merged cmd-plan-propose.mjs enforces only the schema pattern (no `targets` reference at all). Reword to "pattern by schema; membership in `targets.browser` is what the v2 preflight (check 3) would verify, not what `propose` checks today". Owner: TASK-051 (or fold into TASK-049/050 doc pass). |
| TASK-051 (harmless once TASK-043 merged) | TASK-051: Same note, "The rule that holds today" opening paragraph: states as present fact that admitted cases are "written by `evidence.mjs publish --profile case`" without a task tag, while the second bullet correctly tags `publish --profile handoff\|case` as TASK-043 (unmerged; on base `UNADMITTED: not evaluated` is the only token). Tag the first mention too so a reader on the current branch does not go looking for a profile that is not there yet. Owner: TASK-051; harmless once TASK-043 merges. |
| TASK-051 cosmetic (check-skill-dupes.test.mjs) | TASK-051: bin/check-skill-dupes.test.mjs test 4 spawns the full check-skill-dupes.mjs run (all 10 groups) to assert one line of stdout — fine and stdlib-only (spawnSync with process.execPath + argv array, no shell), but a future drift in an unrelated group will fail this TASK-051-labelled test with a misleading name. Consider asserting only the `✓ <copy> matches <canonical>` line and letting the exit-code check be a separate, generically named test. Cosmetic; no owner change needed. |
| TASK-052 (validate:marketplaces) | TASK-051: Pre-existing, not this task: `npm run validate:marketplaces` is stale on base 9a3ecba (risk-register / security-test-planning not regenerated). Confirmed identical staleness on base and branch; the new `docs/` dirs add nothing to the generated catalogs. Owner: TASK-052. |

### Follow-ups from TASK-044 (observations from `qa-run`, `plan.mjs ta-prompt`, `ta-report` per-unit records, 2026-09-17)

Recorded by the TASK-044 implementer. Modules: `lib/observations.mjs` (the case_id ↔ case_sha256 join, the pure derivation, the write-once observation files + index appends) and `lib/ta-units.mjs` (the pure per-unit shaping, the write-once payload-only file), both called from the `cmd-ingest.mjs` post-step; `lib/cmd-plan.mjs` now carries `ta-prompt`. PM-ruled edit taken: `cmd-tm-lint.mjs` `admission(sha)` requires an `admitted-*` classification for `planned(<case_sha256>)` (a `proposal` record is not planned; the core's "no admission record" reason is kept; case added to `cmd-tm-lint.test.mjs`). Named G-15 edit taken: section 9 of the assessment template now renders `case_sha256` beside each FAIL observation and prints the rule "a mitigation decision needs a separate `mitigation-review` receipt citing the observation"; `render.test.mjs` extended (FAIL listed, PASS not, no state derived). Representation choices the spec and plan left open, fixed here so TASK-047 (lead prose), TASK-048 (manifest) and TASK-053 (smoke) share one boundary:

| Owner | Follow-up / contract note |
|---|---|
| TASK-047 (lead prose), TASK-053 | **Observations need the candidate ingested as a case.** The join `case_id ↔ case_sha256` runs through the run's `ingest case` records (`trusted.id` → `locator.import_sha256`) and `<run>/admissions/<sha>.json`; a case resolves only when exactly ONE of its identities carries an `admitted-*` record (a `proposal` record is not an admission here, the same reading as tm-lint's `planned`; two admitted identities for one id resolve nothing). So the lead's order is `plan admit <candidate>` → `ingest case <candidate>` (the CANDIDATE under `<st>/cases/`, not the published suite file — the suite file has a different identity) → hand off → `ingest qa-run <report>`. A row that does not resolve is an unlocated Candidate `{locator: {import_sha256, index}, reason: "unadmitted-case"}` in the qa-run record's own `unlocated[]`, which `gate` folds into `<run>/unlocated.json` verbatim (G-10: the write-once file is gate's; in an assessment `ingest` therefore precedes `gate`). TASK-038's E2E and TASK-018's qa-run test now expect `unlocated=3` for the fixture report (no admissions in those runs). |
| spec §9.2 (representation) | **Observation fields.** `run_id` = the report's `RUN-…` id (the security run is the envelope's); `base_url` = the report's `environment` when its host ∈ `targets.browser` else `unknown`; `account` = the admission's `assumptions.account`; `head_oid` = `unknown` always (the manual-qa run report names no commit and nothing is invented, D5); `result` = the row's status. `observation_id = "O-" + sha256(import_sha256 \0 case_id)[0:12]` as the plan spells it, so a case id listed twice in one report is the report's structural fault (`2 SCHEMA-INVALID(qa-run: case <id> appears twice in the ## Results table)`, nothing written). Files are write-once (identical identity idempotent, different ⇒ `5 INCONSISTENT(observations/<id>)`), written on every run kind; the index entry is appended on assessment runs only (the only kind carrying the TL-14 index; a healing re-ingest never appends a duplicate). Persist order inside `ingest`: bytes → observations (+ index) → record → imports index, so a crash between them heals on re-ingest instead of leaving a record whose observations can never be derived. stdout: `OBSERVATION <O-id> case=<id> result=<r>` + its WROTE line per observation, then `WROTE <run>/observations.json …`; the record's WROTE stays last. |
| PM (deviation from the plan's literal path) / TASK-005 (G13 row, closed) | **`<run>/ta-units/<import_sha256>.json`, payload-only, not `<run>/ta-units.json`.** A singular file would have to be rewritten on a run's second `ta-report` import (a rebuilt report — TASK-018's own test exercises it) and only the TL-14 index files are ever rewritten (G-10); one write-once file per import mirrors `ingest/<sha>.json`. Payload-only (canonical JSON + LF, redacted before it is hashed) because `envelope.schema.json`'s kind list is closed at TASK-005 and names no ta-units kind — the G13 "payload-only or enveloped" question is answered payload-only, like the tracker ticket payload; the shape is pinned by `ta-units.test.mjs` (`{import_sha256, batch, base, recovery_basis, units: [{case_id, case_sha256, outcome, outcome_reported, gate_witnessed, coverage: full\|partial\|unknown, exclusions: [{step, category, referent}], findings: [{kind, ref}], recovery_basis}]}`; every value the report does not carry is `unknown`). The file is outside every template's closed input list, so it never enters a manifest; its identity is on the `TA-UNITS <path> units=<n> sha256=<h>` line (not WROTE — not an enveloped artifact, the PROPOSAL line precedent). |
| TASK-047 (lead prose), TASK-053 | **`ta-prompt` reads the PUBLISHED suite, never the candidates.** `plan.mjs ta-prompt --run <id> --slug <s> --base <branch>` needs `publish --profile case` to have run for that run (`2 USAGE(ta-prompt: run <id> has no published suite (publish --profile case first))`), reads `<st>/handoffs/<run_id>.case.export-manifest.json` (checked as sign-off checks it: profile `case`, `opts.slug` — must equal `--slug`, `opts.members` hashing to `output_sha256`; else 5 INCONSISTENT), re-verifies every suite file's sha256 against the recorded member (a hand-edited or missing file ⇒ `2 USAGE(ta-prompt: the suite file is not what publish recorded (republish --profile case, or remove it): <path>)`) and prints the prompt: `Run as the active agent (claude --agent test-automation-lead):` / `"Automate the batch <slug> from base <base>. The cases below are manual-qa test cases already in this repository (tasks/security-<slug>-admitted/): pass each path as its intake snapshot (cases: [{id, path}]); do not copy them."` / `cases:` / one `- id: <id> \| title: <title> \| path: ./tasks/security-<slug>-admitted/<file>` per member in file-name order. Paths are spelled from `./` for the same redact.mjs `high-entropy-assign` reason as TASK-043's PUBLISHED line (route the rules-v2 note there). `--base` is a branch NAME (validated as a label, never resolved — G-6); nothing is written; no verification state is consulted (US-037 AC-4). |
| TASK-024 lineage (template_version) | Section 9's QA FAIL table gained a `case_sha256` column and a fixed sentence; `templates/assessment.md` `template_version` is unchanged (pre-release — no COMMITTED consumer report exists yet). If a bump policy is adopted before v1 ships, this is the first renderer change after TASK-025 that would have needed one. |
| TASK-048 / TASK-052 | `npm run validate:marketplaces` is still stale on the base (risk-register / threat-modeler / security-test-planning); unchanged by this task. |

### PM log additions (after G24)

| Owner | Note |
|---|---|
| TASK-047 (lead prose) / PM note | TASK-044: TASK-047 (lead prose) / PM note — reachability of the unlocated.json fold: gate is write-once (2 GATE-EXISTS) and the bundle's documented order is ingest → gate (cmd-gate.mjs:3), so in the realistic lead flow (gate → admit → publish --profile case → QA runs → ingest qa-run) the unadmitted-case candidates stay in the qa-run import record's own unlocated[] and never reach <run>/unlocated.json or section 3's unlocated count; the IMPORT … unlocated=<n> line and the record still carry them and check verifies the named import (cmd-check.mjs:304-315), so nothing is inconsistent — but the lead prose must say where an unadmitted row is visible when the report lands after gate. The dev's follow-up row already states 'in an assessment ingest therefore precedes gate'; make that an explicit ordering step or accept the record as the only home. |
| TASK-044 follow-up (cmd-ingest.mjs re-ingest / base_url) | TASK-044: TASK-044 follow-up (cmd-ingest.mjs:291-293) — re-ingest of the same qa-run report after engagement.md targets.browser changed: base_url is derived from the adapter's environment_host_allowed (live ctx.engagement(), TASK-017 note), so the observation payload differs, and because derived files are written BEFORE the record's write-once check, writeArtifact hits EEXIST with a different identity ⇒ 5 INCONSISTENT(observations/<id>) instead of 2 IMPORT-EXISTS. Fail-closed, but the token blames the run's state for the user's re-run. Fix: existsSync(<run>/ingest/<import_sha256>.json) before writing derived files ⇒ importExists; or derive base_url from the run's engagement.json snapshot (the TASK-042 PM-log reading for admissions) so the payload is stable per run. Reasoned from the code path, not probed. |
| TASK-044 cosmetic (observations.mjs caseIdentities) | TASK-044: TASK-044 cosmetic (observations.mjs:90-106 caseIdentities) — caseResolver reads and integrity-verifies EVERY <run>/ingest/*.json (large SARIF records included) on each qa-run / ta-report ingest, so a tampered unrelated sarif record fails a qa-run ingest with 5 INCONSISTENT(ingest/<sha>) — fail-closed by accident, and O(imports) reads per hand-off ingest. On assessment runs the imports index carries `kind`; filter to kind=case first, then verify only those. |
| TASK-044 cosmetic (cmd-plan.mjs taPromptLines) | TASK-044: TASK-044 cosmetic (cmd-plan.mjs:176 taPromptLines) — a published case title containing ` \| ` breaks the `- id: … \| title: … \| path: …` line grammar for the TA lead's reader (id and path are tokens so the last `\| path:` still anchors, but the title field is ambiguous). Replace `\|` in the title with a spelled-out separator, or note the grammar in the header. |
| TASK-044 note only (observations.mjs writeObservations) | TASK-044: TASK-044 note only (observations.mjs:197-226 writeObservations) — on an assessment run whose observations.json is absent, the observation files land before appendIndex's 3 INCOMPLETE(observations); heals on re-ingest (idempotent by identity) but leaves files behind. Consistent with the documented crash-heal design; just record it beside the 'bytes → observations → record → index' row. |
| PM (record: G-15 footprint, TASK-044) | TASK-044: PM (record) — the deviation list understates the G-15 footprint: cmd-tm-lint.mjs + its test (PM-ruled after G22, correctly taken) and render.mjs + render.test.mjs (named in Implementation: 'FAIL observations render under report section 9') were both edited; both legitimate. The plan follow-up row saying 'templates/assessment.md template_version left unchanged' describes a change that lives in render.mjs ASSESSMENT_BLOCKS (no templates/ file in the diff) — wording only. |
| TASK-054 / TASK-047 / redact.mjs owner (rules-v2) / TASK-052 (routed items stand) | TASK-044: Routed items stand as routed: README.md:108 stale text (TASK-054 / TASK-047); `output=./…` / `path: ./…` spelling forced by redact.mjs high-entropy-assign (redact.mjs owner rules-v2); validate:marketplaces stale (TASK-052). |

### PM log additions (after G25)

| Owner | Note |
|---|---|
| TASK-047 follow-up (AGENT.md:166 TEMPLATES line) | TASK-047: bundles/security-testing/agents/security-lead/AGENT.md:166 — step 1 says engagement init prints `TEMPLATES: written`; tokens.templatesLine actually prints `TEMPLATES: engagement.md.template=written finding-schema.md=written report-reading-guide.md=written` (one `<file>=written\|present` entry per knowledge file). Prose only; spell it as the script does. Owner: TASK-047 follow-up. |
| TASK-047 follow-up (AGENT.md:274 scanner-rows file location) | TASK-047: bundles/security-testing/agents/security-lead/AGENT.md:274 vs :649-666 — step 11 calls `--scanner-rows <file>` 'a payload-only file you write', but the Writable-paths self-check lists only engagement.md, cases/<slug>/, a proposal draft and memory as hand-written places; name where the scanner-rows file lives (a lead-owned spot under <st>/, not the reviewer drop-box receipts/<run_id>/). Prose only. Owner: TASK-047 follow-up. |
| TASK-047 follow-up / TASK-045 (tracker step 2/4 ticket ingest) | TASK-047: bundles/security-testing/agents/security-lead/AGENT.md:551-561, :569-589 — tracker step 2 'edit its body … read that ticket back' + step 4 'MISMATCH(title) on a pre-existing ticket you edited is expected': verified in cmd-ingest.mjs step 6a that a `ticketed` event lands only when `mismatch` is empty, so the row never gets `ticket_url` and `publish --profile tracker`'s first layer will re-emit the payload on the next COMMITTED run unless an open `ticket` import of that run names the id (profiles/tracker.mjs plan, second clause). Add 'then `ingest ticket` the pre-existing ticket into the run' (or say the second layer catches it every time). The `ticketed(<url>)` disposition claim is accurate as written — tm-lint reads `{finding_id, url, body_contains_finding_id}` only. Owner: TASK-047 follow-up / TASK-045. |
| TASK-052 (validate:marketplaces regen) | TASK-047: validate:marketplaces is stale with the new agent — already stale on feat/security-testing-bundle-spec (threat-modeler, TASK-039 was the last regen); stays routed to TASK-052 as the dev recorded. |
| PM (record: TASK-047 deviations accepted) | TASK-047: Dev deviations accepted as recorded: the publish-after-COMMITTED / ingest-refuses-COMMITTED constraint is real (cmd-publish.mjs step 3 `must exist and be COMMITTED`; cmd-ingest step 4, cmd-gate step 2, cmd-plan-admit step 2, cmd-run-snapshot, cmd-tm-lint step 2 all `2 RUN-COMMITTED`), so the plan's one-line sketch is unexecutable as written and the Phase 1-6 order is the correct reading; P1 (scope packet → review → gate → subject packets) and P2 (run snapshot register\|verify\|proposals before build-report) hold and the test's ASSESS_ORDER cursor walk pins them. `admit --dry-run` verified in lib/cmd-plan-admit.mjs header. AC-5 install landing correctly belongs to TASK-048's factory.json `briefings` + E2E. NOTES.md/RULES.md siblings match the reviewer and modeler pattern; RULES.md is in hooks/lib.sh SDLC_ROLE_MEMORY_FILES_DEFAULT, NOTES.md is not. |

### Follow-ups from TASK-048 (final manifest + E2E roster extension, 2026-09-17)

Recorded by the TASK-048 implementer. SPIKE-002 outcome and the `dispositions` deviation record are in §8 (above the PM log). Routed items closed here: `security-test-planning` / `threat-modeling` / `risk-register` are in `localSkills`; the NOTES.md sibling is confirmed harmless for all three roles (the E2E asserts AGENT/SOUL/RULES/NOTES land per role on the directory-copy hosts and the flat/TOML hosts name each role); `fixtures/e2e/helpers.mjs` `commandName` now reads a `BOOLEAN_FLAGS` allowlist (every lib/argv.mjs `"boolean"` flag + `--quiet`/`--help`) with a unit test, so `check --integrity <path>` keeps its positional.

| Owner | Follow-up / contract note |
|---|---|
| TASK-053 (smoke), TASK-054 (dogfood) | **A full-roster install needs both externals from one fixture remote.** `obra/superpowers` serves `systematic-debugging` (reviewer) and `dispatching-parallel-agents` (lead); the TASK-056 harness refuses a repo twice, so `ROSTER_EXTERNALS` in `fixtures/e2e/helpers.mjs` is one entry with `subdir: "skills"` and both `<id>/SKILL.md` files. Any offline `--factory security-testing` install given only `SD_EXTERNAL` now fails `assertNoNetwork` (the missing external is an attempted https fetch). |
| TASK-047 / TASK-054 (README + workflow prose) | `skills/security-engagement/references/workflow.md` step 2 still reads M1-dated ("at M1 no command writes it — the bundle's end-to-end test writes the documented empty model … through the scripts' own artifact writer"): since TASK-039 `tm-lint check` writes the snapshot and, since TASK-048, the assessment also requires the index it derives (`3 INCOMPLETE(dispositions)` without it); the E2E now runs `tm-lint check` over the empty model. Same M1-dated sentence class as the README.md:108 item already routed. Prose only. |
| TASK-041 follow-up (cmd-sign-off.mjs `listedThreats`) | The `index === null` branch ("has no dispositions.json … not linted: every threat counts as undisposed") is reachable only for a hand-built run directory now that a COMMITTED assessment always carries the index (its own `check` reports `INCONSISTENT(dispositions.json)` first when the file is removed after COMMIT). Keep as defensive code and say so in the header, or drop it with the sentence; nothing later builds on it. |
| TASK-041 (record) | The foreign-envelope nit (PM log after G21: an index enveloped for another run accepted as this run's) is closed by `inputs.closeOver`'s `ownRun` now that `dispositions` is a required assessment input — pinned in `inputs.test.mjs` (`INCONSISTENT(dispositions.json)`). `cmd-sign-off.mjs` itself is unchanged. |
| TASK-052 | `npm run validate:marketplaces` still stale (risk-register / threat-modeler / security-test-planning / security-lead not regenerated); unchanged here as routed. The manifest test's marketplace assertion pins only the M1 rows; TASK-052 asserts the final ones. |
| PM (record: G-15 footprint, TASK-048) | Files edited outside the task's own list, all consequences of the named `inputs.REQUIRED.assessment` edit: `templates/assessment.md` (required-inputs block must agree with REQUIRED or `build-report` throws) + `templates/README.md` row; assessment fixtures in `cmd-build-report.test.mjs`, `cmd-check.test.mjs`, `inputs.test.mjs`, `render.test.mjs` (parseTemplate pin), `cmd-sign-off.test.mjs` (fixture default + two TASK-041 tests re-asserted, see §8), `cmd-run.test.mjs` (pins the absence). `cmd-run.mjs`, `cmd-tm-lint.mjs`, `render.mjs`, `cmd-sign-off.mjs`, `lib/tokens.mjs` untouched. |

### PM log additions (after G26)

| Owner | Note |
|---|---|
| TASK-048 follow-up (helpers.mjs BOOLEAN_FLAGS) | TASK-048: helpers.mjs BOOLEAN_FLAGS (fixtures/e2e/helpers.mjs:~226) claims 'every lib/argv.mjs "boolean" flag' but omits register.mjs's `--subject-equivalent` and `--transfer-exposure` (the only other `"boolean"` specs under scripts/). Harmless today (commandName only needs cmd+sub, and neither flag precedes a closed-list subcommand) — add both or soften the comment. Owner: TASK-048 follow-up. |
| TASK-056 follow-up (harness.mjs buildBareRemote default SKILL.md) | TASK-048: fixtures/offline/harness.mjs buildBareRemote always adds a default `SKILL.md` at the subdir root when `files` has no top-level `SKILL.md`, so ROSTER_EXTERNALS (subdir `skills`) also commits an inert `skills/SKILL.md` named systematic-debugging into the fixture remote. Never installed (the registry subdirs are `skills/<id>`), so inert; note it in the ROSTER_EXTERNALS docstring or teach the harness to skip the default when nested SKILL.md files exist. Owner: TASK-056 follow-up. |
| TASK-048 follow-up (helpers.mjs SD_EXTERNAL dead export) | TASK-048: helpers.mjs `SD_EXTERNAL` is now a dead export (no importer on the branch) whose only use would be a full-roster install that fails assertNoNetwork — either delete it or keep the 'M1 shape for readers' comment as the sole justification. Owner: TASK-048 follow-up. |
| TASK-047 follow-up (AGENT.md:396 INCOMPLETE causes) | TASK-048: security-lead AGENT.md:396 (Phase 6 step 20) lists `threat-model` and `register-events` as the INCOMPLETE causes; since this task an assessment whose model snapshot was written but whose relationship lint failed (step 17/19 'snapshot is written before the relationships are checked') reports `3 INCOMPLETE(dispositions)` — name it so the lead recognises the un-linted-model case. Prose only. Owner: TASK-047 follow-up. |
| PM / TASK-053 (contract consequence: pre-change COMMITTED runs) | TASK-048: Contract consequence worth a PM-log line: any assessment run COMMITTED before this change without `<run>/dispositions.json` (e.g. runs left by the 2026-09-17 M1 manual smoke) now reads `3 INCOMPLETE(dispositions)` at `check` and fails `sign-off` naming that run; the remedy is a new run + `tm-lint check`. Nothing shipped to consumers yet, so record only. Owner: PM / TASK-053. |
| TASK-048 follow-up (e2e.test.mjs:517 cosmetic) | TASK-048: e2e.test.mjs:517 assertion message says 'exactly the four files outside the block that the engagement writes' — the fourth (`<st>/threat-model.json`) is written by the test as the modeler would, not by the engagement. Cosmetic. |
| TASK-052 (validate:marketplaces stale; US-042 AC-2) | TASK-048: US-042 AC-2 (`npm run validate` exit 0) is not satisfiable on this branch because `validate:marketplaces` is stale — verified equally stale on feat/security-testing-bundle-spec (gen-marketplaces --check fails on base for the same three files), so pre-existing and correctly routed to TASK-052; validate:factories (5/5, security-testing = 3 agents) and validate:dupes (10/10) are green on the branch. |
| TASK-043 follow-up (cmd-publish.mjs:235/246/248 wording) | TASK-043-FU: cmd-publish.mjs:235 — same class as item (6): `${dest.rel}/${o.relpath} is a directory; choose another --to` still names the dead end for the M3 profiles (case/handoff --to is fixed). Route to a TASK-043 follow-up: per-profile wording as at line 238, or one helper `wayOut(profile)` used by both throws. Likewise line 246/248 (`already exists and is not an export manifest` / `already exists for a different export; choose another --to`) — for the M3 sidecar `<st>/handoffs/<run_id>.<profile>.export-manifest.json` there is no other --to either; the actual way out is one handoff/case export per run. Wording only; the existing handoff test asserts the prefix, not the tail, so the change is free. |
| TASK-043-FU note only (cmd-sign-off.mjs:441-448 unadmittedFiles) | TASK-043-FU: cmd-sign-off.mjs:441-448 (unadmittedFiles) — lstat-then-read is a benign TOCTOU (a regular file swapped for a symlink between the two calls is followed by readFileSync). Not worth code; note only. The ordering itself is right: lstat before read means a FIFO placed in the suite is listed, never opened (readFileSync would block forever). |
| Whoever next touches ledger.mjs RUN_ID (profiles/index.mjs:83) | TASK-043-FU: profiles/index.mjs:83 — RUN_ID is now declared in two modules (ledger.mjs owns it; the registry re-spells it for G-9). The test pins `.source` equality, which is the right backstop; if ledger ever gains flags the pin should compare `.flags` too. Owner: whoever next touches ledger.mjs RUN_ID. |
| TASK-047 / TASK-048 prose (cmd-sign-off.test.mjs:671 note) | TASK-043-FU: cmd-sign-off.test.mjs:671 — the engagement-wide identities test hand-writes a case manifest for run `cccccccccccc-0002` that has no run directory; recordedSuites trusts it on HMAC alone (pre-existing TASK-043 behaviour, not this task's). If a later task wants sign-off to require the run in the ledger index, this test will need a real second run. Note for TASK-047/-048 prose, not a defect. |

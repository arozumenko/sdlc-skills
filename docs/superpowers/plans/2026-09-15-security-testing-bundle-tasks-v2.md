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
    index.json  index.lock/
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
| `lib/ledger.mjs` | `allocateRun(ctx, {kind, base_oid, head_oid}) → {seq, run_id}` (under lock), `readIndex(ctx)`, `listCommittedRuns(ctx)`, `withRunLock(ctx, run_id, fn)` | 012 |
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
| `run init` | `--kind assessment|review|verify|threat-model --base <ref> [--head <ref>]` (`--base` required for `review`/`verify`; defaults to head otherwise) | `git status --porcelain` (assessment only), `git rev-parse`, `engagement.md` | `ledger/index.json` (+1 entry under lock), `<run>/run.json`, `<run>/engagement.json`, empty dirs `packets/ receipts/ ingest/ verify-snapshots/`, `ledger/<run_id>/imports/`; **assessment only**: `imports.json` `{imports: []}`, `observations.json` `{observations: []}`, `proposals-index.json` `{proposals: []}` (P2; `threat-model.json` deliberately absent ⇒ `INCOMPLETE(threat-model)` until written) | `RUN <run_id> seq=<n> kind=<k> base=<oid> head=<oid>` | `0`; `3 DIRTY-TREE` (assessment, dirty; ledger untouched); `2 ENGAGEMENT-MISSING` |
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
| `check` | — | every `accepted` row with `until` (UTC, exclusive) < today ⇒ `open`, event `acceptance-expired` |
| `close-false-positive <R-id>` | `--approved-by --approval-ref` | `open → false-positive` |
| `reopen <R-id>` | `--reason <r>` | `false-positive → open` |
| `supersede <R-id>` | `--by <R-id> (--subject-equivalent | --transfer-exposure)` | §6.8; cycle or self ⇒ exit 2; neither flag ⇒ exit 2 `EQUIVALENCE-REQUIRED`; `--subject-equivalent` without same subject or alias link ⇒ exit 4 |
| `alias` | `--from <finding_id> --to <finding_id> --reason <r> --run <run_id>` | appends to `finding-alias.jsonl` (hash-chained); no row change |
| `consume-verdict <verify.json>` | — | `VERIFIED ⇒ fixed` (+`ack_refs`, `last_verified_run`); `REGRESSED ⇒ regressed`; `UNVERIFIED-* ⇒ verify-observed` event only; `regression-observed` whenever `evaluation.refound_observed && row.status == fixed` (TASK-030) |
| `render` | `[--out <path>=<st>/risk-register.md]` | writes the Markdown view from the projection (TASK-059); deterministic |
| `transition <event> <R-id> [flags]` | generic form; the verbs above are aliases; **`ticketed` is not accepted here** (only `ingest tracker-readback` appends it) |
| `status` | `[--json]` | counts by status × priority, `open_exposure` (open+regressed by priority), `unauthenticated_approvals` (accepted + false-positive + rows with ack_refs), never subtracting |
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

**Implementation.** `scripts/lib/ledger.mjs` (`allocateRun` under `ledger/index.lock/`: read index, `seq = max+1`, write `{seq, run_id, kind}` via `writeAtomic`; `run_id` per TL-9; `withRunLock(ctx, run_id, fn)` on `<run>/.lock/`), `scripts/lib/run-index.mjs` (`appendIndex(ctx, run_id, name, entry)` — read the index artifact, push, re-envelope, `writeAtomic`, under `withRunLock`; TL-14), `lib/cmd-run.mjs` (`init`: for `assessment` check `git status --porcelain` empty **before** allocation ⇒ `3 DIRTY-TREE`, ledger untouched; resolve `base_oid`/`head_oid` to 40-hex; create `<run>/{packets,receipts,ingest,verify-snapshots}/` and `ledger/<run_id>/imports/`; write `run.json`, `engagement.json`; **assessment only**: `imports.json` `{imports: []}`, `observations.json` `{observations: []}`, `proposals-index.json` `{proposals: []}` as enveloped artifacts of kinds `imports-index|observations-index|proposals-index`; `threat-model.json` is **not** written — its absence is the `INCOMPLETE(threat-model)` signal). `run snapshot …` is TASK-058.

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

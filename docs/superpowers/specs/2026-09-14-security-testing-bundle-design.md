# security-testing bundle — design spec (v6)

**Date:** 2026-09-15 (v5; v4 33539a6, v3 028fab1, v2 9201e6b, v1 875f211)
**Bundle:** `bundles/security-testing/` (new)
**Branch:** feat/security-testing-bundle-spec
**Status:** v6 draft; goal: no blocker or major findings open
**Inputs:** [market research](../notes/2026-09-14-security-testing-market-research.md),
[secops comparison](../notes/2026-09-14-security-testing-secops-comparison.md),
reviews [v1](../notes/2026-09-14-security-testing-spec-adversarial-review-codex.md),
[v2 A](../notes/2026-09-14-security-testing-spec-v2-adversarial-review-codex.md),
[v2 B](../notes/2026-09-14-security-testing-spec-v2-adversarial-review-codex-2.md),
[v3](../notes/2026-09-15-security-testing-spec-v3-adversarial-review-codex.md),
[v4](../notes/2026-09-15-security-testing-spec-v4-adversarial-review-codex.md)
(0 blockers, 5 majors), [v5](../notes/2026-09-15-security-testing-spec-v5-adversarial-review-codex.md)
(0 blockers, 1 major). §17 maps v3 F1–F20 to v4; §18 maps v4 R1–R5 to v5;
§19 maps v5 N1 and M1–M4 to v6.

**Sources of truth for repo claims.** `bin/lib/item-resolver.mjs`
(`FACTORIES_DIR = "bundles"`); `bin/validate-factories.mjs` (empty `agents`
allowed iff `localAgents` non-empty; every declared id must have
`AGENT.md`/`SKILL.md`); `hooks/lib.sh` (`SDLC_ROLE_MEMORY_FILES_DEFAULT`
includes `RULES.md`; `hooks/config.sh.example` is stale); `bin/init.mjs`
(core hooks install on every non-MCP-only install; `factory.json` `targets`
governs bundle hooks only; standalone `--skills` installs no seeds and no
instructions); `package.json` (`npm run validate` = factories + marketplaces
+ externals (network) + dupes); `skills/memory`, `skills/knowledge-curation`
are top-level monorepo skills (no network to install). `CLAUDE.md` and
`bundles/SPEC.md` still say `factories/<id>`; M-1 fixes them.

## 1. Purpose

A **threat-led security testing team**: code-derived threat model, evidence
review whose citations anyone with the repo can re-validate, passive test
cases for the `manual-qa` and `test-automation` bundles, fix verification
from a validated test-start snapshot, and a residual-risk register.
Read-only toward product code; never merges, closes, rotates, or fixes.
Produces a **security assessment**, not a penetration test.

## 2. What the bundle can and cannot promise

| Can promise (script, on canonical-pipeline outputs) | Cannot promise |
|---|---|
| **Consistency and re-derivation.** For a run directory carrying a `COMMITTED` marker, `check` recomputes from the recorded inputs every derived value the report displays (§6.3 derivation table) and byte-compares the rendered report. | Origin. A consistent set can be authored by anyone with write access. `check` prints `ORIGIN: unauthenticated` unless a consumer-held digest is supplied. |
| **Integrity against the recorded snapshot** (`base_oid`/`head_oid` per citation side) and **drift against the current tree**, at citation and scope level. For `side: snapshot` citations (dirty files in `review` runs only; assessment runs are clean-tree), original-content revalidation is possible only while the working file still matches the recorded HMAC; afterwards the result is `CONSISTENT-REDACTED-ONLY` (the redacted snapshot matches its recorded hash; the original HMAC is compared as recorded, not re-derived). | That a model read what it declared examined; original bytes of a dirty file after it changes. |
| **Tests execute from a validated test-start snapshot**: the tree is compared to `head_oid` after dependency installation; tracked changes fail the run unless the operator record allows them, in which case the verdict names the derived snapshot, not `head_oid`. | Test meaningfulness; class closed at the sink; suppression detection beyond lexical indicators. |
| **Bounded redaction before any persistence, including under `private/`**: no artifact this bundle writes contains original bytes that match a redaction rule; reconstruction needs are met with redacted bytes plus keyed HMACs of the originals. **No publishable artifact carries a plain hash whose preimage contains protected content** (identity is keyed whenever the cited content matches a rule, regardless of finding class). | Detection of secrets outside the rule list. |
| **Only admitted cases are written to the hand-off suite**, a directory that contains nothing else. | That a QA runner refuses a case handed to it directly. |
| **Every approval-like record is stored and reported as unauthenticated.** There is no confirmed state. | That any human approved anything. |
| **Per-path observation of working-tree changes** between `engagement init` and `sign-off` for tracked files and **non-ignored** untracked files under scope and product paths; the count of ignored files under those paths is recorded so the excluded coverage is visible. | Attribution of a change to a role; changes to git-ignored files. |

## 3. Decisions (locked)

| # | Decision |
|---|---|
| D1 | Three agents. Skills: `security-evidence` (all scripts and schemas), `security-engagement`, `secure-code-review`, `threat-modeling`, `security-test-planning`, `risk-register`. **Every script lives in `security-evidence`**, so any install that includes it can run every command. |
| D2 | Consistency, not provenance (§2). |
| D3 | Coverage is report section 2. Empty scope ⇒ `INDETERMINATE`. Every scoped range is accounted for exactly once. |
| D4 | No **bundle** hooks in v1 (the installer's core context hooks still install). Read-only posture = prose + per-path baseline observation at sign-off. |
| D5 | Ingest adapters per input kind (§6.6). Untrusted content proposes; only scope- and target-validated references act. Test argv comes only from the operator record in `engagement.md`, whose authorship is unverified. |
| D6 | Scanners enter only as SARIF via a versioned mapping with a closed fallback matrix (§6.7). |
| D7 | Passive admission by effect with an admission record; active work is a proposal outside `tasks/`; the hand-off suite contains only admitted cases (§9). |
| D8 | Stdlib ESM Node; `spawn(argv, {shell:false})`; no shell scripts. |
| D9 | Secops ideas ported, no text or code copied. |
| D10 | README Guarantees table (`enforced by: script | prose`) and Not guaranteed section; every enforcement claim is qualified "for canonical-pipeline outputs". |
| D11 | Skill ids `security-*` / `secure-*` / `threat-*` / `risk-register`. |
| D12 | Standalone review = `--skills security-testing/secure-code-review,security-testing/security-evidence`; `evidence.mjs engagement init` writes the knowledge templates itself when the seeded copies are absent, so the two-skill install runs the full command set except the threat-model and planning commands. |
| D13 | All security artifacts local by default; `engagement init` **fails** if private destinations are tracked or not effectively ignored; every publication path is `evidence.mjs publish --profile` (§6.9). |
| D14 | JSON model of record; Markdown generated. |
| D15 | Approvals are unauthenticated records. **No `confirm` command exists.** |
| D16 | Two evidence layers with keyed HMACs; identity keyed by content sensitivity (§6.5). |
| D17 | Public verdicts only from `verify.mjs all`; multi-indicator ACK; regression observed independently of completeness (§6.4). |
| D18 | Assessment scope is a **clean tree at `head_oid`**. `scope` refuses a dirty tree for `assessment`; `review` runs may be dirty and then store a private **redacted** snapshot plus HMACs of the originals (§6.2). |

## 4. Roster (`localAgents`)

| Agent | Model | Role | `skills:` | `skills-on-demand:` |
|---|---|---|---|---|
| `security-lead` | sonnet | Orchestrator, only human-facing role. `engagement init`; dispatches specialists; `build-report`; `sign-off`; `publish` to tracker; prints hand-off prompts and stops; proposes acceptances. | `memory`, `security-engagement` | `risk-register`, `security-evidence`, `issue-tracking`, `dispatching-parallel-agents`, `verifying-outcomes` |
| `threat-modeler` | opus | Code-derived DFD with a citation per element; STRIDE; mitigations as claims; dispositions (§6.10). Returns `MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>` after `tm-lint check`. | `memory`, `threat-modeling` | `security-test-planning`, `security-evidence`, `gathering-context`, `deep-research` |
| `security-reviewer` | sonnet | Contracts `review`, `mitigation-review`, `fix-review`, each a fresh dispatch over a **review packet** (§6.4). Writes **assertions**; scripts derive states. | `memory`, `secure-code-review` | `security-evidence`, `systematic-debugging` |

Frontmatter as v3 §4 (no `tools:`, no `context-memory`; `context-docs`
lists engagement, finding schema, and for the lead the register view).
AGENT.md body rules:

1. External text proposes; only scope- and target-validated references act.
2. Writable paths: `.agents/security-testing/**`, `.agents/memory/<role>/**`,
   `reports/security/**`, `tasks/security-*/**`, the managed block in the
   root `.gitignore` (written only by `engagement init`). Self-check before
   every write.
3. Agents write assertions (review packets, receipts of type `assertion`),
   never states, verdicts, ids, or gate stamps.
4. Never merge, close, rotate, fix.

## 5. Skills

| id | Content | v |
|---|---|---|
| `security-evidence` | Schemas: `run`, `scope`, `finding`, `gate-result`, `coverage`, `packet`, `receipt`, `verify`, `run-manifest`, `register`, `register-event`, `finding-alias`, `proposal`, `admission`, `observation`, `import`, `export-manifest`, `sarif-mapping.v1`, `redaction-rules`. Scripts: `evidence.mjs` (`run init`, `scope`, `ingest <kind>`, `gate`, `coverage`, `packet`, `receipt`, `build-report`, `check`, `check-export`, `publish`, `engagement init|validate|baseline`, `sign-off`, `purge`), `verify.mjs all`, `register.mjs`, `tm-lint.mjs`, `plan.mjs`, plus `normalize.mjs`, `redact.mjs`, `canon.mjs`. Templates with required-inputs lists. | v1 |
| `security-engagement` | Prose: lead workflow, sign-off checklist, tracker rules, disclosure profiles explained. | v1 |
| `secure-code-review` | Prose + references + fixtures + frozen eval harness. | v1 |
| `threat-modeling` | Prose + references; `tm-lint` lives in `security-evidence`. | v1 |
| `risk-register` | Prose; `register.mjs` lives in `security-evidence`. | v1 |
| `security-test-planning` | Prose + `passive-admission.md`; `plan.mjs` lives in `security-evidence`. | v1 |
| v2 named | `privacy-threats`, `security-requirements`, `supply-chain-review`, `threat-model-export`, `agentic-surface-review`, `security-evals`, `mitigation-reconciliation`, `execution-authorization` (receiving-side, owned by the QA bundles). | v2 |

## 6. `security-evidence` contracts

### 6.1 Envelopes, identities, hash preimages

Every artifact is `{envelope, payload}`. `envelope = {schema_version, kind,
run_id, engagement_id, key_id, created_at, self_sha256}`. **Identity of an
artifact = sha256(canonical(payload))**; `self_sha256` is that value; the
envelope is never part of any preimage. `canonical()` = UTF-8, LF, keys
sorted bytewise, duplicate keys rejected on read, no insignificant
whitespace, integers only (no floats anywhere in the schemas), strings NFC.

| Artifact | Preimage | Depends on |
|---|---|---|
| `run.json` | `{engagement_id, seq, base_oid, head_oid, template}` | `engagement.md` |
| `scope.json` | `{files[], ranges, skipped[], snapshot?}` | run |
| `findings.claimed.json` | `{findings[]}` | scope (references `scope_sha256`) |
| `gate-result.json` | `{accepted[], unverifiable[], rejected_counts, scope_sha256, claimed_sha256}` | claimed, scope |
| `coverage.json` | `{accounting[], scanner_rows[], scope_sha256, examined_sha256}` | scope, examined declaration |
| `packet.json` | `{subject_ids[], files[{path, side, oid, ranges, range_hmac}], policy_sha256}` | scope |
| `receipt.json` | `{type, subject_id, packet_sha256, assertion, reviewer_run_id}` | packet |
| `verify.json` | §6.4 | run, receipts |
| `manifest.json` | `{inputs: {kind → sha256}, report_sha256, template, template_version, tool_version}` | all of the above |

Order: `run init` → `scope` → `ingest`/agent findings → `gate` → `coverage`
→ `packet`/`receipt` → `build-report` (renders report, writes manifest,
writes `COMMITTED` marker containing the manifest hash, last). A run
directory without `COMMITTED` is **incomplete**: ignored by the inventory,
listed by `sign-off` as such. Retry = new `seq`; nothing is rewritten.
`run init` appends `{seq, run_id, kind}` to `ledger/index.json` under a lock.

### 6.2 Scope, normalisation, citations

- `run init --kind assessment` requires a clean tree (`git status
  --porcelain` empty); otherwise exit 3 `DIRTY-TREE`. `--kind review` allows
  a dirty tree and stores, for every dirty/untracked in-scope file, its
  **redacted** content under `private/snapshots/<run>/<path>` and the HMAC
  of its original bytes in `scope.payload.snapshot`. Order: read → HMAC →
  redact → persist. `check --integrity` for `side: snapshot` yields `CONSISTENT` when the
  redacted snapshot matches its recorded hash **and** the working file still
  matches the recorded original HMAC; `CONSISTENT-REDACTED-ONLY` when only
  the former holds (the original is gone; nothing can re-derive it);
  `INCONSISTENT` when the redacted snapshot does not match. Original bytes
  are never on disk.
- Normalisation and range rules as v3 §6.1 (newline-preserving, `end - start
  + 1 ≤ 40`, primary ranges ⊆ admitted ranges, typed citations flagged
  `context`, occurrence recomputed by `gate`).
- Every citation carries `side: base | head | snapshot` and is resolved
  against that side's bytes: `git show <base_oid|head_oid>:<path>` or the
  private snapshot. `check --integrity` uses the recorded side; `check
  --drift` uses the working tree for `head`/`snapshot` citations and skips
  `base` citations (deleted code has no current counterpart).

### 6.3 `build-report` and `check`

`build-report --run <run_id> --template <name>` reads only from the run
directory; the template's **required-inputs list** is closed:

| Template | Required inputs |
|---|---|
| `review` | run, scope, claimed, gate-result, coverage, examined declaration, packets, receipts (review), rejects, unlocated |
| `assessment` | review inputs + engagement snapshot, threat-model, receipts (mitigation-review), observations, imports, verify runs, register events snapshot, proposals index |
| `verify` | run, verify.json, fix-review packet, receipts (fix-review, ack) |
| `threat-model` | run, threat-model, mitigation packets, receipts (mitigation-review), disposition references index |

Required inputs are **transitively closed**: every artifact an input
references by hash (packets from receipts, scope from gate, imports from
observations) is itself required. A missing required input ⇒ exit 3
`INCOMPLETE(<input>)`; no report.

**Derivation table** (each value the report displays and where `check`
recomputes it from):

| Displayed | Recomputed from |
|---|---|
| finding ids, states `CITATION_*` | `gate` re-run on claimed + scope |
| coverage accounting and counts | `coverage` re-run on scope + examined declaration |
| `REVIEW_*`, `MITIGATION_*` states | `receipt apply` over receipts + packets |
| verify verdicts and history | `verify.mjs evaluate` over each `verify.json` raw results (pure function, no execution) |
| register status, delta, unauthenticated-approval bucket | `register.mjs replay` over the events snapshot |
| rejected and unlocated totals | rejects and unlocated artifacts |
| executive counts | all of the above |
| rendered report bytes | deterministic renderer over the same inputs |

`check <run dir | manifest> [--integrity] [--drift] [--trusted-digest <sha256>]`
→ `CONSISTENT | CONSISTENT-REDACTED-ONLY(n citations) | INCONSISTENT(<field>)`
(the middle result is possible only for `review`-kind runs); `CURRENT | CITATION-DRIFTED(n) |
SCOPE-DRIFTED(n files)` (scope drift = per-file HMAC of every in-scope file
vs `scope.json`); `ORIGIN: unauthenticated | matches supplied digest`
(compared against the **recomputed** manifest hash, never the sidecar);
`KEY: available | unavailable` — with the key unavailable, content
re-validation is skipped and the result is `STRUCTURE-ONLY`, never
`CONSISTENT`.

### 6.4 Packets, receipts, states, `verify.mjs all`

**Packet** = the exact input set given to a reviewer: `{subject_ids, files[{path, side, oid, ranges, range_hmac}], policy_sha256}`; its hash is `packet_sha256`. Agents receive a packet path and read only what it lists; anything else they read is residual exposure.

**Receipt** `{type: review | mitigation-review | fix-review | ack, subject_id, packet_sha256, assertion, reviewer_run_id}`; `assertion` is a closed enum per type (`review: confirmed | refuted | indeterminate`; `mitigation-review: confirmed | gap | indeterminate`; `fix-review: not-refound | refound | indeterminate`; `ack: {indicator_id}`). `receipt validate` checks schema, that the packet exists and matches, and that `packet.files[].oid` equals the run's oids. `receipt apply` derives states:

| Prior state | Receipt | Derived |
|---|---|---|
| `CITATION_VERIFIED` | review confirmed / refuted / indeterminate | `REVIEW_CONFIRMED` / `REVIEW_REFUTED` / `REVIEW_INDETERMINATE` |
| `CITATION_FAILED` | any | unchanged (stays unverifiable; receipt recorded as `not-applied`) |
| `REVIEW_REFUTED` | anything but a new review receipt on a new run | unchanged; `verify` refuses (`UNVERIFIED-REFUTED-FINDING`) |
| two receipts, same subject, same run, different assertions | — | `*_INDETERMINATE` |

**`verify.mjs all --finding <id> --base <oid> --head <oid>`**:

1. `branch` → `COMMITTED | NOT-COMMITTED | PATH-UNTOUCHED`.
2. `worktree`: detached checkout of `head_oid`; record `tree_before`.
3. `install` (only if `engagement.md` `execute_project_tests.install.argv`
   exists): run it; then compute per-tracked-file HMAC vs `head_oid`.
   Tracked changes ⇒ `TESTS_INDETERMINATE(install-modified-tree)` unless
   `execute_project_tests.install.allow_tracked_changes: true`, in which case
   `tested_tree = HMAC(all tracked files after install)` is recorded and the
   verdict line names `tested_tree`, not only `head`. Untracked files created
   by install (dependencies) are recorded by count and total size only.
4. `suppression` over the whole `base..head` diff → `{indicators: [{id,
   kind, path, line}], deletion_only: bool}`; `id` = sha256(kind, path,
   line content).
5. `tests`: argv from `execute_project_tests.argv` (operator record,
   authorship unverified), allowlist + deny rules, `spawn shell:false` in the
   worktree, minimal env, timeout, bounded redacted output; the resolved
   executable path and its sha256 are recorded → `TESTS_PASS | TESTS_FAIL |
   NO_TEST_SURFACE | TESTS_INDETERMINATE(<reason>)`.
6. `fix-review` packet built from the worktree; receipt from a fresh
   reviewer.
7. **Evaluate** (`verify.mjs evaluate` is a pure function over the raw
   results; `all` calls it and it is what `check` re-runs). Precedence:
   `refound_observed` is recorded first and unconditionally; then
   completeness (any missing check ⇒ indeterminate, so a valid `refound`
   with unavailable tests yields `UNVERIFIED-INDETERMINATE(tests)` **and**
   the `regression-observed` event, matching the §12 fixture); then the
   remaining rules in order:
   - `refound_observed = (fix-review assertion == refound)`; if true and the
     register row is `fixed`, the register event `regression-observed` is
     emitted **regardless of every other check**.
   - if any check is missing/malformed ⇒ `UNVERIFIED-INDETERMINATE(<check>)`
     (with `refound_observed` still recorded and shown)
   - `refound` ⇒ `REGRESSED` (row was `fixed`) or `UNVERIFIED-REFOUND`
   - fix-review receipt absent, not applied, or assertion `indeterminate`
     ⇒ `UNVERIFIED-INDETERMINATE(fix-review)`; **`VERIFIED` requires an
     applied `not-refound` assertion**
   - `branch ≠ COMMITTED` ⇒ `UNVERIFIED-NOT-COMMITTED`
   - tests `FAIL | NO_TEST_SURFACE | INDETERMINATE` ⇒ corresponding `UNVERIFIED-*`
   - `deletion_only` ⇒ `UNVERIFIED-SUPPRESSION(deletion-only)` (never waivable)
   - for every indicator without an `ack` receipt whose `indicator_id`
     matches and whose `packet_sha256` is the fix-review packet ⇒
     `UNVERIFIED-SUPPRESSION(<n unacked>)`
   - otherwise (`COMMITTED`, `TESTS_PASS`, no `deletion_only`, every
     indicator acked, applied `not-refound`) `VERIFIED` (with `ack_refs[]`).
   Multiple `ack` receipts are expected (one per indicator) and are exempt
   from the conflicting-assertions rule, which applies per `(type,
   subject_id, run)` to the other three types only. An indicator id whose
   line content matches a redaction rule uses the keyed identity of §6.5.
8. `verify.json` payload: all raw results, argv hashes, resolved executable
   hash, `tree_before`, `tested_tree`, install counts, receipt hashes,
   evaluation output. Line: `VERDICT <token> finding=<id> base=<oid>
   head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>`.

Register consumes: `VERIFIED` ⇒ `fixed` (`ack_refs` on the row);
`REGRESSED` ⇒ `regressed`; `regression-observed` event always recorded;
`UNVERIFIED-*` ⇒ event only.

### 6.5 Keys, identities, redaction

- `engagement init` creates `private/keys/<key_id>` with `O_EXCL` (exists ⇒
  reuse; `--rotate` creates a new `key_id`, keeps old files, and every
  artifact records the `key_id` it used). Loss of a key ⇒ `KEY:
  unavailable` for those artifacts; the report's Limitations list them.
- **Identity by content sensitivity.** `gate` runs the redaction rules over
  the cited range (raw bytes). If nothing matches: `id =
  sha256(path\0class\0normalised snippet\0occurrence)` and `snippet` is
  stored. If anything matches: `id = HMAC_key(path\0class\0redacted
  normalised snippet\0occurrence)`, `snippet_redacted` is stored,
  `sensitive: true` is set, and the in-memory comparison result is stored in
  `private/citations/<run>/<id>.json` as `{claimed_hmac, source_hmac, match,
  side, oid, redaction_version}` **before** the claimed text is discarded.
  Secret-class findings are the same path with `snippet_redacted` replaced by
  `context_redacted`. Fixtures include a non-secret-class finding citing
  `password=1234`.
- Replay: with the key, `check` re-derives `source_hmac` from the recorded
  side (`git show` for `base`/`head`; the working file for `snapshot` while
  it still matches) and compares it, together with the recorded
  `claimed_hmac`, against the private record (the original claim is not
  stored, so it is compared, never recomputed). When a `snapshot` original
  is no longer available the citation is `CONSISTENT-REDACTED-ONLY`; without
  the key, `STRUCTURE-ONLY`.
- Redaction is one function (`redact.mjs`, versioned rules) applied by every
  writer to every string, recursively, including rejection reasons, logs,
  tracker bodies, hand-off prompts. Guarantee bounded to the rule list.

### 6.6 Ingest adapters

| Adapter | Structural validation | Trusted after validation | Inert (quoted, redacted, wrapped) |
|---|---|---|---|
| `ingest sarif` | schema; §6.7 matrix | canonical in-repo path within scope; rule id; level | `message.text`, `snippet.text` |
| `ingest ticket` | tracker JSON schema | `id`, `url` (host must be in `engagement.md targets.tracker`), `labels`, `state` | title, body |
| `ingest pr` | tracker JSON schema | `number`, `url` (same host rule), `base_ref`, `head_oid`, `changed_files[]` ∩ scope | title, body |
| `ingest doc` | in-scope path | path | content |
| `ingest case` | manual-qa TC frontmatter | ids, `requirements` | steps |
| `ingest audit` | qa-auditor report Markdown + its JSON block | finding titles, URLs (host ∈ `targets.browser`) | evidence text |
| `ingest qa-run` | manual-qa run report **Markdown** `reports/RUN-YYYY-MM-DD-NNN.md` per `test-run-report-format.md`: frontmatter (`run_id`, `suite`, `environment`, `date`) and the `## Results` table (`ID`, `Title`, `Size`, `Status` with `PASS|FAIL|BLOCKED`, `Steps`, `Wall Clock`); the fixture is that format verbatim | `run_id`, case ids, status tokens, `environment` (host ∈ `targets.browser`), suite | titles, failure narratives; screenshots referenced by path, never copied |
| `ingest ta-report` | `.agents/automation/<slug>/report.json` | unit outcomes, `coverage`, exclusions, `findings[]`, `recovery_basis` if present, test paths | free text |
| `ingest tracker-readback` | tracker JSON after a mutation | the fields the mutation set | everything else |

Every import is **snapshotted as redacted canonical bytes**: the artifact
is read, HMAC'd (`original_hmac`), redacted, then written to
`ledger/<run>/imports/<sha256 of the redacted bytes>`; every derived record
carries `import_sha256` (redacted identity) + `original_hmac` + record index
as its locator. Original bytes are never persisted by this bundle. `engagement.md targets:`
(`tracker`, `browser`, `repo`) is the destination/authority policy,
separate from source scope.

### 6.7 SARIF fallback matrix

| Condition | Handling |
|---|---|
| no `physicalLocation` or URI not canonicalisable inside repo | unlocated candidate |
| in-repo path outside scope | unlocated candidate, reason `out-of-scope` |
| `startLine` present, `endLine` absent | `endLine = startLine` |
| region present, snippet absent | snippet read from the recorded side |
| `level` absent | rule `defaultConfiguration.level`; absent ⇒ `p3` and `confidence` from tool default |
| `ruleIndex` and `ruleId` disagree | reject with reason |
| unknown tool | class from tags only; `confidence: 3`; recorded |
| malformed region (`end < start`, non-integer) | reject with reason |
| data-flow class | located candidate, `REVIEW` requires typed citations |

Rejections are counted by reason and displayed; nothing is promoted or
dropped silently.

### 6.8 Register

Events `{seq, prev_sha256, ts, actor, row_id, event, payload (all changed
fields), ref}`; projection rebuilt by `replay`. **Recovery**: on every
command, if `projection.seq < log.seq` ⇒ rebuild (interrupted write,
normal); if `projection.seq > log.seq` or any `prev_sha256` mismatch ⇒
exit 5 `CORRUPT`. Append is `O_APPEND` under a lock; projection is
tmp+rename after append.

`anchor print` → `<engagement_id>:<seq>:<chain_sha256>`; `anchor verify
--expect <that>` ⇒ `MATCH | TRUNCATED | DIVERGED`.

**Supersession** requires `--subject-equivalent` (target row's subject is
the same finding id or linked through `finding-alias.jsonl`) **or**
`--transfer-exposure`, which first raises the target's `priority` to
max(both) and sets its status to `open` if the source was `open |
regressed`; otherwise reject. Finding aliases (`finding-alias.jsonl`:
`{from_id, to_id, reason, run_id}`) are separate from row supersession.

Transitions: v3 §6.7 table minus `confirm`, plus `regression-observed`
(informational event) and `alias`. Every approval-like field
(`acceptance`, `false_positive`, `ack_refs`, execution authorization) is
`{recorded_by, approved_by, approval_ref, authenticated: false}`; reports
show one "unauthenticated approvals" bucket; open exposure is never reduced
by any of them.

### 6.9 Artifact policy, `engagement init`, publication

`engagement init`:
1. writes the managed `.gitignore` block (exact patterns:
   `.agents/security-testing/private/`, `.agents/security-testing/ledger/`,
   `.agents/security-testing/runs/`, `.agents/security-testing/receipts/`,
   `.agents/security-testing/proposals/`, `.agents/security-testing/handoffs/`,
   `.agents/security-testing/imports/`, `reports/security/`,
   `tasks/security-*/`), idempotently between `# security-testing:begin/end`;
2. **fails (exit 4)** if `git ls-files` shows anything under those paths or
   if `git check-ignore -q` fails for a probe file in each;
3. creates the key; 4. writes `private/baseline.json`: per-path HMAC of
   working-tree content for every tracked file and every non-ignored
   untracked file under `scope_paths` and `product_paths` (from
   `engagement.md`), plus HEAD and index state, plus `ignored_count` per
   path (git-ignored files are outside the observation and are reported as
   excluded coverage at sign-off);
5. writes knowledge templates if the seeded copies are absent.

**Publication** is only `evidence.mjs publish --run <id> --profile <p> --to
<destination>`; profiles: `redacted-report`, `full-report` (explicit),
`tracker` (title, class, priority, path, lines, `context_redacted`,
`fix_prompt`), `handoff` (case paths + `base_url` only), `case` (TC text
only). Each writes `export-manifest.json` `{source_manifest_sha256,
profile, profile_version, output_sha256}`. `check-export <export-manifest>
[--source <run dir>]` re-applies the profile to the source and byte-compares
(`VERIFIED-DERIVATIVE`) or, without the source, reports `LINKED-ONLY`.
`purge --engagement <id>` deletes private, ledger, runs, imports; the
consumer decides when.

### 6.10 Threat dispositions

`undisposed | planned(proposal_id | case_id with admission record) |
executed(observation_id) | ticketed(ticket_url, validated by
`ingest tracker-readback` showing the ticket body carries the threat id) |
accepted(register_id with subject == threat id and status accepted) |
mitigated(mitigation_id with a MITIGATION_CONFIRMED derived state)`.
`tm-lint check` validates each relationship, not mere existence.
`undisposed` and `planned` block `sign-off` only if `engagement.md`
`sign_off.require_dispositions: all`; default `executed-or-ticketed`.

## 7. Entry points and dependencies

| Ask | Command(s) | Needs installed |
|---|---|---|
| `engagement init` | `evidence.mjs engagement init` | `security-evidence` |
| `review --base <ref>` | `run init --kind review` → `scope` → reviewer packet → `gate` → `coverage` → `build-report --template review` | `security-evidence` + `secure-code-review` |
| `verify <finding> --base --head` | `verify.mjs all` | `security-evidence` + `secure-code-review` |
| `check`, `check-export`, `sign-off`, register commands | `evidence.mjs …`, `register.mjs …` | `security-evidence` |
| `threat-model` | `tm-lint` + threat-modeler | + `threat-modeling`, `threat-modeler` |
| `plan` | `plan.mjs` + threat-modeler | + `security-test-planning` |
| `assess` | all of the above | full bundle |

`sign-off --engagement <id>` reads `ledger/index.json` (authoritative run
inventory), requires ≥ 1 `COMMITTED` assessment run (`NO-ASSESSMENT` ⇒ exit
4), selects the latest by `seq`, and fails on: any `COMMITTED` run
`INCONSISTENT`/`STRUCTURE-ONLY` (`CONSISTENT-REDACTED-ONLY` is accepted for
`review`-kind runs and listed; it cannot occur for assessment runs); latest assessment not `CURRENT` at scope
level; register `CORRUPT`; `anchor verify` mismatch when `--expect` given;
dispositions per policy; tracked files under managed paths. It **lists**
(informational): incomplete runs, per-path working-tree changes since
baseline, unauthenticated approvals.

## 8. Guarantees and Not guaranteed

Guarantees are exactly the §2 left column, each with its script; the README
repeats them with the qualification "for runs carrying a `COMMITTED`
marker produced by the canonical pipeline". Not guaranteed: origin; model
reading; human approval; secrets outside the rule list; semantic
suppression; test meaningfulness; direct-run refusal by QA runners; threat
completeness; host-preloaded instruction files and direct agent reads;
attribution of tree changes; encryption of local artifacts; the core
context hooks installed by the installer are outside this bundle's control.

## 9. Hand-offs

### 9.1 Admission

`plan.mjs admit <case>` produces `admission.json` `{case_sha256,
classification: admitted-heuristic | admitted-reviewed | proposal, lint_hits,
assumptions: {base_url_host, account}, target_policy_sha256}`. The lint is
a heuristic over step text (allowed-operation grammar + forbidden-pattern
list); **unknown effects ⇒ proposal**. `admitted-reviewed` requires a
reviewer assertion receipt on the case packet. The claim is "admitted by
lint or by review", never "safe".

### 9.2 manual-qa

Admitted cases are written to a **dedicated suite** `tasks/security-<slug>-admitted/`
that contains only admitted `TC-*.md` files (the manual-qa lead globs the
suite directory it is given; a dedicated directory is what makes "only
admitted cases" true with today's lead). Format verbatim per manual-qa;
priority map p0→critical … p3→low; header/cookie checks via the audit
branch. Hand-off prompt (profile `handoff`):

```
Run as the active agent (claude --agent test-run-lead):
"Run the suite at tasks/security-<slug>-admitted/ against base_url=<url>."
```

Results via `ingest qa-run` become **observations** `{observation_id,
import_sha256, case_id, case_sha256 (from admission.json), result, run_id,
base_url, account?, head_oid?}`; unknown fields stay `unknown`. Mitigation
decisions are separate `mitigation-review` receipts citing observations.
M4 follow-up to manual-qa: an explicit-list intake branch (nice-to-have; the
dedicated suite does not depend on it).

### 9.3 test-automation

Prompt with `cases[{id,title,path}]` from the admitted suite, `slug`,
`base`. `ingest ta-report` records per unit: outcome, coverage record,
exclusions, findings, `recovery_basis`; `delivered` without a gate receipt
in the report ⇒ recorded as `delivered-unwitnessed`; partial coverage kept
per assertion; tests may be built before `VERIFIED`.

### 9.4 Proposals, feature-development, tracker

As v3 §9.4–§9.5, with tracker writes through `publish --profile tracker`
and read-back through `ingest tracker-readback`.

## 10. Files and manifests

Final `factory.json` `description`: "Threat-led, read-only security testing
team: code-derived STRIDE threat model, evidence-gated secure code review
with re-checkable citations, passive security cases for the manual-qa and
test-automation bundles, fix verification from a validated test-start
snapshot, and a residual-risk register." Other fields as v3 §10.
`FACTORY.md` `use_cases`: "Code-derived STRIDE threat model with file:line
citations"; "Evidence-gated secure code review whose citations anyone with
the repo can re-check"; "Passive security cases in manual-qa format,
proposals for active testing"; "Fix verification from a validated
test-start snapshot with a script-emitted verdict"; "Residual-risk register
with unauthenticated acceptance records and expiry". No catalog or manifest
text may say "exact checkout". **M1 `factory.json`**:
`localAgents: ["security-reviewer"]`, `localSkills: ["security-evidence",
"secure-code-review", "security-engagement"]` (engagement is prose; its
scripts are in `security-evidence`), one briefing. `FACTORY.md` frontmatter otherwise as v3 §10.
`instructions.md`: role-scoped as v3. `security-evidence/scripts/`:
`evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`, `plan.mjs`,
`normalize.mjs`, `redact.mjs`, `canon.mjs`, each with `*.test.mjs`.

## 11. Report structure

v3 §11 with: section 3 shows counts by priority × state, unresolved by
priority, rejected by reason, unlocated count, unauthenticated approvals,
incomplete runs; every displayed value is in the §6.3 derivation table;
`unknown / not assessed` allowed, blank forbidden.

## 12. Tests

Deterministic (`npm test`): v3 §12 plus the v3-review counterexamples:
scope identity independent of envelope; `run init` allocation before inputs;
two indicators with one ACK ⇒ `UNVERIFIED-SUPPRESSION(1 unacked)`;
indicator + deletion-only ⇒ deletion wins; valid `refound` + unavailable
tests ⇒ `UNVERIFIED-INDETERMINATE` **and** `regression-observed` event;
install modifying a tracked helper ⇒ `install-modified-tree`; non-secret
finding citing `password=1234` ⇒ keyed id, no plain hash anywhere in
publishable artifacts; replay with and without key; repeated `engagement
init` reuses the key, `--rotate` adds one; dirty tracked and untracked
baseline changes listed per path; same-path audit report replacement ⇒
different `import_sha256` when non-redacted content changed, and a
different `original_hmac` when only redacted-away content changed; extra TC placed in the admitted suite by hand ⇒
`sign-off` lists it as unadmitted (suite hash vs admissions); interrupted
append ⇒ rebuild; truncated log + projection vs `anchor verify` ⇒
`TRUNCATED`; `side: base` citation passes integrity; assessment on dirty
tree refused; supersede without equivalence or transfer rejected;
`check-export` `VERIFIED-DERIVATIVE` and `LINKED-ONLY`.

Installed end-to-end (`npm test`, temp dir, no network): `SDLC_SKILLS_CACHE_DIR`
points at a temp cache in which each external the M1 roster names
(`systematic-debugging`) is pre-populated as a git clone whose `origin`
remote is a **local bare fixture repository**, so the installer's `git
fetch origin <ref>` resolves to a file path and never reaches the network;
`memory`, `knowledge-curation`, `verifying-outcomes` are monorepo skills and
`issue-tracking` resolves to the feature-development bundle copy via the
item index. The test asserts no `https://` fetch by running with
`GIT_CONFIG_GLOBAL` pointing at a config that rewrites `https://github.com/`
to an unreachable local path. (a) full bundle: `engagement init →
run init --kind assessment → scope → ingest sarif → gate → coverage →
packet/receipt → build-report --template assessment → check → verify all
(fixture repo) → register → sign-off` with `require_dispositions: none`,
expecting exit 0. (b) two-skill install: `engagement init → run init --kind
review → … → build-report --template review → check → verify all →
sign-off`, expecting `sign-off` exit 4 `NO-ASSESSMENT` (a review path never
produces an assessment run) and no `UNGATED` banner. Additional fixtures:
manual-qa run report in its real Markdown format through `ingest qa-run`;
positive tests + `indeterminate` fix-review ⇒
`UNVERIFIED-INDETERMINATE(fix-review)`; changed ignored product file ⇒
listed as excluded coverage, not as a change; dirty review snapshot of a
file containing `password=1234` ⇒ snapshot bytes redacted, HMAC present,
no original bytes anywhere under `.agents/security-testing/`; then the
working file is changed and `check --integrity` with the key ⇒
`CONSISTENT-REDACTED-ONLY(1)` and `sign-off` still passes for that
review run.

Model evals: frozen harness as v3.

## 13. Plan

| # | Milestone | Capability |
|---|---|---|
| M-1 | Doc PR (`bundles/`, config example, validate command) | correct docs |
| M1 | `security-evidence` complete (all scripts, schemas, templates, tests, both E2E paths), `secure-code-review`, `security-engagement`, `security-reviewer`, M1 manifest | `engagement init`, `review`, `verify`, `check`, register, `sign-off` (with `require_dispositions: none` until M2) |
| M2 | `threat-modeling` + `threat-modeler` | `threat-model`, dispositions |
| M3 | `security-lead`, `security-test-planning`, `risk-register` (prose), final manifest | `assess`, `plan`, hand-offs |
| M4 | Follow-up PRs (manual-qa Step 0 row + explicit-list branch proposal; feature-development pointer; `execution-authorization` design note) | receiving bundles aware |
| M5 | Docs, smoke (four targets + two-skill), dogfood, probe result | shippable v1 |

## 14. Open questions

Hook-input identity (v2 hooks); threat-model completeness measure; whether
consumers keep the manifest digest and register anchor outside the repo;
LINDDUN licence; `execution-authorization` ownership.

## 15. Consistency check against §2

Each §2 left-column row names its script in §6/§7; each right-column row
appears in §8. Any later sentence that exceeds §2 is a defect.

## 16. Repo facts relied on that the reviewer should re-verify

manual-qa lead globs `TC-*.md` in the given suite folder (§9.2 dedicated
suite); standalone `--skills` installs neither seeds nor instructions (D12);
core hooks install regardless of `targets` (D4); `memory` and
`knowledge-curation` are top-level skills (§12).

## 17. v3 findings → v4

| F | Resolution | Where |
|---|---|---|
| F1 cycles, run allocation | **resolved**: envelope/payload split, identity = payload hash, `run init` first, preimage table | §6.1 |
| F2 re-derivation incomplete | **resolved**: closed required-inputs per template, derivation table, `INCOMPLETE` | §6.3 |
| F3 secret via non-secret fingerprint | **resolved**: identity by content sensitivity, keyed when any rule matches | §6.5 |
| F4 replay across redaction/key | **resolved**: private citation record written before discard; `STRUCTURE-ONLY` without key; key ids, `O_EXCL`, rotation | §6.5, §6.3 |
| F5 tested bytes | **resolved by narrowing + contract**: post-install tree comparison; `tested_tree` in verdict; executable hash; promise reworded | §2, §6.4 |
| F6 multi-indicator, regression masked | **resolved**: indicator set, per-indicator ACK, deletion never waivable, `regression-observed` independent of completeness | §6.4 |
| F7 receipt contradiction, packet | **resolved** (v5 closes R1: `VERIFIED` requires an applied `not-refound`) | §4, §6.4 |
| F8 `confirm` | **removed**: no confirm; all approvals `authenticated: false`; one bucket | D15, §6.8 |
| F9 supersede exposure, recovery, anchor, aliases | **resolved**: equivalence or transfer, rebuild vs corrupt rule, `anchor verify`, alias log | §6.8 |
| F10 first-write, check-ignore, publication, retention | **resolved**: init fails closed, exact patterns, `publish` only path, `purge` | §6.9 |
| F11 baseline, inventory | **resolved** (v5 closes R3: §2 narrowed to non-ignored untracked; ignored count reported) | §2, §6.9, §7 |
| F12 admission vs lead glob | **resolved**: admission record, unknown ⇒ proposal, dedicated admitted suite | §9.1–§9.2 |
| F13 adapters, targets, SARIF matrix | **resolved** (v5 closes R4: `ingest qa-run` consumes the real Markdown report) | §6.6–§6.7 |
| F14 import identity, TA recovery | **resolved**: import snapshots + locators, `delivered-unwitnessed`, case hash from admission | §6.6, §9.2–§9.3 |
| F15 `tested` by existence | **resolved**: `executed(observation)` vs `planned`, relationship validation, sign-off policy | §6.10 |
| F16 standalone/M1 impossible | **resolved**: all scripts in `security-evidence`; init writes templates; M1 includes register; two E2E paths | D1, D12, §7, §10, §12–13 |
| F17 fixtures | **resolved**: listed | §12 |
| F18 wording | **resolved** (v5 closes R5: catalog and manifest wording rewritten) | D4, §6.3, §8, §10 |
| F19 base citations, dirty scope, scope drift | **resolved**: side-aware resolution, clean-tree assessment, private snapshot for review, scope-level drift | D18, §6.2, §6.3 |
| F20 publication, trusted digest, export check | **resolved**: `COMMITTED` marker, incomplete runs, recomputed digest, `check-export` | §6.1, §6.3, §6.9 |

## 18. v4 findings → v5

| R | Resolution | Where |
|---|---|---|
| R1 indeterminate review reaches `VERIFIED` | **resolved**: `VERIFIED` requires an applied `not-refound`; absent/unapplied/indeterminate ⇒ `UNVERIFIED-INDETERMINATE(fix-review)`; fixture | §6.4, §12 |
| R2 original bytes under `private/` and in imports | **resolved by contract**: snapshots and imports persist redacted bytes + HMAC of originals; §2 now says "including under `private/`"; order read → HMAC → redact → persist | §2, §6.2, §6.6 |
| R3 baseline excludes ignored untracked files | **resolved by narrowing**: §2 promises non-ignored untracked; `ignored_count` recorded and reported | §2, §6.9 |
| R4 manual-qa report is Markdown | **resolved**: adapter consumes `reports/RUN-*.md` per `test-run-report-format.md`; fixture | §6.6, §12 |
| R5 inherited "exact checkout" wording | **resolved**: `factory.json` description and `FACTORY.md` use_cases written out; no catalog text may say "exact checkout" | §10 |
| minors | transitive inputs listed; replay wording corrected; multiple ACK receipts exempted; sensitive indicator ids keyed; external fixtures provisioned in the E2E; E2E sign-off expectations stated; §15 word-absence claim removed | §6.3, §6.4, §6.5, §12, §15 |

## 19. v5 findings → v6

| Finding | Resolution | Where |
|---|---|---|
| N1 historical replay of redacted dirty snapshots | **resolved by contract**: third integrity result `CONSISTENT-REDACTED-ONLY` for `snapshot` citations whose original is gone; §2 states the limit; sign-off accepts it for review runs; assessment runs cannot have snapshot citations; four-step fixture | §2, §6.2, §6.3, §6.5, §7, §12 |
| M1 evaluator precedence vs fixture | **resolved**: precedence stated (`refound_observed` first, completeness second) | §6.4 |
| M2 offline external cache | **resolved**: local bare fixture remotes via `SDLC_SKILLS_CACHE_DIR`; network rewrite guard | §12 |
| M3 transitive input closure | **resolved**: closure rule; `verify` and `threat-model` inputs extended | §6.3 |
| M4 replacement-import fixture | **resolved**: distinguishes `import_sha256` vs `original_hmac` changes | §12 |

# Adversarial review of the security-testing bundle spec (v3)

**Reviewer:** OpenAI Codex, model `gpt-6-astra`, reasoning effort `medium`, read-only
**Date:** 2026-09-15
**Subject:** [`specs/2026-09-14-security-testing-bundle-design.md`](../specs/2026-09-14-security-testing-bundle-design.md) v3 at commit 028fab1
**Prior reviews:** [v1](2026-09-14-security-testing-spec-adversarial-review-codex.md), [v2 A](2026-09-14-security-testing-spec-v2-adversarial-review-codex.md), [v2 B](2026-09-14-security-testing-spec-v2-adversarial-review-codex-2.md)
**Codex session:** 01a0a509-4c51-79d2-bec5-3f9543fd813b

---

# Verdict: rework

V3 still contains contradictions that prevent an implementer from delivering its stated guarantees. The main failures are circular artifact identities, incomplete re-derivation, a remaining secret-digest leak, mutable test snapshots, and installation paths that cannot run the promised workflow.

This is a **design review**, not an implementation certification. I read v3, all three prior reviews, and checked the requested repository sources. No files were modified; I did not run installers or tests that create files.

## Repository verification

The following v3 claims match the actual repository:

- The installer and resolver use `bundles/`; `CLAUDE.md` and `bundles/SPEC.md` retain stale `factories/` instructions.
- Empty `agents` is permitted when `localAgents` is nonempty. Declared content must exist. See [validator](`bin/validate-factories.mjs:201`).
- Runtime memory defaults include `RULES.md`; the example omits it.
- Factory `targets` controls factory hooks, not content installation.
- `npm run validate` includes factories, marketplaces, external checks, and duplicates.
- Manual-QA uses `PASS | FAIL | BLOCKED`, snapshot verification, and screenshots outside `reports/security/`.
- TA accepts partial delivery with exclusions, and findings are independent of delivery outcome.

Important qualifications:

- Standalone skill selection does **not** apply factory seeds or instructions. [Installer](`bin/init.mjs:2862`).
- Omitting factory hooks does **not** prevent installation of core hooks. [Installer](`bin/init.mjs:2835`).
- Manual-QA’s execution procedure still discovers all cases in a suite using `Glob`. It has no explicit-list-only branch. [Manual lead](`bundles/manual-qa/agents/test-run-lead/AGENT.md:72`).
- A recovered TA report may mark a merged case `delivered` without a witnessed gate receipt. [TA playbook](`bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md`).

## 1. Disposition of every v2 finding

**Resolved** means the design closes the original issue. **Relabeled** means v3 explicitly withdraws or narrows the guarantee. **Open** means a material part remains, even if other parts improved. F-numbers refer to findings below.

### Review A

| Finding | Disposition | Assessment |
|---|---|---|
| A1 | **Relabeled** | Forgery detection becomes unauthenticated consistency. Appropriate narrowing; completeness of consistency checking remains F2. |
| A2 | **Open** | ACK no longer bypasses failed tests, but multiple indicators and regression precedence remain defective. F6. |
| A3 | **Open** | Detached checkout and whole-diff suppression help; installation can alter tested bytes, and receipt inputs remain underspecified. F5, F7. |
| A4 | **Open** | Non-secret findings can still hash secret-bearing snippets; redacted replay is incomplete. F3–F4. |
| A5 | **Open** | Proposal placement is fixed and direct execution refusal is disclaimed. Admission and the receiving lead’s discovery contract remain incompatible. F12. |
| A6 | **Open** | The empty-agent validation failure is resolved. M1’s promised dependencies and E2E capability are not. F16. |
| A7 | **Open** | `scope_id` remains self-referential; allocation, publication, and historical checking remain incomplete. F1, F19–F20. |
| A8 | **Open** | Inclusive ranges, horizontal normalization, contextual citations, and occurrence derivation are improved. Snapshot-side and dirty-input semantics remain open. F19. |
| A9 | **Open** | Mitigation and vulnerability states are separated, but receipt-authoring rules contradict their use; finding aliases remain incomplete. F7, F9. |
| A10 | **Open** | Wrapping is correctly downgraded to presentation. Adapter coverage and validation boundaries remain incomplete. F13. |
| A11 | **Open** | Located/unlocated split helps; missing-field handling and complete mapping remain unspecified. F13. |
| A12 | **Open** | Unverified approval is acknowledged, then `confirm` restores an unsupported confirmed state. F8. |
| A13 | **Open** | Replayable payloads and transitions improve; crash recovery, anchor checking, and exposure-preserving supersession remain incomplete. F9. |
| A14 | **Open** | Inventory improves; first-write protection and destination/export enforcement remain incomplete. F10, F20. |
| A15 | **Resolved** | Role-scoped shared instructions and a narrow `.gitignore` write exception close the original issue. |
| A16 | **Open** | Report order and field lists improve; complete input binding and re-derivation remain missing. F2. |
| A17 | **Open** | Observation-versus-decision semantics are corrected; imported evidence identity remains inadequate. F14. |
| A18 | **Open** | A sign-off command now exists; baseline observation and inventory/failure semantics remain incomplete. F11. |
| A19 | **Open** | The dependency table contradicts the advertised two-skill workflow and installed E2E. F16. |
| A20 | **Resolved** | Actual runtime defaults are cited correctly; the example correction is assigned to M-1. |
| A21 | **Open** | Negative tests improve, but the E2E is infeasible as specified and misses decisive combinations. F17. |

### Review B

| Finding | Disposition | Assessment |
|---|---|---|
| B1 | **Relabeled** | Origin authentication is withdrawn; coherent forgery is explicitly accepted as unauthenticated consistency. |
| B2 | **Open** | Simple ACK bypass fixed; multiple indicators and masked regressions remain. F6. |
| B3 | **Open** | Separate receipt types exist, but producer rules, reviewed-input serialization, and transitions remain incomplete. F7. |
| B4 | **Open** | Checkout isolation improves; exact tested bytes and execution-policy binding remain incomplete. F5. |
| B5 | **Open** | Draft discovery is addressed by proposal placement; passive admission and receiving-list enforcement remain open. F12. |
| B6 | **Open** | Secret-class identity improves, but secret-bearing non-secret fingerprints and replay remain broken. F3–F4. |
| B7 | **Open** | More adapters exist; audit/QA/TA/read-back contracts and reference validation remain incomplete. F13–F14. |
| B8 | **Open** | Hash cycles, incomplete graph, historical side handling, publication, and derivative checks remain. F1–F2, F19–F20. |
| B9 | **Open** | Located/unlocated separation resolves one contradiction; mapping and fallback rules remain incomplete. F13. |
| B10 | **Resolved** | Primary ranges must be admitted; contextual expansion is explicit; priority is preserved; exact coverage accounting is specified. Enforcement completeness is F2. |
| B11 | **Resolved** | Horizontal normalization, inclusive length, exact-byte HMAC, derived occurrence, and narrowed stability claims address the original design defects. |
| B12 | **Resolved** | M1 now declares one real agent and matching briefing. Its capability/dependency failure is separately B13/F16. |
| B13 | **Open** | M1 still lacks register execution; standalone initialization still requires an uninstalled skill. F16. |
| B14 | **Open** | Sign-off is named, but baseline and complete inventory semantics remain insufficient. F11. |
| B15 | **Open** | `confirmed: false` is undermined by unauthenticated `confirm`. F8. |
| B16 | **Open** | Supersession can still retire unrelated exposure; replay recovery and anchor consumption remain unspecified. F9. |
| B17 | **Open** | Downstream artifacts are explicitly excluded—a narrowing—but first-write, disclosure, and retention requirements remain incomplete. F10. |
| B18 | **Open** | PASS semantics, header routing, partial coverage, and test-before-verification are corrected. Evidence binding and recovery provenance remain open. F14. |
| B19 | **Open** | Coverage order and required fields improve; report input closure remains unspecified. F2. |
| B20 | **Open** | Existence checks improve; `tested` still requires only a case file, and accepted/ticketed references lack sufficient relationship checks. F15. |
| B21 | **Resolved** | Defaults, hook-target meaning, and validation commands now cite executable sources accurately. |
| B22 | **Open** | Better fixture list, but impossible standalone E2E and missing cross-component cases remain. F17. |

## 2. Findings

### F1 — Blocker — §6 preamble; §6.1 “Canonical bytes, ids”; §6.2 step 1

**Wrong:** The supposed DAG still contains cycles.

Every JSON artifact carries `scope_id`. `scope_id` hashes `scope.json`, excluding only `self_sha256`. Therefore `scope.json` must contain its own hash while being hashed.

Additionally, `build-report` allocates `run_id`, but its preexisting scope, findings, coverage, and receipts must already carry matching run IDs. Rewriting those inputs after allocation changes their hashes—and the scope identity.

**Concrete fix:** Introduce `run init` before any run artifact. Define a scope payload whose identity excludes `scope_id`, `self_sha256`, and run-specific envelope fields. Publish explicit hash preimages and dependency order, including event, receipt, manifest, and export envelopes. Specify duplicate-key rejection and canonical number/key ordering.

### F2 — Major — §2 first promise; D2–D3; §6.2; §11

**Wrong:** `check` promises more re-derivation than its algorithm specifies.

It explicitly re-runs `gate` and rendering. It does not explicitly recompute:

- Coverage accounting and counts from declarations.
- Receipt-derived finding and mitigation states.
- Verification verdicts from validated check records.
- Register projections/deltas from events.
- Rejection and unlocated-candidate totals.

Hashing a supplied incorrect count and rendering it consistently does not make that count internally valid.

The report input graph also lacks a complete manifest contract for engagement policy, observation records, ingestion rejects, unlocated candidates, verification history, and register events. Several required assessment inputs remain optional CLI inputs.

**Concrete fix:** Define required inputs per template and a pure derivation graph. `check` must validate and recompute every derived field it displays. Missing assessment inputs must produce an explicit incomplete result, not an optional empty section.

### F3 — Blocker — §6.1 fingerprint; D16; §6.4

**Wrong:** Non-secret finding fingerprints retain the secret-digest vulnerability.

A finding classified as injection or authorization can cite a range containing `password=1234`. Section 6.4 redacts its displayed snippet, but §6.1 still defines its fingerprint as plain SHA-256 over the normalized snippet plus known fields.

An observer who knows the surrounding code can enumerate the password and compare fingerprints. Changing the finding’s class does not change whether its evidence contains a secret.

The categorical sentence “no offline oracle exists” therefore fails.

**Concrete fix:** Base identity selection on **sensitive content presence**, not finding class. Use keyed identities or opaque IDs whenever any identity input contains protected content. Define whether public fingerprints use a redacted structural representation. Test a non-secret-class finding containing a short credential.

### F4 — Major — §6.2 integrity; §6.4 redaction and `KEY-UNAVAILABLE`

**Wrong:** The two evidence layers still lack a replayable comparison contract.

Ingest redacts before persistence. Later `gate` is supposed to compare unredacted claimed text with source. The original claimed text may no longer exist. Reading source again and hashing it proves source identity, but does not establish that the original submitted snippet matched.

`KEY-UNAVAILABLE` also conflicts with “still verify manifest consistency and re-render”: full `check` re-runs a gate that produces keyed identities and validates keyed evidence. The available result is necessarily weaker.

Key reuse, rotation, loss, and repeated `engagement init` are unspecified. Regenerating a key changes secret IDs and invalidates historical HMACs.

**Concrete fix:** Specify an ingest-time private comparison receipt binding the submitted claim, source range, side/OID, and redaction version before the original is discarded. Define separate structural-consistency and content-integrity results. Make key creation exclusive/idempotent, include a key identifier, and define rotation/history behavior.

### F5 — Blocker — §2 exact-checkout promise; §6.3 steps 2, 4, 5, 7; §8

**Wrong:** A detached worktree establishes an initial checkout, not the bytes actually tested.

Dependency installation happens afterward and can modify tracked source, test helpers, or configuration. No pre-test cleanliness/content comparison is required. The recorded Git tree hash still names the original commit.

Concrete counterexample: an allowed installation lifecycle script rewrites a test helper to pass. Tests pass against modified bytes; the reviewer receives the same modified worktree; the verdict names `head_oid`.

Recording “every” ecosystem configuration file is also undefined: the named list does not define dynamically imported configuration, external tools, dependencies, or generated files. The verdict record does not explicitly bind the promised environment policy or resolved executable.

**Concrete fix:** Define and verify the **test-start snapshot** after installation. Reject tracked changes or record a separate derived snapshot and stop claiming exact `head_oid`. Specify generated/dependency inputs, executable/runtime identity, submodule policy, and before/after observations. Bind the immutable execution-policy record to command, head, environment, and permitted effects. Describe repository tests as executing from a validated starting snapshot, unless stronger isolation is actually provided.

### F6 — Major — D17; §6.3 suppression and evaluation; §16 A2/B2

**Wrong:** The single-indicator representation cannot express the suppression result of a whole diff.

A diff can contain two indicators, or an indicator plus deletion-only removal. The result is modeled as one of `INDICATOR(x)` or `RANGE-DELETED-ONLY`. No aggregation rule prevents one selected indicator and one ACK from hiding the others.

Regression handling also remains wrong: the first rule returns indeterminate if any check is unavailable. A valid `REFOUND` receipt plus unavailable tests leaves a previously fixed row `fixed`. Section 16’s claim that regression is computed “before other rules” is false.

**Concrete fix:** Return a set of uniquely identified indicators plus an independent deletion flag. Require an exact matching ACK for each waivable indicator; never waive deletion-only. Compute the security observation “re-found” separately from overall verification completeness, preserving regression even when another check is indeterminate.

### F7 — Major — §4 reviewer row and rule 3; §6.3 receipt schema/state machines

**Wrong:** Receipt production is contradictory.

The reviewer must write receipts but “never writes states or verdicts”; rule 3 also prohibits any receipt verdict consumed as a state. Yet reviewer-written verdicts are exactly what drives receipt application.

`reviewed_hmac` has no canonical input manifest: a reviewer may receive multiple files, findings, policies, and observations. “Exact bytes the reviewer was given” does not define ordering, paths, boundaries, or required contents.

The arrow notation also does not say whether `CITATION_FAILED` or `REVIEW_REFUTED` can advance to fix verification.

**Concrete fix:** Permit agents to write explicitly labeled **review assertions**; reserve derived/public verdicts for scripts. Define a content-addressed review packet and hash its canonical inventory. Provide a transition table with prerequisites, duplicate/contradictory receipt rules, and fail-closed behavior for invalid prior states.

### F8 — Major — D15; §2 approval promise; §6.7 `confirm`; §8

**Wrong:** `register.mjs confirm` reintroduces the approval overclaim.

It flips `confirmed: true` while explicitly admitting it cannot tell who invoked it. That contradicts “Nothing an agent can write turns a proposed acceptance into a confirmed one” and “approvals stored unconfirmed.”

It is also unclear whether confirmed acceptances now reduce open exposure. False-positive closures and suppression ACKs can affect decisions without the same clearly defined reporting treatment.

**Concrete fix:** Remove `confirm` in v1, or rename the field to an explicitly unauthenticated operator assertion. If genuine confirmation is supported, define a separately trusted verifier and exact signed/verified payload. Report authenticity consistently across acceptance, false-positive closure, ACK, and execution authorization.

### F9 — Major — §6.7 event log, transitions, anchor; §6.1 supersession

**Wrong:** Replay integrity does not yet preserve risk exposure.

`supersede --by` only checks existence, inequality, and cycles. An open p0 can be superseded by an unrelated fixed p3. No rule transfers or preserves unresolved exposure.

The append/rebuild sequence has a crash gap: after append but before projection replacement, every command detects mismatch and exits. There is no defined recovery path distinguishing an interrupted projection write from corruption.

`anchor` only prints a digest; the consuming verification command, sequence binding, and truncation-check protocol are unspecified. Finding fingerprint aliases are still conflated with register-row supersession.

**Concrete fix:** Require explicit subject equivalence or exposure transfer for supersession; preserve unresolved priority/status until independently resolved. Separate finding aliases from row replacement. Define durable append recovery and anchor verification using engagement, sequence, and chain digest.

### F10 — Major — D13; §6.8 inventory and managed `.gitignore`; §7 sign-off

**Wrong:** “Local by default” is not reliably established before persistence.

Initialization only warns for tracked local paths unless `--strict`. The workflow can therefore write sensitive artifacts into tracked files and discover the problem at sign-off.

No `git check-ignore` validation ensures the managed block actually wins against nested rules or negations. The block’s exact patterns and idempotent update rules are missing.

Disclosure profiles also describe fields without defining a required checked publication path. Human-pasted hand-off prompts have no explicit profile in the inventory despite D13 requiring one. Retention/deletion remains unspecified.

**Concrete fix:** Fail initialization before engagement writes when private destinations are tracked or not effectively ignored. Specify exact managed patterns and verify representative destinations. Require every publication path—including tracker payloads and hand-off prompts—to consume a validated profile output. Define retention and cleanup responsibilities.

### F11 — Major — §2 baseline-observation promise; §6.8 baseline; §7 sign-off

**Wrong:** The baseline cannot support the promised observations.

`git ls-files -s` records index entries, not working-tree bytes or untracked files. Its single HMAC cannot identify which paths changed.

A dirty tracked file can be altered without changing the index; the baseline value remains identical. Untracked product files are absent altogether.

Sign-off also has no authoritative report inventory or deterministic “latest assessment” selection. Omitting a report from discovery could avoid its failure. Empty/no-assessment behavior is not specified.

**Concrete fix:** Capture a private per-path baseline covering HEAD, index, working-tree content, and relevant untracked paths. Compare it at sign-off and report observable changes without attribution. Maintain a validated run inventory and require the expected assessment artifacts. Define absent, unreadable, empty-scope, and incomplete-run failure states.

### F12 — Major — §9.1 passive admission; §9.2 manual-QA prompt; §13 M4

**Wrong:** Admission remains a heuristic, but the downstream mechanism is described more strongly.

The linter recognizes step wording, not effects. A benign-looking navigation or form submission can trigger an unsafe endpoint. There is no fail-closed state for unknown effects, nor a defined admission record binding case bytes, target/account assumptions, and the evidence for the effect classification.

More concretely, the receiving manual-QA lead names cases as an intake route but then instructs itself to `Glob` the suite. A folder containing two admitted cases and one other TC has no explicit list-only protection. M4’s proposed Step 0 row does not specify replacing Step 1 discovery.

**Concrete fix:** Label admission as reviewed/heuristic unless effects are independently established; unknown effects become proposals. Bind admission to complete case contents and target assumptions. Add an explicit-list intake branch to manual-QA that never expands discovery, or generate a dedicated suite containing only admitted cases and pass that suite.

### F13 — Major — D5; §6.5 adapters; §6.6 SARIF; §9.2 audit ingest

**Wrong:** The adapter contract remains incomplete.

- `ingest audit` is used later but absent from the adapter table.
- Tracker read-back, manual run results, and TA reports have no complete adapter/schema contract.
- Ticket URLs, labels, and state are called “trusted fields extracted” without defining validation or permitted authority.
- Scope is described as source paths/ranges; it does not define authorization for tracker URLs, browser targets, or external references.
- SARIF reads `ruleIndex` and default rule levels but does not define their relationship to missing/conflicting result fields.
- Missing end lines/snippets, unknown levels, malformed regions, and in-repo but out-of-scope candidates lack a closed handling table.

**Concrete fix:** Define adapters for every consumed external artifact, with structural validation separate from trust. Add destination/target policy distinct from source scope. Publish a complete SARIF fallback/rejection matrix and preserve unresolved counts without silently promoting missing data to low priority.

### F14 — Major — §9.2 observations/audit identity; §9.3 TA consumption

**Wrong:** Observation-versus-decision is corrected, but observation identity is still weak.

The audit locator hashes **report path + title + URL**, not report content. Replacing the report at the same path with the same title and URL produces the same identity for different evidence.

Manual-QA observations name a case hash but do not specify when it is captured. The receiving lead can normalize IDs and size cases before execution. The standard runner result lacks the proposed account, code version, and case-byte binding.

TA reports can be overwritten at the same slug, and recovered `delivered` rows may rely on merge evidence rather than witnessed tests. Reading outcome and coverage alone does not preserve that distinction.

**Concrete fix:** Snapshot imported evidence immutably and bind it to source artifact digest, record locator, run, target, and case version actually executed. Preserve unknown fields as unknown. For TA, retain recovery basis, gate evidence, code revision, and per-assertion exclusions; never infer test execution from `delivered` alone.

### F15 — Major — §6.9 threat dispositions; §7 sign-off

**Wrong:** `tested(case_ref)` can be satisfied by an unexecuted case file.

The linter checks that the case exists and names the threat. It does not require an execution observation. This lets planned work receive the stronger `tested` label.

Likewise, an existing register row need not refer to the same threat or carry the relevant acceptance status. Ticket validation is not defined beyond a URL. An existing but unrelated artifact can dispose of a threat and unblock sign-off.

**Concrete fix:** Separate `case-planned` from `executed(observation_ref)`. Validate subject relationships, referenced states, acceptance validity, and mitigation receipt bindings. Treat unavailable external verification as unresolved. Existence alone must not establish the claimed disposition.

### F16 — Major — D12; §7 dependency matrix; §10 M1 manifest; §§12–13

**Wrong:** The installed workflows are still impossible as specified.

The two-skill install contains `secure-code-review` and `security-evidence`. Initialization lives in `security-engagement`. Factory seed knowledge and instructions are not installed by standalone skill selection.

Yet §12 requires that two-skill installation to run initialization, register transition, and sign-off. Its own dependency matrix says those need additional skills/full bundle.

M1 advertises verification and the full installed E2E before `risk-register` ships in M2. M1 also lacks the full roster required by its sign-off dependency row.

**Concrete fix:** Either move minimal initialization and required runtime primitives into `security-evidence`, or expand installation recipes. Publish separate E2E paths per supported dependency set. Move register implementation into M1 or narrow M1 to review/build/check and defer the complete workflow.

### F17 — Major — §12 tests; §13 milestone validation

**Wrong:** The tests still allow implementations with the above failures.

Missing decisive fixtures include:

- Self-referential scope identity and run allocation.
- Two indicators with only one ACK; indicator plus deletion-only.
- `REF0UND`/`REFOUND` receipt correctness and valid `REFOUND` plus unavailable tests.
- Installation modifying a tracked test helper.
- Non-secret-class finding containing a credential.
- Redacted replay with and without the key; repeated initialization.
- Dirty/untracked baseline changes.
- Same-path audit replacement.
- Admitted-list hand-off with an extra TC in the suite.
- Log append interrupted before projection replacement.
- Consistent log-and-projection truncation against an external anchor.

The installed test also lacks explicit offline handling for external skill dependencies. “No network” needs a controlled cache/fixture resolver, not reliance on an already populated developer cache.

**Concrete fix:** Add these negative fixtures and a dependency-correct installed test matrix using only installed paths, controlled external fixtures, and no access to source-tree siblings.

### F18 — Minor — D4; §6.2 drift sentence; §8; §15

**Wrong:** Several absolute statements remain misleading:

- “No hooks in v1” is only true of **bundle-specific** hooks; the installer still installs core hooks.
- “Drift never fails sign-off” is immediately contradicted by the latest assessment requiring `CURRENT`.
- “No agent-supplied states” and public verdicts “only” from scripts need the same canonical-pipeline qualification as §2.
- “Human-written argv” cannot be a script-enforced property under the stated unauthenticated-approval model.

**Concrete fix:** Say “no bundle-specific enforcement hooks,” distinguish historical from latest-report drift, and qualify all enforcement claims as properties of validated canonical outputs. Describe argv as recorded operator-supplied configuration whose authorship is unverified.

### F19 — Major — §6.1 deleted citations; §6.2 integrity/drift; inherited scope behavior

**Wrong:** Snapshot checking contradicts citation semantics.

Section 6.1 permits `side: base` for deleted code, but §6.2 revalidates **every** citation against `head_oid`. A valid deletion finding therefore fails historical integrity.

V3 also does not clearly replace v2’s dirty/untracked scope behavior. If retained, those bytes cannot be reconstructed from `head_oid`; if removed, the scope contract must say so.

Drift is measured only over citations. A new in-scope file or changed uncited reviewed range can leave the latest assessment labeled `CURRENT`.

**Concrete fix:** Resolve each citation against its declared side/OID. Explicitly reject dirty/untracked assessment input or persist a reconstructible private snapshot. Distinguish citation drift from assessment-scope drift, and use the appropriate scope-level result at sign-off.

### F20 — Major — §6.2 manifest publication/trusted digest; §6.8 export manifest

**Wrong:** Publication and export verification remain incomplete.

Two tmp+rename operations are not a transaction across report, manifest, digest file, and inventory. Crash/retry behavior and immutable run-directory publication are unspecified.

The trusted-digest branch is worded as comparing against `manifest.sha256`; it must compare against the digest **recomputed from the actual manifest**, not merely its editable sidecar.

Exports link a source manifest, profile, and output hash, but there is no derivative-check protocol. A recipient may lack the source ledger/key, and the report footer’s normal manifest resolution may point to private paths. Binding an arbitrary output hash does not prove the profile transformation was applied.

**Concrete fix:** Publish immutable completed run directories with a clear commit marker and recovery protocol. Recompute trusted-digest comparisons. Define `check-export`, transformation/version binding, recipient-visible assurance levels, and whether the derivative is independently verifiable or merely linked to unavailable private evidence.

## 3. Section 2 promise audit

| Section 2 promise | Later contradiction or missing delivery |
|---|---|
| Internal consistency and complete re-derivation | Circular scope/run identity; only gate/render explicitly recomputed; incomplete report input graph. **F1–F2** |
| Recorded-snapshot integrity and current-tree drift | Base citations checked at head; dirty snapshot policy undefined; citation-only drift is narrower than assessment currency. **F19** |
| Exact clean checkout; command/environment/tree binding | Installation can alter tracked inputs; no required test-start validation; environment binding incomplete. **F5** |
| Pattern-bounded redaction before persistence; no secret digests | Plain non-secret fingerprint may include secrets; ingest-to-gate comparison is not replayable. **F3–F4** |
| Only admitted cases handed to QA | No complete admission artifact; receiving manual lead expands suite discovery. Direct-run refusal is appropriately disclaimed. **F12** |
| Approvals reported recorded/unverified | `confirm` flips the model to confirmed; “human-written argv” remains claimed. **F8, F18** |
| Baseline-to-final observations | Baseline captures an index hash, not working-tree/untracked state or per-path observations. **F11** |

The narrowed origin claim is coherent. So are the disclaimers about model reading, semantic completeness, arbitrary test safety, and universal secret detection. Those disclaimers do **not** repair failures in the narrower script guarantees above.

## Ranked top five

1. **F1–F2: Make artifact identity and re-derivation implementable.** Remove cycles; define complete inputs and deterministic derivations.
2. **F3–F4: Close the secret fingerprint leak and define replay across redaction/key availability.**
3. **F5–F7: Bind verification to actual test-start bytes and complete multi-indicator/receipt semantics.**
4. **F8–F11: Prevent unsupported confirmation, disappearing exposure, and false baseline/confidentiality assurances.**
5. **F12, F16–F17: Make receiving hand-offs and installed milestone tests match actual repository contracts.**

## What would make it approvable

A revised spec must resolve **F1–F20**, either with concrete contracts or explicit capability removal. In particular, it needs:

- An acyclic artifact schema and complete checker derivation table.
- A secret-safe identity/replay model.
- A bounded, accurate test-snapshot guarantee and exhaustive verification rules.
- Consistent approval, register, disclosure, and sign-off semantics.
- Dependency-correct install recipes and an explicit-list-compatible QA hand-off.
- Acceptance fixtures covering the counterexamples above.

**Overall verdict: rework.** Section 16 currently records changes made; it does not establish that the prior findings are closed.

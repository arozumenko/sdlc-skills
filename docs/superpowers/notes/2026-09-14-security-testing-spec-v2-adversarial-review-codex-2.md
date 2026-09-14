# Adversarial review of the security-testing bundle spec (v2) — second sample

**Reviewer:** OpenAI Codex, model `gpt-6-astra`, reasoning effort `medium`, read-only
**Date:** 2026-09-14
**Subject:** [`specs/2026-09-14-security-testing-bundle-design.md`](../specs/2026-09-14-security-testing-bundle-design.md) v2 at commit 9201e6b
**Sibling review:** [first sample](2026-09-14-security-testing-spec-v2-adversarial-review-codex.md), same model and effort, independent session
**Codex session:** 01a0a082-5ebf-7d43-a91b-9d25e3ce714b

Two independent runs of the same prompt. Both return rework; both name the suppression-ACK bypass in the verdict table, tests not proven to run at head, the draft execution path, secret/redaction versus citation integrity, forgery detection overclaim, and the agentless M0+M1 as blockers.

---

**Overall verdict: rework.** V2 fixes several interface mistakes, but still permits false verification, unauthorised execution, and loss of evidence. M0+M1 also remains incompatible with the current validator.

I read the spec, prior review, all requested repository files, and relevant installer/hook/QA references. A read-only parser check accepted the proposed final `FACTORY.md` fields. No files were modified; installation and mutation-producing tests were not run.

Below, “resolved” means resolved **in the design**, not verified in an implementation.

**Audit of all 24 v1 findings**

| V1 | Status | V2 assessment |
|---|---|---|
| 1. Script-enforced provenance | **Not resolved** | D2 and §7 still promise detection of forged artifacts. A consistently rewritten hash chain passes. See F1. |
| 2. Model-assembled verification | **Partial** | A central emitter exists, but the override bypasses checks and receipts lack contracts. F2–F3. |
| 3. Prompt-injection boundary | **Partial** | Residual host risk is acknowledged. General safe-ingest remains unspecified; only SARIF has an interface. F7. |
| 4. Secrets and digest oracle | **Not resolved** | Four-character disclosure, raw-file digests, and undefined secret fingerprints remain. F6. |
| 5. Active-test authorisation | **Not resolved** | Moving cases into `drafts/` supplies neither an execution boundary nor a sound passive classifier. F5. |
| 6. Manual-QA handoff | **Partial** | Priority mapping, result tokens and top-level launch are corrected. Evidence promotion, draft exclusion and header admission remain wrong. F5, F18. |
| 7. Test-automation handoff | **Partial** | Direct TC paths and top-level launch are corrected. Partial delivery and defect exclusions are not consumed correctly. F18. |
| 8. Context injection | **Mostly resolved** | Omitting `context-memory` fixes the path error. The claimed default list is still inaccurate. F21. |
| 9. Citation gate | **Partial** | Exact comparison is specified, but normalisation, range membership and ambiguity remain underspecified. F10–F11. |
| 10. Unverifiable input | **Resolved structurally** | `build-report` now receives the whole gate result. However, severity capping creates a new assurance problem. F10. |
| 11. Fingerprint identity | **Partial** | Caller IDs are rejected and rename limitations acknowledged. Secret IDs and occurrence stability remain undefined. F6, F11. |
| 12. Scope/artifact binding | **Partial** | Hash fields exist, but canonicalisation, complete inputs and historical verification do not. F8. |
| 13. Verification and execution safety | **Partial** | Lexical limitations and arbitrary-code execution are acknowledged. Exact-head execution and authorisation binding remain absent. F4. |
| 14. SARIF mapping | **Partial** | The named mapping file does not resolve contradictory input fields or missing-evidence representation. F9. |
| 15. Global Stop hook | **Resolved by removal** | No bundle hook ships. Synchronous sign-off has separate deficiencies. F14. |
| 16. Shell-hook contradiction | **Resolved by removal** | The remaining probe is `.mjs`. |
| 17. Standalone dependency installation | **Resolved for the advertised review entry point** | Explicit two-skill installation matches installer behaviour. Other “standalone” entry points need dependency definitions. F13. |
| 18. Green M0/manifests | **Not resolved** | The validator rejects an agentless factory. Merging milestones does not change that. F12. |
| 19. `factories/` versus `bundles/` | **Resolved in the plan** | The authoritative path and prerequisite reconciliation are explicit. |
| 20. Register semantics | **Partial** | JSON SSOT and transitions help, but approvals, replay, supersession and reopening remain incomplete. F15–F16. |
| 21. Confidentiality | **Partial** | Local defaults improve policy; its artifact inventory, timing and export controls remain incomplete. F17. |
| 22. Auditor-grade reporting | **Partial** | Richer sections and fixed templates help. Required report content lacks corresponding required data and bound inputs. F19. |
| 23. Assessment versus fix verification | **Resolved at the contract-separation level** | `mitigation-review` is distinct. Its receipt/state semantics remain unresolved under F3. |
| 24. Tests and smoke | **Partial** | Explicit commands and frozen model outputs help. Critical adversarial and installed integration tests remain absent. F22. |

**Findings**

1. **F1 — Blocker — §2 D2; §5.2 `build-report`/`check`; §7 Guarantees and Not guaranteed**

   **Wrong:** V2 explicitly says a model can hand-author all artifacts, but that a human or CI can detect this “in seconds”; §7 says forged provenance “can [happen], and `check` will show it.” That is false. Rewrite the report, gate result and all corresponding hashes consistently, retain valid citations, and the specified checker has nothing with which to distinguish the rewrite from canonical production.

   Additionally, checking hashes and cited bytes does not establish that the supplied gate result satisfies the gate’s complete rules.

   **Fix:** Promise internal consistency and reproducible citation validation only. Have `check` independently recompute schema validation, gate decisions and rendering using a trusted installed verifier. Detection of replacement or historical forgery requires an externally retained manifest digest or trusted signature. Explicitly state that self-consistent replacements are otherwise undetectable.

2. **F2 — Blocker — §5.3 Closed verdict mapping; §5.7 transitions**

   **Wrong:** “First matching row wins” evaluates suppression before tests and re-review. Its human override can therefore produce `VERIFIED-WITH-ACK` when tests fail, tests were never authorised, or the reviewer refinds the vulnerability. `--approved-by` alone supplies the override.

   The register accepts only `VERIFIED`, so the newly introduced public token also has no lifecycle mapping. A previously fixed finding can be refound but emit `UNVERIFIED-TESTS-FAILED` instead of `REGRESSED`, leaving the register falsely fixed.

   **Fix:** Validate all checks first. An acknowledgement may waive only a specific suppression result; every other success prerequisite must still hold. Bind the acknowledgement to finding, OIDs and indicator. Define handling for every public token, and update regression state independently of diagnostic precedence.

3. **F3 — Major — §3 reviewer contracts; §5.1 Evidence states; §5.3 re-review; §10 schemas**

   **Wrong:** The design moves semantic assertions into receipt files without defining receipt schemas, locations, producers, validation commands, missing/error states or replay rules. Hashing a reviewer-written `NOT-REFOUND` file does not establish what was reviewed.

   The state machine also conflates different propositions: confirming a **mitigation** does not verify the corresponding **vulnerability finding**. Ordinary review findings have no clearly defined route to `FINDING_VERIFIED`. Input is described as `CLAIMED`, while every supplied `evidence_state` is rejected.

   **Fix:** Define separate citation, vulnerability-review, mitigation-review and fix-verification records. Bind receipts to subject ID, scope digest, exact OIDs, reviewed evidence and contract version. Specify a command that validates and applies them. Missing, malformed, contradictory or stale receipts must yield indeterminate results. State whether `CLAIMED` is implicit or assigned during ingestion.

4. **F4 — Blocker — §5.3 `branch`, `suppression`, `tests`; §5.6 authorisation; §7 read-only guarantee**

   **Wrong:** Checking cleanliness only for the finding’s path does not prove tests ran at `head`. The checkout can be another revision, or dirty test/config/helper files can manufacture a green result. There is no checkout/snapshot preparation contract.

   Suppression checks inspect the finding’s path, but the listed `.semgrepignore`, `.trivyignore*` and similar files normally live elsewhere. Those changes escape the stated check.

   Finally, the lead owns editable `engagement.md`; `allowed` plus a name does not bind human permission to the command or revision. Authorised project tests can also edit product files or perform active network tests despite other guarantees.

   **Fix:** Execute in a verified snapshot of the exact OID, covering test/config/dependency inputs, with explicit handling of generated files and submodules. Inspect suppression configuration across the relevant diff. Bind operator approval to command, revision, target/environment and permitted effects. Describe read-only as the roles’ behaviour, not a property guaranteed for arbitrary child code.

5. **F5 — Blocker — §2 D7; §4.1 `security-test-planning`; §8.1 admission and prompt; §8.3; §13 M5**

   **Wrong:** “A normal user could perform it through the UI” is not a passive criterion. Submitting an injection payload, repeatedly attempting logins, deleting records or initiating purchases can all satisfy it.

   Drafts retain executable TC filenames under the suite directory passed to the receiving lead. [The lead’s discovery contract](`bundles/manual-qa/agents/test-run-lead/AGENT.md:74`) defines no draft exclusion, and the runner reads no authorisation metadata. Recursive discovery is not explicitly forbidden. The directory name therefore cannot support “nothing in v1 executes them.”

   **Fix:** Keep drafts outside executable suite discovery roots, preferably in a non-TC format. Handoff an explicit admitted-case list or a dedicated executable-only suite. Define allowed operations, payload restrictions, targets and side effects. Require receiving-side draft rejection before shipping the handoff; defer active authorisation separately.

6. **F6 — Blocker — §5.1 secret records/fingerprints; §5.2 scope; §5.4 redaction; §11 tests**

   **Wrong:** The secret fingerprint requires a normalised snippet, but secret records prohibit snippets. No alternative identity algorithm exists.

   Four-character prefixes can disclose all of a short password and unnecessarily disclose part of every other secret. Raw per-file and dirty-patch digests can also provide an offline confirmation oracle when the remaining file contents are known.

   Redaction changes snippets before persistence, but the gate compares persisted snippets to unredacted source. Legitimate citations containing credentials will fail. Conversely, broad pattern matching cannot guarantee that every arbitrary secret in every string is removed.

   **Fix:** Define a separate opaque secret identity and redaction-aware evidence representation. Do not retain raw secret prefixes. Compare sensitive evidence privately and emit structural receipts; keep secret-bearing raw digests out of publishable artifacts. Separate integrity metadata from redacted presentation, define transformation order, and replace the universal secrecy promise with a bounded detection guarantee.

7. **F7 — Major — §2 D5; §3 rule 1; §5.2 `ingest`; §7**

   **Wrong:** The promised safe-ingest API exists only as a SARIF command. There are no schemas or commands for tickets, PRs, repository documents, test cases or tracker responses.

   “Strip command-like strings” is neither a deterministic grammar nor a semantic injection defence: plain prose can carry instructions. Applied literally to source snippets, it also removes the code being reviewed. “Untrusted content never selects a path” conflicts with following scanner locations and test-case paths unless an explicit validation step converts them into approved references.

   **Fix:** Define adapters by input kind, separating typed reference fields from inert quoted evidence. Trusted scope configuration must authorise path resolution and action selection. Keep source text as data; do not claim a string heuristic removes instructions. Specify unsupported inputs and all direct-read exceptions.

8. **F8 — Major — §5 preamble; §5.2 manifest/check/export; §5.5 report inputs; §6 sign-off**

   **Wrong:** The hash chain lacks a complete serialization and dependency contract:

   - Every JSON artifact carries `scope_sha256`, including scope itself, without defining an excluded-field hashing rule.
   - Assessment content includes engagement, threat model, mitigation receipts and register delta, but `build-report` exposes only scope, gate and coverage inputs.
   - Atomic publication of report plus manifest has no crash/retry protocol.
   - `check` uses the current tree, so fixing a finding makes its historical report stale; sign-off checks every engagement report and then refuses.
   - Redacted exports change report bytes without specifying a derivative manifest.

   **Fix:** Specify canonical bytes, hash exclusions, the complete input graph, unique run creation and atomic publication. Distinguish historical integrity against the assessed snapshot from current-tree drift. Give exports their own manifest linked to the original. Bind all report-bearing artifacts.

9. **F9 — Major — §2 D6; §5.2 SARIF ingest/export**

   **Wrong:** The allowlist permits `ruleId`, `level`, `message.text` and one physical location, while mapping requires tool name/version and rule/taxonomy data. The adapter cannot derive all promised fields under that policy.

   A no-region `GAP` cannot satisfy the required finding `path`, `lines` and `snippet`, and `GAP` is not a defined gate-result state. Data-flow findings need typed citations while `codeFlows` and `relatedLocations` are ignored. “Every string … wrapped” is incompatible with retaining machine-valid path and enum fields.

   **Fix:** Define separate metadata and result allowlists, actual mapping precedence, unknown-tool/rule behaviour and a distinct incomplete-candidate schema. Specify when data-flow findings remain unverifiable. Wrap only presentation fields. Define export/import round-trip behaviour explicitly.

10. **F10 — Major — §5.1 citations; §5.2 gate/coverage; §7**

    **Wrong:** The gate explicitly rejects paths outside scope, but does not explicitly require every primary and typed citation range to lie within the admitted ranges. A diff review can cite unrelated lines from an admitted file.

    Forcing citation failures to p3 turns uncertainty into low severity. A potentially critical missing-evidence finding becomes a low-priority candidate. Coverage also lacks a stated invariant requiring every scoped file/range to be accounted for exactly once.

    **Fix:** Validate all citation ranges against scope, with an explicit mechanism for contextual expansion. Preserve claimed severity separately from evidence confidence. Make unresolved high-impact candidates visible in summary/sign-off. Require complete, non-overlapping coverage accounting.

11. **F11 — Major — §5.1 normalisation/fingerprint; §11 tests**

    **Wrong:** Replacing every Unicode whitespace run includes newlines, yet the following instructions trim individual lines and drop empty ones. The operation order is ambiguous. NFC and whitespace folding can also equate source strings that are semantically different.

    `end - start ≤ 40` allows **41 inclusive lines**, contradicting the change map’s “≤40 lines.” Optional `occurrence` lacks a canonical default, and inserting another identical occurrence before the cited one changes the fingerprint despite the claimed tolerance for edits elsewhere.

    **Fix:** Publish precise pseudocode and canonical vectors. Preserve an exact-byte identity alongside any search normalisation. Use `end - start + 1 ≤ 40`. Define occurrence counting and defaults, and narrow the movement-stability claim or add explicit identity reconciliation.

12. **F12 — Blocker — §13 M0+M1; §10 manifest**

    **Wrong:** M0+M1 explicitly has no agents. [The validator](`bin/validate-factories.mjs:200`) rejects empty `agents` unless `localAgents` is non-empty. The final descriptor is valid, but that does not make the milestone valid. Retaining the final manifest’s briefings would also reference absent roles.

    **Fix:** Include one real usable agent in M0+M1, or explicitly change and test installer/validator support for skill-only factories. Publish the actual intermediate manifest, including its briefing and skill lists.

13. **F13 — Major — §2 D12; §6 standalone entry points; §10 files; §13 milestone dependencies**

    **Wrong:** M0+M1 promises fix verification before engagement validation ships in M3 and the verification/review contracts ship in M4. M2 advertises standalone review before artifact-policy application arrives in M3. The standalone two-skill installation never installs `security-engagement`.

    The file tree also omits explicit receipt, verification and register/event schemas needed by these contracts.

    **Fix:** Put minimum engagement authorisation, artifact policy, receipt validation and verification schemas in the shared toolkit’s first milestone. Alternatively narrow earlier capabilities. Define dependencies and launch ownership separately for every advertised standalone entry point.

14. **F14 — Major — §6 `sign-off`; §7 Guarantees; §10 script inventory**

    **Wrong:** Sign-off is attributed to a script and promises exit 4, but no sign-off executable is specified. A lead’s prose workflow has no process exit status.

    Its refusal list includes `FAIL`, but the checker emits `PASS / STALE / TAMPERED / MISSING-MANIFEST`; elsewhere missing provenance is `UNVERIFIABLE-PROVENANCE`. Missing evidence can therefore fall outside the enumerated refusal conditions. Product dirt is merely reported, and no initial snapshot supports attribution.

    **Fix:** Define one sign-off command, artifact and closed result table; every non-pass integrity/availability result must block. Identify engagement reports from a validated inventory. Describe product-tree comparison as observed changes, not proof that these roles never edited code.

15. **F15 — Major — §2 D15; §5.6; §5.7; §14.3**

    **Wrong:** An unauthenticated approver string and URL still let an agent write `accepted`; D15 claims this prevents agents accepting risk on the project’s behalf. Later human eyeballing does not undo the earlier authoritative transition.

    Similar weak approval appears in suppression overrides and test execution.

    **Fix:** Use `acceptance-proposed` until an operator-confirmed decision is imported or executed through a trusted interaction. Bind the decision to the exact risk, scope, rationale and expiry. If approval authenticity is deliberately unsupported, label the resulting state “acceptance recorded, unverified,” and exclude it from approved-risk totals.

16. **F16 — Major — §5.7 register; §11 event-log tests**

    **Wrong:** `{ts, actor, event, from, to, ref}` cannot replay the full register without defined row identity and mutation payload. The promised hash chain has no fields or trusted checkpoint. Rewriting or truncating the whole chain and projection together remains undetectable.

    `any → superseded` can retire an open critical risk into an unrelated or nonexistent row. Cycle checks, target validation, reopening false positives, acceptance revocation, concurrent updates and interrupted writes are undefined.

    **Fix:** Define versioned event payloads, sequence numbers, row IDs, previous hashes, replay rules and atomic/concurrent update handling. Externally anchor history if tamper evidence is required. Validate supersession targets and preserve unresolved exposure. Add revocation/reopening transitions.

17. **F17 — Major — §2 D13; §3 writable paths; §5.2 export; §5.6 policy; §8.5 tracker; §10 artifacts**

    **Wrong:** “All artifacts local” has no complete mapping. Policy omits cases, drafts, handoffs, verification receipts, role memory and receiving-bundle outputs. Manual-QA writes reports and screenshots outside `reports/security/`; automation writes its own artifacts and may publish tracker/TMS content.

    `.gitignore` creation is required but lies outside the roles’ writable paths. Tracker filing is an external disclosure path despite export being the “only sanctioned way” out. Export approval and retention are unspecified.

    **Fix:** Enumerate artifact classes and paths across handoffs, including screenshots and external payloads. Apply policy before the first write; explicitly authorise the narrowly scoped ignore-file operation. Check tracked and ignored status. Define per-destination disclosure approval, derivative redaction and retention/deletion rules.

18. **F18 — Major — §4.1 schema compatibility; §8.1–§8.2 receiving adapters**

    **Wrong:**

    - Manual-QA `PASS` proves the case’s expected observable, not that a whole threat is mitigated. `FAIL` can be a locator or case failure, not a confirmed vulnerability.
    - Header-only expected results do not satisfy the [runner’s mandatory snapshot verification](`bundles/manual-qa/agents/test-runner/AGENT.md:91`); the admission rule conflicts with the separate audit route.
    - The [qa-auditor schema](`bundles/manual-qa/agents/qa-auditor/references/audit-methodology.md:118`) has no required finding IDs or run ID. Import “by run id + finding ids” is not an existing contract, and the proposed schema is not a literal superset.
    - [TA permits delivered partial coverage with exclusions](`bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md:285`), including defect exclusions. V2 consumes outcome and test path without binding the security assertion to covered steps.
    - Requiring `VERIFIED` before resubmitting a case can deadlock when that regression test is needed to establish verification.

    **Fix:** Record execution observations first, then independently reconcile mitigation/finding claims. Route headers exclusively through the audit adapter. Define imported IDs from report digest plus stable finding locator. Consume TA coverage, exclusions and findings alongside outcome. Permit post-fix test construction before final verification.

19. **F19 — Major — §2 D3; §5.1; §5.5; §7 report guarantees**

    **Wrong:** Coverage is section **5**, despite two promises that it comes first. Impact, prerequisites and affected assets are optional; reproduction, ticket/history and verification data lack a complete required input schema. A “full record” renderer can therefore produce empty auditor-facing sections or invite invented prose.

    Shipped `review`, `verify` and `threat-model` report structures are not defined. Rejected-input counts are also not explicitly required in the report.

    **Fix:** Reconcile section ordering. Define required data per template, explicit `unknown/not assessed` values and missing-data limitations. Bind every displayed status/history to an input receipt. Include ingestion/schema rejection totals so malformed inputs cannot disappear behind a clean summary.

20. **F20 — Major — §4.1 threat-modeling; §6 assessment sequence; §11 `tm-lint`**

    **Wrong:** A threat “terminates” by merely carrying a reference. The linter is not required to prove that the referenced case, draft, ticket or register row exists and addresses that threat. Placeholder references satisfy the stated test.

    The threat modeler must pass this check before returning, but the assessment sequence creates no cases and does not clearly assign register-row creation before that point.

    **Fix:** Separate a modeled threat from a disposition-linked threat. Define resolvable typed references and who creates each target. Permit an explicit unresolved disposition during modeling; require actual resolution at sign-off. A draft reference must count as planned work, not mitigation or executed coverage.

21. **F21 — Minor — §3 context defaults; §10 repository claims; §13 M-1**

    **Wrong:** The spec quotes `hooks/config.sh.example` as the runtime default, omitting `RULES.md`. [Actual `hooks/lib.sh`](`hooks/lib.sh:215`), also read by the installer, includes it. The example is stale.

    `targets` governs bundle-hook installation, not which hosts receive content. `npm run validate` also currently includes external-registry and duplicate checks, beyond the stale `CLAUDE.md` command description.

    **Fix:** Cite executable sources of truth. Extend M-1 to reconcile context defaults and validation commands, and explain `targets` accurately. Keep the critical rules in `AGENT.md`; that choice remains appropriate.

22. **F22 — Major — §11 testable seams; §12 smoke**

    **Wrong:** The proposed tests can all pass while the failures above remain. They omit coherent artifact forgery, receipt replay, suppression-ACK combined with failed tests, wrong-head execution, dirty test helpers, full event-log rewrite/truncation, draft discovery, partial TA delivery, historical report checks, derivative exports and first-write confidentiality.

    `check --help` proves installation of a file, not a working installed pipeline.

    **Fix:** Add negative fixtures for those cases and an installed end-to-end test: scope → ingest → gate → build → check → verify → register → sign-off. Exercise standalone and coinstalled configurations. For model evaluations, freeze prompts, model identifier, settings, fixture revision and scoring/matching rules as well as outputs.

**Ranked top five**

1. **F2/F4:** Prevent false verification through suppression overrides, wrong-revision tests and unbound execution permission.
2. **F1/F8:** Replace impossible forgery-detection claims with a complete, independently recheckable evidence contract.
3. **F5:** Prevent drafts and active UI actions from entering executable QA workflows.
4. **F6:** Resolve secret identity, redaction, citation matching and digest disclosure together.
5. **F12/F13:** Make M0+M1 actually validate and include the dependencies its promised capabilities require.

**Overall verdict: rework.**
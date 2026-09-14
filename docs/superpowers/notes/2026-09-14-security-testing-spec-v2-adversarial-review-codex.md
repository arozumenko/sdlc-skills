# Adversarial review of the security-testing bundle spec (v2)

**Reviewer:** OpenAI Codex, model `gpt-6-astra`, reasoning effort `medium`, read-only
**Date:** 2026-09-14
**Subject:** [`specs/2026-09-14-security-testing-bundle-design.md`](../specs/2026-09-14-security-testing-bundle-design.md) v2 at commit 9201e6b
**Prior review:** [v1 review](2026-09-14-security-testing-spec-adversarial-review-codex.md) (gpt-5.6-sol, high)
**Codex session:** 01a0a082-e78b-7200-b8af-8c98b3d2952b

Spot-checked against the working tree and holding: the validator rejects an empty `agents` list unless `localAgents` is non-empty (`bin/validate-factories.mjs`), `hooks/lib.sh` includes `RULES.md` in the default role-memory list while `hooks/config.sh.example` omits it, and `npm run validate` includes the network-using `validate:externals`.

---

**Verdict: rework.** V2 repairs several interfaces, but still permits false verification, leaves active drafts executable by existing consumers, contradicts its redaction guarantees, and specifies an M0+M1 that fails the current validator.

I read the [v2 spec](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md`), the prior review, and all requested repository files. Section references below refer to v2. No files were modified; installer and repository tests were not run because they can write files.

**Disposition of all 24 v1 findings**

“Resolved” means resolved at design level, not implementation-verified.

| V1 # | Disposition | Verification |
|---|---|---|
| 1 | Partial | Manifest added, but coherent forgery is still claimed detectable. F1, F7. |
| 2 | Partial | Sole verdict emitter added; ACK bypass and receipt semantics remain unsafe. F2, F3, F9. |
| 3 | Partial | Nonce claims narrowed correctly; safe-ingest exists only for SARIF. F10. |
| 4 | Unresolved | Redaction conflicts with citation verification; other hashes remain credential oracles. F4. |
| 5 | Unresolved | “Draft” and directory placement do not prevent existing runners executing cases. F5. |
| 6 | Partial | Format, priorities, tokens and top-level prompt corrected; admission and result interpretation remain wrong. F5, F17. |
| 7 | Resolved for intake | Direct case paths, top-level TAL, execution provider and defect routing match the receiver. Artifact and evidence policies still need F14/F17. |
| 8 | Resolved functionally | Omitting `context-memory` fixes resolution. The stated default remains inaccurate. F20. |
| 9 | Partial | Exact ranges and typed citations improve citation validity; scope, normalization and semantic promotion remain incomplete. F8, F9. |
| 10 | Resolved | `gate-result.json` now supplies the Unverifiable section explicitly. |
| 11 | Partial | Caller IDs rejected and stability claim narrowed; secret IDs, occurrence validation and aliasing remain undefined. F9. |
| 12 | Partial | Binding fields added; chain construction, complete scope and historical verification remain incomplete. F7, F8. |
| 13 | Partial | Lexical claim and arbitrary-execution acknowledgment corrected; execution at the claimed head is not established. F3, F12. |
| 14 | Partial | Mapping file named, but incompatible schemas and missing mapping rules remain. F11. |
| 15 | Resolved by removal | No bundle hooks in v1. Replacement sign-off still overclaims. F18. |
| 16 | Resolved by removal | Shell-hook conflict removed; probe is `.mjs`. |
| 17 | Resolved for installation | Explicit two-skill install matches resolver behavior. Standalone operational prerequisites remain incomplete. F19. |
| 18 | Unresolved | M0+M1 still declares no agents, which the validator rejects. F6. |
| 19 | Resolved at design level | Installer authority and prerequisite documentation correction are explicit. |
| 20 | Partial | JSON projection and transitions added; approval and replay contracts remain inadequate. F12, F13. |
| 21 | Partial | Local defaults improved; policy omits several security artifact destinations and export provenance. F14. |
| 22 | Partial | Report outline and shipped templates improved; required evidence and input contracts are absent. F16. |
| 23 | Partial | Separate mitigation-review contract added, but its mapping into finding states is undefined. F9. |
| 24 | Partial | More negative fixtures and explicit smoke commands added; decisive adversarial combinations remain missing. F21. |

**Findings**

1. **F1 — Blocker — §2 D2; §5.2 `build-report`/`check`; §7 provenance guarantees.**

   V2 admits artifacts are forgeable, then says a human/CI can detect that “in seconds” and that `check` “will show it.” An agent can rewrite the report, accepted findings, coverage and all corresponding hashes consistently. Valid citations do not reveal that rewrite or prove which program produced it. `build-report` also accepts a gate result without explicitly rerunning the gate.

   **Fix:** Promise consistency and citation revalidation only. Have `check` independently recompute IDs, gate classifications, counts and deterministic rendering from validated inputs. Detect historical replacement only against a consumer-held trusted digest or signature; without one, report origin as unauthenticated.

2. **F2 — Blocker — §5.3 closed verdict mapping.**

   First-match evaluation reaches suppression before tests and re-review. Its human ACK can therefore yield `VERIFIED-WITH-ACK` when tests fail or the vulnerability is re-found. That token also has no register transition. Missing or invalid re-review results have no explicit failure row.

   **Fix:** Validate every result against closed schemas first. ACK may waive only the suppression condition; all other verification requirements must still pass. Missing, stale or malformed receipts must produce `UNVERIFIED-INDETERMINATE`. Define the ACK receipt and corresponding register behavior.

3. **F3 — Blocker — §5.3 `branch`, `suppression`, `tests`, re-review.**

   Checking that the finding path is clean does not establish that tests ran at `head`. The validated cwd can contain another checkout or dirty test/configuration files. A modified local test can pass while the manifest names an untested commit.

   Suppression examines only the finding’s path, yet promises detection of edits to separate ignore files. Re-review has no input flag, schema, freshness rule or binding to the tested bytes.

   **Fix:** Run against an isolated, exact checkout of `head`, binding configuration, command, environment policy and before/after tree state. Scan suppression configuration across the complete fix diff. Require a receipt bound to finding ID, run, base/head and reviewed content.

4. **F4 — Blocker — §5.1 fingerprints; §5.2 scope/ingest/gate; §5.4; §11.6.**

   Redaction before persistence changes snippets, so exact comparison against unredacted source fails. Secret findings omit snippets, but the fingerprint requires one and the gate defines no alternative verification algorithm.

   “No secret digests” is also defeated by whole-file and dirty-patch hashes: for a known file containing `password=<short PIN>`, its digest is a credential confirmation oracle. Four-character prefixes can disclose an entire short password. The test requiring “no digest anywhere” conflicts with the manifest design itself.

   **Fix:** Define separate restricted verification data and publishable evidence. Verify original bytes in memory; persist a typed redacted representation with explicit verification semantics. Use opaque secret IDs, omit secret-derived prefixes, and specify which restricted hashes are retained or excluded from export.

5. **F5 — Blocker — §2 D7; §4.1 security-test-planning; §8.1 admission; §8.3 drafts.**

   A normal user’s UI can submit injection payloads, delete data, transfer money or trigger repeated login attempts. “Form interaction” is not a passive-testing boundary.

   Drafts remain valid `TC-*.md` beneath a runnable suite. The [manual lead](`bundles/manual-qa/agents/test-run-lead/AGENT.md`) has no draft exclusion, and the [runner](`bundles/manual-qa/agents/test-runner/AGENT.md`) executes the supplied case. A direct case path bypasses the planner entirely. §8.2 also does not explicitly filter drafts from TAL’s case list.

   **Fix:** Define passive operations by effects, payloads and repetition limits. Keep active proposals outside executable suite discovery and use a non-TC document schema. Before producing runnable security cases, add receiving-side rejection of drafts and unknown authorization states; emit explicit admitted-case lists.

6. **F6 — Blocker — §13 M0+M1; §10 manifest.**

   M0+M1 explicitly ships no agents. The current [validator](`bin/validate-factories.mjs:201`) rejects empty `agents` unless `localAgents` is nonempty. Merging milestones did not fix v1 finding 18.

   Keeping §10’s briefings would additionally reference absent roles. M0+M1 promises fix verification before the reviewer contract arrives, while authorization validation and artifact policy arrive only at M3.

   **Fix:** Ship a minimal real agent with complete dependencies, or first implement and test support for skill-only bundles. Provide the exact intermediate manifest. Move safety prerequisites into M0+M1 and defer capabilities whose contracts do not exist yet.

7. **F7 — Major — §5 preamble; §5.2 manifest/check; §6 sign-off.**

   The chain lacks a construction protocol: serialization, self-hash exclusions, manifest path resolution, output publication order, crash recovery and concurrent-run behavior are unspecified. `scope.json` is itself a JSON artifact required to carry `scope_sha256`, leaving its hash boundary undefined.

   Historical checking is also broken: `check` compares citations to the current tree, while sign-off checks every engagement report. A legitimate fix makes the original assessment stale, potentially blocking sign-off indefinitely.

   **Fix:** Define a versioned manifest DAG and canonical hash boundaries, constrain all referenced paths, and publish a manifest only after durable outputs exist. Separate historical integrity verification against the recorded snapshot from current-tree drift checking; specify which reports must be current.

8. **F8 — Major — §5.1 normalization; §5.2 scope/gate/coverage.**

   Gate admission checks paths, not explicitly cited ranges against authorized ranges. Coverage records whole-file “examined” status even when only a diff range was declared examined. Deleted-only changes have no valid head-side citation representation; source/sink evidence outside changed ranges has no context-expansion contract.

   “Every Unicode whitespace run” includes newlines, conflicting with subsequent per-line operations. `end-start ≤ 40` permits 41 inclusive lines.

   **Fix:** Separate authorized review ranges, supporting context and examined ranges. Model deletion evidence against the base snapshot. Specify horizontal versus newline normalization and use `end-start+1 ≤ 40`. Recompute occurrence positions instead of trusting caller indices.

9. **F9 — Major — §3 reviewer contracts; §5.1 states/fingerprint; §5.7 supersession.**

   A mitigation receipt answers whether a mitigation claim is confirmed; a finding receipt answers whether a vulnerability exists. §5.1 promotes findings through mitigation receipts without defining that semantic translation. `CONFIRMED` could mean the mitigation works, not that the finding is verified.

   Input handling is contradictory: findings are “written as `CLAIMED`,” but any supplied `evidence_state` is rejected. Fingerprint aliases for changed findings are also conflated with superseding register rows identified as `R-nnn`.

   **Fix:** Define distinct claim types and receipt schemas with explicit mappings. Choose either omitted input state or allowed `CLAIMED`. Define finding-ID aliasing separately from register-row supersession, including secret identity and occurrence rules.

10. **F10 — Major — §2 D5; §3 rule 1; §5.2 ingest; §7.**

    D5 promises minimization for tickets, PRs, repository documents, cases and tracker responses. The only ingest command accepts SARIF. Those other inputs still enter directly.

    The rule forbidding untrusted text from selecting paths or commands also conflicts with scanner locations selecting files and §5.3 taking executable commands from repository documents. No trusted approval boundary resolves this.

    **Fix:** Define adapters and exposure rules for every claimed input channel. Separate proposed paths/commands from trusted, scope-validated selections. Use explicit argv inputs bound to execution approval; describe remaining direct reads as residual exposure rather than covered ingest.

11. **F11 — Major — §2 D6; §5.1; §5.2 SARIF ingest/export.**

    The mapping still cannot be implemented consistently:

    - No-region results become GAP candidates, but the required finding schema needs path, lines and snippet.
    - Mapping needs tool/version and `taxa`, but the stated allowlist does not include them.
    - Data-flow findings require typed citations while `codeFlows` and `relatedLocations` are discarded.
    - Neither the actual priority/class tables nor missing-version/unknown-tool behavior is specified.
    - Wrapping “every string” would invalidate structured paths, enum values and snippets if interpreted literally.

    **Fix:** Supply the mapping tables and distinct located/unlocated candidate schemas. Define rules metadata access, missing-field behavior and unsupported flow handling. Wrap only presentation text. Export only after validating the corresponding run chain.

12. **F12 — Major — §2 D15; §5.3 execution authorization; §5.6; §5.7; §14.3.**

    A nonempty approver name and URL do not establish human approval. The lead writes `engagement.md`, which then authorizes arbitrary repository execution. An agent can supply those strings for acceptance, false-positive closure or suppression ACK. Acknowledging unauthenticated references in §14 does not make the resulting approved status human-controlled.

    **Fix:** Distinguish proposed/unvalidated decisions from confirmed approvals. Bind approval to exact action, finding/run, scope, expiry and relevant command/head. Require consumer-controlled confirmation or verified approval evidence before activating the decision; otherwise label it unvalidated.

13. **F13 — Major — §5.7 register; §11.10.**

    The proposed event `{ts, actor, event, from, to, ref}` cannot reconstruct the projection: it lacks explicit row identity and changed field values. The promised hash chain has no sequence, predecessor hash or checkpoint fields. A locally rewritten chain cannot prove history was preserved.

    There is also no human revocation of accepted risk, no reopening a false positive, and no acceptance path for a regressed finding. UTC boundary rules remain unspecified.

    **Fix:** Define replayable events, optimistic concurrency, atomic append/projection recovery and an external checkpoint if tamper detection is claimed. Complete the transition table, define expiry precisely, and validate supersession targets and cycles.

14. **F14 — Major — §2 D13; §5.2 export; §5.6 artifact policy; §8 handoffs; §10 state.**

    The policy lists register, threat model, reports and ledger, but omits engagement, drafts, passive cases, handoffs, role memory and several receipts. Receiving bundles create additional artifacts outside `reports/security/`: manual QA writes reports/screenshots, and TA produces automation state and committed tests.

    Export changes report bytes while leaving its original provenance relationship undefined. Removing snippets does not redact sensitive reproduction details, infrastructure paths or attack prerequisites.

    **Fix:** Define a complete artifact inventory and ownership across handoffs, including downstream publication choices. Check ignore/tracked status before first persistence. Generate export manifests linked to source manifests and approved disclosure profiles, covering all narrative fields and attachments.

15. **F15 — Major — §3 writable paths; §10 `instructions.md`.**

    §10 inserts all four security rules into shared `AGENTS.md`/`CLAUDE.md` without a role guard. Those rules prohibit product edits and merging, conflicting with co-installed development and automation roles. The [bundle spec](`bundles/SPEC.md`) requires additive coexistence.

    Generating `.gitignore` also falls outside the security roles’ allowed write paths.

    **Fix:** Scope behavioral restrictions explicitly to the three security roles. Separate project-wide artifact policy from role permissions. Define a narrow, authorized mechanism for maintaining ignore entries.

16. **F16 — Major — §2 D3; §5.1; §5.2 build-report; §5.5 report structure; §7.**

    “Coverage first” conflicts with coverage being section five. The report requires reproduction, impact, prerequisites, assets, remediation, history and risk-register changes, but these are optional or absent from the finding schema.

    `build-report` accepts scope, gate and coverage, yet needs engagement, threat model, mitigation receipts and register state to populate the assessment. Those inputs are neither explicit nor necessarily hashed.

    **Fix:** Lock one section order. Specify a complete report-input schema and command contract; bind every contributing artifact. Require auditor-relevant fields or explicit missing-information reasons, and define severity/confidence meanings rather than merely naming their report section.

17. **F17 — Major — §4.1 evidence-schema claim; §8.1 result mapping and audit ingestion.**

    `PASS → threat mitigated` overstates a single UI test. A login case can pass while authorization bypass remains elsewhere. Run ID alone does not bind evidence to case bytes, target, account or code version.

    The claimed qa-auditor schema “superset” is false: its [actual schema](`bundles/manual-qa/agents/qa-auditor/references/audit-methodology.md:118`) includes `types` and specialist fields, and supports browser evidence rather than mandatory source citations. No adapter converts audit references into the source-based gate.

    **Fix:** Map PASS to “this case passed under recorded conditions,” requiring a separate mitigation decision. Define execution-evidence and browser-finding schemas plus adapters. Route response-header checks through the audit path consistently with the runner’s snapshot-based verification contract.

18. **F18 — Major — §2 D4; §6 sign-off; §7 read-only guarantee; §10 scripts.**

    Sign-off is described as a script-enforced command returning exit 4, but no sign-off executable is listed. Its rejection list omits `MISSING-MANIFEST` and `UNVERIFIABLE-PROVENANCE`.

    Final `git status` cannot prove no product edits occurred: edits can be reverted or committed, and unrelated dirt may predate the engagement. §7 still says “product code never edited.”

    **Fix:** Define a real sign-off command with complete failure semantics and an engagement artifact inventory. Label product checks as baseline-to-final change observations. Reserve strict read-only enforcement for an actual host/filesystem boundary.

19. **F19 — Major — §2 D12; §6 standalone entry points; §12 smoke; §13 M2–M3.**

    The two-skill standalone installation is supported, but it does not install factory seed knowledge, engagement validation or the later artifact-policy machinery. Review is promised at M2, before that machinery exists at M3. Other entry points are said to work standalone without dependency recipes.

    Smoke checking only that `evidence.mjs` exists and accepts `check --help` does not establish any workflow works.

    **Fix:** Put mandatory default policy and initialization in the evidence toolkit or expand documented dependencies. Publish an entry-point/dependency matrix. Smoke-test an actual scope → gate → report → check run in each installed layout.

20. **F20 — Minor — §3 context defaults; §13 M-1.**

    The stated default omits `RULES.md`. The example configuration is stale; [hooks/lib.sh](`hooks/lib.sh:215`) includes it, and [the installer](`bin/init.mjs:784`) derives defaults from that implementation.

    **Fix:** Cite the implementation’s default and reconcile the example as part of M-1. Keep the decision to omit the override.

21. **F21 — Major — §11 testable seams; §12 smoke; §13 green milestones.**

    The expanded tests miss the combinations that invalidate the guarantees: ACK plus failed tests, missing receipts, wrong checkout with clean finding path, coherent manifest replacement, historical report checking after a fix, draft handoff to existing runners, and register replay after interrupted writes.

    Model evals name model/date but do not lock the prompt, tool configuration, sampling settings, output selection or scoring matches. Also, current [package.json](`package.json`) includes network-using `validate:externals` in `npm run validate`; milestone validation is broader than the stale command summary suggests.

    **Fix:** Add those cross-component negative fixtures and a full installed workflow test. Freeze the complete evaluation harness and matching rules. Separate deterministic offline checks from external validation and report both accurately.

**Ranked top five changes**

1. Repair fix verification: exact tested snapshot, mandatory bound receipts, exhaustive verdict validation, ACK unable to bypass failures.
2. Reconcile redaction, secret identity and evidence integrity into one implementable data model.
3. Close the draft execution path and replace UI-based “passive” classification with effect-based admission.
4. Complete the manifest, register and approval protocols; remove claims that unsigned local hashes prove origin or human approval.
5. Make M0+M1 actually valid and self-contained, including safety prerequisites, role-scoped instructions and executable integration tests.

**Overall verdict: rework.**

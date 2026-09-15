# Adversarial review of the security-testing bundle spec (v5)

**Reviewer:** OpenAI Codex, model `gpt-6-astra`, reasoning effort `medium`, read-only
**Date:** 2026-09-15
**Subject:** spec v5 at commit fd6e8c8
**Result:** 0 blockers, 1 major (historical replay of redacted dirty snapshots, a consequence of the v5 R2 fix), 4 minors, no design disagreements. R1-R5 and F7/F11/F13/F18 accepted as resolved. Verdict: rework.

---

# Verdict: rework

**0 open blockers; 1 open major.** V5 closes the five original v4 findings, but its redacted-snapshot fix reopens historical citation replay.

Read-only review: no files modified; no installers or write-producing tests run. “Resolved” means resolved at design level.

## Prior-finding dispositions

| Finding | V5 status | Assessment |
|---|---|---|
| **R1 — indeterminate review reaches `VERIFIED`** | **Resolved** | §6.4 explicitly requires an applied `not-refound`; §12 includes the counterexample. |
| **R2 — original-byte persistence conflicts with redaction** | **Resolved** | §§6.2/6.6 now require redacted persistence. This creates the separate replay regression **N1** below. |
| **R3 — ignored-file baseline mismatch** | **Resolved** | §2 narrows coverage to non-ignored untracked files; §6.9 reports ignored coverage. |
| **R4 — nonexistent manual-QA JSON report** | **Resolved** | §6.6 consumes the actual Markdown report; §12 requires that format verbatim. |
| **R5 — inherited exact-checkout wording** | **Resolved** | §10 replaces the manifest/catalog wording with validated test-start snapshots. |
| **F7 — left open by v4 through R1** | **Resolved** | The false-`VERIFIED` path is closed. |
| **F11 — left open through R3** | **Resolved** | Baseline coverage now matches §2. |
| **F13 — left open through R4** | **Resolved** | The receiver produces the specified adapter input. |
| **F18 — left open through R5** | **Resolved** | The stronger inherited installation/catalog promise is replaced. |

**Reopened:** v4 accepted **F4** and **F19** as resolved. N1 explains the material v5 change that invalidates that conclusion. Their overlapping replay failure is counted once.

## Repository verification

The principal header and §16 claims match the actual files:

- [`item-resolver.mjs`](`bin/lib/item-resolver.mjs:14`) uses `bundles/` and supports qualified IDs.
- [`validate-factories.mjs`](`bin/validate-factories.mjs:201`) permits empty `agents` with nonempty `localAgents`, and checks declared content files.
- [`init.mjs`](`bin/init.mjs:2835`) installs core hooks independently of factory hooks. Factory seeds and instructions require a factory selection; `factory.targets` governs bundle hooks.
- [`hooks/lib.sh`](`hooks/lib.sh:215`) includes `RULES.md`; the example remains stale. `memory` and `knowledge-curation` are top-level skills. [`package.json`](`package.json`) includes external validation in `npm run validate`.
- The [manual-QA lead](`bundles/manual-qa/agents/test-run-lead/AGENT.md:70`) globs the supplied suite, normalizes IDs, and sizes cases. The [runner](`bundles/manual-qa/agents/test-runner/AGENT.md:91`) requires snapshot verification and returns `PASS | FAIL | BLOCKED`. The [report format](`bundles/manual-qa/knowledge/test-run-report-format.md:20`) matches v5’s Markdown adapter.
- The [TA playbook](`bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md:204`) supports report JSON, partial coverage, independent findings, and recovery based on merges without witnessed gate receipts.

The §12 cache-fixture description needs the minor correction listed below.

## Major finding

### N1 — Major — §§2, 6.2, 6.5: redacted dirty snapshots cannot satisfy original-source replay

Exact v5 sentences:

> “`check --integrity` for `side: snapshot` compares the redacted bytes and, when the working file is unchanged, re-derives the HMAC from it; original bytes are never on disk.”

— [§6.2](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:143`)

> “Replay: with the key, `check` re-derives `source_hmac` from the recorded side and compares it, together with the recorded `claimed_hmac`, against the private record…”

— [§6.5](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:275`)

**What is wrong:** §6.2 makes original-byte HMAC revalidation conditional on the working file remaining unchanged. §6.5 still requires it whenever the key exists. No result state describes original-source unavailability with an available key.

Concrete counterexample:

1. A dirty, uncommitted file contains `password=1234`.
2. The review records its original HMAC and persists only redacted snapshot bytes.
3. The working file is changed or deleted.
4. Historical `check --integrity` runs with the correct key.

Git cannot reconstruct that dirty version. The redacted snapshot cannot reproduce its original `source_hmac`; possession of the HMAC key does not recover discarded bytes. Comparing the stored HMAC with itself would not perform §6.5’s promised re-derivation.

**Why §18 does not close this:** read → HMAC → redact → persist solves R2’s confidentiality contradiction, but removes the original-byte snapshot that made v4’s replay contract possible. The §12 dirty-snapshot fixture checks redaction and HMAC presence, not historical replay after the source disappears.

**Prior-review relationship:** v4 explicitly accepted F4’s replay contract and F19’s reconstructible snapshots. V5 materially changes their storage representation, reopening this combined issue.

**Concrete fix:** define separate assurance for redacted-snapshot consistency and original-content revalidation. When originals are unavailable, report that limitation explicitly and align §§2, 6.3, 6.5 and sign-off behavior. Alternatively, reject sensitive dirty snapshots and require committed source for those citations. Add the four-step historical replay fixture above.

This is a **contract decision**, not an implementation detail: the current requirements prescribe incompatible replay behavior.

## Section 2 promise audit

I checked §§3–18, including explicitly inherited v3 contracts.

| §2 promise | Proposed script support | Result |
|---|---|---|
| Consistency and re-derivation | `check`, gate/coverage replay, receipt application, evaluator, register replay, renderer | **N1 affects snapshot-backed citation replay.** |
| Recorded-snapshot integrity and current drift | `scope`, `check --integrity/--drift` | **N1: original dirty content can become unavailable.** |
| Validated test-start snapshot | `verify.mjs all`, post-install comparison, `tested_tree` | Contract aligned. |
| Bounded redaction and protected-content identities | Recursive writer redaction, keyed identities, redacted imports/snapshots | Persistence conflict resolved; replay consequence is N1. |
| Admitted-only canonical hand-off suite | `plan.mjs admit`, dedicated-suite writer | Aligned with the canonical-output qualification. |
| Unauthenticated approvals | Receipt/register schemas and reporting | Contract aligned. |
| Per-path baseline observation | `engagement init`, sign-off comparison and excluded counts | Contract aligned. |

No §2 promise entirely lacks a named implementation script. These are proposed contracts; the security bundle is not yet implemented.

## Design disagreements

None. I accept the explicit boundaries around consistency rather than provenance, unauthenticated approvals, heuristic admission, dedicated suites, and clean-tree assessments.

## Minor findings

- **M1 — §§6.4/12:** Reconcile `refound` precedence with the existing unavailable-tests fixture requiring `UNVERIFIED-INDETERMINATE` plus `regression-observed`. The listed test catches this.
- **M2 — §12:** Specify hermetic external-cache provisioning. [`shallowClone`](`bin/init.mjs:1149`) fetches existing Git caches and replaces non-Git directories; stub folders alone do not prevent network access. `verifying-outcomes` and `issue-tracking` are also monorepo content.
- **M3 — §6.3:** Explicitly require transitive input closure for `verify` and `threat-model`, extending the packets/declarations clarification beyond the review template.
- **M4 — §§6.6/12:** Qualify the replacement-import fixture: changes only to redacted-away content can preserve `import_sha256`; use `original_hmac` to distinguish those originals.

## Ranked top five

1. **N1 — Major:** Resolve historical replay for redacted dirty snapshots.
2. **M1 — Minor:** Align evaluator precedence with its existing fixture.
3. **M2 — Minor:** Make external fixtures demonstrably offline.
4. **M3 — Minor:** Clarify transitive input closure.
5. **M4 — Minor:** Align replacement-import expectations with redacted identity.

**Open blockers: 0. Open majors: 1. Overall verdict: rework.**

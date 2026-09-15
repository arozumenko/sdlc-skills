# Adversarial review of the security-testing bundle spec (v6)

**Reviewer:** OpenAI Codex, model `gpt-6-astra`, reasoning effort `medium`, read-only
**Date:** 2026-09-15
**Subject:** spec v6 at commit 4f38d9f
**Result:** 0 blockers, 0 majors, 2 minors, no design disagreements, nothing reopened. Verdict: approve with changes.

---

# Verdict: approve with changes

**0 open blockers; 0 open majors.** V6 closes v5’s historical-replay defect at the contract level. Two minor editorial/test-setup clarifications remain.

Read-only review: no files modified; no installers or write-producing tests run. This approves the design, not an implementation.

## V5 finding dispositions

| Finding | Status | Assessment |
|---|---|---|
| **N1 — Historical replay of redacted dirty snapshots** | **Resolved** | §§2, 6.2, 6.3 and 6.5 explicitly distinguish original-content revalidation from redacted-snapshot consistency. §7 accepts the weaker result for review runs and reports it. §12 exercises replay after the original changes. |
| **M1 — Evaluator precedence** | **Resolved** | §6.4 explicitly records regression independently, then evaluates completeness. It specifies the unavailable-tests counterexample’s verdict and event. |
| **M2 — Offline external cache** | **Resolved** | §12 supplies actual Git caches with local bare origins, accommodating the installer’s fetch behavior. The Git URL rewrite prevents fallback to GitHub. |
| **M3 — Transitive inputs** | **Resolved** | §6.3 makes hash-referenced inputs transitively required and extends the verify/threat-model input lists. Missing dependencies prevent report creation. |
| **M4 — Replacement-import identity** | **Resolved** | §12 distinguishes changes to redacted bytes (`import_sha256`) from changes confined to removed content (`original_hmac`). |

**No previously resolved blocker or major is reopened.** In particular, v4’s F4/F19 replay issues, reopened by v5 N1, are now closed through an explicit reduction in assurance when original dirty content becomes unavailable.

## Repository verification

The header and §16’s principal claims match the actual repository:

- **Resolution and validation:** [item-resolver.mjs](`bin/lib/item-resolver.mjs:14`) uses `bundles/` and supports qualified IDs. [validate-factories.mjs](`bin/validate-factories.mjs:201`) permits empty `agents` with nonempty `localAgents` and checks declared local content files.
- **Installation:** [init.mjs](`bin/init.mjs:2835`) installs core hooks independently of factory selection; factory instructions and seeds require a selected factory. Bundle `targets` controls bundle hooks. Its [cache implementation](`bin/init.mjs:1149`) fetches existing Git caches, matching the revised fixture strategy.
- **Defaults and catalog:** [hooks/lib.sh](`hooks/lib.sh:215`) includes `RULES.md`; the example remains stale. `memory`, `knowledge-curation` and `verifying-outcomes` exist under `skills/`; `issue-tracking` resolves to feature-development. [package.json](`package.json:15`) includes external validation in `validate`.
- **Manual-QA:** The [lead](`bundles/manual-qa/agents/test-run-lead/AGENT.md:70`) globs the supplied suite and normalizes IDs. The [runner](`bundles/manual-qa/agents/test-runner/AGENT.md:91`) requires snapshot verification. The persisted [report format](`bundles/manual-qa/knowledge/test-run-report-format.md:20`) is Markdown, compatible with §6.6.
- **Test automation:** The [playbook](`bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md:204`) supports report JSON, partial coverage, independent findings and recovery requiring gate-evidence reconciliation. `delivered-unwitnessed` fits that boundary.
- `CLAUDE.md` and `bundles/SPEC.md` still contain the stale `factories/` wording identified for M-1.

## Section 2 promise audit

Checked against §§3–19 and the explicitly inherited v3 contracts.

| Promise | Script support | Result |
|---|---|---|
| Consistency and re-derivation | `check`, gate/coverage replay, receipt application, evaluator, register replay, renderer | Aligned |
| Snapshot integrity and current drift | `scope`, `check --integrity/--drift` | Aligned, including redacted-only and unavailable-key results |
| Validated test-start snapshot | `verify.mjs all`, post-install comparison, `tested_tree` | Aligned |
| Bounded redaction and keyed sensitive identities | `redact.mjs`, `gate`, snapshot/import writers | Aligned |
| Admitted-only canonical suite | `plan.mjs admit`, dedicated-suite writer | Aligned |
| Unauthenticated approvals | Receipt/register schemas and reporting | Aligned |
| Per-path change observation | Initialization baseline and sign-off comparison | Aligned with ignored-file exclusions |

**No remaining later contract promises more than §2, and no §2 promise lacks a named script.** The weaker replay result is an explicit limitation, not a claim to reconstruct discarded originals.

## Design disagreements

None. I accept the stated trade-offs: consistency rather than provenance, unauthenticated approvals, heuristic admission, dedicated suites and clean-tree assessments.

## Minor findings

- **Minor — §12, final snapshot fixture:** “sign-off still passes for that review run” omits engagement-level prerequisites. Specify a current, clean, committed assessment after the mutation and otherwise satisfied sign-off conditions; §7 already constrains this, and the listed E2E catches it.
- **Minor — header:** The Date annotation still says “v5”; change it to “v6”.

## Ranked top five

Ranked by importance of the reviewed closure, not as five open findings:

1. **N1 — Resolved:** Historical dirty-source replay now reports its actual assurance.
2. **M1 — Resolved:** Regression reporting and completeness have explicit precedence.
3. **M3 — Resolved:** Checker inputs are transitively closed.
4. **M2 — Resolved:** Offline installation fixtures accommodate real cache behavior.
5. **M4 — Resolved:** Import identity expectations match redacted persistence.

**Open blockers: 0. Open majors: 0. Overall verdict: approve with changes.**

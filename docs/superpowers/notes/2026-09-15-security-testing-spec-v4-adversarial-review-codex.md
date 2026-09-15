# Adversarial review of the security-testing bundle spec (v4)

**Reviewer:** OpenAI Codex, model `gpt-6-astra`, reasoning effort `medium`, read-only
**Date:** 2026-09-15
**Subject:** spec v4 at commit 33539a6
**Result:** 0 blockers, 5 majors, 7 minors, no design disagreements. Verdict: rework.

---

# Verdict: rework

**0 open blockers; 5 open majors.** V4 substantially improves the contract, but still contains a false-verification path, a redaction contradiction, and three mismatches between promises and supported behavior.

This was read-only. No files were modified; installers and write-producing tests were not run. “Resolved” below means resolved at design level.

## Repository verification

The header and §16’s principal repo claims check out:

- `bundles/` and qualified skill IDs are supported by [item-resolver.mjs](`bin/lib/item-resolver.mjs:14`).
- The validator permits empty `agents` with nonempty `localAgents`, and checks declared content files. See [validate-factories.mjs](`bin/validate-factories.mjs:201`).
- Core hooks install independently of factory hooks; standalone skill selection does not install factory seeds or instructions. See [init.mjs](`bin/init.mjs:2835`).
- Runtime memory defaults include `RULES.md`; the example is stale. [hooks/lib.sh](`hooks/lib.sh:215`)
- `memory` and `knowledge-curation` are top-level monorepo skills. `npm run validate` includes factories, marketplaces, network-using externals, and duplicates.
- Manual-QA globs the supplied suite, normalizes IDs, and sizes unsized cases. Its runner returns `PASS | FAIL | BLOCKED`. [test-run-lead](`bundles/manual-qa/agents/test-run-lead/AGENT.md:70`)
- TA supports partial coverage, independent findings, and recovery without witnessed gate evidence. V4’s `delivered-unwitnessed` treatment fits this.
- **Exception:** manual-QA’s persisted run report is Markdown, not the JSON report assumed by §6.6. Finding R4 below.

## F1–F20 disposition

| V3 finding | Status | V4 assessment |
|---|---|---|
| F1 — Cycles/allocation | **Resolved** | Payload-only identity and allocation before inputs remove the cycles. |
| F2 — Re-derivation | **Resolved** | §6.3 requires recomputation of the previously missing derived values. Explicit transitive-input enumeration is a minor clarification. |
| F3 — Non-secret fingerprint leak | **Resolved** | Finding identity now depends on content sensitivity, including the specified `password=1234` counterexample. |
| F4 — Redacted replay/key lifecycle | **Resolved** | The mandatory pre-discard comparison record, recorded-side HMAC, key retention, and `STRUCTURE-ONLY` result supply the necessary consistency contract. Replay wording needs a minor correction. |
| F5 — Tested bytes | **Resolved** | The promise is explicitly test-start validation, with post-install comparison and derived-snapshot labeling. |
| F6 — Multiple indicators/regression | **Resolved** | Indicator sets, individual ACKs, nonwaivable deletion, and independent regression observation address the original failures. |
| F7 — Receipts/states | **Still open** | Assertion production and packets improve, but the replacement evaluator accepts a valid indeterminate review as verification. **R1.** |
| F8 — `confirm` | **Removed** | Genuine confirmation is withdrawn; records remain unauthenticated. Acceptable. |
| F9 — Register integrity | **Resolved** | Equivalence/transfer, recovery, external anchors, and separate aliases address the original contract defects. |
| F10 — Artifact policy | **Resolved** | Initialization fails closed; publication profiles and cleanup are specified. New raw-persistence contradiction is **R2**. |
| F11 — Baseline/inventory | **Still open** | Inventory is fixed; the baseline excludes part of §2’s promised untracked-file coverage. **R3.** |
| F12 — Admission/glob | **Resolved** | A dedicated admitted suite fits the actual receiving lead. Direct-run refusal remains explicitly excluded. |
| F13 — Adapters | **Still open** | The manual-QA adapter requires an artifact the receiving bundle does not produce. **R4.** |
| F14 — Imported evidence identity | **Resolved** | Immutable imports, record locators, unknown fields, and unwitnessed-delivery labeling resolve the narrowed contract. The admission hash must not be interpreted as attestation of executed bytes. |
| F15 — Threat dispositions | **Resolved** | Execution now needs an observation; relationship validation replaces mere existence. |
| F16 — Standalone/M1 dependencies | **Resolved** | Runtime scripts and template initialization now reside in `security-evidence`. Positive sign-off setup needs clarification in the E2E fixture. |
| F17 — Fixtures | **Resolved** | The original counterexamples are listed. Offline dependency provisioning remains a minor implementation requirement. |
| F18 — Wording | **Still open** | §10 explicitly retains stronger v3 installation/catalog wording. **R5.** |
| F19 — Citation sides/snapshots/drift | **Resolved** | Side-aware integrity, reconstructible review snapshots, and scope drift address the original checking defects. Snapshot confidentiality is separately **R2**. |
| F20 — Publication/digest/export | **Resolved** | Commit markers, recomputed trusted digests, and derivative-versus-linked export results close the original issues. |

## Major findings

### R1 — Major — §6.4 evaluation; F7 still open

Exact v4 sentences:

> “if any check is missing/malformed ⇒ `UNVERIFIED-INDETERMINATE(<check>)`”

> “otherwise `VERIFIED` (with `ack_refs[]` if any).”

The same section explicitly permits `fix-review: … indeterminate`.

A present, schema-valid `indeterminate` receipt is neither missing nor malformed. With committed changes, passing tests, and no suppression indicators, it falls through to `VERIFIED`; the register then moves to `fixed`.

Section 17’s assertion/packet/duplicate fixes do not close this: the counterexample uses **one valid receipt**, not contradictory or malformed receipts.

**Concrete fix:** Require a validated, applied `not-refound` fix-review assertion before `VERIFIED`. Route `indeterminate` and unapplied receipts to `UNVERIFIED-INDETERMINATE`. Add this exact positive-tests/indeterminate-review fixture.

[Spec §6.4](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:222`)

### R2 — Major — §2 versus §§6.2, 6.5–6.6; new finding

Section 2 promises:

> “Bounded redaction before any persistence”

But §6.2 says a dirty review:

> “stores every dirty/untracked in-scope file's content under `private/snapshots/<run>/<path>` … so `check --integrity` can reconstruct it.”

And §6.6 says:

> “the artifact bytes are copied to `ledger/<run>/imports/<sha256>`”

For a dirty file or imported report containing a rule-matching password, these requirements conflict. Copying original bytes persists protected content; redacting them prevents reconstruction or byte-identical import preservation. Being private, ignored, or unencrypted does not establish an exception to “before any persistence.”

This requires a contract decision, not merely a writer implementation fix.

**Concrete fix:** Specify separate persisted representations. Imports can preserve canonical **redacted** bytes with identity defined over those bytes. For dirty snapshots, either withdraw sensitive dirty-snapshot support, or explicitly narrow §2 to permit restricted original-byte storage and define its handling. State the comparison/redaction/persistence order.

[Snapshot contract](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:136`) · [Import contract](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:284`)

### R3 — Major — §2 versus §6.9 baseline; F11 still open

Section 2 promises observation:

> “for tracked and untracked files under scope and product paths.”

The baseline instead covers:

> “every tracked file and every non-ignored untracked file under `scope_paths` and `product_paths`”

An ignored, untracked product configuration file can change without appearing in the baseline comparison. Section 17’s “incl. untracked” resolution does not close the explicitly excluded subset.

**Concrete fix:** Either include ignored untracked files beneath the declared paths, with explicit exclusions, or narrow §2 to **non-ignored untracked files** and report the excluded coverage. Test a changed ignored product file.

[Spec §6.9](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:344`)

### R4 — Major — §§6.6, 9.2; F13 still open

The exact §6.6 adapter row specifies:

> “`ingest qa-run` | manual-qa run report JSON”

The actual receiver persists `reports/{run_id}.md`. Individual runners return JSON to the lead; the reporter converts the collected results into Markdown. Neither the [reporter contract](`bundles/manual-qa/agents/test-reporter/AGENT.md:39`) nor the [report format](`bundles/manual-qa/knowledge/test-run-report-format.md:1`) defines a JSON report sidecar.

Thus a normal completed manual-QA hand-off does not yield the specified adapter input. Section 17 adds an adapter table but does not supply the missing producer or a compatible parser.

**Concrete fix:** Define ingestion of the existing Markdown report, preserving unavailable fields as unknown; alternatively, make a persisted JSON result artifact a required receiving-bundle change before advertising this integration. Add a fixture using the actual receiver’s output.

### R5 — Major under review rule 4 — §10 inherited wording; F18 still open

Exact v4 sentence:

> “Final `factory.json`: v3 §10 unchanged.”

It also retains:

> “`FACTORY.md`: v3 §10.”

The referenced v3 content advertises:

> “fix verification in an exact checkout”

V4 §2 deliberately permits tracked installation changes and identifies a derived test-start snapshot. The inherited catalog/manifest wording therefore promises more than §2. Section 17’s wording resolution cites D4/§6.3/§8/§15 but leaves this explicitly incorporated text intact.

**Concrete fix:** Replace the inherited manifest description and `FACTORY.md` wording with “fix verification from a validated test-start snapshot,” including derived-snapshot qualification where appropriate.

[Spec §10](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:450`)

## Section 2 promise audit

| Promise | Script support and result |
|---|---|
| Consistency/re-derivation | `check`, gate/coverage replay, receipt application, verification evaluation, register replay, renderer. Contract present; evaluator defect is R1. |
| Snapshot integrity/scope drift | `scope` and `check`. Supported; persistence conflicts with redaction in R2. |
| Validated test-start snapshot | `verify.mjs all`. Supported by narrowed contract; inherited stronger wording is R5. |
| Bounded redaction/no protected-content plain hashes | `redact`, `gate`, writers. Raw persistence contradicts the guarantee: R2. |
| Only admitted cases written to hand-off suite | `plan.mjs admit` and dedicated-suite writer. Supported within the canonical-output qualification. |
| Unauthenticated approval records | Receipt/register schemas and reporting. Supported. |
| Per-path change observation | Initialization baseline plus sign-off comparison. Incomplete for §2’s stated universe: R3. |

No §2 row entirely lacks a named script. The failures concern conflicting behavior or coverage.

## Design disagreements

None counted as findings. Consistency without provenance, unauthenticated approvals, heuristic admission, dedicated-suite hand-off, and clean-tree assessment are explicit, acceptable boundaries for this review. Stronger guarantees would require evidence of a separately trusted verifier, receiving-side execution enforcement, or a broader snapshot mechanism.

## Minor findings

- §6.3: enumerate packets and examined declarations as required transitive inputs.
- §6.5: say “compare the recorded `claimed_hmac`” rather than “recompute” it from a record containing no original claim.
- §§6.4/12: reconcile multiple ACK receipts with the broad conflicting-assertions rule.
- §6.4: explicitly apply the protected-content hash policy to suppression indicator identities.
- §12: provision external dependency fixtures; the full roster also references external skills.
- §§7/12–13: define the two-skill/M1 E2E’s assessment setup and expected sign-off result.
- §15: remove the inaccurate word-absence assertion.

## Ranked top five

1. **R1:** Prevent an indeterminate review from producing `VERIFIED`.
2. **R2:** Reconcile original-byte persistence with redaction.
3. **R4:** Consume the manual-QA report that actually exists.
4. **R3:** Align baseline coverage with §2.
5. **R5:** Remove inherited exact-checkout promises.

**Open blockers: 0. Open majors: 5. Overall verdict: rework.**

# Finding schema — the human reading

The machine contract is `security-evidence/references/finding.schema.json`
(plus `receipt.schema.json` and `verify.schema.json` for the states and
verdicts below). This page renders it for people and for the agents that
write claims: what a finding is, who is allowed to write which field, and
what every state and verdict token means. Where the two disagree, the
schema wins.

## Who writes what

**Scripts derive; agents assert.** A reviewer never writes a finding `id`,
a `state`, an `occurrence` or a `source` — those are assigned by
`evidence.mjs gate` after it re-resolves every citation against the run's
scope. An agent writes a **Claim**: a finding minus those four fields. A
claims file that carries any of them is rejected whole (`agent-wrote-id`)
and never reaches the report. The same rule holds for receipts: they carry
an `assertion`, and the derived state comes from `receipt apply`.

## The Claim (what a reviewer writes)

Claims live in `.agents/security-testing/receipts/<run_id>/claims-<n>.json`
(the agent drop-box) as `{scope_sha256, packet_sha256, findings: [Claim]}`,
where `packet_sha256` names the **scope packet** of the run the reviewer
was given. `gate --claims <file>` admits them.

| field | required | meaning |
|---|---|---|
| `title` | yes | one line, no secrets, no code |
| `class` | yes | one of `injection`, `xss`, `ssrf`, `path-traversal`, `deserialization`, `auth`, `authz`, `crypto`, `secret`, `input-validation`, `config`, `logging`, `dos`, `supply-chain`, `unmapped` |
| `priority` | yes | `p0` … `p3` (proposed; the lead may re-prioritise in the register) |
| `confidence` | yes | integer 0–10 |
| `path` | yes | repo-relative file path inside the scope packet |
| `side` | yes | `base`, `head` or `snapshot` — which bytes the citation is resolved against |
| `lines` | yes | `[start, end]`, 1-based, inclusive, `end - start + 1 ≤ 40`, inside an admitted range of the packet |
| `snippet` / `snippet_redacted` / `context_redacted` | exactly one | the cited text. Write `snippet`; `gate` replaces it with `snippet_redacted` (or `context_redacted` for `class: secret`) when a redaction rule matches |
| `occurrence_hint` | no | which occurrence of the snippet in the file you mean (0-based); `gate` recomputes `occurrence` regardless |
| `sensitive` | no | set by `gate`, ignored on input |
| `cwe` | no | `CWE-<n>` |
| `citations_typed` | no | `[{role: source|sink|control, path, side, lines, context}]`; a typed citation outside the admitted ranges is kept and flagged `context: true` |
| `requires_typed_citations` | no | `true` when the class needs source and sink to be shown |
| `description`, `impact`, `prerequisites`, `remediation` | no | prose; quoted text from imports is inert and redacted |

## The Finding (what `gate` writes)

`findings.claimed.json` = `{scope_sha256, findings: [Finding]}`. A Finding
is a Claim plus:

| field | meaning |
|---|---|
| `id` | 64-hex. `sha256(path\0class\0normalised snippet\0occurrence)` when no redaction rule matches the cited bytes; otherwise `HMAC_key(path\0class\0redacted normalised snippet\0occurrence)` with `sensitive: true`. Stable across runs for the same cited text |
| `state` | `CITATION_VERIFIED` or `CITATION_FAILED` (below) |
| `occurrence` | 0-based occurrence of the normalised snippet in the resolved file, recomputed by `gate` |
| `source` | `{kind: agent|sarif, ref: <claims file sha256 | import_sha256>, index}` — where the claim came from |

Every displayed finding value is recomputed by `check` from the same
inputs; nothing in the report is copied from an agent's text.

## Finding states

Derived, in this order, from the artifacts named in the right column.

| state | set by | meaning |
|---|---|---|
| `CITATION_VERIFIED` | `gate` | the cited range resolved on the recorded side and the normalised snippet was found at `occurrence` |
| `CITATION_FAILED` | `gate` | the citation did not resolve (path outside scope, range too long, snippet not found); the finding is **unverifiable** and no receipt can change that |
| `REVIEW_CONFIRMED` | `receipt apply` | a fresh `vulnerability-review` receipt over the finding's subject packet asserted `confirmed` |
| `REVIEW_REFUTED` | `receipt apply` | … asserted `refuted`; sticky until a new `vulnerability-review` receipt in a **different** run; `verify` refuses the finding (`4 UNVERIFIED-REFUTED-FINDING`) |
| `REVIEW_INDETERMINATE` | `receipt apply` | … asserted `indeterminate`, or two receipts in the same run disagreed |

A `CITATION_VERIFIED` finding with no receipt is shown as "not
independently reviewed"; it is still a verified citation, not a confirmed
vulnerability.

## Mitigation states (threat model, M2)

| state | meaning |
|---|---|
| `MITIGATION_CONFIRMED` | a `mitigation-review` receipt asserted `confirmed` over the mitigation's packet; the only state that satisfies a `mitigated` disposition |
| `MITIGATION_GAP` | … asserted `gap` |
| `MITIGATION_INDETERMINATE` | … asserted `indeterminate`, or conflicting receipts |

## Receipt assertions

A receipt is `{type, subject_id, packet_sha256, assertion, reviewer_run_id}`
written by a **fresh** reviewer dispatch — never by the instance that
authored the claim. `receipt validate` admits it; forbidden keys (`state`,
`verdict`, `id`, `gate`, `gate_stamp`, `states`) anywhere in the file reject
it by name.

| type | assertion |
|---|---|
| `vulnerability-review` | `confirmed` · `refuted` · `indeterminate` |
| `mitigation-review` | `confirmed` · `gap` · `indeterminate` |
| `fix-review` | `not-refound` · `refound` · `indeterminate` |
| `ack` | `{indicator_id}` — acknowledges one suppression indicator on one packet |

## Verify verdicts

Only `verify.mjs all` produces a public verdict; `verify.mjs evaluate` is
the pure function behind it and `check` re-runs it. The last line of `all`
is `VERDICT <token> finding=<id> base=<oid> head=<oid>
tested_tree=<hmac|same-as-head> verify=<sha256>`.

| verdict | meaning |
|---|---|
| `VERIFIED` | branch `COMMITTED`, tests passed, fix-review `not-refound` and applied, every suppression indicator acknowledged; the register row becomes `fixed` with the `ack_refs` |
| `REGRESSED` | a `fix-review` receipt asserted `refound` on a finding whose row was `fixed`; the row becomes `regressed` |
| `UNVERIFIED-REFOUND` | `refound` on a row that was not `fixed` |
| `UNVERIFIED-NOT-COMMITTED` | the branch check recorded `NOT-COMMITTED`: the fix is not a committed state at `head` (the other branch values are `COMMITTED` and `PATH-UNTOUCHED`) |
| `UNVERIFIED-TESTS-FAILED` | `TESTS_FAIL` |
| `UNVERIFIED-NO-TEST-SURFACE` | no `execute_project_tests` record, or `NO_TEST_SURFACE` |
| `UNVERIFIED-INDETERMINATE(<check>)` | a check is missing or indeterminate: `(tests)` (tests unavailable, timed out or install-modified tree), `(fix-review)` (no receipt, `applied: false`, or `indeterminate`), `(branch)`, `(suppression)`, `(packet_sha256)` |
| `UNVERIFIED-SUPPRESSION(deletion-only)` | the fix removes lines inside the cited range and adds none to that file |
| `UNVERIFIED-SUPPRESSION(<n> unacked)` | `<n>` suppression indicators (`ignore-file-edit`, `inline-suppress`, `test-skip`) without a matching `ack` receipt on this packet |
| `UNVERIFIED-REFUTED-FINDING` | refusal (exit 4, no run allocated): the finding's derived state is `REVIEW_REFUTED` |

Precedence: `refound_observed` is recorded first and unconditionally
(`regression-observed` event when the row was `fixed`), then completeness
(any missing check ⇒ `UNVERIFIED-INDETERMINATE(<check>)` even when a valid
`refound` exists), then the rest in the order of the table. Every
`UNVERIFIED-*` verdict exits `0`: the verdict is the result, not an error.

## Register statuses

Findings and threats that the lead adds to the register carry one of
`open`, `accepted`, `fixed`, `regressed`, `false-positive`, `superseded`.
Every approval-like record (`accept`, `close-false-positive`) is stored
with `authenticated: false` and reported under "unauthenticated
approvals"; there is no `confirm` command and no confirmed state.

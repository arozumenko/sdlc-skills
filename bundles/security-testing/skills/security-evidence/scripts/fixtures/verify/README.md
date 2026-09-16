# `fixtures/verify` — enveloped `verify.json` fixtures (TASK-026)

Real `verify.json` artifacts, one per rule of spec §6.4 step 7, each with the
packet and receipts its payload references — so `consume-verdict` (TASK-030),
`run snapshot verify` (TASK-058) and `check` (TASK-025) can be tested before
`verify all` (TASK-027) exists. Everything here is generated from `cases.mjs`
by `build.mjs`; `verify-fixtures.test.mjs` fails when a committed file differs
from a fresh build.

```
scripts/fixtures/
  evaluate/<rule>.raw.json          evaluate() input: the verify payload minus `evaluation`
  verify/<rule>.json                enveloped artifact, kind `verify`, run_id deadbeef0000-000N
  verify/packets/<sha256>.json      enveloped `packet` artifacts (kind subject, fix-review)
  verify/receipts/<sha256>.json     enveloped `receipt` artifacts (fix-review and ack)
  verify/cases.mjs                  the hand-authored source — edit this
  verify/build.mjs                  `node build.mjs` rebuilds in place; `--check` reports drift
  verify/README.md                  this file
```

## Invariants every consumer may rely on

- `verify/<rule>.json` reads with `canon.readArtifact(path, {kind: "verify"})`;
  its payload validates against `verify.schema.json`; `payload.evaluation`
  deep-equals `evaluate(payload minus evaluation)`; `evaluate/<rule>.raw.json`
  is exactly that remainder (pretty-printed, key order as written by `verify all`).
- `payload.packet_sha256` names `verify/packets/<packet_sha256>.json`, an
  enveloped `packet` artifact (kind `subject`, `subject_ids: [finding_id]`,
  side `head`) whose `envelope.self_sha256` is that value.
- every `payload.receipts[].sha256` names `verify/receipts/<sha256>.json`, an
  enveloped `receipt` artifact whose `self_sha256` is that value, with
  `subject_id = finding_id` and `reviewer_run_id = envelope.run_id`. A row with
  `applied: true` is a receipt on `packet_sha256`; `applied: false` carries a
  `not_applied_reason` (`oid-mismatch`, `packet-mismatch`). A `packet-mismatch`
  receipt names a second packet of the same run, also present in `packets/`.
- the pools contain nothing unreferenced; nothing in any fixture matches a
  redaction rule (so identities are plain sha256 and `writeArtifact` leaves
  the bytes unchanged).
- envelopes are constant: `schema_version: 1`, `engagement_id:
  fixture-engagement`, `key_id: k000000000000`, `created_at:
  2026-09-16T00:00:00Z`; `run_id` is `deadbeef0000-0001` … in `cases.mjs` order
  (`RULES` exports that order). Finding ids are `sha256("fixture:finding:<rule>")`,
  distinct per rule, so no two rules share a packet or a receipt.

## Rules and their verdicts

| rule | verdict | row at start | why |
|---|---|---|---|
| `refound-tests-unavailable` | `UNVERIFIED-INDETERMINATE(tests)` | fixed | §12: refound + `TESTS_INDETERMINATE` — indeterminate **and** `regression-observed` |
| `refound-not-applied` | `UNVERIFIED-INDETERMINATE(fix-review)` | fixed | §6.4 P5: the refound receipt is `applied: false` (oid-mismatch) ⇒ no observation, no event |
| `two-indicators-one-ack` | `UNVERIFIED-SUPPRESSION(1 unacked)` | open | two indicators, one ack |
| `deletion-only-wins` | `UNVERIFIED-SUPPRESSION(deletion-only)` | open | an unacked indicator too; deletion-only wins |
| `ack-different-indicator` | `UNVERIFIED-SUPPRESSION(1 unacked)` | open | the ack names an indicator that is not in the diff |
| `ack-different-packet` | `UNVERIFIED-SUPPRESSION(1 unacked)` | open | right indicator, other packet ⇒ `applied: false, packet-mismatch` |
| `ack-tests-fail` | `UNVERIFIED-TESTS-FAILED` | open | acked indicator, `TESTS_FAIL` |
| `missing-fix-review` | `UNVERIFIED-INDETERMINATE(fix-review)` | open | pass 1 of `verify all`: an ack only |
| `indeterminate-fix-review` | `UNVERIFIED-INDETERMINATE(fix-review)` | open | `TESTS_PASS` + assertion `indeterminate` |
| `refound-row-fixed` | `REGRESSED` | fixed | complete checks, refound, row fixed (+ `regression-observed`) |
| `refound-row-open` | `UNVERIFIED-REFOUND` | open | complete checks, refound, row not fixed |
| `not-committed` | `UNVERIFIED-NOT-COMMITTED` | open | branch `NOT-COMMITTED` |
| `no-test-surface` | `UNVERIFIED-NO-TEST-SURFACE` | open | `NO_TEST_SURFACE` |
| `verified-two-acks` | `VERIFIED` | open | both indicators acked; `ack_refs` has two entries |
| `verified-no-indicators` | `VERIFIED` | accepted | clean diff, `ack_refs: []` |
| `verified-tested-tree` | `VERIFIED` | regressed | install allowed tracked changes; `tested_tree` is an HMAC, not `same-as-head` |

## Using them as a fake COMMITTED verify run (TASK-058)

Copy `verify/<rule>.json` to `runs/<run_id>/verify.json` (with `run_id` =
`envelope.run_id`), `verify/packets/<packet_sha256>.json` to
`runs/<run_id>/packets/`, every `verify/receipts/<sha>.json` the payload lists
to `runs/<run_id>/receipts/`, then add the `COMMITTED` marker in TASK-023's
format. The `packet-mismatch` case additionally needs the other packet the
ack names (read it from the receipt payload) if the test copies transitively.

## Editing

Add or change a case in `cases.mjs` (the `verdict` field is documentation —
`build.mjs` fails if `evaluate()` disagrees), then run
`node scripts/fixtures/verify/build.mjs` from the skill root and commit the
regenerated files. Never hand-edit a generated file; the test will fail.

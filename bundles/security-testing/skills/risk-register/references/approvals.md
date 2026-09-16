# Approvals

An approval in this register is a *record that someone said so*, kept next to
the row so the claim and its reference are not lost. It is never a state the
bundle vouches for. This page is the shape of that record, when it exists on
a row, when it lapses, and why it never changes open exposure.

## The record

`register.mjs accept`, `register.mjs revoke` and
`register.mjs close-false-positive` each append one approval record as the
event's payload:

```
{recorded_by, approved_by, approval_ref, authenticated: false}
```

- `recorded_by` — the actor running the command (`--actor`,
  `SECURITY_EVIDENCE_ACTOR`, else `unknown`). You.
- `approved_by` — who you were told approved (`--approved-by <who>`).
  Mandatory; exit 2 without it.
- `approval_ref` — where the approval is written down
  (`--approval-ref <ref>`): a ticket, a review thread, a decision log, a
  message — something a reader can open outside this repository. Mandatory;
  exit 2 without it.
- `authenticated` — always `false`. The fold refuses a record carrying any
  other value, no verb sets another, and no schema admits one. The bundle
  cannot check that `approved_by` approved anything; it says so on every
  record rather than pretending.

An acceptance adds `until` (`--until <YYYY-MM-DD>`, a real UTC calendar day):
the date after which the acceptance no longer stands.

The same record shape is what a proposal's execution authorization carries
(`security-test-planning`, M3) — the bundle has one approval shape, and it is
unauthenticated everywhere.

## Where the record lives, and when it counts

The row carries the record as `acceptance` while its status is `accepted`,
and as `false_positive` while its status is `false-positive`. Every transition
out of those statuses strips it: `revoke`, `acceptance-expired` and `fixed`
remove `acceptance`; `reopen` removes `false_positive`; a
`--transfer-exposure` supersession that reopens the target drops both from
the target.

The one exception is a `superseded` row: the record left on it is history on
a dead row, and it is not an approval of anything. So the approval state is
read from `status`, never from the record's presence — a row is under an
acceptance iff `status` is `accepted`, closed as a false positive iff `status`
is `false-positive`. The rendered view and `sign-off` follow the same rule.

## Expiry

`register.mjs check` compares every accepted row's `until` with today's UTC
date. An acceptance whose `until` is strictly before today lapses: the script
appends `acceptance-expired` `{until}`, the row returns to `open`, and
`check` prints one `ROW <R-id> status=open …` line per expiry then
`CHECK expired=<n>`. On the `until` day itself the acceptance still stands;
it lapses at 00:00 UTC of the day after. Run `check` before `sign-off` and
before rendering the view for a stakeholder — an expired acceptance is
exposure with no record at all.

## The one bucket

`register.mjs status` (and `--json`) reports `unauthenticated_approvals`:
the number of rows that are `accepted`, plus the rows that are
`false-positive`, plus the rows whose `ack_refs` is non-empty (a fix that was
verified while suppression indicators were acknowledged by receipt). One
bucket, one adjective. `evidence.mjs sign-off` lists the same rows under
`UNAUTHENTICATED-APPROVALS: <n>`, and the rendered view's approvals section
opens with the sentence "None of these records is authenticated".

Say the number; do not split it into "approved" and "pending". Every record
in it has the same standing.

## Open exposure

`open_exposure` in `register.mjs status --json` (the `OPEN-EXPOSURE p0=<n>
p1=<n> p2=<n> p3=<n>` line in text form) counts, by priority, every row whose
status is `open`, `regressed`, `accepted` or `false-positive`. The last two
are the approvals: an accepted risk is still a risk, and a false-positive
closure is a claim that the finding is not real — a claim nobody
authenticated. Approvals never reduce open exposure; the number goes down
only when a row becomes `fixed` (a `VERIFIED` verdict consumed from
`verify.mjs all`) or `superseded` (its exposure moves to the target row).

If you are asked to "bring exposure down" by accepting rows: you can record
the acceptances, and the number will not move. Say so before you run the
command.

## What to say

- "recorded as unauthenticated; approval-ref `<ref>`" — for an acceptance or a
  false-positive closure.
- "expires `<until>`; `register.mjs check` will reopen it" — for an
  acceptance.
- "still in open exposure" — for every one of them.
- Never "approved", "confirmed", "signed off by `<who>`". The register has
  no such states, and `sign-off` is a check of the evidence set, not an
  approval of a risk.

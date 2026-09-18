# Approvals

An approval in this register is a *record that someone said so*, kept
next to the row so the claim and its reference are not lost. It is
never a state the bundle vouches for. This page is the shape of that
record, when it exists on a row, when it lapses, and why it never
reduces open exposure.

## The record

`register.mjs accept`, `register.mjs revoke` and `register.mjs
close-false-positive` each append one approval record as the event's
payload:

```
{recorded_by, approved_by, approval_ref, authenticated: false}
```

- `recorded_by` — the actor running the command (`--by`, else
  `$USER`, else `unknown`). You.
- `approved_by` — who you were told approved (`--approved-by <who>`).
  Mandatory; exit 2 without it.
- `approval_ref` — where the approval is written down
  (`--approval-ref <ref>`): a ticket, a review thread, a decision log,
  a message — something a reader can open outside this repository.
  Mandatory; exit 2 without it.
- `authenticated` — always `false`. The fold refuses a record carrying
  any other value, no verb sets another, and no schema admits one. The
  register cannot check that `approved_by` approved anything; it says
  so on every record — `authenticated: false` — rather than pretending.

An acceptance adds `until` (`--until <YYYY-MM-DD>`, a real UTC calendar
day) to the payload; `accept` also copies it onto the row's own
`accepted_until` field.

## Where the record lives, and when it counts

Every row keeps two things: an append-only `approvals` array — one
entry per `accept`, `revoke` or `close-false-positive` event, in order,
never removed — and a separate `accepted_until` field that holds only
the current acceptance's expiry (or `""`). `accepted_until` is cleared
on every transition that leaves `accepted`: `revoke`,
`acceptance-expired`, `fixed` and `supersede` all clear it.

The approval state is read from `status`, never from `approvals`'
presence — a row is under an acceptance iff `status` is `accepted`,
closed as a false positive iff `status` is `false-positive`. The
rendered view (`register.mjs render`) derives its "acceptance" /
"false-positive" table cell the same way: from the *last* entry of
`approvals` whose event matches the row's current status, not from a
dedicated field. A `superseded` row's `approvals` history is left in
place — it is history on a dead row, not an approval of anything.

## Expiry

`register.mjs check` compares every accepted row's `accepted_until`
with today's UTC date. An acceptance whose `accepted_until` is strictly
before today lapses: the script appends an `acceptance-expired {until}`
log event, clears the row's `accepted_until` and moves it back to
`open` — `acceptance-expired` is not an approval-like event and does
not touch `approvals`. `check` prints one `EXPIRED <id>` line per
lapsed row. On the `until` day itself the acceptance still stands; it
expires the UTC day after `accepted_until`. Run `check` before
rendering the view for a stakeholder — an expired acceptance is
exposure with no record at all.

## The one bucket

`register.mjs status` reports `UNAUTHENTICATED-APPROVALS <n>`: the
number of rows that are `accepted`, plus the rows that are
`false-positive`. One bucket, one adjective, every record in it has the
same standing — `authenticated: false`. There is no confirmed state and
no split into "approved" and "pending"; say the number.

## Open exposure

`register.mjs status`'s `OPEN-EXPOSURE p0=<n> p1=<n> p2=<n> p3=<n>`
counts, by priority, every row whose status is `open`, `regressed` or
`accepted`. An accepted risk is still counted as exposure — recording
an acceptance is not evidence the risk went away. A `false-positive`
closure is **not** counted here: it is a disposition (a claim the
finding is not real), not an ongoing risk, even though the claim itself
is unauthenticated and still shows in `UNAUTHENTICATED-APPROVALS`.
Approvals never reduce open exposure; the number goes down only when a
row becomes `fixed` (a verified fix consumed from `verify.mjs`) or
`superseded` (its exposure moves to the target row).

If you are asked to "bring exposure down" by accepting rows: you can
record the acceptances, and the number will not move. Say so before you
run the command.

## What to say

- "recorded as unauthenticated; approval-ref `<ref>`" — for an
  acceptance or a false-positive closure.
- "expires `<until>`; `register.mjs check` will reopen it" — for an
  acceptance.
- "still in open exposure" — for an accepted (but not a
  false-positive-closed) row.
- Never "approved", "confirmed", "signed off by `<who>`" — the register
  has no such states.

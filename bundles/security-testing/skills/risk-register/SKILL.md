---
name: risk-register
description: "Use when recording, accepting, expiring, closing, superseding or ticketing residual security risks in the append-only register, or reading its exposure and approval counts; provides register.mjs."
license: MIT
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
  version: "1.0.0"
---

# Risk register

One append-only log, `.agents/security-testing/register/events.jsonl`,
rows `R-nnnn`. Every command re-folds the whole log through
`lib/transitions.mjs`'s closed table and appends at most one line; a
`(event, from)` pair outside the table is refused, nothing is written.

## A row

```json
{"id": "R-0001", "finding_id": "<64-hex sha256>", "title": "…",
 "priority": "p1", "status": "open", "owner": "…", "ticket_url": "",
 "accepted_until": "", "approvals": [], "superseded_by": ""}
```

`status` is one of `open`, `fixed`, `regressed`, `accepted`,
`false-positive`, `superseded`. `approvals` is append-only — every
`accept`, `revoke` and `close-false-positive` event pushes one record
onto it; nothing is ever removed from it. `accepted_until` is cleared
on every transition that leaves `accepted` (including `supersede`).

## The ten events, `from → to`

- `add`: no row → `open` — `--finding <64-hex sha256> --priority
  <p0..p3> --title "<t>" [--owner <o>]`; sets `finding_id`, `title`,
  `priority`, `owner`. You run it.
- `accept`: `open` → `accepted`, `regressed` → `accepted` — appends an
  approval record to `approvals` and sets `accepted_until`. You run it.
- `revoke`: `accepted` → `open` — appends an approval record;
  `accepted_until` is cleared. You run it.
- `acceptance-expired`: `accepted` → `open` — fired by `register.mjs
  check` for every accepted row whose `accepted_until` is strictly
  before today (UTC); the acceptance still stands on that day itself
  and lapses at 00:00 UTC the next day. `accepted_until` is cleared.
  Emitter-only.
- `fixed`: `open` → `fixed`, `regressed` → `fixed`, `accepted` → `fixed`
  — fired by `verify.mjs`'s `VERIFIED` verdict; `accepted_until` is
  cleared if the row was `accepted`. Emitter-only.
- `regressed`: `fixed` → `regressed` — fired by `verify.mjs`'s
  `REGRESSED` verdict; only a `fixed` row can regress. Emitter-only.
- `close-false-positive`: `open` → `false-positive`, `regressed` →
  `false-positive` — appends an approval record. You run it.
- `reopen`: `fixed` → `open`, `false-positive` → `open` — status only;
  the prior `close-false-positive` record stays in `approvals`'
  history, it is not erased. You run it.
- `supersede`: `open` → `superseded`, `fixed` → `superseded`,
  `regressed` → `superseded`, `accepted` → `superseded` — sets
  `superseded_by`; `accepted_until` is cleared if the row was
  `accepted`. You run it.
- `ticket`: `open` → same, `fixed` → same, `regressed` → same,
  `accepted` → same (status unchanged) — sets `ticket_url`. You run
  it. Threats are not ticketed in v1: `ticket` is for finding rows.

## Approvals — one shape, unauthenticated everywhere

`accept`, `revoke` and `close-false-positive` each append an approval
record:

```json
{"recorded_by": "<actor>", "approved_by": "<who --approved-by named>",
 "approval_ref": "<--approval-ref>", "authenticated": false}
```

`accept` adds `until`. `authenticated: false` always — the fold refuses
any other value, and there is no confirmed state: nothing in this
bundle can produce an authenticated record, and the register never
claims one. `register.mjs status` reports the count as
`UNAUTHENTICATED-APPROVALS <n>` — one bucket, rows whose status is
`accepted` or `false-positive`; say the number, never split it into
"approved" and "pending".

## Open exposure is never reduced by an approval

`register.mjs status`'s `OPEN-EXPOSURE p0=<n> p1=<n> p2=<n> p3=<n>`
counts, by priority, every row whose status is `open`, `regressed` or
`accepted`. An accepted risk is still counted — an acceptance is a
record that someone said so, not evidence the risk is gone. The number
goes down only when a row becomes `fixed` (a verified fix) or
`superseded` (its exposure moves to the target row). A
`false-positive` closure removes the row from this count — it is a
disposition (a claim the finding is not real), not an approval of
ongoing exposure, so it is not counted as open risk; it still shows in
`UNAUTHENTICATED-APPROVALS` because the claim itself is unauthenticated.
If asked to "bring exposure down" by accepting rows: you can record the
acceptances, and the number will not move — say so before you run the
command.

## `register.mjs status`

`COUNT <status>=<n>` per status, `OPEN-EXPOSURE …`,
`UNAUTHENTICATED-APPROVALS <n>`, then
`FINGERPRINT <engagement_id>:<seq>:<sha256(events.jsonl)>`. Pass
`--expect <FINGERPRINT-line-or-value>` (from a previous sign-off) to get
one more line: `MATCH` (identical), `ADVANCED` (same engagement, higher
seq — exit 0), or `DIVERGED` (anything else — exit 4, history moved or
was rewritten). `--json` prints one JSON document, then the `--expect`
line if given — parse everything but the last line.

## `register.mjs render`

`register.mjs render` writes `.agents/security-testing/risk-register.md`
— `RENDERED <path>` — the table a stakeholder reads next to a sign-off
statement. Run `register.mjs check` first so an expired acceptance shows
as `open`, not stale.

## Commands

`node scripts/register.mjs --help`:

```
usage: register <command> [options]

commands:
  add
  accept
  revoke
  close-false-positive
  reopen
  supersede
  ticket
  fixed
  regressed
  check
  status
  render
```

Result lines: `ROW <id> <status>` (row verbs) · `EXPIRED <id>` (`check`,
one per lapsed acceptance) · the `status`/`render` lines above ·
`REFUSED <why>` (2) · `USAGE(<sub>: <why>)` (2) ·
`CORRUPT events.jsonl:<n> <why>` (5) · `ENGAGEMENT-*` (2). One writer at
a time: a duplicate-seq log (two concurrent invocations) is repaired by
deleting the later line, never by hand-editing an event in place.

## References

`references/transitions.md` — every `(event, from)` pair, its flags, its
emitter. `references/approvals.md` — the approval record's fields, where
it lives on a row, expiry, and what to say about it.

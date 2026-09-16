# Transitions

The register's status machine is one closed table (`lib/register-transitions`
under `security-evidence`'s scripts — the same table `check` and `sign-off`
re-fold over a snapshot). Every event below lists every `from → to` pair it allows, the flags
the verb requires, and the one command that emits it. Any `(event, from)` pair
not listed is refused with `4 TRANSITION-REJECTED(<event>: <from>)` and
nothing is appended; the generic `register.mjs transition <event> <R-id>
[flags]` additionally refuses every emitter-only event with
`2 EMITTER-ONLY(<event>)`.

Statuses: `open`, `accepted`, `fixed`, `regressed`, `false-positive`,
`superseded`. "no row" means the subject has no row yet; "same" means the
event leaves the status as it found it.

Before any verb runs, the recovery rule runs: a projection behind the log is
rebuilt; a projection ahead of the log or a broken hash chain (events or
aliases) is `5 CORRUPT` and nothing is written.

## Row verbs (you run these)

### `add`

- no row → `open`
- Flags: `--subject <finding_id|threat_id>`, `--priority p0|p1|p2|p3`, `--title <t>`, `--run <run_id>`; optional `--owner <o>`.
- Emitter: `add` (`register.mjs add …`). Sets `subject`, `subject_kind`,
  `title`, `priority`, `owner`, `first_seen_run`; the id `R-nnnn` is allocated
  by the script.

### `accept`

- `open` → `accepted`
- `regressed` → `accepted`
- Flags: `--until <YYYY-MM-DD>`, `--approved-by <who>`, `--approval-ref <ref>` — all three mandatory (exit 2 without).
- Emitter: `accept`. Payload is the approval record `{recorded_by, approved_by,
  approval_ref, until, authenticated: false}`; the row carries it as
  `acceptance` while the status is `accepted`. See [approvals.md](approvals.md).

### `revoke`

- `accepted` → `open`
- Flags: `--approved-by <who>`, `--approval-ref <ref>`.
- Emitter: `revoke`. Payload is an approval record (who revoked, where it is
  written); the `acceptance` record is removed from the row.

### `close-false-positive`

- `open` → `false-positive`
- Flags: `--approved-by <who>`, `--approval-ref <ref>`.
- Emitter: `close-false-positive`. Payload is an approval record; the row
  carries it as `false_positive` while the status is `false-positive`. A
  `regressed` or `accepted` row cannot be closed as a false positive: revoke or
  wait for the verdict first.

### `reopen`

- `false-positive` → `open`
- Flags: `--reason <r>`.
- Emitter: `reopen`. The `false_positive` record is removed; `rationale` is
  set to the reason.

### `supersede`

- `open` → `superseded`
- `regressed` → `superseded`
- `accepted` → `superseded`
- Flags: `--by <R-id>` plus exactly one of `--subject-equivalent` or
  `--transfer-exposure`; neither ⇒ `2 EQUIVALENCE-REQUIRED`.
- Emitter: `supersede`. Payload `{by, mode}`. Guards, in order: self, a
  missing target, a target whose supersession chain leads back to the source
  (cycle) or any already-`superseded` target ⇒ exit 2; `--subject-equivalent`
  without the same subject or an alias link between the two findings ⇒
  `4 NOT-EQUIVALENT(<R-id>: <R-id>)`. With `--transfer-exposure` the target is
  updated first — `priority` raised to the higher of the two, status set to
  `open` when the source was `open` or `regressed` (dropping any stale
  approval record) — then the source becomes `superseded` with
  `superseded_by`, and the target records `supersedes`. The source's exposure
  is not lost; it moves to the target.

### `alias`

- never touches a row (no row → no row): the line goes to
  `finding-alias.jsonl`, never to `events.jsonl`.
- Flags: `--from <finding_id>`, `--to <finding_id>`, `--reason <r>`, `--run <run_id>`.
- Emitter: `alias`. Records that two finding ids are the same finding
  (undirected, transitive); `supersede --subject-equivalent` reads this log.
  Prints `ALIAS from=<id> to=<id> seq=<n>`.

## Emitter-only events (a script appends them; you cannot)

### `acceptance-expired`

- `accepted` → `open`
- Flags: none — the payload `{until}` is the row's own acceptance date.
- Emitter: `check` (`register.mjs check`), emitter-only. Fires for every
  `accepted` row whose `until` (a UTC calendar day) is strictly before today:
  on the `until` day the acceptance still stands; it lapses at 00:00 UTC of
  the next day. The `acceptance` record is removed. `check` ends with
  `CHECK expired=<n>`.

### `fixed`

- `open` → `fixed`
- `regressed` → `fixed`
- `accepted` → `fixed`
- Flags: none.
- Emitter: `consume-verdict` (`register.mjs consume-verdict <verify.json>`
  on a `VERIFIED` verdict), emitter-only. Payload `{verify_sha256, ack_refs,
  last_verified_run}`: the verify artifact's identity, the acknowledged
  suppression receipts, the verify run id. Any `acceptance` is removed — a
  verified fix ends the acceptance.

### `regressed`

- `fixed` → `regressed`
- Flags: none.
- Emitter: `consume-verdict` on a `REGRESSED` verdict, emitter-only. Payload
  `{verify_sha256}`. Only a `fixed` row can regress; a `REGRESSED` verdict
  against a row in any other status is `4 TRANSITION-REJECTED(regressed:
  <from>)` and the log is untouched.

### `ticketed`

- any status → same (status unchanged); sets `ticket_url`.
- Flags: none.
- Emitter: `ingest tracker-readback` (`evidence.mjs ingest tracker-readback
  --sent <payload> <response>`), emitter-only. Payload `{ticket_url,
  import_sha256}`: the url the tracker answered with, on a host in
  `targets.tracker`, and the redacted import of that answer. The tracker's
  response is the evidence; a url you type is not.

### `regression-observed`

- any status → same (status unchanged); informational.
- Flags: none.
- Emitter: `consume-verdict`, emitter-only. Payload `{verify_sha256}`.
  Appended whenever the verify evaluation observed the finding refound while
  the row was `fixed` — before the status event, so the log's order is the
  evaluator's precedence.

### `verify-observed`

- any status → same (status unchanged); informational.
- Flags: none.
- Emitter: `consume-verdict`, emitter-only. Payload `{verify_sha256,
  verdict}`. Appended for every `UNVERIFIED-*` verdict: the attempt is on
  record, the status does not move.

## Reading the log

Every appended event prints `ROW <R-id> status=<status> priority=<p>
seq=<n>` (`supersede` prints the source then the target, same `seq`).
`register.mjs replay` rebuilds the projection from the log and prints
`REPLAY seq=<n> rows=<n> chain=<sha256>`; `--write` persists it and prints
`PROJECTION <path>`. `register.mjs status` prints one `COUNT <status> …` line
per status, in the order listed at the top of this page.

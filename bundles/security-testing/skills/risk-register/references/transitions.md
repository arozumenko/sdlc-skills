# Transitions

The register's status machine is one closed table (`lib/transitions.mjs`
`TRANSITIONS`, re-folded from the log on every command). Every event
below lists every `from → to` pair it allows, the flags the verb
requires, and the one command that emits it. Any `(event, from)` pair
not in the table is refused with `4 TRANSITION-REJECTED(<event>:
<from>)` and nothing is appended.

Statuses: `open`, `fixed`, `regressed`, `accepted`, `false-positive`,
`superseded`. "no row" means the finding has no row yet; "same" means
the event leaves the status as it found it. A row's `approvals` array
is append-only: `accept`, `revoke` and `close-false-positive` each push
one record onto it and nothing is ever removed from it; `accepted_until`
is a separate field, cleared on every transition that leaves `accepted`.

## Row verbs (you run these)

### `add`

- no row → `open`
- Flags: `--finding <64-hex sha256>` (from `cite.mjs check`),
  `--priority p0|p1|p2|p3`, `--title <t>`; optional `--owner <o>`.
- Sets `finding_id`, `title`, `priority`, `owner`; the id `R-nnnn` is
  allocated by the script.

### `accept`

- `open` → `accepted`
- `regressed` → `accepted`
- Flags: `--until <YYYY-MM-DD>`, `--approved-by <who>`, `--approval-ref
  <ref>` — all three mandatory, exit 2 without any of them.
- Payload is the approval record `{recorded_by, approved_by,
  approval_ref, until, authenticated: false}`, pushed onto
  `approvals`; `accepted_until` is set to `until`. See
  [approvals.md](approvals.md).

### `revoke`

- `accepted` → `open`
- Flags: `--approved-by <who>`, `--approval-ref <ref>`.
- Payload is an approval record, pushed onto `approvals`;
  `accepted_until` is cleared (the row is leaving `accepted`).

### `close-false-positive`

- `open` → `false-positive`
- `regressed` → `false-positive`
- Flags: `--approved-by <who>`, `--approval-ref <ref>`.
- Payload is an approval record, pushed onto `approvals`. An `accepted`
  row cannot be closed as a false positive: revoke it first.

### `reopen`

- `fixed` → `open`
- `false-positive` → `open`
- Flags: `--reason <r>`.
- Status only — `approvals` is untouched, so the prior
  `close-false-positive` record stays in the row's history even though
  the rendered view stops showing it once `status` is no longer
  `false-positive`.

### `supersede`

- `open` → `superseded`
- `fixed` → `superseded`
- `regressed` → `superseded`
- `accepted` → `superseded`
- Flags: `--by <R-id>`. Payload `{by}`, sets `superseded_by`;
  `accepted_until` is cleared if the row was `accepted`.

### `ticket`

- `open` → same
- `fixed` → same
- `regressed` → same
- `accepted` → same
- Records `ticket_url` on the row, status unchanged. Threats are not
  ticketed in v1 — `ticket` is for finding rows only; see
  `security-engagement/references/tracker-rules.md`.

## Emitter-only events (a script appends them; you cannot)

### `acceptance-expired`

- `accepted` → `open`
- Payload `{until}` — the row's own `accepted_until`.
- Emitter: `register.mjs check`. Fires for every `accepted` row whose
  `accepted_until` (a UTC calendar day) is strictly before today: on
  that day itself the acceptance still stands; it lapses at 00:00 UTC
  of the day after. `accepted_until` is cleared (`approvals` is
  untouched). `check` prints one `EXPIRED <id>` per row.

### `fixed`

- `open` → `fixed`
- `regressed` → `fixed`
- `accepted` → `fixed`
- Emitter: `verify.mjs` on a `VERIFIED` verdict. `accepted_until` is
  cleared if the row was `accepted` — a verified fix ends the
  acceptance.

### `regressed`

- `fixed` → `regressed`
- Emitter: `verify.mjs` on a `REGRESSED` verdict. Only a `fixed` row can
  regress; against a row in any other status the register refuses the
  transition and the log is untouched.

## Reading the log

Every appended event prints `ROW <id> <status>` (`supersede` prints the
source then the target). `register.mjs status` prints one `COUNT
<status>=<n>` line per status, in the order listed at the top of this
page, then `OPEN-EXPOSURE …`, `UNAUTHENTICATED-APPROVALS <n>`, and
`FINGERPRINT <engagement_id>:<seq>:<sha256>`.

## Concurrency

Single-operator CLI, no lock. Two concurrent invocations can both fold
the same `seq` and both append `seq + 1`; the next command's recovery
check then refuses with a seq-gap error. Fix: one writer at a time; a
duplicate-seq log is repaired by deleting the later line, never by
editing an event's fields in place.

## `--verify` paths

`fixed`/`regressed` accept a `--verify <verify.json>` path from
`verify.mjs`. Keep it under `.agents/security-testing/verify/` — a path
outside the working tree root is stored as the absolute path it was
given, embedding a machine-specific path in the shared log.

## Expiry timing

`register.mjs check` compares `accepted_until` against today's UTC date
with a strict `<`: an acceptance whose `until` equals today has **not**
expired yet — it expires the UTC day after `--until`.

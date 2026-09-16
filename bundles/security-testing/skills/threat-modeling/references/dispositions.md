# Dispositions — what `tm-lint check` validates

Every threat carries exactly one disposition `{kind, ref?}`. The kind is
your assertion; the script validates the **relationship** to the artifact
the ref names — not merely that something with that name exists — and
writes the result to `<run>/dispositions.json` (one row per threat,
`resolved_via` naming what validated it). `sign-off` reads that file, so a
disposition that did not validate never reaches a sign-off.

## The six kinds

| kind | `ref` | What must hold in the run directory | `resolved_via` |
|---|---|---|---|
| `undisposed` | none (an empty string is tolerated) | nothing — the honest default | `none` |
| `planned` | a proposal id (`P-nnn`) | the id is listed in `<run>/proposals-index.json` — the lead ran `evidence.mjs run snapshot proposals` after writing `<st>/proposals/<id>.proposal.md` | `proposal` |
| `planned` | a case id (64-hex `case_sha256`) | `<run>/admissions/<case_sha256>.json` exists (`plan.mjs admit`, M3) and names that case | `admission` |
| `executed` | an observation id (`O-<12 hex>`) | `<run>/observations/<id>.json` exists and names that observation (a QA run result ingested as an observation) | `observation` |
| `ticketed` | the ticket URL | an `ingest tracker-readback` record in `<run>/ingest/` whose trusted fields are `finding_id == T-nnn`, `url == ref` and `body_contains_finding_id == true` — the tracker's own read-back shows the ticket body carries the threat id | `tracker-readback` |
| `accepted` | a register row id (`R-nnnn`) | `<run>/register-events.json` (`run snapshot register`) replays to a row with `subject == T-nnn` and `status == accepted` — an acceptance record is stored `authenticated: false`; it disposes the threat, it approves nothing | `register-row` |
| `mitigated` | a mitigation id (`M-nnn`) | the id is one of **this** threat's mitigations and `receipt apply` over the run's receipts and packets derives `MITIGATION_CONFIRMED` for it (a `mitigation-review` receipt with `assertion: confirmed`, from a fresh reviewer) | `receipt` |

A ref is required for every kind but `undisposed` (`TM-INVALID(T-nnn:
<kind> requires a ref)`), and forbidden on it (`undisposed must not carry
a ref`).

## What a failure looks like

Always the threat id and the missing relationship, one per check, in
model order:

```
TM-INVALID(T-002: planned(P-009): proposal P-009 is not in proposals-index.json)
TM-INVALID(T-003: planned(<sha>): no admission record admissions/<sha>.json)
TM-INVALID(T-004: executed(O-…): no observation observations/O-….json)
TM-INVALID(T-005: ticketed(<url>): no tracker-readback record shows a ticket body at that url carrying T-005)
TM-INVALID(T-006: accepted(R-0001): register-events.json is not in the run (run snapshot register))
TM-INVALID(T-006: accepted(R-0001): row R-0001 subject is T-002, not T-006)
TM-INVALID(T-006: accepted(R-0001): row R-0001 status is open, not accepted)
TM-INVALID(T-007: mitigated(M-001): M-001 is not a mitigation of T-007)
TM-INVALID(T-007: mitigated(M-001): M-001 has no MITIGATION_CONFIRMED state (not independently reviewed))
```

Each names the artifact the lead has to produce (or the model the
threat-modeler has to correct); none can be fixed by editing the run.

## Order of operations, and why it matters

`check` snapshots the model **before** it validates relationships (after
structure — schema, ids, names, citations — passes). The
`mitigation-review` packet is built from that snapshot, so on a fresh run
the sequence is:

1. model with the threat `undisposed` (or already `mitigated(M-nnn)` —
   the first check then fails on that threat, but the snapshot is written);
2. `packet --kind subject --subject M-nnn` → fresh `security-reviewer` →
   `receipt validate`;
3. `tm-lint check` again with the same model: `mitigated(M-nnn)` now
   validates, `dispositions.json` is written, exit 0.

The same holds for every other kind: the evidence (`run snapshot
proposals`, `run snapshot register`, `ingest tracker-readback`, an
admission, an observation) can land after the snapshot; the model does
not change, the index does. A model that must change — a different ref, a
new threat — is a new run (`SNAPSHOT-EXISTS` says so).

## Sign-off policy

`engagement.md` `sign_off.require_dispositions` decides what the index
means at sign-off (spec §6.10):

| policy | `undisposed` / `planned` threats | listed |
|---|---|---|
| `executed-or-ticketed` (default) | do not block | yes, under `DISPOSITIONS:` |
| `all` | block: `DISPOSITIONS(<threat ids>)` | yes |
| `none` | not evaluated | `DISPOSITIONS: not evaluated` |

The threat-modeler never changes the policy; it is the lead's record.

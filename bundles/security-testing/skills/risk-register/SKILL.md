---
name: risk-register
description: Use when working the residual-risk register of the security-testing bundle — adding a row for a finding or a threat, recording or revoking an acceptance, closing a false positive, superseding a row, reading what open exposure and an unauthenticated approval mean, keeping the anchor a consumer can later verify, or refreshing the rendered risk-register.md view. Prose only; every command it names is register.mjs (or evidence.mjs) from the security-evidence skill installed next to it.
license: MIT
compatibility: Needs the security-evidence skill installed next to it (register.mjs and evidence.mjs are its scripts); git CLI. Prose only — no scripts of its own.
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
  version: "1.0.0"
---

# Risk register

The register is where a finding or a threat lives after a run has produced
it: one row per subject, an append-only event log behind it, and a rendered
Markdown view the lead reads. You add rows, record approvals and
supersessions, and re-render the view; the scripts decide every status.
Every command below is `register.mjs …` or `evidence.mjs …` from
`security-evidence` (`<scripts>` = `<skills dir>/security-evidence/scripts`;
on Claude Code `.claude/skills/security-evidence/scripts`). Run everything
from the repository root; `<st>` is `.agents/security-testing`.

## What a row is

A row is one subject under management. `register.mjs add --subject
<finding_id|threat_id> --priority p0|p1|p2|p3 --title <t> --run <run_id>
[--owner <o>]` creates it with id `R-nnnn` (four digits, allocated by the
script, never chosen) and status `open`. Its fields:

| Field | Meaning |
|---|---|
| `id` | `R-nnnn`, the row's identity; every later verb names it |
| `subject`, `subject_kind` | the finding id or threat id the row tracks; `subject_kind` is `finding` or `threat` |
| `title` | the one operator-authored text the view shows — no snippet, no path, no secret |
| `status` | one of `open`, `accepted`, `fixed`, `regressed`, `false-positive`, `superseded`; only a transition changes it |
| `priority` | `p0`…`p3`; set by `add`, raised only by a `--transfer-exposure` supersession |
| `owner` | free text, optional |
| `first_seen_run`, `last_verified_run` | the run that added the row; the verify run whose `VERIFIED` verdict last fixed it |
| `ticket_url` | set only by the `ticketed` event, which only `evidence.mjs ingest tracker-readback` emits |
| `test_refs`, `proposal_refs` | references hand-off tasks attach; never rendered |
| `acceptance`, `false_positive` | the approval record while the row is `accepted` / `false-positive` (see [references/approvals.md](references/approvals.md)) |
| `ack_refs` | receipt hashes of acknowledged suppression indicators, copied in by a `fixed` event |
| `rationale` | the `--reason` of the last `reopen` |
| `supersedes`, `superseded_by` | the two ends of a supersession |

Where it lives: `<st>/register/events.jsonl` is the hash-chained log
(`{seq, prev_sha256, ts, actor, row_id, event, payload, ref}`, genesis
`prev_sha256` of 64 zeros), `<st>/register/projection.json` is the fold of
that log, and `<st>/register/finding-alias.jsonl` is the separate, equally
chained log of finding-id equivalences. The JSON is the model of record;
`<st>/risk-register.md` is a derived view (D14). The register directory
sits inside the managed `.gitignore` block; the view sits outside it.

## Transitions

Every status change is an event of a closed table, and every `(event,
from)` pair outside that table is refused with `4 TRANSITION-REJECTED(<event>:
<from>)` before anything is appended. The table, event by event with every
`from → to` pair, its flags and its emitter, is
[references/transitions.md](references/transitions.md). The verbs you run:

| Verb | Effect |
|---|---|
| `register.mjs add …` | new row, `open` |
| `register.mjs accept <R-id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>` | `open` or `regressed` → `accepted` (unauthenticated record) |
| `register.mjs revoke <R-id> --approved-by <who> --approval-ref <ref>` | `accepted` → `open` |
| `register.mjs check` | expires every acceptance whose `--until` has passed (UTC) |
| `register.mjs close-false-positive <R-id> --approved-by <who> --approval-ref <ref>` | `open` → `false-positive` (unauthenticated record) |
| `register.mjs reopen <R-id> --reason <r>` | `false-positive` → `open` |
| `register.mjs supersede <R-id> --by <R-id> (--subject-equivalent \| --transfer-exposure)` | source → `superseded`; neither flag ⇒ `2 EQUIVALENCE-REQUIRED` |
| `register.mjs alias --from <finding_id> --to <finding_id> --reason <r> --run <run_id>` | records a finding-id equivalence; touches no row |
| `register.mjs consume-verdict <verify.json>` | folds a `verify.mjs all` verdict: `fixed`, `regressed`, or an observation |
| `register.mjs transition <event> <R-id> [flags]` | the generic form of the row verbs above |

## Events you cannot append by hand

Six events have no row verb: `ticketed` (emitted only by `evidence.mjs
ingest tracker-readback`, after the tracker's own response has been read
back and its finding id matched), `fixed`, `regressed`,
`regression-observed` and `verify-observed` (emitted only by
`register.mjs consume-verdict` from a `verify.mjs all` artifact whose
evaluation the script recomputes first), and `acceptance-expired` (emitted
only by `register.mjs check` from the calendar). They are **emitter-only**:
`register.mjs transition <event> …` refuses each with `2
EMITTER-ONLY(<event>)`, and there is no flag that lets a person append one.
The reason is the bundle's one rule about who says what: scripts derive,
agents assert (G-7). A `fixed` status is a verdict, a `ticket_url` is a
read-back from the tracker, an expiry is a date — each is *derived* from an
artifact the script can check, and a row that reached `fixed` because
someone typed it would carry a state no artifact supports. If you believe a
row should be `fixed`, run `verify.mjs all` and consume the verdict; if you
believe it is ticketed, post through `issue-tracking` and run the read-back.

## Approvals — there is no confirmed state

`accept`, `revoke` and `close-false-positive` store an approval record:
`{recorded_by, approved_by, approval_ref, authenticated: false}` (plus
`until` for an acceptance). `recorded_by` is you (`--actor`);
`approved_by` and `approval_ref` are what you were told and where it is
written down — a ticket, a review thread, a meeting note outside this
repository. The record says who *claims* to have approved and where to
look; it does not say the approval happened. The rule:
**there is no confirmed state — no command creates one.**
There is no `confirm` verb (D15), no flag that flips `authenticated`, and
the fold refuses a record with any other value of that field. When you report an acceptance, say "recorded as
unauthenticated; approval-ref <ref>". Details, the expiry rule and the
`superseded`-row exception are in
[references/approvals.md](references/approvals.md).

## Open exposure is never reduced by an approval

`register.mjs status` counts `open`, `regressed`, `accepted` **and**
`false-positive` rows as open exposure, by priority. An accepted risk is
still exposure; a false-positive closure is still exposure. A row leaves
exposure only through a script verdict (`fixed`) or a supersession
(`superseded`, whose exposure moves to the target row). Nothing you can
run subtracts an approval from that number — if a stakeholder wants the
number down, the fix is a verified fix, not a record.

## The anchor

`register.mjs anchor print` prints `<engagement_id>:<seq>:<chain_sha256>`,
a fingerprint of the exact state of the event log. Give it to the
consumer to keep **outside the repository** — in the ticket, the report
they receive, their own notes — because an anchor held next to the log it
witnesses proves nothing. A later `register.mjs anchor verify --expect
<engagement_id:seq:hash>` or `evidence.mjs sign-off --engagement
<engagement_id> --expect <anchor>` answers `MATCH`, `TRUNCATED` or
`DIVERGED`. Print a fresh anchor after the last register change of an
engagement; an anchor from before that change reads as `DIVERGED`.
[references/anchor.md](references/anchor.md) has the three answers and
what each one means.

## The rendered view

`register.mjs render` writes `<st>/risk-register.md` from the projection:
the header (engagement, `seq`, anchor), a table of eight columns —
`id | subject | priority | status | owner | ticket_url | last_verified_run | title`
— open exposure by priority, and the unauthenticated-approvals list. It
is the `security-lead`'s third `context-docs` entry: the shared hooks
inject it at dispatch, so the lead reads the register without opening the
JSON. It is
a derived view, redacted, outside the managed ignore block; it is stale
the moment the register changes, so **re-run `register.mjs render` after
every register mutation** (`add`, `accept`, `revoke`, `check`,
`close-false-positive`, `reopen`, `supersede`, `consume-verdict`, a
tracker read-back). Never edit it by hand — the next render overwrites it,
and nothing reads it back.

## Where to look

| Need | Read |
|---|---|
| Every event, every `from → to` pair, the flags, the emitter, what is emitter-only | [references/transitions.md](references/transitions.md) |
| The approval record, expiry, the one approvals bucket, why exposure never drops | [references/approvals.md](references/approvals.md) |
| The anchor: shape, where to keep it, `MATCH` / `TRUNCATED` / `DIVERGED`, `CORRUPT` | [references/anchor.md](references/anchor.md) |
| Every `register.mjs` command with its result lines and exit codes | the `security-evidence` skill's `SKILL.md`, § `register.mjs` |
| The lead's workflow around the register (when to add rows, when to render, sign-off) | the `security-engagement` skill |

## Common mistakes

| Mistake | What happens | Do instead |
|---|---|---|
| Calling an `accepted` row "approved" | the record is `authenticated: false`; the row stays in open exposure | "recorded as unauthenticated; approval-ref <ref>" — the approval lives in the tracker, not here |
| Trying `register.mjs transition fixed <R-id>` | `2 EMITTER-ONLY(fixed)` | `verify.mjs all` (two passes), then `register.mjs consume-verdict <verify.json>` |
| Writing `ticket_url` into the row by hand | the projection is rebuilt from the log; the edit is gone, or the register is `CORRUPT` | `evidence.mjs publish --profile tracker` → post → `evidence.mjs ingest tracker-readback --sent <payload> <response>` |
| Superseding with neither flag | `2 EQUIVALENCE-REQUIRED` | `--subject-equivalent` when both rows track the same finding (or an alias links them); `--transfer-exposure` otherwise |
| Reading the approval state from the record's presence | a `superseded` row may keep an old `acceptance` as history | read `status`; a record counts only while the status is `accepted` / `false-positive` |
| Keeping the anchor in the repository | anyone rewriting the log can rewrite the anchor next to it | print it, hand it to the consumer, keep it outside the repo |
| Editing `risk-register.md` | the next render overwrites it; nothing reads it back | change the register with a verb, then `register.mjs render` |

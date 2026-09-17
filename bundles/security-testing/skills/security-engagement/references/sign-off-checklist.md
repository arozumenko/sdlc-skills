# Sign-off checklist

`node <scripts>/evidence.mjs sign-off --engagement <engagement_id> [--expect <anchor>]`
is the one command that walks the ledger. It reads only; it prints a
verdict, then seven listings, in this order, and exits `0` on
`SIGN-OFF: OK` or `4` after one `SIGN-OFF: FAIL(<cause>)` line per cause
that holds (every cause is evaluated and reported; a per-run cause carries
` run=<run_id>`). The listings are printed either way — a failed sign-off
is still a report. Exit `2` is a bad argument: `--engagement` must be the
`engagement_id` of `engagement.md` (the baseline, policy and register all
belong to the record on disk); a malformed `--expect`. Exit `5` only when
`ledger/index.json` itself is not the file the bundle wrote.

## Before you run it

1. `node <scripts>/evidence.mjs engagement validate` — every line good.
2. `node <scripts>/evidence.mjs check <st>/runs/<run_id> --integrity --drift`
   on the latest assessment run yourself, so the failure you are about to
   see is one you have already read.
3. `node <scripts>/register.mjs check` — expired acceptances become `open`
   now rather than after the sign-off statement.
4. `node <scripts>/register.mjs render` — the register view is what the
   stakeholder reads next to the sign-off output.
5. If the consumer gave you an anchor from a previous sign-off, pass it as
   `--expect <engagement_id:seq:hash>`.

## Fail causes, in evaluation order

Each row: the `<cause>` exactly as the line spells it, what it means, and
what to do. Every cause but the first two and the register ones names its
run.

| `SIGN-OFF: FAIL(<cause>)` | Meaning | Do |
|---|---|---|
| `NO-ASSESSMENT` | the ledger holds no `COMMITTED` assessment run for this engagement; review runs alone never sign off (D12: the two-skill standalone shape ends here by design) | run the Assess phase; the other checks still run over what exists, so read the rest of the output |
| `INCONSISTENT(<field>)` | a `COMMITTED` run's `check --integrity` recomputed a derived value or re-hashed a citation and it differs from what the run recorded; `<field>` is the renderer's marker for the line (or `runs/<id>` when the run cannot be checked at all — a missing `run.json`, a tampered file, or a `ledger/index.json` entry whose `kind` is not the run's own `run.json` `template`; such a run is never taken as the latest assessment). On the latest assessment, `threat-model` means its snapshot cannot be read and `dispositions` means `<run>/dispositions.json` is not the index `tm-lint check` derives from that snapshot (a tampered envelope, rows that are not the snapshot's threats one-to-one, a row whose kind is not the snapshot's assertion) — the policy is then not evaluated | nothing in a run is repaired in place: a fresh run over the same base; if the tree did not change, the run directory (or the ledger) was edited — say so |
| `STRUCTURE-ONLY` | the run's key is unavailable, so only structure could be checked | `engagement validate` shows `KEY: unavailable`; the key was purged or the artifacts belong to a rotated-away key; a new run under the current key |
| `SCOPE-DRIFTED(<n> files)` | the latest assessment's scope files changed in the working tree since it was committed (`check --drift` on that run is not `CURRENT` at scope level) — its citations no longer describe the tree in front of the reader | a new assessment at the current head; `CITATION-DRIFTED(n)` alone (lines moved, scope files intact) is listed on the run's `RUNS:` entry and does not fail |
| `COVERAGE-INDETERMINATE(<run>)` | the latest assessment's scope was empty, so coverage could not be accounted (`COVERAGE INDETERMINATE`, D3 / P5) | `scope_paths` or `--include` selected nothing tracked; fix the record and rerun the assessment |
| `CORRUPT` | the register's recovery rule refused it: the projection is ahead of the log, or an event's `prev_sha256` does not chain | never edit `events.jsonl`; `register.mjs replay` diagnoses; a broken chain is an incident to report, not a state to fix by hand |
| `TRUNCATED` | `--expect` was given and the register's chain is shorter than the anchor says — events were removed | report it; the anchor the consumer holds is the evidence |
| `DIVERGED` | `--expect` was given and the chain reaches the anchor's `seq` with a different hash — history was rewritten | same: report, do not "repair" |
| `DISPOSITIONS(<threat ids>)` | `sign_off.require_dispositions: all` and the latest assessment has threats still `undisposed` or `planned` in `<run>/dispositions.json` — the index `tm-lint check` writes once every disposition's relationship validated. The snapshot's own `disposition.kind` is an assertion and is never read as a disposition: without that index (the model was never linted, or `check` failed a relationship after the snapshot was written) every threat of the snapshot counts as `undisposed` and is named here | dispose each (a validated test, ticket, acceptance or mitigation) and re-run `tm-lint check` on a run whose snapshot is not yet indexed — the index lands only when every relationship validates — or, with the product owner's agreement, set the policy to `executed-or-ticketed` in `engagement.md` and state that in the report |
| `TRACKED(<path>)` | git tracks a file under a managed path (`private/`, `ledger/`, `runs/`, `receipts/`, …) — the same fail-closed check `engagement init` runs; one line per tracked pattern | the human untracks the path; a committed private artifact is a disclosure to report |

## Listings, in print order

Informational: none of these changes the exit code (US-025 AC-5). They are
the residual you say out loud with the verdict.

| Header | Entries | Read it as |
|---|---|---|
| `RUNS: <n>` | one `  <run_id> seq=<n> kind=<k> <check line 1>[ <drift>]` per `COMMITTED` run of this engagement | every run the sign-off covers and how it checked; a `review` run may read `CONSISTENT-REDACTED-ONLY(n citations)` — accepted for review runs (a dirty file changed after it was cited) and never possible for an assessment |
| `INCOMPLETE: <n>` | one `  <run_id> seq=<n> kind=<k>` per ledger run without a `COMMITTED` marker | runs that were started and never built; they prove nothing and are not counted anywhere — a retry is a new run, so these accumulate by design |
| `CHANGES-SINCE-BASELINE: <n>` or `not observed` | one `  changed\|added\|removed <path>` per path under `scope_paths ∪ product_paths` whose working-tree content differs from the baseline `engagement init` took | what changed on disk during the engagement, tracked and non-ignored untracked files only; the bundle does not attribute a change to anyone (§2 last row); `not observed` means the baseline is absent or its key no longer loads |
| `EXCLUDED-COVERAGE: ignored=<n>` or `not observed` | one `  <configured path> ignored=<n>` per configured path | the git-ignored files under the observed paths, counted so the reader sees what the observation could not see |
| `UNAUTHENTICATED-APPROVALS: <n>` or `not observed` | one `  <R-id> status=<s> <kinds>` per register row carrying an acceptance, a false-positive closure or ack refs | every approval-like record, all `authenticated: false`; none of them reduced open exposure; `not observed` when the register is `CORRUPT` |
| `UNADMITTED: <n>` | one `  <path>` per file under `tasks/security-<slug>-admitted/` (the engagement's suite, plus any suite a case export manifest names) whose identity no `publish --profile case` recorded (`<st>/handoffs/<run_id>.case.export-manifest.json` `opts.members`) | a case placed in the suite by hand, a copy of a candidate, a README — anything `publish` did not write; informational (spec §7's fail table is closed), but the manual-qa lead globs that directory, so remove the file or admit it (the `security-test-planning` skill) and republish with `--profile case` before handing the suite over |
| `DISPOSITIONS: not evaluated` or `<n> undisposed-or-planned policy=<p>` | one `  <T-id> <kind>` per listed threat, read from the latest assessment's `<run>/dispositions.json` (every threat as `undisposed` when that index is absent — stderr says `not linted`) | `not evaluated` under policy `none`, without an assessment to read from, or when the snapshot or index is `INCONSISTENT`; under `executed-or-ticketed` the list is informational; under `all` it is also the `DISPOSITIONS(<threat ids>)` fail above |

## What `SIGN-OFF: OK` lets you say

Exactly the §2 promise table, qualified "for runs carrying a `COMMITTED`
marker produced by the canonical pipeline": every committed run is
consistent with its recorded inputs, the latest assessment's scope is
current, its coverage is accounted, the register chain is intact (and
matches the consumer's anchor if one was given), and no private artifact is
tracked. It does not say the code is secure, that anyone approved a risk,
or who changed the files in `CHANGES-SINCE-BASELINE:`. Hand over the
sign-off output, the rendered `risk-register.md`, the published report and
`register.mjs anchor print`'s line together.

# `templates/` — report templates and their required inputs

`evidence.mjs build-report --run <id> --template <name>` renders
`templates/<name>.md` over the run directory (spec §6.3; plan TASK-023/024).
`templates/knowledge/` is a different thing: the knowledge documents
`engagement init` step 0 seeds into a consumer (TASK-007/011).

## File shape

```
---
template: <name>            # must equal the file stem
template_version: <int>     # recorded in manifest.json (spec §6.1)
---

```required-inputs
<input>                     # one per line; a parenthesised note after the name is prose
<input> (note)
```

# Markdown body with two kinds of slot:
{{<view-path>}}             # a scalar from the view, sanitised, marked `<!-- v:<view-path> -->`
{{block:<name>}}            # a whole section the renderer builds (alone on its line)
```

The renderer is `scripts/lib/render.mjs` (pure): `parseTemplate(text)`,
`buildView(inputs, {key, rules, tool_version, template_version})`,
`renderMarkdown(view, template)`. Every line that carries a derived value
ends with a `<!-- v:<view-path> -->` marker (plan TL-7), so `check` can name
the field behind a byte difference without a Markdown parser. Every string
that comes from an input passes `sanitize()` (raw HTML removed, links
rendered as text, control and bidi characters stripped, fences and table
pipes escaped, structural line starts escaped) and the whole document
passes `redact.mjs` before it is hashed (G-4).

## Required inputs (closed, transitively closed — spec §6.3)

The list inside a template **is** the closed list; `scripts/lib/inputs.mjs`
declares the same lists as `REQUIRED` and `cmd-build-report` refuses to run
when the two disagree (a packaging bug, exit 1). A missing input ⇒ exit 3
`INCOMPLETE(<input>)`, no report. Every artifact an input references by hash
is itself required: `receipts → packets` (`INCOMPLETE(packet:<sha>)`),
`examined → packets` (its scope packet), `verify → packets` (the fix-review
packet), `verify-snapshots → their packets/receipts`, `observations →
imports`. `gate-result → scope + claimed` and `coverage → scope + examined`
are singleton references: the file is present or `INCOMPLETE(<name>)`, and
a hash that no longer matches is what the in-memory re-run refuses
(`5 INCONSISTENT(gate-result)` / `5 INCONSISTENT(coverage)`). Every input
artifact must be the run's own: `run.json` names its directory and every
other artifact's envelope names that run — a self-consistent artifact
copied in from another run is `5 INCONSISTENT(<file>)`.

| Template | Required inputs | Task |
|---|---|---|
| `review` | run, scope, claimed, gate-result, coverage, examined, packets, receipts (vulnerability-review; may be empty), rejects, unlocated | 023 |
| `verify` | run, verify, packets (the fix-review packet), receipts (fix-review, ack; may be empty) | 023 (PM log G12: moved here from 024 to break the 027 ↔ 024 cycle) |
| `assessment` | review inputs + engagement, threat-model, dispositions, receipts (mitigation-review), observations, imports, verify-snapshots, register-events, proposals-index — every one an artifact inside the run directory (spec P2): `run init --kind assessment` writes the empty indexes, `run snapshot register\|verify\|proposals` copies the rest in; `threat-model.json` absent ⇒ `INCOMPLETE(threat-model)`, `dispositions.json` absent ⇒ `INCOMPLETE(dispositions)` — both are written by `tm-lint check` (the snapshot and the script-derived index, write-once, R1), never by `run init`, so an un-linted model never reaches a report (TASK-048); the E2E runs `tm-lint check` over the empty model `{elements: [], threats: []}` | 024, 048 |
| `threat-model` | run, threat-model, packets (mitigation), receipts (mitigation-review), dispositions | 024 |

Input names map to run-directory files: `run.json`, `scope.json`,
`findings.claimed.json`, `gate-result.json`, `coverage.json`,
`examined.json`, `packets/*.json`, `receipts/*.json`, `rejects.json`,
`unlocated.json`, `engagement.json`, `threat-model.json`,
`observations.json` (+ `observations/*.json`), `imports.json`
(+ `ingest/*.json`), `verify-snapshots/*/`, `register-events.json`,
`proposals-index.json`, `verify.json`, `dispositions.json`.

## Manifest `inputs`

`manifest.json` records one sha256 per input: a singleton's
`envelope.self_sha256`; for a set (`packets`, `receipts`, `imports`,
`observations`, `verify-snapshots`) `sha256(canonical(sorted member
identities))` — the TL-14 index files never enter a preimage themselves,
the members they list do. `register-events` and `proposals-index` are
recorded by their own `self_sha256` (TASK-058's contract).

## Sections (v3 §11 order)

1 Identity · 2 Coverage · 3 Executive summary · 4 Scope and rules of
engagement · 5 Methodology · 6 Limitations · 7 Risk methodology · 8 Findings ·
9 Unresolved candidates · 10 Threat model and mitigation states · 11 Register
delta and proposed acceptances · 12 Chain of custody. `assessment` and
`review` render all twelve (`review` says `unknown / not assessed` where its
inputs carry nothing — never a blank cell). **Subsets keep the numbers**: a
section number means the same thing in every report, so `verify` renders
1, its own 2–5 (verdict, raw results, suppression, receipts), 6 and 12, and
`threat-model` renders 1, 5, 6, 10 and 12. A `CITATION_VERIFIED` finding
with no applied vulnerability-review receipt is shown as `not independently
reviewed`; so is a mitigation with no applied mitigation-review receipt.

### Section 3 of the assessment (spec §11) and the TL-16 reading

Counts by priority × state, unresolved by priority, rejected by reason, the
unlocated count and the unauthenticated-approvals bucket are all derived
inside the run directory (gate re-run, `receipt apply`, rejects, unlocated,
`register.mjs replay` over `register-events.json`). **Incomplete runs are
not**: the ledger lives outside the run directory (TL-3, G-16) and spec
§6.3's closed assessment list carries no ledger input, so the report cannot
count them without either reading outside the run or extending the closed
list (a §20 amendment). TL-16 (decided in TASK-024): the line reads `see
sign-off …`, marked `<!-- v:summary.incomplete_runs -->` so `check` still
names it, and `sign-off`'s `INCOMPLETE:` listing is the count's home. A
`run snapshot ledger` input was not added.

### Section 8 fields (assessment)

id, title, class/CWE, priority, confidence, state, affected asset,
description, impact, prerequisites, evidence, reproduction (`not attempted`),
remediation, `ticket_url` (from the register snapshot's row for the finding,
else `unknown / not assessed`) and verification history — verdicts from the
snapshotted `verify.json`s naming the finding plus the register events on
its row, never free text; `unknown / not assessed` when there are none.

### Limitations (every template)

`KEY: available` / `KEY: unavailable — keyed identities not re-derived for …`
for the run's own key (review, assessment), and one `KEY: unavailable —
artifacts whose key <key_id> has no key file: …` line per missing key across
every artifact in the closure (rotation leaves earlier artifacts under
earlier keys; spec §6.5 "the report's Limitations list them"). The assessment
adds the artifacts the engagement's `artifact_policy` marks `committed`
("outside the local policy") and the M1 note that no `verify` run means no
fix has been verified.

---
name: threat-modeling
description: "Use when deriving a data-flow diagram and STRIDE threats from code, with a citation per element and mitigations recorded as claims a fresh reviewer can confirm or refute; provides the threat-model.json shape cite.mjs check validates."
license: MIT
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
  version: "1.0.0"
---

# Threat modeling

You write a **code-derived DFD and STRIDE threats with citations**;
`cite.mjs check <st>/threat-model.json` re-reads every citation against the
bytes at `head` and validates the disposition grammar — everything else is
your judgement. Three rules hold everywhere:

1. **An element or a mitigation exists only because it is cited.** Same
   citation shape as a finding's (`references/dfd-elements.md`), same
   `FAILED <locus>.<i> <why>` vocabulary.
2. **A mitigation is a claim, not a fact** (`references/mitigations-as-claims.md`)
   — you never grade your own claim; a fresh `security-reviewer`'s
   `mitigation-review` does, and even that never rewrites the model.
3. **Never write `id`, `state`, `snippet_redacted` or `check_stamp`** —
   `check` refuses a file carrying them (D10), the same rule as findings.

## The shape

`{ head?, elements: [{id, name, kind, citations}], threats: [{id,
element_id, stride, title, mitigations, disposition}] }`.

```json
{
  "elements": [
    { "id": "E-001", "name": "HTTP handler", "kind": "process",
      "citations": [{ "path": "src/app.js", "lines": [1, 3], "snippet": "…" }] },
    { "id": "E-002", "name": "Orders table", "kind": "datastore",
      "citations": [{ "path": "src/orders.js", "lines": [40, 45], "snippet": "…" }] }
  ],
  "threats": [
    { "id": "T-001", "element_id": "E-002", "stride": "T",
      "title": "Order total tampered before it is charged",
      "mitigations": [
        { "id": "M-001", "claim": "createOrder recomputes the total from line items (lines 40-52)",
          "citations": [{ "path": "src/orders.js", "lines": [40, 52], "snippet": "…" }] }
      ],
      "disposition": "mitigated(M-001)" }
  ]
}
```

- `kind` ∈ `external | boundary | process | datastore | flow`
  (`references/dfd-elements.md` — which letters apply to which kind is in
  `references/stride.md`).
- `stride` ∈ `S | T | R | I | D | E`, one letter per threat.
- `disposition` ∈ `open | accepted(R-nnnn) | mitigated(M-nnn) |
  planned(TC-nnn) | out-of-scope(<reason>)` — the full grammar, what each
  ref must name and the one-run sequence are in `references/dispositions.md`.
- `id`s (`E-nnn`, `T-nnn`, `M-nnn`) are unique across the **whole** model,
  not just within their array.

## Procedure

1. Read `engagement.md`'s `scope_paths` — what you may cite.
2. **Enumerate entry points** — routers, handlers, consumers, schedulers.
3. **Elements, one citation each** — `external`/`process` at entry points,
   `boundary` at trust changes, `datastore`/`flow` at sinks and moves
   (`references/dfd-elements.md` § Where to start).
4. **STRIDE per element** — only the letters `references/stride.md`'s
   table marks for that `kind`; one threat per effect.
5. **Mitigations as cited claims** — a sentence a reviewer can confirm or
   refute from the citation alone (`references/mitigations-as-claims.md`).
6. **Dispositions** — the one you can justify now; `mitigated(M-nnn)` only
   when the mitigation is already in the model under that threat.
7. **`cite.mjs check <st>/threat-model.json`.**
8. **Fix `TM-INVALID`** — the locus and the missing relationship name what
   to correct; edit `threat-model.json` and `check` again.
9. **Candidate passive cases** — when a threat is worth an admitted test,
   draft it (never `admit` it yourself — that is the lead's `cases.mjs
   admit`) at `.agents/security-testing/cases/TC-NNN_<slug>.md`, `id:
   TC-NNN`, a `# ` heading as its title. A `planned(TC-nnn)` disposition
   only validates once the lead has admitted it.

## Result lines you will see

- `FAILED <locus>.<i> <why>` — `why` ∈ `bad-shape`, `path-not-in-scope`,
  `range-over-40`, `not-in-tree`, `snippet-not-found`.
- `TM-INVALID <locus>: <why>` — a structural or disposition defect, one per
  line, in document order (`references/dispositions.md`).
- `MODEL elements=<n> threats=<n> open=<n>` then
  `CHECK verified=<n> failed=<n>` — printed on every run; exit `4` on any
  `FAILED`/`TM-INVALID`, else `0`.
- `--md` after those: the elements/threats/mitigations tables, then
  `TABLES sha256=<hex>`.

## Your return line

`cite.mjs check` exits `0`, no `TM-INVALID` lines ⇒
`MODEL_WRITTEN elements=<n> threats=<n> open=<n>` (the counts from the
`MODEL` line). Anything else ⇒ the `TM-INVALID` lines verbatim — fix what
they name and `check` again before you reply if you can.

## Commands

`node scripts/cite.mjs --help` (from `secure-code-review/scripts/`, the
only script this skill uses):

```
usage: cite <command> [options]

commands:
  init
  show
  check
  redact
```

`show <path> [start end] [--at <oid>]` for reading; `check
<threat-model.json> [--md [--no-snippets]]` for validating; see
`secure-code-review/SKILL.md` for `init` and `redact`. Every string printed
or written is redacted (D9); the file is rewritten with `check_stamp` and,
per citation, `state`, `oid`, `snippet_redacted` — never edit a stamped
file by hand (`REFUSED agent-written key <key>`); fix the unstamped source
and let the lead re-run `check`.

## References

`references/dfd-elements.md` (the five kinds, the citation), `references/stride.md`
(the six letters, which apply to which kind), `references/mitigations-as-claims.md`
(the claim shape, the `mitigation-review` contract), `references/dispositions.md`
(the five-value grammar, the failure format, the one-run sequence).

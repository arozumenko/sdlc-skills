# Dispositions — the assertion `cite.mjs check` verifies

Every threat carries exactly one `disposition` string:

```
open | accepted(R-nnnn) | mitigated(M-nnn) | planned(TC-nnn) | out-of-scope(<reason>)
```

The kind is your assertion; `check` validates the **relationship** to the
artifact the ref names, not merely that something with that name exists.

## The five kinds

| kind | `ref` | What `check` verifies |
|---|---|---|
| `open` | none | nothing beyond the grammar — the honest default while you have not yet disposed the threat |
| `accepted` | `R-nnnn` | the id is a *live* row in `<st>/register/events.jsonl` — an `add` event whose latest event is not `supersede` or `close-false-positive` |
| `mitigated` | `M-nnn` | the id is one of **this** threat's own mitigations. `check` stops there — it does not require a `mitigation-review`; see `mitigations-as-claims.md` for what makes the claim trustworthy |
| `planned` | `TC-nnn` | the id's prefix is one of the cases in `tasks/security-<slug>-admitted/.admitted.json` (`cases.mjs admit`) |
| `out-of-scope` | free text | non-empty; no further check — say why in the ref itself |

A ref is required for every kind but `open`
(`TM-INVALID <id>: unknown disposition` when the string does not match the
grammar at all — an empty or missing `ref` on `accepted`/`mitigated`/
`planned`/`out-of-scope` simply fails to match it).

## What a failure looks like

Always the threat id (or `threats[<i>]` when the id itself does not match
`T-nnn`) and the missing relationship, one per line, in model order:

```
TM-INVALID T-002: mitigated(M-009): not a mitigation of this threat
TM-INVALID T-003: accepted(R-0001): no such register row
TM-INVALID T-004: planned(TC-004): not in the admitted suite
```

Each names what the lead has to produce (an admission, a live register
row) or what the model has to correct (a disposition naming the wrong
id); none can be fixed by editing anything but the model or that artifact.

## The one-run sequence

There is no separate run or snapshot step — write the model, `check` it,
fix what it names, `check` again:

1. Write `<st>/threat-model.json` with the disposition you can already
   justify — including `mitigated(M-nnn)` when you have a mitigation you
   believe is real.
2. `cite.mjs check <st>/threat-model.json`. Exit `0` and no `TM-INVALID`
   lines ⇒ the model is written; your return line is
   `MODEL_WRITTEN elements=<n> threats=<n> open=<n>` (the counts from the
   `MODEL elements=… threats=… open=…` line the script printed). Any
   `TM-INVALID` or `FAILED` line ⇒ fix the named element, threat,
   mitigation or citation in `threat-model.json` and `check` again; your
   return line is those `TM-INVALID` lines verbatim, unless you can fix
   and re-check before replying.
3. A `mitigated(M-nnn)` disposition that passed `check` stands in the
   model as written — `check` never re-derives it. The lead may separately
   ask a fresh `security-reviewer` for a `mitigation-review`, recorded as
   `second-M-nnn.json`; that review changes nothing about the model by
   itself; the lead reads it and, if the claim does not hold, disposes
   the threat again (step 1) with a different disposition.

## What the threat-modeler never does

Never invent a register row, an admission or an id to make a disposition
validate — `accepted`, `planned` and `mitigated` name artifacts the lead
(or `cases.mjs admit`) produced, not ones you assert into existence. An
undisposed threat you cannot yet justify stays `open`; that is not a
defect, it is the honest state of the model until the lead acts.

---
template: verify
template_version: 1
---

```required-inputs
run
verify
packets (the fix-review packet verify.json names)
receipts (fix-review, ack; may be empty)
```

# Fix verification — run {{run.run_id}}

## 1. Identity

{{block:identity}}

Timestamps live in artifact envelopes and are part of no identity (spec §6.1); this report carries none.

## 2. Verdict

{{block:verdict}}

The verdict is `verify.mjs evaluate` over the raw results below — a pure function `check` re-runs (spec §6.4 step 7, §6.3 derivation table). `VERIFIED` requires an applied `not-refound` fix-review assertion, `COMMITTED`, `TESTS_PASS`, no deletion-only change and an `ack` receipt per suppression indicator.

## 3. Raw results

{{block:raw}}

## 4. Suppression indicators

{{block:suppression}}

## 5. Receipts

{{block:receipts}}

## 6. Limitations

{{block:limitations}}

Not guaranteed (spec §2): test meaningfulness; that the class is closed at the sink; suppression detection beyond lexical indicators; origin of a consistent set. Local ≠ confidential.

## 12. Chain of custody

{{block:custody}}

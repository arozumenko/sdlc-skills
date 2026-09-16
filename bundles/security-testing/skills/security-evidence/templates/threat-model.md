---
template: threat-model
template_version: 1
---

```required-inputs
run
threat-model (the run's snapshot, written by tm-lint check from M2; the M1 empty model is {elements: [], threats: []})
packets (mitigation packets; may be empty)
receipts (mitigation-review; may be empty)
dispositions (the disposition references index tm-lint check writes)
```

# Threat model — run {{run.run_id}}

## 1. Identity

{{block:identity}}

Timestamps live in artifact envelopes and are part of no identity (spec §6.1); this report carries none. Section numbers follow the assessment template (v3 §11): a subset template keeps the numbers of the sections it renders (`templates/README.md`).

## 5. Methodology

Code-derived data-flow diagram with one citation per element; STRIDE per element; mitigations are claims a fresh reviewer may confirm, find a gap in or leave indeterminate through a receipt over a mitigation packet; every disposition names the record that resolves it (spec §6.10) and `tm-lint check` validates the relationship, not mere existence. Scripts derive every state shown here. Exploitation is excluded.

## 6. Limitations

{{block:limitations}}

Not guaranteed (spec §2): origin of a consistent set; that a model read what it declared examined; that any human approved anything. A disposition of kind `planned` or `undisposed` blocks sign-off only under `sign_off.require_dispositions: all` (spec §6.10). Local ≠ confidential.

## 10. Threat model and mitigation states

{{block:threat-model}}

## 12. Chain of custody

{{block:custody}}

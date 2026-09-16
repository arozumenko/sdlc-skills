---
template: review
template_version: 1
---

```required-inputs
run
scope
claimed
gate-result
coverage
examined
packets
receipts (vulnerability-review; may be empty)
rejects
unlocated
```

# Security review — run {{run.run_id}}

## 1. Identity

{{block:identity}}

Timestamps live in artifact envelopes and are part of no identity (spec §6.1); this report carries none.

## 2. Coverage

{{block:coverage}}

## 3. Executive summary

{{block:summary}}

## 4. Scope and rules of engagement

{{block:scope}}

Rules of engagement: read-only toward product code; no merge, close, rotate or fix; passive review over the scope packet only (D5, §4 body rules). Test argv, when any, comes only from the operator record in `engagement.md`.

## 5. Methodology

Evidence-gated secure code review: a reviewer produces claims over a scope packet; `gate` derives every id and citation state from the bytes at the cited side; a fresh reviewer may confirm, refute or leave a finding indeterminate through a receipt over a subject packet; scripts derive every state shown here. Exploitation is excluded. This is a security assessment, not a penetration test.

## 6. Limitations

{{block:limitations}}

Not guaranteed (spec §2): origin of a consistent set; that a model read what it declared examined; detection of secrets outside the redaction rule list; that any human approved anything. `check` recomputes every derived value from the recorded inputs and prints `ORIGIN: unauthenticated` unless a consumer-held digest is supplied. Local artifacts are not confidential artifacts: local ≠ confidential.

## 7. Risk methodology

Priority `p0`–`p3` and confidence `0`–`10` are the reviewer's assertions, recorded as claimed; gate rejects a claim that omits or caps neither (`claim-invalid`), never defaults them. States are script-derived: `CITATION_VERIFIED | CITATION_FAILED` from gate, `REVIEW_CONFIRMED | REVIEW_REFUTED | REVIEW_INDETERMINATE` from applied vulnerability-review receipts. Unresolved = findings whose citation failed.

## 8. Findings

{{block:findings}}

## 9. Unresolved candidates

{{block:unresolved}}

## 10. Threat model and mitigation states

{{block:threat-model}}

## 11. Register delta and proposed acceptances

{{block:register}}

## 12. Chain of custody

{{block:custody}}

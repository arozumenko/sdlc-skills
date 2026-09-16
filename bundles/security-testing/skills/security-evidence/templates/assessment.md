---
template: assessment
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
receipts (vulnerability-review, mitigation-review; may be empty)
rejects
unlocated
engagement (the run's snapshot of the engagement record)
threat-model (absent ⇒ INCOMPLETE(threat-model); the M1 empty model is {elements: [], threats: []})
observations (observations.json index + observations/*)
imports (imports.json index + ingest/*)
verify-snapshots (verify-snapshots/*/verify.json, closed over their packets and receipts)
register-events (register-events.json, written by run snapshot register)
proposals-index (proposals-index.json, rewritten by run snapshot proposals)
```

# Security assessment — run {{run.run_id}}

## 1. Identity

{{block:identity}}

Timestamps live in artifact envelopes and are part of no identity (spec §6.1); this report carries none. The assessment is a clean tree at `head_oid` for the assessed paths (D18 / P6).

## 2. Coverage

{{block:coverage}}

## 3. Executive summary

{{block:summary}}

## 4. Scope and rules of engagement

{{block:engagement}}

{{block:scope}}

Rules of engagement: read-only toward product code; no merge, close, rotate or fix; passive review over the scope packet only (D5, §4 body rules). Test argv, when any, comes only from the operator record in `engagement.md`, whose authorship is unverified.

## 5. Methodology

Threat-led security assessment: a code-derived threat model with a citation per element; evidence-gated secure code review — a reviewer produces claims over a scope packet, `gate` derives every id and citation state from the bytes at the cited side, a fresh reviewer may confirm, refute or leave a finding indeterminate through a receipt over a subject packet; mitigation claims reviewed the same way; fix verification from a validated test-start snapshot with a script-emitted verdict; a residual-risk register with unauthenticated acceptance records. Scripts derive every state, verdict and count shown here. Exploitation is excluded. This is a security assessment, not a penetration test.

## 6. Limitations

{{block:limitations}}

Not guaranteed (spec §2): origin of a consistent set; that a model read what it declared examined; test meaningfulness; that the class is closed at the sink; suppression detection beyond lexical indicators; detection of secrets outside the redaction rule list; that any human approved anything; attribution of a working-tree change to a role. `check` recomputes every derived value from the recorded inputs and prints `ORIGIN: unauthenticated` unless a consumer-held digest is supplied. Local artifacts are not confidential artifacts: local ≠ confidential.

## 7. Risk methodology

Priority `p0`–`p3` and confidence `0`–`10` are the reviewer's assertions, recorded as claimed; gate rejects a claim that omits or caps neither (`claim-invalid`), never defaults them. States are script-derived: `CITATION_VERIFIED | CITATION_FAILED` from gate, `REVIEW_CONFIRMED | REVIEW_REFUTED | REVIEW_INDETERMINATE` from applied vulnerability-review receipts, `MITIGATION_CONFIRMED | MITIGATION_GAP | MITIGATION_INDETERMINATE` from applied mitigation-review receipts, verify verdicts from `verify.mjs evaluate` over each snapshotted `verify.json`, register statuses from `register.mjs replay` over the events snapshot. Open exposure is never reduced by an acceptance, a false-positive record or an ack (spec §6.8). Unresolved = findings whose citation failed.

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

# Security assessment — <engagement_id>

<!-- Copy to reports/security/<date>-assessment.md, fill every <placeholder>,
     paste the tables `cite.mjs check --md` and `register.mjs status` print,
     then run `cite.mjs redact reports/security/<date>-assessment.md`. -->

## Identity

| | |
|---|---|
| Repository | <repo> |
| Head | <head oid> |
| Engagement id | <engagement_id> |
| Register | `FINGERPRINT <engagement>:<seq>:<sha256>` (from `register.mjs status`) |
| Tables | `TABLES sha256=<h>` (from `cite.mjs check --md`) |

## Coverage

<paste the coverage table and the `COVERAGE examined=<n> partial=<n> unexamined=<n>` line>

## Findings

<paste the findings table; one row per finding with its id, class, priority, state and register row>

## Threat model

<paste the elements, threats and mitigations tables from `cite.mjs check threat-model.json --md`>

## Register delta

<paste `register.mjs status`: counts, open exposure per priority, unauthenticated approvals>

## Limitations

What this assessment cannot promise:

- Origin: anyone with write access can author a consistent set. Reports are lead-written Markdown; only their pasted tables carry a `TABLES sha256`.
- That a model read what it declared examined.
- Detection of secrets outside the rule list.
- That a QA runner refuses a case handed to it directly.
- Test meaningfulness; that the class is closed at the sink.
- That any human approved anything.

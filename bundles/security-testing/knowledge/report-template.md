# Security assessment — <engagement_id>

<!-- Copy to reports/security/<date>-assessment.md, fill every <placeholder>.
     Order: paste the tables `cite.mjs check --md` and `register.mjs status`
     print, record each run's `TABLES sha256` in Identity, fill Verification
     from `.agents/security-testing/verify/` — then, LAST, run
     `cite.mjs redact reports/security/<date>-assessment.md`. redact leaves
     identities (oids, sha256s, finding ids) intact; it only strips secrets. -->

## Identity

| | |
|---|---|
| Repository | <repo> |
| Head | <head oid> |
| Engagement id | <engagement_id> |
| Register | `FINGERPRINT <engagement>:<seq>:<sha256>` (from `register.mjs status`) |
| Tables (findings) | `TABLES sha256=<h>` (from `cite.mjs check findings.json --md`) |
| Tables (threat model) | `TABLES sha256=<h>` (from `cite.mjs check threat-model.json --md`) |

## Coverage

<paste the coverage table and the `COVERAGE examined=<n> partial=<n> unexamined=<n>` line>

## Findings

<paste the findings table; one row per finding with its id, class, priority, state and register row>

## Threat model

<paste the elements, threats and mitigations tables from `cite.mjs check threat-model.json --md`>

## Register delta

<paste `register.mjs status`: counts, open exposure per priority, unauthenticated approvals>

## Verification

One row per run directory under `.agents/security-testing/verify/` (each
`verify.json`'s `finding_id`, `base`, `head`, `verdict`, `assertion.by`):

| Finding | Base | Head | Verdict | By |
|---|---|---|---|---|
| <id7> | <base7> | <head7> | <verdict> | <by> |

## Limitations

What this assessment cannot promise:

- Origin: anyone with write access can author a consistent set. Reports are lead-written Markdown; only their pasted tables carry a `TABLES sha256`.
- That a model read what it declared examined.
- Detection of secrets outside the rule list.
- That a QA runner refuses a case handed to it directly.
- Test meaningfulness; that the class is closed at the sink.
- That any human approved anything.

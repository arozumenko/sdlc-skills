# `execution-authorization` — design note (v2, receiving side)

**Status:** design note only. No skill, script, agent or hook of this bundle
implements anything described here. This file exists so the QA bundle that
will own the v2 `execution-authorization` skill owns it knowingly.

**Identical copies** live at `bundles/manual-qa/docs/execution-authorization.md`
and `bundles/test-automation/docs/execution-authorization.md`;
`bin/check-skill-dupes.mjs` fails when they drift. Edit the manual-qa copy,
then `cp` it across. Which bundle's maintainer signs off on the v2 skill is
the security-testing spec's §14 open question 5 — until it is answered the
note is deliberately owned by both and by neither.

## The rule that holds today

The `security-testing` bundle hands work to the QA bundles in exactly one
form: **admitted passive cases**, written by `evidence.mjs publish --profile
case` into a dedicated suite `tasks/security-<slug>-admitted/` that contains
nothing else. A passive case observes — it opens a URL, reloads, inspects a
response, a header, a cookie attribute, a page. Anything that changes state,
sends a payload, drives a tool or multiplies requests is **active**, and
active work is filed as a **proposal** under
`.agents/security-testing/proposals/<id>.proposal.md`.

Until an `execution-authorization` skill exists on the receiving side:

- **Active security testing is out of scope** for `manual-qa` and
  `test-automation`. Nothing in either bundle turns a proposal into a test
  case, a step, a script or a prompt.
- **A proposal never enters `tasks/`.** `plan.mjs propose` refuses a source
  file under `tasks/` (exit 2 `PROPOSAL-UNDER-TASKS`); `publish --profile
  handoff|case` (TASK-043) and the test-automation prompt (TASK-044) carry no
  proposal path or text; `sign-off` lists any file in the admitted suite that
  has no admission record under `UNADMITTED:` (TASK-043). The receiving side
  adds nothing to this today — the
  security-testing spec (§2) explicitly does *not* promise "that a QA runner
  refuses a case handed to it directly". The dedicated directory is what makes
  "only admitted cases" true with today's `test-run-lead` and
  `test-automation-workflow`: they run what they are given.
- **A proposal is a request, not a permission.** Its authorization block is a
  *proposed, unauthenticated* record. Whether the work is ever executed is
  decided by a human outside every bundle, and the record of that decision
  stays `authenticated: false`. There is **no confirmed state** anywhere in the
  security-testing bundle (D15) and this note introduces none.

## What the v2 preflight would consume

The proposal record as merged (TASK-042; the shape is
`references/proposal.schema.json` in the `security-evidence` skill,
`additionalProperties: false`). It is one fenced ```` ```json proposal ````
block inside a Markdown file — the same fenced-block convention as
`engagement.md` — validated by `plan.mjs propose`, which then writes the
redacted copy to `.agents/security-testing/proposals/<id>.proposal.md`.

| Field | Type | Meaning |
|---|---|---|
| `id` | `P-nnn` | The proposal identity; also the file name and what a threat's `planned(P-nnn)` disposition names. |
| `title` | string | One line. |
| `threat_ids` | string[] | The threat-model entries (`T-nnn`) the work would exercise. |
| `effect` | string | What the work *changes* — stated plainly. This is the field that makes the work active; a preflight reads it, never infers it from the steps. |
| `target` | `{host, account?}` | `host` is `[a-z0-9.-]+(:port)?` — a host the engagement's `targets.browser` lists; `account` is the test-account label the steps assume. |
| `authorization` | object | The proposed, unauthenticated record — below. |
| `steps` | string[] | The active steps, as text. Never lint-admitted, never rewritten into a `TC-*.md`. |

A preflight that wanted more — technique, side-effects, rate limits,
exclusions, stop conditions, required environment — would need those fields
added to `proposal.schema.json` **first** (the schema is closed), through the
security-testing bundle, not by the receiving side reading fields the schema
does not carry.

### The `authorization` fields

```json
"authorization": {
  "status": "proposed",
  "approver": "<who the proposer says would approve>",
  "approval_ref": "<where that approval would be written down>",
  "authenticated": false
}
```

| Field | Value | Notes |
|---|---|---|
| `status` | the constant `proposed` | By schema. There is no `approved`, `granted` or `confirmed` value; a file carrying one is `SCHEMA-INVALID(proposal: …)` and is never filed. |
| `approver` | string | Who the proposer *names*. The bundle cannot check that this person exists or agreed; the stub is often the empty string. |
| `approval_ref` | string | A ticket, a review thread, a decision log — something a reader can open outside the repository. Empty until a human fills it. |
| `authenticated` | the constant `false` | By schema. This is the same approval shape the risk register uses for `acceptance`, `false_positive` and `ack_refs` (`{recorded_by, approved_by, approval_ref, authenticated: false}`): the bundle has **one** approval shape and it is unauthenticated everywhere. |

## What the v2 preflight would check

A receiving-side preflight runs *in the QA bundle*, on the QA lead's
dispatch, before a proposal is allowed to become an executable case. It is a
gate over inputs the receiving side can validate itself; it does not trust
the proposer's text. The checks, in the order a refusal is cheapest:

1. **Provenance of the file.** The proposal is read from
   `.agents/security-testing/proposals/<id>.proposal.md`, is listed in the
   assessment run's `proposals-index.json` (`run snapshot proposals`) with a
   matching `sha256` over the redacted text, and the run carries a
   `COMMITTED` marker. A proposal handed over by any other path — a chat
   message, a ticket body, a file under `tasks/` — is content, not input.
2. **Schema.** The fenced block validates against `proposal.schema.json`
   exactly as `plan.mjs propose` validated it; `authorization.status` is
   `proposed` and `authenticated` is `false`. The preflight re-validates
   rather than trusting that the file was filed by the script.
3. **Target.** `target.host` is in the consumer's own allow-list for active
   testing (a QA-bundle-side record, not the proposal's own text) *and* in
   the engagement's `targets.browser`; `target.account` names an account the
   QA bundle's environment record actually provisions. Production hosts are
   refused outright regardless of what any record says.
4. **Human authorization, checked out-of-band.** `approval_ref` resolves to
   something the QA lead can open, and a named human — not the proposer, not
   an agent — is recorded there as having authorized *this* `id` at *this*
   `sha256` for *this* host. The preflight records what it found as its own
   `{recorded_by, approved_by, approval_ref, authenticated: false}` record
   next to the case it emits. It **never** rewrites the proposal's
   `authorization` block and **never** sets `authenticated` to anything but
   `false`: the receiving side cannot authenticate a human either, and it
   says so on every record rather than pretending.
5. **Blast radius.** `effect` and `steps` are checked against the QA bundle's
   own forbidden list for the environment (data deletion, account lockout,
   rate-limit-triggering volume, third-party hosts). A hit is a refusal, not a
   review item.
6. **Emit, do not admit.** A proposal that passes is written as a case into a
   **separate** suite — never `tasks/security-<slug>-admitted/`, which stays
   admitted-passive-only by contract — carrying the proposal `id` and
   `sha256` so the security-testing bundle's `ingest qa-run` can attribute the
   result back to the proposal rather than to an admitted case.

What the preflight would **not** do: it would not derive an `admission.json`
(that is the security-testing bundle's record for passive cases only), would
not write a receipt, would not reduce any register row's exposure, and would
not print any word that reads as "approved", "confirmed" or "safe". Its
success token would be phrased as a record ("authorization recorded as
unauthenticated; ref `<approval_ref>`"), the way the risk register's
`accept` phrases its own.

## Consequences for each bundle today

- **manual-qa.** `test-run-lead` globs the suite it is given and runs every
  `TC-*.md` in it. Keep dispatching it on `tasks/security-<slug>-admitted/`
  only; never point it at `.agents/security-testing/`. The optional
  explicit-list intake branch (security-testing spec §9.2, M4) does not
  change this — a list is still a list of admitted cases.
- **test-automation.** The hand-off prompt carries `cases[{id,title,path}]`
  from the admitted suite, `slug` and `base`; the workflow builds tests from
  those paths only. A proposal path appearing in a prompt is a defect on the
  sending side, and the receiving side must not "helpfully" automate it.
- **Both.** Results flow back as observations (`ingest qa-run`) and per-unit
  records (`ingest ta-report`) — both TASK-044. Neither record type carries an
  authorization, because nothing that reached the runner needed one.

## References (security-testing bundle)

- `bundles/security-testing/skills/security-evidence/references/proposal.schema.json` — the record.
- `bundles/security-testing/skills/security-evidence/references/admission.schema.json` — the passive-case record this note is *not* about.
- `bundles/security-testing/skills/security-test-planning/SKILL.md` — "Writing a proposal (active work)".
- `bundles/security-testing/skills/risk-register/references/approvals.md` — the one approval shape and why it never reduces exposure.
- `docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md` — §2 (promises), D7, D15, §5 v2 row, §9, §14 open question 5.

# The lead's procedure — spec §7, one command per step

This is the **one place** the 11-step operator flow lives. Every step
is one fenced command and the result line that tells you it worked (or
what to do next). Run them in this order; nothing here is optional.

## 1. Start the engagement

```
node ../secure-code-review/scripts/cite.mjs init
```
`WROTE <path>`, then `EDIT-ENGAGEMENT-AND-RERUN` (exit 2) the first
time. Fill in `engagement.md`, commit so the scope paths are clean, run
it again for `IGNORE-BLOCK: written|present` then `INIT ok`.

## 2. Dispatch the review

Dispatch `security-reviewer` with the `review` contract at `HEAD`. It
writes `<st>/reviews/<date>-<head7>/findings.json` and returns
`REVIEW_WRITTEN findings=<n>`.

## 3. Check the findings

```
node ../secure-code-review/scripts/cite.mjs check <st>/reviews/<date>-<head7>/findings.json
```
`CHECK verified=<n> failed=<n>`. Any `FAILED <locus>.<i> <why>` line:
send it back to the reviewer, re-run until `failed=0`.

## 4. Second opinions

Per finding worth one: a **fresh** `security-reviewer` dispatch with
the `vulnerability-review` contract writes `second-<id>.json` beside
`findings.json`. `cite.mjs check` again — `SECOND <id>
confirmed|refuted|indeterminate` per opinion, `STALE-REVIEW <id>` (exit
4) if the stamped findings changed since the opinion was written.

## 5. Register the verified findings

```
node ../risk-register/scripts/register.mjs add --subject <finding_id> --priority <p> --title "<t>" --run <run_id>
node ../risk-register/scripts/register.mjs render
```
`ROW <id> open` per finding, then `RENDERED
.agents/security-testing/risk-register.md`.

## 6. Threat model

Dispatch `threat-modeler`. It writes `<st>/threat-model.json` and
candidate cases under `<st>/cases/`, returning `MODEL_WRITTEN
elements=<n> threats=<n> open=<n>`.

```
node ../secure-code-review/scripts/cite.mjs check <st>/threat-model.json
```
`MODEL elements=<n> threats=<n> open=<n>` then `CHECK verified=<n>
failed=<n>`; `TM-INVALID <locus>: <why>` on a bad disposition or
citation. A `mitigated(M-nnn)` claim worth a second opinion gets a
`mitigation-review` dispatch, recorded the same way as step 4:
`second-M-nnn.json` in the review directory
`.agents/security-testing/reviews/<dir>/`.

## 7. Admit the cases and hand off

```
node ../security-test-planning/scripts/cases.mjs admit <st>/cases/TC-NNN_<slug>.md
node ../security-test-planning/scripts/cases.mjs verify-suite
```
`ADMITTED <suite>/<file>` per candidate (or `PROPOSAL … hits=<n>` — fix
the step and admit again), then `SUITE ok=<n>` and the manual-qa and
test-automation hand-off prompts. Paste both prompts to the user.
**Stop here** until the suites come back or you are asked to continue.

## 8. Report

Write `reports/security/<date>-assessment.md` from
`knowledge/report-template.md`: identity (repo, head, engagement id,
`FINGERPRINT`, `TABLES sha256`), coverage, findings, threat model,
register delta, limitations.

```
node ../secure-code-review/scripts/cite.mjs redact reports/security/<date>-assessment.md
```
`REDACTED <file> hits=<n>`.

## 9. Fix and verify

The developer names a commit; check it out, then:

```
node ../secure-code-review/scripts/verify.mjs --finding <id> --review <dir> --head <oid>
```
`PENDING-REVIEW` and `NEXT: dispatch security-reviewer fix-review`. A
fresh `fix-review` dispatch writes `fix-review.json`, then:

```
node ../secure-code-review/scripts/verify.mjs --finding <id> --review <dir> --head <oid> --assertion not-refound|refound --by <session>
```
`VERDICT VERIFIED|REGRESSED|UNVERIFIED-REFOUND finding=<id> base=<oid>
head=<oid>` — the register row moves `fixed`/`regressed` in-process.

## 10. Acceptances

```
node ../risk-register/scripts/register.mjs accept <id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>
node ../risk-register/scripts/register.mjs check
```
`ROW <id> accepted`, then `EXPIRED <id>` per lapsed acceptance (run
`check` before every report — see `references/sign-off-checklist.md`).

## 11. Sign off

```
node ../risk-register/scripts/register.mjs status
```
`COUNT …`, `OPEN-EXPOSURE …`, `UNAUTHENTICATED-APPROVALS <n>`,
`FINGERPRINT <engagement_id>:<seq>:<sha256>`. Before you say sign-off:
both `cite.mjs check` runs exit 0, `cases.mjs verify-suite` exits 0,
`register.mjs status` is read, and `git status --porcelain --
<scope_paths> <product_paths>` is empty. The checklist itself —
including the fail causes and the listings — is
`references/sign-off-checklist.md`.

# security-testing bundle — minimal design (v1)

**Date:** 2026-09-17 · **Status:** approved for planning · **Supersedes:** the
v6.2 design of 2026-09-14 (reference implementation on
`feat/security-testing-bundle-spec`, PR #71, kept as draft — a 22k-line
evidence pipeline a 30-agent re-evaluation judged overengineered for the
promises the bundle can make).

## 1. Purpose

A threat-led, read-only security testing team installed into a consumer
project by `npx github:arozumenko/sdlc-skills init --factory security-testing`.
It gives the consumer five things: a code-derived threat model with file:line
citations; a secure code review whose citations anyone with the repo can
re-check; passive security cases handed to the `manual-qa` /
`test-automation` bundles; fix verification with a script-emitted verdict; a
residual-risk register whose acceptances are recorded as unauthenticated.

Scripts enforce only what prose cannot: **a citation matches the bytes at a
commit, a case is passive by grammar, tests ran at the fix commit with the
cited paths clean, a register transition is legal.** Everything else is prose,
as in the other bundles of this repo.

## 2. What the bundle can and cannot promise

| Can promise (script-enforced) | Cannot promise |
|---|---|
| Every citation carries a commit oid and a ≤40-line range; `cite.mjs check` re-reads the bytes at that oid and marks each citation `VERIFIED` or `FAILED(<why>)`, at any time, by anyone with the repo. | Origin: anyone with write access can author a consistent set. Reports are lead-written Markdown; only their pasted tables carry a `TABLES sha256`. |
| Every scoped range is accounted for exactly once as examined / partial / unexamined. | That a model read what it declared examined. |
| Nothing a script writes contains bytes matching a redaction rule; finding ids hash the *redacted* normalised snippet, so no published hash has a secret in its preimage. | Detection of secrets outside the rule list. |
| The hand-off suite `tasks/security-<slug>-admitted/` is written only by `cases.mjs admit` and contains only admitted cases; `verify-suite` lists anything else. | That a QA runner refuses a case handed to it directly. |
| A `VERIFIED` verdict means the project's tests exited 0 at the named fix commit in the project's own checkout with the cited paths clean, and a fresh reviewer asserted `not-refound`. | Test meaningfulness; that the class is closed at the sink. |
| Every approval-like record is stored `authenticated: false`; no command creates a confirmed state; open exposure is never reduced by an approval. | That any human approved anything. |

Dropped from v6.2, deliberately: byte-compared reports, `COMMITTED` markers,
manifests and `check-export`; keyed (HMAC) identities and the engagement key;
dirty-file (`snapshot`) reviews — commit to a scratch branch instead;
worktree-based test runs; the HMAC working-tree baseline; SARIF import;
tracker publish profiles and read-back; packets, receipts and derived states;
the hash-chained register log, projection, alias log and anchor.

## 3. Decisions

| # | Decision |
|---|---|
| D1 | Three agents, five skills; each script lives in the skill whose agent runs it (no `security-evidence`). Standalone review = `--skills security-testing/secure-code-review`. |
| D2 | Nothing is write-once. `check` is re-runnable; a `FAILED` citation is fixed in place and re-checked. |
| D3 | Citations use **raw** line numbers as `git show` prints them; snippet compare is whitespace-insensitive and ignores blank lines. |
| D4 | `verify.mjs` runs in the project's own checkout (the doctrine of `test-automation`'s `gate-case.mjs`): it refuses unless `HEAD` is the fix commit and the cited paths are clean; unrelated dirt is recorded as `carried_dirt`, never cleaned. No worktree, no install step. |
| D5 | Identity = `sha256(path \0 class \0 redact(normalise(snippet)) \0 first line)`. Redaction runs before any write. |
| D6 | JSON is the model of record; the report is Markdown the lead writes from a template, pasting `cite.mjs check --md` tables. |
| D7 | Register = one append-only `events.jsonl`; every command folds the whole log; `status` prints `FINGERPRINT <engagement>:<seq>:<sha256(events.jsonl)>`. No `confirm` verb. |
| D8 | Stdlib ESM Node ≥ 18; `spawn(argv, {shell:false})`; no network; no hooks; no shell scripts; no schema files (shapes are validated in code with one error per line). |
| D9 | The managed `.gitignore` block (`reviews/`, `verify/`, `register/`, `proposals/` under `.agents/security-testing/`) is written by `cite.mjs init`, which fails closed if any of those paths is tracked. |
| D10 | Agents write assertions (findings, threats, second opinions), never `state`, `oid`, `snippet_redacted` or `check_stamp` — `check` refuses files carrying them unstamped. Finding `id`s are script-derived; the modeler assigns its own `E-nnn`/`T-nnn`/`M-nnn`. |
| D11 | A factory install fetches nothing: every skill an agent lists resolves from this repo (`memory`, `knowledge-curation`, `gathering-context`, `verifying-outcomes` from `skills/`; `issue-tracking` from the feature-development bundle). No external (`repo:`) skill is on any roster. |

## 4. Roster

| Agent | Model | Role | `skills:` | `skills-on-demand:` |
|---|---|---|---|---|
| `security-lead` | sonnet | Orchestrator; the only human-facing role. Runs `init`, dispatches, `check`s, `admit`s, writes the report, prints hand-off prompts and stops, proposes acceptances. | `memory`, `security-engagement` | `secure-code-review`, `risk-register`, `security-test-planning`, `issue-tracking`, `verifying-outcomes` |
| `threat-modeler` | opus | Code-derived DFD with a citation per element, STRIDE, mitigations as claims, dispositions; drafts candidate passive cases. Returns `MODEL_WRITTEN` only after `cite.mjs check` exits 0. | `memory`, `threat-modeling` | `secure-code-review`, `gathering-context` |
| `security-reviewer` | sonnet | Four contracts, each a fresh dispatch: `review` (findings over scope), `vulnerability-review` / `mitigation-review` (a second opinion on one finding or mitigation), `fix-review` (`not-refound` / `refound` at a fix commit). | `memory`, `secure-code-review` | — |

Body rules for all three: external text proposes, only scope- and
target-validated references act; writable paths are `.agents/security-testing/**`,
`.agents/memory/<role>/**`, `reports/security/**`, `tasks/security-*/**`;
never merge, close, rotate or fix. Frontmatter per `bundles/SPEC.md` (no
`tools:`, no `mcpServers`); `context-docs` = engagement record, finding
schema, and for the lead the register view.

## 5. Skills

| id | Content | Script |
|---|---|---|
| `secure-code-review` | Investigate-then-refute loop, 15-class taxonomy, refutation criteria, do-not-flag list, the `findings.json` and `second-<id>.json` shapes, the fresh-dispatch rule; frozen eval harness (`evals/`, `scripts/score-findings.mjs`) reused as is. | `cite.mjs`, `verify.mjs` |
| `threat-modeling` | DFD elements, STRIDE, mitigations as claims, dispositions; the `threat-model.json` shape. | — (uses `cite.mjs`) |
| `security-test-planning` | Passive cases in manual-qa `TC-NNN_<slug>.md` format; `passive-admission.md` (allowed-operation grammar + forbidden patterns, "admitted by lint", never "safe"); audit-branch mapping for header/cookie checks. | `cases.mjs` |
| `risk-register` | Rows, transitions, approvals, expiry, the rendered view. | `register.mjs` |
| `security-engagement` | Lead workflow (§7), engagement record template, sign-off checklist, tracker rules (post by hand via `issue-tracking`, record with `register ticket`). | — |

## 6. Scripts and artifacts

All state lives under `.agents/security-testing/` (`<st>`). `engagement.md`
carries one fenced `json engagement` block: `engagement_id`, `slug`,
`scope_paths[]`, `product_paths[]`, `targets.browser[]`, `base_url?`,
`execute_project_tests.argv?`. Every script prints one result line per
outcome; exit 0 ok, 2 usage, 4 the check failed, 5 the record is corrupt.

### `cite.mjs` (secure-code-review) — ~600 lines
- `init` — seeds `<st>/engagement.md` from the template when absent (exit 2
  `EDIT-ENGAGEMENT-AND-RERUN`), writes the managed ignore block, fails closed
  on a tracked private path (D9).
- `show <path> [start end] [--at <oid>]` — numbered, redacted lines at the
  oid (default `HEAD`). The helper the reviewer uses while reading.
- `check <findings.json | threat-model.json> [--md [--no-snippets]]` — refuses
  agent-written `id`/`state`/`verdict` (D10) and a dirty scope
  (`DIRTY-SCOPE <path>`); for every citation `{path, oid?, lines:[s,e],
  snippet}`: path under `scope_paths`, range ≤ 40, bytes at the oid (stamped
  when absent), normalised snippet occurs in the window ⇒ `VERIFIED` else
  `FAILED(<why>)`. Writes the file back with `state`, `oid`, redacted snippet
  and (findings) `id` (D5). Findings mode: coverage from `examined[] =
  [{path, lines?}]` tiled exactly once against `git ls-files -- <scope_paths>`
  ⇒ `COVERAGE examined=<n> partial=<n> unexamined=<n>`; validates every
  `second-<id>.json` in the directory (`{finding_id, oid, findings_sha256,
  assertion: confirmed|refuted|indeterminate, note, by}`; wrong oid or stale
  `findings_sha256` ⇒ `STALE-REVIEW <id>`). Threat-model mode: ids
  `E-nnn`/`T-nnn`/`M-nnn`, every threat names an element, every element and
  mitigation has a citation, disposition ∈ `open | accepted(R-nnnn) |
  mitigated(M-nnn) | planned(TC-nnn) | out-of-scope(<reason>)` with
  `accepted` rows present in the register and `planned` cases in
  `.admitted.json`. `--md` prints the findings / coverage / elements /
  threats / mitigations tables and `TABLES sha256=<h>`. Result line
  `CHECK verified=<n> failed=<n>`; exit 4 on any `FAILED`.
- `redact <file.md>` — rewrites a Markdown file through the rules (the
  lead runs it on the final report).

### `cases.mjs` (security-test-planning) — ~300 lines
- `admit <case.md>` — case must be under `<st>/cases/`, id `TC-NNN`, file
  `TC-NNN_<slug>.md`; lint every step against the grammar and forbidden list,
  hosts against `targets.browser`. No hits ⇒ copy the redacted file to
  `tasks/security-<slug>-admitted/` and append `{file, sha256}` to
  `.admitted.json` there; hits ⇒ copy to `<st>/proposals/` and print them.
  `ADMITTED <file>` | `PROPOSAL <file> hits=<n>`.
- `verify-suite` — every file in the suite is in `.admitted.json` with its
  sha256 ⇒ `SUITE ok=<n>`, else `UNADMITTED: <path>` (exit 4); then prints
  the manual-qa and test-automation hand-off prompts.

### `verify.mjs` (secure-code-review) — ~250 lines
`verify.mjs --finding <id> --review <dir> --head <oid> [--assertion
not-refound|refound --by <session>]`, run directory `<st>/verify/<id8>-<head7>/`.
1. `HEAD == --head` else `NOT-AT-HEAD`; `git status --porcelain -- <cited
   paths>` empty else `DIRTY <path>`; other dirt recorded as `carried_dirt`.
2. `base` = the finding's stamped oid; `base` ancestor of `head` and
   `base..head` touches a cited path, else `UNVERIFIED-NOT-A-FIX`.
3. Run `execute_project_tests.argv` (`shell:false`, timeout); redacted tail
   of output to `tests.log`; no argv ⇒ `UNVERIFIED-NO-TEST-SURFACE`.
4. `git diff base..head -- <cited paths>` deletion-only ⇒
   `UNVERIFIED-DELETION-ONLY`; suppression / skip indicators in the diff ⇒
   `ADVISORY <path>:<line>` (not a gate).
5. First invocation writes `verify.json` with `verdict: PENDING-REVIEW`,
   prints `NEXT: dispatch security-reviewer fix-review`. Second invocation
   (`--assertion`) sets the verdict: `VERIFIED` iff tests exit 0 and
   `not-refound`; `refound` ⇒ `UNVERIFIED-REFOUND`; then calls
   `register.mjs fixed|regressed` in-process. Prints
   `VERDICT <token> finding=<id> base=<oid> head=<oid>`.

### `register.mjs` (risk-register) — ~350 lines
`<st>/register/events.jsonl`, rows `R-nnnn`. Events: `add`, `accept`,
`revoke`, `acceptance-expired`, `fixed`, `regressed`, `close-false-positive`,
`reopen`, `supersede`, `ticket`. Verbs: `add --finding <id> --priority
p0..p3 --title … [--owner …]` (refuses a live row with the same finding id),
`accept R-nnnn --until <date> --approved-by <who> --approval-ref <ref>`,
`revoke`, `close-false-positive`, `reopen --reason`, `supersede R-a --by R-b`,
`ticket R-nnnn <url>`, `fixed|regressed R-nnnn --verify <verify.json>`,
`check` (expires acceptances), `status [--json] [--expect <FINGERPRINT>]`
(counts, open exposure per priority — never reduced by an approval —
unauthenticated approvals, `FINGERPRINT`; `--expect` ⇒ `MATCH | ADVANCED |
DIVERGED`), `render` → `<st>/risk-register.md` (rows, superseded, open
exposure, unauthenticated approvals). Transition table and approval payload
`{recorded_by, approved_by, approval_ref, authenticated:false}` reused from the
reference implementation.

## 7. Operator flow (security-lead)

1. `cite.mjs init`; fill `engagement.md`; commit so scope paths are clean.
2. Dispatch `security-reviewer` (`review`) at `HEAD` → `<st>/reviews/<date>-<head7>/findings.json`.
3. `cite.mjs check` it; send `FAILED` lines back, re-run until clean.
4. Per finding worth a second opinion: fresh `vulnerability-review` dispatch → `second-<id>.json`; `check` again.
5. `register.mjs add` per verified finding; `register.mjs render`.
6. Dispatch `threat-modeler` → `<st>/threat-model.json` + candidate cases in `<st>/cases/`; `cite.mjs check` the model (a `mitigated` claim may get a `mitigation-review`, recorded as in step 4 as `second-M-nnn.json` in the same review directory).
7. `cases.mjs admit` each candidate; `cases.mjs verify-suite`; paste the hand-off prompts to the user; **stop**.
8. Report: `reports/security/<date>-assessment.md` from `knowledge/report-template.md` — identity (repo, head, engagement id, `FINGERPRINT`, `TABLES sha256`), coverage, findings, threat model, register delta, limitations (§2 right column verbatim); `cite.mjs redact` it.
9. Fix: developer names a commit; lead checks it out; `verify.mjs` → fresh `fix-review` → `verify.mjs --assertion` → `VERDICT`.
10. Acceptances by hand with `register.mjs accept`; `register.mjs check` before every report.
11. Sign-off checklist (prose): both `check`s exit 0, `verify-suite` exit 0, `register.mjs status` read, `git status --porcelain -- <scope_paths> <product_paths>` empty.

## 8. Hand-offs
- manual-qa: the dedicated suite directory (`test-run-lead` Step 0 row from PR #71 is reused) with the prompt `Run as the active agent (claude --agent test-run-lead): "Run the suite at tasks/security-<slug>-admitted/ against base_url=<url>."`; header/cookie checks in the audit-step form.
- test-automation: prompt with `cases[{id,title,path}]`, `slug`, `base`.
- feature-development: the `code-review` pointer from PR #71 is reused; the fix report names the `verify.mjs` command.
- Tracker: the lead posts through `issue-tracking` and records `register ticket`.

## 9. Files and manifest
`bundles/security-testing/{factory.json, FACTORY.md, README.md, instructions.md,
CHANGELOG.md, agents/<3>/{AGENT.md,SOUL.md,RULES.md}, briefings/<3>.md,
knowledge/{engagement.md.template, finding-schema.md, report-template.md},
skills/<5>}`. `factory.json`: `localAgents` the three, `localSkills` the five,
`skills: ["memory","knowledge-curation"]`, three briefings, `seed.knowledge`,
`instructions`; never `hooks`/`targets`. Description sentence unchanged from
v6.2 §10; no catalog text says "exact checkout". Target: ~75 files.

## 10. Tests
One `<script>.test.mjs` per script beside it, fixtures under
`scripts/fixtures/` (never a directory named `test`), fixture repos built by
code into temp dirs; ~15 fixtures, ≤ 3,500 test lines (prose contract tests included), seconds to run. One
installed end-to-end test in `bin/` (not in the skill) covering `--factory`
on Claude and the one-skill standalone path, offline. The `secure-code-review`
eval harness stays. `npm run validate` green.

## 11. Migration from the reference implementation
Reused verbatim or trimmed: `normalize.mjs`, `redact.mjs` (`redactString`, a
6-rule `redaction-rules.json`), `lib/git.mjs` (show/ls-files/rev-parse/diff),
`lib/cite-core.mjs` `occurrenceOf`, `lib/coverage-core.mjs` tiling,
`lib/ignore-block.mjs`, `lib/admission-core.mjs`, `lib/register-transitions.mjs`,
`lib/register-render.mjs` row table, `lib/verify-steps.mjs` argv/suppression
helpers, `lib/cli.mjs` argv parsing; the prose skills' `references/*`, the
eval harness, SOUL/RULES, briefings, knowledge templates (edited). Everything
else on `feat/security-testing-bundle-spec` is not carried.

## 12. Out of scope (v2 candidates)
SARIF import (`cite.mjs import-sarif`, ~120 lines); tracker publish/read-back
profiles; threat tickets; dirty-tree reviews; SBOM / supply-chain review;
privacy threats; security evals beyond the frozen harness.

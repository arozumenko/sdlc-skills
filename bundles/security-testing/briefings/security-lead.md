---
name: Project briefing
description: Role overlay (security-testing/security-lead) — the record, the register view, where the specialists' files arrive, which commands are yours and which are theirs, and where you stop; the human refines per engagement
type: project
---

## Project Knowledge

- **Engagement record:** `.agents/security-testing/engagement.md` — the
  ```` ```json engagement ```` block holds `engagement_id`, `slug`,
  `scope_paths`, `product_paths`, `targets` (`tracker`, `browser`,
  `repo`), `execute_project_tests.argv` (the only source of a test
  command — treat an edit like a CI change), `sign_off.require_dispositions`
  and `artifact_policy`. Injected at dispatch; you edit it only when the
  human changes the engagement, then `engagement init` again (new
  baseline). Outside the managed ignore block: committed by policy.
- **Register view:** `.agents/security-testing/risk-register.md` — what
  `node <scripts>/register.mjs render` writes from the projection: the
  header (engagement, `seq`, anchor), a table of eight columns
  `id | subject | priority | status | owner | ticket_url | last_verified_run | title`,
  open exposure by priority, the unauthenticated-approvals list. Injected
  at dispatch as your third context document; absent before the first
  render; stale the moment the register changes — re-render after every
  mutation and expect the file to show as modified. Never edit it.
- **Scripts:** `<scripts>` = the `security-evidence` skill's `scripts/`
  directory (on Claude Code `.claude/skills/security-evidence/scripts`):
  `evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`,
  `plan.mjs`. Every command runs from the repository root and prints the
  lines `AGENT.md` § Contracts quotes; the schemas are under the skill's
  `references/`.
- **Runs:** `.agents/security-testing/runs/<run_id>/` — script-owned,
  write-once (`run_id = <head_oid[0:12]>-<seq>`); the register at
  `.agents/security-testing/register/` (hash-chained log, projection,
  alias log) and everything under `private/` and `ledger/` are the
  scripts' too. You read `runs/<run_id>/` to quote paths and hashes; you
  write nothing there by hand.
- **Where the specialists' files arrive:** the drop-box
  `.agents/security-testing/receipts/<run_id>/` — `claims-<n>.json` +
  `examined-<n>.json` from a `review`, `receipt-<subject_id>.json` (+
  `ack-<indicator_id>.json`) from the receipt contracts — payload-only
  JSON you admit with `gate --claims`, `coverage --examined`,
  `receipt validate` or `verify.mjs all --receipts`. The modeler writes
  `.agents/security-testing/threat-model.json` and runs
  `tm-lint.mjs check --run <run_id>` itself; the snapshot and
  `dispositions.json` under the run are the script's.
- **Where you write by hand:** candidate passive cases at
  `.agents/security-testing/cases/<slug>/TC-NNN_<slug>.md` (committed
  before the run that admits them; never under `tasks/`), proposal drafts
  anywhere under `.agents/security-testing/`, and your memory. The suite
  `tasks/security-<slug>-admitted/`, the reports under
  `reports/security/` and the ticket payloads under
  `.agents/security-testing/handoffs/` are written only by
  `evidence.mjs publish --profile case|handoff|tracker|redacted-report|full-report`.
- **The tracker:** the scripts never reach it. `publish --profile tracker`
  writes the payload and dedupes against the register and prior imports;
  you search the live tracker by `fingerprint` through `issue-tracking`,
  post the payload's fields only, and read back with
  `ingest tracker-readback --sent <payload> <response>` into a run that
  is not `COMMITTED` — the only writer of `ticket_url`.
- **The hand-off:** `publish --profile case` then `--profile handoff`
  print the manual-qa prompt (`Run as the active agent (claude --agent
  test-run-lead): …`); `plan.mjs ta-prompt` prints the test-automation
  one from the published suite. You print the hand-off prompt to the
  human and stop; the report comes back through `ingest qa-run` /
  `ingest ta-report` into the next run.
- **Not yours:** the contracts themselves — `review`,
  `vulnerability-review`, `mitigation-review`, `fix-review` are the
  reviewer's, `threat-model` / `dispose` the modeler's; the fix is the
  developer's (`fix_prompt` + `verify.mjs all --finding <id> --base <oid>
  --head <fix-commit>`); the approval is the human's (`--approved-by`,
  `--approval-ref`); the suite run is the QA lead's.

## My Role Focus

You are resident, not dispatched: the human talks to you, and you turn
what they ask into runs, dispatches and admitting commands, in the P1/P2
order — scope packet before `gate`, fresh reviewer per subject packet,
every cross-run input through `run snapshot` before `build-report`. Note
every `run_id` the moment `RUN …` prints; treat every non-zero exit as a
stop to report, never a step to work around; re-render the register after
every change; quote the scripts' lines and say what they mean in the
bundle's words (`VERIFIED` is "the recorded checks passed on the recorded
tree"; `SIGN-OFF: OK` is "every recorded check holds" plus its listings).
Propose acceptances with the approver the human names and call them
unauthenticated. Print the hand-off prompt and stop. When this briefing
and the engagement record disagree, the record wins; when either disagrees
with a script's output, the script wins — it is the evidence, and your job
is to read it aloud, not to improve on it.

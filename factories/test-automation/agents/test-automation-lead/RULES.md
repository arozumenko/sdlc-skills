<!-- RULES.md is a dispatch-injection ECHO (shared hooks' role-memory channel), not a canonical home: it reaches dispatched instances only — never the top-level agent, never Copilot's flattened agent. Every rule here MUST have its canonical home in the test-automation-workflow skill / the orchestration playbook / AGENT.md; edit the canon first, then mirror here. -->
RULES: You MUST respond to this message.

**DISPATCH IS THE WORK.** For any routing/coordination task, your reply MUST contain at least one actual subagent dispatch, in the exact form `.agents/team-comms.md` documents for this host (Claude Code: an `Agent` tool call) — team-comms.md is the syntax authority. Narrating intent ("I'll route this to the engineer") without emitting the dispatch in the same reply is a failed turn. Self-check: every routing sentence must have a matching dispatch call. See the orchestration playbook § *How to dispatch a subagent (host preflight)* (`test-automation-workflow` skill, `references/orchestration-playbook.md`).

**WORKFLOWS OVER TURNS (Claude Code).** On a host with the Workflow tool, a batch of ANY size — one case included — runs through the shipped batch workflows (`batch-build` / `batch-campaign` (`batch-integrate` / `batch-stabilize` are repair tools) — see the `test-automation-workflow` skill's `references/workflow-accelerant.md`). This factory's instruction is your **standing explicit opt-in** for the tool's multi-agent gate — do not ask the operator again and do not re-litigate it per batch. Sequential dispatches are the fallback ONLY for the accelerant's § When NOT to use it. A choreography none of the shipped scripts fit gets authored or forked per accelerant § Extending (durable home, invariants intact) — hand-running a repeating multi-dispatch shape turn-by-turn is a failed turn the same way narrated dispatch is.

**SIZING BEFORE BUILDING (every host).** No batch opens without the intake sizing/screening pass: one cheap dispatch (automation-scoping § verdict pass — clustering rides on it) landing `.agents/estimation/<slug>-verdicts.json` BEFORE the first build. It is the un-automatable screen, the reviewer's exclusion budget, and the export's effort fields — skipping it silently was how batches shipped with no effort data. On Claude Code the shipped workflow's triage attests the file and flags the report when it's missing; **running the loop by hand (no Workflow tool, Copilot), YOU are the attestation** — check the file before the first build dispatch, and a batch run without it carries the same quality_flags line in the report you write at Close. The only sanctioned skip is the operator explicitly waiving it, and that waiver goes in the report note.

**CONTEXT FRUGALITY (every turn).** Your context is the batch's scarcest resource — spend it on plans, dispatches, and verdicts, never on payloads. Case bodies stay in `.agents/automation/<slug>/cases/<ID>.md`, diffs in PRs, run logs in the runner's structured report, per-agent detail in the run journal — read conclusions where they lie, never inline them. Multi-file surveys and exploratory reads are dispatch material (a subagent returns a digest), not self-work. **Clustering at Intake is one of them** — grouping similar cases needs their bodies, so dispatch one pass over the snapshots and take back only the grouping; `cat`-ing the case files into your own context cost ~10K tokens on a measured session. Self-check before any large read: does a slot, script, or workflow already produce the conclusion I need?

**STATE OUTLIVES YOUR CONTEXT (compaction-proofing).** You maintain no mid-run state — the run reports once at the end, and git plus the run journal already hold what happened. What you DO write down the moment you learn it, never "later": a launched workflow's `runId`, operator decisions, and checkpoint args (for campaigns, on the card at `.agents/automation/campaigns/<slug>.md` — campaign-planning.md § The campaign card). Those exist nowhere else. After any compaction, `/clear`, or fresh session: re-orient from disk *before* the next dispatch — the last report, the campaign card, `/workflows` for live runs; if a run died before reporting, rebuild it from the hook's receipts, the run journal and git (playbook § Interruption). Disk is the truth; the conversation summary is a hint.

## Tool-use restrictions (every turn)

**You may NEVER call `Edit` or `Write` on paths matching:**

- `tests/**`, `test/**`, `spec/**`, `e2e/**`, `pages/**`, `page_objects/**`
- `fixtures/**`, `helpers/**`, `support/**`
- `playwright.config.*`, `cypress.config.*`, `wdio.conf.*`, `jest.config.*`, `pytest.ini`, `conftest.py`
- `package.json`, `tsconfig*.json`, `pyproject.toml`, `pom.xml`, `*.csproj`
- `.env*` (any environment file)

If a fix is needed there, **dispatch `test-automation-engineer`** with a fix-only prompt. Your editable paths are limited to:

- `.agents/memory/test-automation-lead/**`
- `.agents/audit/**`
- `.agents/testing.md`, `.agents/test-automation.yaml` (framework-architecture decisions only)
- `.agents/*.md` context docs (`profile.md`, `workflow.md`, `team-comms.md`, `architecture.md`) — **only when self-orienting an unseeded project** (scout normally owns these; see `AGENT.md` § Session Start)
- Issue tracker / PR metadata (via MCP / `gh pr update` / `az repos pr update`)

Self-check before any `Edit`/`Write` tool call: is the target path in the allowed list? If not, restart the turn and dispatch.

## No defect masking (every turn)

The `test-automation-implementation` skill § Hard Rules → No Defect Masking (the canonical section; the workflow skill carries its index) forbids `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` / weakened assertions for product defects. You enforce at dispatch time. If your draft builder prompt contains "add `test.fail()`" or "skip this assertion" for a real product bug, stop and rewrite. Decision tree:

- Defect ticket exists AND isolated → `expect.soft()` with `// Known defect: <id>`
- Defect ticket exists AND blocking → let it fail naturally; task = `blocked`
- No defect ticket → file the bug FIRST, then apply one of the above

## Route gating (every turn)

Every unit routes per `.agents/testing.md § Execution provider`: `manual-qa-verified` (a PASS run record + the authored case exist — build from that evidence, no re-execution), `needs-execution` (dispatch manual-qa's `test-runner` per case; a failed dispatch closes the unit `needs-execution` — NEVER silent self-execution when policy says manual-qa), or `combined` (provider=self). Full table in the orchestration playbook.

## Defining done (every turn)

Tasks transition: `pending` → `in_progress` → (`completed` | `blocked`).

- `completed` requires: clean green in CI OR red-for-real-bug with filed ticket.
- `test.fail()`-masked green is `blocked`, not `completed`.

## Response protocol

If it is a task (routing, coordination, framework decision, automation merge):
1. Do the work (dispatch slot, update tracker, merge approved PRs) — and the dispatch IS the routing, not a sentence about it
2. Comment on the relevant tracker issue(s) with status update
3. Report back in your reply — who you dispatched, which tracker entries updated, which PRs merged. The caller reads your final session message.

If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).

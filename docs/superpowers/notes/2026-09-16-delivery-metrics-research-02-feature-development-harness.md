# Research 02 — The feature-development delivery harness, end to end

**Question.** What path does a work item take from idea to merged code in the
`feature-development` factory, and where does a TIMESTAMP or an ESTIMATE exist
(or could be captured with least ceremony)?

**Method.** Read every file listed in the task brief under
`bundles/feature-development/`, `hooks/`, the two security-testing plan docs,
and mined the current branch (`feat/security-testing-bundle-spec`, 111 commits
on top of `main`) as a real dataset of the harness delivering 33 tasks in one
day. All paths below are relative to `/Users/Daniel_Sallai/dev/sdlc-skills`.
Line numbers are from `cat -n` on 2026-09-16. "Documented" = what the factory
prose says; "observed" = what the git dataset shows. Where the two differ I say
so — the gap is itself a finding.

---

## 1. Work-item hierarchy and vocabulary

### 1.1 The documented hierarchy (BA → tech-lead → PM → dev)

| Level | Id form | Template lives at | Owner |
|---|---|---|---|
| **Epic** | `# [EPIC] Epic Title` (tracker issue `#100`) | `agents/ba/AGENT.md:123-153` (BA's "Epic Format"); `skills/issue-tracking/references/templates.md:72-108` (tracker body) | BA (Alex) |
| **User story** | `US-XXX` (`# US-XXX: Story Title`, `**Epic:** #100 …`) | `agents/ba/AGENT.md:155-184` | BA |
| **Acceptance criterion** | `AC-N` (Given/When/Then) | `agents/ba/AGENT.md:169-174`; `skills/plan-feature/references/templates.md:79-96` | BA |
| **Technical task** | `TASK-XXX` (`# TASK-XXX: Short descriptive title`, `**Story:** US-XXX`) | `agents/tech-lead/AGENT.md:179-203` | tech-lead (Rio) |
| **Dependency group** | `### Group N (…)`, `### Critical Path: TASK-001 → …` | `agents/tech-lead/AGENT.md:205-218`; plan-feature calls them "phases": `skills/plan-feature/references/templates.md:105-128` | tech-lead |
| **Spike** | `SPIKE-NNN` with `**Timebox:** 2 hours` | `agents/tech-lead/AGENT.md:228-239` | tech-lead |
| **PR / MR** | host-native change, `Closes #N` | `skills/completing-a-task/SKILL.md:68-95` | dev |
| **Ticket** | tracker issue (`gh issue …`) — one per task; "The tracker's status/labels are the source of truth" | `agents/project-manager/AGENT.md:149-152`; `skills/issue-tracking/SKILL.md` | PM updates, BA/TL create |

The tracker workflow states are enumerated once, in
`skills/issue-tracking/references/templates.md:110-116`:

```
Backlog → Ready → In Progress → Review → QA → Done
                       ↓
                    Blocked → (unblock) → In Progress
```

### 1.2 Vocabulary actually used

- **"epic / story / task / PR / ticket / issue"** — the working vocabulary everywhere.
- **"campaign"** — **not used anywhere** in `bundles/feature-development/` (grep: zero hits). It is a `test-automation`/`manual-qa` word (e.g. `bundles/test-automation/hooks/README.md:22` "lazy-modal campaign").
- **"mission"** — used loosely, never defined as a work-item level. `instructions.md:90` "still true once this mission ends"; `instructions.md:94-95` "**Mission state belongs on the work board, not in either memory layer.**"; `agents/qa-engineer/AGENT.md:95,99` "task/mission policy", "When a mission concentrates live verification into a dedicated hardening/E2E task…". So "mission" ≈ the in-flight delivery of one epic/plan; it has no id and no artefact.
- **"work board"** — appears exactly once (`instructions.md:95`) and is **never defined**. Nothing in the factory creates or reads a board. In the PM agent the equivalent of a board is (a) the tracker's labels/status (`agents/project-manager/AGENT.md:152`) and (b) "Keep your own inline status in your reply to the user — each subagent call returns synchronously … There is no queue to inspect." (`agents/project-manager/AGENT.md:395`). Inference: the "work board" is the tracker on a seeded project; in the observed dataset it is the plan markdown file (see §2.3).
- **"case"** — a TMS test case (`TC-NNN`), only in the test-automation flow (`agents/project-manager/AGENT.md:358,374-383`). Not a delivery work item here.
- **"group" / "phase" / "critical path"** — the batching vocabulary (`G0..G29` in the dataset).

### 1.3 The hierarchy as recorded in the real dataset

The security-testing delivery uses exactly the documented shape, one level higher than the templates assume (spec → epic → stories → tasks → groups):

- Spec: `docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md` (v1→v6.1, 14 `docs(spec):` commits 09-14 16:29 → 09-15 22:49).
- Epic + stories: `docs/superpowers/plans/2026-09-15-security-testing-bundle-stories.md` (2154 lines; header lines 1-8 name **Author:** Alex (ba), `# [EPIC] security-testing bundle v1` at line 18, `US-001` … `US-049`, milestones `M-1, M1 … M5`).
- Tasks: `docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md` (1475 lines; **Author:** Rio (tech-lead) line 4; `## 1. Execution plan` line 42 with the ASCII group graph lines 47-79, `### Parallel groups` table lines 80-104, `### Critical path` lines 106-108 ("20 steps"), `### Assignment` lines 110-114; `## 5. Technical tasks` from line 401, one `#### TASK-NNN:` per task with the exact one-line header `**Story:** US-xxx · **Assigned:** js-dev · **Depends on:** TASK-yyy · **Complexity:** S|M|L`).
- PM log: appended sections at the bottom of the same file (`## 6. PM log …` line 1215; `### PM log additions (… after G3)` 1253, `after G7` 1377, `after G10` 1413, `after G11` 1439, `after G12` 1451), one commit each `plan(security-testing): PM log after Gn`.

---

## 2. Who creates each level, at what step, and what artefact records it

| Level | Creator | Step (from the agent prose) | Recording artefact — documented | Recording artefact — observed in dataset |
|---|---|---|---|---|
| Epic | BA | "Epic creation" (`ba/AGENT.md:70`); "Create issues in the issue tracker" (`ba/AGENT.md:83`) | tracker epic issue (`issue-tracking/SKILL.md:87-126`) | one markdown file, commit `7fdfdec 2026-09-15 22:47:55 plan(security-testing): epic + 49 stories (Alex), 55 tasks … (Rio) — first cut` |
| Story | BA | "User story writing" (`ba/AGENT.md:71`); handoff to tech-lead with "Epic issue number, Story count and IDs" (`ba/AGENT.md:205-212`) | tracker story issues | same file/commit as epic |
| Task | tech-lead | "3. Create Technical Tasks" (`tech-lead/AGENT.md:179`), "4. Map Dependencies" (`:205`), "5. Handoff to PM" (`:220-226`: task count and IDs, parallel opportunities, dependencies, risks) | tracker task issues (`issue-tracking/references/templates.md:42-70`, `**Parent:** #100`), or `🔨 **Decomposed**: task list` comment on the epic (`issue-tracking/SKILL.md:215`) | plan file; **task creation time = plan commit** (`e8ebe82 2026-09-16 07:43:42 plan(security-testing): tasks v2 (59 tasks, 20 groups, critic pass 2 = dispatch)`) |
| Group / critical path | tech-lead | "Order tasks by dependency with parallel groups identified" (`tech-lead/AGENT.md:90`) | plan text only (no tracker concept) | plan file `§1`; regrouping happens in the PM log (e.g. line 1222 "move 057 to G8") |
| Dispatch | PM | "Distribute immediately … Under 2 minutes" (`pm/AGENT.md:148`); "**Always update them [tracker status/labels] when routing**" (`:152`); `📬 **Assigned**: to whom` comment (`issue-tracking/SKILL.md:214`) | tracker label/status change + comment | **nothing in git** — only the local reflog `branch: Created from feat/security-testing-bundle-spec` (see §7) |
| Start of work | dev | implement-feature step 1: "Post a `🔧 **Started**` comment" (`implement-feature/SKILL.md:42`; `references/commands.md:33-37`) | tracker comment | nothing (no tracker in play) |
| PR | dev | completing-a-task steps 2-3 (`completing-a-task/SKILL.md:55-95`): branch `<type>/<short-description>`, `git push -u origin HEAD`, `gh pr create --title "<type>: <description> (#<issue>)" … Closes #<issue>` | PR object on the code host | **no PR** — local branch `task/task-NNN`, pushed nowhere (`git branch -a` shows no `remotes/…/task/*`) |
| "Done" comment | dev | step 8 `✅ **Done**` with `**PR:** #XX` (`implement-feature/references/commands.md:166-183`) | tracker comment | first `TASK-NNN: …` commit on the branch |
| Review verdict | tech-lead | "Comment on the issue: 'Code review passed. Approved for merge.' Then notify the PM" (`tech-lead/AGENT.md:153-155`); on a bug: `Review finding: [file:line] … Blocking: yes/no` (`:145-149`) | tracker comment + PR review state | merge-commit subject `merge task/task-NNN (Rio: PASS)` / `(Rio: PASS after 3 rounds)`; findings routed into the PM log tables (`tasks-v2.md:1439-1475`) |
| Merge | PM | "Merging approved PRs" protocol steps 0-5 (`pm/AGENT.md:209-256`), `gh pr merge <N> --squash --delete-branch` (`:95`) | merged PR, closed issue, "PR #<M> merged — … <dev-name> is free" (`:254-256`) | `git merge` commit by the orchestrator (all 111 commits have author = committer = the human's git identity; role is only in the subject text) |
| Status report | PM | "Status Report Format" (`pm/AGENT.md:399-416`) | chat reply to user | `plan(security-testing): PM log after Gn` commits (one per closed group) |

Key point for the spec: **every documented recording surface is a tracker comment or a PR**, and the observed harness used neither — the plan markdown + git branch/merge commits carried the whole lifecycle. A tracker-only design would have captured nothing from this dataset.

---

## 3. Where estimates exist today

There is **no time estimate anywhere** in the factory; there are two t-shirt fields and one timebox:

1. **Story `**Size:** S / M / L`** — `agents/ba/AGENT.md:162`, defined by AC count in the "Story Sizing" table `:197-203` (S = one or two ACs; M = 3-5 ACs; L = 5+ ACs "consider splitting"). A scope measure, not effort.
2. **Task `**Complexity:** S / M / L`** — `agents/tech-lead/AGENT.md:187`; the tracker Task template spells it `**Complexity:** small / medium / large` (`issue-tracking/references/templates.md:48`) and the Epic task table has a `Complexity` column (`:95-99`). Undefined scale — no mapping to hours or tokens anywhere.
3. **Spike `**Timebox:** 2 hours`** — `agents/tech-lead/AGENT.md:235`. The only duration-shaped field in the factory. In the dataset: `SPIKE-002 (scheduled inside TASK-048, 30 min)` (`tasks-v2.md:1172`) and "spike at the start of this task (30 min)" (`:1119`).
4. **`plan-feature` "Estimated scope"** — `skills/plan-feature/references/templates.md:124-127`: `Total tasks: 6 / Parallel groups: 3 phases / Critical path: TASK-1 → TASK-3 → TASK-5`. Counts, not durations.
5. **Story priority** `must-have / should-have / nice-to-have` (`ba/AGENT.md:161`) — ordering, not effort.

Explicit anti-estimate rule for devs: `agents/js-dev/AGENT.md:185` "**Don't give time estimates.**" PM's SOUL says "You use deadlines as focusing tools, not punishment" (`project-manager/SOUL.md:24`) and "You count tasks. You always know how many are open, in progress, and blocked" (`:21`) — counting, not timing.

**Dataset distribution of `Complexity:`** in `tasks-v2.md`: S = 20, M = 24, L = 15 (59 tasks). The tech-lead prose in §8 uses prose-duration language once: "The chain 021 → 022 → 023 → 027 → 024 is one dev's week" (`tasks-v2.md:1204`) — the only elapsed-time estimate in the whole plan, and it was delivered 021→023 in 2 h 49 min (14:14 → 17:03).

**PM status format has no time fields** (`pm/AGENT.md:399-416`): sections `Completed / In Progress / Blocked / Risks / Next Actions`, lines like `- TASK-003: Login API (python-dev) — on track`. No started-at, no ETA, no size.

---

## 4. The dispatch → implement → PR → review → merge lifecycle

### 4.1 Documented states and transitions

| # | State (tracker vocabulary, `issue-tracking/references/templates.md:112-116`) | Transition owner | Evidence that should land |
|---|---|---|---|
| 0 | Backlog → **Ready** | tech-lead decomposes; PM dedups ("If it's already marked in-progress … Don't send again" `pm/AGENT.md:150`) | task issue exists |
| 1 | Ready → **In Progress** | PM routes (`📬 Assigned`, label `in-progress` `issue-tracking/SKILL.md:158`); dev posts `🔧 Started` (`implement-feature/SKILL.md:42`) | label + 2 comments |
| 2 | In Progress → **Review** | dev: completing-a-task 5 steps (`completing-a-task/SKILL.md:38-121`): verified locally → branch commit → push + `gh pr create` → `gh issue comment <N> --body "PR #<X> ready: …"` → final reply "ready for review" with PR number. PM: "Only 'PR open, ready for review' is 'task done'" (`pm/AGENT.md:288-289`) | branch, PR, comment, subagent return value with PR number |
| 3 | Review → In Progress (FAIL) | tech-lead: "Do **not** approve the PR. Comment on the GitHub issue with specific findings … Send the PR back to the developer via a host-native subagent dispatch" (`tech-lead/AGENT.md:141-151`); PM: "Don't merge … `CHANGES_REQUESTED`" (`pm/AGENT.md:258-267`) | review-finding comments; new commits |
| 3' | Review → **QA** → Review | PM "Route completed work to QA for verification" (`pm/AGENT.md:334`); "Don't skip QA — every completed task gets verified before 'done'" (`:447`) | `🧪 Testing` / `✅ Verified` comments (`issue-tracking/SKILL.md:211,213`) |
| 4 | Review (PASS) | tech-lead: "Code review passed. Approved for merge." + notify PM (`tech-lead/AGENT.md:155`) | comment + review approval |
| 5 | → **Done** | PM merge protocol (`pm/AGENT.md:209-256`): 0 read `.agents/profile.md § Automation PR policy` (`Base branch`, `Merge policy: auto-merge|human-approved|manual`, `Merge strategy: squash|rebase|merge`); 1 confirm open + approved + CI green + base matches; 2 merge with strategy; 3 close ticket ("Shipped via #<M>"); 4 unpark dev; 5 tell user | merge commit, closed issue, status line |
| — | **Blocked** | dev reports `Blocker at step <N>: … Tried: … Needs: …` (`completing-a-task/SKILL.md:133-137`); PM classifies technical→TL, scope→BA, decision→user, dependency→wait (`pm/AGENT.md:420-425`) | `🚫 Blocked` comment |
| — | Abandoned / descoped | **no documented state or artefact.** BA "parking lot" for scope (`ba/AGENT.md:214-222`) is the nearest concept. |

Concurrency constraint that shapes cycle time: "**One dev, one in-flight PR.**" (`pm/AGENT.md:297-324`) — a dev is parked until the PM merges, so merge latency is directly dev idle time. Parallelism is only across roles/domains (`pm/AGENT.md:126`).

Branch naming, documented: `git checkout -b <type>/<short-description>` (`completing-a-task/SKILL.md:60`), `feat/<short-description>` (`implement-feature/references/commands.md:146`), prefixes `feat/ fix/ chore/ docs/` (`git-workflow/SKILL.md:44`). Commit title `feat: [description] (#NNN)` (`commands.md:148`). Scout records the project's real convention in `.agents/workflow.md § Branching & commits` (`seeding-a-project/references/templates.md:336-342`: `Branch naming`, `Commit message style`, `Ticket linking`).

### 4.2 Observed lifecycle in the dataset (33 merged tasks, 3 in flight)

The orchestrator (a Claude Code Workflow — the worktrees are named `.claude/worktrees/wf_70c041ed-ce7-{12,13,14}` and `git worktree list` shows them checked out on `task/task-027`, `task/task-031`, `task/task-036`, two `locked`) ran the relay like this, all inside **one** Claude session (105 of 111 commits carry the trailer `Claude-Session: https://claude.ai/code/session_01LGhRqjVhKWmJu7Ki5bCH6Q`; 9 of those add "(conflicts auto-resolved additively)"):

1. **Dispatch** = `git branch task/task-NNN` from `feat/security-testing-bundle-spec` into a worktree. Evidence: reflog line `task/task-006@{2026-09-16 09:14:26 +0200}: branch: Created from feat/security-testing-bundle-spec`. All tasks of a group are created within seconds of each other (G6: seven branches 11:43:57–11:44:12).
2. **Implement** = exactly one commit `TASK-NNN: <title>` (the plan calls each task "a one-session PR", `tasks-v2.md:44`). Body = prose summary + `Co-Authored-By: Claude Opus 5 (1M context)` + `Claude-Session:` trailer. No `🔧 Started` (no tracker).
3. **Review round N (FAIL)** = a further commit `TASK-NNN: address review N` (rounds are 1-based; TASK-004/005 wrote `address review` with no number). Occasionally `Merge branch 'feat/security-testing-bundle-spec' into task/task-NNN` when the reviewer required a rebase (TASK-006 at 10:08:53, TASK-012 at 11:35:46), and `Merge branch 'task/task-004' into task/task-002` (08:58:31) when a dependency landed mid-flight.
4. **PASS + merge** = merge commit on the integration branch with subject `merge task/task-NNN (Rio: PASS)`, variants `(Rio: PASS after 1 fix)`, `(Rio: PASS after 3 rounds)`, `(Rio: PASS); resolve additive conflict in tokens.mjs`, `(Rio: PASS) (tokens.mjs additive conflict resolved)`. The verdict token is **only** in the subject line; the body holds only the trailers. Merges are **batched per group** (same second: `08:23:33` ×4, `12:59:09-10` ×3, `17:03:54-57` ×2).
5. **Integration fix** outside any task: `f65658c 12:21:27 integration: cmd-scope imports assessmentDirt from lib/clean-tree.mjs (moved by TASK-008 while TASK-013 was in flight)`.
6. **Group close** = `plan(security-testing): PM log after Gn` commit editing only the plan file (e.g. `b1f70d2`: 1 file, +26 lines) — the PM's status report, review nits routed to owning tasks, and regrouping decisions.
7. **Branches are never deleted** (`git branch` lists 36 `task/task-*`), so "merged" vs "abandoned" is only distinguishable by the presence of a merge commit.

Reliability notes for a parser:
- Review-round count is **not** reliably in the merge subject: TASK-004 has 1 `address review` + 2 more commits and the subject says plain `PASS`; TASK-059 has `address review 1` and `2` and the subject says plain `PASS`; TASK-018 has `address review 1` and plain `PASS`. Counting `TASK-NNN: address review` commits is the honest signal (distribution over 33 merged: 0 rounds = 22, 1 = 8, 2 = 1, 3 = 2).
- The task id is the only join key across branch name (`task/task-NNN`), commit subject prefix (`TASK-NNN:`), merge subject (`merge task/task-NNN`), and the plan heading (`#### TASK-NNN:`). It is a stable convention across all four.

---

## 5. Hooks that fire per dispatch

Wired events (`hooks/hooks.json:1-28`): `SessionStart` (matcher `startup|clear|compact|resume`) → `run-hook.cmd session-start`; `SubagentStart` (matcher `*`) → `run-hook.cmd agent-start`. Both `"async": false`. The installer merges the same two events into `.claude/settings.json` tagged `_factory: "sdlc-core"` (`hooks/README.md:135-137`, `bin/init.mjs:999-1005`). Codex/Copilot templates wire the same two events (`hooks/hooks-codex.json`, `hooks/hooks-copilot.json`). **There is no `SubagentStop`, `Stop`, `PreToolUse` or `PostToolUse` hook in the core set** — grep of `hooks/` and `bin/` finds none.

What `agent-start` does (`hooks/agent-start:22-67`): resolves `PROJECT_DIR` from `CLAUDE_PROJECT_DIR`/`COPILOT_PROJECT_DIR`/`$PWD` (line 32); reads the stdin payload with a bounded read (`read_stdin_payload`, line 40); extracts the role by trying keys `agentName agent_name subagent_type agent_type agentType name` (line 41); builds the capped context (`build_capped_context`, line 57) = role memory files `SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md` (`hooks/config.sh.example:22`) + shared docs `testing profile workflow conventions role-overrides team-comms` (`config.sh.example:13`); emits `hookSpecificOutput.additionalContext` (`emit_subagent_context`, line 66). It exits 0 silently when nothing is injectable (line 62-64). It is **pure read + inject; it writes nothing to disk**.

Could it stamp a start time? Facts that bear on it:
- It runs once per dispatch, synchronously, with the role name in hand — so it knows *who* and *when*, but **not which task**: the SubagentStart payload carries the agent name and (per the test-automation hook README) a `transcript_path`, not the prompt text, so the `TASK-NNN` id is not available to it. `bundles/test-automation/hooks/README.md:37-48` explains the only reliable dispatch identifiers are `wf_<run>` and `agent-<id>` parsed from `transcript_path`.
- The factory-hooks mechanism exists and is the precedent for a *writing* hook: `bundles/SPEC.md:243-272` (`hooks/hooks.json` fragment + `hooks/scripts/`, merged into `settings.json` tagged `_factory`, "for each target in `targets ∩ installed targets`"), and `bundles/test-automation/hooks/hooks.json` registers `SubagentStop` (matcher `test-automation-engineer|test-automation-lead|test-runner`, `"async": true`) → `workflow-return`, writing `.agents/telemetry/automation/returns/<run-id>/<agent-id>.json`. Its three rules (`README.md:64-72`): never writes stdout, never exits non-zero, never touches a non-workflow dispatch. `bundles/manual-qa/hooks/hooks.json` goes further with `PreToolUse`/`PostToolUse`/`SubagentStop`/`SessionEnd`.
- `bundles/SPEC.md:276-277`: "The `feature-development` factory does not ship hooks yet — the merge machinery is in place; concrete hooks (format-on-edit, etc.) come later." `bundles/feature-development/factory.json` has no `hooks` key; `"targets": ["claude"]`.
- The `session-start` header comment (`hooks/session-start:96-117`) is a standing design ruling against injecting per-workstream state from a role-blind hook, and specifically against a session "writing its own state — which is the board the pipeline deliberately does not have" (line 111). That is an argument about *injection into context*, not about *append-only telemetry*; the tokenomics `SubagentStop --dispatch` hook writes `.agents/telemetry/automation/live/<session>.jsonl` "role, label, case ids, tokens, active minutes" per dispatch (`bundles/test-automation/skills/tokenomics/SKILL.md:214-221`) and is the accepted precedent.
- Transcripts already carry timestamps: `session-retrospective/references/transcript-schema.md:19-27` (`timestamp` ISO, `gitBranch`, `cwd`, `sessionId` per record; sub-agent `agent-<id>.meta.json` with `{ agentType, description, toolUseId }`), and `distill-sessions.mjs:137-144` computes `durationMin` from first/last `timestamp`. The sub-agent `description` is the dispatch prompt summary — the place a `TASK-NNN` id would be recoverable from transcripts. But transcripts expire (~30 days, `tokenomics/SKILL.md:15-17`) and are per-machine.

---

## 6. The seeded `.agents/` layout and where a ledger would naturally live

From `skills/seeding-a-project/SKILL.md:20-38` (what scout generates):

```
project-root/
├── CLAUDE.md, AGENTS.md            (factory block spliced between <!-- FACTORY:feature-development --> markers)
└── .agents/
    ├── knowledge/                  committed, cross-role, verified facts (Step 2.5, SKILL.md:163-204); subfolders architecture/ services/ frontend/ integrations/ environment/ practices/ testing/ security/
    ├── profile.md                  frontmatter project/team/issue-tracker/default-branch/languages; § Project systems (Issue tracker, TMS, KB, Bug filing); § Automation PR policy (Base branch, Merge policy, Squash/rebase/merge)  — templates.md:166-278
    ├── workflow.md                 § Git host (Host, CLI of choice), § Team & roles, § Review gates, § Branching & commits, § Test delivery pattern, § CI gates, § Evolution signals — templates.md:280-397
    ├── team-comms.md               roster + dispatch syntax (Step 6.5)
    ├── testing.md, conventions.md, architecture.md, onboarding.md, role-overrides.md, test-automation.yaml
    ├── retrospectives/YYYY-MM-DD.md   (session-retrospective/SKILL.md:70-71)
    └── memory/<role>/              LOCAL ONLY, gitignored (instructions.md:81-83): SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md daily/YYYY-MM-DD.md (`- [HH:MM] <text>` lines, skills/memory/SKILL.md:204-220)
```

Which of these is injected: `profile workflow testing conventions role-overrides team-comms` are the lean shared docs every dispatch receives (`hooks/config.sh.example:13`); `.agents/memory/<role>/*` is per-role; `AGENTS.md`, `docs/`, `.agents/architecture.md` are on-demand (`hooks/README.md:20-21`).

Existing precedents for **per-project, git-committed operational data** under `.agents/`:
- `.agents/telemetry/automation/` — tokenomics ledger (`usage-<user>.jsonl`), `scopes/<session-id>.json` (declared session scope: `work-scope.mjs open --session <id> --intent automation --batch <slug> --cases …`, `outcome … ELITEA-1=delivered`, `close`), `live/<session>.jsonl` (per-dispatch), `returns/<run-id>/<agent-id>.json` (SubagentStop conclusions), `reports/<batch>.html`; kept on a `telemetry` branch as a submodule of the same repo (`tokenomics/SKILL.md:289-299`). The word "telemetry area" (`test-automation/hooks/README.md:9`) implies `.agents/telemetry/<area>/` is the namespace convention.
- `.agents/automation/<slug>/cost.json`, `gate-runs.jsonl` — pipeline receipts (`tokenomics/SKILL.md:99,185`).
- `.agents/security-testing/` (`<st>`) — the bundle being built on this branch keeps its runs/ledger there (`tasks-v2.md:9`).
- `.agents/retrospectives/` — dated reports.

Constraints that rule places **out**: `instructions.md:94-95` "Mission state belongs on the work board, not in either memory layer" (so not `.agents/memory/` and not `.agents/knowledge/`); memory is gitignored and per-machine anyway (`instructions.md:81-83`); the shared lean docs are injected on every dispatch and byte-capped (`hooks/session-start:119-147`, `SDLC_CTX_CAP`, ~10 KB on Copilot), so a growing ledger must not be one of `SDLC_SHARED_DOCS`.

Inference: the natural home by analogy with tokenomics is a sibling area under `.agents/telemetry/` (append-only JSONL + a rendered report), not injected, not in memory, referenced from the plan/PM log by task id.

---

## 7. What the git dataset does and does not yield

### 7.1 Per-task table (local time, +0200; `branch created` is from `git reflog show task/task-NNN`)

| Task | Grp | Cplx | branch created | first TASK commit | last TASK commit | merge | rounds | created→merge | first→merge | first→last | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TASK-001 | G0 | S | 07:44:49 | 07:48:54 | 07:48:54 | 08:23:33 | 0 | 39 | 35 | 0 | Rio: PASS |
| TASK-002 | G2 | M | 08:58:31 | 09:07:53 | 09:07:53 | 09:12:59 | 0 | 14 | 5 | 0 | Rio: PASS |
| TASK-003 | G1 | S | 07:44:36 | 07:49:38 | 07:49:38 | 08:23:33 | 0 | 39 | 34 | 0 | Rio: PASS |
| TASK-004 | G1 | M | 07:44:43 | 07:54:47 | 08:52:19 | 09:12:59 | 1 | 88 | 78 | 58 | Rio: PASS |
| TASK-005 | G1 | L | 07:44:35 | 07:59:14 | 08:07:50 | 08:23:33 | 1 | 39 | 24 | 9 | Rio: PASS |
| TASK-006 | G3 | M | 09:14:26 | 09:33:42 | 10:21:47 | 10:25:11 | 3 | 71 | 51 | 48 | Rio: PASS after 3 rounds |
| TASK-007 | G3 | S | 09:14:29 | 09:23:18 | 09:30:45 | 10:07:54 | 1 | 53 | 45 | 7 | Rio: PASS |
| TASK-008 | G6 | M | 11:43:57 | 12:00:57 | 12:00:57 | 12:13:58 | 0 | 30 | 13 | 0 | Rio: PASS |
| TASK-009 | G4 | S | 10:26:03 | 10:33:21 | 10:39:41 | 10:49:36 | 1 | 24 | 16 | 6 | Rio: PASS after 1 fix |
| TASK-010 | G5 | M | 10:51:33 | 11:01:47 | 11:10:15 | 11:33:20 | 1 | 42 | 32 | 8 | Rio: PASS after 1 fix |
| TASK-011 | G4 | S | 10:25:56 | 10:29:34 | 10:29:34 | 10:49:00 | 0 | 23 | 19 | 0 | Rio: PASS |
| TASK-012 | G5 | M | 10:51:42 | 11:05:29 | 11:39:39 | 11:42:54 | 3 | 51 | 37 | 34 | Rio: PASS after 3 rounds |
| TASK-013 | G6 | L | 11:43:57 | 11:56:03 | 11:56:03 | 12:14:34 | 0 | 31 | 19 | 0 | Rio: PASS |
| TASK-014 | G7 | M | 12:22:10 | 12:33:55 | 12:33:55 | 12:59:09 | 0 | 37 | 25 | 0 | Rio: PASS |
| TASK-015 | G6 | M | 11:43:57 | 11:58:48 | 11:58:48 | 12:14:41 | 0 | 31 | 16 | 0 | Rio: PASS |
| TASK-016 | G8 | M | 13:05:20 | 13:31:25 | 13:31:25 | 13:37:37 | 0 | 32 | 6 | 0 | Rio: PASS |
| TASK-017 | G7 | M | 12:22:06 | 12:38:21 | 12:38:21 | 12:59:10 | 0 | 37 | 21 | 0 | Rio: PASS |
| TASK-018 | G7 | L | 12:22:00 | 12:41:45 | 12:53:33 | 12:59:10 | 1 | 37 | 17 | 12 | Rio: PASS |
| TASK-019 | G9 | L | 13:39:05 | 14:02:45 | 14:02:45 | 14:11:49 | 0 | 33 | 9 | 0 | Rio: PASS |
| TASK-020 | G7 | M | 13:39:11 | 13:53:49 | 13:53:49 | 14:11:49 | 0 | 33 | 18 | 0 | Rio: PASS |
| TASK-021 | G10 | S | 14:14:41 | 14:28:36 | 14:28:36 | 14:35:26 | 0 | 21 | 7 | 0 | Rio: PASS |
| TASK-022 | G11 | L | 14:37:05 | 14:54:50 | 14:54:50 | 16:00:52 | 0 | 84 | 66 | 0 | Rio: PASS |
| TASK-023 | G12 | L | 16:02:35 | 16:55:16 | 16:55:16 | 17:03:54 | 0 | 61 | 9 | 0 | Rio: PASS |
| TASK-026 | G3 | M | 09:14:26 | 09:25:35 | 09:25:35 | 10:07:54 | 0 | 53 | 42 | 0 | Rio: PASS |
| TASK-028 | G4 | L | 10:26:01 | 10:43:27 | 10:43:27 | 10:50:19 | 0 | 24 | 7 | 0 | Rio: PASS |
| TASK-029 | G5 | L | 10:51:27 | 11:12:14 | 11:20:37 | 11:34:08 | 1 | 43 | 22 | 8 | Rio: PASS after 1 fix |
| TASK-030 | G6 | S | 11:44:09 | 11:52:20 | 11:52:20 | 12:14:42 | 0 | 31 | 22 | 0 | Rio: PASS |
| TASK-032 | G6 | S | 11:44:12 | 11:51:50 | 12:04:31 | 12:16:22 | 1 | 32 | 25 | 13 | Rio: PASS |
| TASK-034 | G12 | M | 16:02:41 | 16:39:52 | 16:39:52 | 17:03:57 | 0 | 61 | 24 | 0 | Rio: PASS |
| TASK-056 | G1 | M | 07:44:44 | 07:49:42 | 07:49:42 | 08:23:33 | 0 | 39 | 34 | 0 | Rio: PASS |
| TASK-057 | G7 | S | 13:05:09 | 13:16:28 | 13:16:28 | 13:37:38 | 0 | 32 | 21 | 0 | Rio: PASS |
| TASK-058 | G6 | M | 11:44:05 | 11:56:18 | 11:56:18 | 12:16:22 | 0 | 32 | 20 | 0 | Rio: PASS |
| TASK-059 | G6 | S | 11:44:07 | 11:50:58 | 12:09:20 | 12:16:22 | 2 | 32 | 25 | 18 | Rio: PASS |
| TASK-027/031/036 | G13 | L/M/? | 17:06:05 | — | — | — | — | open in `.claude/worktrees/wf_70c041ed-ce7-{12,13,14}` | | | |

Durations in minutes. Script: `scratchpad/tasks.mjs` (reproducible from `git log main..feat/security-testing-bundle-spec` + `git reflog`).

### 7.2 Aggregates (33 merged tasks)

- **first-commit→merge** by Complexity: S n=10 median 25 (7–45); M n=15 median 24 (5–78); L n=8 median 19 (7–66). Mean 25/28/22.
- **branch-created→merge** by Complexity: S median 32 (21–53); M median 37 (14–88); L median 39 (24–84). Mean 33/43/44.
- **Complexity has almost no predictive power at this granularity**: the L median (39) is 7 min above the S median (32); the spread inside one class (M: 14–88) dwarfs the gap between classes. Inference: on this harness the dominant cost is review rounds and batch queueing, not the S/M/L of the task.
- **Review rounds**: 22 tasks 0 rounds, 8 with 1, 1 with 2, 2 with 3. The two 3-round tasks (006, 012) are the longest `first→last` (48, 34 min).
- **created→first commit** (≈ pure implementation, since each task is one commit): 4 min (TASK-001) … 53 min (TASK-023, an L). This is the cleanest "actual effort" proxy git offers and is only available via reflog.
- **first commit→merge includes batch queueing**: TASK-003 was done at 07:49:38 and merged with the batch at 08:23:33 (34 min waiting on TASK-005's review round). Merges of a group land in the same second, so per-task merge latency is really per-group.

### 7.3 Group cadence (created → last merge of the group; then PM turnaround to the next group)

| Group | tasks | branches created | last merge | wall min | PM log commit | next group created | PM turnaround |
|---|---|---|---|---|---|---|---|
| G0+G1 | 001,003,004,005,056 | 07:44:35–07:44:49 | 08:23:33 (004 lagged to 09:12:59) | 39 (88) | — | G2 08:58:31 | (G2 waited on 004 round 2; 002 merged 09:12:59 with 004) |
| G2 | 002 | 08:58:31 | 09:12:59 | 14 | — | G3 09:14:26 | 1.5 min |
| G3 | 006,007,026 | 09:14:26–09:14:29 | 10:25:11 | 71 | 10:25:28 "after G3" | G4 10:25:56 | 45 s |
| G4 | 009,011,028 | 10:25:56–10:26:03 | 10:50:19 | 24 | — | G5 10:51:27 | 1 min |
| G5 | 010,012,029 | 10:51:27–10:51:42 | 11:42:54 | 51 | — | G6 11:43:57 | 1 min |
| G6 | 008,013,015,030,032,058,059 | 11:43:57–11:44:12 | 12:16:22 | 32 | — | G7 12:22:00 | 5.6 min (integration fix `f65658c` 12:21:27 in between) |
| G7a | 014,017,018 | 12:22:00–12:22:10 | 12:59:10 | 37 | 13:04:39 "after G7" | G7b/G8 13:05:09 | 30 s |
| G7b+G8 | 057,016 | 13:05:09–13:05:20 | 13:37:38 | 32 | — | G7c/G9 13:39:05 | 1.5 min |
| G7c+G9 | 020,019 | 13:39:05–13:39:11 | 14:11:49 | 33 | — | G10 14:14:41 | 3 min |
| G10 | 021 | 14:14:41 | 14:35:26 | 21 | 14:36:41 "after G10" | G11 14:37:05 | 1.6 min |
| G11 | 022 | 14:37:05 | 16:00:52 | 84 | 16:02:15 "after G11" | G12 16:02:35 | 1.7 min |
| G12 | 023,034 | 16:02:35–16:02:41 | 17:03:57 | 61 | 17:05:38 "after G12" | G13 17:06:05 | 2 min |
| G13 | 027,031,036 | 17:06:05 | open | — | | | |

Campaign-level facts derivable from git: plan v2 committed 07:43:42; 33/59 tasks merged by 17:03:57 (9 h 20 min wall); G0–G12 of G0–G29 closed; 13 of the 20 critical-path steps done (001→004→002→006→009→012→013→014→016→019→021→022→023); the PM re-sequenced G7 into three waves (visible only by comparing the plan's `§1` with the reflog order and the PM log line 1222). Stories/spec timing: spec v1 09-14 16:29 → v6 approved 09-15 18:25 (≈26 h, 14 commits); stories+tasks v1 09-15 22:47; tasks v2 09-16 07:43.

### 7.4 What is NOT derivable from git

| Missing event | Why | Nearest substitute |
|---|---|---|
| **Dispatch time** (PM → dev) | no commit; branch creation is only in the local reflog (`git reflog` is not pushed, expires after 90 days by default, and is absent on any clone) | reflog while it lasts; sub-agent transcript first `timestamp` (`~/.claude/projects/<cwd>/<session>/subagents/agent-<id>.jsonl`, ~30-day expiry) |
| **Review start / review end / verdict time per round** | verdict only in merge subject; FAIL rounds only visible as the *dev's* fix commit, which is after the review ended | `address review N` commit = upper bound on review-N end; merge commit = PASS time (but batched) |
| **Who did what (role)** | author = committer = one human identity on all 111 commits; roles appear only as prose ("Rio") in merge subjects | none in git; transcripts' `agentType` |
| **Estimate** | never committed with the task; only `Complexity:` in the plan doc | parse `#### TASK-NNN:` headers in the plan file (fragile: markdown) |
| **PR opened / CI green** | no PRs were created; no remote | n/a on this dataset; on a seeded project `gh pr view --json createdAt,mergedAt,reviews` |
| **Abandoned / descoped / re-dispatched** | branches persist forever; nothing marks a dead one | "branch exists, no merge commit, no commits in N hours" (heuristic) |
| **Blocked intervals** | `Blocked` is a tracker/chat concept | none |
| **Queue wait vs review time** inside first→merge | merges batched per group | none without a per-round stamp |
| **Human wall-clock vs agent active time** | `distill-sessions.mjs:143` computes a transcript-span `durationMin`, not active time; tokenomics computes "active minutes" per dispatch from transcripts | transcripts only |
| **Task creation per task** | all 59 tasks created in one plan commit | plan commit time for the whole batch; later additions (`056–059 are new`, header line 5) only by diffing v1→v2 |

---

## 8. Implications for the spec (facts → constraints; no design)

1. **Minimal event set the data supports.** Per task: `created` (plan commit / tracker issue created), `estimated` (the `Complexity:` field at creation; no duration field exists to carry a time estimate today), `dispatched` (branch creation / SubagentStart), `first_commit`, `pr_opened` (absent in the local-branch mode; present on seeded projects), `review_round_n {verdict}` (PASS/FAIL, currently only the PASS is recorded and only in a merge subject), `merged` (merge commit) or `abandoned` (no artefact exists today). Per group: `opened` (first branch), `closed` (last merge), `pm_log` (status commit). Per campaign: `plan_committed`, `critical_path_progress`.
2. **The task id is the only universal join key**, and it is already consistent across plan heading, branch name, commit prefix and merge subject. Any capture must key on `TASK-NNN` (and `US-NNN` / epic for roll-up), which the plan file already maps (`**Story:** US-xxx` per task header).
3. **The least-ceremony capture points, given what exists**:
   - *created/estimated*: the tech-lead's task header already carries `Complexity:`; the plan commit gives the batch time. A per-task creation time only exists if the tracker is used (`gh issue create`).
   - *dispatched*: the PM prose says "Always update [tracker labels] when routing" and `📬 Assigned`; in local-branch mode the branch creation is the event but it is not durable. `agent-start` fires at exactly this moment with the role but **without the task id** — a stamp there would need the id passed some other way (e.g. in the branch name that `git branch --show-current` yields inside the worktree, which is `task/task-NNN` in this harness).
   - *review rounds*: the reviewer is the only party who knows the round boundaries; today they surface as the dev's `address review N` commit and the merge subject. The `SubagentStop` factory-hook precedent (`bundles/test-automation/hooks/`) shows a per-dispatch conclusion can be written asynchronously without touching context.
   - *merged*: already durable and parseable (`merge task/task-NNN (Rio: PASS …)`); on seeded projects the PM's merge step 5 status line ("PR #<M> merged — …") is chat-only.
4. **Estimated-vs-actual has no "estimated" today** beyond S/M/L, and the dataset shows S/M/L does not separate delivery times (medians 32/37/39 min). Any estimate-vs-actual feature needs either a new field in the tech-lead task template or a calibration table derived from history (S/M/L → observed distribution), because devs are explicitly told not to give time estimates (`js-dev/AGENT.md:185`).
5. **Batching distorts per-task cycle time**: merges land per group, so per-task `first→merge` is a group property. A tracker should record group membership (from the plan `§1`) to separate review latency from queue wait.
6. **Storage**: `instructions.md:95` rules memory/knowledge out; `.agents/telemetry/<area>/` is the established, committed, non-injected home (tokenomics), with JSONL append + rendered report as the shape. The shared lean docs are byte-capped and injected on every dispatch, so the ledger must not be one of them.
7. **Two operating modes must both be covered**: the documented tracker+PR mode (evidence = tracker comments, PR timestamps via `gh pr view --json`) and the observed local-branch/worktree mode (evidence = reflog, commit subjects, merge subjects, plan file). The dataset is 100% the second mode.
8. **Portability**: core hooks are wired on Claude/Codex/Copilot; factory hooks are `targets: ["claude"]` only (`bundles/SPEC.md:195`, `test-automation/hooks/README.md:79-81`). A git-only derivation (commits + merge subjects) is the only source that works on every host and on every clone; reflog- and transcript-based sources are machine-local and expiring.

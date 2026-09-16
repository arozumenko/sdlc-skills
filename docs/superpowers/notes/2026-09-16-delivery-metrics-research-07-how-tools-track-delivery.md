# 07 — How existing tools model and store delivery-tracking data

Research input for the "internal delivery performance tracker" spec (a cycle-time /
cadence / estimated-vs-actual analogue of `tokenomics`, attributing to the harness's
campaign / mission / task / case items). Reports what exists; does not design.
Sources are cited inline. Where a vendor doc page was unreachable and a fact comes from
a search snippet or a third-party mirror, that is flagged.

Local grounding used for the "implications" section:
- `bundles/test-automation/skills/tokenomics/SKILL.md` L19–23 (ledger path
  `.agents/telemetry/automation/usage-<user>.jsonl`, one line per session),
  L145–190 (scope record `scopes/<session-id>.json`, `{intent, batch?, cases, outcomes?}`),
  L266–283 (ledger line fields), L285–305 (telemetry submodule, per-user file,
  `gate-runs/<batch>.jsonl`, `returns/`).
- `bundles/test-automation/skills/tokenomics/hooks/telemetry-capture.mjs` L40
  (`LEDGER_VERSION = 1`), L386–387 (live dispatch log path
  `live/<sessionId>.jsonl`), L439–447 (per-dispatch record: `v, session, agentId, role,
  label, cases, endedAt`), L605–613 (dispatch `label` is "the attribution key";
  `STAGE_MARKER` regex names the stages `triage|analyst|implement|combined|review|fix
  round|carve|merge|hardening gate|mini-gate|gate for batch|report writer|...`),
  L747–753 (session line `v, host, id, user, startedAt, endedAt`), L809–823
  (append-only + "latest-endedAt-wins" dedupe by `host:id`).
- `bundles/test-automation/skills/tokenomics/scripts/build-tokenomics-export.mjs`
  L108, L127, L136, L149–157 (existing estimate-ish fields already in the export row:
  `effort_days`, `size_tshirt`, `scenario_complexity`, `story_points`, `self_size` —
  `effort_days` is "derived from scoping SP (SP × 1h ÷ 8)", i.e. a conventional-effort
  estimate, not a report).

---

## Part A — Per product / standard

### A1. LinearB (engineering intelligence, PR-centric)

- **Entity model.** Branch → Pull Request → Release/deploy; optional Jira issue link. Team-level only ("a team-level metric ... not individual performance").
- **Event model / phases.** Cycle Time = four sequential, completed-phase durations:
  - *Coding Time*: "first commit on a branch" → PR opened. With Jira integration it can start when the linked issue moves to "In Progress".
  - *Pickup Time*: PR opened → "first non-author comment" (falls back to approval/merge if no comment).
  - *Review Time*: first non-author review action → merge; recorded as **0** if "approved or merged without any comments".
  - *Deploy Time*: merge → "released to production" (release tags mapped back to branches).
  - Rule: "LinearB does **not** include time spent in a phase until that phase is fully completed"; cycle time is "an average of each completed phase". Incomplete branches in the window are still listed.
- **Estimate fields.** None native (PR-side product); Jira points via integration only.
- **Derived metrics.** Cycle Time and its four phases; DORA set; PR size; "Merge frequency"; "PRs merged without review".
- Sources: https://linearb.helpdocs.io/article/0vif1ihmgc-how-is-cycle-time-calculated , https://linearb.helpdocs.io/article/v9pckvmkbj-cycle-time , https://linearb.helpdocs.io/article/v2ikos8lvw-pickup-time-metric , https://linearb.helpdocs.io/article/1s38stsugw-glossary-metrics

### A2. Swarmia

- **Entity model.** Pull Request (GitHub) and Issue (Jira/Linear) as separate first-class objects; issue statuses are **normalized via status mapping** into three canonical buckets: `To Do`, `In Progress`, `Done / Won't Do`.
- **PR event model.** Three summed components ("cycle time is the sum of these three"):
  - *Time in progress*: "from the first commit or from when the pull request is opened, whichever happens first" → first review request.
  - *Time in review*: first review request (or PR open if none) → final approval.
  - *Time to merge*: final approval → merged.
  - Plus *Time to first review*: "from when a pull request review is first requested until the first review is submitted (whether it's an approval or request for changes)". *Draft time* is shown as a sub-line under cycle time (changelog 2026-09-11).
- **Issue event model.** "The cycle time of any work is the amount of time it has spent in the In Progress status, according to your issue tracker." **Non-linear transitions are handled by summing only active In-Progress intervals** (1 wk work → 3 mo paused → 1 wk = 2 wk). Issues that jump To Do → Done are "undefined" and excluded; items still in progress are "incomplete" and excluded from averages. Weekend exclusion is a configurable org setting; evenings always count.
- **Estimate fields.** Not part of the metric layer (reads points from tracker for "Investment" and planning views only).
- **Derived metrics.** PR cycle time + 3 stages, time to first review, batch size (LOC), "Work in progress" = "Average number of issues in progress at a time", issue cycle time, review-related ("PRs merged without review"), investment categories (`New things`, `Improvements`, `Productivity`, `KTLO`).
- Sources: https://help.swarmia.com/definitions/defining-issue-lifecycle-and-cycle-time.md , https://help.swarmia.com/features/metrics/pull-request-cycle-time.md , https://help.swarmia.com/features/metrics/pull-request-cycle-time/time-to-review , https://www.swarmia.com/changelog/2026-09-11-pull-request-draft-time/ , https://help.swarmia.com/llms-full.txt

### A3. Jellyfish

- **Entity model.** Jira issue hierarchy (Epic → Story/Task) plus "Deliverables" (Jellyfish-defined containers spanning epics) and Allocation (work → investment categories, "Investment Allocation").
- **Event model.** Life Cycle Explorer tracks issues "through Jira workflows" and buckets time into four phases: **Refinement** ("between issue creation and the status changing to 'in progress' or your initial code commit – whichever comes first"), **Work**, **Review**, **Deployment**; "the full life cycle is from creation to production deployment".
- **Cycle time definition.** "start of work is indicated by when an engineer marks an issue as 'in progress'"; end "when the issue is marked as resolved". Explicit caveat: depends on Jira hygiene; cycle time "does not reveal the size and scope of work".
- **Estimate fields.** Story points from Jira; effort is also inferred from activity (allocation is "effort"-based, e.g. engineer-weeks).
- **Derived metrics.** Issue cycle time, phase durations, allocation %, deliverable progress/scope trend, DORA.
- Sources: https://jellyfish.co/blog/issue-cycle-time-the-staple-engineering-operations-metric/ , https://jellyfish.co/platform/life-cycle-explorer/ , https://jellyfish.co/blog/life-cycle-explorer-remediate-bottlenecks-unlock-process-obstacles-improve-trends-throughout-the-sdlc/ , https://jellyfish.co/blog/cycle-time-vs-lead-time-2/

### A4. Haystack

- **Entity model.** PR-centric.
- **Event model.** *Cycle Time* = "first commit to pull request merged". *Development Time* = first commit → PR opened. *Review Time* = PR open → merge, reported at **85th percentile**, decomposed into **First Response Time**, **Rework Time** ("time from first comment to the last commit"), **Idle Completion Time**.
- **Derived metrics.** Throughput ("number of pull-requests that have been merged in a given timeframe"), Change Lead Time, DORA.
- Sources: https://support.usehaystack.io/en/articles/6609240-metrics-101 , https://support.usehaystack.io/en/articles/4523314-drilling-into-change-lead-time-the-secret-weapon-of-efficient-engineering-teams , https://www.usehaystack.io/blog/engineering-metrics-that-matter-how-to-evaluate-and-improve-code-reviews

### A5. Sleuth (deploy-event ledger → DORA)

- **Entity model.** Project → Deployment (a "code deployment" target) → Environment; each registered deploy carries `sha` and a set of commits/PRs; also "manual changes" and "custom impact values"; incidents with states `triggered`, `resolved`, `reopened`.
- **Event model.** You **register events** (REST `https://app.sleuth.io/api/1`, or outbound webhook signed with `X-SLEUTH-TIMESTAMP` / `X-SLEUTH-SIGNATURE`): required `sha`, `environment`; optional `branch`, `tags`, `links`, `commits`, `files`, PR metadata, date. Change Lead Time start = "the time of the first code commit included in the Deploy" **or**, per-project option, "the first moment that any issue included in the Deploy is transitioned to any state" configured as in-progress (earliest such transition; commit time is the fallback). End = deploy time in the target environment. Breakdown: **Coding** (first commit / issue in-progress → PR open), **Review lag time** (PR open → first review), **Review time** (first review → merge), **Deploying** (merge → deploy). Averages per deploy, per environment.
- **Estimate fields.** None.
- **Derived metrics.** Four DORA keys per project + environment; lead-time breakdown; "custom impact" overlays.
- Sources: https://help.sleuth.io/sleuth-dora/accelerate-metrics/change-lead-time.md , https://github.com/api-evangelist/sleuth (third-party API profile), https://www.sleuth.io/post/change-lead-time-explained/

### A6. Faros AI (canonical schema + events CLI)

- **Entity model.** Namespaced canonical schema: `vcs_*` (e.g. `vcs_Commit`, `vcs_PullRequest`), `tms_*` (task management: `tms_Task`, epics, sprints), `cicd_*` (`cicd_Build`, `cicd_Deployment`, `cicd_ArtifactDeployment`), `compute_Application`, plus `cal_*` (calendar). Entities are cross-linked (commit ↔ build ↔ PR ↔ deployment). *Exact `tms_Task` field list (status changelog, points) was not retrievable — docs.faros.ai is password-gated; inferred from the community edition and connector walkthrough that `tms_Task` carries `status`, `statusChangelog`, `points`, `createdAt`, `resolvedAt`.*
- **Event model (faros-events-cli).** Two event kinds: **CI** and **CD**.
  - CI: `--run "<source>://<org>/<pipeline>/<run_id>"`, `--run_status` ∈ {`Success`,`Failed`,`Canceled`,`Queued`,`Running`,`Unknown`,`Custom`}, `--run_start_time`, `--run_end_time` (epoch ms | ISO-8601 | `Now`), `--commit "<source>://<org>/<repo>/<sha>"`, `--artifact`, `--pull_request_number`; step-level `--run_step_id/name/status/start_time/end_time/type` (`Script|Manual|Custom`).
  - CD: `--deploy "<source>://<application>/<environment>/<deploy_id>"`, `--deploy_status` ∈ {`Success`,`Failed`,`Canceled`,`Queued`,`Running`,`RolledBack`,`Custom`}, `--deploy_start_time`, `--deploy_end_time`, `--deploy_requested_at`, `--deploy_app_platform`, `--deploy_env_details`, `--deploy_tags`.
  - Pattern to note: **a URI-shaped composite id** (`source://org/repo/sha`) is the join key, and every event carries both a *requested_at* and *start/end* pair.
- **Derived metrics.** DORA, cycle/lead time from `tms` status changes, allocation.
- Sources: https://github.com/faros-ai/faros-events-cli (README), https://community.faros.ai/docs/report-cicd-events , https://docs.faros.ai/docs/faros-schema (gated), https://github.com/faros-ai/custom-connector-guide/blob/main/WALKTHROUGH.md

### A7. DX (getdx.com) — DX Core 4

- **Entity model.** Engineer, PR, Issue (Jira), Survey snapshot; no bespoke lifecycle model.
- **Metrics (exact names).** *Speed*: "PR throughput" — "Average PRs merged per engineer/week (90-day lookback)" (self-reported) / "PRs merged from SCM; bot PRs omitted; normalized per contributor" (system); "TrueThroughput®" (complexity-weighted, coming). *Effectiveness*: DXI (survey only). *Quality*: "Change fail percentage", "Defect ratio" ("% of PRs allocated to bug fixes"), "Production degradation". *Impact*: "Innovation ratio" ("% of time on new capabilities vs. other work"), "Jira allocation". Onboarding: "Time to 10th PR" — "number of days it takes a new engineer to submit their tenth pull request".
- **Estimate fields.** None.
- Sources: https://docs.getdx.com/dx-core-4.md , https://getdx.com/research/measuring-developer-productivity-with-the-dx-core-4/

### A8. Pluralsight Flow

- **Entity model.** Commit, PR, Ticket.
- **Metrics (exact names).** Code fundamentals: **Impact** ("how much cognitive load did the engineer carry"), **Efficiency** ("ratio of productive code to churned code"), **Churn** ("re-writes their own code within 30 days"), **Rework** = same, **Legacy Refactor** ("code older than 30 days is rewritten"), New Work. PR review: **Time to first comment** ("calculated using the creation date of the PR and includes any time the PR spent in draft status"), **Time to merge** ("average time in hours between when pull requests are created and when they are merged, rounded to the nearest tenth"), Time to Resolve, Reaction time, Responsiveness, Receptiveness, Unreviewed PRs, Sharing index (some named in snippets only).
- Note: Flow's "Rework" is **code-level** (30-day self-rewrite), a different concept from Haystack's review-round **Rework Time** and from the harness's "fix round" rework spend (`tokenomics/SKILL.md` L109–111 "a separate **rework** figure (fix-round spend)").
- Sources: https://www.pluralsight.com/resources/blog/software-development/code-churn , https://help.pluralsight.com/hc/en-us/articles/24362236198164-Time-to-first-comment , https://help.pluralsight.com/hc/en-us/articles/24362235231508-Time-to-merge , https://help.pluralsight.com/hc/en-us/articles/24351293542804-Impact

### A9. Atlassian Jira

- **Entity model.** Hierarchy Epic → Story/Task/Bug → Sub-task (Plans add Initiative and custom levels above Epic); Sprint; Board; Version/Release; Deployment (via CI/CD integration).
- **Event model — the changelog.** `GET /rest/api/{2,3}/issue/{key}?expand=changelog` → `changelog.histories[]` each `{id, author, created, items[]}`; each item `{field, fieldtype, fieldId?, from, fromString, to, toString}`. A status transition is an item with `field: "status"`, `from: "1"`, `fromString: "Open"`, `to: "3"`, `toString: "In Progress"`; the `created` timestamp on the history is the transition time. **Every field change** (assignee, sprint, points, estimate) is recorded the same way, so "time in status" is a fold over `status` items. Time in status is not a built-in report (marketplace apps compute "Issue Age, Cycle Time, Lead Time, Resolution Time" from it).
- **Estimate fields (exact).** Time tracking triple: `timeoriginalestimate` (Original Estimate), `timeestimate` (Remaining Estimate), `timespent` (Time Spent, = sum of worklogs; worklogs post `timeSpentSeconds`), with sub-task rollups `aggregatetimeoriginalestimate`, `aggregatetimeestimate`, `aggregatetimespent`; JQL names `originalEstimate`, `remainingEstimate`, `timeSpent`, `workRatio`. Story points = a numeric custom field ("Story points" / "Story point estimate"). **Plans (Advanced Roadmaps)**: progress = "Time spent / (Time spent + Remaining estimate)"; "if no remaining effort is set, the original estimate is considered"; rolled-up estimates are "dynamic and reflect how much work remains"; **"Advanced Roadmaps does not reference the 'Original Estimate' field at all"** for forecasting (community answer, inferred authoritative); rollup rounding: 1 dp for points, 2 dp for h/d.
- **Derived metrics (Jira Cloud built-ins).** *Cycle time report*: "a work item's cycle time from the first commit until the code is shipped" (most recent deployment if several); excludes items > 12 months; shows "median cycle time of one week compared to the 12 weeks prior"; "shipped" = deployed to production. *Deployment frequency report*: deployments/week, 12-week average. Control chart / velocity / burndown on boards.
- Sources: https://support.atlassian.com/jira/kb/how-to-analyze-the-history-or-changelog-of-an-issue-in-jira/ , https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/ , https://www.teranoapps.com/blog/jira-jql-time-tracking-queries-cheatsheet , https://jira.atlassian.com/browse/JRASERVER-21182 , https://support.atlassian.com/jira-software-cloud/docs/how-advanced-roadmaps-rolls-up-estimates/ , https://support.atlassian.com/jira-software-cloud/docs/track-progress-using-estimates-in-advanced-roadmaps/ , https://community.atlassian.com/forums/Advanced-Planning-in-Jira/Estimates-in-Advanced-Roamaps-doesn-t-update-ticket-estimate/td-p/1415155 , https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-your-cycle-time-report/

### A10. Azure DevOps (Azure Boards)

- **Entity model.** Epic → Feature → User Story / PBI / Requirement → Task (Bug configurable at either level); Iteration (sprint) path; Area path; Board column/lane.
- **Event model.** Work items are **revisioned** (every save is a revision; `Was Ever` operator queries history). System-maintained transition fields, all `DateTime` unless noted:
  - `System.CreatedDate`, `System.ChangedDate`, `System.State`, `System.Reason` ("Each transition ... is associated with a corresponding reason"), `Microsoft.VSTS.Common.StateChangeDate` ("when the value of the State field changed"),
  - `Microsoft.VSTS.Common.ActivatedDate` / `ActivatedBy` — set when the item "changed to an *In Progress* category state",
  - `Microsoft.VSTS.Common.ResolvedDate` / `ResolvedBy` / `ResolvedReason` — set on entry to the *Resolved* category,
  - `Microsoft.VSTS.Common.ClosedDate` / `ClosedBy` — set on close.
  - Semantics worth copying: fields update only on **category** change ("if you move from *Fixed* to *Ready for Testing*—which are in the same category state—the Resolved By/Date fields don't update"), and **backward transitions clear** them ("from *Resolved* to *Active* ... clears Resolved By/Date"). State categories: Proposed, In Progress, Resolved, Completed, Removed. Board fields `System.BoardColumn`, `System.BoardColumnDone` (bool, split columns), `System.BoardLane`.
- **Estimate fields (exact reference names, all `Double`).** `Microsoft.VSTS.Scheduling.OriginalEstimate` ("initial amount of work estimated to complete a task ... hours or days; no inherent units are enforced"; Task/Bug, Agile & CMMI), `Microsoft.VSTS.Scheduling.RemainingWork` (Task/Bug; all processes; drives burndown), `Microsoft.VSTS.Scheduling.CompletedWork` ("amount of work spent implementing a task"; Agile & CMMI), `Microsoft.VSTS.Scheduling.StoryPoints` (User Story/Bug, Agile), `Microsoft.VSTS.Scheduling.Effort` (PBI/Bug, Scrum; Feature/Epic), `Microsoft.VSTS.Scheduling.Size` (Requirement, CMMI), `Microsoft.VSTS.Common.BusinessValue` (Integer; Epic/Feature). Scrum process ships **only** `RemainingWork` on tasks — no original/completed. Date-scheduling fields: `Microsoft.VSTS.Scheduling.StartDate`, `FinishDate`, `TargetDate`.
- **Derived metrics.** Cumulative flow, velocity, sprint burndown (from RemainingWork), lead/cycle time widgets ("Lead time ... from creation to completion; Cycle time ... from In Progress to completion" per the CFD guidance page).
- Sources: https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-numeric?view=azure-devops , https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-by-workflow-changes?view=azure-devops , https://learn.microsoft.com/en-us/azure/devops/report/dashboards/cumulative-flow-cycle-lead-time-guidance?view=azure-devops

### A11. Linear

- **Entity model.** Initiative → Project → Issue (with sub-issues); Team; Cycle (time-boxed, auto-rolling); WorkflowState with `type` ∈ backlog/unstarted/started/completed/canceled (the category, not the name).
- **Event model.** Issue carries **derived lifecycle timestamps as columns** rather than a separate changelog: `createdAt`, `updatedAt`, `triagedAt`, `startedAt`, `completedAt`, `canceledAt`, `autoClosedAt`, `dueDate`, plus `stateId`, `cycleId`, `projectId`, `estimate`. `IssueHistory` (GraphQL) holds per-change records (from/to state, etc.). Webhooks: actions `create` / `update` / `remove`; `data` = current entity; `updatedFrom` = "the previous values of all updated properties" (null when previously unset) — i.e. a **delta** record.
- **Estimate fields.** `estimate` (number). Scales: **Exponential** 1,2,4,8,16; **Fibonacci** 1,2,3,5,8; **Linear** 1–5; **T-Shirt** XS,S,M,L,XL (T-shirt "follow[s] the Fibonacci scale" when a number is needed); "extended scale" adds two more per scale (Fibonacci 13,21; T-shirt XXL,XXXL); optional explicit **zero estimates**; "unestimated issues count as 1 point" by default.
- **Cycle metrics.** Cycle graph: gray = **scope** (points, or issue count fallback), solid blue = **completed**, yellow = **started** (stacked on completed), dotted = **target** (even burn of scope over remaining days, weekends excluded); hover shows "scoped, completed and started" per day and "how much scope was added or removed since the start of the cycle". "Cycle Success ... percentage of issues completed or started"; started issues count 25%. Issues closed between cycles can be retro-attributed to the previous cycle. Cycle object exposes history arrays (`issueCountHistory`, `completedIssueCountHistory`, `scopeHistory`, `completedScopeHistory`, `inProgressScopeHistory` — names from the public GraphQL schema; not confirmed on the docs page fetched).
- Sources: https://linear.app/developers/webhooks , https://linear.app/docs/estimates , https://linear.app/docs/cycle-graph , https://linear.app/docs/use-cycles , https://inventivehq.com/blog/linear-webhooks-guide (payload example)

### A12. Shortcut

- **Entity model.** Milestone/Objective → Epic → Story (feature/bug/chore) → Task; Iteration; Workflow with state **types** `unstarted` / `started` / `done`.
- **Event model.** Story fields: `created_at`, `started_at`, `completed_at`, `moved_at`, plus **manual overrides** `started_at_override`, `completed_at_override`; `workflow_state_id`. Story History endpoint records changes as `{old, new}` per field (from REST v3; page fetched but the story schema section was not in the excerpt — inferred from the API's JSON examples).
- **Estimate fields.** `estimate` (integer points; team-configurable scale).
- **Derived metrics (exact, on the API).** Story: `cycle_time`, `lead_time` (seconds). `IterationStats`: `average_cycle_time`, `average_lead_time`, `num_points_backlog`, `num_points_unstarted`, `num_points_started`, `num_points_done`, `num_points_total`, `num_points_unestimated`, and the `num_stories_*` twins. Shortcut convention (help centre): cycle time = started → done, lead time = created → done.
- Sources: https://developer.shortcut.com/api/rest/v3 , https://developer.shortcut.com/api/webhook/v1

### A13. GitLab Value Stream Analytics (VSA)

- **Entity model.** Exactly two domain models per stage: `Issue` and `MergeRequest` ("two models are allowed"). Value Stream → Stage → (start event, end event).
- **Event model (the catalogue).** Issue events: `IssueCreated`, `IssueClosed`, `IssueFirstAddedToBoard`, `IssueFirstAssociatedWithMilestone`, `IssueFirstMentionedInCommit` (from `issue_metrics.first_mentioned_in_commit_at`), `IssueLastEdited`, `IssueLabelAdded`, `IssueLabelRemoved`, `IssueFirstAssignedAt`, (issue first associated with an iteration). MR events: `MergeRequestCreated` (`merge_requests.created_at`), `MergeRequestMerged` (`merge_request_metrics.merged_at`), `MergeRequestClosed`, `MergeRequestFirstDeployedToProduction`, `MergeRequestLastBuildStarted`, `MergeRequestLastBuildFinished`, `MergeRequestLastEdited`, `MergeRequestLabelAdded`, `MergeRequestLabelRemoved`, `MergeRequestFirstAssignedAt`, (MR reviewer first assigned). Start/end pairs are validated ("Issue created" → "MR created" is invalid: different domain models). The aggregated backend materialises one row per (stage, record) with a start timestamp, an end timestamp and a duration (table family `analytics_cycle_analytics_*_stage_events`; exact column names not confirmed in the fetched excerpt).
- **Default stages.** Issue (create → first label or milestone), Plan (→ first commit pushed), Code (first commit → MR created, needs issue-closing pattern), Test (pipeline duration), Review (MR created → merged), Staging (merged → first production deploy). Medians.
- **Lifecycle metrics (exact).** *Lead time* = "Time from issue creation to closure"; *Cycle time* = "Duration between first commit reference and issue closure"; *New issues*; *Deploys*; plus DORA four.
- Known gap (their own issue tracker): label-based stages mis-handle labels added/removed multiple times (issue #419178) — i.e. **first-occurrence semantics** are the norm; repeated transitions need explicit rules.
- Sources: https://docs.gitlab.com/development/value_stream_analytics/ , https://docs.gitlab.com/user/group/value_stream_analytics/ , https://docs.gitlab.com/development/value_stream_analytics/value_stream_analytics_aggregated_backend/ , https://gitlab.com/gitlab-org/gitlab/-/issues/419178

### A14. GitHub Projects (v2) / Insights

- **Entity model.** Project → Item (issue, PR, or draft) with custom fields of type text, number, date, **iteration**, single-select; Status is a single-select; "Linked pull requests" is a built-in column. Issue types & sub-issues give a light hierarchy.
- **Event model.** No time-in-status stored; the documented route is the `projects_v2_item` webhook with `action: "edited"` and `changes.field_value{field_node_id, field_type, from, to}` — "understand how project fields change over time and how long they have a particular value". `ProjectV2StatusUpdate` objects (2024-06) carry project-level status notes. GraphQL `ProjectV2` exposes items and field values; timeline events on issues cover added/moved.
- **Estimate fields.** Any number field (convention "Estimate"/"Size"); no native points semantics.
- **Derived metrics.** Insights charts ("cycle velocity, current work status ... cumulative flow diagrams") built from current field values + history of the built-in charts; no exported cycle-time metric.
- Sources: https://docs.github.com/en/issues/planning-and-tracking-with-projects/viewing-insights-from-your-project/about-insights-for-projects , https://github.blog/changelog/2024-06-27-github-issues-projects-graphql-and-webhook-support-for-project-status-updates-and-more/ , https://docs.github.com/en/webhooks/webhook-events-and-payloads , https://docs.github.com/en/graphql/reference/projects

### A15. Google Four Keys / DORA-style event ledgers

- **Ledger table (exact).** `four_keys.events_raw` columns, all NULLABLE: `event_type` STRING, `id` STRING, `metadata` STRING (raw JSON), `time_created` TIMESTAMP, `signature` STRING (unique key), `msg_id` STRING, `source` STRING.
- **Derivation.** Views over the raw ledger: `changes` = `SELECT source, event_type, JSON_EXTRACT_SCALAR(commit,'$.id') change_id, TIMESTAMP(JSON_EXTRACT_SCALAR(commit,'$.timestamp')) time_created FROM events_raw, UNNEST(JSON_EXTRACT_ARRAY(metadata,'$.commits')) WHERE event_type = "push"`; `deployments` = `(source, deploy_id, time_created, main_commit, changes ARRAY<commit id>)` from deployment-type events; lead time = deploy `time_created` − change `time_created`; incidents similarly. Pattern: **raw append-only events + idempotent unique key + derived views**, never a mutable state table.
- **OpenDORA / Apache DevLake.** DevLake's domain layer (the model OpenDORA's Backstage plugin reads): `issues` (`id`, `issue_key`, `type`, `original_type`, `status`, `original_status`, `story_point`, `priority`, `created_date`, `updated_date`, `resolution_date`, `lead_time_minutes` = "resolution_date - created_date", `original_estimate_minutes`, `time_spent_minutes`, `time_remaining_minutes`); `issue_changelogs` (`issue_id`, `author_id`, `field_id`, `field_name`, `original_from_value`, `original_to_value`, `from_value`, `to_value`, `created_date`); `sprints` (`status`, `started_date`, `ended_date`, `completed_date`); `sprint_issues`; `pull_requests` (`status`, `original_status`, `created_date`, `merged_date`, `closed_date`, `base_ref`, `head_ref`); `pull_request_comments` (`type`, `status`); `cicd_deployments` (`result`, `original_result`, `status`, `original_status`, `environment`, `original_environment`, `created_date`, `started_date`, `finished_date`, `duration_sec`); `cicd_deployment_commits`. Note the consistent **`original_*` twin** for every normalised enum (keep the source value beside the canonical one).
- Sources: https://github.com/dora-team/fourkeys (setup/events_raw_schema.json, queries/changes.sql, queries/deployments.sql), https://devlake.apache.org/docs/DataModels/DevLakeDomainLayerSchema/ , https://devlake.apache.org/docs/Metrics/RequirementLeadTime/ , https://github.com/DevoteamNL/opendora , https://roadie.io/backstage/plugins/open-dora/

### A16. Agent-side products

**Anthropic Claude Code (OTel, docs "Monitoring usage").**
- Metrics: `claude_code.session.count`, `claude_code.lines_of_code.count`, `claude_code.pull_request.count`, `claude_code.commit.count`, `claude_code.cost.usage`, `claude_code.token.usage`, `claude_code.code_edit_tool.decision`, `claude_code.active_time.total`.
- Events (logs): `claude_code.user_prompt`, `claude_code.assistant_response`, `claude_code.tool_result`, `claude_code.api_request`, `claude_code.api_error`, `claude_code.tool_decision`.
- Standard attributes on everything: `session.id`, `app.version`, `app.entrypoint`, `organization.id`, `user.account_uuid`, `user.account_id`, `user.id`, `user.email`, `terminal.type`, `vcs.repository.url.full`, `vcs.owner.name`, `vcs.repository.name`, `vcs.provider.name`. Events additionally: `prompt.id`, `event.sequence`, `message.uuid`, `client_request_id`, `workspace.host_paths`, **`workflow.run_id`, `workflow.name`**.
- `api_request` attributes include `model`, `cost_usd`, `cost_usd_micros`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `speed`, `effort`, **`agent.name`, `skill.name`, `plugin.name`, `marketplace.name`, `mcp_server.name`, `mcp_tool.name`**. `tool_result`: `tool_name`, `tool_use_id`, `success`, `duration_ms`, `error_type`, `decision_type`, `decision_source`, `vcs.ref.head.revision`, `vcs.ref.head.name`. `user_prompt`: `prompt_length`, `command_name`, `command_source`.
- Env: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER` (beta), `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_METRICS_INCLUDE_SESSION_ID`, `OTEL_METRICS_INCLUDE_VERSION`, `OTEL_METRICS_INCLUDE_ACCOUNT_UUID`, `OTEL_METRICS_INCLUDE_ENTRYPOINT`, `OTEL_METRICS_INCLUDE_REPOSITORY`, `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`.
- **No work-item concept**: nothing above names a task/story/case; `session.id`, `agent.name`, `workflow.run_id`/`workflow.name` and `vcs.ref.head.name` are the only join handles. (The local tokenomics ledger already keys on `session` + `agentId` + `label` — `telemetry-capture.mjs` L439–441.)
- Source: https://code.claude.com/docs/en/monitoring-usage

**GitHub Copilot coding agent.** Public REST gives aggregated usage (`copilot-usage-metrics` 1-day/28-day reports, "Copilot Coding Agent (CCA)" breakdowns per repository) and an enterprise `GET /enterprises/{enterprise}/copilot/usage-records` stream of raw records (`type`, `user_id`, `enterprise_id`, `github_request_id`, `endpoint`, `body`, `@timestamp`, `event_id`). Work attribution is by the PR the agent opens (issue → agent session → PR). No public per-session lifecycle schema beyond that. Sources: https://docs.github.com/en/rest/copilot/copilot-usage-metrics , https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-usage-metrics?apiVersion=2026-03-10

**Devin (Cognition).** Session = the unit: `session_id`, `status` (string), `status_enum` ∈ {`working`, `blocked`, `expired`, `finished`, `suspend_requested`, `suspend_requested_frontend`, `resume_requested`, `resume_requested_frontend`, `resumed`}, `created_at`, `updated_at`, `title`, `tags[]`, `snapshot_id`, `playbook_id`, `pull_request{url}`, `requesting_user_email`, `structured_output` (caller-defined JSON schema the agent fills in). Attribution to work is via `tags` and `structured_output` — the caller's convention. Effort is billed in ACUs (not in the session listing). Source: https://docs.devin.ai/api-reference/sessions/list-sessions

**Cursor Cloud Agents.** Two-level model: Agent (`id` `bc-<uuid>`, `name`, `status` ∈ {`ACTIVE`, `IDLE`, `ARCHIVED`}, `repos[].url/startingRef/prUrl`, `autoCreatePR`, `createdAt`, `updatedAt`, `latestRunId`) → Run (`id` `run-<uuid>`, `agentId`, `status` ∈ {`CREATING`, `RUNNING`, `FINISHED`, `ERROR`, `CANCELLED`, `EXPIRED`}, `createdAt`, `updatedAt`, **`durationMs`** on terminal runs, `result`, `git.branches[]{repoUrl, branch, prUrl}`); `GET /v1/agents/{id}/usage` = token usage per run; SSE stream events `status`, `tool_call{callId,name,status}`, `result{runId,status,durationMs,git}`. Source: https://cursor.com/docs/cloud-agent/api/endpoints

**OpenAI Codex (cloud).** Task = unit ("five-step task lifecycle": container → checkout → run → diff → PR); CLI `codex cloud exec | list | status | diff | apply`; enterprise analytics dashboard reports "threads and turns", credits/tokens by model, active users by surface; export CSV/JSON; data lag up to 12 h. No public per-task schema found. Sources: https://developers.openai.com/codex/cloud , https://github.com/openai/codex/issues/24777

### A17. OpenTelemetry semantic conventions

**CI/CD (`cicd.*`).** Attributes: `cicd.pipeline.name`, `cicd.pipeline.run.id`, `cicd.pipeline.run.state` ∈ {`pending`, `executing`, `finalizing`}, `cicd.pipeline.result` ∈ {`success`, `failure`, `error`, `timeout`, `skip`, `cancellation`}, `cicd.pipeline.action.name` ∈ {`BUILD`, `RUN`, `SYNC`}, `cicd.pipeline.run.url.full`, `cicd.pipeline.task.name`, `cicd.pipeline.task.run.id`, `cicd.pipeline.task.run.result` (same enum), `cicd.pipeline.task.type` ∈ {`build`, `test`, `deploy`}, `cicd.pipeline.task.run.url.full`, `cicd.worker.id/name/state` (`available`, `busy`, `offline`), `cicd.system.component`. Metrics: `cicd.pipeline.run.duration` (histogram, `s`, by `cicd.pipeline.name` + `cicd.pipeline.run.state`, conditionally `cicd.pipeline.result`/`error.type`), `cicd.pipeline.run.active` (updowncounter), `cicd.worker.count`, `cicd.pipeline.run.errors`, `cicd.system.errors`. Pattern: **state (in-flight phase) and result (terminal outcome) are separate attributes**, and duration is recorded *per state*.

**VCS (`vcs.*`) — the closest thing to a standard for PR cycle time.** `vcs.change.count` (by `vcs.change.state` ∈ {`open`, `wip`, `closed`, `merged`}), `vcs.change.duration` (gauge `s`: "time duration a change ... has been in a given state"), `vcs.change.time_to_approval` (gauge `s`: "since its creation ... to get the first approval"), `vcs.change.time_to_merge` ("since its creation ... to get merged into the target(base) ref"), `vcs.ref.time`, `vcs.ref.lines_delta` (`vcs.line_change.type` added/removed), `vcs.ref.revisions_delta`, `vcs.contributor.count`, `vcs.repository.count`. Attributes: `vcs.repository.url.full`, `vcs.repository.name`, `vcs.owner.name`, `vcs.provider.name`, `vcs.ref.head.name`, `vcs.ref.base.name`, `vcs.ref.head.revision`, `vcs.ref.type`.

**GenAI (`gen_ai.*`, now in the separate semantic-conventions-genai repo; agent parts still "provisional").** Span names `create_agent {gen_ai.agent.name}`, `invoke_agent {gen_ai.agent.name}`, `invoke_workflow {gen_ai.workflow.name}`, `plan {gen_ai.agent.name}`, `execute_tool {gen_ai.tool.name}`. Required: `gen_ai.operation.name`, `gen_ai.provider.name`. Conditionally required: `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.agent.description`, `gen_ai.conversation.id` ("keep multi-turn sessions traceable as a unit"), `gen_ai.data_source.id`, `gen_ai.request.model`, `error.type`. Recommended: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`. Tool: `gen_ai.tool.call.id`, `gen_ai.tool.name`, `gen_ai.tool.type`.

Sources: https://opentelemetry.io/docs/specs/semconv/registry/attributes/cicd/ , https://opentelemetry.io/docs/specs/semconv/cicd/cicd-metrics/ , https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md , https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/

---

## Part B — Distillation

### B1. The common minimal event schema

Across trackers the *stored* form is one of two shapes, and the mature products keep both:

1. **A field-change log** (Jira `changelog.histories[].items[]`, DevLake `issue_changelogs`, Linear webhook `updatedFrom`, GitHub `changes.field_value{from,to}`, ADO revisions): `{item_id, at, actor, field, from, to, from_raw?, to_raw?}`. Time-in-status is a fold over `field == status`.
2. **Denormalised lifecycle timestamps on the item** (Linear `triagedAt/startedAt/completedAt/canceledAt`; Shortcut `started_at/completed_at` + `*_override`; ADO `ActivatedDate/ResolvedDate/ClosedDate/StateChangeDate`; DevLake `created_date/resolution_date` + `lead_time_minutes`; PR `created/merged/closed`). These are **derived from the log by "first entry into a state category"** rules and **cleared on backward transition** (ADO), so they are a cache, not the source of truth.

The minimal set of *state categories* that every system normalises to (names vary, categories don't):

| Category | Jira | ADO | Linear state `type` | Shortcut state type | Swarmia | GitLab VSA event |
|---|---|---|---|---|---|---|
| created | issue created | `System.CreatedDate` | `createdAt` (backlog/unstarted) | `created_at` (unstarted) | To Do | `IssueCreated` |
| estimated | points / `timeoriginalestimate` set (a changelog item) | `OriginalEstimate` / `StoryPoints` | `estimate` | `estimate` | — | — |
| started / in progress | status → In Progress category | *In Progress* category → `ActivatedDate` | `startedAt` (`started`) | `started_at` (`started`) | In Progress | `IssueFirstMentionedInCommit` / label added |
| in review | status (custom) / PR opened | Board column "In Review" / *Resolved* category → `ResolvedDate` | (state name) | (state name) | PR: first review request | `MergeRequestCreated` / `MergeRequestFirstAssignedAt` |
| done | Done category / resolution | *Completed* → `ClosedDate` | `completedAt` (`completed`) | `completed_at` (`done`) | Done | `IssueClosed` / `MergeRequestMerged` |
| cancelled | Done + resolution "Won't Do" | *Removed* | `canceledAt` (`canceled`) | (archived) | Won't Do | `MergeRequestClosed` |
| deployed | deployment (CI/CD link) | — | — | — | — | `MergeRequestFirstDeployedToProduction` |

Every deploy-ledger (Sleuth, Faros CD event, four-keys, DevLake `cicd_deployments`) additionally keeps **requested/created, started, finished** timestamps and **`status` (in-flight) separate from `result` (terminal)** — the same split OTel encodes as `cicd.pipeline.run.state` vs `cicd.pipeline.result`.

So the minimal event vocabulary that all of the above can be projected onto is:
`created`, `estimated` (re-emittable; carries the new value), `started`, `review_requested` / `in_review`, `review_returned` (changes requested → back to started; this is what makes "review rounds" countable), `done`, `cancelled`, `reopened` (backward transition; the ADO "clear the cached date" case), and — for the harness — `dispatched`/`finished` per dispatch, which is the agent-side analogue of a CI task run (`cicd.pipeline.task.run.*`). Faros and four-keys both show that an **idempotency key per event** (four-keys `signature`; Faros composite URI `source://app/env/id`) is what makes the ledger safely re-emittable.

### B2. Conventional naming (what has crystallised)

- **Lead time** = creation → done (GitLab "issue creation to closure"; DevLake `lead_time_minutes = resolution_date − created_date`; Shortcut `lead_time`; ADO "creation to completion"). DORA's **lead time for changes** is a different thing: commit → production (Sleuth/LinearB/Haystack "Change Lead Time").
- **Cycle time** = started → done, where "started" is *either* the tracker's In-Progress category (Jellyfish, Swarmia, Shortcut, ADO, Linear) *or* first commit (Haystack, LinearB, Jira Cloud's report, GitLab "first commit reference → closure"). Products that use both make the start-event **configurable** (Sleuth's per-project "in-progress states" option; LinearB's Jira toggle; GitLab custom stages). Distribution statistic: **median** is the default in Jira Cloud, GitLab, DevLake; LinearB averages completed phases; Haystack publishes p85 for review time.
- **Time in status / time in state** = per-status dwell; when a status is entered more than once the norms are *sum of intervals* (Swarmia) or *first entry only* (GitLab events, ADO cached dates) — a rule the spec must pick explicitly.
- **PR phase names** (near-universal): *coding/development time* (first commit → PR open), *pickup time* / *time to first review* / *review lag* / *time to first comment* (PR open or first review request → first non-author review), *review time* (first review → approval/merge), *time to merge* (approval → merge, or PR open → merge depending on vendor; the OTel `vcs.change.time_to_merge` is creation → merge and `vcs.change.time_to_approval` creation → first approval), *deploy time* (merge → production). Draft time is now a visible sub-phase (Swarmia, Pluralsight includes it in time-to-first-comment).
- **Review rounds / review cycles** = number of "changes requested → new commits → re-review" loops; no vendor exposes a canonical field name (Swarmia has "review rounds" in UI only). **Rework** is overloaded: Haystack = *Rework Time* inside review ("first comment to the last commit"); Pluralsight/Flow = *code churned within 30 days* by its author; the harness's tokenomics = fix-round spend. The spec should say which it means.
- **Estimated vs actual**: Jira's triple `originalEstimate` / `remainingEstimate` / `timeSpent` (+ `workRatio` = spent ÷ original) and ADO's `OriginalEstimate` / `RemainingWork` / `CompletedWork` are the two canonical shapes; Scrum-template ADO and Jira Plans deliberately **forecast from Remaining, not Original**. Points: Fibonacci is the default numeric scale, T-shirt maps XS/S/M/L/XL → 1/2/3/5/8 (Linear), unestimated defaults to 1 (Linear) or is reported as `num_*_unestimated` (Shortcut). Progress = done ÷ (done + remaining) (Jira Plans), or completed points ÷ scope with started counted at 25 % (Linear Cycle Success).
- **Scope change** is tracked as a first-class time series at the container level (Linear cycle `scope` line and "scope added/removed since start"; Jira Plans rollups; Shortcut `num_points_total` vs `num_points_backlog`).
- **Throughput** = merged PRs or completed items per period (Haystack, DX "PR throughput ... per engineer/week (90-day lookback)"), **WIP** = "average number of issues in progress at a time" (Swarmia); **cadence** in DORA terms is *deployment frequency* (Jira Cloud: deploys/week vs 12-week average).
- Normalisation convention: keep the raw value next to the canonical one — DevLake `status`/`original_status`, `type`/`original_type`, `result`/`original_result`; Jira `from`/`fromString`.

---

## Implications for the spec (git-committed, append-only, per-user JSONL ledger joinable to tokenomics)

These are consequences of the survey, not a design.

1. **Store events, derive timestamps.** Every mature system either stores a change log or is criticised for not doing so (GitHub Projects). Denormalised `startedAt/completedAt` columns (Linear/Shortcut/ADO) are always *derived* by "first entry into category, cleared on backward move". For an append-only JSONL that means one line per transition, and `started_at`-style fields belong in the **report**, not the ledger. Four-keys is the closest precedent: `events_raw{event_type,id,metadata,time_created,signature,source}` + SQL views.
2. **Idempotency key per event.** Four-keys `signature`, Faros composite URI, Devin/Cursor opaque ids, the local ledger's `host:id` + latest-`endedAt`-wins rule (`telemetry-capture.mjs` L809–823). A stable `(item_id, event, seq|at)` key lets any hook re-emit safely and lets `--sweep`-style self-healing coexist with append-only.
3. **Separate `state` from `result`.** OTel `cicd.pipeline.run.state` (pending/executing/finalizing) vs `cicd.pipeline.result` (success/failure/error/timeout/skip/cancellation); DevLake `status` vs `result`; Faros `--run_status` enum. Cancelled is a result, not a state. The harness's gate verdicts (`gate-runs/<batch>.jsonl`, `tokenomics/SKILL.md` L184–188) are already "result" records.
4. **Keep raw beside canonical.** DevLake `original_status`, Jira `fromString`. If the harness's items have their own status words (`delivered`, `deferred`, the open `outcomes` vocabulary in `work-scope.mjs`), record them raw and map to the small category set (`created/estimated/started/in_review/done/cancelled/reopened`) at report time.
5. **The four-level hierarchy has precedents but no standard names.** Jira Initiative→Epic→Story→Sub-task, ADO Epic→Feature→Story→Task, Linear Initiative→Project→Issue, Shortcut Milestone→Epic→Story→Task. Harness campaign→mission→task→case maps cleanly (campaign ≈ initiative/project, mission ≈ epic/wave, task ≈ story, case ≈ sub-task/TMS id). The tokenomics export already uses `work_item_level` with value `feature` (`build-tokenomics-export.mjs` L103) — worth aligning the level names.
6. **Estimate triple, forecast from remaining.** Both Jira and ADO agree on `original / remaining / completed` (Jira: `timeoriginalestimate/timeestimate/timespent`; ADO: `OriginalEstimate/RemainingWork/CompletedWork`), and both planning layers forecast from *remaining*. `estimated` should be a re-emittable event carrying `{scale, value, unit}` (points|hours|days|tshirt), so estimate revisions are history, not overwrites; Linear's T-shirt→Fibonacci mapping and "unestimated = 1 point" default are the conventional fallbacks. Existing harness fields already supply candidates: `effort_days` (derived, "SP × 1h ÷ 8"), `size_tshirt`, `story_points`, `scenario_complexity` (`build-tokenomics-export.mjs` L108–157) — the spec should decide which is *original* (intake sizing) and which is *actual* (ledger active minutes).
7. **Define start-event and re-entry rules explicitly.** Vendors disagree (In-Progress vs first commit; sum-of-intervals vs first-entry) and expose a switch. For the harness the natural "started" is the first dispatch whose `label` matches the item (the `STAGE_MARKER` stages at `telemetry-capture.mjs` L613 already name `triage|implement|review|fix round|merge|gate`), and "in review" is the first `review*` dispatch; `fix round N` dispatches are the countable **review rounds**. State the interval rule (sum, like Swarmia) in the spec.
8. **Cadence = deployment-frequency-shaped.** Jira Cloud ("deploys per week vs 12-week average"), DORA, Sleuth. The harness equivalent is "cases/tasks/missions delivered per week" with a rolling baseline; **median** cycle time with a trailing-12-week comparison is the common presentation. Throughput per engineer/week with a 90-day lookback (DX) is the per-person analogue.
9. **Join handles to tokenomics.** Claude Code's OTel proves the agent side offers only `session.id`, `agent.name`, `workflow.run_id`/`workflow.name`, `vcs.ref.head.name` — no work-item id. The local ledger's join keys are `session` (`id`), `agentId`, `label`, `cases[]`, `scope.batch` (`telemetry-capture.mjs` L439–441, L747–753). Every delivery event therefore needs `session` and, where a dispatch caused it, `agentId` + `label`, plus the item id and its parent chain (`campaign/mission/task/case`), so cost-per-item (tokenomics) and time-per-item (this tracker) fold on the same keys. Cursor's two-level `agent → run` with `durationMs` on terminal runs and Devin's `tags[]` + `structured_output` are the closest external analogues of "dispatch record with caller-supplied attribution".
10. **Per-user files + append-only are compatible with everything above** because no vendor model needs in-place mutation once the source of truth is the event log: the `usage-<user>.jsonl` precedent ("one file per user, so parallel work never conflicts", `tokenomics/SKILL.md` L293–294) carries over; the report dedupes by idempotency key and sorts by `at`. The one thing the log must carry that vendors get for free is the **actor** (Jira `author`, DevLake `author_id`, ADO `ActivatedBy`) — with per-user files the file name is the actor, but a copied/merged line loses it, so the line should still carry `user`.
11. **Vocabulary to reuse verbatim** (so PMs recognise it): `lead_time` (created→done), `cycle_time` (started→done), `time_in_state`, `time_to_first_review` / `pickup_time`, `review_time`, `review_rounds`, `rework` (say which sense), `throughput`, `wip`, `scope_added` / `scope_removed`, `original_estimate` / `remaining` / `actual` (`completed`), `work_ratio` (actual ÷ original), `deployment_frequency` → "delivery frequency". Avoid inventing new names where OTel `vcs.*`/`cicd.*` or Jira/ADO already have one.

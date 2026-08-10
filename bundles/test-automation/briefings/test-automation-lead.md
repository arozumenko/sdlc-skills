---
name: Project briefing
description: Stack overlay (test-automation) — orchestration starting context for Tal
type: project
---

## Project Knowledge

- **Your role on this team:** top-level orchestrator. There is no PM or tech-lead
  above you — you collapse both. The user launches you directly with a TMS case or
  batch; you run the batch pipeline (one unit at a time: analyse, implement + static
  review per case, one hardening gate per batch), own test-framework
  architecture, and own the automation merge.
- **Read before your first dispatch:** `.agents/team-comms.md` (host + exact
  dispatch syntax — wrong syntax means your dispatch prints as plain text and
  nothing runs), `.agents/profile.md` (systems map, base URL, credentials,
  **§ Automation PR policy** — base branch / merge policy / merge strategy),
  `.agents/testing.md` (framework conventions), `.agents/test-automation.yaml`
  (TMS adapter).
- **If none of scout's files exist:** the project was never seeded — **self-orient
  by running the `seeding-a-project` skill yourself** (scout's own onboarding
  procedure, loaded on demand): seed the `.agents/*` set, ask only for blocking
  unknowns, proceed. Don't dead-stop. A deliberate `claude --agent scout` run
  stays the thorough path. See playbook § Self-orientation.
- **Match your skills to the project's systems.** Engage whichever *installed*
  skill corresponds to a system the project actually uses — the TMS adapter named
  in `.agents/test-automation.yaml`, the tracker / knowledge base in
  `.agents/profile.md`, the framework in `.agents/testing.md`. *Examples:* an Xray
  project → `xray-testing` (if installed); a Jira tracker → `atlassian-content` for
  issue writes (plain `create_issue` produces wall-of-text bodies — the skill
  formats them); a Playwright stack → `playwright-best-practices` as a worked
  reference, not a default lens. **If the matching skill isn't installed, work from
  the system's own API / the adapter verbs directly — a missing optional skill is
  never a blocker, and no single TMS (Xray included) is assumed to be present.**

## My Role Focus

Run the batch pipeline and keep the user informed. Gate on AFS status —
`ready-for-automation` and `extend-existing` advance (see
`test-automation-workflow` § Implementer slot). Enforce No-Defect-Masking at dispatch time.
On Claude Code, batches of ANY size run via the shipped batch workflows by default —
the bundle's instruction is your standing Workflow-tool opt-in; don't ask, don't
re-litigate. Fallbacks and extension rules both live in the
`test-automation-workflow` skill's `references/workflow-accelerant.md`:
§ When NOT to use it (unseeded project, no Workflow tool, operator supervising
step by step — a batch of one is NOT an exception) and § Extending the canonical workflows — a shape no
shipped script fits is authored there, not hand-run. Stay context-frugal: you
plan, orchestrate, dispatch — payloads (case bodies, diffs, logs) stay on disk
and in PRs where slots read them; your context carries ids, outcomes, verdicts
(playbook Critical rule 7).
Read § Automation PR policy before every merge. Report at milestones — batch
opened, batch launched, batch returned, close done (playbook § Status
reporting; never per-case). Every routing turn must contain a real dispatch.

# Changelog

All notable changes to this repository are listed here, newest first.
Each line is one merged pull request.

The version in `package.json` and the plugin manifests is `0.3.0`, tagged `v0.3.0`.
Earlier states are pinned by commit, as `MAINTENANCE.md` describes.

## Unreleased

Nothing yet.

## 0.3.0 - 2026-11-23

The first tagged version. Install it with `npx github:arozumenko/sdlc-skills#v0.3.0 init …`.

118 merged pull requests since `0.2.0`, 2026-04-23 to 2026-11-22, plus this release.

### Changes that need attention when you update

- `init --update` keeps local work (#131). In a git project, an installed agent or skill that git reports as
  changed is kept and listed under "NOT updated". That includes one that was installed and never committed, unless
  it is identical to a copy this installer ships. Commit first, or pass `--force`, which replaces without a backup.
  An item git cannot restore (no git, or an ignored path) is copied to a backup folder and then replaced. Two
  exceptions: a symbolic link there is kept, and content identical to a copy this installer ships is replaced
  without a backup.
  Seeded folders are create-only: files are added, never removed or overwritten.
- The installer refuses to run with the home directory or the package itself as the project root (#127).
- The hook installers of `delivery-monitor` and `tokenomics` stop with an error on a settings file that does not
  parse, and write nothing (#128, #129). Before, they replaced the file.
- `delivery-monitor` reports: the heading `## DORA` is now `## DORA (task-level proxies)`, and the budget denial
  says "budget guard threshold" where it said "budget cap" (#129).
- `delivery-monitor plan register` prints `WARN ROSTER-EMPTY` on stderr when no agent of a mapped factory is
  installed (#133).
- The generated Cursor, Codex and Copilot marketplaces no longer list the 30 external skills (#130). Those entries
  pointed at folders that do not exist in this repository. The installer still fetches the external skills.

### Known limits

Installer

- The 30 external skills are not pinned. The installer fetches each one from the branch `skills.json` names for it
  (a moving branch such as `main`) at install time, so two installs of `v0.3.0` on different days can differ in
  those skills.
- A failed fetch of an external skill does not fail the install. The run prints `! skill <id> (external fetch
  failed)`, still ends with `Done`, and exits 0, so the install can be incomplete. Read the output.
- The installer keeps no record of what it installed. `--update` uses git as its baseline, and only the project's
  own repository: an item inside a nested repository counts as changed and is kept until `--force`.
- When git cannot restore an item (a project without git, or an ignored path), an update that replaces a changed
  item first copies it to `.sdlc-skills-backup/<date-time>/`. Nothing prunes these folders. `--force` skips the
  backup. A symbolic link in that position is kept, not replaced.
- An installed skill includes its tests and fixtures.
- CI runs the tests on one current Node release. `engines.node` says `>=18`; versions 18 to 22 are not tested.

Telemetry

- `delivery-monitor` captures dispatches and enforces the budget on Claude Code only. A dispatch from another
  host is never refused.
- The `delivery-monitor` budget is a best-effort guard, not a ceiling and not a security control. It counts
  subagent dispatches only and it fails open: when it cannot evaluate, the call goes through. Most such failures
  show as `BUDGET check: OFF` in `status`, but not all leave a trace, and the `OFF` line clears by age (7 days),
  not by repair. The skill's `SKILL.md` lists the full limits.
- The DORA figures of `delivery-monitor` are task-level proxies, and every spend total covers subagent
  dispatches only.
- `delivery-monitor` has a role map for three of the five factories. `product-management` and
  `security-testing` register with `WARN ROSTER-UNMAPPED`: the dispatch hook records no task transitions for
  their agents and the budget guard does not check them. Their usage is still captured for spend. Record their
  transitions with the CLI.
- `tokenomics` meters cost with one pinned version of `ccusage`, downloaded through `npx` at capture time unless a
  binary is configured. It syncs only where `.agents/telemetry` is an initialised submodule, so a capture in a
  linked git worktree without one stays in that worktree. Its `SKILL.md` lists the limits of the sync lock.
- Two other scripts fall back to an unpinned `@latest` download when no local binary is given:
  `efficiency-audit/scripts/usage-rollup.mjs` (`ccusage`) and `visual-testing/scripts/visual-diff.mjs`
  (`reg-cli`).

### November 2026

- delivery-monitor: budget cache written by rename and rebuilt when torn; warn on an empty roster (#133, 2026-11-22)
- evals: the E16 grader runs the agent's tests on every Node version (#132, 2026-11-22)
- installer: --update keeps local work (create-only seeds, git-aware replace, backups) (#131, 2026-11-22)
- ci: run tests on every pull request; marketplaces list only sources that exist (#130, 2026-11-22)
- delivery-monitor: honest budget guard, visible check state, safer hook install (#129, 2026-11-22)
- tokenomics: never commit a conflicted merge, never replace an unparseable settings file, pin ccusage (#128, 2026-11-22)
- installer: refuse unsafe roots, warn on inferred targets, complete Codex installs (#127, 2026-11-22)
- delivery-monitor: install-hooks never writes or wires outside its target (#126, 2026-11-22)
- delivery-monitor: per-task USD budget check with in-run subagent stop (#125, 2026-11-20)
- delivery-monitor: report shows task costs and judges estimates by effort band (#124, 2026-11-19)
- delivery-monitor: calibration learns from every attributed dispatch, counted once (#123, 2026-11-19)
- docs: stop tracking four working notes that hold private paths and project names (#122, 2026-11-18)
- delivery-monitor: generic wording for consumer names in comments and tests (#121, 2026-11-18)
- delivery-monitor: keep a log of session binding and plan file writes (#120, 2026-11-18)
- delivery-monitor: spend attributes dispatches the ledger never saw (#119, 2026-11-18)
- delivery-monitor: spend counts a dispatch unpriced only when no side prices it (#118, 2026-11-18)
- delivery-monitor: tests pass in an installed copy and under load (#117, 2026-11-18)
- delivery-monitor: capture every dispatch and count spend once (#116, 2026-11-18)
- delivery-monitor: plan register rebuilds the effort calibration itself (#115, 2026-11-17)
- manual-qa: test-run-lead keeps runners in the foreground and flags case drift (#114, 2026-11-17)
- manual-qa: native Android through plain adb; agents stop assuming a web app (#113, 2026-11-17)
- delivery-monitor: DORA change failure rate and time to restore, flow efficiency, time blocked (#112, 2026-11-14)
- delivery-monitor: credit a dispatch to the task its description names, not the role's own task (#111, 2026-11-14)
- Installer: unclosed factory block no longer eats project text; stray START reported on every run (#110, 2026-11-14)
- Cost estimates learn only from fully measured tasks (delivery-monitor) (#109, 2026-11-13)
- init --update: add the factory block that CLAUDE.md is missing (#108, 2026-11-13)
- Revert #106 (learning loops spec + increment 1) (#107, 2026-11-13)
- Learning loops: spec + increment 1 (publish policy, text policy, calibration contract) (#106, 2026-11-13)
- Learn task cost estimates from past work (delivery-monitor calibration) (#105, 2026-11-12)
- Stop repeating the same instructions in CLAUDE.md and AGENTS.md (#104, 2026-11-11)
- Show agents the lessons that match their task, not just the newest ones (#103, 2026-11-10)
- factory blocks: role-filtered stack sections; delivery ownership in the skill; tracker wording (#102, 2026-11-10)
- product-management: fix the security-scan findings (W008, W011) (#101, 2026-11-09)
- feature-development: add release-engineer (Dora) with release and recovery skills (#100, 2026-11-07)

### October 2026

- init doctor: re-land #90 on main (it merged into its stacked base, not main) (#97, 2026-10-27)
- feature-development: review strategy (blocking call, fix-round cap, risk-routed lineup); E10R round-cap eval (#96, 2026-10-26)
- feature-development: wait on slow steps in one bounded call; E17-slow-step eval (#95, 2026-10-26)
- feature-development: one task per subagent; delivery-monitor flags resumed agents that cross tasks (#94, 2026-10-26)
- Correct eval measurement and clarify evidence/contract grading (#93, 2026-10-25)
- Extend evals for evidence, contract context and async failures (#92, 2026-10-24)
- Fix false retry counts for long commands and paths (#91, 2026-10-24)
- init doctor: read-only, offline install health check (#90, 2026-10-19)
- init: warn when a non-interactive factory install selects every dev role; accept --agents all (#89, 2026-10-19)
- evals: land E13 untraced claims on main (#87 merged into its stacked base) (#88, 2026-10-12)
- evals: E13 untraced claims (QA verdicts that state more than the evidence shows) (#87, 2026-10-12)
- hooks: keep the newest MEMORY.md entries when the index is over budget (#86, 2026-10-12)
- evals: canary on answer-key files, pass^k, pinned tool versions, private held-out suites (#85, 2026-10-12)
- ci: validate bundle skills and fix Claude marketplace paths after the factories/ rename (#84, 2026-10-12)
- evals: behaviour and cost evals for feature-development against the real installed factory (#83, 2026-10-11)
- feature-development: preload only what qa-engineer and js-dev use on every task (#82, 2026-10-11)
- hooks: cap Claude Code hook context under its 10,000-character limit (#81, 2026-10-11)
- delivery-monitor: attribute hook dispatches by owning role first; add retract (#80, 2026-10-09)
- delivery-monitor: reject a done sha that predates the item's dispatch; document no-commit done (#79, 2026-10-08)
- Let the project decide whether role memory is committed; skip installed.test outside the source repo (#78, 2026-10-08)
- delivery-monitor: bind the registering session, flag finished open plans, positional run args (#77, 2026-10-08)
- delivery-monitor: stop diagnostics-only commits, bind sessions by branch, add PR-mode backfill (#76, 2026-10-06)

### September 2026

- fix(init): --update refreshes every installed factory block in AGENTS.md/CLAUDE.md (#75, 2026-09-25)
- docs(security-testing): onboarding guide and persona names (Rasmus, Ilse, Vera) (#74, 2026-09-25)
- delivery-monitor: cycle time, cadence and estimate-vs-actual for harness delivery (M1 + HTML report) (#73, 2026-09-18)
- feat: security-testing bundle (minimal) — threat-led, evidence-first security testing team (#72, 2026-09-18)
- feat(manual-qa): quality-evals skill — self-benchmark test-runner/test-author against your own app (#70, 2026-09-12)

### August 2026

- fix(manual-qa): test-author defers to spec on acceptance-criteria input (#69, 2026-08-27)
- docs: manual-qa audit capability + designer design-skill uplift (#67, 2026-08-21)
- feat(test-automation): TA v2 — three-agent roster, coverage contract, manual-qa composition (on the factories layout) (#66, 2026-08-21)
- refactor: rename bundles → factories + adopt FACTORY.md catalog schema (#65, 2026-08-21)
- fix(manual-qa hooks): stop publishing a floor as the bill (#63, 2026-08-20)
- feat(designer): adopt impeccable quality gate + design-story presentation uplift (#62, 2026-08-17)
- feat(designer): UI/UX designer role + screen-specs web target + visual-testing skill (#61, 2026-08-16)
- fix(hooks): deliver SOUL.md on every host — it never reached Claude or Codex (#60, 2026-08-16)
- feat(agents): make independent tool calls go out in parallel (#59, 2026-08-16)
- fix(product-management): repair the hypothesis contract and reconcile the pipeline docs (#58, 2026-08-14)
- fix(product-management): enforce artifact production + discovery mechanics (#57, 2026-08-13)
- fix(manual-qa): fall back to `npx -y ccusage` when ccusage isn't installed (#56, 2026-08-13)
- feat(manual-qa): add Orchestrator composition section to tokenomics HTML report (#55, 2026-08-11)
- feat(test-automation): batch pipeline hardening + scoping and cost skills (#54, 2026-08-10)
- Shared memory + knowledge-curation skills; seed a cross-role knowledge layer (#52, 2026-08-09)
- feat(feature-development): add android-dev ("Dan") persona + external-skill registry guard (#51, 2026-08-06)
- Add product-management bundle — Product Owner discovery pipeline (#50, 2026-08-06)

### July 2026

- fix(manual-qa): async-dispatch metrics fixes + full tokenomics parity in bundle (#49, 2026-07-31)
- feat(manual-qa): metrics-collection hooks + tokenomics export/HTML report (#48, 2026-07-22)
- feat(test-automation): universalize bundle, add efficiency-audit skill, harden onboarding docs (#47, 2026-07-13)

### June 2026

- fix(microsoft-365): default to browser auth-code flow to pass Conditi… (#46, 2026-06-19)
- Bundles-as-source: bundles own their agents/skills (remove canonical mirror + sync) (#45, 2026-06-11)
- Merge team-web + team-ios into one feature-development bundle (#44, 2026-06-11)
- refactor(bundles): rename web-qa → manual-qa (#43, 2026-06-11)
- feat(web-qa): mobile testing as a skill — session grouping, Appium & device-farm validated (#40, 2026-06-11)
- Interactive installer + per-host MCP setup (from onetest-ai/qa-agent) (#42, 2026-06-10)
- Copilot/VS Code context injection via hooks + Codex installer fixes (#41, 2026-06-10)

### May 2026

- feat(bundles): materialize bundle mirrors as real copies via sync script (#38, 2026-05-28)
- feat(bundles): bundle-local skills + symlink pattern for complete bun… (#37, 2026-05-28)
- chore(web-qa): de-enumerate Playwright tool names in agent bodies (#36, 2026-05-27)
- TA orchestrator-slot migration: move playbook to skill (#35, 2026-05-27)
- Add BUNDLE.md catalog descriptors + make web-qa lead orchestrate (#33, 2026-05-27)
- Test Automation process hardening (#30, 2026-05-27)
- docs(bundles): restore missing Quick start heading (#29, 2026-05-27)
- Add session-retrospective skill — assisted reinforcement from past sessions (#28, 2026-05-27)
- Hook-based memory/context injection + multi-runtime plugin & install support (#26, 2026-05-27)
- Cleanup batch a (#25, 2026-05-27)
- Add web-qa test-sizer agent + size analytics (#24, 2026-05-27)
- Cleanup Batch A — mechanical agent/skill review fixes (#23, 2026-05-26)
- Remove Octobots integration — collapse to single host-native mode (#22, 2026-05-26)
- Retitle web-qa roster: orchestrator → test-run-lead + consistent role names (#21, 2026-05-26)
- Add explicit metadata.author to all agents and skills (#19, 2026-05-26)
- Add test-automation bundle — salvage Tal (PM+tech-lead orchestrator) from PR #15 (#18, 2026-05-26)
- docs(README): document web-qa bundle, new skills, and externals (#17, 2026-05-26)
- Team bundles + stack-matched agents/skills (#16, 2026-05-26)
- Add vividus skill — JBehave-based BDD framework (#12, 2026-05-16)
- atlassian-content: add Jira Server/DC and Confluence Server support (#11, 2026-05-16)
- Add microsoft/playwright-cli external skill (#10, 2026-05-16)
- Fix tdd external-skill fetch path (#9, 2026-05-11)

### April 2026

- xray-testing: smoother creds onboarding (.env auto-load, `config set`, --issue-id bypass) (#8, 2026-04-30)
- Add tosca-automation skill — TOSCA Cloud full lifecycle (#7, 2026-04-24)
- Add test-automation pipeline — agents, skills, routing, escalation, onboarding (#6, 2026-04-24)
- Scout + project-seeder overhaul — PR sampling, project-systems, tool wiring, role overrides, deployment-mode, SOUL rollout (#5, 2026-04-24)
- Add xray-testing skill — Cloud GraphQL + Server REST + stdlib Python CLI (#4, 2026-04-24)
- Add atlassian-content skill — Jira ADF + Confluence storage format authoring (#3, 2026-04-24)
- Installer: Copilot CLI flatten + fix-copilot + external skills + conditional skills-inventory injection (#2, 2026-04-24)
- feat: ship RULES.md with each dev agent for octobots dispatch rules (#1, 2026-04-23)

## 0.2.0 - 2026-04-14

- Version set to `0.2.0` in `package.json` and the plugin manifests (commit `3886f29`).

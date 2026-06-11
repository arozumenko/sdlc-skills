# SDLC Skills — Gemini CLI context

You have access to a catalog of role-based agent personas and workflow skills
for software delivery. Load what matches the task; don't bulk-load everything.

## Agents (personas)

When the task fits one of these roles, read the matching `AGENT.md` +
`SOUL.md` and adopt the persona for the rest of the session. Each agent lives
inside the bundle that owns it (`bundles/<id>/agents/<name>/`); only
`personal-assistant` lives at the top-level `agents/`.

**Feature delivery (`feature-development` bundle):**

- `ba` — Business analyst (requirements, user stories, acceptance criteria)
- `tech-lead` — Technical decomposition, interface design, code review
- `project-manager` — Task routing, team coordination, merge gate
- `python-dev` — Python implementation with TDD
- `js-dev` — TypeScript / React / Node implementation with TDD
- `ios-dev` — Swift / SwiftUI / SwiftData implementation (no simulator)
- `qa-engineer` — Test verification, bug reproduction, E2E tests, TMS case execution + AFS emission (via `test-case-analysis` skill)
- `test-automation-engineer` — Implements automation from specs in the project's existing framework
- `scout` — Unfamiliar-codebase exploration, `AGENTS.md`/`CLAUDE.md` authoring

**Test automation (`test-automation` bundle):**

- `test-automation-lead` — Runs the analyst → implementer → reviewer pipeline, owns the automation merge gate and framework architecture
- plus `qa-engineer`, `test-automation-engineer`, `scout` (same roles as above)

**Manual QA (`manual-qa` bundle):**

- `test-run-lead` — Orchestrates a manual-QA run: assembles the suite, dispatches a runner per case, triggers the report
- `test-author` — Turns rough ideas into formatted `TC-NNN` cases
- `test-sizer` — Rates case size/complexity (S/M/L) before authoring
- `test-runner` — Executes one case against a running app via Playwright MCP, returns structured JSON
- `test-reporter` — Turns run results into a Markdown report
- `app-profiler` — Onboards a web app, writes the shared app profile

**Standalone:**

- `personal-assistant` — Second-brain, inbox triage, calendar, Teams, notes

## Workflow skills

Load a skill's `SKILL.md` only when its trigger conditions are met — skills
are capability definitions, not always-on context.

| Skill | When to load |
|---|---|
| `plan-feature` | A spec/requirement exists and implementation hasn't started |
| `implement-feature` | A plan exists and you're about to write code |
| `bugfix-workflow` | Reproducing and fixing a reported bug |
| `xray-testing` | CRUD + results import on Xray entities (Test / Precondition / Set / Plan / Execution / Run) across Cloud (GraphQL) and Server/DC (REST) |
| `atlassian-content` | Authoring Jira issues/comments (ADF, API v3) and Confluence pages (storage format) with accountId mentions + post-creation verification |
| `tosca-automation` | Tricentis TOSCA Cloud full lifecycle — TestCases, Modules, Reusable Blocks, Playlists, Inventory folders, TSU import/export |
| `vividus` | Vividus BDD framework — bootstrap a project, add plugins, author `.story` files, configure suites/profiles/environments, run via Gradle |
| `test-case-analysis` | Executing a TMS case end-to-end and emitting an Automation-Friendly Spec (AFS) |
| `test-automation-workflow` | Automating a TMS test case end-to-end — explore, specify, implement, review |
| `code-review` | Reviewing a PR or diff |
| `completing-a-task` | Finishing routed work — commit, push, PR, comment, notify |
| `git-workflow` | Branching, commits, PRs, rebasing |
| `memory` | Need to remember something across sessions |
| `playwright-testing` | Writing or running E2E browser tests |
| `playwright-cli` | Driving Playwright from the CLI — interactive browser sessions, snapshot/locator interaction, network mocking, tracing, test generation (external, by Microsoft) |
| `browser-verify` | Quick visual / smoke check in a browser |
| `issue-tracking` | Managing GitHub / Linear / GitLab issues |
| `verifying-outcomes` | Checking whether a task actually achieved its outcome |
| `gathering-context` | Cross-channel context — email, Teams, local KB |
| `deep-research` | Multi-source research, fact-checking |
| `obsidian-vault` | Reading / writing an Obsidian vault |
| `microsoft-365` | Microsoft 365 (email / calendar / Teams) |
| `seeding-a-project` | Generating `AGENTS.md` / `.agents/` docs / per-role memory briefings for a new project |

Each skill lives under the bundle that owns it
(`bundles/<id>/skills/<name>/SKILL.md`); the eight orphan skills
(`deep-research`, `gathering-context`, `verifying-outcomes`, `microsoft-365`,
`obsidian-vault`, `tosca-automation`, `vividus`, `xray-testing`) live at the
top-level `skills/`.

## External skills — fallback install

Some skills referenced by agents live in external repos (Matt Pocock's TDD,
Jesse Vincent's `obra/superpowers` skills, Paul Hudson's Swift skills).
This Gemini extension does **not** fetch them — only the monorepo skills
listed above are available in this install.

For the full experience (including external skills auto-fetched into
`.claude/skills/` via git clone + copy, or `--symlink`), run our installer
once in the project:

```bash
npx github:arozumenko/sdlc-skills init --target claude --agents <your-team>
```

Then the externals appear alongside the monorepo skills and work the same
way.

## Using skills in conversation

- "Load the `deep-research` skill" → read its `SKILL.md` (under `skills/` for orphans, or the owning `bundles/<id>/skills/<name>/`).
- "I'm starting as `ios-dev`" → read `bundles/feature-development/agents/ios-dev/AGENT.md` + `SOUL.md`.
- Don't restate a skill's contents verbatim. Follow its workflow.

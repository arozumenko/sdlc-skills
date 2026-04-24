# SDLC Skills — Gemini CLI context

You have access to a catalog of role-based agent personas and workflow skills
for software delivery. Load what matches the task; don't bulk-load everything.

## Agents (personas)

When the task fits one of these roles, read the matching `AGENT.md` +
`SOUL.md` and adopt the persona for the rest of the session:

- `ba` — Business analyst (requirements, user stories, acceptance criteria)
- `tech-lead` — Technical decomposition, interface design, code review
- `project-manager` — Task routing, team coordination, merge gate
- `python-dev` — Python implementation with TDD
- `js-dev` — TypeScript / React / Node implementation with TDD
- `ios-dev` — Swift / SwiftUI / SwiftData implementation (no simulator)
- `qa-engineer` — Test verification, bug reproduction, E2E tests, TMS case execution + AFS emission (via `test-case-analysis` skill)
- `test-automation-engineer` — Implements automation from specs in the project's existing framework
- `scout` — Unfamiliar-codebase exploration, `AGENTS.md`/`CLAUDE.md` authoring
- `personal-assistant` — Second-brain, inbox triage, calendar, Teams, notes

Each agent lives at `./agents/<name>/AGENT.md`.

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
| `test-case-analysis` | Executing a TMS case end-to-end and emitting an Automation-Friendly Spec (AFS) |
| `test-automation-workflow` | Automating a TMS test case end-to-end — explore, specify, implement, review |
| `code-review` | Reviewing a PR or diff |
| `task-completion` | Finishing routed work — commit, push, PR, comment, notify |
| `git-workflow` | Branching, commits, PRs, rebasing |
| `memory` | Need to remember something across sessions |
| `playwright-testing` | Writing or running E2E browser tests |
| `browser-verify` | Quick visual / smoke check in a browser |
| `issue-tracking` | Managing GitHub / Linear / GitLab issues |
| `goal-verifier` | Checking whether a task actually achieved its outcome |
| `context-gatherer` | Cross-channel context — email, Teams, local KB |
| `deep-research` | Multi-source research, fact-checking |
| `obsidian-vault` | Reading / writing an Obsidian vault |
| `msgraph` | Microsoft 365 (email / calendar / Teams) |
| `project-seeder` | Generating `AGENTS.md` / `.agents/` docs / per-role memory briefings for a new project |

Each skill lives at `./skills/<name>/SKILL.md`.

## External skills — fallback install

Some skills referenced by agents live in external repos (Matt Pocock's TDD,
Jesse Vincent's `obra/superpowers` skills, Paul Hudson's Swift skills).
This Gemini extension does **not** fetch them — only the monorepo skills
listed above are available in this install.

For the full experience (including external skills auto-fetched into
`.claude/skills/` via git clone + symlink), run our installer once in the
project:

```bash
npx github:arozumenko/sdlc-skills init --target claude --agents <your-team>
```

Then the externals appear alongside the monorepo skills and work the same
way.

## Using skills in conversation

- "Load the `tdd` skill" → read `./skills/tdd/SKILL.md`.
- "I'm starting as `ios-dev`" → read `./agents/ios-dev/AGENT.md` + `SOUL.md`.
- Don't restate a skill's contents verbatim. Follow its workflow.

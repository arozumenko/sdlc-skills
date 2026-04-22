# sdlc-skills

A bundled software delivery lifecycle toolkit for Claude Code, Cursor,
Windsurf, and GitHub Copilot. One repo contains:

- **Role-based agents** — BA, Tech Lead, PM, Python dev, JS dev, QA, Personal
  Assistant. Each agent ships with `AGENT.md` (frontmatter + technical
  instructions) and `SOUL.md` (personality / voice).
- **Workflow skills** — bug-fix workflow, feature planning, feature
  implementation, project seeding.
- **Generic dev skills** — code review, TDD, Playwright, git workflow.
- **Claude plugin manifest** — `.claude-plugin/marketplace.json` so the
  whole repo installs via `/plugin install sdlc-skills@sdlc-skills` inside
  Claude Code.
- **Legacy npx installer** — `bin/init.mjs` so the same agents and skills
  can be dropped into `.claude/agents/` (and `.cursor/`, `.windsurf/`,
  `.github/`) with a single `npx` command, no Claude plugin layer needed.

## Three ways to consume this repo

### 1. Claude Code plugin marketplace (preferred inside Claude Code)

```bash
# Add the marketplace source (once)
/plugin marketplace add arozumenko/sdlc-skills

# Install everything
/plugin install sdlc-skills@sdlc-skills

# — or install individual agents —
/plugin install sdlc-skills@ba
/plugin install sdlc-skills@tech-lead
/plugin install sdlc-skills@project-manager
/plugin install sdlc-skills@python-dev
/plugin install sdlc-skills@js-dev
/plugin install sdlc-skills@qa-engineer
/plugin install sdlc-skills@scout
/plugin install sdlc-skills@personal-assistant

# — or install individual skills —
/plugin install sdlc-skills@code-review
/plugin install sdlc-skills@bugfix-workflow
/plugin install sdlc-skills@tdd
/plugin install sdlc-skills@msgraph
# ... etc — see full list below
```

Each agent and skill is published as its own plugin entry, so you can
pick exactly what you need. The `sdlc-skills` entry installs the full
toolkit in one shot.

### 2. Direct install via npx (works for any IDE)

Copies agents and skills directly into the IDE directories of the current
project. Does not rely on Claude Code's plugin system.

```bash
# Install everything, all detected IDEs
npx github:arozumenko/sdlc-skills init --all

# Install a subset of agents
npx github:arozumenko/sdlc-skills init --agents ba,tech-lead,pm

# Install specific skills
npx github:arozumenko/sdlc-skills init --skills bugfix-workflow,code-review

# Mix and match, Claude Code only
npx github:arozumenko/sdlc-skills init \
  --agents ba,tech-lead,pm \
  --skills plan-feature,implement-feature \
  --target claude

# Update existing installs
npx github:arozumenko/sdlc-skills init --all --update
```

Detected IDE directories:

| Target | Directory  | Installed path                         |
|--------|------------|----------------------------------------|
| Claude Code     | `.claude/`  | `.claude/agents/<name>/`, `.claude/skills/<name>/` |
| Cursor          | `.cursor/`  | `.cursor/agents/<name>/`, `.cursor/skills/<name>/` |
| Windsurf        | `.windsurf/`| `.windsurf/agents/<name>/`, `.windsurf/skills/<name>/` |
| GitHub Copilot  | `.github/`  | `.github/agents/<name>/`, `.github/skills/<name>/` |

See `npx github:arozumenko/sdlc-skills init --help` for the full flag list.

### 3. agentskills.io / third-party consumption

Every skill under `skills/<name>/` follows the
[agentskills.io](https://agentskills.io) spec — each has a `SKILL.md` with
`name` + `description` frontmatter at the top. Any tool that reads the spec
(Vercel's skill runtime, custom agent frameworks, other AI IDEs) can point
directly at `skills/<name>/` without going through the Claude plugin layer
or this installer.

## Using outside the Octobots supervisor

These agents and skills install cleanly into stock Claude Code (or Cursor /
Windsurf / Copilot) and are useful on their own — a BA can draft stories, a
tech-lead can review a PR, `plan-feature` and `bugfix-workflow` run
end-to-end with just `git` and `gh`. But several pieces assume the
[Octobots supervisor framework](https://github.com/arozumenko/octobots) is
running underneath them, and those assumptions will be visible if you use
the agents standalone. Read this before you install.

### Frontmatter extensions the supervisor owns

| Key | Owned by | Stock-Claude behavior |
|---|---|---|
| `workspace: clone` | supervisor | Ignored. In Octobots, the supervisor launches `python-dev` and `js-dev` in their own git clones so branches don't collide; without it, all devs share your working tree and will step on each other. |
| `skills: [taskbox, memory, ...]` | partly supervisor | `taskbox` and `memory` are bundled *inside* the supervisor, not published here — they're no-ops on stock Claude Code, and any instruction that says "check your inbox" or "snapshot memory" will silently do nothing. |

### `@import` paths that require a seeded project

Several agents import runtime state via Claude Code's `@`-import syntax:

```markdown
@.claude/memory/<role>/snapshot.md
```

These files are written by the supervisor's `memory` skill at launch. On
stock Claude Code, the import resolves to a missing file and the agent
starts without its persistent memory. That's survivable — the agent still
works — but any phrase like "read your snapshot before acting" is a
no-op until you either (a) run the Octobots supervisor, or (b) create the
file yourself.

### Shell commands that assume the supervisor is present

Agent bodies contain commands like:

```bash
python octobots/skills/taskbox/scripts/relay.py send --from scout --to pm "…"
```

These are **hard-coded references to the supervisor's taskbox**. On stock
Claude Code they'll fail with "No such file or directory." Treat those
lines as prompts for the agent to *describe* the handoff verbally instead
— the intent (who hands work to whom, in what order) is still
communicated, even if the literal command doesn't run.

### What works unchanged on stock Claude Code

- `ba`, `tech-lead`, `project-manager`, `qa-engineer`, `scout`,
  `personal-assistant` — all run fine as subagents. They just won't send
  taskbox messages.
- Every skill under `skills/` — `plan-feature`, `bugfix-workflow`,
  `implement-feature`, `task-completion`, `code-review`, `tdd`,
  `git-workflow`, `playwright-testing`, `browser-verify`,
  `issue-tracking`, `goal-verifier`, `context-gatherer`, `deep-research`,
  `obsidian-vault`, `msgraph`. None of them depend on the supervisor.
- Developer agents work on your single working tree instead of a
  supervisor-managed clone; coordinate merges manually.

If you want the full orchestrated experience (multi-agent taskbox, per-dev
clones, supervisor TUI, persistent memory snapshots), install the
Octobots supervisor alongside these agents.

## Repository layout

```
sdlc-skills/
├── .claude-plugin/
│   ├── marketplace.json        # Claude Code marketplace manifest
│   └── plugin.json             # plugin metadata (name, version, keywords)
├── agents/                     # role-based personas
│   └── <agent-name>/
│       ├── AGENT.md            # YAML frontmatter + technical instructions
│       └── SOUL.md             # personality / voice / working style
├── skills/                     # agentskills.io-compliant skills
│   └── <skill-name>/
│       ├── SKILL.md            # frontmatter: name + description
│       ├── references/         # optional supporting docs
│       └── scripts/            # optional helper scripts
├── bin/
│   └── init.mjs                # legacy npx installer (mode 2 above)
├── package.json                # bin: { init: ./bin/init.mjs }
├── LICENSE
└── README.md
```

## Catalog

<!--
  This section is maintained by convention, not by a script.
  When you add an agent or skill, update the corresponding table below.
  The installer reads agents/ and skills/ at runtime, so missing a README
  entry never causes a missing install — it just hides the entry from
  human browsers of this README.
-->

### Agents (9)

| Agent | Role |
|---|---|
| `ba` | Business analyst — turns requirements into user stories with acceptance criteria |
| `tech-lead` | Decomposes user stories into technical tasks with dependencies |
| `project-manager` | Distributes tasks, tracks team state, escalates blockers |
| `python-dev` | Python implementation — owns its own repo clone and branch |
| `js-dev` | JavaScript / TypeScript implementation — owns its own repo clone and branch |
| `ios-dev` | iOS/Swift implementation — SwiftUI, SwiftData, Swift Testing (no simulator) |
| `qa-engineer` | Tests PRs, reports findings on the GitHub issue |
| `personal-assistant` | Conversational assistant: vault, email, calendar, daily brief |
| `scout` | Maps unfamiliar codebases — explores, documents patterns, flags risks |

### Workflow skills — SDLC-coupled (5)

| Skill | What it does |
|---|---|
| `bugfix-workflow` | Structured bug investigation: reproduce → root cause → fix → regression test |
| `plan-feature` | Feature planning workflow used by BA / Tech Lead |
| `implement-feature` | Feature implementation workflow used by devs |
| `project-seeder` | Scout's project onboarding / configuration flow |
| `task-completion` | Five-step task completion protocol: verify → commit → PR → comment → notify |

### External skills (not in this repo)

Some agents declare skills that live in external repos and are installed
through the Octobots supervisor (`supervisor/skills.json` → `registry-fetch.sh
skill <repo>`, or manually via `npx skills add <repo>`). They are not part of
the sdlc-skills monorepo and are not installed by `npx github:arozumenko/sdlc-skills init`.

| Skill | Source | Used by |
|---|---|---|
| `swiftui-pro` | [`twostraws/SwiftUI-Agent-Skill`](https://github.com/twostraws/SwiftUI-Agent-Skill) | `ios-dev` |
| `swiftdata-pro` | [`twostraws/SwiftData-Agent-Skill`](https://github.com/twostraws/SwiftData-Agent-Skill) | `ios-dev` |
| `swift-testing-pro` | [`twostraws/Swift-Testing-Agent-Skill`](https://github.com/twostraws/Swift-Testing-Agent-Skill) | `ios-dev` |
| `swift-concurrency-pro` | [`twostraws/Swift-Concurrency-Agent-Skill`](https://github.com/twostraws/Swift-Concurrency-Agent-Skill) | `ios-dev` |

### Generic dev skills (12)

| Skill | What it does |
|---|---|
| `code-review` | Structured code review checklist and reporting |
| `tdd` | Test-driven development workflow |
| `git-workflow` | Branching, commits, PR conventions |
| `playwright-testing` | E2E browser testing with Playwright |
| `browser-verify` | Quick visual / smoke verification in a browser |
| `issue-tracking` | GitHub issue management conventions |
| `goal-verifier` | Verify a task actually achieved its stated goal |
| `context-gatherer` | Targeted codebase exploration before changes |
| `deep-research` | Multi-source research and synthesis |
| `memory` | Persistent file-based memory across conversations (user, feedback, project, reference) |
| `obsidian-vault` | Read / write the user's Obsidian second brain |
| `msgraph` | Microsoft Graph (email / calendar / Teams) integration |

## Development

This repo is the single source of truth. The same files serve three
consumers (Claude Code plugin marketplace, the npx installer, agentskills.io
third-party tools) with no duplication.

When adding content:

1. **New agent** → create `agents/<name>/AGENT.md` (with YAML frontmatter:
   `name`, `description`, `model`, `color`, `skills`) and `agents/<name>/SOUL.md`.
2. **New skill** → create `skills/<name>/SKILL.md` with agentskills.io
   frontmatter (`name`, `description`). Put supporting files in
   `skills/<name>/references/` or `skills/<name>/scripts/`.
3. **Update the catalog tables in this README.**

No build step, no CI-generated manifests. The installer discovers content
by reading the directories at runtime — add a folder, it shows up in the
next `init` run.

## License

MIT — see [LICENSE](./LICENSE).

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

```
/plugin marketplace add arozumenko/sdlc-skills
/plugin install sdlc-skills@sdlc-skills
```

Claude Code walks the plugin root, picks up everything under `agents/`,
`skills/`, `commands/`, and `mcp/`, and wires it all up automatically. One
command, whole toolkit.

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

### Agents (7)

| Agent | Role |
|---|---|
| `ba` | Business analyst — turns requirements into user stories with acceptance criteria |
| `tech-lead` | Decomposes user stories into technical tasks with dependencies |
| `project-manager` | Distributes tasks, tracks team state, escalates blockers |
| `python-dev` | Python implementation — owns its own repo clone and branch |
| `js-dev` | JavaScript / TypeScript implementation — owns its own repo clone and branch |
| `qa-engineer` | Tests PRs, reports findings on the GitHub issue |
| `personal-assistant` | Conversational assistant: vault, email, calendar, daily brief |

### Workflow skills — SDLC-coupled (4)

| Skill | What it does |
|---|---|
| `bugfix-workflow` | Structured bug investigation: reproduce → root cause → fix → regression test |
| `plan-feature` | Feature planning workflow used by BA / Tech Lead |
| `implement-feature` | Feature implementation workflow used by devs |
| `project-seeder` | Scout's project onboarding / configuration flow |

### Generic dev skills (11)

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

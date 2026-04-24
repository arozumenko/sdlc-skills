# Test Automation — Onboarding

sdlc-skills brings test-automation capabilities to any repo. This
dispatcher takes you from "I want to use this toolkit" to "the
pipeline is running." Details live in the skills themselves —
follow the links as you go.

**Pick your path:**

- [Existing automation project](#existing-automation-project) — you
  have a framework + app + (optionally) a TMS + MCP tools wired.
- [Greenfield (new project)](#greenfield) — no test framework in the
  repo yet.

## The pipeline, one picture

```
TMS case → analyst slot → AFS → implementer slot → green test → reviewer slot → PM merges
```

Role defaults:

| Slot | Agent | Skill |
|---|---|---|
| Analyst | `qa-engineer` (Sage) | `test-case-analysis` |
| Implementer | `test-automation-engineer` (Axel) | `test-automation-workflow` |
| Reviewer | `qa-engineer` (fresh session) | `code-review` |

PM (Max) owns routing and the merge gate. Tech-lead (Rio) is
**not** in the hot path — PM pulls them in for framework bootstrap,
framework-scale work, or mid-flow architectural escalation. Full
routing rules:
[`skills/test-automation-workflow/SKILL.md` § Routing](skills/test-automation-workflow/SKILL.md).

---

## Prerequisites

```bash
node --version                       # Node 18+ (for the npx installer)
gh --version && gh auth status       # gh CLI for PR creation
git rev-parse --is-inside-work-tree  # inside a git repo
```

Plus:

- An application reachable at `$BASE_URL` (existing-project flow only)
- Host MCP tools wired in (optional — TMS has a markdown fallback)

Your host can be GitHub Copilot CLI, Claude Code, Cursor, or
Windsurf — the installer targets all four. Host-specific launch
syntax and install flags: [README.md](README.md).

---

## Existing automation project

You have an existing framework (Playwright / Cypress / WebdriverIO /
pytest + playwright-python / JUnit + Selenium / …), a reachable app,
and ideally TMS MCP tools. If any of these are missing, see the
[Greenfield](#greenfield) path instead.

### 1. Install sdlc-skills

```bash
cd /path/to/your-automation-repo

npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,project-manager,tech-lead,qa-engineer,test-automation-engineer \
  --skills project-seeder,test-case-analysis,test-automation-workflow,playwright-testing,browser-verify,bugfix-workflow,code-review,task-completion,issue-tracking,atlassian-content,xray-testing,memory,tdd,git-workflow,plan-feature \
  --yes
```

Swap `--target` per host (`claude` / `cursor` / `windsurf` /
`copilot`). Omit `--target` to install into every detected IDE
directory. For Copilot users who see directories where `.agent.md`
files should be: `npx github:arozumenko/sdlc-skills init fix-copilot`
(see [README.md](README.md) for the `--soul` modes).

### 2. Seed via scout

Launch scout and paste the prompt below. Scout already carries the
`project-seeder` skill — the prompt supplies only project-specific
inputs:

```
Onboard this repo for the test-automation workflow. Load the
project-seeder skill. DO NOT scaffold a framework, modify app code,
or rewrite tests — discover and document what's there.

Host: <GitHub Copilot CLI | Claude Code | Cursor | Windsurf>

## Project systems
Issue tracker:      <github-issues | jira | gitlab-issues | azure-boards | linear | none | ASK>
Tracker key:        <org/repo or PROJ key | ASK>
TMS:                <zephyr-scale | testrail | xray | azure-test-plans | markdown | none | ASK>
TMS project key:    <... | ASK>
Knowledge base:     <confluence | notion | obsidian | github-wiki | readme-only | none | ASK>
KB space / db:      <... | ASK>
Bug filing style:   <github-issue | story-subtask | separate-ticket | ASK>
Bug filing target:  <blank | QA-BUGS style key | ASK>
Bundling policy:    <strict-per-bug | bundle-per-case | ASK>
Link case in bug:   <yes | no | ASK>
Test case storage:  <tms | markdown | both-synced | ASK>
Automation PR base: <main | develop | feature/<name> | ASK>
Merge policy:       <auto-merge | human-approved | manual | ASK>
Merge strategy:     <squash | rebase | merge | ASK>
```

Scout writes `.agents/testing.md`, `.agents/architecture.md`,
`.agents/workflow.md`, `.agents/profile.md`,
`.agents/test-automation.yaml`, `.agents/team-comms.md`. Full
procedure: [`skills/project-seeder/SKILL.md`](skills/project-seeder/SKILL.md).

**After scout completes, review `.agents/testing.md`.** If the
framework name, version, run command, or CI command is wrong, fix
by hand. Axel's output quality is entirely downstream of this file
— two minutes here saves a rolled-back staging environment later.

Fill in every `Unconfirmed` field scout couldn't infer (test
environments, test user accounts, test data strategy, scope
boundaries). Sage and Axel refuse to proceed without these.

### 3. Verify `.agents/test-automation.yaml`

Scout populated this from your pre-fill block + repo inspection.
Open it, fill any `<ASK>` slots (typically `auth_env` for HTTP
transport, or an MCP server name when multiple candidates exist).

Full schema + all adapter variants (Xray / Zephyr / TestRail /
Azure / markdown; MCP vs HTTP transport):
[`skills/test-automation-workflow/references/tms-adapters.md`](skills/test-automation-workflow/references/tms-adapters.md).

No TMS? The markdown fallback is a one-liner:

```yaml
tms:
  adapter: markdown
  cases_dir: test-specs
```

### 4. Pilot one case end-to-end

Pick a case you already know passes manually. Keep it small — login,
a navigation, a simple form. The point is to prove the pipeline, not
the app.

The full slot-by-slot flow lives in
[`skills/test-automation-workflow/SKILL.md` § Routing](skills/test-automation-workflow/SKILL.md).
Shape:

1. **Analyst (qa-engineer + `test-case-analysis`)** executes the
   case, emits an AFS at
   `test-specs/<feature>/l<pri>_<slug>_<tms-id>.md`, returns a status.
2. **Gate on status** — only `ready-for-automation` advances. Fix
   `blocked` / `defect-found` / `un-automatable` upstream.
3. **Implementer (test-automation-engineer)** reads the AFS, writes
   the test in the existing framework, runs it locally and in CI,
   opens a PR, back-writes the TMS execution.
4. **Reviewer (qa-engineer, fresh session, + `code-review` skill)**
   checks assertions, selectors, defect-masking, cleanup. Reports
   with file:line refs.
5. **PM merges** per `.agents/profile.md` § Automation PR policy
   (`auto-merge` / `human-approved` / `manual`).

### 5. Scale up

Once one case works end-to-end, batch is safe. Parallelism and
serialization rules (page-object collisions, independent-surface
parallelism, reviewer batching): skill § Routing → *Batching* and
[`skills/test-automation-workflow/references/commands.md`](skills/test-automation-workflow/references/commands.md)
for host-specific sub-agent spawning recipes.

---

## Greenfield

You have no existing test framework. sdlc-skills doesn't bootstrap
one unilaterally — that's an architectural decision. Tech-lead (Rio)
owns it.

1. **Install** with the same command as above — include `tech-lead`
   in `--agents`.
2. **Seed via scout** with `TMS: markdown` and `Automation PR base:
   main` (adjust later). Skip framework-specific fields; scout writes
   a stub `.agents/testing.md` with a note that the framework isn't
   picked yet.
3. **Launch tech-lead** with the `test-automation-workflow` skill:

   > Bootstrap a test-automation scaffold for this empty repo. Pick
   > the framework per the project's primary language per
   > [`skills/test-automation-workflow/references/framework-scaffold.md`](skills/test-automation-workflow/references/framework-scaffold.md).
   > Define page-object style, fixture pattern, naming, run command,
   > and CI command. Write the chosen conventions into
   > `.agents/testing.md`. Hand back the scaffold plan; do not write
   > test code yourself — that's the implementer's job.

4. **Launch test-automation-engineer** with tech-lead's plan. Axel
   creates the initial config files + one smoke test proving the
   scaffold works.
5. **From here, follow the existing-project flow** (Step 4 above)
   with the first real case (or markdown case).

Tech-lead's full escalation contract lives in
[`agents/tech-lead/AGENT.md` § Test-Automation Escalations](agents/tech-lead/AGENT.md).

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote
  directories instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`. See
  [README.md](README.md) for `--soul` modes.
- **Sage returns `ready-for-automation` with a sparse selector
  table** → she skipped exploration. Re-run with: *"Execute every
  step via playwright-testing or browser-verify MCP tools before
  writing the AFS — do not author from the TMS case description
  alone."*
- **Axel generates off-style tests** → `.agents/testing.md` is
  misleading him. Fix it by hand (framework version, page-object
  convention, run command); ask Axel to `--update` the spec file.
- **TMS back-write silently fails** → look in `test-results/unsynced/`
  for the queued payload. Retry manually or re-run the back-write
  step through Axel.
- **MCP auth errors** → token rotated / scope missing. Fix the MCP
  server config in the host (`~/.claude.json`, `.mcp.json`, Copilot
  settings). Never in the project repo. Restart the agent session.
- **Flaky test at CI but not local** → head vs headless, viewport,
  timing. Axel owns root-cause. Never accept "retry three times" as
  a fix.

---

## Maintenance

Updating sdlc-skills once you've installed it: [MAINTENANCE.md](MAINTENANCE.md).

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # scout-generated project context
├── .agents/
│   ├── testing.md / architecture.md  # scout-owned content docs
│   ├── team-comms.md / profile.md
│   ├── test-automation.yaml          # TMS + framework config (yours to edit)
│   └── memory/<role>/                # per-role persistent memory
├── test-specs/                       # AFS files (analyst emits)
│   └── <feature>/l<pri>_<slug>_<tms-id>.md
├── test-results/                     # evidence (both phases)
│   ├── screenshots/ reports/ json/
│   └── unsynced/                     # failed TMS back-writes, to retry
├── tests/                            # YOUR framework (untouched)
└── .github/agents/<role>.agent.md    # or .claude/agents/<role>/ per host
```

Only `.agents/`, `test-specs/`, and `test-results/` are owned by the
sdlc-skills pipeline. Your framework, app code, and CI config stay
untouched.

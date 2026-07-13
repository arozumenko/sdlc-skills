# Scout — Exploration & Seeding Workflow

The full 10-phase procedure scout follows when onboarding a new codebase.
This file is loaded by scout at session start; the main AGENT.md keeps only
role identity, behavioral rules, and a pointer here.

File generation (Phase 7 onward) uses the `seeding-a-project` skill — read that
skill's SKILL.md and references for templates and composition guidance.

---

## Phase 1: Lay of the Land

Get the big picture in 60 seconds:

```bash
# What kind of project is this?
ls -la
cat README.md 2>/dev/null | head -80

# What languages?
find . -name "*.py" -not -path "./.venv/*" -not -path "./node_modules/*" | head -5
find . -name "*.ts" -o -name "*.tsx" | head -5
find . -name "*.go" | head -5
find . -name "*.rs" | head -5

# Package manifests
cat pyproject.toml 2>/dev/null | head -40
cat package.json 2>/dev/null | head -40
cat go.mod 2>/dev/null | head -20
cat Cargo.toml 2>/dev/null | head -20

# Git state
git --no-pager log --oneline -10
git --no-pager remote -v
```

**Determine:** Primary language(s), framework(s), monorepo vs single project.

---

## Phase 2: Structure Map

Understand how the code is organized:

```bash
# Directory tree (depth 3, ignore noise)
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' \
  -not -path '*/__pycache__/*' -not -path '*/.venv/*' \
  -not -path '*/dist/*' -not -path '*/build/*' \
  -maxdepth 3 | sort

# Count files by type
find . -type f -name "*.py" -not -path "./.venv/*" | wc -l
find . -type f -name "*.ts" -not -path "./node_modules/*" | wc -l
find . -type f -name "*.test.*" -o -name "*_test.*" -o -name "test_*" | wc -l
```

Read key entry points:
- `src/main.*`, `src/app.*`, `src/index.*`
- `manage.py`, `wsgi.py`, `asgi.py` (Django)
- `app/layout.tsx`, `pages/_app.tsx` (Next.js)
- `cmd/*/main.go` (Go)

---

## Phase 3: Dependencies & Config

```bash
# Python
cat pyproject.toml 2>/dev/null
cat requirements*.txt 2>/dev/null
cat setup.cfg 2>/dev/null
ls .venv/bin/python 2>/dev/null

# JavaScript/TypeScript
cat package.json 2>/dev/null
cat tsconfig.json 2>/dev/null
ls package-lock.json pnpm-lock.yaml yarn.lock bun.lockb 2>/dev/null

# Environment
cat .env.example 2>/dev/null || cat .env.sample 2>/dev/null
cat docker-compose.yml 2>/dev/null | head -50

# CI/CD
ls .github/workflows/*.yml 2>/dev/null
cat .github/workflows/*.yml 2>/dev/null | head -60
cat .gitlab-ci.yml 2>/dev/null | head -40
cat Jenkinsfile 2>/dev/null | head -40
```

---

## Phase 4: Conventions Detection

Read 3-5 representative source files to detect patterns:

```bash
# Find the most recently modified source files (likely most relevant)
find . -name "*.py" -not -path "./.venv/*" -newer .git/HEAD -type f | head -5
find . -name "*.ts" -not -path "./node_modules/*" -newer .git/HEAD -type f | head -5
```

Look for:
- **Import style** — absolute vs relative, order convention
- **Naming** — snake_case, camelCase, PascalCase for files/vars/classes
- **Error handling** — custom exception classes? Error boundaries? Global handlers?
- **Code organization** — thin routes? Service layer? Repository pattern?
- **Comments/docs** — docstrings? JSDoc? Inline comments?
- **Type system** — strict TypeScript? Type hints in Python? Any custom types?

---

## Phase 5: Test Infrastructure

Detect the test framework(s) **broadly and without ordering** — no framework
is the default. Scan across every test surface the repo might exercise (UI
runners, API/unit test frameworks, mobile, performance), and let the files
present decide. A repo may use several; record what you actually find.

```bash
# Test framework — probe broadly, no single tool privileged.
# Whichever config/manifest is present is the truth.
ls pytest.ini conftest.py tox.ini 2>/dev/null              # pytest / Python
ls jest.config.* vitest.config.* mocha* .mocharc* 2>/dev/null  # JS unit runners
ls playwright.config.* cypress.config.* wdio.conf.* 2>/dev/null # browser/UI runners
ls karate-config.* *.feature 2>/dev/null                   # Cucumber/Karate BDD
find . \( -name "build.gradle*" -o -name "pom.xml" \) \
  -not -path "*/node_modules/*" 2>/dev/null | head -5      # JUnit/TestNG (JVM)
ls *.csproj 2>/dev/null                                    # NUnit/xUnit (.NET)
ls go.mod Cargo.toml 2>/dev/null                           # go test / cargo test
# API: REST-assured / requests / supertest / Postman/newman / pact (contract)
grep -rliE "rest-assured|supertest|requests|httpx|newman|pact" \
  --include=*.{js,ts,py,java,kt,xml,json,gradle} . 2>/dev/null | head -5
# Mobile: Appium / Espresso / XCUITest / Detox / Maestro
grep -rliE "appium|espresso|xcuitest|detox|maestro" . 2>/dev/null | head -5
# Performance: k6 / JMeter / Gatling / Locust / Artillery
ls *.jmx 2>/dev/null
grep -rlwiE "k6|gatling|locust|artillery" \
  --include=*.{js,ts,py,scala,java,json,yml,yaml,gradle,toml,txt} \
  --exclude={package-lock.json,yarn.lock,pnpm-lock.yaml} \
  --exclude-dir={node_modules,dist,build,.venv} . 2>/dev/null | head -5

# Test files
find . -path "*/test*" -name "*.py" -not -path "./.venv/*" | head -10
find . -path "*/__tests__/*" -o -name "*.test.*" -o -name "*.spec.*" | head -10

# Read a sample test to understand patterns
```

Look for: framework(s), fixture patterns, mocking approach, test data strategy, CI test commands.

**Record three things into `.agents/testing.md` for the engineer** (use the
template in `seeding-a-project/references/templates.md`):

1. **Framework(s) + version** — exactly what's installed (e.g. `pytest 8`,
   `Playwright 1.47`, `WDIO 8`, `k6`), not a recommendation.
2. **The single-case run command** — the actual invocation that runs one test
   against the real system (verify it runs; flag if you can't).
3. **A free-text TEST-TYPE descriptor** — e.g. `ui` / `api` / `mobile` /
   `perf` / `mixed`. This is a **hint** for the engineer to match per case, **not
   an enforced enum**: if the repo spans surfaces, write `mixed` and note which
   directories are which. Don't force a single label on a polyglot repo.

---

## Phase 5.5: Team Configuration Proposal

This is where you shift from explorer to consultant. Don't ask "does anything look wrong?" — present a **specific, opinionated proposal** based on what you found.

Apply *How you ask and decide* (in your AGENT.md) here: if the repo is
really several independent services, **decompose first** and confirm the
breakdown before proposing one team. Where a role or convention is
ambiguous, present 2–3 options with your recommendation rather than a flat
guess. Resolve any clarifying questions **one at a time**, not as a batch.

**Confirm the delivery systems with the user — don't just infer them.**
The PM and developers route work, open changes, and merge against three
systems you can't always detect reliably from files. Detect first, then
**state what you found and ask the user to confirm or correct** (one
question at a time) — especially when the tracker differs from the code
host, or there's no PR history to sample:

- **Where do tasks live?** Issue/task tracker — GitHub Issues, Jira,
  GitLab Issues, Azure Boards, Linear, or none. → record in
  `profile.md § Project systems`.
- **Where does code live, and how do changes ship?** Code host (GitHub /
  GitLab / Bitbucket / Azure DevOps / Gitea), its CLI (`gh` / `glab` /
  `bb` / `az repos` / `tea`), and the unit of change (PR vs MR). → record
  in `workflow.md § Git host`.
- **How is CI gated?** Which checks must be green to merge, required
  approvers, auto-merge / labels (detect from `.github/workflows`,
  `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml`). → record in
  `workflow.md § CI gates`.

These three feed every routing and merge decision the team makes — the PM
and `completing-a-task` skill read them and adapt their commands to the
host/tracker you record. A wrong guess here misroutes work silently, so
confirm rather than assume GitHub.

**1. Propose the complete team setup:**

```
=== Recommended Team for [Project Name] ===

Role                      Persona  Focus for this project
──────────────────────────────────────────────────────────────────
test-automation-lead      Tal      [pipeline routing, merge gate, framework architecture here]
test-automation-engineer  Axel     [framework + surfaces this role implements against]
qa-engineer               Sage     [test framework and approach for this stack]
scout                     Kit      Codebase exploration (this session)
```

**2. Explain the reasoning.** If you're recommending role changes, say why:
- "test-automation-engineer's default examples lean web/UI — this is a pure API service, so I've tuned the briefing toward the HTTP-client test stack."
- "The repo has both pytest and Cypress suites — I've noted the split so the implementer matches the right one per surface."
- "QA's focus is exploratory + contract testing here — I've noted the detected framework so the engineer matches it."

If the default roles fit, say so: "Default team fits a web app project — no role changes needed."

**3. Ask for approval:**
"Does this team match what you need? You can approve, swap any role's focus, rename a persona, or remove a role."

**Key behaviors:**
- Propose specific persona names where project context suggests them (from GDD, README, team mentions). Use defaults (`Py`, `Jay`, `Alex`) if nothing suggests otherwise.
- If the stack is ambiguous (no files yet), infer from README/GDD. If still unclear, ask one question: "What kind of project is this?" — then propose immediately after the answer.
- Wait for the engineer's response before proceeding.

**Role fit pattern-matching** (use Phase 1–2 data):

| Detected | Implementer (test-automation-engineer) focus | Analyst/reviewer (qa-engineer) focus |
|----------|----------------------------------------------|--------------------------------------|
| `playwright.config.*` / `cypress.config.*` / `wdio.conf.*` | That UI framework, its page objects + fixtures | Browser-driven exploration, selector review |
| HTTP-test stack (pytest + httpx, REST Assured, supertest, …) | API-client layer, contract assertions | Request/response evidence, schema checks |
| Mobile (Appium caps, XCUITest, Espresso) | Screen objects, device/emulator runs | Accessibility-id review, device evidence |
| Perf (k6, Gatling, JMeter) | Scenario modules, thresholds | Metric/threshold review |
| Mixed suites (several of the above) | Match the framework per surface, note the split | Same — per-surface evidence |
| None of the above (greenfield) | Bootstrap per playbook § Framework architecture | Exploration against the live app |

---

## Phase 5.75: CLAUDE.md Reality Check

**Only runs if `CLAUDE.md` already exists.**

Read the entire file. Cross-reference every factual claim against what you actually found:
- Tech stack mentioned vs. package files / project files / binary presence
- Directory paths mentioned vs. `ls` reality
- Commands mentioned vs. what's in `package.json` scripts, Makefile, CI config

Report each divergence with a specific proposed fix — don't ask open-ended questions:

```
CLAUDE.md drift detected:
  - Claims "Unity engine" → No Unity files found. Detected: Godot 4.x (bin/Godot.app).
    Proposed fix: Replace stack section with Godot 4.x / GDScript.
  - References "Assets/Scripts/" → Directory does not exist.
    Proposed fix: Remove this path reference.

Apply these corrections? [yes / no / adjust]
```

Do not touch `CLAUDE.md` until the engineer responds. A stale CLAUDE.md is actively harmful — every agent loads it.

---

## Phase 6: Confirm Before Generate

Present a complete plan of what will be written or modified before touching any file. Wait for "yes".

```
=== Session Plan ===

Files to UPDATE:   CLAUDE.md (fix [N] drift items)
Files to CREATE:   AGENTS.md
                   .agents/{profile, workflow, architecture, conventions, testing, team-comms}.md
                   .agents/test-automation.yaml
                   .agents/memory/<role>/project_briefing.md (per role)
                   .agents/onboarding.md

Roles to tune:     test-automation-engineer → [focus] (framework, surfaces)
                   qa-engineer → [focus] (exploration tooling, evidence style)
                   ...

Memory to seed:    [N] role files — all roles get project context

Proceed? [yes / no / adjust]
```

**Hard stop — do not write a single file until the engineer responds "yes".**

---

## Phase 7: Configure & Tune Team

Execute everything approved in Phase 6. Report each file as you generate it: `✓ project_briefing.md — test-automation-engineer (Playwright + API-client split)`

**File generation uses the `seeding-a-project` skill.** Read the installed
skill's SKILL.md (load it via your host's skill mechanism) for the
generation flow, and the skill's `references/` directory for templates:

- `references/templates.md` — CLAUDE.md / AGENTS.md / `.agents/{profile, architecture, conventions, testing}.md` templates, plus per-role `project_briefing.md` memory-seeding templates
- `references/team-comms-templates.md` — `.agents/team-comms.md` templates by host
- `references/team-comms-workflow.md` — full Step 6.5 detection & generation procedure
- `references/role-customization.md` — Step 7 persona/SOUL.md repurposing procedure

**7a — Generate config files:**
1. `CLAUDE.md` first — **sensitive.** If it already exists: surgical edits only — fix drift items approved in Phase 5.75, nothing else. If it doesn't exist: create from template. Never restructure or reword prose.
2. `AGENTS.md` — full reference, linked from CLAUDE.md. Update, don't overwrite.
3. `.agents/` content files as needed (profile, workflow, architecture, conventions, testing, team-comms, test-automation.yaml).

`CLAUDE.md` lives at the project root.

**7b — Tune SOUL.md and AGENT.md for repurposed roles:**
See `skills/seeding-a-project/references/role-customization.md`. Surgical edits only: update persona name, domain expertise, identity paragraph, mission statement. Leave session lifecycle, communication conventions, and restart protocol intact.

**7c — Seed role memory files:**
For **all roles** — not just customized ones — write a `project_briefing.md`
curated entry at `.agents/memory/<role-id>/project_briefing.md` (with
`type: project` frontmatter per the `memory` skill spec) and append/update
the corresponding line in `.agents/memory/<role-id>/MEMORY.md`. Use the
template in `skills/seeding-a-project/references/templates.md`. Write "My
Role Focus" based on your actual understanding of what that role does on
this project — not placeholder text.

**7d — Generate `.agents/team-comms.md`:**
Run the full procedure in `skills/seeding-a-project/references/team-comms-workflow.md` (substeps 6.5a–6.5f). Every project gets a `team-comms.md`; PM and every routing-capable role point at it for all routing decisions.

**Legacy marker cleanup.** Earlier iterations of this design used `<!-- SCOUT:TEAM-ROSTER:BEGIN -->` / `END` markers inside agent files. Those are gone. If a re-run encounters one, strip the marker block cleanly and log what you removed.

---

## Phase 8: Handoff

Three outputs, in order:

**1. Create `.agents/onboarding.md`** — the persistent audit trail:
- Date, what was found (stack, stage, issues count, GDD presence)
- What was generated/modified (file list)
- Which roles were tuned and why
- Open items (blocked issues, missing addons, decisions pending)
- First recommended task with issue number

**2. File the onboarding record in the tracker** — "Onboarding [date]" with the same content as onboarding.md, filed in the tracker captured in `.agents/profile.md` § Issue tracker (e.g. on GitHub Issues):
```bash
gh issue create --title "Onboarding [date]" --body "$(cat .agents/onboarding.md)"
```
If no tracker is configured (or its CLI is unavailable), warn and skip — `.agents/onboarding.md` is the trail. Don't fail the session.

**3. Report to the operator** — summarize what was seeded and what each role should do first. Give the key facts directly in your terminal close-out message so the engineer can relay context to whichever agent they launch next. Routing for each role is recorded in `.agents/team-comms.md`.

**4. Terminal close-out:**

```
Seeding complete.

⭐ First step: Issue #[N] — [issue title]
   [One sentence on why nothing else can start until this is done.]
```

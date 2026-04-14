# Scout — Exploration & Seeding Workflow

The full 10-phase procedure scout follows when onboarding a new codebase.
This file is loaded by scout at session start; the main AGENT.md keeps only
role identity, behavioral rules, and a pointer here.

File generation (Phase 7 onward) uses the `project-seeder` skill — read that
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

```bash
# Test framework
cat pytest.ini 2>/dev/null
cat conftest.py 2>/dev/null | head -30
cat jest.config.* 2>/dev/null | head -20
cat vitest.config.* 2>/dev/null | head -20
cat playwright.config.* 2>/dev/null | head -30

# Test files
find . -path "*/test*" -name "*.py" -not -path "./.venv/*" | head -10
find . -path "*/__tests__/*" -o -name "*.test.*" -o -name "*.spec.*" | head -10

# Read a sample test to understand patterns
```

Look for: framework, fixture patterns, mocking approach, test data strategy, CI test commands.

---

## Phase 5.5: Team Configuration Proposal

This is where you shift from explorer to consultant. Don't ask "does anything look wrong?" — present a **specific, opinionated proposal** based on what you found.

**1. Propose the complete team setup:**

```
=== Recommended Team for [Project Name] ===

Role             Persona  Focus for this project
──────────────────────────────────────────────────────────────────
project-manager  Max      [what PM coordinates on this project]
python-dev       [Name]   [what this role actually does here]
js-dev           [Name]   [what this role actually does here]
ba               [Name]   [what this role actually does here]
tech-lead        Rio      [Godot / Rust / web context]
qa-engineer      Sage     [test framework and approach for this stack]
scout            Kit      Codebase exploration (this session)
```

**2. Explain the reasoning.** If you're recommending role changes, say why:
- "python-dev and js-dev defaults don't fit a Godot project — I've repurposed them for game dev roles."
- "ba becomes Game Designer because the workflow is GDD-driven, not user-story-driven."
- "QA needs rewriting for GUT/playtesting instead of Playwright."

If the default roles fit, say so: "Default team fits a web app project — no role changes needed."

**3. Ask for approval:**
"Does this team match what you need? You can approve, swap any role's focus, rename a persona, or remove a role."

**Key behaviors:**
- Propose specific persona names where project context suggests them (from GDD, README, team mentions). Use defaults (`Py`, `Jay`, `Alex`) if nothing suggests otherwise.
- If the stack is ambiguous (no files yet), infer from README/GDD. If still unclear, ask one question: "What kind of project is this?" — then propose immediately after the answer.
- Wait for the engineer's response before proceeding.

**Role fit pattern-matching** (use Phase 1–2 data):

| Detected | python-dev suggestion | js-dev suggestion |
|----------|-----------------------|-------------------|
| `*.gd`, `project.godot`, `Godot.app` | GDScript developer | Level designer |
| `Cargo.toml`, `*.rs` | Rust developer | Ask engineer |
| `*.ipynb`, ML libs in requirements | ML/data dev (fits) | Data viz / ML ops |
| `package.json` + `*.py` | Backend developer (fits) | Frontend developer (fits) |
| Only `package.json` | Second JS/TS dev or remove | Frontend developer (fits) |
| None of the above | Keep default or ask | Keep default or ask |

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
                   .octobots/{profile, architecture, conventions, testing}.md
                   .octobots/roles-manifest.yaml
                   .octobots/onboarding.md

Roles to tune:     python-dev → [Persona] ([new focus])
                   js-dev → [Persona] ([new focus])
                   ...

Memory to seed:    [N] role files — all roles get project context

Infrastructure:    roles.py, supervisor.py, telegram-bridge.py will be updated
                   to match the new team configuration.

Proceed? [yes / no / adjust]
```

**Hard stop — do not write a single file until the engineer responds "yes".**

---

## Phase 7: Configure & Tune Team

Execute everything approved in Phase 6. Report each file as you generate it: `✓ SOUL.md — python-dev → Vad (Godot GDScript)`

**File generation uses the `project-seeder` skill.** Read
`sdlc-skills/skills/project-seeder/SKILL.md` for the generation flow, and
the skill's `references/` directory for templates:

- `references/templates.md` — CLAUDE.md / AGENTS.md / profile / conventions / testing / architecture templates, plus `.octobots/roles-manifest.yaml` and role-memory-seeding templates
- `references/team-comms-templates.md` — `.octobots/team-comms.md` templates by host
- `references/team-comms-workflow.md` — full Step 6.5 detection & generation procedure
- `references/role-customization.md` — Step 7 persona/SOUL.md repurposing procedure

**7a — Generate config files:**
1. `CLAUDE.md` first — **sensitive.** If it already exists: surgical edits only — fix drift items approved in Phase 5.75, nothing else. If it doesn't exist: create from template. Never restructure or reword prose.
2. `AGENTS.md` — full reference, linked from CLAUDE.md. Update, don't overwrite.
3. `.octobots/` files as needed (profile, architecture, conventions, testing).

`CLAUDE.md` lives at the project root. It is symlinked into worker workspaces by the supervisor at launch.

**7b — Generate `.octobots/roles-manifest.yaml`:**
Use the template in `skills/project-seeder/references/templates.md`. Fill in all roles — customized and unchanged. This file is the input for the spawn readiness check.

**7c — Tune SOUL.md and AGENT.md for repurposed roles:**
See `skills/project-seeder/references/role-customization.md`. Surgical edits only: update persona name, domain expertise, identity paragraph, mission statement. Leave session lifecycle, taskbox commands, communication conventions, restart protocol intact.

**7d — Seed role memory files:**
Create or update `.claude/memory/<role-id>.md` for **all roles** — not just customized ones. Use the template in `skills/project-seeder/references/templates.md`. Write "My Role Focus" based on your actual understanding of what that role does on this project — not placeholder text.

**7e — Generate `.octobots/team-comms.md`:**
Run the full procedure in `skills/project-seeder/references/team-comms-workflow.md` (substeps 6.5a–6.5g). Every project gets a `team-comms.md`, taskbox and host-native alike; PM and PA point at it for all routing decisions.

**Legacy marker cleanup.** Earlier iterations of this design used `<!-- SCOUT:TEAM-ROSTER:BEGIN -->` / `END` markers inside agent files. Those are gone. If a re-run encounters one, strip the marker block cleanly and log what you removed.

---

## Phase 8: Infrastructure Consistency Check

Run:
```bash
python3 octobots/scripts/check-spawn-ready.py --check infra-only
```

For each discrepancy in `roles.py`, `supervisor.py`, or `telegram-bridge.py`, fix it surgically and explain what changed:

- **`roles.py` ROLE_ALIASES** — add persona aliases for new/renamed roles; remove stale persona aliases that no longer match any active role's persona.
- **`roles.py` ROLE_DISPLAY** — update the shortname label for any role whose short alias changed.
- **`supervisor.py` ROLE_THEME** — update the `name` field (short alias) for repurposed roles.
- **`telegram-bridge.py` `cmd_team` tuples** — update the description string for repurposed roles.

**Auto-fix** alias names and descriptions — these require no judgment. **Ask the engineer** before changing icons (subjective; changing them is optional).

Re-run the check after fixes and report final pass/fail per item.

---

## Phase 9: Spawn Readiness Check

Run:
```bash
python3 octobots/scripts/check-spawn-ready.py
```

Print results as a numbered checklist. If any **critical** check fails, list what's blocking and what the engineer needs to do to resolve it. Do not declare "ready" until all critical checks pass.

---

## Phase 10: Handoff

Three outputs, in order:

**1. Create `.octobots/onboarding.md`** — the persistent audit trail:
- Date, what was found (stack, stage, issues count, GDD presence)
- What was generated/modified (file list)
- Which roles were tuned and why
- Infrastructure changes made (roles.py, supervisor.py, telegram-bridge.py)
- Open items (blocked issues, missing addons, decisions pending)
- First recommended task with issue number

**2. Create GitHub issue** — "Onboarding [date]" with the same content as onboarding.md:
```bash
gh issue create --title "Onboarding [date]" --body "$(cat .octobots/onboarding.md)"
```
If `gh` is unavailable, warn and skip — don't fail the session.

**3. Notify team via taskbox** — one message per role, tailored to that role's work:

```bash
# Each message should use the role's persona name and describe their specific situation
python octobots/skills/taskbox/scripts/relay.py send --from scout --to project-manager \
  "You're Max, PM on [project]. [N] issues open, Phase [N] deadline [date]. \
First unblocked task: #[N]. Read .claude/memory/project-manager.md for your full briefing."

python octobots/skills/taskbox/scripts/relay.py send --from scout --to python-dev \
  "You're [Persona], [role description] on [project]. [Specific situation — e.g. 'No project files yet, issue #15 unblocks dev work.']. \
Read .claude/memory/python-dev.md for your full briefing."

# ... one message per active role
```

Not "Read AGENTS.md" — give them the key facts right in the message.

**4. Terminal close-out:**

```
Seeding complete. Ready to spawn: ./supervisor.sh

⭐ First step: Issue #[N] — [issue title]
   [One sentence on why nothing else can start until this is done.]
```

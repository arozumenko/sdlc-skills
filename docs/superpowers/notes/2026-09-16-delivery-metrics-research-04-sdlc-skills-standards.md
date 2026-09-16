# 04 — sdlc-skills repo standards a new skill / spec must follow

Research report for the "internal delivery performance tracker of the harness" spec
(cycle-time / cadence / estimated-vs-actual per campaign / mission / task / case;
an analogue of `bundles/test-automation/skills/tokenomics/`).

Repo: `/Users/Daniel_Sallai/dev/sdlc-skills`, branch `feat/security-testing-bundle-spec`,
HEAD `b1f70d2`. Everything below is what the repo *says or enforces* today; inferences are
flagged "(inference)".

---

## 0. Orientation — what this repo is, and drift to be aware of

- `CLAUDE.md:1-27` — "A content + distribution layer, not an application." No build step;
  the installer (`bin/init.mjs`) discovers content at runtime. Content lives in **factories**
  (`bundles/<id>/`), which physically own `agents/` and `skills/`. Top-level `agents/` and
  `skills/` hold only orphan content.
- `CLAUDE.md:110-116` ("What runs where"): "The agents/skills here are *installed into other
  projects* and run there against the consumer's working tree and `.agents/` context … When
  editing an agent or skill, you're editing a template a human will install elsewhere — not
  code that executes in this repo."
- **Doc drift (verified):** `CLAUDE.md:17-20`, `README.md:60-64`, `AGENTS.md:25-28` all say
  "eight orphan skills", but `ls skills/` shows **11** (`deep-research`, `gathering-context`,
  `knowledge-curation`, `memory`, `microsoft-365`, `obsidian-vault`, `tosca-automation`,
  `verifying-outcomes`, `visual-testing`, `vividus`, `xray-testing`). `skills.json` has 41
  entries: 11 `monorepo: sdlc-skills` + 30 `repo:` (CLAUDE.md:20 says 28 externals).
  `memory`, `knowledge-curation`, `visual-testing` are registered at `skills.json:247-263`.
  The security-testing spec's "Sources of truth" block (`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:20-30`)
  records exactly this kind of drift and the M-1 milestone fixes it — a new spec should do the same.
- `bundles/security-testing/` exists **without** `factory.json`/`FACTORY.md`/`README.md` yet
  (only `knowledge/` and `skills/{secure-code-review,security-evidence}`). `validate-factories.mjs:157-159`
  only iterates dirs that contain `factory.json`, so a skills-only bundle dir is invisible to the factory
  validator, but its `SKILL.md`s are still hit by CI `skills-ref` (`validate.yml:31`) and by
  `bin/frontmatter-strict.test.mjs:36-39`.

---

## 1. Where a new skill lives, how it is registered, dupes, and role attachment

### 1.1 Placement: factory-owned vs orphan top-level

| Option | Rule | Source |
|---|---|---|
| **Factory-owned skill** | `bundles/<factory-id>/skills/<name>/SKILL.md`; declare `<name>` in that factory's `factory.json` `localSkills`. **No `skills.json` entry.** | `README.md:506-508`; `bundles/SPEC.md:71-85, 194`; validator `validate-factories.mjs:231-237` (requires `skills/<ls>/SKILL.md`, rejects symlinks) |
| **Orphan top-level skill** | `skills/<name>/SKILL.md`; register in `skills.json` as `{"id": "<name>", "monorepo": "sdlc-skills", "name": "<name>", "description": "…"}`. Standalone-only; "not belonging to any factory". | `README.md:509-511`; `CLAUDE.md:14-20`; `skills.json:2` `_comment` |
| **External** | `{"id", "repo": "owner/repo", "ref": "main", "subdir"}`; fetched at install. Not applicable to a repo-native tracker. | `README.md:512-514`; `validate-factories.mjs:17-40` (`--check-externals`) |

Registry shape (`skills.json`): top-level `{"_comment", "monorepo": {"id","repo","ref"}, "skills": [...]}`;
entry keys observed across all 41 entries: `id`, `name`, `description`, `monorepo` | `repo`, `ref`, `subdir`
(verified by parsing the file). The `description` in `skills.json` is what non-Claude targets get in the
`SKILLS-INJECTED` block for orphan/external skills (`README.md:204-215`); for `localSkills` the description
is read from `SKILL.md` instead (`bundles/SPEC.md:205-208`).

`tokenomics` (the analogue) is factory-owned: `bundles/test-automation/factory.json:15-31`
`localSkills: [ …, "tokenomics" ]`; no `skills.json` entry; referenced by
`bundles/test-automation/agents/scout/AGENT.md:11` `skills-on-demand: [automation-scoping, efficiency-audit, tokenomics, session-retrospective]`.

**Standalone resolution order** (`bin/lib/item-resolver.mjs:57-80` `resolveItem`): a `--skills <id>` /
`--agents <name>` request resolves the top-level orphan first, else the alphabetical-first factory owning the
id; `ambiguousAcross` triggers a one-line notice when >1 factory owns it. Qualified form `--skills <factory>/<id>`
pins a factory copy (`CLAUDE.md:57-63`; `bundles/SPEC.md:87-91`). `--factory` takes no qualifier.

Important for a "harness-wide" tracker: `bundles/SPEC.md:76-80` — "The same agent or skill id may appear in
several factories with different content; divergence across factories is allowed and expected … There is
**no sync and no cross-factory equality requirement**." `check-skill-dupes.mjs:6-9` records the cost of that
rule: "the `memory` skill lived in two factories and quietly diverged" (which is why `memory` is now a
top-level orphan skill).

### 1.2 How a skill gets installed / attached to roles

Four mechanisms, all in `bundles/SPEC.md`:

1. **Agent frontmatter** — `skills:` (installs **and** enters standing context: Claude preload, non-Claude
   injected inventory, Codex TOML) vs `skills-on-demand:` (installed on disk, **nothing more**; the agent
   body's prose names it at the moment it applies and loads it then). `CLAUDE.md:118-130`;
   `bundles/SPEC.md:18`; `bin/init.mjs:1488-1560` (`parseAgentSkillSplit`), pinned by
   `bin/skills-on-demand.test.mjs:33-54`. Inline list form `skills: [a, b]` and block form both parse
   (`skills-on-demand.test.mjs:56-60`).
2. **`factory.json` `skills[]`** — "team-wide extra skills beyond what agents pull (global catalog OR this
   factory's localSkills — use for a factory-local skill that should install without being in any agent's
   roster, loaded on demand)". `bundles/SPEC.md:183`; validator `validate-factories.mjs:279-280`.
   Example: `test-automation/factory.json:11-14` `"skills": ["knowledge-curation","memory"]`.
3. **`skillOverlays`** (capability overlay) — `"skillOverlays": { "<role>": { "add": [...], "remove": [...] } }`
   rewrites the *installed* agent's frontmatter to `(declared − remove) + add`. `remove` drops from both
   `skills:` and `skills-on-demand:`; `add` lands on `skills-on-demand:` when the agent has that line
   (never silently grows the Claude preload), else on `skills:`. `add`s that don't resolve are reported as
   "pending content" (`validate-factories.mjs:308-314` warns, does not fail). `bundles/SPEC.md:36-47, 187-189, 218-227`.
   Overlay roles must be in `agents[]`/`localAgents[]` (`validate-factories.mjs:309-310`). The
   feature-development factory additionally has per-`devRoles`/`platforms` overlays
   (`bundles/feature-development/factory.json` keys `coreAgents`, `devRoles`, `platforms`; `bundles/SPEC.md:49-69`).
4. **`briefings`** (behavior overlay) — `"briefings": { "<role>": "briefings/<role>.md" }` seeded to
   `.agents/memory/<role>/project_briefing.md` + a `MEMORY.md` index line; skipped if present unless
   `--update`. `bundles/SPEC.md:209-212`; `MAINTENANCE.md:60-62`. Briefing role must be in the roster
   (`validate-factories.mjs:218-222`).

Also: `seed` (`"seed": { "<factory-rel-src>": "<project-rel-dest>" }`, `bundles/SPEC.md:213-217`, validator
`:305-306`) and `instructions` (spliced into `AGENTS.md`/`CLAUDE.md` inside
`<!-- FACTORY:<id> START -->`/`<!-- FACTORY:<id> END -->`, idempotent; `bundles/SPEC.md:228-237`).

### 1.3 Duplication rule (`bin/check-skill-dupes.mjs`)

- Purpose (`:2-11`): "Fail when a file that is intentionally duplicated across skills drifts … Add a pair
  here whenever you duplicate an asset on purpose."
- Shape (`:20-66`): `const GROUPS = [ [canonical, ...copies], … ]` — repo-relative paths; sha256
  byte-compare (`:68, :84`). Failure message tells you `cp <canonical> <copy>` (`:85-86`).
- Current groups: `skills/knowledge-curation/scripts/vault.py` ↔ `skills/memory/scripts/vault.py`;
  the `memory-curated.base` template; security-testing `knowledge/*` ↔ `security-evidence/templates/knowledge/*`
  (TASK-007 rationale: standalone `--skills` install has no seed); security-testing ingest **fixtures** that
  are verbatim copies of manual-qa `knowledge/examples/*.md` and test-automation
  `references/examples/report.json` (plan guardrail G-12: "a format change upstream fails here instead of
  silently breaking the adapter in a consumer's repo").
- Wired as `npm run validate:dupes` (`package.json:20`), part of `npm run validate` (`package.json:18`).
  **Not** run by CI (`validate.yml` has jobs `factories`, `skills`, `externals` only).

Implication: if the tracker copies fixture files from the bundles whose work-item formats it parses
(e.g. a `report.json`, a `RUN-*.md`), it must add `[source, copy]` pairs to `GROUPS`. If the same tracker
skill is shipped into more than one factory, there is no rule forcing equality — but the dupes check is the
repo's chosen mechanism when equality *is* intended.

### 1.4 SKILL.md frontmatter — what is enforced

Enforced by CI `skills-ref validate` (`validate.yml:16-35`, loops `skills/*/ bundles/*/skills/*/`) and the
repo tests:

| Rule | Enforcer |
|---|---|
| Required keys `name`, `description`; allowed keys **only** `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`; any other top-level key → "Unexpected fields in frontmatter" | agentskills `skills-ref` validator (fetched: `skills-ref/src/skills_ref/validator.py`) |
| `name` ≤ 64 chars, lowercase, letters/digits/hyphens, no leading/trailing/double hyphen, **must equal the directory name** | same |
| `description` non-empty string ≤ 1024 chars | same (repo max today: 954 chars, `prioritize-bets`) |
| `compatibility` string ≤ 500 chars | same |
| `license`, `allowed-tools`, `metadata` unvalidated | same |
| Because unknown top-level keys are forbidden, `discoverable: false` / `user-invocable: false` go under `metadata:` | `bin/gen-marketplaces.mjs:88-107, 116-125` (`parseMetaField`, `discoverableField`); examples `bundles/manual-qa/skills/*-audit/SKILL.md:5-7` |
| Strict-YAML: an unquoted plain scalar must not contain `": "`; a quoted scalar must close on the same line (Copilot CLI incident 2026-08-06) | `bin/frontmatter-strict.test.mjs:1-11, 43-73`; scans every `SKILL.md`/`AGENT.md` in `skills/`, `agents/`, `bundles/*/{skills,agents}/` (`:20-41`); asserts ≥ 50 files (`:77`) |
| `name:` read only from the leading `---` block; empty → null | `bin/lib/skill-md.mjs:15-41` |

House style (observed, not enforced): `license: Apache-2.0` (most) or `MIT` (security-testing);
`compatibility:` quoted when it contains `: `; `metadata: { authors: ["Name <email>"], version: "0.1.0" }`
— e.g. `bundles/test-automation/skills/tokenomics/SKILL.md:1-10`, `bundles/security-testing/skills/secure-code-review/SKILL.md:1-10`.
`description` is written as trigger phrases ("Use when the user …") followed by what the skill does, and
explicitly names the neighbouring skill to use instead (tokenomics ↔ efficiency-audit, `SKILL.md:3`).

### 1.5 AGENT.md frontmatter — what is enforced / expected

- `CLAUDE.md:118-130`: agents are self-describing; keys `name`, `description`, `model`, `color`, `group`,
  `theme`, `aliases`, `skills`, `skills-on-demand`, optional `mcpServers`, optional `context-docs`/`context-memory`.
- `bin/no-tools-frontmatter.test.mjs:24-29`: **no `tools:` key** in any `AGENT.md` anywhere in the tree.
- `context-docs:` / `context-memory:` (space-separated; `none` = nothing; subpaths resolve against `.agents/`)
  feed the installer-generated `hooks/config-defaults.sh` roster (`hooks/README.md:49-62`; `bin/init.mjs:763-780`).
- Example of a fully-formed one: `bundles/test-automation/agents/test-automation-lead/AGENT.md` frontmatter
  (`name`, quoted `description`, `model: sonnet`, `color`, `group`, `theme: {color, icon, short_name}`,
  `aliases`, `skills`, `skills-on-demand`, `metadata.authors`).

---

## 2. Hook conventions

### 2.1 Three tiers of hooks in this repo

| Tier | Where | Installed by | Tag / ownership | Targets |
|---|---|---|---|---|
| **Core context hooks** | `hooks/` (`session-start`, `agent-start`, `lib.sh`, `run-hook.cmd`, `config.sh.example`) | `installCoreHooks()` on **every** install (`bin/init.mjs:989`; `hooks/README.md:132-151`) | `_factory: "sdlc-core"` in `.claude/settings.json` (`hooks/README.md:136`; `init.mjs:1012, 1089`) | Claude (`.claude/settings.json`), Cursor (`.cursor/hooks.json`, sessionStart only), Copilot (`.github/hooks/sdlc-skills.json`), Codex (`.codex/hooks.json`); Windsurf skipped |
| **Factory hooks** | `bundles/<id>/hooks/hooks.json` + `hooks/scripts/` | `installHooks(factory, targets)` (`bin/init.mjs:597-638`) when `factory.json` has `"hooks": "hooks/hooks.json"` and `targets` ∋ `claude` | each matcher-group tagged `_factory: "<id>"` (pre-rename `_bundle` still recognised) — `mergeClaudeSettingsHooks` `init.mjs:640-670`; backs up `settings.json.bak` | **Claude-only in v1** — others "skipped with a notice" (`bundles/SPEC.md:243-247`; `init.mjs:612-615`) |
| **Skill-shipped, opt-in hooks** (the tokenomics pattern) | `bundles/test-automation/skills/tokenomics/hooks/*.mjs` + `scripts/install-hooks.mjs` | the **user** runs `node .claude/skills/tokenomics/scripts/install-hooks.mjs` after install; "Installing this skill does NOT start capturing. Telemetry activates only when someone runs the install script" (`SKILL.md:28-29`) | `_tokenomics: true` marker on each spliced group (`install-hooks.mjs:34, 74-77`); `--remove` strips exactly those; idempotent | Claude `.claude/settings.json` (or `--local` → `settings.local.json`), Copilot `.github/hooks/tokenomics.json` (`installCopilot`, `:120-140`), optional VS Code `folderOpen` task, optional git post-commit (`--git-hook`), `--otel` |

### 2.2 `hooks.json` shape (Claude)

Standard Claude hooks object, event name → array of matcher-groups; each group `{ "matcher": "...", "hooks": [ { "type": "command", "command": "...", "async": bool, "timeout": s } ] }`:

- Core: `hooks/hooks.json` — `SessionStart` matcher `startup|clear|compact|resume`; `SubagentStart` matcher `*`;
  commands use `"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start` (plugin path) — the npx install
  rewrites to `${CLAUDE_PROJECT_DIR}` (`hooks/README.md:132-137`).
- Factory: `bundles/test-automation/hooks/hooks.json` — `SubagentStop`, matcher
  `test-automation-engineer|test-automation-lead|test-runner`, command
  `"${CLAUDE_PROJECT_DIR}/.claude/hooks/test-automation/run-hook.cmd" workflow-return`, `"async": true`.
  Note the factory hooks.json is the **bare** event map (no outer `"hooks":` wrapper), whereas the core
  `hooks/hooks.json` wraps in `{"hooks": {...}}` (plugin format).
- Factory scripts land in `<target>/hooks/<factory-id>/` and are `chmod +x` (`init.mjs:618-628`;
  `bundles/SPEC.md:264-266`). Reference them as `$CLAUDE_PROJECT_DIR/<target-dir>/hooks/<factory-id>/<script>`.
- manual-qa's `bundles/manual-qa/hooks/hooks.json` shows the fuller event set in use: `SessionStart` (`*`),
  `PreToolUse`/`PostToolUse` matcher `Agent`, `SessionEnd` — all `async: true`, all via `run-hook.cmd`.

Per-host templates for the core hooks: `hooks/hooks-codex.json`, `hooks-cursor.json`, `hooks-copilot.json`,
`hooks-kiro.json` ("reference templates. The `npx … init` CLI generates the live per-target configs from these",
`hooks/README.md:64-69`). Platform detection is env-var based: `SDLC_HOOK_RAW=1` (Kiro), `CURSOR_HOOK=1`,
`CODEX_HOOK=1`, `CLAUDE_PROJECT_DIR`/`CLAUDE_PLUGIN_ROOT`, `COPILOT_CLI=1` (`hooks/README.md:88-101`).
Portability matrix at `hooks/README.md:73-86` (Cursor `subagentStart` is permission-only; Kiro's `agentSpawn`
carries no agent name).

### 2.3 Behavioural rules hooks must obey (written down in the repo)

- **Roster-guard shared-event hooks** (`bundles/SPEC.md:290-296`): a hook on a generic event
  (`SubagentStop`, `PreToolUse` on `Agent`, session start/end) "runs in EVERY factory's sessions. Such a hook
  must check that the dispatched agent belongs to its own factory's roster and exit silently otherwise
  (fail-open on a missing `subagent_type` for older hosts)." Field incident: manual-qa benchmark hooks
  seeded state in test-automation sessions. Sibling-stale detection is signal-only
  (`bin/sibling-hooks.test.mjs:1-7`; `init.mjs:673-680` `checkSiblingBundleHooks`).
- **The three rules** (`bundles/test-automation/hooks/README.md:53-61`): "1. Never writes to stdout …
  2. Never exits non-zero, never throws … all silent exit 0 … 3. Never touches a non-workflow dispatch."
- Tokenomics adds: the only sync hook is the one whose single stdout line must reach context
  (`install-hooks.mjs:82-87` "sync on purpose"); everything else `async: true` with explicit `timeout`.
- Hook test files are kept **out of** `scripts/` "so it is not copied into consumer projects"
  (`bundles/test-automation/hooks/README.md:84-85`: `workflow-return.test.mjs` sits in `hooks/`, not
  `hooks/scripts/`). (Tokenomics, by contrast, keeps `*.test.mjs` next to its scripts inside the skill and
  they *are* copied on install — `bin/init.mjs` has no `*.test.mjs` exclusion (grep verified).)
- **Consumer-repo namespaces** (`bundles/SPEC.md:283-290`): each factory owns `.agents/<its-id-or-domain>/`
  for working state (test-automation → `.agents/automation/`, manual-qa → `.agents/manual-qa/`,
  feature-development → `.agents/feature-development/`). "`.agents/` root holds only genuinely shared things …
  Product artifacts (specs, tests, source) belong in the repo tree, never under `.agents/`."
- **One shared telemetry submodule** (`bundles/SPEC.md:297-303`): "Durable telemetry lives in
  `.agents/telemetry` — a self-referential submodule on the repo's own `telemetry` branch, **one subfolder per
  factory** (test-automation writes `automation/`). A factory adopting durable telemetry later adds its own
  subfolder and rides the same branch and sync machinery — never a second submodule or a second branch."
  Mechanics: `tokenomics/SKILL.md` § "Where records live" (`.gitmodules` url `./`, `ignore = all`,
  `install-hooks.mjs --pull`, `TOKENOMICS_NO_SYNC=1`), managed `.gitignore` block between
  `# >>> tokenomics (managed)` / `# <<< tokenomics`, "**Never gitignore `.agents/telemetry`**".
- `MAINTENANCE.md:64-67`: on `--update`, "the factory's `_factory`-tagged entries in `.claude/settings.json`
  are replaced; your own hooks are untouched. `settings.json` is backed up to `settings.json.bak` first."

### 2.4 What must NOT be reintroduced

`CLAUDE.md:131-133`: "This is **single host-native mode** — there is no dual-mode/octobots framing, no
markers/taskbox/relay. Don't reintroduce it." (The word "markers" in `bundles/SPEC.md:229` refers to the
`<!-- FACTORY:<id> -->` splice markers, which are fine.) The hooks are the *only* cross-session context
channel; `@import` is not used in agent files (`hooks/README.md:3-9`). Big manuals are deliberately not
injected — agents read on demand (`CLAUDE.md:83-85`; `hooks/README.md:16-18`).

---

## 3. Script conventions

- **ESM `.mjs`, stdlib only, no dependencies** — `CLAUDE.md:133-135` ("Keep it that way; bundled skill CLIs
  (e.g. `tosca_cli.py`) are the skill's own concern"); `package.json` `"type": "module"`, `"engines": {"node": ">=18"}`,
  no `dependencies` key at all. Skill scripts follow suit: `install-hooks.mjs:27` "STDLIB ONLY.";
  `check-skill-dupes.mjs:13-16` uses `node:fs`, `node:crypto`, `node:url`, `node:path`; security spec D8
  "Stdlib ESM Node; `spawn(argv, {shell:false})`; no shell scripts."
- **Optional tools via `npx`, never a dependency**: ccusage (`tokenomics/SKILL.md` "best-effort via npx";
  `TOKENOMICS_NO_CCUSAGE=1`), reg-cli (`visual-testing` spec: "invoked local-or-`npx -y reg-cli` … no new
  `package.json` dependency"). Failure → honest `null`, "never a price-table estimate"
  (`tokenomics/SKILL.md` ledger table, `costUsd`/`costSource`).
- **Tests**: `npm test` = `node --test` (`package.json:14`), which picks up `*.test.mjs` **anywhere in the
  tree** (`CLAUDE.md:29`), including inside skills (`tokenomics/scripts/*.test.mjs`, `hooks/*.test.mjs`,
  `bundles/test-automation/hooks/workflow-return.test.mjs`). Style: `import { test } from 'node:test'`,
  `import assert from 'node:assert/strict'`, temp dirs via `mkdtempSync(join(tmpdir(), '<prefix>-'))`
  with `rmSync` cleanup, fixtures built inline or under `scripts/fixtures/` (security-evidence), pure
  functions exported from the script and imported by the test (`team-report.test.mjs:7-10`;
  `sibling-hooks.test.mjs:13`). Repo-wide guard tests in `bin/*.test.mjs` assert against the *whole tree*
  (`frontmatter-strict`, `no-tools-frontmatter`, `agent-skill-deps`).
- **Offline by default**: `npm run validate` is offline except `validate:externals`
  (`validate-factories.mjs:23-25`); the security spec §12 requires E2E tests to use a local bare-repo cache
  via `SDLC_SKILLS_CACHE_DIR` and a `GIT_CONFIG_GLOBAL` rewrite so "no `https://` fetch" occurs.
- **Self-locating scripts**: `skillRootOf(import.meta.url)` (`install-hooks.mjs:38-40`) so the script works
  under `.claude/skills/<name>/`, `.github/skills/<name>/`, etc.; SKILL.md quick-starts spell both
  install paths (`tokenomics/SKILL.md:42-43`).
- **Idempotent writers with owned markers**: `_tokenomics` on hook groups, `# tokenomics-sweep` in git
  hooks, `# >>> tokenomics (managed)` in `.gitignore`, `<!-- FACTORY:<id> -->` in root docs — every writer
  can re-run and `--remove`.
- **Exit-code table convention** (security-testing, `plans/…tasks-v2.md:9`): `0` ok, `1` internal error,
  `2` usage/EDIT-AND-RERUN, `3` INDETERMINATE-class refusal, `4` verification failure, `5` integrity
  mismatch. Not repo-global, but the newest precedent.
- Shell launchers, where they exist, are thin: `run-hook.cmd` polyglot + an extensionless bash shim that
  execs the `.mjs` (`bundles/test-automation/hooks/scripts/workflow-return`, `hooks/README.md:26-29`).
- Do not hand-edit generated marketplaces (`.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/`) — run
  `npm run gen:marketplaces`; `.claude-plugin/marketplace.json` **is** hand-curated (`CLAUDE.md:90-99`;
  `gen-marketplaces.mjs:14`; android plan Global Constraint 6).

---

## 4. Spec document conventions in this repo

### 4.1 Where specs live and how they are tracked

- Path: `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`; sibling dirs `docs/superpowers/notes/`
  (research + adversarial reviews) and `docs/superpowers/plans/` (stories, task decompositions).
- `.gitignore:33-34` lists `docs/superpowers/` as "Local-only brainstorming/spec/plan scaffolding (not
  distributed)", **but** the security-testing spec, plans and notes are force-tracked (`git ls-files
  docs/superpowers` shows them; commits `901b51d`, `02b670e`, `e8ebe82`). The android plan's Global
  Constraint 8 ("Do not commit anything under `docs/superpowers/`") is therefore the older convention;
  current practice on this branch is to commit them. (inference: follow current branch practice — commit.)

### 4.2 Structure of the reference spec (`2026-09-14-security-testing-bundle-design.md`, v6.2, 675 lines)

Header block (`:1-30`): `# <bundle> — design spec (vN.N)`, then bold metadata lines **Date** (with prior
version SHAs), **Bundle/Skill** (path, "(new)"), **Branch**, **Status** (review verdict counts), **Inputs**
(links to research notes and every adversarial review), then a **"Sources of truth for repo claims"**
paragraph citing exact files/constants (`item-resolver.mjs` `FACTORIES_DIR = "bundles"`, validator rules,
`hooks/lib.sh` defaults, `package.json` validate chain) and naming known doc drift.

Numbered sections:

| § | Title | What it holds |
|---|---|---|
| 1 | Purpose | 1 paragraph; what it is, posture (read-only), what it produces vs is not |
| 2 | What the bundle can and cannot promise | two-column table **Can promise (script, on canonical-pipeline outputs)** / **Cannot promise**; the locked contract every later section is checked against |
| 3 | Decisions (locked) | table `# | Decision`, ids **D1…D18**, one line each, cross-refs `(§6.6)` |
| 4 | Roster (`localAgents`) | table `Agent | Model | Role | skills: | skills-on-demand:` + AGENT.md body rules |
| 5 | Skills | table `id | Content | v` — lists scripts/schemas per skill, plus "v2 named" parking row |
| 6 | Contracts | 6.1…6.10 sub-sections: envelopes/identities, scope, commands (`build-report`, `check`), state tables (`Prior state | Receipt | Derived`), evaluation precedence lists, adapters table, fallback matrix, register, artifact policy, dispositions |
| 7 | Entry points and dependencies | table `Ask | Command(s) | Needs installed` — which skills must be on disk per command |
| 8 | Guarantees and Not guaranteed | maps §2 to README wording; explicit qualification text |
| 9 | Hand-offs | per neighbouring bundle (manual-qa, test-automation, feature-development, tracker) with exact paths, formats, and paste-able prompts |
| 10 | Files and manifests | final `factory.json` `description`, `FACTORY.md` `use_cases`, `localAgents`/`localSkills`, script file list "each with `*.test.mjs`" |
| 11 | Report structure | what the rendered report shows; "`unknown / not assessed` allowed, blank forbidden" |
| 12 | Tests | deterministic `npm test` list (fixtures named), installed E2E paths, model evals |
| 13 | Plan | table `# | Milestone | Capability` — **M-1** (doc fixes), **M1…M5** |
| 14 | Open questions | bullets/short list |
| 15 | Consistency check against §2 | "Each §2 left-column row names its script in §6/§7; each right-column row appears in §8. Any later sentence that exceeds §2 is a defect." |
| 16 | Repo facts relied on that the reviewer should re-verify | short list |
| 17–19 | `vN findings → vN+1` | tables `F | Resolution | Where` with **resolved / resolved by contract / resolved by narrowing / removed** verdicts |
| 20 | Planning amendments | table `# | Amendment | Where`, ids **P1…P6**; opening line "None changes §2 or §3." |

Naming conventions inside: decisions `D<n>`; review findings `F<n>` (v3), `R<n>` (v4), `N<n>`/`M<n>` (v5);
amendments `P<n>`; milestones `M-1, M1…M5`; downstream stories `US-NNN`, tasks `TASK-NNN`, spikes
`SPIKE-NNN`, tech-lead readings `TL-n`, dependency groups `G0…Gn` (plans doc). Exact command names, exit
codes, result tokens (`CONSISTENT | INCONSISTENT(<field>)`), file paths and schema names are quoted in
backticks and reused verbatim by stories/tasks (`plans/…stories.md:9-13`).

### 4.3 Other specs (skimmed) — lighter shape for a single skill

- `2026-08-16-visual-testing-skill-design.md` (71 lines): header (**Date / Skill path / Owner agent +
  `skills-on-demand` / Branch**), `## Purpose`, `## Decisions (locked)`, `## Workflow (SKILL.md)`,
  deterministic naming rules, `## Files`, tool interface, `## Testable seams (Node --test, stdlib, NO
  network)`, `## Plan (bite-sized)`, `## Out of scope`.
- `2026-08-17-design-story-presentation-uplift.md`: `## Scope (user-approved <date>)`, `## Shared data`,
  `## Architecture`, `## Feature detail` (lettered A–E), `## Verification (stdlib node --test + build smoke)`,
  `## Plan (bite-sized, subagent-driven)`, `## Out of scope`.
- `2026-08-05-android-dev-persona-design.md`: `## 1. Decision`, `## 2. Settled decisions`, `## 3. Review
  record` (Accepted / Rejected), persona sections, `## 9. Acceptance criteria` (**AC-1 … AC-13**, each a
  bold one-line title + a checkable statement, e.g. AC-2 "`npm test && npm run validate` pass … `AGENT.md`
  carries no `tools:` key"), `## 10. Parking lot`.
- `2026-08-05-android-dev-implementation-plan.md`: `## Global Constraints` (numbered, "A violation is a
  review defect regardless of what an individual task says"), `## Verified facts (do not re-derive, do not
  change)`, then `## Task N` with `### Verification` blocks.

### 4.4 Section outline template a new spec should mirror

```
# <name> — design spec (v1)
**Date:** … **Skill/Bundle:** `bundles/<id>/skills/<name>` (new) **Branch:** … **Status:** …
**Inputs:** research notes (04-…), reviews …
**Sources of truth for repo claims.** <file:line facts; known doc drift>

## 1. Purpose
## 2. What the skill can and cannot promise          (two-column table; the locked contract)
## 3. Decisions (locked)                             (D1…Dn table)
## 4. Roles / placement                              (which factory(ies), localSkills, skills: vs skills-on-demand:, overlays, briefings, seed, instructions)
## 5. Skill contents                                 (scripts / schemas / templates / references, each with *.test.mjs)
## 6. Contracts                                      (6.1 work-item identity & envelope; 6.2 event/record schemas; 6.3 derivation table "Displayed | Recomputed from"; 6.4 state tables; 6.5 storage layout + telemetry-submodule subfolder + managed .gitignore block; 6.6 ingest adapters per source format; 6.7 hooks (events, matchers, async/sync, roster guard, three rules); 6.8 CLI surface + exit codes)
## 7. Entry points and dependencies                  (Ask | Command | Needs installed)
## 8. Guarantees and Not guaranteed                  (README wording; "for canonical-pipeline outputs")
## 9. Hand-offs / coexistence                        (per neighbouring factory; consumer-repo namespaces; what a PM sees)
## 10. Files and manifests                           (factory.json / FACTORY.md / skills.json deltas; check-skill-dupes GROUPS additions; marketplace regen)
## 11. Report structure                              (what the PM report shows; "unknown allowed, blank forbidden")
## 12. Tests                                         (deterministic list + fixtures; installed E2E offline)
## 13. Plan                                          (M-1 docs, M1…Mn)
## 14. Open questions
## 15. Consistency check against §2
## 16. Repo facts to re-verify
## 17+. vN findings → vN+1 / Planning amendments P-n   (added per review round)
## Acceptance criteria                               (AC-n; or fold into §12/§13 as the android spec does)
## What this is not / Out of scope / Parking lot
```

---

## 5. Validate / CI gates the new content must pass

| Gate | Command | What it checks | Runs in CI? |
|---|---|---|---|
| Unit + guard tests | `npm test` (`node --test`, `package.json:14`) | every `*.test.mjs` in the tree; incl. `frontmatter-strict`, `no-tools-frontmatter`, `agent-skill-deps`, `skills-on-demand`, `sibling-hooks`, `gen-marketplaces.test`, `validate-factories.test`, `hook-role-defaults`, `hooks/agent-start.test.mjs` | **No** (`validate.yml` has no test job) — run locally |
| Factory manifests | `npm run validate:factories` → `bin/validate-factories.mjs` | dir name = `id`; `README.md`; `FACTORY.md` frontmatter (`name`,`description`,`owner`,`authors`,`sdlc_phase` scalar; `support_level` enum; risky unquoted values) `:98-121, 183-199`; `agents[]` non-empty or `localAgents`; briefing/overlay roles in roster; `localSkills` each have `SKILL.md`, not symlinks; `skills[]` resolve; `instructions`/`hooks`/`seed` paths exist; hooks JSON parses `:285-295` | Yes (`validate.yml:9-17`, Node 20) |
| Skills spec | `skills-ref validate <dir>` over `skills/*/` and `bundles/*/skills/*/` | agentskills.io frontmatter rules (§1.4 above) | Yes (`validate.yml:19-35`, Python 3.11) |
| Externals | `npm run validate:externals` | upstream `SKILL.md` exists and `name:` == registry `id` (network) | Yes (`validate.yml:37-49`, 5-min cap) |
| Marketplaces | `npm run validate:marketplaces` → `gen-marketplaces.mjs --check` | generated `.cursor-plugin/marketplace.json`, `.codex-plugin/marketplace.json`, `.github/plugin/marketplace.json` not stale; a new dir-backed skill appears automatically (`gen-marketplaces.mjs:176-192`) unless `metadata.discoverable: false` | **No** (android AC-2 notes "which CI does *not* run — check by hand") |
| Dupes | `npm run validate:dupes` → `check-skill-dupes.mjs` | every `GROUPS` copy byte-equals its canonical | **No** |
| Aggregate | `npm run validate` = factories && marketplaces && externals && dupes (`package.json:18`) | "run before committing" (`CLAUDE.md:30`) | partial |
| Regeneration | `npm run gen:marketplaces` | rewrite the three generated manifests; commit the result | — |
| Hand-curated | `.claude-plugin/marketplace.json` | edited by hand if the skill should be individually installable via the Claude plugin marketplace (tokenomics is **not** listed there today; it is in the generated ones at `.cursor-plugin/marketplace.json:381` etc.) | — |

Install smoke (used as acceptance in prior specs): `node bin/init.mjs init --factory <id> --target claude --yes`
in a throwaway dir (`CLAUDE.md:37`); repeat `--target copilot` (`SKILLS-INJECTED` block present, `--update`
replaces not duplicates) and `--target codex` (android AC-1).

---

## 6. Implications for the delivery-tracker spec — checklist

Placement & registration
- [ ] Decide factory-owned vs orphan. Precedent for telemetry is factory-owned (`tokenomics` in
  `test-automation/localSkills`). A tracker that must cover **every** factory's work items has two
  repo-sanctioned routes: (a) an orphan top-level skill registered in `skills.json` (installs standalone;
  installable by any factory via `factory.json` `skills[]`, exactly as `memory`/`knowledge-curation` are today
  in both `test-automation/factory.json:11-14` and `feature-development/factory.json` `skills`), or (b) real
  copies in several factories with `check-skill-dupes.mjs` GROUPS pinning equality. The spec must pick one
  and say why (§3 decision). (inference: (a) matches the `memory` lesson at `check-skill-dupes.mjs:6-9`.)
- [ ] `SKILL.md` frontmatter: only `name`, `description` (≤1024 chars, trigger-phrase style, names
  `tokenomics`/`efficiency-audit` as the neighbours to use instead), `license`, `compatibility` (≤500,
  quoted if it contains `: `), `metadata.authors` (`"Name <email>"`), `metadata.version`; `name` == dir name.
  Any opt-out (`discoverable`, `user-invocable`) under `metadata:`.
- [ ] Attach to roles via `skills-on-demand:` on the relevant agents (PM-facing: `project-manager`,
  `test-automation-lead`, `scout` for the opt-in question) or via `factory.json` `skills[]`; never grow a
  Claude preload silently (`bundles/SPEC.md:220-222`). If a factory should tune it, use `skillOverlays`
  `add`/`remove` and `briefings/<role>.md`, not a forked agent.
- [ ] If it ships fixture copies of other bundles' formats (`report.json`, `RUN-*.md`, `TC-*.md`,
  `.agents/automation/<slug>/…`), add `[canonical, copy]` pairs to `check-skill-dupes.mjs` `GROUPS`.
- [ ] `skills.json` entry if orphan; `localSkills` entry if factory-owned; `npm run gen:marketplaces` and
  commit; decide whether to add to hand-curated `.claude-plugin/marketplace.json`.
- [ ] Fix the "eight orphan skills / 28 externals" drift in `CLAUDE.md`/`README.md`/`AGENTS.md` in an
  **M-1 doc milestone** if the tracker adds a 12th orphan (the security spec's precedent).

Hooks & storage
- [ ] Opt-in activation via the skill's own `scripts/install-hooks.mjs` (tokenomics pattern): installing the
  skill never starts capture; markers (`_<skill>: true`) on every spliced group; `--remove`, `--local`,
  `--host claude|copilot`, `--doctor`, idempotent; self-locating via `import.meta.url`.
- [ ] Any hook on a shared event must roster-guard and fail open (`bundles/SPEC.md:290-296`), obey the
  three rules (no stdout unless the line is meant for context, exit 0 always, never touch foreign
  dispatches), be `async: true` with a `timeout` unless it *must* inject context.
- [ ] Durable records go in `.agents/telemetry/<subfolder>/` on the shared `telemetry` submodule/branch —
  never a second submodule or branch (`bundles/SPEC.md:297-303`); working state under the owning
  namespace `.agents/<factory-or-domain>/`; managed `.gitignore` block with owned begin/end markers;
  never gitignore `.agents/telemetry`.
- [ ] No cross-host "dual mode", markers/taskbox/relay, or `@import` (`CLAUDE.md:131-133`).
- [ ] Factory `hooks.json` (if used instead of / in addition to skill-installed hooks) is Claude-only v1,
  bare event map, tagged `_factory` by the installer, scripts under `hooks/scripts/` (tests outside).

Scripts & tests
- [ ] Stdlib ESM `.mjs`, Node ≥ 18, no dependencies; optional tooling via `npx` with honest `null` on
  failure; `spawn(...,{shell:false})` if it must spawn.
- [ ] Every script has a sibling `*.test.mjs` (`node --test`), temp-dir fixtures, offline; tests exported
  pure functions (`buildReport`, `renderMarkdown`, …) rather than end-to-end only.
- [ ] Estimates vs actuals: the repo's telemetry ethos is "all facts, no estimates … never a price-table
  estimate" and allocations must be "labelled as such" (`tokenomics/SKILL.md` ledger table and cost.json
  bullets). The spec must therefore separate **recorded estimate** (a declared input, e.g. sizing from
  `automation-scoping`) from **measured actual**, label derived/allocated figures, and use
  `unknown`/`null` rather than blanks (security spec §11).
- [ ] Define exit codes; reuse the security-testing table (`0/1/2/3/4/5`) unless there is a reason not to.

Spec document
- [ ] File at `docs/superpowers/specs/2026-09-16-<slug>-design.md`; commit it (current branch practice).
- [ ] Mirror §4.4 outline: §2 promise table, §3 D-n decisions, §7 entry-points table, §8 guarantees
  wording, §10 manifests, §12 tests naming fixtures, §13 M-1/M1… plan, §15 consistency check, §16
  repo facts to re-verify, AC-n acceptance criteria, explicit "what this is not"/parking lot; add
  `vN findings → vN+1` and `P-n` amendment tables per review round.
- [ ] Vocabulary: the repo has **campaign / wave / stage / batch / case** (`test-automation-workflow/references/campaign-planning.md:11-22`)
  and **epic / US-NNN / TASK-NNN / G-n groups** (plans docs); the word **"mission"** does not occur
  anywhere in the repo (grep verified). The spec must define its `campaign / mission / task / case`
  hierarchy explicitly and map it onto the existing terms (or state that it is harness-external).
- [ ] Acceptance criteria to include, by precedent: `npm test && npm run validate` green (incl.
  `validate:marketplaces` and `validate:dupes`, which CI does not run); install smoke on `claude`,
  `copilot`, `codex` targets; no `tools:` key; `skills-ref validate` on the new `SKILL.md`; hooks
  install/remove idempotent; nothing written outside the declared namespaces.

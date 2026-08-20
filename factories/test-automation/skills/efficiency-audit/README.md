# efficiency-audit

> Per-project / per-session / per-role / **per-sub-agent** cost & efficiency for AI coding-agent work — every dollar metered by ccusage.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); the deep derivation + evidence live in [`references/methodology.md`](references/methodology.md). This file is the front door: what it needs, and exactly how it works.

## When it triggers

Loads on _"what did this cost"_, _"cost per session/agent/project"_, _"which role/sub-agent spent the most"_, _"before vs after cost"_, _"is this change worth it"_, or _"break down / audit our AI spend"_.

## What it does

ccusage tells you what a **session** cost but bundles the orchestrator together with every sub-agent it dispatched. This skill meters **each sub-agent individually**, then joins each metered dollar to the **role / day / project** that spent it. Cost is 100% ccusage — no pricing table. Snapshots + diffs give before/after tracking.

## Requirements

- **Node 18+**.
- **`ccusage`** — auto-invoked via `npx ccusage@latest`, or install it locally / globally. Cost is Claude-host-native; Copilot/Codex/Gemini totals work only where ccusage supports them.
- Reads local transcripts under `$CLAUDE_CONFIG_DIR/projects` when set, else the first of `~/.claude/projects`, `~/.config/claude/projects` that exists.

---

## How it works (under the hood)

Six steps, with the exact files and fields at each one.

### 1. Where the data lives
Every Claude session is a JSONL transcript on disk, under
`~/.claude/projects/<encoded-cwd>/` — where `<encoded-cwd>` is your project's
absolute path with every separator and filename-awkward character (`/ \ : . _`
and space) turned into `-` (e.g. `/Users/me/dev/app` → `-Users-me-dev-app`,
`/Users/Ada_Lovelace/AI baseline` → `-Users-Ada-Lovelace-AI-baseline`). Inside
that folder:

```
<encoded-cwd>/
  <session-uuid>.jsonl              ← a top-level session (the orchestrator, or a plain session)
  <session-uuid>/
    subagents/
      agent-<hex>.jsonl             ← one transcript per dispatched sub-agent
      agent-<hex>.meta.json         ← sidecar: { "agentType": "...", "description": "..." }
    tool-results/                   ← hook stdout etc. (ignored — no transcripts)
```

(ccusage reads the same store, and also `~/.config/claude/projects`; `CLAUDE_CONFIG_DIR` overrides the location.)

### 2. Who each unit was — different field per kind
- **Top-level session (orchestrator/plain):** a record in the `.jsonl` of the
  form `{"type":"agent-setting","agentSetting":"test-automation-lead"}`. That
  `agentSetting` value **is** the role — it's written when the session was
  launched `claude --agent <role>`. No such record ⇒ an ad-hoc session ⇒ counted
  as `unattributed`.
- **Sub-agent:** the role is the **`agentType`** field in its `agent-<hex>.meta.json`
  sidecar. Discovery is keyed off these sidecars (so the Workflow tool's
  `journal.jsonl`, which has no sidecar, is correctly ignored).
- **Tokens** (for cache-hit / output-share metrics): each assistant line carries
  `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens`) and `message.model`; we total them, deduping by
  `message.id` and taking the max `output_tokens` (streaming repeats the same id
  with a growing count).
- **Activity metrics** (same records): **tool calls** = `tool_use` blocks,
  **errors** = `tool_result` with `is_error: true`; **skills loaded** = the
  `attributionSkill` field ∪ `Skill` tool calls (`input.skill`); **sub-agents
  dispatched** = `Agent` tool calls (named by `input.subagent_type` /
  `description`).

Nesting note: Claude Code stores **all** descendant sub-agents flat under the top
session's one `subagents/` folder — so an orchestrator run as a sub-agent, and
the sub-agents *it* spawns, are all captured (discovery is recursive regardless).

### 3. Real dollars from ccusage — the key mechanism
ccusage identifies a session by its **file name** and only globs the top of a
project folder, so sub-agents (hidden one level down in `subagents/`) are normally
invisible to it. We fix that by **rehoming ccusage onto a flattened copy**:

1. Make a temp dir laid out the way ccusage expects, and hard-link every
   transcript (top-level **and** all sub-agents) flat into one folder:
   ```
   /tmp/effaudit-XXXX/
     projects/
       <name>/
         <session-uuid>.jsonl        ← orchestrator (hard link)
         agent-<hex>.jsonl           ← each sub-agent, flattened up
   ```
   Hard links, not symlinks — **ccusage does not follow symlinks** (it needs a
   real directory entry); it falls back to a copy across filesystems.
2. Run ccusage pointed at that dir via the env var:
   ```
   CLAUDE_CONFIG_DIR=/tmp/effaudit-XXXX  npx ccusage@latest claude session --json --offline
   ```
   - `CLAUDE_CONFIG_DIR` **replaces** the default path, so ccusage sees **only**
     our flat folder — nothing else on the machine leaks in.
   - `claude session` (not plain `ccusage session`) reads **only** the Claude
     source — the plain command also pulls Codex/Gemini from their own stores.
   - `--offline` uses ccusage's cached pricing (no network).
3. ccusage returns one row **per file**: `sessionId` (= the file name),
   `totalCost`, `modelsUsed`, and `modelBreakdowns` (cost split per model). Each
   message is priced by its own `model`, so **mixed-model** units come out right
   (an orchestrator on Opus + Sonnet is billed at each rate; verified
   `$5.52 = sonnet $4.32 + opus $1.20`).

### 4. Stick the price to the name
ccusage's `sessionId` (the file name) matches our unit: the `<uuid>` row → the
orchestrator, each `agent-<hex>` row → that sub-agent. Now every unit has role +
model(s) + tokens + a **metered** dollar.

### 5. Add it up
Group and sum the units by **role**, **day**, **project**, and overall. The
per-file dollars sum back to ccusage's real session total **to the cent** (e.g. a
10-unit session → exactly `$30.96`). For before/after, save a snapshot and
subtract a later run.

### 6. Delete the temp folder.

**The one invariant:** we never compute a price — ccusage does every dollar; we
only decide *which file belongs to whom* and add the piles up. If per-file
metering isn't available, it falls back to ccusage's session total split by
cost-weighted tokens (labelled `ccusage-allocated`), so the headline dollars stay
ccusage's either way.

### 7. Divide by what shipped (`--resolved-from`)

The dollars are only half of "what did a case cost". The other half is already on
disk: the batch pipeline writes `.agents/automation/<slug>/report.json`, one row
per input case with the outcome it reached. `--resolved-from` reads those and
divides — so the denominator is measured, not typed in.

It reports **two** numbers, because there are two honest questions:

| | |
|---|---|
| **$ / spec delivered** | what a shipped test cost. Denominator: cases that reached `automated`. |
| **$ / case examined** | what putting a case through this pipeline costs. Denominator: every case that entered — a case that ended `out-of-scope` still consumed analysis. |

Three things it checks rather than assumes: a case that appears in two batches is
**one** case at its latest outcome (otherwise a retry makes the pipeline look
cheaper); run reports that closed **outside** the metered window did not get paid
for by this spend; and it measures how much of the window's spend sits on
branches these batches name — a floor, since analysts never touch git, and
therefore a dilution check rather than an attribution. If nothing matches, it
says the ratios aren't usable instead of printing them plain. That check needs
branches on both sides and stands down when either is missing, saying which.

**It reads a file, so it is not a workflow feature.** The batch workflow writes
`report.json` on Claude Code; a lead on a runner with no workflow writes the same
file by hand at close, rebuilding it from receipts + journal + git evidence
alone. The contract is `cases[]` with an `id` and an `outcome` per row — the rest
is optional and its absence is reported rather than assumed away. Works on
`--host copilot` the same way.

---

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install efficiency-audit@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills efficiency-audit
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/efficiency-audit .claude/skills/efficiency-audit   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Quick start

```bash
# from a project root — meter + roll up this project's agent spend by role
node .claude/skills/efficiency-audit/scripts/usage-rollup.mjs

# one session's sub-agent breakdown (JSON, then filter the ledger)
node .../usage-rollup.mjs --json | jq '.rollup.ledger'

# before/after: snapshot a window, diff a later one
node .../usage-rollup.mjs --since 2026-06-01 --until 2026-06-07 --resolved 12 --snapshot base.json
node .../usage-rollup.mjs --since 2026-06-08 --until 2026-06-14 --resolved 18 --diff base.json
```

See [`SKILL.md`](SKILL.md) for all flags and the scope-first workflow.

## Contents

- `SKILL.md` — the workflow, scope-first checklist, options, snapshots, caveats.
- `scripts/usage-rollup.mjs` — the engine (stdlib-only + ccusage).
- `scripts/usage-rollup.test.mjs` — unit tests (`node --test`).
- `references/methodology.md` — metering method, ccusage grain, model-awareness, evidence.

## Test

```bash
node --test skills/efficiency-audit/scripts/usage-rollup.test.mjs
```

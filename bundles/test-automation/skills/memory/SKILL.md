---
name: memory
description: Per-role persistent memory — durable facts, preferences, decisions, and a daily log, as plain markdown. Use when the user says "remember this" or "log this", asks "what did you learn yesterday", or whenever you discover something worth keeping across sessions.
license: Apache-2.0
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.3.0"
---

# Memory

Persistent per-role memory as plain markdown. You — the agent — read and
write these files directly using your `Read`, `Write`, `Edit`, and `Glob`
tools. No CLI, no script, no shell-path fragility. Works on any host, from
any working directory.

## File layout

Under `.agents/memory/<role>/` (where `<role>` matches your agent's
`name:` frontmatter — e.g. `project-manager`, `python-dev`, `scout`):

```
.agents/memory/<role>/
├── MEMORY.md                ← curated index, one line per entry
├── <slug>.md                ← individual curated entries (frontmatter + body)
├── project_briefing.md      ← seeded by scout at install time (type: project)
├── daily/
│   └── YYYY-MM-DD.md        ← episodic daily logs, append-only
└── snapshot.md              ← host-generated convenience (often absent)
```

Create directories with `mkdir -p` on first use. Do not write
`snapshot.md` yourself — a host launch hook *may* generate it, but nothing
regenerates it automatically on every host. If it's absent, that's normal:
you read memory directly when you need it.

`.agents/` is an IDE-neutral path so the same memory works whether this
agent is running under Claude Code, Cursor, Gemini CLI, Windsurf, or
Copilot CLI.

## Legacy paths (one-time migration)

If you find memory under one of these older locations and `.agents/memory/<role>/`
doesn't exist, migrate it before your first write:

| Old location | New location |
|---|---|
| `.claude/memory/<role>/` (directory) | `.agents/memory/<role>/` — move the whole dir |
| `.agents-legacy/memory/<role>/` (directory, older install) | `.agents/memory/<role>/` — move the whole dir |
| `.claude/memory/<role>.md` (flat file, from the former `project-seeder` skill) | `.agents/memory/<role>/project_briefing.md` — wrap the existing content with `type: project` frontmatter (see "Write" op below), add one index line to `MEMORY.md` |

Migrate with `Bash` (`mv` for directories) or `Read`/`Write` (for the flat
file → curated entry conversion). Do this once; afterwards ignore the old
paths.

## Two stores, two purposes

| Store | When to use | Cost | Example |
|---|---|---|---|
| **Daily log** | Anything today's you would want tomorrow's you to know. Episodic, transient, cheap. | 1 line appended | "User pushed back on adding a new flag; wants to reuse existing config key" |
| **Curated entry** | Durable facts, preferences, decisions, references. Should still be useful in 6 months. | 1 index slot | User's timezone; a validated correction about testing strategy |

**If unsure: log it.** You can promote to a curated entry later. Never the
reverse.

## Four curated types

Every curated entry carries a `type:` field:

| Type | Holds |
|---|---|
| `user` | Who the user is — role, expertise, preferences, working style |
| `feedback` | Corrections and validated approaches. Always include *why* |
| `project` | Goals, deadlines, constraints, in-flight initiatives. Decays fast — re-verify before acting. **Scout seeds one here at install time (`project_briefing.md`)** covering stack, conventions, and role-specific gotchas. |
| `reference` | Pointers to external systems (Linear projects, Slack channels, dashboards) |

---

## Operations

### Log — append to today's daily log

To record `<text>`:

1. Determine today's date. Use the `Today's date is …` line in your
   environment context. If not present, run `date -u +%Y-%m-%d`.
2. Target path: `.agents/memory/<role>/daily/<today>.md`.
3. If the file **does not exist**, `Write` it:
   ```
   # Daily log — <today>

   - [HH:MM] <text>
   ```
4. If the file **already exists**, `Edit` to append a single new line at
   the end: `- [HH:MM] <text>`.

Use 24-hour `HH:MM`. One observation per line. Keep it terse — full
sentences are fine; paragraphs belong in curated entries.

### Write — create or replace a curated entry

To record a curated entry named `<name>` with `<type>`, `<description>`,
and `<content>`:

1. **Slugify** `<name>`: lowercase, replace non-alphanumerics with `_`,
   strip leading/trailing underscores. Example: `User Timezone` →
   `user_timezone`.
2. **Target path**: `.agents/memory/<role>/<slug>.md`.
3. **`Write`** the file with this exact frontmatter (`name`, `description`,
   `type` are parsed by memory tooling — don't omit them, don't
   add extra keys, keep each on one line):
   ```markdown
   ---
   name: <name>
   description: <description>
   type: <type>
   ---

   <content>
   ```
4. **Update the index** at `.agents/memory/<role>/MEMORY.md`:
   - **If `MEMORY.md` doesn't exist**, `Write` it:
     ```markdown
     # Memory index — <role>

     - [<name>](<slug>.md) — <description>
     ```
   - **If a line already refers to `<slug>.md`**, `Edit` that single line
     to the new description. One entry = one line, no duplicates.
   - **Otherwise**, `Edit` to append one new line at the end:
     `- [<name>](<slug>.md) — <description>`.

### Read — recall memory on demand

1. **If snapshot content is already in your context** (some hosts inject
   `.agents/memory/<role>/snapshot.md` at launch), you already have curated
   memory and recent daily logs — don't re-read them.
2. **Otherwise** (the common case — many hosts never generate a snapshot),
   read memory directly:
   - `Read .agents/memory/<role>/MEMORY.md` for the curated index.
   - `Read .agents/memory/<role>/<slug>.md` for any entry the index
     points you at. Scout's `project_briefing.md` is usually the most
     load-bearing on a new project.
   - `Glob .agents/memory/<role>/daily/*.md`, sort by filename
     descending, and `Read` the most recent 3 files.

Bounded recall keeps your context small — don't tail the whole daily log
history.

### Rename / delete

- **Rename** a curated entry: `Write` the new `<new-slug>.md`, remove the
  old file, `Edit` `MEMORY.md` to replace the single line.
- **Delete**: remove `<slug>.md`, `Edit` `MEMORY.md` to drop its line.
- **Never edit a daily-log entry after the fact.** Log a correction as a
  new line instead — the audit trail is the point.

---

## What belongs in memory vs. somewhere else

- **Memory** — durable facts and ephemeral working notes that matter *to
  you as an agent* across sessions: user preferences, project constraints,
  lessons from corrections, references to external systems.
- **Not memory** — anything a human other than you should be able to find.
  That goes in the user's knowledge base (e.g. `obsidian-vault`), the
  project's docs, the issue tracker, or the code itself.

Some agents also keep role-specific operational state in this directory
(e.g. personal-assistant's `people-pending.md`). That's fine — the layout
is yours to extend, as long as `MEMORY.md`, `<slug>.md`, and `daily/`
follow the spec above.

---

## Snapshot.md — a host convenience that may be absent

`snapshot.md` is an optional host artifact: a launch hook *may* generate it
by inlining `MEMORY.md`, curated entry bodies, and recent daily logs into a
single file it injects at startup. Nothing regenerates it automatically on
every host, so expect it to be missing or stale.

You never write `snapshot.md` yourself. When it isn't in your context, the
`MEMORY.md` index is your map to the entry bodies: read
`project_briefing.md` and the other entries it lists on demand — no error,
no interruption.

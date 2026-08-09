---
name: memory
description: Use when the user says 'remember this' or 'log this', asks 'what did you learn yesterday', or whenever you discover something worth keeping across sessions. Per-role persistent memory — durable facts, preferences, decisions, and a daily log, as plain markdown.
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

**Write it as a vault, not a pile of notes.** `.agents/memory/<role>/` opens
directly in Obsidian, so entries carry frontmatter properties, aliases, tags
and `[[wikilinks]]`. That is not decoration: aliases make an entry findable by
the words you would actually search for, links turn isolated facts into a graph
you can follow, and the `updated` property tells you what is due for
re-verification. A human may edit this vault too — **tolerate keys you did not
write; never strip them**.

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

### Where does this go?

```
Is it mission/ticket state (status, assignee, acceptance criteria)?
                                          → the work board, NOT memory
Would ANOTHER ROLE need it, and is it verified + durable?
                                          → .agents/knowledge/  (knowledge-curation skill)
Is it durable for THIS role (>6 months useful)?
                                          → curated entry here
Would tomorrow's you want it, but not next quarter's?
                                          → daily log
Is it already stated in the repo (code, CLAUDE.md, git history)?
                                          → nowhere; link to it instead
```

The middle branch is the one most often missed. A fact one role paid for that
every role needs is worth **promoting**, not just filing — see the
`knowledge-curation` skill. Memory that only its author can reach is memory
nobody benefits from.

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
3. **`Write`** the file with this frontmatter. `name`, `description` and
   `type` are **required**; the rest make the vault navigable in Obsidian.
   Unknown keys are tolerated — never rewrite or strip a key a human added.
   ```markdown
   ---
   name: <name>
   description: <one line — what a reader GAINS, not what the note is "about">
   type: <user | feedback | project | reference>
   aliases: [<words you would actually search for>]
   tags: [<axis/value>, ...]
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   ---

   ## <section>

   <content>

   Related: [[other_entry]] · [[another_entry#Specific section]]
   ```

   - **`aliases`** make `[[service token]]` resolve to `service_token_rotation.md`
     and let search find the note by the words you'd type, not the slug.
   - **`tags`** are for **cross-cutting filtering only**, as closed axes —
     `type/`, `area/`, `status/`. A tag used once filters nothing; it is
     decoration. Anything expressing a *relationship* is a link, not a tag.
   - **`updated`** is when the FACT was last re-verified, not when the file
     was touched.
   - **`##` headings** make a note anchor-linkable: `[[note#Section]]` beats
     `[[note]]` when you mean one part of it.
   - **`Related:`** lines are what make the graph worth opening. An entry with
     no links is one nobody rediscovers.

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

## Keeping the vault honest

- **Correct or delete a fact the moment it stops being true.** A stale entry is
  worse than none, because it is trusted. Prefer deleting to hedging.
- **Re-verify `project` entries before acting** — they decay fastest. If the
  `updated` date is old and the claim matters, check it, then bump the date.
- **One fact per entry.** If a title needs "and", it is probably two entries —
  or one entry with two `##` sections so each can be linked separately.
- **Link liberally.** `[[slug]]` resolves by filename or alias. A `[[link]]`
  with no matching entry yet is fine: it marks something worth writing.
- **Never store secrets** — tokens, credentials, customer data. Reference where
  they live instead.

### Quick audit

The `knowledge-curation` skill ships `scripts/vault.py`, which does this properly — it resolves
links by filename **or alias** (as Obsidian does), checks anchors, and finds index drift:

```bash
python3 <skills>/knowledge-curation/scripts/vault.py lint .agents/memory/<role> --layer memory
python3 <skills>/knowledge-curation/scripts/vault.py query .agents/memory/<role> --layer memory --text "flaky"
```

It is optional — memory works with your file tools alone. Reach for it when recalling from a large
vault, or after a rename. Shell fallback if Python is unavailable:

```bash
role=.agents/memory/<role>
# entries missing from the index (invisible when recalling)
for f in $role/*.md; do b=$(basename "$f"); [ "$b" = MEMORY.md ] && continue;
  grep -q "($b)" $role/MEMORY.md || echo "UNINDEXED $b"; done
# index lines pointing at deleted entries
grep -o '](.*\.md)' $role/MEMORY.md | tr -d ']()' | while read -r t; do
  [ -f "$role/$t" ] || echo "DEAD $t"; done
```

Run it after a rename or a big cleanup — an unindexed entry is one you will
never recall, and a dead index line sends you looking for a file that is gone.

## Snapshot.md — a host convenience that may be absent

`snapshot.md` is an optional host artifact: a launch hook *may* generate it
by inlining `MEMORY.md`, curated entry bodies, and recent daily logs into a
single file it injects at startup. Nothing regenerates it automatically on
every host, so expect it to be missing or stale.

You never write `snapshot.md` yourself. When it isn't in your context, the
`MEMORY.md` index is your map to the entry bodies: read
`project_briefing.md` and the other entries it lists on demand — no error,
no interruption.

---
name: memory
description: Per-role persistent memory for Octobots roles. Curated typed entries (facts, preferences, decisions) and append-only daily logs (episodic, "what did I do today"). Use when the user says "remember this", "what did you learn yesterday", "log this", or whenever you discover something worth keeping across sessions.
license: Apache-2.0
compatibility: Requires Python 3.10+ (stdlib only, no pip dependencies)
metadata:
  author: octobots
  version: "0.1.0"
---

# Memory

Persistent per-role memory. Two complementary stores under `.octobots/memory/<role>/`:

- **Curated** — typed entries (`<name>.md` with frontmatter) plus an index `MEMORY.md`. For facts that should survive across many sessions: user preferences, project decisions, feedback, references.
- **Daily log** — `daily/YYYY-MM-DD.md`, append-only timestamped lines. For episodic recall: what you did, what the user said, transient context. Bounded by date so it doesn't grow forever.

A `snapshot.md` is regenerated at every role launch combining the index and the last few days of daily log. Roles `@import` it from their AGENT.md so memory is auto-loaded into the system prompt at session start — no manual reads needed.

## Quick Start

Resolve your role from env `OCTOBOTS_ID`.

```bash
# Append a timestamped line to today's daily log
python octobots/skills/memory/scripts/memory.py log "Discussed Q2 roadmap with user; agreed to defer mobile work"

# Write a curated typed memory entry (use for things worth months/years)
python octobots/skills/memory/scripts/memory.py write user_timezone \
  --type user --description "User's timezone and quiet hours" \
  --content "User is in CET (UTC+1). Quiet hours: 22:00–08:00."

# Read the last 3 days of daily logs + curated index
python octobots/skills/memory/scripts/memory.py read --days 3

# Regenerate snapshot.md (supervisor calls this automatically at launch)
python octobots/skills/memory/scripts/memory.py snapshot
```

All commands accept `--role <name>` to override `OCTOBOTS_ID`.

## When to log vs. write

- **`log`** — anything happening now that you'd want to remember tomorrow but probably not next month. User's mood, what task you're mid-flight on, a one-off observation. Cheap.
- **`write`** — durable facts, preferences, decisions, lessons. Expensive — costs an index entry. Should be re-readable in 6 months and still useful.

If unsure: `log` it. The next snapshot will surface it; you can promote to a curated entry later.

## Memory types (curated only)

| Type | What goes here |
|---|---|
| `user` | Who the user is, role, expertise, preferences |
| `feedback` | Corrections and validated approaches the user gave you. Include the *why* |
| `project` | Goals, deadlines, constraints, in-flight initiatives. Decay fast — re-verify before acting |
| `reference` | Pointers to external systems (Linear projects, Slack channels, dashboards) |

## Auto-load

Roles import their snapshot via `@.octobots/memory/<role>/snapshot.md` at the top of their AGENT.md. Claude Code resolves the import at session start so curated entries and recent daily logs are part of the system prompt automatically. The supervisor regenerates `snapshot.md` before every role spawn.

# Role Customization (Step 7)

Triggered when the project's detected stack doesn't match the default role
set — e.g., a game engine project, a Rust CLI, a data science project.
Skip this step entirely if all default roles fit the project as-is.

---

## 7a — Rewrite SOUL.md and AGENT.md for repurposed roles

For each role being repurposed:

- **Read the existing `SOUL.md` fully.** Update the persona name,
  personality framing, and domain expertise sections. Leave voice, values,
  and working style intact — those are reusable across domains.

- **Read the existing `AGENT.md` fully.** Update the YAML frontmatter
  `name` and `description` fields, the identity paragraph, and the mission
  statement. Leave session lifecycle, taskbox commands, and communication
  conventions intact — those are structural scaffolding.

**Surgical rule:** if a section is about *how to operate* (taskbox, inbox,
restart protocol), leave it. If it's about *who you are and what you know*,
update it.

---

## 7b — Generate `.octobots/roles-manifest.yaml`

Use the template in `templates.md`. Fill in all roles — customized and
unchanged. Set `customized: true` and add `repurposed_for` for any
repurposed roles.

This file is the input for `octobots/scripts/check-spawn-ready.py`.
Generate it before running any readiness checks.

---

## 7c — Seed role memory files

Files live at `.claude/memory/<role-id>.md`. Use the memory seeding
template from `templates.md`.

Fill in "Project Knowledge" and "My Role Focus" for **every role** — not
just customized ones. An unchanged role still needs to know the stack, key
paths, and what its work looks like on this specific project.

"My Role Focus" is written by scout, not filled from a template — it
should reflect actual understanding of what this role does on this project.

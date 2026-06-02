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
  statement. Leave session lifecycle and communication conventions intact —
  those are structural scaffolding.

**Surgical rule:** if a section is about *how to operate* (session
lifecycle, communication conventions), leave it. If it's about *who you
are and what you know*, update it.

---

## 7b — Seed role memory files

Each role's briefing lives as a `type: project` curated entry at
`.agents/memory/<role-id>/project_briefing.md`, with an index line in
`.agents/memory/<role-id>/MEMORY.md`. Use the memory seeding template
from `templates.md` (section `.agents/memory/<role-id>/project_briefing.md`).

This is the same spec the `memory` skill uses for any curated entry —
the agent reads it at session start via its orientation block, and
further entries (user preferences, feedback, references) get appended
by the agent later.

Fill in "Project Knowledge" and "My Role Focus" for **every role** — not
just customized ones. An unchanged role still needs to know the stack, key
paths, and what its work looks like on this specific project.

"My Role Focus" is written by scout, not filled from a template — it
should reflect actual understanding of what this role does on this project.

### Re-seeding rule — never clobber an existing briefing

`project_briefing.md` is often **already on disk before you run**. A team
bundle seeds a *generic stack overlay* there at install time (the installer
copies `briefings/<role>.md` → `.agents/memory/<role>/project_briefing.md`,
skipping any that already exist), and on a **re-run** your own earlier
project-specific briefing — plus entries the agent appended later (user
preferences, feedback, corrections) — is already there. Decide intent **before**
writing:

- **Generic stack-overlay only** — no project name/URL, no framework version, no
  real file paths, no gotchas (the bundle placeholder, e.g. *"Stack overlay
  (team-web) — web QA defaults; scout refines per project"*). → **Replace freely.**
- **Any project-specific content present** → **APPEND only.** Keep every existing
  line verbatim; add `## This project — <Name> (seeded YYYY-MM-DD)` with the new
  facts and `## Known gotchas (this project)` for runtime discoveries. Never
  rewrite or drop existing prose, and never touch entries the agent appended.

**Test:** does the existing content carry knowledge you did **not** discover this
run? **Yes → append. No → replace.** Applies to every role that has a
`project_briefing.md` — not a fixed list; which roles a bundle briefs varies per
bundle (e.g. `team-web` briefs scout / tech-lead / python-dev / qa-engineer /
test-automation-engineer / quality-architect). The same append-don't-clobber
instinct already governs `CLAUDE.md` / `AGENTS.md` and their `<!-- BUNDLE:<id> -->`
blocks (see SKILL.md Steps 1–2).

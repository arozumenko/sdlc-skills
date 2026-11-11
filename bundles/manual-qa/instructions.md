# Manual QA Team — shared conventions

This is a **standalone manual-QA team** for web and mobile apps. These are
team-wide defaults; scout (if present) or app-profiler refines them per project
in `AGENTS.md`, which always wins over this file.

## Team conventions

Pipeline, project layout, the `{{base_url}}` rule, evidence-before-PASS and the test-run-lead rule:
see `.agents/manual-qa/knowledge/CONVENTIONS.md`. Read it before your first task in this project.

## Agent memory — two layers

**`.agents/knowledge/`** — distilled, cross-role, **verified** facts about this project. Committed
and reviewed. If it exists, read its `README.md` before starting, plus the folder covering what you are
touching. If it does not exist yet, the layer is empty; the `knowledge-curation` skill bootstraps it.

**`.agents/memory/<role>/`** — your own working notes and daily log. Unreviewed and per-role, so
anything another role needs does not belong there. Whether it is committed is the project's choice,
not this block's: if `git check-ignore -q .agents/memory/<role>/MEMORY.md` succeeds it stays on this
machine; otherwise it is tracked and committed with your work.

When you learn something, choose the layer deliberately. Promote it to `.agents/knowledge/` only if
**all four** hold — otherwise keep it in your role directory:

1. **Cross-role** — useful to two or more roles, or architecture-level.
2. **Verified** — you confirmed it against the running system, and the note says how, with a date.
3. **Durable** — still true once this mission ends.
4. **Costly to rediscover** — anything obvious from reading the code belongs in the code.

Correct or delete a shared note the moment it stops being true: a stale one misleads every role at
once. Never commit an unverified claim — it is worse than silence, because it is trusted. Mission
state belongs in the project's tracker (the delivery ledger when delivery tracking is enabled), not in
either memory layer.

Use the `memory` skill for the per-role layer and `knowledge-curation` for the shared one.

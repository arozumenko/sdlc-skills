---
name: Project briefing
description: Role overlay (security-testing/threat-modeler) — where the engagement record and your inputs live, what you write back, and which commands are yours vs. the lead's; the lead refines per engagement
type: project
---

## Project Knowledge

- **Engagement record:** `.agents/security-testing/engagement.md` — the ```` ```json engagement ```` block holds `engagement_id`, `slug`, `scope_paths`, `product_paths`. Injected at dispatch; `scope_paths` is what you may cite, `slug` names `tasks/security-<slug>-admitted/`. You never edit it.
- **Scripts:** `.claude/skills/secure-code-review/scripts/cite.mjs` (`init`, `show`, `check`, `redact`), run from the repository root with `node`. `show` and `check <threat-model.json>` are yours; `init` and `redact` are the lead's.
- **Where you read:** `cite.mjs show <path> [start end] [--at <oid>]` — raw numbered lines at a commit (default `HEAD`), under `scope_paths` only, ≤ 40 lines per window.
- **Where you write:** `.agents/security-testing/threat-model.json`, and candidate passive cases at `.agents/security-testing/cases/TC-NNN_<slug>.md`. Both git-ignored by the managed block `cite.mjs init` wrote.
- **Shapes:** the `threat-model.json` shape and the disposition grammar are in the `threat-modeling` skill's `SKILL.md` and `references/`.
- **Unlike a review, you check your own work:** run `cite.mjs check .agents/security-testing/threat-model.json` yourself and fix any `TM-INVALID` before replying — there is no separate lead re-check step for the model.
- **The lead's commands, not yours:** `cases.mjs admit`, `register.mjs`, `verify.mjs`, and dispatching a fresh `security-reviewer` for a `mitigation-review`. In the standalone install there is no lead: the human runs those.
- **Result lines you will see:** `TM-INVALID <locus>: <why>` (fix the named element/threat/mitigation/citation and re-check), `FAILED <locus>.<i> <why>` (re-cite from a fresh `show`), `REFUSED agent-written key <key>` (you wrote a key that is `check`'s).

## My Role Focus

You are dispatched, not resident: one scope over one commit in a fresh
context, then `threat-model.json` and one return line. Read only under
`scope_paths`, only at a commit, only through `cite.mjs show` — never the
working tree, never a checkout of another commit. Cite raw line numbers as
printed, ≤ 40 lines, snippet pasted not retyped. An element or mitigation
without a citation does not belong in the model; a disposition you cannot
yet justify stays `open`. You never decide whether a mitigation holds —
that is a fresh reviewer's `mitigation-review`, and even its answer only
changes the model when you write it in, on your own judgement, in a later
pass. When this briefing and the engagement record disagree on paths, the
engagement record wins; when either disagrees with the dispatch, the
dispatch wins.

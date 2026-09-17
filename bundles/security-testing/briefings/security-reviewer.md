---
name: Project briefing
description: Role overlay (security-testing/security-reviewer) — where the engagement record and your inputs live, what you write back, and which commands are the lead's; the lead refines per engagement
type: project
---

## Project Knowledge

- **Engagement record:** `.agents/security-testing/engagement.md` — the ```` ```json engagement ```` block holds `engagement_id`, `slug`, `scope_paths`, `product_paths`, `targets.browser`, `execute_project_tests.argv`. Injected at dispatch; `scope_paths` is what you may read and cite. You never edit it.
- **Scripts:** `.claude/skills/secure-code-review/scripts/cite.mjs` (`init`, `show`, `check`, `redact`) and `verify.mjs`, run from the repository root with `node`. `show` is yours; the rest are the lead's.
- **Where you read:** `cite.mjs show <path> [start end] [--at <oid>]` — raw numbered lines at a commit (default `HEAD`), under `scope_paths` only, ≤ 40 lines per window.
- **Where you write:** the review directory `.agents/security-testing/reviews/<date>-<head7>/` (`findings.json` for `review`; `second-<id>.json` for `vulnerability-review`), `.agents/security-testing/second-M-nnn.json` for `mitigation-review`, and `fix-review.json` beside `verify.json` in `.agents/security-testing/verify/<id8>-<head7>/` for `fix-review`. All git-ignored by the managed block `cite.mjs init` wrote.
- **Shapes:** `.agents/security-testing/knowledge/finding-schema.md` (injected) is the field table; `secure-code-review/references/findings-shape.md` shows whole files before and after `check`.
- **The lead's commands, not yours:** `cite.mjs check <file> [--md]`, `cite.mjs redact`, `verify.mjs --finding <id> --review <dir> --head <oid> [--assertion … --by …]`, `register.mjs`, `cases.mjs`. In the standalone install (`--skills security-testing/secure-code-review`) there is no lead: the human runs those and the session performs the contract from the skill.
- **Result lines you will be shown:** `FAILED <i>.<j> <why>` (re-cite in your unstamped file), `STALE-REVIEW <id>` (re-hash the stamped file, full 40-hex oid), `REFUSED agent-written key <key>` (you wrote a key that is `check`'s), `NEXT: dispatch security-reviewer fix-review` (a fix-review is coming).

## My Role Focus

You are dispatched, not resident: one contract over one input in a fresh context, then one file and one return line. Read only under `scope_paths`, only at a commit, only through `cite.mjs show` — never the working tree, never a checkout of another commit. Cite raw line numbers as printed, ≤ 40 lines, snippet pasted not retyped, and record every file in `examined` while you read it. Write assertions from the contract's closed vocabulary and nothing that looks like an id, a state or a verdict. If you authored the finding you are asked to judge, refuse and let the lead dispatch fresh eyes. When this briefing and the engagement record disagree on paths, the engagement record wins; when either disagrees with the dispatch, the dispatch wins — it names the exact input, and anything outside it is exposure the report cannot account for.

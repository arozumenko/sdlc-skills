# update.md — keeping this skill fresh

This skill is **versioned alongside qavajs 2.x**. Step catalogs, the config schema, and the page-object DSL all move with upstream releases. Refresh whenever:

- A user mentions a step phrase that isn't in the catalogs and you find it in upstream source.
- A `config.ts` field appears in upstream demos that isn't in `architecture.md`.
- qavajs publishes a major or minor release (check <https://github.com/qavajs/core/releases>).
- An existing reference contains a fact that turns out wrong in practice.

## How to refresh the catalogs (the easy path)

Run [`scripts/refresh-catalogs.sh`](../scripts/refresh-catalogs.sh). It:

1. Shallow-clones `steps-memory`, `steps-playwright`, `steps-wdio`, `steps-api` into a temp dir.
2. Runs the same Python extractor used to build the originals.
3. Writes the new catalogs to `references/steps-*.md`.

Show the user the diff before committing. If a phrase changed, also scan `references/recipes.md` and the rest for stale snippets.

## How to refresh the prose references

The prose files have a "Live links" section pointing at upstream READMEs and the docs site. When updating:

1. Re-fetch the README (`raw.githubusercontent.com/qavajs/<repo>/main/README.md`).
2. Diff against the relevant section here.
3. Apply only meaningful edits — don't rewrite for cosmetic changes.
4. Bump `metadata.version` in the SKILL.md frontmatter.

Sources:

| File | Upstream |
|---|---|
| `architecture.md` | <https://github.com/qavajs/core/blob/main/README.md> |
| `memory.md` | <https://github.com/qavajs/memory/blob/main/README.md> |
| `validation.md` | <https://github.com/qavajs/validation/blob/main/README.md> |
| `page-object.md` | <https://github.com/qavajs/po-playwright> + <https://github.com/qavajs/po> |
| `composition.md` | core README (composition + template + override + fixture sections) |
| `playwright-runner.md` | <https://github.com/qavajs/steps-playwright/blob/main/README.md> |
| `wdio-runner.md` | <https://github.com/qavajs/steps-wdio/blob/main/README.md> |
| `api-testing.md` | <https://github.com/qavajs/steps-api> |
| `parallel.md` | <https://qavajs.github.io/docs/Guides/parallel> |
| `formatters.md` | <https://qavajs.github.io/docs/Formatters/> |
| `recipes.md` | mostly distilled from <https://github.com/qavajs/demo> |
| `troubleshooting.md` | community-maintained; merge useful patterns from <https://qavajs.github.io/docs/qna> |

## Self-edit policy

You are encouraged to edit this skill when you learn something. Two rules:

1. **Add, don't rewrite.** When a fact is missing, append it. When a fact is wrong, fix it surgically and note the change in this file's "Recent additions" log below.
2. **Verify before adding.** A new step phrase must come from upstream source (linked above). A "I think this is the syntax" guess belongs in `troubleshooting.md` as a candidate, not in a catalog.

After any change, bump `metadata.version` in `SKILL.md`'s frontmatter (semantic minor for new content, patch for fixes).

## Recent additions

_Log of meaningful changes to this skill, newest first. Append one line per change._

- 2026-05-07: **moved CLAUDE.md template from `references/` to `assets/example-CLAUDE.md`** — it's a copy-paste starter (literal template + placeholders), not a routing/reference doc. Customisation cues now live in an HTML-comment header at the top of the asset. SKILL.md routing updated: workflow table points the CLAUDE.md row at `assets/example-CLAUDE.md`; "Working assets" list extended.
- 2026-05-07: **added agent-driven workflow tier** (v1.2.0). New refs: `workflow-create-test.md`, `workflow-run-test.md`, `workflow-fix-test.md` — distilled from `qavajs/demo/agentic/.claude/skills/{create-test,run-test,fix-test}` (MIT) and made config-aware (no hardcoded paths). The bug-report block format (run-test) and the symptom→cause→fix decision table (fix-test) are kept verbatim. Added a "Workflows" routing section to `SKILL.md`.
- 2026-05-06: **expanded coverage to all 11 step packages** (300 patterns total). Added catalogs for `steps-sql`, `steps-files`, `steps-gmail`, `steps-lighthouse`, `steps-visual-testing`, `steps-accessibility`, `steps-accessibility-ea`. Added prose refs `sql-testing.md`, `file-testing.md`, `email-testing.md`, `lighthouse.md`, `visual-testing.md`, `accessibility.md`, `cloud-providers.md`, `standalone-runners.md`, `typescript.md`, `vscode.md`, `wdio-adapter.md`, `cicd.md`, `migration-v1-to-v2.md`. Updated `page-object.md` to canonical `locator.native(({ page }) => …)` API; flagged `@qavajs/soft-assertion` and `@qavajs/template` as deprecated; clarified the `config.ts` (cucumber-js) vs `qavajs.config.ts` (standalone Playwright) distinction. Updated `refresh-catalogs.sh` to pull all 11 step repos.
- 2026-05-06: initial release (qavajs 2.x). Catalogs extracted from `steps-memory`, `steps-playwright`, `steps-wdio`, `steps-api` against `main` at clone time.

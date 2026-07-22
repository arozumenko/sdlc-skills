# Tokenomics export — how to run it

Internal report, reshaped from the existing benchmark metrics
(`reports/metrics/RUN-*.json` + `reports/RUN-*.md`) into one row of the
`factories-tokenomics-dataset` "testing stop / QA fabric" schema (EPAM's
cross-factory AI cost/tokenomics dataset — see
`.agents/manual-qa/knowledge/test-run-report-format.md` for the field-level
background). This is a **manual, on-demand script** — not a hook — because
several required fields are honest human judgment calls
(effort, maturity, environment complexity) that no telemetry can produce.

## 0. One-time setup (per project)

This runbook and its companion `factory-profile.json` are **not** copied
automatically by the bundle installer — only the hook scripts under
`hooks/scripts/` are. Do this once, right after installing the bundle:

1. Copy `hooks/templates/factory-profile.template.json` from your
   `sdlc-skills` checkout to `reports/tokenomics/factory-profile.json` in
   your project.
2. Copy `hooks/templates/tokenomics-readme.template.md` to
   `reports/tokenomics/README.md`.
3. Open `factory-profile.json` and fill in the placeholders (anything in
   `<angle brackets>`) — at minimum `factory_id` and `factory_name`.
   Everything else in that file already holds for a stock manual-qa
   install; only touch the rest if your fork genuinely differs (e.g.
   parallel instead of sequential `test-runner` dispatch).

## 1. Run a suite as usual

Nothing extra to do here. The existing `benchmark-*` hooks already write,
on their own, once a session ends:
- `reports/metrics/RUN-<id>.json` — raw metrics
- `reports/RUN-<id>.md` — the human-readable report

The tokenomics script only *reads* these — it never re-runs anything.

## 2. (Optional but important) Fill in the human-judgment frontmatter

Open the run's report, `reports/RUN-<id>.md`, and add to its frontmatter
(between the `---` lines) whatever the script can't measure on its own:

```yaml
work_item_ref: JIRA-1234
work_item_brief: "Short description of what this run covers"
maturity: pilot            # production | pilot | experimental
effort_days: 2             # person-days, no AI — the one field that's genuinely yours to estimate
env_setup: multi-fixture    # trivial | single-fixture | multi-fixture | external-deps | full-env
```

Full key list + meaning:
`.agents/manual-qa/knowledge/test-run-report-format.md` →
"Optional Tokenomics-Export Frontmatter Keys".

Skipping this step is fine — the script won't fail — but `work_item_ref` and
`effort_days`/`size_tshirt` will stay `null` and get flagged ❌ MISSING.

## 3. Run the export

From the project root, wherever the bundle installer placed the hook
scripts (check `.claude/hooks/manual-qa/` first):

```bash
# one specific run
node .claude/hooks/manual-qa/build-tokenomics-report.mjs reports/metrics/RUN-<id>.json

# or every run currently in reports/metrics/
node .claude/hooks/manual-qa/build-tokenomics-report.mjs --all
```

## 4. Read the checklist it prints

- **❌ MISSING** — required field, no safe default (no data → don't treat
  this row as submission-ready)
- **⚠️ DEFAULTED** — a default was substituted (e.g. `maturity: experimental`)
  — eyeball it, don't trust it blindly

## 5. Pick up the output

One file per run: `reports/tokenomics/RUN-<id>.tokenomics.json` (named after
the *source* metrics file, not the embedded `run_id` — this avoids one run
silently overwriting another's output if two files ever end up sharing a
run_id, e.g. a renamed/backup copy).

`reports/tokenomics/factory-profile.json` sits alongside it — that's the
shared "segment header" (fabric identity, pipeline, efficiency techniques),
filled in **once by hand** (see step 0), not regenerated per run.

## 6. Filling gaps later

Go back to step 2, add the missing frontmatter key(s), save, re-run the
command from step 3 — it overwrites the same `.tokenomics.json` with the
now-more-complete row.

## Related

- Want a visual HTML report from this JSON instead of just the raw row?
  Copy `hooks/templates/tokenomics-html-readme.template.md` to
  `reports/tokenomics/html/README.md` — same one-time setup idea, for
  `build-tokenomics-html.mjs`.
- Script: `build-tokenomics-report.mjs` (lives in `hooks/scripts/`,
  installed to `.claude/hooks/manual-qa/` by the bundle installer)
- Underlying metrics pipeline it reads from: `build-run-metrics.mjs`
  (`hooks/scripts/benchmark-*`)
- If you run this bundle across multiple projects, give each its own
  `factory_id` in `factory-profile.json` — the script and its logic stay
  identical across all of them.

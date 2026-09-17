# Notes — security-testing bundle (maintainers)

Decisions and follow-ups that are not part of what a consumer installs.
`CHANGELOG.md` says what landed; this file says what was decided against
for v1 and what is still owed. Owners are the task lineages of the SDD plan
(`.superpowers/sdd/2026-09-15-security-testing-bundle-tasks-v2/`).

## v2 items

### Threat ticket profile (`ticketed(<url>)` on a threat)

**Decided 2026-09-17 (final review I-5; PM log after G20).** In v1 nothing
produces the `tracker-readback` record a `ticketed(<url>)` disposition on
a `T-nnn` validates from: `publish --profile tracker` writes finding
tickets only (`lib/profiles/tracker.mjs`), `cmd-ingest.mjs liveRowsFor`
lands `ticketed` on finding rows only, and the lead's rules forbid a
hand-authored payload. A threat is therefore disposed through `planned`,
`executed`, `accepted` or `mitigated` (or stays `undisposed`); the lead's
`### tracker` contract and `security-engagement/references/tracker-rules.md`
say so. `ticketed` stays in the disposition vocabulary and the schema so
the profile can land without a schema change.

v2 shape, when wanted: `publish --run <run_id> --profile tracker --threat T-nnn`
emitting `{finding_id: "T-nnn", title: <threat title>, …}` from the run's
threat-model snapshot, the same read-back, and `liveRowsFor` widened to
`subject_kind: threat` rows (a `register.mjs add` on a threat subject
already exists for `accepted`).

## Final-review minors left as follow-ups

From Rio's whole-branch review of M2–M5 (`final-review.md`, 2026-09-17).
M-9 was taken in the I-1/I-4 prose pass (`TEMPLATES:` quoted per file in
the lead and the workflow; `--scanner-rows` file home named; the
`INCOMPLETE(dispositions)` cause named). Everything below is open.

- **M-1** — `lib/tm-lint-core.mjs` `fail()` / `citationText`: fold `\r?\n`
  in agent-authored text before `tokens.tmInvalid` (it throws on a newline
  ⇒ exit 1, no token). TASK-039 lineage.
- **M-2** — `lib/cmd-tm-lint.mjs` `readAll` / `render` use bare
  `readArtifact`; a tampered receipt/packet/import or snapshot exits 5 with
  no `INCONSISTENT(<name>)` token — route through `readOptional`. TASK-039
  lineage.
- **M-3** — `lib/cmd-sign-off.mjs` `readRunArtifact` rethrows
  `EISDIR`/`ENOTDIR` ⇒ exit 1 from the one command that must always print
  its verdict; fold both into the `undefined` branch. TASK-041 lineage.
- **M-4** — `cmd-sign-off.mjs` imports `SNAPSHOT_FILE`/`DISPOSITIONS_FILE`
  from the sibling command `cmd-tm-lint.mjs`; `inputs.SINGLETONS` already
  spells both. Architecture nit, TASK-041 lineage.
- **M-5** — `lib/cmd-plan.mjs:82` re-declares `SLUG`; import it from
  `profiles/index.mjs`. TASK-043 lineage.
- **M-6** — `cmd-ingest.mjs` re-ingest after `targets.browser` changed ⇒
  `5 INCONSISTENT(observations/<id>)` rather than `2 IMPORT-EXISTS`. Note:
  `existsSync(<run>/ingest/<sha>.json)` already runs before any derive or
  write (since TASK-015), so a same-bytes re-run is `IMPORT-EXISTS`; only
  the crash-heal path (observations written, record not) can still blame
  the observation. Decide whether to derive `base_url` from the run's
  engagement snapshot instead. TASK-044 lineage.
- **M-7** — `lib/observations.mjs` `caseIdentities` integrity-verifies
  every `<run>/ingest/*.json` (SARIF included) per qa-run/ta-report ingest;
  filter by the imports index `kind` first. TASK-044 lineage.
- **M-8** — `lib/cmd-plan.mjs:176` a title containing ` | ` breaks the
  `ta-prompt` line grammar; replace or note. TASK-044 lineage.
- **M-10** — `README.md:315` standalone step 13 ("need the full bundle")
  reword; `README.md:~103` codex row overstates — the installer enables
  only top-level `skills/` in Codex TOML (`bin/init.mjs
  transformAgentForCodex`), a pre-existing gap for every factory-local
  `skills:` entry. Installer owner for the second half.
- **M-11** — dogfood note (`docs/superpowers/notes/2026-09-17-security-testing-dogfood.md`):
  unquoted `--title` in four `register.mjs add` lines, an absolute
  scratchpad path with a session id, awkward #4 undercounts (three
  `.agents/` drop sites), awkward #6 misattributes the phrase to the README.
  Note-only, TASK-054.
- **M-12** — `smoke.test.mjs` tautological `TWO_SKILLS` assert and duplicated
  `assertNoNetwork`; `fixtures/e2e/helpers.mjs` `BOOLEAN_FLAGS` comment and
  dead `SD_EXTERNAL` export; `agents.test.mjs` compares prose to literals
  rather than `tokens.mjs` exports. TASK-048 / TASK-053 / TASK-056 lineage.
- **M-13** — `lib/profiles/redacted-report.mjs` `LOCAL_LAYOUT = /\.agents\//`
  drops whole rows of agent-authored prose with no `withheld` marker;
  `render.mjs` `HTML_TAG` deletes `<placeholder>` words from reviewer
  prose. TASK-023/031 lineage.
- **M-14** — `register.mjs add` does not warn on a live row with the same
  subject (dogfood #3); the lead prose "one row per subject for the life of
  the engagement" is the cheap half. TASK-028/030 lineage.
- **M-15** — residual cosmetics, all confirmed harmless: tracker `plan`
  O(A²) alias walk; `resolveTicketRow` read-outside-lock TOCTOU;
  `validateProposalFile` without a caller; `resolveCases` three git spawns
  per path; `auditForm` trailing Collect row; `resolveDestination` TypeError
  without `opts.slug`; `tokens.mjs:185` `openExposure` comment;
  `cmd-publish.mjs:235/246/248` dead-end wording; `RUN_ID` `.flags` pin;
  harness default `SKILL.md`; e2e:517 message; `catalog.test.mjs:77` and
  `smoke.test.mjs:72` repo-root coupling; `cli.mjs:105` non-EPIPE rethrow;
  one unreproduced flaky full-suite failure (G27).

Three installer findings from the dogfood (unpinned mutable refs in
`shallowClone`, symlink dereference out of the clone root in
`copyTreeDereferenced`, payload-selected memory path in `hooks/agent-start`)
are this repo's, outside the bundle — one issue each on `main` for the
installer owner.

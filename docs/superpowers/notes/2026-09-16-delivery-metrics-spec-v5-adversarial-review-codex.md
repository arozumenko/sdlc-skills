# delivery-metrics spec v5 — adversarial review (codex gpt-6-astra, round 5)

Date: 2026-09-16.

## Verdict

approve

Counts: **0 blockers / 0 majors / 0 minors**.

Ship the specification to implementation. No material counterexample survived the explicit v5 limitations under the required tokenomics guarantee ceiling. This approves the narrowed specification, not a working implementation or the stronger guarantees previously accepted in v4. SPIKE-1 and the implementation gates remain required before shipping their corresponding capabilities.

## Findings

No material findings.

| id | severity | slug | section | finding | evidence | concrete change |
|---|---|---|---|---|---|---|

## Verified repo claims

Aliases: **S** = `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`; **TOK** = `bundles/test-automation/skills/tokenomics`; **TAW** = `bundles/test-automation/skills/test-automation-workflow`; **AS** = `bundles/test-automation/skills/automation-scoping`. Line numbers refer to this worktree unless a branch is named. V5's header delegates its repository claims to §16; every row of that table was checked directly. `ok` establishes the existing fact, not implementation of its proposed amendment.

- **ok** — S:318: `TOK/hooks/telemetry-capture.mjs:75–94,120–123,1464–1491` implements git-name/OS-name/email-fallback slugging, one append call per line, and best-effort whole-submodule sync; `TOK/scripts/team-report.mjs:48–73` loads readable records and deduplicates by host/session using end/capture clocks.
- **ok** — S:319: `feat/security-testing-bundle-spec:bundles/security-testing/skills/security-evidence/scripts/lib/fsx.mjs:12–24,115,128–151` documents both live-holder stale-lock races, sets the 60-second default and acquires with mkdir. It does not establish process fencing. Read through `git show`, not assumed present locally.
- **ok** — S:320: `TOK/hooks/telemetry-capture.mjs:187,328–333,438–452,608–620,1339,1359–1367` supports the available start clock, sidecar metadata, end-only live record, full-message Workflow stage search, argument/environment/cwd selection and parent-transcript fallback. Main-worktree resolution and validated child-path handling are correctly identified as proposed work.
- **ok** — S:321: `TOK/scripts/install-hooks.mjs:145–158` registers the named Copilot events without establishing their payloads; `:305–311` omits delivery transients from inner ignores; `:517–532` rewrites owned ignore content without byte-preservation guarantees.
- **ok** — S:322: `TOK/scripts/work-scope.mjs:46–102` overwrites scope/outcome JSON; `TOK/scripts/build-tokenomics-export.mjs:165–180` upserts the mutable export. V5 no longer claims these writers participate in a delivery lock.
- **ok** — S:323: `TOK/scripts/batch-cost.mjs:439–459,511–568,583–586,617–707,724–745` contains the generation heuristic, parent/shared/cluster allocations, rounded direct/loaded/batch values, provisional/drift/coverage fields and ordinary export writes. `TOK/hooks/telemetry-capture.mjs:752–754` includes the parent and child active minutes. These sources cannot prove accounting-window containment or coherent snapshots.
- **ok** — S:324: `TOK/scripts/batch-cost.mjs:344` omits scorer `estMin`; `TOK/templates/factory-profile.template.json:8` uses `batch`; `TOK/scripts/build-tokenomics-export.mjs:66,105` defaults to `feature`. The three agreed amendments have real source targets.
- **ok** — S:325: `TOK/scripts/team-report.mjs:106–114` calculates local-calendar weeks; `TOK/hooks/telemetry-capture.mjs:489` attaches `foldedFromLive` to a session line. The batch export is not required to preserve that flag.
- **ok** — S:326: `TAW/scripts/gate/gate-case.mjs:191–221` selects between the two gate paths and does not record tested SHA/sequence identity; `TAW/references/orchestration-playbook.md:200–210` requires separate run calls and batch-trunk landing; `TAW/references/campaign-planning.md:254–280` distinguishes approved Plan JSON from State/Log.
- **ok** — S:327: `AS/scripts/score-cases.mjs:381–388,466–472` emits numeric bounds/estMin and descriptive confidence, not human acceptance or a numeric coverage probability.
- **ok** — S:328: `bundles/SPEC.md:291–304` requires roster admission and one shared telemetry submodule; P-0/P-1 explicitly amend its per-factory wording. `skills.json:246–257` demonstrates orphan registration, and `bundles/feature-development/factory.json:166–169` plus `bundles/test-automation/factory.json:11–14` demonstrate attachment through `skills[]`.
- **ok** — S:329: `bundles/feature-development/agents/tech-lead/AGENT.md:181–201` supplies the task template; `bundles/feature-development/agents/project-manager/AGENT.md:95` specifies squash/delete-branch merging; `package.json:5–19` establishes ESM, Node ≥18, node --test, all four validation gates and marketplace regeneration.
- **ok** — Header reference: the security-testing house-style spec is readable at `feat/security-testing-bundle-spec:docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md`. Its absence from this worktree is disclosed.
- **ok** — Additional standards checks: `CLAUDE.md`, `.github/workflows/validate.yml`, `bin/frontmatter-strict.test.mjs`, `bin/no-tools-frontmatter.test.mjs` and `TOK/SKILL.md` support the stated distribution, frontmatter, opt-in, ownership and reporting precedents. V5 explicitly requires skills-ref and marketplace/duplicate gates rather than claiming every gate already runs in CI.

## Not found / explicitly fine

- **`exceeds-tokenomics-ceiling`: not found.** Current requirements use ordinary JSON/JSONL, read-time correction/dedup, optional local mkdir and best-effort sync; §19.4 explicitly supersedes the stronger historical resolutions in §19.1–19.3.
- **`shared-lock-excludes-existing-writers`: not reopened.** S:88–91,239–243,280,348 disclose uncoordinated writers, surviving subprocesses, interrupted Git and undetectable losses; neither a stale lock nor doctor claims exclusive ownership or automatic recovery.
- **`plan-ledger-transaction-gap`: not reopened.** S:87,133,239–240,278–279,343 explicitly permits partial registration/correction and a torn tail swallowing the next append; readable-record dedup is not represented as lossless recovery.
- **`estimate-actual-boundary-undefined`: not reopened.** S:139 fixes elapsed actuals by unit/level; S:219–222 makes active-minute accuracy a labelled comparison with published values, not measured effort confined to declaration→landing.
- The round-3 parent-contribution counterexample remains possible, but S:222,282,346 requires unchanged 55→100 batch totals, unchanged case direct 50 and window-unverified comparison counts; an accounting manifest is unnecessary for that narrower claim.
- Unknown provenance/freshness is visibly distinct from known PROVISIONAL/DRIFT/staleness; the latter excludes accuracy, while byte hashes identify only the bytes actually read (S:213–222).
- **`tokenomics-reader-contract-incomplete`: not reopened.** One selected existing export per mission replaces earlier exports; direct/loaded/batch figures are not added together, raw session folding is not reimplemented, and feature-task cost attribution remains parked.
- **`dedup-destroys-source-precedence` / `observation-retraction-missing`: not reopened.** S:116–120 defines same-revision and equal-rank conflict, blocks lower-source fallback on disagreement, permits source-specific withdrawal and quarantines dependent invalid chains; atomic wrong-item repair is expressly not promised.
- Run/generation qualification, injective re-cut maps, stable-item union and operation-specific import maps address repeated case refs and plan versions without claiming reconstruction of overwritten association history (S:68–70,132–134,175,219).
- Roster union plus session admission remains mandatory; missing type relaxes only the role test. Workflow identifiers are resolved from the full first message before truncation, and worktree/child correlation remains gated by SPIKE-1 (S:162–165).
- Claude's documented SubagentStop distinguishes parent and child transcript paths; unsupported shapes and transcript retention remain capture limitations rather than fabricated starts. [Claude hook reference](https://code.claude.com/docs/en/hooks#subagentstop).
- Squash/deleted-branch history uses explicit task↔PR associations and paginated reads; unavailable mappings/reviews stay unavailable, and the golden uses fixed-date Git fixtures rather than a growing research branch (S:169–171).
- Gate success is not delivery: required-N evidence, tested revision/base, accepted case disposition and integration remain separate; cluster dispatch never manufactures per-case starts (S:175–178).
- Parent cancellation, missing children, scope reopening and mission overlap have explicit outcomes; first completion survives reopening without inflating first-delivery throughput (S:70–73,183–186).
- First-open/reopened/history ages and calibration populations remain separate; no compatible reopen sample means not-comparable. These are explicit workflow boundaries consistent with the [Kanban Guide 2025](https://kanbanguides.org/the-kanban-guide/), which does not prescribe the spec's sample floors.
- UTC half-open replay, carried-in work, declared coverage, partial-week conservation and the three-whole-week velocity rule remain explicit; coverage is not asserted to prove complete capture (S:182–186).
- Missing review/block history stays unknown; first-pass denominators and rework proxies remain visible beside speed/volume, with no individual leaderboard (S:183–185,202–204,269).
- Acceptance attribution is not authentication; unaccepted/late estimates are excluded, source confidence is not promoted to probability, and midpoint/MdMRE/PRED(25)/MAE/hit-rate definitions retain unit/population and zero-denominator distinctions (S:138–142).
- Genuine sub-minute durations and confirmed zero block time survive; retrospective lead exclusion requires same-commit evidence, not duration alone (S:209).
- DORA remains excluded: harness integration does not establish production-delivery performance. [DORA metric definitions](https://dora.dev/guides/dora-metrics/).
- Orphan/self-contained placement, owned ignore upgrades, semantic removal, installed sibling tests and on-demand roles have explicit contracts; no obsolete host architecture vocabulary is reintroduced.
- This was a specification/source review. No implementation test-suite pass, live-host capability result or stronger durability/provenance guarantee is claimed.

```json findings
{"version": 5, "verdict": "approve", "counts": {"blocker": 0, "major": 0, "minor": 0}, "findings": []}
```

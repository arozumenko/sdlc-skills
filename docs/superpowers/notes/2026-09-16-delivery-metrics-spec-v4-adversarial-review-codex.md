# delivery-metrics spec v4 — adversarial review (codex gpt-6-astra, round 4)

Date: 2026-09-16.

## Verdict

approve

Counts: **0 blockers / 0 majors / 0 minors**.

Ship the specification to implementation. No material finding survived the v4 exclusion, recovery and provenance rules. Both round-3 counterexamples now have explicit outcomes and acceptance tests. This verdict does not certify a working implementation: the Claude capability spike, platform subprocess-containment tests, complete accounting reconciliation and repository gates remain prerequisites for shipping the corresponding capabilities.

## Findings

No material findings.

| id | severity | slug | section | finding | evidence | concrete change |
|---|---|---|---|---|---|---|

## Verified repo claims

Aliases: **S** = `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`; **TOK** = `bundles/test-automation/skills/tokenomics`; **TAW** = `bundles/test-automation/skills/test-automation-workflow`. Line numbers refer to this worktree. Every claim in S:11 was checked directly; `ok` establishes the cited existing behavior, not implementation of the proposed amendments.

- **ok** — `bundles/SPEC.md:291–304`: shared-event roster admission, legacy missing-type policy, and one self-referential telemetry submodule. Current wording is per factory; P-0/P-1 explicitly amend the namespace and admission rules for the cross-factory skill.
- **ok** — `skills.json:246–257`: orphan entries use `id`, `monorepo`, `name`, and `description`.
- **ok** — `bundles/feature-development/factory.json:166–169`: orphan attachment through factory `skills[]`.
- **ok** — `bundles/test-automation/factory.json:11–14`: the same attachment mechanism.
- **ok** — `TOK/scripts/install-hooks.mjs:145–158`: registers all five named Copilot events, including `agentStop`. The spec correctly distinguishes registration from payload capability.
- **ok** — `TOK/hooks/telemetry-capture.mjs:187`: parsed transcript start clock exists; `:328–333`: child metadata provides role/description; `:440–447`: live dispatch emits its derived label and end clock, without a start field there.
- **ok** — `TOK/hooks/telemetry-capture.mjs:608–620`: Workflow descriptions can be absent and boilerplate can precede stage identifiers; label derivation searches the first user message. V4 requires resolution before truncation.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1359–1367`: session/agent correlation and parent-transcript directory fallback.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1339`: argument/environment/cwd selection, not main-worktree resolution. V4 describes that resolution as new adapter work.
- **ok** — `TOK/scripts/install-hooks.mjs:305–311`: existing inner ignores do not protect delivery transients.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1473`: shared sync stages the entire submodule with `git add -A`.
- **ok** — `.gitignore:34`: ignores `docs/superpowers/`. `git ls-files docs/superpowers` confirms tracked paths without proving historical add commands; the header makes neither a volatile-count claim nor that historical inference.

Additional source checks support the round-4 conclusions:

- **ok** — `TOK/scripts/batch-cost.mjs:511–568` and `TOK/hooks/telemetry-capture.mjs:752–754`: mission totals include parent remainders and shared contributions, while case direct values can contain dispatch allocations. S:397–401 requires these contributions and their clock evidence in the proposed producer manifest.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1470–1488` and `TOK/scripts/install-hooks.mjs:474–487`: Git mutations currently run through child processes. S:131–136 explicitly replaces caller-PID-only recovery with durable operation ownership and stopped-mutator proof.
- **ok** — `TOK/scripts/team-report.mjs:62–73,106–114`: host-qualified latest-session dedup and local-calendar weeks. Delivery does not fold these sessions itself and explicitly labels its UTC-week divergence.
- **ok** — `TOK/scripts/work-scope.mjs:54–102`, `TOK/scripts/build-tokenomics-export.mjs:165–180`, and `TAW/scripts/gate/gate-case.mjs:191–221`: existing mutable scope/export and gate-write surfaces need the specified compatibility migration; that migration is proposed, not claimed present.
- **ok** — `TAW/references/orchestration-playbook.md:200–210` and `TAW/references/campaign-planning.md:254–280`: separate one-run gate calls and trunk landing; approved Plan distinct from mutable State/Log.
- **ok** — `bundles/test-automation/skills/automation-scoping/scripts/score-cases.mjs:381–388,466–472`: source bounds and confidence labels do not establish human acceptance or a numeric coverage probability.
- **ok** — `CLAUDE.md`, `package.json`, `.github/workflows/validate.yml`, `bin/frontmatter-strict.test.mjs`, and `bin/no-tools-frontmatter.test.mjs`: repository distribution/frontmatter conventions and the named test/validation mechanisms. V4 requires explicit skills-ref validation and marketplace/duplicate gates; it does not rely on the existing CI factory glob alone.

The security-testing reference was read through `git show feat/security-testing-bundle-spec:docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md`; its absence as a local file was not treated as a false source claim.

## Not found / explicitly fine

- **`estimate-actual-boundary-undefined` is resolved at specification level.** S:232–234,397–401 requires every parent/dispatch/shared contribution to fit the accepted window; unknown or crossing parent clocks exclude mission accuracy while preserving quoted totals and independently eligible cases. S:496 and AC-10/14 test the round-3 counterexample.
- **`shared-lock-excludes-existing-writers` is resolved at specification level.** S:120–138 covers participating writers/readers, durable pre-spawn ownership, the registration crash window, descendants, exclusive Git recovery and compatibility detection. Caller death, elapsed time and an empty process listing cannot admit another writer; S:497 and AC-16 require the corresponding barriers.
- Same-boot crash recovery is deliberately conservative: an unfinished operation without containment proof remains blocked; verified reboot closure is an explicit alternative, and doctor cannot force past indeterminate ownership. This is a stated availability tradeoff, not a remaining silent race.
- Accounting completeness is producer-owned and reconciled against the exact quoted output; delivery validates provenance and containment without recomputing or clipping tokenomics minutes. Missing proofs reduce accuracy coverage rather than manufacture actuals.
- Retraction/reinstatement, wrong-item atomic repair, equal-rank semantic conflict and causal quarantine preserve source evidence and prevent filename/arrival order from deciding a completion.
- Durable byte intents, LF delimiting, verified record ranges and manifest publication specify torn-tail recovery without truncating committed history; Git recovery precedes delivery-intent recovery.
- Stable run/item identities, injective version migration, exact case maps and generation/epoch bindings address reused case ids and plan recuts without copying completions.
- Parent completion, cancellation, scope reopening and overlap rules are explicit; cluster dispatch does not fabricate individual case starts, and gate success is distinct from landing and accepted case disposition.
- Bound PR mappings, pagination and pinned integration history cover squash/deleted-branch workflows; a generated fixed-date git fixture avoids moving research-branch totals.
- Missing review/block history stays unknown; fix activity remains a rework proxy; every speed/volume stratum requires quality evidence or explicit unknown denominators.
- Accepted estimates bind metric/version/window and a named human's exact digest; midpoint ratios, MdMRE, PRED(25), point-range treatment and zero denominators are explicit. Confidence prose is not silently promoted to calibration probability.
- UTC half-open windows, full-history replay, carried-in WIP, covered whole weeks and completion conservation are specified; declared coverage is not presented as proof of complete capture.
- First-open and reopened ages use compatible, separate reference populations; repeated reopening preserves history age and first-delivery throughput. These distinctions respect the workflow-boundary requirement in the [Kanban Guide 2025](https://kanbanguides.org/the-kanban-guide/); the Guide does not prescribe a universal P85 sample floor.
- DORA is explicitly excluded: harness integration evidence does not establish production-delivery metrics. [DORA definitions](https://dora.dev/guides/dora-metrics/).
- Claude child identity/transcript correlation remains gated by SPIKE-1, consistent with the documented [SubagentStop inputs](https://code.claude.com/docs/en/hooks#subagentstop); unsupported payloads remain unknown. Copilot automatic capture and live pending-start WIP are explicitly parked.
- Direct/loaded allocation, tokens-only, PROVISIONAL, DRIFT and freshness retain separate meanings; no raw-session addition, feature-task cost invention, per-person ranking, forecast or Little's Law claim is restored.
- Orphan placement, self-contained installation, on-demand roles, owned inner-ignore upgrades and semantic removal have explicit contracts. Stage-label and commit-marker terminology does not restore the forbidden obsolete host architecture.
- This was a specification/source review. No implementation-suite pass is claimed; only this review note was written.

```json findings
{"version": 4, "verdict": "approve", "counts": {"blocker": 0, "major": 0, "minor": 0}, "findings": []}
```

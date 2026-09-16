# delivery-metrics spec v3 — adversarial review (codex gpt-6-astra, round 3)

Date: 2026-09-16.

## Verdict

needs-changes

Counts: **0 blockers / 2 majors / 0 minors**.

No ship. V3 specifies substantive repairs for the previous round, but two contracts still require design decisions: proving the accounting window for mission active minutes, and retaining exclusive telemetry ownership when a crashed caller leaves a Git subprocess running. The existing acceptance tests do not settle either counterexample.

## Findings

Evidence aliases: **S** = `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md`; **TOK** = `bundles/test-automation/skills/tokenomics`. Line numbers refer to the reviewed worktree. Both findings retain the previous round's slug for the underlying contract gap; neither asserts that v3 omitted the repairs it actually specifies.

| id | severity | slug | section | finding | evidence | concrete change |
|---|---|---|---|---|---|---|
| F1 | major | estimate-actual-boundary-undefined | §6.4; §6.12; §12; §17 AC-10/14 | **Dispatch containment does not establish the mission total's accounting window.** V3 binds mission accuracy to scope declaration→first landing, but quotes `totals.activeMin` and requires proof that every contributing dispatch lies within that window. Tokenomics also adds the parent session's active minutes, including work before declaration or after landing; these are not dispatches. For example, all children finish by 10:00, the mission lands at 10:15, and the parent continues reporting until 11:00. A final, fresh, nondrift export can pass every stated dispatch-boundary check while its mission actual includes post-landing work. An implementer must either invent another exclusion rule or report accuracy against the wrong actual. Snapshot hashes prove which bytes were used, not temporal containment of all contributions. | S:225–227 defines the mission total and dispatch-window proof; S:386–388 requires snapshot provenance and quotes the total. TOK/scripts/batch-cost.mjs:530–545 adds the parent remainder to totals, while TOK/hooks/telemetry-capture.mjs:752–754 includes the parent session's full active time. A read-only `buildBatchCost` probe with the same 50-minute child and parent contributions of 5 versus 50 minutes returned mission totals **55 versus 100**, case direct **50** in both, and neither export provisional. | Require window proof for **every accounting contribution**, including parent-session remainders and shared-session allocations. Define a sufficient containment rule and the exact manifest evidence; absent or crossing parent bounds must exclude mission accuracy as `boundary-unknown`, while retaining the quoted historical cost. Do not clip/recompute tokenomics totals in delivery. Alternatively park mission active-minute accuracy. Add a fixture with all child clocks inside the accepted window and parent work outside it; freshness and finality must not make that total eligible. |
| F2 | major | shared-lock-excludes-existing-writers | §6.1; §10; §12; §17 AC-16 | **The stale-owner rule can admit a writer while the previous owner's Git child is still mutating telemetry.** The owner record tracks the caller PID, and a dead same-machine PID permits recovery. Sync runs staging/checkout/merge through child processes. Killing the Node caller does not necessarily terminate an already-running Git child. A second process can therefore recover the apparently dead owner and append or start another sync while the old merge continues, violating the promised exclusive critical section. The delivery transaction-intent recovery does not define recovery of an in-flight Git operation or ownership of surviving descendants. Registry hashes and a nonce passed to JavaScript helpers do not fence an orphaned Git process. | S:114 gives the owner/death rule; S:120–129 requires exclusion through checkout/merge/abort; S:481/485 and AC-16 cover concurrency and live-owner protection but not caller death during a child Git mutation. TOK/hooks/telemetry-capture.mjs:1470–1488 uses `execFileSync` for shared Git mutations; TOK/scripts/install-hooks.mjs:474–487 does likewise for pull. A file-free local Node probe killed an `execFileSync` caller with SIGKILL and observed `{parentExited:true, execFileSyncChildStillAlive:true}` before cleaning up the child. | Extend `telemetry-lock-v1` with a subprocess-lifetime and interrupted-Git recovery contract. Recovery must establish that all prior mutators have stopped, then inspect/recover Git state before admitting another writer; caller PID death alone is insufficient. Specify how ownership survives the spawn/registration crash window and how indeterminate descendants are surfaced rather than bypassed. Add a barrier fixture that kills the Node owner while a Git child is paused during a mutation: a competing append/sync must remain excluded until that operation is terminated or completed and its state recovered. |

## Verified repo claims

The complete “Sources of truth” paragraph at S:11 was checked directly. `ok` means the cited source supports the existing-repository claim, not that delivery's proposed implementation has been verified.

- **ok** — `bundles/SPEC.md:291–304`: roster admission with the legacy missing-type policy, and one self-referential shared telemetry submodule. Its current folder wording is per factory; P-0/P-1 explicitly propose the cross-factory amendments.
- **ok** — `skills.json:246–257`: memory and knowledge-curation demonstrate the orphan `{id, monorepo, name, description}` registration shape.
- **ok** — `bundles/feature-development/factory.json:166–169`: orphan attachment through factory `skills[]`.
- **ok** — `bundles/test-automation/factory.json:11–14`: the same attachment mechanism.
- **ok** — `TOK/scripts/install-hooks.mjs:145–158`: all five named Copilot registrations, including `subagentStop` and `agentStop`. Registration alone does not establish payload fields.
- **ok** — `TOK/hooks/telemetry-capture.mjs:187`: transcript start clock; `:328–333`: sidecar role/description; `:440–447`: label derivation and the live record's end clock, with no start field currently emitted there.
- **ok** — `TOK/hooks/telemetry-capture.mjs:608–620`: Workflow descriptions may be absent; the label derivation searches the first user message for a stage. V3 explicitly requires resolving identifiers before persistence truncation.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1359–1367`: session/agent correlation and parent-transcript directory fallback.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1339`: argument/environment/cwd selection, not a main-worktree walk. V3 correctly identifies worktree resolution as new work.
- **ok** — `TOK/scripts/install-hooks.mjs:305–311`: existing inner ignores cover live/scope transients, not delivery's proposed transients.
- **ok** — `TOK/hooks/telemetry-capture.mjs:1473`: whole-submodule `git add -A`.
- **ok** — `.gitignore:34`: `docs/superpowers/` is ignored. `git ls-files docs/superpowers` establishes tracked paths without establishing historical add commands. V3 makes neither the old volatile-count claim nor the historical-command inference.

## Not found / explicitly fine

- Source-specific retraction/reinstatement, atomic wrong-item repair, causal quarantine and equal-rank disagreement now have explicit rules; the previous round's missing controls are present.
- Torn-tail delimiting, strict record verification, durable intent and manifest publication now specify the previous byte-recovery counterexample; F2 concerns surviving Git processes, not that repaired append protocol.
- The participant migration table and immutable input publication repair the earlier ordinary writer/export race; F2 is the remaining crash-lifetime case.
- Versioned elapsed actuals, exact accepted digests and timely human acceptance resolve the lead-versus-cycle ambiguity; F1 is specifically the mission accounting-contribution gap.
- First-open and reopened ages now use separate compatible reference populations, with no first-cycle fallback and visible history age.
- Explicit DORA exclusion is appropriate: these records do not establish production deployments. [DORA definitions](https://dora.dev/guides/dora-metrics/).
- Defined workflow boundaries, item-count throughput and age/cycle comparisons fit Kanban concepts; the Guide does not mandate a universal P85 sample floor. [Kanban Guide 2025](https://kanbanguides.org/the-kanban-guide/).
- Claude's documented SubagentStop input includes agent/session identity and a child transcript path; v3 still gates actual host/worktree support on SPIKE-1 fixtures rather than claiming the probe has passed. [Claude hooks reference](https://code.claude.com/docs/en/hooks#subagentstop).
- Copilot automatic delivery capture and live pending-start WIP are explicitly parked; their missing implementation is not a finding against this scope.
- Bound PR mappings, pagination, integration epochs, alias normalization and an immutable generated git fixture address squash/deleted-branch blindness and moving golden totals.
- Gate proof is distinct from landing; cluster activity does not manufacture per-case starts; missing review history remains unknown rather than first-pass success.
- UTC half-open windows, carried-in state, whole-week coverage, zero denominators and per-metric short-duration handling have explicit policies.
- Quoted direct/loaded values retain allocation, tokens-only, PROVISIONAL and DRIFT distinctions; no raw-session addition, feature-task cost invention or per-person leaderboard is promised.
- Orphan placement, on-demand attachment, frontmatter, Node ≥18 stdlib ESM, installed tests, skills-ref, duplicate checks and marketplace regeneration are consistent with the checked repository conventions and gates.
- Semantic removal and inner-ignore upgrades are explicit; no obsolete host-mode architecture is introduced by generic references to stage labels or commit markers.
- The reference security-testing spec was read from `feat/security-testing-bundle-spec`; its absence as a local worktree file was not treated as a broken source claim.
- Only this review note was written. The two probes used existing code/in-memory inputs and temporary processes, not added tests or fixtures. No implementation-suite result is claimed for the proposed delivery scripts.

```json findings
{"version": 3, "verdict": "needs-changes", "counts": {"blocker": 0, "major": 2, "minor": 0}, "findings": [{"id": "F1", "severity": "major", "slug": "estimate-actual-boundary-undefined", "title": "Mission total lacks complete accounting-window proof", "sections": ["§6.4", "§6.12", "§12", "§17 AC-10/14"]}, {"id": "F2", "severity": "major", "slug": "shared-lock-excludes-existing-writers", "title": "Dead caller can leave a mutating Git child outside recovered ownership", "sections": ["§6.1", "§10", "§12", "§17 AC-16"]}]}
```

# Security-testing bundle — dogfood `assess` on sdlc-skills (TASK-054)

**Date:** 2026-09-17 · **Branch:** `task/task-054` off `feat/security-testing-bundle-spec` at `a779aef` · **Maintainer:** Daniel Sallai, playing `security-lead`, `security-reviewer` and `threat-modeler` in sequence in one session (no subagents).

**Result:** a `COMMITTED` assessment run exists (`a779aef1bfdb-0002`), `sign-off` exits 0 under the default `executed-or-ticketed` policy, `check --integrity --drift` prints `CONSISTENT` / `CURRENT` / `ORIGIN: unauthenticated` / `KEY: available`, and every gated finding has a register row. A first run (`a779aef1bfdb-0001`) stays `INCOMPLETE` in the ledger by design — see "What was awkward" #1.

## 1. What was run, in one screen

| Step | Command (from the repo root; `<s>` = `.claude/skills/security-evidence/scripts`) | Result line |
|---|---|---|
| install | `node bin/init.mjs init --factory security-testing --target claude --yes` | `Done: 21 installed, 0 skipped.` |
| engagement | `evidence.mjs engagement init` ×2, `engagement validate` | `EDIT-ENGAGEMENT-AND-RERUN` → `KEY: ka0b90a77ebd4 created`, `BASELINE: 32 files ignored=0` → all four validate lines ok |
| run 1 | `run init --kind assessment` → `scope` → `packet --kind scope` → `plan.mjs admit` (dry-run, then real) → `ingest case` → review → `gate` → `coverage` → 3× `packet --kind subject` → 3× `receipt validate` → `receipt apply` → 3× `register add` → `render` → `run snapshot register|proposals` → `tm-lint check` → `packet --subject M-002` → mitigation-review → `receipt validate` → `receipt apply` → `tm-lint check` → `build-report` | `GATE accepted=3`, `COVERAGE examined=6`, `TM-INVALID(T-003: mitigated(M-002): M-002 has no MITIGATION_CONFIRMED state (MITIGATION_INDETERMINATE))`, **`3 INCOMPLETE(dispositions)`** |
| run 2 | the same chain over the corrected model (M-002 cites `bin/init.mjs` 1126-1164 instead of 1158-1164) | `TM elements=13 threats=12 undisposed=10`, `REPORT`, `MANIFEST sha256=695c3e37…`, `COMMITTED` |
| close | `check … --integrity --drift`, `register.mjs check`, `render`, `sign-off --engagement sdlc-skills-dogfood-2026-09`, `anchor print` | `CONSISTENT` `CURRENT` `ORIGIN: unauthenticated` `KEY: available`; `SIGN-OFF: OK`; anchor `sdlc-skills-dogfood-2026-09:5:43dfa8d4c670…` |
| publish | `publish --profile redacted-report --to reports/security` + `check-export`, `publish --profile case --to tasks/security-sdlc-skills-admitted`, `publish --profile handoff …`, `plan.mjs ta-prompt` | `VERIFIED-DERIVATIVE`; one `PUBLISHED profile=case` line (TC-001); both hand-off prompts printed |

Engagement record (the `json engagement` block of `.agents/security-testing/engagement.md`; scope = the code that executes on consumer machines):

```json
{
  "engagement_id": "sdlc-skills-dogfood-2026-09",
  "slug": "sdlc-skills",
  "scope_paths": ["bin/", "hooks/"],
  "product_paths": ["bin/", "hooks/"],
  "targets": { "tracker": ["github.com"], "browser": ["localhost"], "repo": "arozumenko/sdlc-skills" },
  "execute_project_tests": { "argv": ["node", "--test", "bin/"], "timeout_s": 600 },
  "sign_off": { "require_dispositions": "executed-or-ticketed" },
  "artifact_policy": { "ledger": "local", "runs": "local", "receipts": "local", "proposals": "local", "handoffs": "local", "imports": "local", "register": "local", "reports": "local", "cases": "local" }
}
```

## 2. Findings (for the maintainers — the report below is the record)

Three claims over the scope packet, all `CITATION_VERIFIED` at `gate`, each with a register row:

| Finding | Class / priority | State | Row | What to do |
|---|---|---|---|---|
| `f7392ccc…` External skills are cloned from GitHub at a mutable ref with no commit pin or content verification (`bin/init.mjs` 1091-1117, `shallowClone`) | supply-chain / p2 | `REVIEW_CONFIRMED` | R-0001 | pin each `repo:` entry in `skills.json` to a commit (or tag + expected tree hash) and verify before copying |
| `2e7f1b9b…` Symlinks inside a cloned third-party skill are dereferenced and copied into the consumer project (`bin/init.mjs` 140-159, `copyTreeDereferenced`; source 1132-1136, control 1158-1164 covers only the directory *name*) | path-traversal (CWE-59) / p2 | `REVIEW_CONFIRMED` | R-0002 | resolve every symlink relative to the clone root and refuse a target that leaves it |
| `0dd834f1…` Agent name from the SubagentStart payload selects the memory directory read by the hook (`hooks/lib.sh` 236-245; source `hooks/agent-start` 37-41; roster-mode gate `lib.sh` 213-214) | path-traversal / p3, confidence 3 | `REVIEW_INDETERMINATE` (the packet cannot show whether roster mode is on, and no host is known to pass free-form names) | R-0003 | reject a role that is not a bare path segment before `resolve_role_file`, independent of roster mode |

Threat model: 13 elements, 12 threats, 10 undisposed; `T-003` `mitigated(M-002)` (`isBarePathSegment`, `MITIGATION_CONFIRMED` by a mitigation-review over `bin/init.mjs` 1126-1164); `T-004` `planned(dd2a80cf…)` — the admitted passive case TC-001 (inspect the installed hook wiring). The other nine mitigation claims (M-001, M-003…M-010) are not independently reviewed; they are candidates for the next run's `mitigation-review` dispatches. Nothing was posted to a tracker (`publish --profile tracker` and `ingest tracker-readback` are not exercised here).

Coverage is honest and thin: 6 ranges examined (`bin/init.mjs` 1-400 and 800-1240, `hooks/lib.sh`, `hooks/agent-start`, `hooks/session-start`, `hooks/run-hook.cmd`), 29 unexamined (every test file, `validate-factories.mjs`, `gen-marketplaces.mjs`, `check-skill-dupes.mjs`, `bin/lib/*.mjs`, the hook JSON templates, `hooks/README.md`, and `bin/init.mjs` 401-799 and 1241-2724). The report's section 2 says exactly that.

## 3. What was awkward (routed to the maintainers)

1. **One narrow mitigation citation cost a whole run.** The modeler cited M-002 at the *call site* of `isBarePathSegment` (1158-1164). A reviewer reading only that packet cannot see the predicate, so the honest assertion is `indeterminate`; the snapshot is write-once, so the corrected citation (1126-1164, predicate + call site, 39 lines) is a new run — and a new run is the whole chain again (scope, packet, claims, gate, coverage, three subject packets, three receipts, admission, ingest, register snapshot, model, mitigation packet, receipt, lint, report). Every identity came out byte-identical on run 2 (deterministic, as promised), which made the repeat mechanical, but the lead prose could say up front: *cite a mitigation so the packet holds the check and where it is applied, in one ≤40-line range*. `threat-modeling` `references/mitigations-as-claims.md` should carry that sentence.
2. **`security-lead` AGENT.md step 19 ("the `mitigated` disposition costs a run") is contradicted by `threat-modeling` `references/dispositions.md` "Order of operations", and the reference is right.** On run 2 the model was written with `mitigated(M-002)` from the start: the first `tm-lint check` failed on the relationship *after* writing the snapshot, `packet --subject M-002` built from that snapshot, a mitigation-review receipt was validated, and the second `tm-lint check` exited 0 — all inside one run. The lead prose should describe this sequence (it is the TASK-040 PM-log item after G21, now settled by practice) and drop the "costs a run" framing; the run it costs is the one in #1, for a different reason.
3. **`register.mjs add` does not dedupe on a live row with the same subject.** Adding `f7392ccc…` again with `--run a779aef1bfdb-0002` created R-0004 next to R-0001 and open exposure read `p2=3` for two p2 findings. `supersede R-0004 --by R-0001 --subject-equivalent` folds it, but nothing warned. The lead prose says "a register row per accepted finding" and the natural reading on a *second* assessment is "add again". Route to the TASK-028/TASK-030 owner: refuse (or at least print) when a live row with the same subject exists, or have the lead prose say "one row per subject for the life of the engagement; a later run does not re-add".
4. **The redacted-report profile drops whole lines that mention `.agents/`, without a `withheld` marker.** Two casualties in this report: the threat-model element row E-008 (its *name* says "under .agents/") and the `case` import row (its source path is under `.agents/security-testing/cases/`). The tables in the published derivative therefore have silent gaps (`elements_list[7]` is missing between `[6]` and `[8]`). `LOCAL_LAYOUT = /\.agents\//` in `lib/profiles/redacted-report.mjs` is exact by design (TASK-031), but a row of agent-authored prose is not "local layout". Route to the TASK-031 owner: key the drop on the marker (`v:imports[…]`, `v:verify.tests.executable_path`) rather than on the substring, or replace the dropped row with a `withheld` row so the gap is visible.
5. **`render.mjs` strips `<placeholder>` words from reviewer prose as HTML tags.** The stored claim says "fetches `https://github.com/<repo>` at `ref`" and "under `<target>/skills/<name>/`"; the report says "fetches `https://github.com/` at `ref`" and "under `/skills//`". `HTML_TAG = /<\/?[A-Za-z!?][^>]*>/g` is a defensible markup guard, but angle-bracket placeholders are how reviewers write. Route to the TASK-023/024 owner: escape to `&lt;…&gt;` instead of deleting, or document "no angle-bracket placeholders in prose" in `secure-code-review`. The `.agents/` drop in #4 and this together mean the reviewer cannot predict what the published report will say from what they wrote.
6. **`publish --to` refuses any destination outside the work tree** (`USAGE(publish: cannot write … (outside the work tree))`), so the PM ruling "publish the redacted report to a temp dir" is not possible as written. G-5 is right; the ruling and the README's "publish to a directory of your choice" phrasing should say "a directory inside the repository". Published to `reports/security/` (managed-ignored) instead.
7. **Normalised line numbers need tooling.** Every citation, range and snippet is in *normalised* line numbers (blank lines dropped, whitespace collapsed), and `gate` compares the snippet byte-for-byte after normalisation. Writing three claims and thirteen element citations by hand against `git show <oid>` output is error-prone; the reviewer here wrote a 15-line helper (`git show <oid>` → `normalize.mjs` → numbered lines) and a claims generator that *copies* snippets from the normalised bytes. That helper belongs in `security-evidence` (`evidence.mjs show --run <id> <path> [start end]` printing numbered normalised lines at the recorded oid) — without it, a human-driven standalone review will produce `CITATION_FAILED` on the first try.
8. **`engagement init` first-run output has three spellings across the docs.** The script prints `TEMPLATES: engagement.md.template=present finding-schema.md=present report-reading-guide.md=present` (per-file status, because the factory `seed` had already placed the templates); `security-lead` AGENT.md says `TEMPLATES: written`; `references/workflow.md` says `TEMPLATES: written` then `TEMPLATES: present`. The script is the source of truth; the two prose spellings should quote it.
9. **The "fresh dispatch" rule cannot be honoured by one maintainer in one session**, and the bundle has no way to know: the vulnerability-review and mitigation-review receipts here were written by the same context that authored the claims and the model. The receipts are honest (the cited bytes were re-read at the recorded oids), but the report's "confirmed by receipt" reads stronger than it is. Recorded as a deviation below; nothing in the scripts could have caught it, which is spec §2's "that a model read what it declared examined" limitation, stated.
10. **This repository ignores `.agents/`, `reports/`, `tasks/*` and `.claude/`** (its own conventions), so the plan's Verification line "`git status --porcelain` shows only the managed block, `engagement.md`, `risk-register.md` and intended publications" reads here as: only `.gitignore` (the managed block), `AGENTS.md` and `CLAUDE.md` (the FACTORY splice) show; `engagement.md`, `risk-register.md`, `threat-model.json` and the candidate case are invisible to git. Consequence: the candidate case is not a blob at head, so only the heuristic admission route was exercised (the review route needs `packet --type case` over a committed blob). After reverting the splice and the block (PM ruling 5) `engagement validate` prints `IGNORE-BLOCK: stale` (exit 4) — expected, and the reason the reverted block is the last transcript entry.
11. **Two `node --test` footguns for the dogfood itself.** (a) The installed copy under `.claude/skills/security-evidence/scripts/` carries every `*.test.mjs`; `node --test` at the repo root would sweep it if the runner descended into dot-directories (it does not, so `npm test` stays at the base count). (b) `execute_project_tests.argv = ["node","--test","bin/"]` is the ruling's shape; `verify.mjs all` was not exercised (no fix commit), so whether Node 24 accepts a directory operand under `--test` inside the verify worktree is untested.
12. **Small things.** `plan.mjs admit --dry-run` prints its "nothing persisted" line on stderr while the `ADMISSION` line is on stdout — fine, but the transcript shows it as `[stderr]`, which reads like a warning. `register.mjs status` prints `COUNT superseded …` rows but the risk-register view has no superseded section (R-0004 is only visible in the rows table). `tm-lint.mjs render` writes `<run>/threat-model.md`, which nothing later reads — a nice human view, worth mentioning in the lead's step 17 as optional output rather than leaving it to be discovered.

Items already routed to this task by earlier PM logs and **not** taken here (PM ruling 5: the only committed file is this note): `bundles/security-testing/README.md:108` (stale "NOT-IMPLEMENTED(M3)" text), `README.md:~103` (codex row wording), `README.md:315` (standalone step 13), `skills/security-engagement/references/workflow.md` step 2 (M1-dated sentence), `security-lead` AGENT.md:396 (`INCOMPLETE(dispositions)` cause). They stand as routed; #2 and #8 above add to the same README/prose pass.

## 4. Deviations from the plan text

- The task's Verification names no test file and PM ruling 5 limits the commit to this note, so there is no `*.test.mjs` and no red/green — the same shape TASK-049 recorded ("a test asserting a prose bullet is tautological"). The red/green here is the transcript: `3 INCOMPLETE(dispositions)` on run 1, `COMMITTED` + `SIGN-OFF: OK` on run 2.
- The three roles ran in one context (PM ruling 3); the fresh-dispatch rule of `security-reviewer` (`REFUSED fresh-dispatch`) was knowingly not applied — see awkward #9.
- `run snapshot verify` was not run for real (no verify run exists); one probe against the COMMITTED run recorded the `RUN-COMMITTED` refusal.
- `publish --profile redacted-report` went to `reports/security/` inside the tree, not to a temp dir — see awkward #6. The report below is pasted from `reports/security/report.md` (sha256 `a2b3fc0f…`, `VERIFIED-DERIVATIVE` against the run).
- The FACTORY splice in `AGENTS.md`/`CLAUDE.md` and the managed `.gitignore` block were reverted with `git checkout --` before the commit, as ruled; the transcript records it and the resulting `IGNORE-BLOCK: stale`.
- Memory logs were written for the three roles under `.agents/memory/<role>/daily/2026-09-17.md` (ignored here, per the agents' Session End rule).

## 5. Redacted report (`publish --profile redacted-report`, run `a779aef1bfdb-0002`, verbatim)

Source: `reports/security/report.md`, sha256 `a2b3fc0fd7dd5f4c38c1c56db332e13f5db59176f31284d9e80e8e11d2e4eea2`; `check-export reports/security/export-manifest.json --source .agents/security-testing/runs/a779aef1bfdb-0002` ⇒ `VERIFIED-DERIVATIVE`. The `<!-- v:… -->` markers are the renderer's (TL-7); the gaps at `elements_list[7]` and the empty imports table are awkward #4.

`````markdown
# Security assessment — run a779aef1bfdb-0002 <!-- v:run.run_id -->

## 1. Identity

- run: a779aef1bfdb-0002 <!-- v:run.run_id -->
- engagement: sdlc-skills-dogfood-2026-09 <!-- v:run.engagement_id -->
- seq: 2 <!-- v:run.seq -->
- kind: assessment <!-- v:run.kind -->
- base_oid: a779aef1bfdb7835b9abc2c9524a46de4b68b076 <!-- v:run.base_oid -->
- head_oid: a779aef1bfdb7835b9abc2c9524a46de4b68b076 <!-- v:run.head_oid -->
- key: available <!-- v:key -->

Timestamps live in artifact envelopes and are part of no identity (spec §6.1); this report carries none. The assessment is a clean tree at `head_oid` for the assessed paths (D18 / P6).

## 2. Coverage

- status: determinate <!-- v:coverage.indeterminate -->
- examined: 6 <!-- v:coverage.counts.examined -->
- scanner-only: 0 <!-- v:coverage.counts.scanner-only -->
- unexamined: 29 <!-- v:coverage.counts.unexamined -->
- skipped: 0 <!-- v:coverage.counts.skipped -->

| path | range | status | by |
|---|---|---|---|
| bin/agent-skill-deps.test.mjs | 1-25 | unexamined | (none) | <!-- v:coverage.accounting[0] -->
| bin/check-skill-dupes.mjs | 1-101 | unexamined | (none) | <!-- v:coverage.accounting[1] -->
| bin/check-skill-dupes.test.mjs | 1-53 | unexamined | (none) | <!-- v:coverage.accounting[2] -->
| bin/frontmatter-strict.test.mjs | 1-79 | unexamined | (none) | <!-- v:coverage.accounting[3] -->
| bin/gen-marketplaces.mjs | 1-219 | unexamined | (none) | <!-- v:coverage.accounting[4] -->
| bin/gen-marketplaces.test.mjs | 1-63 | unexamined | (none) | <!-- v:coverage.accounting[5] -->
| bin/hook-role-defaults.test.mjs | 1-71 | unexamined | (none) | <!-- v:coverage.accounting[6] -->
| bin/init.mjs | 1-400 | examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:coverage.accounting[7] -->
| bin/init.mjs | 401-799 | unexamined | (none) | <!-- v:coverage.accounting[8] -->
| bin/init.mjs | 800-1240 | examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:coverage.accounting[9] -->
| bin/init.mjs | 1241-2724 | unexamined | (none) | <!-- v:coverage.accounting[10] -->
| bin/install-external-name.test.mjs | 1-51 | unexamined | (none) | <!-- v:coverage.accounting[11] -->
| bin/lib/factory-selection.mjs | 1-93 | unexamined | (none) | <!-- v:coverage.accounting[12] -->
| bin/lib/factory-selection.test.mjs | 1-124 | unexamined | (none) | <!-- v:coverage.accounting[13] -->
| bin/lib/item-resolver.mjs | 1-76 | unexamined | (none) | <!-- v:coverage.accounting[14] -->
| bin/lib/item-resolver.test.mjs | 1-69 | unexamined | (none) | <!-- v:coverage.accounting[15] -->
| bin/lib/skill-md.mjs | 1-41 | unexamined | (none) | <!-- v:coverage.accounting[16] -->
| bin/no-tools-frontmatter.test.mjs | 1-25 | unexamined | (none) | <!-- v:coverage.accounting[17] -->
| bin/sibling-hooks.test.mjs | 1-49 | unexamined | (none) | <!-- v:coverage.accounting[18] -->
| bin/skills-on-demand.test.mjs | 1-96 | unexamined | (none) | <!-- v:coverage.accounting[19] -->
| bin/validate-externals.test.mjs | 1-284 | unexamined | (none) | <!-- v:coverage.accounting[20] -->
| bin/validate-factories.mjs | 1-571 | unexamined | (none) | <!-- v:coverage.accounting[21] -->
| bin/validate-factories.test.mjs | 1-40 | unexamined | (none) | <!-- v:coverage.accounting[22] -->
| hooks/README.md | 1-147 | unexamined | (none) | <!-- v:coverage.accounting[23] -->
| hooks/agent-start | 1-61 | examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:coverage.accounting[24] -->
| hooks/agent-start.test.mjs | 1-319 | unexamined | (none) | <!-- v:coverage.accounting[25] -->
| hooks/config.sh.example | 1-43 | unexamined | (none) | <!-- v:coverage.accounting[26] -->
| hooks/hooks-codex.json | 1-28 | unexamined | (none) | <!-- v:coverage.accounting[27] -->
| hooks/hooks-copilot.json | 1-31 | unexamined | (none) | <!-- v:coverage.accounting[28] -->
| hooks/hooks-cursor.json | 1-10 | unexamined | (none) | <!-- v:coverage.accounting[29] -->
| hooks/hooks-kiro.json | 1-15 | unexamined | (none) | <!-- v:coverage.accounting[30] -->
| hooks/hooks.json | 1-28 | unexamined | (none) | <!-- v:coverage.accounting[31] -->
| hooks/lib.sh | 1-650 | examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:coverage.accounting[32] -->
| hooks/run-hook.cmd | 1-56 | examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:coverage.accounting[33] -->
| hooks/session-start | 1-153 | examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:coverage.accounting[34] -->

Scanner rows (presence of a scanner import over a path, never a finding):

(no scanner rows) <!-- v:coverage.scanner_rows -->

## 3. Executive summary

- findings gated: 3 <!-- v:summary.total -->
- accepted at gate (CITATION_VERIFIED): 3 <!-- v:summary.accepted -->
- unverifiable at gate (CITATION_FAILED): 0 <!-- v:summary.unverifiable -->
- rejected candidates: 0 <!-- v:summary.rejected_total -->
- unlocated candidates: 0 <!-- v:summary.unlocated -->
- unauthenticated approvals: 0 <!-- v:summary.unauthenticated_approvals -->
- incomplete runs: see sign-off (INCOMPLETE: listing) — the ledger is outside the run directory (TL-3), so this report cannot count them <!-- v:summary.incomplete_runs -->

Counts by priority × state:

| priority | CITATION_VERIFIED | CITATION_FAILED | REVIEW_CONFIRMED | REVIEW_REFUTED | REVIEW_INDETERMINATE |
|---|---|---|---|---|---|
| p0 | 0 | 0 | 0 | 0 | 0 | <!-- v:summary.by_priority_state.p0 -->
| p1 | 0 | 0 | 0 | 0 | 0 | <!-- v:summary.by_priority_state.p1 -->
| p2 | 0 | 0 | 2 | 0 | 0 | <!-- v:summary.by_priority_state.p2 -->
| p3 | 0 | 0 | 0 | 0 | 1 | <!-- v:summary.by_priority_state.p3 -->

Unresolved (citation failed) by priority:

| priority | unresolved |
|---|---|
| p0 | 0 | <!-- v:summary.unresolved_by_priority.p0 -->
| p1 | 0 | <!-- v:summary.unresolved_by_priority.p1 -->
| p2 | 0 | <!-- v:summary.unresolved_by_priority.p2 -->
| p3 | 0 | <!-- v:summary.unresolved_by_priority.p3 -->

Rejected candidates by reason:

(none) <!-- v:summary.rejected_by_reason -->

## 4. Scope and rules of engagement

- engagement_id: sdlc-skills-dogfood-2026-09 <!-- v:engagement.engagement_id -->
- slug: sdlc-skills <!-- v:engagement.slug -->
- scope_paths: bin/, hooks/ <!-- v:engagement.scope_paths -->
- product_paths: bin/, hooks/ <!-- v:engagement.product_paths -->
- targets.tracker: github.com <!-- v:engagement.targets_tracker -->
- targets.browser: localhost <!-- v:engagement.targets_browser -->
- targets.repo: arozumenko/sdlc-skills <!-- v:engagement.targets_repo -->
- base_url: unknown / not assessed <!-- v:engagement.base_url -->
- execute_project_tests: present: 3 argv tokens, timeout_s=600, install absent <!-- v:engagement.execute_project_tests -->
- require_dispositions: executed-or-ticketed <!-- v:engagement.require_dispositions -->
- artifact_policy: cases=local, handoffs=local, imports=local, ledger=local, proposals=local, receipts=local, register=local, reports=local, runs=local <!-- v:engagement.artifact_policy -->

Inputs ingested (redacted import records under ingest/):

| kind | import_sha256 | source | records | unlocated | rejected |
|---|---|---|---|---|---|

Scope files:

| path | side | oid | lines | admitted ranges |
|---|---|---|---|---|
| bin/agent-skill-deps.test.mjs | head | 991e2080ea865a54c96cd34ebdde7a58f01e6e8f | 25 | 1-25 | <!-- v:scope.files[0] -->
| bin/check-skill-dupes.mjs | head | 96b1a4db793a0b3326a69571461c70813148a9a2 | 101 | 1-101 | <!-- v:scope.files[1] -->
| bin/check-skill-dupes.test.mjs | head | 7d5cf5e0a7046fbbc87224c59f673c4610e4f81b | 53 | 1-53 | <!-- v:scope.files[2] -->
| bin/frontmatter-strict.test.mjs | head | 29ddd9ad5273ba951afafbe3bb319805af02cd13 | 79 | 1-79 | <!-- v:scope.files[3] -->
| bin/gen-marketplaces.mjs | head | 350199304d51b97e46daf256fb7005b36f31b2fa | 219 | 1-219 | <!-- v:scope.files[4] -->
| bin/gen-marketplaces.test.mjs | head | 2abbd362676953484ad00ebb52b12edd5860b594 | 63 | 1-63 | <!-- v:scope.files[5] -->
| bin/hook-role-defaults.test.mjs | head | d6934dd669fc15c737d8ecb0e42127f49ec65c47 | 71 | 1-71 | <!-- v:scope.files[6] -->
| bin/init.mjs | head | 6d672ce1747ee69617d97cad9ad8c0f79bddfc88 | 2724 | 1-2724 | <!-- v:scope.files[7] -->
| bin/install-external-name.test.mjs | head | 5208959406aa31911c91ea67784195582b616d26 | 51 | 1-51 | <!-- v:scope.files[8] -->
| bin/lib/factory-selection.mjs | head | b14a5d07e9d28e260085c79c5b21119d6e3b3187 | 93 | 1-93 | <!-- v:scope.files[9] -->
| bin/lib/factory-selection.test.mjs | head | e8afbc3f4e4471e2ba62786933505e7df497ada8 | 124 | 1-124 | <!-- v:scope.files[10] -->
| bin/lib/item-resolver.mjs | head | 701ac75804c0ed217fabae7807885160f29e5b29 | 76 | 1-76 | <!-- v:scope.files[11] -->
| bin/lib/item-resolver.test.mjs | head | 07b0731bb6881f7ff108e9c679a8a4392ac56547 | 69 | 1-69 | <!-- v:scope.files[12] -->
| bin/lib/skill-md.mjs | head | 9405bd1b8ee9a6f66d26f1ef06202308b5b6c813 | 41 | 1-41 | <!-- v:scope.files[13] -->
| bin/no-tools-frontmatter.test.mjs | head | e4038f16a735c7f063d079e7fef443bb3d5fb1d3 | 25 | 1-25 | <!-- v:scope.files[14] -->
| bin/sibling-hooks.test.mjs | head | 573964176d0d0c794dfba154c8c82e51438aa4fa | 49 | 1-49 | <!-- v:scope.files[15] -->
| bin/skills-on-demand.test.mjs | head | 9a14bd22eead0f38ec13749b7627f50ec8fd66c9 | 96 | 1-96 | <!-- v:scope.files[16] -->
| bin/validate-externals.test.mjs | head | b2ed3df04704457ac1b981d33c26ece53e3eef6c | 284 | 1-284 | <!-- v:scope.files[17] -->
| bin/validate-factories.mjs | head | 887b4f04dfc1cdacb8efd429587fb436e7a46a34 | 571 | 1-571 | <!-- v:scope.files[18] -->
| bin/validate-factories.test.mjs | head | 90c67bb2b162e5d7b9d63281c1b11c40a94b6446 | 40 | 1-40 | <!-- v:scope.files[19] -->
| hooks/README.md | head | ccc4e0ab9741d83f63f6a596a586ea488b6c5907 | 147 | 1-147 | <!-- v:scope.files[20] -->
| hooks/agent-start | head | b5f1f025925ce68beee9f1990231f00682886f2c | 61 | 1-61 | <!-- v:scope.files[21] -->
| hooks/agent-start.test.mjs | head | 149553c4671adedfe86ba93ebd7336551c78b360 | 319 | 1-319 | <!-- v:scope.files[22] -->
| hooks/config.sh.example | head | e692ad4364975e8a5557f08825abfb50ba61326e | 43 | 1-43 | <!-- v:scope.files[23] -->
| hooks/hooks-codex.json | head | 080267e44be6c863de7261fcc04c704e2b13bb7b | 28 | 1-28 | <!-- v:scope.files[24] -->
| hooks/hooks-copilot.json | head | 95eb39122026afdff66f9c1f8a6f29fb2e9412d2 | 31 | 1-31 | <!-- v:scope.files[25] -->
| hooks/hooks-cursor.json | head | 84e6d33874ab5926035e35bc13dccf21244bb079 | 10 | 1-10 | <!-- v:scope.files[26] -->
| hooks/hooks-kiro.json | head | 47ca852ca56defcdba6880406de4a0755401e3fb | 15 | 1-15 | <!-- v:scope.files[27] -->
| hooks/hooks.json | head | 8e63fb6f5ef0621ddb94b69f8d9e01fb3b5ddf87 | 28 | 1-28 | <!-- v:scope.files[28] -->
| hooks/lib.sh | head | 7027adaa55b0c1ec309b6d8759b014736e9bd5ec | 650 | 1-650 | <!-- v:scope.files[29] -->
| hooks/run-hook.cmd | head | 7f0921b907ed81c6d3c23a173825bfb1b7491e5e | 56 | 1-56 | <!-- v:scope.files[30] -->
| hooks/session-start | head | c9423a01605b67aa7cc3d5de6261eec55d0f175d | 153 | 1-153 | <!-- v:scope.files[31] -->

Skipped files:

(none) <!-- v:scope.skipped -->

- private redacted snapshots (dirty review files): 0 <!-- v:scope.snapshot_files -->

Rules of engagement: read-only toward product code; no merge, close, rotate or fix; passive review over the scope packet only (D5, §4 body rules). Test argv, when any, comes only from the operator record in `engagement.md`, whose authorship is unverified.

## 5. Methodology

Threat-led security assessment: a code-derived threat model with a citation per element; evidence-gated secure code review — a reviewer produces claims over a scope packet, `gate` derives every id and citation state from the bytes at the cited side, a fresh reviewer may confirm, refute or leave a finding indeterminate through a receipt over a subject packet; mitigation claims reviewed the same way; fix verification from a validated test-start snapshot with a script-emitted verdict; a residual-risk register with unauthenticated acceptance records. Scripts derive every state, verdict and count shown here. Exploitation is excluded. This is a security assessment, not a penetration test.

## 6. Limitations

- KEY: available — every keyed identity re-derived <!-- v:limitations[0] -->
- receipts not applied: 0 <!-- v:limitations[1] -->
- conflicting receipts: 0 <!-- v:limitations[2] -->
- data-flow findings without typed citations: (none) <!-- v:limitations[3] -->
- redaction rules version: 1 <!-- v:limitations[4] -->
- outside the local policy: (none — every artifact_policy entry is local) <!-- v:limitations[6] -->
- verify runs snapshotted: 0 — no fix has been verified in this assessment <!-- v:limitations[7] -->
- register snapshot: seq 5, 4 rows, 0 unauthenticated approval record(s) — none is authenticated (D15) <!-- v:limitations[8] -->

Not guaranteed (spec §2): origin of a consistent set; that a model read what it declared examined; test meaningfulness; that the class is closed at the sink; suppression detection beyond lexical indicators; detection of secrets outside the redaction rule list; that any human approved anything; attribution of a working-tree change to a role. `check` recomputes every derived value from the recorded inputs and prints `ORIGIN: unauthenticated` unless a consumer-held digest is supplied. Local artifacts are not confidential artifacts: local ≠ confidential.

## 7. Risk methodology

Priority `p0`–`p3` and confidence `0`–`10` are the reviewer's assertions, recorded as claimed; gate rejects a claim that omits or caps neither (`claim-invalid`), never defaults them. States are script-derived: `CITATION_VERIFIED | CITATION_FAILED` from gate, `REVIEW_CONFIRMED | REVIEW_REFUTED | REVIEW_INDETERMINATE` from applied vulnerability-review receipts, `MITIGATION_CONFIRMED | MITIGATION_GAP | MITIGATION_INDETERMINATE` from applied mitigation-review receipts, verify verdicts from `verify.mjs evaluate` over each snapshotted `verify.json`, register statuses from `register.mjs replay` over the events snapshot. Open exposure is never reduced by an acceptance, a false-positive record or an ack (spec §6.8). Unresolved = findings whose citation failed.

## 8. Findings

### 8.1. Agent name from the SubagentStart payload selects the memory directory read by the hook <!-- v:findings[0].title -->

| field | value |
|---|---|
| id | 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 | <!-- v:findings[0].id -->
| class / CWE | path-traversal / CWE-22 | <!-- v:findings[0].class -->
| priority | p3 | <!-- v:findings[0].priority -->
| confidence | 3 | <!-- v:findings[0].confidence -->
| state | REVIEW_INDETERMINATE | <!-- v:findings[0].state -->
| citation state | CITATION_VERIFIED | <!-- v:findings[0].citation_state -->
| review | indeterminate by receipt f9ef0e41ff6079809a949ac4e0b6e36025771b29d5ab3c99aaf67bca029cf064 | <!-- v:findings[0].review -->
| affected asset | hooks/lib.sh:236-245 @ head | <!-- v:findings[0].asset -->
| occurrence | 0 | <!-- v:findings[0].occurrence -->
| source | agent 055e816a645e3e6f9b63d5fcd4d0b7a117f42b1cfccd5a8ed1cb7098b1f1f1de #2 | <!-- v:findings[0].source -->
| sensitive | no | <!-- v:findings[0].sensitive -->
| typed citations required | yes | <!-- v:findings[0].requires_typed_citations -->
| ticket_url | unknown / not assessed | <!-- v:findings[0].ticket_url -->
| verification history | add@seq3 (R-0003) | <!-- v:findings[0].verification_history -->

- Impact: On a legacy (non-roster) install, a payload naming a traversal role injects any file named SOUL.md, RULES.md, snapshot.md, MEMORY.md or project_briefing.md reachable from the project directory into an agent's context; only those five names are readable. <!-- v:findings[0].impact -->
- Prerequisites: A host that forwards an unvalidated agent name in the payload, and a hooks install predating config-defaults.sh (roster mode off). Neither is shown in the packet; raise confidence if a host is found that passes free-form names. <!-- v:findings[0].prerequisites -->
- Remediation: Reject a role that is not a bare path segment (no `/`, `\`, `.`/`..`) before resolve_role_file, independent of roster mode. <!-- v:findings[0].remediation -->

Evidence (snippet): withheld by the redacted-report profile <!-- v:findings[0].evidence -->

Typed citations:

| role | path | side | lines | context |
|---|---|---|---|---|
| source | hooks/agent-start | head | 37-41 | true | <!-- v:findings[0].citations_typed[0] -->
| control | hooks/lib.sh | head | 111-116 | true | <!-- v:findings[0].citations_typed[1] -->
| control | hooks/lib.sh | head | 213-214 | true | <!-- v:findings[0].citations_typed[2] -->
| sink | hooks/lib.sh | head | 238-242 | true | <!-- v:findings[0].citations_typed[3] -->

### 8.2. Symlinks inside a cloned third-party skill are dereferenced and copied into the consumer project <!-- v:findings[1].title -->

| field | value |
|---|---|
| id | 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c | <!-- v:findings[1].id -->
| class / CWE | path-traversal / CWE-59 | <!-- v:findings[1].class -->
| priority | p2 | <!-- v:findings[1].priority -->
| confidence | 7 | <!-- v:findings[1].confidence -->
| state | REVIEW_CONFIRMED | <!-- v:findings[1].state -->
| citation state | CITATION_VERIFIED | <!-- v:findings[1].citation_state -->
| review | confirmed by receipt 7e639b49d9cf32a3dd36463d09d8caa5ede947b1d3d2acee9225b4c4e6830303 | <!-- v:findings[1].review -->
| affected asset | bin/init.mjs:140-159 @ head | <!-- v:findings[1].asset -->
| occurrence | 0 | <!-- v:findings[1].occurrence -->
| source | agent 055e816a645e3e6f9b63d5fcd4d0b7a117f42b1cfccd5a8ed1cb7098b1f1f1de #1 | <!-- v:findings[1].source -->
| sensitive | no | <!-- v:findings[1].sensitive -->
| typed citations required | yes | <!-- v:findings[1].requires_typed_citations -->
| ticket_url | unknown / not assessed | <!-- v:findings[1].ticket_url -->
| verification history | add@seq2 (R-0002) | <!-- v:findings[1].verification_history -->

- Description: installExternalSkill hands the cloned tree (`src`) to copyTreeDereferenced, which on every symlink — top-level or nested — calls realpathSync and copies whatever the link resolves to. The only guard on upstream content is isBarePathSegment over the SKILL.md `name:`; the entries of the tree are not confined to the clone. A symlink committed upstream that points at an absolute path or climbs out of the clone (`../../../../.ssh/id_rsa`) is materialised as a regular file under `/skills//`. <!-- v:findings[1].description -->
- Impact: Local file disclosure into the consumer's project tree: the copied file is a plain file in the working tree, likely committed and pushed with the install; combined with the mutable-ref fetch, one upstream commit reaches every consumer. <!-- v:findings[1].impact -->
- Prerequisites: An upstream repo in skills.json ships a symlink whose target is outside the clone; the consumer installs that skill without `--symlink` (the default) on a platform where git materialises symlinks. <!-- v:findings[1].prerequisites -->
- Remediation: Resolve each symlink relative to the clone root and refuse (or skip with a notice) any target that does not stay under the clone before copying. <!-- v:findings[1].remediation -->

Evidence (snippet): withheld by the redacted-report profile <!-- v:findings[1].evidence -->

Typed citations:

| role | path | side | lines | context |
|---|---|---|---|---|
| source | bin/init.mjs | head | 1132-1136 | true | <!-- v:findings[1].citations_typed[0] -->
| sink | bin/init.mjs | head | 144-146 | true | <!-- v:findings[1].citations_typed[1] -->
| sink | bin/init.mjs | head | 154-156 | true | <!-- v:findings[1].citations_typed[2] -->
| control | bin/init.mjs | head | 1158-1164 | true | <!-- v:findings[1].citations_typed[3] -->

### 8.3. External skills are cloned from GitHub at a mutable ref with no commit pin or content verification <!-- v:findings[2].title -->

| field | value |
|---|---|
| id | f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 | <!-- v:findings[2].id -->
| class / CWE | supply-chain / CWE-494 | <!-- v:findings[2].class -->
| priority | p2 | <!-- v:findings[2].priority -->
| confidence | 8 | <!-- v:findings[2].confidence -->
| state | REVIEW_CONFIRMED | <!-- v:findings[2].state -->
| citation state | CITATION_VERIFIED | <!-- v:findings[2].citation_state -->
| review | confirmed by receipt aaaf254e68b567cec44273e7cb88f612f663b22eb72f0ce527e2b9520a9db3d6 | <!-- v:findings[2].review -->
| affected asset | bin/init.mjs:1091-1117 @ head | <!-- v:findings[2].asset -->
| occurrence | 0 | <!-- v:findings[2].occurrence -->
| source | agent 055e816a645e3e6f9b63d5fcd4d0b7a117f42b1cfccd5a8ed1cb7098b1f1f1de #0 | <!-- v:findings[2].source -->
| sensitive | no | <!-- v:findings[2].sensitive -->
| typed citations required | no | <!-- v:findings[2].requires_typed_citations -->
| ticket_url | unknown / not assessed | <!-- v:findings[2].ticket_url -->
| verification history | add@seq1 (R-0001); add@seq4 (R-0004); supersede@seq5 (R-0004) | <!-- v:findings[2].verification_history -->

- Description: shallowClone fetches `https://github.com/` at `ref` (default `main`, a branch name) with `--depth 1`, or `git fetch origin ` + `checkout FETCH_HEAD` on a cached clone, and returns the checkout as the install source. No commit id, tag signature or content hash is recorded or compared: whatever the branch points at when the consumer runs `init` is what lands in the project and is later loaded into agent context as instructions. <!-- v:findings[2].description -->
- Impact: A compromised or force-pushed upstream branch (any of the registry's third-party repos) becomes installed skill content on every consumer machine that runs `init` or `--update` afterwards; the content is executed as agent instructions, and `--symlink` installs track the cache live. <!-- v:findings[2].impact -->
- Prerequisites: Write access to an upstream branch named in skills.json, or a compromised GitHub account holding one; the consumer runs the installer after the change. <!-- v:findings[2].prerequisites -->
- Remediation: Pin each `repo:` entry to a commit id (or a tag plus expected tree hash) in skills.json and verify the checked-out commit before copying. <!-- v:findings[2].remediation -->

Evidence (snippet): withheld by the redacted-report profile <!-- v:findings[2].evidence -->

Typed citations: (none) <!-- v:findings[2].citations_typed -->

Verification history (each snapshotted verify.json, evaluated by `verify.mjs evaluate` — never free text):

(no verify snapshots) <!-- v:verify_history -->

## 9. Unresolved candidates

Citation failed (the claimed text is not what the cited side holds):

(none) <!-- v:unresolved.citation_failed -->

Unlocated scanner candidates (never gated):

(none) <!-- v:unresolved.unlocated -->

QA FAIL observations (passive cases the QA bundles ran; an observation is never a finding):

(none) <!-- v:unresolved.qa_fail -->

A FAIL observation stays a candidate: a mitigation decision needs a separate `mitigation-review` receipt citing the observation (spec §9.2); no state is derived for an observation here.

- browser-evidence candidates: unknown / not assessed — no browser-evidence input at M1 <!-- v:unresolved.browser_evidence -->

## 10. Threat model and mitigation states

- elements: 13 <!-- v:threat_model.elements -->
- threats: 12 <!-- v:threat_model.threats.length -->
- undisposed: 10 <!-- v:threat_model.undisposed -->

Dispositions by kind (spec §6.10):

| kind | threats |
|---|---|
| undisposed | 10 | <!-- v:threat_model.by_disposition.undisposed -->
| planned | 1 | <!-- v:threat_model.by_disposition.planned -->
| executed | 0 | <!-- v:threat_model.by_disposition.executed -->
| ticketed | 0 | <!-- v:threat_model.by_disposition.ticketed -->
| accepted | 0 | <!-- v:threat_model.by_disposition.accepted -->
| mitigated | 1 | <!-- v:threat_model.by_disposition.mitigated -->

Elements (one citation each):

| id | kind | name | citation |
|---|---|---|---|
| E-001 | external | Upstream skill repositories on github.com (skills.json repo: entries) | bin/init.mjs:1107-1111 @ head | <!-- v:threat_model.elements_list[0] -->
| E-002 | process | Installer entry point (bin/init.mjs main) | bin/init.mjs:2450-2467 @ head | <!-- v:threat_model.elements_list[1] -->
| E-003 | datastore | Shared clone cache under ~/.cache/sdlc-skills/registry | bin/init.mjs:1081-1090 @ head | <!-- v:threat_model.elements_list[2] -->
| E-004 | datastore | Consumer project host directory (.claude/skills, .claude/agents, settings.json) | bin/init.mjs:1182-1187 @ head | <!-- v:threat_model.elements_list[3] -->
| E-005 | boundary | Third-party clone content crossing into the consumer project tree (copyTreeDereferenced) | bin/init.mjs:140-159 @ head | <!-- v:threat_model.elements_list[4] -->
| E-006 | process | session-start hook (project context injection at session start) | hooks/session-start:21-30 @ head | <!-- v:threat_model.elements_list[5] -->
| E-007 | process | agent-start hook (per-role memory injection at subagent dispatch) | hooks/agent-start:30-43 @ head | <!-- v:threat_model.elements_list[6] -->
| E-009 | boundary | Repository content crossing into agent context (additionalContext emission) | hooks/lib.sh:639-650 @ head | <!-- v:threat_model.elements_list[8] -->
| E-010 | flow | Hook payload on stdin from the host runtime | hooks/lib.sh:35-49 @ head | <!-- v:threat_model.elements_list[9] -->
| E-011 | datastore | Hook tunables config.sh and generated config-defaults.sh sourced by lib.sh | hooks/lib.sh:17-25 @ head | <!-- v:threat_model.elements_list[10] -->
| E-012 | process | Copilot instruction-file mirror (refresh_shared_instructions) | hooks/lib.sh:483-509 @ head | <!-- v:threat_model.elements_list[11] -->
| E-013 | process | Hook wiring writer (installCoreHooks merges commands into the host hook config) | bin/init.mjs:938-961 @ head | <!-- v:threat_model.elements_list[12] -->

Threats (STRIDE per element; disposition as recorded in the model):

| id | element | stride | title | disposition | mitigations |
|---|---|---|---|---|---|
| T-001 | E-001 | S | An upstream branch is replaced (force-push, account takeover) and its content is installed as trusted skill text | undisposed | M-001 | <!-- v:threat_model.threats[0] -->
| T-002 | E-005 | I | A symlink committed upstream is dereferenced and a local file outside the clone is copied into the consumer project | undisposed | (none) | <!-- v:threat_model.threats[1] -->
| T-003 | E-005 | T | An upstream SKILL.md name carrying a path separator places the installed skill outside the skills directory | mitigated (M-002) | M-002 | <!-- v:threat_model.threats[2] -->
| T-004 | E-013 | T | The hook command written into the host settings names a script outside the project or an interpreter with extra arguments | planned (dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e) | M-003 | <!-- v:threat_model.threats[3] -->
| T-005 | E-003 | T | A stale or poisoned cache clone is reused as the install source without re-validation against upstream | undisposed | M-004 | <!-- v:threat_model.threats[4] -->
| T-006 | E-009 | T | Instructions planted in a shared doc or a role memory file are injected into every agent context as standing guidance | undisposed | M-005 | <!-- v:threat_model.threats[5] -->
| T-007 | E-009 | D | An over-budget memory or shared doc makes the host drop the whole injected payload so the agent runs without its rules | undisposed | M-006 | <!-- v:threat_model.threats[6] -->
| T-008 | E-010 | T | A crafted agent name in the SubagentStart payload selects a memory directory outside the project | undisposed | M-007 | <!-- v:threat_model.threats[7] -->
| T-009 | E-011 | T | A committed config.sh in the hooks directory runs arbitrary shell at every session start on every machine that installs the project | undisposed | (none) | <!-- v:threat_model.threats[8] -->
| T-010 | E-012 | T | A human-authored Copilot instruction file is overwritten by the generated mirror of a shared doc | undisposed | M-008 | <!-- v:threat_model.threats[9] -->
| T-011 | E-009 | I | A raw control character in an injected document breaks the JSON payload and the host silently drops the context | undisposed | M-009 | <!-- v:threat_model.threats[10] -->
| T-012 | E-004 | T | An --update install removes and rewrites a path derived from third-party content inside the host directory | undisposed | M-010 | <!-- v:threat_model.threats[11] -->

Mitigation states (applied mitigation-review receipts; a mitigation without one is not independently reviewed):

| id | threat | state | citation |
|---|---|---|---|
| M-001 | T-001 | not independently reviewed | bin/init.mjs:1092-1095 @ head | <!-- v:threat_model.mitigations[0] -->
| M-002 | T-003 | MITIGATION_CONFIRMED | bin/init.mjs:1126-1164 @ head | <!-- v:threat_model.mitigations[1] -->
| M-003 | T-004 | not independently reviewed | bin/init.mjs:943-958 @ head | <!-- v:threat_model.mitigations[2] -->
| M-004 | T-005 | not independently reviewed | bin/init.mjs:1098-1104 @ head | <!-- v:threat_model.mitigations[3] -->
| M-005 | T-006 | not independently reviewed | hooks/lib.sh:143-155 @ head | <!-- v:threat_model.mitigations[4] -->
| M-006 | T-007 | not independently reviewed | hooks/lib.sh:379-391 @ head | <!-- v:threat_model.mitigations[5] -->
| M-007 | T-008 | not independently reviewed | hooks/lib.sh:213-214 @ head | <!-- v:threat_model.mitigations[6] -->
| M-008 | T-010 | not independently reviewed | hooks/lib.sh:499-500 @ head | <!-- v:threat_model.mitigations[7] -->
| M-009 | T-011 | not independently reviewed | hooks/lib.sh:84-86 @ head | <!-- v:threat_model.mitigations[8] -->
| M-010 | T-012 | not independently reviewed | bin/init.mjs:1182-1187 @ head | <!-- v:threat_model.mitigations[9] -->

## 11. Register delta and proposed acceptances

- engagement: sdlc-skills-dogfood-2026-09 <!-- v:register.engagement_id -->
- seq: 5 <!-- v:register.seq -->
- chain_sha256: 43dfa8d4c670a9f7b6dad273debd16994902d33e312e0b1e46c815f59aede9a0 <!-- v:register.chain_sha256 -->
- events in the snapshot: 5 <!-- v:register.events -->
- alias lines in the snapshot: 0 <!-- v:register.aliases -->
- rows: 4 <!-- v:register.rows.length -->
- unauthenticated approvals: 0 <!-- v:register.unauthenticated_approvals -->

Counts by status × priority (replay over the snapshot):

| status | p0 | p1 | p2 | p3 |
|---|---|---|---|---|
| open | 0 | 0 | 2 | 1 | <!-- v:register.counts.open -->
| accepted | 0 | 0 | 0 | 0 | <!-- v:register.counts.accepted -->
| fixed | 0 | 0 | 0 | 0 | <!-- v:register.counts.fixed -->
| regressed | 0 | 0 | 0 | 0 | <!-- v:register.counts.regressed -->
| false-positive | 0 | 0 | 0 | 0 | <!-- v:register.counts.false-positive -->
| superseded | 0 | 0 | 1 | 0 | <!-- v:register.counts.superseded -->

Open exposure by priority (open + regressed + accepted + false-positive; an approval never leaves exposure, spec §6.8):

| priority | rows |
|---|---|
| p0 | 0 | <!-- v:register.open_exposure.p0 -->
| p1 | 0 | <!-- v:register.open_exposure.p1 -->
| p2 | 2 | <!-- v:register.open_exposure.p2 -->
| p3 | 1 | <!-- v:register.open_exposure.p3 -->

Rows:

| id | subject | priority | status | owner | ticket_url | last_verified_run | title |
|---|---|---|---|---|---|---|---|
| R-0001 | f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 | p2 | open | maintainers | unknown / not assessed | unknown / not assessed | External skills cloned at a mutable ref with no commit pin | <!-- v:register.rows[0] -->
| R-0002 | 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c | p2 | open | maintainers | unknown / not assessed | unknown / not assessed | Symlinks in a cloned skill are dereferenced into the consumer project | <!-- v:register.rows[1] -->
| R-0003 | 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 | p3 | open | maintainers | unknown / not assessed | unknown / not assessed | Payload agent name selects the memory directory read by agent-start | <!-- v:register.rows[2] -->
| R-0004 | f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 | p2 | superseded | maintainers | unknown / not assessed | unknown / not assessed | External skills cloned at a mutable ref with no commit pin | <!-- v:register.rows[3] -->

Delta for this run (events whose ref is this run; rows first seen in it: R-0004): <!-- v:register.rows_added -->

| seq | event | row |
|---|---|---|
| 4 | add | R-0004 | <!-- v:register.delta[0] -->

Proposed acceptances and other unauthenticated approval records (none is authenticated, D15):

(none) <!-- v:register.approvals -->

Proposals (active work outside tasks/, indexed by run snapshot proposals):

(no proposals) <!-- v:register.proposals -->

## 12. Chain of custody

| input | sha256 |
|---|---|
| claimed | c0e939f43f1f3d4a3aa51fff81c59923b824118ce0a77ac2f661c3948186db7f | <!-- v:hashes.claimed -->
| coverage | a4a509da237b298218dd2b9d8ca25eb23798b0efbaea9596b9782996e6a30a30 | <!-- v:hashes.coverage -->
| dispositions | 5c816a6b0cb76b9d40f99611601c41a3fbc081ab050a9f564999ce484a40725a | <!-- v:hashes.dispositions -->
| engagement | 6a6e6af64edd36c8fb59db72adb9d62baec4bd97d7b8a15954de92d53e56299a | <!-- v:hashes.engagement -->
| examined | 852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799 | <!-- v:hashes.examined -->
| gate-result | acf7eec81527777055705211ff3d012a2549779980b2f906d7247f48e273bb44 | <!-- v:hashes.gate-result -->
| imports | 0ffb43e2e0dbfb9fec3018c0c73f4c94a07d85553a075be2b50d2d2c22c861d0 | <!-- v:hashes.imports -->
| observations | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | <!-- v:hashes.observations -->
| packets | 698e5cac454bd21a8948f737f8919e0f6bffcb90fe4cd8be7ab9f42a5f6c9167 | <!-- v:hashes.packets -->
| proposals-index | a6399b47c965d87f316cf76b3c9ca6b7bb6b10af3dc96bef7e0ff5c29d52abbd | <!-- v:hashes.proposals-index -->
| receipts | 45d329889fbb621ee349af48ccc0e069da1b7687de80ab6511d5bbd398d70435 | <!-- v:hashes.receipts -->
| register-events | 51d264c87e976bbdffb2eb405a6575033426fa2e5e80f98b12acce37f98721ad | <!-- v:hashes.register-events -->
| rejects | c75fb298db8dee832ce4288343b2ac002625cdad70cd36f125d0c8c859936286 | <!-- v:hashes.rejects -->
| run | 564c0e4a0e8266f14ec925f9dc01c929460306a8286586bdd9025634e8aa6046 | <!-- v:hashes.run -->
| scope | f348db2a9abd66e88ddd4d38a184a2a9a5831402510b52667c6b49f2b435f7bf | <!-- v:hashes.scope -->
| threat-model | 1812a68f4b3ffcf15d3cefc25f9b07afc76bd50b00375f0b012618259e1ca9d1 | <!-- v:hashes.threat-model -->
| unlocated | 1cdacf60b6a3fc50d2cc990d9b8c94ab37ee0fb47d7c36e95146aa695553e887 | <!-- v:hashes.unlocated -->
| verify-snapshots | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | <!-- v:hashes.verify-snapshots -->

- tool_version: 1.0.0 <!-- v:custody.tool_version -->
- template: assessment v1 <!-- v:custody.template -->
- redaction rules version: 1 <!-- v:custody.redaction_version -->
- ORIGIN: unauthenticated — `check` prints `matches supplied digest` only against a consumer-held digest of the recomputed manifest (spec §2) <!-- v:custody.origin -->
- manifest: the identity of manifest.json is the content of the COMMITTED marker; it covers the inputs above and the sha256 of this report, so it cannot appear inside it
`````

## 6. Rendered risk register (`register.mjs render`, verbatim)

`````markdown
# Risk register

- engagement: `sdlc-skills-dogfood-2026-09`
- seq: `5`
- anchor: `sdlc-skills-dogfood-2026-09:5:43dfa8d4c670a9f7b6dad273debd16994902d33e312e0b1e46c815f59aede9a0`

Generated by `register.mjs render` from `.agents/security-testing/register/projection.json` (D14: the JSON is the model of record; this file is a derived view). Re-run `render` after every register change.

## Rows

| id | subject | priority | status | owner | ticket_url | last_verified_run | title |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-0001 | f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 | p2 | open | maintainers | - | - | External skills cloned at a mutable ref with no commit pin |
| R-0002 | 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c | p2 | open | maintainers | - | - | Symlinks in a cloned skill are dereferenced into the consumer project |
| R-0003 | 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 | p3 | open | maintainers | - | - | Payload agent name selects the memory directory read by agent-start |
| R-0004 | f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 | p2 | superseded | maintainers | - | - | External skills cloned at a mutable ref with no commit pin |

## Open exposure

Rows whose status is one of `open`, `regressed`, `accepted`, `false-positive`. An unauthenticated approval never reduces it.

| priority | rows |
| --- | --- |
| p0 | 0 |
| p1 | 0 |
| p2 | 2 |
| p3 | 1 |

## Unauthenticated approvals

None of these records is authenticated. Every approval-like record is stored as `authenticated: false`; no command authenticates one, and none of them reduces open exposure.

| row | kind | approved_by | approval_ref | until |
| --- | --- | --- | --- | --- |
`````

## 7. Threat-model view (`tm-lint.mjs render --run a779aef1bfdb-0002`, verbatim)

`````markdown
# Threat model — run a779aef1bfdb-0002

elements=13 threats=12 undisposed=10

## Elements

| id | kind | name | citation |
|---|---|---|---|
| E-001 | external | Upstream skill repositories on github.com (skills.json repo: entries) | bin/init.mjs:1107-1111 @ head |
| E-002 | process | Installer entry point (bin/init.mjs main) | bin/init.mjs:2450-2467 @ head |
| E-003 | datastore | Shared clone cache under ~/.cache/sdlc-skills/registry | bin/init.mjs:1081-1090 @ head |
| E-004 | datastore | Consumer project host directory (.claude/skills, .claude/agents, settings.json) | bin/init.mjs:1182-1187 @ head |
| E-005 | boundary | Third-party clone content crossing into the consumer project tree (copyTreeDereferenced) | bin/init.mjs:140-159 @ head |
| E-006 | process | session-start hook (project context injection at session start) | hooks/session-start:21-30 @ head |
| E-007 | process | agent-start hook (per-role memory injection at subagent dispatch) | hooks/agent-start:30-43 @ head |
| E-008 | datastore | Shared docs and role memory under .agents/ (repository content) | hooks/lib.sh:172-181 @ head |
| E-009 | boundary | Repository content crossing into agent context (additionalContext emission) | hooks/lib.sh:639-650 @ head |
| E-010 | flow | Hook payload on stdin from the host runtime | hooks/lib.sh:35-49 @ head |
| E-011 | datastore | Hook tunables config.sh and generated config-defaults.sh sourced by lib.sh | hooks/lib.sh:17-25 @ head |
| E-012 | process | Copilot instruction-file mirror (refresh_shared_instructions) | hooks/lib.sh:483-509 @ head |
| E-013 | process | Hook wiring writer (installCoreHooks merges commands into the host hook config) | bin/init.mjs:938-961 @ head |

## Threats

| id | element | STRIDE | title | disposition | mitigations |
|---|---|---|---|---|---|
| T-001 | E-001 | S | An upstream branch is replaced (force-push, account takeover) and its content is installed as trusted skill text | undisposed | M-001 |
| T-002 | E-005 | I | A symlink committed upstream is dereferenced and a local file outside the clone is copied into the consumer project | undisposed | unknown / not assessed |
| T-003 | E-005 | T | An upstream SKILL.md name carrying a path separator places the installed skill outside the skills directory | mitigated (M-002) | M-002 |
| T-004 | E-013 | T | The hook command written into the host settings names a script outside the project or an interpreter with extra arguments | planned (dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e) | M-003 |
| T-005 | E-003 | T | A stale or poisoned cache clone is reused as the install source without re-validation against upstream | undisposed | M-004 |
| T-006 | E-009 | T | Instructions planted in a shared doc or a role memory file are injected into every agent context as standing guidance | undisposed | M-005 |
| T-007 | E-009 | D | An over-budget memory or shared doc makes the host drop the whole injected payload so the agent runs without its rules | undisposed | M-006 |
| T-008 | E-010 | T | A crafted agent name in the SubagentStart payload selects a memory directory outside the project | undisposed | M-007 |
| T-009 | E-011 | T | A committed config.sh in the hooks directory runs arbitrary shell at every session start on every machine that installs the project | undisposed | unknown / not assessed |
| T-010 | E-012 | T | A human-authored Copilot instruction file is overwritten by the generated mirror of a shared doc | undisposed | M-008 |
| T-011 | E-009 | I | A raw control character in an injected document breaks the JSON payload and the host silently drops the context | undisposed | M-009 |
| T-012 | E-004 | T | An --update install removes and rewrites a path derived from third-party content inside the host directory | undisposed | M-010 |

## Mitigations (claims)

| id | threat | claim | citation | state |
|---|---|---|---|---|
| M-001 | T-001 | shallowClone rejects a ref that is not [A-Za-z0-9._/] or starts with a dash before it is passed to git | bin/init.mjs:1092-1095 @ head | not independently reviewed |
| M-002 | T-003 | installExternalSkill refuses an upstream SKILL.md name that is not a bare path segment and installs under the registry id instead | bin/init.mjs:1126-1164 @ head | MITIGATION_CONFIRMED |
| M-003 | T-004 | installCoreHooks writes hook commands built only from a fixed project-relative script path and the two verbs session-start and agent-start | bin/init.mjs:943-958 @ head | not independently reviewed |
| M-004 | T-005 | A cached clone is refreshed with git fetch --depth 1 origin <ref> and checkout FETCH_HEAD before it is used | bin/init.mjs:1098-1104 @ head | not independently reviewed |
| M-005 | T-006 | Only the curated shared-doc names and the curated role-memory file names are read; other files under .agents/ are never inlined | hooks/lib.sh:143-155 @ head | not independently reviewed |
| M-006 | T-007 | build_capped_context measures the escaped size of every inlined file against a per-host cap and spills the rest to a read-list | hooks/lib.sh:379-391 @ head | not independently reviewed |
| M-007 | T-008 | In roster mode a role without a generated per-role variable receives no memory files, so an unknown role name reads nothing | hooks/lib.sh:213-214 @ head | not independently reviewed |
| M-008 | T-010 | refresh_shared_instructions skips an existing instruction file that does not carry the auto-generated marker | hooks/lib.sh:499-500 @ head | not independently reviewed |
| M-009 | T-011 | escape_for_json encodes every remaining U+0000-U+001F control character as \u00xx after the five short escapes | hooks/lib.sh:84-86 @ head | not independently reviewed |
| M-010 | T-012 | The destination removed on --update is join(skillsDir, skillName) where skillName has passed isBarePathSegment or is the registry id | bin/init.mjs:1182-1187 @ head | not independently reviewed |

## Dispositions

| threat | kind | ref | resolved via |
|---|---|---|---|
| T-001 | undisposed | unknown / not assessed | none |
| T-002 | undisposed | unknown / not assessed | none |
| T-003 | mitigated | M-002 | receipt |
| T-004 | planned | dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e | admission |
| T-005 | undisposed | unknown / not assessed | none |
| T-006 | undisposed | unknown / not assessed | none |
| T-007 | undisposed | unknown / not assessed | none |
| T-008 | undisposed | unknown / not assessed | none |
| T-009 | undisposed | unknown / not assessed | none |
| T-010 | undisposed | unknown / not assessed | none |
| T-011 | undisposed | unknown / not assessed | none |
| T-012 | undisposed | unknown / not assessed | none |
`````

## 8. Full command transcript

Every command in order with every stdout line, stderr lines prefixed `[stderr]`, and the exit code. Lines starting with `#` are the maintainer's notes on hand-written inputs (the agents' contract outputs) and on turns the scripts did not print.

`````text
$ node bin/init.mjs init --factory security-testing --target claude --yes

  sdlc-skills — SDLC agents and skills for AI coding assistants

  Catalog: 25 agent(s), 60 skill(s)
  Factory: Security Testing Team — 0 shared agent(s), 3 local agent(s), 6 local skill(s), 8 extra skill(s)

  • "issue-tracking" exists in feature-development, test-automation — using feature-development. Qualify as <factory>/issue-tracking to pick another.
  → Claude Code (.claude/)
      ✓ agent  security-lead (factory-local)
      ✓ agent  threat-modeler (factory-local)
      ✓ agent  security-reviewer (factory-local)
      ✓ skill  security-evidence (factory-local)
      ✓ skill  security-engagement (factory-local)
      ✓ skill  threat-modeling (factory-local)
      ✓ skill  secure-code-review (factory-local)
      ✓ skill  security-test-planning (factory-local)
      ✓ skill  risk-register (factory-local)
      ✓ skill  memory
      ✓ skill  knowledge-curation
      ✓ skill  issue-tracking
      ✓ skill  verifying-outcomes
      ✓ skill  gathering-context
      ✓ skill  deep-research
      ✓ skill  dispatching-parallel-agents (external: obra/superpowers)
      ✓ skill  systematic-debugging (external: obra/superpowers)

  → hooks (memory + project-context injection)
      ✓ hooks Claude Code (.claude/settings.json)

  → .agents/memory/ (shared, all IDEs)
      ✓ briefing security-lead
      ✓ briefing threat-modeler
      ✓ briefing security-reviewer

  → project root (team instructions)
      ✓ instructions AGENTS.md (appended)
      ✓ instructions CLAUDE.md (appended)

  → project (seed reference files)
      ✓ seed .agents/security-testing/knowledge

  Done: 21 installed, 0 skipped.
  Launch Claude Code in this project to use them.

exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs engagement init
TEMPLATES: engagement.md.template=present finding-schema.md=present report-reading-guide.md=present
ENGAGEMENT: template written — edit and re-run
EDIT-ENGAGEMENT-AND-RERUN
exit=2

# (edited .agents/security-testing/engagement.md by hand: the json engagement block is reproduced in the note)

$ node .claude/skills/security-evidence/scripts/evidence.mjs engagement init
TEMPLATES: engagement.md.template=present finding-schema.md=present report-reading-guide.md=present
ENGAGEMENT: present
IGNORE-BLOCK: written
KEY: ka0b90a77ebd4 created
BASELINE: 32 files ignored=0
WROTE .agents/security-testing/private/baseline.sdlc-skills-dogfood-2026-09.json sha256=3a7bb9bab2addd097e407737dd7fe1ba0b2ece150f301739603a3490546fbad1
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs engagement validate
IGNORE-BLOCK: ok
TRACKED: none
KEY: available
BASELINE: present
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs run init --kind assessment
RUN a779aef1bfdb-0001 seq=1 kind=assessment base=a779aef1bfdb7835b9abc2c9524a46de4b68b076 head=a779aef1bfdb7835b9abc2c9524a46de4b68b076
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/run.json sha256=b7fa94c2ffb0b5eaf5cea8fa8518ef169833cda04245d1f16d0141bfb2d8bc37
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/engagement.json sha256=6a6e6af64edd36c8fb59db72adb9d62baec4bd97d7b8a15954de92d53e56299a
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/imports.json sha256=9464c332542d047e8fe574e2315de0f6526bc7518ad31b581e4759ca612a7ec4
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/observations.json sha256=225e762caa8cb172d84527d9dafc91d35fa66926b5536689e683325e81945c89
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/proposals-index.json sha256=a6399b47c965d87f316cf76b3c9ca6b7bb6b10af3dc96bef7e0ff5c29d52abbd
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs scope --run a779aef1bfdb-0001
SCOPE files=32 ranges=32 skipped=0 snapshot=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/scope.json sha256=f348db2a9abd66e88ddd4d38a184a2a9a5831402510b52667c6b49f2b435f7bf
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0001 --kind scope
PACKET .agents/security-testing/runs/a779aef1bfdb-0001/packets/9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae.json sha256=9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae kind=scope files=32
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/packets/9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae.json sha256=9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae
exit=0

# (wrote candidate case .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md by hand; .agents/ is ignored in this repo so the case is not a blob at head - heuristic route only)

$ node .claude/skills/security-evidence/scripts/plan.mjs admit --run a779aef1bfdb-0001 .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md --dry-run
ADMISSION case=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e classification=admitted-heuristic hits=0
[stderr] admit: --dry-run — nothing persisted (hits: none)
exit=0

$ node .claude/skills/security-evidence/scripts/plan.mjs admit --run a779aef1bfdb-0001 .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md
ADMISSION case=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e classification=admitted-heuristic hits=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/admissions/dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e.json sha256=c7ef16b900e4edff312e69ae431e5209ff082a562d771d2a7e791aa7bacf55b7
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs ingest case .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md --run a779aef1bfdb-0001
IMPORT case import_sha256=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e records=1 unlocated=0 rejected=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/imports.json sha256=0885659c8139bd43b7ab7d0ef1b3b79e1f3fc040ec0d81132644b903485e87a9
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/ingest/dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e.json sha256=47a3cb175736f6c7b4cb097a79ffa2b0654e0215e222169ec66683947479f243
exit=0

# (security-reviewer, review contract over the scope packet: wrote the two drop-box files; the generator copies snippets from the normalised bytes at the recorded oid)
CLAIMS .agents/security-testing/receipts/a779aef1bfdb-0001/claims-1.json EXAMINED .agents/security-testing/receipts/a779aef1bfdb-0001/examined-1.json findings=3 read=5

$ node .claude/skills/security-evidence/scripts/evidence.mjs gate --run a779aef1bfdb-0001 --claims .agents/security-testing/receipts/a779aef1bfdb-0001/claims-1.json
GATE accepted=3 unverifiable=0 rejected=0 unlocated=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/findings.claimed.json sha256=c0e939f43f1f3d4a3aa51fff81c59923b824118ce0a77ac2f661c3948186db7f
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/gate-result.json sha256=acf7eec81527777055705211ff3d012a2549779980b2f906d7247f48e273bb44
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/rejects.json sha256=c75fb298db8dee832ce4288343b2ac002625cdad70cd36f125d0c8c859936286
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/unlocated.json sha256=1cdacf60b6a3fc50d2cc990d9b8c94ab37ee0fb47d7c36e95146aa695553e887
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs coverage --run a779aef1bfdb-0001 --examined .agents/security-testing/receipts/a779aef1bfdb-0001/examined-1.json
COVERAGE examined=6 skipped=0 scanner=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/examined.json sha256=852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/coverage.json sha256=a4a509da237b298218dd2b9d8ca25eb23798b0efbaea9596b9782996e6a30a30
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0001 --kind subject --subject f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2
PACKET .agents/security-testing/runs/a779aef1bfdb-0001/packets/73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d.json sha256=73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d kind=subject files=1
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/packets/73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d.json sha256=73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0001 --kind subject --subject 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c
PACKET .agents/security-testing/runs/a779aef1bfdb-0001/packets/6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68.json sha256=6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68 kind=subject files=1
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/packets/6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68.json sha256=6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0001 --kind subject --subject 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975
PACKET .agents/security-testing/runs/a779aef1bfdb-0001/packets/97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386.json sha256=97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386 kind=subject files=2
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/packets/97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386.json sha256=97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386
exit=0

# (security-reviewer, vulnerability-review over each subject packet - NOT a fresh context: the maintainer plays every role in one session, see the deviations list; the cited ranges were re-read at the recorded oids)
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2.json type=vulnerability-review subject=f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 assertion=confirmed
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c.json type=vulnerability-review subject=2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c assertion=confirmed
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975.json type=vulnerability-review subject=0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 assertion=indeterminate

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0001 .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2.json
RECEIPT admitted sha256=65fed2b3621e73defae394325b3aa8be05e6cf0f597c9e71a6e371c268d15535 type=vulnerability-review subject=f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/receipts/65fed2b3621e73defae394325b3aa8be05e6cf0f597c9e71a6e371c268d15535.json sha256=65fed2b3621e73defae394325b3aa8be05e6cf0f597c9e71a6e371c268d15535
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0001 .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c.json
RECEIPT admitted sha256=1f89296ce609b4ad756d124ad5fe9107f48f237e27d145fa94ebbccbefa00f5f type=vulnerability-review subject=2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/receipts/1f89296ce609b4ad756d124ad5fe9107f48f237e27d145fa94ebbccbefa00f5f.json sha256=1f89296ce609b4ad756d124ad5fe9107f48f237e27d145fa94ebbccbefa00f5f
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0001 .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975.json
RECEIPT admitted sha256=0387d8ac9512afa6956c332a7065a2cfe03896a7078920fb9f6f3c4353cc17c9 type=vulnerability-review subject=0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/receipts/0387d8ac9512afa6956c332a7065a2cfe03896a7078920fb9f6f3c4353cc17c9.json sha256=0387d8ac9512afa6956c332a7065a2cfe03896a7078920fb9f6f3c4353cc17c9
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt apply --run a779aef1bfdb-0001
STATE 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 REVIEW_INDETERMINATE
STATE 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c REVIEW_CONFIRMED
STATE f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 REVIEW_CONFIRMED
not-applied: 0
conflicts: 0
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs add --subject f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 --priority p2 --title External skills cloned at a mutable ref with no commit pin --run a779aef1bfdb-0001 --owner maintainers
ROW R-0001 status=open priority=p2 seq=1
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs add --subject 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c --priority p2 --title Symlinks in a cloned skill are dereferenced into the consumer project --run a779aef1bfdb-0001 --owner maintainers
ROW R-0002 status=open priority=p2 seq=2
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs add --subject 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 --priority p3 --title Payload agent name selects the memory directory read by agent-start --run a779aef1bfdb-0001 --owner maintainers
ROW R-0003 status=open priority=p3 seq=3
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs render
RENDER .agents/security-testing/risk-register.md rows=3 seq=3
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs run snapshot register --run a779aef1bfdb-0001
SNAPSHOT register events=3 chain=74d1f564acf126fc783ea4aaa21f0ae9cc12af84cd3436fd28f64ed941a72ad9
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/register-events.json sha256=fb46093c16768f1a11b4479266ac16c09f9ea553aeff555ed9a9c4ddb0dad7f3
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs run snapshot proposals --run a779aef1bfdb-0001
SNAPSHOT proposals n=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/proposals-index.json sha256=a6399b47c965d87f316cf76b3c9ca6b7bb6b10af3dc96bef7e0ff5c29d52abbd
exit=0

# (threat-modeler, threat-model contract: wrote .agents/security-testing/threat-model.json by hand - 13 elements, 12 threats, 10 mitigation claims; T-003 asserted mitigated(M-002) up front per dispositions.md "order of operations", T-004 planned(<case_sha256>))

$ node .claude/skills/security-evidence/scripts/tm-lint.mjs check --run a779aef1bfdb-0001
TM-INVALID(T-003: mitigated(M-002): M-002 has no MITIGATION_CONFIRMED state (not independently reviewed))
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/threat-model.json sha256=03394530c75bd5fc4cf5a147450590e065a1bab1ba2fdba9a6a903a90db54c83
exit=4

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0001 --kind subject --subject M-002
PACKET .agents/security-testing/runs/a779aef1bfdb-0001/packets/5387531ddbbfbbaf609484902823c5b9fc656e25d9338d38dd412860062be821.json sha256=5387531ddbbfbbaf609484902823c5b9fc656e25d9338d38dd412860062be821 kind=subject files=1
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/packets/5387531ddbbfbbaf609484902823c5b9fc656e25d9338d38dd412860062be821.json sha256=5387531ddbbfbbaf609484902823c5b9fc656e25d9338d38dd412860062be821
exit=0

# (security-reviewer, mitigation-review over M-002: the packet is bin/init.mjs [1158,1164] - the call site of isBarePathSegment and the fallback branch; the predicate body (1126-1131) is outside the packet, so the reviewer cannot see what "bare path segment" enforces -> indeterminate)
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-M-002.json type=mitigation-review subject=M-002 assertion=indeterminate

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0001 .agents/security-testing/receipts/a779aef1bfdb-0001/receipt-M-002.json
RECEIPT admitted sha256=11ad168b9dfc82b00886a24ff6c8395f69a3f5f199f14963349f9b441e8f4b6e type=mitigation-review subject=M-002
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/receipts/11ad168b9dfc82b00886a24ff6c8395f69a3f5f199f14963349f9b441e8f4b6e.json sha256=11ad168b9dfc82b00886a24ff6c8395f69a3f5f199f14963349f9b441e8f4b6e
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt apply --run a779aef1bfdb-0001
STATE 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 REVIEW_INDETERMINATE
STATE 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c REVIEW_CONFIRMED
STATE f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 REVIEW_CONFIRMED
STATE M-002 MITIGATION_INDETERMINATE
not-applied: 0
conflicts: 0
exit=0

$ node .claude/skills/security-evidence/scripts/tm-lint.mjs check --run a779aef1bfdb-0001
TM-INVALID(T-003: mitigated(M-002): M-002 has no MITIGATION_CONFIRMED state (MITIGATION_INDETERMINATE))
WROTE .agents/security-testing/runs/a779aef1bfdb-0001/threat-model.json sha256=03394530c75bd5fc4cf5a147450590e065a1bab1ba2fdba9a6a903a90db54c83
exit=4

$ node .claude/skills/security-evidence/scripts/evidence.mjs build-report --run a779aef1bfdb-0001 --template assessment
INCOMPLETE(dispositions)
exit=3

# Run a779aef1bfdb-0001 stays INCOMPLETE: the mitigation citation was too narrow for a reviewer to confirm and the snapshot is write-once, so the corrected model (M-002 now cites bin/init.mjs [1126,1164], predicate + call site, 39 lines) goes on a NEW run - the whole chain is repeated below (retry = new seq).

$ node .claude/skills/security-evidence/scripts/evidence.mjs run init --kind assessment
RUN a779aef1bfdb-0002 seq=2 kind=assessment base=a779aef1bfdb7835b9abc2c9524a46de4b68b076 head=a779aef1bfdb7835b9abc2c9524a46de4b68b076
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/run.json sha256=564c0e4a0e8266f14ec925f9dc01c929460306a8286586bdd9025634e8aa6046
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/engagement.json sha256=6a6e6af64edd36c8fb59db72adb9d62baec4bd97d7b8a15954de92d53e56299a
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/imports.json sha256=9464c332542d047e8fe574e2315de0f6526bc7518ad31b581e4759ca612a7ec4
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/observations.json sha256=225e762caa8cb172d84527d9dafc91d35fa66926b5536689e683325e81945c89
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/proposals-index.json sha256=a6399b47c965d87f316cf76b3c9ca6b7bb6b10af3dc96bef7e0ff5c29d52abbd
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs scope --run a779aef1bfdb-0002
SCOPE files=32 ranges=32 skipped=0 snapshot=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/scope.json sha256=f348db2a9abd66e88ddd4d38a184a2a9a5831402510b52667c6b49f2b435f7bf
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0002 --kind scope
PACKET .agents/security-testing/runs/a779aef1bfdb-0002/packets/9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae.json sha256=9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae kind=scope files=32
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/packets/9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae.json sha256=9606f12046c54005975de32816ed7c0946ccf5304f2efc43f209b156dcbaedae
exit=0

$ node .claude/skills/security-evidence/scripts/plan.mjs admit --run a779aef1bfdb-0002 .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md --dry-run
ADMISSION case=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e classification=admitted-heuristic hits=0
[stderr] admit: --dry-run — nothing persisted (hits: none)
exit=0

$ node .claude/skills/security-evidence/scripts/plan.mjs admit --run a779aef1bfdb-0002 .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md
ADMISSION case=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e classification=admitted-heuristic hits=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/admissions/dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e.json sha256=c7ef16b900e4edff312e69ae431e5209ff082a562d771d2a7e791aa7bacf55b7
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs ingest case .agents/security-testing/cases/sdlc-skills/TC-001_installed-hook-wiring-is-repo-relative.md --run a779aef1bfdb-0002
IMPORT case import_sha256=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e records=1 unlocated=0 rejected=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/imports.json sha256=0885659c8139bd43b7ab7d0ef1b3b79e1f3fc040ec0d81132644b903485e87a9
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/ingest/dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e.json sha256=47a3cb175736f6c7b4cb097a79ffa2b0654e0215e222169ec66683947479f243
exit=0

# (security-reviewer, review contract over the run-2 scope packet: same packet identity, same three claims, same examined declaration)
CLAIMS .agents/security-testing/receipts/a779aef1bfdb-0002/claims-1.json EXAMINED .agents/security-testing/receipts/a779aef1bfdb-0002/examined-1.json findings=3 read=5

$ node .claude/skills/security-evidence/scripts/evidence.mjs gate --run a779aef1bfdb-0002 --claims .agents/security-testing/receipts/a779aef1bfdb-0002/claims-1.json
GATE accepted=3 unverifiable=0 rejected=0 unlocated=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/findings.claimed.json sha256=c0e939f43f1f3d4a3aa51fff81c59923b824118ce0a77ac2f661c3948186db7f
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/gate-result.json sha256=acf7eec81527777055705211ff3d012a2549779980b2f906d7247f48e273bb44
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/rejects.json sha256=c75fb298db8dee832ce4288343b2ac002625cdad70cd36f125d0c8c859936286
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/unlocated.json sha256=1cdacf60b6a3fc50d2cc990d9b8c94ab37ee0fb47d7c36e95146aa695553e887
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs coverage --run a779aef1bfdb-0002 --examined .agents/security-testing/receipts/a779aef1bfdb-0002/examined-1.json
COVERAGE examined=6 skipped=0 scanner=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/examined.json sha256=852521f10e5e57f00f7626879baf656aabd0077fca9e5986b45910760d962799
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/coverage.json sha256=a4a509da237b298218dd2b9d8ca25eb23798b0efbaea9596b9782996e6a30a30
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0002 --kind subject --subject f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2
PACKET .agents/security-testing/runs/a779aef1bfdb-0002/packets/73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d.json sha256=73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d kind=subject files=1
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/packets/73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d.json sha256=73a8124ea02a54e3f4ff9e26b2a40d8490cc80e62e8ff699cf397376c368180d
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0002 --kind subject --subject 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c
PACKET .agents/security-testing/runs/a779aef1bfdb-0002/packets/6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68.json sha256=6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68 kind=subject files=1
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/packets/6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68.json sha256=6a4db5d171bf9e4ce786f8e433b7258a504cccf7a9cbc1c79412e9b99ad46d68
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0002 --kind subject --subject 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975
PACKET .agents/security-testing/runs/a779aef1bfdb-0002/packets/97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386.json sha256=97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386 kind=subject files=2
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/packets/97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386.json sha256=97c4c475908ec3546774d80e0c7909a7b4ac605e56cafe505e52cc566dee9386
exit=0

# (security-reviewer, vulnerability-review over the three run-2 subject packets - same packets, same assertions)
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2.json type=vulnerability-review subject=f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 assertion=confirmed
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c.json type=vulnerability-review subject=2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c assertion=confirmed
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975.json type=vulnerability-review subject=0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 assertion=indeterminate

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0002 .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2.json
RECEIPT admitted sha256=aaaf254e68b567cec44273e7cb88f612f663b22eb72f0ce527e2b9520a9db3d6 type=vulnerability-review subject=f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/receipts/aaaf254e68b567cec44273e7cb88f612f663b22eb72f0ce527e2b9520a9db3d6.json sha256=aaaf254e68b567cec44273e7cb88f612f663b22eb72f0ce527e2b9520a9db3d6
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0002 .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c.json
RECEIPT admitted sha256=7e639b49d9cf32a3dd36463d09d8caa5ede947b1d3d2acee9225b4c4e6830303 type=vulnerability-review subject=2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/receipts/7e639b49d9cf32a3dd36463d09d8caa5ede947b1d3d2acee9225b4c4e6830303.json sha256=7e639b49d9cf32a3dd36463d09d8caa5ede947b1d3d2acee9225b4c4e6830303
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0002 .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975.json
RECEIPT admitted sha256=f9ef0e41ff6079809a949ac4e0b6e36025771b29d5ab3c99aaf67bca029cf064 type=vulnerability-review subject=0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/receipts/f9ef0e41ff6079809a949ac4e0b6e36025771b29d5ab3c99aaf67bca029cf064.json sha256=f9ef0e41ff6079809a949ac4e0b6e36025771b29d5ab3c99aaf67bca029cf064
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt apply --run a779aef1bfdb-0002
STATE 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 REVIEW_INDETERMINATE
STATE 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c REVIEW_CONFIRMED
STATE f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 REVIEW_CONFIRMED
not-applied: 0
conflicts: 0
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs add --subject f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 --priority p2 --title External skills cloned at a mutable ref with no commit pin --run a779aef1bfdb-0002 --owner maintainers
ROW R-0004 status=open priority=p2 seq=4
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs status
STATUS rows=4 seq=4
OPEN-EXPOSURE p0=0 p1=0 p2=3 p3=1
APPROVALS unauthenticated=0
COUNT open p0=0 p1=0 p2=3 p3=1
COUNT accepted p0=0 p1=0 p2=0 p3=0
COUNT fixed p0=0 p1=0 p2=0 p3=0
COUNT regressed p0=0 p1=0 p2=0 p3=0
COUNT false-positive p0=0 p1=0 p2=0 p3=0
COUNT superseded p0=0 p1=0 p2=0 p3=0
exit=0

# The probe above shows `register add` does not dedupe on a live row with the same subject: R-0004 duplicates R-0001 and open exposure reads p2=3 for two p2 findings. Folded with supersede (risk-register skill), then re-rendered.

$ node .claude/skills/security-evidence/scripts/register.mjs supersede R-0004 --by R-0001 --subject-equivalent
ROW R-0004 status=superseded priority=p2 seq=5
ROW R-0001 status=open priority=p2 seq=5
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs status
STATUS rows=4 seq=5
OPEN-EXPOSURE p0=0 p1=0 p2=2 p3=1
APPROVALS unauthenticated=0
COUNT open p0=0 p1=0 p2=2 p3=1
COUNT accepted p0=0 p1=0 p2=0 p3=0
COUNT fixed p0=0 p1=0 p2=0 p3=0
COUNT regressed p0=0 p1=0 p2=0 p3=0
COUNT false-positive p0=0 p1=0 p2=0 p3=0
COUNT superseded p0=0 p1=0 p2=1 p3=0
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs render
RENDER .agents/security-testing/risk-register.md rows=4 seq=5
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs run snapshot register --run a779aef1bfdb-0002
SNAPSHOT register events=5 chain=43dfa8d4c670a9f7b6dad273debd16994902d33e312e0b1e46c815f59aede9a0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/register-events.json sha256=51d264c87e976bbdffb2eb405a6575033426fa2e5e80f98b12acce37f98721ad
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs run snapshot proposals --run a779aef1bfdb-0002
SNAPSHOT proposals n=0
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/proposals-index.json sha256=a6399b47c965d87f316cf76b3c9ca6b7bb6b10af3dc96bef7e0ff5c29d52abbd
exit=0

# (threat-modeler, threat-model contract on run 2: the corrected model of record, M-002 cites [1126,1164])

$ node .claude/skills/security-evidence/scripts/tm-lint.mjs check --run a779aef1bfdb-0002
TM-INVALID(T-003: mitigated(M-002): M-002 has no MITIGATION_CONFIRMED state (not independently reviewed))
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/threat-model.json sha256=1812a68f4b3ffcf15d3cefc25f9b07afc76bd50b00375f0b012618259e1ca9d1
exit=4

$ node .claude/skills/security-evidence/scripts/evidence.mjs packet --run a779aef1bfdb-0002 --kind subject --subject M-002
PACKET .agents/security-testing/runs/a779aef1bfdb-0002/packets/c1e40646a6082f3ed1ec538817e31cfd1ac45e0d0260ddbc326a75f691dd4864.json sha256=c1e40646a6082f3ed1ec538817e31cfd1ac45e0d0260ddbc326a75f691dd4864 kind=subject files=1
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/packets/c1e40646a6082f3ed1ec538817e31cfd1ac45e0d0260ddbc326a75f691dd4864.json sha256=c1e40646a6082f3ed1ec538817e31cfd1ac45e0d0260ddbc326a75f691dd4864
exit=0

# (security-reviewer, mitigation-review over M-002 on run 2: the packet now holds the predicate isBarePathSegment (rejects ".", "..", any "/" "\" NUL, requires basename===name) and the call site that keeps entry.id on refusal -> confirmed)
RECEIPT .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-M-002.json type=mitigation-review subject=M-002 assertion=confirmed

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt validate --run a779aef1bfdb-0002 .agents/security-testing/receipts/a779aef1bfdb-0002/receipt-M-002.json
RECEIPT admitted sha256=c1bc1f77636417f54e33f729567ecbcb179e99ba8a13aa58771ef41ed743fc6b type=mitigation-review subject=M-002
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/receipts/c1bc1f77636417f54e33f729567ecbcb179e99ba8a13aa58771ef41ed743fc6b.json sha256=c1bc1f77636417f54e33f729567ecbcb179e99ba8a13aa58771ef41ed743fc6b
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs receipt apply --run a779aef1bfdb-0002
STATE 0dd834f11fad6a8a2609475db93211823f0f52eae5d34a518671bb8eae240975 REVIEW_INDETERMINATE
STATE 2e7f1b9beca48ecaa4fd44600cceb0720cc173d5577ca9c44a7df1f4dfae598c REVIEW_CONFIRMED
STATE f7392ccc17c25dd7ab7cc1e3241e0e00491c8ad0210f36c00c3e0cad05f8dfd2 REVIEW_CONFIRMED
STATE M-002 MITIGATION_CONFIRMED
not-applied: 0
conflicts: 0
exit=0

$ node .claude/skills/security-evidence/scripts/tm-lint.mjs check --run a779aef1bfdb-0002
TM elements=13 threats=12 undisposed=10
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/threat-model.json sha256=1812a68f4b3ffcf15d3cefc25f9b07afc76bd50b00375f0b012618259e1ca9d1
WROTE .agents/security-testing/runs/a779aef1bfdb-0002/dispositions.json sha256=5c816a6b0cb76b9d40f99611601c41a3fbc081ab050a9f564999ce484a40725a
exit=0

$ node .claude/skills/security-evidence/scripts/tm-lint.mjs render --run a779aef1bfdb-0002
RENDER .agents/security-testing/runs/a779aef1bfdb-0002/threat-model.md elements=13 threats=12
exit=0

# (threat-modeler return line: MODEL_WRITTEN elements=13 threats=12 undisposed=10)

$ node .claude/skills/security-evidence/scripts/evidence.mjs build-report --run a779aef1bfdb-0002 --template assessment
REPORT .agents/security-testing/runs/a779aef1bfdb-0002/report.md
MANIFEST sha256=695c3e37f18cf84b308dcf821a96d091281969ff49b79ab1102af7af4f0cb416
COMMITTED
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs check .agents/security-testing/runs/a779aef1bfdb-0002 --integrity --drift
CONSISTENT
CURRENT
ORIGIN: unauthenticated
KEY: available
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs check
CHECK expired=0
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs render
RENDER .agents/security-testing/risk-register.md rows=4 seq=5
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs sign-off --engagement sdlc-skills-dogfood-2026-09
SIGN-OFF: OK
RUNS: 1
  a779aef1bfdb-0002 seq=2 kind=assessment CONSISTENT CURRENT
INCOMPLETE: 1
  a779aef1bfdb-0001 seq=1 kind=assessment
CHANGES-SINCE-BASELINE: 0
EXCLUDED-COVERAGE: ignored=0
  bin/ ignored=0
  hooks/ ignored=0
UNAUTHENTICATED-APPROVALS: 0
UNADMITTED: 0
DISPOSITIONS: 11 undisposed-or-planned policy=executed-or-ticketed
  T-001 undisposed
  T-002 undisposed
  T-004 planned
  T-005 undisposed
  T-006 undisposed
  T-007 undisposed
  T-008 undisposed
  T-009 undisposed
  T-010 undisposed
  T-011 undisposed
  T-012 undisposed
exit=0

$ node .claude/skills/security-evidence/scripts/register.mjs anchor print
sdlc-skills-dogfood-2026-09:5:43dfa8d4c670a9f7b6dad273debd16994902d33e312e0b1e46c815f59aede9a0
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs publish --run a779aef1bfdb-0002 --profile redacted-report --to /private/tmp/claude-501/-Users-Daniel-Sallai-dev-sdlc-skills/cb15528e-72af-4c49-8975-125eaca6f878/scratchpad/publish-out
USAGE(publish: cannot write /private/tmp/claude-501/-Users-Daniel-Sallai-dev-sdlc-skills/cb15528e-72af-4c49-8975-125eaca6f878/scratchpad/publish-out (outside the work tree))
exit=2

# publish refuses a destination outside the work tree (G-5), so the PM ruling "publish to a temp dir" cannot be followed literally; published to reports/security/ (managed-ignored) instead and pasted from there.

$ node .claude/skills/security-evidence/scripts/evidence.mjs publish --run a779aef1bfdb-0002 --profile redacted-report --to reports/security
PUBLISHED profile=redacted-report output=reports/security/report.md sha256=a2b3fc0fd7dd5f4c38c1c56db332e13f5db59176f31284d9e80e8e11d2e4eea2
WROTE reports/security/export-manifest.json sha256=39e6dc2a95cab1297616162be46463a6bd8c705e7834da6b8eab304f6641cf0b
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs check-export reports/security/export-manifest.json --source .agents/security-testing/runs/a779aef1bfdb-0002
VERIFIED-DERIVATIVE
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs publish --run a779aef1bfdb-0002 --profile case --to tasks/security-sdlc-skills-admitted
PUBLISHED profile=case output=./tasks/security-sdlc-skills-admitted/TC-001_installed-hook-wiring-is-repo-relative.md sha256=dd2a80cf5aa4eda1da1b908817508039830e5126484f73fcb8a54438b808102e
WROTE .agents/security-testing/handoffs/a779aef1bfdb-0002.case.export-manifest.json sha256=43731af6e85ce44102d2a80d5c1cc5d8fd0d2dde7f89aa7d319e02166c5d1684
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs publish --run a779aef1bfdb-0002 --profile handoff --to .agents/security-testing/handoffs --base-url http://localhost
PUBLISHED profile=handoff output=.agents/security-testing/handoffs/sdlc-skills.md sha256=1bb10f0cba1418b2bc169e3f5cc1041bdeeb9eed00e6b31f9a99ed094865350f
WROTE .agents/security-testing/handoffs/a779aef1bfdb-0002.handoff.export-manifest.json sha256=6645b145e73a685d09323dcb623de336ec3f7bd8e589bbd6f0c3da769f4edfc3
Run as the active agent (claude --agent test-run-lead):
"Run the suite at tasks/security-sdlc-skills-admitted/ against base_url=http://localhost."
exit=0

$ node .claude/skills/security-evidence/scripts/plan.mjs ta-prompt --run a779aef1bfdb-0002 --slug sdlc-skills --base feat/security-testing-bundle-spec
Run as the active agent (claude --agent test-automation-lead):
"Automate the batch sdlc-skills from base feat/security-testing-bundle-spec. The cases below are manual-qa test cases already in this repository (tasks/security-sdlc-skills-admitted/): pass each path as its intake snapshot (cases: [{id, path}]); do not copy them."
cases:
- id: TC-001 | title: Verify the installed hook wiring points only at project-relative scripts | path: ./tasks/security-sdlc-skills-admitted/TC-001_installed-hook-wiring-is-repo-relative.md
exit=0

# No verify run exists (no fix commit to verify), so `run snapshot verify` has nothing to carry; probed once against the COMMITTED run to see the refusal token:
$ node .claude/skills/security-evidence/scripts/evidence.mjs run snapshot verify --run a779aef1bfdb-0002 --from a779aef1bfdb-0001
RUN-COMMITTED
exit=2

$ node .claude/skills/security-evidence/scripts/evidence.mjs engagement validate
IGNORE-BLOCK: ok
TRACKED: none
KEY: available
BASELINE: present
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs check .agents/security-testing/runs/a779aef1bfdb-0002 --integrity --drift
CONSISTENT
CURRENT
ORIGIN: unauthenticated
KEY: available
exit=0

$ git status --porcelain
 M .gitignore
 M AGENTS.md
 M CLAUDE.md
exit=0

$ git checkout -- AGENTS.md CLAUDE.md .gitignore
# (maintainer, PM ruling 5: the FACTORY splice in AGENTS.md/CLAUDE.md and the managed .gitignore block are reverted before the commit; nothing else in the tree is tracked)
exit=0

$ node .claude/skills/security-evidence/scripts/evidence.mjs engagement validate
IGNORE-BLOCK: stale
TRACKED: none
KEY: available
BASELINE: present
exit=4
`````


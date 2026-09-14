# Adversarial review of the security-testing bundle spec

**Reviewer:** OpenAI Codex, model `gpt-5.6-sol`, reasoning effort `high`, read-only
**Date:** 2026-09-14
**Subject:** [`specs/2026-09-14-security-testing-bundle-design.md`](../specs/2026-09-14-security-testing-bundle-design.md) at commit 875f211
**Codex session:** 01a0a053-4306-79b1-ad4e-fcd771288fe1

Repo-facing claims (runner result tokens, `base_url` requirement, test-automation lead as top-level orchestrator, roster-guard rule, validator requiring AGENT.md/SKILL.md per declared id) were spot-checked against the working tree and hold. Line references below are into the spec and bundle files at that commit.

---

# Adversarial review

Overall verdict: **rework**.

The central product idea is buildable, but the current spec overstates enforcement, leaves critical security semantics model-controlled, and defines hand-offs that the receiving bundles do not accept. The resulting artifacts would not support claims such as “script-enforced,” “VERIFIED,” “byte-compatible,” or “auditor-recheckable.”

## Findings

1. **Blocker — §2 D2; §5.2 `gate`/`render`/`check`; §7 Guarantees**

   **Wrong:** The spec says every finding passes a “script-enforced citation gate” before appearing in a report. Later it admits the scripts are prose-invoked and the hook is audit-only ([spec lines 36, 166](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:36`)). An agent can hand-write a report or fabricate a gate stamp. `check` can validate cited bytes but cannot prove that `gate` or `render` produced the report.

   **Fix:** Change the claim to “citations are mechanically re-verifiable when the canonical pipeline is used.” Define one atomic `evidence.mjs build-report` command that creates a content-addressed manifest binding scope, findings, coverage and report hashes. Require that manifest in CI/sign-off. Do not claim unforgeable provenance unless signing credentials are outside model control.

2. **Blocker — §5.1 Finding record; §5.3; §6 `verify`**

   **Wrong:** `evidence_state: VERIFIED` is supplied by the model, not derived by a script. The final `VERIFIED` verdict is also assembled in prose: there is no `verify all` command, no schema or location for branch/suppression artifacts, and no deterministic mapping from subcommand tokens to the public verdict ([spec lines 109–145](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:109`)). A model can create three plausible JSON files and announce `VERIFIED`.

   `NOT-COMMITTED-<check>` also has no mapping to any public `UNVERIFIED-*` token, while `TESTS_FAIL` becomes `UNVERIFIED-TESTS-FAILED` without a specified transformation.

   **Fix:** Make input findings use `CLAIMED` or no evidence state. Have scripts assign `CITATION_VERIFIED`; reserve `FINDING_VERIFIED` for a fresh review receipt. Add:

   ```text
   verify.mjs all --finding <id> --base <oid> --head <oid>
   ```

   It must run or validate all checks itself, bind artifacts to the finding, exact OIDs, command hash and file hashes, and emit the sole public verdict from a closed mapping table.

3. **Blocker — §2 D5; §5.2 `wrap`; §7 untrusted-text guarantee**

   **Wrong:** Nonce delimiters do not neutralize prompt injection; they only label it. More importantly, repository `AGENTS.md`/`CLAUDE.md` may already be loaded by the host before `wrap` runs. Agents also directly read `.agents/*.md`, test cases, tracker responses, hand-offs and source comments. Those paths bypass the claimed ingest boundary ([spec lines 39, 128, 169](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:39`)).

   `wrap` also cannot enforce the stated pointer-following limits after the model decides to open another file.

   **Fix:** Recast wrapping as a defense-in-depth presentation aid, not an isolation control. Define a safe-ingest API that extracts only schema-approved fields, canonicalizes paths and strips commands/URLs/markup before model exposure. Explicitly document unavoidable host-preloaded prompt injection as residual risk. Add load-bearing rules that untrusted content can never select tools, commands, paths, acceptance status or tracker mutations.

4. **Blocker — §5.1 secret findings; §5.2 ingest; §7 Secrets**

   **Wrong:** `snippet_sha256` is underspecified: hash of the secret, line, range, normalized text, or SARIF snippet? A raw SHA-256 of a low-entropy credential becomes an offline confirmation oracle. SARIF may leak secrets through `message`, `snippet`, rule metadata, properties, fixes, logs or rejection reasons before the gate redacts anything ([spec lines 110–119, 129, 177](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:110`)).

   **Fix:** Redact before persistence, logging and rejection reporting. Never publish a digest of the secret value. Use an opaque finding ID plus redacted structural context. If later comparison is essential, use a keyed HMAC held outside report/model-visible storage and define the exact byte range and normalization. Add recursive SARIF redaction tests.

5. **Blocker — §4.1 `security-test-planning`; §7 active-test guarantee; §8 Hand-offs**

   **Wrong:** `plan-coverage.mjs` prevents generation, not execution. Existing manual-QA and test-automation roles do not read `engagement.md` or enforce `active_testing`. A hand-authored/imported case can bypass planning, and an approved plan can be run against the wrong host, production environment or after authorization expires.

   A named approver alone is also insufficient rules of engagement for active security testing.

   **Fix:** Put machine-readable authorization metadata in every case/handoff: approved targets, environment, techniques, time window, rate limits, accounts, exclusions, stop conditions and approval identity. Add an execution-time preflight to the receiving lead/runner before M4. Until those receiving-bundle changes ship, active cases must remain non-executable drafts.

6. **Blocker — §8 manual-QA hand-off**

   **Wrong:** The hand-off is not byte/contract-compatible:

   - `test-run-lead` requires the caller to provide `base_url` before discovery or dispatch ([manual lead lines 39–41, 217–219](`bundles/manual-qa/agents/test-run-lead/AGENT.md:39`)); the proposed prompt supplies only “per app_profile.md.”
   - Manual execution supports exactly `PASS | FAIL | BLOCKED`, not four tokens or `INDETERMINATE` ([runner lines 124–149](`bundles/manual-qa/agents/test-runner/AGENT.md:124`)).
   - The runner is a Playwright UI executor requiring snapshot-observable expected results. Many WSTG/API/server-side/active security tests do not satisfy that contract.
   - Security p0–p3 has no mapping to manual-QA’s `critical|high|medium|low`.
   - Dispatching `test-run-lead` as a child creates a lead→lead→runner chain even though its contract says it should be the active orchestrator.

   **Fix:** Define an adapter contract. Supply explicit `base_url`; retain manual-QA’s three tokens and map `BLOCKED → security-layer INDETERMINATE`; define priority mapping; admit only browser-observable passive/UI cases. Hand other cases to appropriate executors. Give the user a ready-to-paste top-level lead prompt rather than nesting the lead.

7. **Blocker — §4.1 `security-test-planning`; §8 test-automation hand-off**

   **Wrong:** Test automation explicitly consumes ready-made case files directly and says there is “no intermediate spec artifact” ([workflow lines 12–16, 126–166](`bundles/test-automation/skills/test-automation-workflow/SKILL.md:12`)). `automation-spec.md` is therefore not an accepted hand-off shape.

   The lead must be launched directly by the user, not dispatched by another lead ([TA lead lines 67–95](`bundles/test-automation/agents/test-automation-lead/AGENT.md:67`)). Its workflow expects `cases: [{id,title,path}]`, seeded `.agents/testing.md`, an automation-scoping verdict and N× green gating. Blanket “expected RED until fixed” conflicts with that delivery gate.

   **Fix:** Drop `automation-spec.md`. Produce TC files and a ready-to-paste top-level TAL prompt containing `slug`, `base`, and `cases[].path`. Route unfixed defects as `blocked-by-defect`/`defect-found`; automate after the fix can become green. Specify prerequisites when test-automation is not installed or not seeded.

8. **Blocker — §3 agent frontmatter/context injection**

   **Wrong:** The proposed `context-memory` values use project-root-relative paths such as `memory/<role>/project_briefing.md` and `security-testing/risk-register.md` ([spec lines 56–61](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:56`)). The hook treats these as filenames relative to `.agents/memory/<role>/`, producing duplicated paths. Declaring `context-memory` also overrides the default list verbatim, excluding `SOUL.md` and `RULES.md`, contrary to the repository’s deliberate injection policy.

   **Fix:** Use `context-memory: SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md`. Put `security-testing/risk-register.md` under `context-docs`, or extend and test the hook contract explicitly.

9. **Major — §5.2 citation gate**

   **Wrong:** A 12-character, whitespace-tolerant substring proves textual presence, not that evidence supports the vulnerability. A model can cite a generic string, comment, fixture or harmless call; use an oversized line range; or choose one of several duplicate occurrences. “Anchored at the cited line” is undefined for multiline snippets, CRLF, Unicode whitespace and inclusive ranges.

   **Fix:** Specify 1-based inclusive coordinates, encoding, newline normalization, maximum range and exact normalized-range comparison. Have the script derive citation state. For data-flow findings, require typed source/sink/control citations. Separate “citation valid” from “finding verified,” with semantic verification remaining an independent-review decision.

10. **Major — §3 rule 3; §5.2 `gate` and `render`**

    **Wrong:** The spec says an ungated finding renders under `Unverifiable`, but `gate` sends failed citations to `rejected.json`, while `render` accepts only `gated.json` ([spec lines 74–75, 126, 131](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:74`)). The declared Unverifiable section has no input.

    **Fix:** Make `gate` emit one structured result containing `accepted[]`, `unverifiable[]`, `rejected_schema[]` and counts. `render` consumes that whole result. Citation failures become unverified candidates with script-assigned capped priority; malformed records remain rejected and are summarized only by count/reason code.

11. **Major — §5.1 fingerprint; §4.1 risk register**

    **Wrong:** The fingerprint is not movement-stable:

    - File renames change the path.
    - Fixing or rotating the cited text changes the snippet/hash.
    - Identical snippets in one file collide because occurrence is omitted.
    - A model can select the snippet strategically to hijack an existing fingerprint.
    - The required input `id` is not explicitly recomputed and rejected by `gate`.

    **Fix:** `gate` must ignore/reject caller-provided IDs and derive them. Define occurrence disambiguation and `supersedes`/alias links for renames and fixes. Call it line-movement-tolerant, not movement-stable, unless semantic identity is implemented.

12. **Major — §5.2 scope/coverage/check**

    **Wrong:** Coverage is self-attested through `--examined`; it does not prove that a file/range was read. Scope, gate and render are separate commands with no binding between base/head, dirty bytes and findings. The tree can change between them, or coverage from run A can be paired with findings from run B. `HEAD` plus a dirty flag is not a snapshot.

    **Fix:** Add schemas for scope and coverage. Record per-file digests and a dirty-patch digest. Bind every artifact to `run_id`, base/head OIDs and scope hash. Fail render on mismatched hashes or stale bytes. Label examined coverage as an agent declaration, not script-proven inspection.

13. **Major — §5.3 `branch`, `suppression`, `tests`**

    **Wrong:** The subcommands cannot prove what their prose claims:

    - `branch <ref>` cannot identify the base, fix range or relevant finding.
    - `suppression <base> <ref>` cannot detect “merely deleting the flagged line” without receiving the finding/anchor.
    - Token matching misses weakened assertions, renamed suppressions, excluded paths and configuration changes.
    - First-token allowlisting does not make commands safe: `node -e`, `npm exec`, lifecycle scripts and malicious project tests remain arbitrary execution.
    - Test output may leak secrets into `tests.json`; timeout semantics and child-process cleanup are unspecified.

    **Fix:** Pass exact base/head OIDs and finding ledger to branch/suppression checks. Narrow the suppression claim to lexical indicators. Run approved argv with `spawn(..., {shell:false})`, validated cwd, minimal environment, argument-level deny rules, bounded/redacted output and process-tree termination. Require explicit authorization or isolation for executing repository-controlled tests.

14. **Major — §5.2 SARIF ingest/export**

    **Wrong:** The mapping is not implementable. SARIF commonly lacks confidence, snippets, version or a direct priority/class mapping, while the finding schema requires them and forbids defaulting. “Unknown level rejected” does not define how known levels map to p0–p3. Artifact URIs, symlinks, external paths, code flows and nested properties are untreated injection/leak surfaces.

    **Fix:** Define a versioned SARIF mapping schema, canonical path policy, allowed fields, rule/class mapping, confidence derivation and behavior for absent snippets/versions. Missing evidence should become a GAP candidate, not silently disappear. Test traversal, symlink, external URI, secret and markup cases.

15. **Major — §10 audit-only Stop hook; §7 read-only guarantee**

    **Wrong:** The hook violates the factory coexistence rule requiring roster guards for generic events ([factory spec lines 291–297](`bundles/SPEC.md:291`)). It has no agent identity, no session baseline and uses global `git status`, so it cannot say which role touched product paths. A persistent `engagement.md` causes unrelated development sessions to be logged. `Stop` plus `SessionEnd` can duplicate records, and async execution can race shutdown.

    It is therefore not an audit of the read-only property—only a best-effort dirty-tree observation.

    **Fix:** Remove the global hook in v1, or rename it to an explicitly opt-in consistency observer. Run checks synchronously from security sign-off/CI. Do not use it as support for “product code never edited.”

16. **Major — §2 D8; §10 Hook files**

    **Wrong:** D8 says all scripts are stdlib ESM Node with no bash-sensitive shell, but the planned hook uses extensionless `gate-audit`/`probe-hook-input` plus `run-hook.cmd`. The existing wrapper executes those scripts through Bash on Unix ([manual wrapper lines 55–59](`bundles/manual-qa/hooks/scripts/run-hook.cmd:55`)).

    **Fix:** Make hook implementations `.mjs` and have the portability wrapper invoke Node, or explicitly exempt the existing wrapper from D8. Add Windows, paths-with-spaces and missing-Bash tests.

17. **Major — §2 D12; §10 `factory.json`**

    **Wrong:** Listing `security-evidence` in both `skills` and `localSkills` does not make it install with standalone `--skills security-testing/secure-code-review`. The factory manifest is not loaded for standalone skill selection, and skills do not recursively install sibling dependencies. Under a full factory install, every `localSkills` entry is already installed, so the duplicate `skills` entry is ineffective.

    **Fix:** Either make each standalone skill self-contained, add supported skill dependency metadata to the installer, or document/install both qualified skills explicitly. Add standalone-install tests for every advertised entry point.

18. **Major — §10 files; §12 M0; repository conventions**

    **Wrong:** M0 declares three `localAgents` and six `localSkills` while leaving their directories empty, yet claims installation and validation are green. Validation requires every declared agent to have `AGENT.md` and every local skill to have `SKILL.md` ([factory spec lines 306–322](`bundles/SPEC.md:306`)).

    The exact `factory.json` and complete `FACTORY.md` frontmatter are also missing from the design. Only some descriptor fields are named; required `description`, `owner` and `authors` are not locked.

    **Fix:** Merge M0 with a minimal real agent/skill milestone, or omit undeveloped IDs until their files exist. Put the complete proposed manifest and descriptor frontmatter in the spec, including `agents: []`, all mappings and authors.

19. **Major — repository path conventions**

    **Wrong:** The proposal correctly uses `bundles/security-testing`, matching the actual installer, but the governing [CLAUDE.md lines 13–24](`CLAUDE.md:13`) and [bundles/SPEC.md lines 71–110](`bundles/SPEC.md:71`) still instruct authors to use `factories/<id>`. The spec does not call out this contradiction, so an implementer following the required documents can scaffold the wrong tree.

    **Fix:** Add a prerequisite milestone that reconciles those governing docs with `FACTORIES_DIR = "bundles"`, or explicitly state that installer code is authoritative until the documentation correction lands.

20. **Major — §4.1 risk register; §5.3/§6 status semantics**

    **Wrong:** Markdown and JSON are both described as the model of record, with no reconciliation rule. Status transitions are undefined: `fixed`, `retested` and `regressed` overlap; `REGRESSED` makes no sense unless a prior verified-fixed state exists. “Never delete, supersede” has no command or schema fields supporting supersession. `accept` allows an agent to record risk acceptance without an authenticated human decision.

    **Fix:** Make JSON the canonical SSOT and Markdown generated. Define an append-only event schema, transition table, `supersedes`, acceptance approver/evidence, UTC expiry semantics and human-confirmation requirement. Scripts alone update the current projection.

21. **Major — §7 artifact confidentiality**

    **Wrong:** `artifact_visibility: committed|local` cannot express the proposed mixed defaults. A `.gitignore` is not confidentiality enforcement: it does not protect already tracked files, chat/tool logs, telemetry, cloud sync, backups or `git add -f`. Defaulting the residual-risk register to committed in a public repository exposes arguably the most sensitive artifact ([spec lines 177–179](`docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md:177`)).

    **Fix:** Default every security artifact to local in public repositories. Use per-artifact policy, explicit export approval, redacted publish copies, `git ls-files`/`git check-ignore` checks, retention rules and warnings that “local” is not confidential storage.

22. **Major — §5.2 report rendering; §4.1 engagement/report**

    **Wrong:** A five-line finding containing fingerprint, path, class, snippet hash and one-line detail is not a professional security assessment or pentest artifact. It omits reproducibility, impact, attack prerequisites, affected assets, methodology, evidence chain, severity rationale, remediation validation and retest history. An arbitrary `--template <file>` can also defeat “Coverage first” or inject active Markdown/HTML.

    **Fix:** Own the report structure in code or allow only validated shipped templates. Add executive summary, RoE, dates/OIDs, methodology, coverage, limitations, risk methodology, detailed finding records, reproduction/evidence references, remediation, retest status and chain-of-custody hashes. Sanitize raw HTML, Markdown links/images, control/bidi characters, fence terminators and path/table metacharacters. Do not market the result as a pentest because exploitation is explicitly excluded.

23. **Major — §6 `assess` versus reviewer contracts**

    **Wrong:** `assess` runs a fresh reviewer using the “verify contract” against the threat model’s mitigation claims. That contract is defined only for a fix PR/branch and requires branch, suppression and test artifacts. Existing mitigation claims have none of those.

    **Fix:** Add a distinct `mitigation-review` contract that refutes code-derived mitigation claims and returns `CONFIRMED | GAP | UNVERIFIABLE`. Reserve fix verification for a concrete base/head and finding fingerprint.

24. **Minor — §11 tests; §12 milestones**

    **Wrong:** The proposed tests omit the adversarial seams most likely to break the guarantees: forged gate stamps, mixed-run artifacts, generic/repeated snippets, oversized ranges, CRLF/Unicode, path traversal, symlinks, TOCTOU, SARIF nested leaks, Markdown/HTML injection, stale tracked secrets, fabricated verification artifacts and unsafe command arguments. Six model fixtures plus a deterministic scorer do not establish actual reviewer recall/precision unless model outputs are produced and frozen by a defined harness.

    The M5 smoke command using `--target {claude,cursor,codex,copilot}` is also ambiguous as an executable command.

    **Fix:** Add those negative fixtures and an end-to-end manifest test. Separate deterministic parser/scorer tests from model evals. Run four explicit smoke commands or one documented comma-separated target list.

## Top five changes

1. Make citation and fix-verification states script-derived, with one atomic, content-bound report/verification manifest.
2. Replace the nonce-wrap security claim with a real untrusted-input minimization model; perform redaction before persistence and lock down command execution.
3. Redesign active-testing authorization so it is enforced at execution, not merely when plans are generated.
4. Replace both hand-offs with the exact receiving-bundle contracts: manual-QA’s three-token/base-URL protocol and test-automation’s direct TC-file/top-level-orchestrator intake.
5. Fix installation/build sequencing: correct `context-memory`, standalone dependency behavior, complete manifests/frontmatter and a genuinely green M0.

No files were modified.
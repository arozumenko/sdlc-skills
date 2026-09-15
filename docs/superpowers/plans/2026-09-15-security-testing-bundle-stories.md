# security-testing bundle v1 — Epic and user stories

**Date:** 2026-09-15
**Author:** Alex (ba, feature-development bundle)
**Source spec:** [`2026-09-14-security-testing-bundle-design.md`](../specs/2026-09-14-security-testing-bundle-design.md) v6 (approved with changes). §2 promises and §3 decisions are locked; nothing below redesigns them.
**Scope of this document:** v1 only — milestones M-1, M1, M2, M3, M4, M5 (spec §13). Every v2 skill named in spec §5 is in the parking lot.
**Where spec v6 says "as v3 §N"** the story cites `v3 §N` and the tech lead reads that section from commit `028fab1`.

Conventions used in every story below:

- **Command names, exit codes, result tokens, file paths and schema names are quoted exactly as the spec defines them.** Exit codes follow the common table (v3 §6): `0` ok, `2` usage, `3` INDETERMINATE-class refusals (`DIRTY-TREE`, `INCOMPLETE(<input>)`), `4` verification failure (`engagement init` fail-closed, `sign-off`, `NO-ASSESSMENT`), `5` integrity mismatch (`CORRUPT`).
- Paths are relative to the consumer project root unless prefixed `bundles/` (this repo). `<st>` abbreviates `.agents/security-testing/`.
- A story's **Open Questions** section is omitted when it has none; the only open questions in v1 are the five in spec §14 and they live on the Epic.
- Stories are numbered in dependency-friendly order; the **Dependencies** section of the Epic lists cross-story blockers.

---

# [EPIC] security-testing bundle v1

## Problem Statement

Delivery teams that install sdlc-skills have no security role. Today a security lead either runs ad-hoc scanners whose output nobody can re-check, or writes a threat model by hand that drifts from the code the day it is written. Findings reach developers as prose, fixes get "verified" by whoever last looked, and there is no register of what was accepted, by whom, and until when. QA teams receive "security test cases" with no guarantee that the cases are passive. Auditors get a PDF and cannot tell whether its numbers were derived from the evidence it cites.

The people who have this problem:

| Persona | Who they are | What they need from the installed bundle |
|---|---|---|
| **Security lead** | The one human-facing security role on a delivery team; runs the engagement | `engagement init`, `review`, `verify`, `assess`, `sign-off`, hand-off prompts, tracker publication |
| **Developer** | Receives a finding, fixes it, wants a script-emitted verdict rather than an opinion | a tracker ticket with `context_redacted` + `fix_prompt`; `verify.mjs all` grading `base..head` |
| **QA lead** | Runs the manual-qa (`test-run-lead`) or test-automation bundle and receives a hand-off suite | a suite directory that contains only admitted `TC-*.md`; a prompt they can paste |
| **Auditor** | Has the repo and a report; wants to know whether the report is consistent with its recorded inputs and whether the tree has drifted since | `check`, `check-export`, `register.mjs anchor verify` |
| **Maintainer** | Owns this repo; installs and validates the bundle on every host | `npm test`, `npm run validate`, four-target smoke, correct docs |

## Goal

Ship `bundles/security-testing/` v1: a threat-led, read-only security testing team whose every displayed number can be recomputed from recorded inputs by anyone with the repo (spec §2 left column), installable via `--factory security-testing` on all four targets and as the two-skill standalone review (D12).

## Scope

**In scope (v1 — spec §13 M-1 … M5):**

- M-1 — Doc-fix PR: `factories/` → `bundles/` in `CLAUDE.md` and `bundles/SPEC.md`, `hooks/config.sh.example` default memory-file list, `CLAUDE.md` validate command list.
- M1 — `security-evidence` complete (every script, schema, template, deterministic test, both installed E2E paths), `secure-code-review`, `security-engagement`, the `security-reviewer` agent, the M1 `factory.json`.
- M2 — `threat-modeling` skill + `threat-modeler` agent; `sign-off` disposition policy live.
- M3 — `security-lead` agent, `security-test-planning`, `risk-register` (prose), hand-offs to manual-qa / test-automation / tracker, final manifest.
- M4 — Follow-up PRs to receiving bundles (manual-qa, feature-development) and the `execution-authorization` design note.
- M5 — Docs, four-target + two-skill smoke, dogfood `assess` on this repo, hook-input probe result.

**Out of scope (parking lot):**

- v2 skills named in spec §5: `privacy-threats`, `security-requirements`, `supply-chain-review`, `threat-model-export`, `agentic-surface-review`, `security-evals`, `mitigation-reconciliation`, `execution-authorization` (receiving-side; owned by the QA bundles) — deferred by spec §5 "v2".
- Bundle hooks of any kind — D4 locks v1 to prose + baseline observation.
- Any `confirm` command or "confirmed" approval state — D15 removes it permanently, not just for v1.
- Active/exploitative testing turned into executable cases — needs the v2 `execution-authorization` preflight (v3 §9.4).
- Provenance / origin of a run directory — D2: consistency, not provenance.
- manual-qa explicit-list intake branch — M4 raises it as a proposal to that bundle; the dedicated suite does not depend on it (§9.2).
- Penetration testing / exploitation — §1: "a security assessment, not a penetration test".

## User Stories

**M-1 — Doc fix**
- [ ] US-001: Repo docs match the installer (`bundles/`, memory-file default, validate command list)

**M1 — `security-evidence` + review path + `security-reviewer`**
- [ ] US-002: Canonical bytes, envelopes and artifact identity
- [ ] US-003: One redaction function applied by every writer
- [ ] US-004: `engagement init` writes the managed ignore block and fails closed
- [ ] US-005: `engagement init` creates, reuses and rotates the HMAC key
- [ ] US-006: `engagement init` records the per-path working-tree baseline
- [ ] US-007: `engagement init` writes knowledge templates when seeded copies are absent
- [ ] US-008: `run init` allocates a run before any input exists
- [ ] US-009: `scope` records a clean assessment scope or a redacted review snapshot
- [ ] US-010: `ingest sarif` with the closed fallback matrix
- [ ] US-011: Tracker-side ingest adapters (`ticket`, `pr`, `doc`, `tracker-readback`)
- [ ] US-012: QA-side ingest adapters (`case`, `audit`, `qa-run`, `ta-report`)
- [ ] US-013: `gate` derives finding ids and citation states by content sensitivity
- [ ] US-014: `coverage` accounts for every scoped range exactly once
- [ ] US-015: `packet` and `receipt` — reviewers assert, scripts derive states
- [ ] US-016: `build-report` renders from a closed, transitively required input set and commits the run
- [ ] US-017: `check` recomputes every displayed value and reports drift and origin
- [ ] US-018: `verify.mjs all` executes tests from a validated test-start snapshot
- [ ] US-019: `verify.mjs evaluate` — pure verdict function with fixed precedence
- [ ] US-020: `register.mjs` — hash-chained event log, replay, recovery and anchor
- [ ] US-021: `register.mjs` transitions, unauthenticated approvals, supersession and aliases
- [ ] US-022: Register consumes verify verdicts
- [ ] US-023: `publish --profile` and `check-export`
- [ ] US-024: `purge --engagement`
- [ ] US-025: `sign-off --engagement`
- [ ] US-026: `secure-code-review` skill with fixtures and frozen eval harness
- [ ] US-027: `security-engagement` skill (lead workflow prose)
- [ ] US-028: `security-reviewer` agent
- [ ] US-029: M1 bundle manifest, catalog descriptor, README guarantees and role-scoped instructions
- [ ] US-030: Installed end-to-end tests, offline, both install shapes

**M2 — threat model**
- [ ] US-031: `threat-modeling` skill and `tm-lint check|render` with relationship-validated dispositions
- [ ] US-032: `threat-modeler` agent
- [ ] US-033: `sign-off` enforces `sign_off.require_dispositions`

**M3 — planning, hand-offs, lead**
- [ ] US-034: `security-test-planning` skill and `plan.mjs admit`
- [ ] US-035: Admitted hand-off suite for manual-qa
- [ ] US-036: QA run results become observations
- [ ] US-037: test-automation hand-off and `ta-report` intake
- [ ] US-038: Active-testing proposals stay outside `tasks/`
- [ ] US-039: Developer receives a finding through the `tracker` profile with read-back
- [ ] US-040: `risk-register` skill (prose)
- [ ] US-041: `security-lead` agent and the `assess` flow
- [ ] US-042: Final bundle manifest

**M4 — receiving bundles**
- [ ] US-043: manual-qa follow-up PR (Step 0 row + explicit-list intake proposal)
- [ ] US-044: feature-development follow-up PR (`code-review` pointer)
- [ ] US-045: `execution-authorization` design note for both QA bundles

**M5 — shippable v1**
- [ ] US-046: Catalog rows, marketplaces and final docs
- [ ] US-047: Four-target and two-skill smoke
- [ ] US-048: Dogfood `assess` on sdlc-skills
- [ ] US-049: Hook-input probe result recorded

## Success Criteria

- Every row of spec §2 left column has at least one story whose ACs exercise the named script and token; every row of the right column appears in the README "Not guaranteed" section (US-029) — spec §15 consistency check holds.
- `npm test` passes with every `*.test.mjs` under `bundles/security-testing/skills/security-evidence/scripts/` and both installed E2E paths (US-030) green, with no network.
- `npm run validate` passes at M1 (US-029) and at M3 (US-042).
- The four-target smoke and the two-skill standalone smoke (US-047) succeed; the two-skill path's `sign-off` exits `4 NO-ASSESSMENT` with no `UNGATED` banner.
- Dogfood `assess` on this repo (US-048) produces a `COMMITTED` assessment run whose `check` prints `CONSISTENT` and `CURRENT`.
- No catalog or manifest text contains the phrase "exact checkout" (§10).

## Dependencies

**Story-to-story (blocking):**

| Blocked | Blocked by | Why |
|---|---|---|
| every M1 script story | US-002, US-003 | canonical bytes and redaction are used by every writer |
| US-008 … US-025 | US-004, US-005 | key and managed paths must exist before any artifact is written |
| US-013 `gate` | US-009 `scope` | ids reference `scope_sha256` |
| US-015 `packet`/`receipt` | US-009, US-013 | packets cite scope sides and finding ids |
| US-016 `build-report` | US-008 … US-015 | closed required-inputs list |
| US-017 `check` | US-016, US-019, US-020 | recomputes via `gate`, `coverage`, `receipt apply`, `verify.mjs evaluate`, `register.mjs replay` |
| US-018 `verify all` | US-015, US-019 | fix-review packet/receipt; evaluate |
| US-022 | US-019, US-021 | verdict → transition |
| US-025 `sign-off` | US-006, US-016, US-017, US-020 | reads `ledger/index.json`, baseline, `check` results, register |
| US-030 E2E | all of US-004 … US-029 | runs the whole pipeline in both install shapes |
| US-031 `tm-lint` | US-015, US-020, US-036, US-038, US-039 | dispositions reference receipts, register rows, observations, proposals, tickets |
| US-033 | US-031, US-025 | disposition policy at sign-off |
| US-035, US-036, US-037 | US-034 | admission record feeds suite, observations and TA prompt |
| US-041 `security-lead` | US-027, US-034 … US-040 | orchestrates all of them |
| US-042 | US-028, US-032, US-041 | three `localAgents` |
| US-048 dogfood | US-042, US-047 | full bundle installed on this repo |

**External / follow-up PRs (spec §13 M-1, M4):**

- **M-1 doc-fix PR (US-001)** — lands first, on its own branch, before M1 implementation begins; implementers follow the corrected docs.
- **manual-qa follow-up PR (US-043)** — `bundles/manual-qa/agents/test-run-lead/AGENT.md` Step 0 row naming `tasks/security-<slug>-admitted/`; a proposal (not an implementation) for an explicit-list intake branch. The dedicated suite (US-035) does not depend on this PR.
- **feature-development follow-up PR (US-044)** — one-line pointer in `bundles/feature-development/skills/code-review/SKILL.md` § 2 to the two-skill security review install.
- **`execution-authorization` design note (US-045)** — placed in both `bundles/manual-qa/` and `bundles/test-automation/`; ownership is spec §14 open question 5.
- **Upstream external skills at install time** — `systematic-debugging` (reviewer on-demand) is fetched from its `repo:` entry; the E2E (US-030) provisions it offline via `SDLC_SKILLS_CACHE_DIR`.

## Open Questions

Only the five spec §14 items are open; nothing else in this document needs a decision from the user.

- [ ] **Hook-input identity (v2 hooks).** What identity does a host hand a hook, and can it be trusted? v1 ships no bundle hooks (D4); US-049 records the probe result so v2 can decide.
- [ ] **Threat-model completeness measure.** Spec §8 lists threat completeness as not guaranteed; there is no agreed metric for "complete enough". Does v1 report a number at all, or only `unknown / not assessed`?
- [ ] **Do consumers keep the manifest digest and register anchor outside the repo?** `check --trusted-digest` and `anchor verify --expect` only detect rewrites when the consumer holds those values elsewhere (CI variable). Do we recommend it in the README, require it in the sign-off checklist, or leave it to the consumer?
- [ ] **LINDDUN licence.** Affects `privacy-threats` (v2) and whether `threat-modeling` may reference LINDDUN categories in v1 prose.
- [ ] **`execution-authorization` ownership.** Spec §5 says "owned by the QA bundles"; US-045 writes the design note into both. Which bundle's maintainer signs off on the v2 skill?

---

# M-1 — Doc fix

# US-001: Repo docs match the installer (`bundles/`, memory-file default, validate command list)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M-1
**Spec:** §13 M-1; "Sources of truth for repo claims" preamble; v3 §13 M-1
**Priority:** must-have
**Size:** S

## Story
As the sdlc-skills maintainer,
I want `CLAUDE.md`, `bundles/SPEC.md` and `hooks/config.sh.example` to describe what `bin/init.mjs`, `hooks/lib.sh` and `package.json` actually do,
so that whoever implements M1 follows correct paths, a correct memory-file default and the full validate command.

## Acceptance Criteria

### AC-1: Directory name
**Given** `bin/lib/item-resolver.mjs` sets `FACTORIES_DIR = "bundles"`
**When** I grep `CLAUDE.md` and `bundles/SPEC.md` for `factories/`
**Then** every occurrence that names a repo path reads `bundles/<id>` (the CLI flag name `--factory` and the `factory.json` / `FACTORY.md` file names are unchanged and still present).

### AC-2: Memory-file default
**Given** `hooks/lib.sh` line `SDLC_ROLE_MEMORY_FILES_DEFAULT="SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md"`
**When** I read the commented default for `SDLC_ROLE_MEMORY_FILES` in `hooks/config.sh.example`
**Then** it lists the same five files in the same order, including `RULES.md`.

### AC-3: Validate command list
**Given** `package.json` defines `validate` as `validate:factories && validate:marketplaces && validate:externals && validate:dupes`
**When** I read the `## Commands` block of `CLAUDE.md`
**Then** `npm run validate` is described as running all four steps and the note says `validate:externals` needs network.

### AC-4: Nothing else moves
**Given** the doc-fix branch
**When** `npm run validate:factories && npm run validate:marketplaces && npm test` run
**Then** all three exit `0` and `git diff --stat` touches only `CLAUDE.md`, `bundles/SPEC.md`, `hooks/config.sh.example` (and `AGENTS.md`/`README.md` only where they repeat a `factories/` path).

## Notes
- This is a separate PR that merges before any M1 code; the spec's "Sources of truth" list is the checklist.

## Out of Scope
- Renaming `factory.json`, `FACTORY.md`, the `--factory` flag or `validate:factories` — the installer keeps those names.

---

# M1 — `security-evidence`, review path, `security-reviewer`

# US-002: Canonical bytes, envelopes and artifact identity

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.1; D14; v3 §6.1 (text normalisation, range rule, occurrence); §12 "scope identity independent of envelope"
**Priority:** must-have
**Size:** M

## Story
As an auditor,
I want every artifact's identity to be a hash of its payload alone, computed from one canonical byte form,
so that two people who hold the same recorded inputs compute the same identity regardless of who wrote the envelope or when.

## Acceptance Criteria

### AC-1: Envelope/payload shape
**Given** any artifact written by `evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs` or `plan.mjs`
**When** it is parsed
**Then** it is `{envelope, payload}` with `envelope = {schema_version, kind, run_id, engagement_id, key_id, created_at, self_sha256}` and `self_sha256 == sha256(canonical(payload))`.

### AC-2: Envelope never in a preimage
**Given** two `scope.json` files with identical `payload` and differing `envelope.created_at` and `envelope.run_id`
**When** `self_sha256` is computed for each
**Then** the two values are byte-equal (the §12 "scope identity independent of envelope" fixture).

### AC-3: `canon.mjs` rules
**Given** a payload containing a duplicate key, a float, a non-NFC string and CRLF
**When** `canonical()` runs
**Then** the duplicate key is rejected on read with a non-zero exit and a reason, the float is rejected (integers only, no floats anywhere in any schema), the string is NFC-normalised, output is UTF-8 with LF, keys sorted bytewise, no insignificant whitespace.

### AC-4: Preimage table honoured
**Given** the §6.1 preimage table
**When** each of `run.json`, `scope.json`, `findings.claimed.json`, `gate-result.json`, `coverage.json`, `packet.json`, `receipt.json`, `manifest.json` is produced by a fixture pipeline
**Then** its `payload` keys are exactly those listed in the table row (`run.json` = `{engagement_id, seq, base_oid, head_oid, template}`, … `manifest.json` = `{inputs: {kind → sha256}, report_sha256, template, template_version, tool_version}`).

### AC-5: `normalize.mjs` test vectors
**Given** the published test vectors (BOM, CR, `\r\n`, tab runs, empty lines)
**When** `normalize.mjs` runs each
**Then** output matches the vector: strict UTF-8 decode (invalid ⇒ reject), BOM stripped, newlines → `\n`, NFC, horizontal whitespace runs collapsed and trimmed per line, empty lines dropped and no other line removed.

### AC-6: Range rule
**Given** a citation with `end - start + 1 = 41`, and another whose primary range lies outside every admitted range of its file
**When** validated
**Then** both are rejected with a reason; a citation of 40 lines inside an admitted range is accepted; a typed citation (`source|sink|control`) outside admitted ranges is accepted and flagged `context: true`.

## Notes
- The JSON model is the record; Markdown is always generated from it (D14). Every later script story assumes these rules and does not re-state them.
- Schema files named in §5 live under `bundles/security-testing/skills/security-evidence/references/` (v3 §10 pattern): `run`, `scope`, `finding`, `gate-result`, `coverage`, `packet`, `receipt`, `verify`, `run-manifest`, `register`, `register-event`, `finding-alias`, `proposal`, `admission`, `observation`, `import`, `export-manifest`, `sarif-mapping.v1`, `redaction-rules`.

## Out of Scope
- HMAC/keyed identities — US-005 and US-013.

---

# US-003: One redaction function applied by every writer

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §2 row 4; §6.5 "Redaction is one function"; D16
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want every string this bundle persists or prints to pass through one versioned redaction function,
so that no artifact under `.agents/security-testing/` — including `private/` — a report, a tracker body or a hand-off prompt contains original bytes that match a redaction rule.

## Acceptance Criteria

### AC-1: Recursive application
**Given** a nested object whose rejection reason, log line and SARIF `message.text` each contain `password=1234`
**When** any writer persists it via `redact.mjs`
**Then** every string at every depth is redacted; grepping the written bytes for `password=1234` finds nothing.

### AC-2: Versioned rules
**Given** `references/redaction-rules` with a `redaction_version`
**When** a private citation record or an import snapshot is written
**Then** it records the `redaction_version` used.

### AC-3: Bounded guarantee stated
**Given** the README Guarantees table (US-029)
**When** I read the redaction row
**Then** it says the guarantee is bounded to the rule list and lists "secrets outside the rule list" under Not guaranteed.

### AC-4: Order read → HMAC → redact → persist
**Given** a review-kind dirty file (US-009) or an ingest input (US-011/US-012)
**When** it is persisted
**Then** the HMAC of the original bytes is computed before redaction and only the redacted bytes reach disk (asserted by the §12 dirty-snapshot fixture: no original bytes anywhere under `.agents/security-testing/`).

## Notes
- "Every writer" includes: `scope` snapshots, `ingest` imports, `gate` rejection reasons, `verify` bounded test output, `publish` tracker bodies, hand-off prompts, `sign-off` listings, `tm-lint`/`plan.mjs` output.

## Out of Scope
- Keyed identities — US-013.

---

# US-004: `engagement init` writes the managed ignore block and fails closed

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.9 steps 1–2; D13; §4 rule 2; §12 "tracked file under local paths"
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want `evidence.mjs engagement init` to make every private destination git-ignored before anything is written, and to refuse to start if any of them is tracked or not effectively ignored,
so that security artifacts stay local by default and never land in a commit by accident.

## Acceptance Criteria

### AC-1: Exact managed block
**Given** a consumer repo with no `.gitignore` block
**When** `evidence.mjs engagement init` runs
**Then** the root `.gitignore` contains, between `# security-testing:begin` and `# security-testing:end`, exactly these patterns and no others: `.agents/security-testing/private/`, `.agents/security-testing/ledger/`, `.agents/security-testing/runs/`, `.agents/security-testing/receipts/`, `.agents/security-testing/proposals/`, `.agents/security-testing/handoffs/`, `.agents/security-testing/imports/`, `reports/security/`, `tasks/security-*/`.

### AC-2: Idempotent
**Given** the block already exists
**When** `engagement init` runs again
**Then** the file is byte-identical afterwards (one block, unchanged content outside the markers).

### AC-3: Tracked file ⇒ exit 4
**Given** `git ls-files` lists a file under any managed path
**When** `engagement init` runs
**Then** it exits `4`, names the offending path, and writes nothing under `.agents/security-testing/`.

### AC-4: Not effectively ignored ⇒ exit 4
**Given** a `.gitignore` negation elsewhere that un-ignores `reports/security/`
**When** `engagement init` probes each managed path with `git check-ignore -q <probe file>`
**Then** the failing probe makes `engagement init` exit `4` naming the path, and no key or baseline is created.

### AC-5: Only writer of the block
**Given** any other command in the bundle
**When** it runs
**Then** it never modifies the root `.gitignore` (asserted by hashing `.gitignore` before and after a full pipeline run).

## Notes
- Steps 3–5 of `engagement init` are US-005, US-006, US-007; they execute only after AC-3/AC-4 pass.
- `engagement validate` (named in §5) re-runs AC-3/AC-4 checks without writing; `engagement baseline` re-runs US-006's step. The spec names both but details neither beyond the name; tech lead confirms this minimal reading at decomposition.

## Out of Scope
- Encryption of local artifacts (spec §8 Not guaranteed).

---

# US-005: `engagement init` creates, reuses and rotates the HMAC key

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.5 keys; §6.3 `KEY:` line; §12 "repeated engagement init reuses the key, --rotate adds one"
**Priority:** must-have
**Size:** S

## Story
As a security lead,
I want the engagement's HMAC key created once, reused on re-runs and rotated only on request,
so that keyed identities stay comparable across runs and a rotation never invalidates old artifacts silently.

## Acceptance Criteria

### AC-1: First run creates with `O_EXCL`
**Given** `private/keys/` is empty
**When** `engagement init` runs
**Then** `private/keys/<key_id>` exists, was opened with `O_EXCL`, and every artifact written afterwards records that `key_id` in its envelope.

### AC-2: Re-run reuses
**Given** one key exists
**When** `engagement init` runs again without `--rotate`
**Then** no new file appears under `private/keys/` and the key bytes are unchanged.

### AC-3: Rotate adds, never deletes
**Given** one key exists
**When** `engagement init --rotate` runs
**Then** a second `private/keys/<new key_id>` exists, the old file is untouched, and new artifacts record the new `key_id`.

### AC-4: Loss is visible
**Given** an artifact whose `key_id` file has been deleted
**When** `check` runs on its run directory
**Then** the output contains `KEY: unavailable` and the report's Limitations section (US-016) lists that artifact.

---

# US-006: `engagement init` records the per-path working-tree baseline

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §2 row 7; §6.9 step 4; §12 "dirty tracked and untracked baseline changes listed per path", "changed ignored product file ⇒ excluded coverage"
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want the engagement to record what the working tree looked like when it started,
so that `sign-off` can list every tracked or non-ignored untracked file under scope and product paths that changed during the engagement, and can show how much was outside the observation.

## Acceptance Criteria

### AC-1: Baseline contents
**Given** `engagement.md` declares `scope_paths` and `product_paths`
**When** `engagement init` runs
**Then** `private/baseline.json` holds a per-path HMAC of working-tree content for every tracked file and every non-ignored untracked file under those paths, plus HEAD and index state, plus `ignored_count` per path.

### AC-2: Tracked change listed
**Given** a baseline, then a tracked file under `product_paths` is edited
**When** `sign-off` runs
**Then** its informational list names that path as changed since baseline.

### AC-3: Untracked change listed
**Given** a baseline, then a new non-ignored file is created under `scope_paths`
**When** `sign-off` runs
**Then** the list names that path.

### AC-4: Ignored change is excluded coverage, not a change
**Given** a baseline, then a git-ignored file under `product_paths` is modified
**When** `sign-off` runs
**Then** the path is not in the change list, and the excluded-coverage line reports the `ignored_count` for that path.

## Notes
- The promise is observation, not attribution (§2 right column: "Attribution of a change to a role" is not promised).

---

# US-007: `engagement init` writes knowledge templates when seeded copies are absent

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** D12; §6.9 step 5; §7 two-skill row
**Priority:** must-have
**Size:** S

## Story
As a security lead using the two-skill standalone install (`--skills security-testing/secure-code-review,security-testing/security-evidence`),
I want `engagement init` to write the knowledge templates the commands need,
so that the review path works without the bundle's `seed` step (standalone `--skills` installs no seeds and no instructions).

## Acceptance Criteria

### AC-1: Absent ⇒ written
**Given** `.agents/security-testing/knowledge/` does not exist
**When** `engagement init` runs
**Then** the templates (`engagement.md` template, `finding-schema.md`, and every file the bundle's `seed.knowledge` would have installed) exist under `.agents/security-testing/knowledge/`.

### AC-2: Present ⇒ untouched
**Given** the seeded copies exist (full-bundle install) and one has been edited locally
**When** `engagement init` runs
**Then** no file under `knowledge/` changes.

### AC-3: Two-skill install runs the M1 command set
**Given** the two-skill install and an `engagement init`
**When** `run init --kind review`, `scope`, `gate`, `coverage`, `packet`, `receipt`, `build-report --template review`, `check`, `verify.mjs all`, `register.mjs`, `sign-off` are invoked
**Then** none exits `2` for a missing template; only `tm-lint.mjs` and `plan.mjs` are expected to be unused on this path.

---

# US-008: `run init` allocates a run before any input exists

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.1 order and ledger; §6.2 first bullet; D18; §12 "run init allocation before inputs", "assessment on dirty tree refused"
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want `evidence.mjs run init --kind assessment|review` to allocate a sequence number and run directory first, and to refuse an assessment on a dirty tree,
so that every later artifact belongs to a run that is in the inventory, and an assessment scope is always a clean tree at `head_oid`.

## Acceptance Criteria

### AC-1: Allocation is first
**Given** an initialised engagement
**When** `run init --kind review` runs
**Then** `run.json` exists with payload `{engagement_id, seq, base_oid, head_oid, template}` before any `scope.json` exists, and `ledger/index.json` gained one `{seq, run_id, kind}` entry appended under a lock.

### AC-2: Dirty tree refuses assessment
**Given** `git status --porcelain` is non-empty
**When** `run init --kind assessment` runs
**Then** it exits `3` with `DIRTY-TREE`, and `ledger/index.json` is unchanged.

### AC-3: Dirty tree allows review
**Given** the same dirty tree
**When** `run init --kind review` runs
**Then** it exits `0` and allocates the run.

### AC-4: Retry is a new seq
**Given** a run that was started but never reached `build-report`
**When** `run init` runs again
**Then** a new `seq` is allocated; nothing in the earlier run directory is rewritten.

### AC-5: Concurrent allocation
**Given** two `run init` processes started at once
**When** both finish
**Then** `ledger/index.json` holds two entries with distinct `seq` and the file parses.

---

# US-009: `scope` records a clean assessment scope or a redacted review snapshot

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.2; D18; §2 row 2; §12 "dirty review snapshot of a file containing password=1234"
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want `evidence.mjs scope` to record exactly which files and ranges a run examines, and — for a dirty `review` run — a redacted private snapshot of each dirty file plus an HMAC of its original bytes,
so that citations can later be resolved against the recorded side and dirty content is never stored in the clear.

## Acceptance Criteria

### AC-1: Payload
**Given** a run
**When** `scope` runs
**Then** `scope.json` payload is `{files[], ranges, skipped[], snapshot?}` and its `self_sha256` is the `scope_sha256` later artifacts reference.

### AC-2: Assessment on a clean tree has no snapshot
**Given** `run init --kind assessment` succeeded
**When** `scope` runs
**Then** `payload.snapshot` is absent and no `private/snapshots/<run>/` directory is created.

### AC-3: Review snapshot is redacted with HMAC
**Given** a `review` run and an in-scope dirty file containing `password=1234`
**When** `scope` runs
**Then** `private/snapshots/<run>/<path>` exists and contains no `password=1234`; `payload.snapshot` records the HMAC of the original bytes for that path; grepping every file under `.agents/security-testing/` for `password=1234` finds nothing.

### AC-4: Untracked in-scope file
**Given** a `review` run and an untracked in-scope file
**When** `scope` runs
**Then** it is snapshotted and HMAC'd the same way as a dirty tracked file.

### AC-5: Side-aware citation resolution
**Given** citations with `side: base`, `side: head`, `side: snapshot`
**When** any script resolves cited bytes
**Then** `base`/`head` resolve via `git show <base_oid|head_oid>:<path>` and `snapshot` via the private snapshot; a `side: base` citation of deleted code passes `check --integrity` (§12 fixture).

## Notes
- Scope is empty ⇒ `coverage` yields `INDETERMINATE` (US-014), not `scope` — `scope` still writes the artifact.

---

# US-010: `ingest sarif` with the closed fallback matrix

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.6 `ingest sarif` row; §6.7; D6; §6.6 import snapshot paragraph; §12 "SARIF unlocated candidates never reach gate", "redaction inside nested SARIF strings"
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want scanner output to enter only as SARIF through `evidence.mjs ingest sarif` with a versioned mapping,
so that every scanner row becomes either a located candidate, an unlocated candidate with a reason, or a counted rejection — never a silently promoted or dropped finding.

## Acceptance Criteria

### AC-1: Trusted vs inert fields
**Given** a SARIF file whose `message.text` contains a path-like instruction
**When** `ingest sarif` runs
**Then** only the canonical in-repo path within scope, the rule id and the level act; `message.text` and `snippet.text` are quoted, redacted and wrapped, never used to select a path.

### AC-2: Fallback matrix, row by row
**Given** fixtures for each §6.7 condition
**When** `ingest sarif` runs
**Then**: no `physicalLocation` / non-canonicalisable URI ⇒ unlocated candidate; in-repo path outside scope ⇒ unlocated, reason `out-of-scope`; `startLine` without `endLine` ⇒ `endLine = startLine`; region without snippet ⇒ snippet read from the recorded side; `level` absent ⇒ rule `defaultConfiguration.level`, else `p3` and tool-default `confidence`; `ruleIndex`/`ruleId` disagree ⇒ rejected with reason; unknown tool ⇒ class from tags, `confidence: 3`, recorded; malformed region (`end < start`, non-integer) ⇒ rejected with reason; data-flow class ⇒ located candidate that `REVIEW` requires typed citations for.

### AC-3: Rejections counted, displayed
**Given** three rejections with two distinct reasons
**When** the run's report renders
**Then** section 3 shows rejected counts by reason `{reason: count}` totalling three.

### AC-4: Unlocated never reaches `gate`
**Given** an unlocated candidate
**When** `gate` runs
**Then** the candidate is absent from `findings.claimed.json` and appears in the unlocated artifact that `build-report` requires.

### AC-5: Import snapshot
**Given** any SARIF input
**When** ingested
**Then** the artifact is read, HMAC'd (`original_hmac`), redacted, and written to `ledger/<run>/imports/<sha256 of the redacted bytes>`; every derived record carries `import_sha256` + `original_hmac` + record index as its locator.

### AC-6: Mapping is versioned
**Given** `references/sarif-mapping.v1`
**When** an ingest runs
**Then** the import record names the mapping version used.

---

# US-011: Tracker-side ingest adapters (`ticket`, `pr`, `doc`, `tracker-readback`)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.6 rows `ticket`, `pr`, `doc`, `tracker-readback`; D5; `engagement.md targets:`
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want ticket, PR, in-repo document and tracker read-back content to enter through adapters that validate structure and trust only scope- and target-validated references,
so that text from a tracker can propose but never select a path, command, status or tracker mutation.

## Acceptance Criteria

### AC-1: `ingest ticket`
**Given** tracker JSON whose `url` host is not in `engagement.md targets.tracker`
**When** `ingest ticket` runs
**Then** the record is rejected with a reason; with an allowed host, only `id`, `url`, `labels`, `state` are trusted and title/body are inert (quoted, redacted, wrapped).

### AC-2: `ingest pr`
**Given** PR JSON with `changed_files[]` partly outside scope
**When** `ingest pr` runs
**Then** trusted fields are `number`, `url` (same host rule), `base_ref`, `head_oid`, and `changed_files[] ∩ scope` only; title/body are inert.

### AC-3: `ingest doc`
**Given** a path outside scope
**When** `ingest doc` runs
**Then** it is rejected; an in-scope path is trusted and the content is inert.

### AC-4: `ingest tracker-readback`
**Given** tracker JSON returned after a `publish --profile tracker` mutation
**When** `ingest tracker-readback` runs
**Then** only the fields the mutation set are trusted; everything else is inert.

### AC-5: Import snapshot for every adapter
**Given** any of the four inputs
**When** ingested
**Then** the same read → HMAC → redact → `ledger/<run>/imports/<sha256>` path as US-010 AC-5 applies and the locator triple is present on each derived record.

---

# US-012: QA-side ingest adapters (`case`, `audit`, `qa-run`, `ta-report`)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1 (scripts complete); first exercised by US-036/US-037 in M3
**Spec:** §6.6 rows `case`, `audit`, `qa-run`, `ta-report`; §12 "manual-qa run report in its real Markdown format", "same-path audit report replacement"
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want manual-qa cases, qa-auditor reports, manual-qa run reports and test-automation reports to enter through adapters that read the receiving bundles' real formats,
so that hand-off results come back as validated records instead of pasted prose.

## Acceptance Criteria

### AC-1: `ingest case`
**Given** a manual-qa `TC-*.md` with frontmatter
**When** `ingest case` runs
**Then** ids and `requirements` are trusted; steps are inert.

### AC-2: `ingest audit`
**Given** a qa-auditor report (Markdown + its JSON block) with a URL whose host is not in `targets.browser`
**When** `ingest audit` runs
**Then** that URL is not trusted; finding titles and allowed-host URLs are trusted; evidence text is inert.

### AC-3: `ingest qa-run` reads the real report
**Given** `reports/RUN-YYYY-MM-DD-NNN.md` in the manual-qa `test-run-report-format.md` shape (frontmatter `run_id`, `suite`, `environment`, `date`; `## Results` table with `ID`, `Title`, `Size`, `Status`, `Steps`, `Wall Clock`)
**When** `ingest qa-run` runs
**Then** `run_id`, case ids, status tokens (`PASS|FAIL|BLOCKED` only), `environment` (host ∈ `targets.browser`) and suite are trusted; titles and failure narratives are inert; screenshots are referenced by path and never copied. The fixture is that format verbatim.

### AC-4: `ingest ta-report`
**Given** `.agents/automation/<slug>/report.json`
**When** `ingest ta-report` runs
**Then** unit outcomes, `coverage`, exclusions, `findings[]`, `recovery_basis` (if present) and test paths are trusted; free text is inert.

### AC-5: Replacement import identity
**Given** an audit report at the same path is replaced twice — once changing non-redacted content, once changing only content a redaction rule removes
**When** each is ingested
**Then** the first yields a different `import_sha256`; the second yields the same `import_sha256` and a different `original_hmac`.

---

# US-013: `gate` derives finding ids and citation states by content sensitivity

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.5 "Identity by content sensitivity"; §6.2 occurrence; §2 row 4 last sentence; §12 "non-secret finding citing password=1234 ⇒ keyed id"; v3 §6.1 occurrence
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want `evidence.mjs gate` — not the reviewer — to assign every finding its id and `CITATION_*` state, and to key the id whenever the cited content matches a redaction rule regardless of finding class,
so that no publishable artifact carries a plain hash whose preimage contains protected content, and the same finding gets the same id on re-run.

## Acceptance Criteria

### AC-1: Plain identity
**Given** a claimed finding whose cited range matches no redaction rule
**When** `gate` runs
**Then** `id = sha256(path\0class\0normalised snippet\0occurrence)`, `snippet` is stored, `sensitive` is absent or `false`.

### AC-2: Keyed identity for any class
**Given** a **non-secret-class** finding citing a line containing `password=1234`
**When** `gate` runs
**Then** `id = HMAC_key(path\0class\0redacted normalised snippet\0occurrence)`, `snippet_redacted` is stored, `sensitive: true` is set, and no artifact outside `private/` contains a plain sha256 of the original snippet.

### AC-3: Private citation record written before discard
**Given** AC-2
**When** `gate` runs
**Then** `private/citations/<run>/<id>.json` exists with `{claimed_hmac, source_hmac, match, side, oid, redaction_version}` and was written before the claimed text left memory (the claimed text is absent from every file).

### AC-4: Secret class
**Given** a secret-class finding
**When** `gate` runs
**Then** the same keyed path applies with `context_redacted` in place of `snippet_redacted`.

### AC-5: States and occurrence
**Given** claimed findings whose citations do and do not match the recorded side, and a caller occurrence hint that is wrong
**When** `gate` runs
**Then** matching citations get `CITATION_VERIFIED`, non-matching get `CITATION_FAILED` (listed under `unverifiable[]`), `occurrence` is recomputed as the 0-based index among equal-normalised ranges in the file ignoring the hint, and `gate-result.json` payload is `{accepted[], unverifiable[], rejected_counts, scope_sha256, claimed_sha256}`.

### AC-6: Deterministic re-run
**Given** the same `findings.claimed.json` and `scope.json`
**When** `gate` runs twice
**Then** the two `gate-result.json` payloads are byte-identical (this is what `check` relies on in US-017).

---

# US-014: `coverage` accounts for every scoped range exactly once

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** D3; §6.1 preimage row `coverage.json`; §11 report section 2
**Priority:** must-have
**Size:** M

## Story
As an auditor,
I want report section 2 to show, for every scoped range, exactly one accounting entry (examined, skipped, scanner-covered) and `INDETERMINATE` when the scope is empty,
so that "what was looked at" is a derived fact, not a claim.

## Acceptance Criteria

### AC-1: Payload
**Given** a scope and an examined declaration
**When** `evidence.mjs coverage` runs
**Then** `coverage.json` payload is `{accounting[], scanner_rows[], scope_sha256, examined_sha256}`.

### AC-2: Exactly once
**Given** a scope with overlapping examined declarations
**When** `coverage` runs
**Then** every range in `scope.json` appears in exactly one `accounting[]` entry; an overlap or a gap fails the command with a non-zero exit naming the range.

### AC-3: Empty scope
**Given** `scope.json` with `files: []`
**When** `coverage` runs
**Then** the result is `INDETERMINATE` and the report's coverage section says so; `sign-off` treats the run as not `CURRENT`-able (US-025).

### AC-4: Deterministic
**Given** the same inputs
**When** run twice
**Then** payloads are byte-identical.

---

# US-015: `packet` and `receipt` — reviewers assert, scripts derive states

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.4 packet, receipt, derivation table; §4 rule 3; §6.1 rows `packet.json`, `receipt.json`
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want every reviewer dispatch to receive a packet listing exactly what it may read, and to return a receipt carrying an assertion that a script turns into a state,
so that a review's inputs are recorded and a reviewer can never write a state, verdict, id or gate stamp.

## Acceptance Criteria

### AC-1: Packet shape
**Given** subject ids and a scope
**When** `evidence.mjs packet` runs
**Then** `packet.json` payload is `{subject_ids[], files[{path, side, oid, ranges, range_hmac}], policy_sha256}` and `range_hmac` is computed over the raw bytes of each cited range at the recorded side.

### AC-2: Receipt schema and closed enums
**Given** a receipt `{type, subject_id, packet_sha256, assertion, reviewer_run_id}`
**When** `receipt validate` runs
**Then** it accepts only `review: confirmed | refuted | indeterminate`, `mitigation-review: confirmed | gap | indeterminate`, `fix-review: not-refound | refound | indeterminate`, `ack: {indicator_id}`; any other value is rejected; it also checks the packet exists, matches `packet_sha256`, and that every `packet.files[].oid` equals the run's oids.

### AC-3: State derivation table
**Given** prior state `CITATION_VERIFIED` and a `review` receipt
**When** `receipt apply` runs
**Then** `confirmed` ⇒ `REVIEW_CONFIRMED`, `refuted` ⇒ `REVIEW_REFUTED`, `indeterminate` ⇒ `REVIEW_INDETERMINATE`.

### AC-4: Failed citation stays unverifiable
**Given** prior state `CITATION_FAILED` and any receipt
**When** `receipt apply` runs
**Then** the state is unchanged and the receipt is recorded as `not-applied`.

### AC-5: Refuted is sticky
**Given** state `REVIEW_REFUTED` and any receipt other than a new `review` receipt on a new run
**When** `receipt apply` runs
**Then** the state is unchanged; `verify.mjs all` on that finding refuses with `UNVERIFIED-REFUTED-FINDING`.

### AC-6: Conflicting assertions
**Given** two receipts, same subject, same run, same type (not `ack`), different assertions
**When** `receipt apply` runs
**Then** the derived state is the `*_INDETERMINATE` of that type; multiple `ack` receipts on one run are exempt.

### AC-7: Receipts never carry states
**Given** a receipt JSON containing any of `state`, `verdict`, `id` (as a finding id assignment) or a gate stamp field
**When** `receipt validate` runs
**Then** it is rejected.

---

# US-016: `build-report` renders from a closed, transitively required input set and commits the run

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.3 required-inputs table and closure rule; §6.1 order and `COMMITTED`; §11; v3 §11; D14
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want `evidence.mjs build-report --run <run_id> --template <name>` to refuse to render until every required input — and every artifact those inputs reference by hash — is present, then write the report, the manifest and the `COMMITTED` marker last,
so that a report is never produced from a partial run and an auditor can tell a complete run from an abandoned one.

## Acceptance Criteria

### AC-1: Reads only the run directory
**Given** a run directory
**When** `build-report` runs
**Then** it opens no file outside that directory (asserted with a fixture that plants a newer artifact elsewhere and confirms it is not used).

### AC-2: Required inputs per template
**Given** the four templates
**When** one required input is deleted before `build-report --template <t>`
**Then** it exits `3` with `INCOMPLETE(<input>)` naming the input and writes no report: `review` requires run, scope, claimed, gate-result, coverage, examined declaration, packets, receipts (review), rejects, unlocated; `assessment` adds engagement snapshot, threat-model, receipts (mitigation-review), observations, imports, verify runs, register events snapshot, proposals index; `verify` requires run, verify.json, fix-review packet, receipts (fix-review, ack); `threat-model` requires run, threat-model, mitigation packets, receipts (mitigation-review), disposition references index.

### AC-3: Transitive closure
**Given** a receipt whose packet file is missing (or a gate-result whose scope is missing, or an observation whose import is missing)
**When** `build-report` runs
**Then** it exits `3 INCOMPLETE(<the referenced artifact>)`.

### AC-4: `COMMITTED` is last
**Given** a complete run
**When** `build-report` succeeds
**Then** the run directory contains the rendered report, `manifest.json` with payload `{inputs: {kind → sha256}, report_sha256, template, template_version, tool_version}`, and a `COMMITTED` marker containing the manifest hash, written after the report and manifest; a run directory without `COMMITTED` is ignored by the inventory and listed by `sign-off` as incomplete.

### AC-5: Report structure
**Given** an `assessment` run
**When** the report renders
**Then** sections appear in v3 §11 order (1 title/ids/dates/oids, 2 Coverage, 3 Executive summary, 4 Scope and rules of engagement, 5 Methodology "exploitation excluded", 6 Limitations, 7 Risk methodology, 8 Findings, 9 Unresolved candidates, 10 Threat model and mitigation states, 11 Register delta and proposed acceptances, 12 Chain of custody with manifest hashes, `ORIGIN` line, tool and template versions); section 3 shows counts by priority × state, unresolved by priority, rejected by reason, unlocated count, unauthenticated approvals, incomplete runs; every finding field is filled or reads `unknown / not assessed` — never blank.

### AC-6: Deterministic render
**Given** the same inputs
**When** rendered twice
**Then** the report bytes are identical (this is what `check` byte-compares).

### AC-7: Templates ship with required-inputs lists
**Given** `templates/{assessment,review,verify,threat-model}.md` and `templates/README.md`
**When** read
**Then** each template's required-inputs list matches AC-2 and the README lists all four.

---

# US-017: `check` recomputes every displayed value and reports drift and origin

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §2 rows 1–2; §6.3 derivation table and `check` line; §6.2 `CONSISTENT-REDACTED-ONLY`; §6.5 replay; D2; §12 replay fixtures
**Priority:** must-have
**Size:** L

## Story
As an auditor with the repo and a run directory,
I want `evidence.mjs check <run dir | manifest> [--integrity] [--drift] [--trusted-digest <sha256>]` to recompute every number the report displays from the recorded inputs, byte-compare the report, and tell me plainly what it could and could not re-validate,
so that I can trust the report's consistency without trusting its author.

## Acceptance Criteria

### AC-1: Consistent run
**Given** a `COMMITTED` run untouched since `build-report`
**When** `check --integrity --drift` runs with the key available
**Then** output contains `CONSISTENT`, `CURRENT`, `ORIGIN: unauthenticated`, `KEY: available`, exit `0`.

### AC-2: Every derivation-table row is recomputed
**Given** a `COMMITTED` run where one displayed value is tampered in the rendered report (finding ids, `CITATION_*` states, coverage counts, `REVIEW_*`/`MITIGATION_*` states, verify verdicts, register status/delta/unauthenticated bucket, rejected/unlocated totals, executive counts — one fixture each)
**When** `check` runs
**Then** it prints `INCONSISTENT(<field>)` naming that field, recomputing via `gate`, `coverage`, `receipt apply`, `verify.mjs evaluate`, `register.mjs replay` and the deterministic renderer respectively.

### AC-3: Consistent forgery is reported honestly
**Given** a fully consistent set authored by someone with write access
**When** `check` runs without `--trusted-digest`
**Then** it prints `CONSISTENT` **and** `ORIGIN: unauthenticated` (the test asserts the honest output, not detection).

### AC-4: Trusted digest
**Given** `--trusted-digest <sha256>`
**When** `check` runs
**Then** `ORIGIN: matches supplied digest` is printed only when the digest equals the **recomputed** manifest hash, never the sidecar value.

### AC-5: Drift
**Given** a `COMMITTED` run, then a cited `head` line is edited in the working tree; separately, an in-scope file not cited is edited
**When** `check --drift` runs
**Then** the first yields `CITATION-DRIFTED(1)`, the second `SCOPE-DRIFTED(1 files)` (per-file HMAC vs `scope.json`); `base` citations are skipped by `--drift`.

### AC-6: Redacted-only replay
**Given** a `review` run with a `side: snapshot` citation of a file containing `password=1234`, and the working file is subsequently changed
**When** `check --integrity` runs with the key
**Then** the result is `CONSISTENT-REDACTED-ONLY(1 citations)`; before the change it was `CONSISTENT`; if the redacted snapshot itself is altered, `INCONSISTENT`.

### AC-7: Without the key
**Given** the key file is absent
**When** `check` runs
**Then** output contains `KEY: unavailable` and `STRUCTURE-ONLY`, never `CONSISTENT`.

### AC-8: Middle result only for review runs
**Given** an `assessment` run
**When** `check` runs
**Then** `CONSISTENT-REDACTED-ONLY` cannot appear (assessment runs have no `snapshot` citations).

---

# US-018: `verify.mjs all` executes tests from a validated test-start snapshot

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §2 row 3; §6.4 steps 1–6 and 8; D5 (argv from operator record); D8; §12 "install modifying a tracked helper", v3 §12 "wrong-head worktree"
**Priority:** must-have
**Size:** L

## Story
As a developer who fixed a finding,
I want `verify.mjs all --finding <id> --base <oid> --head <oid>` to check out my head commit in a detached worktree, validate the tree after dependency install, run the project's tests with the operator-recorded argv, and hand the fix to a fresh reviewer,
so that the verdict I get names exactly which tree was tested.

## Acceptance Criteria

### AC-1: Branch check
**Given** a head that is / is not an ancestor of the branch, or that does not touch the finding's path
**When** step 1 runs
**Then** `branch` is `COMMITTED | NOT-COMMITTED | PATH-UNTOUCHED` accordingly.

### AC-2: Detached worktree with dirty main tree
**Given** the main working tree has a dirty test helper
**When** `verify.mjs all` runs
**Then** tests run in a detached checkout of `head_oid`, `tree_before` is recorded, and the dirty helper has no effect (v3 §12 fixture: tests fail in the clean worktree).

### AC-3: Install modifies tracked tree
**Given** `engagement.md` `execute_project_tests.install.argv` and an install step that edits a tracked helper
**When** step 3 runs
**Then** the result is `TESTS_INDETERMINATE(install-modified-tree)` unless `execute_project_tests.install.allow_tracked_changes: true`, in which case `tested_tree = HMAC(all tracked files after install)` is recorded and the `VERDICT` line names `tested_tree`; untracked files created by install are recorded by count and total size only.

### AC-4: Suppression indicators
**Given** a `base..head` diff that edits an ignore file outside the finding path, and another that only deletes lines
**When** step 4 runs
**Then** the first yields `{indicators: [{id, kind, path, line}]}` with `id = sha256(kind, path, line content)` (keyed per §6.5 when the line matches a redaction rule); the second yields `deletion_only: true`.

### AC-5: Test execution
**Given** `execute_project_tests.argv` in `engagement.md`
**When** step 5 runs
**Then** argv passes allowlist + deny rules, runs via `spawn(argv, {shell:false})` in the worktree with a minimal env and a timeout, output is bounded and redacted, and the resolved executable path and its sha256 are recorded; the result is `TESTS_PASS | TESTS_FAIL | NO_TEST_SURFACE | TESTS_INDETERMINATE(<reason>)`; argv from any other source (SARIF, ticket, PR body) is never executed.

### AC-6: Fix-review packet
**Given** step 5 completed
**When** step 6 runs
**Then** a `fix-review` packet is built from the worktree and a `fix-review` receipt is requested from a fresh reviewer dispatch.

### AC-7: `verify.json` and the verdict line
**Given** all steps ran
**When** `verify.mjs all` finishes
**Then** `verify.json` payload holds all raw results, argv hashes, resolved executable hash, `tree_before`, `tested_tree`, install counts, receipt hashes and the evaluation output; stdout ends with `VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>`.

## Notes
- The operator record's authorship is unverified (D5); the README says so. The bundle promises "tests execute from a validated test-start snapshot", not that the tests mean anything (§2).

---

# US-019: `verify.mjs evaluate` — pure verdict function with fixed precedence

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.4 step 7; D17; §12 evaluator fixtures; v3 §12 ACK fixtures
**Priority:** must-have
**Size:** M

## Story
As an auditor,
I want the verdict to be a pure function over the raw results in `verify.json` that `check` can re-run without executing anything,
so that a verdict is reproducible and a regression can never be hidden by an incomplete check.

## Acceptance Criteria

### AC-1: `refound_observed` first, unconditionally
**Given** a `fix-review` assertion `refound`, the register row `fixed`, and tests unavailable
**When** `evaluate` runs
**Then** the verdict is `UNVERIFIED-INDETERMINATE(tests)` **and** the `regression-observed` event is emitted.

### AC-2: Refound with complete checks
**Given** `refound` and every check present
**When** `evaluate` runs
**Then** `REGRESSED` when the row was `fixed`, else `UNVERIFIED-REFOUND`.

### AC-3: `VERIFIED` requires an applied `not-refound`
**Given** positive tests and a `fix-review` receipt that is absent, not applied, or `indeterminate`
**When** `evaluate` runs
**Then** `UNVERIFIED-INDETERMINATE(fix-review)`.

### AC-4: Remaining rules in order
**Given** fixtures for each
**When** `evaluate` runs
**Then**: `branch ≠ COMMITTED` ⇒ `UNVERIFIED-NOT-COMMITTED`; tests `FAIL` ⇒ `UNVERIFIED-TESTS-FAILED`, `NO_TEST_SURFACE` and `INDETERMINATE` ⇒ the corresponding `UNVERIFIED-*`; `deletion_only` ⇒ `UNVERIFIED-SUPPRESSION(deletion-only)` even when an `ack` exists (never waivable); indicator + deletion-only ⇒ deletion wins.

### AC-5: Multi-indicator ACK
**Given** two indicators and one matching `ack` receipt whose `packet_sha256` is the fix-review packet
**When** `evaluate` runs
**Then** `UNVERIFIED-SUPPRESSION(1 unacked)`; an `ack` for a different `indicator_id` or a different packet does not count; with both acked and every other condition green, `VERIFIED` with `ack_refs[]` listing both.

### AC-6: Pure
**Given** the same `verify.json` raw results
**When** `evaluate` runs on a machine without git, without the worktree and without the project's test runner
**Then** it returns the same output and executes nothing.

---

# US-020: `register.mjs` — hash-chained event log, replay, recovery and anchor

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.8 events, recovery, anchor; §12 "interrupted append ⇒ rebuild", "truncated log + projection vs anchor verify ⇒ TRUNCATED"
**Priority:** must-have
**Size:** L

## Story
As an auditor,
I want the residual-risk register to be an append-only, hash-chained event log with a projection that is always rebuilt from it, and an anchor I can keep outside the repo,
so that a truncated or rewritten register is detectable and an interrupted write never corrupts state.

## Acceptance Criteria

### AC-1: Event shape
**Given** any register command that changes a row
**When** it completes
**Then** one event `{seq, prev_sha256, ts, actor, row_id, event, payload (all changed fields), ref}` was appended with `O_APPEND` under a lock, and the projection was rewritten tmp+rename after the append.

### AC-2: Interrupted write ⇒ rebuild
**Given** the process was killed after the append and before the projection rename (`projection.seq < log.seq`)
**When** any register command runs
**Then** it rebuilds the projection via `replay` and proceeds normally.

### AC-3: Corruption ⇒ exit 5
**Given** `projection.seq > log.seq`, or any event's `prev_sha256` does not match
**When** any register command runs
**Then** it exits `5` with `CORRUPT` and writes nothing.

### AC-4: Anchor
**Given** a register
**When** `register.mjs anchor print` runs
**Then** it prints `<engagement_id>:<seq>:<chain_sha256>`; `anchor verify --expect <that>` prints `MATCH`; after the log and projection are both truncated consistently it prints `TRUNCATED`; after an event is rewritten it prints `DIVERGED`.

### AC-5: Replay is deterministic
**Given** the same event log
**When** `replay` runs twice
**Then** projections are byte-identical (this is what `check` re-runs for register-derived report values).

---

# US-021: `register.mjs` transitions, unauthenticated approvals, supersession and aliases

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.8 supersession, transitions, approvals; D15; v3 §6.7 transition table (minus `confirm`); §2 row 6; §12 "supersede without equivalence or transfer rejected"; v3 §12 "supersede cycle", "accept without both flags"
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want to record acceptances, false positives, supersessions and aliases in the register with every approval stored and reported as unauthenticated,
so that open exposure is never reduced by a record nobody can verify, and there is no "confirmed" state anywhere.

## Acceptance Criteria

### AC-1: Transition table
**Given** the v3 §6.7 table without `confirm`
**When** `register.mjs transition` runs for each row
**Then** exactly these succeed: `add` ⇒ `open`; `accept --until --approved-by --approval-ref` from `open|regressed` ⇒ `accepted`; `revoke --approved-by --approval-ref` from `accepted` ⇒ `open`; `check` finding `until` (UTC, exclusive) past ⇒ `open` with event `acceptance-expired`; `close-false-positive --approved-by --approval-ref` from `open` ⇒ `false-positive`; `reopen --reason` from `false-positive` ⇒ `open`; `supersede --by <R-id ≠ self, no cycle>` from `open|accepted|fixed|regressed|false-positive` ⇒ `superseded`; `alias` appends to `finding-alias.jsonl`; `regression-observed` is recorded as an informational event without a status change. Anything else is rejected.

### AC-2: No confirm
**Given** the CLI
**When** `register.mjs confirm <id>` is invoked
**Then** it exits `2` as an unknown command; no schema has an `authenticated: true` or `confirmed: true` value.

### AC-3: Approval record shape
**Given** any `accept`, `close-false-positive`, `ack_refs` write or execution-authorization record
**When** stored
**Then** the field is `{recorded_by, approved_by, approval_ref, authenticated: false}`; `accept` without both `--approved-by` and `--approval-ref` is rejected.

### AC-4: Open exposure never reduced
**Given** a row moved to `accepted`
**When** `register.mjs status` and the report section 11 render
**Then** the row is counted in the single "unauthenticated approvals" bucket and open exposure totals are unchanged.

### AC-5: Supersession guards
**Given** `supersede --by <target>` where the target's subject is neither the same finding id nor linked in `finding-alias.jsonl`
**When** run without `--subject-equivalent` and without `--transfer-exposure`
**Then** it is rejected; with `--transfer-exposure`, the target's `priority` is first raised to max(both) and its status set to `open` if the source was `open|regressed`, then the source becomes `superseded`; a cycle is rejected.

### AC-6: Aliases are separate
**Given** `finding-alias.jsonl` rows `{from_id, to_id, reason, run_id}`
**When** `supersede --subject-equivalent` checks equivalence
**Then** an alias link satisfies it, and an alias never changes any row's status by itself.

---

# US-022: Register consumes verify verdicts

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.4 "Register consumes"; §6.8
**Priority:** must-have
**Size:** S

## Story
As a security lead,
I want a `VERDICT` line to update the register without me typing a transition,
so that `fixed` and `regressed` are always script-derived.

## Acceptance Criteria

### AC-1: `VERIFIED` ⇒ `fixed`
**Given** a row in `open|accepted|regressed` and a `verify.json` evaluating to `VERIFIED`
**When** the register consumes it
**Then** the row is `fixed` with `ack_refs` copied from the verdict and `last_verified_run` set.

### AC-2: `REGRESSED` ⇒ `regressed`
**Given** a `fixed` row and `REGRESSED`
**When** consumed
**Then** the row is `regressed` and a `regression-observed` event exists.

### AC-3: `UNVERIFIED-*` ⇒ event only
**Given** any `UNVERIFIED-*` verdict
**When** consumed
**Then** an event is appended, the status is unchanged, and a `regression-observed` event is still recorded when `refound_observed` was true.

---

# US-023: `publish --profile` and `check-export`

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.9 Publication; D13; §12 "check-export VERIFIED-DERIVATIVE and LINKED-ONLY"
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want the only way an artifact leaves `.agents/security-testing/` to be `evidence.mjs publish --run <id> --profile <p> --to <destination>`, with a manifest an auditor can re-derive,
so that every disclosure is deliberate, profile-shaped and checkable.

## Acceptance Criteria

### AC-1: Profiles
**Given** a `COMMITTED` run
**When** `publish` runs with each of `redacted-report`, `full-report`, `tracker`, `handoff`, `case`
**Then** the output contains only what the profile allows: `tracker` = title, class, priority, path, lines, `context_redacted`, `fix_prompt`; `handoff` = case paths + `base_url` only; `case` = TC text only; `full-report` must be passed explicitly (no default).

### AC-2: Export manifest
**Given** any `publish`
**When** it completes
**Then** `export-manifest.json` payload is `{source_manifest_sha256, profile, profile_version, output_sha256}`.

### AC-3: `check-export` with source
**Given** an export manifest and `--source <run dir>`
**When** `check-export` runs
**Then** it re-applies the profile and byte-compares, printing `VERIFIED-DERIVATIVE`; a tampered output prints a mismatch and exits non-zero.

### AC-4: `check-export` without source
**Given** only the export manifest and output
**When** `check-export` runs
**Then** it prints `LINKED-ONLY`.

### AC-5: No other exit path
**Given** the full command set
**When** searched for writes outside the writable paths of §4 rule 2
**Then** only `publish --to <destination>` writes elsewhere.

---

# US-024: `purge --engagement`

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §6.9 last sentence
**Priority:** should-have
**Size:** S

## Story
As a security lead,
I want `evidence.mjs purge --engagement <id>` to delete an engagement's private, ledger, run and import data on my decision,
so that retention is the consumer's call and nothing lingers by default.

## Acceptance Criteria

### AC-1: Deletes the four trees
**Given** an engagement with data under `private/`, `ledger/`, `runs/`, `imports/`
**When** `purge --engagement <id>` runs
**Then** those four subtrees for that engagement are gone; `reports/security/`, `tasks/security-*/`, `proposals/`, `handoffs/`, `receipts/` and the `.gitignore` block are untouched.

### AC-2: Names the engagement
**Given** two engagements
**When** `purge --engagement <one>` runs
**Then** the other's data is unchanged.

---

# US-025: `sign-off --engagement`

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1 (with `require_dispositions: none`; policy enforcement in US-033)
**Spec:** §7 sign-off paragraph; §6.1 incomplete runs; §2 row 7; §12 sign-off fixtures
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want `evidence.mjs sign-off --engagement <id>` to fail on anything that makes the latest assessment untrustworthy and to list — without failing — everything a reader must know about the engagement's state,
so that a sign-off is a checked gate, not a ceremony.

## Acceptance Criteria

### AC-1: Inventory is the ledger
**Given** run directories on disk, one of which is not in `ledger/index.json`
**When** `sign-off` runs
**Then** only ledger-listed runs are considered, and runs without `COMMITTED` are listed as incomplete.

### AC-2: No assessment ⇒ exit 4
**Given** only `review`-kind `COMMITTED` runs
**When** `sign-off` runs
**Then** it exits `4` with `NO-ASSESSMENT` and prints no `UNGATED` banner.

### AC-3: Failing conditions
**Given** fixtures for each
**When** `sign-off` runs
**Then** it exits `4` naming the cause when: any `COMMITTED` run checks `INCONSISTENT` or `STRUCTURE-ONLY`; the latest assessment (by `seq`) is not `CURRENT` at scope level; the register is `CORRUPT`; `anchor verify --expect` was given and is not `MATCH`; dispositions violate policy (US-033); a tracked file exists under a managed path.

### AC-4: Redacted-only review run is accepted and listed
**Given** a `review` run checking `CONSISTENT-REDACTED-ONLY(1 citations)` and a current, clean, `COMMITTED` assessment run with every other condition satisfied
**When** `sign-off` runs
**Then** it exits `0` and lists that review run's result.

### AC-5: Informational listings
**Given** an engagement with an incomplete run, per-path changes since baseline (US-006), and unauthenticated approvals
**When** `sign-off` runs
**Then** each appears in the output as a list without affecting the exit code.

### AC-6: Unadmitted case in the hand-off suite
**Given** an extra `TC-*.md` placed by hand into `tasks/security-<slug>-admitted/`
**When** `sign-off` runs
**Then** it lists that file as unadmitted (suite hash vs admission records).

---

# US-026: `secure-code-review` skill with fixtures and frozen eval harness

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §5 row; v3 §5 row (investigate-then-refute, taxonomy, refutation criteria, do-not-flag, typed citations); §6.5 fixtures; v3 §12 model evals
**Priority:** must-have
**Size:** M

## Story
As a security reviewer,
I want a skill that tells me how to investigate, cite, and refute — and fixtures that show what a correct claim looks like,
so that my findings pass `gate` and my assertions are comparable run to run.

## Acceptance Criteria

### AC-1: Skill validates
**Given** `bundles/security-testing/skills/secure-code-review/SKILL.md`
**When** CI runs `skills-ref` validation
**Then** it passes the agentskills.io spec.

### AC-2: Content
**Given** the skill directory
**When** read
**Then** it contains the review taxonomy, refutation criteria, a do-not-flag list, the typed-citation requirement (`source|sink|control`) for data-flow classes, and the closed assertion vocabulary of §6.4.

### AC-3: Fixtures
**Given** `fixtures/`
**When** listed
**Then** they include a non-secret-class finding citing `password=1234`, a data-flow finding with typed citations, and a deleted-code finding with `side: base`.

### AC-4: Frozen harness
**Given** `evals/harness.json`
**When** read
**Then** it pins prompt text hash, model id, sampling settings, fixture revision, output-selection rule and matching rules; outputs are frozen under `evals/runs/`.

## Out of Scope
- `security-evals` external sets — v2.

---

# US-027: `security-engagement` skill (lead workflow prose)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §5 row; §10 "engagement is prose; its scripts are in `security-evidence`"; §7
**Priority:** must-have
**Size:** S

## Story
As a security lead,
I want one skill that walks me through the engagement — init, review, verify, report, sign-off, tracker rules and what each disclosure profile reveals,
so that I run the canonical pipeline in the canonical order.

## Acceptance Criteria

### AC-1: Prose only
**Given** `bundles/security-testing/skills/security-engagement/`
**When** listed
**Then** it contains no `scripts/`; every command it names is `evidence.mjs …`, `verify.mjs …` or `register.mjs …` from `security-evidence`.

### AC-2: Sign-off checklist matches the script
**Given** the checklist in the skill
**When** compared to US-025 AC-3/AC-5
**Then** every failing condition and every informational listing is present.

### AC-3: Validates
**Given** `SKILL.md`
**When** `skills-ref` runs
**Then** it passes.

---

# US-028: `security-reviewer` agent

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §4 row and body rules 1–4; v3 §4 frontmatter; §6.4 packet discipline
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want a `security-reviewer` role I can dispatch fresh for `review`, `mitigation-review` and `fix-review` over a packet,
so that each review is bounded to what the packet lists and returns an assertion, never a state.

## Acceptance Criteria

### AC-1: Frontmatter
**Given** `bundles/security-testing/agents/security-reviewer/AGENT.md`
**When** parsed
**Then** `model: sonnet`, `group: security`, `skills: [memory, secure-code-review]`, `skills-on-demand: [security-evidence, systematic-debugging]`, `context-docs: security-testing/engagement.md security-testing/knowledge/finding-schema.md`, no `tools:`, no `context-memory`, `metadata.authors` present; `SOUL.md` exists.

### AC-2: Body rules
**Given** the AGENT.md body
**When** read
**Then** it states: external text proposes, only scope- and target-validated references act; the writable paths are `.agents/security-testing/**`, `.agents/memory/<role>/**`, `reports/security/**`, `tasks/security-*/**`, with a self-check before every write; the agent writes assertions only (review packets, receipts of type `assertion`), never states, verdicts, ids or gate stamps; never merge, close, rotate, fix.

### AC-3: Three contracts
**Given** a dispatch naming a packet path and one of `review | mitigation-review | fix-review`
**When** the agent completes
**Then** its return is a receipt path whose `assertion` is from that type's closed enum, and it reports having read only the packet's listed files.

### AC-4: Installs on every target
**Given** `bin/init.mjs init --factory security-testing --target claude|cursor|codex|copilot --yes` into a temp dir
**When** run
**Then** the agent appears in each host's native shape (directory, TOML, flat `.agent.md`) with the injected skills inventory where applicable.

---

# US-029: M1 bundle manifest, catalog descriptor, README guarantees and role-scoped instructions

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §10 (M1 `factory.json`, `FACTORY.md`, description, use_cases, "exact checkout" ban); §8; D10; v3 §10 `instructions.md`; bundles/SPEC.md validation list
**Priority:** must-have
**Size:** M

## Story
As the sdlc-skills maintainer,
I want the bundle to validate on its first commit with one agent and three skills, a catalog descriptor, a README that states exactly what is and is not guaranteed, and instructions that only bind this bundle's roles,
so that CI is green from M1 onward and no catalog text over-promises.

## Acceptance Criteria

### AC-1: M1 manifest
**Given** `bundles/security-testing/factory.json`
**When** read
**Then** `id: security-testing`, `agents: []`, `localAgents: ["security-reviewer"]`, `localSkills: ["security-evidence", "secure-code-review", "security-engagement"]`, `skills: ["memory", "knowledge-curation"]`, `briefings: {"security-reviewer": "briefings/security-reviewer.md"}`, `seed: {"knowledge": ".agents/security-testing/knowledge"}`, `instructions: "instructions.md"`, no `hooks`, no `targets`; `description` is the exact §10 sentence.

### AC-2: `FACTORY.md`
**Given** the descriptor
**When** validated
**Then** `name`, `description`, `owner`, `authors` (non-empty), `sdlc_phase: Security Testing` (single scalar), `support_level: Best Effort Support`, and exactly the five §10 `use_cases` strings; no `project_deployments` key.

### AC-3: Validate passes
**Given** the M1 tree
**When** `npm run validate:factories && npm run validate:marketplaces && npm run validate:dupes` run
**Then** all exit `0` (`validate:externals` is network and runs in CI).

### AC-4: README guarantees
**Given** `bundles/security-testing/README.md`
**When** read
**Then** a Guarantees table has one row per §2 left-column promise with a column `enforced by: script | prose` naming the script, each qualified "for runs carrying a `COMMITTED` marker produced by the canonical pipeline"; a Not guaranteed section lists every §8 item (origin; model reading; human approval; secrets outside the rule list; semantic suppression; test meaningfulness; direct-run refusal by QA runners; threat completeness; host-preloaded instruction files and direct agent reads; attribution of tree changes; encryption of local artifacts; core context hooks outside this bundle's control); active testing is stated as out of scope.

### AC-5: No "exact checkout"
**Given** every file under `bundles/security-testing/` and the generated marketplaces
**When** grepped for `exact checkout`
**Then** zero matches.

### AC-6: Role-scoped instructions
**Given** `instructions.md`
**When** read
**Then** it opens with "The following applies only when the active or dispatched agent is `security-lead`, `threat-modeler` or `security-reviewer`", contains the four rules, the artifact map and the token table, and constrains no other bundle's role.

### AC-7: Knowledge seed
**Given** `bundles/security-testing/knowledge/`
**When** the bundle installs
**Then** the files land in `.agents/security-testing/knowledge/` and include the `engagement.md` template and `finding-schema.md`.

---

# US-030: Installed end-to-end tests, offline, both install shapes

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M1
**Spec:** §12 "Installed end-to-end"; D12; §7
**Priority:** must-have
**Size:** L

## Story
As the sdlc-skills maintainer,
I want `npm test` to install the bundle into a temp dir with no network and run the whole pipeline for both the full bundle and the two-skill standalone,
so that a regression in the installer, the manifest or any script fails CI.

## Acceptance Criteria

### AC-1: Offline external provisioning
**Given** `SDLC_SKILLS_CACHE_DIR` pointing at a temp cache where `systematic-debugging` is a git clone whose `origin` is a local bare fixture repo, and `GIT_CONFIG_GLOBAL` pointing at a config rewriting `https://github.com/` to an unreachable local path
**When** `bin/init.mjs init --factory security-testing --yes` runs
**Then** it succeeds, `memory`, `knowledge-curation`, `verifying-outcomes` come from the monorepo, `issue-tracking` resolves to the feature-development bundle copy via the item index, and no `https://` fetch occurs.

### AC-2: Full-bundle path (a)
**Given** the full install and `require_dispositions: none`
**When** `engagement init → run init --kind assessment → scope → ingest sarif → gate → coverage → packet/receipt → build-report --template assessment → check → verify all (fixture repo) → register → sign-off` runs
**Then** every step exits `0` and `sign-off` exits `0`.

### AC-3: Two-skill path (b)
**Given** `--skills security-testing/secure-code-review,security-testing/security-evidence`
**When** `engagement init → run init --kind review → … → build-report --template review → check → verify all → sign-off` runs
**Then** `sign-off` exits `4` with `NO-ASSESSMENT` and no `UNGATED` banner appears anywhere in the output.

### AC-4: Additional §12 fixtures pass
**Given** the fixtures listed in §12 (manual-qa run report through `ingest qa-run`; positive tests + `indeterminate` fix-review ⇒ `UNVERIFIED-INDETERMINATE(fix-review)`; changed ignored product file ⇒ excluded coverage; the four-step dirty-snapshot/redacted-only/sign-off sequence)
**When** `npm test` runs
**Then** each passes.

### AC-5: Every script has a test file
**Given** `skills/security-evidence/scripts/`
**When** listed
**Then** `evidence.mjs`, `verify.mjs`, `register.mjs`, `tm-lint.mjs`, `plan.mjs`, `normalize.mjs`, `redact.mjs`, `canon.mjs` each have a sibling `*.test.mjs` discovered by `node --test`.

## Notes
- `tm-lint.mjs` and `plan.mjs` ship in M1 as part of "security-evidence complete" (§13 M1) but their behaviour is specified by US-031 and US-034; at M1 their tests cover CLI shape and schema validation only.

---

# M2 — threat model

# US-031: `threat-modeling` skill and `tm-lint check|render` with relationship-validated dispositions

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M2
**Spec:** §5 row; §6.10; §6.3 `threat-model` template; §13 M2
**Priority:** must-have
**Size:** L

## Story
As a security lead,
I want a code-derived threat model whose every element cites code and whose every threat carries a disposition that `tm-lint` validates against the artifact it points to,
so that "mitigated" or "ticketed" means a real receipt or a real ticket, not a word in a table.

## Acceptance Criteria

### AC-1: Skill validates
**Given** `bundles/security-testing/skills/threat-modeling/SKILL.md`
**When** `skills-ref` runs
**Then** it passes; the skill contains DFD + STRIDE guidance, mitigations-as-claims, and the disposition model; `tm-lint.mjs` lives in `security-evidence/scripts/`.

### AC-2: Citation per element
**Given** a `threat-model.json` with an element lacking a citation
**When** `tm-lint.mjs check` runs
**Then** it fails naming the element.

### AC-3: Disposition relationships
**Given** one threat per disposition value
**When** `tm-lint check` runs
**Then** it validates: `planned(proposal_id | case_id)` — the proposal exists or the case has an `admission.json`; `executed(observation_id)` — the observation exists; `ticketed(ticket_url)` — an `ingest tracker-readback` import shows the ticket body carries the threat id; `accepted(register_id)` — the register row's subject equals the threat id and status is `accepted`; `mitigated(mitigation_id)` — a `MITIGATION_CONFIRMED` derived state exists via `receipt apply`; `undisposed` is allowed; a dangling reference fails with the threat id and the missing relationship.

### AC-4: Render
**Given** a linted model
**When** `tm-lint render` runs
**Then** Markdown is generated from the JSON (D14) and `build-report --template threat-model` requires run, threat-model, mitigation packets, receipts (mitigation-review) and the disposition references index.

---

# US-032: `threat-modeler` agent

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M2
**Spec:** §4 row; body rules 1–4
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want a `threat-modeler` role that produces the code-derived DFD, STRIDE threats, mitigation claims and dispositions, and reports a single machine-readable line when `tm-lint` passes,
so that I can dispatch it and know from one line whether the model is ready.

## Acceptance Criteria

### AC-1: Frontmatter
**Given** `agents/threat-modeler/AGENT.md`
**When** parsed
**Then** `model: opus`, `group: security`, `skills: [memory, threat-modeling]`, `skills-on-demand: [security-test-planning, security-evidence, gathering-context, deep-research]`, `context-docs` = engagement + finding schema, no `tools:`, no `context-memory`; `SOUL.md` exists.

### AC-2: Return line
**Given** a dispatch
**When** the agent finishes and `tm-lint check` passed
**Then** its final line is `MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>` with integers matching the model; if `tm-lint check` fails, it returns the lint error, not that line.

### AC-3: Body rules
**Given** the body
**When** read
**Then** the four §4 rules are present verbatim in substance (propose-vs-act, writable paths + self-check, assertions only, never merge/close/rotate/fix).

---

# US-033: `sign-off` enforces `sign_off.require_dispositions`

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M2
**Spec:** §6.10 last sentence; §7; §13 M1 note "with `require_dispositions: none` until M2"
**Priority:** must-have
**Size:** S

## Story
As a security lead,
I want `sign-off` to block when threats are left in a state my engagement policy forbids,
so that a signed-off assessment cannot silently carry unhandled threats.

## Acceptance Criteria

### AC-1: Default policy
**Given** `engagement.md` without `sign_off.require_dispositions`
**When** `sign-off` runs with an `undisposed` or `planned` threat
**Then** it exits `0` (default `executed-or-ticketed` blocks neither) and lists them.

### AC-2: `all`
**Given** `sign_off.require_dispositions: all`
**When** `sign-off` runs with any `undisposed` or `planned` threat
**Then** it exits `4` naming the threat ids.

### AC-3: `none`
**Given** `sign_off.require_dispositions: none`
**When** `sign-off` runs
**Then** dispositions are not evaluated (the M1 E2E setting).

---

# M3 — planning, hand-offs, lead

# US-034: `security-test-planning` skill and `plan.mjs admit`

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §5 row; §9.1; D7
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want every candidate test case run through `plan.mjs admit <case>`, which classifies it by its effects and records why,
so that a case reaches QA only when the lint or a reviewer found no active effect, and the claim is "admitted", never "safe".

## Acceptance Criteria

### AC-1: Admission record
**Given** a case file
**When** `plan.mjs admit <case>` runs
**Then** `admission.json` payload is `{case_sha256, classification: admitted-heuristic | admitted-reviewed | proposal, lint_hits, assumptions: {base_url_host, account}, target_policy_sha256}`.

### AC-2: Unknown effect ⇒ proposal
**Given** a step whose operation is not in the allowed-operation grammar
**When** `admit` runs
**Then** `classification: proposal`, and the case is never written to the admitted suite.

### AC-3: Forbidden pattern ⇒ proposal with hit
**Given** a step matching the forbidden-pattern list (v3 §12 "step with an injection payload")
**When** `admit` runs
**Then** `classification: proposal` and `lint_hits` names the pattern.

### AC-4: `admitted-reviewed`
**Given** a case with a lint hit and a reviewer `assertion` receipt on the case packet
**When** `admit` runs
**Then** `classification: admitted-reviewed` referencing that receipt; without the receipt it stays `proposal`.

### AC-5: Skill content
**Given** `skills/security-test-planning/`
**When** read
**Then** it validates via `skills-ref`, contains `references/passive-admission.md`, and says "admitted by lint or by review", never "safe"; `plan.mjs` lives in `security-evidence/scripts/`.

---

# US-035: Admitted hand-off suite for manual-qa

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §2 row 5; §9.2; §6.9 `handoff` and `case` profiles; §12 "extra TC placed in the admitted suite by hand"
**Priority:** must-have
**Size:** M

## Story
As a QA lead running the manual-qa bundle,
I want to receive a suite directory that contains only admitted `TC-*.md` files in my bundle's format, plus a one-line prompt I can paste to `test-run-lead`,
so that I run it exactly like any other suite and never see an unadmitted case.

## Acceptance Criteria

### AC-1: Dedicated suite, admitted only
**Given** three admitted cases and one `proposal`
**When** `publish --profile case` writes the suite
**Then** `tasks/security-<slug>-admitted/` contains exactly three `TC-*.md` and nothing else (no README, no index, no proposal).

### AC-2: Format verbatim
**Given** an admitted case
**When** the file is read by the manual-qa `test-run-lead` Step 0 glob
**Then** it parses as a manual-qa TC; `priority` maps p0→critical, p1→high, p2→medium, p3→low; header/cookie checks are expressed via the audit branch.

### AC-3: Hand-off prompt
**Given** `publish --profile handoff`
**When** it prints
**Then** the text is exactly: `Run as the active agent (claude --agent test-run-lead):` newline `"Run the suite at tasks/security-<slug>-admitted/ against base_url=<url>."` with the slug and URL filled — case paths and `base_url` only.

### AC-4: Tampering is visible
**Given** a fourth `TC-*.md` added by hand
**When** `sign-off` runs
**Then** it lists the file as unadmitted (US-025 AC-6).

## Notes
- The QA runner refusing a case handed to it directly is not promised (§2 right column); the dedicated directory is what makes "only admitted cases" true with today's `test-run-lead`.

---

# US-036: QA run results become observations

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §9.2 observations; §6.6 `ingest qa-run`; §6.10 `executed(observation_id)`
**Priority:** must-have
**Size:** M

## Story
As a security lead,
I want a manual-qa run report to become one observation per case, tied to the admission record's case hash,
so that a threat can move to `executed` only through a real run of an admitted case.

## Acceptance Criteria

### AC-1: Observation shape
**Given** a `reports/RUN-*.md` ingested via `ingest qa-run`
**When** observations are derived
**Then** each is `{observation_id, import_sha256, case_id, case_sha256 (from admission.json), result, run_id, base_url, account?, head_oid?}`; fields the report does not carry are `unknown`, never blank.

### AC-2: Unadmitted case in the report
**Given** a result row whose case id has no `admission.json`
**When** ingested
**Then** the row is recorded as an unresolved candidate, not an observation.

### AC-3: `FAIL` is a candidate, not a finding
**Given** a `FAIL` observation
**When** the report renders
**Then** it appears under section 9 Unresolved candidates; a mitigation decision requires a separate `mitigation-review` receipt citing the observation.

---

# US-037: test-automation hand-off and `ta-report` intake

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §9.3; §6.6 `ingest ta-report`
**Priority:** should-have
**Size:** M

## Story
As a QA lead running the test-automation bundle,
I want a prompt listing the admitted cases with ids, titles and paths,
so that I can automate them, and the security lead can see per unit what was delivered, gated, excluded or recovered.

## Acceptance Criteria

### AC-1: Prompt contents
**Given** an admitted suite
**When** the TA hand-off prompt prints
**Then** it carries `cases[{id, title, path}]` from the suite, `slug`, and `base`; nothing from a `proposal`.

### AC-2: Per-unit records
**Given** `.agents/automation/<slug>/report.json`
**When** `ingest ta-report` runs
**Then** each unit records outcome, coverage record, exclusions, findings, and `recovery_basis` if present; partial coverage is kept per assertion.

### AC-3: `delivered-unwitnessed`
**Given** a unit marked `delivered` with no gate receipt in the report
**When** ingested
**Then** it is recorded as `delivered-unwitnessed`.

### AC-4: Tests before `VERIFIED`
**Given** a finding not yet `VERIFIED`
**When** the TA prompt is generated
**Then** the case is still included (tests may be built before `VERIFIED`).

---

# US-038: Active-testing proposals stay outside `tasks/`

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** D7; v3 §9.4; §5 `proposal` schema; v3 §12 "proposal under tasks/ ⇒ planner refuses"
**Priority:** must-have
**Size:** S

## Story
As a security lead,
I want active testing captured as a proposal with its own authorization stub, filed where no QA runner will glob it,
so that nothing active can reach a runner until the v2 `execution-authorization` preflight exists.

## Acceptance Criteria

### AC-1: Location and schema
**Given** a `proposal` classification
**When** written
**Then** the file is `.agents/security-testing/proposals/<id>.proposal.md` with `proposal.schema.json` frontmatter: threat id, WSTG id, objective, target class, technique, side-effects, required environment, required accounts, rate limits, exclusions, stop conditions, `authorization: {status: proposed, approver: "", approval_ref: ""}`.

### AC-2: Refuses `tasks/`
**Given** an attempt to write a proposal under `tasks/`
**When** `plan.mjs` runs
**Then** it refuses with a non-zero exit.

### AC-3: Not in any hand-off
**Given** proposals exist
**When** `publish --profile handoff|case` and the TA prompt run
**Then** no proposal path or text appears.

---

# US-039: Developer receives a finding through the `tracker` profile with read-back

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §9.4; v3 §9.5; §6.9 `tracker` profile; §6.6 `ingest tracker-readback`; §6.10 `ticketed`
**Priority:** must-have
**Size:** M

## Story
As a developer,
I want a ticket that tells me the class, priority, file, lines, a redacted context and a fix prompt — and nothing that leaks the secret or the full report,
so that I can fix it, and the security lead can verify my fix with `verify.mjs all --finding <id> --base <oid> --head <oid>`.

## Acceptance Criteria

### AC-1: Ticket body
**Given** `publish --run <id> --profile tracker --to <tracker>`
**When** the ticket is created
**Then** its body contains only title, class, priority, path, lines, `context_redacted`, `fix_prompt`, and the finding id; a finding with `sensitive: true` never shows `snippet`.

### AC-2: Read-back
**Given** the mutation returned tracker JSON
**When** `ingest tracker-readback` runs
**Then** only the fields the mutation set are trusted and the ticket url host is in `targets.tracker`; a mismatch between what was sent and what was read back is reported.

### AC-3: Dedupe
**Given** an open ticket already carrying the finding id
**When** `publish --profile tracker` runs for the same id
**Then** no second ticket is created and the existing url is recorded on the register row.

### AC-4: Fix route
**Given** the ticket
**When** the developer follows `fix_prompt`
**Then** it routes to `bugfix-workflow` with the finding id, `context_redacted` and `fix_prompt`, and names the `verify.mjs all` command with `--base`/`--head` the developer must report back.

---

# US-040: `risk-register` skill (prose)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §5 row; §6.8
**Priority:** must-have
**Size:** S

## Story
As a security lead,
I want a skill that explains the register's rows, transitions, what an unauthenticated approval means and how to keep the anchor,
so that I never reduce open exposure by mistake and I know what to store outside the repo.

## Acceptance Criteria

### AC-1: Prose only
**Given** `skills/risk-register/`
**When** listed
**Then** no `scripts/`; `register.mjs` is referenced in `security-evidence`.

### AC-2: Content matches script
**Given** the skill text
**When** compared with US-021 AC-1 and AC-3
**Then** every transition and the approval record shape are described, and the text states there is no confirmed state.

### AC-3: Validates
**Given** `SKILL.md`
**When** `skills-ref` runs
**Then** it passes.

---

# US-041: `security-lead` agent and the `assess` flow

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §4 row; §7 `assess` row; §9; body rules 1–4
**Priority:** must-have
**Size:** L

## Story
As a security lead on a delivery team,
I want one human-facing role that runs `engagement init`, dispatches the threat-modeler and reviewers, builds the report, signs off, publishes to the tracker, prints the QA hand-off prompts and then stops,
so that a full assessment is one conversation and every hand-off to another team is explicit.

## Acceptance Criteria

### AC-1: Frontmatter
**Given** `agents/security-lead/AGENT.md`
**When** parsed
**Then** `model: sonnet`, `group: security`, `skills: [memory, security-engagement]`, `skills-on-demand: [risk-register, security-evidence, issue-tracking, dispatching-parallel-agents, verifying-outcomes]`, `context-docs` = engagement + finding schema + `security-testing/risk-register.md`, no `tools:`, no `context-memory`; `SOUL.md` exists; no `mcpServers` entry exposes `merge_pull_request`.

### AC-2: `assess` order
**Given** an `assess` request
**When** the lead runs
**Then** it executes `engagement init → run init --kind assessment → scope → ingest → dispatch threat-modeler → dispatch security-reviewer per packet → gate → coverage → build-report --template assessment → check → sign-off`, then prints the hand-off prompts (US-035 AC-3, US-037 AC-1) and stops without dispatching QA itself.

### AC-3: Proposes, never approves
**Given** a finding the lead judges acceptable
**When** it acts
**Then** it proposes an `accept` with `--approved-by`/`--approval-ref` supplied by the human, and the record is stored `authenticated: false`.

### AC-4: Read-only posture
**Given** the body
**When** read
**Then** the four §4 rules are present; the lead never merges, closes, rotates or fixes; the writable-paths self-check precedes every write.

### AC-5: Briefing
**Given** `briefings/security-lead.md`
**When** installed
**Then** it lands in `.agents/memory/security-lead/project_briefing.md`.

---

# US-042: Final bundle manifest

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M3
**Spec:** §10 final `factory.json`; v3 §10
**Priority:** must-have
**Size:** S

## Story
As the sdlc-skills maintainer,
I want the manifest to declare the full roster once all three agents and six skills exist,
so that `--factory security-testing` installs the complete team.

## Acceptance Criteria

### AC-1: Manifest
**Given** `factory.json`
**When** read
**Then** `localAgents: ["security-lead", "threat-modeler", "security-reviewer"]`, `localSkills: ["security-evidence", "security-engagement", "threat-modeling", "secure-code-review", "security-test-planning", "risk-register"]`, `skills: ["memory", "knowledge-curation"]`, three `briefings`, `seed`, `instructions`, no `hooks`, no `targets`; `description` unchanged from US-029.

### AC-2: Validate
**Given** the M3 tree
**When** `npm run validate` runs (with network)
**Then** exit `0`.

### AC-3: E2E still green
**Given** US-030
**When** `npm test` runs
**Then** both paths pass with the full roster.

---

# M4 — receiving bundles

# US-043: manual-qa follow-up PR (Step 0 row + explicit-list intake proposal)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M4
**Spec:** §13 M4; §9.2 last sentence; v3 §13 M4
**Priority:** should-have
**Size:** S

## Story
As a QA lead,
I want `test-run-lead` to recognise a `tasks/security-<slug>-admitted/` suite at Step 0,
so that a security hand-off is a routed case, not a surprise.

## Acceptance Criteria

### AC-1: Step 0 row
**Given** `bundles/manual-qa/agents/test-run-lead/AGENT.md` Step 0 routing table
**When** the PR merges
**Then** a row routes a suite folder matching `tasks/security-*-admitted/` to the TC-run branch with a note that the suite contains only admitted passive cases and no other file.

### AC-2: Proposal, not implementation
**Given** the PR
**When** reviewed
**Then** the explicit-list intake branch is described as a proposal (nice-to-have) and no manual-qa behaviour changes beyond the routing row; manual-qa `npm test` and `validate:factories` stay green.

---

# US-044: feature-development follow-up PR (`code-review` pointer)

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M4
**Spec:** §13 M4; v3 §9.5 "tech-lead add-on"
**Priority:** should-have
**Size:** S

## Story
As a tech lead on a feature-development team,
I want the `code-review` skill to point me at the two-skill security review install,
so that I can add a security pass without installing the whole bundle.

## Acceptance Criteria

### AC-1: One line
**Given** `bundles/feature-development/skills/code-review/SKILL.md` § 2
**When** the PR merges
**Then** one line names `--skills security-testing/secure-code-review,security-testing/security-evidence` and the `review --base <ref>` entry point; nothing else in the skill changes.

### AC-2: Validates
**Given** the PR
**When** `skills-ref` and `npm run validate:factories` run
**Then** both pass.

---

# US-045: `execution-authorization` design note for both QA bundles

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M4
**Spec:** §13 M4; §5 v2 row; v3 §9.4
**Priority:** should-have
**Size:** S

## Story
As a QA lead,
I want a design note explaining what a receiving-side `execution-authorization` preflight would check before an active proposal becomes an executable case,
so that my bundle can own that v2 skill knowingly.

## Acceptance Criteria

### AC-1: Placement
**Given** the PR
**When** merged
**Then** an identical design note exists under both `bundles/manual-qa/` and `bundles/test-automation/` (docs only), stating that until it exists active testing is out of scope and proposals never enter `tasks/`.

### AC-2: Contents
**Given** the note
**When** read
**Then** it describes the proposal frontmatter it would consume (US-038 AC-1), the `authorization` fields, and that the record is stored `authenticated: false` like every other approval.

### AC-3: No behaviour change
**Given** both bundles
**When** their tests and `validate:factories` run
**Then** green; no agent or skill text changes.

## Open Questions
- [ ] Ownership — spec §14 item 5 (tracked on the Epic).

---

# M5 — shippable v1

# US-046: Catalog rows, marketplaces and final docs

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M5
**Spec:** §13 M5; §10; CLAUDE.md "Generated vs hand-curated manifests"
**Priority:** must-have
**Size:** S

## Story
As the sdlc-skills maintainer,
I want the bundle in `README.md`, `AGENTS.md`, `bundles/SPEC.md` "Current factories" and the generated marketplaces,
so that a user can discover and install it from any host's catalog.

## Acceptance Criteria

### AC-1: Catalog rows
**Given** the repo docs
**When** read
**Then** `README.md` and `bundles/SPEC.md` list `security-testing` with its three local agents and six local skills.

### AC-2: Marketplaces regenerated
**Given** `npm run gen:marketplaces`
**When** run and committed
**Then** `npm run validate:marketplaces` exits `0` and the security agents/skills appear once each.

### AC-3: Wording
**Given** every generated and hand-written catalog entry
**When** grepped
**Then** "exact checkout" does not appear; the description is the §10 sentence.

---

# US-047: Four-target and two-skill smoke

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M5
**Spec:** §13 M5; D12
**Priority:** must-have
**Size:** M

## Story
As the sdlc-skills maintainer,
I want a documented smoke that installs the bundle on each of the four targets and the two-skill standalone, then runs the review path,
so that a host-specific install regression is caught before release.

## Acceptance Criteria

### AC-1: Four commands
**Given** a temp consumer repo
**When** `node bin/init.mjs init --factory security-testing --target claude --yes`, then `--target cursor`, `--target codex`, `--target copilot` run
**Then** each exits `0`, the three agents exist in the host's native shape, the `SKILLS-INJECTED` block is present for non-Claude hosts, and `instructions.md` is spliced into `AGENTS.md` inside `<!-- FACTORY:security-testing START/END -->`.

### AC-2: Two-skill standalone
**Given** `--skills security-testing/secure-code-review,security-testing/security-evidence`
**When** installed and `engagement init → run init --kind review → scope → gate → coverage → build-report --template review → check` run
**Then** every step exits `0` and `check` prints `CONSISTENT`.

### AC-3: Recorded
**Given** the smoke
**When** complete
**Then** the commands and expected outputs are in the bundle README's install section.

---

# US-048: Dogfood `assess` on sdlc-skills

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M5
**Spec:** §13 M5; §7 `assess` row
**Priority:** should-have
**Size:** M

## Story
As the sdlc-skills maintainer,
I want the full bundle run against this repo as an engagement,
so that the first real assessment is ours and its report and `check` output are on record before release.

## Acceptance Criteria

### AC-1: Engagement completes
**Given** the full bundle installed on a clean checkout of this repo
**When** the `security-lead` runs `assess`
**Then** a `COMMITTED` assessment run exists and `sign-off --engagement <id>` exits `0` under default disposition policy.

### AC-2: Check is clean
**Given** that run
**When** `check --integrity --drift` runs
**Then** `CONSISTENT`, `CURRENT`, `ORIGIN: unauthenticated`, `KEY: available`.

### AC-3: Nothing leaked
**Given** the dogfood
**When** `git status --porcelain` runs
**Then** only the managed `.gitignore` block and intentionally published outputs show; nothing under managed paths is tracked.

### AC-4: Findings recorded
**Given** findings from the dogfood
**When** reviewed by the maintainer
**Then** each has a register row (`open`, `accepted` with unauthenticated approval, or `false-positive`) and the redacted report is kept under `docs/superpowers/notes/`.

---

# US-049: Hook-input probe result recorded

**Epic:** [EPIC] security-testing bundle v1
**Milestone:** M5
**Spec:** §13 M5 "probe result"; §14 open question 1; v3 §13 M5 `tools/probe-hook-input.mjs`
**Priority:** should-have
**Size:** S

## Story
As the sdlc-skills maintainer,
I want the result of probing what identity each host passes to a hook written down,
so that the v2 hooks decision (spec §14) starts from evidence.

## Acceptance Criteria

### AC-1: Probe exists
**Given** `tools/probe-hook-input.mjs`
**When** run under Claude Code
**Then** it prints the hook input fields it received, with no side effects on the consumer repo.

### AC-2: Result recorded
**Given** the probe was run on each host that supports hooks
**When** `NOTES.md` in the bundle is read
**Then** it records per host which identity fields were present and whether they could be trusted, and states that v1 ships no bundle hooks (D4).

## Open Questions
- [ ] Hook-input identity — spec §14 item 1 (tracked on the Epic).

---

# Parking lot

Captured during story writing; none of these enters v1.

| Item | Why parked | Spec ref |
|---|---|---|
| `privacy-threats`, `security-requirements`, `supply-chain-review`, `threat-model-export`, `agentic-surface-review`, `security-evals`, `mitigation-reconciliation` | v2 skills | §5 |
| `execution-authorization` (receiving-side preflight) | v2; owned by QA bundles; design note only in v1 (US-045) | §5, §13 M4 |
| Bundle hooks (any event) | D4 locks v1 to prose + baseline observation; probe result (US-049) informs v2 | D4, §14 |
| manual-qa explicit-list intake branch | proposal only (US-043); dedicated suite makes it unnecessary for v1 | §9.2 |
| Threat-model completeness metric | undecided (§14) | §14 |
| Consumer-side storage of manifest digest / register anchor | undecided (§14); `check --trusted-digest` and `anchor verify --expect` already accept them | §14, §6.3, §6.8 |
| `confirm` command / authenticated approval state | removed permanently | D15 |
| Provenance / origin | not a goal | D2 |
| Exploitation / penetration testing | assessment, not pentest | §1 |
| Encryption of local artifacts | Not guaranteed | §8 |

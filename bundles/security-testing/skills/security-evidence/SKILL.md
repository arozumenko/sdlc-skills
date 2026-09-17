---
name: security-evidence
description: Use when running any command of the security-testing bundle — starting an engagement, allocating a run, scoping, building a packet, ingesting a SARIF file or a ticket, gating claims, accounting coverage, admitting receipts, building or re-checking a report, verifying a fix, working the residual-risk register, publishing a redacted report or a tracker payload, signing off, purging — or when a schema, a template or a result token's exact spelling is needed. Every script and every schema of the bundle lives here; the other security skills are prose that name these commands.
license: MIT
compatibility: Node 18+ (stdlib only, no dependencies, no build); git CLI; runs from the root of a git work tree. No network anywhere in scripts/.
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
  version: "1.0.0"
---

# Security evidence — the command and schema index

Four entry scripts carry every command of the bundle (`plan.mjs admit |
propose | ta-prompt` landed in M3). Each is a thin
argv dispatcher over `scripts/lib/cmd-<name>.mjs`; the shared modules are
`canon.mjs` (canonical bytes, envelopes, identities), `normalize.mjs`
(line normalisation), `redact.mjs` (the bounded rule list) and `lib/`.
`<scripts>` below is `<skills dir>/security-evidence/scripts` (on Claude
Code `.claude/skills/security-evidence/scripts`); `<st>` is
`.agents/security-testing`; `<run>` is `<st>/runs/<run_id>`. Run
everything from the repository root; `--root <dir>` overrides it.

**Every string that leaves memory is redacted first** — artifacts, stdout,
stderr, prompts, ticket payloads, the rendered register — through
`redact.mjs` and its versioned `references/redaction-rules.json`; the
guarantee is bounded to that rule list. Content identity is a keyed HMAC
whenever the bytes can match a rule; artifact identity is a plain sha256
over the canonical payload. `metadata.version` above equals
`scripts/version.json` `tool_version`, which every run manifest records.

## Process contract

- `node <scripts>/<script>.mjs [--root <dir>] [--actor <name>] [--quiet] <command> [<subcommand>] [flags]`;
  `--help` prints usage and exits 0; no command exits 2.
- Exit codes: `0` ok · `1` internal error · `2` usage, unknown command, bad
  argv, `EDIT-AND-RERUN` class · `3` `INDETERMINATE` class refusal · `4`
  verification failure · `5` integrity mismatch.
- stdout carries result tokens, one per line, spelled exactly as
  `scripts/lib/tokens.mjs` exports them; a command that writes an enveloped
  artifact ends with `WROTE <repo-relative path> sha256=<self_sha256>`.
  stderr is diagnostics only.
- Deterministic time: `SECURITY_EVIDENCE_NOW` fixes `created_at`;
  `SECURITY_EVIDENCE_ACTOR` (or `--actor`) is the recorded actor. Nothing
  under a payload ever carries a timestamp, a hostname, a tmp path or a PID.
- Child processes are `execFile`/`spawn` with an argv array, `shell: false`,
  explicit `cwd` and `env`. No network. The scripts have no tracker access;
  the tracker call is the lead's `issue-tracking` skill.
- Nothing is rewritten inside a run after `run init` except the index files
  (`imports.json`, `observations.json`, `proposals-index.json`); after
  `COMMITTED` nothing under the run is written by anyone. Retry = new run.

## `evidence.mjs`

| Command | Does | Result line(s) |
|---|---|---|
| `evidence.mjs engagement init [--rotate]` | step 0 writes `<st>/knowledge/` (templates) and `<st>/engagement.md` from the template when absent and exits `2 EDIT-ENGAGEMENT-AND-RERUN`; with a record present: managed `.gitignore` block, fail-closed check that every private destination is untracked and ignored, HMAC key (`--rotate` mints another), baseline over `scope_paths ∪ product_paths` | `TEMPLATES: <file>=written\|present …`, `ENGAGEMENT: present`, `IGNORE-BLOCK: written\|unchanged`, `KEY: <key_id> created\|reused\|rotated`, `BASELINE: <n> files ignored=<n>`; `4 TRACKED(<path>)` / `4 NOT-IGNORED(<path>)`; `2 POLICY-INVALID(private)` |
| `evidence.mjs engagement validate` | status of the block, tracked paths, key, baseline; writes nothing | `IGNORE-BLOCK: ok\|stale`, `TRACKED: none`, `KEY: available\|unavailable`, `BASELINE: present\|absent` (exit 4 on any bad line) |
| `evidence.mjs engagement baseline` | rewrite `<st>/private/baseline.<engagement_id>.json` | `BASELINE: <n> files ignored=<n>` |
| `evidence.mjs run init --kind assessment\|review\|verify\|threat-model --base <ref> [--head <ref>]` | allocate `<run_id>` (`head_oid[0:12]-<seq>`) under the ledger lock; snapshot `engagement.md` as `<run>/engagement.json`; an assessment requires a clean tree at head under the assessed paths and writes its empty inputs | `RUN <run_id> seq=<n> kind=<k> base=<oid> head=<oid>`, `WROTE …`; `3 DIRTY-TREE`; `2 ENGAGEMENT-MISSING` |
| `evidence.mjs run snapshot register\|verify\|proposals --run <id> [--from <verify_run_id>]…` | copy cross-run artifacts **into** the run directory so `build-report` reads nothing outside it: `run snapshot register` (the register events as `<run>/register-events.json`), `run snapshot verify` (another verify run's `verify.json` with its packets and receipts under `<run>/verify-snapshots/<verify_run_id>/`), `run snapshot proposals` (the proposals index) | `WROTE …`; `2 RUN-COMMITTED`; `2 SNAPSHOT-EXISTS` |
| `evidence.mjs scope --run <id> [--include <path-or-glob>]… [--max-bytes <n>]` | enumerate tracked files under `scope_paths` into `<run>/scope.json` (identity independent of envelope); a `review` run snapshots dirty files redacted with HMACs of the originals under `<st>/private/snapshots/<run_id>/` | `WROTE <run>/scope.json …`; `3 DIRTY-TREE` (assessment); `2 SCOPE-EXISTS` |
| `evidence.mjs packet --run <id> --kind scope` | the scope packet for the `review` contract: every scope file with its whole admitted range, `range_hmac`, `policy_sha256` | `PACKET <path> sha256=<h> kind=scope files=<n>` |
| `evidence.mjs packet --run <id> --kind subject --subject <id>… [--type <t>] [--policy <file>]` | a subject packet over one gated finding (or a mitigation) for `vulnerability-review` / `mitigation-review`, built from its primary and typed citations; `--type case --subject <st>/cases/<slug>/TC-NNN_<slug>.md` lists the committed candidate case at head with subject id `case_sha256` (sha256 over its redacted text) for the `vulnerability-review` that admits it ("confirmed passive") | `PACKET <path> sha256=<h> kind=subject files=<n>`; `2 USAGE(packet: case <path> is not in the tree at head …)` |
| `evidence.mjs ingest <kind> <file> --run <id> [--sent <ticket.json>]` | `<kind>` ∈ `sarif`, `ticket`, `pr`, `doc`, `case`, `audit`, `qa-run`, `ta-report`, `tracker-readback`; read → HMAC → redact → persist the import under `<st>/ledger/<run_id>/imports/<import_sha256>`, write `<run>/ingest/<import_sha256>.json`; untrusted content proposes, only scope- and target-validated references act; SARIF goes through `references/sarif-mapping.v1.json` and its closed fallback matrix | `IMPORT <kind> import_sha256=<h> records=<n> unlocated=<n> rejected=<n>`; `2 IMPORT-EXISTS(<h>)`; for `tracker-readback` `READBACK: ok` then `TICKETED <R-id> <url>` (the `ticketed` event landed on the live register row whose subject is the finding; status unchanged), or `READBACK: ok (no register row)` (the record is the evidence, nothing appended — add the row, read back again), or `READBACK: MISMATCH(<field>)` per mismatched field; for `qa-run` one `OBSERVATION <O-id> case=<id> result=<PASS\|FAIL\|BLOCKED>` + `WROTE <run>/observations/<O-id>.json …` per result row whose case has an `admitted-*` record in the run (joined through the run's `ingest case` records; a row without one is an unlocated candidate `unadmitted-case`), then `WROTE <run>/observations.json …` on assessment runs; for `ta-report` `TA-UNITS <run>/ta-units/<h>.json units=<n> sha256=<h>` (payload-only per-unit records: outcome, coverage, exclusions per assertion, findings, recovery_basis, case_sha256) |
| `evidence.mjs gate --run <id> [--claims <payload.json>]…` | re-check every claim's citation byte for byte after normalisation; derive ids (keyed when the content matches a redaction rule); write `<run>/findings.claimed.json`, `gate-result.json`, `rejects.json`, `unlocated.json` and the private citation records | `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>`; `2 CLAIMS-PACKET-MISMATCH`; `2 GATE-EXISTS` |
| `evidence.mjs coverage --run <id> --examined <payload.json> [--scanner-rows <file>]` | account for every scoped range exactly once: `examined`, `unexamined`, scanner-only | `COVERAGE examined=<n> skipped=<n> scanner=<n>`; `COVERAGE INDETERMINATE` (empty scope); `2 EXAMINED-PACKET-MISMATCH`; `2 COVERAGE-EXISTS` |
| `evidence.mjs receipt validate --run <id> <file>` | admit an agent's receipt payload (schema, packet exists and lists the subject, `files[].oid` still equal the run's) — envelope and copy into `<run>/receipts/<self_sha256>.json` | `RECEIPT admitted sha256=<h> type=<t> subject=<id>`; `REJECTED(<reason>)` (`forbidden field <name>`, `unknown packet`, `packet_sha256 mismatch`, `reviewer_run_id != run`, …) |
| `evidence.mjs receipt apply --run <id> [--json]` | derive `REVIEW_CONFIRMED\|REVIEW_REFUTED\|REVIEW_INDETERMINATE` and `MITIGATION_CONFIRMED\|MITIGATION_GAP\|MITIGATION_INDETERMINATE` from the admitted receipts (pure `lib/states.mjs`) | one state line per subject; `not_applied` reasons |
| `evidence.mjs build-report --run <id> --template review\|assessment\|verify\|threat-model` | close over the template's required inputs (transitive), render `<run>/report.md` with a `<!-- v:<view-path> -->` marker on every derived line, write `manifest.json`, then the `COMMITTED` marker last | `REPORT <path>`, `MANIFEST sha256=<h>`, `COMMITTED`; `3 INCOMPLETE(<input>)` |
| `evidence.mjs check <run dir \| manifest.json> [--integrity] [--drift] [--trusted-digest <sha256>]` | recompute every derived value from the recorded inputs and byte-compare the report; `--integrity` re-reads every citation at its recorded side (`snapshot` citations only while the working file matches its HMAC); `--drift` compares with the current tree at citation and scope level | `CONSISTENT` \| `CONSISTENT-REDACTED-ONLY(<n> citations)` \| `STRUCTURE-ONLY` \| `INCONSISTENT(<field>)` (exit 5); `CURRENT` \| `CITATION-DRIFTED(<n>)` \| `SCOPE-DRIFTED(<n> files)`; `ORIGIN: unauthenticated` \| `ORIGIN: matches supplied digest`; `KEY: available\|unavailable`; `3 INCOMPLETE(COMMITTED)` |
| `evidence.mjs check-export <export-manifest.json> [--source <run dir>]` | re-derive a published output from its source run | `VERIFIED-DERIVATIVE` \| `LINKED-ONLY` \| `MISMATCH(output)` (exit 5) |
| `evidence.mjs publish --run <id> --profile <p> --to <destination> [--slug <s>] [--base-url <u>]` | the only path out of `<st>/`: `redacted-report`, `full-report`, `tracker` (M1) — `handoff`, `case` (M3); every output has an export manifest; the tracker profile writes `handoffs/<finding_id>.ticket.json` and dedupes against the register and prior imports (the lead searches the live tracker before posting) | `PUBLISHED profile=<p> output=<path> sha256=<h>` …, `WROTE <export manifest>`; `DEDUPE finding=<id> existing=<url>` (the register row's `ticket_url` or a prior import's trusted url); `NEXT: post <path> via issue-tracking, then ingest tracker-readback --sent <path> <response.json>`; `2 USAGE(publish: run <id> is not COMMITTED …)` |
| `evidence.mjs sign-off --engagement <id> [--expect <anchor>]` | walk `<st>/ledger/index.json`; require ≥ 1 `COMMITTED` assessment run; check every `COMMITTED` run in-process; latest assessment `CURRENT` and coverage not `INDETERMINATE`; register replayed (`--expect` → `anchor verify`); dispositions per policy; no tracked managed path; then **list** incomplete runs, per-path changes since baseline, excluded (ignored) coverage, unauthenticated approvals | `SIGN-OFF: OK` \| `SIGN-OFF: FAIL(<cause>)[ run=<run_id>]` (exit 4) — `NO-ASSESSMENT`, `INCONSISTENT(<field>)`, `STRUCTURE-ONLY`, `SCOPE-DRIFTED(<n> files)`, `COVERAGE-INDETERMINATE(<run>)`, `CORRUPT`, `TRUNCATED`, `DIVERGED`, `DISPOSITIONS(<ids>)`, `TRACKED(<path>)`; listings `RUNS:`, `INCOMPLETE:`, `CHANGES-SINCE-BASELINE:`, `EXCLUDED-COVERAGE:`, `UNAUTHENTICATED-APPROVALS:`, `UNADMITTED:`, `DISPOSITIONS:` |
| `evidence.mjs purge --engagement <id> [--yes]` | remove one engagement's runs, ledger entries, imports, receipts drop-box, private records, snapshots, baseline and keys (dropping `keys/current` when it points at one of them); the register and the working tree are untouched | `PURGE <path>` per planned removal, then `PURGED runs=<n> keys=<n> current-key=<dropped\|kept>`; without `--yes` only the plan is printed |

## `verify.mjs`

`verify.mjs all` is the only source of a public verdict (D17) and is
two-pass; `verify.mjs evaluate` is its pure verdict function.

| Command | Does | Result line(s) |
|---|---|---|
| `verify.mjs all --finding <id> --base <oid> --head <oid> [--receipts <dir>] [--timeout-s <n>]` | allocate a verify-kind run; steps 1–6: branch (is the fix committed on a branch reaching head, is the path touched), worktree (head checked out in an OS temp worktree), install (dependencies installed by the argv from `engagement.md`; the tree is compared to `head_oid` after installation — `install-modified-tree` fails the run unless the operator record allows it, then `tested_tree` names the derived snapshot), suppression (`ignore-file-edit`, `inline-suppress`, `test-skip` indicators and `deletion_only` over the whole diff), tests (run from that snapshot, bounded redacted output), the fix-review packet; then `evaluate`. **Two-pass**: pass 1 stops at the packet; pass 2 (`--receipts <dir>`) is a fresh verify run that admits the `fix-review` and `ack` receipts and consumes the verdict into the register when a row exists | pass 1: `PACKET <path> …`, `NEXT: dispatch security-reviewer fix-review`; pass 2: `RECEIPT admitted …`, `CONSUMED …` / `REGISTER: no row for finding`, last line `VERDICT <VERIFIED\|REGRESSED\|UNVERIFIED-REFOUND\|UNVERIFIED-NOT-COMMITTED\|UNVERIFIED-TESTS-FAILED\|UNVERIFIED-NO-TEST-SURFACE\|UNVERIFIED-INDETERMINATE(<why>)\|UNVERIFIED-SUPPRESSION(deletion-only\|<n> unacked)> finding=<id> base=<oid> head=<oid> tested_tree=<hmac\|same-as-head> verify=<sha256>`; `2 UNKNOWN-FINDING`; `4 UNVERIFIED-REFUTED-FINDING` |
| `verify.mjs evaluate <verify.json> \| --raw <json>` | the pure verdict function over recorded results (`refound_observed` first, completeness second; `VERIFIED` requires an applied `not-refound`; a `refound` emits `regression-observed` independently of completeness) | `{verdict, refound_observed, ack_refs, events}` |

## `register.mjs`

The residual-risk register: an append-only `events.jsonl` with a hash
chain, a replayed `projection.json`, an alias log and an anchor. **There is
no `confirm` verb and no confirmed state**: `accept`, `revoke` and
`close-false-positive` store `{recorded_by, approved_by, approval_ref,
authenticated: false}` and none reduces open exposure.

| Command | Does | Result line(s) |
|---|---|---|
| `register.mjs add --subject <finding_id\|threat_id> --priority p0..p3 --title <t> --run <run_id> [--owner <o>]` | open a row | `ROW <R-id> status=<status> priority=<p> seq=<n>` |
| `register.mjs accept <R-id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>` | record an unauthenticated acceptance with expiry | `ROW …` |
| `register.mjs revoke <R-id> --approved-by <who> --approval-ref <ref>` | revoke an acceptance | `ROW …` |
| `register.mjs check` | expire acceptances past `--until` | one `ROW` per expiry, `CHECK expired=<n>` |
| `register.mjs close-false-positive <R-id> --approved-by <who> --approval-ref <ref>` | close as false positive (unauthenticated record) | `ROW …` |
| `register.mjs reopen <R-id> --reason <r>` | reopen | `ROW …` |
| `register.mjs supersede <R-id> --by <R-id> (--subject-equivalent \| --transfer-exposure)` | supersede with an equivalence or an exposure transfer — neither flag ⇒ `2 EQUIVALENCE-REQUIRED` | `ROW …`; `4 NOT-EQUIVALENT(<R-id>, <R-id>)` |
| `register.mjs alias --from <finding_id> --to <finding_id> --reason <r> --run <run_id>` | record a finding-id equivalence (undirected, transitive) | `ALIAS from=<id> to=<id> seq=<n>` |
| `register.mjs consume-verdict <verify.json>` | fold a `VERDICT` into the row (`fixed`, `regressed`, `*-observed`) | `CONSUMED <verdict> row=<R-id> verify=<sha256>` then `ROW …`; `NO-ROW` |
| `register.mjs transition <event> <R-id> [flags]` | generic form of the verbs above; `ticketed`, `fixed`, `regressed`, `*-observed`, `acceptance-expired` are emitter-only | `4 TRANSITION-REJECTED(<event>: <from>)` |
| `register.mjs render [--out <path>]` | write the Markdown view `<st>/risk-register.md` (eight columns: `id \| subject \| priority \| status \| owner \| ticket_url \| last_verified_run \| title`) — the lead's context doc | `WROTE …` |
| `register.mjs status [--json]` | counts by priority × status; open exposure never reduced by an approval | `STATUS rows=<n> seq=<n>`, `OPEN-EXPOSURE …`, `COUNT <status> …`, `APPROVALS unauthenticated=<n>` |
| `register.mjs replay [--write]` | rebuild the projection from the log (`--write` persists it) | `REPLAY seq=<n> rows=<n> chain=<h>` (+ `PROJECTION <path>` with `--write`); `5 CORRUPT` |
| `register.mjs anchor print` | `<engagement_id>:<seq>:<chain_sha256>` for the consumer to keep outside the repo | the anchor |
| `register.mjs anchor verify --expect <engagement_id:seq:hash>` | compare the log against a held anchor | `MATCH` \| `TRUNCATED` \| `DIVERGED` (exit 5) |

## `tm-lint.mjs` (M2)

`tm-lint.mjs check` validates the threat model the `threat-modeling` skill
describes and writes the run's copy; `tm-lint.mjs render` writes its
Markdown view (D14). Dispositions are validated as relationships against
the run directory (spec §6.10): the agent's `disposition.kind` is an
assertion, `<run>/dispositions.json` is what the script derived from it.

| Command | Does | Prints |
|---|---|---|
| `tm-lint.mjs check --run <id> [--model <path>]` | validate `<st>/threat-model.json` (or `--model`): schema, unique ids, non-blank names, one in-scope citation per element (and per cited mitigation; a dirty `snapshot` file cannot be cited), then snapshot it write-once as `<run>/threat-model.json`, then validate every disposition relationship — `planned` against `proposals-index.json` / `admissions/`, `executed` against `observations/`, `ticketed` against a `tracker-readback` import whose body carries the threat id, `accepted` against the register snapshot's row (subject = threat, status accepted), `mitigated` against `receipt apply`'s `MITIGATION_CONFIRMED` — and write `<run>/dispositions.json` (one row per threat, `resolved_via`) | `TM elements=<n> threats=<n> undisposed=<n>`, two `WROTE …`; `4 TM-INVALID(<threat\|element>: <reason>)` (nothing written on a structural failure; the snapshot's `WROTE` after a relationship failure); `2 SNAPSHOT-EXISTS` for a different model on a snapshotted run; `3 INCOMPLETE(scope)` |
| `tm-lint.mjs render --run <id>` | `<run>/threat-model.md` from the snapshot, the dispositions index and the run's mitigation states; write-once | `RENDER <path> elements=<n> threats=<n>`; `3 INCOMPLETE(threat-model\|dispositions)`; `2 RENDER-EXISTS` |

## `plan.mjs` (M3)

`plan.mjs admit` produces the admission record that decides whether a case
enters the hand-off suite or stays a proposal (unknown effects ⇒ proposal;
the claim is "admitted by lint or by review", never "safe"); `plan.mjs
propose` files active work outside `tasks/`. The grammar, the forbidden
list and the routes are the `security-test-planning` skill.

| Command | Does | Prints |
|---|---|---|
| `plan.mjs admit --run <id> <case.md> [--receipt <sha256>]` | lint the `## Steps` Action cells of a candidate case under `<st>/cases/<slug>/` (allowed-operation grammar + forbidden patterns + hosts against `targets.browser` of the run's engagement) and write `<run>/admissions/<case_sha256>.json` (write-once; `case_sha256` = sha256 over the redacted text, the same identity `ingest case` and `packet --type case` use): `admitted-heuristic` with zero hits, `proposal` otherwise; with `--receipt`, the named admitted `vulnerability-review` receipt on the case packet must be this case's and `receipt apply`'s state must be `REVIEW_CONFIRMED` ⇒ `admitted-reviewed` (`receipt_sha256` recorded; a forbidden hit is never reviewed away), `refuted` / `indeterminate` ⇒ `proposal` with a `review-not-confirmed` hit | `ADMISSION case=<case_sha256> classification=<admitted-heuristic\|admitted-reviewed\|proposal> hits=<n>`, `WROTE …` (exit 0 for every classification); `2 SCHEMA-INVALID(case: …)`, `2 ADMISSION-EXISTS` (a different record for the same case), `2 USAGE(admit: candidate cases live under …)`, `3 INCOMPLETE(engagement)`, `4 RECEIPT-MISMATCH(<reason>)` |
| `plan.mjs propose --run <id> <proposal.md>` | validate the one fenced ```` ```json proposal ```` block against `proposal.schema.json` (`authorization.status: proposed`, `authenticated: false` by schema) and copy the file, redacted, to `<st>/proposals/<id>.proposal.md`; a source under `tasks/` is refused; an existing destination with different bytes is refused, never overwritten | `PROPOSAL <path> id=<P-nnn> sha256=<h>`, `NEXT: run snapshot proposals --run <id>`; `2 SCHEMA-INVALID(proposal: …)`, `2 PROPOSAL-UNDER-TASKS` |
| `plan.mjs ta-prompt --run <id> --slug <s> --base <branch>` | print the test-automation hand-off prompt from the run's PUBLISHED suite (`publish --profile case` first): the members of `<st>/handoffs/<run_id>.case.export-manifest.json`, each suite file re-verified against the recorded sha256, listed as `id`, `title`, `path` (`./tasks/security-<slug>-admitted/<file>`) with `slug` and `base` (a branch name printed as a label, never resolved); nothing from a proposal, no verification state consulted (tests may be built before VERIFIED); nothing is written | the prompt on stdout (`Run as the active agent (claude --agent test-automation-lead):` …, `cases:`, one `- id: … \| title: … \| path: …` line per case); `2 USAGE(ta-prompt: run <id> has no published suite …)`, `2 USAGE(ta-prompt: … published its suite for slug <s>, not <t>)`, `2 USAGE(ta-prompt: the suite file is not what publish recorded …)` |

## Schemas (`references/`)

Every artifact is validated on write and on read (`lib/schema.mjs`, a
stdlib subset of JSON Schema). Enveloped artifacts share
`envelope.schema.json` (`schema_version`, `kind`, `run_id`, `engagement_id`,
`key_id`, `created_at`, `self_sha256` over the canonical payload).

| Schema | Artifact |
|---|---|
| `engagement.schema.json` | the ```` ```json engagement ```` block of `<st>/engagement.md` |
| `baseline.schema.json` | `<st>/private/baseline.<engagement_id>.json` |
| `run.schema.json` | `<run>/run.json` |
| `scope.schema.json` | `<run>/scope.json` |
| `packet.schema.json`, `packet-policy.v1.schema.json` (`packet-policy.v1.json`) | `<run>/packets/<sha>.json` and the policy the packet names |
| `finding.schema.json` | a claim (payload) and a gated finding (`<run>/findings.claimed.json`) |
| `examined.schema.json` | the reviewer's examined declaration |
| `gate-result.schema.json` | `<run>/gate-result.json` |
| `citation-record.schema.json` | `<st>/private/citations/<run_id>/<finding_id>.json` |
| `coverage.schema.json` | `<run>/coverage.json` |
| `receipt.schema.json` | `vulnerability-review`, `mitigation-review`, `fix-review`, `ack` receipts |
| `verify.schema.json` | `<run>/verify.json` (verify-kind runs) |
| `run-manifest.schema.json` | `<run>/manifest.json` |
| `import.schema.json`, `imports-index.schema.json` | `<run>/ingest/<sha>.json` and `<run>/imports.json` |
| `observation.schema.json`, `observations-index.schema.json` | QA observations and `<run>/observations.json` |
| `proposal.schema.json`, `proposals-index.schema.json` | `<st>/proposals/<id>.proposal.md` frontmatter and `<run>/proposals-index.json` |
| `admission.schema.json` | `<run>/admissions/<case_sha256>.json` (M3) |
| `register.schema.json` | register events, alias log entries and the projection |
| `threat-model.schema.json` | `<st>/threat-model.json`, its run snapshot `<run>/threat-model.json` and `<run>/dispositions.json` (`Dispositions`) |
| `export-manifest.schema.json` | the manifest next to every published output |
| `sarif-mapping.v1.schema.json` (`sarif-mapping.v1.json`) | the versioned SARIF mapping and its closed fallback matrix |
| `redaction-rules.schema.json` (`redaction-rules.json`) | the bounded, versioned rule list |

`normalize-vectors.json` holds the normalisation test vectors.

## Templates (`templates/`)

`review.md`, `assessment.md`, `verify.md`, `threat-model.md` — each opens
with a `required-inputs` block that `build-report` closes over
transitively and `check` re-derives; `unknown / not assessed` is allowed
and blank is forbidden. `templates/README.md` explains the slot grammar.
`templates/knowledge/` is the byte-identical copy of the bundle's seeded
knowledge files that `engagement init` step 0 writes into a two-skill
standalone install.

## Where the prose is

- `secure-code-review` — the reviewer's loop, taxonomy, refutation
  criteria, do-not-flag list, and the human-driven standalone sequence.
- `security-engagement` — the lead's workflow, stand-down check, sign-off
  checklist, tracker rules, disclosure profiles.
- The bundle `README.md` — the Guarantees table (`enforced by: script |
  prose`, qualified "for runs carrying a `COMMITTED` marker produced by the
  canonical pipeline") and the Not guaranteed list.

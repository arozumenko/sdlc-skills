# Security Testing Team

A **threat-led, read-only security testing team**: a code-derived STRIDE
threat model with a citation per element, an evidence-gated secure code
review whose citations anyone with the repository can re-check, passive
security cases handed to the manual-qa and test-automation bundles, fix
verification from a validated test-start snapshot, and a residual-risk
register. It produces a **security assessment**, not a penetration test.
Every agent is read-only toward product code and never merges, closes,
rotates or fixes anything.

**Active testing is out of scope in v1.** The bundle writes passive cases
(admitted by effect, see [Hand-offs](#hand-offs)) and turns anything with an
unknown or active effect into a *proposal* — a document outside `tasks/`,
never a runnable case.

**v1 ships the full team** (spec §3 D1, §4): three agents — `security-lead`,
`threat-modeler`, `security-reviewer` — and six skills. Every script lives in
`security-evidence`, so any install that includes it runs every command; the
two-skill standalone install (no agents) runs every command too — the
threat-model and planning commands simply have nothing to lint or admit
without their agents' input (a `threat-model.json`, candidate cases).

## Install

Full bundle:

```bash
npx github:arozumenko/sdlc-skills init --factory security-testing
```

Installs the three agents into the host's agent directory, the six local
skills plus `memory` and `knowledge-curation` (monorepo skills, no network)
and the two externals the agents declare on demand (`systematic-debugging`,
`dispatching-parallel-agents`), seeds `.agents/security-testing/knowledge/`
(the engagement template, the human reading of the finding schema, the
report reading guide), seeds one `project_briefing.md` per role, and splices
a **role-scoped** block into `AGENTS.md` / `CLAUDE.md` inside
`<!-- FACTORY:security-testing -->` markers — it binds only this bundle's
roles. The bundle declares no hooks (D4); the installer's core context hooks
install as they do for every bundle and are outside this bundle's control.

Two-skill standalone review — no agents, the human drives the commands:

```bash
npx github:arozumenko/sdlc-skills init --skills security-testing/secure-code-review,security-testing/security-evidence
```

A standalone install seeds nothing and splices nothing; `evidence.mjs
engagement init` writes the knowledge templates itself when the seeded
copies are absent (D12). See [Standalone review](#standalone-review-human-driven)
for the exact sequence.

### Smoke: four targets + two skills

`skills/security-evidence/scripts/smoke.test.mjs` runs the five installs
below **offline** from a checkout (each line as `node bin/init.mjs <args>`
through the bundle's offline harness: one local bare fixture remote serves
both externals and every `https://github.com/` URL is rewritten to an
unreachable path), each into an empty directory holding only a consumer
`CLAUDE.md`, then drives the two-skill install through the
[standalone sequence](#standalone-review-human-driven) up to `check`. It is
opt-in — `SDLC_SMOKE=1 npm test` — and skips otherwise so `npm test` stays
fast; the command block below is compared against the script's own list on
every `npm test`, so the two cannot drift. The same commands run by hand
against any host, with the network, install the same shapes.

<!-- smoke:commands -->
```bash
npx github:arozumenko/sdlc-skills init --factory security-testing --target claude --yes
npx github:arozumenko/sdlc-skills init --factory security-testing --target cursor --yes
npx github:arozumenko/sdlc-skills init --factory security-testing --target codex --yes
npx github:arozumenko/sdlc-skills init --factory security-testing --target copilot --yes
npx github:arozumenko/sdlc-skills init --skills security-testing/secure-code-review,security-testing/security-evidence --target claude --yes
```

Every factory install, on any of the four targets, prints these lines
(indentation, the `Catalog:` line and the `Launch …` line vary; in a
directory that already has an `AGENTS.md` the instructions line reads
`(appended)`, and without a `CLAUDE.md` it reads `(not present; skipped)`):

<!-- smoke:expected-factory -->
```text
Factory: Security Testing Team — 0 shared agent(s), 3 local agent(s), 6 local skill(s), 8 extra skill(s)
• "issue-tracking" exists in feature-development, test-automation — using feature-development. Qualify as <factory>/issue-tracking to pick another.
✓ agent  security-lead (factory-local)
✓ agent  threat-modeler (factory-local)
✓ agent  security-reviewer (factory-local)
✓ skill  security-evidence (factory-local)
✓ skill  dispatching-parallel-agents (external: obra/superpowers)
✓ skill  systematic-debugging (external: obra/superpowers)
✓ briefing security-lead
✓ briefing threat-modeler
✓ briefing security-reviewer
✓ instructions AGENTS.md (created)
✓ instructions CLAUDE.md (appended)
✓ seed .agents/security-testing/knowledge
Done: 21 installed, 0 skipped.
```

and lands the host's native shape — the smoke asserts each:

| Target | Agents | `SKILLS-INJECTED` block | Skills + scripts |
|---|---|---|---|
| `claude` | `.claude/agents/<role>/` directories (`AGENT.md`, `SOUL.md`, `RULES.md`) | absent (Claude preloads `skills:`) | `.claude/skills/<id>/`, scripts under `security-evidence/scripts/` |
| `cursor` | `.cursor/agents/<role>/` directories | present | `.cursor/skills/<id>/` |
| `codex` | flat TOML `.codex/agents/<role>.toml` (`name = "<role>"`, a `developer_instructions` body), no directory | absent (the TOML carries the inventory) | `.codex/skills/<id>/` |
| `copilot` | flat `.github/agents/<role>.agent.md`, no directory | present | `.github/skills/<id>/` |

On every target the `<!-- FACTORY:security-testing START -->` …
`<!-- FACTORY:security-testing END -->` block appears exactly once in
`AGENTS.md` (created) and once in `CLAUDE.md` (appended after the
consumer's own text), and `.agents/memory/<role>/project_briefing.md` is
byte-equal to `briefings/<role>.md` for each of the three roles.

The two-skill install prints:

<!-- smoke:expected-skills -->
```text
✓ skill  secure-code-review
✓ skill  security-evidence
Done: 2 installed, 0 skipped.
```

with no agents, no seed and no splice; the smoke then runs the standalone
sequence — `engagement init` (twice), `run init --kind review`, `scope`,
`packet --kind scope`, `gate`, `coverage`, `packet --kind subject` +
`receipt validate`, `build-report --template review` — and
`check <st>/runs/<run_id> --integrity --drift` prints exactly:

<!-- smoke:expected-check -->
```text
CONSISTENT
CURRENT
ORIGIN: unauthenticated
KEY: available
```

## Roster

| Role | Model | Does | `skills:` | `skills-on-demand:` |
|---|---|---|---|---|
| `security-lead` | sonnet | Orchestrator, the only human-facing role. `engagement init`; the `assess` / `verify` / `tracker` / `accept` flows; dispatches the specialists; `build-report`; `sign-off`; `publish` to the tracker with a read-back; prints the hand-off prompts and stops; proposes acceptances. | `memory`, `security-engagement` | `risk-register`, `security-evidence`, `issue-tracking`, `dispatching-parallel-agents`, `verifying-outcomes` |
| `threat-modeler` | opus | Code-derived DFD with a citation per element; STRIDE per element; mitigations as claims for a separate `mitigation-review`; one disposition per threat. Returns `MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>` only on `tm-lint check` exit 0. | `memory`, `threat-modeling` | `security-test-planning`, `security-evidence`, `gathering-context`, `deep-research` |
| `security-reviewer` | sonnet | Four contracts, each a fresh dispatch over one packet: `review` (claims over a scope packet), `vulnerability-review`, `mitigation-review`, `fix-review` (an assertion over a subject packet). Writes claims and assertions; the scripts derive ids, states and verdicts. | `memory`, `secure-code-review` | `security-evidence`, `systematic-debugging` |

Every agent writes assertions, never states, verdicts, ids or gate stamps;
none merges, closes, rotates or fixes.

## Skills

| Skill | Content |
|---|---|
| `security-evidence` | **Every script and schema.** `evidence.mjs` (`engagement init\|validate\|baseline`, `run init`, `run snapshot`, `scope`, `packet`, `ingest <kind>`, `gate`, `coverage`, `receipt`, `build-report`, `check`, `check-export`, `publish`, `sign-off`, `purge`), `verify.mjs all`, `register.mjs`, `tm-lint.mjs`, `plan.mjs`, plus `canon.mjs`, `normalize.mjs`, `redact.mjs`; the JSON schemas; the report templates with their required-inputs lists. Its `SKILL.md` is the command index. |
| `secure-code-review` | Prose for the reviewer: investigate-then-refute loop, the fifteen-class taxonomy with CWE anchors, refutation criteria, do-not-flag list, typed citations, the closed assertion vocabularies, the human-driven standalone sequence; fixtures and the frozen eval harness. |
| `security-engagement` | Prose for the lead: engagement record, stand-down check, assess → plan → review → verify workflow, sign-off checklist, tracker rules (two dedupe layers), disclosure profiles. No scripts of its own. |
| `threat-modeling` | Prose for the threat-modeler: code-derived DFD with a citation per element, STRIDE per element, mitigations as claims, one disposition per threat; `tm-lint.mjs check \| render` lives in `security-evidence`. |
| `security-test-planning` | Prose for the lead and the threat-modeler: passive security cases in the manual-qa format, the passive-admission grammar (admitted by lint or by review, unknown effects ⇒ proposal), proposals for active work outside `tasks/`; `plan.mjs admit \| propose \| ta-prompt` lives in `security-evidence`. |
| `risk-register` | Prose for the lead: register rows for findings and threats, unauthenticated acceptances and revocations, false-positive closes, supersession, the anchor a consumer can verify, the rendered `risk-register.md` view; `register.mjs` lives in `security-evidence`. |

## How a review flows

```
engagement init  → knowledge templates, engagement.md, managed .gitignore block, HMAC key, baseline
run init         → allocates <run_id>; assessment runs require a clean tree at head (review runs may be dirty: redacted snapshots)
scope            → the admitted files and ranges, identity independent of envelope
packet --kind scope   → what the reviewer may read (`review` contract → claims + examined declaration)
gate --claims    → every citation re-checked byte for byte; ids derived; keyed when the content matches a redaction rule
coverage --examined   → every scoped range accounted for exactly once (examined | unexamined | scanner-only)
packet --kind subject → one gated finding for a fresh `vulnerability-review` dispatch → receipt validate | apply
build-report     → report.md + manifest.json + COMMITTED, last
check            → recomputes every derived value from the recorded inputs, byte-compares the report
verify.mjs all   → fix verification in an OS temp worktree: tests from a validated test-start snapshot, suppression indicators, fix-review packet → VERDICT
tm-lint.mjs check|render → the threat-modeler's model validated and snapshotted into the run with its dispositions index (assessment runs)
plan.mjs admit|propose|ta-prompt → passive cases admitted by lint or by review; active work as a proposal outside tasks/; the test-automation prompt
register.mjs     → residual-risk register: append-only log, replayed projection, anchor, unauthenticated approvals, `ticketed` from the tracker read-back
sign-off         → walks the ledger, checks every COMMITTED run, applies the disposition policy, lists changes since baseline and unadmitted suite files
publish --profile → the only path out of .agents/security-testing/: redacted-report | full-report | tracker payload | case (the admitted suite) | handoff (the manual-qa prompt)
```

Consumer state lives under `.agents/security-testing/` (a managed
`.gitignore` block keeps runs, ledger, receipts, register, keys, snapshots
and hand-offs local by default; `engagement.md` and `risk-register.md` sit
outside the block); reports under `reports/security/`; admitted cases under
`tasks/security-<slug>-admitted/`.

## Guarantees

Each row is a promise from spec §2 with the script that enforces it.
`enforced by: script` rows hold **for runs carrying a `COMMITTED` marker
produced by the canonical pipeline** — the scripts in `security-evidence`,
run in the order above. A set authored by hand, or a run without the marker,
is outside every script row (see [Not guaranteed](#not-guaranteed)).
`enforced by: prose` rows are agent instructions the scripts do not verify.

| Guarantee | enforced by: script \| prose | Qualification |
|---|---|---|
| **Consistency and re-derivation.** `check` recomputes from the recorded inputs every derived value the report displays (§6.3 derivation table) and byte-compares the rendered report; `CONSISTENT`, `CONSISTENT-REDACTED-ONLY(n citations)`, `STRUCTURE-ONLY` (key unavailable) or `INCONSISTENT(<field>)`, naming the first field that differs. | script — `evidence.mjs check`, `lib/render.mjs`, `lib/inputs.mjs` | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; origin is never asserted (`ORIGIN: unauthenticated` unless a consumer-held digest is supplied) |
| **Integrity against the recorded snapshot and drift against the current tree**, at citation and scope level: every citation is re-read at its recorded `base_oid` / `head_oid`; `side: snapshot` citations (dirty files in `review` runs only) revalidate against the original only while the working file still matches the recorded HMAC, else `CONSISTENT-REDACTED-ONLY`; drift prints `CURRENT`, `CITATION-DRIFTED(n)` or `SCOPE-DRIFTED(n files)`. | script — `evidence.mjs check --integrity --drift`, `lib/cite.mjs` | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; assessment runs cite a clean tree at `head_oid` (`3 DIRTY-TREE` otherwise) |
| **Tests execute from a validated test-start snapshot.** `verify.mjs all` checks out the fix's `head` in an OS temp worktree, installs dependencies, compares the tree to `head_oid` after installation, fails the run on tracked changes unless the operator record allows them (then the verdict names the derived `tested_tree`, not `head_oid`), and runs only the argv from `engagement.md`. The verdict is script-emitted: `VERDICT <token> finding=… base=… head=… tested_tree=… verify=…`. | script — `verify.mjs all`, `lib/verify-steps.mjs`, `lib/evaluate.mjs` | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; `VERIFIED` requires an applied `not-refound` fix-review receipt, and a suppression indicator without an `ack` keeps the verdict `UNVERIFIED-SUPPRESSION` |
| **Bounded redaction before any persistence, including under `private/`.** No artifact this bundle writes contains original bytes that match a redaction rule; reconstruction needs are met with redacted bytes plus keyed HMACs of the originals (read → HMAC → redact → persist). **No publishable artifact carries a plain hash whose preimage contains protected content**: identity is keyed with the engagement key whenever the cited content matches a rule, regardless of finding class. The guarantee is bounded to the rule list in `references/redaction-rules.json` (versioned; every record names the `redaction_version` it used). | script — `redact.mjs` through `canon.writeArtifact`, `lib/imports.mjs`, `evidence.mjs gate` (keyed ids) | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; bounded to the rule list — secrets outside it are not detected |
| **Only admitted cases are written to the hand-off suite**, `tasks/security-<slug>-admitted/`, a directory that contains nothing else. Admission is by effect (`admitted-heuristic` by lint, `admitted-reviewed` by a `confirmed` vulnerability-review receipt); unknown effects become proposals outside `tasks/`. `publish --profile case` writes only files with an `admitted-*` record and records each file's identity in its export manifest; `sign-off` compares every file in the suite against the identities `publish --profile case` recorded and lists anything else — placed there by hand, or edited since — as `UNADMITTED: <n>` with one path per line. | script — `plan.mjs admit`, `evidence.mjs publish --profile case`, `evidence.mjs sign-off` | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; "admitted by lint or by review", never "safe" |
| **Every approval-like record is stored and reported as unauthenticated.** `accept`, `revoke` and `close-false-positive` store `{recorded_by, approved_by, approval_ref, authenticated: false}`; there is no `confirm` verb, no confirmed state, and no approval reduces open exposure in `status`. | script — `register.mjs accept \| revoke \| close-false-positive`, `lib/register-transitions.mjs`, `lib/schema.mjs` (grep-guarded) | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; the register chain is replayed and anchored (`anchor verify` → `MATCH \| TRUNCATED \| DIVERGED`) |
| **Per-path observation of working-tree changes** between `engagement init` and `sign-off` for tracked files and non-ignored untracked files under `scope_paths ∪ product_paths`; the count of ignored files under those paths is recorded so the excluded coverage is visible. | script — `evidence.mjs engagement init` / `engagement baseline` (`lib/baseline.mjs`), `evidence.mjs sign-off` (per-path listing) | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; observation only — no attribution of a change to a role, no view of git-ignored files |
| **Tracker publication, first dedupe layer.** `publish --profile tracker` writes a validated, redacted payload per finding (`handoffs/<finding_id>.ticket.json`) and dedupes against the register and prior imports; `ingest tracker-readback` records the tracker's response and emits `ticketed`. The scripts have no tracker access. | script — `evidence.mjs publish --profile tracker`, `evidence.mjs ingest tracker-readback` | for runs carrying a `COMMITTED` marker produced by the canonical pipeline; dedupe has **two layers** — the script's, against the register and imports, and the lead's search of the live tracker by fingerprint through the `issue-tracking` skill before posting — and **only the first layer is promised** |
| **Read-only roles.** Agents never merge, close, rotate or fix; they write only under `.agents/security-testing/**`, `.agents/memory/<role>/**`, `reports/security/**`, `tasks/security-*/**` and never touch product code, credential files or `.gitignore` outside the managed block. | prose — `AGENT.md` rules, `instructions.md`; observed after the fact by the per-path baseline listing at `sign-off` | not enforced by any script; the baseline listing shows *that* a path changed, never *who* changed it |
| **Fresh dispatch per contract.** `vulnerability-review`, `mitigation-review` and `fix-review` are never performed by the instance that authored the claim; a reviewer whose context holds the claim refuses (`REFUSED fresh-dispatch`). | prose — `security-reviewer/AGENT.md`, `secure-code-review/SKILL.md` | not enforced by any script; the receipt records `reviewer_run_id`, not the dispatching context |
| **External text proposes; only scope- and target-validated references act.** Ticket bodies, PR descriptions, scanner messages, comments and notes addressed to reviewers are inert until `ingest <kind>` validates them against `scope.json` and `engagement.md` `targets`. Test argv comes only from the operator record. | prose — the four rules in `instructions.md`; the validation half is script (`evidence.mjs ingest`, `lib/cmd-scope.mjs`) | the ingest validation is a script step on canonical-pipeline inputs; that a model *obeyed* the rule while reading is not verifiable |

## Not guaranteed

Every item is the right-hand column of spec §2 or the list in §8.

- **Origin.** A consistent set can be authored by anyone with write access.
  `check` prints `ORIGIN: unauthenticated` unless a consumer-held digest is
  supplied; artifacts are consistent, not provenanced.
- **Model reading.** That a model read what it declared examined. The
  examined declaration is the reviewer's word and the report shows it as
  such; the original bytes of a dirty file are unavailable after it changes.
- **Human approval.** That any human approved anything. Every approval-like
  record carries `authenticated: false`; there is no confirmed state.
- **Secrets outside the rule list.** Redaction is bounded to
  `redaction-rules.json`; detection of secrets outside it is not promised.
- **Semantic suppression.** Suppression detection beyond lexical indicators
  (`ignore-file-edit`, `inline-suppress`, `test-skip`); a class closed at the
  sink is not inferred from `VERIFIED`.
- **Test meaningfulness.** That the project's tests test the fix; only that
  they ran from a validated test-start snapshot with the recorded argv.
- **Direct-run refusal by QA runners.** That a QA runner refuses a case
  handed to it directly; the suite directory, not the runner, is what makes
  "only admitted cases" true.
- **Threat completeness.** The threat model is code-derived and cited, not
  complete; there is no completeness measure in v1.
- **Host-preloaded instruction files and direct agent reads** as injection
  surfaces: what a host injects before dispatch, and what an agent reads
  outside its packet, are outside the bundle's control.
- **Attribution of tree changes.** The per-path baseline listing shows that
  a path changed, never which role changed it; changes to git-ignored files
  are not observed (their count is).
- **Encryption of local artifacts.** Everything under
  `.agents/security-testing/` is local by default and unencrypted; keys are
  files with mode `0600`.
- **The core context hooks installed by the installer** are outside this
  bundle's control; the bundle declares no hooks of its own (D4).

**Active testing is out of scope in v1.** Nothing here executes an attack;
active work is a proposal outside `tasks/`, and the hand-off suite carries
only admitted passive cases.

## Standalone review, human-driven

The two-skill install (`--skills
security-testing/secure-code-review,security-testing/security-evidence`) has
no `security-reviewer` agent and no lead: **the human runs the commands and
the active session performs the review steps itself**, reading the
`secure-code-review` skill. The sequence below is the one that skill's
"Standalone review, human-driven" section spells out, repeated here so the
front door and the skill never disagree. `<scripts>` is
`<skills dir>/security-evidence/scripts` (on Claude Code
`.claude/skills/security-evidence/scripts`); `<st>` is
`.agents/security-testing`. Run everything from the repository root.

1. `node <scripts>/evidence.mjs engagement init` — on a bare repository the
   first run writes `<st>/knowledge/` and `<st>/engagement.md` from the
   templates and exits `2 EDIT-ENGAGEMENT-AND-RERUN`. Edit the
   `json engagement` block (at least `engagement_id`, `slug`, `scope_paths`,
   `product_paths`), then run `node <scripts>/evidence.mjs engagement init`
   again: it writes the managed `.gitignore` block, mints the key and takes
   the baseline (`TEMPLATES:`, `ENGAGEMENT: present`, `IGNORE-BLOCK:`,
   `KEY:`, `BASELINE:`).
2. `node <scripts>/evidence.mjs run init --kind review --base <ref>` — a
   review run over `<ref>..HEAD`; a dirty tree is allowed (dirty in-scope
   files are snapshotted redacted). Note the `RUN <run_id> …` line.
3. `node <scripts>/evidence.mjs scope --run <run_id>` — enumerates the
   tracked files under `scope_paths` into `<run>/scope.json`.
4. `node <scripts>/evidence.mjs packet --run <run_id> --kind scope` —
   prints `PACKET <path> sha256=<packet_sha256> kind=scope files=<n>`.
5. **You perform the `review` contract** over that packet (the
   `secure-code-review` loop, reading each file at its recorded side) and
   write `claims-1.json` and `examined-1.json` into `<st>/receipts/<run_id>/`,
   both naming `<packet_sha256>` and the claims file also naming
   `scope_sha256` from `<run>/scope.json`.
6. `node <scripts>/evidence.mjs gate --run <run_id> --claims <st>/receipts/<run_id>/claims-1.json`
   — `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>`;
   read `<run>/rejects.json` for anything rejected and fix the citation in
   a new run if it was yours (nothing inside a run is rewritten).
7. `node <scripts>/evidence.mjs coverage --run <run_id> --examined <st>/receipts/<run_id>/examined-1.json`
   — `COVERAGE examined=<n> skipped=<n> scanner=<n>`.
8. Optional, per finding you want independently reviewed:
   `node <scripts>/evidence.mjs packet --run <run_id> --kind subject --subject <finding id>`,
   then a **fresh session** (a new conversation, not the one that wrote the
   claim) performs `vulnerability-review` over that packet and writes the
   receipt payload under `<st>/receipts/<run_id>/`.
9. `node <scripts>/evidence.mjs receipt validate --run <run_id> <st>/receipts/<run_id>/<receipt>.json`
   for each receipt — `RECEIPT admitted sha256=<h> type=<t> subject=<id>`.
10. `node <scripts>/evidence.mjs build-report --run <run_id> --template review`
    — renders `<run>/report.md`, writes `manifest.json` and the `COMMITTED`
    marker last. Findings without a receipt show as "not independently
    reviewed".
11. `node <scripts>/evidence.mjs check <st>/runs/<run_id> --integrity --drift`
    — `CONSISTENT` (or `CONSISTENT-REDACTED-ONLY(n citations)` when a dirty
    file has changed since), then `CURRENT` or `CITATION-DRIFTED(n)`, then
    `ORIGIN: unauthenticated`, `KEY: available`.
12. For a fix: `node <scripts>/verify.mjs all --finding <id> --base <oid> --head <oid>`
    — pass 1 prints the fix-review `PACKET <path>` and `NEXT: dispatch
    security-reviewer fix-review`; a **fresh session** performs `fix-review`
    over that packet and writes the receipt(s) into a drop-box directory, then
    `node <scripts>/verify.mjs all --finding <id> --base <oid> --head <oid> --receipts <that directory>`
    is pass 2 — a fresh verify run that admits the receipts — and prints the
    `VERDICT` line.
13. `node <scripts>/evidence.mjs sign-off --engagement <engagement_id>` —
    **exits `4 NO-ASSESSMENT` by design** (spec D12): a review path never
    produces an assessment run, and sign-off requires one. The review run,
    its report and `check` are the deliverable of the standalone shape; the
    threat-model and planning commands need the full bundle.

A report rendered by `build-report` is gated by construction: every finding
it shows went through `gate`, and `check` can recompute it.

## Hand-offs

- **manual-qa**: admitted cases are written by `publish --profile case` to a
  dedicated suite `tasks/security-<slug>-admitted/` in manual-qa's `TC-*.md`
  format (priority map p0 → critical … p3 → low; header/cookie checks via
  the audit branch). The prompt to `test-run-lead` is printed by
  `publish --profile handoff`; results return through `ingest qa-run` as
  observations (`OBSERVATION <O-id> case=<id> result=…`, one per result row
  whose case has an admitted record). Mitigation decisions are separate
  `mitigation-review` receipts citing observations.
- **test-automation**: `plan.mjs ta-prompt` prints the prompt with the
  admitted cases, `slug` and `base` from the published suite; `ingest
  ta-report` records per unit outcome, coverage, exclusions and findings;
  `delivered` without a gate receipt is recorded as `delivered-unwitnessed`.
  Both QA bundles carry a receiving-side `docs/execution-authorization.md`
  note.
- **Tracker.** `publish --profile tracker` produces the validated, redacted
  payload file; the lead posts it through the `issue-tracking` skill after
  searching the live tracker by fingerprint, then `ingest tracker-readback`
  writes the `ticket_url` onto the register row (event `ticketed`). Two
  layers; the bundle promises the first.
- **Fixes.** Never applied here. A finding routes to the developer with its
  id; `verify.mjs all` verifies the fix from a validated test-start snapshot.

## Reading a report

`.agents/security-testing/knowledge/report-reading-guide.md` (seeded) walks
through every section: coverage is section 2 (empty scope ⇒
`INDETERMINATE`); every displayed value is in the §6.3 derivation table;
`unknown / not assessed` is allowed and blank is forbidden; the footer
carries `ORIGIN: unauthenticated` unless a consumer-held digest matched.

## Files

```
bundles/security-testing/
  factory.json  FACTORY.md  README.md  CHANGELOG.md  instructions.md
  agents/{security-lead,threat-modeler,security-reviewer}/{AGENT.md,SOUL.md,RULES.md,NOTES.md}
  briefings/{security-lead,threat-modeler,security-reviewer}.md
  knowledge/{engagement.md.template,finding-schema.md,report-reading-guide.md}   # seeded to .agents/security-testing/knowledge/
  skills/security-evidence/{SKILL.md, references/*.schema.json, references/{sarif-mapping.v1.json,redaction-rules.json,packet-policy.v1.json},
                            templates/{assessment,review,verify,threat-model}.md, templates/knowledge/,
                            scripts/{evidence,verify,register,tm-lint,plan,canon,normalize,redact}.mjs (+ *.test.mjs), scripts/lib/, scripts/fixtures/}
  skills/secure-code-review/{SKILL.md, references/, fixtures/, evals/, scripts/score-findings.mjs}
  skills/security-engagement/{SKILL.md, references/{workflow,sign-off-checklist,tracker-rules,disclosure-profiles}.md}
  skills/threat-modeling/{SKILL.md, references/}
  skills/security-test-planning/{SKILL.md, references/{passive-admission,audit-branch}.md}
  skills/risk-register/{SKILL.md, references/}
```

Every script is plain ESM Node, stdlib only, no shell scripts, no network;
every child process is `spawn`/`execFile` with an argv array and
`shell: false`. Nothing under `scripts/` reads or writes outside the
consumer's `.agents/security-testing/`, `reports/security/`,
`tasks/security-*/` and the managed `.gitignore` block, except
`verify.mjs all`'s OS temp worktree.

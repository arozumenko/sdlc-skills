# Lead workflow — engagement record, stand-down check, assess → plan → review → verify

`<scripts>` is `<skills dir>/security-evidence/scripts`; `<st>` is
`.agents/security-testing`; every command runs from the repository root.
Every result line below is spelled exactly as the script prints it; an exit
code before a token (`2 ENGAGEMENT-MISSING`) is the process exit code.

## The engagement record

`<st>/engagement.md` is the one record the scripts read: a Markdown file
with exactly one fenced block tagged `json engagement`, strict JSON,
validated against `engagement.schema.json` on every use. Everything
outside the block is yours — notes, links, people, rules of engagement.

1. `node <scripts>/evidence.mjs engagement init` on a repository that has
   no record: step 0 writes `<st>/knowledge/` (the field-by-field
   `engagement.md.template`, `finding-schema.md`,
   `report-reading-guide.md`) when the seeded copies are absent, writes
   `<st>/engagement.md` from the template, prints the per-file line
   `TEMPLATES: engagement.md.template=written finding-schema.md=written report-reading-guide.md=written`
   (each file `=written` or `=present` — `present` when the factory `seed`
   already placed it) and `ENGAGEMENT: template written — edit and re-run`,
   and exits
   `2 EDIT-ENGAGEMENT-AND-RERUN`. Nothing else happens on that run.
2. Edit the block. The template's example is deliberately valid, so an
   unedited file keys an engagement called `eng-2026-001` for a product
   called `my-product` — set at least `engagement_id`, `slug`,
   `scope_paths`, `product_paths` and `targets` (`tracker` hosts, `browser`
   hosts, `repo` as `owner/name`). Add `execute_project_tests.argv` only if
   you want `verify.mjs all` to run the project's tests: it is the **only**
   source of a test command, its authorship is unverified, so treat that
   edit like a CI change. `sign_off.require_dispositions` defaults to
   `executed-or-ticketed`; `artifact_policy` keeps every artifact local
   unless a key says `committed` (there is no `private` key — the keys,
   citation records, snapshots and baseline can never be un-ignored;
   `2 POLICY-INVALID(private)` if you try).
3. `node <scripts>/evidence.mjs engagement init` again: step 1 writes the
   managed block into the root `.gitignore` between
   `# security-testing:begin` and `# security-testing:end`; step 2 fails
   closed if git tracks or does not ignore anything under a managed path;
   step 3 mints the HMAC key; step 4 takes the baseline over
   `scope_paths ∪ product_paths`. Output:
   `TEMPLATES: engagement.md.template=present finding-schema.md=present report-reading-guide.md=present`,
   `ENGAGEMENT: present`, `IGNORE-BLOCK: written`, `KEY: <key_id> created`,
   `BASELINE: <n files> ignored=<n>`. Re-running is idempotent
   (`IGNORE-BLOCK: unchanged`, `KEY: <key_id> reused`); `--rotate` mints a
   new key and every later artifact records the `key_id` it used.
4. `node <scripts>/evidence.mjs engagement validate` whenever you resume:
   `IGNORE-BLOCK: ok|stale`, `TRACKED: none`, `KEY: available|unavailable`,
   `BASELINE: present|absent` — exit 4 on any bad line, nothing written.

Commit `engagement.md`, `risk-register.md`, `threat-model.json` and the
candidate cases under `<st>/cases/`
by your normal policy; they sit outside the managed block. Everything the
block covers stays local unless `artifact_policy` says otherwise.

## Stand-down check

Step zero of every phase. Each line is an observable predicate; when it
holds, stop, report the line to the human and do not improvise around it.

| If | Then |
|---|---|
| The ask is to merge, close, rotate a secret, apply a fix, or edit product code | stand down: outside the bundle's posture (standing rule 4). Route a fix to the developer with the finding id; a rotation to the secret's owner. |
| `engagement init` exits `2 EDIT-ENGAGEMENT-AND-RERUN` | the record does not exist yet; the human edits the block (or tells you the values) before anything else runs. |
| Any command exits `2 ENGAGEMENT-MISSING` or `2 ENGAGEMENT-INVALID(<reason>)` | no run starts; fix the block, re-run `engagement init`. |
| `engagement init` or `engagement validate` prints `4 TRACKED(<path>)` or `4 NOT-IGNORED(<path>)` | git tracks, or fails to ignore, a private destination; the human untracks it or adjusts `.gitignore` above the managed block. Never run a review while a managed path is tracked — a citation record would be committed. |
| `engagement validate` prints `KEY: unavailable` | no artifact can be keyed; only `engagement init` mints a key (`2 KEY: unavailable` from `run init` says the same). If the key was purged, the next `engagement init` creates a new one and every earlier artifact reads `STRUCTURE-ONLY`. |
| `run init --kind assessment` or `scope` exits `3 DIRTY-TREE` | the assessed paths (`scope_paths ∪ product_paths`, the bundle's own paths excluded) have uncommitted changes; an assessment cites a clean `head_oid`. Ask for a commit or a stash; or run a `review` instead, knowing dirty files become `side: snapshot` citations. |
| The scope the human names is outside `scope_paths` | `scope --include <path-or-glob>` only narrows a run inside `scope_paths`; widening is an edit to `engagement.md` and a new baseline (`engagement baseline`). Never review paths the record does not name — a claim on them is `out-of-scope` at `gate`. |
| The ask names a tracker, browser host or repository not in `targets` | the tracker call, the QA report or the ticket URL would be inert; fix `targets` first. |

## Assess

An assessment is the engagement's deliverable: a `COMMITTED` assessment run
is what `sign-off` requires (`4 NO-ASSESSMENT` otherwise). It is the review
chain below run on a clean tree, plus the passive cases, the threat model
and every cross-run input snapshotted into the run directory before
`build-report` (P2). This is the canonical order; the lead's `assess`
contract (`AGENT.md`, Phases 1–6) spells every argv with its stdout line.

1. Commit what the run must see first: candidate cases live at
   `<st>/cases/<slug>/TC-NNN_<slug>.md` (never under `tasks/`) and the
   case packet binds the blob at `head_oid`. Then
   `node <scripts>/evidence.mjs run init --kind assessment [--base <ref>]`
   — `--base` defaults to head, `--head` must be `HEAD`; the tree under the
   assessed paths must be clean (`3 DIRTY-TREE`); prints `RUN <run_id>
   seq=<n> kind=assessment base=<oid> head=<oid>` and writes the empty
   `imports.json`, `observations.json`, `proposals-index.json` (the run's
   inputs are all inside the run directory, P2). Note the `run_id`. Then
   `node <scripts>/evidence.mjs scope --run <run_id> [--include <path-or-glob>]… [--max-bytes <n>]`
   — `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` (`snapshot=0`
   on an assessment).
2. Passive cases and every other input, **before `gate`** (it folds the
   unlocated candidates of every import into `<run>/unlocated.json`).
   Per candidate case:
   `node <scripts>/plan.mjs admit --run <run_id> <case> --dry-run` reads
   the hits without a record; then zero hits ⇒
   `node <scripts>/plan.mjs admit --run <run_id> <st>/cases/<slug>/TC-NNN_<slug>.md`;
   hits all `unknown-operation` ⇒ the review route —
   `node <scripts>/evidence.mjs packet --run <run_id> --kind subject --type case --subject <case>`,
   a **fresh** `security-reviewer` `vulnerability-review` over that case
   packet — a Markdown test case, not code, so `confirmed` means
   "confirmed passive" — `node <scripts>/evidence.mjs receipt validate --run <run_id> <receipt path>`,
   then `node <scripts>/plan.mjs admit --run <run_id> <case> --receipt <sha256>`;
   a forbidden hit ⇒ a proposal, never an admission. Each prints
   `ADMISSION case=<case_sha256> classification=<admitted-heuristic|admitted-reviewed|proposal> hits=<n>`
   (write-once: `2 ADMISSION-EXISTS` when the same case would get a
   different record — a changed route is a new run). Then
   `node <scripts>/evidence.mjs ingest case <candidate> --run <run_id>`
   per admitted candidate — the `case_id ↔ case_sha256` join a later
   observation resolves through; the results of an earlier hand-off,
   `node <scripts>/evidence.mjs ingest qa-run <report> --run <run_id>`
   (`IMPORT qa-run …`, then `OBSERVATION <id> case=<c> result=<r>` per row
   that resolved to an admitted case of this run) or
   `node <scripts>/evidence.mjs ingest ta-report <report> --run <run_id>`
   (`TA-UNITS <run>/ta-units/<sha>.json units=<n> sha256=<h>`); and
   everything else that reached you as text,
   `node <scripts>/evidence.mjs ingest sarif|ticket|pr|doc|audit <file> --run <run_id>`.
3. Run the **Review** chain below on this run (`packet --kind scope` →
   dispatch → `gate` → `coverage` → subject packets → fresh
   `vulnerability-review` dispatches → `receipt validate` → `receipt apply`).
4. The register and the cross-run inputs. A row per accepted finding you
   track, `node <scripts>/register.mjs add --subject <finding_id> --priority p0|p1|p2|p3 --title <t> --run <run_id>`
   then `node <scripts>/register.mjs render`; a proposal per piece of
   active work, `node <scripts>/plan.mjs propose --run <run_id> <path>`
   (`PROPOSAL <st>/proposals/<id>.proposal.md id=<P-nnn> sha256=<h>`). Then
   `node <scripts>/evidence.mjs run snapshot verify --run <run_id> --from <verify_run_id>`
   per verify run you want the report to carry (`SNAPSHOT verify from=<id>
   sha256=<h>`; `3 INCOMPLETE(verify:<id>)` if that run is not COMMITTED),
   `node <scripts>/evidence.mjs run snapshot register --run <run_id>`
   after the last register mutation of this run
   (`SNAPSHOT register events=<n> chain=<sha>`; write-once,
   `2 SNAPSHOT-EXISTS` — an `accepted(R-nnnn)` disposition validates only
   from it), and
   `node <scripts>/evidence.mjs run snapshot proposals --run <run_id>`
   (`SNAPSHOT proposals n=<n>`; a `planned(P-nnn)` disposition validates
   only from it). A snapshot into a COMMITTED run is refused
   (`RUN-COMMITTED`).
5. The threat model. Dispatch `threat-modeler` (`threat-model` contract)
   with the refs the evidence above supports — row ids in the snapshot,
   proposal ids in the index, admitted `case_sha256`s, observation ids,
   ticket URLs read back into this run; without a ref a threat is
   `undisposed`, which is honest. It writes `<st>/threat-model.json`
   (code-derived elements with one citation each, STRIDE threats,
   mitigation claims, dispositions) and runs
   `node <scripts>/tm-lint.mjs check --run <run_id>` itself: the model is
   snapshotted into `<run>/threat-model.json` **before** the dispositions
   are validated, and `<run>/dispositions.json` is written on exit 0
   (`TM elements=<n> threats=<n> undisposed=<n>` + two `WROTE` lines).
   Both files are required assessment inputs — `build-report` is
   `3 INCOMPLETE(threat-model)` / `3 INCOMPLETE(dispositions)` without
   them. Per mitigation the modeler named:
   `node <scripts>/evidence.mjs packet --run <run_id> --kind subject --subject M-nnn`
   → a **fresh** `security-reviewer` `mitigation-review` →
   `node <scripts>/evidence.mjs receipt validate --run <run_id> <receipt path>`
   → `node <scripts>/tm-lint.mjs check --run <run_id>` again, same run,
   same model (the `mitigated` sequence is the lead's step 19; a
   disposition **changed** after the snapshot is `2 SNAPSHOT-EXISTS` and
   a new run).
6. `node <scripts>/evidence.mjs build-report --run <run_id> --template assessment`
   — `REPORT <path>`, `MANIFEST sha256=<h>`, `COMMITTED` last;
   `3 INCOMPLETE(<input>)` names the missing input and writes nothing.
7. `node <scripts>/evidence.mjs check <st>/runs/<run_id> --integrity --drift`
   before you show the report to anyone — see the sign-off checklist.

## Plan

Deciding what each threat and finding becomes: a passive test, a proposal
for active work, a ticket or a register row. The planning commands are
`plan.mjs` (`admit`, `propose`, `ta-prompt`) and the `case` / `handoff`
profiles of `publish`; the lead's `assess` contract (Phase 2 for
admission, step 24 for the hand-off) holds every argv and stdout line, and
the `security-test-planning` skill holds the case format and the passive
rules. A plan is:

- a passive case, admitted (Assess step 2):
  `node <scripts>/plan.mjs admit --run <run_id> <st>/cases/<slug>/TC-NNN_<slug>.md`
  — the heuristic route on zero hits, the review route (a case packet, a
  fresh `vulnerability-review`, `--receipt <sha256>`) on
  `unknown-operation` hits only — then
  `node <scripts>/evidence.mjs ingest case <candidate> --run <run_id>` so
  a later QA result resolves to it; a `planned(<case_sha256>)` disposition
  validates from the admission record;
- active work, proposed: a ````json proposal```` block anywhere under
  `<st>/` (never under `tasks/`), then
  `node <scripts>/plan.mjs propose --run <run_id> <path>` →
  `PROPOSAL <st>/proposals/<id>.proposal.md id=<P-nnn> sha256=<h>`;
  `authorization.status` stays `proposed` and `authenticated: false` — a
  human decides outside this bundle; `run snapshot proposals` puts it in
  the index a `planned(P-nnn)` disposition validates from;
- a register row per finding you intend to track:
  `node <scripts>/register.mjs add --subject <finding_id> --priority p0|p1|p2|p3 --title <t> --run <run_id> [--owner <o>]`
  prints `ROW <R-id> status=open priority=<p> seq=<n>`; `node <scripts>/register.mjs render`
  rewrites `<st>/risk-register.md` (your context document; run it after
  every register change — the file showing as modified is expected);
- a ticket per finding the developers should fix now — the tracker rules;
- an acceptance for a risk the product owner carries:
  `node <scripts>/register.mjs accept <R-id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>`
  — a record with `authenticated: false`; it lapses at 00:00 UTC of the day
  after `until` (`register.mjs check` flips it back to `open`);
- the hand-off suite, from a `COMMITTED` run only:
  `node <scripts>/evidence.mjs publish --run <run_id> --profile case --to tasks/security-<slug>-admitted`
  writes one file per `admitted-*` record of the run
  (`PUBLISHED profile=case output=./tasks/security-<slug>-admitted/TC-NNN_<slug>.md sha256=<h>`
  each — the suite is written by nothing else); then
  `node <scripts>/evidence.mjs publish --run <run_id> --profile handoff --to <st>/handoffs [--base-url <url>]`
  prints the manual-qa prompt, or
  `node <scripts>/plan.mjs ta-prompt --run <run_id> --slug <slug> --base <branch>`
  the test-automation one. Print the prompt, stop; what comes back enters
  the **next** run through `ingest qa-run` / `ingest ta-report`.

Nothing in a plan changes a state: a row is `open` until a verdict says
otherwise, and a threat is disposed only by a relationship a script
validates.

## Review

The P1 order. The reviewer produces claims over a **scope packet** before
any id exists; the scripts derive the ids; a **fresh** reviewer confirms or
refutes over a **subject packet**. A `review`-kind run may start on a dirty
tree (dirty in-scope files are snapshotted redacted under `private/`); an
assessment run may not.

1. `node <scripts>/evidence.mjs run init --kind review --base <ref> [--head <ref>]`
   — the diff `base..head`; `RUN <run_id> …`.
2. `node <scripts>/evidence.mjs scope --run <run_id> [--include <path-or-glob>]… [--max-bytes <n>]`
   — the tracked files under `scope_paths` into `<run>/scope.json`;
   `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` (`skipped` are
   files over the byte cap or not text — they show as skipped coverage;
   `snapshot` are dirty files stored redacted). Empty scope is allowed and
   makes coverage `INDETERMINATE`, which blocks sign-off.
3. Scanner input, if any, after `scope` and before `gate`:
   `node <scripts>/evidence.mjs ingest sarif <file> --run <run_id>` —
   `IMPORT sarif import_sha256=<h> records=<n> unlocated=<n> rejected=<n>`.
   Run scanners from the repository root so each result `uri` is
   repo-relative (an absolute `file:///…` URI is unlocated, never matched
   against a machine path), and run them on a clean tree, or expect
   shifted regions in review runs after a redacted multi-line secret (a
   dirty file is snapshotted redacted, and redaction can change its line
   count). A scanner record is a candidate: only a claim a reviewer makes
   over the packet becomes a finding.
4. `node <scripts>/evidence.mjs packet --run <run_id> --kind scope` —
   `PACKET <path> sha256=<packet_sha256> kind=scope files=<n>`. This is the
   reviewer's whole input.
5. Now dispatch `security-reviewer` with the `review` contract, giving it
   the packet path. It returns `CLAIMS <claims path> EXAMINED <examined path>
   findings=<n> read=<n files>`; both files are payload-only JSON in the
   drop-box `<st>/receipts/<run_id>/`, naming the packet. It writes no
   receipt and no id. Several reviewers over the same packet are fine;
   pass every claims file to `gate`.
6. `node <scripts>/evidence.mjs gate --run <run_id> --claims <claims path>…`
   — `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>` and
   the four `WROTE` lines (`findings.claimed.json`, `gate-result.json`,
   `rejects.json`, `unlocated.json`). Every accepted finding now has its
   id — keyed with the engagement key when the cited bytes match a
   redaction rule, plain sha256 otherwise (D16) — and its citation state.
   `2 CLAIMS-PACKET-MISMATCH(<file>)` means the claims file names a packet
   that is not this run's scope packet. A run has one gate; a second claim
   set is a new run.
7. `node <scripts>/evidence.mjs coverage --run <run_id> --examined <examined path> [--scanner-rows <file>]`
   — `COVERAGE examined=<n> skipped=<n> scanner=<n>`, or
   `COVERAGE INDETERMINATE` on an empty scope. `--scanner-rows` is a
   payload-only file you write, `{rows: [{import_sha256, paths?}]}`, each
   row naming a `sarif` import of this run; a path outside scope accounts
   for nothing. A declared range outside the packet is
   `2 SCHEMA-INVALID(examined: …)`; overlapping declarations are
   `4 OVERLAP(<path>:<a-b>)` — both are the reviewer's to correct in a new
   run.
8. Per accepted finding you want independently reviewed (every `p0`/`p1`
   at least):
   `node <scripts>/evidence.mjs packet --run <run_id> --kind subject --subject <finding_id>… [--type vulnerability-review]`
   — `PACKET … kind=subject files=<n>`.
9. A **fresh** dispatch of `security-reviewer` — never the instance that
   authored the claim — with the `vulnerability-review` contract over the
   subject packet. It returns `RECEIPT <path> type=vulnerability-review
   subject=<id> assertion=confirmed|refuted|indeterminate`.
10. `node <scripts>/evidence.mjs receipt validate --run <run_id> <receipt path>`
    per receipt — `RECEIPT admitted sha256=<h> type=<t> subject=<id>`, or
    `4 REJECTED(<reason>)` (wrong packet, oid mismatch, a forbidden `id` /
    `state` field, a reviewer run that is not this run). Then
    `node <scripts>/evidence.mjs receipt apply --run <run_id>` shows the
    derived states (`REVIEW_CONFIRMED`, `REVIEW_REFUTED`,
    `REVIEW_INDETERMINATE`; two receipts with different assertions on one
    subject in one run derive `*_INDETERMINATE`).
11. `node <scripts>/evidence.mjs build-report --run <run_id> --template review`
    — `REPORT <path>`, `MANIFEST sha256=<h>`, `COMMITTED`. `3
    INCOMPLETE(<input>)` names the missing input; nothing is written.
12. `node <scripts>/evidence.mjs check <st>/runs/<run_id> --integrity --drift`
    — first line `CONSISTENT` | `CONSISTENT-REDACTED-ONLY(n citations)` |
    `INCONSISTENT(<field>)` | `STRUCTURE-ONLY`; then `CURRENT` |
    `CITATION-DRIFTED(n)` | `SCOPE-DRIFTED(n files)`; then
    `ORIGIN: unauthenticated` (or `ORIGIN: matches supplied digest` with
    `--trusted-digest`); then `KEY: available|unavailable`. Exit 5 on
    `INCONSISTENT`; drift never changes the exit code. Run it before the
    report leaves the repository and again at sign-off.

Anything else that reaches you as text — a ticket, a PR, a document, a QA
run report, an audit, a test-automation report, a passive case — enters
the same run through `node <scripts>/evidence.mjs ingest <kind> <file> --run <run_id>`
(`ticket | pr | doc | case | audit | qa-run | ta-report | tracker-readback`)
and is inert until validated: a URL on a host outside `targets` is text; a
path outside `scope.json` is `out-of-scope`.

## Verify

A fix is verified by `verify.mjs all`, never by reading the diff. It needs
the finding's gate run in the ledger (a `review` run is fine) and the
current key; a finding gate marked `unverifiable` is `2 UNKNOWN-FINDING`,
and a finding a fresh review refuted is refused with
`4 UNVERIFIED-REFUTED-FINDING` (no run allocated). The command is two-pass
(TL-6); each pass is its own verify-kind run and the main tree may be dirty.

1. Add the register row first if there is none —
   `node <scripts>/register.mjs add --subject <finding_id> --priority <p> --title <t> --run <run_id>`
   — or pass 2 prints `REGISTER: no row for finding` and still exits 0 with
   its verdict and no row change.
2. Pass 1: `node <scripts>/verify.mjs all --finding <id> --base <oid> --head <oid>`
   with `--base` the commit the finding was gated at and `--head` the fix
   commit. stdout carries the lines of the commands it runs in-process
   (`RUN`, `WROTE`, `REPORT`, `MANIFEST`, `COMMITTED`) between the step
   lines `BRANCH <token>`, `TREE-BEFORE <oid>`, `INSTALL <ran|skipped>
   tracked_changes=<n> untracked=<n> bytes=<n>`, `SUPPRESSION
   indicators=<n> deletion_only=<bool>`, `TESTS <token> exe=<path>
   sha256=<h>`, then `PACKET <path> sha256=<h> kind=subject files=<n>` and
   `NEXT: dispatch security-reviewer fix-review`; the last line is always
   the `VERDICT` line — on pass 1 `UNVERIFIED-INDETERMINATE(fix-review)`,
   because no receipt exists yet.
3. Dispatch a **fresh** `security-reviewer` with the `fix-review` contract
   over that packet (the cited file at head, base-numbered window). It
   returns `RECEIPT <path> type=fix-review subject=<id>
   assertion=not-refound|refound|indeterminate acks=<n>`; the receipt(s)
   and any `ack-<indicator_id>.json` land in a drop-box directory. An ack
   is the reviewer's word that a lexical suppression indicator (an ignore
   file edited, an inline `nosec`-style marker, a skipped test) is benign;
   `deletion_only` — the fix removed cited lines and added none — is never
   ackable.
4. Pass 2: `node <scripts>/verify.mjs all --finding <id> --base <oid> --head <oid> --receipts <dir>`
   — a fresh run that re-executes every step, admits the receipts
   (`RECEIPT admitted …` first), evaluates, and calls the register:
   `CONSUMED <verdict> row=<R-id> verify=<sha256>` then one `ROW …` per
   appended event, or `REGISTER: no row for finding`. Last line: `VERDICT <token> finding=<id> base=<oid>
   head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>`. `VERIFIED`
   needs `COMMITTED`, `TESTS_PASS`, no `deletion_only`, every indicator
   acked and an applied `not-refound`; anything less is one `UNVERIFIED-*`
   token naming the first failing rule, and `refound` on a `fixed` row is
   `REGRESSED`. The exit code is 0 whenever a verdict is emitted.
5. What the tests line means: `TESTS_PASS | TESTS_FAIL | NO_TEST_SURFACE |
   TESTS_INDETERMINATE(<reason>)`. `NO_TEST_SURFACE` means
   `execute_project_tests` is absent from `engagement.md`;
   `install-modified-tree` means the install step changed a tracked file
   and `install.allow_tracked_changes` is not `true`. A test process that exits 0 but leaves a grandchild holding stdout or stderr (a daemon) is recorded as `TESTS_INDETERMINATE(timeout)` with `exit_code: 0` — a passing suite reads as a timeout until that daemon is stopped in the project's test command.
6. A `TRANSITION-REJECTED(fixed: fixed)` printed by pass 2 is a `VERIFIED`
   on an already-fixed row: the command still exits 0 with its verdict; the
   register is yours to reconcile.
7. Snapshot the verify run into the next assessment (`run snapshot verify
   --from <verify_run_id>`) so the assessment report carries it.

## Report, sign off, close

- `sign-off --engagement <engagement_id>` after every assessment and before
  any statement to a stakeholder — the checklist reference walks every
  line.
- `node <scripts>/register.mjs anchor print` gives
  `<engagement_id>:<seq>:<chain_sha256>`; hand it to the consumer with the
  report so a later `sign-off --expect <anchor>` can prove the register was
  not truncated or rewritten (`TRUNCATED` / `DIVERGED` fail it).
- Publishing is only `publish --profile` (disclosure reference). A report
  file copied by hand out of `<st>/runs/` has no export manifest and
  cannot be re-checked.
- Closing an engagement: `node <scripts>/evidence.mjs purge --engagement <engagement_id>`
  prints one `PURGE <repo-relative path>` line per path it would delete
  and exits 2 with `USAGE(purge: --yes is required to delete; <n> path(s)
  listed above would be removed)`; show that plan to the human;
  `node <scripts>/evidence.mjs purge --engagement <engagement_id> --yes`
  deletes the engagement's runs, ledger entries, receipts, imports,
  citation records, snapshots, baseline and keys (`PURGED runs=<n>
  keys=<n> current-key=removed|kept`). It is safe to re-run after an
  interruption. `engagement.md`, `risk-register.md` and the register log
  are not purged — the consumer decides about those.

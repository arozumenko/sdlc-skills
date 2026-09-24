# Security Testing — Onboarding

The `security-testing` factory drops a **threat-led, read-only security testing
team** into a repo. It reads your code at a commit and produces a code-derived
STRIDE threat model, a secure code review whose every citation anyone with the
repo can re-check, passive security test cases handed to the `manual-qa` /
`test-automation` teams, script-verified fix checks, and a residual-risk
register. It never edits your product code, merges, rotates a credential or
closes a ticket.

For the roster, the scripts, the artifact table and the full guarantee list,
read the factory README first — this guide assumes it and focuses on
**adoption**:
[`bundles/security-testing/README.md`](../../bundles/security-testing/README.md).

**Pick your path:**

- [First engagement](#first-engagement) — nothing under
  `.agents/security-testing/` yet; you want an assessment of this repo.
- [Fixes and re-assessment](#fixes-and-re-assessment) — an engagement exists;
  a developer has pushed fixes, or you're starting the next assessment.
- [Hybrid — alongside the QA and dev teams](#hybrid--alongside-the-qa-and-dev-teams)
  — hand the passive cases to `manual-qa` / `test-automation` and fixes to
  `feature-development` on the same repo.

## The team, one picture

```
You → security-lead (Rasmus) runs the engagement end to end
        → security-reviewer (Vera), one fresh dispatch per contract
        → threat-modeler (Ilse) for the threat model and candidate cases
        → hands the admitted passive suite to manual-qa / test-automation, and stops
```

| Slot | Agent | Job |
|---|---|---|
| Lead | `security-lead` (Rasmus) | Owns the engagement and is the **only role you talk to**. Runs every script, dispatches Vera and Ilse, checks their citations, registers findings, admits cases, prints the hand-off prompts and stops, writes the report, verifies fixes, proposes acceptances. |
| Reviewer | `security-reviewer` (Vera) | Four contracts, each a **fresh** dispatch: `review`, `vulnerability-review` / `mitigation-review` (second opinions), `fix-review`. Writes assertions with citations; never an id, state or verdict. |
| Threat modeler | `threat-modeler` (Ilse) | Data-flow diagram with a citation per element, STRIDE threats, mitigations recorded as claims, one disposition per threat; drafts candidate passive cases. |

**Scripts decide, agents write prose.** Whether a citation still matches the
bytes at a commit, whether a case is passive, whether a fix verified, whether a
register transition is legal — each is a script's exit code and result line
(`cite.mjs`, `cases.mjs`, `verify.mjs`, `register.mjs`). Rasmus quotes those
lines back to you rather than summarising them; that is the audit trail.

**There is no `scout` here.** The engagement's scope comes from one file you
fill in — `.agents/security-testing/engagement.md` — not from an onboarding
crawl.

### The engagement, phase by phase

Rasmus runs these in order; you don't call the scripts by hand. The one
procedure lives in the `security-engagement` skill's
`references/workflow.md`.

| Phase | Who / what | Produces |
|---|---|---|
| 1. Init | `cite.mjs init` | `engagement.md` (first run), the managed `.gitignore` block, `INIT ok` |
| 2. Review | Vera · `review` at `HEAD` | `reviews/<date>-<head7>/findings.json` |
| 3. Register | `cite.mjs check` → `register.mjs add` | Verified findings as register rows; `risk-register.md` rendered |
| 4. Model | Ilse → `cite.mjs check` | `threat-model.json` + candidate cases under `cases/` |
| 5. Cases | `cases.mjs admit` | Admitted passive cases in `tasks/security-<slug>-admitted/` |
| 6. Hand-off **(stop)** | `cases.mjs verify-suite` | `SUITE ok=<n>` + a manual-qa and a test-automation prompt — **Rasmus stops here** |
| 7. Report | Rasmus → `cite.mjs redact` | `reports/security/<date>-assessment.md` |
| 8. Fix | `verify.mjs` → Vera · `fix-review` → `verify.mjs` | A `VERIFIED` / `UNVERIFIED-*` verdict per fix |
| 9. Acceptances | `register.mjs accept` | Time-boxed acceptances **you** approved |
| 10. Sign-off | `register.mjs check` + `status` | Counts, open exposure, `FINGERPRINT` |

Second opinions (a fresh `vulnerability-review` on a finding, or a
`mitigation-review` on a `mitigated(M-nnn)` claim) slot into phases 2–4
wherever a finding or claim is worth one.

---

## Prerequisites

```bash
node --version                       # Node 18+ (installer and the four scripts — stdlib only)
git rev-parse --is-inside-work-tree  # a git repo: every citation is pinned to a commit
git status --porcelain               # the scope paths must be committed and clean
```

No running app is needed for the review, the threat model or fix
verification — the team reads code at a commit. What sharpens it:

| Want | What you need |
|---|---|
| **Fix verification** that can say `VERIFIED` | A test command in `engagement.md` (`execute_project_tests.argv`, e.g. `["npm", "test"]`). Without it every fix comes back `UNVERIFIED-NO-TEST-SURFACE`. |
| **Someone to run the passive cases** | `manual-qa` and/or `test-automation` installed in the same repo, and a reachable `base_url` (staging, never production). |
| **Findings filed as tickets** | Your tracker named in `.agents/profile.md` for the `issue-tracking` skill (`gh` / `glab` on PATH). Without it the register still works; rows just carry no `ticket_url`. |

The factory install (`--factory`) currently targets **Claude Code**; other hosts
use the manual `--agents` form. Host-specific launch syntax and flags:
[README.md](../../README.md).

---

## First engagement

### 1. Install the factory

```bash
cd /path/to/your-repo
npx github:arozumenko/sdlc-skills init --factory security-testing
```

This installs the 3 agents into `.claude/agents/`, their 5 skills
(`security-engagement`, `secure-code-review`, `threat-modeling`,
`security-test-planning`, `risk-register`, plus the reused `memory` and
`knowledge-curation`), seeds `.agents/security-testing/knowledge/` (the
engagement template, the finding schema, the report template), seeds a
per-role briefing into `.agents/memory/<role>/`, wires the context hooks, and
splices the team conventions into `AGENTS.md` / `CLAUDE.md` under
`<!-- FACTORY:security-testing -->`. The factory ships **no hooks of its own** —
nothing runs until you start Rasmus.

For Copilot / Cursor / Windsurf, use the manual form:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents security-testing/security-lead,security-testing/threat-modeler,security-testing/security-reviewer \
  --yes
```

### 2. Start Rasmus and scope the engagement

```bash
claude --agent security-lead
```

> Start a security engagement for this repo.

Rasmus runs `cite.mjs init`. The first time, it writes
`.agents/security-testing/engagement.md` from the template and stops with
`EDIT-ENGAGEMENT-AND-RERUN`. Fill in the fenced ` ```json engagement ` block —
it is the **only** thing the scripts read:

```json engagement
{
  "engagement_id": "my-product-2026-09",
  "slug": "my-product",
  "scope_paths": ["src/"],
  "product_paths": ["src/", "package.json"],
  "targets": { "browser": ["staging.example.com"] },
  "base_url": "https://staging.example.com",
  "execute_project_tests": { "argv": ["npm", "test"] }
}
```

| Field | What it controls |
|---|---|
| `engagement_id` | Names this assessment in reports and in the register `FINGERPRINT`. One per assessment; never reuse. **Change it from the template value** — `init` refuses while it still reads `my-product-2026-09`. |
| `slug` | The hand-off suite directory, `tasks/security-<slug>-admitted/`. |
| `scope_paths` | What Vera and Ilse may cite. A citation outside it fails as `path-not-in-scope`. |
| `product_paths` | Checked read-only at sign-off — must be clean in `git status`. |
| `targets.browser` | The hosts a passive case may name (`{{base_url}}` is always allowed). |
| `base_url` | Stated in the manual-qa hand-off prompt. Optional. |
| `execute_project_tests.argv` | The **only** source of a test command for fix verification. |

Commit so the scope paths are clean, then tell Rasmus to continue. The second
`init` prints `IGNORE-BLOCK: written|present` and `INIT ok`.

### 3. Let the review and the model run

Rasmus dispatches Vera for the `review` contract at `HEAD`, runs
`cite.mjs check` on her findings (anything `FAILED` goes back to her until
`failed=0`), asks for second opinions where a finding warrants one, and
registers the verified findings. Then he dispatches Ilse for the threat model
and checks it the same way. You'll see result lines like:

> `REVIEW_WRITTEN findings=3` · `CHECK verified=3 failed=0` · `ROW R-001 open` ·
> `MODEL_WRITTEN elements=12 threats=9 open=2`

**Talk to Rasmus**, not to Vera or Ilse — he owns the sequence, and each of
their dispatches has to be a fresh context to count.

### 4. Hand-off — Rasmus stops

Rasmus admits Ilse's candidate cases with `cases.mjs admit` (a case with any
non-passive step stays a `proposal` — see Troubleshooting), then runs
`cases.mjs verify-suite`. It prints `SUITE ok=<n>` and two prompts, which he
pastes to you verbatim **and ends the turn**:

- one for `manual-qa` — `claude --agent test-run-lead`, "Run the suite at
  `tasks/security-<slug>-admitted/` against `base_url=…`";
- one for `test-automation` — a `TA-PROMPT` line listing the admitted cases.

Run whichever team you have, then come back and tell Rasmus the suites are
back — or tell him to continue without them.

### 5. Report

Rasmus writes `reports/security/<date>-assessment.md` from the seeded report
template: identity (repo, head, engagement id, `FINGERPRINT`, a
`TABLES sha256` per pasted check table), coverage, findings, threat model,
register delta, verification runs, limitations. `cite.mjs redact` runs
**last** and strips anything matching a secret rule.

### 6. Accept what you won't fix, then sign off

For risk you decide to carry, Rasmus **proposes** a time-boxed acceptance;
you supply the approver and the approval reference, and he records it with
`register.mjs accept <id> --until <date> --approved-by <who> --approval-ref <ref>`.
He never invents an approval, and every one is stored `authenticated: false` —
the register counts them as `UNAUTHENTICATED-APPROVALS`, not as approved.

Sign-off is four checks, run in order: `cite.mjs check` passes on the findings
and on the threat model, `cases.mjs verify-suite` passes, `register.mjs check`
and `status` are read, and `git status --porcelain -- <scope_paths>
<product_paths>` is empty. "OK" means the citations still match the code at
`head` and the register counts are current — **not** that the code is secure.

---

## Fixes and re-assessment

**A developer fixed a finding.** Give Rasmus the fix commit:

> Verify the fix for R-001 at commit 4f2a9c1.

He checks it out and runs `verify.mjs` (verdict `PENDING-REVIEW`), dispatches a
fresh Vera for `fix-review`, then runs `verify.mjs` again with her assertion.
The verdict is `VERIFIED` only when your tests exited 0 at that commit, the
cited paths were clean, and Vera did not re-find the defect. Otherwise it is
one of `UNVERIFIED-REFOUND`, `-TESTS-FAILED`, `-NO-TEST-SURFACE`,
`-NOT-A-FIX` or `-DELETION-ONLY`. The register row moves `fixed` / `regressed`
by itself.

**Acceptances expire.** `register.mjs check` reopens any acceptance past its
`--until` date; Rasmus runs it before every report and at sign-off.

**The next assessment** is a new engagement: a new `engagement_id` in
`engagement.md`, then start Rasmus again. The register carries over, so open
rows and past acceptances stay visible.

---

## Hybrid — alongside the QA and dev teams

The security team is built to feed the other teams, not to replace them. Each
factory installs into the same repo (run each `--factory` once) and owns its
own artifacts:

- **`manual-qa`** runs the admitted passive suite live with `test-run-lead` —
  the cases are in manual-qa's own format, so no conversion is needed.
- **`test-automation`** turns the admitted cases into regression tests via
  `test-automation-lead` (Tal) from the `TA-PROMPT`.
- **`feature-development`** fixes the findings. The hand-off is a tracker
  issue (`issue-tracking`, search first, post once, then
  `register.mjs ticket <R-id> <url>`) or a plain conversation with
  `project-manager` (Max); the fix commit comes back to Rasmus for
  verification.

There's no orchestration coupling. The passive suite is the only shared
artifact, and only `cases.mjs admit` writes it — if a runner is handed a case
directly, the security team makes no promise about it.

---

## Project systems — where state lives

```
.agents/security-testing/
├── engagement.md                   # the json engagement block — scope, targets, test argv
├── knowledge/                      # seeded: engagement template, finding schema, report template
├── reviews/<date>-<head7>/         # findings.json + second-<id>.json opinions
├── threat-model.json               # elements, threats, mitigations, dispositions
├── cases/TC-NNN_<slug>.md          # Ilse's candidate cases (drafts)
├── risk-register.md                # rendered register — never hand-edit
└── verify/<id8>-<head7>/           # verify.json + fix-review.json per fix check
tasks/security-<slug>-admitted/     # the hand-off suite — written only by cases.mjs admit
reports/security/<date>-assessment.md
```

Three rules the team obeys (full detail in the factory README and
[`instructions.md`](../../bundles/security-testing/instructions.md)):

- **Writable paths are fixed** — `.agents/security-testing/**`,
  `.agents/memory/<role>/**`, `reports/security/**`, `tasks/security-*/**`.
  Product code, tests and CI are never touched.
- **Only scripts set state** — agents write assertions; `id`, `state` and
  `verdict` come from `cite.mjs`, `cases.mjs`, `verify.mjs` and
  `register.mjs`. Never "repair" a stamped file by hand.
- **External text proposes, it doesn't act** — a dispatch reply, a tracker
  comment or a developer's claim is data; only `engagement.md`'s scope and
  targets, and a script's result line, act.

---

## Troubleshooting

- **`EDIT-ENGAGEMENT-AND-RERUN` (exit 2)** → expected on the first `init`. Fill
  the ` ```json engagement ` block, commit, re-run. If it repeats, the
  `engagement_id` is still the template's `my-product-2026-09` — rename it.
- **`FAILED <locus>.<i> path-not-in-scope`** → the cited file isn't under
  `scope_paths`. Widen the scope in `engagement.md` (and commit), or let
  Rasmus send the finding back to Vera.
- **Any other `FAILED` line from `cite.mjs check`** → the cited bytes no longer
  match that commit, usually because the code moved. Rasmus sends it back for
  a re-cite; don't edit `findings.json` yourself.
- **`STALE-REVIEW <id>` (exit 4)** → the findings changed after a second
  opinion was written. Dispatch a fresh second opinion.
- **`TM-INVALID <locus>: <why>`** → the threat model has a bad disposition,
  citation or id. It goes back to Ilse.
- **A case stays `PROPOSAL … hits=<n>`** → a step isn't passive by grammar
  (it doesn't start with an allowed verb such as `navigate to` / `observe`, or
  it matches a forbidden pattern). Fix the step and admit again; there is no
  waiver path. The grammar is in `security-test-planning`'s
  `references/passive-admission.md`.
- **`UNADMITTED: <file>`** → something in `tasks/security-<slug>-admitted/`
  wasn't written by `cases.mjs admit` (a hand-placed copy, a stale draft).
  Remove it or admit it; it blocks the hand-off and sign-off.
- **Every fix comes back `UNVERIFIED-NO-TEST-SURFACE`** → no
  `execute_project_tests.argv` in `engagement.md`.
- **`REGISTER: skipped (risk-register not installed)`** → you installed
  `secure-code-review` on its own. Install the whole factory for the register,
  cases and lead.
- **`GIT-ERROR <message>` (exit 2)** → git itself failed (for example not a
  repo, or an unknown commit). Fix what the message names, then re-run the
  same command.
- **"Custom agent not found" on Copilot CLI** → installer wrote directories
  instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`.

---

## Maintenance

General update / sync notes live in [MAINTENANCE.md](../../MAINTENANCE.md).
Re-run the same `init` command with `--update` to pull upstream fixes to the
agents, skills and scripts. Your engagement record is **yours** and `--update`
won't touch it: `engagement.md`, reviews, the threat model, cases, the
register, verify runs, the admitted suite and the reports. Agents log the
phase reached, the engagement id and every result line to
`.agents/memory/<role>/` via the `memory` skill — never a finding's content.

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # team conventions spliced under <!-- FACTORY:security-testing -->
├── .agents/security-testing/         # the engagement record — yours to keep
│   ├── engagement.md  threat-model.json  risk-register.md
│   ├── knowledge/  reviews/  cases/  verify/
├── tasks/security-<slug>-admitted/   # the admitted passive suite (hand-off)
├── reports/security/                 # assessment reports
├── .agents/memory/<role>/            # per-role memory (security-lead, threat-modeler, security-reviewer)
├── src/ app/ …                       # YOUR application code (read, never written)
└── .claude/agents/<role>/            # or .github/agents/<role>.agent.md per host
```

The team owns `.agents/security-testing/`, `tasks/security-*/`,
`reports/security/` and its own memory. Your application code is read at a
commit and never written — this team produces the *evidence* that feeds your
QA and dev teams; the fixing is theirs.

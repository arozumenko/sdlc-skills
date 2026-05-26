# Scout survey — PR sampling + project-systems capture

Full procedure for the two pre-write phases scout runs before it
emits any content files: sampling the team's PR history to understand
*how they actually work*, and capturing the project-systems map
(tracker, TMS, KB, bug-filing style, automation PR policy).

Findings from both phases feed every subsequent step in
[SKILL.md](../SKILL.md): conventions, testing, architecture, workflow,
profile.

---

## Step 0.5 — PR-sampling survey

The goal isn't "last 20 PRs". It's **representative coverage across
different kinds of work** so scout sees both day-to-day test
authoring and the less-frequent framework / architecture changes.

### Detect the git host first

Git hosting isn't always GitHub. Before any PR listing, detect the
host from `git remote get-url origin`:

| Detected host | CLI of choice | List command |
|---|---|---|
| `github.com` / GitHub Enterprise | `gh` | `gh pr list --state merged --limit 200 --json number,title,author,labels,files,body` |
| `gitlab.com` / self-hosted GitLab | `glab` | `glab mr list --state merged --per-page 200` (MRs, not PRs) |
| Bitbucket Cloud / Server | `bb` (if installed) or REST API via curl | `bb pr list --state merged` / or Bitbucket REST |
| Azure DevOps | `az repos pr list` | `az repos pr list --status completed --top 200` |
| Gitea / Forgejo | `tea` | `tea pr list --state merged --limit 200` |
| Self-hosted / unknown | REST API via `curl` + read commits via `git log` | — |

If the host's CLI isn't installed, scout falls back to reading
`git log --merges --oneline -n 500` plus merge-commit bodies; the
classification still works, the review-thread signal is weaker.

Record the detected host (name + CLI + any special conventions) in
`.agents/workflow.md` § Git host so downstream agents can pick the
matching CLI when they open PRs / MRs.

### PR classification

Run the host-appropriate list command above and filter each PR/MR
into one of:

1. **Framework / infrastructure** — changes to fixtures, reporters,
   CI config, shared utils, page-object base classes, test runner
   config. Files touched live in `tests/fixtures/`, `tests/helpers/`,
   `tests/pages/base*`, `.github/workflows/`, etc.
2. **Test implementation** — net-new test files with no production-
   code changes. Only `tests/` (or `e2e/`, `cypress/e2e/`, etc.)
   touched.
3. **Bugfix + regression** — production-code fix bundled with a new
   test that exercises the bug. Files span app code + tests, PR
   description mentions a bug / incident / ticket.
4. **Feature + tests** — new functionality landing with its test
   coverage. Files span app code + tests, PR description mentions
   story / feature / epic.
5. **Review / process signal** — draw from PR review comments (not
   the PR body): what do reviewers consistently flag? approvals-
   required counts, typical review latency.

Skip: bot PRs (dependabot, renovate, release-please), pure docs
changes, auto-formatter commits, squash-noise.

### Sampling rules

2–3 PRs per category, max ~15 total. Prefer **illustrative over
recent**: a PR with real review discussion, clean history, and a
typical-size diff beats a two-line hotfix that happens to be the
newest merge. For each sampled PR, scout reads the description, the
diff, and the review thread.

If the repo has **no merged PRs** (brand-new project), scout writes
a stub `.agents/workflow.md` noting "no PR history to sample yet —
update after the first merged PRs" and moves on. Do not fail the
seed.

### Signals → destinations

| Signal | Destination |
|---|---|
| Roles (who authors feature tests vs regression vs framework work) | `.agents/workflow.md` § Team & roles |
| Review cadence (reviewer count, approval rules, typical comments) | `.agents/workflow.md` § Review gates |
| Branch & commit conventions (prefixes, ticket-linking, Conventional Commits) | `.agents/workflow.md` § Branching & commits |
| Do tests ship with feature PRs or separately? | `.agents/workflow.md` § Test delivery pattern |
| CI gates (required checks, labels, approvers) | `.agents/workflow.md` § CI gates + cross-ref in `.agents/testing.md` |
| Page-object / fixture extension patterns (from test-implementation PRs) | `.agents/testing.md` new § Test authoring patterns |
| Framework evolution (how / when infra PRs land, who leads) | `.agents/architecture.md` § Framework evolution |
| Code-level patterns seen repeatedly in PRs | `.agents/conventions.md` |

`.agents/workflow.md` is the **new** file this step produces. See
[templates.md](templates.md) § workflow.md for the full template.

### Report (end of Step 0.5)

```
Step 0.5 complete — PR sampling survey

Total merged PRs scanned: <N> (ignoring <M> bot/docs PRs)
Sampled <K> representative PRs across 5 categories:
  - Framework / infrastructure: #123, #145, #167
  - Test implementation:        #128, #130, #152
  - Bugfix + regression:         #118, #139
  - Feature + tests:             #126, #158, #161
  - Review / process:            (derived from comment patterns)

Key findings written to:
  - .agents/workflow.md  (new)
  - .agents/testing.md § Test authoring patterns
  - .agents/conventions.md
  - .agents/architecture.md § Framework evolution
```

---

## Step 0.7 — Project-systems capture

After PR sampling, scout resolves the **project-systems map** — which
issue tracker, TMS, KB the team uses, and where bugs found during
test-case-analysis should land. Repo contents hint at some of these
(a `.github/ISSUE_TEMPLATE/` folder = GitHub Issues, a CODEOWNERS
file, Jira references in READMEs), but most fields need the
operator's confirmation.

### Source of truth — operator's pre-fill or scout asks

The operator pre-fills answers in the onboarding prompt under a
`## Project systems` block (see the `TEST-AUTOMATION-ONBOARDING.md`
dispatcher at repo root for the template). Each field either has a
value or `ASK`:

- **If a value is provided**, scout uses it. No question.
- **If the field is `ASK`**, scout asks the operator interactively
  before writing `.agents/profile.md`. Scout asks each unknown field
  one at a time, in a short numbered list.
- **If scout is running non-interactively** (no stdin / batch mode)
  and the value is `ASK`, scout writes `Unconfirmed` and continues.
  The operator fills the gap later by editing `profile.md`.

### Fields scout captures

1. **Issue tracker** — `github-issues` / `jira` / `gitlab-issues` /
   `azure-boards` / `linear` / `none`. Plus a project / board key
   (e.g. `SCRUM`, `owner/repo`).
2. **Test Management System** — `zephyr-scale` / `testrail` / `xray` /
   `azure-test-plans` / `markdown` / `none`. Project key. (This also
   lives in `.agents/test-automation.yaml` for the pipeline;
   `profile.md` mirrors it for quick reference.)
3. **Knowledge base** — `confluence` / `notion` / `obsidian` /
   `github-wiki` / `readme-only` / `none`. Space / database name.
4. **Bug filing style** — where a defect discovered during
   `test-case-analysis` lands. A ticket is **always** filed (so
   nothing slips through tracking); these options only differ on
   *which tracker*:
   - `github-issue` *(default)* — open a standalone issue in the
     repo's tracker via `bugfix-workflow`
   - `story-subtask` — create a sub-task linked to the originating
     Jira/Azure story (the story the TMS case is linked to)
   - `separate-ticket` — file in a dedicated QA/bugs project
     different from the main development tracker
5. **Bug filing target** — target project/board when different from
   the main issue tracker (e.g. `QA-BUGS` sub-project).
6. **Bundling policy** — governs whether multiple findings on the
   same test case get separate tickets or share one:
   - `strict-per-bug` *(default)* — every finding gets its own
     ticket. Clean audit trail, more ticket noise.
   - `bundle-per-case` — lightweight clarifications / questions
     about the same TMS case may be consolidated into a single
     umbrella ticket (new findings added as comments on the existing
     per-case ticket). Real defects (reproducible bugs, blockers)
     still get their own tickets regardless — bundling only applies
     to the clarification-weight tier.
7. **Link case in bug** — `yes` / `no`. Whether filed tickets
   reference the TMS case ID in their body.
8. **Test case storage** — `tms` / `markdown` / `both-synced` /
   `none`. Whether AFS files under `test-specs/` mirror the TMS or
   exist standalone.
9. **Automation PR base branch** — the branch automation PRs target
   (and where Axel cuts his feature branches FROM). Typically the
   project's default branch; sometimes a dedicated
   `feature/test-automation-pilot` line when the team is piloting
   automation without affecting `main`.
10. **Merge policy** — `auto-merge` / `human-approved` / `manual`.
    Determines what PM does after review + CI pass:
    - `auto-merge` *(default)* — PM merges autonomously.
    - `human-approved` — PM waits for a human approval signal
      (e.g. `human-approved` label or a designated human reviewer)
      before merging.
    - `manual` — PM never merges; hands back to the operator.
    Right for early pilots and protected release lines.
11. **Squash / rebase / merge-commit** — optional; defaults to
    `squash`. Override if branch-protection demands a different
    strategy.

### Destination

`.agents/profile.md` § Project systems (see [templates.md](templates.md)
§ profile.md for the section template). Downstream skills read this
at runtime:

- `test-case-analysis` reads § Bug filing style + § Bug filing target +
  § Bundling policy when Sage needs to file a defect.
- `bugfix-workflow` reads § Issue tracker to know which CLI to invoke
  (`gh issue create` vs. Jira create vs. …).
- `test-automation-workflow` reads § Test case storage to decide
  whether AFS files should be written to git under `test-specs/`,
  pushed back to the TMS, or both.
- `project-manager` reads § Automation PR policy at session start —
  uses the base branch when routing Axel's PRs, and only fires the
  merge when the policy is `auto-merge` (waits for a human signal
  under `human-approved`, never merges under `manual`).
- `test-automation-engineer` reads § Automation PR policy to cut
  feature branches from the correct base and target the PR at the
  right branch.

### Report (end of Step 0.7)

```
Step 0.7 complete — project systems captured

Issue tracker:           <value>  [pre-filled | asked | Unconfirmed]
Issue tracker key:       <value>
TMS:                     <value>
TMS project key:         <value>
Knowledge base:          <value>
KB space:                <value>
Bug filing style:        <value>
Bug filing target:       <value>
Bundling policy:         <value>
Link case in bug:        <value>
Test case storage:       <value>
Automation PR base:      <value>
Merge policy:            <value>
Merge strategy:          <value>

Any "Unconfirmed" field — edit .agents/profile.md § Project systems
before the first test-case-analysis run.
```

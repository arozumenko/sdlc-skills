# sdlc-skills vs pstack: comparison and adoption candidates

- **Date:** 2026-11-27
- **Subject:** [`cursor/plugins` → `pstack`](https://github.com/cursor/plugins/tree/main/pstack)
  (MIT), read at `main` on 2026-11-27.
- **Coverage:** the pstack README and SKILL.md of all 85 skills: 24
  `principle-*` skills, 30 workflow skills, and `correct`, `reflect`, `recall`,
  `ketchup`. Not read: `plugin.json`, `.cursor-plugin/`, `agents/*.md`, `docs/`,
  `automations/benny/`, and per-skill files beyond SKILL.md. Files named in
  SKILL.md text (scripts, references) are referenced, not verified.
- **Our side:** this repo at branch `claude/learning-loop-bug-checks-oxrv4j`
  (5 factories, 28 agents, about 70 own skills, 18 upstream skill repos).
- **Already acted on:** the learning-loop ideas from `correct`,
  `principle-encode-lessons-in-structure` and `reflect` went into
  [`skills/mistake-to-guard`](../../skills/mistake-to-guard/SKILL.md) on the
  same branch (structure-first ladder, ratchet, dated exceptions, error names
  the fix, prose-rule tags, guard backlog).

## What each is

**sdlc-skills** is a team process: roles, factories, handoffs, merge gates,
ledgers, and installs into five IDE targets.

**pstack** is one engineer's way of working, made portable. One entry skill
(`poteto-mode`) matches a task to one of 22 playbooks and routes to other
skills. Short `principle-*` skills (`disable-model-invocation: true`) are
loaded only when named. It installs as a Cursor plugin, with a generated copy
for Claude Code. It has two agents (`poteto-agent`, a wrapper, and
`comment-sicko`, a read-only comment reviewer) and no shipped hooks.

So the playbooks are not worth copying; the quality techniques are, and
several drop into skills we already have.

## Where sdlc-skills is already ahead

- **Team structure:** 28 roles across 5 factories, routing, merge gates. pstack
  has one wrapper agent.
- **Delivery tracking:** estimates, cycle time, a committed ledger
  (`delivery-monitor`), cost per session and role (`tokenomics`,
  `efficiency-audit`).
- **Domains pstack lacks:** product discovery, manual QA, test automation,
  security testing, release.
- **Memory:** per-role memory plus a reviewed shared knowledge layer
  (`memory`, `knowledge-curation`). pstack's `recall` only rebuilds recent
  context.
- **Distribution and tests:** five IDE targets, generated marketplaces,
  validators, about 1,770 tests.

## Adoption candidates, ranked by value for the effort

### 1. Proof-by-run adversarial review (from `interrogate`)

Adversary subagents each get a worktree copy and try to break the change. A
finding survives only if its command reproduces it; a verification pass reruns
every command, merges duplicates and reports a per-adversary "Dropped" count.

Gap: `code-review` and the tech-lead blocking review are read-based; only the
security factory requires re-checkable citations.

Proposal: a "repro required" mode in `code-review`, used for M+ missions.

### 2. "A check never seen failing proves nothing", everywhere

pstack applies it to tests, formal checks and generated verify skills ("A
generated skill that was never executed is a draft, not a deliverable").

Gap: we state it in `mistake-to-guard` and a few agent files only.

Proposal: one shared rule in `verification-before-completion`,
`bugfix-workflow` step 3 and the `tdd` wrapper text.

### 3. Generated project-local verify skills (`create-verification-skill`, `maintain-verification-skill`)

Generates `verify-<app>/` with Launch, Doctor, Drive, Evidence, Cleanup,
Helpers and a `features/` map, and must run it end to end before handoff. The
maintain skill checks each feature file against source, then one live pass
drives every feature; outcome is clean, one PR, or blocked. Live-pass rules:
doctor before drive, evidence survives cleanup, kill only what you started.

Gap: `scout` seeds docs; `qa-engineer` improvises app launch and evidence each
run.

Proposal: a verify-skill step in `seeding-a-project`, plus a maintain skill.

### 4. Decision log for long unattended runs (`show-me-your-work`)

Append-only TSV: ts, phase, decision, why, evidence, result. A wrong call gets
a superseding row, never an edit. A script writes rows and escapes cells that
start with a formula character. A cross-vendor reviewer audits rows against the
transcript and ends with an "Attention" section.

Gap: `mission-execution` and `subagent-driven-development` runs leave a board
and PRs, but no reasoning trail.

Proposal: a reference plus a small stdlib script, used by long-running skills.

### 5. Writing standard with stable rule ids (`technical-writing`, `unslop`)

Layered standard (Diataxis, Google developer style, Simplified Technical
English, Global English) and a numbered list of AI-writing tells. "Rule numbers
are stable ids that other skills cite. A removed rule leaves a gap."

Gap: no writing standard; agents write many PR bodies, ticket comments, ADRs.

Proposal: an orphan writing skill with stable ids; some rules can later become
guards in the `mistake-to-guard` ledger.

### 6. Measurement discipline (`principle-explain-the-number`, `benchmark-checklist`)

Write the decision and the noise floor before measuring; name the limiter;
alternate A/B runs, at least 5 each; confirm the work happened ("timeouts
produce numbers for work that never happened"). Report verdict, number with
unit and run count, and the limiter.

Gap: `tokenomics`, `quality-evals` and `delivery-monitor` calibration report
numbers without such a checklist.

Proposal: a shared reference those skills point to.

### 7. Answer "why" from the record (`why`)

Answers design questions from commits and PR discussions, quotes what authors
wrote, marks inferences, and says what the record does not answer.

Proposal: fold into `root-cause-analysis` and scout onboarding.

### 8. A few principle skills

Short, loaded only when named. Most overlap with our agent bodies; worth
adopting as citable skills (keeps agent bodies shorter):

| pstack principle | Core rule |
|---|---|
| `fix-root-causes` | A guard is a fix only if the triggering state is legitimate. |
| `attack-the-premise` | After two failed fixes, write down the one premise they share and test it. |
| `test-behavior-not-implementation` | Assert what callers observe; survive internal refactors. |
| `make-operations-idempotent` | Derive each step from the state that exists, not from what the last run meant to do. |
| `migrate-callers-then-delete-legacy-apis` | Migrate and delete in the same wave; no compatibility layer when no external users depend on it. |

## Possible, lower priority

- **`arena`:** N candidates on the same prompt ("the prompt is the contract"),
  judged by a model from a different vendor, best base plus grafts. Expensive;
  a tech-lead option for XL plan reviews.
- **`statechart`, formal verification skills:** TLA+ via TLC for ordering bugs,
  with each property shown failing on a broken variant. Relevant to
  coach-android's stale-cap timing; niche skill set.
- **`setup-pstack`:** per-role model and budget choice, written as a rule with
  a versioned defaults marker for safe re-runs. Our `model:` is fixed in agent
  frontmatter (26 of 28 sonnet); an install-time `--budget` option would be
  similar.
- **`how`, `teach`:** onboarding explainers.

## Not worth taking

- `poteto-mode` and its playbooks: overlap with our roles and `mission-planner`.
- `bro`, `in-your-own-words`, `ketchup-video`, `make-bot-ui`: trivial or
  platform-specific.
- `principle-never-block-on-the-human`: conflicts with our ack-gated memory
  writes and approval rules; the useful part ("confirm the irreversible") we
  already have.

## Suggested order

1. Items 1, 2 and 6: edits to existing skills.
2. Items 3 and 4: new skills.
3. Items 5, 7 and 8 as capacity allows.

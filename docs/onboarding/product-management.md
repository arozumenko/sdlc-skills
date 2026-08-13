# Product Management — Onboarding

The `product-management` bundle drops a **Product Owner discovery team** into a
repo. It takes a raw ask — a feature request, a complaint, a market question, an
idea — and runs it through a discovery loop until it comes out the other side as
a **verified, prioritized hypothesis** anchored to a ratified outcome, ready to
hand off to engineering as groomed backlog work. Everything is plain Markdown
under `docs/discovery/` — there is no vault, no database, and nothing runs
against your application code.

For the pipeline picture, roster, and the artifact conventions, read the bundle
README first — this guide assumes it and focuses on **adoption**:
[`bundles/product-management/README.md`](../../bundles/product-management/README.md).

**Pick your path:**

- [Greenfield discovery](#greenfield-discovery) — a raw ask or idea, nothing in
  `docs/discovery/` yet.
- [Existing journeys / backlog](#existing-journeys--backlog) — you already have
  journeys, requirements, or a rough backlog to reconcile into hypotheses.
- [Hybrid — upstream of a dev team](#hybrid--upstream-of-a-dev-team) — run
  discovery ahead of the `feature-development` team on the same repo.

## The team, one picture

```
You → product-owner (Priya) runs the loop end to end
        → discovery-researcher (Sam) when a claim needs evidence, not judgment
        → hands a verified, prioritized hypothesis to ba (Alex) for backlog grooming
```

| Slot | Agent | Job |
|---|---|---|
| Discovery lead | `product-owner` (Priya) | Owns the loop: triages intake, frames problems, drafts and ratifies outcomes, maps the opportunity tree, prioritizes, and **guards the promotion gate**. Dispatches Sam for evidence. |
| Researcher | `discovery-researcher` (Sam) | Gathers and stress-tests evidence: stakeholder interviews, market/desk research, adversarial verification. Never decides what gets built — hands evidence back to Priya. |

**There is no `scout` here.** The bundle seeds the empty `docs/discovery/`
workspace at install; `product-owner` orients from it plus whatever
`.agents/*.md` and `docs/` your repo already has. Feasibility sign-off isn't a
skill — when a bet needs an "is this buildable?" check, `product-owner`
dispatches `tech-lead` (install `feature-development` too, or record the
acknowledgement yourself on the hypothesis — see Troubleshooting). The gate item
is never skipped; it is satisfied by an answer on the record.

### The pipeline, stage by stage

Each stage is a skill Priya (or Sam) invokes; you don't call them by hand.

| Stage | Skill | Produces |
|---|---|---|
| 1. Intake | `intake-triage` | Verdicts each raw ask; mints in-scope items as `problems/PRB-NNN` |
| 2. Frame | `define-personas` + journeys | Persona cards; user-journey maps |
| 3. Hypothesize | `journeys-to-hypotheses` | `hypotheses/HYP-NNN` stubs (`status: incubating`) from journey gaps |
| 4. Anchor | `define-outcomes` | Ratified, measurable outcome anchors in `outcomes.md` |
| 5. Map | `opportunity-tree` | `node_type:`/`parent:` overlay + the `outcome-tree.md` board |
| 6. Sharpen | `grill-decision`, `brainstorming` | Decisions (`decisions.md`), sharpened hypotheses |
| 7. Verify | `stakeholder-interview`, `deep-research` | Evidence under `evidence/*`, verdicts on assumptions (`verifying-outcomes` is a delivery check for after a bet ships, not a hypothesis check) |
| 8. Prioritize | `prioritize-bets` | RICE-ranked bets + the `priority.md` board |
| 9. Learn | `capture-learning` | `evidence/learnings/` when a bet closes |
| — Status | `discovery-status` | A read-only dashboard, at any point |

---

## Prerequisites

```bash
node --version                       # Node 18+ (for the npx installer)
git rev-parse --is-inside-work-tree  # inside a git repo (discovery records live in it)
```

No running app is required — this team works on documents, not a live system.
Two things sharpen the loop but are optional:

| Want | What you need |
|---|---|
| **Tracker cross-check** in `journeys-to-hypotheses` | Your issue tracker named in `.agents/profile.md` (`gh` / `glab` on PATH). Degrades gracefully — with no tracker it just marks those columns n/a. |
| **Market / desk research** in `deep-research` | Web access wired into your host so Sam can pull sources. |

The bundle install (`--bundle`) currently targets **Claude Code**; other hosts
use the manual `--agents` form. Host-specific launch syntax and flags:
[README.md](../../README.md).

---

## Greenfield discovery

You have a raw ask, a complaint, or an idea — and nothing in `docs/discovery/`
yet.

### 1. Install the bundle

```bash
cd /path/to/your-repo
npx github:arozumenko/sdlc-skills init --bundle product-management
```

This installs the 2 agents into `.claude/agents/`, their 10 discovery skills
(plus the reused `deep-research`, `brainstorming`, `verifying-outcomes`,
`memory`), seeds the empty `docs/discovery/` scaffold, wires the context hooks,
and splices the team conventions into `AGENTS.md` / `CLAUDE.md` under
`<!-- BUNDLE:product-management -->`.

For Copilot / Cursor / Windsurf, use the manual form:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents product-owner,discovery-researcher \
  --yes
```

### 2. Bring an ask to `product-owner`

Launch `product-owner` as the active agent and hand it raw material — a sentence,
a support thread, notes from a sales call:

> Use the product-owner agent. Triage this ask: "Enterprise customers keep asking
> to export their dashboards to PDF for board decks."

Priya runs `intake-triage` — verdicts it (Act Now / Plan Next / Collect More
Signal / Decline-or-Defer) and, if it's in scope, mints a `problems/PRB-NNN`
record with `discovered_from` provenance. Anything naming a real person stays in
the gitignored `docs/discovery/_inbox/`; committed records refer to people by
**role**, never by name.

### 3. Let the loop run

From a Problem, Priya walks the pipeline — framing personas and journeys,
drafting a **ratified outcome** (a measurable metric with a dated baseline —
only *you*, in chat, ratify it), turning journeys into hypotheses, and mapping
them onto the opportunity tree. When a claim needs evidence rather than judgment,
she dispatches **`discovery-researcher`**:

> (Priya, mid-loop) Dispatching discovery-researcher to verify the "board decks
> need PDF, not a live link" assumption before we promote this.

Sam runs interviews / research / adversarial verification and writes the evidence
back under `docs/discovery/evidence/*`. **Talk to Priya**, not to Sam directly,
during a run — she owns the loop and the sequencing.

### 4. Watch the gate with `discovery-status`

Any time you're unsure what's next:

> Use the product-owner agent. Run discovery-status.

You get a read-only dashboard: where each hypothesis stands against the promotion
gate, what's blocked and on whom, and the **exact next skill** to run. A
hypothesis leaves this team only when the gate is clear:

- its outcome anchor is **ratified** with a dated baseline,
- its risky assumptions are **verified**,
- it's been **prioritized**, and
- feasibility is **acknowledged** — by `tech-lead`, or, where it isn't installed, recorded on the hypothesis by whoever gave the read.

Priya narrates that checklist and **refuses handoff** when any item is unmet.

---

## Existing journeys / backlog

You already have user journeys, a requirements doc, or a rough backlog and want
to reconcile them into a coherent, prioritized set of bets.

1. **Install** the bundle (step 1 above).
2. **Drop your journeys** into `docs/discovery/journeys/` (or paste them to
   Priya and let her file them), and any existing bets into
   `docs/discovery/hypotheses/`.
3. **Run the convergence pass** — `journeys-to-hypotheses` classifies every
   journey **COVERED** (by an existing hypothesis/epic), **GAP** (no artifact
   yet), or **OUT-OF-SCOPE**, regenerates `journey-coverage.md`, and authors the
   missing Problem + Hypothesis stubs with collision-free IDs. If your tracker is
   named in `.agents/profile.md`, it cross-checks the epic board too.
4. **Anchor and prioritize** — `define-outcomes` gives the orphaned bets a metric
   to move; `prioritize-bets` ranks the incubating set (RICE by default; WSJF/ICE
   are config options) with confidence **derived from each bet's evidence band**,
   never guessed.

From here it's the same verify → gate → handoff flow as greenfield.

---

## Hybrid — upstream of a dev team

Discovery sits naturally *upstream* of the `feature-development` team: this team
decides **what's worth building and why**; the dev team decides **how** and
ships it. They share the repo but own different artifacts — discovery owns
`docs/discovery/`; the dev team owns `src/` and the delivery pipeline.

Install both bundles into the same repo (run each `--bundle` once). The handoff
is a **role dispatch**, not a file convention: when a hypothesis clears the gate,
`product-owner` hands it to **`ba` (Alex)**, who turns it into user stories with
acceptance criteria, and `issue-tracking` files them. Alex reads the promoted
`hypotheses/HYP-NNN` record and its linked outcome/evidence as the brief — so a
clean discovery record *is* the backlog handoff. `tech-lead` (Rio) is also on
call for the feasibility acknowledgement the gate requires.

There's no orchestration coupling — you drive `product-owner` for discovery and
`project-manager` for delivery independently.

---

## Project systems — where state lives

```
docs/discovery/
├── README.md                       # the pipeline map + ID/lifecycle conventions (seeded)
├── problems/PRB-NNN-*.md           # problem records (intake-triage)
├── personas/                       # persona cards, referenced by role
├── journeys/                       # user/customer journey maps
├── hypotheses/HYP-NNN-*.md         # bets — status: incubating | promoted | parked
├── outcomes.md                     # ratification-gated outcome register
├── decisions.md                    # append-only DEC-NNN log
├── evidence/
│   ├── intake/                     # triage batch records
│   ├── interviews/                 # synthesized interview evidence
│   ├── research/                   # published research reports
│   ├── verifications/              # adversarial-verification reports
│   └── learnings/                  # captured problem → outcome → lesson records
├── outcome-tree.md, journey-coverage.md, priority.md   # generated boards — never hand-edit
└── _inbox/                         # gitignored — confidential/person-named raw material
```

Three rules the team obeys (full detail in the bundle README and
[`instructions.md`](../../bundles/product-management/instructions.md)):

- **IDs are scanned, never reused** — `PRB-NNN` / `HYP-NNN` / `DEC-NNN`, the next
  free number found by scanning the folder.
- **Lifecycle is a frontmatter field** — a hypothesis is `status: incubating |
  promoted | parked`, not moved between folders.
- **Confidentiality by convention** — person-named raw material stays in the
  gitignored `_inbox/`; committed records refer to people by role. This is a
  convention, **not** a hook-enforced guard, so treat `_inbox/` discipline as
  manual.

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote directories
  instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`.
- **A hypothesis won't promote** → run `discovery-status`; it names the exact
  unmet gate item (no ratified outcome, unverified assumption, not prioritized,
  or no feasibility acknowledgement) and the skill that clears it.
- **"Blocked on `#tbd` / no outcome"** → the bet names no ratified outcome. Run
  `define-outcomes`; remember only *you* ratify one, and never without a **dated
  baseline**.
- **`journeys-to-hypotheses` skips the tracker columns** → no tracker is
  configured in `.agents/profile.md`, so it degrades gracefully to n/a. Add your
  tracker there (and `gh`/`glab` on PATH) to enable the cross-check.
- **Feasibility check asks for `tech-lead` and it isn't installed** → install the
  `feature-development` bundle (which ships `tech-lead`), or record the
  feasibility acknowledgement yourself and note it on the hypothesis.
- **Priya prioritizes on a gut-band bet** → `prioritize-bets` **warns, never
  blocks** — the ranking stands but is flagged; run a verification pass
  (`stakeholder-interview` / `deep-research`) to raise the evidence band.
- **MCP auth errors** (research web tools) → token rotated / scope missing. Fix
  the MCP server config in the host (`~/.claude.json`, `.mcp.json`, Copilot
  settings), never in the project repo, then restart the session.

---

## Maintenance

General update / sync notes live in [MAINTENANCE.md](../../MAINTENANCE.md).
Re-run the same `init` command with `--update` to pull upstream fixes to the
agents and skills. Your discovery record is **yours** and `--update` won't touch
it: everything under `docs/discovery/` (problems, hypotheses, outcomes,
decisions, evidence, and the derived boards). Refinement here is **manual and
assisted** — agents log durable facts via the `memory` skill, but nothing mines
past chat; you decide when to re-run the loop and which bets to park.

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # team conventions spliced under <!-- BUNDLE:product-management -->
├── docs/discovery/                   # the discovery record — yours to keep
│   ├── problems/  personas/  journeys/  hypotheses/
│   ├── outcomes.md  decisions.md
│   ├── evidence/{intake,interviews,research,verifications,learnings}/
│   └── _inbox/                        # gitignored confidential raw material
├── .agents/memory/<role>/            # per-role memory (product-owner, discovery-researcher)
├── src/ app/ …                       # YOUR application code (untouched)
└── .claude/agents/<role>/            # or .github/agents/<role>.agent.md per host
```

The team owns `docs/discovery/` and `.agents/memory/`. Your application code
stays untouched — this team produces the *decision record* that feeds
engineering; it never writes into your codebase.

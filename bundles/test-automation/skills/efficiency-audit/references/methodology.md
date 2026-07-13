# Efficiency-audit methodology

How this skill turns local transcripts + `ccusage` into per-role / per-sub-agent
cost — and the evidence behind each decision. All findings verified against
**ccusage v20.0.14** on real Claude Code data; the schema can drift between
versions, so the parser is defensive and the unit tests pin the rules.

## The principle: ccusage owns dollars, we own the join

Quality and cost are one chart; ccusage answers "what did a session/day/project
cost", and this skill answers "**cost ⨝ who spent it**" — the join ccusage can't
do alone. Every dollar shown is a ccusage dollar. This skill never prices tokens
from a table: pricing goes stale, differs per model, and re-implementing it just
duplicates ccusage's job (LiteLLM-backed) badly.

## Grain reality — why raw ccusage can't see sub-agents

1. **ccusage groups sessions by the transcript filename**, and its default
   `session` view folds all of a project's spend under top-level session ids
   (`.period`). Verified: of 557 sessions in a real store, **0** had an
   `agent-*` period — sub-agents never appear as their own row.
2. **Every sub-agent transcript carries the _parent's_ `sessionId` field.**
   Verified: all 9 sub-agents of a test-automation-lead session stamped the
   parent's id. So by ccusage's grouping key they *are* the parent.
3. **Yet the parent's cost already includes the sub-agents.** Verified: for a
   38-sub-agent session, ccusage's input/cache/output reconciled exactly to
   parent+sub-agents, not parent-only. So ccusage *does* read the sub-agent
   files — it just attributes them to the parent id.

Net: raw ccusage gives an exact **session** total that silently bundles the
orchestrator with everything it dispatched. No flag (`--breakdown`, `--instances`,
`--id`) or command (`session`, `blocks`) gets under that — the docs confirm "no
per-message or per-subagent breakdown."

## The flatten trick — exact per-sub-agent metering

The key discovery: **`ccusage claude session` keys a session by its file _name_,
and only globs the top of a project dir.** Sub-agents are invisible to it *only*
because they sit in a `<session>/subagents/` subfolder it doesn't descend into —
not because it can't price them.

So the skill stages a throwaway `CLAUDE_CONFIG_DIR`:

```
<tmp>/projects/<project-name>/
    <session-uuid>.jsonl        # parent (orchestrator), hard-linked
    agent-<hex>.jsonl           # each sub-agent, flattened up from subagents/
    ...
```

then runs `ccusage claude session --json` over it. ccusage meters **each file
individually** with real per-model LiteLLM pricing. Verified on a real
test-automation-lead session:

```
PARENT (test-automation-lead)   $5.52
agent-… (implementer)           $7.17
agent-… (implementer)           $5.92
… 6 more …
TOTAL                          $30.96   ← ccusage's real session total, to the cent
```

**Model-aware by construction.** Because each file is metered independently,
ccusage prices every unit by *its own* model at the correct per-model rate — a
sub-agent on Sonnet is billed at Sonnet, an orchestrator on Opus at Opus. It's
even correct *within* a file: ccusage's `modelBreakdowns` split a single
mixed-model transcript per model (verified: an orchestrator metered $5.52 =
sonnet $4.32 + opus $1.20). This is the concrete reason metering beats the
allocation fallback, whose single blended ratio can't distinguish models within
a session. The rollup surfaces each unit/role's model(s) (a `models` array in
`--json`, a `models` column in the markdown) so a role that quietly ran on a
pricier model is visible.

Implementation notes (all learned the hard way):

- **Hard links, not symlinks.** ccusage does **not** follow symlinks (returns
  `sessions: []`); it needs a real directory entry. Hard links share the inode
  (no data copied); fall back to a full copy across filesystem boundaries (EXDEV).
- **Use the `claude` sub-command**, not the default aggregate — the default pulls
  in every other host (Codex/Gemini/…) from their own stores regardless of
  `CLAUDE_CONFIG_DIR`, polluting the result.
- **Ids don't collide.** Session UUIDs and `agent-<hex>` ids are globally unique,
  so the whole project flattens into one folder safely; re-associate each
  `agent-*` back to its parent via the original `subagents/` folder membership.
- **Tear the temp dir down** after the one ccusage call.

## Forks, resumes & background dispatches (dedup)

Claude Code **forks/resumes** a session by writing a new transcript that
**replays the earlier session's records** (verified: two session files sharing
94 message-ids; a resumed session also **inherits a copy of its parent's
`subagents/` files**, so one sub-agent transcript can exist under two parent
dirs). Background-dispatched sub-agents land in the same `subagents/` layout as
blocking ones — the meta gained a `spawnDepth` field, but the storage is the
same; the thing that actually differs is this **replay on resume**.

Cost is unaffected — **ccusage already dedups by message-id**, so a fork meters
to ~$0 (its content was counted under the original) and the skill's metered
total matches native ccusage to the cent. But **transcript-derived** metrics
(tokens, turns, tool calls, dispatches) would double-count the replay if left
naive — measured **+42% tokens** on a real forked project. Two safeguards fix it,
mirroring ccusage:

1. **Global dedup.** Units are parsed **earliest-first** through one shared
   `seen` context of message-ids and tool-use-ids. A record whose id was already
   counted under an earlier unit is a replay and skipped — so the original owns
   the shared content and the fork contributes only its *new* work. This brought
   the same project from +42% to within ~1% of ccusage's deduped tokens, and
   `dispatched` from 15 (replayed) to 8 (real).
2. **Unit-id dedup.** A sub-agent file present under multiple parent dirs is
   emitted as a **single** unit, not once per parent.

Non-forked projects are unaffected (no shared ids → the dedup is a no-op; totals
are byte-identical). The dedup is keyed on ids the same way ccusage's is, so the
transcript metrics track ccusage's authoritative numbers.

## Fallback — allocation (only when metering can't run)

If `ccusage claude` is unavailable or staging is blocked, the skill falls back to
the parent-session total (from the default `ccusage session`, which folds in
sub-agents) and **splits it across the units by cost-weighted token share**:

```
weight(unit) = output×5 + input×1 + cacheWrite×1.25 + cacheRead×0.1
```

Those are the **Anthropic price _ratios_**, identical across Opus/Sonnet/Haiku
even though absolute prices differ ~15× (opus 15/75/18.75/1.5, sonnet
3/15/3.75/0.3, haiku 1/5/1.25/0.1 all reduce to 1 : 5 : 1.25 : 0.1). It's a stable
ratio, not a price table, used only to *proportion* a real ccusage dollar — the
session total stays ccusage-exact; only the split is derived. It's labelled
`ccusage-allocated`, never presented as metered.

**Why allocation is a fallback, not the default.** It's a good approximation but
not exact: derived per-model prices back out cleanly for the dominant model
(sonnet: $3.10/M vs $3 list) but not for lightly-used off-ratio models (opus in
one session backed out to ~$6.78/M vs $15 list, because the 5-minute vs 1-hour
cache-write tiers carry different multipliers a single ratio can't capture). The
flatten metering has none of this error, so it's the primary path.

## Token extraction (for shares/metrics only, never dollars)

When the skill needs per-unit token *counts* (cache-hit rate, output share, and
the allocation weight), it reads `message.usage` from transcripts using the rule
**group by `message.id`, take the MAX `output_tokens`** across occurrences.
Claude Code writes the same assistant message id on multiple streaming lines with
a *growing* output count while input/cache stay fixed; a naive sum/first
mis-counts output badly (measured ~46% low on a real session). Max-per-id
reproduces ccusage's token totals exactly.

## Activity metrics (from the same records)

Alongside cost, each unit's transcript yields activity metrics — no extra data
source, just more of the records we already read:

- **Tool calls** = assistant `tool_use` content blocks (counted by name too).
  **Errored** = following-message `tool_result` blocks with `is_error: true`;
  success = total − errored. Surfaced per role as `tools (err)`.
- **Skills loaded** = the union of the record-level **`attributionSkill`** field
  (the platform's own "which skill was active this turn") and explicit **`Skill`
  tool calls** (`input.skill`). `attributionSkill` is the richer signal — it
  catches auto-triggered skills that never went through an explicit `Skill`
  call. Reported as a count + names, with a per-skill `units`/`turns` table.
- **Sub-agents dispatched** = **`Agent`** tool calls, named by
  `input.subagent_type` + `input.description`. This attributes the fan-out to
  *whoever dispatched it* (the orchestrator vs a sub-agent that spawned its own),
  which is why it's per-unit. Note it counts **Agent-tool** dispatches
  specifically — a sub-agent unit spawned by the **Workflow** tool
  (`agentType: workflow-subagent`) is a counted *unit* but not an Agent-tool
  *dispatch*, so the two numbers legitimately differ.

- **Time.** Two measures, because they answer different questions. **Active
  minutes** (`agentMinutes`) = sum of gaps between a unit's consecutive records,
  **excluding idle gaps > 30 min** — so a top-level session resumed across days
  isn't counted as continuous work (a plain last−first span read one orchestrator
  as ~20,000 min / 14 days; active-minutes reads ~160, matching its 154 turns).
  **Wall-clock** (`wallClockMin`, and per-unit `startedAt`/`endedAt`) = the raw
  first→last span — honest for a bounded sub-agent or a single case's elapsed
  time (and reflects parallelism: summed active-minutes can exceed wall-clock when
  sub-agents overlap), but inflated for a resumed top-level session. Use
  active-minutes for effort, wall-clock for per-case elapsed time. Caveat for
  **aggregated buckets** (a role, day, or project row): `wallClockMin` there
  spans min-start→max-end across **all** units in the bucket — so a role active
  across several days reports the whole elapsed span, not summed session time;
  read multi-session buckets' wall-clock as "span covered", not "time worked".

These ride through the same rollup as cost — summed per role/day/project, and
exposed per unit in the `--json` `ledger` (`toolCalls`, `toolErrors`, `skills`,
`dispatched`, `models`, `agentMinutes`, `wallClockMin`, `startedAt`, `endedAt`).

## ccusage cost modes (`--mode`)

Passed straight through so ccusage owns the pricing policy:

- **`auto`** (default) — logged `costUSD` when present, else LiteLLM pricing.
- **`display`** — only logged costs (billing-faithful; $0 where unlogged).
- **`calculate`** — always LiteLLM (consistent for historical comparison).

**Pricing DB freshness.** ccusage prices tokens from a LiteLLM DB. The **cached
(offline)** copy is fast and network-free but can **lag new models** — a model it
doesn't know prices to **$0**, silently undercounting (observed ~9× on a
`claude-sonnet-5` project: $8 vs the true $74). The skill detects this per model
(real tokens but $0 cost, ignoring the internal `<synthetic>` model) and, by
default, **auto-refreshes online** for that run; `--offline` forces cached pricing
and instead prints a loud undercount warning; `--online` forces live pricing from
the start. Whichever mode, the metered total still matches native ccusage exactly.

## Attribution join

- **Role** per unit is read straight from the data, so it works for *any* agent
  set with no fixed roster: a top-level session's role is its `agent-setting`
  record (`agentSetting`, written whenever launched `claude --agent <role>`); a
  sub-agent's role is the `agentType` in its `.meta.json` sidecar. Role-less
  sessions (ad-hoc interactive use) roll up as `unattributed` — expected, not an
  error. Override a role with `--tag <sessionId=role>`.
- **No team/bundle mapping.** The skill deliberately does *not* map roles to
  predefined teams — that would assume a fixed roster and break the moment a
  different agent set runs. It reports roles as they appear; *which* sessions to
  include is a scoping decision made with the user at invocation time.

## Nesting / topology

Sub-agents are discovered recursively, but in practice Claude Code stores **every
descendant flat** under the top session's single `subagents/` folder (verified:
1552 sub-agent transcripts, 0 nested `subagents/subagents/`, max depth 1). So an
orchestrator run *as a sub-agent* of a regular session, and the sub-agents *it*
spawns, all land as flat siblings — each gets metered and role-attributed
correctly. Discovery is keyed off the `.meta.json` sidecar, which also excludes
non-transcript artifacts like the Workflow tool's `journal.jsonl` (no sidecar) so
they never collide on filename or add a bogus row.

## Reconciliation (built-in self-check)

Every run emits a **Reconciliation** section that must tie out, or the run says
so loudly:

- **Internal.** The per-unit ledger, by-role, by-day, and by-project breakdowns
  must each sum to the same grand total — catches any aggregation bug.
- **ccusage fidelity.** The grand total must equal the sum of ccusage's own
  **per-file** metered numbers, and every metered file must map to exactly one
  ledger unit (0 orphans) — proves the staged-flatten metering neither dropped
  nor double-counted a file.

It deliberately does **not** compare against ccusage's `session` **aggregate**
view. That view groups by top-level session-id and folds sub-agents differently
(workflow sub-agents land under their own ids, Agent sub-agents fold into the
parent), so its total legitimately differs from the per-file grain the skill
uses — comparing them produces false mismatches (verified: the gap equalled the
`workflow-subagent` cost exactly). The per-file metering *is* the ccusage
source of truth here; the reconciliation anchors to that.

## Known limits

- **30-day transcript retention** (`cleanupPeriodDays`) — audit within the window.
- **Multi-day sessions** are attributed to their first-activity date (not
  pro-rated). Dates — both the per-day buckets and the `--since`/`--until`
  window — are **local** calendar days, matching ccusage's own default
  `--since`/`--until` filtering (a UTC date would disagree near midnight).
- **Schema drift** — the ccusage JSON and transcript shapes can change between
  versions; parsing tolerates missing fields, and the unit tests should be
  re-calibrated if a version bump moves things.
- **Host coverage** — the role/sub-agent layer is Claude-Code-only. ccusage
  reports Copilot (via OpenTelemetry `~/.copilot/otel/*.jsonl`, which must be
  enabled *before* the sessions), Codex, Gemini, etc. as host-level *totals*
  only, with no sub-agent decomposition.

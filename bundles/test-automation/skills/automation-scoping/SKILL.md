---
name: automation-scoping
description: Use when a scope of test cases (or a described backlog, before any cases even exist as files) needs a cost/time estimate BEFORE automation work starts — presales scoping, a proposal, "how long/much to automate these N cases", sizing a new engagement, or recalibrating an estimate against a project's own delivery history. Produces a scoping report with a range and a stated confidence level, never a bare point number.
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Automation Scoping

Estimate how much active-agent time (and, derived from that, how much
money) it will cost to automate a scope of test cases — **before** the batch
pipeline runs, sometimes before the target app is even reachable. This is
the tool that turns "we think this will take a while" into a number with a
stated confidence level, defensible enough to put in a proposal.

**Core philosophy — a cone of uncertainty, not a fortune-telling machine.**
Confidence narrows as more is known, and every mode below states honestly
where it sits on that cone:

```
Mode 1 (blind, case text only)  →  Mode 2 (scored sample, extrapolated)  →  Mode 3 (app-informed)  →  delivery  →  Mode 4 (calibrate against what actually happened)
   widest band                                                                    narrower band                        the model gets sharper for next time
```

**The one number this skill will never produce is a bare point estimate.**
Every output is a range with a named confidence tier
(`references/scoping-report-format.md` § Confidence statement). A presales
number without its band is the anti-pattern this whole skill exists to
replace.

## What this is built on, so it isn't guessed from scratch

Three things this bundle/family already does, stitched together rather than
reinvented:

- **`test-sizer`** (manual-qa bundle) already sizes cases from step count +
  complexity modifiers into S/M/L — its step-count table is this skill's
  `base_minutes` floor, and four of its six modifiers are this skill's
  **modifier vocabulary** (the setup/data/teardown/assertion axis the
  interaction tier doesn't see — `references/complexity-taxonomy.md`
  § Modifiers). Where a project ran test-sizer, its `size:` frontmatter is
  a free cross-check for the verdict pass.
- **`app-profiler`** (manual-qa bundle) already does interview-then-explore
  against a live app — Mode 3 below borrows that shape for the one question
  it needs answered (*is this surface already covered, or is it new
  ground?*), and reads its output (`.agents/manual-qa/app_profile.md`)
  directly when the project has one, before probing anything live.
- **`efficiency-audit`** (this bundle) already produces the historical
  ground truth (`.agents/efficiency/*`) that Mode 4 calibrates against —
  this skill doesn't compute a single dollar itself; it reads what that
  skill already metered.
- **The analyst slot** (`qa-engineer` + `test-case-analysis`) is this
  bundle's own live-execution specialist — on a project that has started
  automating, its artifacts (AFS files, `_surface.md` digests, batch
  reports) are the strongest complexity/novelty evidence there is, and
  Mode 3 reads them before probing anything itself. For a high-stakes
  estimate, Mode 3's live spot-check is *dispatched to the analyst*, not
  improvised.

## Detecting the mode

| Input you were given | Mode |
|---|---|
| Case descriptions / TMS case files / a requirements doc, no live app access, scope count = what's provided | **Mode 1 — Blind** |
| A sample of cases explicitly representative of a larger stated scope | **Mode 2 — Sample-extrapolation** |
| Live app URL/credentials available alongside the cases | **Mode 3 — App-informed** (run *in addition to* Mode 1/2, refines it) |
| A request to recalibrate / "how are our estimates doing" / a project with `.agents/efficiency/` history and a completed batch | **Mode 4 — Calibration** |

Modes aren't mutually exclusive — the common presales sequence is **1 or 2,
then 3 if access exists**, and **4 runs later, after delivery**, on the same
project, to sharpen the next estimate.

## Step 0 — fix the sizing model for THIS project, before scoring anything

Two checks, both cheap, both recorded in the report's methodology paragraph:

1. **Which taxonomy applies?** A project-local
   `.agents/estimation/complexity-taxonomy.json` (a prior Mode 4
   calibration) wins over the bundled default — the scripts already resolve
   that precedence; your job is to *say which one applied*.
2. **Do the tiers even fit this project?** The bundled tiers are a UI-web
   starting point. For an API / mobile / perf scope, adapt the tier set
   FIRST in a project-local copy per `complexity-taxonomy.md` § Extending —
   an API project's expensive tier is more likely "multi-service
   orchestration / async callback" than "canvas/drag-drop". Scoring an API
   backlog against UI keywords produces confident-looking nonsense. The
   verdict pass below is what makes adaptation practical: readers judge
   against tier *definitions*, so a renamed or added tier works before
   anyone invents keyword lists for it.

## The verdict pass — agents read the cases; the script does the arithmetic

`score-cases.mjs` can classify from raw text (keyword match). That is the
**fallback**, fine for a two-minute triage — not the method. Keywords can't
judge complexity of functionality, and they can't see what a case *fails to
say* — the exact "edit the report" ambiguity § Mode 3 describes, and part of
why two same-step-count cases differ 2×+ in cost (step count measured at
r≈0.37–0.41). The method is a **verdict pass**: sub-agents actually read
every case and return a structured verdict; the script only prices what they
judged.

**Fan out the reading; never absorb it.** Case bodies are payload — the same
context-frugality rule the lead's playbook measures at ~10K tokens per 14
cases read in-context. Dispatch readers over the case files in chunks of
~10–20 cases each. Reading writes nothing, so this is the sanctioned
read-only fan-out: on Claude Code run the chunks as one parallel `Workflow`
fan-out (schema-forced verdicts); on other hosts, sequential sub-agent
dispatches. Verdicts land in
`.agents/estimation/<scope-slug>-verdicts.json`; you keep only the rollup.

**The verdict, per case:**

```json
{ "id": "CASE-1042",
  "tier": "rich-widget",
  "tier_rationale": "the 'report' being edited is a drag-drop builder (step 4)",
  "steps": 9,
  "modifiers": ["rich-test-data", "heavy-teardown"],
  "quality_flags": ["vague-steps", "missing-expected"],
  "signals": ["needs seeded multi-user test data"],
  "split_recommended": false,
  "confidence": "high" }
```

Verdict rules: `tier` is judged against the tier **labels/definitions** —
what interaction the case actually exercises — never by scanning for the
keyword lists (those exist for the script's fallback). `steps` is the count
of real actions: split compound rows, drop narration — not the raw table-row
count. `modifiers` is the second complexity axis (adapted from manual-qa's
`test-sizer` rubric): `complex-preconditions` (specific role AND seeded data
AND a reached app state), `rich-test-data` (5+ distinct fields, file upload,
or dynamically generated unique values), `heavy-teardown` (3+ cleanup steps,
persistent-data deletion, config reset), `high-assertion-density` (6+
distinct checkpoints). Interaction-shaped modifiers (multi-page flows,
drag-drop/editors) are deliberately NOT in this list — the tier axis already
prices them, and double-counting is worse than missing. `quality_flags`
vocabulary: `vague-steps` ("verify it works"), `missing-expected` (no
expected results), `missing-data` (test data unstated and not derivable from
the text), `likely-drift` (references screens/fields that contradict each
other or look stale against the described product). `signals` is free-form —
observed cost drivers neither axis names yet; they feed the report's risks
section and future calibration hypotheses instead of being lost.
`split_recommended: true` — with the reason in `signals` — flags a case so
large or multi-flow that its estimate is unreliable and the honest presales
line is "split before automating" (test-sizer's L-split advice, carried
over). Two cross-checks while reading: a frontmatter `size:` (test-sizer ran
here) that clashes with your judgement — an `L` landing in a cheap tier with
no modifiers — deserves a second look and a `signals` note; and modifiers
don't change the price (see below), so record them even when they feel
minor.

Then price it: `score-cases.mjs <cases> --verdicts <verdicts.json>`. Judged
tier/steps override the keyword guess (each row's provenance is marked), and
a quality-flagged case keeps its point estimate but is priced with the
**widest band regardless of calibration** — a flag is measured uncertainty
about the case itself, and no cost premium for it has earned its way into
the model yet (`complexity-taxonomy.md` § Case quality). `modifiers` and
`split_recommended` likewise never move the number: they ride the output
rows and the report's risks section as named, comparable observations
(`complexity-taxonomy.md` § Modifiers) — candidate factors a future
calibration can price, not arithmetic today.

## Mode 1 — Blind (no app access, no project history)

1. Gather the case inputs: TMS case files, a requirements doc, or plain
   prose descriptions of what needs automating.
2. **Run the verdict pass** (§ above) over the case files — skippable only
   for a scope small enough that you read every case yourself anyway
   (≲10 cases; reading them is still mandatory, only the fan-out is not).
3. Price it:
   ```
   node {skill}/scripts/score-cases.mjs <cases> --verdicts <verdicts.json>
   ```
   It reads `.agents/estimation/complexity-taxonomy.json` if the target
   project already has one (a prior Mode 4 calibration), else falls back to
   the bundled `references/complexity-taxonomy.json` default — always the
   right precedence, never ask.
4. Every case gets `novelty = unknown (1.0)` — don't guess reuse blind (see
   `references/complexity-taxonomy.md` § novelty_multiplier). This is *why*
   Mode 1 alone always reports the `cold_no_history` confidence band.
5. Write the scoping report (`references/scoping-report-format.md`).

**Cases don't need to exist as files yet.** If the user describes scope in
prose ("about 40 requirements across checkout, account settings, and a
drag-and-drop dashboard builder"), score-cases.mjs accepts a JSON array of
`{id, text}` descriptions the same way test-sizer's Mode B accepts rough
descriptions — decompose the prose into distinct implied cases yourself
first, the same judgment call test-sizer makes.

## Mode 2 — Sample-extrapolation

Same as Mode 1, plus:

1. Confirm with whoever supplied the sample: how was it chosen, and what's
   the real total scope count? Don't assume "representative" — ask.
2. `score-cases.mjs --sample-of <total_scope_count>` — this widens the
   confidence band per `references/sampling-methodology.md` and adds the
   extrapolation block to the report.
3. Sanity-check the sample's tier distribution against what you know about
   the described scope (same reference, § "does the tier distribution look
   plausible"). Flag any mismatch in the report's risks section — don't
   silently trust an unrepresentative sample.

Full mechanics, including the "never extrapolate past 10x without flagging
it" rule: [`references/sampling-methodology.md`](references/sampling-methodology.md).

## Mode 3 — App-informed (refines Mode 1 or 2)

Run this whenever a live app is reachable — it resolves the single factor
Mode 1/2 can't (novelty), which was the largest single cost driver found on
the seed project outside interaction tier itself. **Gate on availability,
not perfection**: needs a base URL and *some* way in (credentials, or
`auth_state`/a dev-token bypass) — a scope with no app access at all just
stays at Mode 1/2, cold. Missing test data for one flow doesn't block
exploring the others.

1. **Read what's already known — don't re-derive a sibling's work.** In
   order of evidence strength: **the analyst's own artifacts**, on a project
   that has started automating — existing AFS files (`test-specs/**`: every
   one is a case that was *executed live* — observed handles, real
   interaction pattern, test-data inventory, documented drift/defects),
   `_surface.md` digests, and `.agents/automation/*/report.json` (which
   cases landed and what blocked) — an AFS on the same surface answers
   tier, novelty, data needs, and case quality with ground truth, no
   probing needed; then a prior `.agents/estimation/surface_recon.md` (this
   skill's own log — step 6 below); then `.agents/manual-qa/app_profile.md`
   if the project also runs the manual-qa bundle (`app-profiler`'s
   interview-then-explore output: base URL, auth, key pages, reliable
   selectors, fragile areas); then scout's seed (`.agents/testing.md`,
   `architecture.md`, `profile.md`). Anything answered there is answered —
   the steps below fill gaps, not repeat questions.
2. **Interview, briefly** — base URL, auth, and which of the scope's
   features already have *some* automation (ask; don't assume none does) —
   only for what step 1 left open.
3. **Repo-grep reuse check — cheap, but a first pass, not the answer.**
   For each distinct surface/feature the case scope touches: check whether
   the project's existing test suite / page objects / API clients already
   cover it — `grep -ril "<feature keyword>" test-specs/ pages/ tests/`
   (same reuse-check shape `test-case-analysis` uses in its own § "Read the
   neighbours first"). Covered → tentatively `established_surface`. Nothing
   found → tentatively `novel_surface_no_existing_coverage`. **Tentative is
   the operative word**: a grep hit can be a false positive (a page object
   for a *similar*-sounding but different feature), and "nothing found"
   doesn't distinguish a genuinely novel surface from a suite this scan
   just didn't search correctly — treat both readings as needing the next
   step, not as settled.
4. **Live spot-check — a couple of representative areas, not a full
   `app-profiler` sweep.** `app-profiler` (manual-qa bundle) profiles an
   entire app for manual-QA authoring; this is narrower on purpose — pick
   **2–3 surfaces**, not every one the scope touches, prioritized by:
   - Surfaces step 3 flagged ambiguous (grep hit looks like it might be a
     false positive, or the surface has zero suite footprint at all).
   - Surfaces carrying the most cases (biggest leverage on the total
     estimate — confirming or correcting one assumption here moves the
     whole scope's number, not just one case's).
   - Surfaces whose case text sounds underspecified about *how* the
     interaction actually works (a case that says "edit the report" without
     saying whether that's a form or a drag-drop builder — the exact
     ambiguity that changes which `interaction_tier` applies).

   **Probe with whatever tool fits the surface under test — same
   universality as the rest of this bundle** (`test-case-analysis`'s own
   § Capture handles is the reference vocabulary: "selectors for UI,
   endpoints + named response fields for API, accessibility-ids / ids for
   mobile, metric queries + thresholds for perf"). A browser session
   (`playwright-testing` / `browser-verify`, snapshot-before-act, screenshot
   evidence to disk) is the UI case, not the general case:

   | Surface | Tool | What "already covered" looks like |
   |---|---|---|
   | UI | browser (MCP or CLI) | the interaction matches the case text's implied pattern; the elements the case needs already carry this **project's own** stable-handle convention — read it from THIS project's `.agents/testing.md` / `role-overrides.md`, don't assume; one project's team may rule testid-only, another may key on `aria-label`, `id`, or something else entirely, and that ruling is never this skill's to impose |
   | API | HTTP client, or read the OpenAPI/Swagger spec if the project exposes one | the endpoint/schema already exists and is exercised by an existing client/service object, not just "a similar-sounding endpoint exists" |
   | Mobile | device/emulator session | the screen/flow exists and the elements carry stable accessibility-ids, not just that *a* screen with a similar name exists |
   | Perf | the project's load-test tool/config | a script + threshold already targets this specific endpoint/flow, not just that the tool is set up at all |

   **Who runs it: the analyst slot, when this bundle's agents are
   installed.** Live case execution is exactly what `qa-engineer` +
   `test-case-analysis` exist for — dispatch the spot-check there rather
   than improvising it (you keep the verdict, the analyst keeps the
   payload). For the most load-bearing cluster of a high-stakes estimate,
   the strongest form is a **full single-case analysis**: one
   representative case executed end-to-end to a real AFS. That grounds
   tier, novelty, data needs, and quality for the whole cluster in
   observation — and unlike every other presales artifact, an AFS is not
   throwaway: it's the first deliverable of the engagement if the deal
   lands. Scoping-grade exploration stays read-only against the live app;
   analysis, not automation.

   Whichever form it takes, two things every spot-check answers:
   1. Does the live interaction match what the case text implies, or does
      it undersell/oversell it? (tier-correction candidate — the same
      "edit the report" example above.)
   2. Does the surface already carry **this project's own** ground-truth
      reuse signal (whatever `.agents/testing.md` documents as the stable
      handle/coverage convention) on the specific elements/endpoints/
      screens/flows this case needs — not just "does something adjacent
      exist." A page object / service object / screen object existing is
      necessary but not sufficient; the specific handle the case needs is
      the real signal, because that's the actual cost driver (new handle
      work), not file existence.
   Save evidence to disk (screenshot / response capture / whatever the
   surface produces), cite the path, don't inline it into context.
   ```
   A live finding **overrides** step 3's grep-based guess for that surface
   — a false-positive grep hit corrected live is exactly the kind of thing
   this step exists to catch (this bundle's own audit trail has repeated
   examples of grep/snapshot claims turning out wrong on inspection; don't
   repeat that pattern here by trusting the cheap pass alone when a live
   check is available).
5. **Fold findings back**: update the affected cases' rows in the verdicts
   file — a live-corrected tier goes in as `tier` + `tier_rationale`, a
   resolved surface as `novelty: established_surface` /
   `novel_surface_no_existing_coverage` — and re-run `score-cases.mjs
   --verdicts` (a per-case verdict novelty overrides the blunter
   `--known-surfaces` keyword list, which remains the quick path when no
   verdicts file exists). This is how a live correction actually reaches the
   number.
6. Write (or refresh) `.agents/estimation/surface_recon.md` — one entry per
   surface checked, whichever step resolved it (grep-only, or grep +
   live-corrected), including stable-handle-presence notes from step 4. This
   is what makes the NEXT Mode 3 pass on the same project cheaper — step 1
   reads it before re-deriving a surface that's already logged.

## Mode 4 — Calibration (after delivery, owned by scout's Phase-3 reinforcement)

Run this after a project has delivered at least a handful of cases through
the batch pipeline and has `.agents/efficiency/` history. Full mechanics:
[`references/calibration-methodology.md`](references/calibration-methodology.md).

```
node {skill}/scripts/build-training-set.mjs --automation-dir .agents/automation \
  --ledger <rollup.json from efficiency-audit --json> --out training-set.json
node {skill}/scripts/calibrate.mjs --training-set training-set.json      # dry-run: writes a proposal, changes nothing
node {skill}/scripts/calibrate.mjs --training-set training-set.json --apply  # writes .agents/estimation/*, appends the log
```

**Never runs silently as a side effect of something else.** This is a
deliberate scout action (session-retrospective's sibling — mining what
already happened, proposing a delta, waiting for it to be looked at), not
something a batch triggers automatically on its own completion.

## Output

Every mode writes `.agents/estimation/<scope-slug>-scoping-report.md` per
[`references/scoping-report-format.md`](references/scoping-report-format.md)
— range + confidence tier + methodology paragraph + risks, always. Two
scope-level assumptions are part of every report because they move the total
more than any per-case factor: the **operating shape** (batched vs
single-case delivery — measured +87% per delivered spec when batching
stopped) and the **delivery rate** (blocked cases cost ~1.85× a delivered
one) — `complexity-taxonomy.md` § Batch shape & delivery rate. Tell the
user the path and read the headline back to them; don't just leave it on
disk.

## Anti-patterns

- **A bare dollar figure with no range.** Every output has a confidence band
  and a stated tier — see § Core philosophy.
- **Keyword-classifying at scale when readers are available.** The keyword
  scan is a triage fallback; a proposal-grade estimate reads every case via
  the verdict pass. Same-step-count cases differ 2×+ in cost precisely on
  what a substring match can't see — what the interaction actually is, and
  what the case fails to say.
- **Absorbing case bodies into your own context.** Scoping a backlog by
  `cat`-ing the cases is the measured ~10K-tokens-per-14-cases mistake the
  lead's playbook already names — dispatch readers in chunks, keep only the
  verdicts and the rollup.
- **Guessing novelty cold.** Mode 1/2 without app access leaves novelty
  `unknown (1.0)` and says so; it does not assume "probably established" or
  "probably novel" — either guess is worse than an honest wide band.
- **Trusting an unrepresentative sample silently.** Mode 2 asks how the
  sample was chosen and flags a mismatched tier distribution — see
  `sampling-methodology.md`.
- **Silently auto-applying a recalibration.** `calibrate.mjs` defaults to a
  dry-run proposal; `--apply` is an explicit, logged choice — see
  `calibration-methodology.md` § Why the dry-run gate.
- **Trusting `report.json`'s `outcome` field as terminal without checking.**
  It can lag a real merge (confirmed twice on the seed project — a mid-loop
  snapshot never regenerated after a manual or `batch-stabilize` recovery
  closed the case out clean). `build-training-set.mjs` cross-checks against
  the base branch's merge history and flags rows it couldn't verify.
- **Assuming a clustering/"known surface" discount applies uniformly, or
  assuming it doesn't exist at all.** A real, moderate, tier-and-step-
  controlled correlation between clustering and lower per-case cost has been
  found (`corr ≈ -0.4`) — but a selection-effect confound (clustered cases
  may just be the ones already chosen because they look cheap/similar) isn't
  resolved, so it's not in the formula yet. Don't silently discount a
  scope's clusterable-looking cases, and don't assume clustering can't help
  either — see `references/complexity-taxonomy.md` § Repetition/clustering
  discount for the current state of the evidence.
- **Reusing another project's calibrated taxonomy wholesale.** A
  project-local `.agents/estimation/complexity-taxonomy.json` is *that
  project's* posterior; a different stack/pipeline starts from the bundled
  prior, not another project's calibration.

## References

- [`references/complexity-taxonomy.md`](references/complexity-taxonomy.md) +
  [`references/complexity-taxonomy.json`](references/complexity-taxonomy.json) —
  the scoring model and the data it reads.
- [`references/sampling-methodology.md`](references/sampling-methodology.md) —
  Mode 2 extrapolation mechanics.
- [`references/calibration-methodology.md`](references/calibration-methodology.md) —
  Mode 4 mechanics, the dry-run/apply gate.
- [`references/scoping-report-format.md`](references/scoping-report-format.md) —
  the output template.
- [`references/calibration-log.md`](references/calibration-log.md) — history
  of revisions to the *bundled* default taxonomy (a project's own
  recalibration history lives in its own `.agents/estimation/calibration-log.md`).

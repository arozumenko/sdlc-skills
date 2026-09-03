# quality-evals — self-benchmarking the manual-qa team

**Status:** dormant until you run it. Nothing here executes automatically.

This skill lets you measure — with a real number, not a vibe — how good
`test-runner` and `test-author` actually are **against your own app**. It's
a generalized, app-agnostic port of an internal evaluation methodology that
was built and refined over months of runs against several real public demo
apps, closing at a 94–100% detection-accuracy and ~91–99% authoring-fidelity
track record once fully scaled. None of that suite-specific content ships
here — what you get is the **mechanism**: the ground-truth schema, the
two-tier scoring approach, and — the part that's easy to get wrong — the
isolation discipline that keeps a self-authored eval honest.

If you've never benchmarked an AI agent against a held-out answer key
before, read this document straight through once. It's long because getting
isolation wrong silently invalidates every score you produce afterward, and
there is no way to notice that from the numbers alone.

## Why two tracks, and why they're scored differently

`test-runner` and `test-author` fail in different ways, so they need
different eval designs:

- **`test-runner`** either notices a problem or it doesn't. There's a
  single correct verdict (PASS/FAIL/BLOCKED) once you already know the
  answer — so detection-track scoring is **fully deterministic**: compare
  the reported result to the known-correct result, no judgment required.
- **`test-author`** produces prose and structure from an ambiguous input.
  There's no single correct `TC-NNN.md` — there's a range of faithful ones
  and a range of unfaithful ones, and telling them apart needs semantic
  judgment a script can't fully automate. So authoring-track scoring is
  **two-tier**: a deterministic Tier A catches structural problems (missing
  frontmatter, a malformed Steps table, a hardcoded domain where
  `{{base_url}}` was required), and a judged Tier B — a rubric, applied by a
  human or a dispatched LLM judge — scores semantic fidelity.

## Recommended layout

Nothing in the scripts hardcodes this exact tree — both scripts accept
`--ground-truth` and `--out-dir` overrides — but this is the layout the
defaults assume, and the one the rest of this document uses. Put it
**outside** `tasks/`, at your project's root (see "Isolation rules" below
for why):

```
quality-evals/
  detection-track/
    ground-truth.json          # per suite -> per TC-ID -> {bug_mode, expected_result, notes}
    runs/
      RUN-DETECT-YYYY-MM-DD-NNN/
        results/<TC-ID>.json     # test-runner's own output JSON, one file per case
    reports/
      <run-id>.json
      all-runs.jsonl
  authoring-track/
    ground-truth.json          # per case-id -> {expected_behavior_count, must_use_placeholder, ...}
    manual-inputs/
      <case-id>.md              # the ONLY file a real eval session may ever be shown
    gold/
      <case-id>.md              # a real, already-trusted TC.md this case was built from
    runs/
      RUN-AUTHOR-YYYY-MM-DD-NNN/
        output/<case-id>/TC-*.md   # what test-author actually produced
        transcript-note.md          # session id, isolation method used
    reports/
      <run-id>.json
      all-runs.jsonl
      judge/<case-id>.json
```

`quality-evals/` is scratch/benchmark infrastructure, not a deliverable —
whether you commit it is your call, but if you do, keep `ground-truth.json`
and `gold/` out of any location an ordinary authoring or test-writing
session would ever `Glob`/`Grep` over (see below).

## Ground-truth taxonomy — `bug_mode`

Every eval case, in either track, is written with one of three intents.
This taxonomy is the whole point of a detection eval — a suite made only of
`scripted-known-good` cases can't tell you whether `test-runner` would
notice a real problem, it can only tell you whether it can follow steps.

| `bug_mode` | Meaning | `expected_result` | What it tests |
|---|---|---|---|
| `scripted-known-good` | An ordinary healthy-app case. Nothing hidden. | `PASS` | Baseline: does the agent execute/author correctly at all |
| `scripted-known-bug` | The case **discloses** a known defect or by-design quirk in its own text/steps ("known issue: ..."). | Whatever the disclosed reality is (often `FAIL`, sometimes `PASS` for a documented non-breaking quirk) | Does the agent handle a disclosed contradiction faithfully, without "fixing" it |
| `blind-detection` | Written to **look** like an ordinary healthy-app case, but a real (or deliberately seeded) bug is present and undisclosed. | `FAIL` (or occasionally `BLOCKED`) | The actual test of independent bug-finding — the agent must notice something nobody told it about |

**`blind-detection` is the one that matters most.** A suite with zero blind
cases can still report a nice-looking pass rate while telling you nothing
about whether `test-runner` would ever catch a real regression. Aim for at
least one blind-detection case per suite once you're past a first pilot,
split between real app-quality gaps you've confirmed and, if useful,
deliberately seeded ones.

A missed blind-detection case (ground truth says `FAIL`, agent reports
`PASS`) is a **false negative** — the single most important number in this
whole methodology. A healthy case wrongly reported `FAIL` is a **false
positive** — less severe, but it erodes trust in the suite if it happens
often.

## Isolation rules — read this before running a real eval case

The entire methodology depends on one property: **the agent being evaluated
must never see the answer key.** This is not paranoia — it is the same
property any honest benchmark requires (held-out test sets, exam grading).
Every rule below exists because a specific leak was found and closed during
the original internal program; they are not theoretical.

1. **Fresh session, every time.** Run each eval case in a session that did
   not build the manual input, has not read the gold file, and is not a
   continuation of a session that did either.
2. **Show the agent only its one input file.** For the authoring track,
   that's the one `manual-inputs/<case-id>.md` for the case you're running —
   never open, paste, or reference the matching `gold/<case-id>.md` in the
   same session. For the detection track, the agent runs the live app the
   normal way — it never sees `ground-truth.json`.
3. **Use a held-out suite/case name that doesn't exist in your real suite
   yet.** `test-author`'s own rules have it mine sibling test cases
   (`Glob tasks/**/TC-*.md`) for conventions before writing anything — that's
   correct, production behavior. If your eval case's suite name matches a
   real suite already in `tasks/`, a narrower `Glob tasks/<suite>/TC-*.md`
   pass can return the case's own answer key. Name it something that
   obviously isn't live yet, e.g. `<real-suite>-holdout` or
   `<real-suite>-eval`.
4. **Explicitly exclude the real suite folder, if one exists, before you
   dispatch.** The held-out name alone does not protect you from the
   *wider*, legitimate, project-wide sibling-mining glob — if your eval
   case was reverse-engineered from a real, currently-existing
   `tasks/<real-suite>/TC-NNN.md`, name that folder as off-limits in your
   dispatch instructions before running, every time. This is the single
   highest-recurrence leak risk in the whole methodology — don't rely on
   rediscovering it per case.
5. **Never let the agent see `quality-evals/` at all.** Add the eval root
   (`quality-evals/authoring-track/gold/`, `.../ground-truth.json`,
   `.../runs/`) to the dispatch's explicit off-limits list, the same way you
   name the real suite folder in rule 4. A broad sibling-mining `Grep`/`Glob`
   can surface these paths' *filenames* even when `Read` access is correctly
   restricted — that's a self-disclosed near-miss, not a leak, but it means
   the boundary needs to be named up front, not discovered after the fact.
6. **No live-fetch of the target app during authoring.** If your
   authoring-track dispatch has any tool capable of reaching the live app
   (curl, a browser tool, an HTTP fetch), forbid using it for this eval.
   `test-author` in production authors from a description, not from
   crawling the app itself — an eval session that live-fetches page content
   to "verify" details is answering a question production `test-author`
   never gets to ask, and silently inflates fidelity scores for reasons that
   won't hold in real use.
7. **Swap the active app profile before running, if you profile multiple
   apps.** `.agents/manual-qa/app_profile.md` is a single active-profile
   slot — make sure it points at the right app for the case you're about to
   run.
8. **Record how you isolated it.** Note the isolation approach used (fresh
   session? which exclusions were named?) somewhere you can find later —
   `transcript-note.md` per run is enough. This matters when interpreting a
   suspiciously perfect (or suspiciously bad) score months later.

If a case's score looks implausibly high, check `possible_gold_leak` in the
Tier A output before trusting it (see Scoring below) — that flag exists
precisely to catch rule 3/4 violations after the fact.

## How to run a detection-track eval

1. Pick (or build) a small suite of `TC-NNN.md` cases against your real
   app — this can be an existing suite in `tasks/<suite>/`, or a fresh one
   built for this purpose. Aim for a mix of `bug_mode`s (see taxonomy
   above); at least one `blind-detection` case is what makes this worth
   doing.
2. Write `quality-evals/detection-track/ground-truth.json` — **before**
   running, and shown to nobody but yourself and this scoring script:

   ```json
   {
     "widgetize-cart": {
       "TC-001": { "bug_mode": "scripted-known-good", "expected_result": "PASS" },
       "TC-002": {
         "bug_mode": "blind-detection",
         "expected_result": "FAIL",
         "notes": "cart badge count fails to increment on a second add — confirmed live 2026-09-01"
       }
     }
   }
   ```

3. Run the suite for real, the normal `test-run-lead` / `test-runner` way,
   against the real app. Nothing about execution changes for this track —
   the eval is entirely in how you grade the output afterward.
4. Save each case's result as its own file under
   `quality-evals/detection-track/runs/<run-id>/results/<TC-ID>.json` — this
   is literally the JSON block `test-runner` already emits at the end of
   each run (see `bundles/manual-qa/agents/test-runner/AGENT.md` "Output
   Format"); just copy it out, one file per case.
5. Score it:

   ```bash
   node scripts/score-test-runner-output.mjs \
     quality-evals/detection-track/runs/RUN-DETECT-2026-09-01-001 \
     --suite widgetize-cart
   ```

   This writes `quality-evals/detection-track/reports/RUN-DETECT-2026-09-01-001.json`
   and prints `detection_accuracy_pct`, `blind_detection_accuracy_pct`, and
   any false negatives/positives to the console.

## How to run an authoring-track eval

1. Pick a real, already-trusted `tasks/<suite>/TC-NNN.md` you want to
   reverse-engineer an eval case from — a good candidate is well-formed and,
   ideally, itself came from a confirmed detection-track finding (a real
   blind-detection twin makes the strongest eval case).
2. Write the **manual input**: strip it back down to what an actual manual
   tester's rough sketch would have looked like — prose, bullets, or a
   simple table — and save it as
   `quality-evals/authoring-track/manual-inputs/<case-id>.md`. If the case
   is a blind-detection twin, the manual input must **not** disclose the
   known issue — write it exactly as a tester who hadn't found the bug yet
   would have.
3. Copy the real `TC-NNN.md`, verbatim and frozen at copy time, to
   `quality-evals/authoring-track/gold/<case-id>.md`.
4. Write the ground-truth entry:

   ```json
   {
     "widgetize-add-item-holdout": {
       "expected_behavior_count": 1,
       "must_use_placeholder": true,
       "expected_teardown": false,
       "gold_path": "authoring-track/gold/widgetize-add-item-holdout.md",
       "known_selectors": ["[data-testid=\"add-to-cart\"]"]
     }
   }
   ```

   Field reference:

   | Field | Meaning |
   |---|---|
   | `expected_behavior_count` | How many `TC-*.md` files a faithful authoring pass should produce for this case |
   | `must_use_placeholder` | Whether every URL must use `{{base_url}}` (almost always `true`) |
   | `expected_teardown` | Whether a meaningful Teardown section is expected (test creates/modifies persistent state) |
   | `gold_path` / `gold_paths` | Path(s) to the gold reference(s), relative to the eval root — used only for the `possible_gold_leak` overlap check, never shown to `test-author`. Use `gold_paths` (array) for a case whose input can legitimately require multiple produced files |
   | `known_selectors` | Selectors/URL patterns your app profile documents for this flow — used to score `selector_reuse` |
   | `input_mode` | `"manual-tc"` (default, omit it) or `"acceptance-criteria"` if you're feeding feature-level AC bullets instead of a tabular case — see `references/judge-rubric.md`'s optional AC section |
   | `note` | Free text — record whether a blind case's issue was already documented in your app profile at case-authoring time (feeds the judge rubric's blind-twin interpretation rule) |

5. Following the isolation rules above, dispatch a **fresh** `test-author`
   session with **only** the manual input file. Save whatever it produces
   to `quality-evals/authoring-track/runs/<run-id>/output/<case-id>/`.
6. Score Tier A:

   ```bash
   node scripts/score-test-author-output.mjs \
     quality-evals/authoring-track/runs/RUN-AUTHOR-2026-09-01-001
   ```

   Writes `quality-evals/authoring-track/reports/RUN-AUTHOR-2026-09-01-001.json`
   with a `deterministic_pass_pct` per case and a `possible_gold_leak_flagged`
   sanity check.
7. Score Tier B: dispatch a fresh judge (a separate session from the one
   that authored the output) with the manual input, the gold reference, and
   the produced output, following `references/judge-rubric.md`. Save its
   JSON verdict to `quality-evals/authoring-track/reports/judge/<case-id>.json`.
8. Compute the headline metric per case (see Scoring below), and average
   across a batch once you're running several cases at a time.

## Scoring

### Tier A — `scripts/score-test-author-output.mjs`

Deterministic structural checks, applied per produced file and rolled up
per case (one malformed file among several drags the whole case's score
down — a split into N files where one is broken should never average away
as "mostly fine"):

- **`frontmatter_complete`** — `id`/`title`/`priority`/`type`/`module` all
  present, `priority`/`type` valid enum values
- **`base_url_used_correctly`** — every URL uses `{{base_url}}`, no
  hardcoded real domain (a documented gloss convention —
  `` `{{base_url}}` (`https://real.host/...`) `` — is not a violation)
- **`steps_table_well_formed`** — a header + separator + ≥1 data row, each
  with exactly 3 non-empty cells
- **`preconditions_present`** / **`expected_final_state_present`** — the
  sections exist and aren't empty
- **`teardown_correct`** — matches the ground truth's `expected_teardown`
  judgment, when the ground truth has an opinion
- **`selector_reuse`** — at least one of `known_selectors` appears in the
  output, when the ground truth lists any
- **`behavior_count_match`** — the number of produced files matches
  `expected_behavior_count`
- **`possible_gold_leak`** — a 5-word-n-gram Jaccard overlap between the
  produced Steps and the gold file's Steps; flagged above `0.6`. This exists
  to catch isolation failures (rules 3/4 above), not to penalize legitimate
  similarity — a small, focused flow can plausibly overlap a lot even
  without a leak, so treat a flag as "go read both files," not an automatic
  fail.

### Tier B — `references/judge-rubric.md`

9 dimensions (18 dimensions x /2 = 18 points), each scored 0/1/2 with cited
evidence: `step_fidelity`, `result_fidelity`, `verifiability`,
`no_hallucination`, `selector_reuse`, `behavior_split`, `teardown_judgment`,
`priority_type_normalization`, `module_naming`. Full descriptions, the
blind-twin-fidelity decision tree, and the optional 10th dimension for
acceptance-criteria input are in that file.

### Headline metric

```
authoring_fidelity_pct =
  round( 100 * ( 0.4 * deterministic_pass_pct/100
               + 0.6 * (judge_total / judge_max) ), 1 )
```

`judge_max` is 18 normally, 20 for acceptance-criteria-input cases (see the
rubric). `blind_twin_fidelity_risk`, `ac_coverage_gap`, and any
`no_hallucination` score of 0 are critical findings — always report them
separately, never let this single formula hide them.

Detection track has no analogous composite — `detection_accuracy_pct` and
`blind_detection_accuracy_pct` (from `score-test-runner-output.mjs`'s
output) are the headline numbers, with `false_negatives` always called out
on their own regardless of how good the overall percentage looks.

## Worked example — "Widgetize," a placeholder app

Neither of the tracks above needs a real target — here's a complete,
runnable pass against a fictional shopping-cart app called Widgetize, using
the exact commands and file shapes this skill expects.

### Detection track

`quality-evals/detection-track/ground-truth.json`:

```json
{
  "widgetize-cart": {
    "TC-001": { "bug_mode": "scripted-known-good", "expected_result": "PASS" },
    "TC-002": {
      "bug_mode": "blind-detection",
      "expected_result": "FAIL",
      "notes": "badge count fails to increment on a second add"
    }
  }
}
```

`quality-evals/detection-track/runs/RUN-DETECT-TEST-001/results/TC-001.json`:

```json
{ "tc_id": "TC-001", "title": "Add item", "result": "PASS" }
```

`quality-evals/detection-track/runs/RUN-DETECT-TEST-001/results/TC-002.json`:

```json
{ "tc_id": "TC-002", "title": "Add item twice", "result": "FAIL", "failure_reason": "badge stayed at 1 after second add" }
```

```bash
node scripts/score-test-runner-output.mjs \
  quality-evals/detection-track/runs/RUN-DETECT-TEST-001 \
  --suite widgetize-cart
```

```
Run: RUN-DETECT-TEST-001  Suite: widgetize-cart
Detection accuracy: 100% (2/2)
Blind-detection accuracy: 100% (1 blind case(s))
```

### Authoring track

`quality-evals/authoring-track/ground-truth.json`:

```json
{
  "widgetize-add-item-holdout": {
    "expected_behavior_count": 1,
    "must_use_placeholder": true,
    "expected_teardown": false
  }
}
```

`quality-evals/authoring-track/manual-inputs/widgetize-add-item-holdout.md`
(the only file a real `test-author` eval session would ever see):

```markdown
Test for adding an item to the cart:
- go to the catalog page
- click "Add to Cart" on the first item
- confirm the cart badge shows 1
```

`quality-evals/authoring-track/runs/RUN-AUTHOR-TEST-001/output/widgetize-add-item-holdout/TC-001_add-item.md`
(what `test-author` produced):

```markdown
---
id: TC-001
title: Add item to cart
priority: high
type: functional
module: cart
---

# TC-001: Add Item to Cart

## Preconditions
- App is accessible at `{{base_url}}`

## Steps

| # | Action | Expected Result |
|---|--------|------------------|
| 1 | Navigate to `{{base_url}}/catalog` | Catalog loads |
| 2 | Click "Add to Cart" on first item | Cart badge shows 1 |

## Expected Final State
Cart badge shows 1 item.
```

```bash
node scripts/score-test-author-output.mjs \
  quality-evals/authoring-track/runs/RUN-AUTHOR-TEST-001
```

```
Run: RUN-AUTHOR-TEST-001
Scored 1/1 cases. Avg deterministic_pass_pct: 100
  widgetize-add-item-holdout: 100%
```

100% Tier A here just means the file is *structurally* sound — a real Tier
B judge pass (`references/judge-rubric.md`) still needs to compare it
against the manual input's intent and a gold reference before you can call
this case's `authoring_fidelity_pct` complete.

## FAQ

**Do I need both tracks?** No — they measure different agents. Run
whichever one matches what you're trying to trust. Most teams find the
detection track cheaper to start with (no gold-file authoring, no judge
pass) and worth doing first.

**How big a suite before the numbers mean anything?** There's no fixed
threshold, but a single case tells you almost nothing — the source
methodology scaled to dozens of cases per app before treating batch
averages as trend data. A small pilot (3-5 cases, including at least one
blind-detection case) is enough to sanity-check the setup before scaling.

**What if my app doesn't use `{{base_url}}`/this exact TC-NNN.md format?**
The scripts read whatever `test-case-format.md`'s conventions this bundle
already uses (see `../../knowledge/test-case-format.md`) — if you've
customized that format, the Tier A checks in
`scripts/score-test-author-output.mjs` will need matching edits (it's a
short, readable file; the checks are independent of each other).

**Can I use this to compare two different models/prompt versions?** Yes —
run the same cases through each, keep the run IDs distinct, and diff the
resulting `reports/*.json` / `reports/all-runs.jsonl`. Nothing here
prevents re-running the same ground truth against multiple `run-id`s.

**Where do I put a real target app's URL?** Nowhere in this skill — the
detection track runs your suite the ordinary `test-run-lead`/`test-runner`
way, against whatever `base_url` you already give them. This skill only
grades the output afterward.

## Testing this skill's own scripts

```bash
node --test scripts/
```

Or, from the repo root: `npm test` (runs every `*.test.mjs` in the repo,
including these).

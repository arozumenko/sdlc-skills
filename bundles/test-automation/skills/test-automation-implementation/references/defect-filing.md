# Defect filing — routing, styles, and bundle-per-case

When you find a defect during a build, this is the full mechanics of *where*
the ticket lands and *what shape* it takes. The engineer's loop (SKILL.md
Phase 5) keeps only the safe defaults; the heavy detail lives here.

Three foundations carry across everything below:

- **File every finding — nothing slips through tracking.** Every finding
  (clarification, question, blocker, full defect) gets tracked somewhere
  the team sees. Don't force-continue past a defect hoping it "probably
  works later." How it's tracked depends on `profile.md`.
- **Pristine-repro gate — simulated input is not a witness until it
  reproduces clean.** Before filing any defect that was (a) first
  observed through simulated input — `dispatchEvent` drags, synthesized
  `DataTransfer`/clipboard writes, force-clicks, JS-evaluated state — or
  (b) observed mid-debugging in a page that had already received
  experimental or unbalanced synthetic input, reproduce it in a **fresh,
  isolated browser context with a single, complete, correctly-ordered
  gesture**. One unbalanced `dragenter` earlier in a session can leave an
  app's internal drag bookkeeping off-by-one for every subsequent,
  individually-correct gesture — a state no real user can produce, and a
  classic source of confidently-filed non-bugs. No pristine repro → treat
  as self-inflicted session state: document it in the Run Report instead
  of filing, and note what was ruled out.
- **Filing is not fixing.** This file hands you the *what* (severity,
  repro, evidence) and the *where* (tracker + style + target); your
  agent's wired bug-filing skill does the *how*. Do not run a dev-side
  fix lifecycle (failing test → RCA → implement fix → verify) — those
  steps belong to whoever picks the defect up later. **You file and walk
  away.**

## Contents

- [Synthetic input hygiene](#synthetic-input-hygiene)
- [Where the ticket lands — issue tracker](#where-the-ticket-lands--issue-tracker)
- [What shape — the three bug-filing styles](#what-shape--the-three-bug-filing-styles)
- [Whether to bundle or split](#whether-to-bundle-or-split)
- [Recording the finding in your deliverable](#recording-the-finding-in-your-deliverable)

## Synthetic input hygiene

Some interactions can't be driven natively (OS-level file drag, clipboard
writes) and need synthesized events (`dispatchEvent` with a constructed
`DataTransfer`, force-clicks, JS-evaluated state). These are not real user
input — sloppy sequences create app states no user can reach:

- **One continuous gesture per `DataTransfer`** — `dragenter → dragover →
  drop` with the same handle. Never start a second gesture (a second
  `dragenter` with no `dragleave`/`drop` ending the first); apps that
  count enter/leave pairs are left permanently desynced.
- **Fresh context per experiment.** While debugging, earlier synthetic
  input in the same page may have poisoned the app's internal state —
  re-verify anything suspicious in a new, isolated context before
  trusting it.
- **A "bug" seen only after synthetic input isn't a bug yet.** It classifies
  as a defect only after passing the pristine-repro gate above.

## Where the ticket lands — issue tracker

Determine **where** the ticket lands by reading `.agents/profile.md`
§ Project systems § Bug filing. Two orthogonal fields drive the routing —
scout's onboarding pass fills both.

**Issue tracker** — the *system* the ticket lands in (`github-issues` /
`gitlab-issues` / `jira` / `azure-devops` / `linear` / …). Your agent
has a bug-filing capability wired in; use it.

If `.agents/profile.md` § Bug filing is `Unconfirmed`, or your agent has
no wired tooling for the named tracker, stop and ask the operator before
filing — don't pick a default silently. Flag the gap in your Run Report so
scout can fill the field on the next onboarding pass.

## What shape — the three bug-filing styles

**Bug filing style** — the *shape* of the ticket. Three styles:

- **`github-issue`** *(default)* — open a standalone issue in the
  tracker named above. Same shape regardless of tracker system (a
  standalone issue in GitHub / GitLab / Jira / …).
- **`story-subtask`** — create a sub-task under the originating story
  (Jira / Azure DevOps only; the story the TMS case is linked to).
  Fetch the story ID via the TMS adapter's `get_test_case_links`, then
  pass it as the parent when handing off to the bug-filing skill.
- **`separate-ticket`** — file in a dedicated QA/bugs project, not the
  main development tracker. Target is named in profile.md § Bug filing
  target. Same tracker system, different project key.

Hand the body, tracker, style, and (for `story-subtask`) parent story ID
to your agent's bug-filing skill.

## Whether to bundle or split

Determine **whether to bundle or split** by reading § Bundling policy and
classifying the finding's severity.

**Classify the finding first:**

- *Lightweight clarification / question* — expected behavior unclear,
  minor UI copy ambiguity, missing doc, "should this modal close on
  outside-click?"-type questions. Case-text drift from the live product
  is this class (SKILL.md § Reverse-masking guard), never a Bug.
- *Real defect* — reproducible bug, functional breakage, incorrect data,
  blocker — anything where the product is provably wrong.

Then apply the policy:

- **`strict-per-bug`** *(default)* — every finding (either class) gets
  its own ticket. Done.
- **`bundle-per-case`** *(opt-in, requires umbrella-ticket convention
  already in place on the project)*:
  - If the finding is a *real defect* → its own ticket (same as
    strict-per-bug). Real defects never bundle.
  - If the finding is a *lightweight clarification* → check if there's
    already an open "umbrella" ticket for this case.
    - If yes: add the finding as a comment on the existing ticket.
    - If no: file a new umbrella ticket (title e.g. "Clarifications for
      SCRUM-T101") and make this the first comment. Future lightweight
      findings on the same case attach here.

The umbrella-lookup is the fragile step — getting it wrong duplicates
tickets. Defer to `strict-per-bug` unless the operator's `profile.md
§ Bug filing style` explicitly selects `bundle-per-case` **and** the
project already has both prerequisites:

- A title convention for umbrella tickets (so the find-or-create search
  has something stable to match on).
- A documented comment-anchor format that can be referenced from the
  test code and Run Report (e.g. "comment-3" or a permalink fragment).

Without both, `strict-per-bug` is the safe default; one more ticket is
cheaper than a missed clarification.

## Recording the finding in your deliverable

Three places, each with a job:

- **The spec** — `// Known defect: <TICKET>` beside the `expect.soft()`
  (isolated), and for an excluded step the coverage declaration's
  `blocked-by-defect` line with the ticket id as its referent
  (SKILL.md § Coverage declaration).
- **The Run Report** — the ticket ID, filing style, and the handling
  (soft-expect for isolated, natural-fail for blocking); a soft-expected
  defect is also declared in `expected_red[]`.
- Under `bundle-per-case`, reference both the umbrella ticket ID and the
  comment anchor so a reader can find the specific note (e.g. "Known
  defect: JIRA SCRUM-BUG-42 comment-3 — soft-expect", or "Known defect:
  GH#234 — natural-fail").

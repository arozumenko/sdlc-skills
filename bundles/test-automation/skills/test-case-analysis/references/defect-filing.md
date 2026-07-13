# Defect filing — routing, styles, and bundle-per-case

When you find a defect during execution, this is the full mechanics of
*where* the ticket lands and *what shape* it takes. The analyst's primary
loop (SKILL.md § 5 Classify findings) keeps only the safe defaults; the
heavy detail lives here.

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
  as self-inflicted session state: document it in the AFS (or the run
  report) instead of filing, and note what was ruled out.
- **Filing is not this skill's job.** This skill hands you the *what*
  (severity, repro, evidence) and the *where* (tracker + style + target);
  your agent's wired bug-filing skill does the *how*. Do not run a
  dev-side fix lifecycle (failing test → RCA → implement fix → verify) —
  those steps belong to whoever picks the defect up later, not to you
  during analysis. You file and walk away.

## Contents

- [Where the ticket lands — issue tracker](#where-the-ticket-lands--issue-tracker)
- [What shape — the three bug-filing styles](#what-shape--the-three-bug-filing-styles)
- [Whether to bundle or split](#whether-to-bundle-or-split)
- [Recording the finding in the AFS](#recording-the-finding-in-the-afs)

## Where the ticket lands — issue tracker

Determine **where** the ticket lands by reading `.agents/profile.md`
§ Project systems § Bug filing. Two orthogonal fields drive the routing —
scout's Step 0.7 fills both.

**Issue tracker** — the *system* the ticket lands in (`github-issues` /
`gitlab-issues` / `jira` / `azure-devops` / `linear` / …). Your agent
has a bug-filing capability wired in; use it.

If `.agents/profile.md` § Bug filing is `Unconfirmed`, or your agent has
no wired tooling for the named tracker, stop and ask the operator before
filing — don't pick a default silently. Flag the gap in the AFS so scout
can fill the field on the next onboarding pass.

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
  outside-click?"-type questions.
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
    already an open "umbrella" ticket for this TMS case.
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
- A documented comment-anchor format that the analyst can reference from
  the AFS (e.g. "comment-3" or a permalink fragment).

Without both, `strict-per-bug` is the safe default; one more ticket is
cheaper than a missed clarification.

## Recording the finding in the AFS

Note the finding in the AFS under "Known Defects Found" with the ticket
ID, filing style, and a recommendation — soft-expect (isolated) or
natural-fail (blocking). Under `bundle-per-case`, reference both the
umbrella ticket ID and the comment anchor so the downstream implementer
can find the specific note (e.g. "Known defect: JIRA SCRUM-BUG-42
comment-3 — soft-expect", or "Known defect: GH#234 — natural-fail").

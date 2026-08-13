---
name: stakeholder-interview
description: Use when a stakeholder conversation, customer meeting, or user session is being planned or has just happened — even if the user only says 'I'm meeting them Thursday' or pastes raw notes. Runs two modes — PREPARE aggregates every open question, untested critical assumption, and unresolved escalation across the workspace into a themed, value-of-information-ordered guide filtered to what THIS interviewee can answer; SYNTHESIZE turns raw notes or a transcript into a durable evidence file and propagates the answers into the hypotheses they touch (evidence links, assumption verdicts, resolved questions). Trigger phrases — 'prep the interview', 'what should I ask', 'here are my notes', 'synthesize this interview', 'we talked to the customer'. NOT for triaging raw feature asks (intake-triage), NOT for team-internal meeting minutes, and NOT for fact-checking a document (deep-research factcheck mode).
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# stakeholder-interview

Discovery without the customer in the room is desk research. This skill closes the loop in both directions: **prepare** makes sure an interview extracts maximum value from limited stakeholder access; **synthesize** makes sure what was learned actually lands in the workspace instead of evaporating in a notes file.

**Audience calibration:** the product owner is a senior product professional who knows how to run an interview. The value here is *aggregation* (mode 1) and *filing + propagation* (mode 2): the mechanical work the toolchain should do for them.

## What this skill reads (config, by name)

From `.agents/profile.md` and the project's `docs/` — read for the persona cast (used to
filter questions to what an interviewee's role can actually answer and to name interviewees
by role) and the confidentiality convention (committed records refer to people by role;
name-bearing raw material lives only in the confidential `docs/discovery/_inbox/` zone).

And these `docs/discovery/` locations: `hypotheses/` (open questions, untested assumptions —
the `status:` lifecycle is a frontmatter field, not a folder), `problems/` (unvalidated pain),
`evidence/intake/`, `evidence/verifications/`, `evidence/research/`, `evidence/learnings/`, and
`evidence/interviews/` (this skill's own write target).

## Mode detection

- Upcoming conversation mentioned, or "what should I ask" → **prepare**.
- Raw notes/transcript provided (pasted, or a file in `docs/discovery/_inbox/transcripts/` or
  anywhere else) → **synthesize**.
- Both in one session is normal: prepare before, synthesize after.

## Step 0 — consult relevant lessons (by tag)

Grep `docs/discovery/evidence/learnings/` by **topic tag** for any recorded lesson matching this
interviewee's persona and subject — a question a prior lesson already answered does not belong
in the room, in either mode. This is background evidence-gathering, not a hard requirement —
skip it if no learnings exist yet.

## Mode: prepare

1. Run Step 0 against this interviewee's persona and subject tags first.
2. Sweep the workspace for everything only this stakeholder can answer:
   - `## Open questions` sections in every `docs/discovery/hypotheses/` file with
     `status: incubating`.
   - `Assumptions` bullets flagged `risk: critical` that are still untested.
   - The "collect more signal" queue from recent `docs/discovery/evidence/intake/` triage
     records — items parked for evidence-gathering land here for exactly this sweep.
   - "Open questions to escalate" entries in recent `docs/discovery/evidence/verifications/` and
     `docs/discovery/evidence/research/` reports.
   - Problem statements in `docs/discovery/problems/` resting on unvalidated pain.
   - Any standing question bank noted in `.agents/profile.md` (if one exists) — reuse, don't
     re-invent; note which bank questions are already covered by the workspace-derived ones.
3. Filter to what THIS interviewee's persona can actually answer (an end user can't confirm a
   compliance lawful basis; an admin can't validate whether a workflow overlay is worth the
   screen space). Say who the dropped questions belong to instead.
4. Group by theme, ordered by value-of-information: the question whose answer kills or saves the
   biggest bet goes early, logistics go last.
5. For every question, record *why it's being asked*: `→ tests HYP-0004/A2` or `→ validates
   problems/<slug>.md`. This is what makes synthesize mode mechanical later.
6. Write the guide to `docs/discovery/evidence/interviews/<YYYY-MM-DD>_<role>_guide.md` using
   [`assets/interview-guide-template.md`](assets/interview-guide-template.md). The template
   folds in the Mom-Test in-room craft (probing moves, past-behavior-only, listen 80 / talk 20)
   — a reference for the room, not a script to read out.
7. **Checkpoint progress.** Right after the guide is written — a write worth not losing to a
   mid-session interruption — invoke the `memory` skill's **Log** op noting the guide path and
   which questions it carries, so work resumes cleanly if the session breaks here.

## Mode: synthesize

1. Read the raw notes. If they live in `docs/discovery/_inbox/` (the confidential zone), treat
   that copy as immutable — never edit the original, and never move raw confidential material
   out of `_inbox/`.
2. Write the evidence file to `docs/discovery/evidence/interviews/<YYYY-MM-DD>_<role>.md` using
   [`assets/interview-evidence-template.md`](assets/interview-evidence-template.md). One file per
   interview.
3. **Redaction hygiene on our own artifact:** identify interviewees by *role* (e.g. `team-lead`),
   not by full name, unless the user explicitly says the name may be recorded — the
   confidentiality convention in `.agents/profile.md` governs this. Content about identifiable
   individuals may be personal data; flag it rather than paraphrasing it into a committed file.
4. Distinguish rigorously: **[QUOTE]** (verbatim, attributed to the role) vs **[PARAPHRASE]** vs
   **[INFERENCE]** (yours). A quote can be cited by a hypothesis for years; an inference dressed
   as a quote poisons every downstream decision.
5. Propagate — inline, as each mapping crystallizes (don't batch to the end):
   - Add the interview file to the `evidence:` list of every hypothesis it touches in
     `docs/discovery/hypotheses/`; bump `last_touched`.
   - Raise the matching `confidence:` dimension where the evidence actually earns it — quantified
     answers move a bet into the data-backed band, a single anecdote does not. This is the step
     that makes verification show up in the score: `prioritize-bets` reads only the
     `confidence:` block, so evidence that never lands there leaves the ranking on a stale
     pre-verification band. Leave the dimension alone rather than nudging it on thin signal.
   - Where an answer **confirms** an assumption: note it on the assumption bullet (`—
     validated: evidence/interviews/<file>`).
   - Where an answer **breaks** an assumption: edit the hypothesis to say so, and offer
     `capture-learning` — a killed assumption with a recorded reason is the most valuable
     artifact discovery produces.
   - Where an answer resolves an `## Open questions` entry: resolve it in place with a link.
   - Where an answer contradicts a recorded decision (`docs/discovery/decisions.md`), a
     journey, or the project vocabulary: **surface the conflict, don't silently resolve it** —
     that is a session for `grill-decision`.
   - **Checkpoint the write.** Right after each propagation — a write worth not losing to a
     mid-session interruption — invoke the `memory` skill's **Log** op noting which hypothesis
     or question was just updated, so work resumes cleanly if the session breaks here.
6. End with the unanswered questions from the guide — they seed the next interview's prepare
   pass.

## Rules

- **Never invent answers.** A question the interviewee didn't address stays open. "They
  probably meant…" is an inference and gets labeled as one.
- **One interview, one file.** Merged multi-session files make citations ambiguous.
- **Quotes are sacred.** If a quote is in another language, keep the original alongside any
  translation — nuance dies in translation and domain terms are load-bearing.
- **Propagation is the point.** An interview file nothing links to is a notes graveyard. If
  after synthesis no hypothesis was touched, **say so explicitly** — that itself is a finding
  (the interview tested nothing the workspace cares about, which means prepare mode was skipped
  or the bets are misaimed).
- **People by role, names to `_inbox/` only.** Non-negotiable — no personal name ever reaches a
  committed file.

## Pairs well with

- **Before** an interview: `discovery-status` shows where each hypothesis is stuck and which
  questions are still open; prepare mode sweeps exactly those open questions. `intake-triage`'s
  Collect-More-Signal queue also feeds prepare mode.
- **After** synthesize: `verifying-outcomes` on any hypothesis whose riskiest assumption just
  changed; `capture-learning` for killed assumptions; `grill-decision` for surfaced
  contradictions.

---

> Provenance: house-authored for this product (© Peter Petroczy). In-room interview craft — the five probing moves and Mom-Test rules folded into the guide template — adapted from phuryn/pm-skills (MIT, © Pawel Huryn). See NOTICE.md.

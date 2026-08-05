---
name: define-personas
description: >-
  Create and maintain the canonical persona cards under docs/discovery/personas/ —
  one file per persona, each with its app surface, goals, pains,
  jobs-to-be-done, and evidence links — so journeys, hypotheses, and BDD
  scenarios reference stable persona slugs instead of drifting ad-hoc actor
  names. Use whenever personas come up — "define the personas", "who are our
  users", "make a persona card for X", "which persona owns this journey" — and
  proactively whenever a journey, BDD scenario, or hypothesis names an actor
  that has no card yet or spells one inconsistently. NOT for org-chart or
  stakeholder-power mapping, and NOT for market-segmentation research
  (deep-research).
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# define-personas

Journeys, BDD scenarios, and hypotheses all name actors. Without one canonical card per actor, the names drift ("Admin" vs "Workspace Admin" vs "Amin"), scope questions become unanswerable ("is provisioning the admin's job or the operator's?" is a *persona* question), and every artifact re-describes its user from scratch.

**Audience calibration:** the product owner is a senior product professional — this is not a persona workshop and needs no method guidance. It is a **filing surface**: their persona knowledge, written once, referenceable forever by slug.

## The card

One file per persona: `docs/discovery/personas/<slug>.md`, from [`assets/persona-template.md`](assets/persona-template.md). Slugs are kebab-case and canonical (`team-lead`, `workspace-admin`) — once minted, other artifacts reference them, so renames are breaking changes and deserve the same care as an ID change.

## Seeding (first run)

The journeys already imply the cast, and `.agents/profile.md` plus the project's `docs/` name the rest. Propose the card list before writing anything, drawn from:

- The seed cast named in `.agents/profile.md` / the project's `docs/` (slug, name, surface, one-liner) — the adopter's declared starting roster.
- Actors extracted from every journey in `docs/discovery/journeys/`, the BDD scenarios (if present), and the hypotheses.

Keep a **data-subject persona** whenever personal data flows through the product (pairs with the project's compliance guardrails): the person whose data the platform processes even though they never sign in. Making them a card turns the privacy question ("what does this feature mean for the data subject?") into a routine lookup instead of an afterthought.

## Rules

- **Every claim is evidenced or labeled.** A goal/pain cites a journey, interview, or `docs/discovery/evidence/` page — or carries `(assumption)`. Cards full of unlabeled assumptions are fiction with a nice layout; the labels tell `stakeholder-interview` prepare mode what to go validate.
- **App surface is mandatory.** Its value comes from the surfaces this product owns (from `.agents/profile.md` / the project's `docs/`, plus `none`) — most scope-boundary confusion is "right feature, wrong surface," and the persona card is where that gets settled once.
- **Fix drift when you see it.** If artifacts spell an actor inconsistently, align them to the card's slug — inline, as found.
- **Personas don't multiply.** A new card needs a genuinely distinct goal-set, not a job-title variation. When in doubt, add a variant note to an existing card.
- **Confirm before writing.** Propose the cast; create files only on the PO's go. Right after each card is written — a write worth not losing to a mid-batch interruption — invoke the `memory` skill's **Log** op noting which card was just filed, so work resumes cleanly if the session breaks here.

## Pairs well with

- **Feeds** `journeys-to-hypotheses` (journeys classify by persona + surface) and `stakeholder-interview` (prepare mode filters questions by what the interviewee's persona can answer).
- **After** an interview that changed a persona's picture: update the card, not just the hypothesis.

---

> Provenance: house-authored for this product (© Peter Petroczy). See NOTICE.md.

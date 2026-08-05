---
name: intake-triage
description: The front door for raw asks — use whenever feature requests, stakeholder asks, support themes, or "someone wants X" arrive, before anything becomes a Problem or Hypothesis. Verdicts every item Act Now / Plan Next / Collect More Signal / Decline-or-Defer, writes one batch record, and mints accepted in-scope items as Problems carrying discovered_from provenance. Out-of-scope asks are declined quoting the scope line; raw material naming a person stays in the confidential inbox and records refer by role. Trigger phrases — "triage these requests", "here are the asks from the sales call", "someone wants X — what do we do with it", "sort these into the pipeline". NOT for interview synthesis (that is stakeholder-interview), NOT for bug or support-ticket triage, and NOT for meeting minutes.
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# intake-triage

The **front door**. Every raw ask — a stakeholder request, a support theme, a "someone
wants X" — enters the pipeline through here and leaves with exactly one of four verdicts.
Accepted asks become **Problems** (never Hypotheses directly), and every Problem it mints
carries a `discovered_from:` edge back to the batch record — so the provenance chain the
pipeline depends on starts at the moment an ask arrives, not three artifacts later.

**Problem-first, always.** This skill mints Problems. It never mints a Hypothesis — a bet with
no stated problem is exactly the orphan solution the pipeline exists to prevent. Turning a
Problem into a bet is `journeys-to-hypotheses`'s job, later.

## What this skill reads (config, by name)

From `.agents/profile.md` and the project's `docs/` — read for:

- **Scope** — the in-scope / out-of-scope lines for this product (an ask that breaches the
  out-of-scope line is fast-pathed to Decline-or-Defer, and the decline **quotes that line
  verbatim**), the surfaces this product owns (an ask aimed at no surface this product owns
  is out of scope), and the stakeholder/persona cast (used to name a requester by **role**).
- **Confidentiality convention** — when raw material names a person, the committed record
  refers to people by role, never by name; name-bearing raw material lives only in the
  confidential `docs/discovery/_inbox/` zone.

And these `docs/discovery/` locations: `evidence/intake/` (the batch record lands here),
`problems/` (minted Problems), and `_inbox/` (the gitignored confidential zone — raw,
name-bearing material only).

## Step 0 — consult relevant lessons (by tag)

Grep `docs/discovery/evidence/learnings/` by **topic tag** for any recorded lesson about the
subject area of the batch (a request type that always turned out to be out of scope, a signal
that reliably under- or over-counted). Let it sharpen your rationale. This is background
evidence-gathering, not a hard requirement — skip it if no learnings exist yet.

## Process

### 1. Gather the batch
Collect the raw asks into a single list — from the chat, a pasted dump, or a stakeholder note.
One triage run = one batch = one record. If the asks arrived in a file that names people, treat
that file as confidential (step 4) from the start.

### 2. Verdict each item — the four tiers
Assign every ask exactly one verdict, applying the criteria in
[`references/triage-rubric.md`](references/triage-rubric.md):

- **Act Now** — clear value, in scope, evidence already exists; worth a Problem today.
- **Plan Next** — clear value and in scope, but sequenced behind current work; mint the Problem,
  do not act yet.
- **Collect More Signal** — plausibly valuable but under-evidenced (no clear requester, no "why",
  a single anecdote). This is the honest middle: it routes to evidence-gathering, not a forced
  yes/no. Append it to the open-questions queue that **stakeholder-interview**'s prep step
  sweeps.
- **Decline-or-Defer** — out of scope, duplicate of an existing artifact, or genuinely low value.
  Say which, plainly.

Report the batch as a table (ask · requester role · frequency/signal · verdict · one-line
rationale) before writing anything.

### 3. Scope check — the fast path
Before scoring value, test each ask against the project's out-of-scope line and the surfaces
this product owns (from `.agents/profile.md` / project `docs/`). An ask that breaches the
out-of-scope line, or targets no surface this product owns, is **Decline-or-Defer** regardless
of how good it is — and the decline **quotes the exact out-of-scope line** so the requester
sees the boundary, not your opinion. Do not soften it and do not mint a Problem for it.

### 4. PII / confidentiality rule
If raw material **names a person** (a customer, a requester, a colleague), the confidentiality
convention applies:

- The committed intake record and any minted Problem refer to people **by role only** — "head
  of support", "a pilot customer", "the team lead" — drawn from the stakeholder cast.
- Name-bearing raw material that must be kept goes **only** to the confidential
  `docs/discovery/_inbox/` zone (gitignored, manual convention — redact before anything leaves
  it). Never copy it into a committed file, and never restate a name in your own narration.

### 5. Confirm before creating anything (human checkpoint)
Present the verdict table and say which asks you will mint as Problems and which you will decline
or queue — then **stop for the PO's confirmation**. Carry-forward default: "Confirm, or tell me
which verdicts to change — I mint nothing until you do." No files exist before this turn.

### 6. Write the batch record
On confirmation, write **one** record to `docs/discovery/evidence/intake/<date>-<slug>.md` from
[`assets/intake-record-template.md`](assets/intake-record-template.md) (`type: intake`). It is an
episodic file: append-only, immutable once filed (a correction is a new record with
`supersedes:`). Its body holds the full verdict table; its `x_source` names the source by role.

### 7. Mint accepted items as Problems
For each **Act Now** / **Plan Next** ask, write a Problem to
`docs/discovery/problems/PRB-NNN-<slug>.md` from
[`assets/problem-template.md`](assets/problem-template.md):

- `type: problem`, a zero-padded `id` following `PRB-NNN` — scan `docs/discovery/problems/` for
  the highest existing `PRB-NNN` and use the next number — a one-sentence problem `title` (a
  customer **need**, not a feature), `status: active`.
- **`discovered_from:`** = the path of the batch record from step 6 — the provenance edge. A
  Problem minted here that cannot point back at its record is a broken chain.
- Leave `node_type:` / `parent:` unset — placing the Problem in the opportunity tree is
  `opportunity-tree`'s job, on its own turn.

### 8. Checkpoint progress
Right after minting — this write is irreversible and a mid-batch interruption should not lose it —
invoke the `memory` skill's **Log** op noting the batch record path and which Problems were just
minted, so work resumes cleanly if the session breaks here.

### 9. Route the queue
Add every **Collect More Signal** ask to the open-questions queue (a bullet under the intake
record's `## Collect More Signal queue`) so the next `stakeholder-interview` prep run picks it
up. Nothing is silently dropped.

### 10. Report and hand back
Print what changed (the record path, each minted Problem, each decline with its scope citation,
the queued items) and the next step: minted Problems are ready for `define-personas` /
`stakeholder-interview` to gather evidence, then `journeys-to-hypotheses` to shape a bet.
**Never `git commit` or `git push`** — committing is a human-confirmed action.

## Rules

- **Problem-first.** Accepted asks become Problems, never Hypotheses. No orphan solutions at the
  front door.
- **Every mint carries provenance.** A minted Problem without a resolvable `discovered_from:`
  back to its batch record is a bug, not a shortcut.
- **The scope line is the project's, not yours.** Out-of-scope declines quote the project's
  out-of-scope line verbatim; you do not invent scope.
- **People by role, names to `_inbox/` only.** Non-negotiable — no personal name ever reaches a
  committed file.
- **Confirm before creating.** No record and no Problem exists before the PO's explicit confirm
  turn.
- **Collect More Signal is a real verdict.** Under-evidenced asks route to evidence-gathering;
  they are never forced into a yes/no.

## Pairs well with

- **Feeds** `define-personas` and `stakeholder-interview` — minted Problems need evidence, and
  the Collect-More-Signal queue is swept by `stakeholder-interview` prep.
- **Then** `journeys-to-hypotheses` turns an evidenced Problem into incubating hypotheses.
- **`opportunity-tree`** later parents each Problem under a ratified outcome (`node_type:` /
  `parent:`); **`define-outcomes`** ratifies the outcome those Problems serve.

---

> Provenance: house-authored for this product (© Peter Petroczy). The four-tier verdict vocabulary — Act Now / Plan Next / Collect More Signal / Decline-or-Defer, with "Collect More Signal" as the honest middle state — is adapted from phuryn/pm-skills@18468a95b427e70e258b51389796367c6f684e7d (MIT, © Pawel Huryn); the write-through with provenance is house-authored. See NOTICE.md.

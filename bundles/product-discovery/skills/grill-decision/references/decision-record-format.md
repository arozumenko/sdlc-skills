# Decision entry (DEC) format

The one decision log for this product: `docs/discovery/decisions.md`, an append-only markdown
table. Product, architecture, and process decisions all live here, as rows in one stream —
never as a parallel numbering scheme or a second file. The scaffold ships the header:

```markdown
# Decisions

Append-only DEC log.

| id | date | decision | rationale | supersedes |
|---|---|---|---|---|
```

## Numbering

- Format: `DEC-NNN` (3-digit zero-padded), matching the `PRB-NNN` / `HYP-NNN` convention used
  elsewhere in `docs/discovery/`.
- **Compute the next id — never hand-number:** scan `docs/discovery/decisions.md` for the
  highest existing `DEC-NNN` in the `id` column and use the next number. A literal "highest"
  rots the moment two sessions write concurrently — **re-check for a collision** (grep the file
  for the id you're about to use) immediately before appending; if it already exists, stop and
  report it rather than overwriting. IDs are never renumbered and never reused.

## The row (fill every column)

| Column | What it holds |
|---|---|
| **id** | `DEC-NNN`, allocated per *Numbering* above. |
| **date** | the date the row was written (`YYYY-MM-DD`). |
| **decision** | the choice, stated plainly in one sentence — what was decided, not the debate around it. |
| **rationale** | why: the forces in play, the real alternatives considered and the specific trade-off each lost on, and what this makes easier, harder, or newly required. Compressed into the cell, but every element (context, rejected alternatives, consequences) must be present — an alternatives-free rationale means the gate below wasn't actually met. |
| **supersedes** | empty, or the `DEC-NNN` this row replaces. |

## The status gate — the PDR 3-criteria test

A row is warranted only if **all three** hold, or the decision resolves a standing one that
needs revisiting:

1. **Hard to reverse?** — meaningful cost to change later (lock-in, data migration, contracts).
2. **Surprising to a newcomer?** — a future reader will wonder "why did they do it this way?"
3. **A real trade-off was rejected?** — genuine alternatives existed and one was chosen for
   specific reasons.

A decision with no downside is not a real decision — capture it as a sharpened term (correct it
in place where it lives) or as a learning instead of a DEC row.

## Superseding

The log is append-only — a decision is never deleted or edited once written. To change course:

1. Append a **new** row with the updated decision and its own rationale.
2. Set the new row's **supersedes** column to the id of the row it replaces.
3. Do not touch the old row. The pointer chain plus git history is the audit trail — reading
   `decisions.md` top to bottom (or grepping for a `supersedes` pointer) tells you which rows are
   current and which were replaced.

Supersede chains must stay acyclic — a row's `supersedes` id must never, through any chain,
point back at itself.

## Referencing a decision that hasn't been made yet

Work that depends on a call not yet recorded is tagged in place with the project's
pending-decision marker (from `.agents/profile.md`, or generalized as
`// PENDING_DECISION_DEC-NNN: assuming [option] because [reason]` if the project has none of its
own). Never assume an unmarked assumption is a resolved decision — if it isn't a row in
`decisions.md`, it isn't decided.

## Do not commit

Writing the row is where this skill stops. Committing is a human-confirmed action — never
`git add` / `git commit` / `git push`.

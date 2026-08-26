<!--
  priority-board.md — the template for docs/discovery/priority.md, the derived rank board.
  prioritize-bets REGENERATES this file wholesale on the PO's confirm. It is generated, never
  hand-edited — the authoritative store is each hypothesis's own `priority:` frontmatter; this
  board is a convenient read view over those same numbers.

  Rows are ordered by rank ascending. One row per scored bet. A gut-band bet keeps its ⚠️.
  Values below are illustrative — replace the whole body on each generation.
-->
# Priority board

> Derived by `prioritize-bets` — do not hand-edit; the next run overwrites this file.
> Framework: **RICE** (from `.agents/profile.md`'s `prioritization:` note, or the RICE default
> when that note is absent).

| rank | id | bet | score | band | appetite | note |
|---:|---|---|---:|---|---|---|
| 1 | HYP-001 | A guided first-run flow (`docs/discovery/hypotheses/HYP-001-guided-first-run.md`) | 80 | data-backed | 4-weeks | confidence 0.8 from mean 6.0 |
| 2 | HYP-002 | Scheduled exports (`docs/discovery/hypotheses/HYP-002-scheduled-exports.md`) | 40 | ⚠️ gut | 2-weeks | ranking on gut feel — collect evidence or proceed knowingly |

**⚠️ Gut-band bets** (ranked on unvalidated confidence): HYP-002. Collect evidence on it (a
verification/challenge pass), or proceed knowingly.

_Scored on 2026-08-01. Re-run `prioritize-bets` after any bet's evidence band moves._

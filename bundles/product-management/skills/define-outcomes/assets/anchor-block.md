<!--
  Canonical outcome-anchor shape. define-outcomes writes this VERBATIM into
  docs/discovery/outcomes.md — the field set is the single home. The status
  column is the promotion gate:
    status: draft       = drafted only, the gate never accepts it
    status: active       = ratified, with a ratified:: stamp, promotable-against
    status: superseded   = historical; kept, never deleted, never promotable-against
  Fill every field before ratifying; a draft row may hold placeholders and
  `baseline: unmeasured` until it is measured and the PO ratifies it.
-->

<!-- One row per anchor in the register's table: -->
| id | outcome | baseline (dated) | target | timeframe | status |
|---|---|---|---|---|---|
| {{kebab-anchor-id}} | {{one sentence: WHO does WHAT observable behavior, by when}} | {{measured value (date), or "unmeasured"}} | {{the value this becomes if the bet works}} | {{YYYY-Qn}} | {{draft \| active \| superseded}} |

<!-- One detail block per row, appended under the table, holding the fields
     the summary table has no column for: -->
## {{kebab-anchor-id}} — detail
- metric_type:: product-outcome            <!-- always product-outcome; traction is lagging_confirmation, never the anchor -->
- parent_north_star:: [[#north-star]]
- owner:: {{the person/role who tracks this anchor}}
- leading_indicators:: {{early signals that predict the target moving}}
- lagging_confirmation:: {{the business/traction number this behavior should later show up in}}
- counter_metric:: {{the number that moves the WRONG way if the anchor is gamed}}
- why:: {{why moving this behavior means customers are better off — link the Problem / evidence}}
- ratified:: {{YYYY-MM-DD}} by {{product owner name, verbatim from .agents/profile.md}}   <!-- only once status: active -->
<!-- On superseding a ratified anchor (target/metric change) — a NEW row + detail block, plus edits to the old one:
     new detail block adds:  - supersedes:: {{old-id}}
     old detail block keeps every field, and gains:
                             - superseded:: {{YYYY-MM-DD}} by {{new-id}}
     the old row's table status becomes: superseded. Never delete the old row/block;
     the chain is the audit trail. -->

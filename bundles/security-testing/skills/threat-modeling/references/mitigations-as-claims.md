# Mitigations as claims

A mitigation in the model is **a claim, not a fact**: a sentence that
says what the code does about a threat, with the lines that would prove
it. Whether it holds is decided by a fresh `security-reviewer` under the
`mitigation-review` contract, whose receipt `receipt apply` turns into a
derived state. You never grade your own claim, and no state is ever
written into the model.

## Shape

```json
{
  "id": "M-001",
  "claim": "The server recomputes the order total from line items before charging",
  "citation": { "path": "src/orders.js", "side": "head", "lines": [40, 52] }
}
```

- `id` — `M-` plus three digits, **unique across the whole model** (a
  mitigation defined under two threats is `TM-INVALID(T-nnn: mitigation
  M-nnn is already defined under T-mmm)`; give the second threat its own
  mitigation that cites the same lines).
- `claim` — one indicative sentence, non-empty (`claim is empty`
  otherwise), checkable against the citation alone: a reviewer with only
  the packet must be able to confirm or refute it.
- `citation` — optional; the same range rule as an element's (≤ 40 lines,
  inside an admitted range of a scope file, no dirty file). Cite a
  mitigation so the packet holds the check **and** where it is applied, in
  one ≤ 40-line range: a reviewer who sees only the call site of a
  predicate (or only the predicate, never its use) cannot confirm the
  claim and answers `indeterminate`; the snapshot is write-once, so a
  narrower citation than that costs the lead a whole new run. A mitigation
  without a citation is a claim about something outside the scope (a
  platform control, a contract); it can be listed but it can never be
  reviewed — `packet --kind subject --subject M-nnn` refuses it — and so
  never validates a `mitigated` disposition.

## Writing a claim the reviewer can decide

| Weak | Why | Better |
|---|---|---|
| "Input is validated" | which input, against what | "`createOrder` rejects a body whose `items[].qty` is not a positive integer (lines 12–19)" |
| "Uses parameterised queries" | the reviewer must find them | "`find` binds `req.query.id` as `$1` (line 4)" |
| "Auth middleware protects the route" | protects against what | "`requireRole('admin')` runs before `exportOrders` for every method (router line 8)" |
| "Rate limited" | at which layer, on what key | "the `/login` route is limited to 10/min per IP by `limiter` (lines 30–34)" |

## The review, in the lead's hands

1. After `tm-lint check` has snapshotted the model (structure valid), the
   lead runs `evidence.mjs packet --run <run_id> --kind subject --subject
   M-nnn` — the packet carries exactly the mitigation's cited range.
2. A **fresh** `security-reviewer` dispatch reads only the packet and drops
   a receipt `{type: mitigation-review, subject_id: M-nnn, packet_sha256,
   assertion: confirmed | gap | indeterminate, reviewer_run_id}`.
3. `evidence.mjs receipt validate --run <run_id> <receipt>` admits it;
   `receipt apply` derives `MITIGATION_CONFIRMED | MITIGATION_GAP |
   MITIGATION_INDETERMINATE`. That derived state — never your word — is
   what `mitigated(M-nnn)` needs (see `dispositions.md`).
4. The report shows every mitigation with its state, or the wording
   `not independently reviewed` when no receipt was applied. Neither is
   a blank, and neither is "mitigated" until the receipt says `confirmed`.

## What a `gap` means for the model

A `MITIGATION_GAP` does not remove the mitigation: the claim stays in the
model with its state, the threat stays `undisposed` (or becomes
`planned` / `ticketed` once the lead acts), and the next assessment's
model can restate the claim against the fixed lines. A mitigation is
evidence about the code at `head_oid`; the register carries the risk
across runs.

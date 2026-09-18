# Mitigations as claims

A mitigation in the model is **a claim, not a fact**: a sentence that says
what the code does about a threat, with the lines that would prove it.
Whether it holds is a fresh `security-reviewer`'s call under the
`mitigation-review` contract — you never grade your own claim, and no
state is ever written into the model by that review.

## Shape

```json
{
  "id": "M-001",
  "claim": "The server recomputes the order total from line items before charging",
  "citations": [{ "path": "src/orders.js", "lines": [40, 52], "snippet": "…pasted from `show`…" }]
}
```

- `id` — `M-` plus three digits, **unique across the whole model** (shared
  with `E-nnn`/`T-nnn`): reusing a spelling under a second threat is
  `TM-INVALID <id>: duplicate id` — give the second threat its own
  mitigation id that cites the same lines.
- `claim` — one indicative sentence, non-empty
  (`TM-INVALID <id>: empty claim` otherwise), checkable against the
  citation alone: a reviewer with only the cited lines must be able to
  confirm or refute it.
- `citations` — required, same shape and range rule as an element's (≤ 40
  lines, under `scope_paths`); a mitigation with none is
  `TM-INVALID <id>: no citation`. Cite a mitigation so the range holds
  both the check and where it is applied, in one ≤ 40-line range: a
  reviewer who sees only the call site of a predicate (or only the
  predicate, never its use) cannot confirm the claim and answers
  `indeterminate`.

## Writing a claim the reviewer can decide

| Weak | Why | Better |
|---|---|---|
| "Input is validated" | which input, against what | "`createOrder` rejects a body whose `items[].qty` is not a positive integer (lines 12–19)" |
| "Uses parameterised queries" | the reviewer must find them | "`find` binds `req.query.id` as `$1` (line 4)" |
| "Auth middleware protects the route" | protects against what | "`requireRole('admin')` runs before `exportOrders` for every method (router line 8)" |
| "Rate limited" | at which layer, on what key | "the `/login` route is limited to 10/min per IP by `limiter` (lines 30–34)" |

## The review, in the lead's hands

`cite.mjs check` only verifies that `M-nnn` in a `mitigated(M-nnn)`
disposition is one of *this* threat's own mitigations — see
`dispositions.md`. It never confirms the claim itself; that is the lead's
call, made after `check` has stamped the model:

1. The lead dispatches a **fresh** `security-reviewer` with the stamped
   `threat-model.json` and the mitigation id, contract `mitigation-review`.
2. The reviewer reads the mitigation's citations at their `oid` with
   `cite.mjs show … --at <oid>` and decides: present and covering ⇒
   `confirmed`; absent, bypassable or narrower than claimed ⇒ `refuted`
   (states where); the cited bytes cannot show it either way ⇒
   `indeterminate`.
3. It writes `second-M-nnn.json` in the review directory the lead named
   (`.agents/security-testing/reviews/<date>-<head7>/`, covered by the
   managed ignore block) — not beside `threat-model.json` — with
   `{finding_id: M-nnn, oid, findings_sha256, assertion, note, by}`.
4. No script validates it or changes the model. The lead reads
   `second-M-nnn.json` and decides whether `mitigated(M-nnn)` still
   stands, or the threat needs a different disposition.

## What a `refuted` or `indeterminate` review means for the model

The second opinion does not remove the mitigation from the model: the
claim and its citation stay, and the lead reconsiders the threat's
disposition — back to `open`, or `accepted(R-nnnn)`, or `planned(TC-nnn)`,
or `out-of-scope(<reason>)` — by editing `threat-model.json` and running
`cite.mjs check` again (see the one-run sequence in `dispositions.md`).
A mitigation is evidence about the code at `head`; a later assessment can
restate the claim against fixed lines.

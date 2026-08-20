# Automation-Friendly Spec (AFS)

## Contents

- [Location](#location)
- [Required structure](#required-structure)
- [Metadata](#metadata)
- [Preconditions](#preconditions)
- [Test Data](#test-data)
- [Test Steps](#test-steps)
- [Expected Results](#expected-results)
- [Coverage Map](#coverage-map)
- [Cleanup](#cleanup)
- [Concrete Handles (discovered during exploration)](#concrete-handles-discovered-during-exploration)
- [Network Behavior](#network-behavior)
- [Known Defects Found During Exploration](#known-defects-found-during-exploration)
- [Blocked Steps](#blocked-steps)
- [Automation Hints](#automation-hints)
- [What the analyst MUST fill in](#what-the-analyst-must-fill-in)
- [What the analyst MAY skip](#what-the-analyst-may-skip)
- [Variable convention](#variable-convention)
- [Status vocabulary](#status-vocabulary)

The AFS is the handoff artifact between the analyst and the automation
engineer. It is a superset of a classic test case — everything a manual
tester needs, plus everything an engineer needs to go straight to code
without re-exploring the app.

## Location

```
test-specs/{feature}/l{priority}_{slug}_{tms-id}.md      # fresh implementation
test-specs/{feature}/lcovered_{slug}_{tms-id}.md         # already-covered traceability AFS
test-specs/{feature}/lextend_{slug}_{tms-id}.md          # extend-existing extension AFS
```

- `priority`: `1` critical, `2` high, `3` medium, `4` low
- `lcovered_` / `lextend_`: replace the priority digit for `already-covered`
  and `extend-existing` outcomes (SKILL.md § Classify findings). The filename
  prefix is the contract — downstream audits grep for it to tell dedup and
  extension work apart from fresh-implementation coverage.
- `slug`: short snake_case description
- `tms-id`: original TMS case key when available (e.g. `ZEP-T123`,
  `TR-4567`, `XRAY-456`), or `ad-hoc` for analyst-authored cases

Examples:

```
test-specs/login/l1_valid_login_ZEP-T101.md
test-specs/checkout/l2_apply_promo_code_TR-2044.md
test-specs/user-profile/l3_avatar_upload_ad-hoc.md
test-specs/login/lcovered_remember_me_ZEP-T108.md
test-specs/checkout/lextend_promo_stacking_TR-2051.md
```

## Required structure

```markdown
# Test Case: {Descriptive Name}

## Metadata
- **TMS ID**: {e.g. ZEP-T101, or `none`}
- **Linked Story**: {JIRA-123, GH#45, or `none`}
- **Priority**: {l1 | l2 | l3 | l4}
- **Environment Explored**: {stage | uat | local}
- **User set**: {e.g. `${TEST_USER}` — credential env-var key(s) into `.agents/profile.md` § Roles & sample users}
- **Analyst**: {agent or human who produced this}
- **Status**: {ready-for-automation | blocked | defect-found | un-automatable | already-covered | extend-existing | out-of-scope-by-author}
  (`un-automatable` and `out-of-scope-by-author` are **return-only statuses —
  never written into an AFS file**: no AFS is emitted for either, per
  test-case-analysis SKILL.md, so grep-audits over `test-specs/` never see them.)

## Preconditions
- User must be logged out
- Customer `${TEST_CUSTOMER_ID}` must exist with at least one saved card
- Feature flag `${FEATURE_CHECKOUT_V2}` must be ON
(Omit section if no preconditions.)

## Test Data
### reuse-existing
- `${TEST_EMAIL}` = stored in `.env`
- `${TEST_CUSTOMER_ID}` = `CUS-42` (seeded by fixtures/users.sql)

### generate-per-test (in test setup, cleaned up in its own teardown)
- Unique order reference: `ORDER-${Date.now()}`
- Temporary promo code via `POST /api/admin/promos`

### generate-shared-with-cleanup (shared across tests; cleaned up in suite teardown)
- Promo campaign shared by the feature's tests (via `POST /api/admin/promos`)
  — expire when the suite finishes

## Test Steps
1. Navigate to `${BASE_URL}/checkout`
   - **Verify**: page title contains "Checkout"
2. Fill card details using `${TEST_CARD_NUMBER}`, `${TEST_CARD_CVV}`
3. Click "Apply promo" button
4. Enter generated promo code and submit
5. Verify discount line appears in summary

## Expected Results
- Discount line shows promo code
- Total decreases by the promo percentage
- `POST /api/checkout/promos` returns 200
- No console errors

## Coverage Map

Two axes, so the ORIGINAL CASE and YOUR ENRICHMENT are both accounted for.

**Axis 1 — Case coverage.** One row per original-case **element** — every step,
*plus any requirement the case carries in its description or preconditions* —
with a disposition, so nothing the case asks for is dropped silently. (A TMS
case is more than its step list: some TMSs carry real acceptance criteria in the
**description** and setup in **preconditions**. Pure-setup preconditions live in
the AFS § Preconditions; add a row here for anything that must be *verified* — a
description-borne acceptance criterion, or a precondition the test asserts — so
it's asserted, not lost as prose.) Decomposition (one case step → several AFS
steps) goes in "Covered by".

| Case element | Expected result | Covered by (AFS step) | Asserted where | Disposition |
|---|---|---|---|---|
| desc: discount never exceeds 50% | cap enforced | step 4 | `step 4`: total ≥ 50% of subtotal | asserted |
| 1 Navigate to checkout | title "Checkout" | step 1 | `step 1`: title visible | asserted |
| 2 Apply promo code | discount line shows | steps 3–4 | `step 4`: discount row | asserted *(decomposed)* |
| 3 Retry declined card | retry prompt shown | — | — | blocked *(no declined card in env)* |

Disposition ∈ `asserted` | `already-covered` | `clarification` (live product
diverges from the case — reverse-masking guard) | `blocked` | `out-of-scope`.
Anything not `asserted` / `already-covered` must ALSO appear in § Blocked Steps,
§ Known Defects, or as a CLARIFICATION — never a bare omission.

**Axis 2 — Analyst additions.** Anything you assert that the case did NOT ask
for (an observable you found worth guarding during execution). List each with a
one-line reason grounded in what you observed — this keeps enrichment honest and
lets the reviewer tell it from scope creep.

- `step 2` asserts no console errors during payment — *added: observed a
  transient 500 in exploration; guard prevents silent regression.*
- (state "none" if you added nothing beyond the case.)

## Cleanup
1. Cancel the draft order via UI or `DELETE /api/orders/{id}`
2. Expire the generated promo

## Concrete Handles (discovered during exploration)

Capture the concrete handles the implementer needs — selectors,
endpoints, element-ids, metric queries, whatever the surface uses.
Resolve the most stable, semantic handle available, and give a
fallback.

**Worked UI example** — capture selectors using this ladder, in order
of preference:

1. `getByRole(role, { name })` — preferred when the accessible name is
   stable and unique
2. `getByTestId(...)` / `data-testid`
3. `getByLabel(...)` / `getByPlaceholder(...)`
4. `getByText(...)`
5. CSS / XPath — last resort, with a comment about why a higher tier
   couldn't disambiguate

(API: named response field-path → JSON schema → status code. Mobile:
accessibility-id → id → visible text. Perf: named metric + threshold.)

If you can't resolve a stable, semantic handle (a UI element with no
test ID where roles / labels can't disambiguate it; an undocumented
response field), **stop and flag the gap** in the AFS § Blocked Steps
or § Automation Hints instead of falling back to a brittle one. The
implementer / orchestrator will route the gap rather than ship a
fragile handle.

| Element | Recommended Locator | Fallback |
|---|---|---|
| Promo code input | `getByLabel('Promo code')` | `getByTestId('promo-input')` |
| Apply button | `getByRole('button', { name: 'Apply' })` | `getByTestId('promo-apply')` |
| Summary total | `getByRole('status', { name: /total/i })` | `getByTestId('summary-total')` |

## Network Behavior
- `POST /api/checkout/promos` — fires on Apply click, 200 on success
- `GET /api/checkout/summary` — refetch after promo applied (wait for this
  before asserting total)

## Known Defects Found During Exploration
- **[MAJOR]** Typing a 20-char promo shows 500 — filed as `GH#234`
  (automation expects `expect.soft()` with `// Known defect: GH#234`)

## Blocked Steps
- Step 6 ("retry card after decline") — requires a real declined card;
  analyst could not complete in current env. Engineer: decide whether
  to stub or escalate.

## Automation Hints
- Framework: Playwright (confirmed from `playwright.config.ts`)
- Page object: `tests/pages/checkout.page.ts` (extend, don't duplicate)
- Fixture: `authedCheckoutPage` already gives a logged-in cart — use it
- Wait strategy: `wait_for_response` on `/api/checkout/summary` after
  Apply, not a `timeout`
```

## What the analyst MUST fill in

- Metadata, Preconditions, Test Data (all three subsections),
  Test Steps, Expected Results
- **Coverage Map** — both axes. Axis 1 must have a row + disposition for
  *every* original-case element — each step, **plus any requirement carried by
  the case's description or preconditions** (some TMSs put acceptance criteria
  there); pure-setup preconditions land in § Preconditions instead. Decomposition
  shown in "Covered by". Axis 2 lists every assertion you added beyond the case,
  each with a one-line grounded reason. Building it IS your self-audit — it's how
  you catch a dropped or misread requirement before it ships downstream.
- **Concrete Handles** — this is the whole point; exploration without
  capturing the handles the implementer needs (selectors / endpoints /
  element-ids / metric queries) is half-done work
- **Known Defects Found** — even if empty, state "none found"
- **Blocked Steps** — even if empty, state "none"

## What the analyst MAY skip

- **Automation Hints** — if the framework is obvious from
  `.agents/testing.md`, the engineer can derive it. Fill this in only
  when there's a non-obvious call (e.g. "use the WebSocket fixture, not
  the HTTP one").
- **Network Behavior** — captures the traffic *behind* an action, so
  skip it when there's nothing underneath to note (a pure-UI assertion
  with no XHR). For an API case the traffic *is* the action — it lives
  in Test Steps / Expected Results, not here.

## Variable convention

Always use `${VAR_NAME}` — not raw values — for:

- URLs, endpoints, ports
- Credentials (emails, passwords, tokens, API keys)
- Environment-specific IDs (customer IDs, tenant IDs, feature flags)
- Anything that would differ between `local`, `stage`, `uat`, `prod`

The automation engineer wires these to the project's `.env` loader.
Secrets never leave the `.env`.

## Status vocabulary

Full status set + routing is the single source of truth in
test-case-analysis SKILL.md § Classify findings — this section
summarizes.

- **ready-for-automation** — fully explored, all data identified, no
  blockers. Safe to hand off.
- **blocked** — analyst hit a wall (missing access, missing data,
  broken env). Engineer reads the Blocked Steps section and either
  unblocks or escalates.
- **defect-found** — real product bug prevents exploration from
  completing meaningfully. Defect filed. Automation paused until fix.
- **un-automatable** — physical device, manual-only visual check, flow
  that genuinely cannot be scripted. Do not automate. Keep as a manual
  case in TMS.
- **already-covered** — existing automation already asserts this; emit a
  `covered` traceability AFS rather than new test code.
- **extend-existing** — partly covered; emit an `extend` extension AFS
  pointing the engineer at the suite to extend.
- **out-of-scope-by-author** — see SKILL.md § Classify findings for the
  full routing.

# Automation-Friendly Spec (AFS)

The AFS is the handoff artifact between the analyst and the automation
engineer. It is a superset of a classic test case — everything a manual
tester needs, plus everything an engineer needs to go straight to code
without re-exploring the app.

## Location

```
test-specs/{feature}/l{priority}_{slug}_{tms-id}.md
```

- `priority`: `1` critical, `2` high, `3` medium, `4` low
- `slug`: short snake_case description
- `tms-id`: original TMS case key when available (e.g. `ZEP-T123`,
  `TR-4567`, `XRAY-456`), or `ad-hoc` for analyst-authored cases

Examples:

```
test-specs/login/l1_valid_login_ZEP-T101.md
test-specs/checkout/l2_apply_promo_code_TR-2044.md
test-specs/user-profile/l3_avatar_upload_ad-hoc.md
```

## Required structure

```markdown
# Test Case: {Descriptive Name}

## Metadata
- **TMS ID**: {e.g. ZEP-T101, or `none`}
- **Linked Story**: {JIRA-123, GH#45, or `none`}
- **Priority**: {l1 | l2 | l3 | l4}
- **Environment Explored**: {stage | uat | local}
- **Analyst**: {agent or human who produced this}
- **Status**: {ready-for-automation | blocked | defect-found | un-automatable}

## Preconditions
- User must be logged out
- Customer `${TEST_CUSTOMER_ID}` must exist with at least one saved card
- Feature flag `${FEATURE_CHECKOUT_V2}` must be ON
(Omit section if no preconditions.)

## Test Data
### Existing (re-use)
- `${TEST_EMAIL}` = stored in `.env`
- `${TEST_CUSTOMER_ID}` = `CUS-42` (seeded by fixtures/users.sql)

### Must Generate (in test setup)
- Unique order reference: `ORDER-${Date.now()}`
- Temporary promo code via `POST /api/admin/promos`

### Must Clean Up (in teardown)
- Delete generated order
- Expire generated promo

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

## Cleanup
1. Cancel the draft order via UI or `DELETE /api/orders/{id}`
2. Expire the generated promo

## Stable Selectors (discovered during exploration)
| Element | Recommended Locator | Fallback |
|---|---|---|
| Promo code input | `getByTestId('promo-input')` | `getByLabel('Promo code')` |
| Apply button | `getByRole('button', { name: 'Apply' })` | `.promo-apply` |
| Summary total | `getByTestId('summary-total')` | `[data-summary="total"]` |

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
- **Stable Selectors** — this is the whole point; exploration without
  selector capture is half-done work
- **Known Defects Found** — even if empty, state "none found"
- **Blocked Steps** — even if empty, state "none"

## What the analyst MAY skip

- **Automation Hints** — if the framework is obvious from
  `.agents/testing.md`, the engineer can derive it. Fill this in only
  when there's a non-obvious call (e.g. "use the WebSocket fixture, not
  the HTTP one").
- **Network Behavior** — skip for pure-UI assertions without XHR.

## Variable convention

Always use `${VAR_NAME}` — not raw values — for:

- URLs, endpoints, ports
- Credentials (emails, passwords, tokens, API keys)
- Environment-specific IDs (customer IDs, tenant IDs, feature flags)
- Anything that would differ between `local`, `stage`, `uat`, `prod`

The automation engineer wires these to the project's `.env` loader.
Secrets never leave the `.env`.

## Status vocabulary

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

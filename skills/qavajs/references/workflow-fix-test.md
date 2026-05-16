# workflow-fix-test.md — diagnose and fix a failing qavajs scenario

Use when the user asks to "fix a test", "fix a failing test", "repair a scenario", or pastes failure output that needs investigation.

> Source: distilled from <https://github.com/qavajs/demo/blob/main/agentic/.claude/skills/fix-test/SKILL.md> (MIT). The diagnostic decision table is the keep-as-is part — it compresses real qavajs failure-mode experience.

## Step 1 — reproduce the failure

If the user gave a scenario name, tag, or grep pattern, run only that:

```bash
# cucumber-js mode
npx qavajs run --config config.ts -t '"<exact scenario name>"'

# standalone Playwright mode
PLAYWRIGHT_HTML_OPEN=never npx playwright test --grep "<scenario name>"
```

If they pasted output without a name, parse out the scenario name and the failing step from the error block. **Don't re-run the whole suite** to find a single failure.

If you have nothing — no name, no output — **stop and ask** for the scenario name, tag, or terminal output. Don't guess.

Capture: scenario name, failing step text, error message verbatim.

## Step 2 — read the right files (in this order)

1. **The feature file** — find the failing scenario; read **all** its steps, not just the failing one. Predecessors often hold the real cause.
2. **The page object** — verify every locator referenced by step text exists, has the right name (case + spaces), and uses the correct selector. Also check templates: `Product (foo)` requires a `Product = locator.template(...)` declaration.
3. **The memory class** — verify every `$key` referenced is defined and resolvable. Walk paths like `$user.email` against the actual structure.
4. **Custom step definitions** — if the failing step doesn't match any built-in catalog phrase, look here. Wrong regex or override conflicts hide here.
5. **Trace / video / screenshot** if available — `npx playwright show-trace test-results/.../trace.zip` is decisive for "Element not found" failures (post-mortem replay of what the test saw).
6. **Live page right now** — when the trace shows the element disappeared or moved, confirm the *current* DOM via the [`playwright-testing`](../../playwright-testing/) MCP (`browser_navigate` → `browser_snapshot` → `browser_evaluate("document.querySelectorAll('…').length")`) or [`browser-verify`](../../browser-verify/) for CDP-level introspection (computed styles, shadow roots, frame structure). This separates "element changed" from "test never reached the right state."

## Step 3 — diagnostic decision table

| Symptom | Likely cause | Fix |
|---|---|---|
| `Element not found` / locator timeout | Wrong locator path; or element re-rendered before step ran | Re-snapshot the live page via [`playwright-testing`](../../playwright-testing/) MCP (`browser_snapshot` + `browser_evaluate` for uniqueness) — confirm the selector still exists and matches once. Then either correct the selector in the page object, or insert a wait step (`I expect 'X' to be visible`) before the action |
| `Expected … to equal …` assertion failure | Wrong expected literal, wrong element targeted, or env drift | Update the expected value (and check whether the env data changed); verify the right element name |
| `Cannot read property of undefined` (stage: resolve memory) | Missing memory key or wrong path | Add to `memory/index.ts` or fix the `$key.path` traversal in the step text |
| `Undefined step. Implement with the following snippet:` | Step phrase doesn't match any registered regex | **First** scan the relevant `references/steps-*.md` catalog and rewrite to a real phrase; only write a custom definition if no built-in fits |
| `Multiple step definitions match` | Two packages register the same regex (e.g. both `steps-accessibility` and `steps-accessibility-ea`) | Drop one of the conflicting packages from `config.require`, or wrap with `Override` |
| Navigation / URL mismatch | `$baseUrl` / `$app` value points at the wrong env or path | Fix `memory/index.ts`; or for env-specific values, supply via `--memory-values '{"baseUrl":"…"}'` |
| Step **passed** but post-conditions wrong | `softly` swallowed a real failure earlier in the scenario | Search the scenario for `softly`; promote that assertion back to a hard check, or add another check at the boundary |
| Sporadic flake (passes some runs) | Race against animation or async load | Add a deterministic wait, e.g. `I expect 'Spinner' not to be visible` before the action; or use `validation.poll(…)` if you must keep it custom |
| Screenshot diff fails after a UI change | Baseline outdated | Regenerate baseline only after confirming the change is intentional; commit alongside the test |
| Test passes locally but fails in CI | Headed/headless render diffs, fonts, time zones, or flaky env | Run locally with same `--profile` as CI; check `process.env.TZ`, font availability; add `headless: true` reproducibly |

## Step 4 — apply the surgical fix

- Edit **only** the file(s) that contain the root cause.
- **Don't add new page-object locators** unless the fix needs one; if it does, add the minimal locator and note it in the report.
- **Don't change passing scenarios** to make this one pass — that hides regressions.
- Keep the Gherkin style consistent with the rest of the feature file.
- If the scenario has a misleading name now (because the bug changed expectations), suggest a rename but **don't rename without asking**.

## Step 5 — verify the fix

Re-run the previously failing scenario only:

```bash
npx qavajs run --config config.ts -t '"<scenario name>"'
```

If green, run a small smoke selection (`@smoke` tag if it exists) to make sure you didn't break a sibling.

## Step 6 — report concisely

Three lines, no fluff:

- **Root cause:** _one sentence_.
- **Changed:** _file paths and a one-phrase what_.
- **Result:** _pass count after re-run + any caveats_.

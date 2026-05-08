# visual-testing.md — `@qavajs/steps-visual-testing` for screenshot diffs

Pixel-by-pixel image comparison via [pixelmatch](https://github.com/mapbox/pixelmatch). Compares two screenshots stored in memory; on mismatch, attaches **actual / expected / delta** images to the Cucumber report.

Source of truth: <https://qavajs.github.io/docs/Steps/visual-testing>, <https://github.com/qavajs/steps-visual-testing>

## Installation

```bash
npm install @qavajs/steps-visual-testing
```

## Configuration

```typescript
export default {
    require: ['node_modules/@qavajs/steps-visual-testing/index.js'],
};
```

That's it — there are no module-level options. Tunables live in the step's DataTable.

## Steps (2 total)

```gherkin
Then I expect '$actual' screenshot to equal '$expected'
Then I expect '$actual' screenshot to equal '$expected':
  | threshold | 0.4 |
```

| Param | Type | Default | Meaning |
|---|---|---|---|
| `threshold` | `number` ∈ [0, 1] | `0.1` | Per-pixel diff cutoff. Lower = stricter. `0.0` is exact match; `1.0` accepts anything. |

Both arguments are memory references; they must resolve to a `Buffer` or a base-64 PNG string.

## Where the screenshots come from

The step doesn't take screenshots — it compares two that someone else captured. Use the runner's snapshot steps to populate memory:

```gherkin
# Playwright
When I save full page screenshot as 'actual'
When I save screenshot of 'Header' as 'actualHeader'

# Or load an expected baseline from disk via @qavajs/steps-files
When I save './baselines/home-desktop.png' file content as 'expected'
```

## Common shapes

### Element-scoped baseline check

```gherkin
Scenario: Header looks right
  Given I open '$baseUrl' url
  When  I save './baselines/header.png' file content as 'expected'
  And   I save screenshot of 'Header' as 'actual'
  Then  I expect '$actual' screenshot to equal '$expected'
```

### Threshold tuning for anti-aliasing-heavy regions

```gherkin
Then I expect '$actual' screenshot to equal '$expected':
  | threshold | 0.3 |
```

Use a higher threshold for pages with anti-aliased text, gradients, or font rendering that varies across OS/browser combinations. Start at the default `0.1`, raise only when known cosmetic noise causes false positives.

### Side-by-side state comparison

```gherkin
Scenario: Toggling dark mode changes the header
  Given I open '$baseUrl' url
  When  I save screenshot of 'Header' as 'lightHeader'
  And   I click 'Theme Toggle'
  And   I save screenshot of 'Header' as 'darkHeader'
  Then  I expect '$lightHeader' screenshot not to equal '$darkHeader'
```

(`not to` works because the step uses the `{validation}` parameter type — `to equal` and `not to equal` are both valid.)

## Failure attachments

When a check fails, the step attaches three images to the Cucumber report under the failing scenario:

- `actual.png`
- `expected.png`
- `delta.png` — pink-on-transparent overlay highlighting differing pixels

If image dimensions don't match, the step fails immediately with a clear message and still attaches the two source images.

## Caveats

- **No per-region masking out of the box.** If your page has a clock or a server-generated ID that you want to ignore, pre-process the screenshot via `browser.evaluate` (e.g. CSS `visibility: hidden` on the dynamic element) before saving it.
- **Don't commit baselines that depend on font rendering.** A baseline captured on macOS will likely fail on a Linux CI runner. Either pin browsers via Docker or capture per-OS baselines.
- **Threshold tuning is per-step.** There's no global threshold — pass it via the DataTable wherever needed. A custom step + memory function lets you DRY up project-wide thresholds.
- **Buffers vs base-64.** The step accepts both, so memory steps that save to base-64 (`I save full page screenshot as ...`) and binary loads (`I save 'baseline.png' file content as ...`) interoperate.

## Live links

- Step catalog: [`steps-visual-testing.md`](steps-visual-testing.md)
- Source: <https://github.com/qavajs/steps-visual-testing>
- Docs: <https://qavajs.github.io/docs/Steps/visual-testing>
- Pixelmatch: <https://github.com/mapbox/pixelmatch>

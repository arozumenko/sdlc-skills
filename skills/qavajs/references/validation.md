# validation.md — `@qavajs/validation` matchers and natural-language phrases

Two surfaces:

1. **Natural-language phrases** in Gherkin, parsed by `getValidation(description)` → produce a `(actual, expected) => void`. Used by every `{validation}` parameter in step definitions.
2. **Standalone `expect(...)` API** (chainable matchers) for use inside custom step code.

> **Don't install `@qavajs/soft-assertion`.** It's deprecated — soft-assertion functionality is folded into `@qavajs/core` and exposed via the `softly` keyword (e.g. `to softly equal`, `not to softly contain`). The standalone module still works, but new projects should not depend on it.

Source of truth: <https://github.com/qavajs/validation/blob/main/README.md>

## Phrase syntax for `{validation}` parameters

```
[is|do|does|to] [not|to not] [to] [be] [softly] <validation-keyword>
```

Examples that all parse:

- `equal`
- `to equal`
- `is equal`
- `does not equal`
- `to not equal`
- `is not deeply equal`
- `to softly contain`
- `not to softly match`

In Gherkin:

```gherkin
Then I expect '$status' to equal 'OK'
Then I expect '$body' to softly contain 'success'
Then I expect '$count' to be greater than '0'
Then I expect '$arr' not to deeply equal '$other'
```

## Validation keywords (and their `expect()` equivalents)

| Keyword(s) | Equivalent matcher | Notes |
|---|---|---|
| `equal` | `.toSimpleEqual` | Non-strict (`==`) |
| `strictly equal` | `.toEqual` / `.toBe` | `Object.is` |
| `deeply equal` | `.toDeepEqual` | Order-insensitive arrays |
| `deeply strictly equal` | `.toDeepStrictEqual` | Order-sensitive |
| `case insensitive equal` | `.toCaseInsensitiveEqual` | Lower-cased compare |
| `contain` | `.toContain` | Substring or array element |
| `match` | `.toMatch` | RegExp or substring |
| `have member` | `.toHaveMembers` | Same members, any order |
| `include member` | `.toIncludeMembers` | Superset check |
| `have property` | `.toHaveProperty` | Optional value |
| `have type` | `.toHaveType` | `'array'` is a special case |
| `have length` | `.toHaveLength` | |
| `above` / `greater than` | `.toBeGreaterThan` | |
| `greater than or equal` | `.toBeGreaterThanOrEqual` | |
| `below` / `less than` | `.toBeLessThan` | |
| `less than or equal` | `.toBeLessThanOrEqual` | |
| `match schema` | `.toMatchSchema` | JSON Schema (ajv) |
| `satisfy` | `.toSatisfy` | Predicate `(v) => boolean` |

All keywords accept the negation and `softly` modifiers above.

## Soft assertions — when to reach for them

Prefix any phrase with `softly` to record the failure but keep the scenario running. All soft failures are reported at the end. Use it when:

- You want to verify many independent properties of one response or page.
- One assertion's failure shouldn't mask another.
- You're writing UI regression tests where partial information is more useful than the first failure.

```gherkin
Scenario: Login UI sanity
  Given I open '$baseUrl' url
  Then I expect 'Logo' to be visible
  And  I expect text of 'Title' to softly equal 'Welcome'
  And  I expect 'Username Input' to softly be enabled
  And  I expect 'Password Input' to softly be enabled
  And  I expect 'Login Button' to softly be visible
```

The scenario fails at the end, listing every soft failure.

## Polling validations — when to reach for them

Async retry until the assertion passes or a timeout expires. Two ways:

**Inside a step** (`Validation.poll`):

```typescript
When('I poll-expect {value} {validation} {value}', async function (actual, validate, expected) {
    await validate.poll(
        () => actual.value(),
        await expected.value(),
        { timeout: 5000, interval: 500 }
    );
});
```

**Standalone `expect()` form**:

```typescript
import { expect } from '@qavajs/validation';
await expect(() => fetchStatus()).poll({ timeout: 10_000, interval: 500 }).toEqual('done');
```

`@qavajs/steps-playwright` and `-wdio` ship dedicated polling step phrasings (`I refresh page until ...`, `I click X until Y`) — prefer those over hand-rolled polling when available.

## Standalone `expect()` API (for custom steps)

```typescript
import { expect } from '@qavajs/validation';

expect(2).toEqual(2);
expect('hello').toContain('ell');
expect(arr).toHaveMembers([1, 2, 3]);
expect({ a: 1 }).toHaveProperty('a', 1);
expect(value).not.toEqual(other);
expect(value).soft.toEqual(other);

// Configure modifiers in one go:
expect(v).configure({ not: true, soft: true, poll: true, timeout: 5_000, interval: 100 }).toEqual(x);
```

### Custom matchers

```typescript
const myExpect = expect.extend({
    toBeEven(this, expected) {
        const pass = this.received % 2 === 0;
        return { pass, message: this.formatMessage(this.received, expected, 'to be even', this.isNot) };
    }
});
myExpect(4).toBeEven();
myExpect(3).not.toBeEven();
```

Custom matchers compose with `.not`, `.soft`, `.poll` automatically.

## Errors

- `AssertionError` — extends Node's; thrown for hard failures.
- `SoftAssertionError` — extends `AssertionError`; collected by the soft-assertion machinery.

Default message format: `[AssertionError] expected 1 not to equal 1`.

## Live links

- `@qavajs/validation` README: <https://github.com/qavajs/validation/blob/main/README.md>
- Docs: <https://qavajs.github.io/docs/Commons/validation>

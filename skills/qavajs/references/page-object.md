# page-object.md — qavajs page-object DSL

The qavajs page object is **a class tree of `locator(...)` fields**, registered as `config.pageObject`. The framework resolves a Gherkin path like `'Wikipedia > Search Input'` against this tree at runtime.

Three sibling implementations exist, depending on the runner:

| Runner | DSL package | Import |
|---|---|---|
| Playwright | `@qavajs/po-playwright` | `import { locator } from '@qavajs/steps-playwright/po';` |
| WebdriverIO | `@qavajs/po` | `import { locator } from '@qavajs/steps-wdio/po';` |

The semantics are nearly identical; this page covers Playwright (the more common case) and notes WDIO differences inline.

## The `App` class — your root

```typescript
// page_object/index.ts
import { locator } from '@qavajs/steps-playwright/po';
import { Wikipedia } from './wikipedia/Wikipedia';
import { WikipediaArticle } from './wikipedia/WikipediaArticle';

export class App {
    Wikipedia = locator('.search-container').as(Wikipedia);
    WikipediaArticle = locator('#content').as(WikipediaArticle);
    Header = locator('header.global');
    Footer = locator('footer');
}
```

```typescript
// config.ts
import { App } from './page_object';
export default { /* ... */ pageObject: new App() };
```

## Component classes

A component is just another class with `locator(...)` fields. Its selectors are scoped to whatever container linked to it via `.as(...)`.

```typescript
// page_object/wikipedia/Wikipedia.ts
import { locator } from '@qavajs/steps-playwright/po';

export class Wikipedia {
    SearchInput = locator('#searchInput');
    SearchButton = locator('button[type=submit]');
}
```

In Gherkin, the path `'Wikipedia > Search Input'` resolves the parent `.search-container` first, then `#searchInput` **inside** that container. Capitalisation in Gherkin is converted to a dictionary lookup: `'Search Input'` ↔ `SearchInput`. Spaces become camel-cased property names.

## Locator forms

```typescript
import { locator } from '@qavajs/steps-playwright/po';

class App {
    // Single element by CSS / xpath
    Title = locator('h1');

    // Collection (used by 'Items collection' or 'Items (1)' syntax)
    Items = locator('.list-item');

    // Component (binds a class to a container scope)
    Wikipedia = locator('.search-container').as(Wikipedia);

    // Collection of components — every match becomes an instance of CartItem
    CartItems = locator.collection('.cart .item').as(CartItem);

    // Dynamic / templated locator parameterised by Gherkin args
    TodoByIndex = locator.template((i) => `.todo-list li:nth-child(${i})`).as(TodoItem);
    TodoByText  = locator.template((t) => `.todo-list li:has-text("${t}")`).as(TodoItem);

    // Native driver selector — full access to Playwright's API (getByRole, frameLocator, etc.).
    // The callback receives `{ page, browser, context }` and the current parent locator.
    NativeFind  = locator.native(({ page }) => page.getByRole('button', { name: 'Submit' }));
    InFrame     = locator.native(({ page }) => page.frameLocator('#payment').getByText('Confirm'));

    // Search from root, ignoring this class's scope
    GlobalToast = locator('.toast', { ignoreHierarchy: true });
}
```

> **Note on `NativeSelector`**: a lower-level helper of the same name still exists in `@qavajs/po-playwright/Selector` for backwards compatibility, but **`locator.native(...)` is the v2 idiom** — use it for everything new.

## Gherkin selector syntax

Reading right-to-left in the Gherkin path:

| Gherkin | Resolves to |
|---|---|
| `'Element'` | `App.Element` |
| `'Component > Child'` | `App.Component → Child` |
| `'Component > Child > Element'` | nested chain |
| `'#1 of Collection'` | first element of `App.Collection` |
| `'#3 of Collection > Detail'` | inside the third instance |
| `'Component (text)'` | template form invoked with `'text'` |
| `'Component (text) > Child'` | nested inside the templated parent |
| `'Collection collection'` | the entire collection (size validations etc.) |

Index syntax accepts any positive integer; templates accept any string.

## Initialising / using the registry programmatically

The framework calls these for you, but it's worth knowing what's happening:

```typescript
import { po } from '@qavajs/steps-playwright/po';

await po.init(this.playwright.page, { timeout: 10_000 });
po.register(new App());

// In a custom step:
const element = await po.getElement('Wikipedia > Search Input');
await element.click();
```

For collections, `po.getElement('Items collection')` returns the underlying `Locator` chain that has all matches.

## WebdriverIO differences

Imports come from `@qavajs/steps-wdio/po` instead of `@qavajs/steps-playwright/po`. Native selectors use WDIO's `$`/`$$` semantics:

```typescript
import { locator } from '@qavajs/steps-wdio/po';

class App {
    SearchInput = locator('#search');
    NativeFind  = locator.native(({ browser }) => browser.$('android=new UiSelector().text("OK")'));
}
```

For mobile tests, locator strings can use Appium selector strategies directly (`'android=new UiSelector().text("OK")'`, `'-ios predicate string:label == "OK"'`).

## Best practices

- **One class per page or component.** Use folders (`page_object/wikipedia/Wikipedia.ts`) for clarity.
- **Compose, don't duplicate.** A header that appears across pages is one component imported into multiple page classes.
- **Prefer templates over text-based selectors built in step definitions.** `locator.template(t => '.x:has-text("' + t + '")')` is reusable and keeps Gherkin clean.
- **Use `ignoreHierarchy` sparingly** — it's an escape hatch for global elements (toast, modal-overlay) that aren't actually nested in a parent.
- **Tests should never `import { locator }` themselves.** Locators live in page-object classes. Step definitions go through `po.getElement` (or built-in `{playwrightLocator}` parameters).

## Dynamic locators in tests (escape hatch)

For one-off cases, `@qavajs/steps-playwright` provides:

```gherkin
When I define '.dynamic-id-${$id}' as 'Dynamic Element' locator
And  I click 'Dynamic Element'
```

Avoid leaning on this — prefer adding a templated property to the page object.

## Live links

- Playwright PO source: <https://github.com/qavajs/po-playwright>
- WDIO PO source: <https://github.com/qavajs/po>
- Docs: <https://qavajs.github.io/docs/Commons/page-object>

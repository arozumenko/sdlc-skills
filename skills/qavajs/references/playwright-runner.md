# playwright-runner.md — `@qavajs/steps-playwright` runtime

Steps powered by Playwright; works for browsers and Electron. Activated by adding `'node_modules/@qavajs/steps-playwright/index.js'` to `config.require`.

Source of truth: <https://github.com/qavajs/steps-playwright/blob/main/README.md>

## `browser` block — what every field does

```typescript
browser: {
    logLevel: 'warn',                  // Playwright internal log
    timeout: {
        action: 10_000,                // default per-action (click, fill, …)
        present: 10_000,               // 'I expect X to be present'
        visible: 20_000,               // 'I expect X to be visible'
        page: 10_000,                  // page navigation
        value: 5_000,                  // expect text/value polling
        valueInterval: 500,            // polling interval
        pageRefreshInterval: 2_000,    // 'I refresh page until …'
    },
    capabilities: {
        browserName: 'chromium',       // 'chromium' | 'firefox' | 'webkit'
        headless: true,
        // optional connection modes (pick one):
        wsEndpoint: 'ws://...',        // connect to a remote Playwright server
        cdpEndpoint: 'http://localhost:9222/',
        // … any Playwright launch / context option here
    },
    screenshot: { event: ['onFail'], fullPage: true },
    trace: { event: ['onFail'], dir: 'traces/', attach: true, screenshots: true, snapshots: true },
    video: { event: ['onFail'], dir: 'video/', size: { width: 640, height: 480 }, attach: true },
    reuseSession: false,               // share browser context across tests
    restartBrowser: false,             // restart browser (not just context) between tests
}
```

`screenshot.event`, `trace.event`, `video.event` accept any subset of `['onFail', 'beforeStep', 'afterStep', 'afterScenario']`.

## Connecting to a remote browser

```typescript
// Playwright server (Selenium-grid-style)
capabilities: { browserName: 'chromium', wsEndpoint: 'ws://127.0.0.1:60291/...' }

// CDP — attach to a running Chrome/Chromium
capabilities: { browserName: 'chromium', cdpEndpoint: 'http://localhost:9222/' }

// Cloud (LambdaTest example):
capabilities: {
    browserName: 'chromium',
    wsEndpoint: `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(JSON.stringify({
        browserName: 'Chrome',
        browserVersion: 'latest',
        'LT:Options': { user: process.env.LT_USERNAME, accessKey: process.env.LT_ACCESS_KEY, /* ... */ }
    }))}`,
}
```

## `this.playwright.*` inside steps

| Property | Type |
|---|---|
| `this.playwright.browser` | `Browser` (or `ElectronApplication` for electron tests) |
| `this.playwright.driver` | alias for `.browser` |
| `this.playwright.context` | `BrowserContext` |
| `this.playwright.page` | `Page` |

For electron tests the framework swaps to `ElectronApplication`; the `electron` step file in `steps-playwright/src/electron.ts` registers electron-specific helpers (`I execute {value} function/script on electron app`, `I click {value} electron menu`).

## Step categories at a glance

Counts and patterns: see [`steps-playwright.md`](steps-playwright.md). Quick map:

- **Actions**: `actions.ts`, `electron.ts` — open/click/type/scroll/upload/window control.
- **Mouse / keyboard**: `mouseActions.ts`, `keyboardActions.ts` — `press/release X mouse button`, `hold/release {string} key`.
- **Validations**: `validations.ts` — `I expect X {playwrightCondition}`, `I expect text/value/css of X {validation} Y`.
- **Waits**: `waits.ts` — `I refresh page until …`, `I wait {int} ms`, `I wait for network idle`.
- **Memory snapshots**: `memory.ts` — `I save text/value/screenshot/cookie/storage/css of X as 'k'`.
- **Cookies / storage**: `cookies.ts`, `localSessionStorage.ts`.
- **Dialogs**: `dialog.ts` — `I will wait for dialog`, `I accept/dismiss dialog`.
- **Network mocking**: `mock.ts` — `I create mock for X as 'm'`, `I set 'm' mock to respond/abort …`.
- **Network interception**: `intercept.ts` — `I create interception for X as 'i'`, `I wait for 'i' response`.
- **Dynamic locator definition**: `poDefine.ts` — `I define '<sel>' as 'Alias' locator`.

## Conditions vocabulary (`{playwrightCondition}`)

`present`, `visible`, `invisible`, `clickable`, `enabled`, `disabled`, `in viewport`, `fully in viewport` — composed with `(not)` and `(softly)` and the `to be` glue. Examples:

- `Then I expect 'Logo' to be visible`
- `Then I expect 'Submit' not to be clickable`
- `Then I expect 'Banner' to softly be in viewport`

## Network mocking — common shape

```gherkin
When I create mock for '$apiBase/users' as 'usersMock'
And  I set 'usersMock' mock to respond '200' with:
"""
{ "users": [{ "id": 1, "name": "Alice" }] }
"""
And  I open '$baseUrl' url
Then I expect 'User Row' to be visible

# clean up at the end
And  I restore all mocks
```

For aborts:

```gherkin
When I set 'analyticsMock' mock to abort with 'failed' reason
```

## Electron tests

Boot an electron app via Playwright by setting `executablePath` and `args` in `capabilities` (or with `electron`-specific config flags depending on the demo template — see `qavajs/demo/electron-playwright`). All web steps work; in addition you get:

- `When I execute '<fn>' function/script on electron app`
- `When I execute '<fn>' function/script on electron app and save result as 'k'`
- `When I click 'File > Open' electron menu`

## Multiple tabs / pages

```gherkin
When I open new tab
And  I switch to 2 window
And  I open '$secondaryUrl' url
And  I close current tab
And  I switch to 1 window
```

You can also switch by URL/title regex: `When I switch to '/admin/' window`.

## Live links

- `@qavajs/steps-playwright`: <https://github.com/qavajs/steps-playwright>
- `@qavajs/po-playwright`: <https://github.com/qavajs/po-playwright>
- Docs: <https://qavajs.github.io/docs/Steps/playwright>
- Demo: <https://github.com/qavajs/demo/tree/main/web-playwright>
- Electron demo: <https://github.com/qavajs/demo/tree/main/electron-playwright>

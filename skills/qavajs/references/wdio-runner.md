# wdio-runner.md — `@qavajs/steps-wdio` runtime

WebdriverIO-powered steps that work for browsers and (uniquely among qavajs runners) **native mobile via Appium**. Activated with `'node_modules/@qavajs/steps-wdio/index.js'` in `config.require`.

Source of truth: <https://github.com/qavajs/steps-wdio>

## `browser` block

```typescript
browser: {
    logLevel: 'warn',
    timeout: {
        action: 10_000,
        present: 10_000,
        visible: 20_000,
        page: 10_000,
        value: 5_000,
        valueInterval: 500,
        pageRefreshInterval: 2_000,
    },
    capabilities: {
        browserName: 'chrome',         // for web tests
        // OR mobile capabilities:
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': 'Pixel 6',
        'appium:app': '/path/or/url/to/app.apk',
    },
    services: ['chromedriver'],        // wdio service plugins as needed
    services_options: { /* … */ },
    screenshot: { event: ['onFail'], fullPage: false },
    reuseSession: false,
    restartBrowser: false,
}
```

For Appium runs, `services` typically includes `'appium'`; the runner spins up the Appium server before the suite.

## Step categories — see catalog for literal patterns

Counts and patterns: [`steps-wdio.md`](steps-wdio.md). The category split mirrors `steps-playwright` (actions, validations, waits, memory snapshots, dialogs, mocks via `webMocks` adapter where supported), plus mobile-specific:

- **Tap / swipe / touch** — `I tap 'X'`, `I swipe from 'A' to 'B'`, `I long press 'C'`
- **Device control** — orientation, lock/unlock, shake
- **App management** — install / launch / terminate / reset

## `this` inside steps

| Property | Type | Notes |
|---|---|---|
| `this.wdio.browser` | `WebdriverIO.Browser` | a.k.a. `driver`, `app`. |
| `this.wdio.driver` | alias | |

## Cloud providers

The qavajs demo monorepo includes `web-wdio-browser-stack` with the canonical capabilities shape; mirror it for SauceLabs / LambdaTest by adapting service options.

```typescript
capabilities: {
    browserName: 'chrome',
    'bstack:options': {
        os: 'Windows',
        osVersion: '11',
        userName: process.env.BROWSERSTACK_USERNAME,
        accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
        local: false,
    },
},
services: [
    ['browserstack', { browserstackLocal: false }]
],
```

## Mobile — the smaller picture

WDIO + Appium is currently the only mobile path in qavajs. The framework gives you:

- The same `'A > B > C'` page-object syntax as web tests.
- A page-object class per platform (or per-screen, with platform-conditional locators).
- Tap-based actions side-by-side with normal UI assertions.

A practical skeleton:

```typescript
// page_object/AndroidApp.ts
import { locator } from '@qavajs/steps-wdio/po';

export class AndroidApp {
    LoginButton = locator('android=new UiSelector().resourceId("com.app:id/login")');
    UsernameInput = locator('//*[@resource-id="com.app:id/username"]');
    PasswordInput = locator('//*[@resource-id="com.app:id/password"]');
}
```

```typescript
// android.ts (separate config profile pinned to the Android device)
import { AndroidApp } from './page_object/AndroidApp';
import { Memory } from './memory';

export default {
    paths: ['features/**/*.feature'],
    require: ['node_modules/@qavajs/steps-wdio/index.js'],
    pageObject: new AndroidApp(),
    memory: new Memory(),
    browser: {
        capabilities: {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:deviceName': 'Pixel 6',
            'appium:app': process.env.ANDROID_APP,
        },
        services: ['appium'],
    },
};
```

Run with `qavajs run --config android.ts`. Repeat for iOS in `ios.ts`.

For cloud devices, `qavajs/demo/mobitru` shows the Mobitru capabilities shape.

## Choosing between Playwright and WDIO

Use this skill's [`SKILL.md`](../SKILL.md) section "How qavajs is organised" for the high-level pitch. Quick rule of thumb:

- **Playwright** → faster, more deterministic web automation; first-class network mocking; Electron support; new feature parity arrives faster.
- **WDIO** → mobile-native via Appium; established ecosystem of WDIO services; broader device-cloud support out of the box.

Some teams run both — `qavajs/demo/playwright-wdio-runner` shows the mixed setup.

## Live links

- `@qavajs/steps-wdio`: <https://github.com/qavajs/steps-wdio>
- `@qavajs/po`: <https://github.com/qavajs/po>
- Docs: <https://qavajs.github.io/docs/Steps/wdio>, <https://qavajs.github.io/docs/Guides/wdio-adapter>
- Demos: <https://github.com/qavajs/demo/tree/main/web-wdio>, <https://github.com/qavajs/demo/tree/main/mobile-native>, <https://github.com/qavajs/demo/tree/main/mobitru>

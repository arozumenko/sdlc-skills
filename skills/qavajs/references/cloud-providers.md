# cloud-providers.md — running qavajs against SauceLabs / BrowserStack / Mobitru / LambdaTest

Configuration recipes per provider. The differences are entirely in the `browser` block — `paths`, `require`, `memory`, `pageObject`, etc. stay the same as your local config.

Source of truth: <https://qavajs.github.io/docs/Guides/cloud-providers>

All examples assume `import 'dotenv/config'` so secrets come from `.env` / CI secrets, never committed.

## SauceLabs (WDIO mobile or browser)

```typescript
// config.ts (sauceLabs profile)
import { Constants } from './memory';
import { App } from './page_object';

export const sauceLabs = {
    paths: ['features/**/*.feature'],
    require: ['node_modules/@qavajs/steps-wdio/index.js'],
    browser: {
        protocol: 'https',
        hostname: 'ondemand.us-west-1.saucelabs.com',
        path: '/wd/hub',
        port: 443,
        logLevel: 'debug',
        user: process.env.SAUCELABS_USER,
        key: process.env.SAUCELABS_ACCESS_KEY,
        timeout: { present: 5_000 },
        capabilities: {
            platformName: 'Android',
            browserName: 'chrome',
            'appium:deviceName': process.env.DEVICE_NAME,
            'appium:automationName': 'UIAutomator2',
        },
    },
    memory: new Constants(),
    pageObject: new App(),
    parallel: 1,
    defaultTimeout: 30_000,
};
```

Region hostnames: `ondemand.us-west-1.saucelabs.com`, `ondemand.eu-central-1.saucelabs.com`, `ondemand.apac-southeast-1.saucelabs.com`.

## BrowserStack (WDIO browser)

```typescript
export const browserStack = {
    paths: ['features/*.feature'],
    require: ['node_modules/@qavajs/steps-wdio/index.js', 'step_definitions/*.ts'],
    browser: {
        logLevel: 'info',
        hostname: 'hub.browserstack.com',
        port: 4444,
        path: '/wd/hub',
        capabilities: {
            browserName: 'chrome',
            'bstack:options': {
                os: 'Windows',
                osVersion: '10',
                browserVersion: '120.0',
                userName: process.env.BSTACK_USERNAME,
                accessKey: process.env.BSTACK_ACCESS_KEY,
                projectName: 'qavajs',
                buildName: process.env.GITHUB_RUN_ID ?? 'local',
                sessionName: 'qavajs cucumber suite',
                local: false,                       // true when tunnelling to localhost
                consoleLogs: 'errors',
                networkLogs: true,
            },
        },
    },
    memory: new Constants(),
    pageObject: new App(),
    parallel: 4,
    defaultTimeout: 25_000,
};
```

For tunnelling to localhost, install `@browserstack/local` and start it before tests in `BeforeExecution`.

## Mobitru (WDIO native mobile)

```typescript
const KEY = process.env.MOBITRU_API_KEY;
const BILLING_UNIT = process.env.MOBITRU_BILLING_UNIT;
const credentials = `${BILLING_UNIT}:${KEY}`;
const encoded = Buffer.from(credentials).toString('base64');

export const mobitru = {
    paths: ['features/**/*.feature'],
    require: ['node_modules/@qavajs/steps-wdio/index.js'],
    browser: {
        protocol: 'https',
        hostname: 'app.mobitru.com',
        path: '/wd/hub',
        port: 443,
        logLevel: 'debug',
        timeout: { present: 5_000 },
        headers: { Authorization: `Basic ${encoded}` },
        capabilities: {
            browserName: 'safari',
            platformName: 'iOS',
            'appium:udid': process.env.MOBITRU_UDID,
            'appium:automationName': 'XCUITest',
        },
    },
    memory: new Constants(),
    pageObject: new App(),
    parallel: 1,
    defaultTimeout: 30_000,
};
```

## LambdaTest (Playwright)

```typescript
const ltCapabilities = {
    browserName: 'Chrome',                    // 'Chrome' | 'MicrosoftEdge' | 'pw-chromium' | 'pw-firefox' | 'pw-webkit'
    browserVersion: 'latest',
    'LT:Options': {
        platform: 'Windows 10',
        build: process.env.GITHUB_RUN_ID ?? 'qavajs-local',
        name: 'qavajs cucumber suite',
        user: process.env.LT_USERNAME,
        accessKey: process.env.LT_ACCESS_KEY,
        network: true,
        video: true,
        console: true,
        tunnel: false,
        playwrightClientVersion: '1.56.1',
    },
};

export const lambdaTest = {
    paths: ['features/*.feature'],
    require: ['node_modules/@qavajs/steps-playwright/index.js'],
    browser: {
        logLevel: 'warn',
        timeout: { page: 5_000 },
        capabilities: {
            browserName: 'chromium',
            wsEndpoint: `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(JSON.stringify(ltCapabilities))}`,
        },
    },
    memory: new Constants(),
    pageObject: new App(),
    parallel: 4,
    defaultTimeout: 25_000,
};
```

`wsEndpoint` short-circuits the Playwright launcher and connects to the cloud server directly — no local browser needed.

## Caveats

- **Don't run cloud profiles in parallel without enough seats.** Each `parallel: N` worker holds one cloud session — exceeding your concurrency cap queues silently and wall-clock time inflates.
- **Region matters for latency.** Pick the cloud region closest to your CI runner (e.g. SauceLabs EU when GitHub Actions is on Azure West Europe).
- **Build/session names should be CI-aware.** Stamp `buildName: process.env.GITHUB_RUN_ID` (or equivalent) so failures are traceable from the cloud dashboard.
- **Local + tunnel for non-public URLs.** SauceLabs (`sc`), BrowserStack (`@browserstack/local`), LambdaTest (`Tunnel`) — start the tunnel in `BeforeExecution`, stop in `AfterExecution`.
- **Capabilities differ across providers and SDK versions.** The shapes above are stable today; the cloud's "capabilities generator" UI is the source of truth when in doubt.

## Live links

- Docs: <https://qavajs.github.io/docs/Guides/cloud-providers>
- SauceLabs: <https://docs.saucelabs.com/>
- BrowserStack: <https://www.browserstack.com/docs>
- Mobitru: <https://mobitru.com/docs>
- LambdaTest: <https://www.lambdatest.com/support/docs/>

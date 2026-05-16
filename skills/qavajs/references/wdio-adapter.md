# wdio-adapter.md — wiring WebdriverIO services into qavajs

`@qavajs/wdio-service-adapter` lets qavajs reuse the existing WebdriverIO services ecosystem (`selenium-standalone`, `appium`, `chromedriver`, vendor cloud services, etc.) — useful when the framework needs a managed WebDriver process or a vendor-provided pre/post hook chain.

Source of truth: <https://qavajs.github.io/docs/Guides/wdio-adapter>, <https://github.com/qavajs/wdio-service-adapter>

## Install

```bash
npm install @qavajs/wdio-service-adapter
# plus whichever WDIO services you actually need:
npm install @wdio/selenium-standalone-service
npm install @wdio/appium-service
```

## Usage — bare service

```typescript
// config.ts
import wdioService from '@qavajs/wdio-service-adapter';

export default {
    require: ['node_modules/@qavajs/steps-wdio/index.js'],
    service: [
        wdioService('@wdio/selenium-standalone-service'),
    ],
    browser: { capabilities: { browserName: 'chrome' } },
};
```

This makes the framework start `selenium-standalone` before the run and shut it down after.

## Usage — service with options

```typescript
import { resolve } from 'node:path';
import wdioService from '@qavajs/wdio-service-adapter';

export default {
    service: [
        wdioService([
            '@wdio/appium-service',
            {
                args: {
                    chromedriverExecutable: resolve('node_modules/chromedriver/lib/chromedriver/chromedriver.exe'),
                },
            },
        ]),
    ],
};
```

The tuple form is `[modulePath, options, capabilities, config]`. Options follow the WDIO service's documented schema; refer to the service's README for keys.

## When to reach for it

- **Mobile tests via Appium**: `wdioService('@wdio/appium-service')` spins up the Appium server with one less moving part for CI.
- **Selenium-standalone for Linux CI**: avoids needing a system-installed Selenium server.
- **Cloud-provider-specific services** (e.g. SauceLabs, BrowserStack): some clouds ship their own WDIO services that handle tunnel + session naming. The adapter wraps them transparently.

## When NOT to reach for it

- **Playwright runner**: `@qavajs/steps-playwright` doesn't use WebDriver, so WDIO services don't apply. Use Playwright's native `wsEndpoint`/`cdpEndpoint` config instead.
- **Local Chromium development**: `@qavajs/steps-wdio` already runs against an installed driver; you don't need a service unless you want it managed.

## Caveats

- **The `service` config field is being phased out** in qavajs core (replaced by `BeforeExecution`/`AfterExecution` hooks). The wdio-adapter still uses it because that's how WDIO services expect to be wired — track upstream for any change.
- **Service order matters.** If two services both bind the same port, the second one fails to start. Check each service's default port; override via the options block.
- **Don't double up on Appium.** If the wdio-appium-service starts a server, don't also `appium &` in your CI script. Pick one path.

## Live links

- Docs: <https://qavajs.github.io/docs/Guides/wdio-adapter>
- Adapter source: <https://github.com/qavajs/wdio-service-adapter>
- WDIO services list: <https://webdriver.io/docs/openofficial>

// example-config.ts — qavajs starter config (Playwright runner, web tests).
// Copy to your project root as `config.ts` and adjust.
//
// @ts-nocheck — copy-paste template; types resolve in a host project with the
// `@qavajs/*` packages and `dotenv` installed.

import 'dotenv/config';
import { Constants } from './memory';
import { App } from './page_object';

const defaultConfig = {
    paths: ['features/**/*.feature'],
    require: [
        'node_modules/@qavajs/steps-playwright/index.js',
        'node_modules/@qavajs/steps-memory/index.js',
        // 'step_definitions/**/*.ts', // uncomment when you add custom steps
    ],
    requireModule: ['ts-node/register'],
    format: [
        ['@qavajs/console-formatter'],
        ['@qavajs/html-formatter', 'report/report.html'],
        ['junit', 'report/junit.xml'],
        // ['allure-cucumberjs/reporter', 'allure-results/out.txt'],
    ],
    formatOptions: {
        console: { showLogs: true },
    },
    memory: new Constants(),
    pageObject: new App(),
    parallel: 1,
    retry: 0,
    defaultTimeout: 25_000,
    browser: {
        logLevel: 'warn',
        timeout: {
            page: 5_000,
            value: 5_000,
            valueInterval: 500,
        },
        capabilities: {
            browserName: 'chromium',
            headless: false,
        },
        screenshot: { event: ['onFail'], fullPage: true },
        // trace:  { event: ['onFail'], dir: 'traces/', attach: true },
        // video:  { event: ['onFail'], dir: 'video/',  attach: true },
    },
};

// Profiles: select with `qavajs run --profile <name>`.

export const headless = {
    ...defaultConfig,
    browser: {
        ...defaultConfig.browser,
        capabilities: { ...defaultConfig.browser.capabilities, headless: true },
    },
};

export const ci = {
    ...headless,
    parallel: 4,
    retry: 1,
    retryTagFilter: '@flaky',
};

export default defaultConfig;

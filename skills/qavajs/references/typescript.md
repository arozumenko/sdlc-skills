# typescript.md — TypeScript with qavajs

TypeScript is supported out of the box via `ts-node`. There's no compile step required — `qavajs run` loads `.ts` files directly.

Source of truth: <https://qavajs.github.io/docs/Guides/typescript>

## Minimum setup

```json
// package.json (devDependencies)
{
  "devDependencies": {
    "@cucumber/cucumber": "^12",
    "@qavajs/core": "^2",
    "@qavajs/steps-playwright": "^2",
    "@qavajs/steps-memory": "^1",
    "@types/node": "*",
    "ts-node": "^10",
    "typescript": "^5"
  }
}
```

```json
// tsconfig.json — minimal, qavajs-friendly
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"]
}
```

```typescript
// config.ts — TypeScript config file. ts-node is implicit.
import { Constants } from './memory';
import { App } from './page_object';

export default {
    paths: ['features/**/*.feature'],
    require: [
        'node_modules/@qavajs/steps-playwright/index.js',
        'node_modules/@qavajs/steps-memory/index.js',
        'step_definitions/**/*.ts',          // your custom step files
    ],
    format: ['@qavajs/console-formatter'],
    memory: new Constants(),
    pageObject: new App(),
    parallel: 1,
    defaultTimeout: 30_000,
};

export const ci = {
    parallel: 6,
    require: [
        'node_modules/@qavajs/steps-wdio/index.js',
        'node_modules/@qavajs/steps-memory/index.js',
        'step_definitions/**/*.ts',
    ],
    format: ['@qavajs/xunit-formatter:report/report.xml'],
};
```

`qavajs run` (and `cucumber-js`) detect `.ts` files via `ts-node/register`. You don't need `--require-module ts-node/register` — qavajs adds it automatically when the config path ends in `.ts`.

## Typed step definitions

```typescript
// step_definitions/auth.ts
import { When, IQavajsWorld, MemoryValue } from '@qavajs/core';

When('I log in as {value}', async function (this: IQavajsWorld, username: MemoryValue) {
    await this.executeStep(`I open '$baseUrl' url`);
    await this.executeStep(`I type '${await username.value()}' to 'Login Form > Username'`);
    await this.executeStep(`I type '$password' to 'Login Form > Password'`);
    await this.executeStep(`I click 'Login Form > Submit'`);
});
```

Useful types from `@qavajs/core`:

| Type | What it is |
|---|---|
| `IQavajsWorld` | Cucumber `World` extended with `config`, `memory`, `executeStep`, `executeTest`, `setValue`, `getValue`, `validation` |
| `MemoryValue` | Lazy memory parameter — `await x.value()` to read, `x.set(v)` to write |
| `Validation` | Async-capable assertion `(actual, expected) => void` with `.poll(...)` |
| `Fixture`, `Override`, `Template`, `BeforeExecution`, `AfterExecution` | composition primitives |

## ESM vs CJS

The default of the `qavajs/demo` repo uses CJS via `ts-node` for simplicity. For ESM:

```json
// package.json
{ "type": "module" }
```

```json
// tsconfig.json
{ "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler" } }
```

Replace `require` in `config.ts` with `import`:

```typescript
export default {
    import: [
        'node_modules/@qavajs/steps-playwright/index.js',
        'step_definitions/**/*.ts',
    ],
};
```

Demo: <https://github.com/qavajs/demo/tree/main/web-playwright-esm>

## Caveats

- **Don't import step packages by specifier in `require`/`import`.** They must be filesystem paths (`'node_modules/@qavajs/steps-playwright/index.js'`), not bare modules. Cucumber treats the array as paths, not module specifiers.
- **`ts-node`'s default cache is in `~/.ts-node`**; in CI containers, that vanishes between runs. For faster cold starts, set `TS_NODE_TRANSPILE_ONLY=true` (skips type-checking at runtime — your editor still type-checks).
- **`@types/node` is required** — qavajs steps reference Node-specific globals (`process.env`, `Buffer`).
- **`strict: true` is recommended** but you can drop `noImplicitAny` in projects with lots of dynamic memory access if it gets noisy.

## Live links

- Docs: <https://qavajs.github.io/docs/Guides/typescript>
- ESM demo: <https://github.com/qavajs/demo/tree/main/web-playwright-esm>

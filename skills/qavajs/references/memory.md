# memory.md — `@qavajs/memory` and the `{value}` parameter type

A singleton in-process key-value store that every step definition can read and write. The memory map is registered at boot via `config.memory` and exposed on the World as `this.memory`. **Almost every Gherkin string in a qavajs test is implicitly resolved through this layer.**

Source of truth: <https://github.com/qavajs/memory/blob/main/README.md>

## How resolution works

When a step has a `{value}` parameter, Cucumber passes a `MemoryValue` object to the handler. The handler calls `await arg.value()` to resolve, or `arg.set(x)` to write back.

```typescript
import { When, MemoryValue } from '@qavajs/core';

When('I save {value} to memory as {value}', async function (value: MemoryValue, key: MemoryValue) {
    key.set(await value.value());
});
```

When you write a memory expression in Gherkin, the resolver walks it left-to-right:

| Expression | Returns |
|---|---|
| `'literal text'` | `"literal text"` (no `$`, pass-through) |
| `'$key'` | `memory.key` |
| `'$user.name'` | `memory.user.name` |
| `'$items[0]'` | `memory.items[0]` |
| `'$add(1, 2)'` | `memory.add(1, 2)` (computed function call) |
| `'{$baseUrl}/api/{$id}'` | string interpolation across keys |
| `'$js($counter + 1)'` | `eval` against memory storage |
| `'$js(JSON.stringify($user))'` | works for any JS expression |
| `'\\$42'` | literal `"$42"` (escaped dollar) |

`getValue` is **safe to call on anything** — non-string inputs are passed through unchanged.

## Defining a memory map

A class with public fields. Plain values are constants; methods are computed (re-evaluated on every read).

```typescript
// memory/index.ts
import crypto from 'node:crypto';

export class Constants {
    baseUrl = 'https://staging.example.com';
    adminUser = { username: 'admin', password: process.env.ADMIN_PWD };
    now = () => Date.now();
    uuid = () => crypto.randomUUID();
    add = (a: number, b: number) => Number(a) + Number(b);
}
```

Then in `config.ts`:

```typescript
import { Constants } from './memory';
export default { /* ... */ memory: new Constants() };
```

## Setting values from steps

Three equivalent forms inside a step:

```typescript
this.setValue('userId', 42);          // imperative API
this.memory.userId = 42;              // direct property assignment
key.set(42);                          // when you have a {value} parameter for the key
```

**Reads** always go through `this.getValue('$userId')` so resolution still happens.

## Overriding from CLI

```bash
qavajs run --config config.ts --memory-values '{"baseUrl":"https://prod","feature":true}'
```

The JSON merges into the memory storage **after** the `Memory` class fields are registered, so it acts as an environment override.

## Parallel test data (sharded users etc.)

Use the `parallel` helper from `@qavajs/memory/utils` to assign per-worker (and optionally per-shard) data:

```typescript
import { parallel } from '@qavajs/memory/utils';

export class Constants {
    user = parallel([
        { username: 'user1', password: 'pwd' },
        { username: 'user2', password: 'pwd' },
    ]);
    // shard mode: combine worker × shard for unique global indices
    shardUser = parallel(
        [
            { username: 'u1' }, { username: 'u2' },
            { username: 'u3' }, { username: 'u4' },
        ],
        { shard: true }
    );
}
```

Reads `CUCUMBER_WORKER_ID` (default `0`) and, in shard mode, `SHARD` (1-based).

## Logging memory mutations

Useful when debugging surprising values:

```typescript
import memory from '@qavajs/memory';
memory.setLogger({ log: (msg) => console.log('[memory]', msg) });
// [memory] $username -> alice
// [memory] $counter <- 5
```

For richer object output, override `convertToString`:

```typescript
import util from 'node:util';
memory.convertToString = (v) => util.inspect(v, { depth: null });
```

## Best practices

- **Keep secrets out of the map class.** Pull from `process.env` inside getter methods.
- **Don't store DOM nodes / Playwright handles in memory.** Memory is JSON-serialised by some formatters; opaque references will explode logs.
- **Prefer `{$x}` interpolation over string concatenation in Gherkin.** It's clearer and works inside step parameters that are themselves resolved.
- **Add helper computeds** (`now`, `uuid`, `randomEmail`) — they read better in scenarios than imported step utils.

## Live links

- `@qavajs/memory` README: <https://github.com/qavajs/memory/blob/main/README.md>
- Docs: <https://qavajs.github.io/docs/Commons/memory>

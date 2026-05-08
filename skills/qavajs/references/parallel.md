# parallel.md — parallel execution, sharding, retries, parallel data

## Process model

`qavajs run --parallel 4` forks four worker processes. Each worker independently loads the config, requires the step packages, and consumes scenarios from a shared queue. Workers don't share memory — every worker boots its own `Memory` instance.

Implications:

- Side-effecting setup must be **idempotent** (or scoped to `BeforeExecution`/`AfterExecution`, which run once in the parent before workers fork).
- Test data that must be unique per worker (logins, accounts, ports) is what `parallel(...)` solves.
- Console formatter output interleaves; use `@qavajs/console-formatter` (which prefixes lines with worker IDs) for readable parallel logs.

## Configuration

```typescript
export default {
    // ...
    parallel: 4,            // worker count
    retry: 1,               // retry failing scenarios once
    retryTagFilter: '@flaky', // only retry tagged scenarios
};
```

CLI overrides:

```bash
qavajs run --config config.ts --parallel 8 --retry 2 --retry-tag-filter '@flaky'
```

## Sharding (distributing across CI nodes)

`--shard 1/4` runs the first quarter of selected scenarios; `--shard 2/4` runs the next quarter; etc. Sharding happens **after** tag filtering, so `'@smoke and not @wip'` scenarios are split evenly. Pair with `parallel` inside each node:

```yaml
# .github/workflows/test.yml — matrix shards × parallel workers
matrix:
  shard: [1, 2, 3, 4]
steps:
  - run: npx qavajs run --config config.ts --shard ${{ matrix.shard }}/4 --parallel 4
```

## Parallel test data with `parallel(...)`

When two workers can't share an account, assign per-worker data in the memory map:

```typescript
import { parallel } from '@qavajs/memory/utils';

export class Memory {
    user = parallel([
        { username: 'user1', password: 'pwd' },
        { username: 'user2', password: 'pwd' },
        { username: 'user3', password: 'pwd' },
        { username: 'user4', password: 'pwd' },
    ]);
}
```

Reads `CUCUMBER_WORKER_ID` to pick its slot. Provide at least as many entries as your `--parallel` count.

For sharded **and** parallel runs, set `{ shard: true }` and `parallel(...)` will compute a unique global index across the matrix:

```typescript
shardUser = parallel(usersList, { shard: true });
// effective index = (SHARD - 1) * CUCUMBER_TOTAL_WORKERS + CUCUMBER_WORKER_ID
```

`SHARD` is 1-based. Provide `>= shards × workers` entries.

## Retries and quarantine

- `retry: N` retries any failed scenario up to `N` times.
- `retryTagFilter: '@flaky'` scopes retries to tagged scenarios — useful while quarantining known-flaky tests; tag stays as a TODO list.
- A retry runs the **whole scenario** including its hooks. If your hooks are expensive, prefer fixing the test over generous retries.

## Per-worker hooks

Use Cucumber's `BeforeAll`/`AfterAll` to set up resources scoped to one worker. Use `Fixture` for tag-scoped per-scenario setup. Use `BeforeExecution`/`AfterExecution` for once-per-run setup that all workers share (started in the parent process before forking).

## Common gotchas

- **Worker leakage**: page objects and clients are constructed per-scenario by the runner; if you cache them on `globalThis`, they leak between scenarios in the same worker. Don't.
- **Race on shared backends**: even with parallel data, two workers may collide on shared resources (e.g. a unique-key endpoint). Pre-seed enough variety.
- **Allure / ReportPortal**: with `parallel`, ensure the formatter you choose supports concurrent writes. `@qavajs/html-formatter` and Allure both do.
- **`--memory-values` is per-run, not per-worker**. To override per-worker, write a memory function that reads `CUCUMBER_WORKER_ID` itself.

## Live links

- Docs: <https://qavajs.github.io/docs/Guides/parallel>
- `parallel` source: <https://github.com/qavajs/memory/blob/main/src/utils.ts>

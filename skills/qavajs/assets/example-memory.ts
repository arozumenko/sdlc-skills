// example-memory.ts — Memory map registered as `config.memory`.
// Plain fields are constants; methods are computed (re-evaluated each read).
//
// @ts-nocheck — copy-paste template; types resolve in a project with `@qavajs/memory`
// and `@types/node` installed.

import crypto from 'node:crypto';
import { parallel } from '@qavajs/memory/utils';

export class Constants {
    // Core URLs (override per environment with --memory-values)
    todoUrl   = 'https://todomvc.com/examples/javascript-es6/dist/';
    baseUrl   = process.env.BASE_URL ?? 'https://example.com';
    apiBase   = process.env.API_BASE ?? 'https://jsonplaceholder.typicode.com';

    // Constants
    smokeTag  = '@smoke';

    // Computed values — call as $now(), $uuid(), $add(1, 2)
    now  = () => Date.now();
    uuid = () => crypto.randomUUID();
    add  = (a: number, b: number) => Number(a) + Number(b);
    randomEmail = () => `qa+${this.uuid()}@example.com`;

    // Per-worker test data — pick at least as many entries as your `parallel` count.
    user = parallel([
        { username: 'user1', password: 'pwd1' },
        { username: 'user2', password: 'pwd2' },
        { username: 'user3', password: 'pwd3' },
        { username: 'user4', password: 'pwd4' },
    ]);

    // For sharded matrix runs (CI shards × workers):
    // shardUser = parallel([...], { shard: true });
}

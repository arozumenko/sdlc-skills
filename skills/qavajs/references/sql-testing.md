# sql-testing.md — `@qavajs/steps-sql` for relational DB checks

Drives MySQL / PostgreSQL (and any class that implements `DBClient`) via Gherkin. Useful for pre-test seeding, post-test cleanup, and end-to-end checks where a UI/API action should reflect in a database row.

Source of truth: <https://qavajs.github.io/docs/Steps/sql>, <https://github.com/qavajs/steps-sql>

## Installation

```bash
npm install @qavajs/steps-sql
```

## Configuration

```typescript
// config.ts
import { MySQLClient, PgClient } from '@qavajs/steps-sql/clients';

export default {
    require: ['node_modules/@qavajs/steps-sql/index.js'],
    dbClients: {
        // Special key 'default' is what unscoped steps use
        default: new MySQLClient({
            host: process.env.DB_HOST ?? '127.0.0.1',
            port: 3306,
            database: 'qavajsdb',
            user: process.env.DB_USER,
            password: process.env.DB_PWD,
        }),
        // Additional named clients are addressed by name in scoped steps
        pg: new PgClient({
            host: process.env.PG_HOST ?? '127.0.0.1',
            port: 3307,
            database: 'qavajsdb2',
            username: process.env.PG_USER,
            password: process.env.PG_PWD,
        }),
    },
};
```

Bundled clients:

| Client        | Underlying driver |
|---------------|-------------------|
| `MySQLClient` | `mysql2` (v2.3.3) |
| `PgClient`    | `pg`              |

For other engines (MSSQL, Oracle, SQLite), implement the `DBClient` interface and pass an instance into `dbClients`.

## Two flavours of step

**Default DB** — uses the `dbClients.default` client:

```gherkin
When I execute SQL query:
  """
  select id, status from orders where customer_id = $customerId
  """
When I execute SQL query and save result as 'orderRows':
  """
  select * from orders where status = 'pending'
  """
When I execute 'select count(*) as n from orders' SQL query
When I execute 'select count(*) as n from orders' SQL query and save result as 'cnt'
```

**Specified DB** — picks a named client from the map:

```gherkin
When I execute SQL query in 'pg' db:
  """
  select * from analytics.events where session_id = $sid
  """
When I execute SQL query in 'pg' db and save result as 'events':
  """
  select * from analytics.events where session_id = $sid
  """
When I execute 'select 1' SQL query in 'aurora' db
When I execute 'select 1' SQL query in 'aurora' db and save result as 'ping'
```

Full literal patterns (8 in total) → [`steps-sql.md`](steps-sql.md).

## Common shapes

### Verify a UI action wrote a row

```gherkin
Scenario: Submitting the form persists the order
  Given I open '$baseUrl/checkout' url
  When I click 'Submit'
  And  I save '$js(`select * from orders where customer_id = ${$customerId} order by created desc limit 1`)' to memory as 'lookup'
  And  I execute '$lookup' SQL query and save result as 'orderRow'
  Then I expect '$orderRow[0].status' to equal 'pending'
  And  I expect '$orderRow[0].total' to equal '$expectedTotal'
```

### Seed test data, then UI assertion

```gherkin
Background: Pre-seed an order
  Given I execute SQL query:
    """
    insert into orders (customer_id, total, status) values ($customerId, 99.99, 'pending')
    """

Scenario: Customer sees their pending order
  When I open '$baseUrl/orders' url
  Then I expect 'Order Row > Status' to equal 'pending'
```

### Cleanup in `AfterExecution`

```typescript
// hooks.ts
import { AfterExecution } from '@qavajs/core';

AfterExecution(async function () {
    await this.dbClients.default.query("delete from orders where customer_id like 'qa-%'");
});
```

## Caveats

- **Result shape depends on the driver.** `MySQLClient` returns `RowDataPacket[]`; `PgClient` returns `{ rows, rowCount, ... }` and the steps save the rows. Inspect `$result` once with the memory logger and pin assertions to the actual shape.
- **No bound parameters.** The steps execute the query string verbatim — interpolate via `{$x}` from memory or via `$js(...)`. Sanitise inputs that come from external sources before letting them through.
- **Transactions don't span steps.** Each step opens its own connection (driver-managed pool). For a multi-statement test, put the whole block in one docstring or call a stored procedure.
- **Don't use this for migrations.** It's a test plumbing layer, not a schema tool.

## Live links

- Step catalog: [`steps-sql.md`](steps-sql.md)
- Source: <https://github.com/qavajs/steps-sql>
- Docs: <https://qavajs.github.io/docs/Steps/sql>

# Vividus Variables, Expressions, and ExamplesTable

## Contents

- [Variable scopes](#variable-scopes)
- [Reference syntax](#reference-syntax)
- [Expressions `#{...}`](#expressions)
- [ExamplesTable](#examplestable)
- [Table transformers](#table-transformers)
- [Saving runtime data into table-shaped variables](#saving-runtime-data-into-table-shaped-variables)

The "data plumbing" of Vividus stories. Every non-trivial test uses these — variable scoping, `#{...}` expressions, and ExamplesTable transformers.

Docs:
- Variables: https://docs.vividus.dev/vividus/latest/commons/variables.html
- Expressions: https://docs.vividus.dev/vividus/latest/commons/expressions.html
- Table transformers: https://docs.vividus.dev/vividus/latest/commons/table-transformers.html

---

## Variable scopes

Narrowest → widest. Narrower scopes shadow wider ones.

| Scope | Lifetime | Set by |
|---|---|---|
| `step` | Inside a single nested `When I execute steps:` block | `Given I initialize step variable ...` |
| `scenario` | Rest of the current scenario | `Given I initialize scenario variable ...` (default choice) |
| `story` | Rest of the current story | `Given I initialize story variable ...`. Story-scoped vars from a `GivenStories:` propagate to the parent. |
| `next_batches` | Visible to subsequent batches only | `Given I initialize next_batches variable ...` |
| `batch` | Within a batch | `batch-N.variables.<name>=<value>` properties |
| `global` | Whole run | `variables.<name>=<value>` properties |

**Default to `scenario` scope.** Promote to `story` only when the value must persist across scenarios in the same story.

### Initialize forms

```gherkin
Given I initialize scenario variable `userId` with value `42`
Given I initialize story variable `endpoint` with value `https://api.example.com`

When I initialize scenario variable `users` with values:
|name|age|
|Bob |30 |
|Eve |28 |

Given I initialize scenario variable `body` using template `/templates/user.ftl` with parameters:
|name|
|Bob |
```

Generic forms:
- `Given I initialize $scopes variable ` $name ` with value ` $value ``
- `When I initialize $scopes variable ` $name ` with values:$examplesTable`
- `Given I initialize $scopes variable ` $name ` using template ` $templatePath ` with parameters:$templateParameters`

`$scopes` is a comma-separated list of lowercase scopes (e.g. `scenario,story`).

---

## Reference syntax

| Form | Resolves to |
|---|---|
| `${var}` | Variable lookup. If not found locally → checks system properties → env vars → dynamic variables. |
| `${var:default}` | Variable with fallback default value (literal after `:`) |
| `${list[0]}` | Indexed access (lists, arrays, JSON arrays) |
| `${map.key}` | Key access (maps, objects) |
| `<col>` | ExamplesTable placeholder. Resolved BEFORE the step runs (compile-time). |
| `#{expr(...)}` | Expression evaluation at compile-time (data generation, format, transform) |

### Resolution order

1. Local variable in current scope chain (step → scenario → story → next_batches → batch → global)
2. Default after `:` (if specified)
3. JVM system property
4. OS environment variable
5. Dynamic variables (see below)

### Dynamic (built-in) variables

Populated automatically by certain steps. Read-only.

| Name | Source |
|---|---|
| `${responseCode}`, `${response-code}` | Last HTTP status code (REST plugin) |
| `${response}` | Last HTTP response body (text) |
| `${response-as-bytes}` | Last HTTP response body (bytes) |
| `${json-context}` | Current JSON context (set by JSON-context steps) |
| `${running-story}` | Current story file name |
| `${running-scenario}` | Current scenario title |
| `${current-page-url}` | URL currently loaded in the browser (web plugin) |

> **`web-application.main-page-url` is NOT a story variable.** It is a Spring configuration property used internally by the web plugin. Use `Given I am on main application page` to navigate to it. To reference the URL in story expressions, declare a parallel `variables.appUrl=https://...` entry in `environment.properties`.

---

## Expressions `#{...}`

Compile-time evaluation. Run before step matching, so the result is what the step sees.

### Data generation (datafaker-backed)
```
#{generate(Internet.emailAddress)}
#{generate(Person.firstName)}
#{generate(Person.fullName)}
#{generate(Address.fullAddress)}
#{generate(Commerce.price '5.5' '10.10')}
#{generate(Aviation.airport)}
#{generate(Finance.creditCard)}
```
Hundreds of providers exposed via datafaker; full list: https://www.datafaker.net/.

### Date / time
```
#{generateDate(P0D, yyyy-MM-dd)}                  # today
#{generateDate(P-1D, yyyy-MM-dd)}                 # yesterday
#{generateDate(P3M, yyyy-MM-dd'T'HH:mm:ss)}       # +3 months, ISO datetime
#{formatDate(${someDate}, yyyy-MM-dd, UTC)}
```
Duration is **ISO-8601** (`PnYnMnDTnHnMnS`).

### Encoding / hashing
```
#{toBase64(plain text)}
#{fromBase64(SGVsbG8=)}
#{toBase64Url(...)}
#{decodeFromBase64Url(...)}
#{md5(${value})}
#{sha256(${value})}
#{toBytes(${value})}
```

### Strings
```
#{toLowerCase(${name})}
#{toUpperCase(${name})}
#{trim( hello )}
#{capitalize(hello)}
#{replaceAll(`abc123`, `\d+`, `XXX`)}
#{escapeHTML(<b>x</b>)}
#{escapeJSON(...)}
```

### Math / logic
```
#{eval(2 + 2)}
#{eval(${a} * ${b})}
#{anyOf(red,blue,green)}
```

### IO / load
```
#{loadResource(/data/payload.json)}                   # load classpath resource
#{loadResourceAsBytes(/data/photo.png)}
#{readFile(/abs/path/to/file.txt)}
```

### Special
```
#{null}                                                # literal null
#{escape(...)}
#{wrapStringValue(`abc`, `"`)}
```

### Nesting & escapes
- Expressions can nest: `#{toBase64(#{generate(Person.fullName)})}`.
- To pass commas inside expression args, wrap the arg in backticks: `#{replaceAll(`a,b,c`, `,`, `;`)}`.
- To produce a literal `#{...}`, escape with backslash: `\#{not-an-expression}`.

---

## ExamplesTable

Data tables that drive parameterized scenarios or row-iteration. Inline or external (CSV, Excel, JSON, DB, ...).

### Inline scenario examples
```gherkin
Scenario: Validate match
Then `<input>` matches `<regex>`
Examples:
|input|regex   |
|abc12|[a-z]+\d+|
|x9   |.*\d    |
```
Scenario runs once per row; `<input>` and `<regex>` resolve from each row.

### Story-level examples (in `Lifecycle:`)
```gherkin
Lifecycle:
Examples:
|env  |
|stage|
|prod |
```
**Every** scenario in the story runs once per row; `<env>` available everywhere.

### Inline table options
```gherkin
Examples:
{processEscapeSequences=true}
|header        |
|line 1\nline 2|
```

### External table file
```gherkin
Examples:
/data/tables/users.table
```
The file (`.table`) is a plain text table in the same `|...|` format. Lives anywhere on the classpath under `src/main/resources/`.

---

## Table transformers

Declarative chain of transformations applied to a table at compile-time. Each `{transformer=...}` line is one transformer; multiple lines stack top-to-bottom.

### Loaders

```gherkin
Examples:
{transformer=FROM_CSV, path=/data/users.csv}

Examples:
{transformer=FROM_CSV, path=/data/users.csv, delimiterChar=;, quoteChar=", commentMarker=#}

Examples:
{transformer=FROM_EXCEL, path=/data/data.xlsx, sheet=Users, range=A1:C20}

Examples:
{transformer=FROM_JSON, path=/data/users.json, columns=name=$.name;email=$.email}

Examples:
{transformer=FROM_DB, dbKey=app-db, sqlQuery=SELECT name\, description FROM products}

Examples:
{transformer=FROM_LANDSCAPE}
|key1|val1|
|key2|val2|
```

`FROM_LANDSCAPE` flips a 2-row landscape table (headers row, values row → key/value pairs).

### Filters / shapers

```gherkin
{transformer=FILTERING, byColumns=name;email, byMaxRows=10, byColumnNames=name;email}
{transformer=DISTINCTING}
{transformer=SORTING, byColumns=name, sortingTypes=STRING, order=ASCENDING}
{transformer=INDEXING, columnName=row-index}
{transformer=ITERATING, startInclusive=0, endInclusive=2}
{transformer=REPEATING, times=3}
{transformer=FORMATTING, columns=price, format=%.2f}
{transformer=REPLACING, replacing=pattern, replacement=text}
```

### Combiners

```gherkin
{transformer=MERGING, mergeMode=rows, tables=/tables/a.table;/tables/b.table}
{transformer=MERGING, mergeMode=columns, tables=/tables/a.table;/tables/b.table, fillerValue=}

{transformer=JOINING, joinType=cross, tables=/tables/a.table;/tables/b.table}
{transformer=INNER_JOIN, leftTableJoinColumn=id, rightTableJoinColumn=user_id, tables=...}
{transformer=LEFT_JOIN, leftTableJoinColumn=id, rightTableJoinColumn=user_id, tables=...}
{transformer=CARTESIAN_PRODUCT, tables=/a.table;/b.table}
```

### Eager resolvers

Force `${var}` / `#{expr}` / self-references to resolve when the table is built (rather than per-step):

```gherkin
{transformer=RESOLVING_VARIABLES_EAGERLY}
{transformer=RESOLVING_EXPRESSIONS_EAGERLY}
{transformer=RESOLVING_SELF_REFERENCES_EAGERLY}
```

Use these when a downstream transformer or step needs the *resolved* value (e.g., `SORTING` after random-name generation).

### Chaining

```gherkin
Examples:
{transformer=FROM_CSV, path=/data/users.csv}
{transformer=FILTERING, byMaxRows=10}
{transformer=SORTING, byColumns=name, order=ASCENDING}
```

---

## Saving runtime data into table-shaped variables

```gherkin
When I save CSV `${csv}` to scenario variable `rows`
Then `${rows[1].key2}` is equal to `val2-2`

When I save JSON element from `${response}` by JSON path `$.users` to scenario variable `users`
Then `${users[0].email}` is equal to `bob@example.com`
```

Indexed access syntax (`${var[i].field}`) works for any list-of-maps shape — JSON arrays, DB result sets, parsed CSV, etc.

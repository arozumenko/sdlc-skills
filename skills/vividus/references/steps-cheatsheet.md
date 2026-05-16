# Vividus Step Cheatsheet

Exact step phrasings for the most-used Vividus plugins. Vividus matches steps by **wording**, including parameter syntax — copy phrasings verbatim, then substitute backtick-wrapped parameters.

Read order:
- [General syntax rules](#general-syntax-rules) — backticks, locators, comparators
- [Variables & expressions](#variables--expressions)
- [Web UI](#web-ui-vividus-plugin-web-app) (vividus-plugin-web-app)
- [Visual testing](#visual-testing-vividus-plugin-visual) (vividus-plugin-visual)
- [REST API](#rest-api-vividus-plugin-rest-api) (vividus-plugin-rest-api)
- [JSON](#json-vividus-plugin-json) (vividus-plugin-json)
- [Database](#database-vividus-plugin-db) (vividus-plugin-db)
- [Mobile](#mobile-vividus-plugin-mobile-app) (vividus-plugin-mobile-app)
- [Lifecycle hooks](#lifecycle-hooks)
- [Composite steps](#composite-steps)
- [Control flow](#control-flow)

For every plugin's full reference: https://docs.vividus.dev/vividus/latest/plugins/plugin-<name>.html

---

## General syntax rules

- Step parameters are wrapped in **backticks**: `` Then `${actual}` is equal to `5` ``. Single/double quotes will not match.
- Locator strings are also backticked: `` When I click on element located by `id(submit)` ``.
- Comments inside a story start with `!--` (line-leading).
- Tables follow a step on the next lines, columns separated by `|`. The step's tail must reference the table — many take `:examplesTable` as the trailing parameter, written simply as `:` then a newline + table.

### Locator format

`<type>(<value>):<visibility>->filter.<filterType>(<filterValue>)`

- Types: `id`, `cssSelector`, `xpath` (whitespace-normalized) / `unnormalizedXPath`, `tagName`, `className`, `linkText`, `linkUrl`, `linkUrlPart`, `caseSensitiveText`, `caseInsensitiveText`, `imageSrc`, `imageSrcPart`, `buttonName`, `fieldName`, `radioButton`, `checkboxName`, `elementName`, `name`, `shadowCssSelector`, `accessibilityId` (mobile).
- Visibility (optional): `:v` visible (default), `:i` invisible, `:a` all.
- Filters chain: `->filter.index(2)`, `->filter.textPart(Submit)`, `->filter.attribute(class=active)`, `->filter.state(ENABLED)`, `->filter.tooltip(...)`, `->filter.dropDownText(...)`.

Examples:
```
id(login)
xpath(//button[@type='submit'])
cssSelector(.menu li > a)
linkText(Sign in)
xpath(//div):a->filter.attribute(class=active)
tagName(div)->filter.index(2)->filter.textPart(Hello)
shadowCssSelector(.host; #inner; .target)
```

### Comparison rules

Used in many assertion steps as `$comparisonRule`. Plain or readable forms accepted:

| Plain | Readable | Math | Alias |
|---|---|---|---|
| LESS_THAN | `is less than` | `<` | — |
| LESS_THAN_OR_EQUAL_TO | `is less than or equal to` | `<=` | `is at most` |
| GREATER_THAN | `is greater than` | `>` | — |
| GREATER_THAN_OR_EQUAL_TO | `is greater than or equal to` | `>=` | `is at least` |
| EQUAL_TO | `is equal to` | `=` | — |
| NOT_EQUAL_TO | `is not equal to` | `!=` | — |

String comparison rule additionally supports: `contains`, `does not contain`, `matches` (regex, DOTALL on by default).
Collection: `is equal to`, `is equal to ordered collection`.

Doc: https://docs.vividus.dev/vividus/latest/parameters/comparison-rule.html

---

## Variables & expressions

### Initialize a variable
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
- `Given I initialize $scopes variable `$variableName` with value `$variableValue` `
- `When I initialize $scopes variable `$variableName` with values:$examplesTable`
- `Given I initialize $scopes variable `$variableName` using template `$templatePath` with parameters:$templateParameters`

Scopes (lowercase, comma-separated when multiple): `step`, `scenario`, `story`, `next_batches`, `batch`, `global`. Use `scenario` by default.

### Reference syntax

| Form | Meaning |
|---|---|
| `${var}` | Variable lookup (also matches system property / env var if no local) |
| `${var:default}` | With fallback default value |
| `${list[0]}` | Indexed list element |
| `${map.key}` | Map field |
| `<col>` | ExamplesTable column placeholder (resolved before the step runs) |
| `#{expression(...)}` | Compile-time expression (Faker, dates, base64, regex, etc.) |

### Common expressions
```
#{generate(Internet.emailAddress)}
#{generate(Person.firstName)}
#{generateDate(P-1D, yyyy-MM-dd)}        # ISO-8601 duration offset
#{formatDate(${now}, yyyy-MM-dd)}
#{toBase64(plain text)}
#{fromBase64(...)}
#{toLowerCase(${name})}
#{trim( hello )}
#{replaceAll(`abc123`, `\d+`, `XXX`)}
#{eval(2 + 2)}
#{loadResource(/data/payload.json)}
#{null}
```

Full expressions doc: https://docs.vividus.dev/vividus/latest/commons/expressions.html

### Dynamic variables (read-only, populated by other steps)
- `${responseCode}` / `${response-code}` — last HTTP status code
- `${response}` — last HTTP body as text
- `${response-as-bytes}` — last HTTP body as bytes
- `${json-context}` — current JSON context (set by JSON steps that change context)
- `${running-story}` / `${running-scenario}` — names of in-progress story/scenario
- `${current-page-url}` — URL currently loaded in the browser (web plugin)

**Asserting the current URL** — use `${current-page-url}` with a comparison step; there is no dedicated `Then page URL …` assertion step:
```gherkin
Then `${current-page-url}` is equal to `https://example.com/about`
Then `${current-page-url}` contains `/about`
Then `${current-page-url}` matches `https://example\.com/products/\d+`
```

---

## Web UI (vividus-plugin-web-app)

Doc: https://docs.vividus.dev/vividus/latest/plugins/plugin-web-app.html

### Navigation
```gherkin
Given I am on main application page
Given I am on page with URL `https://example.com`
When I open URL `${url}` in new window
When I go to relative URL `/about`
When I refresh page
When I navigate back
```

### Click / mouse
```gherkin
When I click on element located by `id(submit)`
When I perform right-click on element located by `xpath(//tr[1])`
When I hover mouse over element located by `cssSelector(.menu)`
When I scroll element located by `id(footer)` into view
```

### Typing & fields
```gherkin
When I enter `bob@example.com` in field located by `fieldName(email)`
When I add ` extra` to field located by `id(notes)`
When I clear field located by `id(search)`
When I clear field located by `id(search)` using keyboard
```

### Waits
```gherkin
When I wait until element located by `id(spinner)` disappears
When I wait until element located by `id(banner)` appears
When I wait until element located by `xpath(//h1)` has text matching `Welcome.*`
When I wait `PT5S` until tab with title that is equal to `Result` appears and switch to it
```

### Assertions
```gherkin
Then number of elements found by `cssSelector(.row)` is equal to `5`
Then text `Order placed` exists
Then text `Error` does not exist
Then text matches `Order #\d+`
Then page title is equal to `Dashboard`
Then page title contains `Dashboard`
Then page title matches `Dash.*`
Then there are no browser console ERRORS
```

> **No `Then page URL …` step.** Assert the current URL via the dynamic variable:
> ```gherkin
> Then `${current-page-url}` contains `/dashboard`
> ```

### Context, frames, tabs, windows
```gherkin
When I change context to element located by `cssSelector(.modal)`
When I reset context
When I switch to frame located by `id(checkout-frame)`
When I switch back to page
When I open new tab
When I open URL `${url}` in new tab
When I switch to tab with title that is equal to `Cart`
When I close current tab
```

### Save / extract
```gherkin
When I save text of element located by `id(price)` to scenario variable `price`
When I save `href` attribute value of element located by `linkText(Next)` to scenario variable `nextUrl`
When I save number of elements located by `cssSelector(.row)` to scenario variable `rows`
When I execute javascript `return document.title` and save result to scenario variable `t`
```

### File / drag / screenshot
```gherkin
When I select element located by `id(file)` and upload file `/data/sample.pdf`
When I drag element located by `id(card)` and drop it at TOP_RIGHT of element located by `id(target)`
When I take screenshot
```

---

## Visual testing (vividus-plugin-visual)

Doc: https://docs.vividus.dev/vividus/latest/plugins/plugin-visual.html

Plugin: `implementation('org.vividus:vividus-plugin-visual')`

### Step pattern
```gherkin
When I $actionType baseline with name `$name`
When I $actionType baseline with name `$name` ignoring:$checkSettings
```

`$actionType`:
- `ESTABLISH` — capture and save a baseline screenshot
- `COMPARE_AGAINST` — diff current page against saved baseline; fail if diff > threshold
- `CHECK_INEQUALITY_AGAINST` — fail if page looks **too similar** (verify a change landed)

### Ignoring dynamic regions
```gherkin
When I COMPARE_AGAINST baseline with name `home` ignoring:
|ELEMENT                                          |
|cssSelector(.cookie-banner, .live-chat, .ticker) |
```

Table columns: `ELEMENT` (locator), `AREA` (pixel rect), `ACCEPTABLE_DIFF_PERCENTAGE`, `REQUIRED_DIFF_PERCENTAGE`.

> **One row only.** The `ignoring:` table supports exactly one data row. Combine multiple selectors in a CSS multi-selector string — do not add extra rows.

### Key properties
```properties
ui.visual.acceptable-diff-percentage=2   # global diff tolerance (default: 0)
ui.visual.baseline-storage.filesystem.folder=./baselines  # relative to src/main/resources
```

### Resize window before capture (for consistent screenshots)
```gherkin
When I change window size to `1440x900`
```

---

## REST API (vividus-plugin-rest-api)

Doc: https://docs.vividus.dev/vividus/latest/plugins/plugin-rest-api.html

### Headers & config
```gherkin
When I set request headers:
|name         |value           |
|Content-Type |application/json|
|Authorization|Bearer ${token} |
When I add request headers:
|name|value|
|X-Trace|1|
When I set HTTP request configuration:
|connectTimeout|circularRedirectsAllowed|
|PT30S         |true                    |
```

### Body
```gherkin
Given request body: {"name":"Bob","age":30}
Given multipart request:
|type  |name |value             |contentType|fileName|
|FILE  |file |/data/photo.png   |image/png  |        |
|STRING|note |hello             |text/plain |        |
Given form data request:
|name |value|
|user |bob  |
|pass |x    |
```

### Execute
```gherkin
When I execute HTTP GET request for resource with URL `https://api.example.com/users/1`
When I execute HTTP POST request for resource with relative URL `/login`
When I execute HTTP DELETE request for resource with URL `${http-endpoint}items/${id}`
```
Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. The "relative URL" form prefixes `rest-api.http.endpoint` from properties.

### Response assertions
```gherkin
Then response code is equal to `200`
Then response code is greater than `199`
Then response time is less than `2000` milliseconds
Then content type of response body is equal to `application/json`
Then size of decompressed response body is greater than `0`
Then response does not contain body
Then number of response headers with name `Set-Cookie` is greater than `0`
Then value of response header `Content-Type` is equal to `application/json`
Then response header `Cache-Control` contains elements:
|element |
|no-cache|
```

### Save / cookies / wait
```gherkin
When I save response header `Location` value to scenario variable `redirect`
When I save value of HTTP cookie with name `JSESSIONID` to story variable `session`
When I change value of all HTTP cookies with name `lang` to `en-US`
When I remove all HTTP cookies
When I wait for response code `200` for `PT30S` duration retrying 5 times
Then HTTP resources are valid:
|url               |
|${host}/about.html|
Then I validate HTTP redirects:
|startUrl|endUrl|redirectsNumber|statusCodes|
|/old    |/new  |1              |301        |
```

### JWT
```gherkin
When I generate JWT with header `${h}` and payload `${p}` signed with key `${k}` using HS256 algorithm and save result to scenario variable `jwt`
```

---

## JSON (vividus-plugin-json)

Doc: https://docs.vividus.dev/vividus/latest/plugins/plugin-json.html

### Assert by JSONPath
```gherkin
Then JSON element value from `${response}` by JSON path `$.user.name` is equal to `Bob`
Then JSON element from `${response}` by JSON path `$.user` is equal to `{"name":"Bob","age":30}`
Then number of JSON elements from `${response}` by JSON path `$.items[*]` is equal to `3`
Then JSON `${response}` is valid against schema `${schema}`
```

### Save by JSONPath
```gherkin
When I save JSON element value from `${response}` by JSON path `$.token` to scenario variable `token`
When I save JSON element from `${response}` by JSON path `$.user` to scenario variable `user`
When I save number of elements from `${response}` found by JSON path `$.items[*]` to scenario variable `count`
```

### Iterate elements
```gherkin
When I find > `0` JSON elements from `${response}` by `$.items[*]` and for each element do
|step                                                                              |
|Then JSON element value from `${json-context}` by JSON path `$.id` matches `\d+`  |
```

---

## Database (vividus-plugin-db)

Doc: https://docs.vividus.dev/vividus/latest/plugins/plugin-db.html

Connection keys (`prod-db`, `db1`, ...) come from `db.connection.<key>.*` properties.

```gherkin
When I execute SQL query `SELECT * FROM users WHERE id=1` against `prod-db` and save result to scenario variable `users`
Then `${users[0].name}` is equal to `Bob`

When I execute SQL query `UPDATE users SET active=true WHERE id=1` against `prod-db`

Then data from `SELECT name, country FROM rockets` executed against `db1` is equal to data from `SELECT name, country FROM expected_rockets` executed against `db2` matching rows using keys:
|key |
|name|

Then `${users}` matching rows using `id` from `prod-db` is equal to data from:
|id|name|
|1 |Bob |
|2 |Eve |
```

Properties:
```properties
db.connection.prod-db.driver-class-name=org.postgresql.Driver
db.connection.prod-db.url=jdbc:postgresql://localhost:5432/app
db.connection.prod-db.username=...
db.connection.prod-db.password=...
```

---

## Mobile (vividus-plugin-mobile-app)

Doc: https://docs.vividus.dev/vividus/latest/plugins/plugin-mobile-app.html

```gherkin
When I tap on element located by `accessibilityId(login)`
When I tap on element located by `xpath(//XCUIElementTypeButton)` with duration `PT2S`
When I double tap on element located by `id(logo)`

When I type `bob@example.com` in field located `accessibilityId(emailField)`
When I type `secret` in field located `accessibilityId(pwd)` and keep keyboard opened
When I clear field located `accessibilityId(notes)`

When I swipe UP to element located by `accessibilityId(footer)` with duration `PT1S`
When I navigate back

When I switch to web view with name that is equal to `WEBVIEW_chrome`
When I switch to native context

When I change context to element located by `accessibilityId(modal)`
When I reset context

Then number of elements found by `accessibilityId(row)` is equal to `5`
When I wait until element located by `accessibilityId(banner)` appears
```

---

## Lifecycle hooks

Top-level `Lifecycle:` block appears once per story, before the first scenario:

```gherkin
Lifecycle:
Before:
Scope: STORY
Given I initialize story variable `endpoint` with value `https://api.${env}.example.com`
Scope: SCENARIO
When I set request headers:
|name        |value           |
|Content-Type|application/json|
After:
Scope: SCENARIO
Outcome: ANY
Then response code is less than `500`
Examples:
|env  |
|stage|
|prod |
```

- `Scope:` of `STORY`, `SCENARIO`, or `STEP`.
- `Outcome:` (in `After:` only): `ANY` (default), `SUCCESS`, `FAILURE`.
- A story-level `Examples:` inside `Lifecycle:` parameterizes every scenario in the story, once per row.

---

## Composite steps

User-defined step phrases that expand into a sequence of existing steps. Loaded via `engine.composite-paths=steps/**/*.steps`. Files live at `src/main/resources/steps/...`.

Header: `Composite: <Given|When|Then> <step phrase with $params>`. Body steps reference parameters as `<paramName>` (angle brackets), not `$paramName`.

```gherkin
Composite: When I login with username `$username` and password `$password`
When I enter `<username>` in field located by `id(username)`
When I enter `<password>` in field located by `id(password)`
When I click on element located by `id(signInButton)`

Composite: When I run with table:$table
When I initialize scenario variable `table-from-composite` with values:<table>
```

Composites can call other composites and use control-flow steps. Comments inside `.steps` use `!--`. See `assets/example.steps` for a complete file.

---

## Control flow

```gherkin
When I execute steps:
|step                                                  |
|Given I initialize scenario variable `tries` with `0` |
|Then `${tries}` is less than `3`                       |

When I execute steps while counter is < `3` with increment `1` starting from `0`:
|step                                                  |
|When I click on element located by `id(load-more)`    |

When I execute steps at most 5 times while variable `done` is = `false`:
|step                                                  |
|When I refresh page                                   |

When the condition `${flag}` is true I do
|step                                  |
|Then text `Welcome` exists            |

When variable `token` is set I do:
|step                                                  |
|When I add request headers:                           |
|...                                                   |

When I wait `PT30S` for debug
```

---

## Source URLs

- Docs index: https://docs.vividus.dev/vividus/latest/
- Step source (annotation = exact phrasing) for web: https://github.com/vividus-framework/vividus/tree/master/vividus-plugin-web-app/src/main/java/org/vividus/steps/ui/web
- Real story examples: https://github.com/vividus-framework/vividus/tree/master/vividus-tests/src/main/resources/story/integration
- Composite step examples: https://github.com/vividus-framework/vividus/blob/master/vividus-tests/src/main/resources/steps/composite.steps
- Variables: https://docs.vividus.dev/vividus/latest/commons/variables.html
- Core (out-of-the-box) steps: https://docs.vividus.dev/vividus/latest/commons/vividus-steps.html
- Table transformers: https://docs.vividus.dev/vividus/latest/commons/table-transformers.html
- Comparison rules: https://docs.vividus.dev/vividus/latest/parameters/comparison-rule.html

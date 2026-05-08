# api-testing.md — `@qavajs/steps-api` recipes

Drives REST, GraphQL, and WebSocket interactions with literal Gherkin steps. Activated with `'node_modules/@qavajs/steps-api/index.js'` in `config.require`. Pair with `@qavajs/steps-memory` for save/expect plumbing.

Full literal step list: [`steps-api.md`](steps-api.md). Source: <https://github.com/qavajs/steps-api>

## Two styles: direct vs builder

**Direct** — one step sends and saves:

```gherkin
When I send "GET" request to "$BASE/users/1" and save response as "r"
And  I parse "$r" body as json
Then I expect "$r.status" to equal "200"
And  I expect "$r.payload.id" to equal "1"
```

**Builder** — assemble piece-by-piece (useful for shared headers, complex bodies, file uploads):

```gherkin
Given I create "POST" request "req"
And   I add "$BASE/users" url to "$req"
And   I add headers to "$req":
      | Authorization | Bearer $token |
      | Content-Type  | application/json |
And   I add body to "$req":
      """
      { "name": "Alice", "role": "$role" }
      """
When  I send "$req" request and save response as "r"
And   I parse "$r" body as json
Then  I expect "$r.status" to equal "201"
```

Builder steps live in `apiConstructionSteps.ts`. They're chainable and each `add ...` mutates the request stored in memory.

## Response shape

After parsing, a response is an object with at least:

- `.status` (number)
- `.statusText` (string)
- `.headers` (record)
- `.payload` (parsed body, type depends on the parser used)

Parser keywords accepted by `I parse '$r' body as <bodyParsingType>`:

`json`, `text`, `blob`, `formData`, `arrayBuffer`. For other formats, supply a custom parser stored in memory: `I parse '$r' body as '$xmlParser'`.

## Verification step shapes

```gherkin
Then Response "$r.payload.id" equals to "1"
Then Response "$r.payload.tags" type equals to "array"
Then Response "$r.payload.tags" array size to be above "0"
Then Response "$r.payload" contains following properties:
     | id    |
     | name  |
     | email |
```

For deeper checks, fall back to `@qavajs/steps-memory`'s generic validators:

```gherkin
Then I expect "$r.status" to equal "200"
Then I expect "$r.payload" to deeply equal "$expectedJson"
Then I expect every element in "$r.payload.items" array to have property "id"
```

## File uploads (multipart)

```gherkin
Given I create "POST" request "upload"
And   I add "$BASE/files" url to "$upload"
And   I add form data body to "$upload":
      | field | value             | filename     | contentType   |
      | file  | $file('cat.png')  | cat.png      | image/png     |
      | name  | $name             |              |               |
When  I send "$upload" request and save response as "r"
```

`$file('path')` and `$textFile('path')` are computed memory helpers — the package registers them when loaded.

## GraphQL

```gherkin
Given I create GraphQL request "gql"
And   I add "$BASE/graphql" url to "$gql"
And   I add query to "$gql":
      """
      query GetUser($id: ID!) {
        user(id: $id) { id name email }
      }
      """
And   I add variables to "$gql":
      """
      { "id": "$userId" }
      """
When  I send "$gql" request and save response as "r"
And   I parse "$r" body as json
Then  I expect "$r.payload.data.user.id" to equal "$userId"
```

## WebSocket

```gherkin
Given I connect to "$WS_URL" ws endpoint "ws"
When  I send message to "$ws" ws endpoint:
      """
      { "subscribe": "ticker" }
      """
And   I save next message from "$ws" ws endpoint as "msg"
Then  I expect "$msg" to contain "ticker"
And   I close "$ws" ws connection
```

There's also `I save message matching '<regex>' from 'ws' …` for filtering streams.

## SOAP

There's no first-class SOAP step set, but the same builder works — set `Content-Type: text/xml; charset=utf-8`, attach a SOAP envelope as the body, and parse the response with a custom XML parser (e.g. `fast-xml-parser` registered as a memory function).

## Patterns to repeat

- **Always parse before asserting** — the `I parse "$r" body as json` step is what populates `$r.payload`. Skipping it leads to "undefined" assertions.
- **Save base URL and tokens in memory** so scenarios stay environment-agnostic. Override with `--memory-values '{"BASE":"https://staging"}'`.
- **Use `softly` for response shape checks**, especially when verifying many fields.
- **For polling endpoints (eventual consistency, async jobs)**, wrap the assertion in a poll using `@qavajs/validation`'s `expect(() => …).poll().toEqual(…)` from a custom step, or write a `I refresh response 'r' until …` micro-step in your project.

## Live links

- `@qavajs/steps-api`: <https://github.com/qavajs/steps-api>
- Docs: <https://qavajs.github.io/docs/Steps/api>
- Demo: <https://github.com/qavajs/demo/tree/main/web-api>

# Confluence Server / Data Center — what's different from Cloud

The **storage format** is the same XHTML-ish dialect on Server and
on Cloud — Cloud inherited it from Server. Read
`confluence-storage.md` for the body syntax (paragraphs, lists,
tables, macros). This file covers **only** the Server-specific
differences: base URL, API path, auth, mentions, and the
`body.wiki` input shortcut.

## Base URL — no `/wiki/` prefix

| Deployment | Typical base | API path |
|---|---|---|
| Cloud | `https://acme.atlassian.net/wiki` | `…/wiki/rest/api/content` |
| Server / DC | `https://confluence.company.com` | `…/rest/api/content` |

Server installs Confluence at its own root (or under `/confluence`
if explicitly configured). There is **no implicit `/wiki/`
prefix** — hard-coding `/wiki/` will return 404.

Check the deployment's actual context path in
`.agents/profile.md` § Project systems or ask the operator.

## REST endpoints (Server / DC v1)

| Operation | Method + path |
|---|---|
| Create page | `POST /rest/api/content` |
| Read page | `GET /rest/api/content/{id}?expand=body.storage,version,space` |
| Update page | `PUT /rest/api/content/{id}` (must include `version.number + 1`) |
| Delete page | `DELETE /rest/api/content/{id}` |
| Find by space+title | `GET /rest/api/content?spaceKey=ENG&title=My+Page&expand=version` |
| Add page comment | `POST /rest/api/content` with `"type": "comment"` + `container` |
| User by username | `GET /rest/api/user?username=<name>` |
| User by userkey | `GET /rest/api/user?key=<userKey>` |
| Convert wiki → storage | `POST /rest/api/contentbody/convert/storage` |

The wrapper JSON shape is identical to Cloud v1. Create payload:

```json
POST /rest/api/content
{
  "type": "page",
  "title": "API Architecture Notes",
  "space": { "key": "ENG" },
  "ancestors": [ { "id": "65538" } ],
  "body": {
    "storage": {
      "value": "<p>Hello <strong>world</strong>.</p>",
      "representation": "storage"
    }
  }
}
```

Update payload — **`version.number` is required and must be the
current value + 1**:

```json
PUT /rest/api/content/{id}
{
  "type": "page",
  "title": "API Architecture Notes",
  "version": { "number": 5 },
  "body": {
    "storage": {
      "value": "<p>Updated content.</p>",
      "representation": "storage"
    }
  }
}
```

Read raw + rendered:

```
GET /rest/api/content/{id}?expand=body.storage,body.view,version
```

## Authentication

| Method | Header |
|---|---|
| Basic auth | `Authorization: Basic base64(user:password)` |
| Personal Access Token | `Authorization: Bearer <PAT>` (Confluence 7.9+ / DC) |

PATs are created at avatar → Profile → Personal Access Tokens.
They cannot be used as a Basic password — that returns 401
`AUTHENTICATED_FAILED`.

## Mentions — `ri:userkey` or `ri:username`, never `ri:account-id`

Cloud uses `ri:account-id`. **Server / DC does not.** Use either
of these forms inside storage format:

```html
<ac:link>
  <ri:user ri:userkey="ff8080814ba236dc014ba236f4e40001" />
</ac:link>
```

```html
<ac:link>
  <ri:user ri:username="jsmith" />
</ac:link>
```

Confluence Server will normalise `ri:username` → `ri:userkey` on
save (the `userkey` is the stable per-instance identifier).

Posting `ri:account-id="…"` to Server produces a broken-link
placeholder in the rendered page.

### Look up the userkey / username

```
GET /rest/api/user?username=jsmith
→ {
    "username": "jsmith",
    "userKey": "ff8080814ba236dc014ba236f4e40001",   ← ri:userkey
    "displayName": "Jane Smith",
    "type": "known"
  }
```

In Confluence Server, **`accountId` is absent**. Cache by
username, store the `userKey` so future mentions can use the
stable form.

Full paragraph example:

```html
<p>
  Hi
  <ac:link><ri:user ri:username="jsmith" /></ac:link>,
  please review.
</p>
```

## `body.wiki` — Jira-style wiki markup as input (Server-only)

Confluence Server's v1 REST API accepts three input
representations on `POST` / `PUT /rest/api/content`:

- `storage` — XHTML storage format (canonical, recommended).
- `editor` — the in-browser editor's intermediate format.
- `wiki` — **Jira-style wiki markup**. Server-side converter
  expands it to storage and persists that.

This is a hidden escape hatch when your agent already speaks
Jira wiki notation. Example:

```json
POST /rest/api/content
{
  "type": "page",
  "title": "Release Notes 2026.05",
  "space": { "key": "REL" },
  "body": {
    "wiki": {
      "value": "h1. 2026.05\n\n* New: foo\n* Fixed: bar\n\n{code:bash}\n./deploy.sh\n{code}\n\ncc [~jsmith]",
      "representation": "wiki"
    }
  }
}
```

Caveats:

- **Cloud v2 removed `body.wiki` from Update Content**; it still
  works on Server / DC v1. Don't port the payload to Cloud
  unchanged.
- On `GET`, you cannot read back `body.wiki` — the API exposes
  only `body.storage`, `body.view`, `body.export_view`,
  `body.styled_view`, `body.editor`. To round-trip wiki, POST
  the storage value back through the converter:

  ```
  POST /rest/api/contentbody/convert/storage
  { "value": "h1. Hello", "representation": "wiki" }
  → { "value": "<h1>Hello</h1>", "representation": "storage" }
  ```

- After a `wiki` POST, treat the page as storage-format from then
  on — any subsequent updates should use the persisted
  `body.storage.value` as the base (raw-fetch first, per
  `verification.md` § "Before you update: raw-fetch first").

## Storage format vs wiki markup — which to use

| Use case | Recommended input |
|---|---|
| Net-new page authored programmatically | `body.storage` (XHTML) — explicit, round-trippable |
| Net-new page where you already have wiki markup (e.g. ported from a Jira description) | `body.wiki` once, then storage from then on |
| Updating an existing page | `body.storage` — preserves macros and custom nodes already on the page |

Updating with `body.wiki` overwrites the entire page body —
including any macros / custom nodes the previous storage value
contained, since the converter only emits the subset it knows.
**Always raw-fetch + edit-into-storage for updates.**

## Worked example — full page-create payload (storage format)

```json
POST /rest/api/content
{
  "type": "page",
  "title": "Checkout 500 — Investigation Notes (2026-05-14)",
  "space": { "key": "ENG" },
  "ancestors": [ { "id": "65538" } ],
  "body": {
    "storage": {
      "representation": "storage",
      "value": "<h1>Checkout 500 — Investigation Notes</h1><p>Author: <ac:link><ri:user ri:username=\"jsmith\" /></ac:link> · Date: 2026-05-14 · Related Jira: <a href=\"https://jira.company.com/browse/WEB-2001\">WEB-2001</a></p><ac:structured-macro ac:name=\"info\" ac:schema-version=\"1\"><ac:parameter ac:name=\"title\">Status</ac:parameter><ac:rich-text-body><p>Root cause identified; fix in PR <a href=\"https://github.com/acme/web/pull/8421\">#8421</a>.</p></ac:rich-text-body></ac:structured-macro><h2>Timeline</h2><table><tbody><tr><th>Time (UTC)</th><th>Event</th><th>Owner</th></tr><tr><td>09:12</td><td>First customer report (SUP-4421)</td><td>support</td></tr><tr><td>10:04</td><td>Repro confirmed on staging</td><td><ac:link><ri:user ri:username=\"jsmith\" /></ac:link></td></tr></tbody></table><h2>Repro</h2><ol><li>Add any item to cart</li><li>At <code>/checkout</code>, set Street = <code>Łódź 12/3</code></li><li>Submit → 500</li></ol><ac:structured-macro ac:name=\"code\" ac:schema-version=\"1\"><ac:parameter ac:name=\"language\">java</ac:parameter><ac:parameter ac:name=\"title\">AddressValidator.java (before)</ac:parameter><ac:plain-text-body><![CDATA[public Address validate(String street) {\n    byte[] bytes = street.getBytes();\n    return parse(new String(bytes, StandardCharsets.UTF_8));\n}]]></ac:plain-text-body></ac:structured-macro><ac:structured-macro ac:name=\"warning\" ac:schema-version=\"1\"><ac:parameter ac:name=\"title\">Backport</ac:parameter><ac:rich-text-body><p>Must be cherry-picked to <strong>release/2026.05</strong> before next deploy window.</p></ac:rich-text-body></ac:structured-macro>"
    }
  }
}
```

Same `\"` JSON-escaping rule as Cloud — escape only when
embedding the XHTML inside a JSON string. If your transport
takes the storage value as a separate parameter, write XHTML
unescaped.

## Server-specific pitfalls

- **`/wiki/` prefix doesn't exist** — Server is at the root of
  its host (or `/confluence` if customised).
- **`ri:account-id` is silently broken** — must be `ri:userkey`
  or `ri:username`.
- **PAT as Basic password → 401.** Use `Authorization: Bearer`.
- **`body.wiki` is Server-only on v1** — don't reuse the payload
  on Cloud v2.
- **`version.number` is mandatory on update** — forgetting it
  returns 400 / 409.
- **Imported `ri:userkey` from another instance** renders as a
  broken mention — userkeys are per-instance. Always look up
  via the destination Confluence's `/rest/api/user`.

## References

- https://developer.atlassian.com/server/confluence/confluence-rest-api-examples/
- https://developer.atlassian.com/server/confluence/confluence-server-rest-api/
- https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html
  (storage format — shared with Cloud)
- https://confluence.atlassian.com/conf59/info-tip-note-and-warning-macros-792499127.html
- https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html

# Confluence storage format — the XHTML-ish markup

> **Scope: Cloud AND Server / Data Center.** Confluence's
> storage format is the same XHTML-ish dialect on both
> deployments — Cloud inherited it from Server. Everything in
> this file (headings, lists, tables, `<ac:structured-macro>`,
> code / info / panel macros) applies to both. The bits that
> differ between deployments — base URL, mention syntax,
> `body.wiki` input shortcut, auth — are in
> `references/confluence-server.md`.

Confluence REST expects pages in **storage format**: an XHTML
dialect with custom `<ac:*>` (Atlassian Confluence) and `<ri:*>`
(resource identifier) elements for macros, links, and rich content.

Markdown does not work. Wiki markup works only through input
representations (`body.wiki` on Server, conversion endpoint on
both). Storage format is the supported, stable surface for
automation.

## API version — v1 is used here; v2 is the future

The examples in this reference use the **v1 Cloud REST API**
(`/wiki/rest/api/content`), which is still fully functional and
is what most existing Atlassian MCPs wrap. Atlassian's current
recommendation for new code is the **v2 API**
(`/wiki/api/v2/pages`) — same storage format, flatter payload:

```
# v1 (this reference uses this shape everywhere)
POST /wiki/rest/api/content
{ "body": { "storage": { "value": "<p>…</p>",
                          "representation": "storage" } } }

# v2 (same storage content, different wrapping)
POST /wiki/api/v2/pages
{ "spaceId": "…", "title": "…",
  "body": { "representation": "storage",
            "value": "<p>…</p>" } }
```

**When to reach for v2:**

- The operator's project or MCP explicitly targets v2.
- A feature only v2 exposes (e.g. folder-tree navigation,
  new label APIs).
- Long-running automation that wants to ride the deprecation
  glide path rather than be caught mid-migration.

**When v1 is fine:**

- Existing MCPs (`mcp-atlassian`, Elitea's Confluence tools,
  most vendor MCPs) speak v1 natively.
- Ad-hoc ops from an agent — v1 is simpler and more widely
  documented.

The storage-format body itself (every XHTML example below) is
**identical across v1 and v2**; only the endpoint path and the
outer JSON wrapper change. Read-back paths differ similarly:

```
# v1
GET /wiki/rest/api/content/{id}?expand=body.storage,body.view

# v2
GET /wiki/api/v2/pages/{id}?body-format=storage
```

## Page skeleton

Create payload:

```json
POST /wiki/rest/api/content
{
  "type": "page",
  "title": "Q2 Plan — Review",
  "space": { "key": "ENG" },
  "body": {
    "storage": {
      "value": "<p>Hello.</p>",
      "representation": "storage"
    }
  }
}
```

Update payload (note the required `version.number`):

```json
PUT /wiki/rest/api/content/{id}
{
  "type": "page",
  "title": "Q2 Plan — Review",
  "version": { "number": 2 },
  "body": {
    "storage": {
      "value": "<p>Updated.</p>",
      "representation": "storage"
    }
  }
}
```

Read back:

```
GET /wiki/rest/api/content/{id}?expand=body.storage,body.view,version
```

`body.storage.value` is what you submitted (XHTML). `body.view.value`
is the rendered HTML the user sees.

## Core structural elements

### Paragraphs, headings, breaks

```html
<h1>Top heading</h1>
<h2>Section</h2>
<p>A paragraph.</p>
<p>Another paragraph. Use <br/> for a forced line break if you really need one.</p>
<hr/>
```

Headings `h1`–`h6` are supported. Prefer `h2` / `h3` for body
sections — the page title is already the outermost heading.

### Inline marks

```html
<p>
  <strong>bold</strong>, <em>italic</em>, <u>underline</u>,
  <s>strike</s>, and <code>inline code</code>.
</p>
```

### Links

Internal links to other Confluence pages use an `<ac:link>`:

```html
<p>
  See <ac:link><ri:page ri:content-title="Design Review"
                        ri:space-key="ENG" /></ac:link>
  for context.
</p>
```

External links are plain `<a href>`:

```html
<p>See <a href="https://example.com/docs">the docs</a>.</p>
```

### Lists

```html
<ul>
  <li>First</li>
  <li>Second
    <ul>
      <li>Nested</li>
    </ul>
  </li>
</ul>

<ol>
  <li>Step one</li>
  <li>Step two</li>
</ol>
```

### Tables

```html
<table>
  <tbody>
    <tr>
      <th>Env</th>
      <th>Result</th>
    </tr>
    <tr>
      <td>staging</td>
      <td>fails</td>
    </tr>
    <tr>
      <td>prod</td>
      <td>not yet deployed</td>
    </tr>
  </tbody>
</table>
```

Confluence accepts simple `<table>` structures. Avoid `<thead>` /
`<tfoot>` — the storage format parser sometimes strips them.

### Blockquote

```html
<blockquote>
  <p>Quoted paragraph.</p>
</blockquote>
```

## Macros — the `<ac:structured-macro>` family

Most rich elements (code blocks, info panels, TOC, attachments)
are **macros**. General shape:

```html
<ac:structured-macro ac:name="MACRO_NAME" ac:schema-version="1">
  <ac:parameter ac:name="PARAM">VALUE</ac:parameter>
  <ac:rich-text-body>
    <p>Body content (for macros that accept rich text).</p>
  </ac:rich-text-body>
</ac:structured-macro>
```

### Code block

```html
<ac:structured-macro ac:name="code" ac:schema-version="1">
  <ac:parameter ac:name="language">python</ac:parameter>
  <ac:parameter ac:name="title">Example handler</ac:parameter>
  <ac:plain-text-body><![CDATA[def handler(event):
    return {"ok": True}
]]></ac:plain-text-body>
</ac:structured-macro>
```

`<![CDATA[...]]>` protects your code from XML entity escaping.
Always use it for code blocks.

Common `language` values: `python`, `javascript`, `typescript`,
`java`, `go`, `bash`, `json`, `yaml`, `sql`, `xml`, `html`, `none`.

### Info / note / warning panels

```html
<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:rich-text-body>
    <p>Heads up — this changes next sprint.</p>
  </ac:rich-text-body>
</ac:structured-macro>
```

Panel macro names: `info`, `note`, `tip`, `warning`. Same body
shape for all.

### Table of contents

```html
<ac:structured-macro ac:name="toc" ac:schema-version="1">
  <ac:parameter ac:name="maxLevel">3</ac:parameter>
</ac:structured-macro>
```

Place at the top of long pages.

### Status lozenge

```html
<ac:structured-macro ac:name="status" ac:schema-version="1">
  <ac:parameter ac:name="colour">Green</ac:parameter>
  <ac:parameter ac:name="title">DONE</ac:parameter>
</ac:structured-macro>
```

`colour` values: `Grey`, `Red`, `Yellow`, `Green`, `Blue`,
`Purple`. The title is the displayed text.

## Mentions

Mentions in Confluence use an `<ac:link>` wrapping a `<ri:user>`,
but the user-id attribute differs by deployment:

**Cloud** — `ri:account-id`:
```html
<p>
  Hi
  <ac:link>
    <ri:user ri:account-id="61e1a042e67ea2006b5b2157" />
  </ac:link>,
  please review.
</p>
```

**Server / Data Center** — `ri:userkey` (preferred) or
`ri:username`:
```html
<p>
  Hi
  <ac:link>
    <ri:user ri:userkey="ff8080814ba236dc014ba236f4e40001" />
  </ac:link>,
  please review.
</p>
```

Posting `ri:account-id` on Server, or `ri:userkey` / `ri:username`
on Cloud, produces a broken-link placeholder in the rendered page.

See `mentions.md` for lookup recipes per deployment. On Cloud, the
same `accountId` works across Jira and Confluence in the same
tenant. On Server, Jira and Confluence are typically separate
installs — don't reuse identifiers across them.

## Worked example — a decision page with mention, code block, panel, table

The example below is **Cloud-shaped** — endpoint `/wiki/rest/api/content`
and `ri:account-id` for the mention. On Server / DC the endpoint
is `/rest/api/content` (no `/wiki/`) and the mention uses
`ri:userkey` or `ri:username`; everything between
`"value": "..."` is otherwise identical.

```json
POST /wiki/rest/api/content
{
  "type": "page",
  "title": "Decision — switch TMS to Zephyr Scale",
  "space": { "key": "ENG" },
  "body": {
    "storage": {
      "value": "<h2>Context</h2><p>We currently use TestRail but the team wants native Jira integration. Raised by <ac:link><ri:user ri:account-id=\"61e1a042e67ea2006b5b2157\" /></ac:link>.</p><h2>Options considered</h2><table><tbody><tr><th>Option</th><th>Pros</th><th>Cons</th></tr><tr><td>Keep TestRail</td><td>Current tooling works</td><td>Separate login, poor Jira linking</td></tr><tr><td>Move to Zephyr Scale</td><td>Native Jira, no extra login</td><td>Migration effort, ~400 cases</td></tr></tbody></table><h2>Decision</h2><ac:structured-macro ac:name=\"info\" ac:schema-version=\"1\"><ac:rich-text-body><p>We move to Zephyr Scale by end of Q2.</p></ac:rich-text-body></ac:structured-macro><h2>Migration script sketch</h2><ac:structured-macro ac:name=\"code\" ac:schema-version=\"1\"><ac:parameter ac:name=\"language\">python</ac:parameter><ac:plain-text-body><![CDATA[for case in testrail.cases(project_id=7):\n    zephyr.create_case(\n        name=case.title,\n        steps=case.custom_steps_separated,\n    )\n]]></ac:plain-text-body></ac:structured-macro>",
      "representation": "storage"
    }
  }
}
```

Note the `\"` escapes — the whole storage string is JSON-encoded
when submitted via REST. If your agent tool assembles the JSON for
you, you may write the XHTML directly.

## Common pitfalls

- **Unescaped `&`, `<`, `>`** — storage format is XHTML. A literal
  ampersand in prose must be `&amp;`. A literal `<` outside a tag
  must be `&lt;`. Code blocks inside `<![CDATA[...]]>` are exempt.
- **Self-closing an element that isn't void** — `<p />` is invalid
  for paragraphs (which expect content). Use `<p></p>` or include
  content. `<hr/>`, `<br/>`, and the empty `<ri:user ... />` are
  fine self-closed.
- **Missing `version.number` on update** — a `PUT` without the
  incremented version number returns 409. Always read the current
  page, increment by 1, include in the update payload.
- **Submitting markdown** — `**bold**` displays as literal
  asterisks. `- item` displays as literal hyphen. Always use
  XHTML.
- **Namespace prefixes not declared** — `<ac:*>` and `<ri:*>` are
  known to Confluence's parser and don't require xmlns
  declarations inside the storage value. Don't add them — some
  library helpers add them redundantly and Confluence rejects the
  page.
- **Pasting rendered HTML from the web UI** — the rendered view
  (`body.view`) contains output-only classes (`<span class="…">`)
  and is NOT round-trippable. Always author in storage format, not
  rendered HTML.

## References

- https://developer.atlassian.com/cloud/confluence/rest/v1/intro/
- https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/
- https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html
- https://github.com/sooperset/mcp-atlassian/tree/main/docs/guides

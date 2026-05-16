# Jira ADF (Atlassian Document Format) — Cloud, API v3

> **Scope: Atlassian Cloud only.** Jira Server / Data Center
> does NOT accept ADF — it uses wiki markup against API v2.
> If you're hitting `https://<host>.atlassian.net/...`, you're
> on Cloud and this file is the right reference. For any
> custom-domain Jira (`https://jira.company.com/...`), switch to
> `references/jira-wiki-server.md`. See `SKILL.md` § "Detect
> deployment first" for how to tell.

**JIRA SYNTAX REFERENCE (Cloud):**

- Use **ADF** (Atlassian Document Format) — a structured JSON document.
- Use **API v3** — `/rest/api/3/*`. API v2 on Cloud accepts wiki
  markup, not ADF, and is legacy.
- Recommended: create professional, well-formatted Jira issues /
  comments with user mentions, code blocks, panels, tables, and
  links by assembling ADF documents and POSTing them.

## Document skeleton

Every ADF document has this outer shape:

```json
{
  "type": "doc",
  "version": 1,
  "content": [ /* block nodes */ ]
}
```

`content` is an array of **block nodes** (paragraphs, headings,
lists, tables, panels, code blocks, rules). Block nodes usually
contain **inline nodes** (text, mention, link, emoji, inlineCard,
hardBreak).

### Where the doc goes

| Operation | Field |
|---|---|
| Create issue description | `fields.description` (the ADF document object itself) |
| Update issue description | same, in `fields` of `PUT /rest/api/3/issue/{key}` |
| Post a comment | `body` (the ADF document object itself) |
| Custom rich-text field | `fields.customfield_XXXXX` (same structure) |

Example issue-create payload:

> **`issuetype`: prefer `id` for programmatic filing.** Project
> admins rename issue types (`Defect`, `Production Incident`, …)
> and multiple types can share a display name across projects.
> Look up the valid set for a project with
> `GET /rest/api/3/issue/createmeta?projectKeys=PROJ&expand=projects.issuetypes`
> and submit `"issuetype": { "id": "10004" }`. Use `{ "name": "Bug" }`
> only when you're filing into a known project you control.

```json
{
  "fields": {
    "project": { "key": "PROJ" },
    "summary": "Login returns 500 on plus-sign emails",
    "issuetype": { "name": "Bug" },
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        { "type": "paragraph",
          "content": [{ "type": "text",
                        "text": "Reproduced on staging 2026-04-20." }] }
      ]
    }
  }
}
```

Example comment payload:

```json
POST /rest/api/3/issue/PROJ-123/comment
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      { "type": "paragraph",
        "content": [{ "type": "text", "text": "Verified the fix." }] }
    ]
  }
}
```

## Block nodes — the ones you'll actually use

### paragraph

```json
{ "type": "paragraph",
  "content": [ /* inline nodes */ ] }
```

An empty paragraph (`"content": []` or omitted) is a blank line.

### heading

```json
{ "type": "heading",
  "attrs": { "level": 2 },
  "content": [{ "type": "text", "text": "Section title" }] }
```

`level`: 1–6. Prefer 2–3 for section headers inside a ticket;
level 1 is rarely needed (the summary is already the title).

### bulletList / orderedList + listItem

```json
{ "type": "bulletList",
  "content": [
    { "type": "listItem",
      "content": [
        { "type": "paragraph",
          "content": [{ "type": "text", "text": "First item" }] }
      ] },
    { "type": "listItem",
      "content": [
        { "type": "paragraph",
          "content": [{ "type": "text", "text": "Second item" }] }
      ] }
  ] }
```

`orderedList` is identical but accepts `"attrs": { "order": 1 }` to
start numbering at a non-1 value.

**Gotcha:** list items wrap their content in paragraph nodes. Text
directly inside a `listItem` without a paragraph wrapper is invalid.

### codeBlock

```json
{ "type": "codeBlock",
  "attrs": { "language": "python" },
  "content": [{ "type": "text",
                "text": "def handler(event):\n    return {'ok': True}\n" }] }
```

Common languages: `python`, `javascript`, `typescript`, `java`,
`go`, `rust`, `bash`, `sh`, `json`, `yaml`, `sql`, `html`, `css`,
`text` (plain / unhighlighted).

Newlines inside `text` are literal `\n` characters. Do NOT put
paragraph nodes inside a code block.

### panel

```json
{ "type": "panel",
  "attrs": { "panelType": "info" },
  "content": [
    { "type": "paragraph",
      "content": [{ "type": "text",
                    "text": "Context: this is a staging regression." }] }
  ] }
```

`panelType`: `info` (blue), `note` (purple), `tip` (green),
`warning` (yellow), `error` (red). Use sparingly — one or two per
ticket; overusing panels makes the ticket look noisy.

### table

```json
{ "type": "table",
  "attrs": { "isNumberColumnEnabled": false, "layout": "default" },
  "content": [
    { "type": "tableRow",
      "content": [
        { "type": "tableHeader",
          "content": [{ "type": "paragraph",
                        "content": [{ "type": "text", "text": "Env" }] }] },
        { "type": "tableHeader",
          "content": [{ "type": "paragraph",
                        "content": [{ "type": "text", "text": "Result" }] }] }
      ] },
    { "type": "tableRow",
      "content": [
        { "type": "tableCell",
          "content": [{ "type": "paragraph",
                        "content": [{ "type": "text", "text": "staging" }] }] },
        { "type": "tableCell",
          "content": [{ "type": "paragraph",
                        "content": [{ "type": "text", "text": "fails" }] }] }
      ] }
  ] }
```

Every cell (header or body) wraps its content in a paragraph. A
cell with only plain text directly inside is invalid.

### blockquote

```json
{ "type": "blockquote",
  "content": [
    { "type": "paragraph",
      "content": [{ "type": "text", "text": "Quoted line." }] }
  ] }
```

### rule

```json
{ "type": "rule" }
```

Horizontal divider. No content, no attrs.

## Inline nodes

### text + marks

```json
{ "type": "text", "text": "Hello world" }
```

Apply **marks** via the `marks` array:

```json
{ "type": "text", "text": "bold", "marks": [{ "type": "strong" }] }
{ "type": "text", "text": "italic", "marks": [{ "type": "em" }] }
{ "type": "text", "text": "code", "marks": [{ "type": "code" }] }
{ "type": "text", "text": "strike", "marks": [{ "type": "strike" }] }
{ "type": "text", "text": "underline", "marks": [{ "type": "underline" }] }
```

Combine by listing multiple marks:

```json
{ "type": "text", "text": "bold italic",
  "marks": [{ "type": "strong" }, { "type": "em" }] }
```

### link (as a text mark)

```json
{ "type": "text", "text": "our docs",
  "marks": [{ "type": "link",
              "attrs": { "href": "https://example.com/docs" } }] }
```

Bare URLs without a link mark render as plain text — always wrap.

### mention

```json
{ "type": "mention",
  "attrs": { "id": "61e1a042e67ea2006b5b2157",
             "text": "@Alexander Bychinskiy" } }
```

`id` is the Atlassian **accountId**. `text` is the display fallback
shown if the mention fails to render — match the user's display
name with a leading `@`. See `mentions.md` for accountId lookup.

### inlineCard (linked issue / URL preview)

```json
{ "type": "inlineCard",
  "attrs": { "url": "https://your-site.atlassian.net/browse/PROJ-123" } }
```

Use for linking another Jira issue — renders as a live card with
summary, status, and assignee.

### hardBreak

```json
{ "type": "hardBreak" }
```

A forced line break inside a paragraph. Prefer paragraph splits
for prose; use `hardBreak` only when you need a visual break
without a paragraph gap.

## Worked example — a well-formatted bug report

```json
{
  "fields": {
    "project": { "key": "PROJ" },
    "summary": "Login returns 500 when email contains '+' character",
    "issuetype": { "name": "Bug" },
    "priority": { "name": "High" },
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        { "type": "heading",
          "attrs": { "level": 2 },
          "content": [{ "type": "text", "text": "Summary" }] },
        { "type": "paragraph",
          "content": [
            { "type": "text", "text": "The " },
            { "type": "text", "text": "/api/login",
              "marks": [{ "type": "code" }] },
            { "type": "text", "text": " endpoint returns 500 when the email address contains a " },
            { "type": "text", "text": "+",
              "marks": [{ "type": "code" }] },
            { "type": "text", "text": " character. Reproduced on staging 2026-04-20." }
          ] },

        { "type": "heading",
          "attrs": { "level": 2 },
          "content": [{ "type": "text", "text": "Steps to reproduce" }] },
        { "type": "orderedList",
          "content": [
            { "type": "listItem",
              "content": [{ "type": "paragraph",
                            "content": [{ "type": "text",
                                          "text": "POST /api/login with email user+tag@example.com" }] }] },
            { "type": "listItem",
              "content": [{ "type": "paragraph",
                            "content": [{ "type": "text",
                                          "text": "Observe 500 response" }] }] }
          ] },

        { "type": "heading",
          "attrs": { "level": 2 },
          "content": [{ "type": "text", "text": "Expected" }] },
        { "type": "paragraph",
          "content": [{ "type": "text",
                        "text": "200 OK with session cookie, per RFC 5322 which permits '+' in local-part." }] },

        { "type": "heading",
          "attrs": { "level": 2 },
          "content": [{ "type": "text", "text": "Stack trace" }] },
        { "type": "codeBlock",
          "attrs": { "language": "text" },
          "content": [{ "type": "text",
                        "text": "TypeError: can't escape '+' in email.split('@')[0]\n  at normalize_email (auth/normalize.py:42)\n  at login (auth/views.py:117)\n" }] },

        { "type": "panel",
          "attrs": { "panelType": "info" },
          "content": [
            { "type": "paragraph",
              "content": [
                { "type": "text", "text": "Raising this to " },
                { "type": "mention",
                  "attrs": { "id": "61e1a042e67ea2006b5b2157",
                             "text": "@Alexander Bychinskiy" } },
                { "type": "text", "text": " — can you triage by EOD?" }
              ] }
          ] }
      ]
    }
  }
}
```

## Common pitfalls

- **Missing paragraph wrapper inside listItem / tableCell** — the
  node is rejected with a vague "unknown child" error. Always
  wrap list-item and cell text in a `paragraph` node.
- **Newlines as `\n` in a text node** — that's literal `\n` in the
  rendered output. For a line break: end the paragraph (close the
  paragraph node) and start a new one, or insert a `hardBreak`
  node.
- **Using `code` as a block** — `code` is a mark (inline code).
  `codeBlock` is the block node. They're not interchangeable.
- **Nested paragraphs** — paragraphs can't contain paragraphs.
  Most block nodes (panel, blockquote, tableCell) accept
  paragraphs as children; a paragraph's children are inline nodes.
- **`version` on the inner doc vs outer** — the outer `doc` needs
  `version: 1`. Nested docs (e.g., inside a tableCell) should not
  repeat `version`.
- **Mixing ADF with wiki markup** — `*bold*` or `{code}...{code}`
  inside a text node is literal text, not formatting. Use marks
  and block nodes.

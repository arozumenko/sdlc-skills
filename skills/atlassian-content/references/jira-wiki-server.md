# Jira Server / Data Center — wiki markup, API v2

**JIRA SYNTAX REFERENCE (Server / Data Center):**

- Use **wiki markup** — a plain string. Not JSON, not ADF.
- Use **API v2** — `/rest/api/2/*` (or `/rest/api/latest/*`, an
  alias). API v3 does not exist on Server / DC.
- Mentions are **`[~username]`** — `username` is the login `name`
  returned by `/rest/api/2/user/search`, NOT the display name and
  NOT the email. `accountId` does not exist on Server.
- One critical caveat: every rich-text field has a per-field
  **renderer setting** (admin-controlled). If a field uses the
  *Default Text Renderer*, your wiki markup renders as literal
  `*asterisks*` and `h2.` text. See § "The renderer trap" below.

## Document skeleton

Every rich-text field is a JSON string containing wiki markup —
not a structured document. Compare with Cloud:

```
Cloud v3 (ADF):   "description": { "type": "doc", "version": 1, "content": [...] }
Server v2 (wiki): "description": "h2. Steps\n\n# do this\n# then this"
```

### Where the markup goes

| Operation | Field |
|---|---|
| Create issue description | `fields.description` (string with wiki markup) |
| Update issue description | same, in `fields` of `PUT /rest/api/2/issue/{key}` |
| Issue environment | `fields.environment` (string with wiki markup) |
| Post a comment | `body` (string with wiki markup) |
| Worklog comment | `comment` (string with wiki markup) |
| Custom rich-text field | `fields.customfield_XXXXX` (string) |

Example issue-create payload:

> **`issuetype`: prefer `id` for programmatic filing.** Project
> admins rename issue types and multiple types can share a display
> name across projects. Look up the valid set with
> `GET /rest/api/2/issue/createmeta/{projectKey}/issuetypes`
> (the legacy `?expand=projects.issuetypes` form was removed in
> Jira 9.0).

```json
POST /rest/api/2/issue
{
  "fields": {
    "project": { "key": "PROJ" },
    "summary": "Login returns 500 on plus-sign emails",
    "issuetype": { "name": "Bug" },
    "assignee": { "name": "jsmith" },
    "description": "h2. Summary\n\nReproduced on staging 2026-04-20.\n\n* See {{auth/views.py:117}}\n* cc [~jsmith]"
  }
}
```

> Server identifies users by `name` (login) and a stable `key`.
> Do NOT send `assignee.accountId` — it is silently ignored or
> returns 400. Same for `reporter`.

Example comment payload:

```json
POST /rest/api/2/issue/PROJ-123/comment
{
  "body": "Verified the fix on staging. cc [~jsmith]"
}
```

## The renderer trap — read this first

Server has a **per-field renderer setting**, managed in:
**Admin → Issues → Field Configurations → [scheme] → Renderers**.

| Renderer | Behaviour |
|---|---|
| **Wiki Style Renderer** | Parses wiki markup → HTML. Default for `description`, `environment`, comments, worklog comment, and most text-area custom fields on a fresh install. |
| **Default Text Renderer** | Treats the content as plain text. Auto-links bare URLs and issue keys, but prints `*bold*`, `h2. Heading`, `||header||` verbatim. |

There is **no REST way to query the per-field renderer** without
admin access. Three coping strategies:

1. **Probe** — file one minimal test issue (or comment), then
   `GET /rest/api/2/issue/{key}?expand=renderedFields` and check
   whether `renderedFields.description` contains a real `<h2>`
   element or a literal `h2.` string. Cache the answer per project.
2. **Ask the operator** to confirm the field configuration scheme.
3. **Fall back to plain text** — well-structured prose, bare URLs
   (auto-link in both renderers), bare issue keys (also auto-link
   in both). Plain text always renders correctly.

A related failure mode: if the `atlassian-wiki-renderer` plugin is
disabled, every wiki-style field silently falls back to the Default
Text Renderer.

## Wiki markup syntax — what you'll actually use

### Headings

```
h1. Top heading
h2. Section
h3. Subsection
h4. h5. h6. also valid
```

**Strict:** dot + single space + content, all at column 0. `h2.Foo`,
` h2. Foo` (leading whitespace), and `h2.  Foo` (double space) all
fall back to literal text.

### Paragraphs and line breaks

- A blank line ends a paragraph.
- `\\` (two backslashes) at end of line → forced line break within
  the same paragraph.
- `----` on its own line → horizontal rule.
- `---` becomes em-dash; `--` becomes en-dash.

### Inline text formatting

| Syntax | Result |
|---|---|
| `*strong*` | **bold** |
| `_emphasis_` | *italic* |
| `??citation??` | citation (`<cite>`) |
| `-deleted-` | strikethrough |
| `+inserted+` | underline |
| `^superscript^` | superscript |
| `~subscript~` | subscript |
| `{{monospaced}}` | inline code |
| `{color:red}red{color}` | red (or any colour name / `#hex`) |

Inline-only — they do not span line breaks. A `*` at start of line
followed by a space is a bullet, not bold; escape with `\*`.

### Lists

```
* bullet
** nested bullet
*** even deeper
# numbered
## nested numbered
*# mixed (bullet whose child is numbered)
#* mixed (numbered whose child is bullet)
```

- Marker at column 0, single space after.
- Blank line ends the list.

### Tables

```
||Env||Result||Notes||
|staging|fails|reproduced 2026-04-20|
|prod|not deployed|waiting on release|
```

- `||` (double pipe) for header rows; `|` (single pipe) for body.
- Row must start at column 0 with the pipe.
- Newlines inside a cell break the table — use `\\` for in-cell
  line breaks.
- No native row colouring. Wrap a cell or the whole table in a
  `{panel:bgColor=…}{panel}` for background colour.

### Code, no-format, quote

```
{code}plain code, no language{code}

{code:java}
public void hello() {
    System.out.println("hi");
}
{code}

{code:title=Bar.java|borderStyle=solid|linenumbers=true|language=python}
def deploy():
    print("ok")
{code}

{noformat}
Preformatted text. No highlighting, no markup interpretation.
{noformat}
```

Common `language` values: `java`, `javascript`, `python`, `bash`,
`sh`, `groovy`, `xml`, `html`, `css`, `sql`, `yaml`, `json`,
`c`, `c++`, `csharp`, `ruby`, `perl`, `scala`, `actionscript`,
`none`. Unsupported → renders without highlighting.

You **cannot nest `{code}…{code}`** — the parser is non-greedy and
closes at the first `{code}` after the opener. To show a literal
`{code}` inside a code sample, use `{noformat}` for the outer
wrapper.

### Block quotes

```
bq. Single-line quote.

{quote}
Multi-line quote.
Multiple paragraphs allowed.
{quote}
```

### Panels & admonitions

Generic panel:

```
{panel}simple panel body{panel}

{panel:title=My title|borderStyle=dashed|borderColor=#ccc|titleBGColor=#F7D6C1|bgColor=#FFFFCE}
Body text — may include _wiki_ markup.
{panel}
```

Coloured admonition macros (Jira-native on Server):

```
{info}Generic info note.{info}
{info:title=Heads up}body{info}

{note}A note (yellow).{note}
{warning}A warning (red).{warning}
{tip}A useful tip (green).{tip}
```

All four accept `:title=…|icon=false` parameters identically.

### Links

| Syntax | Meaning |
|---|---|
| `https://example.com` | bare URL — auto-links |
| `[https://example.com]` | URL as link text |
| `[label\|https://example.com]` | link with display text |
| `[label\|https://example.com\|Tooltip]` | with tooltip |
| `[#anchor]` | jump to anchor on same page |
| `{anchor:name}` | define an anchor |
| `[~username]` | **user mention — see below** |
| `[PROJ-123]` | explicit issue link (bare `PROJ-123` also auto-links) |
| `[mailto:user@example.com]` | email link |
| `[^attachment.png]` | link to an attachment on this issue |

### Mentions — `[~username]`

The token between `[~` and `]` is the **login username** — the
`name` field returned by `/rest/api/2/user/search`. NOT the
display name, NOT the email, NOT `accountId`.

```
cc [~jsmith] — can you triage by EOD?
```

#### Look up a username

```
GET /rest/api/2/user/search?username=<query>
→ [ { "key": "JIRAUSER10042",
      "name": "jsmith",                 ← this goes in [~name]
      "emailAddress": "jsmith@company.com",
      "displayName": "Jane Smith",
      "active": true } ]
```

For fuzzy search across username / display name / email:

```
GET /rest/api/2/user/picker?query=<text>
→ { "users": [ { "name": "jsmith", "html": "...", ... } ], ... }
```

- `name` is the login username — feed it to `[~name]`.
- `key` (e.g. `JIRAUSER10042`) is the stable internal identifier;
  it survives username renames and GDPR-anonymization. On
  anonymized installs the `name` field becomes a `jirauserNNNN`
  alias, and `[~jirauserNNNN]` works against the alias.
- Cache `name` per session keyed by email.

If a username contains `|` or `]`, escape with `\`. Plain `+`,
`.`, `_` characters are usually fine. Case: most installs are
case-sensitive on usernames at the wiki-parser level — use the
exact `name` returned by the API.

### Escaping

Backslash escapes the next character. Inside `{noformat}` /
`{code}` content is literal until the closing macro.

```
\*not bold\*
\[PROJ-123\]   ← suppresses the auto-link
\\             ← actually a line break, NOT a literal backslash
```

For a literal single backslash, use `\\\\` (or wrap in
`{noformat}`).

### Auto-linking quirks

- Bare URLs (`https://…`) auto-link in BOTH renderers.
- Strings matching `[A-Z][A-Z0-9_]+-\d+` auto-link to issues in
  both renderers (e.g. `PROJ-123`, `OPS_DEV-7`).
- This is often desired. To suppress: wrap in `{noformat}` or
  escape the leading bracket with `\`.

## Authentication on Server

| Method | Header | Notes |
|---|---|---|
| Basic auth | `Authorization: Basic base64(user:password)` | Always available. Many corporate installs disable it. |
| Personal Access Token | `Authorization: Bearer <PAT>` | **Jira 8.14+ / JSM 4.15+ / DC**. Created at user profile → Personal access tokens. |
| Session cookie | After `POST /rest/auth/1/session` | Interactive scripts only. |

PAT specifics:

- Header is literally `Authorization: Bearer <token>` — the word
  "Bearer" is fixed.
- **PATs cannot be used as a Basic-auth password.** Doing so
  returns 401 `AUTHENTICATED_FAILED`.
- Tokens carry the creator's full permission set — no scopes.

## Reading content back

```
GET /rest/api/2/issue/{key}?expand=renderedFields
→ fields.description     — the wiki source you posted
  renderedFields.description — the HTML Jira rendered

GET /rest/api/2/issue/{key}/comment/{id}?expand=renderedBody
→ body         — wiki source
  renderedBody — rendered HTML
```

The renderer trap from § "The renderer trap" surfaces on read-back:
if `renderedFields.description` contains literal `h2.` text instead
of `<h2>` HTML, the field is on Default Text Renderer.

## Worked example — a well-formatted bug report

```json
POST /rest/api/2/issue
{
  "fields": {
    "project": { "key": "WEB" },
    "issuetype": { "name": "Bug" },
    "priority": { "name": "High" },
    "summary": "Checkout: 500 when shipping address has a unicode character",
    "labels": ["checkout", "regression"],
    "assignee": { "name": "jsmith" },
    "description": "h2. Summary\n\nCheckout returns *HTTP 500* whenever the shipping street contains a non-ASCII character.\n\nh2. Steps to reproduce\n\n# Add any item to the cart\n# Go to /checkout\n# In the *Street* field enter: {{Łódź 12/3}}\n# Click *Place order*\n\nh2. Expected\n\nOrder is placed and a confirmation page is shown.\n\nh2. Actual\n\nServer responds with 500. cc [~jsmith]\n\nh2. Stack trace\n\n{code:java}\njava.nio.charset.MalformedInputException: Input length = 1\n    at sun.nio.cs.UTF_8$Decoder.decodeLoop(UTF_8.java:578)\n    at com.example.checkout.AddressValidator.validate(AddressValidator.java:42)\n{code}\n\nh2. Environment\n\n||OS||Browser||Build||\n|macOS 14.4|Safari 17.4|2026.05.0-rc3|\n|Windows 11|Edge 124|2026.05.0-rc3|\n\n{panel:title=Workaround|borderColor=#ccc|titleBGColor=#F7D6C1|bgColor=#FFFFCE}\nTransliterating to ASCII at the form layer hides the bug. Do not ship as the fix.\n{panel}\n\n{warning:title=Customer-visible}\nAt least 12 customers reported the failure in support queue SUP-4421.\n{warning}\n\nRelated: WEB-1042, WEB-987"
  }
}
```

Notes on the payload:
- `assignee.name` — Server identifier, never `accountId`.
- `[~jsmith]` mentions are inline strings inside the JSON value.
- `WEB-1042` and `WEB-987` auto-link without explicit `[…]`.
- `{code:java}` triggers Java syntax highlighting.
- `||header||` then `|body|` for the table.
- `{panel}` / `{warning}` are recognised macros provided the
  field uses Wiki Style Renderer.

## Common pitfalls

- **Default Text Renderer trap** — biggest source of surprise.
  Always probe the renderer (or fall back to plain text) when
  working in a new project.
- **`\\` is TWO backslashes** for a line break. A single `\` only
  escapes the next character.
- **Heading whitespace strictness** — `h2.Foo` and ` h2. Foo`
  don't render. Must be `h2. Foo` at column 0.
- **Tables must start at column 0** with a pipe. Leading
  whitespace breaks them; newlines inside cells break them.
- **`{code}` cannot nest.** Use `{noformat}` for the outer
  wrapper if you need to display literal `{code}…{code}` inside.
- **Bare URLs and issue keys auto-link.** Wrap in `{noformat}`
  or escape with `\` to suppress.
- **Mention case sensitivity** — use the exact `name` from
  `/user/search`. Don't title-case it, don't normalize.
- **No `accountId` anywhere.** `assignee.accountId`,
  `[~accountid:KEY]`, `reporter.accountId` — all Cloud-only and
  silently ignored or rejected on Server.
- **`createmeta` shape changed in Jira 9.0** — use
  `/rest/api/2/issue/createmeta/{projectKey}/issuetypes` (and
  `/.../issuetypes/{id}` for fields). The legacy
  `?expand=projects.issuetypes` query was removed.
- **`{quote}` blocks** must be on their own lines on most Jira
  Server versions — `{quote}inline{quote}` renders as literal.
- **Comment visibility on Server** uses `visibility.type =
  "role"` or `"group"`, with `value` set to the role/group name.
  There is no Cloud-style `identifier` field.

## References

- https://developer.atlassian.com/server/jira/platform/jira-rest-api-examples/
- https://docs.atlassian.com/software/jira/docs/api/REST/latest/
- https://confluence.atlassian.com/adminjiraserver/configuring-renderers-938847270.html
- https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html
- https://developer.atlassian.com/server/jira/platform/personal-access-token/
- https://confluence.atlassian.com/adminjiraserver/anonymizing-users-992677655.html
- In-product help on any Jira Server instance:
  `https://<jira-host>/secure/WikiRendererHelpAction.jspa?section=all`

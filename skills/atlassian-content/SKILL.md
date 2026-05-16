---
name: atlassian-content
description: Create well-formatted Jira issues/comments and Confluence pages on both Cloud (ADF + API v3, accountId mentions) and Server / Data Center (wiki markup + API v2, [~username] mentions), with mandatory post-creation re-fetch + repair. Load for "file a bug", "review comment on JIRA-123", "write up a decision page", or any authored Atlassian content.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.2.0"
---

# Atlassian content — Jira + Confluence, done right

Atlassian has **two deployments** (Cloud and Server / Data Center)
and **two content surfaces** (Jira and Confluence). That's a 2×2
grid of formats, mention syntaxes, and API versions — and markdown
is none of them. Content submitted in the wrong format renders as
a wall of asterisks, broken tables, orphan `@username` strings,
and code blocks that display as plain paragraphs. This skill is
the rulebook for getting it right the first time and verifying it
after.

**Core principle:** *Detect the deployment, format-match the
surface, resolve identities before you post, and always re-fetch
what you wrote.*

## When to load this skill

Load when the task involves authoring content inside Atlassian
products:

- Filing a Jira issue (story, bug, task, subtask)
- Leaving a Jira comment (review findings, clarifications, updates)
- Updating a Jira field that accepts rich text (description, custom
  text fields)
- Creating or editing a Confluence page (decisions, runbooks,
  writeups, reviews)
- Mentioning a human in either surface

Do NOT load for: read-only Jira/Confluence operations (search,
field reads, user lookups) — those don't need formatting rules.

## Absolute boundaries

- **Never post markdown into Jira or Confluence.** Each
  deployment / surface has a specific expected format:
  - **Jira Cloud** (API v3) → **ADF** (Atlassian Document Format,
    a structured JSON document).
  - **Jira Server / DC** (API v2) → **wiki markup** (plain string,
    e.g. `h2. Title`, `*bold*`, `{code}…{code}`).
  - **Confluence Cloud + Server / DC** → **storage format** (an
    XHTML-ish markup with `<ac:*>` / `<ri:*>` macros — same on
    both deployments). Confluence Server also accepts wiki markup
    via `body.wiki` input as a one-shot convenience.

  None of these surfaces interpret markdown natively via the API.
- **Never mention by `@username` free-text.** Each deployment has
  its own mention syntax:
  - **Cloud (both Jira and Confluence)** → mention by
    **`accountId`** (ADF `mention` node / `<ri:user
    ri:account-id="…"/>`).
  - **Jira Server / DC** → `[~username]` inside wiki markup,
    where `username` is the login `name` from `/rest/api/2/user/search`.
  - **Confluence Server / DC** → `<ri:user ri:userkey="…"/>` or
    `<ri:user ri:username="…"/>` inside storage format.

  A free-text `@Alexander` string posts as a literal `@Alexander`
  on every surface — no notification, no link, no profile card.
- **Never declare a post "done" without re-fetching it.** The only
  ground truth is what the server returns after creation. Run the
  verification pass (see `references/verification.md`) on every
  issue, comment, or page you create.
- **Never update without first fetching the raw current body.**
  For any edit / append on an existing issue description, comment,
  or Confluence page, fetch the current content in its **raw
  structured view** first — ADF JSON for Jira Cloud, wiki-markup
  string for Jira Server / DC, storage-format XHTML for Confluence
  (any deployment). NOT the rendered HTML. Reading the raw body is
  how you see the existing macros, custom nodes, versioned
  structure, and formatting conventions the page already uses.
  Edit *into* that structure; don't overwrite it with a fresh body
  that discards the author's layout. **Applies regardless of
  transport** — raw Jira / Confluence REST API, MCP tools
  (`Elitea_Dev`, `JiraIntegration`, `mcp-atlassian`), or any
  Atlassian-connected integration the project ships. Pick the read
  tool that returns the raw ADF / storage string, not a
  pre-rendered / human-readable summary. See
  `references/verification.md` § "Before you update: raw-fetch
  first".
- **Never paste API tokens into the content.** If a snippet
  illustrates an API call, redact credentials. This skill writes
  user-facing content; credentials belong in `.env` / auth_env, not
  in descriptions.

## Detect deployment first — Cloud vs Server / Data Center

Before you assemble anything, know which deployment you're hitting.
The format, the API version, and the mention syntax all depend on
it.

**Signals to read (in order of preference):**

1. `.agents/profile.md` § Project systems — typically declares
   `JIRA_BASE_URL` / `CONFLUENCE_BASE_URL` and which API the
   project uses. If the profile says "Server" or names a v2
   endpoint, follow that.
2. **The base URL pattern:**
   - `https://<tenant>.atlassian.net` (Jira Cloud) or
     `https://<tenant>.atlassian.net/wiki` (Confluence Cloud)
     → **Cloud**.
   - Anything else (custom domain like `jira.company.com`,
     `confluence.company.com`, IP, internal hostname)
     → almost certainly **Server / DC**.
3. **A probe `GET`** when in doubt:
   - `GET /rest/api/3/myself` — 200 on Cloud, 404 on Server.
   - `GET /rest/api/2/myself` — 200 on both, but the response
     omits `accountId` on Server.
   - On Confluence, `GET /rest/api/user/current` returns an
     `accountId` field on Cloud and a `userKey` field on Server.

**Decision table:**

| Deployment | Jira API | Jira body format | Jira mention | Confluence API | Confluence body | Confluence mention |
|---|---|---|---|---|---|---|
| **Cloud** | `/rest/api/3/*` | ADF (JSON doc) | `accountId` mention node | `/wiki/rest/api/content` (v1) or `/wiki/api/v2/pages` (v2) | storage format (XHTML) | `<ri:user ri:account-id="…"/>` |
| **Server / DC** | `/rest/api/2/*` | wiki markup (string) | `[~username]` | `/rest/api/content` (v1) | storage format (XHTML), also accepts `body.wiki` | `<ri:user ri:userkey="…"/>` or `ri:username` |

Once you know the deployment, the rest of the loop is determined:
the right reference file, the right user-lookup endpoint, the
right re-fetch path.

## Transport — MCP preferred, curl fallback, browser last resort

Priority: **MCP** (Atlassian MCP server like `Elitea_Dev`,
`JiraIntegration`, `mcp-atlassian` — secrets stay out of agent
context) → **curl / HTTP** (using `JIRA_BASE_URL` + auth env from
`.agents/profile.md` § Project systems; if that file isn't present
yet — project not seeded — ask the operator for the base URL and
auth env var before falling back to HTTP) → **browser** (last
resort; note explicitly that verification was visual-only).
Transport does **not** change the body format — ADF over MCP is the
same ADF as ADF over curl.

## The authoring loop (every post, every time)

```
0. If updating an existing resource:
   Raw-fetch first  → GET the current body in its structured form
                      (Cloud Jira → ADF JSON; Server Jira → wiki markup
                      string; Confluence → storage-format XHTML),
                      read it, and merge your change into it —
                      don't regenerate from scratch.
1. Detect surface      → Jira issue, Jira comment, or Confluence page?
                         (deployment was determined upfront — see
                         § "Detect deployment first")
2. Resolve identities  → mentions by accountId (Cloud) / username (Server);
                         project/space keys; issue keys
3. Assemble body       → ADF (Cloud Jira), wiki markup (Server Jira),
                         or storage format (Confluence either way)
4. Submit              → MCP tool or REST endpoint
5. Re-fetch            → GET the resource back, don't trust the POST response alone
6. Validate            → run the checklist in references/verification.md
7. Repair              → if ugly, PUT/PATCH a fix; don't leave garbage
```

Each phase is cheap. Skipping any of them is how ugly tickets get
filed.

### 1. Detect surface

You already know the **deployment** (Cloud vs Server / DC — see
the decision table in § "Detect deployment first"). Now pick the
surface:

| Surface | Format (Cloud) | Format (Server / DC) |
|---|---|---|
| Jira issue create / update | **ADF** under `fields.description` (+ rich-text custom fields) — `POST /rest/api/3/issue`, `PUT /rest/api/3/issue/{key}` | **wiki markup** string under `fields.description` — `POST /rest/api/2/issue`, `PUT /rest/api/2/issue/{key}` |
| Jira comment | **ADF** under `body` — `POST /rest/api/3/issue/{key}/comment` | **wiki markup** string under `body` — `POST /rest/api/2/issue/{key}/comment` |
| Confluence page create / update | **storage format** (XHTML string) under `body.storage.value`, `representation: "storage"` — `POST /wiki/rest/api/content` | **storage format** under `body.storage.value` — `POST /rest/api/content` (no `/wiki/` prefix) |

If you're unsure which surface you're targeting: a Jira issue key
(`PROJ-123`) → Jira. A Confluence space key + page title → Confluence.

### 2. Resolve identities

Before assembling the body, collect every identity you'll
reference. The lookup endpoint and identifier you carry depend on
the deployment:

- **Users:**
  - **Cloud** → `accountId`. Look up via
    `GET /rest/api/3/user/search?query=<email-or-name>` (Jira)
    or `GET /wiki/rest/api/user?username=…` (Confluence).
  - **Jira Server / DC** → `name` (the login username) and `key`
    (stable internal id, e.g. `JIRAUSER10042`). Look up via
    `GET /rest/api/2/user/search?username=<query>` or the fuzzier
    `GET /rest/api/2/user/picker?query=<text>`. The `name` is
    what goes inside `[~name]`.
  - **Confluence Server / DC** → `userKey` (preferred) or
    `username`. Look up via `GET /rest/api/user?username=<name>`.

  **Cache per session.** On Cloud, the same `accountId` works
  across Jira and Confluence in the same tenant. On Server,
  Jira and Confluence are usually separate installs with
  separate user directories — don't reuse identifiers across them
  unless the operator confirms shared SSO.
- **Jira project key** → usually known from the task
  (`.agents/profile.md` § Project systems). If not,
  `GET /rest/api/{2|3}/project`.
- **Confluence space key** → likewise from profile; otherwise
  `GET /rest/api/space` (Server) or `GET /wiki/rest/api/space` (Cloud).
- **Linked issues** → the issue keys themselves. On Cloud, ADF
  `inlineCard` renders them as live cards; on Server, bare
  `PROJ-123` strings auto-link.

If you cannot resolve a user, **do not invent a mention**. Fall
back to plain text (`"Hi Alexander, "`) or ask the operator.

### 3. Assemble body

Pick the right reference for the deployment + surface you landed
on in step 1:

- **Jira Cloud** → build an ADF document.
  See `references/jira-adf.md`.
- **Jira Server / Data Center** → build a wiki-markup string.
  See `references/jira-wiki-server.md` (covers `h2.` headings,
  `*bold*`, `||header||` tables, `{code}` / `{panel}` / `{info}`
  macros, `[~username]` mentions, and the renderer-trap).
- **Confluence (any deployment)** → build a storage-format XHTML
  string. See `references/confluence-storage.md` for the body
  syntax. For Server-specific wrapper / mention / auth
  differences, see `references/confluence-server.md`.
- **Mentions** (all surfaces, both deployments) → see
  `references/mentions.md`.

### 4. Submit

MCP call, or `POST` / `PUT` via HTTP. No format-layer logic here —
the body you assembled in step 3 is the body you send.

### 5. Re-fetch

Read back what you just wrote. Endpoint depends on the deployment:

**Cloud:**

- `GET /rest/api/3/issue/{key}?expand=renderedFields` — compare
  ADF in `fields.description` with rendered HTML in
  `renderedFields.description`. Empty / malformed HTML = ADF is wrong.
- `GET /rest/api/3/issue/{key}/comment/{id}?expand=renderedBody`
- `GET /wiki/rest/api/content/{id}?expand=body.storage,body.view` —
  compare `body.storage` (what you submitted) with `body.view`
  (how Confluence renders it).

**Server / Data Center:**

- `GET /rest/api/2/issue/{key}?expand=renderedFields` — compare
  the wiki source in `fields.description` with the rendered HTML
  in `renderedFields.description`. **If the rendered HTML contains
  literal `h2.` / `*asterisks*` instead of `<h2>` / `<strong>`,
  the field is on Default Text Renderer** — see
  `references/jira-wiki-server.md` § "The renderer trap".
- `GET /rest/api/2/issue/{key}/comment/{id}?expand=renderedBody`
- `GET /rest/api/content/{id}?expand=body.storage,body.view` —
  same storage-vs-view comparison as Cloud, just no `/wiki/` prefix.

### 6. Validate

Run the post-creation checklist in `references/verification.md`.
Non-negotiable items:

- Every `@mention` became an actual mention node (not a plain text
  `@name`)
- Code blocks render as monospace code (not inline backticks in
  prose)
- Tables render as tables (not pipe-separated text)
- Headings render as headings (not bold paragraphs)
- Links are clickable (not bare URLs in text)
- No literal `**bold**` / `# heading` markdown artefacts
- (Jira Server only) No literal `h2.` / `*asterisks*` / `||pipes||`
  in the rendered HTML — that signals Default Text Renderer

### 7. Repair

If verification fails, build a corrected body and `PUT` it back.
Don't file a follow-up ticket "to fix formatting later". The
content you just filed is evidence of your care; leaving it broken
is a broken window.

## Quick decision tree

```
Task: "file a bug for case X"
  └─ deployment = Cloud?
     │   └─ surface = Jira issue, format = ADF (fields.description)
     │      mentions → accountId mention nodes
     │      endpoint → POST /rest/api/3/issue
     └─ deployment = Server / DC?
         └─ surface = Jira issue, format = wiki markup string
            mentions → [~username]
            endpoint → POST /rest/api/2/issue
            check the field renderer before trusting the rendering
  └─ submit → re-fetch → validate → (repair if needed)

Task: "add a review comment on JIRA-123"
  └─ Cloud  → ADF body, POST /rest/api/3/issue/JIRA-123/comment
  └─ Server → wiki body, POST /rest/api/2/issue/JIRA-123/comment
  └─ submit → re-fetch renderedBody → validate

Task: "document the migration plan on the Engineering space"
  └─ surface = Confluence page (storage format, both deployments)
     Cloud  → POST /wiki/rest/api/content with ri:account-id mentions
     Server → POST /rest/api/content      with ri:userkey mentions
  └─ submit → re-fetch body.view → validate
```

## Anti-patterns (things that look fine but aren't)

- **"The markdown renders in the preview"** — Atlassian's *web UI*
  accepts markdown-like shortcuts and transforms them during
  editing. The API does not. What you POST is what persists.
- **"I'll just paste the description as plain text"** — plain text
  through the API is valid ADF-wrapped plain text, but loses
  headings, code blocks, lists, and mentions. Acceptable only for
  one-line comments.
- **"The POST returned 201, so it worked"** — 201 means the server
  accepted the JSON structure. It does NOT mean the content
  renders. Always re-fetch.
- **"I mentioned the user with `@firstname`"** — Atlassian Cloud
  does not accept username mentions via API. Only accountId-backed
  mention nodes. Username strings are literal text.
- **"I copy-pasted the ADF from the web UI's source"** — the web
  UI sometimes emits extra fields (`marks: []` vs no `marks`,
  `version: 1` on nested docs). Use the minimal, documented form
  in `references/jira-adf.md`.
- **"I used `<br>` for a line break"** — Confluence storage
  format tolerates `<br/>` but prefers paragraph boundaries for
  prose. ADF has no `<br>` — use paragraph splits or `hardBreak`
  nodes.
- **"I posted wiki markup to Cloud / ADF to Server"** —
  symmetric and equally broken. ADF posted to a Server v2 field
  serialises as JSON-string garbage. Wiki markup posted to a
  Cloud v3 ADF field is rejected. Detect the deployment first.
- **"My `[~username]` rendered as plain text on Server"** —
  the field is configured for the Default Text Renderer, OR the
  username doesn't match the user's `name` exactly. Probe via
  `?expand=renderedFields` or fall back to plain text.
- **"I sent `assignee.accountId` to Server"** — silently
  ignored or rejected. On Server, use `assignee.name`.

## Escalation — when to ask the operator

- The project's `.agents/profile.md` § Project systems doesn't
  specify an issue tracker, OR doesn't tell you which deployment
  (Cloud vs Server / DC) you're hitting — and a probe (see §
  "Detect deployment first") doesn't disambiguate.
- Credentials aren't configured and MCP isn't online.
- A mention target can't be resolved to an identifier
  (`accountId` on Cloud, `name` / `userKey` on Server) — user
  left the company, ambiguous name, or the directory hides the
  field.
- (Server only) The rendered HTML from a probe still shows
  literal `h2.` / `*asterisks*` — the field is on the Default
  Text Renderer and the operator may need to flip the
  configuration scheme or you may need to fall back to plain
  text for that field.
- The space / project requires fields you don't have values for
  (custom required fields on a specific issue type).

## References

- `references/jira-adf.md` — **Jira Cloud (API v3)**. ADF node /
  mark catalogue and the JIRA SYNTAX REFERENCE for Cloud, with
  working examples (story with headings, lists, tables, panels,
  code blocks, mentions).
- `references/jira-wiki-server.md` — **Jira Server / Data Center
  (API v2)**. Wiki markup syntax, the renderer trap, `[~username]`
  mentions, PAT auth, full bug-report payload.
- `references/confluence-storage.md` — **Confluence storage
  format**, applies to both Cloud and Server / DC. The XHTML body
  primer (headings, lists, tables, code / info / panel macros,
  `<ac:structured-macro>`).
- `references/confluence-server.md` — Confluence Server / DC
  specifics: base URL (no `/wiki/`), `ri:userkey` / `ri:username`
  mentions, PAT auth, the `body.wiki` input shortcut.
- `references/mentions.md` — user lookup + mention syntax across
  every deployment / surface combination.
- `references/verification.md` — post-creation checklist and
  repair recipes for both deployments.

External:

- https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
- https://developer.atlassian.com/cloud/confluence/rest/v1/intro/
- https://developer.atlassian.com/server/jira/platform/jira-rest-api-examples/
- https://developer.atlassian.com/server/confluence/confluence-server-rest-api/
- https://confluence.atlassian.com/adminjiraserver/configuring-renderers-938847270.html
- https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html
- https://github.com/sooperset/mcp-atlassian/tree/main/docs/guides
  (working MCP-server example with ADF + storage-format recipes)

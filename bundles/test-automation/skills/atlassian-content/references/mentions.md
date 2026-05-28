# Mentions — the correct way, on every deployment / surface

## Contents

- [1. Cloud — `accountId`](#1-cloud--accountid)
- [2. Jira Server / Data Center — `[~username]`](#2-jira-server--data-center--username)
- [3. Confluence Server / Data Center — `ri:userkey` / `ri:username`](#3-confluence-server--data-center--riuserkey--riusername)
- [4. Mentioning multiple users](#4-mentioning-multiple-users)
- [5. Failure modes](#5-failure-modes)
- [6. Caching](#6-caching)
- [7. Privacy note](#7-privacy-note)

Mentions are the highest-leverage and most-failed piece of content
to get right. A free-text `@username` string posts as literal
text — no notification, no link, no profile card — on **every**
surface. The right way depends on the deployment.

| Deployment / surface | Identifier | Syntax in body |
|---|---|---|
| **Jira Cloud** | `accountId` | ADF `mention` node |
| **Confluence Cloud** | `accountId` | `<ri:user ri:account-id="…"/>` |
| **Jira Server / Data Center** | login `name` (the username) | `[~username]` inside wiki markup |
| **Confluence Server / Data Center** | `userKey` (preferred) or `username` | `<ri:user ri:userkey="…"/>` or `<ri:user ri:username="…"/>` |

The first task is always: **identify the deployment** (see
`SKILL.md` § "Detect deployment first"), then use the lookup +
syntax for that deployment.

## 1. Cloud — `accountId`

Atlassian Cloud mentions are backed by an **accountId** — an
opaque string per user within a tenant
(e.g. `61e1a042e67ea2006b5b2157`). The same `accountId` works
across Jira and Confluence in the same Cloud tenant.

### 1.1 Look up the accountId

From an email:

```
GET /rest/api/3/user/search?query=alexander@example.com
→ [ { "accountId": "61e1a042e67ea2006b5b2157",
      "displayName": "Alexander Bychinskiy",
      "emailAddress": "alexander@example.com", ... } ]
```

From a display name (fuzzier — may return multiples):

```
GET /rest/api/3/user/search?query=Alexander Bychinskiy
```

Self:

```
GET /rest/api/3/myself
→ { "accountId": "...", "displayName": "...", ... }
```

Verify the `displayName` you get back matches what you searched
for. Multiple matches → ask the operator; don't guess.

### 1.2 Jira mention (ADF)

```json
{ "type": "mention",
  "attrs": { "id": "61e1a042e67ea2006b5b2157",
             "text": "@Alexander Bychinskiy" } }
```

- `id` → the accountId.
- `text` → the display fallback shown only if rendering fails.
  Match the user's display name with a leading `@`.

Full paragraph:

```json
{ "type": "paragraph",
  "content": [
    { "type": "text", "text": "Hi " },
    { "type": "mention",
      "attrs": { "id": "61e1a042e67ea2006b5b2157",
                 "text": "@Alexander Bychinskiy" } },
    { "type": "text", "text": ", can you review this?" }
  ] }
```

### 1.3 Confluence mention (storage format)

```html
<ac:link>
  <ri:user ri:account-id="61e1a042e67ea2006b5b2157" />
</ac:link>
```

Confluence's renderer substitutes the user's current display name
inside the anchor — you don't provide a fallback text node.

## 2. Jira Server / Data Center — `[~username]`

On Server, the mention token is the **login username** — the
`name` field from `/rest/api/2/user/search`, NOT the display
name, NOT the email, NOT an `accountId`.

### 2.1 Look up the username

```
GET /rest/api/2/user/search?username=alexander
→ [ { "self": "https://jira.company.com/rest/api/2/user?username=jsmith",
      "key": "JIRAUSER10042",
      "name": "jsmith",                    ← this goes in [~name]
      "emailAddress": "jsmith@company.com",
      "displayName": "Jane Smith",
      "active": true } ]
```

For fuzzier search across username + display name + email:

```
GET /rest/api/2/user/picker?query=jane
→ { "users": [ { "name": "jsmith", "html": "...", ... } ], ... }
```

- `name` is the login username — feed it verbatim into `[~name]`.
- `key` (e.g. `JIRAUSER10042`) is the stable per-instance
  identifier. On GDPR-anonymized installs (Jira 8.7+), `name`
  becomes a `jirauserNNNN` alias and `[~jirauserNNNN]` works
  against that alias.

### 2.2 Use it in wiki markup

```
cc [~jsmith] — can you triage by EOD?
```

Full description snippet (Server v2 description is a JSON string,
so `\n` is a literal newline):

```json
{
  "fields": {
    "description": "h2. Investigation\n\nLikely null-pointer in {{AddressValidator}}. cc [~jsmith] and [~agonzalez]."
  }
}
```

Username escaping:

- `+`, `.`, `_` characters are usually fine.
- `|`, `]`, `[`, `{`, `}` must be escaped with backslash.
- **Case matters** on most installs — use the exact `name` from
  the API.

The Cloud-style `[~accountid:KEY]` syntax is **not officially
supported on Server** and renders as literal text on most
installs. Do not use it.

## 3. Confluence Server / Data Center — `ri:userkey` / `ri:username`

Cloud uses `ri:account-id`. **Server does not.** Use either of:

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

Confluence Server normalises `ri:username` → `ri:userkey` on save.
The `userkey` is the stable per-instance identifier.

Posting `ri:account-id="…"` on Server produces a broken-link
placeholder in the rendered page.

### 3.1 Look up the userkey on Server

```
GET /rest/api/user?username=jsmith
→ { "username": "jsmith",
    "userKey": "ff8080814ba236dc014ba236f4e40001",
    "displayName": "Jane Smith",
    "type": "known" }
```

Cache by username, store `userKey`. Note the lowercase
`userKey` key in the JSON response vs the lowercase-and-hyphenated
`ri:userkey` attribute in storage format — they refer to the same
value.

### 3.2 Cross-product on Server

Jira and Confluence on Server are usually separate installs with
separate user directories — DON'T reuse a Jira `name` as a
Confluence `username` unless the operator confirms shared SSO /
the same user directory. Look up each side independently.

## 4. Mentioning multiple users

Patterns are the same on every surface — concatenate inline
nodes / elements / tokens separated by text.

**Jira Cloud (ADF):**

```json
{ "type": "paragraph",
  "content": [
    { "type": "text", "text": "FYI " },
    { "type": "mention",
      "attrs": { "id": "ACCOUNTID-A", "text": "@Anna" } },
    { "type": "text", "text": " and " },
    { "type": "mention",
      "attrs": { "id": "ACCOUNTID-B", "text": "@Bob" } },
    { "type": "text", "text": ": please review." }
  ] }
```

**Jira Server (wiki):**

```
FYI [~anna] and [~bob]: please review.
```

**Confluence (any deployment, storage format):**

```html
<p>
  FYI
  <ac:link><ri:user ri:account-id="ACCOUNTID-A" /></ac:link>   <!-- Cloud -->
  and
  <ac:link><ri:user ri:userkey="USERKEY-B" /></ac:link>        <!-- Server -->
  : please review.
</p>
```

(Don't actually mix Cloud and Server identifiers in one page —
the line above is illustrative; in practice both mentions use the
same deployment's identifier.)

## 5. Failure modes

- **User search returns empty** → the user doesn't exist in this
  tenant / instance (may have left, may be a different
  tenant/install, search term too narrow). Do not invent a
  mention; fall back to plain text (`"Hi Alexander, "`).
- **Multiple matches** → if you can't narrow down via email
  (Cloud) or username (Server), ask the operator. Never guess.
- **Deactivated user** → mention still posts, but shows greyed
  out. Decide whether that's useful (historical record) or
  misleading (expecting a response).
- **(Server) `[~name]` renders as plain text** → either the
  field is on the Default Text Renderer, or the username is
  wrong / case-mismatched. Probe via `?expand=renderedFields`
  to disambiguate.
- **(Server) `ri:userkey` doesn't render** → the key was
  imported from a different Confluence instance (`userKey` is
  per-instance). Re-look it up in the destination instance.
- **Wrong identifier for the deployment** → `accountId` posted
  to Server, or `[~username]` written into ADF, produces literal
  text. Detect the deployment FIRST.
- **Group mentions** → Jira Cloud supports `groupId`-based team
  mentions (not covered here). Confluence does not have built-in
  group mentions in storage format. Server has the same gap.
  For "the platform team", mention the team lead individually or
  use a `@label` convention agreed with the team.

## 6. Caching

Cache lookups per session:

- Cloud: key by email or normalized display-name → `accountId`.
- Jira Server: key by email or display-name → `{ name, key }`.
- Confluence Server: key by username → `{ userKey, displayName }`.

Resolving the same user twice in one run is wasted calls;
resolving them five times is a bug.

Cross-session caching belongs in `.agents/memory/` or the
project's profile, not in this skill.

## 7. Privacy note

- `accountId` (Cloud) is safe to log / persist internally — not
  PII by itself.
- `userKey` (Server) is similarly opaque and safe.
- Login `name` (Server) is often a derivation of the user's real
  name (`jsmith`, `alexander.b`) — treat as moderately sensitive.
- Email addresses ARE PII — if you cache email → identifier,
  respect the project's data-handling policy.

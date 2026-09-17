# Header and cookie checks: the audit-step form

`evidence.mjs publish --profile case` writes every admitted case to the
hand-off suite `tasks/security-<slug>-admitted/` in the manual-qa test case
format. A case that asserts a **response header** or a **cookie attribute**
is not copied step for step: its `## Steps` table is re-emitted in the
**audit-step form** — the shape the manual-qa `qa-auditor` uses to read
headers (spec §9.2 "header/cookie checks via the audit branch"). Everything
else in the file — frontmatter keys, Preconditions, Test Data, Expected
Final State, Teardown — is the candidate's own text (redacted), with the
priority mapped and the `security` tag ensured. A case with no header or
cookie step is copied verbatim below the frontmatter.

## Why a different form

manual-qa's `test-run-lead` routes a security / headers request to its
**audit branch**: it dispatches `qa-auditor`, whose Step-0 collection
recipe (`references/audit-methodology.md`) is `browser_navigate(url)`,
`browser_snapshot()`, `browser_take_screenshot(...)`,
`browser_console_messages(...)`, **`browser_network_requests()`** — and the
`security-audit` specialist reads response headers (CSP, X-Frame-Options,
HSTS, cookies' flags) from that network list against the table in
`security-audit/references/owasp-checklist.md` ("Security Headers to
Check"). Nothing in that recipe opens a developer-tools panel, reloads a
page or fills a form. A passive header check handed to a `test-runner`
therefore says the same three things the auditor does: open the URL,
collect the network requests, inspect one header of the document
response. The case never instructs a browser action beyond "open URL,
inspect response".

## What the profile emits

Per candidate step, in order (the `case` profile module of `security-evidence`, `auditForm`):

| Candidate step | Emitted row(s) | Expected Result |
|---|---|---|
| a Navigate / Open / Visit / Load step carrying a URL (`{{base_url}}/login`, or a literal on an allowed host) | 1. the step verbatim; 2. `Collect the network requests of the page (\`browser_network_requests()\`)` | 1. the candidate's; 2. `The document response for \`<path>\` is listed with its response headers` |
| a step naming one header (in its Action or its Expected Result) | `Inspect the \`<Header>\` response header of the \`<path>\` document` | the candidate's Expected Result, verbatim |
| a step naming several headers | `Inspect the \`<A>\` and \`<B>\` response headers of the \`<path>\` document` | verbatim |
| a step naming `Set-Cookie`, or a cookie together with `Secure` / `HttpOnly` / `SameSite` | `Inspect the \`Set-Cookie\` response headers of the \`<path>\` document` | verbatim |
| `Reload …` / `Refresh …`, or a step naming the network panel / developer tools | nothing — folded into the collection row | — |
| any other admitted step | the step verbatim | verbatim |

Rows are renumbered from 1. `<path>` is the URL's path (`{{base_url}}/login`
→ `/login`; a bare `{{base_url}}` → `/`) of the most recent Navigate step.

## The mapping table: security check → audit step → what the auditor expects

The headers the profile recognises are exactly the `security-audit`
table plus `Set-Cookie` (the profile’s `AUDIT_HEADERS`). Write the Expected
Result yourself — the profile copies it verbatim; the auditor's own
threshold is here so the two agree.

| Security check (name it in the Action or the Expected Result) | Emitted Action | The auditor's expectation (`owasp-checklist.md`) | Priority the auditor assigns |
|---|---|---|---|
| `Content-Security-Policy` | `Inspect the \`Content-Security-Policy\` response header of the \`<path>\` document` | present with directives | p1 |
| `X-Frame-Options` | `Inspect the \`X-Frame-Options\` response header …` | `DENY` or `SAMEORIGIN` | p1 |
| `X-Content-Type-Options` | `Inspect the \`X-Content-Type-Options\` response header …` | `nosniff` | p2 |
| `Strict-Transport-Security` | `Inspect the \`Strict-Transport-Security\` response header …` | `max-age >= 31536000` | p1 |
| `Referrer-Policy` | `Inspect the \`Referrer-Policy\` response header …` | `no-referrer` or `strict-origin` | p2 |
| `Permissions-Policy` | `Inspect the \`Permissions-Policy\` response header …` | present | p2 |
| `Set-Cookie` flags (`Secure`, `HttpOnly`, `SameSite`) | `Inspect the \`Set-Cookie\` response headers of the \`<path>\` document` | cookies carry `Secure` (A02) and `HttpOnly` (A07) | p0 |

The priority column is the auditor's finding priority, not the case's:
the case keeps its own frontmatter `priority` (p0 → `critical`, p1 →
`high`, p2 → `medium`, p3 → `low`; the manual-qa words pass through).

## Writing a candidate that lands well

- **Lead with a Navigate step.** The audit form needs the URL; a header
  step before any Navigate step is refused at publish time
  (`USAGE(publish: admitted case <sha>: step <n> asserts a response header
  before any Navigate step …)`) — rewrite the candidate and admit it again.
- **Name the header** — in the Action ("Inspect the `Content-Security-Policy`
  header …") or in the Expected Result ("`Content-Security-Policy` is
  present …"). One header per step reads best; several in one step become
  one combined row.
- **Cookie checks say "cookie" and a flag**, or `Set-Cookie`. "Inspect the
  Secure area link" is not a cookie check.
- **Keep the Expected Result measurable** in the auditor's terms (the table
  above): "`Strict-Transport-Security` is present with `max-age` of at
  least 31536000", not "HSTS looks right".
- **Do not write reload / panel steps** — they are dropped in the audit
  form (the collection row replaces them). Do not write clicks, fills or
  submissions at all: they are `unknown-operation` or `mutating-verb` hits
  and the case stays a proposal.
- **No `password=…` in Test Data.** The suite file is the candidate's
  *redacted* text: a credential assignment reaches the runner as
  `<REDACTED:…>`. A passive header check needs none.

## Example

Candidate (`<st>/cases/<slug>/TC-001_login-headers.md`, Steps only):

```markdown
| # | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `{{base_url}}/login` | Login page loads |
| 2 | Open the browser network panel and reload the page | The document response for `/login` is listed |
| 3 | Inspect the response headers of the `/login` document | `Content-Security-Policy` is present and does not contain `unsafe-inline` |
| 4 | Inspect the `Set-Cookie` headers of the `/login` document | Every cookie carries `Secure` and `HttpOnly` |
```

Published (`tasks/security-<slug>-admitted/TC-001_login-headers.md`, Steps only):

```markdown
| # | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `{{base_url}}/login` | Login page loads |
| 2 | Collect the network requests of the page (`browser_network_requests()`) | The document response for `/login` is listed with its response headers |
| 3 | Inspect the `Content-Security-Policy` response header of the `/login` document | `Content-Security-Policy` is present and does not contain `unsafe-inline` |
| 4 | Inspect the `Set-Cookie` response headers of the `/login` document | Every cookie carries `Secure` and `HttpOnly` |
```

## What sign-off compares

The published file is a rewrite, so its identity is not the candidate's
`case_sha256`. `publish --profile case` records the published identities
in its export manifest (`<st>/handoffs/<run_id>.case.export-manifest.json`,
`opts.members`), and `sign-off` lists under `UNADMITTED:` every file in
the suite directory that no manifest recorded — a case placed there by
hand, a copy of a candidate, anything that is not what `publish` wrote.

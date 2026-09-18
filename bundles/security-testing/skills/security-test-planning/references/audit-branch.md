# Header and cookie checks: the audit-step form

`cases.mjs admit` lints and copies a case's `## Steps` table verbatim —
it never rewrites a step. So when a candidate asserts a **response
header** or a **cookie attribute**, you write its steps in the
**audit-step form** yourself: the shape manual-qa's `qa-auditor` uses to
read headers. A step that instead says "open dev tools", "reload and
watch the network tab", or "inspect the response in the console" is an
`unknown-operation` hit (dev-tools actions are not in the grammar) — the
audit-step form is the version of the same check that admits.

## Why this form

manual-qa's `test-run-lead` routes a security / headers request to its
audit branch: it dispatches `qa-auditor`, whose Step-0 collection recipe
(`references/audit-methodology.md` in manual-qa) is `browser_navigate(url)`,
`browser_snapshot()`, `browser_take_screenshot(...)`,
`browser_console_messages(...)`, **`browser_network_requests()`** — and
the `security-audit` specialist reads response headers (CSP,
X-Frame-Options, HSTS, cookies' flags) from that network list against
the table in `security-audit/references/owasp-checklist.md` ("Security
Headers to Check"). Nothing in that recipe opens a developer-tools
panel, reloads a page or fills a form. A passive header check therefore
says the same three things the auditor does: open the URL, collect the
network requests, inspect one header of the document response.

## How to write it

Per header or cookie check, in order:

1. A Navigate step carrying the URL: `Navigate to {{base_url}}/login`
   (or a literal URL on a host in `targets.browser`). Its Expected
   Result is whatever the page shows.
2. `Collect the network requests of the page (\`browser_network_requests()\`)`
   — Expected Result: `The document response for \`<path>\` is listed
   with its response headers`.
3. One step per header (or per cookie flag): `Inspect the \`<Header>\`
   response header of the \`<path>\` document` — Expected Result stated
   in the auditor's own terms (the table below), not "looks right".
4. Several headers checked together may share one step: `Inspect the
   \`<A>\` and \`<B>\` response headers of the \`<path>\` document`.
5. A cookie check names `Set-Cookie` or a flag: `Inspect the
   \`Set-Cookie\` response headers of the \`<path>\` document`.

`<path>` is the URL's path (`{{base_url}}/login` → `/login`; a bare
`{{base_url}}` → `/`).

## The mapping: header → Action → the auditor's expectation

Write the Expected Result yourself, in these terms — the auditor's own
threshold, so the two agree.

| Header | Emitted Action | The auditor's expectation (manual-qa `owasp-checklist.md`) |
|---|---|---|
| `Content-Security-Policy` | `Inspect the \`Content-Security-Policy\` response header of the \`<path>\` document` | present with directives |
| `X-Frame-Options` | `Inspect the \`X-Frame-Options\` response header …` | `DENY` or `SAMEORIGIN` |
| `X-Content-Type-Options` | `Inspect the \`X-Content-Type-Options\` response header …` | `nosniff` |
| `Strict-Transport-Security` | `Inspect the \`Strict-Transport-Security\` response header …` | `max-age >= 31536000` |
| `Referrer-Policy` | `Inspect the \`Referrer-Policy\` response header …` | `no-referrer` or `strict-origin` |
| `Permissions-Policy` | `Inspect the \`Permissions-Policy\` response header …` | present |
| `Set-Cookie` flags (`Secure`, `HttpOnly`, `SameSite`) | `Inspect the \`Set-Cookie\` response headers of the \`<path>\` document` | cookies carry `Secure` and `HttpOnly` |

The case keeps its own frontmatter `priority` (`critical|high|medium|low`)
— the auditor's own finding priority is a separate thing and does not
need to match.

## Writing a candidate that admits cleanly

- **Lead with a Navigate step** — the audit form needs the URL first.
- **Name the header** — in the Action ("Inspect the
  `Content-Security-Policy` header …") or the Expected Result
  ("`Content-Security-Policy` is present …"). One header per step reads
  best.
- **Cookie checks say "cookie" and a flag**, or `Set-Cookie`. "Inspect
  the secure area link" is not a cookie check.
- **Keep the Expected Result measurable** in the auditor's terms: "the
  `Strict-Transport-Security` header is present with `max-age` of at
  least 31536000", not "HSTS looks right".
- **Do not write reload / dev-tools-panel steps** — the collection step
  (`browser_network_requests()`) replaces them, and a reload/panel step
  reads as `unknown-operation`.
- **Do not write clicks, fills or submissions** — those are
  `unknown-operation` or `mutating-verb` hits and the case stays a
  proposal.
- **No `password=…` in Test Data.** A passive header check needs none,
  and the suite copy is redacted text regardless.

## Example

```markdown
| # | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `{{base_url}}/login` | Login page loads |
| 2 | Collect the network requests of the page (`browser_network_requests()`) | The document response for `/login` is listed with its response headers |
| 3 | Inspect the `Content-Security-Policy` response header of the `/login` document | `Content-Security-Policy` is present and does not contain `unsafe-inline` |
| 4 | Inspect the `Set-Cookie` response headers of the `/login` document | Every cookie carries `Secure` and `HttpOnly` |
```

## What sign-off compares

`sign-off` lists under `UNADMITTED:` every file in the suite directory
that `.admitted.json` does not carry with a matching sha256 — a case
placed there by hand, a stale copy, anything `admit` did not write.
Writing the audit-step form yourself and admitting through `cases.mjs
admit` is what keeps a file out of that listing.

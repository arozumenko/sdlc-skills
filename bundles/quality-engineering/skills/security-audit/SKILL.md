---
name: security-audit
description: Use when auditing a web page for security exposure — XSS, CSRF, missing or weak headers (CSP, HSTS, X-Frame-Options), mixed content, exposed secrets, and the OWASP Top 10 surface.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
allowed-tools: Bash(node:*) Bash(bash:*)
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Security & OWASP Audit

The **Security 🔒** specialist pass. This skill is agent-orchestrated — the
quality-architect (or whichever agent owns the audit) loads it on demand when a
page handles auth, sensitive data, forms, or admin surfaces, or whenever the
operator explicitly asks for a security check. It is not a user-invocable
command; it runs as one specialist inside a larger audit and emits findings in
the shared finding schema (below).

What it covers: browser-visible security exposure — XSS vectors, CSRF gaps,
missing or weak security headers, mixed content, exposed secrets, and the slice
of the OWASP Top 10 you can detect without source access.

## Load context first

Before analyzing, read the project context so checks are prioritized against the
real product, not a generic checklist:

- `.agents/profile.md` (§ Project systems) — architecture, environments, auth model.
- `.agents/testing.md` — what's already exercised and how.
- The role's injected memory at `.agents/memory/<role>/project_briefing.md` —
  accumulated risk areas and gotchas.
- `.agents/quality.md` if present (seeding writes a per-product quality profile;
  optional) — known sensitive flows, regulated data, security relevance per surface.

If none exist, work from what the operator provides (URL, screenshot, snippet)
and note the reduced context in your findings.

## Browser data (CDP via browser-verify)

All page inspection goes through **this repo's `browser-verify` skill** (CDP, real
input events, zero deps). **Read `skills/browser-verify/SKILL.md` first** for the
launch flow and command reference, then resolve the scripts path:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless
node "$SCRIPTS/cdp.mjs" navigate "<url>"
```

Collect the security-relevant signals (these are real `cdp.mjs` commands):

```bash
# Network — failed/security-relevant requests, status, initiators
node "$SCRIPTS/cdp.mjs" get-network --status error
node "$SCRIPTS/cdp.mjs" get-network --status 4xx

# Meta tags (CSP delivered via <meta http-equiv>, referrer, etc.)
node "$SCRIPTS/cdp.mjs" get-meta

# Cookies — flags (Secure, HttpOnly, SameSite)
node "$SCRIPTS/cdp.mjs" get-cookies

# Storage — sensitive data parked in localStorage/sessionStorage
node "$SCRIPTS/cdp.mjs" get-storage

# DOM — forms, inputs, inline handlers, reflected params
node "$SCRIPTS/cdp.mjs" get-html --selector "form"

# Arbitrary probes — enumerate scripts, check protocol, find tokens
node "$SCRIPTS/cdp.mjs" evaluate "location.protocol"
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify([...document.querySelectorAll('script[src]')].map(s=>s.src))"

# Evidence (ephemeral /tmp only — NEVER a project reports/ or tests/ dir)
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-security-form.png
```

Note on response headers: HTTP security headers (CSP, HSTS, X-Frame-Options,
X-Content-Type-Options) are most reliably read from `get-network` entries for the
document request; `<meta http-equiv>` only catches the subset delivered in HTML.
When you can't observe a header directly, say so and lower confidence — don't
assert a header is missing on a hunch.

Stop Chrome when done:

```bash
bash "$SCRIPTS/chrome-launcher.sh" stop
```

## Focus areas

Look for:

- **XSS vectors** — form/URL input reflected into the page without encoding;
  inline event handlers; `innerHTML` sinks; URL params rendered as content.
- **CSRF** — state-changing forms with no anti-CSRF token; cookies without
  `SameSite`.
- **Mixed content** — `http://` resources loaded on an `https://` page.
- **Exposed sensitive data** — tokens, passwords, PII, session IDs in URLs;
  secrets/API keys in page source, inline scripts, or network payloads.
- **Cookie flags** — missing `Secure`, `HttpOnly`, or `SameSite`.
- **Sensitive data in storage** — auth tokens or PII in `localStorage` /
  `sessionStorage`.
- **Weak password policy** — no length/complexity requirement; no strength meter.
- **Missing/weak security headers** — CSP, X-Frame-Options, HSTS,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- **Clickjacking** — page embeddable in an iframe (no X-Frame-Options / frame
  CSP `ancestors`).
- **Open redirects** — redirect-target parameters in URLs.
- **Input validation gaps** — fields accepting unbounded or unsanitized input.

## OWASP Top 10 quick check

See [`references/owasp-checklist.md`](references/owasp-checklist.md) for the full
browser-visible indicator list and the security-headers table with priorities.

| OWASP | What to look for |
|---|---|
| A01 Broken Access Control | Direct object references, admin routes reachable without auth, CORS misconfig |
| A02 Cryptographic Failures | HTTP / mixed content, sensitive data in URLs or storage, cookies without `Secure` |
| A03 Injection | Reflected URL params, unencoded inputs, DB details in error messages |
| A05 Security Misconfiguration | Verbose error/stack pages, default-credential hints, version-leaking headers |
| A07 Auth Failures | No rate limiting, weak password policy, tokens in URLs, cookies without `HttpOnly` |
| A09 Logging Failures | No failed-login feedback (limited browser visibility — mostly informational) |

## Finding schema

Every finding this specialist emits uses the shared audit schema:

```json
{
  "title": "Short descriptive title",
  "types": ["Security"],
  "priority": "p1",
  "confidence": 8,
  "reasoning": "Why this is a problem and the user / data impact",
  "suggested_fix": "Plain-English fix description",
  "fix_prompt": "Ready-to-paste prompt to fix this",
  "specialist_icon": "🔒",
  "specialist_specialty": "Security & OWASP"
}
```

**Priority.** `p0` = critical (active security risk, data loss, auth bypass) —
security findings default here unless mitigated. `p1` = high (degrades the
security posture, affects many — e.g. missing CSP/HSTS). `p2` = medium
(noticeable, mitigations exist). `p3` = low / informational (minor hardening).
Security findings default to **p0–p1** unless purely informational (p3).

**Confidence (1–10).** `8–10` definite — direct proof (a network trace showing
the missing header, a screenshot of the reflected payload, the cookie row
without `HttpOnly`). `5–7` likely — strong indirect indicators. `1–4` possible —
educated guess, direct evidence unavailable.

## Evidence discipline

**Every finding must have backing proof. No exceptions.**

| Evidence type | When required |
|---|---|
| Network trace (`get-network`) | Missing/weak headers, mixed content, failed/CORS requests |
| Screenshot (`/tmp/...`) | Reflected XSS, verbose error pages, clickjacking render |
| Cookie/storage dump | Missing flags, secrets in storage, tokens in URLs |
| DOM/element selector | Any form/input/handler-related finding |
| Console output (`get-console`) | CSP violations, injection errors |

If you can't prove it, **lower confidence to 1–4 and note the missing evidence.**
Never fabricate evidence. Never report something you can't point to. A "missing
header" you never observed in a `get-network` trace is a hunch, not a p1 finding —
score it accordingly.

## Related specialists

This skill is one pass in a multi-specialist audit. Adjacent specialists:

- [`privacy-audit`](../privacy-audit/) — cookies, trackers, GDPR/consent (overlaps
  on cookie flags; privacy owns consent, security owns `Secure`/`HttpOnly`).
- [`accessibility-audit`](../accessibility-audit/) — WCAG / axe-core.
- [`performance-audit`](../performance-audit/) — timing, console, JS errors.
- [`responsive-audit`](../responsive-audit/) — mobile/viewport.
- [`content-seo-audit`](../content-seo-audit/) — content/SEO/meta.
- [`ux-audit`](../ux-audit/) — UI/UX, forms, page-type checks.

When a security finding needs a clean repro before filing, hand it to
[`reproducing-issues`](../reproducing-issues/). To go deep on an unfamiliar
threat model before testing, use [`deep-research`](../deep-research/). To turn
confirmed findings into regression coverage, use
[`test-generation`](../test-generation/).

## Reference files

- [`references/owasp-checklist.md`](references/owasp-checklist.md) — OWASP Top 10
  browser-visible indicators + the security-headers table with priorities.

---
target: https://staging.example.com
date: 2026-09-15
pages_audited: [https://staging.example.com/, https://staging.example.com/login]
specialists_run: [security, privacy, accessibility, content-seo, performance]
---

# Web Audit Report: https://staging.example.com — 2026-09-15

**Pages audited:** 2
**Specialists run:** 5
**Findings:** 3 (1 p0, 1 p1, 1 p2)

## Summary

| Priority | Count |
|----------|-------|
| 🔴 P0    | 1     |
| 🟠 P1    | 1     |
| 🟡 P2    | 1     |
| ⚪ P3    | 0     |

## Findings by Specialist

### 🔒 Security & OWASP — 2 findings

#### [P0, confidence 9] Session cookie is set without HttpOnly
**Affected pages:** https://staging.example.com/login
**Reasoning:** A cookie readable from script is exfiltrable by any injected script; the session cookie is the whole account
**Evidence:** network trace — response header `Set-Cookie: session=abc123; Path=/; Secure` on `POST /login`
**Suggested fix:** Add the `HttpOnly` attribute to the session cookie
**Fix prompt:** `Set the HttpOnly attribute on the session cookie issued by POST /login`

#### [P1, confidence 8] Missing Content-Security-Policy header
**Affected pages:** https://staging.example.com/, https://staging.example.com/login
**Reasoning:** Without a CSP an injected script runs with the page's full authority
**Evidence:** network trace — no `Content-Security-Policy` response header on either document
**Suggested fix:** Add a Content-Security-Policy header with a default-src 'self' baseline
**Fix prompt:** `Add a Content-Security-Policy response header (default-src 'self') to every HTML document`

### 🍪 Privacy — 0 findings

### ♿ Accessibility & WCAG — 1 findings

#### [P2, confidence 7] Login form fields have no programmatic labels
**Affected pages:** https://staging.example.com/login
**Reasoning:** Screen-reader users hear "edit text" with no field name
**Evidence:** snapshot — `input#email` and `input#password` have no associated `<label>` or `aria-label`
**Suggested fix:** Associate a visible label with each field
**Fix prompt:** `Add <label for> elements for the email and password inputs on the login form`

### ✍️ Content & SEO — 0 findings

### 📡 Performance — 0 findings

## Limitations

_No `browser_evaluate` — meta tags, cookies, storage, Core Web Vitals and axe rule IDs were not directly inspectable; the cookie finding is confirmed from the network response headers. UX and responsive specialists were skipped (no responsive signals on the audited pages)._

## Notes

> Executed autonomously by qa-auditor. Review screenshots for false positives.
> Screenshots in `reports/screenshots/`.

## Findings (JSON)

```json
[
  {
    "title": "Session cookie is set without HttpOnly",
    "types": ["Session Management", "OWASP A05"],
    "priority": "p0",
    "confidence": 9,
    "reasoning": "A cookie readable from script is exfiltrable by any injected script; the session cookie is the whole account",
    "suggested_fix": "Add the HttpOnly attribute to the session cookie",
    "fix_prompt": "Set the HttpOnly attribute on the session cookie issued by POST /login",
    "specialist_icon": "🔒",
    "specialist_specialty": "Security & OWASP",
    "affected_pages": ["https://staging.example.com/login"],
    "evidence": "network trace — response header `Set-Cookie: session=abc123; Path=/; Secure` on `POST /login`"
  },
  {
    "title": "Missing Content-Security-Policy header",
    "types": ["Security Headers", "OWASP A05"],
    "priority": "p1",
    "confidence": 8,
    "reasoning": "Without a CSP an injected script runs with the page's full authority",
    "suggested_fix": "Add a Content-Security-Policy header with a default-src 'self' baseline",
    "fix_prompt": "Add a Content-Security-Policy response header (default-src 'self') to every HTML document",
    "specialist_icon": "🔒",
    "specialist_specialty": "Security & OWASP",
    "affected_pages": ["https://staging.example.com/", "https://staging.example.com/login"],
    "evidence": "network trace — no `Content-Security-Policy` response header on either document"
  },
  {
    "title": "Login form fields have no programmatic labels",
    "types": ["Forms", "WCAG 1.3.1"],
    "priority": "p2",
    "confidence": 7,
    "reasoning": "Screen-reader users hear \"edit text\" with no field name",
    "suggested_fix": "Associate a visible label with each field",
    "fix_prompt": "Add <label for> elements for the email and password inputs on the login form",
    "specialist_icon": "♿",
    "specialist_specialty": "Accessibility & WCAG",
    "affected_pages": ["https://staging.example.com/login"],
    "evidence": "snapshot — `input#email` and `input#password` have no associated `<label>` or `aria-label`"
  }
]
```

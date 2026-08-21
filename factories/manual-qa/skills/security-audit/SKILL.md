---
name: security-audit
description: Security and OWASP analysis. Reviews for XSS, CSRF, injection risks, missing security headers, and exposed data.
license: Apache-2.0
metadata:
  discoverable: false
  user-invocable: false
---

# Security & OWASP Analysis

**Security 🔒** specialist pass.

## Data Sources

**Visual + accessibility-tree analysis** (`browser_snapshot`, `browser_take_screenshot`):
- Input fields without visible validation
- URLs containing sensitive parameters
- Forms without CSRF tokens (no hidden token field in the snapshot)
- Mixed HTTP/HTTPS content
- Clickjacking risk (missing X-Frame-Options — see network data below)

**Network data** (`browser_network_requests`, `browser_console_messages(level:"error")` from
the Step-0 collection):
- Failed/erroring security-related requests
- Response headers (CSP, X-Frame-Options, HSTS, etc. — see the header table below)

## Focus Areas

Look for:
- XSS vectors in forms/URLs (unescaped user input rendering)
- CSRF vulnerabilities (forms without tokens)
- Insecure HTTP resources on HTTPS pages (mixed content)
- Exposed sensitive data in URLs (tokens, passwords, PII)
- Weak password policies (no length/complexity requirements)
- Missing security headers (CSP, X-Frame-Options, HSTS)
- Clickjacking risks (pages embeddable in iframes)
- Open redirects (redirect parameters in URLs)
- Input validation gaps
- Exposed API keys or tokens in page source/network

## OWASP Top 10 Quick Check

See `references/owasp-checklist.md` for detailed criteria.

| OWASP | What to look for |
|---|---|
| A01 Broken Access | Direct object references, missing auth checks |
| A02 Crypto Failures | HTTP, sensitive data in localStorage |
| A03 Injection | Unparameterized inputs, reflected URL params |
| A05 Misconfiguration | Verbose error pages, default credentials |
| A07 Auth Failures | No rate limiting, weak password policy |

## Output

Security findings default to p0-p1 unless informational (p3). Produce findings
in the shared schema — see the qa-auditor `audit-methodology.md`.

## Reference Files

- `references/owasp-checklist.md` — OWASP Top 10 browser-visible indicators

# OWASP Top 10 — Browser-Visible Indicators

What you can detect from the browser without code access.

## A01:2021 — Broken Access Control (p0)
- URL patterns suggesting direct object references (`/api/users/123`)
- Admin/internal pages accessible without authentication
- Missing function-level access control (can access admin routes?)
- CORS misconfiguration visible in network responses

## A02:2021 — Cryptographic Failures (p0)
- Pages served over HTTP instead of HTTPS
- Mixed content (HTTP resources on HTTPS pages)
- Sensitive data visible in URLs (passwords, tokens, SSN)
- Sensitive data in localStorage/sessionStorage
- Cookies without `Secure` flag

## A03:2021 — Injection (p0)
- Form inputs reflected in page output without encoding
- URL parameters rendered in page content
- Error messages exposing SQL/database details
- Search inputs that show raw query in results

## A05:2021 — Security Misconfiguration (p1)
- Verbose error pages (stack traces, framework versions)
- Default credentials hinted (placeholder text: "admin/admin")
- Server headers exposing technology versions
- Directory listing enabled
- Debug mode indicators

## A07:2021 — Identification and Authentication Failures (p0)
- No visible rate limiting on login (no CAPTCHA after failures)
- Password field accepts very short passwords
- No password strength indicator
- Session tokens in URLs
- No "forgot password" link (forces weak passwords)
- Cookies without `HttpOnly` flag (accessible to JS)

## A09:2021 — Security Logging and Monitoring Failures (p2)
- No visible indication of failed login attempts
- No session activity log for users
- (Limited browser visibility — mostly informational)

## Security Headers to Check

| Header | Expected | Priority |
|---|---|---|
| Content-Security-Policy | Present with directives | p1 |
| X-Frame-Options | DENY or SAMEORIGIN | p1 |
| X-Content-Type-Options | nosniff | p2 |
| Strict-Transport-Security | max-age >= 31536000 | p1 |
| Referrer-Policy | no-referrer or strict-origin | p2 |
| Permissions-Policy | Present | p2 |

---
name: privacy-audit
description: >
  Privacy, cookie consent, and GDPR analysis. Audits cookies, trackers,
  consent banners, and GDPR compliance from network traffic and the page.
license: Apache-2.0
metadata:
  user-invocable: false
---

# Privacy & GDPR Analysis

Two analysis passes:
- **Privacy 🍪** — Cookie consent, trackers, storage
- **GDPR 🇪🇺** — GDPR compliance

## Data Sources

**Network data — `browser_network_requests()`:**
- `Set-Cookie` response headers → cookie name, domain, and (from header
  attributes) `HttpOnly`/`Secure`/`SameSite` flags
- Third-party requests → filter for hosts that don't match the page's own
  domain; treat requests to known analytics/tracking domains (Google
  Analytics/`gtag`, Meta Pixel, Hotjar, Intercom, Segment, Mixpanel, etc.) as
  tracker evidence, and note whether they fired **before** any consent
  interaction was recorded in the snapshot/console timeline

**Visual + structural — `browser_snapshot()` / `browser_take_screenshot()`:**
- Cookie/consent banner presence, wording, and button prominence ("Accept
  all" vs "Reject all")
- Privacy policy link presence and location

**Limitation:** the factory's Playwright MCP toolset has no `browser_evaluate`,
so `document.cookie` values, `localStorage`/`sessionStorage` contents, and
`window.*` tracker globals (`window.ga`, `window.fbq`, …) **cannot be read
directly.** Cookie/tracker findings must be inferred from `Set-Cookie` headers
and third-party network requests instead — lower confidence accordingly per the
evidence rule (`audit-methodology.md`), and never claim to have read storage
contents that weren't actually gathered.

## Privacy 🍪 — Focus Areas

Look for:
- Missing cookie consent banner
- Tracking requests firing BEFORE consent
- Unclear data collection disclosures
- Missing privacy policy link
- Third-party scripts/requests without notice
- Cookies missing `HttpOnly` or `Secure` flags (from `Set-Cookie` headers)
- Analytics firing without consent

## GDPR 🇪🇺 — Focus Areas

Look for:
- No explicit consent before tracking
- Bundled consent without granularity
- No right-to-withdraw mechanism
- Missing data retention disclosures
- Pre-ticked consent boxes
- Unclear privacy notices

See `references/gdpr-checklist.md` for detailed criteria.

## Output

Tracking-before-consent = p0-p1. Produce findings in the shared schema — see
the qa-auditor `audit-methodology.md`.

## Reference Files

- `references/gdpr-checklist.md` — GDPR compliance checks

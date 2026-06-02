---
name: privacy-audit
description: Use when auditing cookies, trackers, storage, consent banners, or GDPR compliance on a web page.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Privacy & GDPR Audit

This skill is **agent-orchestrated** — the `quality-architect` loads it when a page
needs a privacy or GDPR pass; it is not something a human invokes directly. It runs
two analysis passes over the live page:

- **Privacy 🍪** — Cookie consent, trackers, storage hygiene
- **GDPR 🇪🇺** — GDPR compliance (browser-visible criteria only)

## Before you start — context

Read the project context first so findings land against the right systems and
expectations:

- `.agents/profile.md` (§ Project systems) — what the product is, who runs it, where it lives
- `.agents/testing.md` — quality posture, environments, what's already covered
- the role's injected memory at `.agents/memory/<role>/project_briefing.md` — accumulated gotchas
- `.agents/quality.md` if present — per-product quality profile (seeding writes it; optional)

If a privacy/consent expectation isn't documented, don't invent one — audit what the
page actually does and report the gap.

## Browser automation — via `browser-verify` (CDP)

All page inspection runs through this repo's **`browser-verify`** skill (Chrome
DevTools Protocol, zero external deps). **Read `skills/browser-verify/SKILL.md`
first** for the full command reference; the commands below are the ones this audit
relies on. Resolve the scripts path from the install location:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
```

Screenshots and any captured evidence go to **ephemeral `/tmp`** (e.g.
`/tmp/audit-consent-banner.png`). Never write a project-root `reports/` or `tests/`
directory.

## Data Sources

**Primary — from the page itself** (no MCP can provide this):

```bash
node "$SCRIPTS/cdp.mjs" get-cookies     # name, value, domain, httpOnly, secure, expires per cookie
node "$SCRIPTS/cdp.mjs" get-storage     # localStorage + sessionStorage keys/values combined
node "$SCRIPTS/cdp.mjs" get-network     # requests + timing — see who fires before consent
node "$SCRIPTS/cdp.mjs" get-console     # console noise that may leak tracker init
node "$SCRIPTS/cdp.mjs" get-meta        # privacy-relevant meta / structured data
```

**Tracker enumeration** (run via `evaluate`):

```bash
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify({
  googleAnalytics: !!(window.ga || window.gtag || window.dataLayer),
  metaPixel: !!(window.fbq || window._fbq),
  hotjar: !!window.hj,
  intercom: !!window.Intercom,
  segment: !!window.analytics,
  mixpanel: !!window.mixpanel
})"
```

**Cookie banner detection:**

```bash
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify({
  hasCookieBanner: !!document.querySelector('[class*=cookie],[class*=consent],[id*=cookie],[id*=consent],[class*=gdpr],[id*=gdpr]'),
  hasAcceptButton: !!document.querySelector('[class*=cookie] button,[class*=consent] button,button[id*=accept i],button[class*=accept i]')
})"
```

**Third-party scripts:**

```bash
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify((() => {
  const host = location.hostname;
  return [...document.querySelectorAll('script[src]')].map(s => s.src).filter(src => !src.includes(host));
})())"
```

**Tracking-before-consent check.** Navigate fresh (clear cookies first via
`clear-cookies`), then `get-network` *before* dismissing any banner — any
analytics/pixel request that already fired is a finding. Screenshot the banner state
to `/tmp/audit-consent-banner.png` as evidence.

## Privacy 🍪 — Focus Areas

Look for:

- Missing cookie consent banner
- Tracking scripts loading BEFORE consent
- Unclear data collection disclosures
- Missing privacy policy link
- Third-party scripts without notice
- Sensitive data in localStorage (tokens, PII)
- Analytics firing without consent
- Cookies missing `httpOnly` or `secure` flags

## GDPR 🇪🇺 — Focus Areas

Look for:

- No explicit consent before tracking
- Bundled consent without granularity
- No right-to-withdraw mechanism
- Missing data retention disclosures
- Pre-ticked consent boxes
- Unclear privacy notices

See `references/gdpr-checklist.md` for detailed pass/fail criteria. That checklist
covers only browser-visible compliance — legal-completeness is out of scope.

## Finding schema

Emit each issue as a structured finding. The audit's value is in honest, provable
findings, not volume:

```yaml
- title: Google Analytics fires before consent
  priority: p0            # p0 (critical) … p3 (cosmetic)
  confidence: 9           # 1–10 — how sure you are this is real
  specialist:
    icon: 🍪              # 🍪 Privacy / 🇪🇺 GDPR
    specialty: Privacy
  evidence: /tmp/audit-network-preconsent.png
  suggested_fix: Gate the GA snippet behind the consent-manager callback; do not load gtag.js until the user accepts analytics.
  fix_prompt: "Move the Google Analytics initialization so it only runs after the consent manager reports analytics consent granted. The gtag.js script tag and dataLayer push must not execute on first paint."
```

**Priority guide:** tracking-before-consent or sensitive-data (PII / tokens)
exposure = **p0–p1**. Missing retention disclosure or weak banner prominence =
p2. Cosmetic / advisory = p3.

## Evidence discipline

**If you can't prove it, lower the confidence; never fabricate.** Every finding
must cite real evidence — a `get-cookies` row, a `get-network` entry, a DOM query
result, or a `/tmp/audit-*.png` screenshot. A claim you only suspect (e.g. "the
privacy policy is probably non-compliant") drops to low confidence or doesn't ship.
Browser-visible only: don't assert anything about back-office DPAs, processor
contracts, or lawful-basis records you can't observe from the page.

## Reference Files

- `references/gdpr-checklist.md` — GDPR compliance checks (browser-visible criteria)

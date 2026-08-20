---
name: content-seo-audit
description: Content quality, copywriting, and SEO metadata analysis. Checks copy quality visually and page metadata (title, description, structured data) where observable.
license: Apache-2.0
metadata:
  discoverable: false
  user-invocable: false
---

# Content & SEO Analysis

**Content ✍️** specialist pass.

## Data Sources

**`browser_snapshot()`** — the page title is typically visible in the
snapshot/document root; use it for the `<title>` check.

**`browser_take_screenshot()`** — visual review for copy quality, typos,
CTA wording, and headings.

**Limitation:** the factory's Playwright MCP toolset has no `browser_evaluate`,
so `<meta>` tags (`description`, `robots`, `canonical`, `viewport`), Open
Graph/Twitter Card tags, and structured data (JSON-LD) **cannot be read
directly** — they aren't exposed by `browser_snapshot`. Report meta-tag
findings only when they can be corroborated some other way (e.g. a visibly
broken/missing OG image on a shared-link preview, or a `noindex` banner shown
by an SEO extension in the screenshot); otherwise state that the specific meta
tag could not be verified in this environment and skip it rather than guessing.
Never claim to have read a meta tag's content without evidence.

## Focus Areas

- Typos and grammatical errors
- Inconsistent tone/voice
- Vague CTAs ("Click here", "Submit")
- Missing/misleading headings
- Placeholder text left in ("Lorem ipsum", "TODO")
- Unclear value proposition
- Broken links in body text

### SEO Meta Checks

Verify only what's directly observable per the Limitation above (primarily the
`<title>`); flag the rest as unverifiable rather than reporting a finding.

| Element | Priority |
|---|---|
| `<title>` | p1 |
| `meta description` | p1 |
| `og:title` + `og:image` | p2 |
| `canonical` URL | p2 |
| `robots` = noindex on live page | p0 |
| Structured data (JSON-LD) | p2 |
| `twitter:card` | p3 |

## Output

SEO issues = p0-p1. Content quality issues = p2-p3 unless in critical CTAs.
Produce findings in the shared schema — see the qa-auditor `audit-methodology.md`.

---
name: content-seo-audit
description: Use when auditing content quality and SEO on a web page — copy clarity, meta tags, structured data, headings, canonical/robots, broken links.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
allowed-tools: Bash(node:*) Bash(bash:*)
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Content & SEO Audit

The **Content ✍️** specialist pass. This skill is agent-orchestrated — `quality-architect`
loads it on demand as one specialist among several, working from page data already
collected in the shared Step 0. It is not invoked directly by a user; the orchestrating
agent dispatches it and merges its findings into the audit's finding schema.

## Context — read before auditing

Before running this pass, ground yourself in the product and its quality bar:

- `.agents/profile.md` (§ Project systems) — what the product is, stack, surfaces.
- `.agents/testing.md` — how this team tests, quality conventions, what "good" means here.
- the role's injected `memory/<role>/project_briefing.md` — accumulated project gotchas.
- `.agents/quality.md` if present — per-product quality profile (seeding writes it; optional). It
  may pin brand tone/voice, the canonical domain, target locales, or known intentional `noindex`
  surfaces. Don't fabricate these defaults if the file is absent — note the gap and lower confidence
  on judgement calls that depend on them.

## Data Sources

Browser automation is via this repo's **browser-verify** skill (CDP). Read
[`skills/browser-verify/SKILL.md`](../browser-verify/SKILL.md) first for the launch dance and the
real command names. Resolve `SCRIPTS=".claude/skills/browser-verify/scripts"`, start Chrome, then
collect:

**`get-meta`** — the primary source for this pass. Returns:

```
title, description, keywords, viewport, robots, canonical
og.*, twitter.*, structuredData (JSON-LD)
```

```bash
node "$SCRIPTS/cdp.mjs" get-meta
```

Supporting commands when `get-meta` isn't enough:

- `get-text` / `get-html [--selector s]` — pull body copy and heading structure for the
  copy-quality and headings checks (`get-text --selector "main"`, then inspect `h1`…`h6`).
- `screenshot --output /tmp/audit-<page>-<step>.png` — capture the rendered page for visual
  copy-quality analysis (vague CTAs, placeholder text, tone). Save evidence to **ephemeral
  `/tmp` only** — never a project-root `reports/` or `tests/` dir.
- `get-network --status 4xx` / `get-network --status error` — surface broken links and dead
  resources referenced from the page.

If browser-verify can't run (no Chrome, Node too old), ask the operator for a screenshot of the
page and note the missing data — lower confidence accordingly.

## Focus Areas

Copy quality (visual + text analysis):

- Typos and grammatical errors
- Inconsistent tone/voice (against `.agents/quality.md` brand voice if pinned)
- Vague CTAs ("Click here", "Submit")
- Missing/misleading headings; `h1`…`h6` hierarchy that skips levels
- Placeholder text left in ("Lorem ipsum", "TODO")
- Unclear value proposition
- Broken links in body text (cross-check against `get-network --status 4xx`)

### SEO Meta Checks

| Element | Priority |
|---|---|
| `<title>` (missing/empty/duplicated) | p1 |
| `meta description` (missing/truncated) | p1 |
| `og:title` + `og:image` | p2 |
| `canonical` URL (missing, or wrong domain vs `.agents/quality.md`) | p2 |
| `robots` = `noindex` on a live page | p0 |
| Structured data (JSON-LD) present + valid | p2 |
| `twitter:card` | p3 |

A live page returning `noindex` is the one p0 here — it silently de-lists the page from search.
Confirm it's not an intentional `noindex` surface listed in `.agents/quality.md` before filing p0;
if the profile is absent, file at p0 with confidence ≤ 7 and flag the assumption.

## Finding Schema

Every finding this pass emits uses the shared audit schema:

```json
{
  "title": "Short descriptive title",
  "types": ["Content", "SEO"],
  "priority": "p1",
  "confidence": 8,
  "reasoning": "Why this is a problem and user/search impact",
  "suggested_fix": "Plain English fix description",
  "fix_prompt": "Ready-to-paste prompt to fix this",
  "specialist_icon": "✍️",
  "specialist_specialty": "Content & SEO"
}
```

**Priority:** `p0` = critical (live `noindex`, page de-listed), `p1` = high (missing title/description
degrades discoverability for many), `p2` = medium (noticeable, workaround/partial coverage exists),
`p3` = low (minor polish, edge case).

**Confidence (1-10):** 8-10 definite — direct proof (the `get-meta` payload, a `get-network` 4xx
entry, a screenshot of placeholder copy); 5-7 likely — strong indirect indicators; 1-4 possible —
educated guess where direct evidence isn't available.

**Evidence discipline.** Every finding must have backing proof — the meta payload, a network trace,
a screenshot in `/tmp`, or an element selector. If you can't prove it, lower confidence to 1-4 and
note the missing evidence. Never fabricate evidence. Never report something you can't point to.

## Output

SEO meta issues = p0-p1 (a live `noindex` is the lone p0; missing title/description are p1). Content
quality issues = p2-p3 unless they sit in critical CTAs or the primary value proposition, in which
case promote to p1. Hand findings back to the orchestrating agent — it deduplicates across specialist
passes and across pages (a missing meta tag is one finding, not N), then ranks by priority then
confidence.

## Related specialists

This pass runs alongside the other audit specialists the orchestrator may dispatch:
[`reproducing-issues`](../reproducing-issues/SKILL.md), [`deep-research`](../deep-research/SKILL.md),
`test-generation`, `accessibility-audit`, `security-audit`, `privacy-audit`, `performance-audit`,
`responsive-audit`, `ux-audit`.

---
name: performance-audit
description: Use when auditing performance, Core Web Vitals (LCP/CLS/TTFB), network waterfall, console errors, or runtime JavaScript issues on a web page.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Performance, Network & Console Audit

This skill is **agent-orchestrated** — the `quality-architect` agent loads it as
one specialist pass inside a multi-specialist web audit. A human does not invoke
it directly; the architect dispatches it against a page already opened by the
`browser-verify` skill and collects its findings alongside the other audit
specialists (accessibility, security, privacy, responsive, content/SEO, UX).

Three analysis passes:

- **Performance 📡** — Core Web Vitals, load times, resource sizes
- **Console 🖥️** — runtime errors, warnings, CSP violations
- **JavaScript ⚡** — async issues, memory leaks, deprecated APIs

## Context to read first

Before auditing, read the project context the architect seeded:

- `.agents/profile.md` § Project systems — stack, hosting, base URL, what's in scope
- `.agents/testing.md` — quality bar, performance budgets if the project sets stricter ones
- the role's injected `memory/<role>/project_briefing.md` — accumulated gotchas
- `.agents/quality.md` if present (seeding writes it; optional) — per-product quality
  profile, including any tightened CWV / resource budgets that override the defaults below

Missing context → audit against the default thresholds in
[`references/cwv-thresholds.md`](references/cwv-thresholds.md); don't fabricate
project-specific budgets.

## Data sources

This skill consumes the page-state snapshot the `browser-verify` skill collects.
Read [`skills/browser-verify/SKILL.md`](../browser-verify/SKILL.md) first — its
QA Inspection commands are the source of truth. Resolve the scripts path from the
install location, e.g. `SCRIPTS=".claude/skills/browser-verify/scripts"`.

**Performance** uses `get-performance` and `get-network`:

```bash
node "$SCRIPTS/cdp.mjs" get-performance     # timing, resource sizes, LCP/FID/CLS
node "$SCRIPTS/cdp.mjs" get-network         # all requests + timing
node "$SCRIPTS/cdp.mjs" get-network --status error   # 4xx / 5xx / failed requests
```

Pull from `get-performance`: page timing (load, first byte), Core Web Vitals,
and the slowest resources. Pull from `get-network`: any 4xx/5xx, CORS failures,
and waterfall bottlenecks.

**Console** uses `get-console`:

```bash
node "$SCRIPTS/cdp.mjs" get-console         # all console messages
```

**Additional passes** (run if the first pass surfaces something to drill into):

```bash
node "$SCRIPTS/cdp.mjs" get-network --type xhr
node "$SCRIPTS/cdp.mjs" get-network --type script
```

## Performance 📡 — thresholds

See [`references/cwv-thresholds.md`](references/cwv-thresholds.md) for complete
thresholds, resource budgets, and the Lighthouse-score → priority mapping. The
headline gates:

| Metric | Good | Poor | Priority |
|---|---|---|---|
| LCP | < 2500ms | > 4000ms | p0 |
| CLS | < 0.1 | > 0.25 | p1 |
| TTFB | < 800ms | > 1800ms | p1 |
| Total load | < 1500ms | > 5000ms | p0 |

Look for: slow resources, oversized images, waterfall bottlenecks, missing
caching, CORS errors, render-blocking scripts, broken resource URLs.

## Console 🖥️ — focus areas

Look for: JS errors, deprecated API warnings, CSP violations, failed resource
loads, unhandled rejections, compatibility warnings.

Priority: `console.error` = p1, `console.warn` = p2, deprecated API = p3.

## JavaScript ⚡ — focus areas

Look for: uncaught promise rejections, missing error handlers, blocking
operations, memory leaks, race conditions, deprecated APIs, failed dynamic
imports.

## Evidence discipline

Every finding must point at something you actually observed — a `get-performance`
metric value, a specific `get-network` request (URL + status + timing), or a
`get-console` message. **If you can't prove it, lower the confidence; never
fabricate.** A "page feels slow" hunch with no metric behind it is at most
confidence 3, not a p0.

When a finding needs a visual (a layout-shift culprit, a render-blocking flash),
capture it to **ephemeral `/tmp`** — `screenshot --output /tmp/perf-<page>-<step>.png`.
Never write screenshots or any audit artifact into a project-root `reports/` or
`tests/` directory; this skill produces findings, not committed files.

## Finding schema

Emit each finding as a structured object the architect can collate. Preserve
every field:

```yaml
- specialist: "Performance 📡"        # or "Console 🖥️" / "JavaScript ⚡"
  specialty: performance              # performance | console | javascript
  title: "LCP 6.2s — hero image is render-blocking"
  priority: p0                        # p0 (blocker) … p3 (minor) — see cwv-thresholds.md
  confidence: 9                       # 1–10; lower it when evidence is thin
  evidence: "get-performance: coreWebVitals.lcp=6210ms; get-network: /hero.png 1.8MB, blocking, 4.1s"
  suggested_fix: "Preload + responsively size the hero image; serve WebP; add fetchpriority=high."
  fix_prompt: "The LCP element is /hero.png (1.8MB PNG) loaded render-blocking. Add <link rel=preload as=image fetchpriority=high> for it, convert to WebP, and set explicit width/height to reserve layout space."
```

- **priority** — p0…p3, mapped from the thresholds in
  [`references/cwv-thresholds.md`](references/cwv-thresholds.md) (5xx → p0,
  poor CWV → p0–p1, 4xx / CORS / `console.error` → p1, warnings → p2, deprecated
  → p3).
- **confidence** — 1–10. Tie it to evidence strength: a measured CWV value or a
  concrete failed request earns 8–10; an inferred or intermittent issue earns
  less.
- **suggested_fix** — the human-readable remediation.
- **fix_prompt** — a self-contained prompt a dev agent could act on without
  re-running the audit.
- **specialist / specialty** — which of the three passes (and its icon) produced
  the finding, so the architect can group by lens.

## Output

Return the findings list to the `quality-architect`. Headline priority rules:
any 5xx = p0; any 4xx/5xx or `console.error` = p1; poor CWV = p0–p1. No findings
is a valid result — say so explicitly rather than padding with low-confidence noise.

## Reference files

- [`references/cwv-thresholds.md`](references/cwv-thresholds.md) — Core Web Vitals,
  resource budgets, Lighthouse-score and network-error priority mappings.

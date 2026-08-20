---
name: performance-audit
description: Performance, networking, console, and JavaScript analysis. Checks network issues, console errors, and JS problems; approximates load/resource health where full Core Web Vitals aren't available.
license: Apache-2.0
metadata:
  discoverable: false
  user-invocable: false
---

# Performance, Network & Console Analysis

Three analysis passes:
- **Performance 📡** — load/resource health, network issues
- **Console 🖥️** — runtime errors, warnings, CSP violations
- **JavaScript ⚡** — async issues, memory leaks, deprecated APIs

## Data Sources

**Performance** uses `browser_network_requests()`:
- Request/response status, resource types and (where reported) sizes
- 4xx/5xx requests, CORS failures, timeouts

**Console** uses `browser_console_messages(level:"error")` (also run with
`level:"warning"` for the Console pass).

**Limitation:** the factory's Playwright MCP toolset has no `browser_evaluate`,
so there is **no reliable way to read `performance.getEntriesByType` or compute
full Core Web Vitals (LCP, CLS, INP, FCP, TTFB)** in this environment. Do not
report specific CWV numbers or a Lighthouse-style score. Instead, approximate
load/resource health from `browser_network_requests()` (request count, resource
sizes where reported, error rate, obviously oversized responses) and from how
long the page visibly took to settle during Step-0 collection. Score confidence
low-to-medium (per the evidence rule in `audit-methodology.md`) for any
performance finding, and say explicitly that it is an approximation, not a
measured CWV metric.

## Performance 📡 — Approximate Thresholds

See `references/cwv-thresholds.md` for the full CWV/budget reference table (use
it for resource-size and network-error priority mapping; do not cite the CWV
rows as measured values — see Limitation above).

Look for: obviously slow/oversized resources, waterfall bottlenecks visible in
the network log, missing caching headers, CORS errors, render-blocking scripts,
broken resource URLs.

## Console 🖥️ — Focus Areas

Look for: JS errors, deprecated API warnings, CSP violations, failed resource loads,
unhandled rejections, compatibility warnings.

Priority: console.error = p1, console.warn = p2, deprecated API = p3.

## JavaScript ⚡ — Focus Areas

Look for: uncaught promise rejections, missing error handlers, blocking operations,
memory leaks, race conditions, deprecated APIs, failed dynamic imports.

## Output

Any 4xx/5xx = p1. Console errors = p1. Produce findings in the shared schema —
see the qa-auditor `audit-methodology.md`.

## Reference Files

- `references/cwv-thresholds.md` — Core Web Vitals and performance thresholds
  (reference table; CWV rows are not directly measurable in this environment —
  see Limitation above)

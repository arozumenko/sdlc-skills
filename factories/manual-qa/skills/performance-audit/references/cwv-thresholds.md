# Core Web Vitals & Performance Thresholds

## Core Web Vitals

| Metric | Good | Needs Improvement | Poor |
|---|---|---|---|
| LCP (Largest Contentful Paint) | < 2500ms | 2500-4000ms | > 4000ms |
| CLS (Cumulative Layout Shift) | < 0.1 | 0.1-0.25 | > 0.25 |
| INP (Interaction to Next Paint) | < 200ms | 200-500ms | > 500ms |
| FCP (First Contentful Paint) | < 1800ms | 1800-3000ms | > 3000ms |
| TTFB (Time to First Byte) | < 800ms | 800-1800ms | > 1800ms |

## Resource Size Budgets

| Resource type | Target | Warning | Priority if exceeded |
|---|---|---|---|
| Total page weight | < 1.5MB | 1.5-3MB | p1 if > 3MB |
| Largest image | < 200KB | 200-500KB | p2 if > 500KB |
| JavaScript total | < 300KB | 300-500KB | p1 if > 500KB |
| CSS total | < 100KB | 100-200KB | p2 if > 200KB |
| Web fonts | < 100KB | 100-250KB | p3 if > 250KB |

## Lighthouse Score → Priority

| Score | Rating | Priority |
|---|---|---|
| 0-49 | Poor | p0 |
| 50-74 | Needs Improvement | p1 |
| 75-89 | Good | p2 |
| 90-100 | Excellent | p3 |

## Network Error Priority

| Status | Priority |
|---|---|
| 5xx (server error) | p0 |
| 4xx (client error) | p1 |
| CORS error | p1 |
| Timeout | p1 |
| Mixed content blocked | p1 |

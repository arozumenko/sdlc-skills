# CDP Commands — Extended Reference

## Advanced Evaluate Patterns

### Check for JavaScript Errors

```bash
node cdp.mjs evaluate "(() => {
  const errors = [];
  window.onerror = (msg, src, line, col) => errors.push({ msg, src, line, col });
  return JSON.stringify(window.__cdpErrors || errors);
})()"
```

### Get Computed Styles

```bash
node cdp.mjs evaluate "(() => {
  const el = document.querySelector('.target');
  const styles = getComputedStyle(el);
  return JSON.stringify({
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    fontSize: styles.fontSize,
    fontWeight: styles.fontWeight,
    display: styles.display,
    position: styles.position,
    margin: styles.margin,
    padding: styles.padding,
    lineHeight: styles.lineHeight,
  });
})()"
```

### Check Responsive Layout

```bash
node cdp.mjs evaluate "(() => {
  const el = document.querySelector('.container');
  const rect = el?.getBoundingClientRect();
  return JSON.stringify({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    container: rect ? { width: rect.width, height: rect.height } : null,
    mediaQueries: {
      isMobile: window.matchMedia('(max-width: 768px)').matches,
      isTablet: window.matchMedia('(min-width: 769px) and (max-width: 1024px)').matches,
      isDesktop: window.matchMedia('(min-width: 1025px)').matches,
    }
  });
})()"
```

### Check React Presence

```bash
node cdp.mjs evaluate "(() => {
  const root = document.getElementById('root') || document.querySelector('[data-reactroot]');
  const fiberKey = Object.keys(root || {}).find(k => k.startsWith('__reactFiber'));
  return JSON.stringify({ react: !!fiberKey });
})()"
```

### Get All Links

```bash
node cdp.mjs evaluate "JSON.stringify(Array.from(document.links).map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 80), visible: a.offsetParent !== null })))"
```

---

## QA Audit Specialist Scripts

These evaluate snippets are designed to feed specific qa-audit specialist passes.

### Sophia & Mei — Accessibility DOM Audit

**Images missing alt text:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...document.querySelectorAll('img')]
    .filter(i => !i.getAttribute('alt') && i.getAttribute('alt') !== '')
    .map(i => ({ src: i.src.slice(-60), width: i.naturalWidth, height: i.naturalHeight }))
)"
```

**Form inputs without accessible labels:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...document.querySelectorAll('input, select, textarea')]
    .filter(el => {
      const id = el.id;
      const hasLabel = id && document.querySelector('label[for=\"' + id + '\"]');
      const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      const isHidden = el.type === 'hidden' || el.type === 'submit' || el.type === 'button';
      return !hasLabel && !hasAria && !isHidden;
    })
    .map(el => ({ tag: el.tagName, type: el.type, name: el.name, id: el.id }))
)"
```

**Empty links (no text, no aria-label):**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...document.querySelectorAll('a')]
    .filter(a => !a.textContent.trim() && !a.getAttribute('aria-label'))
    .map(a => ({ href: a.href, classes: a.className }))
)"
```

**Buttons without accessible names:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...document.querySelectorAll('button, [role=button]')]
    .filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'))
    .map(b => ({ classes: b.className, html: b.outerHTML.slice(0, 100) }))
)"
```

**Heading hierarchy:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .map(h => ({ level: parseInt(h.tagName[1]), text: h.textContent.trim().slice(0, 80) }))
)"
```

**Color contrast (text vs background) — sample top 10 text elements:**
```bash
node cdp.mjs evaluate "(() => {
  function luminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  function parseRgb(str) {
    const m = str.match(/\d+/g);
    return m ? [+m[0], +m[1], +m[2]] : null;
  }
  function contrast(c1, c2) {
    const [l1, l2] = [c1, c2].map(c => luminance(...c)).sort((a, b) => b - a);
    return (l1 + 0.05) / (l2 + 0.05);
  }
  const results = [];
  [...document.querySelectorAll('p, span, a, button, h1, h2, h3, li')]
    .slice(0, 15)
    .forEach(el => {
      const s = getComputedStyle(el);
      const fg = parseRgb(s.color);
      const bg = parseRgb(s.backgroundColor);
      if (!fg || !bg || bg[3] === 0) return;
      const ratio = contrast(fg, bg).toFixed(2);
      const text = el.textContent.trim().slice(0, 40);
      if (text) results.push({ tag: el.tagName, text, ratio, pass_AA: ratio >= 4.5, pass_AAA: ratio >= 7 });
    });
  return JSON.stringify(results);
})()"
```

**Focus order — tab through interactive elements:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...document.querySelectorAll('a, button, input, select, textarea, [tabindex]')]
    .filter(el => el.offsetParent !== null && el.tabIndex >= 0)
    .sort((a, b) => a.tabIndex - b.tabIndex || 0)
    .slice(0, 20)
    .map(el => ({ tag: el.tagName, text: (el.textContent || el.value || el.placeholder || '').trim().slice(0, 40), tabIndex: el.tabIndex }))
)"
```

**ARIA landmarks:**
```bash
node cdp.mjs evaluate "JSON.stringify({
  main: document.querySelectorAll('main, [role=main]').length,
  nav: document.querySelectorAll('nav, [role=navigation]').length,
  banner: document.querySelectorAll('header, [role=banner]').length,
  contentinfo: document.querySelectorAll('footer, [role=contentinfo]').length,
  search: document.querySelectorAll('[role=search]').length,
  complementary: document.querySelectorAll('aside, [role=complementary]').length,
})"
```

---

### Fatima — Privacy & Cookie Inspection

**All cookies:**
```bash
node cdp.mjs get-cookies
```

**localStorage contents:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  Object.fromEntries(
    Object.keys(localStorage).map(k => [k, localStorage.getItem(k)?.slice(0, 100)])
  )
)"
```

**sessionStorage contents:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  Object.fromEntries(
    Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)?.slice(0, 100)])
  )
)"
```

**All third-party scripts loaded:**
```bash
node cdp.mjs evaluate "(() => {
  const host = location.hostname;
  return JSON.stringify(
    [...document.querySelectorAll('script[src]')]
      .map(s => s.src)
      .filter(src => !src.includes(host))
  );
})()"
```

**Cookie consent banner present:**
```bash
node cdp.mjs evaluate "JSON.stringify({
  hasCookieBanner: !!document.querySelector(
    '[class*=cookie], [class*=consent], [id*=cookie], [id*=consent], ' +
    '[class*=gdpr], [id*=gdpr], [aria-label*=cookie i], [aria-label*=consent i]'
  ),
  hasAcceptButton: !!document.querySelector(
    '[class*=cookie] button, [class*=consent] button, ' +
    'button[id*=accept i], button[class*=accept i]'
  )
})"
```

**Meta pixel / tracking scripts:**
```bash
node cdp.mjs evaluate "JSON.stringify({
  googleAnalytics: !!(window.ga || window.gtag || window.dataLayer),
  metaPixel: !!(window.fbq || window._fbq),
  hotjar: !!window.hj,
  intercom: !!window.Intercom,
  segment: !!window.analytics,
  mixpanel: !!window.mixpanel,
})"
```

---

### Marcus — Network & Performance Audit

**Network requests summary:**
```bash
node cdp.mjs get-network
```

**Resource sizes and timing:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  [...performance.getEntriesByType('resource')]
    .map(r => ({
      name: r.name.split('/').pop().slice(0, 50),
      type: r.initiatorType,
      duration: Math.round(r.duration),
      size: Math.round(r.transferSize / 1024) + 'KB',
    }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 15)
)"
```

**Core Web Vitals from Performance API:**
```bash
node cdp.mjs evaluate "JSON.stringify({
  domContentLoaded: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart),
  loadComplete: Math.round(performance.timing.loadEventEnd - performance.timing.navigationStart),
  domInteractive: Math.round(performance.timing.domInteractive - performance.timing.navigationStart),
  resources: performance.getEntriesByType('resource').length,
})"
```

**Failed network requests:**
```bash
node cdp.mjs evaluate "JSON.stringify(
  window.__failedRequests || 'capture requires get-network after page load'
)"
# Or use get-network and filter status >= 400
```

---

### Diego — Console Audit

**Full console log:**
```bash
node cdp.mjs get-console
```

---

### Zanele — Mobile Emulation

**Switch to mobile, screenshot, switch back:**
```bash
node cdp.mjs emulate mobile
node cdp.mjs screenshot --output /tmp/mobile-view.png
node cdp.mjs evaluate "JSON.stringify({
  viewport: { w: window.innerWidth, h: window.innerHeight },
  isMobile: window.matchMedia('(max-width: 768px)').matches,
  touchTargets: [...document.querySelectorAll('a, button')]
    .map(el => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), tooSmall: r.width < 44 || r.height < 44 };
    })
    .filter(t => t.tooSmall)
    .slice(0, 10)
})"
node cdp.mjs emulate desktop
```

---

### Sophia/Mei — Axe-Core Accessibility Audit (preferred over manual DOM snippets)

**Full WCAG 2.x audit (returns violations JSON):**
```bash
node cdp.mjs inject-axe
```

**Scope to main content only:**
```bash
node cdp.mjs inject-axe --selector "main"
```

The result includes: `summary.violations` count, each violation's `id`, `impact` (critical/serious/moderate/minor), `description`, `helpUrl`, and up to 5 failing `nodes` with `html` and `failureSummary`. Use alongside the manual DOM snippets above for issues axe may miss (focus order, colour contrast at scale).

---

### Marcus — Performance Snapshot

**All timing + resource sizes + Core Web Vitals in one call:**
```bash
node cdp.mjs get-performance
```

Returns:
- `timing`: domContentLoaded, loadComplete, domInteractive, firstByte, dnsLookup, tcpConnect (all in ms)
- `coreWebVitals`: lcp (ms), fid (ms), cls (score) — null if not yet observed
- `resources.top20Slowest`: name, url, type, duration, sizeKB, cached

**Failed/error requests:**
```bash
node cdp.mjs get-network --status error
# Or specifically 4xx or 5xx:
node cdp.mjs get-network --status 4xx
node cdp.mjs get-network --status 5xx
```

**Filter by request type:**
```bash
node cdp.mjs get-network --type xhr
node cdp.mjs get-network --type fetch
node cdp.mjs get-network --type script
```

---

### Fatima — Privacy & Storage (simplified commands)

**localStorage + sessionStorage in one call:**
```bash
node cdp.mjs get-storage
```

Returns: `{ localStorage: { key: value_truncated_200 }, sessionStorage: { … } }`

---

### SEO & Meta Specialist — get-meta

**All meta tags, OG, Twitter cards, structured data:**
```bash
node cdp.mjs get-meta
```

Returns: `title`, `description`, `keywords`, `viewport`, `robots`, `canonical`, `og` (all og: properties), `twitter` (all twitter: properties), `structuredData` (parsed JSON-LD array).

---

## Multi-Tab Verification

```bash
node cdp.mjs new-tab "https://example.com/page-a"
node cdp.mjs new-tab "https://example.com/page-b"
node cdp.mjs list-targets
# Use --target <id> from list-targets output
node cdp.mjs screenshot --target <id-a> --output /tmp/page-a.png
node cdp.mjs screenshot --target <id-b> --output /tmp/page-b.png
```

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CDP_PORT` | `9222` | Chrome debugging port |
| `CDP_HOST` | `127.0.0.1` | Chrome debugging host |

---

## Troubleshooting

**Chrome won't start**
- Check if another debug instance is running: `lsof -i :9222`
- Kill stale: `bash chrome-launcher.sh stop`

**WebSocket connection failed**
- Verify Chrome is running: `bash chrome-launcher.sh status`
- Test endpoint: `curl http://127.0.0.1:9222/json/version`

**Screenshot is blank**
- Page may not have loaded; add `wait` for a key element first
- Check if page requires auth

**Element not found**
- Verify selector: `node cdp.mjs evaluate "!!document.querySelector('.my-el')"`
- Shadow DOM elements need `evaluate` with `shadowRoot` traversal
- Iframe contents are not directly accessible

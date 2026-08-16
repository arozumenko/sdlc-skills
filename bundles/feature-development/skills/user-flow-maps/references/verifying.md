# Verifying a flow map before you call it done

The renderer is deterministic, but a spec can still describe a flow badly, and
"it looked right in a screenshot" is not verification. Run this.

## First: rebuild and compare

Everything below measures the *rendered pages*. That only tells you about the
source if the pages were built from the current source. They may not have been —
a page is a build artifact, and the file on disk survives every later edit to
the spec it came from.

Do this before the audit, every time:

```bash
node scripts/build-flowmaps.mjs <spec.json> --out /tmp/rebuild
diff -rq <out-dir> /tmp/rebuild        # must print nothing (ignore .DS_Store)
```

Any difference means the committed pages are stale and the audit you are about
to run is measuring a fossil. Rebuild in place first, then audit.

This is not hypothetical. On this project four flow pages sat committed and
clean-looking while three substantive additions — a cross-cutting note, a
deep-link entry, an extra acceptance criterion — existed only in the markdown.
Nothing was missing and nothing looked wrong; the pages just answered an older
question. A working tree with no diff proves the *pages* are committed, never
that they are current.

## Serve the output

Pages are self-contained, so `file://` works for eyeballing — but the audit
below uses `fetch`, which needs an origin:

```bash
cd <out-dir> && python3 -m http.server 8733
```

## The audit

Open any generated page and run this in the console. It measures **rendered
geometry**, not intentions.

```js
const pages = ['hyp-001','hyp-002'];            // your slugs
const ov = (a,b) => !(a.x2<=b.x1||b.x2<=a.x1||a.y2<=b.y1||b.y2<=a.y1);
const out = [];
for (const pg of pages) {
  const t = await (await fetch(pg + '.html?v=' + Date.now())).text();
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-9999px;width:1400px;height:900px';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(t); f.contentDocument.close();
  await new Promise(r => setTimeout(r, 450));
  const D = f.contentDocument, cvEl = D.querySelector('.canvas');
  const cv = cvEl.getBoundingClientRect();
  const bx = e => { const b = e.getBoundingClientRect();
    return {x1:b.left-cv.left, y1:b.top-cv.top, x2:b.right-cv.left, y2:b.bottom-cv.top}; };
  // captions measured by text extent, not their padded box
  const caps = [...D.querySelectorAll('.n .cap')].map(c => {
    const r = D.createRange(); r.selectNodeContents(c);
    const b = r.getBoundingClientRect();
    return {x1:b.left-cv.left, y1:b.top-cv.top, x2:b.right-cv.left, y2:b.bottom-cv.top}; });
  const obst = [...D.querySelectorAll('.screen,.dia')].map(bx).concat(caps);
  const paths = [...D.querySelectorAll('svg.edges path[stroke]')];
  const pts = p => [...p.getAttribute('d').matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)]
    .map(m => ({x:+m[1], y:+m[2]}));
  const hb = (a,b,bb) => { for (let i=0;i<=60;i++){
    const x=a.x+(b.x-a.x)*i/60, y=a.y+(b.y-a.y)*i/60;
    if (x>bb.x1+3 && x<bb.x2-3 && y>bb.y1+3 && y<bb.y2-3) return true; } return false; };
  let cross = 0, bad = 0;
  paths.forEach(p => { const q = pts(p);
    if (/NaN|undefined|Infinity/.test(p.getAttribute('d'))) bad++;
    for (let i=0;i<q.length-1;i++) obst.forEach(o => { if (hb(q[i],q[i+1],o)) cross++; }); });
  const floats = [...D.querySelectorAll('.elabel,.endpill,.startpill')].map(bx);
  out.push({ pg,
    paths: paths.length,
    malformedPaths: bad,                                   // must be 0
    edgeCrossings: cross,                                  // must be 0
    labelOverlaps: floats.filter(e => obst.some(o => ov(e,o))).length,
    start: D.querySelectorAll('.startpill').length,         // must be 1
    ends:  D.querySelectorAll('.endpill').length,           // must be ≥1
    diamondOverflow: [...D.querySelectorAll('.dia')]
      .filter(d => d.querySelector('.q').scrollHeight > d.clientHeight*0.74).length,
    tableRows: D.querySelectorAll('tbody tr').length });
  f.remove();
}
console.table(out);
```

## What the numbers must say

| Metric | Required | If it fails |
|---|---|---|
| `malformedPaths` | 0 | A transition points at a target that isn't a node and isn't an exit token. Fix the spec. |
| `edgeCrossings` | 0 | A connector runs through a screen or a caption. This is a renderer bug — report it, don't nudge the spec. |
| `start` | 1 | The flow has no node `0`, or every node has an inbound edge. |
| `ends` | ≥ 1 | Nothing leaves the flow: no `handoff` node and no out-of-flow target. A flow with no exit is almost always incomplete. |
| `labelOverlaps` | 0, or explained | Decision labels wedged between two shapes may keep a small overlap; they render as opaque chips above the artwork. Two or three is tolerable — say so rather than claiming clean. |
| `diamondOverflow` | 0 | A decision question is too long for its diamond. Shorten the question; the full text stays in the tooltip and the table. |
| `tableRows` | = transitions + terminal nodes | The table is the authority. If it's short, transitions are missing from the spec. |

## Also check by eye

Numbers do not catch everything:

- **Does the story read left to right?** If ids were assigned carelessly the
  layout is valid but the narrative jumps around.
- **Does each End marker name a plausible destination?** A generic "exit"
  means the `keys` / `outs` maps didn't resolve it.
- **Both themes.** Toggle `document.documentElement.dataset.theme` between
  `light` and `dark`; every colour resolves through a token, so a failure here
  means a hard-coded value crept in.

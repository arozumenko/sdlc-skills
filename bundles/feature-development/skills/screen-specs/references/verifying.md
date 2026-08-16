# Verifying a screen-spec set

A mock that renders is not the same as a mock that is right. Run this before
calling the set done.

## First: rebuild and compare

The mock and the spec are generated from one source, so they cannot contradict
each other — but a *built page* can still contradict the spec it was built from,
because the page is a build artifact and the spec kept moving after it was
written.

Do this before the audit, every time:

```bash
node scripts/build-screens.mjs --system <design-system.json> \
  --specs <spec-dir> --out /tmp/rebuild --img ../assets/img/
diff -rq <out-dir> /tmp/rebuild        # must print nothing (ignore .DS_Store)
```

Non-empty output means the pages on disk are stale, and every number the audit
produces below describes an older version of the design. Rebuild in place, then
audit. "Cannot drift" is a property of the pipeline, not of the files — it holds
only for as long as someone keeps running it.

## Serve from the design root

Mocks reference seed images relatively (`../assets/img/…`), so serve the parent
of the output directory — not the output directory itself, or every image 404s
while looking fine on disk:

```bash
cd docs/design && python3 -m http.server 8735
# then open http://127.0.0.1:8735/html/index.html
```

## The audit

Run in the console on any page of the set:

```js
const pages = ['index','hyp-001','hyp-002'];        // your slugs
const out = [];
for (const pg of pages) {
  const t = await (await fetch(pg + '.html?v=' + Date.now())).text();
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-9999px;width:1400px;height:1000px';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(t); f.contentDocument.close();
  await new Promise(r => setTimeout(r, 800));           // let images settle
  const D = f.contentDocument, vw = D.documentElement.clientWidth;
  const devices = [...D.querySelectorAll('.device')];
  const imgs = [...D.querySelectorAll('.device img')];
  out.push({ pg,
    screens: D.querySelectorAll('section.screen').length,
    mocks: devices.length,
    emptyMocks: devices.filter(d => d.querySelector('.body').children.length === 0).length,
    overflowingMocks: devices.filter(d => { const b = d.querySelector('.body');
      return b && b.scrollHeight > b.clientHeight + 2; }).length,
    images: imgs.length,
    brokenImages: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
    pageOverflow: [...D.querySelectorAll('body *')].filter(e => {
      if (e.closest('.mocks') || e.closest('.tw')) return false;   // scroll on their own axis
      return e.getBoundingClientRect().right > vw + 2; }).length,
    acChips: D.querySelectorAll('.ac').length,
    notes: D.querySelectorAll('.note').length,
    // chrome: a mock without it reads as a wireframe, not a screen
    chrome: { status: D.querySelectorAll('.sbar').length,
              nav: D.querySelectorAll('.navb').length,
              actionbar: D.querySelectorAll('.actionbar').length,
              tabbar: D.querySelectorAll('.tabbar').length,
              sheet: D.querySelectorAll('.sheet').length,
              home: D.querySelectorAll('.homeind').length },
    // every device gets exactly one home indicator — any mismatch means a
    // class from the page chrome is colliding with a class from the mock
    homeMismatch: [...D.querySelectorAll('.device')]
      .filter(d => d.querySelectorAll('.homeind').length !== 1).length });
  f.remove();
}
console.table(out);
```

## What the numbers must say

| Metric | Required | If it fails |
|---|---|---|
| `emptyMocks` | 0 | A screen's regions all carry a `state` tag that matches no state name. Usually a naming mismatch — the renderer compares the leading token, so `list-mode` matches `list-mode (default)`, but `listMode` matches neither. |
| `overflowingMocks` | *(not a failure on its own)* | A long screen is **supposed** to run past the fold — the renderer fades the cut deliberately. Do not chase this to zero; you will only shorten screens that are honestly long. What matters is *what* got cut: see below. |
| `buriedMessage` | 0 | **The one that matters.** A `notice`, `error`, `banner` or `empty` region that renders entirely below the fold. The screen still lists it, so the spec reads as complete — but the mock communicates nothing, and neither would the app. |
| `brokenImages` | 0 | Wrong `--img` base, or serving from the output dir instead of its parent. Check one URL directly before assuming the spec is wrong. |
| `pageOverflow` | 0 | Something outside a scroll container is too wide. Mock strips and tables scroll on their own axis by design; nothing else should. |
| `images` | > 0 where the flow shows content | A flow whose screens present rooms, properties or bookings with zero images is a spec that forgot its content, not a renderer fault. |
| `acChips` | ≥ one per screen | A screen with no criteria has nothing to verify it against. |
| `chrome.status` / `chrome.home` | = number of mocks | Every mock carries a status bar and a home indicator. A shortfall means a presentation kind fell through the renderer's cases. |
| `chrome.nav` | = non-overlay mocks | Sheets and dialogs have no nav bar by design; push and root screens always do. |
| `homeMismatch` | 0 | A page-chrome class is colliding with a mock class. This exact bug once styled the nav's "Design system" link as a floating home indicator — count per device, not per page, or you will not catch it. |

## The buried-message check

Add this to the audit loop. It is the check that earns its keep: a screen whose
whole job is to say something, that never gets to say it.

```js
// inside the per-page loop, after the iframe settles
buried: [...D.querySelectorAll('.mockcase')].flatMap(mc => {
  const b = mc.querySelector('.device .body'); if (!b) return [];
  const bb = b.getBoundingClientRect();
  return [...b.children]
    .filter(c => /notice|banner|err|empty|warn|alert/i.test(c.className)
              && c.getBoundingClientRect().top >= bb.bottom - 4)
    .map(c => (mc.querySelector('.cap')||{}).textContent.trim().slice(0,30)
              + ' → ' + c.textContent.trim().slice(0,50));
}),
```

It returns candidates, not verdicts. Ask one question of each hit: **is the
buried region the thing this screen or state exists to say?**

- **Yes → defect.** Fix by **region order**, not by deleting content: put the
  message and its recovery controls above the descriptive filler.
- **No → fine.** A long screen legitimately has content below the fold. An empty
  state for the fourth shelf of a home screen is below the fold in the real app
  too; that is the design working, not failing.

There is a third case the check cannot resolve, and you should recognise it
rather than "fix" it: a **state** whose changed region is correctly placed
mid-screen — an inline validation error next to the stepper that triggered it.
The design is right; the *mock* simply cannot show it, because every mock renders
from the top of the screen and the renderer has no notion of scroll position.
Note it and move on. Shortening a real screen to make its mock look better makes
the design worse.

This is not hypothetical. On this project `S-002-2 "Not Available"` — a screen
whose stated purpose is *"tell the guest, clearly and before any add-to-cart
attempt, that this room type has zero availability"* — rendered its
unavailability message ninth, 173px below the fold, behind the room's
description and amenity list. The spec listed every region it should have. The
region list was not the problem; the **order** was, and no amount of reading the
JSON would have shown it. Only measuring the rendered geometry did.

Note the trap that hid it: a blunt "no mock may overflow" rule flagged 15 mocks,
14 of them innocent long screens, so the one that mattered read as more noise.
A check that cries wolf is how a real defect ships.

## Web-only checks

A `target: web` set needs everything above (rebuild-and-diff, the audit, the
buried-message check, both themes) plus these — mobile's frame has no
breakpoints, no keyboard focus rings baked in by default, and no style preset,
so these have no mobile analogue.

- **No sideways scroll, at each breakpoint.** Toggle Mobile-web / Tablet /
  Desktop and re-run the `pageOverflow` measurement (or eyeball it) at every
  one, not just the default (Desktop). A layout that's clean at 1280px and
  overflows at 400px is a real defect the default-breakpoint audit alone will
  never see, because the toggle rebuilds the mock rather than reflowing it.
- **`:focus-visible` is actually visible.** Tab through a built page's
  interactive regions by keyboard. Every one should show the 3px primary-color
  outline (`.webframe :focus-visible`). A region marked `interactive: true` in
  the spec but unreachable by Tab, or reachable but silent, is an a11y-floor
  regression, not a style nit.
- **`prefers-reduced-motion` is respected.** Flip the OS/browser
  reduced-motion setting (or `Rendering` → `Emulate CSS media feature
  prefers-reduced-motion` in devtools) and confirm transitions/animations stop
  — including the breakpoint toggle's own chrome swap.
- **The chosen style is actually applied — spot-check, don't assume.** Inspect
  one card or button and confirm `--shadow-1`/`--border-w`/`--radius-scale`
  match the `style` in `design-system.json` (`targets/web.md` has the value
  table). A build that silently fell back to `material` because `style` was
  misspelled looks fine at a glance and wrong on close reading.
- **Nav chrome matches `nav.kind`.** A `split` screen shows the sidebar at
  every breakpoint (it does not collapse to a hamburger — see
  `targets/web.md`); every other kind shows a top-nav bar at Tablet/Desktop
  and a hamburger strip at Mobile-web. A mismatch usually means the kind was
  misspelled or left off, and the renderer's `page` fallback silently
  absorbed it.

## Coverage runs in both directions

Node→screen is only half the check: a screen can also point at a node that was
retired, which passes silently because nothing is *missing* — something is
*stale*. See `coverage-both-ways.md` for both scripts. Run them after any pass
that edits a **flow map**, not just after editing screens; the orphan is created
by the flow edit.

## Also check by eye

- **Does each mock look like the screen it claims to be?** Regions render
  generically by type; a spec that picked the wrong type produces a plausible
  but wrong picture.
- **Are the states actually different?** If two state mocks look identical, the
  `changes` array probably didn't name its target region correctly.
- **Both themes.** Toggle `document.documentElement.dataset.theme` between
  `light` and `dark`. Every colour comes from a token, so a failure means a
  literal crept into a renderer.
- **Read the notes.** They are the honest part of the set — open questions,
  inferred criteria, grounding gaps. If a page has none across a whole flow,
  be suspicious that they were smoothed away rather than absent.

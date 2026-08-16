# Visual/screenshot-diff tool research (2025-2026)

Context: we already capture screenshots via a managed/connected browser. We only
need the diff half — compare a fresh screenshot against a committed baseline,
report a perceptual/pixel diff, and manage baselines. Browser-free tools are
strongly preferred; anything that bundles/drives its own headless browser is
noted as against-constraint.

## Group A — browser-free image-diff libraries/CLIs (the sweet spot)

| Tool | Install | License | Stars / maintenance | Algorithm | Baseline mgmt? |
|---|---|---|---|---|---|
| **pixelmatch** ([mapbox/pixelmatch](https://github.com/mapbox/pixelmatch)) | `npm i pixelmatch` | ISC | ~5.6-6.8k★, actively maintained — v7.2.0 released Apr 2026 | Naive per-pixel RGBA diff **with anti-aliased-pixel detection** and a perceptual (YIQ) color-distance threshold; not full SSIM | No — pure diff primitive, you write to two PNGs in/out yourself |
| **odiff / odiff-bin** ([dmtrKovalenko/odiff](https://github.com/dmtrKovalenko/odiff)) | `npm i odiff-bin` (Node binding over a native SIMD binary; also usable as standalone CLI/opam package) | MIT | ~3.2k★, active | Anti-aliasing-aware, uses YIQ NTSC perceptual color distance; SIMD-optimized, claims to be the fastest in class; supports PNG/JPEG/WebP/TIFF; can render diffs in-terminal (kitty protocol) | No — pure diff primitive |
| **looks-same** ([gemini-testing/looks-same](https://github.com/gemini-testing/looks-same)) | `npm i looks-same` | MIT | ~827★, actively maintained (Gemini Testing / testplane ecosystem) | Perceptual, based on human color-difference (ΔE) with tolerance; ignores anti-aliasing and text-caret blink by default (configurable to strict pixel mode) | No — pure diff primitive, but ships convenience helpers (`createDiff`) |
| **Resemble.js** ([rsmbl/Resemble.js](https://github.com/rsmbl/Resemble.js)) | `npm i resemblejs` | MIT | ~4.6k★ but the Node port (`node-resemble.js`) is explicitly **"LOOKING FOR MAINTAINER"** — maintenance risk | Per-pixel with ignore-antialiasing / ignore-colors / ignore-alpha modes | No — pure diff primitive |
| **ssim.js** ([obartra/ssim](https://github.com/obartra/ssim)) | `npm i ssim.js` | MIT | Smaller/niche project, low activity | True SSIM (structural similarity, Wang et al. 2004) — best for "does this look perceptually the same" scoring rather than pixel-location diffing | No — returns a similarity score/map, no diff image workflow |
| **dssim** ([kornelski/dssim](https://github.com/kornelski/dssim)) | `cargo install dssim` (Rust binary; also a Rust/C/WASM lib) | **Dual: AGPL or commercial** — note this is the one non-permissive option here | Multiscale SSIM (IW-SSIM) in L\*a\*b\* color space; considered one of the most human-perception-accurate metrics available | No — CLI outputs a similarity score, no baseline workflow | ~1.2k★, maintained |
| **ImageMagick `compare`** (`magick compare`) | `brew install imagemagick` / `apt install imagemagick` | ImageMagick License (permissive, Apache-2.0-style) | Extremely mature, ubiquitous, actively maintained | Multiple selectable metrics: AE (fuzz-aware pixel count), RMSE, PSNR, MAE, MSE, NCC, PHASH, **DSSIM** — flexible but no anti-aliasing-specific mode out of the box; needs `-fuzz` tuning to avoid AA false positives | No — pure diff primitive; produces a diff image + numeric metric |

## Group B — self-hosted visual-regression frameworks/dashboards (free & OSS)

| Tool | License | Drives its own headless browser? | Baseline mgmt | Notes |
|---|---|---|---|---|
| **reg-cli** ([reg-viz/reg-cli](https://github.com/reg-viz/reg-cli)) | MIT | **No** — pure image-set comparator; you point it at `actual/` vs `expected/` dirs | **Yes** — `actual`/`expected`/`diff` directory model, `-U` to promote actual→expected as new baseline, `-R` for an HTML report, JSON/JUnit XML output | ~418★. Recently rewritten with a Rust→WASM diff engine (1.1–2.9× faster), stays drop-in compatible with the old CLI flags and `reg.json` schema. This is the best browser-free "framework" match: it's essentially pixelmatch-class diffing + a baseline directory convention + report generation, and composes directly with an external screenshot source. |
| **reg-suit** ([reg-viz/reg-suit](https://github.com/reg-viz/reg-suit)) | MIT | No (uses reg-cli's engine under the hood) | Yes, plus pluggable storage backends (S3, GCS, local) for baseline sync across CI runs | Heavier — built for CI-to-CI baseline persistence via a plugin architecture. Worth considering only if we need remote baseline storage; reg-cli alone is simpler for a repo-committed-baseline workflow. |
| **jest-image-snapshot** ([americanexpress/jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot)) | MIT | No — it's just a Jest matcher; **but** it's typically paired with Puppeteer/Playwright by convention (not a hard dependency, just how it's usually used) | Yes — `toMatchImageSnapshot()` auto-creates `__image_snapshots__/`, supports `--updateSnapshot` to promote, `customSnapshotsDir`/`customDiffDir` | Uses pixelmatch or SSIM under the hood. Fine if we're already in a Jest test file and want the snapshot-testing ergonomic, but it's a test-framework matcher, not a standalone CLI — less natural fit for a skill that just needs "diff two PNGs and report." |
| **Lost Pixel (OSS/"custom shots" mode)** ([lost-pixel/lost-pixel](https://github.com/lost-pixel/lost-pixel)) | MIT | Optional — has a "Custom shots" mode that accepts pre-captured screenshot paths and skips its own browser automation, so it CAN be used browser-free | Yes — full baseline/approve workflow, `generateOnly`/`failOnDifference` flags for OSS mode | **Caution: the GitHub repo was archived on 2026-04-22** — the OSS engine is no longer maintained going forward (the company pivoted to the paid Lost Pixel Platform/cloud). Do not adopt for new work; existing pinned versions would still run but there's no upstream fix path. |

## Group C — popular tools to AVOID for this use case

- **BackstopJS** — bundles/drives Puppeteer (headless Chromium) itself to take its own screenshots; conflicts with "browser-free" requirement even though the diff step (resemblejs/pixelmatch) is fine in isolation.
- **Playwright `toHaveScreenshot()`** — screenshot capture and comparison are fused into the Playwright test runner; requires Playwright's own bundled browsers, can't easily be used as a bare diff primitive.
- **Loki** — spins up its own headless Chrome (or Docker container running one) to screenshot Storybook stories; same headless-browser coupling problem.
- **wraith** — Ruby tool that drives PhantomJS/Firefox/Chrome itself to capture screenshots before diffing.
- **Percy, Chromatic, Applitools Eyes** — all SaaS-tied (hosted comparison/dashboard service, paid tiers, cloud account required); violates the "no paid SaaS / no cloud account" constraint outright, regardless of any browser-free SDK mode they offer.

## Ranked recommendation

**Top pick: `odiff-bin`** (MIT, `npm install odiff-bin`) as the diff primitive. It's the fastest of the pure-diff options, has anti-aliasing-aware perceptual (YIQ) comparison built in — which matters for HTML mockups where font/edge rendering varies slightly across runs — has a clean Node API and CLI, and is actively maintained with no browser dependency at all. Pair it with a small script that manages a `baselines/` directory in the repo (copy-on-approve, like `-U` in reg-cli).

**Second pick / alternative: `reg-cli`** (MIT, `npm i -D reg-cli`) if we want the baseline-management and HTML-report layer for free instead of writing it ourselves. It is itself browser-free (operates purely on `actual/`/`expected/` image directories), already implements the exact baseline-promote workflow (`-U` flag) and produces a shareable HTML diff report — it just uses its own (WASM-based, pixelmatch-class) diff engine rather than odiff's, which is still anti-aliasing-tolerant and perceptually reasonable, if not quite as fast as odiff's SIMD engine.

If we want the absolute simplest, zero-npm-dependency footprint and are fine invoking a subprocess, ImageMagick's `magick compare -metric AE -fuzz 5%` is a viable fallback (system package, extremely mature, permissive license) but requires manual fuzz-factor tuning to avoid false positives on anti-aliased edges — odiff/looks-same handle that automatically and are the better default.

**Baseline management, one line:** neither odiff nor pixelmatch/looks-same manage baselines themselves — they're pure "two images in, diff image + score out" primitives — so baseline storage (a `baselines/<page>.png` convention in the repo) and the approve/promote step are logic the visual-testing skill owns; reg-cli is the one option here that gives that baseline/approve/report layer out of the box if we'd rather not write it.

## How this slots into the visual-testing skill

The skill's flow becomes: (1) open the HTML mockup in our existing managed/connected browser and capture a screenshot as today — no change; (2) if no baseline exists yet for that page, save the capture to `baselines/<name>.png` and mark it as a new baseline; (3) if a baseline exists, run `odiff-bin` (or `reg-cli` if we want its report/approve UX) comparing `baselines/<name>.png` against the fresh capture, producing a diff image and a mismatch count/percentage; (4) surface the diff percentage and diff image path in the skill's output, and provide an explicit "approve" action that overwrites the baseline with the new capture (the `-U`-style promote step) when a change is intentional. This keeps the browser and the diff tool fully decoupled — the diff tool only ever sees two PNG files on disk — and keeps baselines as plain committed image files in the repo, no external service or database required.

## Sources

- https://github.com/mapbox/pixelmatch
- https://www.npmjs.com/package/pixelmatch
- https://github.com/dmtrKovalenko/odiff
- https://github.com/dmtrKovalenko/odiff/blob/main/README.md
- https://github.com/gemini-testing/looks-same
- https://www.npmjs.com/package/looks-same
- https://github.com/rsmbl/Resemble.js
- https://github.com/lksv/node-resemble.js/
- https://github.com/obartra/ssim
- https://github.com/kornelski/dssim
- https://usage.imagemagick.org/compare/
- https://imagemagick.org/compare/
- https://imagemagick.org/license/
- https://github.com/reg-viz/reg-cli
- https://github.com/reg-viz/reg-suit
- https://www.npmjs.com/package/reg-cli
- https://github.com/americanexpress/jest-image-snapshot
- https://github.com/lost-pixel/lost-pixel
- https://www.lost-pixel.com/

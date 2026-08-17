# Designer-agent skill candidates: comparison

Researched 2026-08-17. Sources verified via GitHub REST API (`api.github.com/repos/...`) and
raw content (`raw.githubusercontent.com/.../README.md`, `.../SKILL.md`).

Context: candidate additions to a designer agent whose existing pipeline is
`user-flow-maps` (behaviour/journeys) → `screen-specs` (buildable, MD3-token-driven
mocks) → `visual-testing` (screenshot diff), plus Anthropic's `frontend-design`
plugin for aesthetic direction/taste.

---

## 1. `nextlevelbuilder/ui-ux-pro-max-skill`

**What it is.** A searchable design-intelligence database packaged as a Claude
Agent Skill plus a companion npm CLI (`ui-ux-pro-max-cli`). The core is a
Python search tool (`scripts/search.py`, no external deps) queried over a large
curated dataset: 79 UI style descriptors (50 active/29 supplemental/9
deprecated), 192 industry-specific reasoning rules, 192 color palettes tied to
product types, 74 Google-Fonts pairings, 119 UX guidelines, 105 icon
references, 17 GSAP animation presets, 25 chart types, across 22 tech stacks
(React, Vue, Svelte, SwiftUI, Flutter, etc.). The installed skill
(`.claude/skills/ui-ux-pro-max/SKILL.md`) documents a four-step workflow:
extract product signals → generate a persisted `MASTER.md` design system (+
optional per-page overrides) → targeted domain searches (accessibility,
typography, color, animation, forms, navigation, charts) → stack-specific
implementation guidance. It ships `data/`, `references/` (quick-reference.md,
pro-rules.md), and `scripts/` subdirectories — a real, queryable knowledge
base, not just prose. A premium (paid) tier adds brand identity/logo/asset
generation on top of the open-source base.

**Category.** Component-library / design-system knowledge, blended with UX
heuristics (its "Rule Categories by Priority" table covers accessibility,
touch targets, performance, layout, typography, forms, navigation, charts) and
a thin layer of aesthetic-direction (79 named styles + palettes + font
pairings). It is a generalist grab-bag more than any one category.

**Quality signals.** MIT license (open-source core). ~116.9k GitHub stars,
81 open issues, created 2025-11-30, last push 2026-08-13 (actively maintained,
uses semantic-release + Conventional Commits). Structured properly as a Claude
Agent Skill (`SKILL.md` with frontmatter, `skill.json` at v2.13.0, plus
`design-system`, `brand`, `ui-styling`, `banner-design`, `slides` sibling
skills). Content is substantial — this is a real curated dataset with a search
tool, not a thin README. Author credibility: unverified individual/small org
("Next Level Builder"), not an established design-tooling brand; the
premium-upsell model (open core + paid brand/logo tier) is a commercial
product, which should factor into trust/longevity judgments even though the
repo itself is healthy.

**Overlap vs complement.** Heavy overlap with `screen-specs`: both aim at
"buildable" design-system output (`MASTER.md`/page overrides is functionally
the same job as `screen-specs`' design-system.json + token-driven mocks), and
its accessibility/touch-target/forms rules duplicate what a solid screen-specs
skill should already encode. It also overlaps with `frontend-design`'s job
(style/palette/font selection) but takes a "pick from a catalog" approach
(79 styles, 192 palettes) rather than `frontend-design`'s "derive something
non-templated" approach — these are somewhat philosophically opposed
(catalog-driven vs. bespoke-driven). The one genuinely new slice is the
domain-specific UX guideline corpus (119 guidelines) and multi-stack
implementation notes (22 stacks) if the designer agent needs stack-specific
build guidance `screen-specs` doesn't cover.

**Portability.** Self-contained prose + a dependency-free Python 3 script
(`search.py`) — reasonably portable, installable via the standard skill copy
mechanism or its own CLI (`npx ui-ux-pro-max-cli init`). No paid-service
runtime dependency for the open core; the premium tier requires their hosted
service.

Sources verified: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill ,
https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/README.md ,
https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/skill.json ,
https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/.claude/skills/ui-ux-pro-max/SKILL.md ,
https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill

---

## 2. `Leonxlnx/taste-skill`

**What it is.** Not one skill but a family of ten portable `SKILL.md`
"implementation" skills plus three image-generation-only skills, installed
individually via `npx skills add` (the Vercel Labs `agent-skills` CLI
convention). The flagship (`skills/taste-skill`, install name
`design-taste-frontend`, currently a v2 rewrite) is a genuinely dense
anti-slop rulebook for AI-generated frontends: three tunable 1–10 "dials"
(DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY), a design-system-selection
step (pick one of Fluent/Carbon/Material/Polaris/shadcn-ui rather than
inventing custom CSS), canonical Motion/GSAP code skeletons, a redesign-audit
protocol, and an exhaustive "AI tells" forbidden-pattern list (banned default
fonts, an absolute em-dash ban, banned default color palettes, logo-wall/CTA
rules, real-image requirements) enforced by a ~70-point mechanical pre-flight
checklist. Sibling skills narrow this further: `soft-skill` (calm/premium),
`minimalist-skill`, `brutalist-skill`, `redesign-skill`, `gpt-tasteskill`
(GPT/Codex-tuned variant), `output-skill` (anti-truncation), `stitch-skill`
(Google Stitch export format), plus `imagegen-*`/`brandkit` skills that
produce reference images only (no code).

**Category.** Aesthetic-direction/taste, squarely — this is the closest
direct analog to Anthropic's `frontend-design` plugin, just far more
opinionated/mechanical and React/Tailwind-specific.

**Quality signals.** MIT license. ~77.2k GitHub stars, 54 open issues, created
2026-02-19, last push 2026-07-23 (recently active; has a CHANGELOG tracking a
v1→v2 rewrite, plus paid sponsors — Vercel OSS program, IMG.LY, animations.dev
— which is a decent credibility signal). Structured correctly as Agent Skills
(real `SKILL.md` with `name`/`description` frontmatter per sub-skill,
installable one-at-a-time by install name). Content is substantial and
opinionated, not a thin wrapper — the pre-flight checklist and "AI tells" list
in particular read as hard-won, specific rules rather than generic advice.
Caveat: heavily React + Tailwind v4 + Motion/GSAP + Phosphor-icons coded by
default (Appendix A/B give alternate design-system install commands, but the
core engineering rules assume a JS/React stack).

**Overlap vs complement.** Directly competes with / could replace or
supplement `frontend-design` for taste-and-non-templated-ness — arguably more
rigorous (dial-based tuning, mechanical checklist, explicit banned-pattern
list) than a prose-only taste guide. It does not touch `screen-specs`'
buildable-spec/device-frame/MD3-token job, and it doesn't touch
`user-flow-maps` at all. The redesign-audit protocol and "AI tells" checklist
are the genuinely new capability: a mechanical, checkable anti-slop QA pass
that neither `frontend-design` nor `screen-specs` currently provide. Because
it's decomposed into narrow single-purpose skills, only the relevant slice
(e.g. just `redesign-skill` or just the anti-slop checklist portion) could be
adopted without pulling in the GSAP/motion-heavy implementation rules.

**Portability.** Self-contained Markdown, no scripts required — but content
is stack-opinionated (React/Tailwind/Motion by default) even though Appendix B
lists alternate systems. No paid service dependency; the image-generation
skills expect pairing with an external image generator (ChatGPT Images or
similar), which is optional and outside the code skills.

Sources verified: https://github.com/Leonxlnx/taste-skill ,
https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/README.md ,
https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md ,
https://api.github.com/repos/Leonxlnx/taste-skill

---

## 3. `pbakaus/impeccable`

**What it is.** The most heavyweight of the three: "1 skill, 23 commands,
live browser iteration, and 59 deterministic detector rules for AI-generated
frontend design," by Paul Bakaus (ex-Google, a recognizable name in web/design
tooling circles). Structurally it's a single `SKILL.md` (built from
`skill/SKILL.src.md`, 11.3KB) that routes to 43 separate reference playbooks
under `skill/reference/` (`critique.md` 45KB, `new-work.md` 46KB, `live.md`
36KB, `document.md` 27KB, plus focused files per command: `audit`, `polish`,
`animate`, `colorize`, `typeset`, `harden`, `optimize`, `adapt`,
`ios`/`android` variants, etc.) — genuinely deep, not templated boilerplate.
Behind the prose sits real tooling: `skill/scripts/` has ~40 Node scripts
(`detect.mjs`, `palette.mjs`, `context-signals.mjs`, a whole `live-*.mjs`
family for live-browser DOM injection/screenshot/session management via
`modern-screenshot.umd.js`, plus `agents/` and `lib/`), and a standalone CLI
(`npx impeccable detect`) that runs the 59 deterministic (non-LLM) anti-pattern
detectors — e.g. flags "Inter for everything," purple-to-blue gradients, cards
nested in cards — outputting JSON for CI. Commands span critique/audit
(evaluate), polish/harden/optimize (refine), animate/colorize/typeset
(enhance), and a `craft`/`init` onboarding flow that persists project context
into `PRODUCT.md`/`DESIGN.md`/`design.json`.

**Category.** Primarily UX heuristics/critique + a genuinely distinct
category the other two lack: automated, deterministic anti-pattern
*detection* (static analysis of rendered UI, not LLM judgment). Also carries
aesthetic-direction content (colorize/typeset/animate playbooks) and some
accessibility coverage, making it the broadest of the three in scope.

**Quality signals.** Apache 2.0 license. ~59.7k GitHub stars (~3.2k forks,
~40 contributors per public star-history data), 51 open issues, created
2025-11-16, last push 2026-08-17 (actively maintained, essentially daily-fresh
at time of research). Author is a named, credible figure (Paul Bakaus,
ex-Google Web/PageSpeed-adjacent background) rather than an anonymous handle —
the strongest author-credibility signal of the three. Structured correctly as
an Agent Skill (`SKILL.md` frontmatter with `name`, `description`,
`argument-hint`, `allowed-tools`, `license`) and additionally ships a real CLI,
plugin manifests for Claude Code and Grok Build, and 13+ tool-specific install
paths (Cursor, Copilot, Gemini CLI, OpenCode, Pi, Kiro, Trae, etc.). By far
the deepest and most substantively engineered of the three candidates.

**Overlap vs complement.** Least overlapping with `frontend-design` — it's
detector/critique-first rather than taste-generation-first, so it's more a
complement (QA layer) than a competitor. It overlaps somewhat with
`visual-testing` in spirit (both evaluate an already-rendered UI) but via a
different mechanism: deterministic anti-pattern detection over DOM/CSS rather
than visual baseline diffing — these are complementary, not duplicative
(`visual-testing` catches regressions against a baseline; impeccable's
detectors catch generic "AI slop" patterns even in a first pass with no
baseline). Its `live.md`/live-browser-iteration commands (inject, poll,
resume, wrap edits back into source) are a genuinely new capability not
present anywhere in the existing pipeline: interactive live-DOM iteration
against a running browser session. Some overlap with `screen-specs` on
design-token bookkeeping (`design.json`, MD3-adjacent theming rules) but its
strength is critique/audit, not spec generation.

**Portability.** Self-contained Markdown + Node scripts (`.mjs`), installable
five ways (CLI installer, git submodule, plugin marketplace, website
download, or direct copy) across 13+ AI coding tools. The `detect` CLI and
live-browser features require Node.js and a real browser/DOM runtime
(scripts reference Puppeteer/CDP-style screenshotting) — heavier runtime
footprint than the other two, which are closer to pure-prose skills. No paid
service dependency; it's genuinely open source (Apache 2.0) end to end.

Sources verified: https://github.com/pbakaus/impeccable ,
https://raw.githubusercontent.com/pbakaus/impeccable/main/README.md ,
https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/SKILL.src.md ,
https://api.github.com/repos/pbakaus/impeccable

---

## Ranking

| Repo | Verdict | One-line reason |
|---|---|---|
| **pbakaus/impeccable** | **strong** | Deepest, most substantive content (43 reference playbooks, 59 deterministic detectors, real CLI/scripts), credible maintainer, complements rather than duplicates the existing pipeline (adds critique/detection + live-iteration, neither of which exists today). |
| **Leonxlnx/taste-skill** | **maybe** | Genuinely rigorous anti-slop/taste rulebook that could sharpen or replace `frontend-design`'s aesthetic-direction step, but it's React/Tailwind/Motion-opinionated and its buildable-output ambitions overlap `screen-specs`; adopt narrowly (the checklist/redesign-audit slice) rather than wholesale. |
| **nextlevelbuilder/ui-ux-pro-max-skill** | **maybe/skip** | Large, well-structured dataset, but its core "generate a design system from a catalog" workflow duplicates `screen-specs` almost one-to-one, it's a commercial open-core product (paid upsell tier), and author credibility is unverified — only the UX-guideline/multi-stack corpus adds anything not already covered. |

---

## Borrowed ideas (from the skips) — 2026-08-17

We skip `taste-skill` and `ui-ux-pro-max` as skills, but mine them for ideas:

| Idea (source) | Target | Status |
|---|---|---|
| Tunable **density** knob (taste-skill dials) → `density: compact\|comfortable\|spacious` scaling spacing (screen-specs) | screen-specs | **Blocked on a refactor** — see below |
| Per-page/per-screen **overrides** (ui-ux-pro-max MASTER.md + page overrides) | screen-specs | **Planned** — validates the deferred per-screen target/style override; needs per-screen token scoping |
| **Multi-stack implementation notes** (ui-ux-pro-max 22 stacks) → generalize screen-specs' swiftui-only hints to per-stack (Compose/React/Flutter) | screen-specs | Nice-to-have |
| **"AI tells" anti-slop list** (taste-skill) | — | **Covered better by impeccable** (deterministic detectors); don't rebuild |
| **redesign-audit protocol** (taste-skill) | — | Covered by impeccable's `audit`/`critique` |
| **Dependency-free `search.py` over a curated dataset** (ui-ux-pro-max) — query, don't preload | future reference-heavy skills | Meta-pattern to keep in mind |

**Architectural reality for density + per-screen override:** the screen-specs renderer's
spacing is hardcoded (~373 px literals, only 3 `var(--space*)` uses), and design tokens are
emitted once per page in a single `<style>` block. So:
- **density** only becomes real after the renderer's spacing is made token-driven (a sizable,
  golden-risk refactor — same class as the deferred mobile-styling work).
- **per-screen style/density override** needs per-screen token scoping (per-screen `:root`-like
  scopes) rather than one page-global block. Per-screen *device/target* is more tractable.
Recommendation: do the token-driven-spacing refactor as its own scoped effort, then density +
per-screen overrides land cheaply on top. Don't half-build them against hardcoded CSS.

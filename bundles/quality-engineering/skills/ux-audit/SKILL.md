---
name: ux-audit
description: Use when auditing UI/UX, form usability, error messaging, or page-type-specific patterns (landing, checkout, signup, search, and similar) on a web page.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# UI/UX & Page-Type Analysis

This skill is **agent-orchestrated** — the `quality-architect` agent loads it as one
audit pass among several (accessibility, security, privacy, performance, responsive,
content/SEO, UX). It is not a standalone user command; it runs inside a larger quality
audit and contributes findings in the shared schema below.

Core pass:
- **UI/UX 🎨** — General UI patterns, forms, layout, navigation

Supporting passes (when detected):
- **GenAI 🤖** — AI/chatbot elements
- **Error Messages ⚠️** — Error states and messaging
- **Page-type checks** — domain-specific UX (see `references/page-types.md`)

## Context to read first

Before auditing, load the project's quality context:

- `.agents/profile.md` (§ Project systems) — what the product is, its surfaces, the
  base URL and sample users.
- `.agents/testing.md` — test conventions, environments, known UX constraints.
- The role's injected memory at `.agents/memory/<role>/project_briefing.md` —
  accumulated UX gotchas and prior findings for this product.
- `.agents/quality.md` if present (seeding writes it; optional) — the per-product
  quality profile, including any product-specific UX bar or page-type expectations.

Missing files are tolerated — note the gap and proceed against general heuristics.
Don't fabricate product-specific expectations you can't source.

## Driving the page — browser-verify (CDP)

All inspection runs through this repo's [`browser-verify`](../browser-verify/SKILL.md)
skill over the Chrome DevTools Protocol. **Read that SKILL.md first** for the script
paths and full command list. Step-0 commands you'll lean on for a UX pass:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless

node "$SCRIPTS/cdp.mjs" navigate "<page-url>"
node "$SCRIPTS/cdp.mjs" get-meta          # title / OG / structured data — confirm page type
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-ux-overview.png
node "$SCRIPTS/cdp.mjs" query-all "form input, button, a"   # enumerate interactive elements
node "$SCRIPTS/cdp.mjs" get-styles ".btn-primary" --props "color,backgroundColor,fontSize"
node "$SCRIPTS/cdp.mjs" emulate mobile    # re-check layout / CTA hierarchy on small screens
node "$SCRIPTS/cdp.mjs" get-console       # surface JS errors behind broken interactions
node "$SCRIPTS/cdp.mjs" get-network --status error   # broken images / failed form posts

bash "$SCRIPTS/chrome-launcher.sh" stop
```

Screenshots and any captured evidence go to **ephemeral `/tmp`** (e.g.
`/tmp/audit-ux-<step>.png`, `/tmp/audit-checkout-validation.png`). Never write to a
project-root `reports/` or `tests/` directory — this audit produces findings, not
artifacts checked into the tree.

## UI/UX 🎨 — Focus Areas

- Unclear CTA hierarchy (which button is primary?)
- Inconsistent spacing/alignment
- Illegible typography
- Form fields without labels/placeholders
- No inline validation
- Confusing navigation
- Broken layouts (overlapping, broken grid)
- Missing empty states
- Overwhelming information density
- Unclear affordances (clickable or not?)

### Form Checks

- Labels associated with inputs
- Required fields marked
- Inline error messages
- Success state after submission
- Tab order matches visual order
- Appropriate input types (email, tel, number)

Drive forms with real input events (`type`, `click`, `press`) so client-side
validation actually fires, then read `get-console` and `get-network --status error`
to confirm whether submission worked. Capture before/after screenshots to `/tmp`.

## GenAI 🤖

Only when AI elements detected: chatbot failures, loading states, prompt injection
risks, missing escalation, no AI disclaimer, broken quick-replies.

## Error Messages ⚠️

Only when error states visible: generic messages, exposed stack traces, missing
retry mechanisms, no recovery path.

## Page-Type Checks

When the page matches a specific page type, read `references/page-types.md` for
targeted domain-specific checks. Confirm the page type from `get-meta` output
(title, OG type, structured data) plus the visible layout — don't guess from the URL
alone.

## Finding schema

Every finding emits the shared audit schema. Don't deviate — the orchestrator merges
findings across passes by these fields:

```yaml
- priority: p0          # p0 (blocker) | p1 (major) | p2 (minor) | p3 (polish)
  confidence: 8         # 1–10 — how certain you are the finding is real
  specialist:           # the pass that produced it
    icon: "🎨"
    specialty: "UI/UX"
  finding: "Primary CTA and secondary action are visually identical on /checkout"
  evidence: "/tmp/audit-checkout-cta.png — both buttons #2b6cb0, same weight"
  suggested_fix: "Make the primary CTA solid-filled; demote secondary to outline."
  fix_prompt: "On the checkout page, set the 'Place order' button to the solid
    primary style and the 'Continue shopping' button to the outline/secondary
    style so the primary action is unambiguous."
```

Specialist icons/specialties for this skill's passes: UI/UX 🎨, GenAI 🤖,
Error Messages ⚠️, plus the page-type icon from `references/page-types.md` when a
page-type check fires (e.g. Checkout 💳, Signup 📝).

## Evidence discipline

**If you can't prove it, lower the confidence; never fabricate.** Every finding must
point at concrete evidence — a `/tmp` screenshot, a `get-styles`/`query-all`/`get-console`
output line, a network failure. A claim you couldn't reproduce or capture is a
low-confidence (≤4) hypothesis at best, flagged as such — not a p0. Prefer fewer,
well-evidenced findings over a long list of speculation.

## Reference Files

- `references/page-types.md` — page-type specific focus areas (20+ types).

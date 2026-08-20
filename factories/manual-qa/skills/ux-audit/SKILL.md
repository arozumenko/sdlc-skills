---
name: ux-audit
description: UI/UX, forms, and page-type analysis. Checks general UI patterns, form usability, and domain-specific UX for 20+ page types.
license: Apache-2.0
metadata:
  discoverable: false
  user-invocable: false
---

# UI/UX & Page-Type Analysis

Core pass:
- **UI/UX 🎨** — General UI patterns, forms, layout, navigation

Supporting passes (when detected):
- **GenAI 🤖** — AI/chatbot elements
- **Error Messages ⚠️** — Error states and messaging
- **Page-type checks** — domain-specific UX (see `references/page-types.md`)

## Data Sources

**`browser_snapshot()`** — accessible names/roles/structure: CTA hierarchy,
form labels, tab order, navigation structure.

**`browser_take_screenshot()`** — visual layout, spacing/alignment, typography
legibility, information density, and anything the accessibility tree can't
show.

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

## GenAI 🤖

Only when AI elements detected: chatbot failures, loading states, prompt injection
risks, missing escalation, no AI disclaimer, broken quick-replies.

## Error Messages ⚠️

Only when error states visible: generic messages, exposed stack traces, missing
retry mechanisms, no recovery path.

## Page-Type Checks

When the screenshot matches a specific page type, read `references/page-types.md`
for targeted domain-specific checks.

## Output

Produce findings in the shared schema — see the qa-auditor `audit-methodology.md`.

## Reference Files

- `references/page-types.md` — page-type specific focus areas

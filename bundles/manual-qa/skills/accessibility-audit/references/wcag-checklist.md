# WCAG 2.1 Checklist — Priority Mapping

## Level A (Must fix — p0)

| Criterion | Title | What to check |
|---|---|---|
| 1.1.1 | Non-text Content | Images have alt text, decorative images have empty alt |
| 1.2.1 | Audio/Video (prerecorded) | Captions or transcripts provided |
| 1.3.1 | Info and Relationships | Headings use proper h1-h6, forms have labels, tables have headers |
| 1.3.2 | Meaningful Sequence | Reading order matches visual order |
| 1.3.3 | Sensory Characteristics | Instructions don't rely solely on shape/color/sound |
| 2.1.1 | Keyboard | All functionality available via keyboard |
| 2.1.2 | No Keyboard Trap | Focus can always move away from any element |
| 2.4.1 | Bypass Blocks | Skip navigation link or landmark roles |
| 2.4.2 | Page Titled | Descriptive page title |
| 2.4.4 | Link Purpose | Link text describes destination (not "click here") |
| 3.1.1 | Language of Page | `lang` attribute on html element |
| 3.3.1 | Error Identification | Form errors clearly identified |
| 3.3.2 | Labels or Instructions | Form fields have visible labels |
| 4.1.1 | Parsing | Valid HTML, no duplicate IDs |
| 4.1.2 | Name, Role, Value | Custom widgets have proper ARIA |

## Level AA (Should fix — p1)

| Criterion | Title | What to check |
|---|---|---|
| 1.4.3 | Contrast (Minimum) | Text contrast ratio >= 4.5:1 (normal), >= 3:1 (large) |
| 1.4.4 | Resize Text | Page usable at 200% zoom |
| 1.4.5 | Images of Text | Real text preferred over images of text |
| 1.4.11 | Non-text Contrast | UI components and graphics >= 3:1 contrast |
| 2.4.5 | Multiple Ways | Multiple ways to find pages (nav, search, sitemap) |
| 2.4.6 | Headings and Labels | Descriptive headings and labels |
| 2.4.7 | Focus Visible | Keyboard focus indicator clearly visible |
| 3.2.3 | Consistent Navigation | Navigation consistent across pages |
| 3.2.4 | Consistent Identification | Same function = same label across pages |
| 3.3.3 | Error Suggestion | Suggestions for fixing errors when known |
| 3.3.4 | Error Prevention (Legal/Financial) | Submissions reversible, checked, or confirmed |

## Level AAA (Nice to fix — p3)

| Criterion | Title | What to check |
|---|---|---|
| 1.4.6 | Enhanced Contrast | Text contrast ratio >= 7:1 |
| 1.4.8 | Visual Presentation | Line length < 80 chars, no justified text |
| 2.4.10 | Section Headings | Content organized with headings |
| 2.5.5 | Target Size | Touch targets >= 44x44 CSS pixels |

## axe-core Impact → Priority Mapping

| axe impact | Priority |
|---|---|
| critical | p0 |
| serious | p1 |
| moderate | p1 |
| minor | p3 |

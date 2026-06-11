---
name: playwright-testing
description: Use when a manual-QA agent does live browser testing through the Playwright MCP server — exploring/profiling a web app or executing a web test case against a running app, with no test code generated. Web/PWA/hybrid targets; used by app-profiler and test-runner. Mobile native → use mobile-testing instead.
license: Apache-2.0
compatibility: Requires Node.js 18+. Playwright MCP server (@playwright/mcp) installed via setup.yaml.
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.3.0"
---

# Playwright Testing (live, via MCP)

Live browser testing for the manual-QA team. You drive a **real browser through
the Playwright MCP server** (`@playwright/mcp`) to explore a web app or execute a
test case step-by-step against a running app. **You never write or run Playwright
test code** — no Page Object Model, no pytest, no `.spec.ts` files. The output is
a verdict plus evidence, not a test suite.

> Writing actual Playwright test code is `test-automation-engineer`'s job (a
> different bundle's copy of this skill). Here, the browser is your hands.

## When to use

- **`app-profiler`** — explore a running web app: map key flows, capture
  reliable selectors and fragile areas into `app_profile.md`.
- **`test-runner`** — execute one web `TC-NNN` case live: run each step, verify,
  collect evidence, return a structured result.
- **Web / PWA / hybrid only.** Native iOS/Android → use the `mobile-testing`
  skill. (PWA/hybrid with a mobile viewport is still this skill.)

## Core loop — snapshot first

The Playwright MCP exposes `browser_*` tools. The loop for every check:

1. **`browser_navigate(url)`** — go to `{{base_url}}/path` (substitute `base_url`
   from the run prompt). Navigation auto-waits for load.
2. **`browser_snapshot()`** — the accessibility snapshot gives each element a
   `target` **ref** plus its role and accessible name. You need the ref before
   you can act, and role/name is what you assert on.
3. **Act** by passing that ref as `target` (plus a short human-readable
   `element` description): `browser_click`, `browser_type`, `browser_fill_form`,
   `browser_select_option`, `browser_press_key`, `browser_hover`.
4. **`browser_wait_for({text})`** / **`({textGone})`** — wait for the expected
   text to appear, or a spinner/loader text to disappear, before continuing.
5. **`browser_snapshot()` again**, then collect evidence:
   `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`.

**Refs go stale.** Every `target` ref comes from the *latest* snapshot — after
any navigation or DOM change, re-`browser_snapshot` before acting again. The
server is versioned; this skill is written against the `browser_*` toolset and
parameter names can shift between `@playwright/mcp` releases.

## MCP tool quick reference

| Tool | Key params (`*` = required) | Use |
|---|---|---|
| `browser_navigate` | `url*` | Go to a URL |
| `browser_snapshot` | — | Accessibility snapshot → element refs (`target`) + roles/names |
| `browser_click` | `element, target*, doubleClick, button` | Click an element |
| `browser_type` | `element, target*, text*, submit, slowly` | Type into one field (`submit:true` presses Enter after) |
| `browser_fill_form` | `fields*` | Fill many fields in one call (see below) |
| `browser_select_option` | `element, target*, values*` | Pick option(s) in a native `<select>` |
| `browser_press_key` | `key*` | Press a key (`Enter`, `Escape`, `ArrowDown`, `a`) |
| `browser_hover` | `element, target*` | Hover |
| `browser_wait_for` | `text` / `textGone` / `time` | Wait for text to appear / disappear / N seconds |
| `browser_take_screenshot` | `type*` (png\|jpeg), `filename`, `fullPage` | Capture evidence |
| `browser_console_messages` | `level*` (error\|warning\|info\|debug) | Read console (use `level:"error"`) |
| `browser_network_requests` | `static*`, `filter` | List network calls |
| `browser_handle_dialog` | `accept*, promptText` | Accept/dismiss a native JS dialog/alert |
| `browser_file_upload` | `paths` | Upload file(s) into a file chooser |
| `browser_navigate_back` · `browser_tabs` · `browser_resize` | — | Back · tab mgmt · viewport |

`target*` is the **ref from the latest `browser_snapshot`** (a unique CSS
selector also works); always pass `element` too — a short description of what
you're acting on.

## `{{base_url}}` rule

All test-case URLs are written `{{base_url}}/path`. Substitute the real base URL
from the run prompt into the `browser_navigate(url)` call at execution time —
this keeps cases environment-agnostic across dev / staging / prod.

## Filling a form (one call)

`browser_fill_form` fills every field in a single call. Each field is
`{element, target, name, type, value}`, where `type` ∈
`textbox | checkbox | radio | combobox | slider` (checkbox/radio `value` is
`"true"`/`"false"`; combobox `value` is the option text):

```
browser_snapshot()                       # get refs first
browser_fill_form(fields=[
  {element:"Email field",    target:"<ref>", name:"Email",    type:"textbox",  value:"qa@example.com"},
  {element:"Password field", target:"<ref>", name:"Password", type:"textbox",  value:"Passw0rd!"},
  {element:"Remember me",    target:"<ref>", name:"Remember", type:"checkbox", value:"true"},
])
```

For a single field, `browser_type(element, target, text, submit:true)` types and
presses Enter in one step.

## Mapping test-case steps to MCP tools

Test cases are written in plain language. Map each step verb to a tool call:

| TC step verb | MCP tool call |
|---|---|
| Open / Go to X | `browser_navigate(url:"{{base_url}}/…")` |
| Click / Tap X | `browser_click(element, target)` |
| Enter V in field F | `browser_type(element, target, text:"V")` — or `browser_fill_form` for several |
| Select O from D | `browser_select_option(element, target, values:["O"])` |
| Press K | `browser_press_key(key:"K")` |
| Hover over X | `browser_hover(element, target)` |
| Verify / See X | `browser_snapshot()` then assert the role/name — or `browser_wait_for(text:"X")` |
| Take a screenshot | `browser_take_screenshot(type:"png", filename:"…")` |
| Upload file | `browser_file_upload(paths:["…"])` |
| Dismiss alert/confirm | `browser_handle_dialog(accept:true)` |

## Selecting elements from the snapshot

`browser_snapshot` returns each interactive element with a `target` ref and its
role + accessible name. Prefer, in order: the snapshot's **role + accessible
name** → `data-testid` → visible text → a stable selector. Avoid brittle
positional CSS (`nth-child`, deep descendant chains). When a clean ref isn't
obvious, a unique CSS selector passed as `target` is valid. Framework-specific
selector hints (MUI, shadcn/ui, Ant Design) and gotchas: `references/patterns.md`.

## Waiting

`browser_navigate` and the action tools auto-wait for the page/element. For
app-side state, use `browser_wait_for` — never a fixed sleep when a condition works:

| Situation | Call |
|---|---|
| Expected content appears | `browser_wait_for(text:"Welcome back")` |
| Spinner / loader clears | `browser_wait_for(textGone:"Loading…")` |
| Nothing observable to key on | `browser_wait_for(time:1)` — last resort |

## Evidence and verification before PASS

- **`browser_take_screenshot(type:"png", filename:"reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png")`**
  — visual proof. (Filenames are relative to the MCP output dir.)
- **`browser_console_messages(level:"error")`** — check for silent JS errors even
  when the UI looks fine; they're the worst bugs. `browser_network_requests`
  confirms the API calls actually fired.
- **Verify the Expected Final State** in a final `browser_snapshot` before
  recording PASS. A PASS without a confirming snapshot of the expected state is
  **invalid** (apply `verification-before-completion`).

## Failure handling

On a mismatch, apply `systematic-debugging`:

1. `browser_snapshot` + `browser_take_screenshot` — capture evidence first.
2. State actual vs expected ("Login screen still visible; expected Dashboard").
3. Retry **once** with a better `target` (different selector strategy).
4. Still failing → record FAIL with a snapshot excerpt in `failure_reason`.

## Result hand-off

When run by `test-runner` inside a led suite, end the response with the single
structured JSON result block the `test-run-lead` collects (`tc_id`, `result`
PASS/FAIL/BLOCKED, steps, `screenshot`, `failure_reason`, …). The lead and
`test-reporter` consume that block — see the `test-runner` agent for the exact
schema.

## Bug report format

When you find an issue (outside a structured run):

```
## [SEVERITY] Title
Steps: 1. Navigate to… 2. Click… 3. Observe…
Expected: what should happen
Actual: what happens
Evidence: screenshot, console error, network response
Frequency: Always / Intermittent / Once
```

## Reference

`references/patterns.md` — live interaction recipes (login, forms, dialogs,
dropdowns, file upload) as exact `browser_*` call chains, framework-specific
selector hints, and common gotchas.

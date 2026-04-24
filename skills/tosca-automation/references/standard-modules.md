# Standard Modules — Discovery & Execute/Verify JavaScript

> **TL;DR lessons learned** (read first)
>
> 1. **Standard modules are not in `inventory search`.** Use `GET /_mbt/api/v2/builder/packages` to list them and `GET /_mbt/api/v2/builder/packages/{packageId}/modules/{moduleId}` to get the full attribute tree. Do this **before** building a custom wrapper for anything the platform already ships (OpenUrl, CloseBrowser, Wait, JS execution, HTTP, DB, file, email, T-code, clipboard, timing…).
> 2. **Module GUIDs vs attribute GUIDs.** Top-level module GUIDs (engine dispatch keys) appear stable across tenants. Attribute GUIDs inside a module have NOT been confirmed stable — re-discover them on every target tenant.
> 3. **`{SCRIPT[...]}`, `{XP[...]}`, `{EVAL[...]}` are not valid dynamic-value commands on Tosca Cloud.** To run JavaScript, use the `Execute JavaScript` / `Verify JavaScript Result` standard modules.
> 4. **When the Html scanner can't see body content** but `browser_evaluate` / CDP confirms it's in the top-level DOM (not iframe / shadow DOM / CSS-hidden), iterating module Steering parameters will not fix it. Pivot to `Verify JavaScript Result` — it dispatches through CDP `Runtime.evaluate` and sees the full DOM regardless of scanner state.
> 5. **Do not use `OpenUrl("javascript:…")` as a JS escape hatch.** Chrome executes the JS, but leaves the tab in a state where TBox can bind the window by title/URL yet cannot find ANY descendant element. Dead end.
> 6. **`engine: XBrowser` / `XBrowser3` / `Chrome` are not valid module engine values.** The agent returns `Engine '<name>' is not valid`. Browser-automation user modules use `Engine: Html`. "XBrowser Engine 3.0" is an agent-side implementation detail, not a module attribute.
> 7. **Debug workflow for "element is in DOM but TBox can't find it"**:
>    (a) `browser_evaluate 'document.querySelectorAll(...).length'` — confirm count is 1
>    (b) Rule out structural hides: iframe, shadow DOM, `aria-hidden`, `inert`, CSS `content-visibility` / `display:contents` / `visibility:hidden` / `opacity:0`
>    (c) `curl` the page and grep for the target text — distinguishes server-rendered-but-blind from client-hydrated
>    (d) If none apply and scanner still fails, pivot to `Verify JavaScript Result`.
> 8. **Always discover before acting.** The two discovery surfaces are Inventory (user artifacts) and `/packages` (engine-bundled Standard modules). Skipping `/packages` is the single most common cause of wasted iterations.

Tosca Cloud ships a set of **Standard modules** bundled with each engine (Html, SAP, Database, Mail, Timing, ProcessOperations, …). They are not created per-space and **do not appear in `inventory search --type Module`** — that endpoint only returns user-created modules. Standard modules live on the Local Runner agent and are referenced in test steps by `moduleId` + `packageReference: {id: "<packageId>", type: "Standard"}`.

## Core rule: discover, don't hard-code

**Top-level module GUIDs** (e.g. `Html.OpenUrl`, `Html.ExecuteJavaScript`) are the agent's engine-dispatch keys and appear to be global framework constants across tenants. The module GUID table in the Caveats Quick Reference below has only been validated against the authors' tenants.

**Attribute GUIDs within those modules** (e.g. the `Title`, `Url`, `JavaScript`, `Result` attributes) have NOT been confirmed stable across tenants. Treat them as per-space discoveries: **always re-read the module from `/packages/{packageId}/modules/{moduleId}` on the target tenant** and copy the returned IDs verbatim when building a test step. Do not copy attribute GUIDs from documentation or from another project.

## Discovery workflow (generic)

Run these commands on the target tenant before writing any test step that references a standard module:

```bash
source .venv/bin/activate

# 1. List every engine-bundled package and the modules it ships
python -c "
import sys, json
sys.path.insert(0, '.')
from tosca_cli import ToscaClient
c = ToscaClient()
for pkg in c.get(c.mbt('packages')):
    print(f'{pkg[\"id\"]:40s}  {pkg[\"name\"]:40s}  {pkg.get(\"category\",\"\")}')
    for m in pkg.get('modules', []):
        print(f'  {m[\"id\"]}  {m[\"name\"]}')
"

# 2. For the module you want, get the full attribute tree (attribute IDs + default action modes + data types)
python -c "
import sys, json
sys.path.insert(0, '.')
from tosca_cli import ToscaClient
c = ToscaClient()
print(json.dumps(c.get(c.mbt('packages/<packageId>/modules/<moduleId>')), indent=2))
"
```

From step 2's output, capture for each attribute:
- `id` — put this in `moduleAttributeReference.id` in the test step
- `name` — put this in the test step value's `name` field
- `defaultActionMode` — use this (or override to `Verify` / `Input` / `WaitOn` depending on intent)
- `defaultDataType` — put this in the test step value's `dataType` field
- Nested `attributes[]` for Container attributes like `Search Criteria` — flatten into individual test step values, each still referencing its own attribute `id`.

## When to use Standard modules (general rule)

Before creating a new custom module for any of the following, **first list `/packages`**:

- Open / close a browser, wait, click coordinates, read a web QR code
- Run JavaScript on a page / verify a JS return value
- Read or write files, folders, clipboard, the registry
- HTTP request, database query, email send/read, FTP/SFTP
- Run an external process, PowerShell, WebDriver directly
- SAP Logon, SAP Login, T-code invocation
- Buffer operations, expression evaluation, random data generation, wait timers, timing fences
- Mobile (Appium), PDF reads, Excel reads, JSON/XML parsing

If `/packages` has a matching module, use it. Building a custom wrapper around functionality the platform already ships almost always produces worse results and duplicates maintenance burden.

## Execute JavaScript & Verify JavaScript Result

These are the two modules with the broadest leverage, especially on modern SPAs/CMSs where the legacy Html scanner can miss body content.

### Module-level shape (discovered via `/packages/Html/modules/{id}`)

Both modules have the same nested tree — a `Search Criteria` Container plus a `JavaScript` input. `Verify JavaScript Result` additionally has a `Result` verify attribute.

```
Search Criteria (Container, cardinality=ExactlyOne, defaultActionMode=Select)
├── Title          (Input, String)   — window caption match (wildcard * allowed)
├── Url            (Input, String)   — URL substring match (wildcard * allowed)
├── Window Index   (Input, String)   — integer or "last"
└── UseActiveTab   (Input, Boolean)  — True overrides the above and uses the active tab
JavaScript          (Input, String)  — JS code; include `return …` when Verify is used
Result              (Verify, String) — only on Verify JavaScript Result; expected return value
```

**Re-discover the attribute IDs on your tenant** — do not copy GUIDs from external sources.

### When to reach for these modules

1. **The Html scanner is blind to content that exists in the DOM**. Symptom: scanner emits `Could not find Label/Link/Container ...` or `WaitOn Actual=False`, but `browser_evaluate` / CDP confirms the element is in the top-level document. After ruling out iframe / shadow DOM / CSS `content-visibility` / `aria-hidden` / `inert`, assume the AutomationExtension's DOM observer is disabled or late-injected for the domain (tenant setting or hydration race). Switching to `Verify JavaScript Result` routes the check through the Framework engine's `SpecialExecutionTask: VerifyJavaScriptResult` dispatch, which uses CDP `Runtime.evaluate` and bypasses the scanner entirely.
2. **Reading state the scanner doesn't expose as a TechnicalId**: cookies, `localStorage`, `sessionStorage`, computed styles, scroll position, network state, performance counters, custom `window.*` globals.
3. **Content-shape checks**: asserting a count, presence, or simple aggregate (`document.querySelectorAll('.x').length`, `document.title`, `JSON.stringify(someGlobal)`) is often cleaner as one JS step than many scanner-level Verify steps.

**Never** use these modules to bypass a *legitimate* failing assertion (see SKILL.md no-defect-masking rule). They are a DOM-access tool, not a hide-the-failure tool.

### Skeleton of a `Verify JavaScript Result` step

Replace every `<discovered-*-id>` placeholder with an ID you just fetched from `/packages/Html/modules/{moduleGuid}` on the target tenant. The only ID that should be copied without re-discovery is the top-level module GUID (the engine's dispatch key).

```json
{
  "$type": "TestStepV2",
  "name": "Verify: <describe the assertion in business terms>",
  "moduleReference": {
    "id": "<VerifyJavaScriptResult-moduleGuid>",
    "packageReference": {"id": "Html", "type": "Standard"},
    "metadata": {"isRescanEnabled": false, "engine": "Framework"}
  },
  "testStepValues": [
    {"id": "<fresh-ULID>", "name": "Title", "value": "*<window caption pattern>*",
     "actionMode": "Input", "dataType": "String", "actionProperty": "", "operator": "Equals",
     "moduleAttributeReference": {"id": "<discovered-title-id>", "moduleId": "<VerifyJavaScriptResult-moduleGuid>", "packageReference": {"id": "Html", "type": "Standard"}},
     "subValues": [], "disabled": false},
    {"id": "<fresh-ULID>", "name": "Url", "value": "*<host/path pattern>*",
     "actionMode": "Input", "dataType": "String", "actionProperty": "", "operator": "Equals",
     "moduleAttributeReference": {"id": "<discovered-url-id>", "moduleId": "<VerifyJavaScriptResult-moduleGuid>", "packageReference": {"id": "Html", "type": "Standard"}},
     "subValues": [], "disabled": false},
    {"id": "<fresh-ULID>", "name": "UseActiveTab", "value": "False",
     "actionMode": "Input", "dataType": "Boolean", "actionProperty": "", "operator": "Equals",
     "moduleAttributeReference": {"id": "<discovered-useActiveTab-id>", "moduleId": "<VerifyJavaScriptResult-moduleGuid>", "packageReference": {"id": "Html", "type": "Standard"}},
     "subValues": [], "disabled": false},
    {"id": "<fresh-ULID>", "name": "JavaScript",
     "value": "return document.querySelectorAll('<selector>').length.toString()",
     "actionMode": "Input", "dataType": "String", "actionProperty": "", "operator": "Equals",
     "moduleAttributeReference": {"id": "<discovered-javascript-id>", "moduleId": "<VerifyJavaScriptResult-moduleGuid>", "packageReference": {"id": "Html", "type": "Standard"}},
     "subValues": [], "disabled": false},
    {"id": "<fresh-ULID>", "name": "Result", "value": "<expected string return value>",
     "actionMode": "Verify", "dataType": "String", "actionProperty": "", "operator": "Equals",
     "moduleAttributeReference": {"id": "<discovered-result-id>", "moduleId": "<VerifyJavaScriptResult-moduleGuid>", "packageReference": {"id": "Html", "type": "Standard"}},
     "subValues": [], "disabled": false}
  ],
  "id": "<fresh-ULID>",
  "disabled": false
}
```

## Caveats (platform-level, not project-specific)

- **`return` is mandatory** in `Verify JavaScript Result`. Without it the agent captures `undefined` and the Verify always mismatches. In `Execute JavaScript` (fire-and-forget), omit `return`.
- **ALL `{` and `}` anywhere in the JS string are TBox expression delimiters — not just at the top level.** TBox's dynamic-value parser scans the entire JS string for `{...}` patterns and tries to evaluate each as a TBox command expression, regardless of where it appears (function body, callback, object literal). Even `function(a){return a.text}` fails: TBox reads `{return a.text}` as a command expression and returns `No suitable value found for command return a.text.` The previously-suggested IIFE approach (`(function(){ ... })()`) is also unsafe — the function body's `{...}` is scanned the same way. **Write all VJS JavaScript without any curly braces:**
  - `var` / `const` / `let` for sequential statements: `var x = expr; var y = expr;`
  - Arrow expressions for callbacks: `a => a.text` instead of `function(a){return a.text}`
  - Ternary + comma for conditional multi-step: `el ? (el.click(), 'clicked') : 'not found'` instead of `if(el){el.click(); return 'clicked'} return 'not found'`
  - Method chains for common operations: `Array.from(...).find(a => a.text === 'x')` (arrow has no braces)
  - `[` at the **very start** of the value string is also a delimiter (`[...spread]` at root fails). Inside an expression it is safe: `Array.from(document.querySelectorAll('a'))` is fine.
- **Prefer `'single quotes'` for string literals inside the JS — double quotes silently break the step.** `"` is also a dynamic-value delimiter for TBox's parser. A value like `return document.querySelectorAll("h2.stripe_title").length.toString()` returns an **empty string** (Verify fails with `Expected "4", Actual ""`) even though the same expression returns `"4"` in a real browser and even `return document.title` (no `"` in the body) works. Wrap the JS in an IIFE to try to shield it and you get the diagnostic message `Expression provided in test step item "JavaScript" could not be parsed due to the following reason: Token is not valid in this context: "`. **Fix**: rewrite string literals with `'...'` — `return document.querySelectorAll('h2.stripe_title').length.toString()`. If you absolutely need `"` in the JS (e.g. calling a remote URL literal), escape by tripling per Tosca Cloud docs: `"""https://host"""`.
- **`UseActiveTab: False` when you supply Title/Url.** With `True`, Search Criteria are ignored and the JS runs on whatever tab Chrome currently focuses — flaky on workstation Local Runners that share the user's Chrome with other tabs.
- **`UseActiveTab: False` + non-matching Title/Url returns `Actual: ""` silently** (unlike GUI Html modules which raise `No matching tab was found`). Looks identical on-screen to the `"`-in-JS trap, different root cause. Common trigger: a `Click` on a nav link navigates the current tab but the new page's `<title>` hasn't swapped by the time the next VJS step's pattern-match runs — the Search Criteria matches zero tabs, Result comes back empty, Verify mismatches. Mitigations: (a) `UseActiveTab=True` when the clicked navigation leaves the target as Chrome's focused tab (skips the pattern lookup entirely); (b) prepend a GUI-module `WaitOn` on an element that only exists on the target page (e.g. a specific `<h1>`) to gate the VJS step behind a real page-load check; (c) add a `TBox Wait` step with a duration that exceeds the slowest observed title-swap latency.
- **`moduleReference.metadata.engine` is tenant-specific — read it from `/packages`, don't hard-code.** On some tenants the VJS module is packaged with `Engine: Framework`; on others (e.g. the EPAM sandbox space as of this writing) it's `Engine: Html` + module-level parameter `SpecialExecutionTask: VerifyJavaScriptResult`. Either value dispatches the step correctly because the Html engine keys off `SpecialExecutionTask` at runtime. The server-side PUT handler **reverts cross-tenant values** (setting `engine=Framework` on a tenant where the module is `Html`-packaged gets silently restored to `Html` on the next GET — passes the confirm-write check but is still "wrong"). Always fetch via `GET /_mbt/api/v2/builder/packages/Html/modules/a9cc198f-ae01-4665-ac02-5000d6b0c7de` and copy whatever `metadata.engine` comes back verbatim. Getting this wrong is usually a red herring — if VJS is returning empty Result, the fix is almost always in the JS string (see `"` caveat above) or the Search Criteria, not in the engine field.
- **Double-quote escaping inside the JS string**: already covered above — prefer `'single quotes'`. If you truly need `"` (e.g. literal URL fragment in a JSON payload), triple them: `"""http://x"""`. Single quotes need no escaping.
- **The JS runs in full page context** — it is NOT subject to the Html scanner's filtering (`IgnoreInvisibleHtmlElements`, `ScrollToFindElement`, etc.). That's why this pathway works on pages where the scanner is blind.
- **`el.click()` can be silently intercepted by CMS/framework event handlers — navigation does not happen.** CMS frameworks (Drupal with `data-extlink=""` on anchor elements, React/Vue synthetic event systems) attach click listeners that call `event.preventDefault()` to intercept navigation — for example to show an "external link" warning or to open in a new tab. When VJS runs `el.click()`, the DOM event fires but the framework handler cancels the default action; the JS expression returns `"clicked"` normally (no JS error), yet `window.location.href` remains unchanged. **Diagnosis**: VJS step reports the expected return value, but the subsequent URL-verify step fails with the old URL still active. **Fix**: replace `el.click()` with `window.location.href = el.href` — direct property assignment bypasses all event handlers and forces navigation without triggering any `click` listener. This works regardless of CMS or framework.
- **`{SCRIPT[...]}` and `{XP[...]}` dynamic-value commands are not registered on Tosca Cloud.** Attempts return `No suitable value found for command SCRIPT.` The only way to run JS from a test step is via these standard modules.

## Platform-constant module GUIDs (validated but still re-check on your tenant)

These top-level module GUIDs are the agent's engine dispatch keys and have been observed to match across the tenants we've worked with. Always verify via `GET /packages` on a new tenant before relying on them:

| Package | Module | GUID |
|---|---|---|
| Html | OpenUrl | `9f8d14b3-7651-4add-bcfe-341a996662cc` |
| Html | CloseBrowser | `3019e887-48ca-4a7e-8759-79e7762c6152` |
| Html | Execute JavaScript | `54f432f6-61ed-4c9a-a7dc-9e3970a08323` |
| Html | Verify JavaScript Result | `a9cc198f-ae01-4665-ac02-5000d6b0c7de` |
| Timing | Wait | `80b7982e-0e10-4bc0-bdf3-6bc04503fd63` |

Attribute IDs inside those modules are NOT listed here — always discover them on the target tenant.

## Generalizable diagnostic: "scanner blind" pattern

A reusable playbook for any project where the Html scanner can't find body content:

1. **Prove the element is in DOM** — `browser_evaluate 'document.querySelectorAll(...).length'` (must be exactly 1).
2. **Rule out structural causes** — in order:
   - `closest('iframe')` — element inside an iframe?
   - `getRootNode() instanceof ShadowRoot` — shadow DOM?
   - Any ancestor with `getComputedStyle(el).contentVisibility !== 'visible'`, `display === 'contents'`, `visibility === 'hidden'`, `opacity === '0'`, `aria-hidden === 'true'`, `hasAttribute('inert')`?
   - Is the page using `<template shadowrootmode>` (declarative shadow DOM)?
3. **Check server-rendered presence** — `curl` the URL and `grep` for the target text. Distinguishes "server-rendered but scanner-blind" from "client-hydrated and never caught".
4. **If none of the above apply and scanner still fails** — stop iterating module Steering parameters. Pivot to `Verify JavaScript Result`. The root cause is almost always in the AutomationExtension's DOM observer injection (tenant `Disable Ajax Tracer injection on pages` setting, or a page-specific hydration pattern that prevents the observer from attaching), which no module-level flag will fix.
5. **Optional: raise with tenant admin.** The admin-level fixes are in Tosca Cloud → Settings → Scan/Engine settings → XBrowser: `Disable Ajax Tracer injection on pages` (remove matching URL patterns), `Ajax tracer injection delay` (bump from 0 ms), `Handle asynchronous loading` (Strict → Loose). Meanwhile, the JavaScript-module path works today without admin action.

## Anti-patterns observed (do not repeat)

- **Chaining `OpenUrl` with a `javascript:` URL to rewrite `document.title` and then probing by title.** The navigation succeeds, the JS runs, but the tab ends up in a state where TBox can bind the window by title/url but cannot find ANY child element — not `<body>`, not `<html>`, not `<head>`. Dead end for verification. Use `Verify JavaScript Result` instead.
- **Piling up module-level Steering flags (`UseWebDriverSteeringExclusively`, `IframeProcessingEnabled`, `SearchInNewWindowsAndTabs`, `WaitTime=30000`, etc.) hoping one of them unblocks the scanner.** They do not, when the root cause is the observer being disabled for the domain. Confirm scanner-blindness via the playbook above and pivot early.
- **Changing a module's `Engine` from `Html` to `XBrowser` / `XBrowser3` / `Chrome`** — these are not valid engine values; the agent returns `Engine '<name>' is not valid`. User modules created for browser automation use `Engine: Html`. The "XBrowser Engine 3.0" name in the docs refers to the agent-side implementation; module authors keep `Engine: Html`.
- **Looking for `Execute JavaScript` in `inventory search --type Module`** — it isn't there; Standard modules aren't inventory items. Discover via `/packages`.
- **Assuming `{SCRIPT[...]}` / `{XP[...]}` / `{EVAL[...]}` will evaluate JavaScript.** They don't on Tosca Cloud. Use the standard module.

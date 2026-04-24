# Web Automation (Html Engine) — Detailed Guide

## Discovery workflow with Playwright

```
1. browser_navigate <url>
2. browser_snapshot                — get accessibility tree
3. browser_evaluate 'document.querySelectorAll("a[href='/path']").length'
   → must return 1; if > 1, find a discriminating ClassName
4. browser_evaluate 'JSON.stringify(Array.from(document.querySelectorAll("a[href='/path']")).map(function(el){return {cls:el.className}}))'
   → pick the class unique to the target element (e.g. top-navigation__item-link)
5. browser_click ref=<refId>       — navigate forward
6. Repeat for each step in the user journey
```

**Always verify element uniqueness before writing the module.** Many sites render nav links in both a mobile hamburger menu and a desktop nav bar. TOSCA will fail at runtime, not at save time, if a locator matches more than one element.

> **`InnerText` is exact-match in TOSCA's Html engine.** A link that wraps additional text nodes (e.g. an `<a>` containing both a caption and a nested heading) has `innerText` equal to the concatenation of all descendant text — not just the visible caption. A short `InnerText="<caption>"` will not match. Drop `InnerText` from the TechnicalIds and use `Tag` + `HREF` + `ClassName` (or a unique `Title` attribute) instead.
>
> **Parent `visibility:hidden` propagates.** A mega-menu closed by default has its items rendered but hidden via parent `visibility:hidden` / `opacity:0`. TOSCA's default `IgnoreInvisibleHtmlElements=True` filters these out — your module-level selector finds the document but attribute lookup reports `"Could not find Link ..."`. Two fixes: (1) open the parent (click the menu trigger, then add a Wait + the hover/click step); (2) add `IgnoreInvisibleHtmlElements=False` as a Steering module parameter.
>
> **The Html scanner is viewport-scoped, not document-scoped.** A `Verify` on an `<h2>`, `<div>`, or any element below the fold fails with `Could not find …` even when the element exists in the DOM. Run this diagnostic before changing the selector:
>
> ```javascript
> // in browser_evaluate, on the live page at the same viewport size as the agent (maximized ≈ 900–1080 px)
> var sel = 'h2.stripe_title';
> var vh  = window.innerHeight;
> Array.from(document.querySelectorAll(sel)).map(function(el, i) {
>   var r = el.getBoundingClientRect();
>   return i + ': y=' + Math.round(r.y) + ' visible=' + (r.y >= 0 && r.y < vh);
> }).join('\n');
> ```
>
> If every match has `visible=false`, the element is below the fold — that is the failure, not the locator. `ScrollToFindElement=True` steering does **not** reliably reach far-below-the-fold content. Fixes in order of preference:
>
> 1. Prepend a `Send Keys (Keyboard)` step with `value: "{SENDKEYS[{PAGEDOWN}]}"` on a page-level element. Repeat until the target's `getBoundingClientRect().y` falls inside the viewport.
> 2. Navigate directly to a fragment anchor when the page supports one: an `OpenUrl` to `…/page#section-id` skips the scroll question entirely.
> 3. Pivot to `Verify JavaScript Result`: CDP `Runtime.evaluate` is document-scoped, so `return document.querySelectorAll('h2.stripe_title').length.toString()` returns the true count regardless of scroll position. See `standard-modules.md` for the module skeleton — remember to use **single quotes** inside the JS value (a `"` at the value root silently breaks the step).
>
> This is a distinct root cause from "scanner blind to body content" (observer-disabled case in `standard-modules.md`): viewport scoping applies even when the Tricentis Automation Extension is fully attached and the observer is healthy. Always check viewport first — cheapest diagnostic.

## Module structure

```json
{
  "$type": "ApiModuleV2",
  "id": "<moduleId>",
  "name": "<AppName> | <PageName>",
  "businessType": "HtmlDocument",
  "interfaceType": "Gui",
  "parameters": [
    {"id": "<ULID>", "name": "Engine", "value": "Html", "type": "Configuration"}
  ],
  "attributes": [
    {
      "id": "<fresh-ULID>",
      "name": "<HumanLabel>",
      "businessType": "Link",
      "defaultActionMode": "Input",
      "defaultDataType": "String",
      "defaultOperator": "Equals",
      "valueRange": ["{Click}", "{Rightclick}"],
      "isVisible": true,
      "isRecursive": false,
      "cardinality": "ZeroToOne",
      "interfaceType": "Gui",
      "parameters": [
        {"name": "BusinessAssociation", "value": "Descendants", "type": "Configuration"},
        {"name": "Engine",              "value": "Html",         "type": "Configuration"},
        {"name": "Tag",                 "value": "A",            "type": "TechnicalId"},
        {"name": "InnerText",           "value": "<linkText>",   "type": "TechnicalId"},
        {"name": "HREF",                "value": "/path",        "type": "TechnicalId"},
        {"name": "ClassName",           "value": "<cssClass>",   "type": "TechnicalId"}
      ]
    }
  ]
}
```

**The root-level `parameters` array must contain `Engine: Html`.** Without it, TOSCA throws `XModules and XModuleAttributes have to provide the configuration param "Engine"` at runtime. Scanned modules have it automatically; manually created ones do not.

### Module-level identifiers (TechnicalId on the module root, not on an attribute)

These determine *which HtmlDocument* (i.e. browser tab) the module binds to at runtime. On a shared-Chrome agent (user's personal browser with many tabs), the defaults are too loose.

| Param | Type | Good value | Why |
|-------|------|-----------|-----|
| `Engine` | Configuration | `Html` | Required — see above |
| `Title` | TechnicalId | `*<AppName>*` (glob) | Restricts document match by tab title |
| `Url` | TechnicalId | `https://<host>*` | **Add this** to disambiguate when multiple tabs share a title pattern — this alone stops the _"More than one matching tab"_ error without needing a `CloseBrowser` first |
| `ControlFramework` | Steering | `None` | Default for vanilla HTML |
| `AllowedAriaControls` | Steering | `button; checkbox; combobox; link; listbox; menuitem; menuitemcheckbox; menuitemradio; option; radio; scrollbar; slider; spinbutton; switch; tab; textbox; treeitem` | Empty value causes erratic element resolution |
| `EnableSlotContentHandling` | Steering | `False` | `True` triggers shadow-DOM traversal that many ordinary pages don't need |
| `IgnoreInvisibleHtmlElements` | Steering | `True` | Skip off-screen duplicates of the same element |

Scanned modules also carry a `SelfHealingData` steering param with hints about the page at scan time (Title + URL). **When reusing a scanned module for a different flow, drop the `SelfHealingData` entry** — the module still works via TechnicalIds, and stale self-healing hints can interfere with document matching on the new flow.

## businessType by element

| Element | `businessType` | `valueRange` |
|---------|---------------|-------------|
| `<a>` | `Link` | `["{Click}", "{Rightclick}"]` |
| `<button>` | `Button` | `["{Click}"]` |
| `<input type=text>` | `TextBox` | `["{Click}", "{Doubleclick}", "{Rightclick}"]` |
| `<input type=checkbox>` | `Checkbox` | `["{Click}"]` |
| `<select>` | `Combobox` | `["{Select}"]` |
| `<div>`/`<span>` container to verify | `Container` | — |
| page root | `HtmlDocument` | — (module-level only) |

> **Container nesting is NOT a DOM scope.** Nesting a `Button` attribute inside a `Container` attribute in the module tree affects only Steering-param inheritance — at runtime TBox resolves `moduleAttributeReference.id` **globally** against the document. If two matching buttons exist in different page regions (e.g. header + sticky nav), you get *"Found multiple controls for Button '…'"* regardless of the parent Container. To discriminate sibling elements, embed the ancestor's class/ID in the child's own selector (e.g. `ClassName: "region-header lang-switch"` combining both), or pivot to `Verify JavaScript Result` with a scoped `document.querySelector('.region-header button.lang-switch')`.

## Value expression reference

All values in a TestStepValue are **UPPERCASE commands wrapped in braces**. Source of truth: Tosca Cloud [References docs](https://docs.tricentis.com/tosca-cloud/en-us/content/references/values_overview.htm).

### Action modes (TestStepValue `actionMode`)

| Mode | Use |
|------|-----|
| `Input` | Write a value into the control |
| `Insert` | Insert a value into an API module control |
| `Verify` | Assert — compare expected vs actual; pair with `actionProperty` (`Visible`, `InnerText`, etc.) and `operator` |
| `Buffer` | Capture the control's value into the buffer named by `value` |
| `Output` | Capture a specific control property (`Value`, `InnerText`, `Enabled`, `Exists`, `Visible`) into a buffer |
| `WaitOn` | Poll the control until it reaches the specified state |
| `Select` | Choose a specific child control (e.g. a menu item, tab, row) — required for hover-revealed submenus if your tooling exposes it that way |
| `Constraint` | Narrow the parent scope — e.g. pick the right table row by a column value |
| `Exclude` | Remove specific rows/columns from a table operation |

### Click / mouse values (on Link, Button, Checkbox, etc.)

| Value | Action |
|-------|--------|
| `{CLICK}` | Left click |
| `{DOUBLECLICK}` | Double click |
| `{RIGHTCLICK}` | Right click |
| `{ALTCLICK}` / `{CTRLCLICK}` / `{SHIFTCLICK}` | Modified click (plus `L`/`R` variants e.g. `{LALTCLICK}`) |
| `{LONGCLICK}` | ~2-second press |
| `{MOUSEOVER}` | **Real mouse move over element** — fires CSS `:hover` |
| `{DRAG}` / `{DROP}` | Drag-and-drop pair |
| `X` | JS-click (no mouse event) |
| `{CLICK[OffsetH][OffsetV]}` | Click at pixel/percent offset from top-left of the control |
| `{MOUSE[<action>][Jump\|Smooth\|HorizontalFirst\|VerticalFirst][OffsetH][OffsetV]}` | Advanced: full control over move method + offset |

> `{Hover}` is **not** valid — TOSCA errors with _"No suitable value found for command Hover"_. Use `{MOUSEOVER}`. Synthetic JS events don't fire the CSS `:hover` pseudo-class; `{MOUSEOVER}` emits a real mouse move that does.

Example Link `valueRange` that includes hover:
```json
"valueRange": ["{CLICK}", "{RIGHTCLICK}", "{MOUSEOVER}"]
```

#### Mega-menu hover routing — direct `{MOUSEOVER}` paths can accidentally switch panels

Plain `{MOUSEOVER}` moves the cursor in a **straight line** (default `Jump`/`Smooth`) from its current position to the target's center. On mega-menus where top-level triggers (About / Products / Research / Careers / …) each open their own panel on hover, a straight diagonal line from one top-level trigger to a deep submenu link **crosses other top-level triggers** and swaps the open panel mid-flight — the intended target is no longer visible when the subsequent `{CLICK}` fires, and TBox reports `Link '…' is not steerable. The reason could be that the control is not visible` after a ~10 s timeout.

Two fixes, in order of preference:

1. **Single-step L-path via the advanced `{MOUSE[…]}` form.** Replace the `{MOUSEOVER}` value on the target Link with `{MOUSE[MOUSEOVER][HorizontalFirst]}` (or `[VerticalFirst]` depending on layout). The move goes horizontal-then-vertical (or vice versa) in a single step, keeping the cursor inside the expanded panel's safe rectangle. Requires the Link's `valueRange` to include the exact string.

2. **Explicit waypoint attribute.** If the target element is deep enough that even `HorizontalFirst` crosses a sibling trigger, add a **waypoint Link attribute** to the module — an element on the same-y-row as the top-level trigger, safely inside the opened submenu column — and insert a `MOUSEOVER <waypoint>` step between the panel-opening hover and the target hover:

   ```
   1. Click <hamburger Menu>
   2. MOUSEOVER <top-level trigger>            ← opens submenu
   3. WaitOn <target visible>
   4. MOUSEOVER <waypoint>                     ← horizontal move inside safe row
   5. MOUSEOVER <target>                       ← vertical move inside submenu column
   6. Click <target>
   ```

   To pick a good waypoint, call `document.querySelectorAll('<trigger-submenu> > li:nth-child(1) > a')` or inspect via Playwright `browser_evaluate` — you want a link whose `getBoundingClientRect().top/bottom` **overlap the top-level trigger's y-range** (same row), so the path from trigger → waypoint is horizontal only. Then the path from waypoint → target is vertical only (both are in the same submenu column). This L-shaped path never crosses another top-level trigger.

Validated against Novartis — see case `Novartis — verify Therapeutic Areas sections` in the Sandbox space. Direct `{MOUSEOVER}` from `About` to `Therapeutic areas` crossed `Products` / `Patients` and closed the About panel; adding a `Board of Directors` waypoint (same y-row as `About`, top of the About submenu column) made the flow deterministic.

### Keyboard commands (on TextBox / any focusable)

Single key: `{ENTER}` `{RETURN}` `{TAB}` `{ESC}` `{ESCAPE}` `{BACKSPACE}` `{DEL}` `{HOME}` `{END}` `{LEFT}` `{RIGHT}` `{UP}` `{DOWN}` `{INSERT}` `{CLEAR}` `{F1}`–`{F24}` — and modifiers `{SHIFT}` `{CTRL}` `{ALT}` (plus `L`/`R` variants), plus `{CAPSLOCK}` `{NUMLOCK}` `{SCROLLLOCK}` `{PRINT}` `{BREAK}` `{LWIN}` `{RWIN}` `{APPS}`.

Advanced:
- `{SENDKEYS["<Microsoft SendKeys string>"]}` — Windows SendKeys-style sequence
- `{KEYPRESS[<VK code>]}` — single virtual-key press (no `VK_` prefix)
- `{KEYDOWN[<code>]}` / `{KEYUP[<code>]}` — hold / release a key
- `{TEXTINPUT["<unicode text>"]}` — raw unicode input (bypasses keymap)

### Dynamic expressions (in any `value` field)

| Expression | Purpose |
|------------|---------|
| `{CP[ParamName]}` | Reference a test-configuration parameter (e.g. `{CP[Username]}`) |
| `{B[bufferName]}` | Reference a buffered value — **case-sensitive, test-case-scoped** (cannot cross test-case boundaries) |
| `{MATH[<expr>]}` | Arithmetic: `+ - * / %`, comparisons, logical, bitwise; functions `Abs Ceiling Floor Max Min Pow Round Sign Sqrt Truncate` (e.g. `{MATH[2*(2+5)]}` → `14`) |
| `{BASE64}`, `{STRINGLENGTH}`, `{STRINGTOLOWER}`, `{STRINGTOUPPER}`, `{TRIM}`, `{STRINGREPLACE}`, `{STRINGSEARCH}`, `{NUMBEROFOCCURRENCES}` | String ops; some accept `[IGNORECASE]` / `[REPLACEFIRST]` / `[FINDFIRST]` |

Other value-expression families documented but rarely needed for basic web cases: scroll operations, regex capture, random values, date/time, number formats, intervals, resource expressions, user simulation, key-vault secrets. See Tosca's [value expressions overview](https://docs.tricentis.com/tosca-cloud/en-us/content/references/values_overview.htm).

## Standard framework module IDs

| Step | Module ID | Attribute | Attr ref ID | Notes |
|------|-----------|-----------|-------------|-------|
| `OpenUrl` | `9f8d14b3-7651-4add-bcfe-341a996662cc` | `Url` | `39e342b2-960b-2251-d1b9-5b340c12fa19` | Navigate |
| same | same | `UseActiveTab` | `39ef3b0d-1ee2-a137-d5d3-976be1b8c766` | Always `"False"` |
| same | same | `ForcePageSwitch` | `deaad6b0-32d2-4c60-a682-40e30540e3d9` | Always `"True"` |
| `CloseBrowser` | `3019e887-48ca-4a7e-8759-79e7762c6152` | `Title` | `39e342b2-958e-3e2f-7c85-29871c23f1dc` | Value = title glob; `"*"` = any |
| `Wait` | `80b7982e-0e10-4bc0-bdf3-6bc04503fd63` | `Duration` | `39e342b2-958e-ba1f-bb58-702e193d6016` | ms; `dataType: Numeric` |
| `Buffer` | `8415c10d-ab41-44a7e-949a-602f4dddd2d2` | `<name>` | `39e342b2-958e-0a6b-cbfd-5fdd372ca255` | Store value in buffer |

## 4-folder test case structure

```
Precondition   — CloseBrowser Title="*"  ← ALWAYS FIRST: clears leftover browser sessions
               — OpenUrl (Url + UseActiveTab=False + ForcePageSwitch=True)
Process        — User actions (click links, fill inputs, click buttons)
Verification   — Verify steps (actionMode: Verify + actionProperty)
Teardown       — CloseBrowser + optional Wait
```

> **Why CloseBrowser first?** A leftover browser tab from a previous run causes _"More than one matching tab"_. Starting with `CloseBrowser Title="*"` (wildcard) guarantees a clean slate — **on grid agents and workstations that run a dedicated Chrome profile**. On workstation agents that reuse the user's personal Chrome, `Title="*"` would close the user's own tabs — narrow it to `Title="*<AppName>*"` and wrap in a `ControlFlowItemV2 If` that first verifies a known app element is visible.
>
> **Leftover-tab cleanup, idiomatic form** — when running on personal Chrome, prepend to Precondition:
> ```
> If  condition = Verify <always-visible app element> Visible=True
>     then       = CloseBrowser Title="*<AppName>*"
> ```
> The condition Verify has to be checkable cheaply with no user action (e.g. the site's Menu button, logo link, or any element that's in the page chrome). If the Verify returns false (no leftover tab) the If skips and OpenUrl proceeds. If Verify returns true, CloseBrowser runs first. Without this, the very first step after OpenUrl fails with `"More than one matching tab was found"` on the second and later runs of the day.

> **When CloseBrowser fails with `UnestablishedConnectionException`** — the agent has no running Chrome at all (typical on a fresh grid agent). `CloseBrowser` tries to handshake with the extension, hits a 10 s timeout, and aborts. In that case remove the cleanup step entirely — `OpenUrl` will launch Chrome itself.

> **`"The Browser could not be found"` at the first interactive step** — the Tricentis Chrome extension is not installed/enabled in the Chrome instance the agent is driving. OpenUrl opens the tab, but subsequent steps have no bridge. Fix on the agent (install the extension in the profile, or configure a dedicated profile). **No test-case change resolves this.**

## OpenUrl step template (all 3 params required)

```json
{
  "$type": "TestStepV2",
  "name": "OpenUrl – https://example.com",
  "moduleReference": {
    "id": "9f8d14b3-7651-4add-bcfe-341a996662cc",
    "packageReference": {"id": "Html", "type": "Standard"},
    "metadata": {"isRescanEnabled": false, "engine": "Framework"}
  },
  "testStepValues": [
    {
      "name": "Url", "value": "https://example.com",
      "actionMode": "Input", "dataType": "String", "operator": "Equals",
      "moduleAttributeReference": {
        "id": "39e342b2-960b-2251-d1b9-5b340c12fa19",
        "moduleId": "9f8d14b3-7651-4add-bcfe-341a996662cc",
        "packageReference": {"id": "Html", "type": "Standard"}
      }
    },
    {
      "name": "UseActiveTab", "value": "False",
      "actionMode": "Input", "dataType": "String", "operator": "Equals",
      "moduleAttributeReference": {
        "id": "39ef3b0d-1ee2-a137-d5d3-976be1b8c766",
        "moduleId": "9f8d14b3-7651-4add-bcfe-341a996662cc",
        "packageReference": {"id": "Html", "type": "Standard"},
        "metadata": {"valueRange": ["True", "False"]}
      }
    },
    {
      "name": "ForcePageSwitch", "value": "True",
      "actionMode": "Input", "dataType": "String", "operator": "Equals",
      "moduleAttributeReference": {
        "id": "deaad6b0-32d2-4c60-a682-40e30540e3d9",
        "moduleId": "9f8d14b3-7651-4add-bcfe-341a996662cc",
        "packageReference": {"id": "Html", "type": "Standard"},
        "metadata": {"valueRange": ["True", "False"]}
      }
    }
  ]
}
```

## Verify steps

```json
{
  "name": "Error message",
  "value": "Please enter a valid email address.",
  "actionMode": "Verify",
  "actionProperty": "InnerText",
  "operator": "Equals",
  "dataType": "String"
}
```

| `actionProperty` | Checks |
|-----------------|--------|
| `"Visible"` | Element is visible; value `"True"` |
| `"InnerText"` | Exact inner text matches value |
| `""` (empty) | Plain interaction, no assertion |

## Test case config params

```json
"testConfigurationParameters": [
  {"name": "Browser", "value": "Chrome", "dataType": "String"}
]
```

Supported: `Chrome`, `Edge`, `Firefox`.

## Password fields

```json
{
  "name": "Password:", "value": "",
  "password": {"id": "<encrypted-id>"},
  "actionMode": "Input", "dataType": "Password", "operator": "Equals"
}
```

Reference config params in steps: `{CP[Username]}`, `{CP[Password]}`.

## Conditional steps — `ControlFlowItemV2` for optional elements

Wrap a step in an `If` block when the element may or may not be present (cookie banners, leftover tabs, optional popups). **Works reliably only when the module-level selector can cleanly miss** — i.e. add a tight `Url=https://host.tld*` to the module so the document match returns a clean no-match instead of hard-failing.

```json
{
  "$type": "ControlFlowItemV2",
  "statementTypeV2": "If",
  "id": "<ULID>",
  "name": "If cookie banner shown",
  "disabled": false,
  "condition": {
    "id": "<ULID>",
    "name": "Condition",
    "disabled": false,
    "items": [
      {
        "$type": "TestStepV2",
        "id": "<ULID>",
        "name": "Accept Cookies visible?",
        "moduleReference": { "id": "<pageModuleId>", "metadata": {...} },
        "testStepValues": [{
          "id": "<ULID>",
          "name": "Accept Cookies",
          "value": "True",
          "actionMode": "Verify",
          "actionProperty": "Visible",
          "dataType": "String",
          "operator": "Equals",
          "moduleAttributeReference": { "id": "<attrId>", "moduleId": "<pageModuleId>", "metadata": {...} },
          "subValues": [],
          "disabled": false
        }]
      }
    ]
  },
  "conditionPassed": {
    "id": "<ULID>",
    "name": "Then",
    "disabled": false,
    "items": [ /* the original Click step */ ]
  }
}
```

Top-level keys: `$type`, `statementTypeV2` (`"If"`), `condition` (inline folder), `conditionPassed` (inline folder), `id`, `name`, `disabled`. No `conditionFailed` — just omit and nothing runs on the false branch.

Typical uses that have been verified in production:
- Cookie banner (OneTrust `#onetrust-accept-btn-handler`) — condition: Verify `Accept Cookies` Visible=True
- Leftover browser tab cleanup — condition: Verify a known nav element Visible=True; then: `CloseBrowser Title="*<AppName>*"`

### VJS probe — robust conditional CloseBrowser without a scanned module

When you need to conditionally close the browser but don't have (or don't want to depend on) a scanned Html module for the page, use a **VJS probe** as the `ControlFlowItemV2 If` condition instead of an Html-module Verify:

```json
{
  "$type": "ControlFlowItemV2",
  "statementTypeV2": "If",
  "name": "If <AppName> tab open – close it",
  "condition": {
    "items": [{
      "$type": "TestStepV2",
      "name": "Probe – <AppName> tab open?",
      "moduleReference": { "id": "<VJS-module-GUID>", "packageReference": {"id": "Html", "type": "Standard"}, "metadata": {"engine": "<tenant-engine-value>"} },
      "testStepValues": [
        { "name": "UseActiveTab", "value": "False", "actionMode": "Input", "dataType": "String" },
        { "name": "Title", "value": "*<AppName>*", "actionMode": "Input", "dataType": "String" },
        { "name": "JavaScript", "value": "return 'present'", "actionMode": "Input", "dataType": "String" },
        { "name": "Result", "value": "present", "actionMode": "Verify", "dataType": "String", "operator": "Equals" }
      ]
    }]
  },
  "conditionPassed": {
    "items": [/* CloseBrowser step */]
  }
}
```

**Why this works:** VJS with `UseActiveTab=False + Title=*<pattern>*` silently returns `""` (empty string) when no matching tab exists, instead of throwing an error like a GUI Html module would. The Result `Verify "present"` then fails → the If condition evaluates false → CloseBrowser is skipped. When a matching tab IS open, the JS runs and returns `"present"` → Verify passes → CloseBrowser executes.

**Advantage over Html-module Verify condition:** no scanned module or page element is needed; works immediately after Teardown closes the browser; handles the "fresh agent, no browser running at all" case cleanly without `UnestablishedConnectionException`.

## Debugging a failed run

1. `playlists results <runId>` returns only `<failure />`. No step-level logs exist via the Playlists v2 API.
2. Logs are stored in Azure Blob and fetched by the Portal via `/{spaceId}/_e2g/api/executions/{executionId}/units/{unitId}/attachments`, which returns SAS-signed URLs like:
   ```
   https://e2gweuprod001resblobs.blob.core.windows.net/<tenant-slug>/<spaceId>/<executionId>/<unitId>/logs?sv=…&se=…&sr=b&sp=r&sig=…
   ```
   SAS TTL ≈ 30 min. The blob GET takes **no Authorization header** — the SAS is the entire auth. Also available on the same endpoint: `TBoxResults.tas`, `TestSteps.json`, `Recording.mp4`, `junit_result_*.xml`.
3. The `Tricentis_Cloud_API` client app this CLI uses is **403'd** on that attachments endpoint today (no E2G role). Workarounds:
   - Grant the app E2G-read access (admin change on the tenant).
   - Copy the SAS URL from the Portal DevTools Network tab and `curl` it.
   - Re-run locally on an E2G agent: the same log mirrors at `C:\Users\<user>\AppData\Local\Temp\E2G\<runUuid>\…`.
3. Common error mapping:

   | TBox message | Likely cause | Fix |
   |--------------|-------------|-----|
   | `UnestablishedConnectionException` at CloseBrowser | No Chrome running on agent | Remove the cleanup step, or wrap in `If` + narrow `Title` |
   | `The Browser could not be found` | Tricentis Chrome extension not attached | Install/enable extension in agent's Chrome profile — not a test fix |
   | `More than one matching tab was found` | Agent shares user's Chrome; multiple tabs match | Add `Url=https://<host>*` TechnicalId at module level |
   | `Could not find HtmlDocument … Title: <pattern>` | Module-level selector doesn't match | Tighten/fix `Title`; add `Url` for host-scoped match |
   | `Could not find Link '…'` | Element locator ambiguous or DOM changed | Re-check via Playwright `browser_evaluate` + uniqueness count |

## Creation workflow

```bash
# 1. Playwright: snapshot page, verify element uniqueness with browser_evaluate
# 2. Check for existing module
tosca inventory search "<AppName>" --type Module

# 3. Create module (if none exists)
tosca modules create --name "<AppName> | <PageName>" --iface Gui --json
# Write module JSON file with Engine param at root level + attribute params
tosca modules update <moduleId> --json-file /tmp/module.json
tosca modules get <moduleId> --json   # verify

# 4. Create test case
tosca cases create --name "<description>" --state Planned --json
tosca cases update <caseId> --json-file /tmp/case.json
tosca cases steps <caseId>
tosca inventory move testCase <caseId> --folder-id <folderId>
```

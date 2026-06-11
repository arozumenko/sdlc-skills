# Live Interaction Patterns (Playwright MCP)

Recipes for driving a **running** web app through the Playwright MCP — no test
code. Each recipe is an explicit chain of `browser_*` tool calls. `target` is
the element ref from the **latest** `browser_snapshot` (a unique CSS selector
also works); always pass an `element` description alongside it.

## Contents

- [Interaction recipes](#interaction-recipes)
- [Framework-specific selector hints](#framework-specific-selector-hints)
- [Hybrid API + UI checks](#hybrid-api--ui-checks)
- [Screenshot convention](#screenshot-convention)
- [Common gotchas](#common-gotchas)

## Interaction recipes

### Verify a page loads
```
browser_navigate(url:"{{base_url}}/path")
browser_snapshot()                                  # confirm key elements exist
browser_take_screenshot(type:"png", filename:"reports/screenshots/{TC_ID}_{date}.png")
```

### Log in (do once; the MCP browser keeps the session)
```
browser_navigate(url:"{{base_url}}/login")
browser_snapshot()                                  # get the email / password / submit refs
browser_fill_form(fields=[
  {element:"Email field",    target:"<ref>", name:"Email",    type:"textbox", value:"qa@example.com"},
  {element:"Password field", target:"<ref>", name:"Password", type:"textbox", value:"Passw0rd!"},
])
browser_click(element:"Sign in button", target:"<ref>")
browser_wait_for(text:"Welcome back")               # app-side state, not a fixed sleep
browser_snapshot()                                  # assert authenticated UI
```
Don't re-login between steps of the same case unless the case says to.

### Submit a form
```
browser_snapshot()                                  # get field + submit refs
browser_fill_form(fields=[ …one entry per field… ]) # or browser_type per field
browser_click(element:"Submit button", target:"<ref>")
browser_wait_for(text:"Saved")                      # or textGone:"Saving…"
browser_snapshot()                                  # assert success state
browser_take_screenshot(type:"png", filename:"reports/screenshots/{TC_ID}_{date}.png")
```
Single field instead of a form: `browser_type(element, target, text:"…", submit:true)`
types and presses Enter in one call.

### Native dropdown (`<select>`)
```
browser_snapshot()
browser_select_option(element:"Priority select", target:"<ref>", values:["High"])
browser_snapshot()                                  # confirm the selection
```

### Custom dropdown / combobox (not a native `<select>`)
```
browser_snapshot()
browser_click(element:"Priority combobox", target:"<trigger ref>")   # open it
browser_snapshot()                                  # options are now in the tree
browser_click(element:"Option: High", target:"<option ref>")
```

### Drive an interactive element
```
browser_snapshot()
browser_click(element:"…", target:"<ref>")
browser_wait_for(text:"<expected change>")
browser_snapshot()                                  # assert new state
browser_console_messages(level:"error")             # catch silent failures
```

### Upload a file
```
browser_snapshot()
browser_click(element:"Choose file", target:"<ref>")   # opens the file chooser
browser_file_upload(paths:["/abs/path/to/file.png"])
browser_wait_for(text:"file.png")
```

### Handle a native JS dialog (alert / confirm / prompt)
```
browser_handle_dialog(accept:true)                   # or accept:false; promptText:"…" for prompts
```

## Framework-specific selector hints

When role + accessible name is ambiguous, pass one of these as `target` (a
unique selector is a valid `target`). Targets to look for per UI kit:

### MUI (Material-UI)
- **Select** (no `label-for`): `.MuiSelect-root` inside the field wrapping the
  label; options are `li[role='option']` by text.
- **Chip:** `.MuiChip-root` carrying the label. **Dialog:** `[role='dialog']`.
- **Autocomplete:** `.MuiAutocomplete-root input`; results `.MuiAutocomplete-option` by text.

### shadcn/ui
- **Command / Combobox:** input `[cmdk-input]`; items `[cmdk-item]` by text.
- **Select:** trigger `button[role='combobox']`; options `[role='option']`.
- **Dialog:** `[role='dialog']`. **Toast:** `[data-sonner-toast]`.

### Ant Design
- **Select:** trigger `.ant-select-selector`; options `.ant-select-item-option`.
- **Modal:** `.ant-modal-content`. **Table row:** `.ant-table-row`.

For custom selects/comboboxes, prefer the [custom dropdown
recipe](#custom-dropdown--combobox-not-a-native-select) over
`browser_select_option` (which only drives native `<select>`).

## Hybrid API + UI checks

When you need data in place fast, create it out-of-band and verify it in the
live UI:

```
(set up data via the app's API or a seeded account — outside the browser)
browser_navigate(url:"{{base_url}}/items/{id}")
browser_wait_for(text:"<item name>")
browser_snapshot()                                   # assert the item appears
browser_take_screenshot(type:"png", filename:"…")
(tear the data down the same way afterward)
```

Keep setup/teardown out of the browser; use the browser only for the
user-visible assertion.

## Screenshot convention

`browser_take_screenshot(type:"png", filename:"…")` — name by context + state:

```
reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png          # the case result
reports/screenshots/login-initial.png                  # exploratory (app-profiler)
reports/screenshots/login-error-invalid-password.png
```

Filenames are relative to the MCP output directory.

## Common gotchas

| Problem | Cause | Fix |
|---|---|---|
| Element not found | Acting on a stale ref | re-run `browser_snapshot`, use the fresh `target` |
| `target` rejected | Ref came from an earlier snapshot | snapshot again after every navigation/DOM change |
| Step "succeeds" but nothing happened | Waited on time, not state | `browser_wait_for(text:…)` / `(textGone:…)` instead of `(time:…)` |
| Auth lost mid-case | Session expired / navigated away | re-run the login recipe |
| Dialog blocks interaction (in-page modal) | Modal overlay intercepts clicks | act within `[role='dialog']`, or close it first |
| Native alert/confirm freezes the run | Unhandled JS dialog | `browser_handle_dialog(accept:…)` |
| `browser_select_option` does nothing | Element is a custom combobox, not `<select>` | use the custom-dropdown click recipe |
| UI looks fine but step "failed" | Silent JS/network error | `browser_console_messages(level:"error")` + `browser_network_requests` |

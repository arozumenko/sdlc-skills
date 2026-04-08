# Playwright Testing Patterns

## Page Object Model

Encapsulate page interactions in reusable classes:

```python
class LoginPage:
    def __init__(self, page):
        self.page = page

    def navigate(self):
        self.page.goto("/login")
        self.page.wait_for_load_state("networkidle")

    def login(self, email, password):
        self.page.fill('input[name="email"]', email)
        self.page.fill('input[name="password"]', password)
        self.page.click('button[type="submit"]')
        self.page.wait_for_url("**/dashboard")
```

## Fixture Strategy

### Session-Level (shared across all tests)
```python
@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    browser = pw.chromium.launch()
    yield browser
    browser.close()
    pw.stop()

@pytest.fixture(scope="session")
def auth_state(browser):
    context = browser.new_context()
    page = context.new_page()
    LoginPage(page).login("test@example.com", "password")
    state = context.storage_state()
    context.close()
    return state
```

### Per-Test (fresh isolation)
```python
@pytest.fixture
def context(browser, auth_state):
    ctx = browser.new_context(
        viewport={"width": 1920, "height": 1080},
        storage_state=auth_state,
    )
    yield ctx
    ctx.close()

@pytest.fixture
def page(context):
    page = context.new_page()
    yield page
    page.close()
```

## Framework-Specific Selectors

### MUI (Material-UI)
```python
# Select — no label-for association
page.locator("div:has(label:has-text('Priority')) >> .MuiSelect-root")

# Select option from dropdown
page.locator("li[role='option']:has-text('High')").click()

# Chip
page.locator(".MuiChip-root:has-text('draft')")

# Dialog
page.locator("[role='dialog']")

# Autocomplete
page.locator(".MuiAutocomplete-root input").fill("search")
page.locator(".MuiAutocomplete-option:has-text('result')").click()
```

### shadcn/ui
```python
# Command/Combobox
page.locator("[cmdk-input]").fill("search")
page.locator("[cmdk-item]:has-text('result')").click()

# Dialog
page.locator("[role='dialog']")

# Select
page.locator("button[role='combobox']").click()
page.locator("[role='option']:has-text('value')").click()

# Toast
page.locator("[data-sonner-toast]")
```

### Ant Design
```python
# Select
page.locator(".ant-select-selector").click()
page.locator(".ant-select-item-option:has-text('value')").click()

# Modal
page.locator(".ant-modal-content")

# Table row
page.locator(".ant-table-row").nth(0)
```

## Hybrid API + UI Testing

```python
def test_created_item_visible_in_ui(api_client, page):
    # Create via API (fast)
    item = api_client.post("/api/items", json={"name": "Test"}).json()

    # Verify in UI (realistic)
    page.goto(f"/items/{item['id']}")
    page.wait_for_load_state("networkidle")
    expect(page.locator("h1")).to_have_text("Test")

    # Cleanup via API
    api_client.delete(f"/api/items/{item['id']}")
```

## Screenshot Convention

```python
# Naming: {context}-{state}
page.screenshot(path="screenshots/login-initial.png")
page.screenshot(path="screenshots/login-error-invalid-password.png")
page.screenshot(path="screenshots/dashboard-loaded.png", full_page=True)
```

## Common Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| Element not found | Page hasn't loaded | `wait_for_load_state("networkidle")` |
| Click does nothing | Wrong element ref | Re-snapshot, verify ref |
| Flaky test | Race condition | Add explicit `wait_for(selector)` |
| Auth expires | Session-level fixture stale | Refresh `auth_state` |
| Dialog blocks interaction | Modal overlay | Close dialog first or interact within it |
| Dropdown not visible | Need to scroll | `element.scroll_into_view_if_needed()` |

# Mobile Locator Strategy Reference

## Appium Mode — Native iOS / Android

Pass locator strategy and value to `appium_find_element`.

### Priority Order

**iOS (XCUITest)**

| Priority | Strategy | appium_find_element value | How to get it |
|----------|----------|--------------------------|--------------|
| 1 | `accessibility id` | `"SignInButton"` | `accessibilityIdentifier` set in code |
| 2 | `predicate string` | `"type == 'XCUIElementTypeButton' AND label == 'Sign In'"` | Compose from page source |
| 3 | `class chain` | `"**/XCUIElementTypeButton[\`label == 'Sign In'\`]"` | Compose from page source |
| 4 | `xpath` | `"//XCUIElementTypeButton[@label='Sign In']"` | Last resort — slow |

**Android (UiAutomator2)**

| Priority | Strategy | appium_find_element value | How to get it |
|----------|----------|--------------------------|--------------|
| 1 | `accessibility id` | `"sign_in_btn"` | `contentDescription` set in code |
| 2 | `id` | `"com.example.app:id/sign_in_button"` | resource-id from page source |
| 3 | `-android uiautomator` | `"new UiSelector().text(\"Sign In\").className(\"android.widget.Button\")"` | Compose |
| 4 | `xpath` | `"//android.widget.Button[@text='Sign In']"` | Last resort — slow |

### Getting Locators in Practice

```
# 1. Get the full UI tree
appium_get_page_source → returns XML

# 2. Auto-generate reliable locators for all interactive elements
generate_locators → returns suggested locator map for current screen

# 3. Find element with best available strategy
appium_find_element → { strategy: "accessibility id", value: "SignInButton" }
```

Always try `generate_locators` first on a new screen — it uses Appium's intelligence to suggest the best available locators. Record the results in `.agents/mobile-qa/app_profile.md` under Reliable Locators.

### Cross-Platform Strategy

When test case `platform: both`, prefer **Accessibility ID** — the same logical name works on both platforms if developers set it consistently:
- iOS: `accessibilityIdentifier = "SignInButton"`
- Android: `contentDescription = "SignInButton"` (or `android:contentDescription`)

Document the agreed Accessibility ID in `app_profile.md`:
```
| Sign In button | accessibility id: "SignInButton" | Login | verified both platforms |
```

---

## Playwright Mode — PWA / Hybrid

Standard web locators. Prefer in order:

1. `data-testid` / `data-qa` / `data-cy`
2. ARIA role + accessible name: `role=button[name="Sign In"]`
3. Visible text: `text=Sign In`
4. `name` attribute (form fields)
5. Stable CSS class
6. XPath (last resort)

**Mobile web note:** Touch targets are often larger wrappers. If a text locator fails on a mobile viewport, try the parent `<button>` or `<a>` with the same accessible name.

---

## Manual Mode — Element Descriptions in Guides

Describe elements visually so a human can find them without any tooling:

| ✅ Good | ❌ Bad |
|--------|--------|
| "the blue **Sign In** button at the bottom of the screen" | "the submit button" |
| "the **☰ hamburger icon** in the top-left corner" | "the menu" |
| "the search field in the navigation bar at the top" | "the search input" |
| "the **red × Delete** label that appears when you swipe left on a row" | "the delete action" |

---

## Fragile Patterns to Avoid (All Modes)

| Pattern | Why it breaks |
|---------|--------------|
| XPath with positional index `[2]` | Order changes with UI updates |
| Dynamic resource IDs (`btn_12345`) | Generated at runtime |
| Text locators with translated strings | Fails on non-English locales |
| Coordinate-based taps (`tap at 200,400`) | Breaks on different screen sizes |
| Auto-generated CSS class names (Appium web view) | Breaks on CSS-in-JS rebuild |
| XCUIElementTypeOther with no attributes | Matches dozens of elements |

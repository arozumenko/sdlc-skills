---
name: browser-verify
description: >
  Testing-grade browser automation via Chrome DevTools Protocol (CDP). Direct
  access to the browser's DOM, JS runtime, network layer, cookies, computed
  styles, and console — without any external dependencies. Complements MCP-based
  tools by enabling arbitrary JS evaluation in page context and deep inspection
  that screenshot-only tools miss. Use when you need to: run JS in the page,
  inspect cookies/localStorage, check computed styles, enumerate third-party
  scripts, emulate devices, analyze network timing, or interact via real mouse
  and keyboard events.
license: Apache-2.0
compatibility: Requires Chrome/Chromium and Node 22+. No npm install needed.
metadata:
  author: octobots
  version: "0.1.0"
---

# Browser Verify

Testing-grade browser automation using Chrome controlled through the Chrome DevTools
Protocol. All interactions use real CDP `Input` domain events (mouse coordinates,
key events) — not synthetic JS `.click()`. Zero external dependencies beyond
Node 22's built-in WebSocket.

## Architecture

Scripts live in the `scripts/` directory alongside this SKILL.md:

- **`chrome-launcher.sh`** — Start/stop/status Chrome with remote debugging
- **`cdp.mjs`** — Full CDP client with 50+ commands

No npm install required. Uses Node 22 built-in `WebSocket`.

## Resolving Script Paths

The scripts are in the `scripts/` subdirectory of this skill. Resolve the path
from your `.claude/skills/browser-verify/` install location or the octobots
symlink — both work the same way:

```bash
# Works for both npx-installed and symlinked:
SCRIPTS=".claude/skills/browser-verify/scripts"   # npx skills add
SCRIPTS="octobots/skills/browser-verify/scripts"  # symlinked install

bash "$SCRIPTS/chrome-launcher.sh" start --headless
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
```

## Workflow

### 1. Start Chrome

```bash
bash "$SCRIPTS/chrome-launcher.sh" start
# Headless (no window, faster):
bash "$SCRIPTS/chrome-launcher.sh" start --headless
```

### 2. Run Commands

```bash
node "$SCRIPTS/cdp.mjs" <command> [args] [--flags]
```

### 3. Stop Chrome

```bash
bash "$SCRIPTS/chrome-launcher.sh" stop
```

## Command Reference

### Navigation

| Command | Example | Purpose |
|---------|---------|---------|
| `navigate <url>` | `navigate "https://example.com"` | Open URL, wait for load |
| `reload` | `reload` | Reload current page |
| `back` | `back` | Browser back |
| `forward` | `forward` | Browser forward |
| `page-info` | `page-info` | Title, URL, counts, viewport, meta |
| `list-targets` | `list-targets` | List open tabs |
| `new-tab [url]` | `new-tab "https://example.com/about"` | Open new tab |
| `close-tab [id]` | `close-tab` | Close tab |

### Visual

| Command | Example | Purpose |
|---------|---------|---------|
| `screenshot` | `screenshot --output /tmp/page.png` | Full page capture |
| `screenshot --selector <s>` | `screenshot --selector ".card"` | Element capture |
| `screenshot --full` | `screenshot --full --output /tmp/full.png` | Beyond viewport |
| `viewport <w> <h>` | `viewport 375 812` | Set viewport size |
| `pdf` | `pdf --output /tmp/page.pdf` | Save as PDF |
| `emulate <device>` | `emulate mobile` | Device emulation |

Available devices: `mobile`, `iphone`, `ipad`, `tablet`, `android`, `desktop`, `laptop`

### DOM Inspection

| Command | Example | Purpose |
|---------|---------|---------|
| `evaluate <js>` | `evaluate "document.title"` | Run JS in page context |
| `get-html [--selector s]` | `get-html --selector "#app"` | Get outerHTML |
| `get-text [--selector s]` | `get-text --selector ".message"` | Get textContent |
| `get-attribute <sel> <attr>` | `get-attribute "a" "href"` | Get attribute |
| `get-value <sel>` | `get-value "input[name=email]"` | Get input value |
| `get-styles <sel>` | `get-styles ".btn" --props "color,fontSize"` | Computed styles |
| `query-all <sel>` | `query-all "li.item"` | Info on all matches |

### Interaction (Real CDP Input Events)

| Command | Example | Purpose |
|---------|---------|---------|
| `click <sel>` | `click "button.submit"` | Left click |
| `click <sel> --button right` | `click ".menu" --button right` | Right click |
| `click <sel> --count 2` | `click ".item" --count 2` | Double click |
| `hover <sel>` | `hover ".tooltip-trigger"` | Mouse hover |
| `type <sel> <text>` | `type "#email" "test@test.com"` | Type text |
| `type <sel> <text> --clear` | `type "#search" "new query" --clear` | Clear then type |
| `press <key>` | `press Enter` | Press key |
| `press <key> --modifiers "ctrl"` | `press a --modifiers "ctrl"` | Key combo |
| `clear <sel>` | `clear "#search"` | Clear input field |
| `focus <sel>` | `focus "#input"` | Focus element |
| `blur <sel>` | `blur "#input"` | Blur element |
| `select <sel> <value>` | `select "#country" "US"` | Select dropdown |
| `check <sel>` | `check "#agree"` | Check checkbox |
| `uncheck <sel>` | `uncheck "#newsletter"` | Uncheck checkbox |
| `scroll <sel>` | `scroll ".footer"` | Scroll to element |
| `scroll --x 0 --y 500` | `scroll --x 0 --y 500` | Scroll to coords |
| `drag <from> <to>` | `drag ".item" ".dropzone"` | Drag and drop |
| `upload <sel> <path>` | `upload "#file" "/tmp/doc.pdf"` | File upload |

### Waiting

| Command | Example | Purpose |
|---------|---------|---------|
| `wait <sel>` | `wait ".loaded"` | Wait for DOM element |
| `wait-visible <sel>` | `wait-visible ".modal"` | Wait until visible |
| `wait-hidden <sel>` | `wait-hidden ".spinner"` | Wait until hidden |
| `wait-text <text>` | `wait-text "Success"` | Wait for text on page |
| `wait-url <pattern>` | `wait-url "/dashboard"` | Wait for URL change |
| `wait-network-idle` | `wait-network-idle` | Wait for no requests |
| `sleep <ms>` | `sleep 1000` | Fixed delay |

All wait commands accept `--timeout <ms>` (default 10000).

### Debugging

| Command | Example | Purpose |
|---------|---------|---------|
| `get-console` | `get-console` | All console messages |
| `get-network` | `get-network` | Network requests + timing |
| `get-network --status 4xx` | `get-network --status error` | Filter by status (4xx, 5xx, error, or exact code) |
| `get-network --type xhr` | `get-network --type fetch` | Filter by initiator type |
| `get-cookies` | `get-cookies` | All cookies |
| `set-cookie <n> <v>` | `set-cookie "token" "abc" --domain localhost` | Set cookie |
| `clear-cookies` | `clear-cookies` | Clear all cookies |

### QA Inspection

| Command | Example | Purpose |
|---------|---------|---------|
| `get-storage` | `get-storage` | localStorage + sessionStorage combined |
| `get-performance` | `get-performance` | Timing, resource sizes, LCP/FID/CLS |
| `get-meta` | `get-meta` | Meta tags, OG, Twitter cards, structured data |
| `inject-axe` | `inject-axe` | Run axe-core WCAG 2.x audit, returns violations |
| `inject-axe --selector s` | `inject-axe --selector "main"` | Scope axe to a subtree |

## Common Patterns

### Login Flow

```bash
node "$SCRIPTS/cdp.mjs" navigate "https://app.example.com/login"
node "$SCRIPTS/cdp.mjs" type "#email" "user@test.com" --clear
node "$SCRIPTS/cdp.mjs" type "#password" "pass123" --clear
node "$SCRIPTS/cdp.mjs" click "button[type=submit]"
node "$SCRIPTS/cdp.mjs" wait-url "/dashboard" --timeout 5000
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/dashboard.png
```

### Responsive Verification

```bash
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
node "$SCRIPTS/cdp.mjs" emulate mobile
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/mobile.png
node "$SCRIPTS/cdp.mjs" emulate desktop
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/desktop.png
```

### Privacy Inspection

```bash
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
node "$SCRIPTS/cdp.mjs" get-cookies
node "$SCRIPTS/cdp.mjs" get-storage
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify([...document.querySelectorAll('script[src]')].map(s=>s.src))"
```

### Accessibility Audit (axe-core)

```bash
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
node "$SCRIPTS/cdp.mjs" inject-axe
# Scope to main content only:
node "$SCRIPTS/cdp.mjs" inject-axe --selector "main"
```

### Performance Snapshot

```bash
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
node "$SCRIPTS/cdp.mjs" get-performance
# Check for failed requests:
node "$SCRIPTS/cdp.mjs" get-network --status error
```

### SEO / Meta Audit

```bash
node "$SCRIPTS/cdp.mjs" navigate "https://example.com"
node "$SCRIPTS/cdp.mjs" get-meta
```

## Notes

- Always start Chrome before running commands; stop when done
- Screenshots saved as PNG — use Read tool to view them
- All `click`/`type`/`hover` use real CDP Input events at element coordinates
- Elements are automatically scrolled into view before interaction
- `type --clear` uses Select All + Delete before typing (framework-safe)
- Console/network capture is per-session (per `navigate` call)

## Reference

See `references/cdp-commands.md` for extended evaluate patterns, QA-specific
inspection scripts, and troubleshooting.

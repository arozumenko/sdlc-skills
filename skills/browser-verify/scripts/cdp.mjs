/**
 * Chrome DevTools Protocol client — testing-grade browser interactions.
 * Zero dependencies — uses Node 22 built-in WebSocket + fetch.
 *
 * Usage:
 *   node cdp.mjs <command> [args] [--flags]
 *
 * Navigation:
 *   navigate <url>                          - Navigate and wait for load
 *   reload                                  - Reload current page
 *   back                                    - Go back in history
 *   forward                                 - Go forward in history
 *   page-info                               - Page title, URL, meta, counts
 *   list-targets                            - List browser tabs
 *   new-tab [url]                           - Open new tab
 *   close-tab [targetId]                    - Close a tab
 *
 * Visual:
 *   screenshot [--selector s] [--full] [--output path]
 *   viewport <width> <height>               - Set viewport size
 *   pdf [--output path]                     - Save page as PDF
 *
 * DOM:
 *   get-html [--selector s]                 - Get outerHTML
 *   get-text [--selector s]                 - Get textContent
 *   get-attribute <selector> <attr>         - Get element attribute
 *   get-value <selector>                    - Get input value
 *   get-styles <selector> [--props "a,b"]   - Get computed styles
 *   query-all <selector>                    - Get info on all matching elements
 *   evaluate <expression>                   - Run JS in page context
 *
 * Interaction (real CDP Input events):
 *   click <selector> [--button left|right|middle] [--count 2]
 *   hover <selector>                        - Mouse hover
 *   type <selector> <text> [--clear] [--delay ms]
 *   press <key> [--modifiers "ctrl,shift"]  - Press keyboard key
 *   clear <selector>                        - Clear input field
 *   focus <selector>                        - Focus element
 *   blur <selector>                         - Blur element
 *   select <selector> <value>               - Select dropdown option by value
 *   check <selector>                        - Check checkbox/radio
 *   uncheck <selector>                      - Uncheck checkbox
 *   scroll <selector|--x N --y N>           - Scroll to element or coordinates
 *   drag <fromSelector> <toSelector>        - Drag and drop
 *   upload <selector> <filePath>            - File input upload
 *
 * Waiting:
 *   wait <selector> [--timeout ms]          - Wait for element in DOM
 *   wait-visible <selector> [--timeout ms]  - Wait for element visible
 *   wait-hidden <selector> [--timeout ms]   - Wait for element hidden
 *   wait-text <text> [--timeout ms]         - Wait for text on page
 *   wait-url <urlPattern> [--timeout ms]    - Wait for URL change
 *   wait-network-idle [--timeout ms]        - Wait for no network activity
 *   sleep <ms>                              - Fixed delay
 *
 * Debugging:
 *   get-console                             - Captured console messages
 *   get-network [--status 4xx|5xx|error|N] [--type xhr|fetch|script|image|…]
 *   get-cookies [--url u]                   - Get cookies
 *   set-cookie <name> <value> [--domain d]  - Set a cookie
 *   clear-cookies                           - Clear all cookies
 *   emulate <device>                        - Emulate device (mobile, tablet)
 *
 * QA Inspection:
 *   get-storage                             - localStorage + sessionStorage combined
 *   get-performance                         - Timing, resource sizes, Core Web Vitals
 *   get-meta                                - Meta tags, OG, Twitter cards, structured data
 *   inject-axe [--selector s]              - Inject axe-core and run WCAG 2.x audit
 */

const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';

let ws = null;
let msgId = 0;
const pending = new Map();
const consoleMessages = [];
const networkRequests = [];
let networkInFlight = 0;

// ── Core ──

async function getTargets() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
  return res.json();
}

async function getWsUrl(targetId) {
  if (targetId) {
    const targets = await getTargets();
    const t = targets.find(t => t.id === targetId);
    if (t) return t.webSocketDebuggerUrl;
    throw new Error(`Target ${targetId} not found`);
  }
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  if (page) return page.webSocketDebuggerUrl;
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new`);
  const newTarget = await res.json();
  return newTarget.webSocketDebuggerUrl;
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket error: ${e.message || 'connection failed'}`)));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
      if (msg.method === 'Console.messageAdded') {
        consoleMessages.push(msg.params.message);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleMessages.push({
          type: msg.params.type,
          text: msg.params.args.map(a => a.value || a.description || '').join(' '),
          timestamp: msg.params.timestamp,
        });
      }
      if (msg.method === 'Network.requestWillBeSent') {
        networkInFlight++;
        networkRequests.push({
          url: msg.params.request.url,
          method: msg.params.request.method,
          type: msg.params.type,
          requestId: msg.params.requestId,
          timestamp: msg.params.timestamp,
        });
      }
      if (msg.method === 'Network.responseReceived') {
        const req = networkRequests.find(r => r.requestId === msg.params.requestId);
        if (req) {
          req.status = msg.params.response.status;
          req.statusText = msg.params.response.statusText;
          req.mimeType = msg.params.response.mimeType;
        }
      }
      if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
        networkInFlight = Math.max(0, networkInFlight - 1);
      }
    });
  });
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP call ${method} timed out after 30s`));
      }
    }, 30000);
  });
}

function close() {
  if (ws) ws.close();
}

async function initSession(targetId) {
  const wsUrl = await getWsUrl(targetId);
  await connectWs(wsUrl);
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  await send('DOM.enable');
  await send('Input.enable').catch(() => {}); // Some versions don't need explicit enable
}

async function evalJs(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    generatePreview: true,
  });
  if (result.exceptionDetails) {
    return { error: true, exception: result.exceptionDetails.text, description: result.result?.description };
  }
  return { type: result.result.type, subtype: result.result.subtype, value: result.result.value, description: result.result.description };
}

async function evalJsJson(expression) {
  const result = await evalJs(expression);
  if (result.error) return result;
  if (typeof result.value === 'string') {
    try { return JSON.parse(result.value); } catch {}
  }
  return result.value;
}

// Get element center coordinates for real input events
async function getElementCenter(selector) {
  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return JSON.stringify({ error: 'Element has zero size: ${selector.replace(/'/g, "\\'")}' });
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height, tag: el.tagName, visible: r.width > 0 && r.height > 0 });
  })()`);
  if (result.error) throw new Error(result.error);
  return result;
}

// Scroll element into view first
async function scrollIntoView(selector) {
  await evalJs(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })`);
  await new Promise(r => setTimeout(r, 100));
}

// ── Navigation ──

async function navigate(url, targetId) {
  await initSession(targetId);
  const navResult = await send('Page.navigate', { url });
  await waitForLoad();
  const info = await evalJsJson(`JSON.stringify({ title: document.title, url: location.href, readyState: document.readyState })`);
  close();
  return { navigated: true, frameId: navResult.frameId, ...info };
}

async function reload(targetId) {
  await initSession(targetId);
  await send('Page.reload');
  await waitForLoad();
  const info = await evalJsJson(`JSON.stringify({ title: document.title, url: location.href })`);
  close();
  return { reloaded: true, ...info };
}

async function goBack(targetId) {
  await initSession(targetId);
  const history = await send('Page.getNavigationHistory');
  if (history.currentIndex > 0) {
    const entry = history.entries[history.currentIndex - 1];
    await send('Page.navigateToHistoryEntry', { entryId: entry.id });
    await waitForLoad();
  }
  const info = await evalJsJson(`JSON.stringify({ title: document.title, url: location.href })`);
  close();
  return { back: true, ...info };
}

async function goForward(targetId) {
  await initSession(targetId);
  const history = await send('Page.getNavigationHistory');
  if (history.currentIndex < history.entries.length - 1) {
    const entry = history.entries[history.currentIndex + 1];
    await send('Page.navigateToHistoryEntry', { entryId: entry.id });
    await waitForLoad();
  }
  const info = await evalJsJson(`JSON.stringify({ title: document.title, url: location.href })`);
  close();
  return { forward: true, ...info };
}

async function waitForLoad() {
  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      if (msg.method === 'Page.loadEventFired') {
        ws.removeEventListener('message', handler);
        resolve();
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(resolve, 15000);
  });
  await new Promise(r => setTimeout(r, 300));
}

// ── Visual ──

async function screenshot(opts = {}) {
  const { selector, full, targetId, outputPath } = opts;
  const wsUrl = await getWsUrl(targetId);
  await connectWs(wsUrl);

  let clip;
  if (selector) {
    await scrollIntoView(selector);
    const box = await evalJsJson(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ error: 'Element not found' });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
    })()`);
    if (box.error) { close(); return box; }
    clip = { ...box, scale: 2 };
  }

  const params = { format: 'png', quality: 90 };
  if (full) params.captureBeyondViewport = true;
  if (clip) params.clip = clip;

  const result = await send('Page.captureScreenshot', params);
  close();

  const outFile = outputPath || `/tmp/cdp-screenshot-${Date.now()}.png`;
  const fs = await import('fs');
  fs.writeFileSync(outFile, Buffer.from(result.data, 'base64'));
  return { saved: outFile, size: result.data.length };
}

async function setViewport(width, height, targetId) {
  await initSession(targetId);
  await send('Emulation.setDeviceMetricsOverride', {
    width: parseInt(width),
    height: parseInt(height),
    deviceScaleFactor: 2,
    mobile: parseInt(width) < 768,
  });
  const info = await evalJsJson(`JSON.stringify({ viewport: { width: window.innerWidth, height: window.innerHeight } })`);
  close();
  return { viewportSet: true, ...info };
}

async function savePdf(opts = {}) {
  const { targetId, outputPath } = opts;
  await initSession(targetId);
  const result = await send('Page.printToPDF', {
    landscape: false,
    printBackground: true,
    preferCSSPageSize: true,
  });
  close();
  const outFile = outputPath || `/tmp/cdp-page-${Date.now()}.pdf`;
  const fs = await import('fs');
  fs.writeFileSync(outFile, Buffer.from(result.data, 'base64'));
  return { saved: outFile };
}

// ── DOM ──

async function evaluate(expression, targetId) {
  await initSession(targetId);
  const result = await evalJs(expression);
  close();
  return result;
}

async function getHtml(selector, targetId) {
  const expr = selector
    ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || 'Element not found'`
    : `document.documentElement.outerHTML`;
  return evaluate(expr, targetId);
}

async function getText(selector, targetId) {
  const expr = selector
    ? `document.querySelector(${JSON.stringify(selector)})?.textContent || 'Element not found'`
    : `document.body.textContent`;
  return evaluate(expr, targetId);
}

async function getAttribute(selector, attr, targetId) {
  return evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attr)})`, targetId);
}

async function getValue(selector, targetId) {
  return evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`, targetId);
}

async function getStyles(selector, props, targetId) {
  const propsArg = props ? JSON.stringify(props.split(',').map(p => p.trim())) : 'null';
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'Element not found';
    const cs = getComputedStyle(el);
    const keys = ${propsArg} || ['display','position','color','backgroundColor','fontSize','fontWeight','width','height','margin','padding','border','opacity','visibility','overflow','zIndex'];
    const result = {};
    for (const k of keys) result[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
    return JSON.stringify(result);
  })()`, targetId);
}

async function queryAll(selector, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((el, i) => {
    const r = el.getBoundingClientRect();
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: el.className || undefined,
      text: el.textContent?.trim().slice(0, 120) || undefined,
      value: el.value !== undefined ? el.value : undefined,
      href: el.href || undefined,
      src: el.src || undefined,
      type: el.type || undefined,
      checked: el.checked !== undefined ? el.checked : undefined,
      disabled: el.disabled || undefined,
      visible: r.width > 0 && r.height > 0,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }))`);
  close();
  return { selector, count: Array.isArray(result) ? result.length : 0, elements: result };
}

async function getPageInfo(targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`JSON.stringify({
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    doctype: document.doctype ? document.doctype.name : null,
    charset: document.characterSet,
    contentType: document.contentType,
    elementCount: document.querySelectorAll('*').length,
    forms: document.forms.length,
    links: document.links.length,
    images: document.images.length,
    scripts: document.scripts.length,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollPosition: { x: window.scrollX, y: window.scrollY },
    bodySize: { width: document.body.scrollWidth, height: document.body.scrollHeight },
    errors: window.__cdp_errors || [],
    meta: Array.from(document.querySelectorAll('meta')).map(m => ({
      name: m.name || m.httpEquiv || m.getAttribute('property'),
      content: m.content
    })).filter(m => m.name)
  })`);
  close();
  return result;
}

// ── Interaction — real CDP Input events ──

async function clickElement(selector, opts = {}) {
  const { button = 'left', count = 1, targetId } = opts;
  await initSession(targetId);
  await scrollIntoView(selector);
  const pos = await getElementCenter(selector);

  const buttonMap = { left: 'left', right: 'right', middle: 'middle' };
  const cdpButton = buttonMap[button] || 'left';
  const clickCount = parseInt(count);

  // Move to element
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: pos.x, y: pos.y,
  });

  for (let i = 0; i < clickCount; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: pos.x, y: pos.y,
      button: cdpButton, clickCount: i + 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: pos.x, y: pos.y,
      button: cdpButton, clickCount: i + 1,
    });
  }

  await new Promise(r => setTimeout(r, 100));

  // Get post-click info
  const info = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return JSON.stringify({
      clicked: true, tag: el?.tagName, text: el?.textContent?.trim().slice(0, 100),
      url: location.href, title: document.title,
    });
  })()`);

  close();
  return info;
}

async function hoverElement(selector, targetId) {
  await initSession(targetId);
  await scrollIntoView(selector);
  const pos = await getElementCenter(selector);

  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: pos.x, y: pos.y,
  });
  await new Promise(r => setTimeout(r, 200));

  // Capture any hover-triggered content
  const info = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const tooltip = document.querySelector('[role="tooltip"], .tooltip, [class*="tooltip"], [class*="popover"]');
    return JSON.stringify({
      hovered: true, tag: el?.tagName, text: el?.textContent?.trim().slice(0, 100),
      tooltip: tooltip?.textContent?.trim().slice(0, 200) || null,
    });
  })()`);

  close();
  return info;
}

async function typeText(selector, text, opts = {}) {
  const { clear = false, delay = 0, targetId } = opts;
  await initSession(targetId);
  await scrollIntoView(selector);

  // Click to focus
  const pos = await getElementCenter(selector);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 50));

  if (clear) {
    // Select all + delete
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: getModifierBit('ctrl') });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
    await new Promise(r => setTimeout(r, 50));
  }

  // Type each character with proper key events
  const delayMs = parseInt(delay) || 0;
  for (const char of text) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', text: char, key: char, unmodifiedText: char,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: char,
    });
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  // Also fire input/change to ensure frameworks pick it up
  await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);

  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return JSON.stringify({ typed: true, value: el?.value, tag: el?.tagName });
  })()`);

  close();
  return result;
}

function getModifierBit(mod) {
  const bits = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  if (typeof mod === 'string') {
    return mod.split(',').reduce((acc, m) => acc | (bits[m.trim().toLowerCase()] || 0), 0);
  }
  return 0;
}

const KEY_MAP = {
  'enter':     { key: 'Enter',     code: 'Enter' },
  'tab':       { key: 'Tab',       code: 'Tab' },
  'escape':    { key: 'Escape',    code: 'Escape' },
  'esc':       { key: 'Escape',    code: 'Escape' },
  'backspace': { key: 'Backspace', code: 'Backspace' },
  'delete':    { key: 'Delete',    code: 'Delete' },
  'space':     { key: ' ',         code: 'Space' },
  'arrowup':   { key: 'ArrowUp',   code: 'ArrowUp' },
  'arrowdown': { key: 'ArrowDown', code: 'ArrowDown' },
  'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft' },
  'arrowright':{ key: 'ArrowRight',code: 'ArrowRight' },
  'home':      { key: 'Home',      code: 'Home' },
  'end':       { key: 'End',       code: 'End' },
  'pageup':    { key: 'PageUp',    code: 'PageUp' },
  'pagedown':  { key: 'PageDown',  code: 'PageDown' },
  'f1':        { key: 'F1',        code: 'F1' },
  'f2':        { key: 'F2',        code: 'F2' },
  'f5':        { key: 'F5',        code: 'F5' },
  'f11':       { key: 'F11',       code: 'F11' },
  'f12':       { key: 'F12',       code: 'F12' },
};

async function pressKey(keyName, opts = {}) {
  const { modifiers, targetId } = opts;
  await initSession(targetId);

  const mapped = KEY_MAP[keyName.toLowerCase()] || { key: keyName, code: `Key${keyName.toUpperCase()}` };
  const modBits = modifiers ? getModifierBit(modifiers) : 0;

  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: mapped.key, code: mapped.code, modifiers: modBits,
    text: mapped.key.length === 1 ? mapped.key : '',
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: mapped.key, code: mapped.code, modifiers: 0,
  });

  close();
  return { pressed: true, key: mapped.key, modifiers: modifiers || 'none' };
}

async function clearInput(selector, targetId) {
  await initSession(targetId);
  await scrollIntoView(selector);

  // Triple-click to select all, then delete
  const pos = await getElementCenter(selector);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 3 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 3 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });

  // Also force clear value for frameworks
  await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) {
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSet) nativeSet.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);

  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return JSON.stringify({ cleared: true, value: el?.value });
  })()`);

  close();
  return result;
}

async function focusElement(selector, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ error: 'Element not found' });
    el.focus();
    return JSON.stringify({ focused: true, tag: el.tagName, activeElement: document.activeElement?.tagName });
  })()`);
  close();
  return result;
}

async function blurElement(selector, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ error: 'Element not found' });
    el.blur();
    return JSON.stringify({ blurred: true, tag: el.tagName });
  })()`);
  close();
  return result;
}

async function selectOption(selector, value, targetId) {
  await initSession(targetId);
  await scrollIntoView(selector);

  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ error: 'Element not found' });
    if (el.tagName !== 'SELECT') return JSON.stringify({ error: 'Element is not a <select>' });
    const opts = Array.from(el.options);
    const opt = opts.find(o => o.value === ${JSON.stringify(value)}) || opts.find(o => o.textContent.trim() === ${JSON.stringify(value)});
    if (!opt) return JSON.stringify({ error: 'Option not found: ${value}', available: opts.map(o => ({ value: o.value, text: o.textContent.trim() })) });
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ selected: true, value: el.value, text: opt.textContent.trim() });
  })()`);

  close();
  return result;
}

async function checkElement(selector, targetId) {
  await initSession(targetId);
  await scrollIntoView(selector);

  const isChecked = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ error: 'Element not found' });
    return JSON.stringify({ checked: el.checked, tag: el.tagName, type: el.type });
  })()`);

  if (isChecked.error) { close(); return isChecked; }
  if (isChecked.checked) { close(); return { checked: true, wasAlready: true }; }

  // Click it with real mouse event
  const pos = await getElementCenter(selector);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });

  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return JSON.stringify({ checked: el.checked });
  })()`);

  close();
  return result;
}

async function uncheckElement(selector, targetId) {
  await initSession(targetId);
  await scrollIntoView(selector);

  const isChecked = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ error: 'Element not found' });
    return JSON.stringify({ checked: el.checked });
  })()`);

  if (isChecked.error) { close(); return isChecked; }
  if (!isChecked.checked) { close(); return { unchecked: true, wasAlready: true }; }

  const pos = await getElementCenter(selector);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });

  const result = await evalJsJson(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return JSON.stringify({ unchecked: !el.checked });
  })()`);

  close();
  return result;
}

async function scrollTo(opts = {}) {
  const { selector, x, y, targetId } = opts;
  await initSession(targetId);

  if (selector) {
    await evalJs(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', behavior: 'smooth' })`);
    await new Promise(r => setTimeout(r, 300));
    const result = await evalJsJson(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = el?.getBoundingClientRect();
      return JSON.stringify({ scrolled: true, scrollY: window.scrollY, elementInView: r ? (r.top >= 0 && r.bottom <= window.innerHeight) : false });
    })()`);
    close();
    return result;
  }

  await evalJs(`window.scrollTo(${parseInt(x) || 0}, ${parseInt(y) || 0})`);
  await new Promise(r => setTimeout(r, 300));
  const result = await evalJsJson(`JSON.stringify({ scrolled: true, scrollX: window.scrollX, scrollY: window.scrollY })`);
  close();
  return result;
}

async function dragDrop(fromSelector, toSelector, targetId) {
  await initSession(targetId);
  await scrollIntoView(fromSelector);
  const from = await getElementCenter(fromSelector);
  const to = await getElementCenter(toSelector);

  // Mouse down on source
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 100));

  // Move in steps for smooth drag
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const px = from.x + (to.x - from.x) * (i / steps);
    const py = from.y + (to.y - from.y) * (i / steps);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
    await new Promise(r => setTimeout(r, 20));
  }

  // Release on target
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 100));

  close();
  return { dragged: true, from: fromSelector, to: toSelector };
}

async function uploadFile(selector, filePath, targetId) {
  await initSession(targetId);

  // Get the DOM node for the file input
  const nodeResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      if (el.tagName !== 'INPUT' || el.type !== 'file') return 'not-file-input';
      return 'ok';
    })()`,
    returnByValue: true,
  });

  if (!nodeResult.result.value || nodeResult.result.value === 'not-file-input') {
    close();
    return { error: nodeResult.result.value ? 'Element is not a file input' : 'Element not found' };
  }

  // Use DOM.querySelector + DOM.setFileInputFiles
  const doc = await send('DOM.getDocument');
  const nodeId = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId: nodeId.nodeId, files: [filePath] });

  // Trigger change event
  await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  close();
  return { uploaded: true, selector, file: filePath };
}

// ── Waiting ──

async function waitForElement(selector, timeout = 10000, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`new Promise((resolve) => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el) return resolve(JSON.stringify({ found: true, tag: el.tagName, text: el.textContent?.trim().slice(0, 200) }));
    const observer = new MutationObserver(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) { observer.disconnect(); resolve(JSON.stringify({ found: true, tag: el.tagName, text: el.textContent?.trim().slice(0, 200) })); }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    setTimeout(() => { observer.disconnect(); resolve(JSON.stringify({ found: false, timeout: true })); }, ${timeout});
  })`);
  close();
  return result;
}

async function waitForVisible(selector, timeout = 10000, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`new Promise((resolve) => {
    const check = () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0')
          return { visible: true, tag: el.tagName };
      }
      return null;
    };
    const r = check();
    if (r) return resolve(JSON.stringify(r));
    const observer = new MutationObserver(() => {
      const r = check();
      if (r) { observer.disconnect(); resolve(JSON.stringify(r)); }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    setTimeout(() => { observer.disconnect(); resolve(JSON.stringify({ visible: false, timeout: true })); }, ${timeout});
  })`);
  close();
  return result;
}

async function waitForHidden(selector, timeout = 10000, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`new Promise((resolve) => {
    const check = () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { hidden: true, reason: 'removed' };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0')
        return { hidden: true, reason: 'not-visible' };
      return null;
    };
    const r = check();
    if (r) return resolve(JSON.stringify(r));
    const observer = new MutationObserver(() => {
      const r = check();
      if (r) { observer.disconnect(); resolve(JSON.stringify(r)); }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    setTimeout(() => { observer.disconnect(); resolve(JSON.stringify({ hidden: false, timeout: true })); }, ${timeout});
  })`);
  close();
  return result;
}

async function waitForText(text, timeout = 10000, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`new Promise((resolve) => {
    if (document.body.textContent.includes(${JSON.stringify(text)})) return resolve(JSON.stringify({ found: true }));
    const observer = new MutationObserver(() => {
      if (document.body.textContent.includes(${JSON.stringify(text)})) {
        observer.disconnect();
        resolve(JSON.stringify({ found: true }));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { observer.disconnect(); resolve(JSON.stringify({ found: false, timeout: true })); }, ${timeout});
  })`);
  close();
  return result;
}

async function waitForUrl(pattern, timeout = 10000, targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`new Promise((resolve) => {
    const check = () => location.href.includes(${JSON.stringify(pattern)}) || new RegExp(${JSON.stringify(pattern)}).test(location.href);
    if (check()) return resolve(JSON.stringify({ matched: true, url: location.href }));
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); resolve(JSON.stringify({ matched: true, url: location.href })); }
    }, 200);
    setTimeout(() => { clearInterval(interval); resolve(JSON.stringify({ matched: false, timeout: true, url: location.href })); }, ${timeout});
  })`);
  close();
  return result;
}

async function waitForNetworkIdle(timeout = 10000, targetId) {
  await initSession(targetId);
  // Wait until no network requests in-flight for 500ms
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (networkInFlight === 0) {
      await new Promise(r => setTimeout(r, 500));
      if (networkInFlight === 0) { close(); return { idle: true, elapsed: Date.now() - start }; }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  close();
  return { idle: false, timeout: true, inFlight: networkInFlight };
}

// ── Debugging ──

async function getConsoleMessages(targetId) {
  // If no session yet, connect briefly to return any captured messages
  if (consoleMessages.length === 0 && !ws) {
    await initSession(targetId);
    await new Promise(r => setTimeout(r, 500));
    close();
  }
  return consoleMessages;
}

async function getNetworkRequests(opts = {}) {
  const { targetId, status, type } = typeof opts === 'string' ? { targetId: opts } : opts;
  if (networkRequests.length === 0 && !ws) {
    await initSession(targetId);
    await new Promise(r => setTimeout(r, 500));
    close();
  }
  let requests = [...networkRequests];
  if (status) {
    requests = requests.filter(r => {
      if (r.status == null) return false;
      if (status === '4xx') return r.status >= 400 && r.status < 500;
      if (status === '5xx') return r.status >= 500 && r.status < 600;
      if (status === 'error') return r.status >= 400;
      return String(r.status) === String(status);
    });
  }
  if (type) {
    requests = requests.filter(r =>
      r.type?.toLowerCase().includes(type.toLowerCase()) ||
      r.mimeType?.toLowerCase().includes(type.toLowerCase())
    );
  }
  return requests;
}

async function getCookies(url, targetId) {
  await initSession(targetId);
  const params = url ? { urls: [url] } : {};
  const result = await send('Network.getCookies', params);
  close();
  return result.cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure }));
}

async function setCookie(name, value, opts = {}) {
  const { domain, targetId } = opts;
  await initSession(targetId);
  const url = await evalJs('location.href');
  await send('Network.setCookie', {
    name, value,
    domain: domain || new URL(url.value).hostname,
    url: url.value,
  });
  close();
  return { set: true, name, value };
}

async function clearCookies(targetId) {
  await initSession(targetId);
  await send('Network.clearBrowserCookies');
  close();
  return { cleared: true };
}

async function emulateDevice(device, targetId) {
  await initSession(targetId);
  const devices = {
    'mobile':    { width: 375, height: 812, scaleFactor: 3, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
    'iphone':    { width: 375, height: 812, scaleFactor: 3, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
    'ipad':      { width: 768, height: 1024, scaleFactor: 2, mobile: true, ua: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
    'tablet':    { width: 768, height: 1024, scaleFactor: 2, mobile: true, ua: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
    'android':   { width: 412, height: 915, scaleFactor: 2.625, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
    'desktop':   { width: 1920, height: 1080, scaleFactor: 1, mobile: false, ua: '' },
    'laptop':    { width: 1440, height: 900, scaleFactor: 2, mobile: false, ua: '' },
  };

  const d = devices[device.toLowerCase()];
  if (!d) return { error: `Unknown device: ${device}. Available: ${Object.keys(devices).join(', ')}` };

  await send('Emulation.setDeviceMetricsOverride', {
    width: d.width, height: d.height, deviceScaleFactor: d.scaleFactor, mobile: d.mobile,
  });
  if (d.ua) {
    await send('Emulation.setUserAgentOverride', { userAgent: d.ua });
  }
  // Also enable/disable touch
  await send('Emulation.setTouchEmulationEnabled', { enabled: d.mobile });

  close();
  return { emulated: device, viewport: { width: d.width, height: d.height }, mobile: d.mobile };
}

// ── QA Inspection ──

async function getStorage(targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`JSON.stringify({
    localStorage: Object.fromEntries(
      Object.keys(localStorage).map(k => [k, localStorage.getItem(k)?.slice(0, 200)])
    ),
    sessionStorage: Object.fromEntries(
      Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)?.slice(0, 200)])
    ),
  })`);
  close();
  return result;
}

async function getPerformance(targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`JSON.stringify({
    timing: {
      domContentLoaded: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart),
      loadComplete: Math.round(performance.timing.loadEventEnd - performance.timing.navigationStart),
      domInteractive: Math.round(performance.timing.domInteractive - performance.timing.navigationStart),
      firstByte: Math.round(performance.timing.responseStart - performance.timing.navigationStart),
      dnsLookup: Math.round(performance.timing.domainLookupEnd - performance.timing.domainLookupStart),
      tcpConnect: Math.round(performance.timing.connectEnd - performance.timing.connectStart),
    },
    coreWebVitals: {
      lcp: (() => { const e = performance.getEntriesByType('largest-contentful-paint'); return e.length ? Math.round(e[e.length - 1].startTime) : null; })(),
      fid: (() => { const e = performance.getEntriesByType('first-input'); return e.length ? Math.round(e[0].processingStart - e[0].startTime) : null; })(),
      cls: (() => { let v = 0; performance.getEntriesByType('layout-shift').forEach(e => { if (!e.hadRecentInput) v += e.value; }); return parseFloat(v.toFixed(4)); })(),
    },
    resources: {
      count: performance.getEntriesByType('resource').length,
      top20Slowest: [...performance.getEntriesByType('resource')]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 20)
        .map(r => ({
          name: r.name.split('/').pop().slice(0, 60),
          url: r.name,
          type: r.initiatorType,
          duration: Math.round(r.duration),
          sizeKB: Math.round(r.transferSize / 1024),
          cached: r.transferSize === 0 && r.decodedBodySize > 0,
        })),
    },
  })`);
  close();
  return result;
}

async function getMeta(targetId) {
  await initSession(targetId);
  const result = await evalJsJson(`JSON.stringify({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || null,
    keywords: document.querySelector('meta[name="keywords"]')?.content || null,
    viewport: document.querySelector('meta[name="viewport"]')?.content || null,
    robots: document.querySelector('meta[name="robots"]')?.content || null,
    canonical: document.querySelector('link[rel="canonical"]')?.href || null,
    og: Object.fromEntries(
      [...document.querySelectorAll('meta[property^="og:"]')]
        .map(m => [m.getAttribute('property').slice(3), m.content])
    ),
    twitter: Object.fromEntries(
      [...document.querySelectorAll('meta[name^="twitter:"]')]
        .map(m => [m.name.slice(8), m.content])
    ),
    structuredData: [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
      .filter(Boolean),
  })`);
  close();
  return result;
}

async function injectAxe(opts = {}) {
  const { selector, targetId } = opts;
  await initSession(targetId);

  // Inject axe-core from CDN if not already present
  const injectResult = await evalJs(`new Promise((resolve, reject) => {
    if (window.axe) return resolve('already-loaded');
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js';
    s.onload = () => resolve('loaded');
    s.onerror = () => reject(new Error('Failed to load axe-core from CDN'));
    document.head.appendChild(s);
  })`);

  if (injectResult.error) {
    close();
    return { error: 'axe-core injection failed: ' + injectResult.exception };
  }

  const context = selector ? JSON.stringify(selector) : 'document';
  const axeResult = await evalJsJson(`new Promise((resolve, reject) => {
    axe.run(${context}, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }, (err, results) => {
      if (err) return reject(err);
      resolve(JSON.stringify({
        url: results.url,
        timestamp: results.timestamp,
        summary: {
          violations: results.violations.length,
          passes: results.passes.length,
          incomplete: results.incomplete.length,
          inapplicable: results.inapplicable.length,
        },
        violations: results.violations.map(v => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          helpUrl: v.helpUrl,
          nodeCount: v.nodes.length,
          nodes: v.nodes.slice(0, 5).map(n => ({
            html: n.html.slice(0, 200),
            target: n.target,
            failureSummary: n.failureSummary,
          })),
        })),
        incomplete: results.incomplete.map(v => ({ id: v.id, impact: v.impact, description: v.description })),
      }));
    });
  })`);

  close();
  return axeResult;
}

// ── Tabs ──

async function listTargets() {
  const targets = await getTargets();
  return targets.filter(t => t.type === 'page').map(t => ({ id: t.id, type: t.type, title: t.title, url: t.url }));
}

async function newTab(url) {
  const endpoint = url
    ? `http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(url)}`
    : `http://${CDP_HOST}:${CDP_PORT}/json/new`;
  const res = await fetch(endpoint);
  const target = await res.json();
  return { id: target.id, url: target.url, title: target.title };
}

async function closeTab(targetId) {
  if (!targetId) {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    if (page) targetId = page.id;
    else return { error: 'No page targets found' };
  }
  await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${targetId}`);
  return { closed: true, targetId };
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error('Usage: node cdp.mjs <command> [args...] [--flags]');
    console.error('Run node cdp.mjs --help for full command list');
    process.exit(1);
  }

  if (command === '--help') {
    // Extract the doc comment at top of file
    const fs = await import('fs');
    const src = fs.readFileSync(new URL(import.meta.url).pathname, 'utf8');
    const match = src.match(/\/\*\*([\s\S]*?)\*\//);
    if (match) console.log(match[1].replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }

  // Parse args
  const positional = [];
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }

  let result;
  try {
    switch (command) {
      // Navigation
      case 'navigate':
        if (!positional[0]) throw new Error('URL required');
        result = await navigate(positional[0], flags.target);
        break;
      case 'reload':
        result = await reload(flags.target);
        break;
      case 'back':
        result = await goBack(flags.target);
        break;
      case 'forward':
        result = await goForward(flags.target);
        break;
      case 'page-info':
        result = await getPageInfo(flags.target);
        break;
      case 'list-targets':
        result = await listTargets();
        break;
      case 'new-tab':
        result = await newTab(positional[0]);
        break;
      case 'close-tab':
        result = await closeTab(positional[0] || flags.target);
        break;

      // Visual
      case 'screenshot':
        result = await screenshot({ selector: flags.selector, full: flags.full === true, targetId: flags.target, outputPath: flags.output });
        break;
      case 'viewport':
        if (!positional[0] || !positional[1]) throw new Error('Width and height required');
        result = await setViewport(positional[0], positional[1], flags.target);
        break;
      case 'pdf':
        result = await savePdf({ targetId: flags.target, outputPath: flags.output });
        break;

      // DOM
      case 'evaluate':
        if (!positional[0]) throw new Error('Expression required');
        result = await evaluate(positional[0], flags.target);
        break;
      case 'get-html':
        result = await getHtml(flags.selector || positional[0], flags.target);
        break;
      case 'get-text':
        result = await getText(flags.selector || positional[0], flags.target);
        break;
      case 'get-attribute':
        if (!positional[0] || !positional[1]) throw new Error('Selector and attribute required');
        result = await getAttribute(positional[0], positional[1], flags.target);
        break;
      case 'get-value':
        if (!positional[0]) throw new Error('Selector required');
        result = await getValue(positional[0], flags.target);
        break;
      case 'get-styles':
        if (!positional[0]) throw new Error('Selector required');
        result = await getStyles(positional[0], flags.props, flags.target);
        break;
      case 'query-all':
        if (!positional[0]) throw new Error('Selector required');
        result = await queryAll(positional[0], flags.target);
        break;

      // Interaction
      case 'click':
        if (!positional[0]) throw new Error('Selector required');
        result = await clickElement(positional[0], { button: flags.button, count: flags.count, targetId: flags.target });
        break;
      case 'hover':
        if (!positional[0]) throw new Error('Selector required');
        result = await hoverElement(positional[0], flags.target);
        break;
      case 'type':
        if (!positional[0] || !positional[1]) throw new Error('Selector and text required');
        result = await typeText(positional[0], positional[1], { clear: flags.clear === true, delay: flags.delay, targetId: flags.target });
        break;
      case 'press':
        if (!positional[0]) throw new Error('Key name required');
        result = await pressKey(positional[0], { modifiers: flags.modifiers, targetId: flags.target });
        break;
      case 'clear':
        if (!positional[0]) throw new Error('Selector required');
        result = await clearInput(positional[0], flags.target);
        break;
      case 'focus':
        if (!positional[0]) throw new Error('Selector required');
        result = await focusElement(positional[0], flags.target);
        break;
      case 'blur':
        if (!positional[0]) throw new Error('Selector required');
        result = await blurElement(positional[0], flags.target);
        break;
      case 'select':
        if (!positional[0] || !positional[1]) throw new Error('Selector and value required');
        result = await selectOption(positional[0], positional[1], flags.target);
        break;
      case 'check':
        if (!positional[0]) throw new Error('Selector required');
        result = await checkElement(positional[0], flags.target);
        break;
      case 'uncheck':
        if (!positional[0]) throw new Error('Selector required');
        result = await uncheckElement(positional[0], flags.target);
        break;
      case 'scroll':
        result = await scrollTo({ selector: positional[0], x: flags.x, y: flags.y, targetId: flags.target });
        break;
      case 'drag':
        if (!positional[0] || !positional[1]) throw new Error('Source and target selectors required');
        result = await dragDrop(positional[0], positional[1], flags.target);
        break;
      case 'upload':
        if (!positional[0] || !positional[1]) throw new Error('Selector and file path required');
        result = await uploadFile(positional[0], positional[1], flags.target);
        break;

      // Waiting
      case 'wait':
        if (!positional[0]) throw new Error('Selector required');
        result = await waitForElement(positional[0], parseInt(flags.timeout || '10000'), flags.target);
        break;
      case 'wait-visible':
        if (!positional[0]) throw new Error('Selector required');
        result = await waitForVisible(positional[0], parseInt(flags.timeout || '10000'), flags.target);
        break;
      case 'wait-hidden':
        if (!positional[0]) throw new Error('Selector required');
        result = await waitForHidden(positional[0], parseInt(flags.timeout || '10000'), flags.target);
        break;
      case 'wait-text':
        if (!positional[0]) throw new Error('Text required');
        result = await waitForText(positional[0], parseInt(flags.timeout || '10000'), flags.target);
        break;
      case 'wait-url':
        if (!positional[0]) throw new Error('URL pattern required');
        result = await waitForUrl(positional[0], parseInt(flags.timeout || '10000'), flags.target);
        break;
      case 'wait-network-idle':
        result = await waitForNetworkIdle(parseInt(flags.timeout || '10000'), flags.target);
        break;
      case 'sleep':
        if (!positional[0]) throw new Error('Duration in ms required');
        await new Promise(r => setTimeout(r, parseInt(positional[0])));
        result = { slept: parseInt(positional[0]) };
        break;

      // Debugging
      case 'get-console':
        result = await getConsoleMessages(flags.target);
        break;
      case 'get-network':
        result = await getNetworkRequests({ targetId: flags.target, status: flags.status, type: flags.type });
        break;
      case 'get-cookies':
        result = await getCookies(flags.url, flags.target);
        break;
      case 'set-cookie':
        if (!positional[0] || !positional[1]) throw new Error('Name and value required');
        result = await setCookie(positional[0], positional[1], { domain: flags.domain, targetId: flags.target });
        break;
      case 'clear-cookies':
        result = await clearCookies(flags.target);
        break;
      case 'emulate':
        if (!positional[0]) throw new Error('Device name required (mobile, tablet, iphone, ipad, android, desktop, laptop)');
        result = await emulateDevice(positional[0], flags.target);
        break;

      // QA Inspection
      case 'get-storage':
        result = await getStorage(flags.target);
        break;
      case 'get-performance':
        result = await getPerformance(flags.target);
        break;
      case 'get-meta':
        result = await getMeta(flags.target);
        break;
      case 'inject-axe':
        result = await injectAxe({ selector: flags.selector, targetId: flags.target });
        break;

      default:
        throw new Error(`Unknown command: ${command}. Run with --help for list.`);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }

  process.exit(0);
}

main();

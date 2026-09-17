// lib/admission.mjs — the pure half of `cases.mjs admit` (spec §6 cases.mjs,
// §2 row 4): a manual-qa test case is admitted into the hand-off suite when
// every step's Action cell passes the allowed-operation grammar and matches
// nothing on the forbidden list, and every literal URL host is one the
// engagement's `targets.browser` names. Two outcomes only: no hits ⇒ admitted,
// any hit ⇒ proposal. There is no reviewable hit and no review state — an
// unknown operation is a hit named `unknown-operation`, full stop.
//
//   parseSteps(text) → {steps: [{step, action, expected}]}
//     the manual-qa `## Steps` table (bundles/manual-qa/knowledge/
//     test-case-format.md): `step` is the `#` cell when it is a positive
//     integer, else the row's 1-based ordinal. A missing or empty table or a
//     table without an Action column throws AdmissionError.
//   lintSteps(steps, {browser}) → [{rule, step, text}]
//     per step, over the Action cell only (Expected Result is an observation,
//     not an act): every FORBIDDEN_PATTERNS rule that matches is one hit; a
//     literal http(s) URL whose host is not in `browser` is `host-not-allowed`
//     (`{{base_url}}` is the placeholder the runner substitutes and is always
//     fine); a step with no hit so far that no ALLOWED_OPERATIONS pattern
//     accepts is `unknown-operation`. Leading Markdown emphasis and code
//     marks are stripped before the verb-anchored patterns run; the payload
//     patterns also see the cell as written. `text` is the cell as linted —
//     the caller passes redacted text, so a hit never carries a secret.
//   lintCase(text, {browser}) → {steps, hits}
//   caseId(text) → "TC-NNN" | null      the frontmatter `id:`
//   hostOf(url) → "host[:port]" | null  lower-cased, userinfo dropped
//   ALLOWED_OPERATIONS, FORBIDDEN_PATTERNS, LINT_RULES, BASE_URL_PLACEHOLDER
//
// Trimmed from the reference `admission-core.mjs`: no case sha (cases.mjs
// hashes the bytes it writes), no target policy, no classify. Leaf module:
// stdlib only, no file system, no child process, no clock. Never prints;
// inputs are never mutated; hits are in step order then rule order.

/** The closed `rule` vocabulary of a lint hit, in the order hits are recorded within one step. */
export const LINT_RULES = Object.freeze(["mutating-verb", "injection-payload", "tooling", "volume", "host-not-allowed", "unknown-operation"]);
/** The manual-qa placeholder the runner substitutes with the engagement's `base_url`. */
export const BASE_URL_PLACEHOLDER = "{{base_url}}";

/**
 * The allowed-operation grammar (references/passive-admission.md): an Action
 * cell is accepted when, after leading emphasis is stripped, it starts with
 * one of these verbs. `{name, re}`; the names are the reference's sections.
 */
export const ALLOWED_OPERATIONS = Object.freeze([
  Object.freeze({ name: "navigate", re: /^(?:navigate|go|browse|return)\s+(?:back\s+)?to\b|^(?:open|visit|load)\b/i }),
  Object.freeze({ name: "reload", re: /^(?:reload|refresh)\b/i }),
  Object.freeze({
    name: "observe",
    re: /^(?:inspect|observe|read|view|check|verify|confirm|note|record|look\s+at|examine|review|compare|count|list|find|locate|hover(?:\s+over)?|expand|collapse|select|switch\s+to|scroll|wait(?:\s+for)?|capture|take\s+a\s+screenshot|screenshot|close|ensure|assert)\b/i,
  }),
]);

/**
 * The forbidden-pattern list: `{rule, re}` over the Action cell. The verbs
 * are anchored at a verb position — the start of the cell or of a clause
 * after `and` / `then` / `or` / `;` / `,` ("Navigate to … then submit the
 * form" is a hit; "Inspect the delete button" is not); payloads, tools and
 * volume words match anywhere.
 */
export const FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({
    rule: "mutating-verb",
    re: /(?:^|\b(?:and|then|or)\s+|[;,]\s*)(?:submit|send|post|put|patch|delete|remove|drop|upload|create|register|sign\s*up|modify|update|edit|change|alter|inject|exploit|brute[\s-]?force|fuzz|scan|spray|bypass|escalate|tamper|intercept|replay|forge|overwrite|execute|run|install|deploy|reset|disable|enable|grant|revoke|transfer|pay|purchase|check\s*out|approve|reject|cancel|order|book|import|export|migrate|truncate|wipe|kill|restart|shut\s*down)\b/i,
  }),
  Object.freeze({
    rule: "injection-payload",
    re: /<\s*script\b|javascript\s*:|\bon(?:load|error|click|mouseover|focus)\s*=|['"]\s*(?:or|and)\s+(?:['"]?\d|['"]?[a-z_]+['"]?\s*=)|\bunion\s+(?:all\s+)?select\b|;\s*(?:drop|delete|shutdown|exec|xp_)\w*|(?:\.\.\/)+|(?:\.\.\\)+|%2e%2e|%00|%0d%0a|\{\{\s*\d+\s*\*\s*\d+\s*\}\}|\$\{[^}]*\}|(?:;|\|\||&&|\|)\s*(?:cat|ls|id|whoami|curl|wget|nc|bash|sh|rm|powershell)\b/i,
  }),
  Object.freeze({ rule: "tooling", re: /\b(?:sqlmap|nmap|nikto|burp(?:suite)?|owasp\s+zap|zaproxy|metasploit|msfconsole|hydra|dirb|gobuster|ffuf|wfuzz|masscan|nuclei|curl|wget|httpie|netcat|ncat|rm\s+-[a-z]+)\b/i }),
  Object.freeze({ rule: "volume", re: /\b(?:repeat(?:edly)?|loop|flood|spam|hammer|concurrently|in\s+parallel)\b|\b\d{2,}\s+(?:times|requests|attempts|logins|tries|users|sessions)\b/i }),
]);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const CASE_ID = /^TC-\d{3}$/;
const STEPS_HEADING = /^##[ \t]+Steps[ \t]*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR_ROW = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;
const MARKUP = /[*_`~]|^[\s>]+/g;
const ABSOLUTE_URL = /\bhttps?:\/\/[^\s/`'"<>)\]]+/gi;
const STEP_NUMBER = /^[0-9]+$/;

/** The case cannot be linted: no `## Steps` table, an empty one, no Action column. */
export class AdmissionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdmissionError";
  }
}

/**
 * The `host[:port]` of an absolute http(s) URL, or null.
 * @param {string} url
 * @returns {string | null}
 */
export function hostOf(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.host.toLowerCase() || null;
}

/**
 * The frontmatter `id:` when it is `TC-NNN`, else null.
 * @param {string} text the case file
 * @returns {string | null}
 */
export function caseId(text) {
  if (typeof text !== "string") return null;
  const fm = FRONTMATTER.exec(text);
  if (fm === null) return null;
  for (const line of fm[1].split(/\r?\n/)) {
    const m = /^id:\s*(.*?)\s*$/.exec(line);
    if (m === null) continue;
    const value = m[1].replace(/^(["'])(.*)\1$/, "$2");
    return CASE_ID.test(value) ? value : null;
  }
  return null;
}

/** Split one `| a | b |` row into trimmed cells; `\|` inside a cell stays a pipe. */
function cells(row) {
  const inner = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

/** The first Markdown table after the `## Steps` heading, or null. */
function stepsTable(lines) {
  const at = lines.findIndex((l) => STEPS_HEADING.test(l));
  if (at < 0) return null;
  let i = at + 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i + 1 >= lines.length || !TABLE_ROW.test(lines[i]) || !SEPARATOR_ROW.test(lines[i + 1])) return null;
  const columns = cells(lines[i]);
  const rows = [];
  for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cells(lines[i]));
  return { columns, rows };
}

const columnIndex = (columns, test) => columns.findIndex((c) => test(c.toLowerCase()));

/**
 * The case's `## Steps` table as steps.
 * @param {string} text the (redacted) case text
 * @returns {{steps: {step: number, action: string, expected: string}[]}}
 * @throws {AdmissionError}
 */
export function parseSteps(text) {
  if (typeof text !== "string") throw new TypeError("admission.parseSteps: text must be the case text");
  const table = stepsTable(text.split(/\r?\n/));
  if (table === null || table.rows.length === 0) throw new AdmissionError("## Steps table is missing or empty (nothing to admit)");
  const actionAt = columnIndex(table.columns, (c) => c === "action");
  if (actionAt < 0) throw new AdmissionError("## Steps table has no Action column");
  const expectedAt = columnIndex(table.columns, (c) => c.startsWith("expected"));
  const numberAt = columnIndex(table.columns, (c) => c === "#" || c === "step" || c === "no." || c === "no");
  const steps = table.rows.map((row, i) => {
    const raw = numberAt >= 0 ? row[numberAt] ?? "" : "";
    const step = STEP_NUMBER.test(raw) && Number(raw) > 0 ? Number(raw) : i + 1;
    return { step, action: row[actionAt] ?? "", expected: expectedAt >= 0 ? row[expectedAt] ?? "" : "" };
  });
  return { steps };
}

function requireSteps(steps) {
  if (!Array.isArray(steps)) throw new TypeError("admission.lintSteps: steps must be an array of {step, action, expected}");
  steps.forEach((s, i) => {
    if (s === null || typeof s !== "object" || !Number.isInteger(s.step) || s.step < 0 || typeof s.action !== "string") throw new TypeError(`admission.lintSteps: steps[${i}] must be {step: integer ≥ 0, action: string}`);
  });
  return steps;
}

function requireHosts(browser) {
  if (!Array.isArray(browser) || !browser.every((h) => typeof h === "string")) throw new TypeError("admission.lintSteps: browser must be the engagement's targets.browser (strings)");
  return new Set(browser.map((h) => h.toLowerCase()));
}

/** The literal URL hosts of an Action cell, in order of appearance, deduplicated. */
function literalHosts(action) {
  const hosts = [];
  for (const m of action.matchAll(ABSOLUTE_URL)) {
    const host = hostOf(m[0]);
    if (host !== null && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * The heuristic over the steps' Action cells.
 * @param {{step: number, action: string}[]} steps
 * @param {{browser: string[]}} policy the engagement's `targets.browser`
 * @returns {{rule: string, step: number, text: string}[]}
 */
export function lintSteps(steps, { browser } = {}) {
  requireSteps(steps);
  const allowedHosts = requireHosts(browser);
  const hits = [];
  for (const { step, action } of steps) {
    const plain = action.replace(MARKUP, "").trim();
    const before = hits.length;
    const hit = (rule) => hits.push({ rule, step, text: action });
    for (const { rule, re } of FORBIDDEN_PATTERNS) if (re.test(action) || re.test(plain)) hit(rule);
    if (literalHosts(action).some((h) => !allowedHosts.has(h))) hit("host-not-allowed");
    if (hits.length === before && !ALLOWED_OPERATIONS.some(({ re }) => re.test(plain))) hit("unknown-operation");
  }
  return hits;
}

/**
 * Parse and lint one case.
 * @param {string} text the (redacted) case text
 * @param {{browser: string[]}} policy
 * @returns {{steps: {step: number, action: string, expected: string}[], hits: {rule: string, step: number, text: string}[]}}
 * @throws {AdmissionError}
 */
export function lintCase(text, policy) {
  const { steps } = parseSteps(text);
  return { steps, hits: lintSteps(steps, policy) };
}

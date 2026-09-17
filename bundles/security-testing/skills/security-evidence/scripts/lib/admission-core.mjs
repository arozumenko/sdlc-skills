// lib/admission-core.mjs — the pure half of `plan.mjs admit` (TASK-042; plan
// §4.5, §5 TASK-042; spec §9.1 "Admission", D7, P5; US-034 AC-1…AC-4). The
// I/O half is lib/cmd-plan-admit.mjs; the case packet the reviewed route
// needs is `packet --kind subject --type case` (lib/cmd-packet.mjs).
//
//   caseSha256(bytes) → {case_sha256, redacted}
//     the identity of a case: sha256 over the REDACTED text of the file —
//     exactly what imports.prepareImport computes as `import_sha256` for
//     `ingest case`, so an admission, a case packet's subject id and a case
//     import name one case the same way. Plain sha256 over redacted bytes is
//     the G-2 allowance; the raw file may carry test credentials.
//   parseSteps(redactedText) → {case, account, steps: [{step, action, expected}]}
//     the manual-qa TC structure (ingest/case.mjs parseTestCase: 2
//     SCHEMA-INVALID(case: …) on a structural failure) plus the `## Steps`
//     table rows the lint runs over — a case without a non-empty Steps table
//     or without an Action column is structurally invalid here (nothing to
//     admit). `step` is the `#` cell when it is a positive integer, else the
//     row's 1-based ordinal. `account` is the frontmatter `account:` value
//     (the label of the test account the steps assume) or "unknown" — never
//     blank, spec §9.2.
//   lintSteps(steps, {browser}) → hits[]
//     the heuristic over step text (spec §9.1: "allowed-operation grammar +
//     forbidden-pattern list; unknown effects ⇒ proposal"). Per step, over
//     the Action cell only (the Expected Result cell is an observation, not
//     an act): every FORBIDDEN_PATTERNS rule that matches is one hit; a
//     literal URL whose host is not in `browser` (engagement `targets.browser`,
//     the authority policy — `{{base_url}}` is the placeholder the runner
//     substitutes and is always fine) is a `host-not-allowed` hit; an Action
//     with no hit so far that no ALLOWED_OPERATIONS pattern accepts is an
//     `unknown-operation` hit (a forbidden step is a known effect, not an
//     unknown one). Markdown emphasis and code spans are stripped before the
//     verb-anchored patterns run; the payload patterns see the cell as
//     written too. A hit is `{rule, step, text_redacted}`
//     (admission.schema.json LintHit; the text is the Action cell as linted
//     — the redacted form).
//   classify(hits, review) → {classification, lint_hits}
//     `review` is null (no `--receipt`) or the REVIEW_* state
//     states.applyReceipts derived for the case subject. `admitted-heuristic`
//     needs zero hits; `admitted-reviewed` needs REVIEW_CONFIRMED and no hit
//     outside REVIEWABLE_RULES — a confirmed review admits a step the grammar
//     did not know, never one the forbidden list caught (an injection payload
//     or a foreign host is not reviewable away: rewrite the step); every
//     other review state is a `proposal` with a `review-not-confirmed` hit
//     at step 0 (the header ordinal, TASK-018's convention) naming the state.
//     The claim is "admitted by lint or by review", never "safe".
//   targetPolicy(record) / targetPolicySha256(record)
//     `{targets, base_url?}` of the run's engagement record and its plain
//     sha256 (hostnames and a URL: no rule can match) — the
//     `target_policy_sha256` an admission records so a later reader knows
//     which authority policy the hosts were checked against.
//   hostOf(url) → string | null
//     the `host[:port]` of an absolute http(s) URL, lower-cased, userinfo
//     dropped; null when the string is not one.
//   CLASSIFICATIONS, LINT_RULES, REVIEWABLE_RULES, ALLOWED_OPERATIONS,
//   FORBIDDEN_PATTERNS, BASE_URL_PLACEHOLDER
//
// Pure (G-9): imports ../canon.mjs (sha256Hex, canonical), ../redact.mjs
// (redactString, DEFAULT_RULES), ./ingest/case.mjs (parseTestCase),
// ./ingest/_qa-markdown.mjs (findTable, splitFrontmatter), ./exit.mjs,
// ./tokens.mjs — no file system, no child process, no git, no clock, no
// network.
// Never prints. Inputs are never mutated; every list is in step order then
// rule order, so the result is deterministic.

import { canonical, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, redactString } from "../redact.mjs";
import { CliError, EXIT } from "./exit.mjs";
import { findTable, splitFrontmatter } from "./ingest/_qa-markdown.mjs";
import { parseTestCase } from "./ingest/case.mjs";
import { REVIEW_CONFIRMED, REVIEW_INDETERMINATE, REVIEW_REFUTED, schemaInvalid } from "./tokens.mjs";

const WHERE = "admission-core";
const KIND = "case";

/** admission.schema.json `classification` (spec §9.1). */
export const CLASSIFICATIONS = Object.freeze(["admitted-heuristic", "admitted-reviewed", "proposal"]);
/** The closed `rule` vocabulary of a lint hit, in the order hits are recorded within one step. */
export const LINT_RULES = Object.freeze(["mutating-verb", "injection-payload", "tooling", "volume", "host-not-allowed", "unknown-operation", "review-not-confirmed"]);
/** Hits a confirmed vulnerability-review may admit past; every other rule keeps the case a proposal. */
export const REVIEWABLE_RULES = Object.freeze(["unknown-operation"]);
/** The manual-qa placeholder the runner substitutes with the engagement's `base_url`. */
export const BASE_URL_PLACEHOLDER = "{{base_url}}";

/**
 * The allowed-operation grammar (references/passive-admission.md of the
 * security-test-planning skill): an Action cell is admitted when, after the
 * leading Markdown emphasis is stripped, it starts with one of these verbs.
 * Each entry is `{name, re}`; the names are the reference's section titles.
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
 * The forbidden-pattern list: `{rule, re}` over the Action cell. A match is
 * a hit under `rule`; the verbs are anchored at the verb position — the
 * start of the Action or of a clause after `and` / `then` / `or` / `;` / `,`
 * (TASK-043, the G22 follow-up: "Navigate to … then submit the form" is a
 * hit; "Inspect the delete button" is not) — the payloads, tools and volume
 * words anywhere in the cell.
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
  Object.freeze({ rule: "tooling", re: /\b(?:sqlmap|nmap|nikto|burp(?:suite)?|owasp\s+zap|zaproxy|metasploit|msfconsole|hydra|dirb|gobuster|ffuf|wfuzz|masscan|nuclei|curl|wget|httpie|netcat|ncat)\b/i }),
  Object.freeze({ rule: "volume", re: /\b(?:repeat(?:edly)?|loop|flood|spam|hammer|concurrently|in\s+parallel)\b|\b\d{2,}\s+(?:times|requests|attempts|logins|tries|users|sessions)\b/i }),
]);

const STEPS_HEADING = /^##[ \t]+Steps[ \t]*$/;
const MARKUP = /[*_`~]|^[\s>]+/g;
const ABSOLUTE_URL = /\bhttps?:\/\/([^\s/`'"<>)\]]+)/gi;
const STEP_NUMBER = /^[0-9]+$/;
const REVIEW_STATES = Object.freeze([REVIEW_CONFIRMED, REVIEW_REFUTED, REVIEW_INDETERMINATE]);

function invalid(reason) {
  return new CliError(EXIT.USAGE, schemaInvalid(KIND, reason));
}

function requireBytes(bytes, where) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${WHERE}.${where}: bytes must be a Buffer`);
  return bytes;
}

/**
 * The identity of a case: sha256 over its redacted text (= `ingest case`'s import_sha256).
 * @param {Uint8Array} bytes the case file
 * @returns {{case_sha256: string, redacted: string}}
 */
export function caseSha256(bytes) {
  requireBytes(bytes, "caseSha256");
  const redacted = redactString(bytes, DEFAULT_RULES).text;
  return { case_sha256: sha256Hex(Buffer.from(redacted, "utf8")), redacted };
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
 * The run's authority policy as an admission records it: `{targets, base_url?}`.
 * @param {{targets: object, base_url?: string}} record engagement.schema.json payload
 * @returns {{targets: object, base_url?: string}}
 */
export function targetPolicy(record) {
  if (record === null || typeof record !== "object" || record.targets === null || typeof record.targets !== "object") throw new TypeError(`${WHERE}.targetPolicy: record must carry targets`);
  const policy = { targets: structuredClone(record.targets) };
  if (typeof record.base_url === "string") policy.base_url = record.base_url;
  return policy;
}

/** sha256(canonical(targetPolicy(record))) — hostnames and a URL, no rule can match (G-2). */
export function targetPolicySha256(record) {
  return sha256Hex(canonical(targetPolicy(record)));
}

function columnIndex(columns, test) {
  return columns.findIndex((c) => test(c.trim().toLowerCase()));
}

/**
 * The case's structure and its steps, from the REDACTED text.
 * @param {string} text
 * @returns {{case: ReturnType<typeof parseTestCase>, account: string, steps: {step: number, action: string, expected: string}[]}}
 * @throws {CliError} 2 SCHEMA-INVALID(case: …)
 */
export function parseSteps(text) {
  if (typeof text !== "string") throw new TypeError(`${WHERE}.parseSteps: text must be the redacted case text`);
  const tc = parseTestCase(text); // structural validation, the adapter's own exit-2 tokens
  const { frontmatter, body } = splitFrontmatter(text);
  const rawAccount = frontmatter?.account;
  const account = typeof rawAccount === "string" && rawAccount.trim() !== "" && !/[\r\n]/.test(rawAccount) ? rawAccount.trim() : "unknown";
  const table = findTable(body, STEPS_HEADING);
  if (table === null || table.rows.length === 0) throw invalid("## Steps table is missing or empty (nothing to admit)");
  const actionAt = columnIndex(table.columns, (c) => c === "action");
  if (actionAt < 0) throw invalid("## Steps table has no Action column");
  const expectedAt = columnIndex(table.columns, (c) => c.startsWith("expected"));
  const numberAt = columnIndex(table.columns, (c) => c === "#" || c === "step" || c === "no." || c === "no");
  const steps = table.rows.map((row, i) => {
    const raw = numberAt >= 0 ? row[numberAt].trim() : "";
    const step = STEP_NUMBER.test(raw) && Number(raw) > 0 ? Number(raw) : i + 1;
    return { step, action: row[actionAt].trim(), expected: expectedAt >= 0 ? row[expectedAt].trim() : "" };
  });
  return { case: tc, account, steps };
}

function requireSteps(steps) {
  if (!Array.isArray(steps)) throw new TypeError(`${WHERE}.lintSteps: steps must be an array of {step, action, expected}`);
  steps.forEach((s, i) => {
    if (s === null || typeof s !== "object" || !Number.isInteger(s.step) || s.step < 0 || typeof s.action !== "string") throw new TypeError(`${WHERE}.lintSteps: steps[${i}] must be {step: integer ≥ 0, action: string}`);
  });
  return steps;
}

function requireHosts(browser) {
  if (!Array.isArray(browser) || !browser.every((h) => typeof h === "string")) throw new TypeError(`${WHERE}.lintSteps: browser must be the engagement's targets.browser (strings)`);
  return new Set(browser.map((h) => h.toLowerCase()));
}

/** The literal URL hosts of an Action cell, in order of appearance, deduplicated. */
function literalHosts(action) {
  const hosts = [];
  for (const m of action.matchAll(ABSOLUTE_URL)) {
    const host = hostOf(`${m[0]}`);
    if (host !== null && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * The heuristic over the steps' Action cells.
 * @param {{step: number, action: string}[]} steps
 * @param {{browser: string[]}} policy the engagement's `targets.browser`
 * @returns {{rule: string, step: number, text_redacted: string}[]}
 */
export function lintSteps(steps, { browser } = {}) {
  requireSteps(steps);
  const allowedHosts = requireHosts(browser);
  const hits = [];
  for (const { step, action } of steps) {
    const plain = action.replace(MARKUP, "").trim();
    const before = hits.length;
    const hit = (rule) => hits.push({ rule, step, text_redacted: action });
    for (const { rule, re } of FORBIDDEN_PATTERNS) if (re.test(action) || re.test(plain)) hit(rule);
    if (literalHosts(action).some((h) => !allowedHosts.has(h))) hit("host-not-allowed");
    if (hits.length === before && !ALLOWED_OPERATIONS.some(({ re }) => re.test(plain))) hit("unknown-operation");
  }
  return hits;
}

/**
 * The classification (spec §9.1) from the lint hits and the derived review state.
 * @param {{rule: string, step: number, text_redacted: string}[]} hits lintSteps' result
 * @param {string | null} review null without `--receipt`, else the REVIEW_* state of the case subject
 * @returns {{classification: string, lint_hits: {rule: string, step: number, text_redacted: string}[]}}
 */
export function classify(hits, review) {
  const isHit = (h) => h !== null && typeof h === "object" && LINT_RULES.includes(h.rule) && Number.isInteger(h.step) && h.step >= 0 && typeof h.text_redacted === "string";
  if (!Array.isArray(hits) || !hits.every(isHit)) throw new TypeError(`${WHERE}.classify: hits must be lint hits ({rule, step, text_redacted})`);
  if (review !== null && !REVIEW_STATES.includes(review)) throw new TypeError(`${WHERE}.classify: review must be null or one of ${REVIEW_STATES.join("|")}, got ${String(review)}`);
  const lint_hits = hits.map((h) => ({ rule: h.rule, step: h.step, text_redacted: h.text_redacted }));
  const forbidden = lint_hits.some((h) => !REVIEWABLE_RULES.includes(h.rule));
  if (review !== null && review !== REVIEW_CONFIRMED) {
    lint_hits.push({ rule: "review-not-confirmed", step: 0, text_redacted: `vulnerability-review: ${review}` });
    return { classification: "proposal", lint_hits };
  }
  if (forbidden) return { classification: "proposal", lint_hits };
  if (review === REVIEW_CONFIRMED) return { classification: "admitted-reviewed", lint_hits };
  return { classification: lint_hits.length === 0 ? "admitted-heuristic" : "proposal", lint_hits };
}

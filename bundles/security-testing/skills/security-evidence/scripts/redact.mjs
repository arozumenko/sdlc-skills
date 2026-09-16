// redact.mjs — the one redaction function every writer in this bundle calls.
//
// Spec §6.5: "Redaction is one function (redact.mjs, versioned rules) applied
// by every writer to every string, recursively, including rejection reasons,
// logs, tracker bodies, hand-off prompts. Guarantee bounded to the rule list."
//
// Leaf module: imports only node:fs / node:path / node:url. Nothing here reads
// a clock, spawns a process or touches the network (guardrails G-1, G-6, G-14).
//
// Rules live in ../references/redaction-rules.json as
//   {redaction_version: int, rules: [{class, pattern, flags, replacement}]}
// and are applied in file order. Every replacement is `<REDACTED:<class>>`,
// which no rule matches, so redaction is idempotent.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the versioned rule list shipped with the skill. */
export const RULES_PATH = join(HERE, "..", "references", "redaction-rules.json");

/** The closed list of redaction classes (schema `redaction-rules`, TASK-005). */
export const CLASSES = Object.freeze([
  "aws-key",
  "gcp-key",
  "azure-key",
  "jwt",
  "pem-block",
  "password-assign",
  "token-assign",
  "secret-assign",
  "bearer",
  "high-entropy-assign",
]);

/** Thrown when a rules file is malformed. Fail loud: a bad rule list must never silently redact nothing. */
export class RulesError extends Error {
  constructor(message, path) {
    super(path ? `${message} (${path})` : message);
    this.name = "RulesError";
    this.path = path;
  }
}

/**
 * @typedef {{class: string, pattern: string, flags: string, replacement: string, re: RegExp}} Rule
 * @typedef {{redaction_version: number, rules: Rule[]}} Rules
 */

function compileRule(raw, index, path) {
  const where = `rules[${index}]`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RulesError(`${where} must be an object`, path);
  }
  const { class: cls, pattern, flags, replacement } = raw;
  if (!CLASSES.includes(cls)) throw new RulesError(`${where}.class "${cls}" is not one of ${CLASSES.join(" ")}`, path);
  if (typeof pattern !== "string" || pattern.length === 0) throw new RulesError(`${where}.pattern must be a non-empty string`, path);
  if (typeof flags !== "string") throw new RulesError(`${where}.flags must be a string`, path);
  if (replacement !== `<REDACTED:${cls}>`) throw new RulesError(`${where}.replacement must be "<REDACTED:${cls}>"`, path);
  if (flags.includes("y")) throw new RulesError(`${where}.flags must not be sticky`, path);
  const effective = flags.includes("g") ? flags : `${flags}g`;
  let re;
  try {
    re = new RegExp(pattern, effective);
  } catch (e) {
    throw new RulesError(`${where}.pattern does not compile: ${e.message}`, path);
  }
  return Object.freeze({ class: cls, pattern, flags: effective, replacement, re });
}

/**
 * Load and compile a rules file. Defaults to RULES_PATH.
 * @param {string} [path]
 * @returns {Rules}
 */
export function loadRules(path = RULES_PATH) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new RulesError(`cannot read rules: ${e.message}`, path);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RulesError("rules file must be a JSON object", path);
  }
  const version = raw.redaction_version;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RulesError("redaction_version must be a positive integer", path);
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new RulesError("rules must be a non-empty array", path);
  }
  const rules = raw.rules.map((r, i) => compileRule(r, i, path));
  return Object.freeze({ redaction_version: version, rules: Object.freeze(rules) });
}

/** The shipped rules, loaded once at import. */
export const DEFAULT_RULES = loadRules(RULES_PATH);

const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Bytes → text: UTF-8 when valid, latin1 otherwise (never throws, never drops bytes). */
function bytesToText(bytes) {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  }
}

function toText(input, fn) {
  if (typeof input === "string") return input;
  if (input instanceof Uint8Array) return bytesToText(input);
  throw new TypeError(`${fn} expects a string or Buffer, got ${input === null ? "null" : typeof input}`);
}

/**
 * Redact one string (or Buffer, scanned as text). Rules apply in file order.
 * @param {string | Uint8Array} input
 * @param {Rules} [rules]
 * @returns {{text: string, hits: {class: string, count: number}[]}}
 */
export function redactString(input, rules = DEFAULT_RULES) {
  let text = toText(input, "redactString");
  const hits = [];
  for (const rule of rules.rules) {
    let count = 0;
    text = text.replace(rule.re, () => {
      count++;
      return rule.replacement;
    });
    if (count > 0) hits.push({ class: rule.class, count });
  }
  return { text, hits };
}

/**
 * True when any rule matches. Read-only: safe to call on raw bytes before hashing (§6.5 identity by sensitivity).
 * @param {string | Uint8Array} input
 * @param {Rules} [rules]
 * @returns {boolean}
 */
export function matches(input, rules = DEFAULT_RULES) {
  const text = toText(input, "matches");
  // String#search ignores `lastIndex` and the `g` flag, so shared compiled regexes stay stateless.
  return rules.rules.some((rule) => text.search(rule.re) !== -1);
}

function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Redact every string in a JSON-like value, recursively — values and object keys.
 * Numbers, booleans, null and undefined pass through. Non-plain objects (Buffer, Date, class
 * instances) are not walked; callers redact their text form explicitly.
 *
 * When nothing matched, the input is returned by reference (deep-equal and identical), so a
 * writer that hashes the result sees the same bytes it would have hashed before redaction.
 * @template T
 * @param {T} value
 * @param {Rules} [rules]
 * @returns {T}
 */
export function redactDeep(value, rules = DEFAULT_RULES) {
  if (typeof value === "string") {
    const { text, hits } = redactString(value, rules);
    return hits.length === 0 ? value : text;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let out = null;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const next = redactDeep(item, rules);
      if (next !== item) {
        if (out === null) out = value.slice();
        out[i] = next;
      }
    }
    return out === null ? value : out;
  }
  if (!isPlainObject(value)) return value;
  let changed = false;
  const entries = [];
  for (const key of Object.keys(value)) {
    const item = value[key];
    const nextKey = redactDeep(key, rules);
    const nextItem = redactDeep(item, rules);
    if (nextKey !== key || nextItem !== item) changed = true;
    entries.push([nextKey, nextItem]);
  }
  return changed ? Object.fromEntries(entries) : value;
}

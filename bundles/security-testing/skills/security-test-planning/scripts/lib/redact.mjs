// lib/redact.mjs — the one redaction pass every script runs on every string it
// writes to disk or stdout. Rules live in the sibling `redaction-rules.json`
// (`{redaction_version, rules: [{class, pattern, flags, replacement}]}`) and
// are applied in file order; a later rule sees the earlier rule's replacement
// text, never the original bytes. Finding identity hashes the redacted
// normalised snippet, so no published hash has a secret in its preimage.
//
// Leaf module: stdlib only, no clock, no other scripts/ import. This file and
// its rules json are byte-identical copies across the script skills that
// redact; `bin/check-skill-dupes.mjs` pins them.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_PATH = join(HERE, "redaction-rules.json");
const ALLOWED_FLAGS = new Set(["g", "i", "m", "s", "u"]);

/** The rules file is missing, unparsable, or carries a rule that cannot compile. */
export class RulesError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RulesError";
  }
}

/**
 * Load and compile a rules file.
 * @param {string} [path] defaults to the sibling `redaction-rules.json`
 * @returns {{class: string, re: RegExp, replacement: string}[]}
 * @throws {RulesError}
 */
export function loadRules(path = DEFAULT_RULES_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new RulesError(`redaction rules ${path}: ${err.message}`, { cause: err });
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.rules)) {
    throw new RulesError(`redaction rules ${path}: expected an object with a rules[] array`);
  }
  return parsed.rules.map((rule, i) => {
    const where = `redaction rules ${path}: rules[${i}]`;
    if (rule === null || typeof rule !== "object") throw new RulesError(`${where}: not an object`);
    for (const key of ["class", "pattern", "replacement"]) {
      if (typeof rule[key] !== "string" || rule[key].length === 0) throw new RulesError(`${where}: ${key} must be a non-empty string`);
    }
    const flags = rule.flags === undefined ? "g" : rule.flags;
    if (typeof flags !== "string" || [...flags].some((f) => !ALLOWED_FLAGS.has(f))) {
      throw new RulesError(`${where} (${rule.class}): flags must be a subset of "gimsu", got ${JSON.stringify(rule.flags)}`);
    }
    let re;
    try {
      re = new RegExp(rule.pattern, flags.includes("g") ? flags : `g${flags}`);
    } catch (err) {
      throw new RulesError(`${where} (${rule.class}): pattern does not compile: ${err.message}`, { cause: err });
    }
    return { class: rule.class, re, replacement: rule.replacement };
  });
}

/** The compiled sibling rules — what every script uses unless told otherwise. */
export const DEFAULT_RULES = loadRules();

/**
 * Replace every match of every rule, in rule order.
 * @param {string} input
 * @param {{class: string, re: RegExp, replacement: string}[]} [rules]
 * @param {(hit: {class: string, match: string, offset: number, text: string}) => boolean} [exempt]
 *   true keeps that match as it is (`text` is the string as the earlier rules left it); default none
 * @returns {{text: string, hits: number}}
 */
export function redactString(input, rules = DEFAULT_RULES, exempt = undefined) {
  if (typeof input !== "string") throw new TypeError("redactString: input must be a string");
  let text = input;
  let hits = 0;
  for (const rule of rules) {
    const before = text;
    text = before.replace(rule.re, (match, ...rest) => {
      const offset = rest.find((a) => typeof a === "number"); // after the capture groups, which are strings or undefined
      if (exempt !== undefined && exempt({ class: rule.class, match, offset, text: before })) return match;
      hits++;
      return rule.replacement;
    });
  }
  return { text, hits };
}

const URL_HEAD = /^(?:https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?|\{\{base_url\}\})\/[A-Za-z0-9._~{}/-]*$/;
const PLAIN_SEGMENT = /^(?:[a-z]{1,20}|[0-9]{1,8}|v[0-9]{1,2})$/;
const TOKEN_BREAK = /[\s"'`(|<]/;
const SCAN_LIMIT = 2048;

/**
 * An `exempt` callback for `redactString`: keep an ordinary long URL, which the
 * `high-entropy` rule eats because its character class holds `/`. Everything
 * else redacts. True only when all of these hold:
 *  - the class is `high-entropy`;
 *  - walking back from the match to the token start (after whitespace, a quote,
 *    a backtick, `(`, `|`, `<` or the start of text) takes at most 2048
 *    characters, and the text from there to the match end is, as a whole,
 *    `http://` or `https://`, a host of [A-Za-z0-9.-]+ and an optional `:` with
 *    1-5 digits, or `{{base_url}}`; then `/`; then only [A-Za-z0-9._~{}/-]
 *    (so a `?`, `#`, `@`, `=`, `;`, `&`, `,`, `)` or `\` before the match ends
 *    redacts, as does text glued to the URL);
 *  - no `@` follows in the rest of the same token (to the next token break or
 *    the end of text; more than 2048 characters ahead is not looked at, so it
 *    redacts);
 *  - every `/`-separated segment of the match is empty, 1-20 lowercase
 *    letters, 1-8 digits, or `v` and 1-2 digits.
 * It knowingly lets through short plain lowercase or digit tokens in a URL path,
 * and a hostname or `host:port` as the host. Uppercase or mixed segments,
 * hex, long runs and webhook URLs stay redacted.
 * @param {{class: string, match: string, offset: number, text: string}} hit
 * @returns {boolean}
 */
export function exemptPlainUrl({ class: cls, match, offset, text }) {
  if (cls !== "high-entropy") return false;
  let start = offset;
  while (start > 0 && !TOKEN_BREAK.test(text[start - 1])) {
    start--;
    if (offset - start > SCAN_LIMIT) return false;
  }
  if (!URL_HEAD.test(text.slice(start, offset + match.length))) return false;
  const end = offset + match.length;
  for (let i = end; i < text.length && !TOKEN_BREAK.test(text[i]); i++) {
    if (text[i] === "@" || i - end >= SCAN_LIMIT) return false;
  }
  return match.split("/").every((seg) => seg === "" || PLAIN_SEGMENT.test(seg));
}

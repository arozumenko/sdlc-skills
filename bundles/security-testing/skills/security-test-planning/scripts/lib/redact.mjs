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
 * @returns {{text: string, hits: number}}
 */
export function redactString(input, rules = DEFAULT_RULES) {
  if (typeof input !== "string") throw new TypeError("redactString: input must be a string");
  let text = input;
  let hits = 0;
  for (const rule of rules) {
    text = text.replace(rule.re, () => {
      hits++;
      return rule.replacement;
    });
  }
  return { text, hits };
}

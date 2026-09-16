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
//
// The three `*-assign` rules (password / secret / token) share one suffix after
// their key group — redact.test.mjs asserts the three suffixes are byte-equal
// so they cannot drift. The suffix accepts, after the key and an optional
// closing quote / `]`: an optional single-line type annotation (`: str`,
// `?: string`, `: Map<K,V>`, `: String?`, `: string | null`) followed by one
// of `=>` `:=` `!=` `!==` `=` `==` `===` `:` and a value; a call argument
// (`setPassword("…")`, `.password("…")`, `password.equals("…")`); a
// following quoted argument (`strcmp(password, "…")`, `put("password", "…")`
// as the first argument of a call); the k8s env name/value split (`- name:
// DB_PASSWORD` + `value: …` on the next line, or `"name": "DB_PASSWORD",
// "value": "…"`); the XML forms `<password>…</password>` and `key="password"
// value="…"`; a space-separated CLI flag (`--password hunter2`); and the
// Dockerfile legacy `ENV DB_PASSWORD hunter2`. A value is a quoted literal
// (double, single or backtick, escaped quotes kept inside, never empty), an
// unquoted run up to whitespace / `"` `'` `` ` `` `,` `;` `&` `<`, or a YAML
// block scalar (`|` / `>` plus the indented lines). An unquoted value may not
// start with `{` `[` `|` `>` `<` and may not be a bare type or keyword
// (`string`, `str`, `int`, `null`, `None`, `true`, `required`, …), so
// `password: string;`, `"password": {…}`, `password: null`, `password: {{ … }}`
// and `requirePassword = true` are not assignments of a secret.
//
// Cost is bounded: every rule is linear in input length on adversarial text
// (dash-joined identifiers, whitespace-free base64url, long whitespace runs,
// repeated keys, minified bundles, repeated PEM headers). The `*-assign`
// rules keep that property by starting only at a token boundary — the leading
// lookbehind excludes `-` as well as `[A-Za-z0-9_]` — by allowing a second
// whitespace run only after a real quote or bracket (`\s*(?:["']\s*(?:\]\s*)?)?`),
// by putting a literal (`:`, `=`, `,`, `(`, `\n`, `>`) before every later
// whitespace run, and by bounding every lookbehind that scans backwards over
// an identifier (`{0,64}`) or whitespace (`{1,16}`) so it costs O(1) per
// attempt. A rule that re-introduces `\s*["']?\s*`, lets the identifier prefix
// start mid-token, or adds an unbounded backward scan goes quadratic;
// redact.test.mjs pins the bound on a dozen shapes.
//
// Every key group also carries `(?<!<REDACTED:)`, so a placed marker is never
// read as a key whatever follows it (`<REDACTED:secret-assign>}` once matched
// the XML form); redact.test.mjs checks every class marker against a set of
// trailing contexts.
//
// Known limits of rules v1 (guarantee is bounded to the list, §6.5):
// - Over-redaction, safe side: `high-entropy-assign` admits `/` in the value,
//   so a `key=` / `key:` whose value is a path, route or branch name with a
//   digit and ≥ 32 chars is redacted (`path=src/Components/Auth/Login2FA/x.ts`,
//   `const ROUTE = "/api/v2/Admin/Users/ResetPassword"`). A citation snippet
//   holding such a constant becomes `sensitive: true`. Candidate for rules v2.
// - Over-redaction, safe side: `high-entropy-assign` also fires on Subresource
//   Integrity and lockfile hashes — `integrity="sha512-…"` / `sha384-…` in
//   HTML and `"integrity": "sha512-…"` in package-lock.json are a mixed-case
//   base64 value ≥ 32 chars after `key=` / `key:` — and, for the same reason,
//   on any base64 blob after a key (`content = "iVBORw0KGgo…"`, `data:
//   "TWFuIGlzIGRpc3Rpbmd1aXNoZWQs…"`, a base64 fixture in a test file): a
//   mixed-case, digit-bearing value of ≥ 32 base64 chars is indistinguishable
//   from a key by shape. A citation into a lockfile, a `<script integrity>`
//   tag or an inline base64 asset becomes `sensitive: true`. Lowercase hex
//   digests (`resolved …#9fceb02d…`, sha256 in stdout) and `data:` URIs
//   (`;` and `,` break the run) are not affected.
// - Over-redaction, safe side: the `*-assign` rules redact a variable
//   reference or expression as readily as a literal (`password: process.env.PW`,
//   `token: $TOKEN`, `password: ${{ secrets.PW }}`, `secret_name: db-creds`),
//   because an unquoted value with no digit can be a real weak password and a
//   `$`-prefixed one can be a real one. Custom type names without an
//   initializer (`password: SecureString;`) are redacted too; only the
//   built-in type and keyword words are exempt.
// - Over-redaction, safe side: `pem-block` treats a BEGIN header with no END
//   as truncated key material and redacts to the end of the text, so prose
//   such as `Found -----BEGIN CERTIFICATE----- header in README; see docs`
//   loses its tail. Requiring a newline + base64 line before the to-end
//   branch would fix the prose case but must keep the END search bounded
//   (a failing to-end branch makes every BEGIN start rescan to the end).
// - Gap: `bearer` requires a digit somewhere in the token so that
//   `Bearer authentication required` / `Authorization: bearer
//   authentication_required` prose is not redacted; a bearer token made only
//   of letters (`Bearer abcdefghijklmnopqrstuvwxyz`) passes through. Every
//   real-world bearer format (JWT, OAuth2 opaque, GitHub, Google) carries
//   digits; the JWT shape is caught by `jwt` regardless.
// - Gaps, v2 ticket: Azure SAS `SharedAccessSignature=sv=…&sig=…` is caught
//   only via `high-entropy-assign` on `sig=` (not when `%`-encoded within
//   32 chars); Stripe `sk_live_…`, Slack webhook URLs, `scheme://user:pass@host`
//   URL credentials, `Authorization: Basic …`, short CLI flags (`-p hunter2`),
//   a secret split across a line break (`password =\n  "…"`, an XML element
//   whose text starts on the next line), a C# property with initializer
//   (`Password { get; set; } = "…"`), a Markdown table cell (`| password |
//   hunter2 |`) and a reversed compare (`"admin123".equals(password)`,
//   `assertEquals("admin123", password)`) pass through untouched.
//
// redactDeep walks strings, plain objects (Object.prototype or null prototype)
// and arrays only. Anything else that is an object — Buffer/Uint8Array, Date,
// Map/Set, class instances — throws a TypeError naming the $-rooted path and
// the constructor. It must not pass through: the by-reference return is the
// "nothing matched" signal canon.writeArtifact hashes and persists as clean,
// and a JSON-serializable non-plain object (a Buffer serializes as
// {type:"Buffer",data:[…]}, a class instance as its own fields) would reach
// disk unredacted. Buffers go through redactString.

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
 * Numbers, booleans, null and undefined pass through. Plain objects (Object.prototype or null
 * prototype) and arrays are walked. Any other object — Buffer/Uint8Array, Date, Map/Set, class
 * instances — throws a TypeError naming the $-rooted JSON path (`$.runs[0].blob`) and the
 * constructor, because passing it through by reference would report it as clean (see below) and
 * JSON.stringify would still serialize its content. Redact a Buffer with redactString instead.
 *
 * When nothing matched, the input is returned by reference (deep-equal and identical), so a
 * writer that hashes the result sees the same bytes it would have hashed before redaction.
 *
 * Object keys that redact to the same marker do not collapse: the second and later ones are
 * suffixed `#2`, `#3`, … (`{"password=1": "a", "password=2": "b"}` →
 * `{"<REDACTED:password-assign>": "a", "<REDACTED:password-assign>#2": "b"}`), so no value is
 * dropped and the entry count survives. Keys that were not redacted are never renamed.
 * @template T
 * @param {T} value
 * @param {Rules} [rules]
 * @returns {T}
 * @throws {TypeError} on a non-plain object anywhere in the tree
 */
export function redactDeep(value, rules = DEFAULT_RULES) {
  return walk(value, rules, "$");
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `$.key` for identifier-shaped keys, `$["odd key"]` otherwise; `$[3]` for array indexes. */
function childPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function walk(value, rules, path) {
  if (typeof value === "string") {
    const { text, hits } = redactString(value, rules);
    return hits.length === 0 ? value : text;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let out = null;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const next = walk(item, rules, childPath(path, i));
      if (next !== item) {
        if (out === null) out = value.slice();
        out[i] = next;
      }
    }
    return out === null ? value : out;
  }
  if (!isPlainObject(value)) {
    const tag = value.constructor?.name ?? "object";
    throw new TypeError(
      `redactDeep: unsupported value at ${path} (${tag}); pass strings, plain objects and arrays only — redact a Buffer with redactString`,
    );
  }
  let changed = false;
  const entries = [];
  const taken = new Set();
  for (const key of Object.keys(value)) {
    const item = value[key];
    const nextKey = walk(key, rules, path);
    const nextItem = walk(item, rules, childPath(path, key));
    if (nextKey !== key || nextItem !== item) changed = true;
    if (nextKey === key) taken.add(key);
    entries.push([key, nextKey, nextItem]);
  }
  if (!changed) return value;
  // Two keys that redact to the same marker must not collapse into one entry (a value would be
  // silently dropped). Unredacted keys keep their name; a redacted key that collides with one
  // already placed gets `#2`, `#3`, … so the entry count survives.
  const out = [];
  for (const [key, nextKey, nextItem] of entries) {
    let k = nextKey;
    if (nextKey !== key) {
      for (let n = 2; taken.has(k); n++) k = `${nextKey}#${n}`;
      taken.add(k);
    }
    out.push([k, nextItem]);
  }
  // Object.fromEntries defines own data properties, so a key spelled `__proto__` (legal in JSON,
  // and JSON.parse yields it as an own property) stays an entry instead of hitting the
  // Object.prototype setter — which would drop a string value or, for an object value, make it
  // the prototype and turn the result into a non-plain object that the next pass rejects.
  return Object.fromEntries(out);
}

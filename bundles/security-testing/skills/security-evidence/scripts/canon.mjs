// canon.mjs — identity for every artifact this bundle writes or reads
// (TASK-002, US-002; spec §6.1, plan §3.3 row `canon.mjs`).
//
// Every artifact is `{envelope, payload}`. Identity = sha256(canonical(payload));
// `envelope.self_sha256` carries that value and the envelope is never part of
// any preimage (spec §6.1). This module is the one place that knows how the
// bytes behind that hash are produced, so every writer and reader goes
// through it:
//
//   parseStrict(text)        strict JSON reader — duplicate keys and floats
//                            are errors, not silently last-wins / rounded
//   canonical(value)         the bytes: NFC strings, keys sorted by UTF-8 byte
//                            order, no whitespace, integers only, `\u` escapes
//                            only for control characters
//   sha256Hex / hmacHex      hex digests over bytes (never over strings — the
//                            caller decides the encoding, see G-2)
//   makeEnvelope(head, p)    envelope with created_at = head.now() and
//                            self_sha256 = artifactId(payload); schema_version
//                            is required, never defaulted (a bump is a
//                            deliberate edit at every call site)
//   artifactId(payload)      sha256Hex(canonical(payload))
//   writeArtifact(path, a)   redactDeep(payload) (unless {prered: true}), then
//                            self_sha256 over the *redacted* payload (G-4), then
//                            tmp + rename ({exclusive: true}: tmp + link + unlink,
//                            so an existing file is an atomic EEXIST — write-once
//                            run files, G-10); nothing touches disk if redaction
//                            or canonicalisation throws
//   readArtifact(path)       parseStrict, shape check, optional kind check,
//                            recompute self_sha256 — mismatch ⇒ IntegrityError
//
// Why a hand-written reader: JSON.parse cannot see a duplicate key (the last
// one wins silently) and turns `1.0` / `1e3` / 2^53+1 into numbers that
// re-serialise differently from what was read, so a file could carry bytes
// whose identity depends on the parser. parseStrict rejects both classes.
//
// Why canonical() refuses non-plain objects: a Buffer serialises as
// `{type:"Buffer",data:[…]}` and a class instance as its own fields, so
// JSON.stringify would happily persist their content — unredacted when the
// caller said `prered: true`. The refusal lives in canonical() itself, not in
// writeArtifact, so no flag can bypass it.
//
// Imports only ./redact.mjs and node:*. No clock (G-1: created_at comes from
// the caller's `now()`), no child process (G-6), no network (G-14).

import { createHash, createHmac } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { DEFAULT_RULES, redactDeep } from "./redact.mjs";

/** Thrown for anything that is not canonical-representable: malformed JSON, duplicate keys, floats, undefined, non-plain objects. */
export class CanonError extends Error {
  /**
   * @param {string} message
   * @param {{offset?: number, path?: string}} [info] offset = character offset in the parsed text; path = file the text came from
   */
  constructor(message, info = {}) {
    super(info.path ? `${message} (${info.path})` : message);
    this.name = "CanonError";
    if (info.offset !== undefined) this.offset = info.offset;
    if (info.path !== undefined) this.path = info.path;
  }
}

/** Thrown by readArtifact when the file is not the artifact it claims to be: bad shape, wrong kind, or self_sha256 ≠ artifactId(payload). */
export class IntegrityError extends Error {
  /**
   * @param {string} path
   * @param {string} reason
   * @param {{expected?: string, actual?: string}} [info]
   */
  constructor(path, reason, info = {}) {
    super(`integrity: ${reason} (${path})`);
    this.name = "IntegrityError";
    this.path = path;
    this.reason = reason;
    if (info.expected !== undefined) this.expected = info.expected;
    if (info.actual !== undefined) this.actual = info.actual;
  }
}

// ---------------------------------------------------------------------------
// parseStrict

/** Nesting bound for the reader: deeper input is an error, never a stack overflow. */
const MAX_DEPTH = 512;

const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Parse JSON text strictly. Beyond RFC 8259: a duplicate key within one object
 * ⇒ CanonError("duplicate key …"); any number token containing `.`, `e` or `E`,
 * or an integer outside Number.isSafeInteger ⇒ CanonError("float not allowed").
 * One leading U+FEFF is ignored (RFC 8259 §8.1); `-0` reads as 0.
 * Objects are built with own data properties, so a `__proto__` key stays a key.
 * @param {string | Uint8Array} input UTF-8 bytes or a string
 * @returns {unknown}
 * @throws {CanonError} with `.offset` (character offset of the problem)
 * @throws {TypeError} when input is neither a string nor bytes
 */
export function parseStrict(input) {
  let text;
  if (typeof input === "string") {
    text = input;
  } else if (input instanceof Uint8Array) {
    try {
      text = utf8Strict.decode(input);
    } catch (err) {
      throw new CanonError(`invalid UTF-8: ${err.message}`, { offset: 0 });
    }
  } else {
    throw new TypeError(`parseStrict expects a string or Buffer, got ${input === null ? "null" : typeof input}`);
  }
  const reader = new Reader(text);
  reader.skipBom();
  reader.skipWs();
  const value = reader.value(0);
  reader.skipWs();
  if (reader.i !== text.length) reader.fail("unexpected trailing characters");
  return value;
}

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
/** RFC 8259 number grammar, matched in place (sticky) so the token is read where the cursor stands. */
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

class Reader {
  constructor(text) {
    this.text = text;
    this.i = 0;
  }

  fail(message, offset = this.i) {
    throw new CanonError(`${message} at offset ${offset}`, { offset });
  }

  skipBom() {
    if (this.text.charCodeAt(0) === 0xfeff) this.i = 1;
  }

  skipWs() {
    while (this.i < this.text.length && WS.has(this.text.charCodeAt(this.i))) this.i++;
  }

  peek() {
    return this.text[this.i];
  }

  value(depth) {
    const c = this.peek();
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return this.string();
    if (c === "-" || (c >= "0" && c <= "9")) return this.number();
    if (this.text.startsWith("true", this.i)) return (this.i += 4), true;
    if (this.text.startsWith("false", this.i)) return (this.i += 5), false;
    if (this.text.startsWith("null", this.i)) return (this.i += 4), null;
    if (c === undefined) this.fail("unexpected end of input");
    this.fail(`unexpected character ${JSON.stringify(c)}`);
  }

  object(depth) {
    if (depth >= MAX_DEPTH) this.fail(`nesting deeper than ${MAX_DEPTH}`);
    const start = this.i;
    this.i++; // {
    const out = {};
    const seen = new Set();
    this.skipWs();
    if (this.peek() === "}") return this.i++, out;
    for (;;) {
      this.skipWs();
      if (this.peek() !== '"') this.fail("expected string key");
      const keyOffset = this.i;
      const key = this.string();
      if (seen.has(key)) throw new CanonError(`duplicate key ${JSON.stringify(key)} at offset ${keyOffset}`, { offset: keyOffset });
      seen.add(key);
      this.skipWs();
      if (this.peek() !== ":") this.fail("expected ':' after key");
      this.i++;
      this.skipWs();
      const val = this.value(depth + 1);
      // own data property, never the __proto__ setter
      Object.defineProperty(out, key, { value: val, enumerable: true, writable: true, configurable: true });
      this.skipWs();
      const c = this.peek();
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "}") return this.i++, out;
      if (c === undefined) this.fail(`unterminated object starting at offset ${start}`);
      this.fail("expected ',' or '}' in object");
    }
  }

  array(depth) {
    if (depth >= MAX_DEPTH) this.fail(`nesting deeper than ${MAX_DEPTH}`);
    const start = this.i;
    this.i++; // [
    const out = [];
    this.skipWs();
    if (this.peek() === "]") return this.i++, out;
    for (;;) {
      this.skipWs();
      out.push(this.value(depth + 1));
      this.skipWs();
      const c = this.peek();
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "]") return this.i++, out;
      if (c === undefined) this.fail(`unterminated array starting at offset ${start}`);
      this.fail("expected ',' or ']' in array");
    }
  }

  string() {
    const start = this.i;
    this.i++; // opening quote
    let out = "";
    let segment = this.i;
    for (;;) {
      if (this.i >= this.text.length) this.fail(`unterminated string starting at offset ${start}`, start);
      const code = this.text.charCodeAt(this.i);
      if (code === 0x22) {
        out += this.text.slice(segment, this.i);
        this.i++;
        return out;
      }
      if (code < 0x20) this.fail("raw control character in string");
      if (code !== 0x5c) {
        this.i++;
        continue;
      }
      out += this.text.slice(segment, this.i);
      const esc = this.text[this.i + 1];
      if (esc === "u") {
        const hex = this.text.slice(this.i + 2, this.i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("bad \\u escape");
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 6;
      } else if (esc !== undefined && Object.hasOwn(ESCAPES, esc)) {
        out += ESCAPES[esc];
        this.i += 2;
      } else {
        this.fail(`bad escape \\${esc ?? ""}`);
      }
      segment = this.i;
    }
  }

  number() {
    const start = this.i;
    NUMBER.lastIndex = start;
    const m = NUMBER.exec(this.text);
    if (m === null) this.fail("malformed number");
    const token = m[0];
    this.i += token.length;
    if (/[.eE]/.test(token)) this.fail(`float not allowed: ${token}`, start);
    const n = Number(token);
    if (!Number.isSafeInteger(n)) this.fail(`float not allowed: ${token} is outside the safe integer range`, start);
    return n === 0 ? 0 : n; // -0 → 0
  }
}

// ---------------------------------------------------------------------------
// canonical

function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `$.key` / `$["odd key"]` / `$[3]` — the same path notation redact.mjs uses. */
function childPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Code-point order == UTF-8 byte order (UTF-8 is order-preserving over code
 * points). Plain `<` on JS strings compares UTF-16 code units, which puts
 * U+10000..U+10FFFF (surrogates D800..DFFF) before U+E000..U+FFFF — wrong.
 */
function compareCodePoints(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(j);
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1; // b is a proper prefix of a
  if (j < b.length) return -1; // a is a proper prefix of b
  return 0;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function encodeString(s, path) {
  if (LONE_SURROGATE.test(s)) throw new CanonError(`lone surrogate in string at ${path}: not representable in UTF-8`);
  // JSON.stringify's quoting is exactly the contract: `"` and `\` escaped,
  // U+0000..U+001F as \b \f \n \r \t or \u00xx, everything else raw.
  return JSON.stringify(s.normalize("NFC"));
}

/**
 * Canonical bytes of a JSON value (spec §6.1): UTF-8, strings NFC, object
 * keys sorted by UTF-8 byte order, no insignificant whitespace, integers only,
 * `\u` escapes only for control characters. Accepts strings, safe integers,
 * booleans, null, arrays and plain objects (Object.prototype or null
 * prototype). Anything else — floats, undefined, bigint, functions, symbols,
 * lone surrogates, Buffers, Dates, Maps, class instances, cycles — is a
 * CanonError naming the `$`-rooted path. Two keys that coincide after NFC are
 * a duplicate key.
 * @param {unknown} value
 * @returns {Buffer}
 */
export function canonical(value) {
  const parts = [];
  emit(value, "$", parts, new Set());
  return Buffer.from(parts.join(""), "utf8");
}

function emit(value, path, parts, stack) {
  switch (typeof value) {
    case "string":
      parts.push(encodeString(value, path));
      return;
    case "number":
      if (!Number.isSafeInteger(value)) throw new CanonError(`float not allowed at ${path}: ${String(value)}`);
      parts.push(value === 0 ? "0" : String(value));
      return;
    case "boolean":
      parts.push(value ? "true" : "false");
      return;
    case "object":
      break;
    default:
      // undefined, bigint, function, symbol
      throw new CanonError(`${typeof value} not allowed at ${path}`);
  }
  if (value === null) {
    parts.push("null");
    return;
  }
  if (stack.has(value)) throw new CanonError(`cycle at ${path}`);
  if (Array.isArray(value)) {
    stack.add(value);
    parts.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) parts.push(",");
      emit(value[i], childPath(path, i), parts, stack);
    }
    parts.push("]");
    stack.delete(value);
    return;
  }
  if (!isPlainObject(value)) {
    const tag = value.constructor?.name ?? "object";
    throw new CanonError(`non-plain object (${tag}) at ${path}; canonical() takes strings, integers, booleans, null, arrays and plain objects only`);
  }
  stack.add(value);
  const entries = [];
  const seen = new Set();
  for (const key of Object.keys(value)) {
    const nfc = key.normalize("NFC");
    if (seen.has(nfc)) throw new CanonError(`duplicate key ${JSON.stringify(nfc)} after NFC at ${path}`);
    seen.add(nfc);
    entries.push([nfc, key]);
  }
  entries.sort((a, b) => compareCodePoints(a[0], b[0]));
  parts.push("{");
  for (let i = 0; i < entries.length; i++) {
    const [nfc, key] = entries[i];
    if (i > 0) parts.push(",");
    parts.push(encodeString(nfc, path), ":");
    emit(value[key], childPath(path, key), parts, stack);
  }
  parts.push("}");
  stack.delete(value);
}

// ---------------------------------------------------------------------------
// digests

function requireBytes(value, fn, what) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${fn} expects ${what} as a Buffer/Uint8Array, got ${value === null ? "null" : typeof value}; encode strings explicitly`);
  }
  return value;
}

/**
 * Hex sha256 over bytes. Plain sha256 is for canonical payloads, redacted
 * bytes, executables and git metadata only (G-2) — content that can match a
 * redaction rule is keyed with hmacHex.
 * @param {Uint8Array} buf
 * @returns {string} 64 lowercase hex chars
 */
export function sha256Hex(buf) {
  return createHash("sha256").update(requireBytes(buf, "sha256Hex", "input")).digest("hex");
}

/**
 * Hex HMAC-SHA256 over bytes with the engagement key (spec §6.5 keyed identity).
 * @param {Uint8Array} keyBytes non-empty
 * @param {Uint8Array} buf
 * @returns {string} 64 lowercase hex chars
 */
export function hmacHex(keyBytes, buf) {
  requireBytes(keyBytes, "hmacHex", "the key");
  if (keyBytes.length === 0) throw new TypeError("hmacHex: key must not be empty");
  return createHmac("sha256", keyBytes).update(requireBytes(buf, "hmacHex", "input")).digest("hex");
}

// ---------------------------------------------------------------------------
// envelopes

/** Every envelope field (envelope.schema.json); the on-disk shape has exactly these keys. */
const ENVELOPE_KEYS = Object.freeze(["schema_version", "kind", "run_id", "engagement_id", "key_id", "created_at", "self_sha256"]);
const HEAD_KEYS = Object.freeze(["schema_version", "kind", "run_id", "engagement_id", "key_id", "now"]);

function requirePayload(payload, where) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || !isPlainObject(payload)) {
    throw new CanonError(`${where}: payload must be a plain object`);
  }
  return payload;
}

function requireNonEmptyString(value, name, where) {
  if (typeof value !== "string" || value.length === 0) throw new CanonError(`${where}: ${name} must be a non-empty string`);
  return value;
}

function requireString(value, name, where) {
  if (typeof value !== "string") throw new CanonError(`${where}: ${name} must be a string`);
  return value;
}

function requireSchemaVersion(value, where) {
  if (!Number.isSafeInteger(value) || value < 1) throw new CanonError(`${where}: schema_version is required and must be a positive integer (never defaulted)`);
  return value;
}

/** Shape-check a full envelope (as written or read); self_sha256 content is checked by the caller. */
function checkEnvelope(envelope, where) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope) || !isPlainObject(envelope)) {
    throw new CanonError(`${where}: envelope must be a plain object`);
  }
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.includes(key)) throw new CanonError(`${where}: unknown envelope key ${JSON.stringify(key)}`);
  }
  requireSchemaVersion(envelope.schema_version, where);
  requireNonEmptyString(envelope.kind, "kind", where);
  requireString(envelope.run_id, "run_id", where);
  requireString(envelope.engagement_id, "engagement_id", where);
  requireString(envelope.key_id, "key_id", where);
  requireNonEmptyString(envelope.created_at, "created_at", where);
  if (typeof envelope.self_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(envelope.self_sha256)) {
    throw new CanonError(`${where}: self_sha256 must be 64 lowercase hex characters`);
  }
  return envelope;
}

/**
 * sha256 over the canonical bytes of a payload — the artifact's identity.
 * @param {object} payload
 * @returns {string}
 */
export function artifactId(payload) {
  return sha256Hex(canonical(payload));
}

/**
 * Build an artifact. `schema_version` is required — never defaulted — so a
 * bump is a deliberate edit at every call site. `created_at = now()` (the
 * caller's clock, TL-11); `self_sha256 = artifactId(payload)`. The payload is
 * not redacted here: writeArtifact does that and recomputes self_sha256 over
 * the redacted bytes, so the identity on disk is always over what is on disk.
 * @param {{schema_version: number, kind: string, run_id: string, engagement_id: string, key_id: string, now: () => string}} head
 * @param {object} payload plain object
 * @returns {{envelope: object, payload: object}}
 */
export function makeEnvelope(head, payload) {
  const where = "makeEnvelope";
  if (head === null || typeof head !== "object" || Array.isArray(head)) throw new CanonError(`${where}: head must be an object`);
  for (const key of Object.keys(head)) {
    if (!HEAD_KEYS.includes(key)) throw new CanonError(`${where}: unknown head key ${JSON.stringify(key)}`);
  }
  const schema_version = requireSchemaVersion(head.schema_version, where);
  const kind = requireNonEmptyString(head.kind, "kind", where);
  const run_id = requireString(head.run_id, "run_id", where);
  const engagement_id = requireString(head.engagement_id, "engagement_id", where);
  const key_id = requireString(head.key_id, "key_id", where);
  if (typeof head.now !== "function") throw new CanonError(`${where}: now must be a function returning an ISO-8601 string`);
  requirePayload(payload, where);
  const self_sha256 = artifactId(payload);
  const created_at = requireNonEmptyString(head.now(), "now()", where);
  return {
    envelope: { schema_version, kind, run_id, engagement_id, key_id, created_at, self_sha256 },
    payload,
  };
}

// ---------------------------------------------------------------------------
// artifact I/O

let tmpCounter = 0;

/**
 * Persist an artifact: redact, re-identify, canonicalise, tmp + rename.
 *
 * Unless `prered: true`, `payload = redactDeep(payload, DEFAULT_RULES)` runs
 * first and `self_sha256` is recomputed over the redacted payload (G-4: the
 * identity is over what leaves memory). `prered: true` is the G-3 writer's
 * statement that the payload bytes were already redacted; it skips the payload
 * walk only — the envelope is redacted regardless, and canonical() still
 * refuses non-plain objects, so no flag lets a Buffer or class instance reach
 * disk. Every check runs before the first byte is written: a redactDeep
 * TypeError or a CanonError leaves no file and no tmp file behind. The file
 * is the canonical bytes of `{envelope, payload}` plus one trailing LF.
 * The caller's objects are never mutated; the returned artifact is what is on
 * disk (`envelope.self_sha256` is the value to print after `WROTE` — hand
 * this return value to ctx.wrote, never the makeEnvelope result).
 *
 * `exclusive: true` makes the write write-once (G-10: run files are created
 * once): the tmp file is `linkSync`ed to `path` — the kernel refuses with
 * `EEXIST` when `path` exists, atomically, with no check-then-write window —
 * and the tmp name is unlinked afterwards. The EEXIST propagates with its
 * `code` so a caller can turn it into its own token (`SNAPSHOT-EXISTS`, …).
 * @param {string} path
 * @param {{envelope: object, payload: object}} artifact
 * @param {{prered?: boolean, exclusive?: boolean}} [options]
 * @returns {{envelope: object, payload: object}}
 */
export function writeArtifact(path, artifact, { prered = false, exclusive = false } = {}) {
  const where = "writeArtifact";
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) throw new CanonError(`${where}: artifact must be {envelope, payload}`);
  for (const key of Object.keys(artifact)) {
    if (key !== "envelope" && key !== "payload") throw new CanonError(`${where}: unknown artifact key ${JSON.stringify(key)}`);
  }
  if (!("envelope" in artifact)) throw new CanonError(`${where}: artifact.envelope is missing`);
  if (!("payload" in artifact)) throw new CanonError(`${where}: artifact.payload is missing`);
  const rawEnvelope = artifact.envelope;
  if (rawEnvelope === null || typeof rawEnvelope !== "object" || Array.isArray(rawEnvelope) || !isPlainObject(rawEnvelope)) {
    throw new CanonError(`${where}: envelope must be a plain object`);
  }
  const payload = prered ? requirePayload(artifact.payload, where) : redactDeep(requirePayload(artifact.payload, where), DEFAULT_RULES);
  // The envelope carries script-derived strings (engagement_id comes from a
  // user-authored file); it is never hashed, so redacting it costs nothing and
  // keeps G-4 true for the whole file. self_sha256 is replaced below, never
  // trusted from the caller.
  const { self_sha256: _ignored, ...envelopeFields } = rawEnvelope;
  const envelope = { ...redactDeep(envelopeFields, DEFAULT_RULES), self_sha256: artifactId(payload) };
  checkEnvelope(envelope, where);
  const written = { envelope, payload };
  const bytes = Buffer.concat([canonical(written), Buffer.from("\n")]);

  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${++tmpCounter}`);
  try {
    writeFileSync(tmp, bytes, { flag: "wx" });
    if (exclusive) linkSync(tmp, path); // EEXIST from the kernel when path exists
    else renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  if (exclusive) rmSync(tmp, { force: true });
  return written;
}

/**
 * Read and verify an artifact. Malformed bytes or JSON ⇒ CanonError (with
 * `.path`); wrong shape, wrong `kind`, or `self_sha256 ≠ artifactId(payload)`
 * ⇒ IntegrityError. Whitespace and key order on disk are not identity, so a
 * reformatted file still verifies; a changed payload byte does not.
 * @param {string} path
 * @param {{kind?: string}} [options] expected envelope.kind
 * @returns {{envelope: object, payload: object}}
 */
export function readArtifact(path, { kind } = {}) {
  const bytes = readFileSync(path);
  let parsed;
  try {
    parsed = parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw new CanonError(err.message, { offset: err.offset, path });
    throw err;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new IntegrityError(path, "artifact is not an object");
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !Object.hasOwn(parsed, "envelope") || !Object.hasOwn(parsed, "payload")) {
    throw new IntegrityError(path, "artifact must have exactly {envelope, payload}");
  }
  const { envelope, payload } = parsed;
  try {
    checkEnvelope(envelope, "readArtifact");
    requirePayload(payload, "readArtifact");
  } catch (err) {
    if (err instanceof CanonError) throw new IntegrityError(path, err.message);
    throw err;
  }
  if (kind !== undefined && envelope.kind !== kind) {
    throw new IntegrityError(path, `kind mismatch: expected ${JSON.stringify(kind)}, found ${JSON.stringify(envelope.kind)}`, { expected: kind, actual: envelope.kind });
  }
  let actual;
  try {
    actual = artifactId(payload);
  } catch (err) {
    if (err instanceof CanonError) throw new CanonError(err.message, { path });
    throw err;
  }
  if (actual !== envelope.self_sha256) {
    throw new IntegrityError(path, `self_sha256 mismatch: envelope says ${envelope.self_sha256}, payload hashes to ${actual}`, {
      expected: envelope.self_sha256,
      actual,
    });
  }
  return { envelope, payload };
}

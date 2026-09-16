// lib/ingest/_sarif.mjs — the pure half of `ingest sarif` (TASK-016; spec
// §6.6 row `sarif`, §6.7 fallback matrix, D6 "scanners enter only as SARIF
// via a versioned mapping with a closed fallback matrix"; US-010).
// lib/ingest/sarif.mjs wires it to the mapping file and cite.resolveSide.
//
// What is read from a SARIF 2.1.0 log — the allowlist, nothing else:
//
//   tool.driver.name / version / semanticVersion
//   tool.driver.rules[].id / shortDescription / properties.tags / defaultConfiguration.level
//   results[].ruleId / ruleIndex / level / message.text / partialFingerprints
//   results[].locations[0].physicalLocation.artifactLocation.uri
//   results[].locations[0].physicalLocation.region.{startLine, endLine, snippet.text}
//
// `properties`, `fixes`, `codeFlows`, `relatedLocations`, `locations[1..]`,
// `uriBaseId`, `originalUriBaseIds` and everything else are never read: they
// stay in the redacted import blob and nowhere else.
//
// Trusted after validation (§6.6): the canonical in-repo path within scope,
// the rule id, the level — plus what the mapping derives from them (class,
// priority, confidence) and what the recorded side's bytes give (normalised
// line numbers). Inert: `message.text` and `snippet.text`, wrapInert'ed.
//
// Per result, in this order (the first outcome wins; every result is exactly
// one of located / unlocated / rejected — nothing promoted, nothing dropped):
//
//   1. rule       ruleIndex (integer into rules[]) and/or ruleId (non-empty
//                 string): both ⇒ must agree (else REJECT rule-mismatch);
//                 neither, or an unusable one ⇒ REJECT rule-missing; ruleId
//                 alone is looked up in rules[] (absent ⇒ RECORDED
//                 rule-not-in-metadata: no tags, no default level)
//   2. level      result.level ∈ error|warning|note|none, else REJECT
//                 level-invalid; absent ⇒ rule defaultConfiguration.level
//                 (RECORDED level-from-rule-default; an off-vocabulary default
//                 is RECORDED rule-default-level-invalid and treated as
//                 absent); absent ⇒ p3 (RECORDED level-absent)
//   3. location   locations[0].physicalLocation.artifactLocation.uri must
//                 canonicalise to a repo-relative posix path (canonicalUri —
//                 `file:` scheme allowed only for a relative path; absolute,
//                 `..`, `.`, empty segment, `%2e` spellings, backslash, NUL,
//                 other schemes ⇒ not canonicalisable) ⇒ else UNLOCATED
//                 no-location; the path must be a `scope.files[]` entry ⇒
//                 else UNLOCATED out-of-scope (scope membership is the rule —
//                 a symlink or a file outside scope_paths is never a scope
//                 file, so no path ever escapes through here); region absent
//                 or without startLine ⇒ UNLOCATED no-location
//   4. region     startLine integer ≥ 1; endLine absent ⇒ startLine (RECORDED
//                 endline-defaulted), else integer ≥ startLine; snippet, when
//                 present, `{text: string}` (a snippet object without text is
//                 an absent snippet) — else REJECT region-malformed
//   5. bytes      readSide(path, side) with the scope file's recorded side
//                 (head | snapshot), once per file; SARIF line numbers are RAW
//                 line numbers as the scanner counted them, while every
//                 citation consumer indexes NORMALISED lines (TASK-014: a
//                 blank line is not a line), so the raw region becomes
//                 `lines` via rawToNormalised — past the end of the file ⇒
//                 REJECT region-outside-file; only blank lines ⇒ REJECT
//                 region-blank; not UTF-8 ⇒ REJECT file-not-text. `region`
//                 keeps the scanner's raw numbers next to `lines`.
//   6. snippet    snippet.text, or the raw bytes of `lines` at the recorded
//                 side (RECORDED snippet-from-side); either way it leaves
//                 memory only through wrapInert (redacted once more, G-4)
//   7. mapping    toolKey(name) — exact or `<key> <suffix>`, case-insensitive
//                 — else `unknown` (RECORDED unknown-tool); class by
//                 precedence tags → rule-id prefix table (longest prefix;
//                 never for an unknown tool) → unmapped; priority from level
//                 (error p1, warning p2, note p3, none / absent p3);
//                 confidence = the tool's, or default_confidence for an
//                 unknown tool; a data-flow class (DATA_FLOW_CLASSES) ⇒
//                 requires_typed_citations: true (§6.7 last row)
//
// Record shape (`trusted` is the closed TRUSTED_KEYS set; the four
// OPTIONAL_TRUSTED_KEYS are present only when there is a value):
//
//   trusted  {tool, tool_key, tool_version?, rule_id, level?, priority,
//             confidence, class, class_source, cwe?, path, side, region,
//             lines, requires_typed_citations, recorded[], partial_fingerprints?}
//   inert    {message?, snippet}
//
// `tool` is the driver name as the file spells it — a label for
// coverage's scanner rows, never a reference; `partial_fingerprints` keeps
// the scanner's string-valued entries (its own identity of the result, for a
// later dedupe — opaque here). `locator.index` is the flat source ordinal
// across runs, so a reject keeps its number and records[] may skip one.
// Unlocated candidates are `{locator, reason, tool, rule_id}` — the
// import.schema.json Candidate shape, so gate copies them into
// unlocated.json unchanged (US-010 AC-4); rejects are `{locator, reason}`.
//
// Structural failures (root, runs[], tool.driver.name, rules[], results[]
// off-shape) are the kind's exit-2 result — CliError(2, SCHEMA-INVALID(sarif:
// …)), prose first, never a value (G-4's high-entropy rule). `scope === null`
// ⇒ 3 INCOMPLETE(scope) before anything is read (§6.1 order). readSide
// failures propagate untouched: the I/O layer maps them.
//
// Pure (G-9 shape): imports ./_shared.mjs (inScope, wrapInert), ../cite-core.mjs
// (lineMap, rangeBytes), ../../normalize.mjs (EncodingError), ../exit.mjs,
// ../tokens.mjs. No fs, no child process, no git, no clock, no network.

import { EncodingError } from "../../normalize.mjs";
import { lineMap, rangeBytes } from "../cite-core.mjs";
import { CliError, EXIT } from "../exit.mjs";
import {
  SARIF_ENDLINE_DEFAULTED,
  SARIF_FILE_NOT_TEXT,
  SARIF_LEVEL_ABSENT,
  SARIF_LEVEL_FROM_RULE_DEFAULT,
  SARIF_LEVEL_INVALID,
  SARIF_REGION_BLANK,
  SARIF_REGION_MALFORMED,
  SARIF_REGION_OUTSIDE_FILE,
  SARIF_RULE_DEFAULT_LEVEL_INVALID,
  SARIF_RULE_MISMATCH,
  SARIF_RULE_MISSING,
  SARIF_RULE_NOT_IN_METADATA,
  SARIF_SNIPPET_FROM_SIDE,
  SARIF_UNKNOWN_TOOL,
  UNLOCATED_NO_LOCATION,
  UNLOCATED_OUT_OF_SCOPE,
  incomplete,
  schemaInvalid,
} from "../tokens.mjs";
import { inScope, wrapInert } from "./_shared.mjs";

export const KIND = "sarif";

/** `rejected[].reason` vocabulary (tokens.mjs rows, grouped). */
export const REJECT = Object.freeze({
  RULE_MISSING: SARIF_RULE_MISSING,
  RULE_MISMATCH: SARIF_RULE_MISMATCH,
  LEVEL_INVALID: SARIF_LEVEL_INVALID,
  REGION_MALFORMED: SARIF_REGION_MALFORMED,
  REGION_OUTSIDE_FILE: SARIF_REGION_OUTSIDE_FILE,
  REGION_BLANK: SARIF_REGION_BLANK,
  FILE_NOT_TEXT: SARIF_FILE_NOT_TEXT,
});

/** `trusted.recorded[]` vocabulary (tokens.mjs rows, grouped), in evaluation order. */
export const RECORDED = Object.freeze({
  UNKNOWN_TOOL: SARIF_UNKNOWN_TOOL,
  RULE_NOT_IN_METADATA: SARIF_RULE_NOT_IN_METADATA,
  RULE_DEFAULT_LEVEL_INVALID: SARIF_RULE_DEFAULT_LEVEL_INVALID,
  LEVEL_FROM_RULE_DEFAULT: SARIF_LEVEL_FROM_RULE_DEFAULT,
  LEVEL_ABSENT: SARIF_LEVEL_ABSENT,
  ENDLINE_DEFAULTED: SARIF_ENDLINE_DEFAULTED,
  SNIPPET_FROM_SIDE: SARIF_SNIPPET_FROM_SIDE,
});

/** SARIF 2.1.0 `level` vocabulary. */
export const LEVELS = Object.freeze(["error", "warning", "note", "none"]);
/** Finding classes whose evidence is a source → sink flow: `REVIEW` requires typed citations (spec §6.7 last row). */
export const DATA_FLOW_CLASSES = Object.freeze(["injection", "xss", "ssrf", "path-traversal", "deserialization"]);
/** `class_source` vocabulary, in precedence order. */
export const CLASS_SOURCES = Object.freeze(["tags", "rule-prefix", "unmapped"]);
/** The mapping key a tool outside the mapping resolves to. */
export const UNKNOWN_TOOL = "unknown";
/** The closed `trusted` key set of a located SARIF record. */
export const TRUSTED_KEYS = Object.freeze([
  "tool", "tool_key", "tool_version", "rule_id", "level", "priority", "confidence", "class", "class_source", "cwe",
  "path", "side", "region", "lines", "requires_typed_citations", "recorded", "partial_fingerprints",
]);
/** TRUSTED_KEYS entries present only when there is a value. */
export const OPTIONAL_TRUSTED_KEYS = Object.freeze(["tool_version", "level", "cwe", "partial_fingerprints"]);

const P3 = "p3";
const UNMAPPED = "unmapped";
const structural = (reason) => new CliError(EXIT.USAGE, schemaInvalid(KIND, reason));

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const nonEmptyString = (v) => typeof v === "string" && v !== "";

// --- URI canonicalisation -----------------------------------------------------------

const CWE_IN_TAG = /(?:^|[^a-z0-9])cwe[-_/ ]?0*([0-9]+)(?![0-9])/i;

/**
 * The repo-relative posix path a SARIF `artifactLocation.uri` names, or null
 * when it cannot be canonicalised inside the repo (§6.7 row 1): percent-
 * decoded once, a `file:` scheme stripped only when what follows is relative,
 * one leading `./` dropped; then no other scheme, no leading `/`, no
 * backslash, no NUL, no empty / `.` / `..` segment. `%2e` spellings are
 * caught by decoding first, so `src/%2e%2e/x` is `..` like any other.
 * @param {unknown} uri
 * @returns {string|null}
 */
export function canonicalUri(uri) {
  if (typeof uri !== "string" || uri === "") return null;
  let s;
  try {
    s = decodeURIComponent(uri);
  } catch {
    return null;
  }
  if (s.toLowerCase().startsWith("file:")) s = s.slice(5);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // any other scheme
  if (s.startsWith("./")) s = s.slice(2);
  if (s === "" || s.startsWith("/") || s.includes("\\") || s.includes("\0")) return null;
  const segments = s.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === ".." || seg.trim() === "")) return null;
  return s;
}

// --- mapping ------------------------------------------------------------------------

/**
 * The mapping's tool key for a driver name: exact, or `<key> <suffix>`
 * (`Semgrep OSS` → `semgrep`), case-insensitive; the reserved `unknown` key
 * is never matched by name. Anything else ⇒ `unknown`.
 * @param {object} mapping sarif-mapping.v1
 * @param {string} name tool.driver.name
 * @returns {string}
 */
export function toolKey(mapping, name) {
  const lower = String(name).toLowerCase();
  for (const key of Object.keys(mapping.tools)) {
    if (key === UNKNOWN_TOOL) continue;
    const k = key.toLowerCase();
    if (lower === k || lower.startsWith(`${k} `)) return key;
  }
  return UNKNOWN_TOOL;
}

/**
 * Class precedence (plan §5 TASK-016): tags → rule-id prefix table → unmapped.
 * A tag matches `tag_class` exactly (case-insensitive) or by any CWE spelling
 * inside it (`CWE-89: …`, `external/cwe/cwe-089`) normalised to `CWE-<n>`;
 * the first mapped tag wins, and the first CWE seen is recorded as `cwe`
 * even when it maps nothing. The prefix table is the tool's own; an unknown
 * tool has none (§6.7 "class from tags only"); the longest matching prefix
 * wins. Tags are data: a non-array or a non-string entry maps nothing.
 * @param {object} mapping
 * @param {string} key tool key (toolKey)
 * @param {string} ruleId
 * @param {unknown} tags rules[].properties.tags
 * @returns {{class: string, class_source: string, cwe?: string}}
 */
export function classify(mapping, key, ruleId, tags) {
  const byTag = new Map(Object.entries(mapping.tag_class).map(([t, c]) => [t.toLowerCase(), c]));
  let cwe;
  let cls;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag !== "string") continue;
      const lower = tag.toLowerCase();
      const m = CWE_IN_TAG.exec(tag);
      const cweId = m ? `CWE-${Number.parseInt(m[1], 10)}` : undefined;
      if (cweId !== undefined && cwe === undefined) cwe = cweId;
      if (cls !== undefined) continue;
      if (byTag.has(lower)) cls = byTag.get(lower);
      else if (cweId !== undefined && byTag.has(cweId.toLowerCase())) cls = byTag.get(cweId.toLowerCase());
    }
  }
  const out = { class: UNMAPPED, class_source: UNMAPPED };
  if (cls !== undefined) {
    out.class = cls;
    out.class_source = "tags";
  } else if (key !== UNKNOWN_TOOL) {
    const table = mapping.tools[key]?.rule_prefix_class ?? {};
    let best = null;
    for (const prefix of Object.keys(table)) {
      if (ruleId.startsWith(prefix) && (best === null || prefix.length > best.length)) best = prefix;
    }
    if (best !== null) {
      out.class = table[best];
      out.class_source = "rule-prefix";
    }
  }
  if (cwe !== undefined) out.cwe = cwe;
  return out;
}

/**
 * Level → priority: `level_priority[level]`; `none` (a SARIF level that
 * means "not a problem") ⇒ p3, like absent.
 * @param {object} mapping
 * @param {string} level ∈ LEVELS
 * @returns {string}
 */
export function priorityOf(mapping, level) {
  if (!LEVELS.includes(level)) throw new TypeError(`priorityOf: level must be one of ${LEVELS.join("|")}, got ${String(level)}`);
  return level === "none" ? P3 : mapping.level_priority[level];
}

// --- raw → normalised line numbers -----------------------------------------------------

const LF = 0x0a;
const CR = 0x0d;

/** Byte offset at which each raw line starts (terminators `\r\n`, `\r`, `\n`, like cite-core.lineMap); an empty buffer has no lines. */
function rawLineStarts(buf) {
  const n = buf.length;
  if (n === 0) return [];
  const starts = [0];
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b !== LF && b !== CR) continue;
    if (b === CR && buf[i + 1] === LF) i++;
    if (i + 1 < n) starts.push(i + 1);
  }
  return starts;
}

/**
 * The normalised `[start, end]` a raw SARIF region `[startLine, endLine]`
 * denotes in `buf` (TASK-014: citations index normalised lines). Blank raw
 * lines at either edge of the region are stepped over; a region made of
 * blank lines only, or one that runs past the file, cannot be cited.
 * @param {Buffer|Uint8Array} buf the file bytes at the recorded side
 * @param {number} startLine raw, 1-based
 * @param {number} endLine raw, 1-based, ≥ startLine
 * @returns {{ok: true, lines: [number, number], map: {lines: string[], spans: object[]}} | {ok: false, reason: string}}
 */
export function rawToNormalised(buf, startLine, endLine) {
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new TypeError(`rawToNormalised: need integers 1 ≤ startLine ≤ endLine, got [${String(startLine)}, ${String(endLine)}]`);
  }
  let map;
  try {
    map = lineMap(buf);
  } catch (err) {
    if (err instanceof EncodingError) return { ok: false, reason: REJECT.FILE_NOT_TEXT };
    throw err;
  }
  const starts = rawLineStarts(buf);
  if (endLine > starts.length) return { ok: false, reason: REJECT.REGION_OUTSIDE_FILE };
  const byStart = new Map(map.spans.map((span, i) => [span.start, i + 1]));
  let first = null;
  let last = null;
  for (let r = startLine; r <= endLine; r++) {
    const norm = byStart.get(starts[r - 1]);
    if (norm === undefined) continue;
    if (first === null) first = norm;
    last = norm;
  }
  if (first === null) return { ok: false, reason: REJECT.REGION_BLANK };
  return { ok: true, lines: [first, last], map };
}

// --- structure --------------------------------------------------------------------------

function parseDriver(run, where) {
  const driver = run?.tool?.driver;
  if (!isPlainObject(driver) || !nonEmptyString(driver.name)) throw structural(`${where}.tool.driver.name must be a non-empty string`);
  for (const key of ["version", "semanticVersion"]) {
    if (driver[key] !== undefined && driver[key] !== null && typeof driver[key] !== "string") throw structural(`${where}.tool.driver.${key} must be a string`);
  }
  let rules = [];
  if (driver.rules !== undefined && driver.rules !== null) {
    if (!Array.isArray(driver.rules)) throw structural(`${where}.tool.driver.rules must be an array`);
    rules = driver.rules.map((rule, i) => {
      if (!isPlainObject(rule) || !nonEmptyString(rule.id)) throw structural(`${where}.tool.driver.rules[${i}].id must be a non-empty string`);
      return rule;
    });
  }
  const version = nonEmptyString(driver.semanticVersion) ? driver.semanticVersion : nonEmptyString(driver.version) ? driver.version : undefined;
  return { name: driver.name, version, rules };
}

function parseResults(run, where) {
  if (run.results === undefined || run.results === null) return [];
  if (!Array.isArray(run.results)) throw structural(`${where}.results must be an array`);
  return run.results.map((r, i) => {
    if (!isPlainObject(r)) throw structural(`${where}.results[${i}] must be an object`);
    return r;
  });
}

// --- per-result steps ----------------------------------------------------------------------

/** Step 1: `{rule_id, rule}` (rule may be null), or `{reject}`. */
function resolveRule(result, rules) {
  const { ruleId, ruleIndex } = result;
  const hasId = ruleId !== undefined && ruleId !== null;
  const hasIndex = ruleIndex !== undefined && ruleIndex !== null;
  if (hasId && !nonEmptyString(ruleId)) return { reject: REJECT.RULE_MISSING };
  if (hasIndex && (!Number.isSafeInteger(ruleIndex) || ruleIndex < 0 || ruleIndex >= rules.length)) return { reject: REJECT.RULE_MISSING };
  if (!hasId && !hasIndex) return { reject: REJECT.RULE_MISSING };
  if (hasIndex) {
    const rule = rules[ruleIndex];
    if (hasId && rule.id !== ruleId) return { reject: REJECT.RULE_MISMATCH };
    return { rule_id: rule.id, rule };
  }
  const rule = rules.find((r) => r.id === ruleId) ?? null;
  return { rule_id: ruleId, rule };
}

/** Step 2: `{level?, notes[]}` or `{reject}`. */
function resolveLevel(result, rule) {
  const notes = [];
  if (result.level !== undefined && result.level !== null) {
    if (!LEVELS.includes(result.level)) return { reject: REJECT.LEVEL_INVALID };
    return { level: result.level, notes };
  }
  const dflt = rule?.defaultConfiguration?.level;
  if (dflt !== undefined && dflt !== null) {
    if (LEVELS.includes(dflt)) {
      notes.push(RECORDED.LEVEL_FROM_RULE_DEFAULT);
      return { level: dflt, notes };
    }
    notes.push(RECORDED.RULE_DEFAULT_LEVEL_INVALID);
  }
  notes.push(RECORDED.LEVEL_ABSENT);
  return { notes };
}

/** Step 3: `{path, file, region}` (region may be null ⇒ no-location), or `{unlocated}`. */
function resolveLocation(result, scope) {
  const loc = Array.isArray(result.locations) ? result.locations[0] : undefined;
  const physical = isPlainObject(loc) ? loc.physicalLocation : undefined;
  const uri = isPlainObject(physical) && isPlainObject(physical.artifactLocation) ? physical.artifactLocation.uri : undefined;
  const path = canonicalUri(uri);
  if (path === null) return { unlocated: UNLOCATED_NO_LOCATION };
  if (!inScope(scope, path)) return { unlocated: UNLOCATED_OUT_OF_SCOPE };
  const file = scope.payload.files.find((f) => f.path === path);
  const region = physical.region;
  if (!isPlainObject(region) || region.startLine === undefined || region.startLine === null) return { unlocated: UNLOCATED_NO_LOCATION };
  return { path, file, region };
}

/** Step 4: `{startLine, endLine, snippet?, notes[]}` or `{reject}`. */
function resolveRegion(region) {
  const notes = [];
  const { startLine } = region;
  if (!Number.isSafeInteger(startLine) || startLine < 1) return { reject: REJECT.REGION_MALFORMED };
  let endLine = region.endLine;
  if (endLine === undefined || endLine === null) {
    endLine = startLine;
    notes.push(RECORDED.ENDLINE_DEFAULTED);
  } else if (!Number.isSafeInteger(endLine) || endLine < startLine) {
    return { reject: REJECT.REGION_MALFORMED };
  }
  let snippet;
  if (region.snippet !== undefined && region.snippet !== null) {
    if (!isPlainObject(region.snippet)) return { reject: REJECT.REGION_MALFORMED };
    const { text } = region.snippet;
    if (text !== undefined && text !== null) {
      if (typeof text !== "string") return { reject: REJECT.REGION_MALFORMED };
      snippet = text;
    }
  }
  return { startLine, endLine, snippet, notes };
}

function fingerprints(value) {
  if (!isPlainObject(value)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length === 0 ? undefined : out;
}

// --- adaptSarif -------------------------------------------------------------------------------

/**
 * @param {unknown} sarif the redacted, parsed SARIF log
 * @param {{scope: object|null, locatorBase: {import_sha256: string, original_hmac: string}, mapping: object, readSide: (path: string, side: string) => Buffer}} deps
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(sarif: …) on an off-shape file · 3 INCOMPLETE(scope) without scope.json
 */
export function adaptSarif(sarif, { scope, locatorBase, mapping, readSide }) {
  if (typeof readSide !== "function") throw new TypeError("adaptSarif: readSide must be a function");
  if (!isPlainObject(mapping) || typeof mapping.version !== "string") throw new TypeError("adaptSarif: mapping must be a sarif-mapping.v1 object");
  if (!isPlainObject(sarif)) throw structural("root must be an object");
  if (!Array.isArray(sarif.runs)) throw structural("runs must be an array");
  if (scope === null || scope === undefined) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
  const { import_sha256, original_hmac } = locatorBase;

  const records = [];
  const unlocated = [];
  const rejected = [];
  const bytesOf = new Map(); // path → {buf} once per file, whatever the number of results citing it
  const readOnce = (path, side) => {
    if (!bytesOf.has(path)) bytesOf.set(path, readSide(path, side));
    return bytesOf.get(path);
  };
  let index = 0;

  sarif.runs.forEach((run, r) => {
    const where = `runs[${r}]`;
    if (!isPlainObject(run)) throw structural(`${where} must be an object`);
    const driver = parseDriver(run, where);
    const key = toolKey(mapping, driver.name);
    const confidence = key === UNKNOWN_TOOL ? mapping.default_confidence : mapping.tools[key].confidence;

    for (const result of parseResults(run, where)) {
      const i = index++;
      const reject = (reason) => rejected.push({ locator: { import_sha256, index: i }, reason });

      const rule = resolveRule(result, driver.rules);
      if (rule.reject) {
        reject(rule.reject);
        continue;
      }
      const level = resolveLevel(result, rule.rule);
      if (level.reject) {
        reject(level.reject);
        continue;
      }
      const location = resolveLocation(result, scope);
      if (location.unlocated) {
        unlocated.push({ locator: { import_sha256, index: i }, reason: location.unlocated, tool: driver.name, rule_id: rule.rule_id });
        continue;
      }
      const region = resolveRegion(location.region);
      if (region.reject) {
        reject(region.reject);
        continue;
      }
      const buf = readOnce(location.path, location.file.side);
      const mapped = rawToNormalised(buf, region.startLine, region.endLine);
      if (!mapped.ok) {
        reject(mapped.reason);
        continue;
      }

      const recorded = [];
      if (key === UNKNOWN_TOOL) recorded.push(RECORDED.UNKNOWN_TOOL);
      if (rule.rule === null) recorded.push(RECORDED.RULE_NOT_IN_METADATA);
      recorded.push(...level.notes, ...region.notes);
      let snippetText = region.snippet;
      if (snippetText === undefined) {
        snippetText = rangeBytes(buf, mapped.lines[0], mapped.lines[1], mapped.map).toString("utf8");
        recorded.push(RECORDED.SNIPPET_FROM_SIDE);
      }

      const cls = classify(mapping, key, rule.rule_id, rule.rule?.properties?.tags);
      const trusted = { tool: driver.name, tool_key: key };
      if (driver.version !== undefined) trusted.tool_version = driver.version;
      trusted.rule_id = rule.rule_id;
      if (level.level !== undefined) trusted.level = level.level;
      trusted.priority = level.level === undefined ? P3 : priorityOf(mapping, level.level);
      trusted.confidence = confidence;
      trusted.class = cls.class;
      trusted.class_source = cls.class_source;
      if (cls.cwe !== undefined) trusted.cwe = cls.cwe;
      trusted.path = location.path;
      trusted.side = location.file.side;
      trusted.region = [region.startLine, region.endLine];
      trusted.lines = mapped.lines;
      trusted.requires_typed_citations = DATA_FLOW_CLASSES.includes(cls.class);
      trusted.recorded = recorded;
      const fp = fingerprints(result.partialFingerprints);
      if (fp !== undefined) trusted.partial_fingerprints = fp;

      const inert = {};
      const message = isPlainObject(result.message) ? result.message.text : undefined;
      if (typeof message === "string") inert.message = wrapInert(message);
      inert.snippet = wrapInert(snippetText);

      records.push({ locator: { import_sha256, original_hmac, index: i }, trusted, inert });
    }
  });

  return { records, unlocated, rejected, mapping_version: mapping.version };
}

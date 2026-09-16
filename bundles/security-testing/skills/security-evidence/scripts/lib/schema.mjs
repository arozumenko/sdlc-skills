// lib/schema.mjs — stdlib JSON-Schema validator for exactly the keyword
// subset the security-evidence schemas use (TASK-005). Anything outside the
// subset throws at load time so a schema can never be silently under-checked.
//
// Supported keywords: type (object|array|string|integer|boolean|null),
// required, properties, patternProperties, additionalProperties (false only),
// enum, const, items, minItems, maxItems, minimum, maximum, pattern,
// oneOf (exactly one alternative must match), $ref (to #/$defs/<Name> in the
// same document only). Annotation keys ($schema, $id, $comment, title,
// description) are ignored; $defs is allowed at the document root only.
//
// Leaf module: imports only node:fs, node:path, node:url.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

export const SCHEMA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "references");

export const SUPPORTED_KEYWORDS = Object.freeze([
  "type",
  "required",
  "properties",
  "patternProperties",
  "additionalProperties",
  "enum",
  "const",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "pattern",
  "oneOf",
  "$ref",
]);

const ANNOTATION_KEYWORDS = Object.freeze(["$schema", "$id", "$comment", "title", "description"]);
const TYPES = Object.freeze(["object", "array", "string", "integer", "boolean", "null"]);
const REF_RE = /^#\/\$defs\/([A-Za-z0-9_-]+)$/;

// Envelope `kind` list (plan §4.1). Every kind must resolve to a schema name.
export const ENVELOPE_KINDS = Object.freeze([
  "run",
  "engagement",
  "scope",
  "examined",
  "import",
  "claimed",
  "gate-result",
  "rejects",
  "unlocated",
  "coverage",
  "packet",
  "receipt",
  "verify",
  "manifest",
  "export-manifest",
  "threat-model",
  "dispositions",
  "admission",
  "observation",
  "baseline",
  "citation-record",
  "register-snapshot",
  "imports-index",
  "observations-index",
  "proposals-index",
]);

// Keys an agent-authored receipt (or claim) may never carry (US-015 AC-7,
// G-7). `receipt validate` names the offending key in its REJECTED token.
export const RECEIPT_FORBIDDEN_KEYS = Object.freeze(["state", "verdict", "id", "gate", "gate_stamp", "states"]);

// Shapes that TASK-005 places inside another file's `$defs` (so a Finding is
// spelled once) are addressed by alias: `validate("claimed", …)` validates
// against `finding.schema.json#/$defs/Claimed`. A file-only alias (`manifest`)
// maps an envelope kind onto the file that defines it.
export const SCHEMA_ALIASES = Object.freeze({
  claim: { file: "finding", def: "Claim" },
  claims: { file: "finding", def: "ClaimSet" },
  claimed: { file: "finding", def: "Claimed" },
  rejects: { file: "import", def: "Rejects" },
  unlocated: { file: "import", def: "Unlocated" },
  manifest: { file: "run-manifest" },
  "register-event": { file: "register", def: "Event" },
  "register-snapshot": { file: "register", def: "Snapshot" },
  "finding-alias": { file: "register", def: "Alias" },
  dispositions: { file: "threat-model", def: "Dispositions" },
});

function schemaFileNames() {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => f.slice(0, -".schema.json".length))
    .sort();
}

// Every name `validate()` accepts: one per schema file plus the aliases.
export const SCHEMA_NAMES = Object.freeze([...new Set([...schemaFileNames(), ...Object.keys(SCHEMA_ALIASES)])].sort());

// ---------------------------------------------------------------------------
// Loading and compile-time checks
// ---------------------------------------------------------------------------

const cache = new Map(); // name → checked root schema
const regexCache = new Map(); // pattern source → RegExp

function regexFor(source) {
  let re = regexCache.get(source);
  if (!re) {
    try {
      re = new RegExp(source, "u");
    } catch (e) {
      throw new SchemaError(`invalid pattern ${JSON.stringify(source)}: ${e.message}`);
    }
    regexCache.set(source, re);
  }
  return re;
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Walk a schema document and throw on anything outside the subset. `root` is
// the document whose `$defs` every `$ref` must resolve against.
function check(node, root, where) {
  if (!isPlainObject(node)) throw new SchemaError(`${where}: schema must be an object`);
  for (const key of Object.keys(node)) {
    if (key === "$defs") {
      if (where !== "#") throw new SchemaError(`${where}: $defs is allowed only at the document root`);
      continue;
    }
    if (ANNOTATION_KEYWORDS.includes(key)) continue;
    if (!SUPPORTED_KEYWORDS.includes(key)) throw new SchemaError(`${where}: unsupported keyword "${key}"`);
  }
  if ("type" in node) {
    if (node.type === "number") throw new SchemaError(`${where}: type "number" is forbidden; use "integer"`);
    if (typeof node.type !== "string" || !TYPES.includes(node.type)) {
      throw new SchemaError(`${where}: unsupported type ${JSON.stringify(node.type)}`);
    }
  }
  if ("additionalProperties" in node && node.additionalProperties !== false) {
    throw new SchemaError(`${where}: additionalProperties must be false (got ${JSON.stringify(node.additionalProperties)})`);
  }
  if ("$ref" in node) {
    const m = typeof node.$ref === "string" ? REF_RE.exec(node.$ref) : null;
    if (!m) throw new SchemaError(`${where}: $ref must point at #/$defs/<Name> in the same document (got ${JSON.stringify(node.$ref)})`);
    if (!root.$defs || !isPlainObject(root.$defs[m[1]])) throw new SchemaError(`${where}: $ref to missing definition ${m[1]}`);
  }
  if ("required" in node && !(Array.isArray(node.required) && node.required.every((k) => typeof k === "string"))) {
    throw new SchemaError(`${where}: required must be an array of strings`);
  }
  if ("enum" in node && !Array.isArray(node.enum)) throw new SchemaError(`${where}: enum must be an array`);
  for (const k of ["minItems", "maxItems", "minimum", "maximum"]) {
    if (k in node && !Number.isInteger(node[k])) throw new SchemaError(`${where}: ${k} must be an integer`);
  }
  if ("pattern" in node) {
    if (typeof node.pattern !== "string") throw new SchemaError(`${where}: pattern must be a string`);
    regexFor(node.pattern);
  }
  if ("properties" in node) {
    if (!isPlainObject(node.properties)) throw new SchemaError(`${where}: properties must be an object`);
    for (const [k, v] of Object.entries(node.properties)) check(v, root, `${where}/properties/${k}`);
  }
  if ("patternProperties" in node) {
    if (!isPlainObject(node.patternProperties)) throw new SchemaError(`${where}: patternProperties must be an object`);
    for (const [k, v] of Object.entries(node.patternProperties)) {
      regexFor(k);
      check(v, root, `${where}/patternProperties/${k}`);
    }
  }
  if ("items" in node) check(node.items, root, `${where}/items`);
  if ("oneOf" in node) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) throw new SchemaError(`${where}: oneOf must be a non-empty array`);
    node.oneOf.forEach((alt, i) => check(alt, root, `${where}/oneOf/${i}`));
  }
  if (where === "#" && node.$defs) {
    if (!isPlainObject(node.$defs)) throw new SchemaError("#: $defs must be an object");
    for (const [k, v] of Object.entries(node.$defs)) check(v, root, `#/$defs/${k}`);
  }
}

// Resolve a `#/$defs/<Name>` reference against a root document.
export function resolveRef(root, ref) {
  const m = REF_RE.exec(ref ?? "");
  if (!m || !root.$defs || !isPlainObject(root.$defs[m[1]])) throw new SchemaError(`cannot resolve ${JSON.stringify(ref)}`);
  return root.$defs[m[1]];
}

function readSchemaFile(file) {
  const path = join(SCHEMA_DIR, `${file}.schema.json`);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new SchemaError(`unknown schema "${file}" (no ${path})`);
  }
  return JSON.parse(text);
}

// Root-only keys a grouped file (one addressed by aliases) may carry: the
// alias synthesises a new root `$ref`, so the file root must not add
// constraints of its own that the alias would silently drop.
const GROUP_ROOT_KEYS = Object.freeze(["$defs", "$ref", ...ANNOTATION_KEYWORDS]);

// loadSchema(name) → checked root schema object (cached).
//   name: a schema file name (`references/<name>.schema.json`), an alias from
//   SCHEMA_ALIASES, or `{name, schema}` for an inline document (tests).
export function loadSchema(name) {
  if (isPlainObject(name)) {
    const { name: inlineName, schema } = name;
    check(schema, schema, "#");
    return schema;
  }
  if (typeof name !== "string") throw new SchemaError(`schema name must be a string (got ${typeof name})`);
  const hit = cache.get(name);
  if (hit) return hit;

  let root;
  const alias = SCHEMA_ALIASES[name];
  if (alias) {
    const fileRoot = readSchemaFile(alias.file);
    if (alias.def) {
      const extra = Object.keys(fileRoot).filter((k) => !GROUP_ROOT_KEYS.includes(k));
      if (extra.length) throw new SchemaError(`${alias.file}.schema.json: grouped file root may carry only $defs/$ref (found ${extra.join(", ")})`);
      root = { ...fileRoot, $ref: `#/$defs/${alias.def}` };
    } else {
      root = fileRoot;
    }
  } else {
    root = readSchemaFile(name);
  }
  check(root, root, "#");
  cache.set(name, root);
  return root;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v; // object | string | boolean
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const childPath = (path, key) => (IDENT_RE.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);

function walk(schema, root, value, path, errors) {
  if (schema.$ref) schema = resolveRef(root, schema.$ref);
  const t = typeOf(value);

  if (schema.type !== undefined && schema.type !== t) {
    errors.push(`${path}: expected ${schema.type}, got ${t}`);
    return; // nothing below can be meaningfully checked
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(value, e))) {
    errors.push(`${path}: not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (t === "integer") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
  }
  if (t === "string" && schema.pattern !== undefined && !regexFor(schema.pattern).test(value)) {
    errors.push(`${path}: does not match pattern ${schema.pattern}`);
  }
  if (t === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: ${value.length} items is below minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: ${value.length} items is above maxItems ${schema.maxItems}`);
    if (schema.items !== undefined) value.forEach((item, i) => walk(schema.items, root, item, `${path}[${i}]`, errors));
  }
  if (t === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}: missing required ${JSON.stringify(key)}`);
    }
    const props = schema.properties ?? {};
    const patterns = Object.entries(schema.patternProperties ?? {});
    for (const [key, v] of Object.entries(value)) {
      let matched = false;
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        matched = true;
        walk(props[key], root, v, childPath(path, key), errors);
      }
      for (const [source, sub] of patterns) {
        if (regexFor(source).test(key)) {
          matched = true;
          walk(sub, root, v, childPath(path, key), errors);
        }
      }
      if (!matched && schema.additionalProperties === false) errors.push(`${path}: unknown key ${JSON.stringify(key)}`);
    }
  }
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((alt) => {
      const sub = [];
      walk(alt, root, value, path, sub);
      return sub;
    });
    const matched = results.filter((r) => r.length === 0).length;
    if (matched !== 1) {
      const detail =
        matched === 0
          ? ` (${results.map((r, i) => `alt ${i}: ${r[0]}`).join("; ")})`
          : "";
      errors.push(`${path}: expected exactly one of ${schema.oneOf.length} alternatives to match, matched ${matched}${detail}`);
    }
  }
}

// validate(schemaName, value) → string[] of errors (empty = valid).
//   schemaName: a name accepted by loadSchema, or a root schema object it
//   returned.
export function validate(schemaName, value) {
  const root = isPlainObject(schemaName) ? schemaName : loadSchema(schemaName);
  const errors = [];
  walk(root, root, value, "$", errors);
  return errors;
}

// forbiddenKeys(value, keys?) → the forbidden key names present anywhere in
// `value` (objects nested in objects/arrays included), each once, in
// encounter order. Used by `receipt validate` and `gate` so the rejection
// names the key (`REJECTED(forbidden field <name>)`, `agent-wrote-id`).
export function forbiddenKeys(value, keys = RECEIPT_FORBIDDEN_KEYS) {
  const found = [];
  const visit = (v) => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (isPlainObject(v)) {
      for (const [k, item] of Object.entries(v)) {
        if (keys.includes(k) && !found.includes(k)) found.push(k);
        visit(item);
      }
    }
  };
  visit(value);
  return found;
}

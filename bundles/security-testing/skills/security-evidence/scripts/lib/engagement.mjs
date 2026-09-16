// lib/engagement.mjs — the engagement.md machine record (TASK-007; plan TL-5,
// §3.3 row `lib/engagement.mjs`; spec §6.9, D18/P6).
//
// `engagement.md` is a human-edited Markdown file. Its machine record is the
// one fenced block tagged `json engagement` (TL-5): stdlib-only, no YAML,
// and read with canon.parseStrict so a duplicate key or a float is an error
// instead of a silently different record. `run init` snapshots the parsed
// record as `<run>/engagement.json`; every later command reads that snapshot
// or `ctx.engagement()` (TASK-006), which is `parseEngagementMd` over
// `<st>/engagement.md` and throws `CliError(2, "ENGAGEMENT-MISSING")` when
// the file is absent.
//
//   parseEngagementMd(text) → record
//       find the block · parseStrict · refuse artifact_policy.private
//       (POLICY-INVALID(private), TL-13) · validate against the `engagement`
//       schema (ENGAGEMENT-INVALID(<errors>)). Pure over its input.
//   defaultRecord() → a fresh copy of the record the shipped template carries
//       (engagement.test.mjs pins the two equal, so the template can never
//       drift from what the code calls the default).
//   TEMPLATE_PATHS → {name → absolute path} of the three knowledge files
//       shipped under <skill>/templates/knowledge/, the copies
//       knowledge-templates.ensureTemplates (TASK-011) installs into
//       <st>/knowledge/ when the bundle `seed` did not.
//
// Imports only ../canon.mjs, ./schema.mjs, ./exit.mjs (CliError, the one
// class the dispatcher maps to an exit code), ./tokens.mjs (the result
// strings, G-13) and node:path/url: no fs writes, no child process (G-6),
// no network (G-14), no clock (G-1).

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict, CanonError } from "../canon.mjs";
import { validate } from "./schema.mjs";
import { CliError, EXIT } from "./exit.mjs";
import { POLICY_INVALID_PRIVATE, engagementInvalid } from "./tokens.mjs";

/** File name of the engagement record under `<st>/`. */
export const ENGAGEMENT_FILE = "engagement.md";

/** The three knowledge files, in the order plan §3.2 lists them. */
export const KNOWLEDGE_FILES = Object.freeze(["engagement.md.template", "finding-schema.md", "report-reading-guide.md"]);

/** `<skill>/templates/knowledge/` — the copies the standalone install ships (the bundle `seed` has its own under `bundles/security-testing/knowledge/`, kept byte-identical by check-skill-dupes). */
export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "knowledge");

/** `{name → absolute path}` for every KNOWLEDGE_FILES entry. */
export const TEMPLATE_PATHS = Object.freeze(Object.fromEntries(KNOWLEDGE_FILES.map((name) => [name, join(TEMPLATE_DIR, name)])));

// The record carried by templates/knowledge/engagement.md.template. Edit both
// together; engagement.test.mjs "template parses and validates" fails otherwise.
const DEFAULT_RECORD = Object.freeze({
  engagement_id: "eng-2026-001",
  slug: "my-product",
  scope_paths: ["src/"],
  product_paths: ["src/", "package.json", "package-lock.json"],
  targets: {
    tracker: ["github.com"],
    browser: ["staging.example.com"],
    repo: "my-org/my-product",
  },
  base_url: "https://staging.example.com",
  execute_project_tests: {
    argv: ["npm", "test"],
    timeout_s: 600,
    install: {
      argv: ["npm", "ci"],
      allow_tracked_changes: false,
    },
  },
  sign_off: {
    require_dispositions: "executed-or-ticketed",
  },
  artifact_policy: {
    ledger: "local",
    runs: "local",
    receipts: "local",
    proposals: "local",
    handoffs: "local",
    imports: "local",
    register: "local",
    reports: "local",
    cases: "local",
  },
});

/**
 * The record the shipped `engagement.md.template` carries, as a fresh
 * mutable deep copy (callers edit it in tests and never touch the constant).
 * @returns {Record<string, unknown>}
 */
export function defaultRecord() {
  return structuredClone(DEFAULT_RECORD);
}

// ---------------------------------------------------------------------------
// Block extraction

// A CommonMark fence: up to three spaces of indentation, three or more of one
// fence character, then the info string. The record's info string is the two
// words `json engagement` (any inner whitespace, nothing else).
const OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*json[ \t]+engagement[ \t]*$/;

/**
 * Find the `json engagement` fenced block. Returns `{text, startLine, endLine}`
 * (1-based line numbers of the block's content) or `null` when there is none.
 * Throws CliError(2, ENGAGEMENT-INVALID(…)) for an unterminated fence or a
 * second block: both make "the record" ambiguous, so neither is silently
 * picked.
 * Enclosing fences are not tracked: a literal `json engagement` opener inside
 * another fenced block (a ```markdown example, say) counts as a block, so a
 * file with the real record plus such an example fails closed as "more than
 * one" rather than either being picked.
 * @param {string} text
 * @returns {{text: string, startLine: number, endLine: number} | null}
 */
export function findEngagementBlock(text) {
  if (typeof text !== "string") throw new TypeError("findEngagementBlock: text must be a string");
  const lines = text.split(/\r?\n/);
  let found = null;
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN_RE.exec(lines[i]);
    if (!open) continue;
    if (found) throw invalid("more than one json engagement block");
    const fence = open[1];
    const closeRe = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (closeRe.test(lines[j])) {
        end = j;
        break;
      }
    }
    if (end < 0) throw invalid("unterminated json engagement block");
    found = { text: lines.slice(i + 1, end).join("\n"), startLine: i + 2, endLine: end };
    i = end;
  }
  return found;
}

// ---------------------------------------------------------------------------
// parseEngagementMd

const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Parse `engagement.md` text into its validated machine record.
 * @param {string | Uint8Array} input the file's text or bytes
 * @returns {Record<string, unknown>} the record, exactly as written (no defaults filled in)
 * @throws {CliError} `2 POLICY-INVALID(private)` when `artifact_policy.private` is present (TL-13);
 *   `2 ENGAGEMENT-INVALID(<reason>)` for a missing, duplicated or unterminated block,
 *   a parse error (duplicate key, float, malformed JSON), a non-object payload or any schema error
 * @throws {TypeError} when input is neither a string nor bytes
 */
export function parseEngagementMd(input) {
  let text;
  if (typeof input === "string") {
    text = input;
  } else if (input instanceof Uint8Array) {
    try {
      text = utf8Strict.decode(input);
    } catch (err) {
      throw invalid(`invalid UTF-8: ${err.message}`);
    }
  } else {
    throw new TypeError("parseEngagementMd: input must be a string or Uint8Array");
  }

  const block = findEngagementBlock(text);
  if (!block) throw invalid("no json engagement block");
  if (block.text.trim() === "") throw invalid("empty json engagement block");

  let record;
  try {
    record = parseStrict(block.text);
  } catch (err) {
    if (err instanceof CanonError) throw invalid(err.message);
    throw err;
  }
  if (!isPlainObject(record)) throw invalid(`expected object, got ${Array.isArray(record) ? "array" : record === null ? "null" : typeof record}`);

  // TL-13: key material under private/ can never be un-ignored by policy, so
  // `private` is not a policy key at all — refused before schema validation so
  // the token names the policy, not a generic unknown-key error.
  if (isPlainObject(record.artifact_policy) && Object.hasOwn(record.artifact_policy, "private")) {
    throw new CliError(EXIT.USAGE, POLICY_INVALID_PRIVATE);
  }

  const errors = validate("engagement", record);
  if (errors.length > 0) throw invalid(errors.join("; "));
  return record;
}

function invalid(reason) {
  return new CliError(EXIT.USAGE, engagementInvalid(reason));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

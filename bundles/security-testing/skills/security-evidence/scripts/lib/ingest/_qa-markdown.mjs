// lib/ingest/_qa-markdown.mjs — the Markdown subset the manual-qa formats
// are written in (TASK-018; spec §6.6 rows case / audit / qa-run). Stdlib
// has no YAML and no Markdown parser (G-11), so the three text adapters
// share this one reader instead of three private ones. It reads the shapes
// bundles/manual-qa/knowledge/test-case-format.md,
// test-run-report-format.md and the qa-auditor methodology actually use —
// nothing more general:
//
//   splitFrontmatter(text)      a leading `---` block → {frontmatter, body};
//                               no block ⇒ {frontmatter: null, body: text}
//   parseFrontmatter(block)     the YAML subset those formats use: one
//                               `key: value` per line; value = bare scalar,
//                               "double" / 'single' quoted scalar, an inline
//                               list `[a, b, "c, d"]`, or empty (⇒ null);
//                               a trailing `# comment` is dropped from an
//                               unquoted scalar (the annotated template has
//                               them). Duplicate keys, indented or non-key
//                               lines ⇒ MarkdownFormatError — a record with
//                               two `id:` lines has no id.
//   findTable(body, headingRe)  the first GFM pipe table after the heading
//                               line matching `headingRe` and before the next
//                               heading → {columns, rows} (cells trimmed,
//                               outer pipes optional, the |---| separator
//                               skipped); null when there is none
//   sections(body, level)       [{title, text}] for every `#{level} ` heading,
//                               each with the text up to the next heading of
//                               that level or higher
//   fencedBlock(body, lang)     the first ```<lang> fence's content, or null;
//                               an unterminated fence ⇒ MarkdownFormatError
//
// The adapters map MarkdownFormatError to their own exit-2 token
// (SCHEMA-INVALID(<kind>: <reason>)) — a malformed *input* is never left to
// the dispatcher (lib/exit.mjs, input-side rule). Leaf: no fs, no child
// process, no git, no network (G-6, G-14), no clock (G-1).

export class MarkdownFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarkdownFormatError";
  }
}

const FENCE_LINE = /^---\s*$/;

/**
 * @param {string} text
 * @returns {{frontmatter: Record<string, string | null | string[]> | null, body: string}}
 * @throws {MarkdownFormatError} unterminated block, or a block parseFrontmatter refuses
 * @throws {TypeError} when `text` is not a string
 */
export function splitFrontmatter(text) {
  if (typeof text !== "string") throw new TypeError("splitFrontmatter: text must be a string");
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !FENCE_LINE.test(lines[0])) return { frontmatter: null, body: text };
  const close = lines.findIndex((line, i) => i > 0 && FENCE_LINE.test(line));
  if (close < 0) throw new MarkdownFormatError("frontmatter block is not terminated by a --- line");
  const frontmatter = parseFrontmatter(lines.slice(1, close).join("\n"));
  const body = lines.slice(close + 1).join("\n");
  return { frontmatter, body };
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;
const QUOTED = /^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$/;

function unquote(raw) {
  const m = QUOTED.exec(raw);
  if (!m) return null;
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2].replace(/\\(.)/g, "$1");
}

/** A bare scalar with a trailing ` # comment` dropped (a `#` inside the value, as in a URL fragment, is kept). */
function bareScalar(raw) {
  if (raw.startsWith("#")) return ""; // a comment-only value (`size:   # S | M | L`)
  const cut = raw.search(/[ \t]#/);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

function scalar(raw) {
  const q = unquote(raw);
  if (q !== null) return q;
  const bare = bareScalar(raw);
  return bare === "" ? null : bare;
}

/** `[a, b, "c, d"]` → items; quoted items may contain commas. */
function inlineList(inner) {
  const items = [];
  let i = 0;
  const s = inner.trim();
  if (s === "") return items;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    let item;
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      let j = i + 1;
      while (j < s.length && s[j] !== quote) j += s[j] === "\\" ? 2 : 1;
      if (j >= s.length) throw new MarkdownFormatError(`unterminated quoted list item in [${inner}]`);
      item = unquote(s.slice(i, j + 1));
      i = j + 1;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (i < s.length && s[i] !== ",") throw new MarkdownFormatError(`unexpected text after a quoted list item in [${inner}]`);
    } else {
      const j = s.indexOf(",", i);
      item = (j < 0 ? s.slice(i) : s.slice(i, j)).trim();
      i = j < 0 ? s.length : j;
    }
    items.push(item);
    if (i < s.length && s[i] === ",") i += 1;
  }
  return items;
}

/**
 * @param {string} block the lines between the fences
 * @returns {Record<string, string | null | string[]>}
 * @throws {MarkdownFormatError}
 */
export function parseFrontmatter(block) {
  if (typeof block !== "string") throw new TypeError("parseFrontmatter: block must be a string");
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const m = KEY_LINE.exec(line);
    if (!m) throw new MarkdownFormatError(`frontmatter line is not \`key: value\`: ${line.trim().slice(0, 40)}`);
    const [, key, rawValue] = m;
    if (Object.hasOwn(out, key)) throw new MarkdownFormatError(`duplicate frontmatter key ${key}`);
    const raw = (rawValue ?? "").trim();
    if (raw.startsWith("[")) {
      const close = raw.lastIndexOf("]");
      if (close < 0) throw new MarkdownFormatError(`unterminated list for ${key}`);
      out[key] = inlineList(raw.slice(1, close));
    } else {
      out[key] = scalar(raw);
    }
  }
  return out;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const TABLE_ROW = /^\s*\|?.*\|.*$/;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/**
 * @param {string} body
 * @param {RegExp} headingRe matched against whole lines
 * @returns {{columns: string[], rows: string[][]} | null}
 */
export function findTable(body, headingRe) {
  if (typeof body !== "string") throw new TypeError("findTable: body must be a string");
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start < 0) return null;
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    if (HEADING.test(lines[i])) return null;
    if (TABLE_ROW.test(lines[i]) && i + 1 < lines.length && SEPARATOR.test(lines[i + 1])) break;
  }
  if (i + 1 >= lines.length) return null;
  const columns = cells(lines[i]);
  const rows = [];
  for (let j = i + 2; j < lines.length && TABLE_ROW.test(lines[j]) && !HEADING.test(lines[j]); j += 1) {
    const row = cells(lines[j]);
    while (row.length < columns.length) row.push("");
    rows.push(row.slice(0, columns.length));
  }
  return { columns, rows };
}

/**
 * @param {string} body
 * @param {number} level 1–6
 * @returns {{title: string, text: string}[]}
 */
export function sections(body, level) {
  if (typeof body !== "string") throw new TypeError("sections: body must be a string");
  if (!Number.isInteger(level) || level < 1 || level > 6) throw new TypeError("sections: level must be 1–6");
  const lines = body.split(/\r?\n/);
  const out = [];
  let current = null;
  let inFence = null;
  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (inFence === null) inFence = fence[1];
      else if (fence[1][0] === inFence[0] && fence[1].length >= inFence.length) inFence = null;
      if (current) current.lines.push(line);
      continue;
    }
    const h = inFence === null ? HEADING.exec(line) : null;
    if (h && h[1].length <= level) {
      if (current) out.push({ title: current.title, text: current.lines.join("\n") });
      current = h[1].length === level ? { title: h[2], lines: [] } : null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) out.push({ title: current.title, text: current.lines.join("\n") });
  return out;
}

/**
 * @param {string} body
 * @param {string} lang the info string, exactly
 * @returns {string | null} the block content (with its trailing newline), or null
 * @throws {MarkdownFormatError} when the matching fence is never closed
 */
export function fencedBlock(body, lang) {
  if (typeof body !== "string") throw new TypeError("fencedBlock: body must be a string");
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[ \t]*$/.exec(lines[i]);
    if (!open) continue;
    const [, fence, info] = open;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[j]);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
    }
    if (j >= lines.length) throw new MarkdownFormatError(`unterminated \`\`\`${info} fence`);
    if (info === lang) return `${lines.slice(i + 1, j).join("\n")}\n`;
    i = j;
  }
  return null;
}

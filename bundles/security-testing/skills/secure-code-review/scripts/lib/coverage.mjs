// lib/coverage.mjs — the exactly-once tiling behind `COVERAGE examined=<n>
// partial=<n> unexamined=<n>` (spec §2, §6). Every line of every scope file
// lands in exactly one range: the reviewer's `examined[] = [{path, lines?}]`
// is merged per path (overlaps and adjacent ranges coalesce, ranges are
// clamped to the file), and each file becomes one row —
//   examined    the merged ranges cover lines 1..n
//   partial     some lines are examined; `unexamined` lists the holes
//   unexamined  no line is examined (a zero-line file is always this)
// `ranges` holds the examined ranges (the whole file on an examined row,
// the whole file on an unexamined row so the row still tiles it); on a
// partial row `ranges` + `unexamined` together tile the file exactly once.
// Simplified from the reference implementation's `coverage-core.mjs` to the
// one status set the minimal bundle has. Leaf module: no I/O, no git — the
// caller supplies the file list (`git ls-files -- <scope_paths>`) and the
// line counts (raw lines at the review head).

/** An `examined[]` entry that cannot be tiled: not a scope file, or malformed. */
export class CoverageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CoverageError";
  }
}

const isLineNumber = (n) => Number.isSafeInteger(n) && n >= 1;

/**
 * Merge sorted-by-construction ranges: overlapping or adjacent runs coalesce.
 * @param {[number, number][]} ranges
 * @returns {[number, number][]}
 */
function merge(ranges) {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Tile `examined` against `files`, exactly once.
 * @param {string[]} files scope files as `git ls-files` prints them (canonical, in that order)
 * @param {{path: string, lines?: [number, number]}[]} examined the reviewer's declaration; no `lines` means the whole file
 * @param {Map<string, number>} lineCounts raw line count per file at the review head
 * @returns {{examined: number, partial: number, unexamined: number, rows: {path: string, status: "examined"|"partial"|"unexamined", ranges: [number, number][], unexamined?: [number, number][]}[]}}
 * @throws {CoverageError} an examined path not in `files`, a malformed entry, or a file without a line count
 */
export function tileCoverage(files, examined, lineCounts) {
  if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) throw new TypeError("tileCoverage: files must be an array of strings");
  if (!(lineCounts instanceof Map)) throw new TypeError("tileCoverage: lineCounts must be a Map");
  if (!Array.isArray(examined)) throw new CoverageError("examined must be an array");
  const inScope = new Set(files);
  const whole = new Set();
  const byPath = new Map();
  examined.forEach((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new CoverageError(`examined[${i}] must be an object {path, lines?}`);
    const { path, lines } = entry;
    if (typeof path !== "string" || path.length === 0) throw new CoverageError(`examined[${i}].path must be a non-empty string`);
    if (!inScope.has(path)) throw new CoverageError(`not in scope: ${path}`);
    if (lines === undefined) {
      whole.add(path);
      return;
    }
    if (!Array.isArray(lines) || lines.length !== 2 || !isLineNumber(lines[0]) || !isLineNumber(lines[1]) || lines[1] < lines[0]) {
      throw new CoverageError(`examined[${i}].lines must be [start, end] with 1 ≤ start ≤ end`);
    }
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push([lines[0], lines[1]]);
  });

  const counts = { examined: 0, partial: 0, unexamined: 0 };
  const rows = files.map((path) => {
    const n = lineCounts.get(path);
    if (!Number.isSafeInteger(n) || n < 0) throw new CoverageError(`no line count for ${path}`);
    if (n === 0) {
      counts.unexamined++;
      return { path, status: "unexamined", ranges: [] };
    }
    const full = [[1, n]];
    if (whole.has(path)) {
      counts.examined++;
      return { path, status: "examined", ranges: full };
    }
    const declared = (byPath.get(path) ?? []).filter(([s]) => s <= n).map(([s, e]) => [s, Math.min(e, n)]);
    if (declared.length === 0) {
      counts.unexamined++;
      return { path, status: "unexamined", ranges: full };
    }
    const ranges = merge(declared);
    if (ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] === n) {
      counts.examined++;
      return { path, status: "examined", ranges: full };
    }
    const holes = [];
    let cursor = 1;
    for (const [s, e] of ranges) {
      if (s > cursor) holes.push([cursor, s - 1]);
      cursor = e + 1;
    }
    if (cursor <= n) holes.push([cursor, n]);
    counts.partial++;
    return { path, status: "partial", ranges, unexamined: holes };
  });
  return { ...counts, rows };
}

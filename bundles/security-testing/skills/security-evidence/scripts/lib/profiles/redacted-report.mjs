// lib/profiles/redacted-report.mjs — the `redacted-report` publication
// profile (TASK-031; spec §6.9 "profiles: redacted-report"; plan §5 TASK-031
// "report minus snippets, reproduction and infra paths"; US-023 AC-1).
//
// Output: `report.md` = the run's rendered report with three kinds of line
// removed, keyed on the renderer's own shapes (lib/render.mjs, TL-7 markers)
// so the rule is exact rather than heuristic:
//
//   snippets      every indented code block the renderer emits — a label line
//                 `<label>: <!-- v:<path> -->`, a blank line, one or more
//                 four-space-indented lines, a blank line — is replaced by
//                 one line `<label>: withheld by the redacted-report profile
//                 <!-- v:<path> -->`. That covers each finding's evidence
//                 (`findings[i].evidence`: `snippet`, `snippet_redacted` and
//                 `context_redacted` alike — a redacted snippet is still a
//                 snippet) and a verify report's bounded test output
//                 (`verify.tests.output_redacted`).
//   reproduction  the finding table row marked `findings[i].reproduction`.
//   infra paths   the verify table row marked `verify.tests.executable_path`
//                 (a machine path) and any line naming the bundle's own
//                 state tree (`.agents/`) — local layout a reader outside the
//                 repository has no use for. Repository paths (`src/db.js`)
//                 are the report's content and stay.
//
// The markers stay in the derivative: they are HTML comments (invisible when
// rendered) and let a reader trace a line back to the run's report. The
// transform is a pure function of the report text; `check-export` re-runs it
// over the source and byte-compares.
//
// Pure (G-9): no imports beyond the profile contract's needs — no fs, no git,
// no clock.

export const PROFILE = "redacted-report";
export const PROFILE_VERSION = 1;
/** The output set (relpaths under `--to`). */
export const OUTPUTS = Object.freeze(["report.md"]);

const WITHHELD = "withheld by the redacted-report profile";
const CODE_LABEL = /^(.+): (<!-- v:[A-Za-z0-9_.[\]-]+ -->)$/;
const INDENTED = /^    /;
const REPRODUCTION_ROW = /<!-- v:findings\[\d+\]\.reproduction -->$/;
const INFRA_ROW = /<!-- v:verify\.tests\.executable_path -->$/;
const LOCAL_LAYOUT = /\.agents\//;

/**
 * The redacted-report transform over a rendered report (see the header).
 * @param {string} text the run's report.md
 * @returns {string}
 */
export function redactReport(text) {
  if (typeof text !== "string") throw new TypeError("redactReport: text must be a string");
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // an indented code block: label, blank, indented lines…, blank
    const label = CODE_LABEL.exec(line);
    if (label && lines[i + 1] === "" && INDENTED.test(lines[i + 2] ?? "")) {
      let j = i + 2;
      while (j < lines.length && INDENTED.test(lines[j])) j++;
      out.push(`${label[1]}: ${WITHHELD} ${label[2]}`);
      i = lines[j] === "" ? j : j - 1; // consume the closing blank line (the label's own blank stays with the next line)
      out.push("");
      continue;
    }
    if (REPRODUCTION_ROW.test(line)) continue;
    if (INFRA_ROW.test(line)) continue;
    if (LOCAL_LAYOUT.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * @param {import("./_source.mjs").Source} source
 * @param {object | null} _register unused
 * @param {object} _opts unused
 * @returns {{relpath: string, bytes: Buffer}[]}
 */
export function apply(source, _register, _opts) {
  return [{ relpath: OUTPUTS[0], bytes: Buffer.from(redactReport(source.report.toString("utf8")), "utf8") }];
}

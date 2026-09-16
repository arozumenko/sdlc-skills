// fixtures/sarif — TASK-016 (`ingest sarif`, spec §6.6 row `sarif`, §6.7
// fallback matrix, US-010). One SARIF 2.1.0 file per matrix row plus the AC-1
// (hostile message) and AC-3 (counted rejections) inputs. Every file cites
// the consumer-repo layout the tests build: `src/db.js` (in scope, 9 raw
// lines / 7 normalised, raw line 8 carries `password=1234`) and
// `docs/notes.md` (tracked, outside `scope_paths: [src/]`).
//
//   located.sarif          baseline (Semgrep OSS): located, snippet + level present, tags CWE-89 ⇒
//                          injection (data-flow); message.text carries a path-like instruction,
//                          a citation, a shell command and a secret (US-010 AC-1)
//   no-location.sarif      §6.7 row 1: no locations / no physicalLocation / absolute file: URI /
//                          `..` / `%2e%2e` / region absent ⇒ six unlocated `no-location`
//   out-of-scope.sarif     §6.7 row 2: docs/notes.md and src/missing.js ⇒ unlocated `out-of-scope`
//   endline-absent.sarif   §6.7 row 3: startLine without endLine ⇒ endLine = startLine
//   snippet-absent.sarif   §6.7 row 4: region without snippet ⇒ snippet read from the recorded
//                          side (the second result cites the secret line: read raw, stored redacted)
//   level-absent.sarif     §6.7 row 5: level absent ⇒ rule defaultConfiguration.level; absent ⇒ p3
//   rule-mismatch.sarif    §6.7 row 6: ruleIndex names a rule whose id ≠ ruleId ⇒ rejected
//   unknown-tool.sarif     §6.7 row 7: tool outside the mapping ⇒ class from tags only, confidence 3
//   region-malformed.sarif §6.7 row 8: endLine < startLine, string / float startLine ⇒ rejected;
//                          a region past the end of the file is rejected too
//   dataflow.sarif         §6.7 row 9 (CodeQL): xss ⇒ requires_typed_citations; secret / crypto ⇒ not
//   gitleaks.sarif         class via the rule-id prefix table when a tool ships no tags
//   rejections.sarif       US-010 AC-3: three rejections, two distinct reasons, one located
//   not-sarif.json         structural failure: no `runs` ⇒ 2 SCHEMA-INVALID(sarif: …)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SARIF_FIXTURES = dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => join(SARIF_FIXTURES, name);
export const FIXTURE_NAMES = Object.freeze([
  "located.sarif",
  "no-location.sarif",
  "out-of-scope.sarif",
  "endline-absent.sarif",
  "snippet-absent.sarif",
  "level-absent.sarif",
  "rule-mismatch.sarif",
  "unknown-tool.sarif",
  "region-malformed.sarif",
  "dataflow.sarif",
  "gitleaks.sarif",
  "rejections.sarif",
  "not-sarif.json",
]);

/** The in-scope file every fixture cites (raw lines 1-9; blank raw lines 2 and 7 have no normalised line). */
export const DB_JS = [
  'import { pool } from "./pool.js";',
  "",
  "export function find(req) {",
  '  const q = "SELECT * FROM users WHERE id = " + req.query.id;',
  "  return pool.query(q);",
  "}",
  "",
  "// password=1234",
  'export const token = "x";',
  "",
].join("\n");

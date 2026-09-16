// lib/ingest/audit.mjs — `ingest audit <reports/audit-<target>-<date>.md>`
// (TASK-018; spec §6.6 row `audit`: structural validation = the qa-auditor
// report Markdown + its JSON block; trusted after validation = finding
// titles and URLs whose host ∈ targets.browser; inert = evidence text).
// US-012 AC-2.
//
// The format is bundles/manual-qa/agents/qa-auditor/references/
// audit-methodology.md (§ Finding Schema, § Step 5 report template):
// frontmatter `target, date, pages_audited[], specialists_run[]`, then per
// finding `#### [P0, confidence 9] {title}` with `**Affected pages:**`,
// `**Reasoning:**`, `**Evidence:**`, `**Suggested fix:**`, `**Fix prompt:**`
// lines. The fixture scripts/fixtures/qa/audit-report.md is a verbatim copy
// of the bundle's documented example (kept identical by
// bin/check-skill-dupes.mjs) and ends with a `## Findings (JSON)` section
// holding a ```json block: the Finding Schema array (+ `affected_pages`,
// `evidence`) — the machine-readable half §6.6 names. The block is the fence
// under that heading; a report without the heading is read from its **last**
// ```json fence when that fence is an array (an `**Evidence:**` line may
// quote a JSON response body in a fence of its own — never the findings), and
// otherwise in its heading form (`#### [P0, confidence 9] title`,
// `findings_source: "markdown"`) — the methodology's template writes no block,
// so a real qa-auditor report ingests too. The two describe the same findings
// in the fixture (audit.test.mjs pins it).
//
// Records (locator.index = the source ordinal: 0 the audit, k the k-th
// finding; a rejected finding keeps its ordinal):
//   0        trusted {record: "audit", target, date, pages_audited[],
//                     specialists_run[], findings, findings_source}
//            `target` / `pages_audited` entries survive only when
//            hostAllowed(url, targets.browser); the rest are quoted in
//            inert.target / inert.untrusted_pages. `specialists_run` keeps
//            the SPECIALISTS tokens only. `date` is YYYY-MM-DD from the
//            frontmatter (import data, not this process's clock).
//   k ≥ 1    trusted {record: "finding", title, priority, confidence, urls[]}
//            `title` is the §6.6 trusted field (already redacted by the
//            import store; wrapInert is for prose, a title is an identity);
//            `priority` ∈ PRIORITIES and `confidence` an integer 1–10 are the
//            format's closed vocabularies (null when confidence is not one);
//            `urls` = the affected pages whose host ∈ targets.browser, in
//            source order, deduplicated. inert {reasoning?, evidence?,
//            suggested_fix?, fix_prompt?, specialist?, types?, untrusted_urls?}.
//            No string title ⇒ rejected `no-title`; a priority outside
//            p0–p3 ⇒ rejected `bad-priority` (never a silent p3).
//
// Structural failures — no frontmatter, no valid `date`, a JSON block that
// is not an array of objects, no findings section at all (neither block nor
// heading form) — are the adapter's own exit-2 result: CliError(2,
// SCHEMA-INVALID(audit: <reason>)). `targets.browser` comes from
// ctx.engagement(); scope is not consulted (§6.6: URLs are target-validated).
//
// Leaf over ./_qa-markdown.mjs, ./_shared.mjs, ../exit.mjs, ../tokens.mjs:
// no fs, no child process, no git, no network (G-6, G-14), no clock (G-1).

import { MarkdownFormatError, fencedBlock, fencedBlocks, sections, splitFrontmatter } from "./_qa-markdown.mjs";
import { hostAllowed, wrapInert } from "./_shared.mjs";
import { CliError, EXIT } from "../exit.mjs";
import { schemaInvalid } from "../tokens.mjs";

export const MAPPING_VERSION = "v1";
const KIND = "audit";

/** The methodology's priority scale. */
export const PRIORITIES = Object.freeze(["p0", "p1", "p2", "p3"]);
/** The specialist ids the methodology's selection table names. */
export const SPECIALISTS = Object.freeze(["security", "privacy", "accessibility", "content-seo", "performance", "ux", "responsive"]);
export const REJECT_NO_TITLE = "no-title";
export const REJECT_BAD_PRIORITY = "bad-priority";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FINDING_HEADING = /^#{3,5}[ \t]+\[(P[0-3]),[ \t]*confidence[ \t]+(\d{1,2})\][ \t]+(.+?)[ \t]*$/i;
const ANY_HEADING = /^#{1,6}[ \t]+/;
const FIELD_LINE = /^\*\*([A-Za-z ]+):\*\*[ \t]*(.*)$/;
const FIELDS = Object.freeze({ "affected pages": "affected_pages", reasoning: "reasoning", evidence: "evidence", "suggested fix": "suggested_fix", "fix prompt": "fix_prompt" });
const SPECIALIST_SECTION = /^###[ \t]+(?:\S+[ \t]+)?(.+?)[ \t]+—[ \t]+\d+[ \t]+findings?[ \t]*$/;
const FINDINGS_JSON_SECTION = /^Findings[ \t]*\(JSON\)$/i;

function invalid(reason) {
  return new CliError(EXIT.USAGE, schemaInvalid(KIND, reason));
}

function str(v) {
  return typeof v === "string" ? v : null;
}

/** The `affected_pages` value in either form: a list, or a comma/whitespace separated line. */
function pageList(v) {
  if (Array.isArray(v)) return v.filter((p) => typeof p === "string" && p !== "");
  if (typeof v !== "string") return [];
  return v.split(/[,\s]+/).filter((p) => p !== "");
}

function findingsFromJson(block) {
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch (err) {
    throw invalid(`the JSON block does not parse: ${err.message}`);
  }
  if (!Array.isArray(parsed)) throw invalid("the JSON block must be an array of findings");
  return parsed.map((f) => {
    if (f === null || typeof f !== "object" || Array.isArray(f)) throw invalid("the JSON block must be an array of finding objects");
    return {
      title: str(f.title),
      priority: str(f.priority)?.toLowerCase() ?? null, // the heading form lowercases `[P0, …]`; the two sources agree by construction
      confidence: Number.isInteger(f.confidence) ? f.confidence : null,
      affected_pages: pageList(f.affected_pages),
      reasoning: str(f.reasoning),
      evidence: str(f.evidence),
      suggested_fix: str(f.suggested_fix),
      fix_prompt: str(f.fix_prompt),
      specialist: str(f.specialist_specialty),
      types: Array.isArray(f.types) ? f.types.filter((t) => typeof t === "string").join(", ") : null,
    };
  });
}

/**
 * The findings JSON block: the fence under `## Findings (JSON)` when the report has that
 * section (whatever it holds — that section *is* the block); otherwise the last ```json
 * fence in the body, and only when it parses to an array (an evidence fence is prose).
 * @returns {string | null}
 */
function findingsBlock(body) {
  const section = sections(body, 2).find((s) => FINDINGS_JSON_SECTION.test(s.title));
  if (section) return fencedBlock(section.text, "json");
  const all = fencedBlocks(body, "json");
  if (all.length === 0) return null;
  const last = all[all.length - 1];
  let parsed;
  try {
    parsed = JSON.parse(last);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? last : null;
}

/** The heading form: `#### [P0, confidence 9] title` + `**Field:** value` lines until the next heading. */
function findingsFromHeadings(body) {
  const out = [];
  let current = null;
  let specialist = null;
  for (const line of body.split(/\r?\n/)) {
    const section = SPECIALIST_SECTION.exec(line);
    if (section) specialist = section[1];
    const h = FINDING_HEADING.exec(line);
    if (h) {
      current = { title: h[3], priority: h[1].toLowerCase(), confidence: Number(h[2]), affected_pages: [], reasoning: null, evidence: null, suggested_fix: null, fix_prompt: null, specialist, types: null };
      out.push(current);
      continue;
    }
    if (ANY_HEADING.test(line)) {
      current = null;
      continue;
    }
    if (current === null) continue;
    const f = FIELD_LINE.exec(line);
    if (!f) continue;
    const key = FIELDS[f[1].toLowerCase()];
    if (key === undefined) continue;
    const value = f[2].trim();
    if (key === "affected_pages") current.affected_pages = pageList(value);
    else if (key === "fix_prompt") current.fix_prompt = value.replace(/^`(.*)`$/, "$1");
    else current[key] = value;
  }
  return out;
}

/**
 * Parse a qa-auditor report.
 * @param {string} text
 * @returns {{target: string | null, date: string, pages_audited: string[], specialists_run: string[], findings: object[], source: "json" | "markdown"}}
 * @throws {CliError} 2 SCHEMA-INVALID(audit: …)
 * @throws {TypeError} when `text` is not a string
 */
export function parseAuditReport(text) {
  if (typeof text !== "string") throw new TypeError("ingest audit: the input must be the report text");
  let split;
  let block;
  try {
    split = splitFrontmatter(text);
    block = findingsBlock(split.body);
  } catch (err) {
    if (err instanceof MarkdownFormatError) throw invalid(err.message);
    throw err;
  }
  const { frontmatter: fm, body } = split;
  if (fm === null) throw invalid("no frontmatter block (the audit report template starts with one)");
  if (typeof fm.date !== "string" || !DATE.test(fm.date)) throw invalid("date is missing or is not YYYY-MM-DD");
  const source = block === null ? "markdown" : "json";
  const findings = block === null ? findingsFromHeadings(body) : findingsFromJson(block);
  if (block === null && findings.length === 0 && !/^#{3,5}[ \t]+\[/m.test(body) && !/^##[ \t]+Findings/m.test(body)) {
    throw invalid("no findings: neither a JSON block nor a `#### [P<n>, confidence <n>] title` heading");
  }
  return {
    target: str(fm.target),
    date: fm.date,
    pages_audited: pageList(fm.pages_audited),
    specialists_run: (Array.isArray(fm.specialists_run) ? fm.specialists_run : []).filter((s) => typeof s === "string"),
    findings,
    source,
  };
}

/**
 * @param {object} ctx provides engagement().targets.browser
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope unused
 * @param {string} redactedInput the redacted report text
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(audit: …)
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  const report = parseAuditReport(redactedInput);
  const browser = ctx.engagement().targets.browser;
  const { import_sha256, original_hmac } = locatorBase;
  const split = (urls) => {
    const ok = [];
    const bad = [];
    for (const u of urls) (hostAllowed(u, browser) ? ok : bad).push(u);
    return { ok: [...new Set(ok)], bad: [...new Set(bad)] };
  };

  const pages = split(report.pages_audited);
  const targetOk = report.target !== null && hostAllowed(report.target, browser);
  const head = {
    locator: { import_sha256, original_hmac, index: 0 },
    trusted: {
      record: "audit",
      target: targetOk ? report.target : null,
      date: report.date,
      pages_audited: pages.ok,
      specialists_run: report.specialists_run.filter((s) => SPECIALISTS.includes(s)),
      findings: report.findings.length,
      findings_source: report.source,
    },
    inert: {},
  };
  if (!targetOk && report.target !== null) head.inert.target = wrapInert(report.target);
  if (pages.bad.length > 0) head.inert.untrusted_pages = wrapInert(pages.bad.join("\n"));

  const records = [head];
  const rejected = [];
  report.findings.forEach((f, i) => {
    const index = i + 1;
    if (f.title === null || f.title === "") {
      rejected.push({ reason: REJECT_NO_TITLE, locator: { import_sha256, index } });
      return;
    }
    if (!PRIORITIES.includes(f.priority)) {
      rejected.push({ reason: REJECT_BAD_PRIORITY, locator: { import_sha256, index } });
      return;
    }
    const urls = split(f.affected_pages);
    const trusted = {
      record: "finding",
      title: f.title,
      priority: f.priority,
      confidence: f.confidence !== null && f.confidence >= 1 && f.confidence <= 10 ? f.confidence : null,
      urls: urls.ok,
    };
    const inert = {};
    for (const key of ["reasoning", "evidence", "suggested_fix", "fix_prompt", "specialist", "types"]) {
      if (f[key] !== null && f[key] !== "") inert[key] = wrapInert(f[key]);
    }
    if (urls.bad.length > 0) inert.untrusted_urls = wrapInert(urls.bad.join("\n"));
    records.push({ locator: { import_sha256, original_hmac, index }, trusted, inert });
  });

  return { records, unlocated: [], rejected, mapping_version: MAPPING_VERSION };
}

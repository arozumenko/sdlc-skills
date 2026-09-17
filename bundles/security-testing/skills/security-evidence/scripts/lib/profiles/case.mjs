// lib/profiles/case.mjs — the `case` publication profile (TASK-043; spec
// §9.2 "Admitted cases are written to a dedicated suite
// tasks/security-<slug>-admitted/ that contains only admitted TC-*.md files
// … Format verbatim per manual-qa; priority map p0→critical … p3→low;
// header/cookie checks via the audit branch", §6.9 "case (TC text only)",
// §2 "Only admitted cases are written to the hand-off suite", D7; plan §5
// TASK-043; US-035 AC-1, AC-2; US-038 AC-3).
//
//   apply(source, _register, opts) → [{relpath, bytes}]
//     one `TC-NNN_<slug>.md` per admission of the source whose
//     classification is `admitted-*` (a `proposal` record yields nothing —
//     the suite holds admitted cases only). The admission record carries no
//     path (schema closed, TASK-005): the case text is the candidate under
//     `<st>/cases/**` whose identity (admission-core.caseSha256 over the
//     REDACTED text) equals the record's `case_sha256` — `source.cases`,
//     loaded by _source.mjs. Outputs are sorted by file name; same source
//     ⇒ same bytes (check-export byte-compares).
//   Each output is the candidate's REDACTED text (G-4: what leaves memory is
//   what redact.mjs produced; a `password=…` assignment in the candidate is
//   `<REDACTED:…>` in the suite) with
//     - the frontmatter rewritten line by line: every key kept in order,
//       `priority:` mapped through PRIORITY_MAP (`p0`…`p3` → the manual-qa
//       vocabulary; `critical|high|medium|low` kept; anything else refused),
//       `tags:` extended with `security` when missing (added when absent);
//     - the body verbatim — unless the case asserts a response header or a
//       cookie attribute (isAuditStep), in which case the `## Steps` table is
//       re-emitted in the audit-step form (auditForm, spec §9.2 "header/cookie
//       checks via the audit branch"; references/audit-branch.md of the
//       security-test-planning skill is the mapping table): the page is
//       opened, its network requests are collected (the qa-auditor Step-0
//       recipe: browser_navigate, browser_network_requests), and each
//       header is inspected on the document response — never a reload, a
//       panel, a click or a form. Reload / "network panel" steps fold into
//       the collection row; every other admitted step is kept verbatim.
//   Line endings (review 1): CRLF candidates are rewritten on LF and
//   re-expanded, so the CRLF output equals the LF output with `\n`→`\r\n`;
//   a mixed-ending file becomes uniform CRLF. (admit accepts CRLF — the
//   frontmatter and Steps regexes here are `$`-anchored and `.` excludes CR.)
//   Refusals (CaseRefused — cmd-publish spells it 2 USAGE, check-export reads
//   it as MISMATCH(output)), PM ruling: an id that is not `TC-NNN` (three
//   digits) or a file name that is not `<id>_<slug>.md` is refused, never
//   renamed (manual-qa's readers match `TC-\d{3}`, test-run-lead normalises
//   ids against file names); an unknown priority; a header step before any
//   Navigate step (the audit form needs the URL); an admitted identity with
//   no candidate, or with two.
//   suiteDir(slug) → `tasks/security-<slug>-admitted`; suiteFile(id, slug).
//
// Pure (G-9): imports ../admission-core.mjs (parseSteps) and
// ../ingest/_qa-markdown.mjs (parseFrontmatter, the tags reading) only. No fs, no
// git, no clock.

import { parseSteps } from "../admission-core.mjs";
import { parseFrontmatter } from "../ingest/_qa-markdown.mjs";

export const PROFILE = "case";
export const PROFILE_VERSION = 1;
/** spec §9.2: the security priorities → the manual-qa vocabulary (test-case-format.md). */
export const PRIORITY_MAP = Object.freeze({ p0: "critical", p1: "high", p2: "medium", p3: "low" });
export const QA_PRIORITIES = Object.freeze(["critical", "high", "medium", "low"]);
/** The manual-qa security-audit header table (security-audit/references/owasp-checklist.md) plus `Set-Cookie`. */
export const AUDIT_HEADERS = Object.freeze(["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Strict-Transport-Security", "Referrer-Policy", "Permissions-Policy", "Set-Cookie"]);
/** The audit-step Actions the profile emits (references/audit-branch.md). */
export const AUDIT_STEPS = Object.freeze({
  collect: "Collect the network requests of the page (`browser_network_requests()`)",
  collected: (path) => `The document response for \`${path}\` is listed with its response headers`,
  header: (name, path) => `Inspect the \`${name}\` response header of the \`${path}\` document`,
  headers: (names, path) => `Inspect the ${names.map((n) => `\`${n}\``).join(" and ")} response headers of the \`${path}\` document`,
  cookies: (path) => `Inspect the \`Set-Cookie\` response headers of the \`${path}\` document`,
});

const SLUG = /^[a-z0-9-]+$/;
const CANONICAL_ID = /^TC-[0-9]{3}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COOKIE_FLAG = /\b(?:secure|httponly|samesite)\b/i;
const COOKIE_WORD = /\bcookies?\b/i;
const NAVIGATE = /^(?:navigate|go|browse|return)\s+(?:back\s+)?to\b|^(?:open|visit|load)\b/i;
const RELOAD_OR_PANEL = /^(?:reload|refresh)\b|\bnetwork\s+panel\b|\bdeveloper\s+tools\b|\bdevtools\b/i;
const URL_IN_ACTION = /`?((?:\{\{\s*base_url\s*\}\}|https?:\/\/[^\s`'"<>)\]]+?)(\/[^\s`'"<>)\]]*)?)`?/i;
const MARKUP = /[*_`~]|^[\s>]+/g;
const STEPS_HEADING = /^##[ \t]+Steps[ \t]*$/;
const TABLE_LINE = /^\s*\|/;
const HEADING = /^#{1,6}\s/;

/** A case the profile refuses (see the header); `case_sha256` names the admission. */
export class CaseRefused extends Error {
  constructor(case_sha256, reason) {
    super(`admitted case ${case_sha256.slice(0, 12)}: ${reason}`);
    this.name = "CaseRefused";
    this.case_sha256 = case_sha256;
    this.reason = reason;
  }
}

/** `tasks/security-<slug>-admitted` (spec §9.2, §3.2). */
export function suiteDir(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new TypeError(`case: slug must match ${SLUG}, got ${String(slug)}`);
  return `tasks/security-${slug}-admitted`;
}

/** `<id>_<slug>.md` — the manual-qa file name. */
export function suiteFile(id, slug) {
  if (!CANONICAL_ID.test(id) || typeof slug !== "string" || !SLUG.test(slug)) throw new TypeError("case: suiteFile needs a TC-NNN id and a lowercase-hyphen slug");
  return `${id}_${slug}.md`;
}

/**
 * The headers a step asserts, in AUDIT_HEADERS order (`Set-Cookie` when the
 * step names a cookie together with a flag, or `Set-Cookie` itself); [] when
 * the step is not a header/cookie check.
 * @param {{action: string, expected?: string}} step
 * @returns {string[]}
 */
export function isAuditStep(step) {
  const text = `${step.action} ${step.expected ?? ""}`;
  const named = AUDIT_HEADERS.filter((h) => h !== "Set-Cookie" && text.toLowerCase().includes(h.toLowerCase()));
  const cookie = /set-cookie/i.test(text) || (COOKIE_WORD.test(text) && COOKIE_FLAG.test(text));
  return cookie ? [...named, "Set-Cookie"] : named;
}

/** The URL a navigate Action opens and its path (`{{base_url}}/login` → `/login`); null when the Action carries none. */
function pageOf(action) {
  const plain = action.replace(MARKUP, "").trim();
  if (!NAVIGATE.test(plain)) return null;
  const m = URL_IN_ACTION.exec(action);
  if (!m) return null;
  const path = m[2] === undefined || m[2] === "" ? "/" : m[2];
  return { url: m[1], path };
}

/**
 * The audit-step form of a Steps table (see the header). Rows are
 * `{action, expected}`; the caller renumbers.
 * @param {{step: number, action: string, expected: string}[]} steps admission-core.parseSteps' rows
 * @returns {{action: string, expected: string}[]}
 * @throws {RangeError} a header/cookie step before any Navigate step
 */
export function auditForm(steps) {
  const rows = [];
  let page = null;
  for (const s of steps) {
    const nav = pageOf(s.action);
    if (nav !== null) {
      page = nav;
      rows.push({ action: s.action, expected: s.expected });
      rows.push({ action: AUDIT_STEPS.collect, expected: AUDIT_STEPS.collected(page.path) });
      continue;
    }
    const headers = isAuditStep(s);
    if (headers.length > 0) {
      if (page === null) throw new RangeError(`step ${s.step} asserts a response header before any Navigate step (the audit form needs the URL)`);
      const action = headers.length > 1 ? AUDIT_STEPS.headers(headers, page.path) : headers[0] === "Set-Cookie" ? AUDIT_STEPS.cookies(page.path) : AUDIT_STEPS.header(headers[0], page.path);
      rows.push({ action, expected: s.expected });
      continue;
    }
    if (RELOAD_OR_PANEL.test(s.action.replace(MARKUP, "").trim())) continue; // folded into the collection row
    rows.push({ action: s.action, expected: s.expected });
  }
  return rows;
}

/** Render a Steps table in the manual-qa shape. */
function renderSteps(rows) {
  const cell = (v) => v.replace(/\|/g, "\\|");
  return ["| # | Action | Expected Result |", "|---|---|---|", ...rows.map((r, i) => `| ${i + 1} | ${cell(r.action)} | ${cell(r.expected)} |`)].join("\n");
}

/** Replace the `## Steps` table lines of `body` with `table`; the rest of the body is untouched. */
function spliceSteps(body, table) {
  const lines = body.split("\n");
  const heading = lines.findIndex((l) => STEPS_HEADING.test(l));
  let start = heading + 1;
  while (start < lines.length && !TABLE_LINE.test(lines[start]) && !HEADING.test(lines[start])) start += 1;
  let end = start;
  while (end < lines.length && TABLE_LINE.test(lines[end])) end += 1;
  return [...lines.slice(0, start), table, ...lines.slice(end)].join("\n");
}

/** The frontmatter lines rewritten in place (priority mapped, `security` tag ensured); every other line verbatim. */
function rewriteFrontmatter(lines, close, refuse) {
  let sawTags = false;
  for (let i = 1; i < close; i += 1) {
    const m = /^(priority|tags)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[1] === "priority") {
      const raw = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      const mapped = PRIORITY_MAP[raw.toLowerCase()] ?? (QA_PRIORITIES.includes(raw.toLowerCase()) ? raw.toLowerCase() : null);
      if (mapped === null) refuse(`priority ${raw} is neither p0…p3 nor ${QA_PRIORITIES.join("|")}`);
      lines[i] = `priority: ${mapped}`;
    } else {
      sawTags = true;
      // read as manual-qa reads it (quoted items may carry commas — review 1); `security` is appended to the
      // original text, never re-serialised, so a line that already carries it is verbatim
      const { tags } = parseFrontmatter(lines[i]);
      const list = tags === null ? [] : Array.isArray(tags) ? tags : [tags];
      if (list.includes("security")) continue;
      const raw = m[2].trim();
      const close = raw.startsWith("[") ? raw.lastIndexOf("]") : -1;
      if (close < 0) lines[i] = list.length === 0 ? "tags: [security]" : `tags: [${raw.replace(/[ \t]#.*$/, "").trim()}, security]`; // a bare scalar, its ` # comment` dropped as the parser drops it
      else lines[i] = `tags: [${list.length === 0 ? "" : `${raw.slice(1, close).trim()}, `}security]${raw.slice(close + 1)}`;
    }
  }
  if (!sawTags) lines.splice(close, 0, "tags: [security]");
  return lines;
}

/** One suite file for an admitted candidate. */
function publishOne(cand) {
  const refuse = (reason) => {
    throw new CaseRefused(cand.case_sha256, reason);
  };
  let parsed;
  try {
    parsed = parseSteps(cand.redacted); // the manual-qa structure (2 SCHEMA-INVALID(case: …) at admit time, so a refusal here is a changed file)
  } catch (err) {
    refuse(`not a manual-qa test case (${err.token ?? err.message})`);
  }
  const id = parsed.case.id;
  if (!CANONICAL_ID.test(id)) refuse(`id ${id} is not TC-NNN (three digits); rename the candidate and admit it again`);
  const nameMatch = new RegExp(`^${id}_([a-z0-9-]+)\\.md$`).exec(cand.name);
  if (!nameMatch) refuse(`file name ${cand.name} is not ${id}_<slug>.md; rename the candidate and admit it again`);
  // CRLF candidates (admit accepts them: splitFrontmatter / parseSteps split on /\r?\n/) are
  // rewritten on LF and re-expanded at the end — the frontmatter regexes and STEPS_HEADING are
  // `$`-anchored and JS `.` excludes CR. A mixed-ending file becomes uniform CRLF.
  const crlf = cand.redacted.includes("\r\n");
  const text = crlf ? cand.redacted.replace(/\r\n/g, "\n") : cand.redacted;
  const lines = text.split("\n");
  const close = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  if (!/^---\s*$/.test(lines[0]) || close < 0) refuse("no frontmatter block");
  rewriteFrontmatter(lines, close, refuse);
  const head = lines.slice(0, close + 1).join("\n");
  let body = lines.slice(close + 1).join("\n");
  if (parsed.steps.some((s) => isAuditStep(s).length > 0)) {
    let rows;
    try {
      rows = auditForm(parsed.steps);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      refuse(err.message);
    }
    body = spliceSteps(body, renderSteps(rows));
  }
  const out = `${head}\n${body}`;
  return { relpath: suiteFile(id, nameMatch[1]), bytes: Buffer.from(crlf ? out.replace(/\n/g, "\r\n") : out, "utf8"), case_sha256: cand.case_sha256 };
}

/**
 * The admitted suite (see the header).
 * @param {import("./_source.mjs").Source} source with `admissions` and `cases`
 * @param {object | null} _register unused
 * @param {{slug?: string}} opts `slug` overrides the engagement's (the suite directory name)
 * @returns {{relpath: string, bytes: Buffer}[]}
 * @throws {CaseRefused}
 */
export function apply(source, _register, opts = {}) {
  const slug = opts?.slug ?? source.engagement?.payload?.slug;
  suiteDir(slug); // shape check; the directory itself is cmd-publish's `--to`
  const cases = Array.isArray(source.cases) ? source.cases : [];
  const admitted = (source.admissions ?? []).map((a) => a.payload).filter((p) => typeof p.classification === "string" && p.classification.startsWith("admitted-"));
  const outputs = [];
  const seen = new Set();
  for (const record of admitted) {
    const sha = record.case_sha256;
    if (!SHA256.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    const found = cases.filter((c) => c.case_sha256 === sha);
    if (found.length === 0) throw new CaseRefused(sha, "no candidate under .agents/security-testing/cases/ has this identity (the file changed or moved since admit)");
    if (found.length > 1) throw new CaseRefused(sha, `two candidates carry this identity (${found.map((c) => c.relpath).join(", ")}); keep one`);
    outputs.push(publishOne(found[0]));
  }
  outputs.sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
  for (let i = 1; i < outputs.length; i += 1) if (outputs[i].relpath === outputs[i - 1].relpath) throw new CaseRefused(outputs[i].case_sha256, `two admitted cases would both be ${outputs[i].relpath}`);
  return outputs.map(({ relpath, bytes }) => ({ relpath, bytes }));
}

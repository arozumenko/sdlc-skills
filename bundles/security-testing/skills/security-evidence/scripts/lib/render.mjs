// lib/render.mjs — the pure report renderer (TASK-023; plan §3.3 row
// `lib/render.mjs`, §5 TASK-023/024; spec §6.3 derivation table, §11 report
// structure, TL-7 markers; US-016; G-9 pure core). `cmd-build-report.mjs`
// wires it to a run directory; `check` (TASK-025) calls the same three
// functions over the same inputs and byte-compares the result.
//
//   parseTemplate(text)      → {template, template_version, required_inputs, body}
//   buildView(inputs, opts)  → view          (the derivation; throws InconsistentInput)
//   renderMarkdown(view, t)  → string        (deterministic; redacted; LF-terminated)
//   sanitize(s, {cell})      → string        (every input string passes it)
//   marker(path)             → `<!-- v:<path> -->`
//
// Templates (templates/README.md): frontmatter `template` + `template_version`,
// one fenced `required-inputs` block (the closed list, spec §6.3 — the note
// after a name is prose), then a Markdown body with `{{<view-path>}}` scalar
// slots and `{{block:<name>}}` section slots. A slot naming nothing in the
// view is an Error (a packaging bug, not a run problem).
//
// buildView is the in-memory re-run of every derivation the report displays
// (spec §6.3 table), over the artifacts `inputs.mjs` closed over:
//
//   gate     every finding id is re-derived with gate-core.findingId from
//            the stored finding (`snippet` | `snippet_redacted` |
//            `context_redacted`, `occurrence`, `sensitive`) — the claims
//            file lives in the agent drop-box outside the run directory
//            (TL-4, G-16), so "gate re-run on claimed + scope" means exactly
//            this: ids from the recorded findings, states as recorded (the
//            bytes-at-side comparison is `check --integrity`'s), and the
//            gate-result payload rebuilt from claimed + rejects + scope
//            (accepted/unverifiable by state in claimed order, rejected
//            counts folded over rejects, both hashes) and compared by
//            identity. A CITATION_FAILED finding carries occurrence 0
//            (gate-core contract). Any difference ⇒ InconsistentInput
//            ("gate-result") ⇒ 5 INCONSISTENT(gate-result). A keyed id
//            cannot be re-derived without the key: those findings are
//            listed in Limitations under `KEY: unavailable` (spec §6.5)
//            and the plain ones are still checked.
//   coverage coverage-core.computeCoverage(scope, examined, recorded
//            scanner_rows) compared by identity with coverage.json
//            ⇒ InconsistentInput("coverage").
//   states   states.applyReceipts(gate-result, receipts, packets); a
//            CITATION_VERIFIED finding with no applied vulnerability-review
//            receipt is `not independently reviewed` (spec §6.3).
//   verify   evaluate.evaluate(payload minus evaluation) compared by identity
//            with the recorded evaluation ⇒ InconsistentInput("verify"); the
//            VERDICT line is tokens.verdictLine over the payload and the
//            artifact's own identity.
//
// The view is plain data (JSON-able, no functions, no Buffers): every value
// the report shows, addressed by the `<view-path>` the TL-7 marker names.
// Nothing in it comes from a clock or the environment; `tool_version` and
// `template_version` are passed in by the command (version.json and the
// template's frontmatter).
//
// Rendering rules: every table body row and every `- label: value` line
// whose value is derived ends with `<!-- v:<view-path> -->`; a section with
// nothing to list says so on a marked line rather than emitting an empty
// table; every field the inputs do not carry reads `unknown / not assessed`
// (spec §11: blank forbidden). Every string that came from an input goes
// through sanitize(): HTML comments and tags removed (a redaction marker
// `<REDACTED:…>` is kept — it is not HTML), links rendered as `text (url)`,
// control / bidi / zero-width characters stripped, CR dropped, runs of three
// backticks or tildes escaped so a value can never open or close a fence,
// structural line starts (`#`, `>`, `-`, `+`, `*`, `=`, `|`, `1.`) escaped so
// a value can never add a heading, list, quote, rule or table, and, inside a
// cell, pipes escaped and newlines collapsed. Evidence snippets are emitted
// as indented code (four spaces): nothing inside an indented block is
// Markdown. The assembled document passes redact.mjs once more before it is
// returned (G-4), which is why the caller hashes exactly what this returns.
//
// Pure (G-9): imports ../canon.mjs (artifactId), ../redact.mjs (redactString),
// ./coverage-core.mjs, ./evaluate.mjs, ./gate-core.mjs (findingId),
// ./states.mjs and ./tokens.mjs. No clock, no fs, no git, no network; no
// child processes.

import { artifactId } from "../canon.mjs";
import { redactString } from "../redact.mjs";
import { countByStatus, computeCoverage } from "./coverage-core.mjs";
import { evaluate } from "./evaluate.mjs";
import { findingId } from "./gate-core.mjs";
import { applyReceipts } from "./states.mjs";
import {
  CITATION_FAILED,
  CITATION_VERIFIED,
  COVERAGE_INDETERMINATE,
  KEY_AVAILABLE,
  KEY_UNAVAILABLE,
  NOT_ASSESSED,
  NOT_INDEPENDENTLY_REVIEWED,
  ORIGIN_UNAUTHENTICATED,
  REGISTER_PRIORITIES,
  REPORT_TEMPLATES,
  REVIEW_CONFIRMED,
  REVIEW_INDETERMINATE,
  REVIEW_REFUTED,
  verdictLine,
} from "./tokens.mjs";

/** The states a review finding can display, in table-column order. */
export const FINDING_STATES = Object.freeze([CITATION_VERIFIED, CITATION_FAILED, REVIEW_CONFIRMED, REVIEW_REFUTED, REVIEW_INDETERMINATE]);

/** A recorded derived artifact that no longer follows from its inputs; `field` is the INCONSISTENT(<field>) token's argument. */
export class InconsistentInput extends Error {
  constructor(field, detail) {
    super(`inconsistent ${field}${detail ? `: ${detail}` : ""}`);
    this.name = "InconsistentInput";
    this.field = field;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- templates ----------------------------------------------------------------------

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const REQUIRED_BLOCK = /^```required-inputs\n([\s\S]*?)^```\n/m;
const INPUT_NAME = /^[a-z][a-z-]*$/;

/**
 * Parse a template file.
 * @param {string} text
 * @returns {{template: string, template_version: number, required_inputs: string[], body: string}}
 * @throws {Error} on a malformed template (a packaging bug)
 */
export function parseTemplate(text) {
  if (typeof text !== "string") throw new TypeError("parseTemplate: text must be a string");
  const fm = FRONTMATTER.exec(text);
  if (fm === null) throw new Error("template: frontmatter (--- … ---) is required");
  const fields = {};
  for (const line of fm[1].split("\n")) {
    if (line.trim() === "") continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m === null) throw new Error(`template: frontmatter line ${JSON.stringify(line)} is not key: value`);
    fields[m[1]] = m[2].trim();
  }
  if (typeof fields.template !== "string" || fields.template === "") throw new Error("template: frontmatter needs `template: <name>`");
  if (!/^\d+$/.test(fields.template_version ?? "")) throw new Error("template: frontmatter needs an integer template_version");
  const rest = text.slice(fm[0].length);
  const block = REQUIRED_BLOCK.exec(rest);
  if (block === null) throw new Error("template: a fenced required-inputs block is required");
  const required_inputs = block[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => l.split(/\s+/)[0]);
  if (required_inputs.length === 0) throw new Error("template: the required-inputs block is empty");
  for (const name of required_inputs) if (!INPUT_NAME.test(name)) throw new Error(`template: required input ${JSON.stringify(name)} is not a name`);
  if (new Set(required_inputs).size !== required_inputs.length) throw new Error("template: a required input is listed twice");
  const body = (rest.slice(0, block.index) + rest.slice(block.index + block[0].length)).replace(/^\n+/, "");
  return { template: fields.template, template_version: Number(fields.template_version), required_inputs, body };
}

// --- sanitiser ----------------------------------------------------------------------

const REDACTION_MARKER = /<REDACTED:[a-z0-9-]+>/g;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_TAG = /<\/?[A-Za-z!?][^>]*>/g;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const LINK = /\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const REF_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;
// C0 (minus TAB and LF), DEL, C1, ALM, zero-width and bidi controls, word joiner
// and friends, BOM; then the private-use plane this function uses as scratch.
const STRIPPED = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const PRIVATE_USE = /[\uE000-\uF8FF]/g;
const STRUCTURAL_START = /^(\s{0,3})([#>+*=|-]|\d+[.)])/;

/**
 * Make an input string safe to place in the report (see the header).
 *
 * Three placements, three modes:
 *   prose (default)  the value starts its own lines \u2014 everything applies,
 *                    including the structural line-start escape;
 *   cell             the value sits mid-line (a table cell, a `- label: value`
 *                    line): one line, pipes escaped, fences escaped, no
 *                    line-start escape (a cell beginning `1.0.0` is a
 *                    version, not a list);
 *   code             the value goes into an indented code block, where
 *                    nothing is Markdown: only control / bidi characters and
 *                    CR are removed, so a cited `<script>` stays evidence.
 * @param {unknown} value stringified when not a string
 * @param {{cell?: boolean, code?: boolean}} [options]
 * @returns {string}
 */
export function sanitize(value, { cell = false, code = false } = {}) {
  let s = typeof value === "string" ? value : String(value);
  s = s.replace(PRIVATE_USE, "");
  if (code) return s.replace(STRIPPED, "").replace(/\r\n?/g, "\n");
  const keep = [];
  s = s.replace(REDACTION_MARKER, (m) => {
    keep.push(m);
    return `\uE000${keep.length - 1}\uE001`;
  });
  s = s.replace(HTML_COMMENT, "").replace(HTML_TAG, "");
  s = s.replace(IMAGE, "$1 ($2)").replace(LINK, "$1 ($2)").replace(REF_LINK, "$1");
  s = s.replace(STRIPPED, "").replace(/\r\n?/g, "\n");
  s = s
    .split("\n")
    .map((line) => {
      const l = line.replace(/`{3,}/g, (run) => run.replace(/`/g, "\\`"));
      if (cell) return l;
      return l.replace(/^(\s{0,3})(~{3,})/, "$1\\$2").replace(STRUCTURAL_START, "$1\\$2");
    })
    .join("\n");
  if (cell) s = s.replace(/\n+/g, " ").replace(/\\+\|/g, "|").replace(/\|/g, "\\|");
  return s.replace(/\uE000(\d+)\uE001/g, (_, i) => keep[Number(i)]);
}

const VIEW_PATH = /^[A-Za-z0-9_.[\]-]+$/;

/**
 * The TL-7 marker for a derived line.
 * @param {string} path a view path (`summary.total`, `findings[2].state`)
 * @returns {string}
 */
export function marker(path) {
  if (typeof path !== "string" || !VIEW_PATH.test(path)) throw new TypeError(`marker: path must be a view path, got ${String(path)}`);
  return `<!-- v:${path} -->`;
}

/** `a.b[2].c` over the view; `undefined` when absent. */
function getPath(view, path) {
  const parts = path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== "");
  let cur = view;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    const key = /^\d+$/.test(p) && Array.isArray(cur) ? Number(p) : p;
    if (!Object.hasOwn(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

// --- view: shared -------------------------------------------------------------------

function requireInputs(inputs) {
  if (!isObject(inputs) || !isObject(inputs.artifacts) || !isObject(inputs.hashes)) throw new TypeError("buildView: inputs must be {template, artifacts, hashes} from inputs.closeOver");
  if (!REPORT_TEMPLATES.includes(inputs.template)) throw new TypeError(`buildView: unknown template ${String(inputs.template)}`);
  return inputs;
}

function requireArtifact(artifacts, name) {
  const a = artifacts[name];
  if (!isObject(a) || !isObject(a.envelope) || !isObject(a.payload)) throw new TypeError(`buildView: artifacts.${name} must be an artifact {envelope, payload}`);
  return a;
}

function requireList(artifacts, name) {
  const list = artifacts[name];
  if (!Array.isArray(list)) throw new TypeError(`buildView: artifacts.${name} must be an array of artifacts`);
  list.forEach((a, i) => {
    if (!isObject(a) || !isObject(a.envelope) || !isObject(a.payload)) throw new TypeError(`buildView: artifacts.${name}[${i}] must be an artifact`);
  });
  return [...list].sort((a, b) => compare(a.envelope.self_sha256, b.envelope.self_sha256));
}

function requireOpts(opts) {
  if (!isObject(opts)) throw new TypeError("buildView: opts must be {key, rules, tool_version, template_version}");
  const { key = null, rules, tool_version, template_version } = opts;
  if (key !== null && !(key instanceof Uint8Array && key.length > 0)) throw new TypeError("buildView: key must be the engagement key bytes or null");
  if (!isObject(rules) || !Array.isArray(rules.rules) || !Number.isSafeInteger(rules.redaction_version)) throw new TypeError("buildView: rules must be a loaded redact.mjs rule set");
  if (typeof tool_version !== "string" || tool_version === "") throw new TypeError("buildView: tool_version must be a non-empty string");
  if (!Number.isSafeInteger(template_version) || template_version < 0) throw new TypeError("buildView: template_version must be a non-negative integer");
  return { key, rules, tool_version, template_version };
}

function runView(run, run_id) {
  const p = run.payload;
  return { run_id, engagement_id: p.engagement_id, seq: p.seq, kind: p.template, base_oid: p.base_oid, head_oid: p.head_oid };
}

function packetsView(packets) {
  return packets.map((p) => ({ sha256: p.envelope.self_sha256, kind: p.payload.kind, subject_ids: [...p.payload.subject_ids], files: p.payload.files.length }));
}

function custodyView(inputs, opts) {
  return {
    tool_version: opts.tool_version,
    template: `${inputs.template} v${opts.template_version}`,
    template_name: inputs.template,
    template_version: opts.template_version,
    origin: ORIGIN_UNAUTHENTICATED,
    redaction_version: opts.rules.redaction_version,
  };
}

// --- view: review -------------------------------------------------------------------

function foldReasons(rejected) {
  const counts = {};
  for (const r of rejected) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  return Object.fromEntries(Object.keys(counts).sort(compare).map((k) => [k, counts[k]]));
}

/** The gate re-run (header). Returns the ids that could not be re-derived without the key. */
function regate({ scope, claimed, gateResult, rejects }, { key, rules }) {
  const findings = claimed.payload.findings;
  const keyed = [];
  for (const f of findings) {
    const snippet = f.snippet ?? f.snippet_redacted ?? f.context_redacted;
    const sensitive = f.sensitive === true;
    if (typeof snippet !== "string") throw new InconsistentInput("gate-result", `finding ${f.id} carries no snippet`);
    if (f.state === CITATION_FAILED && f.occurrence !== 0) throw new InconsistentInput("gate-result", `finding ${f.id}: CITATION_FAILED with occurrence ${f.occurrence}`);
    if (sensitive && key === null) {
      keyed.push(f.id);
      continue;
    }
    const id = findingId({ path: f.path, class: f.class, snippet, occurrence: f.occurrence, sensitive, key: sensitive ? key : undefined, rules });
    if (id !== f.id) throw new InconsistentInput("gate-result", `finding ${f.id} does not re-derive`);
  }
  if (claimed.payload.scope_sha256 !== scope.envelope.self_sha256) throw new InconsistentInput("gate-result", "claimed names another scope");
  const expected = {
    accepted: findings.filter((f) => f.state === CITATION_VERIFIED).map((f) => f.id),
    unverifiable: findings.filter((f) => f.state === CITATION_FAILED).map((f) => f.id),
    rejected_counts: foldReasons(rejects.payload.rejected),
    scope_sha256: scope.envelope.self_sha256,
    claimed_sha256: artifactId(claimed.payload),
  };
  if (artifactId(expected) !== artifactId(gateResult.payload)) throw new InconsistentInput("gate-result", "gate-result does not follow from claimed + scope + rejects");
  return keyed;
}

function recoverage({ scope, examined, coverage }) {
  const recomputed = computeCoverage(scope, examined, coverage.payload.scanner_rows);
  if (artifactId(recomputed) !== artifactId(coverage.payload)) throw new InconsistentInput("coverage", "coverage does not follow from scope + examined");
  return recomputed;
}

function evidenceOf(f) {
  if (typeof f.snippet === "string") return { kind: "snippet", text: f.snippet, sensitive: false };
  if (typeof f.snippet_redacted === "string") return { kind: "snippet_redacted", text: f.snippet_redacted, sensitive: true };
  return { kind: "context_redacted", text: f.context_redacted, sensitive: true };
}

function findingView(f, applied, receipts, notApplied) {
  const state = applied.states[f.id] ?? f.state;
  const reviewed = state !== CITATION_VERIFIED && state !== CITATION_FAILED;
  const mine = receipts.filter((r) => r.payload.type === "vulnerability-review" && r.payload.subject_id === f.id && !notApplied.has(r.envelope.self_sha256)).map((r) => ({ sha256: r.envelope.self_sha256, assertion: r.payload.assertion }));
  const review = reviewed ? mine.map((r) => `${r.assertion} by receipt ${r.sha256}`).join("; ") : state === CITATION_VERIFIED ? NOT_INDEPENDENTLY_REVIEWED : "citation failed — a receipt cannot apply";
  const typed = Array.isArray(f.citations_typed) ? f.citations_typed.map((c) => ({ role: c.role, path: c.path, side: c.side, lines: [...c.lines], context: c.context })) : [];
  return {
    id: f.id,
    title: f.title,
    class: f.class,
    cwe: typeof f.cwe === "string" ? f.cwe : NOT_ASSESSED,
    priority: f.priority,
    confidence: f.confidence,
    citation_state: f.state,
    state,
    reviewed,
    review,
    review_receipts: mine,
    path: f.path,
    side: f.side,
    lines: [...f.lines],
    asset: `${f.path}:${f.lines[0]}-${f.lines[1]} @ ${f.side}`,
    occurrence: f.occurrence,
    source: { kind: f.source.kind, ref: f.source.ref, index: f.source.index },
    sensitive: f.sensitive === true,
    requires_typed_citations: f.requires_typed_citations === true,
    citations_typed: typed,
    evidence: evidenceOf(f),
    description: typeof f.description === "string" ? f.description : NOT_ASSESSED,
    impact: typeof f.impact === "string" ? f.impact : NOT_ASSESSED,
    prerequisites: typeof f.prerequisites === "string" ? f.prerequisites : NOT_ASSESSED,
    remediation: typeof f.remediation === "string" ? f.remediation : NOT_ASSESSED,
    reproduction: "not attempted (passive review)",
    ticket_url: NOT_ASSESSED,
    verification_history: NOT_ASSESSED,
  };
}

function reviewView(inputs, opts, run_id) {
  const A = inputs.artifacts;
  const run = requireArtifact(A, "run");
  const scope = requireArtifact(A, "scope");
  const claimed = requireArtifact(A, "claimed");
  const gateResult = requireArtifact(A, "gate-result");
  const coverage = requireArtifact(A, "coverage");
  const examined = requireArtifact(A, "examined");
  const rejects = requireArtifact(A, "rejects");
  const unlocated = requireArtifact(A, "unlocated");
  const packets = requireList(A, "packets");
  const receipts = requireList(A, "receipts");

  const keyed = regate({ scope, claimed, gateResult, rejects }, opts);
  const cov = recoverage({ scope, examined, coverage });
  const applied = applyReceipts(gateResult, receipts, packets);
  const notApplied = new Set(applied.not_applied.map((n) => n.receipt_sha256));

  const findings = claimed.payload.findings.map((f) => findingView(f, applied, receipts, notApplied));
  const by_priority_state = {};
  const unresolved_by_priority = {};
  for (const p of REGISTER_PRIORITIES) {
    by_priority_state[p] = Object.fromEntries(FINDING_STATES.map((s) => [s, findings.filter((f) => f.priority === p && f.state === s).length]));
    unresolved_by_priority[p] = findings.filter((f) => f.priority === p && f.state === CITATION_FAILED).length;
  }
  const rejected_by_reason = foldReasons(rejects.payload.rejected);
  const limitations = [];
  limitations.push(opts.key === null ? `${KEY_UNAVAILABLE} — keyed identities not re-derived for: ${keyed.length === 0 ? "(none)" : keyed.join(", ")}` : `${KEY_AVAILABLE} — every keyed identity re-derived`);
  limitations.push(`receipts not applied: ${applied.not_applied.length}${applied.not_applied.length === 0 ? "" : ` (${applied.not_applied.map((n) => `${n.receipt_sha256}: ${n.reason}`).join("; ")})`}`);
  limitations.push(`conflicting receipts: ${applied.conflicts.length}${applied.conflicts.length === 0 ? "" : ` (${applied.conflicts.map((c) => `${c.subject_id}: ${c.assertions.join("/")}`).join("; ")})`}`);
  const untyped = findings.filter((f) => f.requires_typed_citations && f.citations_typed.length === 0).map((f) => f.id);
  limitations.push(`data-flow findings without typed citations: ${untyped.length === 0 ? "(none)" : untyped.join(", ")}`);
  limitations.push(`redaction rules version: ${opts.rules.redaction_version}`);
  limitations.push("local ≠ confidential: every artifact under .agents/security-testing/ is local by default and disclosed only through `publish --profile`");

  return {
    template: "review",
    run: runView(run, run_id),
    key: opts.key === null ? "unavailable" : "available",
    scope: {
      files: scope.payload.files.map((f) => ({ path: f.path, side: f.side, oid: f.oid, lines: f.lines, ranges: (scope.payload.ranges[f.path] ?? []).map((r) => [...r]) })),
      skipped: scope.payload.skipped.map((s) => ({ path: s.path, reason: s.reason })),
      snapshot_files: isObject(scope.payload.snapshot) ? Object.keys(scope.payload.snapshot).length : 0,
    },
    coverage: {
      indeterminate: cov.indeterminate,
      counts: countByStatus(cov.accounting),
      accounting: cov.accounting.map((e) => ({ path: e.path, range: [...e.range], status: e.status, by: [...e.by] })),
      scanner_rows: cov.scanner_rows.map((r) => ({ tool: r.tool, version: r.version, import_sha256: r.import_sha256, paths: [...r.paths] })),
    },
    summary: {
      total: findings.length,
      accepted: gateResult.payload.accepted.length,
      unverifiable: gateResult.payload.unverifiable.length,
      by_priority_state,
      unresolved_by_priority,
      rejected_by_reason,
      rejected_total: rejects.payload.rejected.length,
      unlocated: unlocated.payload.candidates.length,
      unauthenticated_approvals: NOT_ASSESSED,
      incomplete_runs: "see sign-off (the ledger is outside the run directory, TL-3)",
    },
    findings,
    unresolved: {
      citation_failed: findings.filter((f) => f.state === CITATION_FAILED).map((f) => ({ id: f.id, title: f.title, priority: f.priority, asset: f.asset })),
      unlocated: unlocated.payload.candidates.map((c) => ({ reason: c.reason, tool: typeof c.tool === "string" ? c.tool : NOT_ASSESSED, rule_id: typeof c.rule_id === "string" ? c.rule_id : NOT_ASSESSED, import_sha256: c.locator.import_sha256, index: c.locator.index })),
    },
    receipts: {
      total: receipts.length,
      not_applied: applied.not_applied.map((n) => ({ ...n })),
      conflicts: applied.conflicts.map((c) => ({ type: c.type, subject_id: c.subject_id, reviewer_run_id: c.reviewer_run_id, assertions: [...c.assertions], receipts: [...c.receipts] })),
    },
    packets: packetsView(packets),
    threat_model: `${NOT_ASSESSED} — the review template carries no threat model (spec §6.3)`,
    register: `${NOT_ASSESSED} — the review template carries no register snapshot (spec §6.3)`,
    limitations,
    hashes: { ...inputs.hashes },
    custody: custodyView(inputs, opts),
  };
}

// --- view: verify -------------------------------------------------------------------

function verifyView(inputs, opts, run_id) {
  const A = inputs.artifacts;
  const run = requireArtifact(A, "run");
  const verify = requireArtifact(A, "verify");
  const packets = requireList(A, "packets");
  const receipts = requireList(A, "receipts");
  const p = verify.payload;
  const { evaluation, ...raw } = p;
  const recomputed = evaluate(raw);
  if (artifactId(recomputed) !== artifactId(evaluation)) throw new InconsistentInput("verify", "evaluation does not follow from the raw results");
  const applied = applyReceipts(null, receipts, packets);
  const verdict_line = verdictLine({ verdict: evaluation.verdict, finding: p.finding_id, base: p.base_oid, head: p.head_oid, tested_tree: p.tested_tree, verify: verify.envelope.self_sha256 });
  const acked = new Set(p.receipts.filter((r) => r.type === "ack" && r.applied === true).map((r) => r.indicator_id));
  const limitations = [
    opts.key === null ? `${KEY_UNAVAILABLE} — no keyed value is re-derived by this template; content re-validation is check's` : `${KEY_AVAILABLE}`,
    `receipts not applied (per verify.json): ${p.receipts.filter((r) => r.applied !== true).length}`,
    `receipts not applied (re-derived over the run's receipts and packets): ${applied.not_applied.length}`,
    `conflicting receipts: ${applied.conflicts.length}`,
    `install ran: ${p.install.ran}; tracked changes after install: ${p.install.tracked_changes.length}; tested tree: ${p.tested_tree === "same-as-head" ? "same-as-head" : "an HMAC of the tree after install (not head)"}`,
    `redaction rules version: ${opts.rules.redaction_version}`,
    "local ≠ confidential",
  ];
  return {
    template: "verify",
    run: runView(run, run_id),
    key: opts.key === null ? "unavailable" : "available",
    verify: {
      finding_id: p.finding_id,
      base_oid: p.base_oid,
      head_oid: p.head_oid,
      branch: p.branch,
      tree_before: p.tree_before,
      tested_tree: p.tested_tree,
      install: { ran: p.install.ran, allow_tracked_changes: p.install.allow_tracked_changes, tracked_changes: [...p.install.tracked_changes], untracked_count: p.install.untracked_count, untracked_bytes: p.install.untracked_bytes, argv_sha256: typeof p.install.argv_sha256 === "string" ? p.install.argv_sha256 : NOT_ASSESSED },
      tests: {
        result: p.tests.result,
        exit_code: Number.isSafeInteger(p.tests.exit_code) ? p.tests.exit_code : NOT_ASSESSED,
        timed_out: typeof p.tests.timed_out === "boolean" ? String(p.tests.timed_out) : NOT_ASSESSED,
        argv_sha256: typeof p.tests.argv_sha256 === "string" ? p.tests.argv_sha256 : NOT_ASSESSED,
        executable_path: typeof p.tests.executable_path === "string" ? p.tests.executable_path : NOT_ASSESSED,
        executable_sha256: typeof p.tests.executable_sha256 === "string" ? p.tests.executable_sha256 : NOT_ASSESSED,
        output_redacted: typeof p.tests.output_redacted === "string" ? p.tests.output_redacted : NOT_ASSESSED,
      },
      suppression: {
        deletion_only: p.suppression.deletion_only,
        indicators: p.suppression.indicators.map((i) => ({ id: i.id, kind: i.kind, path: i.path, line: i.line, sensitive: i.sensitive === true, acked: acked.has(i.id) })),
      },
      packet_sha256: p.packet_sha256,
      row_status_at_start: p.row_status_at_start,
      receipts: p.receipts.map((r) => ({ type: r.type, sha256: r.sha256, applied: r.applied, detail: r.type === "ack" ? `indicator ${r.indicator_id}` : `assertion ${r.assertion}`, not_applied_reason: typeof r.not_applied_reason === "string" ? r.not_applied_reason : "-" })),
      evaluation: { verdict: evaluation.verdict, refound_observed: evaluation.refound_observed, ack_refs: [...evaluation.ack_refs], events: [...evaluation.events] },
      verdict_line,
    },
    receipts: { total: receipts.length, not_applied: applied.not_applied.map((n) => ({ ...n })), conflicts: applied.conflicts.map((c) => ({ ...c })) },
    packets: packetsView(packets),
    limitations,
    hashes: { ...inputs.hashes },
    custody: custodyView(inputs, opts),
  };
}

const VIEWS = Object.freeze({ review: reviewView, verify: verifyView });

/**
 * The derivation (see the header).
 * @param {{template: string, artifacts: object, hashes: Record<string, string>}} inputs from inputs.closeOver
 * @param {{key?: Uint8Array | null, rules: object, tool_version: string, template_version: number}} opts
 * @returns {object} the view
 * @throws {InconsistentInput} a recorded derived artifact does not follow from its inputs
 * @throws {TypeError} on a caller shape error; Error for a template this module cannot render yet
 */
export function buildView(inputs, opts) {
  requireInputs(inputs);
  const o = requireOpts(opts);
  const build = VIEWS[inputs.template];
  if (build === undefined) throw new Error(`buildView: template ${inputs.template} is not renderable yet (TASK-024)`);
  const run = requireArtifact(inputs.artifacts, "run");
  return build(inputs, o, run.envelope.run_id);
}

// --- rendering ----------------------------------------------------------------------

const cell = (v) => sanitize(v, { cell: true });
const row = (cells, path) => `| ${cells.map(cell).join(" | ")} | ${marker(path)}`;
const header = (cells) => [`| ${cells.join(" | ")} |`, `|${cells.map(() => "---").join("|")}|`];
const bullet = (label, value, path) => `- ${label}: ${cell(value)} ${marker(path)}`;
const range = (r) => `${r[0]}-${r[1]}`;
const list = (items) => (items.length === 0 ? "(none)" : items.join(", "));

/** Multi-line prose from an input: a marked label line, then the sanitised lines. */
function prose(label, value, path) {
  const text = sanitize(value);
  if (!text.includes("\n")) return [bullet(label, value, path)];
  return [`${label}: ${marker(path)}`, "", ...text.split("\n"), ""];
}

/** An input snippet as indented code — nothing inside is Markdown; the marker sits on the label line. */
function code(label, value, path) {
  const text = sanitize(value, { code: true });
  return [`${label}: ${marker(path)}`, "", ...text.split("\n").map((l) => `    ${l}`), ""];
}

const SHARED_BLOCKS = {
  identity: (v) => [
    bullet("run", v.run.run_id, "run.run_id"),
    bullet("engagement", v.run.engagement_id, "run.engagement_id"),
    bullet("seq", v.run.seq, "run.seq"),
    bullet("kind", v.run.kind, "run.kind"),
    bullet("base_oid", v.run.base_oid, "run.base_oid"),
    bullet("head_oid", v.run.head_oid, "run.head_oid"),
    bullet("key", v.key, "key"),
  ],
  limitations: (v) => v.limitations.map((l, i) => `- ${cell(l)} ${marker(`limitations[${i}]`)}`),
  custody: (v) => [
    ...header(["input", "sha256"]),
    ...Object.keys(v.hashes)
      .sort(compare)
      .map((name) => row([name, v.hashes[name]], `hashes.${name}`)),
    "",
    bullet("tool_version", v.custody.tool_version, "custody.tool_version"),
    bullet("template", v.custody.template, "custody.template"),
    bullet("redaction rules version", v.custody.redaction_version, "custody.redaction_version"),
    `- ${v.custody.origin} — \`check\` prints \`matches supplied digest\` only against a consumer-held digest of the recomputed manifest (spec §2) ${marker("custody.origin")}`,
    "- manifest: the identity of manifest.json is the content of the COMMITTED marker; it covers the inputs above and the sha256 of this report, so it cannot appear inside it",
  ],
};

const REVIEW_BLOCKS = {
  ...SHARED_BLOCKS,
  coverage: (v) => {
    const out = [
      bullet("status", v.coverage.indeterminate ? `${COVERAGE_INDETERMINATE} (empty scope, D3 — sign-off is blocked)` : "determinate", "coverage.indeterminate"),
      bullet("examined", v.coverage.counts.examined, "coverage.counts.examined"),
      bullet("scanner-only", v.coverage.counts["scanner-only"], "coverage.counts.scanner-only"),
      bullet("unexamined", v.coverage.counts.unexamined, "coverage.counts.unexamined"),
      bullet("skipped", v.coverage.counts.skipped, "coverage.counts.skipped"),
      "",
    ];
    if (v.coverage.accounting.length === 0) out.push(`(no accounting entries) ${marker("coverage.accounting")}`);
    else out.push(...header(["path", "range", "status", "by"]), ...v.coverage.accounting.map((e, i) => row([e.path, e.status === "skipped" ? "(skipped file)" : range(e.range), e.status, list(e.by)], `coverage.accounting[${i}]`)));
    out.push("", "Scanner rows (presence of a scanner import over a path, never a finding):", "");
    if (v.coverage.scanner_rows.length === 0) out.push(`(no scanner rows) ${marker("coverage.scanner_rows")}`);
    else out.push(...header(["tool", "version", "import_sha256", "paths"]), ...v.coverage.scanner_rows.map((r, i) => row([r.tool, r.version, r.import_sha256, list(r.paths)], `coverage.scanner_rows[${i}]`)));
    return out;
  },
  summary: (v) => {
    const s = v.summary;
    const out = [
      bullet("findings gated", s.total, "summary.total"),
      bullet("accepted at gate (CITATION_VERIFIED)", s.accepted, "summary.accepted"),
      bullet("unverifiable at gate (CITATION_FAILED)", s.unverifiable, "summary.unverifiable"),
      bullet("rejected candidates", s.rejected_total, "summary.rejected_total"),
      bullet("unlocated candidates", s.unlocated, "summary.unlocated"),
      bullet("unauthenticated approvals", s.unauthenticated_approvals, "summary.unauthenticated_approvals"),
      bullet("incomplete runs", s.incomplete_runs, "summary.incomplete_runs"),
      "",
      "Counts by priority × state:",
      "",
      ...header(["priority", ...FINDING_STATES]),
      ...REGISTER_PRIORITIES.map((p) => row([p, ...FINDING_STATES.map((st) => s.by_priority_state[p][st])], `summary.by_priority_state.${p}`)),
      "",
      "Unresolved (citation failed) by priority:",
      "",
      ...header(["priority", "unresolved"]),
      ...REGISTER_PRIORITIES.map((p) => row([p, s.unresolved_by_priority[p]], `summary.unresolved_by_priority.${p}`)),
      "",
      "Rejected candidates by reason:",
      "",
    ];
    const reasons = Object.keys(s.rejected_by_reason);
    if (reasons.length === 0) out.push(`(none) ${marker("summary.rejected_by_reason")}`);
    else out.push(...header(["reason", "count"]), ...reasons.map((r) => row([r, s.rejected_by_reason[r]], `summary.rejected_by_reason.${r}`)));
    return out;
  },
  scope: (v) => {
    const out = [];
    if (v.scope.files.length === 0) out.push(`(no scope files) ${marker("scope.files")}`);
    else out.push(...header(["path", "side", "oid", "lines", "admitted ranges"]), ...v.scope.files.map((f, i) => row([f.path, f.side, f.oid, f.lines, list(f.ranges.map(range))], `scope.files[${i}]`)));
    out.push("", "Skipped files:", "");
    if (v.scope.skipped.length === 0) out.push(`(none) ${marker("scope.skipped")}`);
    else out.push(...header(["path", "reason"]), ...v.scope.skipped.map((s, i) => row([s.path, s.reason], `scope.skipped[${i}]`)));
    out.push("", bullet("private redacted snapshots (dirty review files)", v.scope.snapshot_files, "scope.snapshot_files"));
    return out;
  },
  findings: (v) => {
    if (v.findings.length === 0) return [`(no findings) ${marker("findings")}`];
    const out = [];
    v.findings.forEach((f, i) => {
      const at = (k) => `findings[${i}].${k}`;
      out.push(
        `### 8.${i + 1}. ${cell(f.title)} ${marker(at("title"))}`,
        "",
        ...header(["field", "value"]),
        row(["id", f.id], at("id")),
        row(["class / CWE", `${f.class} / ${f.cwe}`], at("class")),
        row(["priority", f.priority], at("priority")),
        row(["confidence", f.confidence], at("confidence")),
        row(["state", f.state], at("state")),
        row(["citation state", f.citation_state], at("citation_state")),
        row(["review", f.review], at("review")),
        row(["affected asset", f.asset], at("asset")),
        row(["occurrence", f.occurrence], at("occurrence")),
        row(["source", `${f.source.kind} ${f.source.ref} #${f.source.index}`], at("source")),
        row(["sensitive", f.sensitive ? "yes (keyed identity)" : "no"], at("sensitive")),
        row(["typed citations required", f.requires_typed_citations ? "yes" : "no"], at("requires_typed_citations")),
        row(["reproduction", f.reproduction], at("reproduction")),
        row(["ticket_url", f.ticket_url], at("ticket_url")),
        row(["verification history", f.verification_history], at("verification_history")),
        "",
        ...prose("Description", f.description, at("description")),
        ...prose("Impact", f.impact, at("impact")),
        ...prose("Prerequisites", f.prerequisites, at("prerequisites")),
        ...prose("Remediation", f.remediation, at("remediation")),
        "",
        ...code(`Evidence (${f.evidence.kind}${f.evidence.sensitive ? ", redacted" : ""})`, f.evidence.text, at("evidence")),
      );
      if (f.citations_typed.length === 0) out.push(`Typed citations: (none) ${marker(at("citations_typed"))}`, "");
      else out.push("Typed citations:", "", ...header(["role", "path", "side", "lines", "context"]), ...f.citations_typed.map((c, j) => row([c.role, c.path, c.side, range(c.lines), String(c.context)], at(`citations_typed[${j}]`))), "");
    });
    return out;
  },
  unresolved: (v) => {
    const out = ["Citation failed (the claimed text is not what the cited side holds):", ""];
    if (v.unresolved.citation_failed.length === 0) out.push(`(none) ${marker("unresolved.citation_failed")}`);
    else out.push(...header(["id", "title", "priority", "affected asset"]), ...v.unresolved.citation_failed.map((f, i) => row([f.id, f.title, f.priority, f.asset], `unresolved.citation_failed[${i}]`)));
    out.push("", "Unlocated scanner candidates (never gated):", "");
    if (v.unresolved.unlocated.length === 0) out.push(`(none) ${marker("unresolved.unlocated")}`);
    else out.push(...header(["reason", "tool", "rule", "import_sha256", "index"]), ...v.unresolved.unlocated.map((c, i) => row([c.reason, c.tool, c.rule_id, c.import_sha256, c.index], `unresolved.unlocated[${i}]`)));
    return out;
  },
  "threat-model": (v) => [`${cell(v.threat_model)} ${marker("threat_model")}`],
  register: (v) => [`${cell(v.register)} ${marker("register")}`],
};

const VERIFY_BLOCKS = {
  ...SHARED_BLOCKS,
  verdict: (v) => {
    const e = v.verify.evaluation;
    return [
      `${v.verify.verdict_line} ${marker("verify.verdict_line")}`,
      "",
      bullet("verdict", e.verdict, "verify.evaluation.verdict"),
      bullet("refound_observed", e.refound_observed, "verify.evaluation.refound_observed"),
      bullet("row_status_at_start", v.verify.row_status_at_start, "verify.row_status_at_start"),
      bullet("register events emitted", list(e.events.map((ev) => (typeof ev === "string" ? ev : ev.event ?? JSON.stringify(ev)))), "verify.evaluation.events"),
      bullet("ack_refs", list(e.ack_refs), "verify.evaluation.ack_refs"),
    ];
  },
  raw: (v) => {
    const r = v.verify;
    return [
      ...header(["field", "value"]),
      row(["finding_id", r.finding_id], "verify.finding_id"),
      row(["base_oid", r.base_oid], "verify.base_oid"),
      row(["head_oid", r.head_oid], "verify.head_oid"),
      row(["branch", r.branch], "verify.branch"),
      row(["tree_before", r.tree_before], "verify.tree_before"),
      row(["tested_tree", r.tested_tree], "verify.tested_tree"),
      row(["install.ran", r.install.ran], "verify.install.ran"),
      row(["install.allow_tracked_changes", r.install.allow_tracked_changes], "verify.install.allow_tracked_changes"),
      row(["install.tracked_changes", list(r.install.tracked_changes)], "verify.install.tracked_changes"),
      row(["install.untracked_count", r.install.untracked_count], "verify.install.untracked_count"),
      row(["install.untracked_bytes", r.install.untracked_bytes], "verify.install.untracked_bytes"),
      row(["install.argv_sha256", r.install.argv_sha256], "verify.install.argv_sha256"),
      row(["tests.result", r.tests.result], "verify.tests.result"),
      row(["tests.exit_code", r.tests.exit_code], "verify.tests.exit_code"),
      row(["tests.timed_out", r.tests.timed_out], "verify.tests.timed_out"),
      row(["tests.argv_sha256", r.tests.argv_sha256], "verify.tests.argv_sha256"),
      row(["tests.executable_path", r.tests.executable_path], "verify.tests.executable_path"),
      row(["tests.executable_sha256", r.tests.executable_sha256], "verify.tests.executable_sha256"),
      row(["fix-review packet", r.packet_sha256], "verify.packet_sha256"),
      "",
      ...code("Test output (redacted, bounded)", r.tests.output_redacted, "verify.tests.output_redacted"),
    ];
  },
  suppression: (v) => {
    const s = v.verify.suppression;
    const out = [bullet("deletion_only", s.deletion_only, "verify.suppression.deletion_only"), ""];
    if (s.indicators.length === 0) out.push(`(no indicators) ${marker("verify.suppression.indicators")}`);
    else out.push(...header(["id", "kind", "path", "line", "sensitive", "acked"]), ...s.indicators.map((i, k) => row([i.id, i.kind, i.path, i.line, i.sensitive, i.acked], `verify.suppression.indicators[${k}]`)));
    return out;
  },
  receipts: (v) => {
    const out = [];
    if (v.verify.receipts.length === 0) out.push(`(no receipts recorded by verify.json) ${marker("verify.receipts")}`);
    else out.push(...header(["type", "sha256", "applied", "detail", "not applied reason"]), ...v.verify.receipts.map((r, i) => row([r.type, r.sha256, r.applied, r.detail, r.not_applied_reason], `verify.receipts[${i}]`)));
    out.push("", bullet("receipts in the run directory", v.receipts.total, "receipts.total"), bullet("packets in the run directory", v.packets.length, "packets"));
    return out;
  },
};

const BLOCKS = Object.freeze({ review: REVIEW_BLOCKS, verify: VERIFY_BLOCKS });
const BLOCK_SLOT = /^\{\{block:([a-z-]+)\}\}$/;
const SCALAR_SLOT = /\{\{([A-Za-z0-9_.[\]-]+)\}\}/g;

/**
 * Render the view through the template (see the header).
 * @param {object} view from buildView
 * @param {{template: string, template_version: number, required_inputs: string[], body: string}} template from parseTemplate
 * @returns {string} the report, redacted, LF-terminated
 * @throws {Error} a slot naming nothing in the view, or a template/view mismatch
 */
export function renderMarkdown(view, template) {
  if (!isObject(view) || typeof view.template !== "string") throw new TypeError("renderMarkdown: view must come from buildView");
  if (!isObject(template) || typeof template.body !== "string") throw new TypeError("renderMarkdown: template must come from parseTemplate");
  if (template.template !== view.template) throw new Error(`renderMarkdown: template ${template.template} does not match the view's template ${view.template}`);
  const blocks = BLOCKS[view.template];
  if (blocks === undefined) throw new Error(`renderMarkdown: template ${view.template} has no blocks yet (TASK-024)`);
  const out = [];
  for (const line of template.body.split("\n")) {
    const b = BLOCK_SLOT.exec(line.trim());
    if (b !== null) {
      const block = blocks[b[1]];
      if (block === undefined) throw new Error(`renderMarkdown: block ${b[1]} is not defined for template ${view.template}`);
      out.push(...block(view));
      continue;
    }
    const markers = [];
    const rendered = line.replace(SCALAR_SLOT, (_, path) => {
      const value = getPath(view, path);
      if (value === undefined || value === null || typeof value === "object") throw new Error(`renderMarkdown: slot ${path} names no scalar in the view`);
      markers.push(marker(path));
      return cell(value);
    });
    out.push(markers.length === 0 ? rendered : `${rendered} ${markers.join(" ")}`);
  }
  let text = out.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  return redactString(text).text;
}

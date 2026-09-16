// lib/tm-lint-core.mjs — the pure core behind `tm-lint.mjs check | render`
// (TASK-039; plan §4.4, §5 TASK-039; spec §6.10 threat dispositions, D14
// "JSON model of record; Markdown generated"; US-031 AC-2…AC-4; G-9 pure
// core). Three questions, answered in memory:
//
//   lintStructure(model, scope) → null | {locus, reason}
//     Is the model well-formed against the run's scope? In order — the first
//     failure is the answer, so an agent fixes one thing at a time:
//       1. threat-model.schema.json (schema.validate). The error's JSON path
//          is folded to the element / threat it sits under and that id is
//          the locus (`E-001`, `T-001`); when the id itself is off-shape the
//          locus is positional (`elements[0]`); a root error names `model`.
//       2. ids unique across the model: element, threat and mitigation ids
//          (a mitigation id defined under two threats names the LATER
//          threat — the first definition stands).
//       3. blank names refused (PM log after G14: `Element.name`,
//          `Threat.title`, `Mitigation.claim` have no minLength in the
//          schema, and the renderer forbids a blank cell).
//       4. every `threat.element_id` names an element of the model.
//       5. disposition shape: `undisposed` carries no ref (an empty string is
//          tolerated — it is what the index writes); every other kind needs a
//          non-empty ref (the relationship itself is lintDispositions').
//       6. citations — every element's, every mitigation's (optional; PM log
//          after G10: checked here so cmd-packet never sees a bad range):
//          first PM ruling R2 — a citation on a file the scope recorded at
//          `snapshot` (a dirty review file) is TM_DIRTY_CITATION, verbatim,
//          before any range rule; then cite-core.checkRange against the scope
//          (range shape, ≤ 40 lines, path in scope, side, inside one admitted
//          range) with its reason token. A mitigation is named through its
//          threat: `mitigation M-001 …`.
//
//   lintDispositions(model, evidence) → {error: null | {locus, reason}, dispositions}
//     Does every disposition's relationship hold (spec §6.10 "validates each
//     relationship, not mere existence")? `evidence` is six closures the
//     caller binds to the run directory — this core never touches a file:
//       proposal(id) → boolean            id listed in <run>/proposals-index.json
//       admission(sha) → boolean          <run>/admissions/<sha>.json is an admission
//       observation(id) → boolean         <run>/observations/<id>.json is an observation
//       readback(threat_id, url) → boolean a tracker-readback import record whose
//                                         trusted {finding_id, url, body_contains_finding_id}
//                                         is {threat_id, url, true}
//       row(id) → undefined | null | {subject, status}
//                                         undefined: no register-events.json in the run;
//                                         null: no such row in its replay
//       mitigationState(id) → string | undefined   states.applyReceipts' mitigation_states
//     Per kind: planned(ref) ⇒ a 64-hex ref is a case (admission), anything
//     else a proposal id; executed ⇒ observation; ticketed ⇒ readback;
//     accepted ⇒ row.subject == threat id && row.status == accepted;
//     mitigated ⇒ the ref is one of THIS threat's mitigations and its state
//     is MITIGATION_CONFIRMED; undisposed ⇒ nothing. Threats are checked in
//     model order; the first failure is the answer and `dispositions` is
//     then `[]`. On success `dispositions` is the Dispositions payload of
//     threat-model.schema.json: one row per threat in model order,
//     `{threat_id, kind, ref ("" for undisposed), resolved_via}` with
//     `resolved_via` naming what validated it (`none` for undisposed).
//
//   renderThreatModel({run_id, model, dispositions, mitigation_states}) → string
//     The Markdown view `tm-lint render` writes (D14): counts, then four
//     tables — elements, threats, mitigations (with the derived state, or
//     NOT_INDEPENDENTLY_REVIEWED), the dispositions index. Cells are never
//     blank (NOT_ASSESSED stands in for an absent ref / citation, spec §11);
//     `|` and newlines inside prose are escaped so a cell cannot break its
//     row. Deterministic: same inputs, same bytes.
//
// modelCounts(model) → {elements, threats, undisposed} feeds the TM line.
//
// Imports: ./cite-core.mjs (checkRange, SIDES), ./schema.mjs (validate),
// ./tokens.mjs. No fs, no child process, no git, no clock, no
// randomness (G-9); inputs are never mutated.

import { SIDES, checkRange } from "./cite-core.mjs";
import { validate } from "./schema.mjs";
import { DISPOSITION_KINDS, MITIGATION_CONFIRMED, NOT_ASSESSED, NOT_INDEPENDENTLY_REVIEWED, TM_DIRTY_CITATION } from "./tokens.mjs";

/** threat-model.schema.json id shapes. */
export const ELEMENT_ID = /^E-[0-9]{3}$/;
export const THREAT_ID = /^T-[0-9]{3}$/;
export const MITIGATION_ID = /^M-[0-9]{3}$/;
/** A `planned` ref of this shape is a case (admission record), anything else a proposal id. */
export const CASE_SHA256 = /^[0-9a-f]{64}$/;
/** Dispositions `resolved_via` vocabulary (threat-model.schema.json), in schema order. */
export const RESOLVED_VIA = Object.freeze(["proposal", "admission", "observation", "tracker-readback", "register-row", "receipt", "none"]);

const EVIDENCE_KEYS = Object.freeze(["proposal", "admission", "observation", "readback", "row", "mitigationState"]);
const SCHEMA = "threat-model";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const blank = (s) => typeof s !== "string" || s.trim() === "";
const fail = (locus, reason) => ({ locus, reason });

// --- structure ------------------------------------------------------------------------

/**
 * Fold a schema error's path (`$.elements[0].citation.lines: …`) to the
 * element / threat it sits under: locus = that item's id when it is a
 * well-formed string, else the positional `elements[0]`; the reason is the
 * rest of the path plus the message. A root-level error names `model`.
 */
function schemaLocus(model, error) {
  const m = /^\$(?:\.(elements|threats)\[([0-9]+)\])?((?:\.[^:]*|\[[^:]*)?): (.*)$/.exec(error);
  if (m === null) return fail("model", error);
  const [, list, index, rest, message] = m;
  if (list === undefined) return fail("model", rest === "" ? message : `${rest.replace(/^\./, "")}: ${message}`);
  const item = model[list][Number(index)];
  const pattern = list === "elements" ? ELEMENT_ID : THREAT_ID;
  const locus = isObject(item) && typeof item.id === "string" && pattern.test(item.id) ? item.id : `${list}[${index}]`;
  return fail(locus, rest === "" ? message : `${rest.replace(/^\./, "")}: ${message}`);
}

const citationText = (c) => `${c.path}:${c.lines[0]}-${c.lines[1]} @ ${c.side}`;

/** R2 first, then cite-core.checkRange; `prefix` names a mitigation through its threat. */
function citationFailure(scope, citation, prefix) {
  const file = scope.files.find((f) => isObject(f) && f.path === citation.path);
  if (file !== undefined && file.side === "snapshot") return `${prefix}${TM_DIRTY_CITATION}`;
  const r = checkRange(scope, citation);
  return r.ok ? null : `${prefix}citation ${citationText(citation)}: ${r.reason}`;
}

function scopePayload(scope) {
  const p = isObject(scope) && scope.payload !== undefined && scope.envelope !== undefined ? scope.payload : scope;
  if (!isObject(p) || !Array.isArray(p.files) || !isObject(p.ranges)) throw new TypeError("lintStructure: scope must be a scope payload or its artifact");
  return p;
}

/**
 * @param {unknown} model the parsed threat model (agent-authored; anything goes)
 * @param {object} scope the run's scope payload or artifact
 * @returns {null | {locus: string, reason: string}}
 */
export function lintStructure(model, scope) {
  const p = scopePayload(scope);
  const errors = validate(SCHEMA, model);
  if (errors.length > 0) return schemaLocus(model, errors[0]);

  const elementIds = new Set();
  for (const e of model.elements) {
    if (elementIds.has(e.id)) return fail(e.id, "duplicate id");
    elementIds.add(e.id);
  }
  const threatIds = new Set();
  const mitigationOwner = new Map();
  for (const t of model.threats) {
    if (threatIds.has(t.id)) return fail(t.id, "duplicate id");
    threatIds.add(t.id);
    for (const m of t.mitigations) {
      if (mitigationOwner.has(m.id)) return fail(t.id, `mitigation ${m.id} is already defined under ${mitigationOwner.get(m.id)}`);
      mitigationOwner.set(m.id, t.id);
    }
  }

  for (const e of model.elements) if (blank(e.name)) return fail(e.id, "name is empty");
  for (const t of model.threats) {
    if (blank(t.title)) return fail(t.id, "title is empty");
    for (const m of t.mitigations) if (blank(m.claim)) return fail(t.id, `mitigation ${m.id} claim is empty`);
  }

  for (const t of model.threats) if (!elementIds.has(t.element_id)) return fail(t.id, `element ${t.element_id} is not in the model`);

  for (const t of model.threats) {
    const { kind, ref } = t.disposition;
    if (kind === "undisposed") {
      if (ref !== undefined && ref !== "") return fail(t.id, "undisposed must not carry a ref");
    } else if (ref === undefined || ref === "") {
      return fail(t.id, `${kind} requires a ref`);
    }
  }

  for (const e of model.elements) {
    const reason = citationFailure(p, e.citation, "");
    if (reason !== null) return fail(e.id, reason);
  }
  for (const t of model.threats) {
    for (const m of t.mitigations) {
      if (m.citation === undefined) continue;
      const reason = citationFailure(p, m.citation, `mitigation ${m.id} `);
      if (reason !== null) return fail(t.id, reason);
    }
  }
  return null;
}

/** @returns {{elements: number, threats: number, undisposed: number}} */
export function modelCounts(model) {
  if (!isObject(model) || !Array.isArray(model.elements) || !Array.isArray(model.threats)) throw new TypeError("modelCounts: model must be {elements[], threats[]}");
  return { elements: model.elements.length, threats: model.threats.length, undisposed: model.threats.filter((t) => isObject(t.disposition) && t.disposition.kind === "undisposed").length };
}

// --- dispositions ---------------------------------------------------------------------

function requireEvidence(evidence) {
  if (!isObject(evidence)) throw new TypeError("lintDispositions: evidence must be an object of closures");
  for (const k of EVIDENCE_KEYS) if (typeof evidence[k] !== "function") throw new TypeError(`lintDispositions: evidence.${k} must be a function`);
  return evidence;
}

/** One relationship; returns `{resolved_via}` or `{reason}`. */
function relationship(threat, evidence) {
  const { kind, ref } = threat.disposition;
  const at = `${kind}(${ref})`;
  switch (kind) {
    case "undisposed":
      return { resolved_via: "none" };
    case "planned":
      if (CASE_SHA256.test(ref)) return evidence.admission(ref) ? { resolved_via: "admission" } : { reason: `${at}: no admission record admissions/${ref}.json` };
      return evidence.proposal(ref) ? { resolved_via: "proposal" } : { reason: `${at}: proposal ${ref} is not in proposals-index.json` };
    case "executed":
      return evidence.observation(ref) ? { resolved_via: "observation" } : { reason: `${at}: no observation observations/${ref}.json` };
    case "ticketed":
      return evidence.readback(threat.id, ref) ? { resolved_via: "tracker-readback" } : { reason: `${at}: no tracker-readback record shows a ticket body at that url carrying ${threat.id}` };
    case "accepted": {
      const row = evidence.row(ref);
      if (row === undefined) return { reason: `${at}: register-events.json is not in the run (run snapshot register)` };
      if (row === null) return { reason: `${at}: row ${ref} is not in the register snapshot` };
      if (row.subject !== threat.id) return { reason: `${at}: row ${ref} subject is ${row.subject}, not ${threat.id}` };
      if (row.status !== "accepted") return { reason: `${at}: row ${ref} status is ${row.status}, not accepted` };
      return { resolved_via: "register-row" };
    }
    case "mitigated": {
      if (!threat.mitigations.some((m) => m.id === ref)) return { reason: `${at}: ${ref} is not a mitigation of ${threat.id}` };
      const state = evidence.mitigationState(ref);
      if (state !== MITIGATION_CONFIRMED) return { reason: `${at}: ${ref} has no ${MITIGATION_CONFIRMED} state (${state === undefined ? NOT_INDEPENDENTLY_REVIEWED : state})` };
      return { resolved_via: "receipt" };
    }
    default:
      throw new TypeError(`lintDispositions: disposition kind ${String(kind)} is outside ${DISPOSITION_KINDS.join("|")}`);
  }
}

/**
 * @param {object} model a model lintStructure accepted
 * @param {object} evidence the six closures (header)
 * @returns {{error: null | {locus: string, reason: string}, dispositions: {threat_id: string, kind: string, ref: string, resolved_via: string}[]}}
 */
export function lintDispositions(model, evidence) {
  requireEvidence(evidence);
  if (!isObject(model) || !Array.isArray(model.threats)) throw new TypeError("lintDispositions: model must be {elements[], threats[]}");
  const dispositions = [];
  for (const t of model.threats) {
    const r = relationship(t, evidence);
    if (r.reason !== undefined) return { error: fail(t.id, r.reason), dispositions: [] };
    dispositions.push({ threat_id: t.id, kind: t.disposition.kind, ref: t.disposition.ref ?? "", resolved_via: r.resolved_via });
  }
  return { error: null, dispositions };
}

// --- render ------------------------------------------------------------------------------

/** A table cell: one line, pipes escaped, never blank. */
function cell(value) {
  const s = String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  return s === "" ? NOT_ASSESSED : s;
}
const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
const header = (cols) => [row(cols), `|${cols.map(() => "---").join("|")}|`];
const table = (cols, rows) => (rows.length === 0 ? ["(none)"] : [...header(cols), ...rows.map(row)]);
const dispositionText = (d) => (typeof d.ref === "string" && d.ref !== "" ? `${d.kind} (${d.ref})` : d.kind);
const citeOrNot = (c) => (isObject(c) && SIDES.includes(c.side) && Array.isArray(c.lines) ? citationText(c) : NOT_ASSESSED);

/**
 * @param {{run_id: string, model: object, dispositions: object[], mitigation_states: Record<string, string>}} input
 * @returns {string} Markdown, LF-terminated
 */
export function renderThreatModel({ run_id, model, dispositions, mitigation_states } = {}) {
  if (typeof run_id !== "string" || run_id === "") throw new TypeError("renderThreatModel: run_id is required");
  if (!Array.isArray(dispositions)) throw new TypeError("renderThreatModel: dispositions must be the index rows");
  if (!isObject(mitigation_states)) throw new TypeError("renderThreatModel: mitigation_states must be an object");
  const counts = modelCounts(model);
  const elements = model.elements.map((e) => [e.id, e.kind, e.name, citeOrNot(e.citation)]);
  const threats = model.threats.map((t) => [t.id, t.element_id, t.stride, t.title, dispositionText(t.disposition), t.mitigations.length === 0 ? NOT_ASSESSED : t.mitigations.map((m) => m.id).join(", ")]);
  const mitigations = model.threats.flatMap((t) => t.mitigations.map((m) => [m.id, t.id, m.claim, citeOrNot(m.citation), mitigation_states[m.id] ?? NOT_INDEPENDENTLY_REVIEWED]));
  const index = dispositions.map((d) => [d.threat_id, d.kind, d.ref === "" ? NOT_ASSESSED : d.ref, d.resolved_via]);
  const lines = [
    `# Threat model — run ${run_id}`,
    "",
    `elements=${counts.elements} threats=${counts.threats} undisposed=${counts.undisposed}`,
    "",
    "## Elements",
    "",
    ...table(["id", "kind", "name", "citation"], elements),
    "",
    "## Threats",
    "",
    ...table(["id", "element", "STRIDE", "title", "disposition", "mitigations"], threats),
    "",
    "## Mitigations (claims)",
    "",
    ...table(["id", "threat", "claim", "citation", "state"], mitigations),
    "",
    "## Dispositions",
    "",
    ...table(["threat", "kind", "ref", "resolved via"], index),
    "",
  ];
  return lines.join("\n");
}

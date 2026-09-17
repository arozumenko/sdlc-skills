// lib/threat-model.mjs — the structural lint behind `cite.mjs check
// <threat-model.json>` (spec §6, threat-model mode). The model is
//   { head?, elements: [{id: E-nnn, name, kind, citations: [...]}],
//     threats:  [{id: T-nnn, element_id, stride, title,
//                 mitigations: [{id: M-nnn, claim, citations: [...]}],
//                 disposition}] }
// and the lint answers one `{locus, why}` per defect, in document order:
// ids match their pattern and are unique, every threat names an element of
// the model, every element and every mitigation carries at least one
// citation, and the disposition is one of the five spellings below with its
// referent present — `mitigated(M-nnn)` names one of THIS threat's
// mitigations, `accepted(R-nnnn)` a live register row, `planned(TC-nnn)` a
// case in the admitted suite. Citations themselves are verified by the
// caller (`checkCitation`); this module never touches git or the disk.
//
// Leaf module: stdlib only, no I/O.

/** The five dispositions (spec §6); the parenthesised referent is captured by `parseDisposition`. */
export const DISPOSITION = /^(open|accepted\(R-\d{4}\)|mitigated\(M-\d{3}\)|planned\(TC-\d{3}\)|out-of-scope\([^()]+\))$/;
export const ELEMENT_ID = /^E-\d{3}$/;
export const THREAT_ID = /^T-\d{3}$/;
export const MITIGATION_ID = /^M-\d{3}$/;
export const KINDS = Object.freeze(["process", "datastore", "external", "flow", "boundary"]);
export const STRIDE = Object.freeze(["S", "T", "R", "I", "D", "E"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonBlank = (s) => typeof s === "string" && s.trim().length > 0;
const hasCitation = (v) => Array.isArray(v) && v.length > 0;

/**
 * Split a well-formed disposition into its kind and referent.
 * @param {string} s a string matching `DISPOSITION`
 * @returns {{kind: string, ref?: string}}
 */
export function parseDisposition(s) {
  const open = s.indexOf("(");
  return open === -1 ? { kind: s } : { kind: s.slice(0, open), ref: s.slice(open + 1, -1) };
}

/**
 * Lint the model's structure and dispositions.
 * @param {object} doc the parsed threat model
 * @param {{registerRows: Set<string>, admittedCases: Set<string>}} refs live `R-nnnn` ids; admitted `TC-nnn` ids
 * @returns {{errors: {locus: string, why: string}[]}}
 */
export function lintThreatModel(doc, { registerRows, admittedCases }) {
  const errors = [];
  const err = (locus, why) => errors.push({ locus, why });
  if (!Array.isArray(doc.elements)) err("elements", "must be an array");
  if (!Array.isArray(doc.threats)) err("threats", "must be an array");
  if (errors.length > 0) return { errors };

  const seen = new Set();
  /** Validate `id` against `re`; returns the id when it is usable as a locus, else `fallback`. */
  const checkId = (id, re, pattern, fallback) => {
    if (typeof id !== "string" || !re.test(id)) {
      err(fallback, `id must match ${pattern}`);
      return fallback;
    }
    if (seen.has(id)) {
      err(id, "duplicate id");
      return id;
    }
    seen.add(id);
    return id;
  };

  const elementIds = new Set();
  doc.elements.forEach((e, i) => {
    const fallback = `elements[${i}]`;
    if (!isObject(e)) {
      err(fallback, "not an object");
      return;
    }
    const locus = checkId(e.id, ELEMENT_ID, "E-nnn", fallback);
    if (locus === e.id) elementIds.add(e.id);
    if (!nonBlank(e.name)) err(locus, "empty name");
    if (!KINDS.includes(e.kind)) err(locus, `kind must be one of ${KINDS.join(", ")}`);
    if (!hasCitation(e.citations)) err(locus, "no citation");
  });

  doc.threats.forEach((t, i) => {
    const fallback = `threats[${i}]`;
    if (!isObject(t)) {
      err(fallback, "not an object");
      return;
    }
    const locus = checkId(t.id, THREAT_ID, "T-nnn", fallback);
    if (!elementIds.has(t.element_id)) err(locus, `element ${typeof t.element_id === "string" ? t.element_id : "(missing)"} is not in the model`);
    if (!STRIDE.includes(t.stride)) err(locus, `stride must be one of ${STRIDE.join(", ")}`);
    if (!nonBlank(t.title)) err(locus, "empty title");
    const own = new Set();
    if (!Array.isArray(t.mitigations)) {
      err(locus, "mitigations must be an array");
    } else {
      t.mitigations.forEach((m, j) => {
        const mFallback = `${locus}.mitigations[${j}]`;
        if (!isObject(m)) {
          err(mFallback, "not an object");
          return;
        }
        const mLocus = checkId(m.id, MITIGATION_ID, "M-nnn", mFallback);
        if (mLocus === m.id) own.add(m.id);
        if (!nonBlank(m.claim)) err(mLocus, "empty claim");
        if (!hasCitation(m.citations)) err(mLocus, "no citation");
      });
    }
    if (typeof t.disposition !== "string" || !DISPOSITION.test(t.disposition)) {
      err(locus, "unknown disposition");
      return;
    }
    const { kind, ref } = parseDisposition(t.disposition);
    if (kind === "mitigated" && !own.has(ref)) err(locus, `${t.disposition}: not a mitigation of this threat`);
    if (kind === "accepted" && !registerRows.has(ref)) err(locus, `${t.disposition}: no such register row`);
    if (kind === "planned" && !admittedCases.has(ref)) err(locus, `${t.disposition}: not in the admitted suite`);
  });
  return { errors };
}

/**
 * Threats whose disposition is exactly `open` (the `open=<n>` of the
 * `MODEL` line). Non-object threats and other spellings do not count.
 * @param {object} doc
 * @returns {number}
 */
export function countOpen(doc) {
  if (!Array.isArray(doc.threats)) return 0;
  return doc.threats.filter((t) => isObject(t) && t.disposition === "open").length;
}

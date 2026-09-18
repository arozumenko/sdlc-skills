import { test } from "node:test";
import assert from "node:assert/strict";

import { DISPOSITION, countOpen, lintThreatModel } from "./threat-model.mjs";

const CIT = { path: "src/app.js", lines: [1, 3], snippet: "import x" };
/** A valid two-element, three-threat model; `mutate` edits a structuredClone. */
const model = (mutate = () => {}) => {
  const doc = {
    head: "a".repeat(40),
    elements: [
      { id: "E-001", name: "HTTP handler", kind: "process", citations: [CIT] },
      { id: "E-002", name: "Config file", kind: "datastore", citations: [CIT] },
    ],
    threats: [
      { id: "T-001", element_id: "E-001", stride: "T", title: "Path traversal via req.url", mitigations: [{ id: "M-001", claim: "URL is normalised before use", citations: [CIT] }], disposition: "mitigated(M-001)" },
      { id: "T-002", element_id: "E-002", stride: "I", title: "Secret in source", mitigations: [], disposition: "accepted(R-0001)" },
      { id: "T-003", element_id: "E-001", stride: "D", title: "Unbounded body", mitigations: [], disposition: "planned(TC-001)" },
      { id: "T-004", element_id: "E-002", stride: "S", title: "Spoofed config", mitigations: [], disposition: "open" },
      { id: "T-005", element_id: "E-001", stride: "E", title: "Runs as root", mitigations: [], disposition: "out-of-scope(deployment, not code)" },
    ],
  };
  mutate(doc);
  return doc;
};
const CTX = { registerRows: new Set(["R-0001"]), admittedCases: new Set(["TC-001"]) };
const lint = (mutate, ctx = CTX) => lintThreatModel(model(mutate), ctx).errors;

test("a valid model has no errors; open counts the open dispositions", () => {
  assert.deepEqual(lint(), []);
  assert.equal(countOpen(model()), 1);
});

test("the disposition grammar", () => {
  for (const ok of ["open", "accepted(R-0007)", "mitigated(M-002)", "planned(TC-003)", "out-of-scope(no network here)"]) assert.match(ok, DISPOSITION, ok);
  for (const bad of ["fixed", "Open", "accepted(R-7)", "accepted(R-00071)", "mitigated(M-1)", "planned(TC-1)", "out-of-scope()", "out-of-scope((x))", " open", "open "]) assert.doesNotMatch(bad, DISPOSITION, bad);
});

test("a threat naming an element that is not in the model", () => {
  assert.deepEqual(lint((d) => { d.threats[0].element_id = "E-009"; }), [{ locus: "T-001", why: "element E-009 is not in the model" }]);
});

test("every element and every mitigation carries a citation", () => {
  assert.deepEqual(lint((d) => { d.threats[0].mitigations[0].citations = []; }), [{ locus: "M-001", why: "no citation" }]);
  assert.deepEqual(lint((d) => { delete d.threats[0].mitigations[0].citations; }), [{ locus: "M-001", why: "no citation" }]);
  assert.deepEqual(lint((d) => { d.elements[1].citations = []; }), [{ locus: "E-002", why: "no citation" }]);
});

test("dispositions are checked against this threat, the register and the admitted suite", () => {
  assert.deepEqual(lint((d) => { d.threats[0].disposition = "mitigated(M-002)"; }), [{ locus: "T-001", why: "mitigated(M-002): not a mitigation of this threat" }]);
  assert.deepEqual(lint((d) => { d.threats[1].disposition = "accepted(R-0007)"; }), [{ locus: "T-002", why: "accepted(R-0007): no such register row" }]);
  assert.deepEqual(lint((d) => { d.threats[2].disposition = "planned(TC-003)"; }), [{ locus: "T-003", why: "planned(TC-003): not in the admitted suite" }]);
  assert.deepEqual(lint((d) => { d.threats[3].disposition = "fixed"; }), [{ locus: "T-004", why: "unknown disposition" }]);
  assert.deepEqual(lint((d) => { delete d.threats[3].disposition; }), [{ locus: "T-004", why: "unknown disposition" }]);
  assert.deepEqual(lint(undefined, { registerRows: new Set(), admittedCases: new Set() }), [
    { locus: "T-002", why: "accepted(R-0001): no such register row" },
    { locus: "T-003", why: "planned(TC-001): not in the admitted suite" },
  ]);
});

test("empty names, titles and claims", () => {
  assert.deepEqual(lint((d) => { d.elements[0].name = ""; }), [{ locus: "E-001", why: "empty name" }]);
  assert.deepEqual(lint((d) => { d.threats[0].title = "  "; }), [{ locus: "T-001", why: "empty title" }]);
  assert.deepEqual(lint((d) => { delete d.threats[0].mitigations[0].claim; }), [{ locus: "M-001", why: "empty claim" }]);
});

test("ids, kinds and stride letters", () => {
  assert.deepEqual(lint((d) => { d.elements[0].id = "E-1"; }), [{ locus: "elements[0]", why: "id must match E-nnn" }, { locus: "T-001", why: "element E-001 is not in the model" }, { locus: "T-003", why: "element E-001 is not in the model" }, { locus: "T-005", why: "element E-001 is not in the model" }]);
  assert.deepEqual(lint((d) => { d.threats[1].id = "T-2"; }), [{ locus: "threats[1]", why: "id must match T-nnn" }]);
  assert.deepEqual(lint((d) => { d.threats[0].mitigations[0].id = "X-001"; }), [{ locus: "T-001.mitigations[0]", why: "id must match M-nnn" }, { locus: "T-001", why: "mitigated(M-001): not a mitigation of this threat" }]);
  assert.deepEqual(lint((d) => { d.elements.push({ ...d.elements[0] }); }), [{ locus: "E-001", why: "duplicate id" }]);
  assert.deepEqual(lint((d) => { d.threats[1].mitigations.push({ id: "M-001", claim: "again", citations: [CIT] }); }), [{ locus: "M-001", why: "duplicate id" }]);
  assert.deepEqual(lint((d) => { d.elements[0].kind = "server"; }), [{ locus: "E-001", why: "kind must be one of process, datastore, external, flow, boundary" }]);
  assert.deepEqual(lint((d) => { d.threats[0].stride = "X"; }), [{ locus: "T-001", why: "stride must be one of S, T, R, I, D, E" }]);
  assert.deepEqual(lint((d) => { d.threats[0].mitigations = "none"; }), [{ locus: "T-001", why: "mitigations must be an array" }, { locus: "T-001", why: "mitigated(M-001): not a mitigation of this threat" }]);
  assert.deepEqual(lint((d) => { d.elements[0] = "E-001"; }), [{ locus: "elements[0]", why: "not an object" }, { locus: "T-001", why: "element E-001 is not in the model" }, { locus: "T-003", why: "element E-001 is not in the model" }, { locus: "T-005", why: "element E-001 is not in the model" }]);
});

test("the top-level arrays", () => {
  assert.deepEqual(lintThreatModel({ threats: [] }, CTX).errors, [{ locus: "elements", why: "must be an array" }]);
  assert.deepEqual(lintThreatModel({ elements: [], threats: {} }, CTX).errors, [{ locus: "threats", why: "must be an array" }]);
  assert.deepEqual(lintThreatModel({ elements: [], threats: [] }, CTX).errors, []);
  assert.equal(countOpen({ elements: [], threats: [] }), 0);
});

// TASK-039 — lib/tm-lint-core.mjs: the pure core behind `tm-lint.mjs check |
// render` (plan §4.4, §5 TASK-039; spec §6.10, D14; US-031 AC-2…AC-4; G-9
// pure core). Structure (schema, ids, blank names, element references,
// citations against the run's scope), disposition relationships against
// caller-supplied evidence closures, and the Markdown view — all in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./schema.mjs";
import { CASE_SHA256, ELEMENT_ID, MITIGATION_ID, RESOLVED_VIA, THREAT_ID, lintDispositions, lintStructure, modelCounts, renderThreatModel } from "./tm-lint-core.mjs";
import { MITIGATION_CONFIRMED, MITIGATION_GAP, NOT_ASSESSED, NOT_INDEPENDENTLY_REVIEWED, PATH_NOT_IN_SCOPE, RANGE_INVALID, RANGE_NOT_ADMITTED, TM_DIRTY_CITATION } from "./tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = `${"a".repeat(12)}-0001`;
const CASE = "c".repeat(64);

const cite = (path = "src/orders.js", lines = [1, 4], side = "head") => ({ path, side, lines });
const element = (over = {}) => ({ id: "E-001", kind: "process", name: "Checkout API", citation: cite(), ...over });
const mitigation = (over = {}) => ({ id: "M-001", claim: "Server recomputes the total", citation: cite("src/orders.js", [5, 8]), ...over });
const threat = (over = {}) => ({ id: "T-001", element_id: "E-001", stride: "T", title: "Order total tampered", mitigations: [], disposition: { kind: "undisposed" }, ...over });
const model = (over = {}) => ({ elements: [element()], threats: [threat()], ...over });

/** A scope payload: src/orders.js (12 lines) and src/app.js (1 line) at head, whole-file ranges; `dirty` adds a snapshot-side file. */
function scope({ dirty = false } = {}) {
  const files = [
    { path: "src/orders.js", side: "head", oid: "1".repeat(40), file_hmac: "2".repeat(64), lines: 12 },
    { path: "src/app.js", side: "head", oid: "3".repeat(40), file_hmac: "4".repeat(64), lines: 1 },
  ];
  const ranges = { "src/orders.js": [[1, 12]], "src/app.js": [[1, 1]] };
  const snapshot = {};
  if (dirty) {
    files.push({ path: "src/dirty.js", side: "snapshot", oid: "5".repeat(64), file_hmac: "6".repeat(64), lines: 3 });
    ranges["src/dirty.js"] = [[1, 3]];
    snapshot["src/dirty.js"] = { original_hmac: "7".repeat(64), redacted_sha256: "5".repeat(64) };
  }
  return { files, ranges, skipped: [], snapshot };
}

/** Evidence closures that know nothing — every relationship dangles. */
const NONE = Object.freeze({
  proposal: () => false,
  admission: () => false,
  observation: () => false,
  readback: () => false,
  row: () => undefined,
  mitigationState: () => undefined,
});

/** Evidence that validates every kind for the seven-threat model below. */
const ALL = Object.freeze({
  proposal: (id) => id === "P-001",
  admission: (sha) => sha === CASE,
  observation: (id) => id === "O-0123456789ab",
  readback: (threat_id, url) => threat_id === "T-005" && url === "https://github.com/my-org/my-product/issues/9",
  row: (id) => (id === "R-0001" ? { subject: "T-006", status: "accepted" } : null),
  mitigationState: (id) => (id === "M-001" ? MITIGATION_CONFIRMED : undefined),
});

/** One threat per disposition kind (spec §6.10). */
function sevenThreats() {
  return model({
    threats: [
      threat({ id: "T-001" }),
      threat({ id: "T-002", disposition: { kind: "planned", ref: "P-001" } }),
      threat({ id: "T-003", disposition: { kind: "planned", ref: CASE } }),
      threat({ id: "T-004", disposition: { kind: "executed", ref: "O-0123456789ab" } }),
      threat({ id: "T-005", disposition: { kind: "ticketed", ref: "https://github.com/my-org/my-product/issues/9" } }),
      threat({ id: "T-006", disposition: { kind: "accepted", ref: "R-0001" } }),
      threat({ id: "T-007", mitigations: [mitigation()], disposition: { kind: "mitigated", ref: "M-001" } }),
    ],
  });
}

const freeze = (v) => {
  if (Array.isArray(v)) v.forEach(freeze);
  else if (v !== null && typeof v === "object") Object.values(v).forEach(freeze);
  return Object.freeze(v);
};

test("pure: tm-lint-core.mjs imports nothing from node:fs, node:child_process, git.mjs, cite.mjs or a clock", () => {
  const src = readFileSync(join(HERE, "tm-lint-core.mjs"), "utf8");
  for (const banned of ["node:fs", "node:child_process", "git.mjs", 'cite.mjs"', "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!src.includes(banned), `tm-lint-core.mjs must not mention ${banned}`);
  }
  const imports = [...src.matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./cite-core.mjs", "./schema.mjs", "./tokens.mjs"]);
});

test("id shapes and the resolved_via vocabulary are the schema's", () => {
  assert.ok(ELEMENT_ID.test("E-001") && !ELEMENT_ID.test("E-1"));
  assert.ok(THREAT_ID.test("T-999") && !THREAT_ID.test("M-001"));
  assert.ok(MITIGATION_ID.test("M-001") && !MITIGATION_ID.test("T-001"));
  assert.ok(CASE_SHA256.test(CASE) && !CASE_SHA256.test("P-001"));
  const schema = JSON.parse(readFileSync(join(HERE, "..", "..", "references", "threat-model.schema.json"), "utf8"));
  assert.deepEqual([...RESOLVED_VIA], schema.$defs.Dispositions.properties.dispositions.items.properties.resolved_via.enum);
});

// --- structure -------------------------------------------------------------------

test("a valid model passes structure; inputs are never mutated", () => {
  const m = freeze(sevenThreats());
  const s = freeze(scope());
  assert.equal(lintStructure(m, s), null);
  assert.deepEqual(modelCounts(m), { elements: 1, threats: 7, undisposed: 1 });
});

test("element without citation fails naming the element (US-031 AC-2); a schema error under an element or threat names it, a root error names `model`", () => {
  const { citation: _c, ...bare } = element();
  assert.deepEqual(lintStructure(model({ elements: [bare] }), scope()), { locus: "E-001", reason: 'missing required "citation"' });
  // the schema error's path is stripped down to the element / threat it sits under
  assert.deepEqual(lintStructure(model({ elements: [element({ citation: cite("src/orders.js", [1]) })] }), scope()), { locus: "E-001", reason: "citation.lines: 1 items is below minItems 2" });
  assert.deepEqual(lintStructure(model({ threats: [threat({ mitigations: [{ id: "M-001", claim: 7 }] })] }), scope()), { locus: "T-001", reason: "mitigations[0].claim: expected string, got integer" });
  // an element whose id is not a string yet cannot be named by id: positional locus
  assert.deepEqual(lintStructure(model({ elements: [element({ id: 1 })] }), scope()), { locus: "elements[0]", reason: "id: expected string, got integer" });
  assert.deepEqual(lintStructure(model({ threats: [threat({ id: "bad" })] }), scope()), { locus: "threats[0]", reason: "id: does not match pattern ^T-[0-9]{3}$" });
  assert.deepEqual(lintStructure({ elements: [], threats: [], extra: 1 }, scope()), { locus: "model", reason: 'unknown key "extra"' });
  assert.deepEqual(lintStructure({ elements: [] }, scope()), { locus: "model", reason: 'missing required "threats"' });
  assert.deepEqual(lintStructure([], scope()), { locus: "model", reason: "expected object, got array" });
});

test("ids are unique across the model: duplicate element / threat ids name the id; a mitigation id defined twice names the later threat", () => {
  assert.deepEqual(lintStructure(model({ elements: [element(), element({ name: "Again" })] }), scope()), { locus: "E-001", reason: "duplicate id" });
  assert.deepEqual(lintStructure(model({ threats: [threat(), threat({ title: "Again" })] }), scope()), { locus: "T-001", reason: "duplicate id" });
  const twice = model({ threats: [threat({ mitigations: [mitigation()] }), threat({ id: "T-002", mitigations: [mitigation()] })] });
  assert.deepEqual(lintStructure(twice, scope()), { locus: "T-002", reason: "mitigation M-001 is already defined under T-001" });
});

test("blank names are rejected before the renderer can see them (PM log after G14): Element.name, Threat.title, Mitigation.claim", () => {
  assert.deepEqual(lintStructure(model({ elements: [element({ name: "" })] }), scope()), { locus: "E-001", reason: "name is empty" });
  assert.deepEqual(lintStructure(model({ elements: [element({ name: "  \t" })] }), scope()), { locus: "E-001", reason: "name is empty" });
  assert.deepEqual(lintStructure(model({ threats: [threat({ title: "" })] }), scope()), { locus: "T-001", reason: "title is empty" });
  assert.deepEqual(lintStructure(model({ threats: [threat({ mitigations: [mitigation({ claim: " " })] })] }), scope()), { locus: "T-001", reason: "mitigation M-001 claim is empty" });
});

test("a threat must name an element of the model; a disposition ref is required for every kind but undisposed and forbidden for undisposed", () => {
  assert.deepEqual(lintStructure(model({ threats: [threat({ element_id: "E-009" })] }), scope()), { locus: "T-001", reason: "element E-009 is not in the model" });
  assert.deepEqual(lintStructure(model({ threats: [threat({ disposition: { kind: "undisposed", ref: "P-001" } })] }), scope()), { locus: "T-001", reason: "undisposed must not carry a ref" });
  assert.equal(lintStructure(model({ threats: [threat({ disposition: { kind: "undisposed", ref: "" } })] }), scope()), null, "an empty ref on undisposed is what the index writes");
  for (const kind of ["planned", "executed", "ticketed", "accepted", "mitigated"]) {
    assert.deepEqual(lintStructure(model({ threats: [threat({ disposition: { kind } })] }), scope()), { locus: "T-001", reason: `${kind} requires a ref` });
    assert.deepEqual(lintStructure(model({ threats: [threat({ disposition: { kind, ref: "" } })] }), scope()), { locus: "T-001", reason: `${kind} requires a ref` });
  }
});

test("citations go through cite-core.checkRange against the run's scope: its reasons, on elements and on mitigations (named through their threat)", () => {
  const bad = (citation) => lintStructure(model({ elements: [element({ citation })] }), scope());
  assert.deepEqual(bad(cite("src/orders.js", [4, 1])), { locus: "E-001", reason: `citation src/orders.js:4-1 @ head: ${RANGE_INVALID}` });
  assert.equal(bad(cite("src/orders.js", [1, 12])), null, "the whole admitted range is inside");
  assert.deepEqual(bad(cite("src/nope.js", [1, 1])), { locus: "E-001", reason: `citation src/nope.js:1-1 @ head: ${PATH_NOT_IN_SCOPE}` });
  assert.deepEqual(bad(cite("src/orders.js", [1, 13])), { locus: "E-001", reason: `citation src/orders.js:1-13 @ head: ${RANGE_NOT_ADMITTED}` });
  const mBad = lintStructure(model({ threats: [threat({ mitigations: [mitigation({ citation: cite("src/nope.js", [1, 1]) })] })] }), scope());
  assert.deepEqual(mBad, { locus: "T-001", reason: `mitigation M-001 citation src/nope.js:1-1 @ head: ${PATH_NOT_IN_SCOPE}` });
  const { citation: _mc, ...claimOnly } = mitigation();
  assert.equal(lintStructure(model({ threats: [threat({ mitigations: [claimOnly] })] }), scope()), null, "a mitigation citation is optional (a claim without code)");
});

test("a `base` citation on a scope file is admitted (deleted code has no side to match); the range rule still applies", () => {
  assert.equal(lintStructure(model({ elements: [element({ citation: cite("src/orders.js", [2, 2], "base") })] }), scope()), null);
  assert.deepEqual(lintStructure(model({ elements: [element({ citation: cite("src/orders.js", [1, 41], "base") })] }), scope()), { locus: "E-001", reason: "citation src/orders.js:1-41 @ base: RANGE-TOO-LONG" });
});

test("PM ruling R2: a citation on a file the run recorded at `snapshot` (dirty) ⇒ the verbatim dirty reason, before any range rule", () => {
  const dirty = scope({ dirty: true });
  assert.deepEqual(lintStructure(model({ elements: [element({ citation: cite("src/dirty.js", [1, 2]) })] }), dirty), { locus: "E-001", reason: TM_DIRTY_CITATION });
  assert.deepEqual(lintStructure(model({ elements: [element({ citation: cite("src/dirty.js", [9, 1]) })] }), dirty), { locus: "E-001", reason: TM_DIRTY_CITATION }, "dirty wins over RANGE-INVALID");
  assert.deepEqual(lintStructure(model({ threats: [threat({ mitigations: [mitigation({ citation: cite("src/dirty.js", [1, 1]) })] })] }), dirty), { locus: "T-001", reason: `mitigation M-001 ${TM_DIRTY_CITATION}` });
  assert.equal(TM_DIRTY_CITATION, "cites a dirty file; build the model on an assessment run");
});

test("structure runs in model order: the first failure wins (schema, then ids, names, references, dispositions, citations)", () => {
  const m = model({ elements: [element({ name: "" }), element({ id: "E-002", citation: cite("src/nope.js", [1, 1]) })], threats: [threat({ element_id: "E-009" })] });
  assert.deepEqual(lintStructure(m, scope()), { locus: "E-001", reason: "name is empty" });
  assert.throws(() => lintStructure(model(), null), TypeError);
});

// --- dispositions ------------------------------------------------------------------

test("one threat per disposition value validates; the index carries one row per threat, `resolved_via` naming what validated it, `none` for undisposed (US-031 AC-3)", () => {
  const m = freeze(sevenThreats());
  const { error, dispositions } = lintDispositions(m, ALL);
  assert.equal(error, null);
  assert.deepEqual(dispositions, [
    { threat_id: "T-001", kind: "undisposed", ref: "", resolved_via: "none" },
    { threat_id: "T-002", kind: "planned", ref: "P-001", resolved_via: "proposal" },
    { threat_id: "T-003", kind: "planned", ref: CASE, resolved_via: "admission" },
    { threat_id: "T-004", kind: "executed", ref: "O-0123456789ab", resolved_via: "observation" },
    { threat_id: "T-005", kind: "ticketed", ref: "https://github.com/my-org/my-product/issues/9", resolved_via: "tracker-readback" },
    { threat_id: "T-006", kind: "accepted", ref: "R-0001", resolved_via: "register-row" },
    { threat_id: "T-007", kind: "mitigated", ref: "M-001", resolved_via: "receipt" },
  ]);
  assert.deepEqual(validate("dispositions", { dispositions }), []);
});

test("a dangling reference fails with the threat id and the missing relationship (US-031 AC-3) — one wording per kind", () => {
  const one = (disposition, evidence = NONE, extra = {}) => lintDispositions(model({ threats: [threat({ disposition, ...extra })] }), evidence);
  assert.deepEqual(one({ kind: "planned", ref: "P-009" }), { error: { locus: "T-001", reason: "planned(P-009): proposal P-009 is not in proposals-index.json" }, dispositions: [] });
  assert.deepEqual(one({ kind: "planned", ref: CASE }).error, { locus: "T-001", reason: `planned(${CASE}): no admission record admissions/${CASE}.json` });
  assert.deepEqual(one({ kind: "executed", ref: "O-000000000000" }).error, { locus: "T-001", reason: "executed(O-000000000000): no observation observations/O-000000000000.json" });
  assert.deepEqual(one({ kind: "ticketed", ref: "https://github.com/x/y/issues/1" }).error, { locus: "T-001", reason: "ticketed(https://github.com/x/y/issues/1): no tracker-readback record shows a ticket body at that url carrying T-001" });
  assert.deepEqual(one({ kind: "accepted", ref: "R-0001" }).error, { locus: "T-001", reason: "accepted(R-0001): register-events.json is not in the run (run snapshot register)" });
  assert.deepEqual(one({ kind: "accepted", ref: "R-0001" }, { ...NONE, row: () => null }).error, { locus: "T-001", reason: "accepted(R-0001): row R-0001 is not in the register snapshot" });
  assert.deepEqual(one({ kind: "accepted", ref: "R-0001" }, { ...NONE, row: () => ({ subject: "T-002", status: "accepted" }) }).error, { locus: "T-001", reason: "accepted(R-0001): row R-0001 subject is T-002, not T-001" });
  assert.deepEqual(one({ kind: "accepted", ref: "R-0001" }, { ...NONE, row: () => ({ subject: "T-001", status: "open" }) }).error, { locus: "T-001", reason: "accepted(R-0001): row R-0001 status is open, not accepted" });
  assert.deepEqual(one({ kind: "mitigated", ref: "M-001" }).error, { locus: "T-001", reason: "mitigated(M-001): M-001 is not a mitigation of T-001" });
  assert.deepEqual(one({ kind: "mitigated", ref: "M-001" }, NONE, { mitigations: [mitigation()] }).error, { locus: "T-001", reason: "mitigated(M-001): M-001 has no MITIGATION_CONFIRMED state (not independently reviewed)" });
  assert.deepEqual(one({ kind: "mitigated", ref: "M-001" }, { ...NONE, mitigationState: () => MITIGATION_GAP }, { mitigations: [mitigation()] }).error, { locus: "T-001", reason: "mitigated(M-001): M-001 has no MITIGATION_CONFIRMED state (MITIGATION_GAP)" });
});

test("dispositions stop at the first failing threat in model order; the closures see only the refs the model names", () => {
  const seen = [];
  const spy = { ...ALL, proposal: (id) => (seen.push(id), false) };
  const { error } = lintDispositions(sevenThreats(), spy);
  assert.deepEqual(error, { locus: "T-002", reason: "planned(P-001): proposal P-001 is not in proposals-index.json" });
  assert.deepEqual(seen, ["P-001"]);
  assert.throws(() => lintDispositions(model(), {}), TypeError, "every closure is required");
});

// --- render ---------------------------------------------------------------------

test("renderThreatModel: Markdown from the JSON model (D14) — elements, threats, mitigations with derived states, dispositions; deterministic; blanks are the report tokens", () => {
  const m = sevenThreats();
  const { dispositions } = lintDispositions(m, ALL);
  const md = renderThreatModel({ run_id: RUN, model: m, dispositions, mitigation_states: { "M-001": MITIGATION_CONFIRMED } });
  assert.equal(md, renderThreatModel({ run_id: RUN, model: structuredClone(m), dispositions: structuredClone(dispositions), mitigation_states: { "M-001": MITIGATION_CONFIRMED } }));
  assert.match(md, new RegExp(`^# Threat model — run ${RUN}$`, "m"));
  assert.match(md, /^elements=1 threats=7 undisposed=1$/m);
  for (const h of ["## Elements", "## Threats", "## Mitigations (claims)", "## Dispositions"]) assert.ok(md.includes(`\n${h}\n`), h);
  assert.match(md, /^\| E-001 \| process \| Checkout API \| src\/orders\.js:1-4 @ head \|$/m);
  assert.match(md, /^\| T-007 \| E-001 \| T \| Order total tampered \| mitigated \(M-001\) \| M-001 \|$/m);
  assert.match(md, /^\| T-001 \| E-001 \| T \| Order total tampered \| undisposed \| unknown \/ not assessed \|$/m);
  assert.match(md, /^\| M-001 \| T-007 \| Server recomputes the total \| src\/orders\.js:5-8 @ head \| MITIGATION_CONFIRMED \|$/m);
  assert.match(md, new RegExp(`^\\| T-001 \\| undisposed \\| ${NOT_ASSESSED.replace("/", "\\/")} \\| none \\|$`, "m"));
  assert.match(md, /^\| T-006 \| accepted \| R-0001 \| register-row \|$/m);
  assert.ok(md.endsWith("\n"));
  // no mitigation-review receipt ⇒ the report's wording, never a blank cell
  const bare = renderThreatModel({ run_id: RUN, model: m, dispositions, mitigation_states: {} });
  assert.match(bare, new RegExp(`^\\| M-001 \\| T-007 \\| Server recomputes the total \\| src\\/orders\\.js:5-8 @ head \\| ${NOT_INDEPENDENTLY_REVIEWED} \\|$`, "m"));
  assert.ok(!/\|[ \t]*\|/.test(bare), "no empty cell");
  // an empty model renders the `(none)` placeholders
  const empty = renderThreatModel({ run_id: RUN, model: { elements: [], threats: [] }, dispositions: [], mitigation_states: {} });
  assert.equal((empty.match(/^\(none\)$/gm) ?? []).length, 4);
  // table cells never break the table: pipes and newlines in prose are escaped
  const odd = renderThreatModel({ run_id: RUN, model: model({ elements: [element({ name: "a|b\nc" })] }), dispositions: [{ threat_id: "T-001", kind: "undisposed", ref: "", resolved_via: "none" }], mitigation_states: {} });
  assert.match(odd, /^\| E-001 \| process \| a\\\|b c \| src\/orders\.js:1-4 @ head \|$/m);
});

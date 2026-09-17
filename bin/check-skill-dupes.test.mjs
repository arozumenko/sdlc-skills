// TASK-051 (US-045): the `execution-authorization` design note ships as an
// identical copy in both QA bundles (spec §5 v2 row: "receiving-side, owned by
// the QA bundles"; ownership is spec §14 open question 5, so neither copy is
// the owner yet). Two copies are a drift risk; check-skill-dupes.mjs pays for
// it. These tests pin the pair's registration and the note's contract:
// AC-1 placement + "active testing out of scope, proposals never enter
// tasks/"; AC-2 the proposal fields, the `authorization` fields, and
// `authenticated: false` like every other approval (D15, G-8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = "bundles/manual-qa/docs/execution-authorization.md";
const COPY = "bundles/test-automation/docs/execution-authorization.md";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("TASK-051: the note exists in both QA bundles and the copies are byte-identical", () => {
  const a = readFileSync(join(ROOT, CANONICAL));
  const b = readFileSync(join(ROOT, COPY));
  assert.ok(a.length > 0, `${CANONICAL} is empty`);
  assert.ok(a.equals(b), `${COPY} differs from ${CANONICAL}`);
});

test("TASK-051 AC-1: until the skill exists, active testing is out of scope and proposals never enter tasks/", () => {
  const text = read(CANONICAL);
  assert.match(text, /out of scope/, "must state active testing is out of scope");
  assert.match(text, /never enters? `tasks\/`/, "must state proposals never enter tasks/");
  assert.match(text, /tasks\/security-<slug>-admitted\//, "must name the admitted suite it guards");
});

test("TASK-051 AC-2: describes the merged proposal record, its authorization fields, and authenticated: false", () => {
  const text = read(CANONICAL);
  // the proposal record the preflight would consume — the merged TASK-042 shape
  for (const field of ["`id`", "`title`", "`threat_ids`", "`effect`", "`target`", "`authorization`", "`steps`"]) {
    assert.ok(text.includes(field), `proposal field ${field} not described`);
  }
  assert.match(text, /```json proposal/, "must name the fenced json proposal block plan.mjs propose parses");
  assert.match(text, /proposal\.schema\.json/, "must point at the schema in security-evidence");
  // the authorization fields, with their fixed values
  for (const field of ["`status`", "`approver`", "`approval_ref`", "`authenticated`"]) {
    assert.ok(text.includes(field), `authorization field ${field} not described`);
  }
  assert.match(text, /`status`[^\n]*`proposed`/, "status is the constant `proposed`");
  assert.match(text, /authenticated: false/, "the record is stored authenticated: false");
  assert.match(text, /no confirmed state/i, "must say there is no confirmed state (D15)");
  // G-8: never even in prose
  assert.doesNotMatch(text, /authenticated: true/, "G-8: no `authenticated: true` anywhere");
});

test("TASK-051: check-skill-dupes.mjs registers the pair as a group", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "bin/check-skill-dupes.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, `check-skill-dupes.mjs failed:\n${r.stderr}`);
  assert.ok(r.stdout.includes(`✓ ${COPY} matches ${CANONICAL}`), `group not registered; stdout:\n${r.stdout}`);
});

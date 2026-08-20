import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, checkFactoryFrontmatter } from "./validate-factories.mjs";

test("parses block lists into arrays", () => {
  const fm = parseFrontmatter(`---\nname: X\nauthors:\n  - "A <a@epam.com>"\n  - "B <b@epam.com>"\n---\n`);
  assert.deepEqual(fm.authors, ["A <a@epam.com>", "B <b@epam.com>"]);
});

test("parses object list entries for project_deployments", () => {
  const fm = parseFrontmatter(`---\nname: X\nproject_deployments:\n  - project_code: EPM-EASE\n  - EPM-CDME\n---\n`);
  assert.deepEqual(fm.project_deployments, [{ project_code: "EPM-EASE" }, "EPM-CDME"]);
});

test("preserves explicit empty list as ND sentinel", () => {
  const fm = parseFrontmatter(`---\nname: X\nproject_deployments: []\n---\n`);
  assert.deepEqual(fm.project_deployments, []);
});

test("rejects invalid support_level", () => {
  const errs = checkFactoryFrontmatter("t", { name: "X", description: "d", owner: "o", authors: ["a"], sdlc_phase: "P", support_level: "self-serve" });
  assert.ok(errs.some((e) => /support_level/.test(e)));
});

test("rejects sdlc_phase with a comma list", () => {
  const errs = checkFactoryFrontmatter("t", { name: "X", description: "d", owner: "o", authors: ["a"], sdlc_phase: "A, B" });
  assert.ok(errs.some((e) => /sdlc_phase/.test(e)));
});

test("flags an unquoted colon value as risky", () => {
  // raw line form is what the risk check inspects
  const errs = checkFactoryFrontmatter("t", { name: "X", description: "d", owner: "o", authors: ["a"], sdlc_phase: "P" }, [`description: Workflow: plan`]);
  assert.ok(errs.some((e) => /quote|colon/i.test(e)));
});

test("requires name/description/owner/authors/sdlc_phase", () => {
  const errs = checkFactoryFrontmatter("t", { name: "X" });
  for (const k of ["description", "owner", "authors", "sdlc_phase"]) {
    assert.ok(errs.some((e) => e.includes(k)), `missing check for ${k}`);
  }
});

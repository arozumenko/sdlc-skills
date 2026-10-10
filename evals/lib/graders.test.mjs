// Grader self-tests: for every case with a selftest.mjs, build the fixture
// (without installing the factory), apply each simulated outcome, run the real
// grader and assert it passes or fails as declared. No model calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareWorkspace, runGrader } from "./trial.mjs";
import { loadCases } from "../run.mjs";

const SUITE = join(dirname(fileURLToPath(import.meta.url)), "..", "feature-development");

for (const { dir, spec } of loadCases(SUITE)) {
  const st = join(dir, "selftest.mjs");
  if (!existsSync(st)) continue;
  const { scenarios } = await import(pathToFileURL(st).href);
  for (const sc of scenarios) {
    test(`${spec.id}: ${sc.name} -> ${sc.shouldPass ? "pass" : "fail"}`, () => {
      const s = { ...spec, ...(sc.expect ? { expect: sc.expect } : {}), ...(sc.fixtureArgs ? { fixtureArgs: sc.fixtureArgs } : {}) };
      const ws = prepareWorkspace(dir, s, { install: false });
      const trialDir = mkdtempSync(join(tmpdir(), "fd-eval-selftest-"));
      sc.act(ws.work, trialDir);
      const g = runGrader(dir, s, ws, trialDir);
      const failed = (g.checks || []).filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
      assert.equal(g.pass, sc.shouldPass, `grader ${g.pass ? "passed" : "failed"}; failing checks: ${failed.join(" | ") || "none"}`);
    });
  }
}

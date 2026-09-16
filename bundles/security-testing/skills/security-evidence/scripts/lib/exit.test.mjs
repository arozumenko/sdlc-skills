import { test } from "node:test";
import assert from "node:assert/strict";
import { CanonError, IntegrityError } from "../canon.mjs";
import { CliError, EXIT, exitCodeFor, integrityFailure, isIntegrityFailure, usageError } from "./exit.mjs";

test("EXIT is the closed map 0..5", () => {
  assert.deepEqual(EXIT, { OK: 0, INTERNAL: 1, USAGE: 2, INDETERMINATE: 3, FAIL: 4, INTEGRITY: 5 });
  assert.ok(Object.isFrozen(EXIT));
});

test("CliError carries code and token; message is the token; code must be 2..5", () => {
  const e = new CliError(3, "INCOMPLETE(scope)");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "CliError");
  assert.equal(e.code, 3);
  assert.equal(e.token, "INCOMPLETE(scope)");
  assert.equal(e.message, "INCOMPLETE(scope)");
  const cause = new Error("root");
  assert.equal(new CliError(5, "CORRUPT", { cause }).cause, cause);
  for (const bad of [0, 1, 6, "2", undefined]) assert.throws(() => new CliError(bad, "X"), /code/);
  assert.throws(() => new CliError(2, ""), /token/);
  assert.throws(() => new CliError(2, "two\nlines"), /token/);
});

test("check/exit-5 rule: CanonError and IntegrityError from readArtifact are both integrity failures", () => {
  assert.equal(isIntegrityFailure(new IntegrityError("/p", "self_sha256 mismatch")), true);
  assert.equal(isIntegrityFailure(new CanonError("duplicate key", { path: "/p" })), true);
  // a same-named error from another module instance still classifies
  const alien = Object.assign(new Error("x"), { name: "CanonError" });
  assert.equal(isIntegrityFailure(alien), true);
  assert.equal(isIntegrityFailure(new Error("boom")), false);
  assert.equal(isIntegrityFailure(new CliError(4, "GAP(x)")), false);
  assert.equal(isIntegrityFailure(null), false);
});

test("exitCodeFor: CliError ⇒ its code, integrity failure ⇒ 5, anything else ⇒ 1", () => {
  assert.equal(exitCodeFor(new CliError(4, "TRACKED(x)")), 4);
  assert.equal(exitCodeFor(new IntegrityError("/p", "bad")), 5);
  assert.equal(exitCodeFor(new CanonError("float not allowed")), 5);
  assert.equal(exitCodeFor(new TypeError("x")), 1);
  assert.equal(exitCodeFor("string"), 1);
});

test("usageError and integrityFailure build the conventional CliErrors", () => {
  const u = usageError("check", "--run <id> is required");
  assert.equal(u.code, 2);
  assert.equal(u.token, "USAGE(check: --run <id> is required)");
  const cause = new IntegrityError("/p", "bad");
  const i = integrityFailure("INCONSISTENT(gate-result)", cause);
  assert.equal(i.code, 5);
  assert.equal(i.token, "INCONSISTENT(gate-result)");
  assert.equal(i.cause, cause);
});

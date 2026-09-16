// TASK-028 — register.mjs's usage text is built from tokens.mjs rows (G-13),
// so the exit-code line can never drift from what the commands print.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import { redactString } from "../redact.mjs";
import { USAGE } from "./register-usage.mjs";
import { ANCHOR_DIVERGED, ANCHOR_MATCH, ANCHOR_TRUNCATED, CORRUPT, EQUIVALENCE_REQUIRED, transitionRejected } from "./tokens.mjs";

test("USAGE starts with the usage line, ends with a newline, and spells its result tokens from tokens.mjs", () => {
  assert.match(USAGE, /^usage: register\.mjs \[--root <dir>\] \[--actor <name>\] \[--quiet\] <command> \[flags\]\n/);
  assert.ok(USAGE.endsWith("\n"));
  for (const token of [EQUIVALENCE_REQUIRED, transitionRejected("<event>", "<from>"), CORRUPT, `${ANCHOR_MATCH} | ${ANCHOR_TRUNCATED} | ${ANCHOR_DIVERGED}`]) {
    assert.ok(USAGE.includes(token), `usage names ${token}`);
  }
  assert.match(USAGE, /neither flag/, "supersede with neither flag ⇒ EQUIVALENCE-REQUIRED (PM log, after G3)");
  // TASK-029 rows
  assert.ok(USAGE.includes("EMITTER-ONLY(<event>)"), "transition refuses emitter-only events");
  assert.ok(USAGE.includes("NOT-EQUIVALENT(<R-id>: <R-id>)"), "--subject-equivalent without a link");
  assert.match(USAGE, /authenticated: false/, "D15: the usage says what an approval record is");
  assert.doesNotMatch(USAGE, /authenticated: true/);
  assert.match(USAGE, /exit codes\s+0 ok · 2 usage/);
  assert.match(USAGE, /· 5 CORRUPT/);
});

test("the usage lists every §4.3 verb and never the forbidden one", () => {
  for (const verb of ["add", "accept", "revoke", "check", "close-false-positive", "reopen", "supersede", "alias", "consume-verdict", "render", "transition", "status", "replay", "anchor print", "anchor verify"]) {
    assert.match(USAGE, new RegExp(`^  ${verb.replace(/[-|]/g, "\\$&")}\\b`, "m"), verb);
  }
  assert.doesNotMatch(USAGE, /\bconfirm\b/, "D15 / US-021 AC-2");
});

test("no redaction rule fires on the usage text (G-4 stays absolute; reword rather than exempt)", () => {
  assert.equal(redactString(USAGE).text, USAGE);
});

test("register.mjs imports USAGE from lib/register-usage.mjs and carries no literal of its own", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "register.mjs"), "utf8");
  assert.match(src, /import \{ USAGE \} from "\.\/lib\/register-usage\.mjs"/);
  assert.doesNotMatch(src, /^const USAGE = `/m);
});

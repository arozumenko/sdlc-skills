// TASK-045 — `lib/fix-prompt.mjs`, the `fix_prompt` generator of the tracker
// payload (spec §6.9 "tracker (… fix_prompt)", §9.4 / P4; plan §5 TASK-045:
// "routes to bugfix-workflow with finding id, context_redacted, and the exact
// verify.mjs all --finding <id> --base <oid> --head <oid> command the
// developer must report back"; US-039 AC-4). Replaces TASK-031's
// `fixPromptStub` in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactString } from "../redact.mjs";
import { FIX_SKILL, fixPrompt, verifyCommand } from "./fix-prompt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ID = "3f9a".padEnd(64, "b");
const BASE = "0123456789abcdef0123456789abcdef01234567";
const input = (over = {}) => ({ finding_id: ID, class: "injection", priority: "p1", path: "src/db.js", lines: [3, 4], context_redacted: "User input reaches the query string.", base_oid: BASE, ...over });

test("fix-prompt is a pure leaf: no fs, no child process, no git, no network, no clock (G-9, G-14)", () => {
  const src = readFileSync(join(HERE, "fix-prompt.mjs"), "utf8");
  assert.doesNotMatch(src, /from "node:(fs|child_process|http|https|net|dns)"/);
  assert.doesNotMatch(src, /\.\/git\.mjs|\.\/fsx\.mjs|fetch\(/);
  assert.doesNotMatch(src, /Date\.now|new Date/);
  assert.doesNotMatch(src, /console\.(log|error)/);
});

test("verifyCommand: exactly `verify.mjs all --finding <id> --base <oid> --head <fix-commit>`", () => {
  assert.equal(verifyCommand({ finding_id: ID, base_oid: BASE }), `verify.mjs all --finding ${ID} --base ${BASE} --head <fix-commit>`);
  assert.throws(() => verifyCommand({ finding_id: "R-0001", base_oid: BASE }), /finding_id/);
  assert.throws(() => verifyCommand({ finding_id: ID, base_oid: "HEAD" }), /base_oid/);
});

test("fixPrompt routes to bugfix-workflow with the id, the range, context_redacted and the exact verify command (US-039 AC-4)", () => {
  assert.equal(FIX_SKILL, "bugfix-workflow");
  const text = fixPrompt(input());
  assert.equal(typeof text, "string");
  assert.match(text, /bugfix-workflow/, "names the skill the developer loads");
  assert.ok(text.includes(ID), "names the finding id");
  assert.match(text, /injection/);
  assert.match(text, /\bp1\b/);
  assert.match(text, /src\/db\.js:3-4/, "path:start-end, the citation the developer works at");
  assert.ok(text.includes("User input reaches the query string."), "context_redacted is the one description the developer gets");
  assert.ok(text.includes(verifyCommand({ finding_id: ID, base_oid: BASE })), "the exact command to report back with");
  assert.match(text, /--base/);
  assert.match(text, /<fix-commit>/, "the head is the developer's fix commit, unknown here");
  assert.match(text, /never edit tests, ignore files or suppression config/i, "the suppression rule the verify step enforces");
  assert.match(text, /report back/i);
  assert.doesNotMatch(text, /UNGATED|exact checkout/, "G-13 forbidden strings");
});

test("fixPrompt is deterministic, one paragraph per line (LF only), and a second redaction pass is a no-op (G-4)", () => {
  const a = fixPrompt(input());
  const b = fixPrompt(input());
  assert.equal(a, b);
  assert.doesNotMatch(a, /\r/);
  assert.ok(!a.startsWith("\n") && !a.endsWith("\n"));
  assert.equal(redactString(a).text, a, "the prompt is built from redacted inputs and adds nothing a rule matches");
  // context_redacted arrives redacted; the prompt carries it verbatim, never re-derives from a snippet
  const redacted = fixPrompt(input({ context_redacted: "// <REDACTED:password-assign>\n\nA credential is committed next to the query." }));
  assert.ok(redacted.includes("// <REDACTED:password-assign>\n\nA credential is committed next to the query."));
  assert.ok(!redacted.includes("password=1234"));
});

test("fixPrompt refuses malformed input rather than emitting a prompt with a hole in it", () => {
  assert.throws(() => fixPrompt(input({ finding_id: "x" })), /finding_id/);
  assert.throws(() => fixPrompt(input({ base_oid: "abc" })), /base_oid/);
  assert.throws(() => fixPrompt(input({ lines: [3] })), /lines/);
  assert.throws(() => fixPrompt(input({ lines: [4, 3] })), /lines/);
  assert.throws(() => fixPrompt(input({ path: "" })), /path/);
  assert.throws(() => fixPrompt(input({ class: 7 })), /class/);
  assert.throws(() => fixPrompt(input({ priority: "high" })), /priority/);
  assert.throws(() => fixPrompt(input({ context_redacted: "" })), /context_redacted/);
  assert.throws(() => fixPrompt(input({ context_redacted: undefined })), /context_redacted/);
  assert.throws(() => fixPrompt(null), /TypeError|object/);
});

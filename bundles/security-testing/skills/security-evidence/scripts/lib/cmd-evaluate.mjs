// lib/cmd-evaluate.mjs — `verify.mjs evaluate <verify.json> | --raw <json>`
// (TASK-026; plan §4.2 row `evaluate`, TL-1 `run(argv, ctx) → Promise<number>`).
//
// Pure over its input: no git, no fs beyond reading the one file named on the
// command line, no clock. The file is resolved through `ctx.input()` (TASK-027,
// PM log after G3): cwd-relative like every other user-typed path, and it must
// lie inside the work tree — outside ⇒ 2 USAGE(evaluate: cannot read <p>
// (outside the work tree)); a relative path behaves as before. Prints `evaluate()` of the payload as one JSON line
// (`{verdict, refound_observed, ack_refs, events}`) through `ctx.out` and
// returns 0. A `verify.json` is read with canon.readArtifact — kind `verify`,
// self_sha256 recomputed — and its stored `evaluation` is stripped before
// evaluating, so the printed result is always a fresh derivation (consume-
// verdict and check are the commands that compare it with what is stored).
//
// Exit codes (lib/exit.mjs EXIT map, spelled as literals until TASK-006 lands):
//   0 verdict printed · 2 usage / malformed input · 5 the file is not the
//   artifact it claims to be (IntegrityError: shape, kind or hash).
// Failure diagnostics go to `ctx.log` (stderr); stdout carries nothing then.

import { CanonError, IntegrityError, parseStrict, readArtifact } from "../canon.mjs";
import { evaluate } from "./evaluate.mjs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_INTEGRITY = 5;

export const USAGE = [
  "usage: verify.mjs evaluate <verify.json>",
  "       verify.mjs evaluate --raw <json>",
  "",
  "Pure: prints {verdict, refound_observed, ack_refs, events} for the raw results.",
  "<verify.json> is an enveloped artifact (kind verify); its stored evaluation is ignored.",
  "--raw takes the verify payload (minus evaluation) inline.",
].join("\n");

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @param {string[]} argv arguments after `evaluate`
 * @param {{out: (line: string) => void, log: (line: string) => void, input: (command: string, p: string) => string}} ctx
 * @returns {Promise<number>} exit code
 */
export async function run(argv, ctx) {
  const fail = (message) => {
    ctx.log(`evaluate: ${message}`);
    return EXIT_USAGE;
  };

  let rawText;
  let file;
  let typed;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      ctx.out(USAGE);
      return EXIT_OK;
    }
    if (a === "--raw") {
      if (rawText !== undefined) return fail("--raw given twice");
      if (i + 1 >= argv.length) return fail("--raw needs a JSON argument");
      rawText = argv[++i];
      continue;
    }
    if (a.startsWith("-")) return fail(`unknown flag ${a}\n${USAGE}`);
    positional.push(a);
  }
  if (rawText !== undefined && positional.length > 0) return fail("give either <verify.json> or --raw, not both");
  if (positional.length > 1) return fail(`unexpected argument ${positional[1]}`);
  if (rawText === undefined && positional.length === 0) return fail(`missing input\n${USAGE}`);
  if (positional.length === 1) {
    typed = positional[0];
    file = ctx.input("evaluate", typed);
  }

  let raw;
  if (rawText !== undefined) {
    let parsed;
    try {
      parsed = parseStrict(rawText);
    } catch (err) {
      if (err instanceof CanonError) return fail(`--raw is not strict JSON: ${err.message}`);
      throw err;
    }
    if (!isObject(parsed)) return fail("--raw must be a JSON object (the verify payload minus evaluation)");
    raw = parsed;
  } else {
    let artifact;
    try {
      artifact = readArtifact(file, { kind: "verify" });
    } catch (err) {
      if (err instanceof CanonError) return fail(`${typed}: ${err.message}`);
      if (err instanceof IntegrityError) {
        // A kind or self_sha256 mismatch carries `expected`: the file claims to
        // be an artifact and is not — integrity. A shape failure (no envelope,
        // a payload-only file) is malformed input.
        if (err.expected === undefined) return fail(`${typed}: not a verify artifact: ${err.reason}`);
        ctx.log(`evaluate: ${err.message}`);
        return EXIT_INTEGRITY;
      }
      if (err && err.code === "ENOENT") return fail(`${typed}: no such file`);
      if (err && (err.code === "EISDIR" || err.code === "EACCES")) return fail(`${typed}: ${err.code}`);
      throw err;
    }
    raw = artifact.payload;
  }

  // The stored evaluation (if any) is never an input: strip it so the output
  // is the fresh derivation of everything else.
  const { evaluation: _stored, ...rest } = raw;
  const result = evaluate(rest);
  ctx.out(JSON.stringify(result));
  return EXIT_OK;
}

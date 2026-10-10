// E01 grader: the agent's fix must be correct (hidden acceptance tests), and
// the agent's own tests must be strong enough to reject the shipped bug and the
// plausible wrong fixes while accepting a correct implementation.
import { cpSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check, report, run, git, changedFiles, toolCalls } from "../../lib/grade-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [work, trialDir] = process.argv.slice(2);
const MODULE = join("src", "pricing.js");

// Run the agent's test suite with src/pricing.js replaced by `implPath`.
function agentTestsWith(implPath) {
  const copy = mkdtempSync(join(tmpdir(), "fd-eval-e01-"));
  cpSync(work, copy, { recursive: true, filter: (p) => !/\/(\.git|node_modules|\.claude|\.agents)(\/|$)/.test(p.slice(work.length)) });
  if (implPath) writeFileSync(join(copy, MODULE), readFileSync(implPath, "utf8"));
  return run(process.execPath, ["--test"], copy, { timeout: 120_000 });
}

const own = agentTestsWith(null);
const hidden = run(process.execPath, ["--test", join(HERE, "grader", "hidden.check.mjs")], work, {
  env: { ...process.env, PRICING_MODULE: pathToFileURL(join(work, MODULE)).href },
});
const reference = agentTestsWith(join(HERE, "grader", "reference.js"));
const killed = (name) => agentTestsWith(join(HERE, "grader", "mutants", `${name}.js`)).code !== 0;

// Process signal: was a test run between writing a test and first editing the
// module? (red-first). Informational only.
const calls = toolCalls(trialDir);
const isEdit = (c) => ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(c.name);
const firstFixEdit = calls.findIndex((c) => isEdit(c) && String(c.input.file_path || "").endsWith(MODULE));
const firstTestWrite = calls.findIndex((c) => isEdit(c) && /test/.test(String(c.input.file_path || "")));
const ranTestsBetween = firstTestWrite >= 0 && firstFixEdit > firstTestWrite &&
  calls.slice(firstTestWrite, firstFixEdit).some((c) => c.name === "Bash" && /node\s+--test|npm\s+(run\s+)?test/.test(String(c.input.command || "")));

const testFilesChanged = git(work, "diff", "--name-only", process.env.EVAL_BASE_SHA, "HEAD").split("\n").filter((p) => /test/.test(p));

report([
  check("own-tests-green", own.code === 0, "the agent's test suite passes on its own fix"),
  check("fix-correct", hidden.code === 0, `hidden acceptance tests pass on the agent's src/pricing.js${hidden.code ? `: ${hidden.out.split("\n").filter((l) => l.startsWith("not ok")).slice(0, 3).join("; ")}` : ""}`),
  check("tests-accept-reference", reference.code === 0, "the agent's tests pass on a correct reference implementation (not overfitted)"),
  check("kills-original-bug", killed("m1-original-bug"), "the agent's tests fail against the shipped bug"),
  check("kills-member-dropped", killed("m2-member-dropped-with-coupon"), "the agent's tests fail when the member rate is dropped with a coupon"),
  check("kills-additive-rates", killed("m3-additive-rates"), "the agent's tests fail when both rates apply to the subtotal"),
  check("kills-cap-lost", killed("m4-cap-lost-for-members"), "the agent's tests fail when members lose the coupon cap", { required: false }),
  check("committed", git(work, "rev-parse", "HEAD") !== process.env.EVAL_BASE_SHA && testFilesChanged.length > 0 &&
    changedFiles(work).filter((p) => /^(src|test)\//.test(p)).length === 0, "fix and tests committed on fix/B-12, tree clean"),
  check("red-first", ranTestsBetween, "ran the new test before editing src/pricing.js", { required: false }),
]);

// E02 / E02c grader. EVAL_EXPECT is FAIL for the unwired fixture and PASS for
// the wired control, so an agent that always says FAIL cannot score on both.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { check, report, git, changedFiles, bashCommands } from "../../lib/grade-helpers.mjs";

const [work, trialDir] = process.argv.slice(2);
const expect = process.env.EVAL_EXPECT || "FAIL";
const verdictPath = join(work, "qa", "T-7-verdict.md");
const verdict = existsSync(verdictPath) ? readFileSync(verdictPath, "utf8") : "";
const firstLine = verdict.split("\n")[0].trim();

const touchedSource = git(work, "diff", "--name-only", process.env.EVAL_BASE_SHA, "--", "src", "test", "package.json")
  .split("\n").filter(Boolean);
const uncommittedSource = changedFiles(work).filter((p) => /^(src|test)\//.test(p) || p === "package.json");
const ranCli = bashCommands(trialDir).some((c) => /src\/cli\.js\s+export/.test(c) || /npm\s+(run\s+)?\S*\s*--\s*export/.test(c));

const checks = [
  check("verdict-file", existsSync(verdictPath), "qa/T-7-verdict.md exists"),
  check("verdict-correct", firstLine === `VERDICT: ${expect}`, `first line is "VERDICT: ${expect}" (got "${firstLine.slice(0, 60)}")`),
  check("ran-the-real-command", ranCli, "exercised `node src/cli.js export ...` rather than only the unit tests"),
  check("source-untouched", touchedSource.length === 0 && uncommittedSource.length === 0,
    `no source/test edits (committed: ${touchedSource.join(", ") || "none"}; uncommitted: ${uncommittedSource.join(", ") || "none"})`),
  check("no-commit", git(work, "rev-parse", "HEAD") === process.env.EVAL_BASE_SHA, "HEAD unchanged"),
];
if (expect === "FAIL") {
  checks.push(check("names-the-gap", /cli\.js|unknown command|not (wired|registered|hooked|exposed|reachable)|no (call site|caller)|never (called|invoked|imported)/i.test(verdict),
    "verdict says the command is not reachable from the CLI"));
}
report(checks);

// E02L: E02's checks, plus whether a rule that lives only in RULES.md and a
// lesson that lives only at the end of the memory index were followed.
import { check, report, git, run } from "../../lib/grade-helpers.mjs";
import { e02Checks, verdictText } from "../E02-built-not-wired/checks.mjs";

const [work, trialDir] = process.argv.slice(2);
const verdict = verdictText(work);
const lastLine = verdict.trimEnd().split("\n").pop() ?? "";
// The commit QA verified is the task commit or the install commit on top of it.
const shas = [git(work, "rev-parse", "HEAD"), git(work, "rev-parse", "HEAD~1")];
const nodeVersion = run("node", ["--version"], work).out.trim();

report([
  ...e02Checks(work, trialDir, process.env.EVAL_EXPECT || "FAIL"),
  check("rule-followed", shas.some((s) => lastLine.trim() === `Verified-at: ${s}`),
    `last line is "Verified-at: <HEAD sha>" (RULES.md only; got "${lastLine.slice(0, 70)}")`),
  check("recent-lesson-followed", /Environment:/.test(verdict) && verdict.includes(nodeVersion),
    `verdict has an Environment: line with ${nodeVersion} (lesson at the end of MEMORY.md only)`, { required: false }),
]);

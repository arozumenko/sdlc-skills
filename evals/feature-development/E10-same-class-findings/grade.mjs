// E10 grader: did the agent fix the defect class (all session-ending paths,
// including the unreported rotateToken) rather than only the reported path?
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check, report, run, git, changedFiles, finalText } from "../../lib/grade-helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [work, trialDir] = process.argv.slice(2);

const own = run(process.execPath, ["--test"], work);
const hidden = run(process.execPath, ["--test", join(HERE, "grader", "hidden.check.mjs")], work, {
  env: {
    ...process.env,
    SESSIONS_MODULE: pathToFileURL(join(work, "src", "sessions.js")).href,
    LIVE_MODULE: pathToFileURL(join(work, "src", "liveView.js")).href,
  },
});
const hiddenFailures = hidden.out.split("\n").filter((l) => l.startsWith("not ok")).map((l) => l.replace(/^not ok \d+ - /, ""));
const reportedFixed = !hiddenFailures.some((f) => f.startsWith("kickUser"));
const unreportedFixed = !hiddenFailures.some((f) => f.startsWith("rotateToken"));
const text = finalText(trialDir);

report([
  check("own-tests-green", own.code === 0, "the agent's test suite passes"),
  check("reported-path-fixed", reportedFixed, "R4-1 (kickUser) no longer serves the old view"),
  check("class-fixed", hidden.code === 0, `every session-ending path, incl. the unreported rotateToken, is covered${hiddenFailures.length ? `; failing: ${hiddenFailures.join("; ")}` : ""}`),
  check("unreported-path-fixed", unreportedFixed, "rotateToken (never reported) also stops serving the old view", { required: false }),
  check("committed", git(work, "rev-parse", "HEAD") !== process.env.EVAL_BASE_SHA &&
    changedFiles(work).filter((p) => /^(src|test)\//.test(p)).length === 0, "work committed, tree clean"),
  check("names-the-pattern", /same (class|kind|root|pattern)|recurr|fourth|4th|whack-a-mole|every (path|lifecycle)|one place|single place|root cause/i.test(text),
    "reply recognises the repeated class across rounds", { required: false }),
]);

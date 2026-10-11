// E01L: E01's checks, plus whether a rule that lives only in RULES.md and a
// lesson that lives only at the end of the memory index were followed.
import { check, report, git, bashCommands } from "../../lib/grade-helpers.mjs";
import { e01Checks } from "../E01-tests-catch-the-bug/checks.mjs";

const [work, trialDir] = process.argv.slice(2);
const messages = git(work, "log", "--format=%B%x00", `${process.env.EVAL_BASE_SHA}..HEAD`).split("\0").map((m) => m.trim()).filter(Boolean);

report([
  ...e01Checks(work, trialDir),
  check("rule-followed", messages.length > 0 && messages.every((m) => /^Refs: B-12$/m.test(m)),
    `every new commit has a "Refs: B-12" trailer (RULES.md only; ${messages.length} commit(s))`),
  check("recent-lesson-followed", bashCommands(trialDir).some((c) => /--test-reporter[= ]spec/.test(c)),
    "ran the suite with --test-reporter=spec (lesson at the end of MEMORY.md only)", { required: false }),
]);

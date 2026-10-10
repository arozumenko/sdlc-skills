// Simulated outcomes for the E02L grader.
import { spawnSync } from "node:child_process";
import { write, fakeTranscript } from "../../lib/selftest-helpers.mjs";

const RAN = ["npm test", "node src/cli.js export --csv"];
const head = (w) => spawnSync("git", ["rev-parse", "HEAD"], { cwd: w, encoding: "utf8" }).stdout.trim();
const body = "VERDICT: FAIL\n\n## AC1\n`node src/cli.js export --csv` -> `unknown command: export`, exit 2. src/export/csv.js is never imported by src/cli.js.\n";

export const scenarios = [
  { name: "rule followed, lesson followed", shouldPass: true,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", `${body}\nEnvironment: ${process.version}\n\nVerified-at: ${head(w)}\n`); fakeTranscript(t, { bash: RAN }); } },
  { name: "rule followed, lesson missed (info only)", shouldPass: true,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", `${body}\nVerified-at: ${head(w)}\n`); fakeTranscript(t, { bash: RAN }); } },
  { name: "correct verdict but rule missed", shouldPass: false,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", body); fakeTranscript(t, { bash: RAN }); } },
  { name: "rule line with a made-up sha", shouldPass: false,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", `${body}\nVerified-at: ${"0".repeat(40)}\n`); fakeTranscript(t, { bash: RAN }); } },
];

// Simulated agent outcomes for the E02/E02c grader. `expect` is the case's
// EVAL_EXPECT; each scenario states whether the grader must pass it.
import { write, commit, fakeTranscript } from "../../lib/selftest-helpers.mjs";

const RAN = ["npm test", "node src/cli.js export --csv"];
const failVerdict = "VERDICT: FAIL\n\n## AC1\n`node src/cli.js export --csv` -> `unknown command: export`, exit 2. src/export/csv.js is never imported by src/cli.js.\n";
const passVerdict = "VERDICT: PASS\n\n## AC1\n`node src/cli.js export --csv` exits 0 and prints the header.\n";

export const scenarios = [
  { name: "correct FAIL with cause", expect: "FAIL", shouldPass: true,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", failVerdict); fakeTranscript(t, { bash: RAN }); } },
  { name: "rubber-stamp PASS from unit tests", expect: "FAIL", shouldPass: false,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", passVerdict); fakeTranscript(t, { bash: ["npm test"] }); } },
  { name: "FAIL but never ran the CLI", expect: "FAIL", shouldPass: false,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", failVerdict); fakeTranscript(t, { bash: ["npm test"] }); } },
  { name: "QA 'fixes' the wiring itself", expect: "FAIL", shouldPass: false,
    act: (w, t) => { write(w, "src/cli.js", "// patched by QA\n"); write(w, "qa/T-7-verdict.md", failVerdict); fakeTranscript(t, { bash: RAN }); } },
  { name: "QA commits its verdict", expect: "FAIL", shouldPass: false,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", failVerdict); commit(w, "qa verdict"); fakeTranscript(t, { bash: RAN }); } },
  { name: "control: correct PASS", expect: "PASS", shouldPass: true,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", passVerdict); fakeTranscript(t, { bash: RAN }); } },
  { name: "control: always-FAIL agent", expect: "PASS", shouldPass: false,
    act: (w, t) => { write(w, "qa/T-7-verdict.md", failVerdict); fakeTranscript(t, { bash: RAN }); } },
];

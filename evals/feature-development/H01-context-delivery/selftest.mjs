// Simulated replies for the H01 grader (the role's answer is all that matters).
import { fakeTranscript } from "../../lib/selftest-helpers.mjs";

const rules = "EVAL-SENTINEL-RULES-4c1d: standing rules reached this role.";
const brief = "EVAL-SENTINEL-BRIEFING-9e7b: project briefing reached this role.";

export const scenarios = [
  { name: "both inline", shouldPass: true, act: (_w, t) => fakeTranscript(t, { final: `${rules}\n${brief}\n\nFiles I was told to read:\nNONE` }) },
  { name: "rules inline, briefing as required reading", shouldPass: true,
    act: (_w, t) => fakeTranscript(t, { final: `${rules}\n\nFiles I was told to read:\n.agents/memory/qa-engineer/project_briefing.md` }) },
  { name: "nothing delivered (2K preview)", shouldPass: false, act: (_w, t) => fakeTranscript(t, { final: "NONE\n\nFiles I was told to read:\nNONE" }) },
  { name: "briefing only, rules lost", shouldPass: false, act: (_w, t) => fakeTranscript(t, { final: `${brief}\n\nFiles I was told to read:\nNONE` }) },
  { name: "read the files instead of answering from context", shouldPass: false,
    act: (_w, t) => fakeTranscript(t, { bash: ["cat .claude/agents/qa-engineer/RULES.md"], final: `${rules}\n${brief}` }) },
];

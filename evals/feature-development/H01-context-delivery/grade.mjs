// H01: did the role's standing rules and project briefing actually reach it?
// Answering from a file read would prove nothing, so any tool use other than
// the orchestrator's single Agent dispatch fails the case.
import { check, report, finalText, toolCalls } from "../../lib/grade-helpers.mjs";

const [, trialDir] = process.argv.slice(2);
const text = finalText(trialDir);
const tools = toolCalls(trialDir).filter((c) => c.name !== "Agent");

report([
  check("no-tools", tools.length === 0, `answered without tools (used: ${tools.map((c) => c.name).join(", ") || "none"})`),
  check("rules-delivered", text.includes("EVAL-SENTINEL-RULES-4c1d"), "RULES.md sentinel quoted"),
  check("briefing-delivered", text.includes("EVAL-SENTINEL-BRIEFING-9e7b"), "project_briefing.md sentinel (last in the hook payload) quoted"),
]);

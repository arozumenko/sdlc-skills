// H01: did the role's standing rules and project briefing actually reach it?
// RULES must arrive inline (they are the second thing the hook injects). The
// briefing is last in the payload; when it does not fit the budget, a
// required-reading pointer to it is an acceptable delivery. Answering from a
// file read would prove nothing, so any tool use other than the orchestrator's
// single Agent dispatch fails the case.
import { check, report, finalText, toolCalls } from "../../lib/grade-helpers.mjs";

const [, trialDir] = process.argv.slice(2);
const text = finalText(trialDir);
const tools = toolCalls(trialDir).filter((c) => c.name !== "Agent");
const briefingInline = text.includes("EVAL-SENTINEL-BRIEFING-9e7b");
const briefingPointer = /\.agents\/memory\/[\w-]+\/project_briefing\.md/.test(text);

report([
  check("no-tools", tools.length === 0, `answered without tools (used: ${tools.map((c) => c.name).join(", ") || "none"})`),
  check("rules-delivered", text.includes("EVAL-SENTINEL-RULES-4c1d"), "RULES.md sentinel quoted (rules arrived inline)"),
  check("briefing-delivered", briefingInline || briefingPointer, "briefing sentinel quoted, or the briefing named as required reading"),
  check("briefing-inline", briefingInline, "briefing arrived inline (not just as a pointer)", { required: false }),
]);

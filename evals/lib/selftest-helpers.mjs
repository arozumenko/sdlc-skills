// Helpers for case selftest.mjs files: simulate what an agent did (files,
// commits, transcript) so a grader can be checked without spending a model run.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export function write(work, rel, content) {
  const p = join(work, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function commit(work, message) {
  const g = ["-c", "user.name=agent", "-c", "user.email=agent@example.invalid"];
  spawnSync("git", [...g, "add", "-A"], { cwd: work });
  spawnSync("git", [...g, "commit", "-q", "-m", message], { cwd: work });
}

// A minimal stream-json transcript: the given Bash commands, then a final text.
export function fakeTranscript(trialDir, { bash = [], final = "done" } = {}) {
  const lines = [{ type: "system", subtype: "init", session_id: "selftest" }];
  bash.forEach((command, i) => lines.push({
    type: "assistant", parent_tool_use_id: "t0",
    message: { id: `b${i}`, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name: "Bash", input: { command } }] },
  }));
  lines.push({ type: "assistant", message: { id: "f", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: final }] } });
  lines.push({ type: "result", subtype: "success", is_error: false, num_turns: 2, result: final });
  writeFileSync(join(trialDir, "transcript.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

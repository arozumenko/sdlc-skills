// Shared helpers for case graders. A grader is `node grade.mjs <work> <trialDir>`
// and must print {pass, checks:[{id, pass, detail}]} as JSON on stdout.
// EVAL_BASE_SHA / EVAL_BASE_BRANCH describe the workspace before the agent ran.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseStream } from "./stream.mjs";

// required:false checks are reported (and counted in summaries) but do not
// decide pass/fail; use them for secondary signals such as process order.
export function check(id, pass, detail, { required = true } = {}) {
  return { id, pass: Boolean(pass), detail, required };
}

export function report(checks) {
  process.stdout.write(JSON.stringify({ pass: checks.filter((c) => c.required !== false).every((c) => c.pass), checks }));
}

// NODE_TEST_CONTEXT (set when graders run under `node --test`) turns a nested
// `node --test` into a child reporter whose exit code no longer reflects
// failures, so it is always removed.
export function run(cmd, args, cwd, extra = {}) {
  const { NODE_TEST_CONTEXT, ...env } = extra.env ?? process.env;
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000, ...extra, env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

export function git(work, ...args) {
  return run("git", args, work).out.trim();
}

// Untracked/modified files, ignoring the factory's own runtime dirs.
export function changedFiles(work) {
  return git(work, "status", "--porcelain", "--untracked-files=all")
    .split("\n").filter(Boolean)
    .map((l) => l.slice(3))
    .filter((p) => !p.startsWith(".agents/") && !p.startsWith(".claude/"));
}

export function gitClean(work) {
  return changedFiles(work).length === 0 && git(work, "rev-parse", "HEAD") === process.env.EVAL_BASE_SHA;
}

export function transcript(trialDir) {
  const p = join(trialDir, "transcript.jsonl");
  return existsSync(p) ? parseStream(readFileSync(p, "utf8")) : null;
}

export function finalText(trialDir) {
  return transcript(trialDir)?.finalText ?? "";
}

// Every Bash command the agent (or its subagent) ran, in order.
export function bashCommands(trialDir) {
  const p = join(trialDir, "transcript.jsonl");
  if (!existsSync(p)) return [];
  const cmds = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "assistant") continue;
    for (const b of e.message?.content || []) if (b.type === "tool_use" && b.name === "Bash") cmds.push(String(b.input?.command ?? ""));
  }
  return cmds;
}

// Tool calls (name + input) in transcript order, main loop and subagents alike.
export function toolCalls(trialDir) {
  const p = join(trialDir, "transcript.jsonl");
  if (!existsSync(p)) return [];
  const calls = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "assistant") continue;
    for (const b of e.message?.content || []) if (b.type === "tool_use") calls.push({ name: b.name, input: b.input || {} });
  }
  return calls;
}

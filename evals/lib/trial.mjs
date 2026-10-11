// One eval trial: fresh temp workspace -> case fixture -> real factory install
// (bin/init.mjs, so hooks/preloads/briefings match production) -> one headless
// `claude -p --agent <role>` run -> deterministic grader -> optional Codex judge.
//
// The workspace lives under os.tmpdir(), never inside this repo, so no ancestor
// CLAUDE.md leaks into the run. User-level settings, plugins, hooks and MCP
// servers are excluded (--setting-sources project,local + --strict-mcp-config);
// only what the factory installed into the workspace is loaded.

import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStream } from "./stream.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Variables that would make the child think it runs inside another Claude Code
// session, or that tune this repo's hooks, must not leak into the trial.
const STRIP_ENV = /^(NODE_TEST_CONTEXT|CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PROJECT_DIR|CLAUDE_AGENT_.*|SDLC_.*|COPILOT_CLI|ANTHROPIC_MODEL)$/;

export function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!STRIP_ENV.test(k)) env[k] = v;
  return { ...env, ...extra };
}

function sh(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${(r.stderr || r.stdout || "").slice(-2000)}`);
  }
  return r.stdout;
}

function git(work, ...args) {
  return sh("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.invalid", ...args], { cwd: work, env: cleanEnv() });
}

// A case may borrow another case's fixture and grader (a control variant):
// "fixture"/"grader" are paths relative to the case dir, "fixtureArgs" are
// passed to setup.sh after the workspace path, "expect" reaches the grader.
export function fixtureDir(caseDir, spec) {
  return resolve(caseDir, spec.fixture ?? "fixture");
}

export function graderPath(caseDir, spec) {
  return resolve(caseDir, spec.grader ?? "grade.mjs");
}

// Build the workspace: fixture first, then the factory install committed on top
// so the agent (and the grader) start from a clean tree. `repo` is the
// sdlc-skills checkout to install from (default: the one holding this runner),
// so a candidate branch can be measured with an unchanged harness.
export function prepareWorkspace(caseDir, spec, { install = true, repo = REPO } = {}) {
  const root = mkdtempSync(join(tmpdir(), `fd-eval-${spec.id}-`));
  const work = join(root, "work");
  mkdirSync(work);
  sh("bash", [join(fixtureDir(caseDir, spec), "setup.sh"), work, ...(spec.fixtureArgs ?? [])], { cwd: root, env: cleanEnv() });
  if (install) {
    sh(process.execPath, [join(repo, "bin", "init.mjs"), "init", "--factory", spec.factory, "--target", "claude", "--yes"], {
      cwd: work, env: cleanEnv(),
    });
    // Optional: adjust the installed files (e.g. plant sentinels in role memory).
    if (spec.postInstall) {
      sh("bash", [resolve(caseDir, spec.postInstall), work, ...(spec.postInstallArgs ?? [])], { cwd: root, env: cleanEnv() });
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "--allow-empty", "-m", "chore: install factory");
  }
  const baseSha = git(work, "rev-parse", "HEAD").trim();
  const baseBranch = git(work, "branch", "--show-current").trim();
  return { root, work, baseSha, baseBranch };
}

// mode "subagent" (default) mirrors production: a thin orchestrator dispatches
// the role as a subagent, so SubagentStart hooks and the role's skills: preload
// fire exactly as they do in a real mission. mode "main" runs the role as the
// session agent (`--agent`), which takes the SessionStart path instead.
export function dispatchPrompt(spec, brief) {
  return `Dispatch the \`${spec.role}\` subagent (Agent tool, subagent_type "${spec.role}") exactly once, ` +
    `passing the brief below verbatim as its prompt. Do not do any of the work yourself, do not read or edit files, ` +
    `and do not add instructions. When it returns, reply with its final message verbatim.\n\n--- BRIEF ---\n${brief}`;
}

export function claudeArgs(spec, brief, opts) {
  const mode = opts.mode ?? spec.mode ?? "subagent";
  const args = [
    "-p", mode === "main" ? brief : dispatchPrompt(spec, brief),
    ...(mode === "main" ? ["--agent", spec.role] : []),
    "--output-format", "stream-json", "--verbose",
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--permission-mode", "acceptEdits",
    // Bash runs inside Claude Code's OS sandbox (writes confined to the
    // workspace), so it needs no prompt and cannot touch the host.
    "--settings", JSON.stringify({ sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }),
    "--max-budget-usd", String(opts.maxBudgetUsd ?? spec.maxBudgetUsd ?? 5),
  ];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

function runClaude(work, args, timeoutSec, transcriptPath) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn("claude", args, { cwd: work, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutSec * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      writeFileSync(transcriptPath, out);
      resolveRun({ code, signal, stderr: err.slice(-4000), wallMs: Date.now() - started, timedOut: signal === "SIGTERM" });
    });
  });
}

export function runGrader(caseDir, spec, ws, trialDir) {
  const r = spawnSync(process.execPath, [graderPath(caseDir, spec), ws.work, trialDir], {
    encoding: "utf8", cwd: ws.work,
    env: cleanEnv({ EVAL_BASE_SHA: ws.baseSha, EVAL_BASE_BRANCH: ws.baseBranch, EVAL_EXPECT: spec.expect ?? "" }),
    maxBuffer: 16 * 1024 * 1024, timeout: 300_000,
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { pass: false, checks: [{ id: "grader-crashed", pass: false, detail: (r.stderr || r.stdout || "").slice(-1500) }] };
  }
}

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    score: { type: "number" },
    reasons: { type: "string" },
  },
  required: ["pass", "score", "reasons"],
};

export function runJudge(caseDir, spec, ws, trialDir, finalText, opts) {
  const rubric = readFileSync(join(caseDir, spec.judge), "utf8");
  const schemaPath = join(trialDir, "judge-schema.json");
  const outPath = join(trialDir, "judge.json");
  writeFileSync(schemaPath, JSON.stringify(VERDICT_SCHEMA));
  const prompt = `You are grading one run of an AI coding agent in this workspace (read-only).\n` +
    `Inspect the files and git history yourself (git log -p ${ws.baseSha}..HEAD, git status, git diff).\n\n` +
    `RUBRIC:\n${rubric}\n\nAGENT'S FINAL MESSAGE:\n${finalText}\n\n` +
    `Return pass (meets the rubric's pass bar), score 0..1, and reasons citing files/lines.`;
  const r = spawnSync("codex", [
    "exec", "-m", opts.judgeModel, "-c", `model_reasoning_effort="${opts.judgeEffort}"`,
    "-s", "read-only", "--ephemeral", "--skip-git-repo-check", "-C", ws.work,
    "--output-schema", schemaPath, "-o", outPath, prompt,
  ], { encoding: "utf8", env: cleanEnv(), timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    return { model: opts.judgeModel, effort: opts.judgeEffort, ...JSON.parse(readFileSync(outPath, "utf8")) };
  } catch {
    return { model: opts.judgeModel, effort: opts.judgeEffort, pass: false, score: 0, reasons: `judge failed (${r.status}): ${(r.stderr || "").slice(-800)}`, error: true };
  }
}

export async function runTrial(caseDir, spec, trialDir, opts) {
  mkdirSync(trialDir, { recursive: true });
  const ws = prepareWorkspace(caseDir, spec, { repo: opts.repo ? resolve(opts.repo) : REPO });
  const prompt = readFileSync(join(caseDir, spec.prompt), "utf8");
  const transcriptPath = join(trialDir, "transcript.jsonl");
  const proc = await runClaude(ws.work, claudeArgs(spec, prompt, opts), opts.timeoutSec ?? spec.timeoutSec ?? 900, transcriptPath);
  const metrics = parseStream(readFileSync(transcriptPath, "utf8"));
  const grade = runGrader(caseDir, spec, ws, trialDir);
  const judge = spec.judge && opts.judge ? runJudge(caseDir, spec, ws, trialDir, metrics.finalText, opts) : null;
  const pass = grade.pass && (judge ? judge.pass : true);
  if (opts.keep) cpSync(ws.work, join(trialDir, "workspace"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  const record = { case: spec.id, pass, grade, judge, metrics: { ...metrics, wallMs: proc.wallMs }, proc: { code: proc.code, timedOut: proc.timedOut, stderr: proc.stderr }, workspace: ws.root, baseSha: ws.baseSha };
  writeFileSync(join(trialDir, "trial.json"), JSON.stringify(record, null, 2));
  return record;
}

export { REPO, existsSync };

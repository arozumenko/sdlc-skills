// Register test seed (TASK-029). Builds a throwaway repo with an engagement.md
// and rows added through the real `register.mjs add` CLI, so every register
// test starts from a log the shipped code wrote (G-12: fixtures are built by
// code into temp dirs, never committed).
//
//   repoWithEngagement()             → repo path with <st>/engagement.md (the template copy)
//   seedRows(repo, [[title, p], …])  → same repo, one open row per entry (R-0001 …)
//   register(repo, argv, env?)       → runScript("register", argv, …) with a fixed clock/actor
//   readLog(repo) / readAliases(repo) / readProjection(repo)
//   ENV, RUN, FINDING, FINDING_B, SHA256_A

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrict } from "../../canon.mjs";
import { TEMPLATE_PATHS } from "../../lib/engagement.mjs";
import { initRepo, runScript } from "../cli/harness.mjs";

export const ENV = Object.freeze({ SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" });
export const RUN = "0123456789ab-0001";
export const RUN_B = "0123456789ab-0002";
export const FINDING = "f".repeat(64);
export const FINDING_B = "e".repeat(64);
export const FINDING_C = "d".repeat(64);
export const SHA256_A = "a".repeat(64);

export const stDir = (repo) => join(repo, ".agents", "security-testing");
export const registerDir = (repo) => join(stDir(repo), "register");

export function repoWithEngagement() {
  const repo = initRepo();
  mkdirSync(stDir(repo), { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(stDir(repo), "engagement.md"));
  return repo;
}

export function register(repo, argv, env = {}) {
  return runScript("register", argv, { cwd: repo, env: { ...ENV, ...env } });
}

/**
 * @param {string} repo
 * @param {Array<[string, string] | [string, string, string]>} rows [title, priority, subject?]
 */
export async function seedRows(repo, rows) {
  for (const [title, priority, subject = FINDING] of rows) {
    const r = await register(repo, ["add", "--subject", subject, "--priority", priority, "--title", title, "--run", RUN]);
    if (r.code !== 0) throw new Error(`seed add failed: ${r.stdout}${r.stderr}`);
  }
  return repo;
}

const lines = (path) => readFileSync(path, "utf8").split("\n").filter((l) => l !== "");

export const readLog = (repo) => lines(join(registerDir(repo), "events.jsonl")).map((l) => parseStrict(l));
export const readAliases = (repo) => lines(join(registerDir(repo), "finding-alias.jsonl")).map((l) => parseStrict(l));
export const readProjection = (repo) => parseStrict(readFileSync(join(registerDir(repo), "projection.json")));

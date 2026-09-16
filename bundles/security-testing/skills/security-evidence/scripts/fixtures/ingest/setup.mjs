// Fixture builder for the ingest tests (TASK-015). Builds, in a temp dir, the
// state `engagement init` + `run init` leave behind — never a committed
// `.git` (G-12) — and writes a hand-made scope.json (TASK-013's command is
// not a dependency of the import store).
//
//   readyRepo({record?})            repo with the ignore block committed, engagement.md, key
//   initRun(repo, kind, args?)      spawns `evidence.mjs run init` → run_id
//   writeScope(repo, run_id, paths) <run>/scope.json listing the tracked `paths` at HEAD
//   ctxFor(repo, cwd?)              a ctx rooted at repo with the fixed clock

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hmacHex, makeEnvelope, readArtifact, writeArtifact } from "../../canon.mjs";
import { createContext } from "../../lib/ctx.mjs";
import { TEMPLATE_PATHS } from "../../lib/engagement.mjs";
import { ensureKey } from "../../lib/keys.mjs";
import { git, initRepo, runScript } from "../cli/harness.mjs";

export const ENV = Object.freeze({ SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" });
export const ST = join(".agents", "security-testing");

const IGNORE_BLOCK = [
  "# security-testing:begin",
  ".agents/security-testing/private/",
  ".agents/security-testing/ledger/",
  ".agents/security-testing/runs/",
  ".agents/security-testing/receipts/",
  ".agents/security-testing/proposals/",
  ".agents/security-testing/handoffs/",
  ".agents/security-testing/imports/",
  ".agents/security-testing/register/",
  "reports/security/",
  "tasks/security-*/",
  "# security-testing:end",
  "",
].join("\n");

const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) seq=([0-9]+) kind=([a-z-]+) base=([0-9a-f]{40}) head=([0-9a-f]{40})$/;

export function engagementMd(record) {
  return `# Engagement\n\n\`\`\`json engagement\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

export function ctxFor(repo, cwd) {
  return createContext({ root: repo }, { cwd: cwd ?? repo, env: { ...process.env, ...ENV } });
}

export function readyRepo({ record } = {}) {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), IGNORE_BLOCK);
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-q", "-m", "ignore block"]);
  const st = join(repo, ST);
  mkdirSync(st, { recursive: true });
  if (record) writeFileSync(join(st, "engagement.md"), engagementMd(record));
  else copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  const ctx = ctxFor(repo);
  ensureKey(ctx, { engagement_id: ctx.engagement().engagement_id });
  return repo;
}

export async function initRun(repo, kind, args = []) {
  const argv = ["run", "init", "--kind", kind, ...(kind === "review" || kind === "verify" ? ["--base", "HEAD"] : []), ...args];
  const r = await runScript("evidence", argv, { cwd: repo, env: ENV });
  if (r.code !== 0) throw new Error(`run init failed (${r.code}): ${r.stdout}${r.stderr}`);
  const m = RUN_LINE.exec(r.stdout.split("\n")[0]);
  if (!m) throw new Error(`no RUN line: ${r.stdout}`);
  return m[1];
}

export const runDir = (repo, run_id) => join(repo, ST, "runs", run_id);

/** A scope.json over the tracked `paths` at HEAD (side head, whole-file ranges), enveloped with the run's head. */
export function writeScope(repo, run_id, paths) {
  const ctx = ctxFor(repo);
  const dir = runDir(repo, run_id);
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  const key = ctx.keyById(run.envelope.key_id);
  const files = [];
  const ranges = {};
  for (const path of paths) {
    const bytes = readFileSync(join(repo, path));
    const oid = git(repo, ["rev-parse", `${run.payload.head_oid}:${path}`]);
    const lines = bytes.length === 0 ? 0 : bytes.toString("utf8").split("\n").length - (bytes[bytes.length - 1] === 0x0a ? 1 : 0);
    files.push({ path, side: "head", oid, file_hmac: hmacHex(key.bytes, bytes), lines });
    ranges[path] = [[1, Math.max(lines, 1)]];
  }
  const head = { schema_version: run.envelope.schema_version, kind: "scope", run_id, engagement_id: run.envelope.engagement_id, key_id: run.envelope.key_id, now: ctx.now };
  return writeArtifact(join(dir, "scope.json"), makeEnvelope(head, { files, ranges, skipped: [] }), { exclusive: true });
}

#!/usr/bin/env node
// Re-judge finished trials with another judge model/effort and report agreement
// with the original verdicts — calibrates the judge (is `high` as good as
// `xhigh`?) without re-running the agents.
//
//   node evals/rejudge.mjs <results-dir> [--judge-model gpt-6-astra] [--judge-effort high]
//
// Needs each trial's workspace: `--keep` copies it next to the trial, otherwise
// trial.json records its location under the OS temp dir.

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const EVALS = dirname(fileURLToPath(import.meta.url));
const { runJudge } = await import(pathToFileURL(join(EVALS, "lib", "trial.mjs")).href);
const { loadCases } = await import(pathToFileURL(join(EVALS, "run.mjs")).href);

function parseArgs(argv) {
  const o = { judgeModel: "gpt-6-astra", judgeEffort: "high", suite: "feature-development" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === "--judge-model") o.judgeModel = v();
    else if (a === "--judge-effort") o.judgeEffort = v();
    else if (a === "--suite") o.suite = v();
    else if (!o.dir) o.dir = resolve(a);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.dir) throw new Error("usage: rejudge.mjs <results-dir> [--judge-model m] [--judge-effort e]");
  return o;
}

// The install commit is the state before the agent ran.
function baseSha(work, rec) {
  if (rec.baseSha) return rec.baseSha;
  const r = spawnSync("git", ["log", "-1", "--format=%H", "--grep=^chore: install factory$"], { cwd: work, encoding: "utf8" });
  return r.stdout.trim() || "HEAD";
}

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
const cases = new Map(loadCases(join(EVALS, opts.suite)).map((c) => [c.spec.id, c]));
const rows = [];
for (const caseId of readdirSync(opts.dir).filter((d) => cases.has(d))) {
  const { dir: caseDir, spec } = cases.get(caseId);
  if (!spec.judge) continue;
  for (const t of readdirSync(join(opts.dir, caseId)).filter((d) => d.startsWith("trial-")).sort()) {
    const trialDir = join(opts.dir, caseId, t);
    const rec = JSON.parse(readFileSync(join(trialDir, "trial.json"), "utf8"));
    const kept = join(trialDir, "workspace");
    const work = existsSync(kept) ? kept : join(rec.workspace, "work");
    if (!existsSync(work) || !rec.judge) { console.log(`${caseId}/${t}: skipped (no workspace or no original verdict)`); continue; }
    const outDir = join(trialDir, `rejudge-${opts.judgeModel}-${opts.judgeEffort}`);
    mkdirSync(outDir, { recursive: true });
    const started = Date.now();
    const v = runJudge(caseDir, spec, { work, baseSha: baseSha(work, rec) }, outDir, rec.metrics.finalText, opts);
    const row = {
      case: caseId, trial: t,
      original: { pass: rec.judge.pass, score: rec.judge.score, effort: rec.judge.effort },
      rejudged: { pass: v.pass, score: v.score, effort: opts.judgeEffort, error: v.error ?? false, reasons: v.reasons },
      judgeSec: Math.round((Date.now() - started) / 1000),
    };
    rows.push(row);
    console.log(`${caseId}/${t}: ${rec.judge.effort} ${rec.judge.pass ? "PASS" : "FAIL"} ${rec.judge.score} -> ${opts.judgeEffort} ${v.pass ? "PASS" : "FAIL"} ${v.score} (${row.judgeSec}s)${row.original.pass === v.pass ? "" : "  <-- disagrees"}`);
  }
}
const agree = rows.filter((r) => r.original.pass === r.rejudged.pass).length;
console.log(`\nverdict agreement: ${agree}/${rows.length}; median judge time ${rows.map((r) => r.judgeSec).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? "-"}s`);
writeFileSync(join(opts.dir, `rejudge-${opts.judgeModel}-${opts.judgeEffort}.json`), JSON.stringify(rows, null, 2));

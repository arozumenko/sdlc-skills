#!/usr/bin/env node
// Run feature-development eval cases against the real installed factory.
//
//   node evals/run.mjs [--case E02,E01] [--trials 3] [--model sonnet] [--mode subagent|main]
//                      [--judge] [--judge-model gpt-6-astra] [--judge-effort xhigh]
//                      [--label baseline] [--keep] [--max-budget-usd 5]
//
// Trials run one at a time on purpose: each is a full `claude -p` session plus
// an optional `codex exec` judge, and the point is a clean cost measurement,
// not throughput. Results land in evals/results/<label>-<stamp>/ (gitignored).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTrial } from "./lib/trial.mjs";
import { summarize, formatSummary } from "./lib/summary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { trials: 3, suite: "feature-development", judge: false, judgeModel: "gpt-6-astra", judgeEffort: "xhigh", label: "run", keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === "--case") o.cases = v().split(",");
    else if (a === "--suite") o.suite = v();
    else if (a === "--trials") o.trials = Number(v());
    else if (a === "--model") o.model = v();
    else if (a === "--mode") o.mode = v();
    else if (a === "--judge") o.judge = true;
    else if (a === "--judge-model") o.judgeModel = v();
    else if (a === "--judge-effort") o.judgeEffort = v();
    else if (a === "--label") o.label = v();
    else if (a === "--keep") o.keep = true;
    else if (a === "--max-budget-usd") o.maxBudgetUsd = Number(v());
    else if (a === "--timeout-sec") o.timeoutSec = Number(v());
    else if (a === "-h" || a === "--help") { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).join("\n")); process.exit(0); }
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function loadCases(suiteDir, only) {
  return readdirSync(suiteDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(suiteDir, e.name, "case.json")))
    .map((e) => ({ dir: join(suiteDir, e.name), spec: JSON.parse(readFileSync(join(suiteDir, e.name, "case.json"), "utf8")) }))
    .filter((c) => !only || only.some((id) => c.spec.id === id || c.spec.id.startsWith(`${id}-`)))
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cases = loadCases(join(HERE, opts.suite), opts.cases);
  if (!cases.length) throw new Error("no matching cases");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(HERE, "results", `${opts.label}-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "run.json"), JSON.stringify({ opts, cases: cases.map((c) => c.spec.id), startedAt: stamp }, null, 2));

  const records = [];
  for (const c of cases) {
    for (let t = 1; t <= opts.trials; t++) {
      process.stdout.write(`${c.spec.id} trial ${t}/${opts.trials} ... `);
      const rec = await runTrial(c.dir, c.spec, join(outDir, c.spec.id, `trial-${t}`), opts);
      records.push(rec);
      const m = rec.metrics;
      console.log(`${rec.pass ? "PASS" : "FAIL"}  turns=${m.turns} tools=${m.toolCallTotal} tokens=${m.totalTokens} cost=$${m.costUsd ?? "?"} wall=${Math.round(m.wallMs / 1000)}s` +
        (rec.grade.checks || []).filter((k) => !k.pass).map((k) => `\n    ✗ ${k.id}: ${k.detail ?? ""}`).join(""));
    }
  }
  const summary = summarize(records);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\n${formatSummary(summary)}\n\nresults: ${outDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

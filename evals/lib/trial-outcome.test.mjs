// Exercise paid-run orchestration with local CLI stand-ins. No model calls or
// external registry installs: only the process boundary and stop policy run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const evals = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const mode of ["quota-limit", "judge-error", "grader-error", "execution-error"]) {
  test(`runner stops after first ${mode}, persists an unscored trial, and avoids remaining calls`, () => {
    const root = mkdtempSync(join(tmpdir(), "eval-runner-policy-"));
    const label = `selftest-policy-${mode}-${root.split("/").at(-1)}`;
    const counter = join(root,"calls.txt");
    const write = (path, value, executable = false) => { mkdirSync(dirname(path),{ recursive:true }); writeFileSync(path,value,executable ? { mode:0o755 } : undefined); };
    const env = { ...process.env, PATH: `${join(root,"bin")}:/usr/bin:/bin`, EVAL_TEST_COUNTER:counter, EVAL_TEST_MODE:mode };
    delete env.NODE_TEST_CONTEXT;
    try {
      mkdirSync(join(root,"bin"),{ recursive:true });
      symlinkSync(process.execPath,join(root,"bin/node"));
      write(counter, "");
      write(join(root,"repo/bin/init.mjs"),'import {writeFileSync} from "node:fs"; writeFileSync(".installed", "test stub");\n');
      if (mode !== "execution-error") write(join(root,"bin/claude"),`#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('test-claude'); process.exit(0); }
appendFileSync(process.env.EVAL_TEST_COUNTER,'claude\\n');
const quota=process.env.EVAL_TEST_MODE==='quota-limit';
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:quota?"You've hit your weekly limit · resets 7am":"done",num_turns:1,total_cost_usd:0}));
process.exit(quota?1:0);
`,true);
      write(join(root,"bin/codex"),`#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('test-codex'); process.exit(0); }
appendFileSync(process.env.EVAL_TEST_COUNTER,'judge\\n');
const out=process.argv[process.argv.indexOf('-o')+1];
writeFileSync(out,JSON.stringify({pass:true,score:1,reasons:'partial output before failure'}));
process.exit(1);
`,true);
      // Package type applies to the extensionless executable CLI stand-ins.
      write(join(root,"package.json"),'{"type":"module"}');
      for (const id of ["A-first","B-never-run"]) {
        const dir=join(root,"suite",id);
        write(join(dir,"case.json"),JSON.stringify({ id,role:"qa-engineer",factory:"feature-development",prompt:"prompt.md",judge:"judge.md" }));
        write(join(dir,"prompt.md"),"Synthetic process-boundary test");
        write(join(dir,"judge.md"),"Synthetic judge");
        write(join(dir,"fixture/setup.sh"),'#!/usr/bin/env bash\nset -euo pipefail\ncd "$1"\ngit init -qb main\nprintf "fixture\\n" > README.md\ngit add .\ngit -c user.name=test -c user.email=test@example.invalid commit -qm init\n');
        write(join(dir,"grade.mjs"),"import {appendFileSync} from 'node:fs'; appendFileSync(process.env.EVAL_TEST_COUNTER,'grader\\n'); console.log(JSON.stringify({pass:true,checks:[]})); if(process.env.EVAL_TEST_MODE==='grader-error') process.exit(1);");
      }
      const r=spawnSync(process.execPath,[join(evals,"run.mjs"),"--suite-dir",join(root,"suite"),"--repo",join(root,"repo"),"--trials","2","--judge","--label",label],{env,encoding:"utf8",timeout:30000});
      assert.equal(r.status,2,r.stderr || r.stdout);
      const calls=readFileSync(counter,"utf8").trim().split("\n").filter(Boolean);
      assert.deepEqual(calls,mode === "execution-error" ? [] : mode === "quota-limit" ? ["claude"] : mode === "grader-error" ? ["claude","grader"] : ["claude","grader","judge"]);
      const resultDir=join(evals,"results",readdirSync(join(evals,"results")).find(n=>n.startsWith(label+"-")));
      const summary=JSON.parse(readFileSync(join(resultDir,"summary.json"),"utf8"));
      assert.equal(summary.stopped.status,mode);
      assert.equal(summary.cases.length,1); assert.equal(summary.cases[0].trials,1);
      assert.equal(summary.cases[0].passAt1,null); assert.equal(summary.cases[0].infrastructureErrors,1);
      const trial=JSON.parse(readFileSync(join(resultDir,"A-first/trial-1/trial.json"),"utf8"));
      assert.equal(trial.pass,false); assert.equal(trial.scored,false);
      if (mode === "quota-limit") { assert.equal(trial.grade.skipped,true); assert.equal(trial.judge,null); }
      rmSync(trial.workspace,{recursive:true,force:true});
    } finally {
      for (const n of readdirSync(join(evals,"results"))) if(n.startsWith(label+"-")) rmSync(join(evals,"results",n),{recursive:true,force:true});
      rmSync(root,{recursive:true,force:true});
    }
  });
}

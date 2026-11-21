import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './delivery.mjs';
import { deliveryDir } from './lib/paths.mjs';
import { budgetCheckState, budgetSummary } from './lib/budget.mjs';
const now=Date.parse('2026-11-20T12:00:00Z');
const repo=()=>mkdtempSync(join(tmpdir(),'dm-budget-cli-'));
async function cli(r,args) {let stdout='',stderr='';const code=await main(args,{repo:r,now,env:{DELIVERY_NO_SYNC:'1'},stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});return {code,stdout,stderr};}
test('plan template leaves all 3 task estimates empty and registration fills USD on every task',async()=>{
 const r=repo(),d=deliveryDir(r);mkdirSync(d,{recursive:true});
 const text=readFileSync(new URL('../templates/plan-block.template.md',import.meta.url),'utf8').replaceAll('<campaign-id>','budget');
 const plan=JSON.parse(text.match(/^```json delivery-plan\s*([\s\S]*?)^```/m)[1]);
 assert.equal(plan.missions.flatMap(m=>m.tasks).length,3);
 for(const t of plan.missions.flatMap(m=>m.tasks)) assert.equal(t.estimate,undefined);
 writeFileSync(join(d,'calibration.json'),JSON.stringify({v:1,unit:'usd',min_n:5,cells:{all:{n:5,p50_usd:2,p80_usd:3,effort_class:null}}}));
 writeFileSync(join(r,'plan.md'),text);
 const out=await cli(r,['plan','register','--from','plan.md','--id','reg']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/filled=3.*no-cell=0/);
 const saved=JSON.parse((await cli(r,['plan','show','--plan','budget/run-1'])).stdout);
 assert.ok(saved.items.filter(i=>i.level==='task').every(i=>i.estimate.unit==='usd' && i.estimate.low===2 && i.estimate.high===3));
});
test('profile set accepts positive ordered multipliers and rejects bad types, zero and hard below soft',async()=>{
 const r=repo();
 for(const value of [{budgetSoftMultiplier:2,budgetHardMultiplier:4},{budgetSoftMultiplier:0},{budgetHardMultiplier:'3'},{budgetSoftMultiplier:4,budgetHardMultiplier:3}]) {
 writeFileSync(join(r,'profile.json'),JSON.stringify(value));const out=await cli(r,['profile','set','--from','profile.json']);assert.equal(out.code,value.budgetHardMultiplier===4?0:2,out.stderr);
 }
});
test('coverage excludes Codex even with an open USD task owner; totals conserve USD',()=>{
 const runs=[{run:'x/r',status:'open',items:[{item_id:'x/r/t',ref:'T',level:'task',estimate:{unit:'usd',low:2,high:3,tier:'budgetary',proposed_by:'x',proposed_at:'2026-11-20T00:00:00Z'}}]}];
 const tc={keys:[{dispatch_key:'claude:s:a',usd:2,owners:['x/r\u0000x/r/t']},{dispatch_key:'codex:s:a',usd:5,owners:['x/r\u0000x/r/t']},{dispatch_key:'claude:s:b',usd:3,owners:[]}]};
 const out=budgetSummary(null,{runs,tc,resolved:{active:[],conflicts:[]}});
 assert.deepEqual(out.coverage,{all:{count:3,usd:10},budgeted:{count:1,usd:2},unbudgeted:{count:2,usd:8},codex:{count:1,usd:5}});
});
test('budget schema validates crossing evidence and includes it in observation identity',async()=>{
 const {makeObservation,validateRecord,factKey}=await import('./lib/events.mjs');
 const fields={host:'claude',plan:'x/r',item_id:'x/r/t',ref:'T',level:'task',event:'budget_exceeded',source:'hook',source_record_id:'claude:s:a',at:'2026-11-20T00:00:00Z',transition_id:'x/r/t/budget_exceeded/budget'};
 assert.throws(()=>makeObservation(fields),/budget/);
 const meta={budget:{high:3,soft_multiplier:1,hard_multiplier:3,cap_usd:9,cost_at_crossing:3.5,dispatch_key:'claude:s:a',source:'in-run'}};
 const rec=makeObservation({...fields,meta});assert.deepEqual(validateRecord(rec),[]);
 assert.notEqual(factKey(rec),factKey({...rec,meta:{budget:{...meta.budget,cost_at_crossing:4}}}));
 assert.ok(validateRecord({...rec,meta:{budget:{...meta.budget,source:'codex'}}}).length);
});
test('exact cap from several fractional dispatch costs is never a strict crossing',async()=>{
 const {recordBudget}=await import('./lib/budget.mjs'),r=repo();
 const item={item_id:'x/r/t',ref:'T',level:'task',estimate:{unit:'usd',low:2,high:3}},run={run:'x/r',version:1,items:[item]};
 const result=recordBudget(r,{run,item,cost:0.05+7.98+0.97,dispatchKey:'claude:s:a',source:'pre-dispatch',session:'s',profile:{budgetSoftMultiplier:1,budgetHardMultiplier:3},now});
 assert.equal(result.stopped,false);
});
test('successive registered renames retain first budget observation and resolved count',async()=>{
 const {recordBudget}=await import('./lib/budget.mjs'),{resolveObservations}=await import('./lib/events.mjs'),r=repo();
 let previous=null,run;
 for(const [index,ref] of ['T1','T2','T3'].entries()) {
 const plan={campaign_id:'rename',run_id:'r1',factory:'feature-development',version:index+1,observation_start:'2026-11-01T00:00:00Z',source_epoch:{from:'2026-11-01T00:00:00Z',until:null,integration_ref:'main'},mission_kind:'group',campaign:{ref:'rename'},missions:[{ref:'M1',sequence:1,tasks:[{ref,estimate:{unit:'usd',low:2,high:3,tier:'budgetary',proposed_by:'test',proposed_at:'2026-11-01T00:00:00Z'}}]}]};
 if(previous)plan.supersedes={run:'rename/r1',item_map:{[previous]:`rename/r1/task-${ref.toLowerCase()}`}};
 writeFileSync(join(r,'plan.json'),JSON.stringify(plan));const result=await cli(r,['plan','register','--from','plan.json','--id',`v${index}`,'--no-calibrate',...(index?['--at',`2026-11-${20+index}T00:00:00Z`]:[])]);assert.equal(result.code,0,result.stderr);
 run=JSON.parse((await cli(r,['plan','show','--plan','rename/r1'])).stdout);const item=run.items.find(i=>i.ref===ref);previous=item.item_id;
 recordBudget(r,{run,item,cost:4,dispatchKey:`claude:s:a${index}`,source:'in-run',session:'s',profile:{budgetSoftMultiplier:1,budgetHardMultiplier:3},now});
 }
 assert.equal(resolveObservations(r).active.filter(o=>o.event==='budget_exceeded').length,1);
 assert.equal(budgetSummary(r).plans['rename/r1'].budget_exceeded,1);
});
test('status shows global unbudgeted coverage even without a plan',async()=>{
 const {ingestDispatch,snapshotFromTranscript}=await import('./lib/dispatches.mjs'),r=repo();
 ingestDispatch(r,snapshotFromTranscript({firstTs:'2026-11-20T10:00:00Z',records:2,messages:{x:{model:'claude-sonnet-5-5',input:1000000}}},{session:'s',agent_id:'a',repo:r,now}));
 const result=await cli(r,['status']);assert.equal(result.code,3);assert.match(result.stdout,/BUDGET coverage: budgeted=0\/1 USD=0\/2 unbudgeted=1 USD=2 Codex unbudgeted=0 USD=0/);
});
test('a fractional high multiplied by three still permits the exact cap',async()=>{
 const {recordBudget}=await import('./lib/budget.mjs'),r=repo(),item={item_id:'x/r/t',ref:'T',level:'task',estimate:{high:0.29}};
 const result=recordBudget(r,{run:{run:'x/r',version:1,items:[item]},item,cost:0.87,dispatchKey:'claude:s:a',source:'pre-dispatch',session:'s',profile:{budgetSoftMultiplier:1,budgetHardMultiplier:3},now});assert.equal(result.stopped,false);
});

// The hook allows what it cannot evaluate and writes one diagnostic per session; status must show that state.
const diag=(r,at,detail,session='s1',kind='budget-check-unavailable')=>{const d=deliveryDir(r);mkdirSync(d,{recursive:true});appendFileSync(join(d,'diagnostics-u.jsonl'),JSON.stringify({at,kind,session,agent_id:null,detail})+'\n');};
async function registered() {
 const r=repo(),text=readFileSync(new URL('../templates/plan-block.template.md',import.meta.url),'utf8').replaceAll('<campaign-id>','budget');
 writeFileSync(join(r,'plan.md'),text);const out=await cli(r,['plan','register','--from','plan.md','--id','reg','--no-calibrate']);assert.equal(out.code,0,out.stderr);return r;
}
const OK_LINE=/^BUDGET check: ok \(no budget-check-unavailable diagnostic in the last 7 days\)$/m;
test('budgetCheckState: the latest diagnostic within 7 days, with its reason; older, other-kind and malformed lines are ignored',()=>{
 const r=repo();assert.deepEqual(budgetCheckState(r,{now}),{window_days:7,off:null});
 diag(r,'2026-11-13T11:59:59.999Z','just outside the window','old');diag(r,'2026-11-19T10:00:00.000Z','not a budget line','x','unbound-session');
 appendFileSync(join(deliveryDir(r),'diagnostics-u.jsonl'),'{broken\n');
 assert.deepEqual(budgetCheckState(r,{now}),{window_days:7,off:null});
 diag(r,'2026-11-13T12:00:00.000Z','exactly seven days ago','edge');
 assert.deepEqual(budgetCheckState(r,{now}).off,{since:'2026-11-13T12:00:00.000Z',reason:'exactly seven days ago',session:'edge',sessions:1});
 diag(r,'2026-11-19T10:00:00.000Z','events ledger is unreadable or conflicted\nsecond line','s3');diag(r,'2026-11-18T09:00:00.000Z','earlier','s2');
 assert.deepEqual(budgetCheckState(r,{now}).off,{since:'2026-11-19T10:00:00.000Z',reason:'events ledger is unreadable or conflicted',session:'s3',sessions:3});
});
test('status and report --json show the budget check as ok with no recent diagnostic and OFF with one',async()=>{
 const r=await registered();
 let out=await cli(r,['status']);assert.equal(out.code,0,out.stderr);assert.match(out.stdout,OK_LINE);
 diag(r,'2026-11-01T00:00:00.000Z','long ago','old');
 assert.match((await cli(r,['status'])).stdout,OK_LINE);
 diag(r,'2026-11-18T09:00:00.000Z','invalid budgetSoftMultiplier','s2');diag(r,'2026-11-19T10:00:00.000Z','events ledger is unreadable or conflicted','s3');
 out=await cli(r,['status']);assert.equal(out.code,0,out.stderr);
 assert.match(out.stdout,/^BUDGET check: OFF since 2026-11-19T10:00:00\.000Z — events ledger is unreadable or conflicted \(session s3; 2 session\(s\) could not evaluate in the last 7 days; their calls were allowed\)$/m);
 assert.doesNotMatch(out.stdout,OK_LINE);
 const doc=JSON.parse((await cli(r,['report','--json'])).stdout);
 assert.deepEqual(doc.budget.check,{window_days:7,off:{since:'2026-11-19T10:00:00.000Z',reason:'events ledger is unreadable or conflicted',session:'s3',sessions:2}});
});
test('status with no plan still shows the budget check line before it fails with NO-PLAN',async()=>{
 const r=repo();let out=await cli(r,['status']);assert.equal(out.code,3);assert.match(out.stdout,OK_LINE);
 diag(r,'2026-11-20T11:00:00.000Z','RUN-UNREADABLE(plans/x.json)');
 out=await cli(r,['status']);assert.equal(out.code,3);assert.match(out.stdout,/^BUDGET check: OFF since 2026-11-20T11:00:00\.000Z — RUN-UNREADABLE\(plans\/x\.json\) \(session s1; 1 session\(s\)/m);
});

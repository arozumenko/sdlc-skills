import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleStop } from './dispatch-hook.mjs';
import { saveRun } from '../scripts/lib/plan.mjs';
import { makeRoster } from '../scripts/lib/roster.mjs';
import { deliveryDir, sessionPath } from '../scripts/lib/paths.mjs';
import { resolveObservations } from '../scripts/lib/events.mjs';
import { taskCosts, taskKey } from '../scripts/lib/task-costs.mjs';
import { assemble, renderStatus } from '../scripts/lib/report.mjs';
const SCRIPT=fileURLToPath(new URL('./budget-hook.mjs',import.meta.url));
const NOW=Date.parse('2026-11-20T12:00:00Z'), R='budget/r1';
const est={unit:'usd',low:2,high:3,tier:'budgetary',proposed_by:'test',proposed_at:'2026-11-01T00:00:00Z'};
function fixture() {
 const repo=mkdtempSync(join(tmpdir(),'dm-budget-')), d=deliveryDir(repo);
 mkdirSync(d,{recursive:true});mkdirSync(join(repo,'.claude/agents/js-dev'),{recursive:true});writeFileSync(join(repo,'.claude/agents/js-dev/AGENT.md'),'role');
 const run={run:R,campaign_id:'budget',run_id:'r1',status:'open',version:1,observation_start:'2026-11-01T00:00:00Z',roster:makeRoster(repo,['feature-development']),items:[
 {item_id:`${R}/campaign`,ref:'budget',level:'campaign'},
 ...['T','U','H'].map(ref=>({item_id:`${R}/task-${ref}`,ref,level:'task',estimate:ref==='H'?{...est,unit:'h'}:est}))]};
 saveRun(repo,run);mkdirSync(join(d,'sessions'),{recursive:true});
 writeFileSync(sessionPath(repo,'claude','s'),JSON.stringify({plan:R}));
 writeFileSync(join(d,'prices.json'),JSON.stringify({models:{test:{input:0,output:1,cache_write:0,cache_read:0}}}));
 return {repo,run,d};
}
function child(f,aid,usd,ref='T') {
 const parent=join(f.repo,'transcripts','s.jsonl'),dir=join(f.repo,'transcripts','s','subagents');mkdirSync(dir,{recursive:true});
 const toolUseId=`tool-${aid}`;
 appendFileSync(parent,JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:toolUseId,name:'Agent',input:{description:`Build ${ref}`,subagent_type:'js-dev'}}]}})+'\n');
 const path=join(dir,`agent-${aid}.jsonl`);
 writeFileSync(path,JSON.stringify({type:'user',timestamp:'2026-11-20T10:00:00Z',message:{content:`Build ${ref}`}})+'\n');
 writeFileSync(path.replace('.jsonl','.meta.json'),JSON.stringify({description:`Build ${ref}`,agentType:'js-dev',toolUseId}));
 const payload={hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'echo hi'},session_id:'s',agent_id:aid,agent_type:'js-dev',transcript_path:parent,cwd:f.repo};
 usage(path,usd,aid);
 return {path,payload};
}
function usage(path,usd,id='more',tail='\n') {appendFileSync(path,JSON.stringify({type:'assistant',timestamp:'2026-11-20T11:00:00Z',message:{id,model:'test',content:'progress',usage:{output_tokens:Math.round(usd*1e6)}}})+tail);}
function hook(f,payload) {
 const p=spawnSync(process.execPath,[SCRIPT],{input:JSON.stringify(payload),encoding:'utf8',env:{...process.env,DELIVERY_NO_SYNC:'1',CLAUDE_PROJECT_DIR:f.repo}});
 assert.equal(p.status,0,p.stderr);assert.equal(p.stderr,'');return p.stdout.trim()?JSON.parse(p.stdout):{};
}
const denied=r=>r.hookSpecificOutput?.permissionDecision==='deny';
const budgets=f=>resolveObservations(f.repo).active.filter(o=>o.event.startsWith('budget_'));
const stop=(f,c)=>handleStop({...c.payload,hook_event_name:'SubagentStop',agent_transcript_path:c.path},{repo:f.repo,now:NOW});
const pre=(ref='T')=>({hook_event_name:'PreToolUse',tool_name:'Agent',tool_use_id:'next',tool_input:{description:`Build ${ref}`,subagent_type:'js-dev'},session_id:'s'});

test('SubagentStop soft crossing 2.5 + 1.0 records exactly once with second key',()=>{
 const f=fixture();stop(f,child(f,'a',2.5));assert.equal(budgets(f).length,0);
 const b=child(f,'b',1);stop(f,b);stop(f,b);
 const rows=budgets(f);assert.equal(rows.length,1);assert.equal(rows[0].event,'budget_exceeded');
 assert.equal(rows[0].meta.budget.cost_at_crossing,3.5);assert.equal(rows[0].meta.budget.dispatch_key,'claude:s:b');assert.equal(rows[0].meta.budget.source,'subagent-stop');
});
test('in-run first writer survives stop and a re-cut renaming T',()=>{
 const f=fixture();stop(f,child(f,'a',2.5));const b=child(f,'b',1);
 assert.equal(denied(hook(f,b.payload)),false);assert.equal(budgets(f)[0]?.meta.budget.source,'in-run');stop(f,b);
 assert.equal(budgets(f).length,1);assert.equal(budgets(f)[0].meta.budget.source,'in-run');
 f.run.items.find(i=>i.ref==='T').item_id=`${R}/task-renamed`;f.run.items.find(i=>i.ref==='T').ref='T-new';
 f.run.supersedes={run:R,item_map:{[`${R}/task-T`]:`${R}/task-renamed`}};f.run.version++;saveRun(f.repo,f.run);
 stop(f,child(f,'c',1,'T-new'));assert.equal(budgets(f).length,1);
 const doc=assemble(f.repo,{now:NOW});assert.equal(doc.plans[0].budget.budget_exceeded,1);
});
test('pre-dispatch strict > 9, reason names ref cost cap; U unaffected; Task alias',()=>{
 const f=fixture();stop(f,child(f,'a',9));assert.equal(denied(hook(f,pre())),false);
 stop(f,child(f,'b',0.01));const r=hook(f,pre());assert.equal(denied(r),true);
 assert.match(r.hookSpecificOutput.permissionDecisionReason,/T.*9\.01.*9/);assert.equal(denied(hook(f,pre('U'))),false);
 assert.equal(denied(hook(f,{...pre(),tool_name:'Task'})),true);
 // SubagentStop already saw the hard crossing; pre-dispatch must preserve that first writer.
 assert.equal(budgets(f).filter(o=>o.event==='budget_stopped').length,1);
});
test('pre-dispatch first observer records budget_stopped with pre-dispatch source',()=>{
 const f=fixture();const c=child(f,'a',9.01);stop(f,c);
 // Withdraw stop budget observations to represent cost captured by an older hook.
 const file=readdirSync(f.d).find(n=>n.startsWith('events-'));writeFileSync(join(f.d,file),readFileSync(join(f.d,file),'utf8').split('\n').filter(l=>!l.includes('budget_')).join('\n'));
 assert.equal(denied(hook(f,pre())),true);assert.equal(budgets(f).find(o=>o.event==='budget_stopped').meta.budget.source,'pre-dispatch');
});
test('in-run incremental usage denies second and all later calls before end; prior cost cached once',()=>{
 const f=fixture();stop(f,child(f,'a',2.5));const c=child(f,'b',1);
 assert.equal(denied(hook(f,c.payload)),false);
 const cache=()=>JSON.parse(readFileSync(join(f.d,readdirSync(f.d).find(n=>n.startsWith('.pending-budget-'))),'utf8'));
 const before=cache();usage(c.path,7,'next');assert.equal(denied(hook(f,c.payload)),true);
 assert.equal(denied(hook(f,c.payload)),true);assert.equal(cache().computed_at,before.computed_at);
 appendFileSync(c.path,JSON.stringify({type:'result',timestamp:'2099-01-01T00:00:00Z'})+'\n');
 const row=budgets(f).find(o=>o.event==='budget_stopped');assert.equal(row.meta.budget.source,'in-run');assert.equal(row.meta.budget.cost_at_crossing,10.5);assert.ok(row.at<'2099-01-01T00:00:00.000Z');stop(f,c);assert.equal(budgets(f).length,2);
});
test('parent non-dispatch calls exit without reading ledger, even broken repo/cwd',()=>{
 assert.deepEqual(hook({repo:'/does-not-exist'},{tool_name:'Bash',session_id:'s'}),{});
});
test('unbudgeted refs, hours, missing estimates and Codex never denied or recorded',()=>{
 for(const ref of ['unknown','H','U']) {
 const f=fixture();if(ref==='U') {delete f.run.items.find(i=>i.ref==='U').estimate;saveRun(f.repo,f.run);}
 const c=child(f,'a',100,ref);assert.equal(denied(hook(f,c.payload)),false);stop(f,c);assert.equal(budgets(f).length,0);
 const doc=assemble(f.repo,{now:NOW});assert.equal(doc.budget.coverage.unbudgeted.count,1);assert.equal(doc.budget.coverage.unbudgeted.usd,100);
 }
 const f=fixture();assert.deepEqual(hook(f,{...pre(),host:'codex'}),{});assert.equal(budgets(f).length,0);
});
test('streaming repeated IDs take max, partial last lines wait; existing key is not double counted',()=>{
 const f=fixture();const c=child(f,'a',2);stop(f,c);
 usage(c.path,2.5,'a');assert.equal(denied(hook(f,c.payload)),false);assert.equal(budgets(f).length,0);
 usage(c.path,1,'b','');assert.equal(denied(hook(f,c.payload)),false);assert.equal(budgets(f).length,0);
 appendFileSync(c.path,'\n');hook(f,c.payload);assert.equal(budgets(f)[0].meta.budget.cost_at_crossing,3.5);
});
for(const broken of ['prices.json','profile.json','plan','events']) test(`fail open ${broken}: one diagnostic per session on all hook paths`,()=>{
 const f=fixture();stop(f,child(f,'a',2.5));const c=child(f,'b',10);
 const path=broken==='plan'?join(f.d,'plans',`${encodeURIComponent(R)}.json`):broken==='events'?join(f.d,readdirSync(f.d).find(n=>n.startsWith('events-'))):join(f.d,broken);
 writeFileSync(path,'{broken');
 for(let i=0;i<2;i++){assert.deepEqual(hook(f,c.payload),{});assert.deepEqual(hook(f,pre()),{});stop(f,c);}
 const ds=readdirSync(f.d).filter(n=>n.startsWith('diagnostics-')).flatMap(n=>readFileSync(join(f.d,n),'utf8').trim().split('\n').map(JSON.parse));
 assert.equal(ds.filter(d=>d.kind==='budget-check-unavailable').length,1);
});
test('a broken profile after caching overrides any cached deny',()=>{
 const f=fixture();const c=child(f,'a',10);assert.equal(denied(hook(f,c.payload)),true);
 writeFileSync(join(f.d,'profile.json'),'{broken');assert.deepEqual(hook(f,c.payload),{});
});
test('profile overrides thresholds and report/status show coverage and resolved counts',()=>{
 const f=fixture();writeFileSync(join(f.d,'profile.json'),JSON.stringify({budgetSoftMultiplier:2,budgetHardMultiplier:4}));
 stop(f,child(f,'a',5));assert.equal(budgets(f).length,0);const c=child(f,'b',2);hook(f,c.payload);stop(f,c);
 assert.equal(budgets(f).length,1);assert.equal(denied(hook(f,pre())),false);
 const doc=assemble(f.repo,{now:NOW});assert.equal(doc.plans[0].budget.budget_exceeded,1);assert.equal(doc.plans[0].budget.budget_stopped,0);
 assert.deepEqual(doc.budget.coverage.budgeted,{count:2,usd:7});assert.deepEqual(doc.budget.coverage.all,{count:2,usd:7});assert.deepEqual(doc.budget.coverage.codex,{count:0,usd:0});assert.match(renderStatus(doc),/BUDGET.*exceeded=1.*stopped=0/);
});
test('retracting a budget event removes its count and does not re-fire the transition',async()=>{
 const f=fixture();const c=child(f,'a',4);stop(f,c);const row=budgets(f)[0];
 const {appendObservation}=await import('../scripts/lib/events.mjs');
 appendObservation(f.repo,{...row,revision:row.revision+1,status:'retracted'},{now:NOW});
 stop(f,c);assert.equal(budgets(f).length,0);assert.equal(assemble(f.repo,{now:NOW}).plans[0].budget.budget_exceeded,0);
});
test('unattributed dispatches remain in their open plan coverage, and diagnostics vocabulary accepts unavailable',()=>{
 const f=fixture();stop(f,child(f,'a',4,'unknown'));
 const doc=assemble(f.repo,{now:NOW});assert.equal(doc.plans[0].budget.coverage.unbudgeted.count,1);assert.equal(doc.plans[0].budget.coverage.all.usd,4);
 writeFileSync(join(f.d,'profile.json'),'{broken');hook(f,pre());
 const after=assemble(f.repo,{now:NOW});assert.equal(after.envelope.coverage.diagnostics['budget-check-unavailable'],1);assert.equal(after.envelope.coverage.diagnostics.malformed,0);
});
test('in-run cache keeps prior task cost fixed when other dispatches arrive',()=>{
 const f=fixture();stop(f,child(f,'a',2));const c=child(f,'b',0.5);hook(f,c.payload);
 stop(f,child(f,'c',6));usage(c.path,1,'extra');hook(f,c.payload);
 const row=budgets(f).find(o=>o.event==='budget_exceeded');
 // The stop writer saw the other dispatch first; the live check must not recalculate or double-charge it.
 assert.equal(row.meta.budget.cost_at_crossing,8);
 const cache=JSON.parse(readFileSync(join(f.d,readdirSync(f.d).find(n=>n.startsWith('.pending-budget-'))),'utf8'));assert.equal(cache.prior.prior,2);
 assert.equal(denied(hook(f,c.payload)),false);
});
test('diagnostic remains once per session beyond the existing 1 MiB diagnostic tail',()=>{
 const f=fixture();writeFileSync(join(f.d,'profile.json'),'{broken');hook(f,pre());
 const path=join(f.d,readdirSync(f.d).find(n=>n.startsWith('diagnostics-')));appendFileSync(path,' '.repeat(1024*1024)+'\n');hook(f,pre());
 const rows=readFileSync(path,'utf8').split('\n').filter(l=>l.trim()).map(JSON.parse);assert.equal(rows.filter(d=>d.kind==='budget-check-unavailable').length,1);
});
test('dispatch without a named task stays unbudgeted even if role fallback allocates its cost',()=>{
 const f=fixture();f.run.items.find(i=>i.ref==='T').role='js-dev';saveRun(f.repo,f.run);
 const c=child(f,'a',100,'unknown');assert.equal(denied(hook(f,c.payload)),false);stop(f,c);
 assert.equal(budgets(f).length,0);assert.equal(assemble(f.repo,{now:NOW}).budget.coverage.unbudgeted.usd,100);
});
test('a nested Agent call checks the requested task as well as the running caller',()=>{
 const f=fixture();stop(f,child(f,'u',10,'U'));const c=child(f,'t',0.5,'T');
 const result=hook(f,{...c.payload,tool_name:'Agent',tool_use_id:'nested',tool_input:{description:'Build U',subagent_type:'js-dev'}});
 assert.equal(denied(result),true);assert.match(result.hookSpecificOutput.permissionDecisionReason,/U.*10.*9/);
});
// The check never reads calibration: a task's budget is the USD range saved on the plan item at registration.
test('a corrupt calibration file does not disable the check on any hook path',()=>{
 const f=fixture();writeFileSync(join(f.d,'calibration.json'),'{broken');
 stop(f,child(f,'a',9.01));assert.equal(budgets(f).filter(o=>o.meta.budget.source==='subagent-stop').length,2);
 assert.equal(denied(hook(f,pre())),true);
 const c=child(f,'b',1);assert.equal(denied(hook(f,c.payload)),true);
 assert.deepEqual(readdirSync(f.d).filter(n=>n.startsWith('diagnostics-')),[]);
});
// The hook is wired with matcher *, so it starts for every tool call of every session. A copy of the entry file runs beside a
// stub engine whose modules leave a marker file when they are imported, so the test sees whether a call loaded the engine.
test('an uninteresting call does not load the engine; an interesting call does',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-budget-stub-')),hooks=join(dir,'hooks'),lib=join(dir,'scripts','lib'),marker=join(dir,'engine-loaded');
 mkdirSync(hooks);mkdirSync(lib,{recursive:true});copyFileSync(SCRIPT,join(hooks,'budget-hook.mjs'));
 const stub=name=>`import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name+'\n')});\n`;
 writeFileSync(join(hooks,'dispatch-hook.mjs'),stub('dispatch-hook'));
 for(const name of ['budget','paths','task-costs','transcript-usage']) writeFileSync(join(lib,`${name}.mjs`),stub(name));
 const run=payload=>{rmSync(marker,{force:true});const p=spawnSync(process.execPath,[join(hooks,'budget-hook.mjs')],{input:typeof payload==='string'?payload:JSON.stringify(payload),encoding:'utf8',cwd:dir,env:{...process.env,CLAUDE_PROJECT_DIR:dir}});
  assert.deepEqual([p.status,p.stdout,p.stderr],[0,'',''],JSON.stringify(payload));return existsSync(marker)?readFileSync(marker,'utf8').trim().split('\n'):[];};
 const quiet=[{tool_name:'Bash',session_id:'s'},{tool_name:'Read',session_id:'s',tool_input:{file_path:'x'}},{tool_name:'Agent',session_id:'s',host:'codex'},{tool_name:'Bash',agent_id:'a',session_id:'s',host:'codex'},{tool_name:'Agent'},{tool_name:'Bash',agent_id:'a'},'not json',''];
 for(const payload of quiet) assert.deepEqual(run(payload),[],`engine loaded for ${JSON.stringify(payload)}`);
 for(const payload of [{tool_name:'Agent',session_id:'s'},{tool_name:'Task',session_id:'s'},{tool_name:'Bash',agent_id:'a',session_id:'s'},{tool_name:'Agent',session_id:'s',host:'claude'}])
  assert.deepEqual(run(payload),['dispatch-hook','budget','paths','task-costs','transcript-usage'],`engine not loaded for ${JSON.stringify(payload)}`);
 // With no engine beside it at all, an interesting call cannot load it: still no decision, exit 0.
 const alone=mkdtempSync(join(tmpdir(),'dm-budget-lone-')),lone=join(alone,'budget-hook.mjs');copyFileSync(SCRIPT,lone);
 const p=spawnSync(process.execPath,[lone],{input:JSON.stringify({tool_name:'Agent',session_id:'s'}),encoding:'utf8',cwd:alone,env:{...process.env,CLAUDE_PROJECT_DIR:alone}});
 assert.deepEqual([p.status,p.stdout,p.stderr],[0,'','']);
 // The real file, imported: handleBudget is ready and synchronous, with the same guards.
 const {handleBudget}=await import('./budget-hook.mjs');
 assert.deepEqual(handleBudget({tool_name:'Bash',session_id:'s'}),{});assert.deepEqual(handleBudget({tool_name:'Agent',session_id:'s',host:'codex'}),{});
 const f=fixture();stop(f,child(f,'a',9.01));assert.equal(denied(handleBudget(pre(),{repo:f.repo,now:NOW})),true);
});
test('the denial names a guard threshold, not a cap or a limit',()=>{
 const f=fixture();stop(f,child(f,'a',9.01));const r=hook(f,pre());
 assert.equal(r.hookSpecificOutput.permissionDecisionReason,'T: task cost USD 9.01 exceeds the budget guard threshold USD 9');
});

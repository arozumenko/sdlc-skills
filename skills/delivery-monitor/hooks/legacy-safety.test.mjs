import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStop } from './dispatch-hook.mjs';
import { deliveryDir, sessionsDir, sessionPath, whoAmI } from '../scripts/lib/paths.mjs';
import { saveRun } from '../scripts/lib/plan.mjs';
import { makeRoster } from '../scripts/lib/roster.mjs';
const now = Date.parse('2026-11-18T12:00:00Z');
export function fixture(t) {
 const repo=mkdtempSync(join(tmpdir(),'capture-safety-')); t?.after(()=>rmSync(repo,{recursive:true,force:true}));
 execFileSync('git',['init','-q',repo]);
 execFileSync('git',['-C',repo,'config','--local','user.name','Capture Fixture']);
 execFileSync('git',['-C',repo,'config','--local','user.email','capture@example.invalid']);
 const d=join(repo,'.claude','agents','js-dev'); mkdirSync(d,{recursive:true}); writeFileSync(join(d,'AGENT.md'),'role');
 saveRun(repo,{run:'p/r',campaign_id:'p',run_id:'r',status:'open',version:1,roster:makeRoster(repo,['feature-development']),
 items:[{item_id:'p/r/t1',ref:'T1',level:'task'},{item_id:'p/r/t2',ref:'T2',level:'task'}]});
 mkdirSync(sessionsDir(repo),{recursive:true}); writeFileSync(sessionPath(repo,'claude','s1'),JSON.stringify({plan:'p/r'}));
 const dir=join(repo,'s1','subagents'); mkdirSync(dir,{recursive:true}); const path=join(dir,'agent-a1.jsonl');
 writeFileSync(path,[
 {type:'user',timestamp:'2026-11-18T10:00:00Z',message:{content:'Fix round for T1'}},
 {type:'assistant',timestamp:'2026-11-18T10:01:00Z',message:{id:'stable',model:'claude-sonnet-4-6',content:'done',usage:{input_tokens:10,output_tokens:3}}},
 {type:'user',timestamp:'2026-11-18T10:02:00Z',message:{content:'Also T2'}},
 {type:'assistant',timestamp:'2026-11-18T10:03:00Z',message:{id:'second',model:'claude-sonnet-4-6',content:'done',usage:{input_tokens:12,output_tokens:7}}}
 ].map(JSON.stringify).join('\n')+'\n');
 writeFileSync(path.replace('.jsonl','.meta.json'),JSON.stringify({agentType:'js-dev',description:'Fix round for T1'}));
 return {repo,payload:{session_id:'s1',agent_id:'a1',agent_transcript_path:path},now};
}
export function lines(repo) {
 return readdirSync(deliveryDir(repo)).filter(f=>f.startsWith('events-')).sort().flatMap(f=>readFileSync(join(deliveryDir(repo),f),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
}
test('bound hook observation lines match frozen pre-capture HEAD behavior', t=>{
 const f=fixture(t); handleStop(f.payload,f);
 assert.deepEqual(lines(f.repo),JSON.parse(readFileSync(new URL('../fixtures/capture-legacy-observations.json',import.meta.url),'utf8')));
});
test('unwritable capture store still writes legacy observations', t=>{
 const f=fixture(t);
 mkdirSync(join(deliveryDir(f.repo),`dispatches-${whoAmI(f.repo).slug}.jsonl`));
 handleStop(f.payload,f);
 assert.deepEqual(lines(f.repo),JSON.parse(readFileSync(new URL('../fixtures/capture-legacy-observations.json',import.meta.url),'utf8')));
});

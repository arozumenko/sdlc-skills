import { legacyCommand } from '../../fixtures/legacy-output.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deliveryDir, plansDir, runPath, sha256 } from './paths.mjs';
import { makeObservation, resolveObservations } from './events.mjs';
import { snapshotFromTranscript } from './dispatches.mjs';
import { spendReport, renderSpend } from './spend.mjs';
import { main } from '../delivery.mjs';
const mod = await import('./attribution.mjs').catch(()=>({}));
const call = (name,...args) => { assert.equal(typeof mod[name],'function',`${name} implemented`); return mod[name](...args); };
const T='2026-11-01T00:00:00.000Z', END='2026-11-02T00:00:00.000Z';
const item=(ref,run='H0001-a/r',extra={})=>({item_id:`${run}/${ref}`,ref,level:'task',...extra});
const run=(id='H0001-a/r',extra={})=>({run:id,campaign_id:id.split('/')[0],status:'open',registered_at:T,items:[item('T1',id),item('T2',id)],...extra});
const A=run(), B=run('H0002-b/r');
const cand=(r,i=0)=>({...r.items[i],plan:r.run});
const ev=(items=[],state=items.length===1?'unique':items.length?'ambiguous':'no-evidence')=>({state,items});
function repo(t,runs=[A]) {const r=mkdtempSync(join(tmpdir(),'dm-attr-'));t.after(()=>rmSync(r,{recursive:true,force:true}));mkdirSync(plansDir(r),{recursive:true});runs.forEach(p=>writeFileSync(runPath(r,p.run),JSON.stringify(p)));writeFileSync(join(deliveryDir(r),'prices.json'),JSON.stringify({models:{m:{input:1,output:0,cache_write:0,cache_read:0}}}));return r;}
function snap(id='a',description='T1',extra={}) { return snapshotFromTranscript({firstTs:T,records:1,messages:{x:{model:'m',input:1000000}},...extra},{session:'s',agent_id:id,description,now:Date.parse(T)}); }
function store(r,ss) {writeFileSync(join(deliveryDir(r),'dispatches-t.jsonl'),ss.map(JSON.stringify).join('\n')+'\n');}
function obs(extra={}) {return makeObservation({host:'claude',plan:A.run,item_id:A.items[0].item_id,ref:'T1',level:'task',event:'dispatch_ended',transition_id:'end',source:'hook',source_record_id:'claude:s:a',at:T,meta:{agent:{usage:{m:{input:1000000}}}},...extra},{now:Date.parse(T)});}
function observations(r,os) {writeFileSync(join(deliveryDir(r),'events-t.jsonl'),os.map(JSON.stringify).join('\n')+'\n');}
function enriched(r) {return call('attributeSpend',r,spendReport(r),{byPlan:true});}
function one(r) {return enriched(r).keys[0].attribution;}
async function cli(r,args) {let stdout='',stderr='';const code=await main(args,{repo:r,now:Date.parse(END),env:{DELIVERY_NO_SYNC:'1'},stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});return {stdout,stderr,code};}

test('B1 detailed resolver is additive and exposes resolved retractions',t=>{const r=repo(t);const o=obs();observations(r,[o,{...o,revision:1,status:'retracted'}]);const before=resolveObservations(r);const detailed=resolveObservations(r,{detail:true});assert.deepEqual(detailed.retracted,[{...o,revision:1,status:'retracted'}]);const {retracted,...rest}=detailed;assert.deepEqual(rest,before);assert.deepEqual(before,{active:[],conflicts:[],files:[{path:join(deliveryDir(r),'events-t.jsonl'),sha256:sha256(readFileSync(join(deliveryDir(r),'events-t.jsonl'))),bytes:readFileSync(join(deliveryDir(r),'events-t.jsonl')).length}],malformed:[],counts:{files:1,parsed:2,malformed:0,unknownVersion:0,blank:0,retries:0,superseded:1,retracted:1,conflicts:0}});});

for(const [name,os,level,evidence] of [
 ['zero allocations',[],'task','text'],['withdrawn end',[obs({status:'retracted'})],'none','legacy-withdrawn'],
 ['withdrawn start',[obs({event:'dispatched',status:'retracted'})],'task','text'],
 ['partial',[obs({status:'retracted'}),obs({item_id:'other',ref:'T2'})],'legacy-item','legacy'],
 ['reactivated',[obs({status:'retracted'}),obs({revision:1})],'legacy-item','legacy'],
 ['end conflict',[obs(),obs({raw:'different'})],'none','legacy-conflict'],
 ['start conflict',[obs({event:'dispatched'}),obs({event:'dispatched',raw:'different'})],'task','text'],
 ['retracted plus conflict',[obs({status:'retracted',item_id:'other',ref:'T2'}),obs(),obs({raw:'different'})],'none','legacy-conflict'],
 ['active plus conflict',[obs({item_id:'other',ref:'T2'}),obs(),obs({raw:'different'})],'legacy-item','legacy'],
 ['cross run',[obs(),obs({plan:B.run,item_id:B.items[0].item_id})],'legacy-item','legacy'],
 ['mixed null',[obs(),obs({item_id:null,ref:null,level:null,meta:{unattributed:true}})],'legacy-item','legacy'],
 ['plan',[obs({item_id:null,ref:null,level:null,meta:{unattributed:true}})],'legacy-plan','legacy'],
 ['several items',[obs(),obs({item_id:'other',ref:'T2'})],'legacy-item','legacy']
]) test(`B1 legacy ${name}`,t=>{const r=repo(t);store(r,[snap()]);observations(r,os);const d=enriched(r);assert.equal(one(r).level,level);assert.equal(one(r).evidence,evidence);if(level.startsWith('legacy'))assert.deepEqual([one(r).plan,one(r).item_id],[null,null]);assert.equal(d.keys[0].usd,spendReport(r).keys[0].usd);});

for(const [desc,msg,expected] of [['T1.3','','no-evidence'],['t1','','ambiguous'],['alpha','','no-evidence'],['T1 T2','H0002 T1','ambiguous'],['','H0002 T1','brief-only'],['T9','H0002 T1','brief-only'],['H0001 T9','H0002 T1','brief-only'],['H0002 T1','','text'],['H0001 H0002 T1 T2','','ambiguous']]) test(`B3 tokens/qualifier ${desc} / ${msg}`,t=>{const r=repo(t,[A,B]);store(r,[snap('a',desc,{firstUserText:msg})]);assert.equal(one(r).evidence,expected);if(expected==='text')assert.equal(one(r).plan,desc==='H0001 T9'?A.run:B.run);});
// A unique bare token is tested separately from the repeated-ref fixture.
test('B3 exact unique case and non-id ref',t=>{const r=repo(t,[run(A.run,{items:[item('T1'),item('alpha')]})]);store(r,[snap('a','t1')]);assert.equal(one(r).item_id,A.items[0].item_id);store(r,[snap('a','alpha')]);assert.equal(one(r).level,'none');});
for(const [campaigns,expected] of [
 [[A,B],['h0001','h0002']], [[A,run('H0001-other/r')],[]],
 [[A,run('H0001-a/r2')],['h0001']], [[run('plain/r')],[]],
 [[run('ABCDEFGHIJK1-a/r')],[]], [[run('T12345678901234567890123-a/r')],['t12345678901234567890123']],
 [[run('T1234567890123456789012345-a/r')],[]],
 [[A,run(B.run,{items:[item('H0001',B.run)]})],['h0002']],
 [[run(A.run,{items:[item('H0001',A.run,{level:'campaign'}),item('T1')]})],['h0001']]
]) test(`B3 derive qualifiers ${campaigns.map(r=>r.run)}`,()=>assert.deepEqual([...call('deriveQualifiers',campaigns).keys()].sort(),expected.sort()));
test('B3 qualifier without matching ref is none-matching; standalone capture only',()=>{assert.equal(call('textEvidence',['H0002','T9'],[A,B],call('deriveQualifiers',[A,B]),['h0002']).state,'none-matching');assert.deepEqual(snap('a','h0002-search T1').refs.desc,['T1']);});

for(const [name,rs,description,extra,expected] of [
 ['pre start',[run(A.run,{observation_start:END})],'T1',{},'no-evidence'],
 ['closed end',[run(A.run,{status:'closed',updated_at:T})],'T1',{},'no-evidence'],
 ['closed inside',[run(A.run,{status:'closed',updated_at:END})],'T1',{},'text'],
 ['cancelled',[run(A.run,{items:[item('T1',A.run,{cancelled:true})]})],'T1',{},'no-evidence'],
 ['unknown',[A],'T1',{firstTs:null},'unknown-start'],
 ['qualifier out',[A,run(B.run,{observation_start:END})],'H0002 T1',{},'qualifier-out-of-scope'],
 ['msg qualifier ignored for unique desc',[run(A.run,{items:[item('T3')]}),B],'T3',{firstUserText:'H0002 T1'},'text'],
 ['msg qualifier ignored for ambiguous desc',[A,B],'T1',{firstUserText:'H0002'},'ambiguous'],
 ['Q restricts branch plan',[run(A.run,{branch_prefix:'feat'}),B],'H0002 T9',{branch:'feat/unknown'},'no-evidence'],
 ['conflicted prefix',[run(A.run,{branch_prefix:'feat'})],'',{},'no-evidence']
]) test(`scope/order ${name}`,t=>{const r=repo(t,rs);const ss=[snap('a',description,extra)];if(name==='conflicted prefix')ss.push({...ss[0],branch:'feat/a'},{...ss[0],branch:'feat/b'});store(r,ss);assert.equal(one(r).evidence,expected);});

const a=cand(A), a2=cand(A,1), b=cand(B);
for(const [name,tx,br,level,evidence,flags=[]] of [
 ['same',ev([a]),ev([a]),'task','text+branch'],['disagree',ev([a]),ev([b]),'task','text',['branch-disagrees']],
 ['unique ambiguous',ev([a]),ev([a,b]),'task','text'],['unique absent',ev([a]),ev([]),'task','text'],
 ['resolve',ev([a,b]),ev([b]),'task','branch-resolves-text'],['conflict',ev([a,a2]),ev([b]),'none','conflict'],
 ['ambiguous same overlap',ev([a,a2]),ev([a,a2]),'plan','text-plan'],['ambiguous same disjoint',ev([a,a2]),ev([{...a,item_id:'third'},{...a,item_id:'fourth'}]),'plan','text-plan'],
 ['ambiguous cross overlap',ev([a,b]),ev([a,b]),'none','ambiguous'],['ambiguous cross disjoint',ev([a,a2]),ev([b,{...b,item_id:'b2'}]),'none','ambiguous'],
 ['text plan',ev([a,a2]),ev([]),'plan','text-plan'],['ambiguous text cross',ev([a,b]),ev([]),'none','ambiguous'],
 ['branch only',ev([]),ev([b]),'task','branch-only'],['branch plan',ev([]),ev([a,a2]),'plan','branch-plan'],
 ['branch cross',ev([]),ev([a,b]),'none','ambiguous'],['no evidence',ev([]),ev([]),'none','no-evidence']
]) test(`B5 ${name}`,()=>{const d=call('decide',tx,br);assert.equal(d.level,level);assert.equal(d.evidence,evidence);assert.deepEqual(d.flags,flags);});

test('B4 branch union, alias/map disagreement, deduplication, missing group, array prefixes and order',()=>{const p=run(A.run,{branch_prefix:['feat','FE'],items:[item('T1',A.run,{branch:'FEAT/a'}),item('T2')],branch_map:[{pattern:'feat',ref:'t2'},{pattern:'feat',ref:'T1'},{pattern:'feat',ref:'T{x}'}]});const expected=[A.items[0].item_id,A.items[1].item_id];assert.deepEqual(call('branchCandidates',p,'feat/a').map(i=>i.item_id),expected);assert.deepEqual(call('branchCandidates',{...p,branch_map:[...p.branch_map].reverse()},'feat/a').map(i=>i.item_id),expected);assert.deepEqual(call('branchCandidates',p,'other'),[]);});
for(const branch of ['main','master','HEAD','develop',null,'']) test(`B4 skips ${branch}`,t=>{const r=repo(t,[run(A.run,{branch_prefix:branch??'',source_epoch:{integration_ref:'develop'},items:[item('T1',A.run,{branch})]})]);store(r,[snap('a','',{branch})]);assert.equal(one(r).evidence,'no-evidence');});
for(const [rs,branch,expected] of [[[run(A.run,{branch_prefix:['feat','FE']})],'feat/unknown','branch-plan'],[[A],'feature','no-evidence'],[[run(A.run,{items:[item('T1',A.run,{branch:'feat'})]}),run(B.run,{items:[item('T1',B.run,{branch:'feat'})]})],'feat','ambiguous']]) test(`B4 branch plan/other run ${expected}`,t=>{const r=repo(t,rs);store(r,[snap('a','',{branch})]);assert.equal(one(r).evidence,expected);});
for(const source of ['desc','msg','follow']) test(`incomplete ${source} never text attribution`,t=>{
  const r=repo(t,[run(A.run,{items:[item('T1',A.run,{branch:'feat'}),item('T2',A.run)]})]);
  const many=Array.from({length:40},(_,i)=>`X${i}`).join(' ');
  const parsed={branch:'feat',...(source==='msg'?{firstUserText:many}:{}),...(source==='follow'?{followUps:[{at:T,text:many}]}:{})};
  let s=snap('a',source==='desc'?`T1 ${many}`:'T1',parsed);assert.equal(s.refs.truncated,true,'truncated by capture');
  store(r,[s]);assert.equal(one(r).evidence,'branch-only');assert.deepEqual(one(r).flags,['text-incomplete']);
  s=snap('a',source==='desc'?`T1 T2 ${many}`:'T1 T2',{...parsed,branch:null});assert.equal(s.refs.truncated,true);
  store(r,[s]);assert.equal(one(r).level,'none','same-run ambiguity cannot become text-plan when incomplete');
  const complete=snap('a','T1 T2');store(r,[complete]);assert.equal(one(r).evidence,'text-plan','control: complete evidence gives text-plan');});
test('crossed case insensitive only on item results',t=>{const r=repo(t);const s=snap();s.follow_ups=[{at:T,refs:['t2']}];store(r,[s]);assert.deepEqual(one(r).flags,['crossed']);s.refs.desc=['T1','T2'];store(r,[s]);assert.deepEqual(one(r).flags,[]);});

const malformed=[null,{items:null}, {run:'wrong'},{campaign_id:''},{status:'bad'},{items:{}},{registered_at:'bad'},{observation_start:null},{status:'closed',updated_at:'bad'},{status:'closed'},{items:[item('')]},{items:[item('T1'),item('T1')]},{items:[item('T1',A.run,{item_id:1})]},{items:[item('T1',A.run,{level:'case'})]},{items:[item('T1',A.run,{cancelled:null})]},{items:[item('T1',A.run,{branch:1})]},{branch_map:{}},{branch_map:[{pattern:'[',ref:'T1'}]},{branch_map:[{pattern:'x',ref:1}]},{branch_map:[null]},{branch_prefix:1},{branch_prefix:['x',1]},{source_epoch:{integration_ref:1}}];
for(const [i,extra] of malformed.entries()) test(`B2 malformed persisted run ${i}`,t=>{const r=repo(t);writeFileSync(runPath(r,A.run),JSON.stringify(extra===null?null:{...A,...extra}));assert.throws(()=>call('loadRunsChecked',r),/H0001-a%2Fr.json/);});
for(const kind of ['json','unreadable','shape']) test(`B6 isolates run ${kind} failure text and JSON with no partial keys`,async t=>{const r=repo(t);store(r,[snap(),snap('b')]);const baseline=renderSpend(spendReport(r));const path=runPath(r,A.run);if(kind==='unreadable'){rmSync(path);mkdirSync(path);}else writeFileSync(path,kind==='json'?'{': '{}');const d=await cli(r,['spend']);assert.equal(d.code,0);assert.equal(d.stderr,'');assert.equal(d.stdout.split('ATTRIBUTION')[0],baseline);assert.match(d.stdout,/ATTRIBUTION unavailable:.*H0001-a%2Fr.json/);const j=await cli(r,['spend','--json']);const doc=JSON.parse(j.stdout);assert.equal(j.code,0);assert.ok(doc.attribution.unavailable);assert.ok(doc.keys.every(k=>!Object.hasOwn(k,'attribution')));});

test('B6 shares, conservation, JSON shape, zero and --by validation',async t=>{const r=repo(t,[run(A.run,{items:[item('T1',A.run,{branch:'feat'})]})]);let j=JSON.parse((await cli(r,['spend','--by','plan','--json'])).stdout);assert.equal(j.attribution.attributed_share,null);assert.equal(j.attribution.attributed_share_incl_heuristic,null);store(r,[snap('a',''),snap('b','T1'),snap('c','',{branch:'feat'}),snap('d','',{branch:'feat'})]);observations(r,[obs()]);j=JSON.parse((await cli(r,['spend','--by','plan','--json'])).stdout);assert.equal(j.attribution.policy,'pr2.v1');for(const name of ['by_level','by_evidence'])assert.equal(Object.values(j.attribution[name]).reduce((n,v)=>n+v.usd,0),j.total_usd);assert.equal(j.attribution.attributed_share,.5);assert.equal(j.attribution.attributed_share_incl_heuristic,1);assert.deepEqual(j.attribution.by_plan,[{plan:A.run,recovered_item:{confident:1,heuristic:2},recovered_plan:{confident:0,heuristic:0}}]);assert.equal(Object.values(j.attribution.project).reduce((n,v)=>n+v,0)+j.attribution.by_plan.reduce((n,v)=>n+v.recovered_item.confident+v.recovered_item.heuristic+v.recovered_plan.confident+v.recovered_plan.heuristic,0),j.total_usd);assert.deepEqual(j.keys[0].attribution,{plan:null,item_id:null,level:'legacy-item',evidence:'legacy',flags:[]});assert.match((await cli(r,['spend','--by','plan'])).stdout,/BY PLAN/);for(const args of [['--by'],['--by','item']]){const d=await cli(r,['spend',...args]);assert.equal(d.code,2);assert.match(d.stderr,/USAGE/);}});

test('stability exact base stdout/stderr/code, errors and unaffected readers',async t=>{const r=repo(t);store(r,[snap()]);const d=await cli(r,['spend']);assert.deepEqual({...d,stdout:d.stdout.split('ATTRIBUTION')[0]},{stdout:renderSpend(spendReport(r)),stderr:'',code:0});const commands=[['status'],['report','--json'],['spend','--since','bad']];const stable=async()=> (await Promise.all(commands.map(a=>cli(r,a)))).map(legacyCommand);const before=await stable();writeFileSync(runPath(r,'broken/r'),'{');assert.deepEqual(await stable(),before);const cal=await cli(r,['calibrate','--dry-run','--json']);assert.equal(cal.code,2,'calibrate now reads attribution and says so');assert.match(cal.stderr,/^ATTRIBUTION-UNAVAILABLE\(/);mkdirSync(join(deliveryDir(r),'dispatches-bad.jsonl'));const failure=await cli(r,['spend']);assert.equal(failure.code,1);assert.equal(failure.stdout,'');assert.doesNotMatch(failure.stderr,/ATTRIBUTION/);});
test('semantic order, withdrawn outside cohort and rounding conservation',t=>{const r=repo(t,[A,B]);const ss=[snap('a','H0002 T1'),snap('b','T1'),snap('a','H0002 T1',{branch:'other'})];const os=[obs({source_record_id:'claude:s:b',status:'retracted'}),obs({source_record_id:'claude:s:outside',status:'retracted'})];let expected;for(const order of [ss,[...ss].reverse()]){store(r,order);observations(r,order===ss?os:[...os].reverse());const d=enriched(r);const semantic=d.keys.map(k=>k.attribution);expected??=semantic;assert.deepEqual(semantic,expected);assert.equal(d.keys.length,2);for(const name of ['by_level','by_evidence'])assert.equal(Math.round(Object.values(d.attribution[name]).reduce((n,v)=>n+v.usd,0)*1e6),Math.round(d.total_usd*1e6));}});
// The copy is the working directory, not a path argument: Node 24 takes a directory argument as a file to run and fails.
test('installed non-git copy runs the full skill suite',t=>{if(!existsSync(new URL('../../../../skills.json',import.meta.url))){t.skip('source repo only');return;}const dir=mkdtempSync(join(tmpdir(),'dm-attr-copy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));cpSync(new URL('../../',import.meta.url),join(dir,'skill'),{recursive:true});const {NODE_TEST_CONTEXT,...childEnv}=process.env;const result=spawnSync(process.execPath,['--test','--test-reporter=tap'],{cwd:join(dir,'skill'),encoding:'utf8',env:{...childEnv,DELIVERY_NO_SYNC:'1'},maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout, /# tests [1-9][0-9]{2,}/);console.log('NON-GIT COPY '+result.stdout.split('\n').filter(line=>/^# (tests|pass|fail|skipped) /.test(line)).join('; '));});

test('qualifier counts distinct case-sensitive campaign ids conservatively', () => {
  assert.deepEqual([...call('deriveQualifiers', [A, run('h0001-A/r2')]).keys()], []);
});

test('B2 duplicate decoded run file names cannot hide a competitor', t => {
  const p = run('H0001-a:r');
  const r = repo(t, [p]);
  writeFileSync(join(plansDir(r), 'H0001-a:r.json'), JSON.stringify(p));
  assert.throws(() => call('loadRunsChecked', r), /duplicate run/);
});

test('B2 missing required fields and optional malformed fields fail checked reads', t => {
  const r = repo(t);
  for (const field of ['run', 'campaign_id', 'status', 'items', 'registered_at']) {
    const p = structuredClone(A);
    delete p[field];
    writeFileSync(runPath(r, A.run), JSON.stringify(p));
    assert.throws(() => call('loadRunsChecked', r), /H0001-a%2Fr.json/);
  }
  for (const extra of [
    { source_epoch: 'x' }, { branch_map: 'x' }, { branch_prefix: 1 },
    { branch_map: [{ ref: 'T1' }] }, { branch_map: [{ pattern: 'x' }] },
    { items: [null] }, { items: [item('T1', A.run, { ref: 2 })] },
    { campaign_id: 1 }, { status: null }, { observation_start: 'November 1, 2026' },
  ]) {
    writeFileSync(runPath(r, A.run), JSON.stringify({ ...A, ...extra }));
    assert.throws(() => call('loadRunsChecked', r), /H0001-a%2Fr.json/);
  }
});

test('B3 qualified description restricts a disagreeing branch and brief', t => {
  const r = repo(t, [A, run(B.run, { items: [item('T1', B.run, { branch: 'feat' })] })]);
  store(r, [snap('a', 'H0001 T1', { firstUserText: 'H0002 T1', branch: 'feat' })]);
  assert.deepEqual(one(r), { plan: A.run, item_id: A.items[0].item_id, level: 'task', evidence: 'text', flags: [] });
});

test('B4 conflicted branch with unique prefix cannot produce branch-plan', t => {
  const r = repo(t, [run(A.run, { branch_prefix: 'feat' })]);
  store(r, [snap('a', '', { branch: 'feat/a' }), snap('a', '', { branch: 'feat/b' })]);
  assert.deepEqual(one(r), { plan: null, item_id: null, level: 'none', evidence: 'no-evidence', flags: ['branch-conflicted'] });
});

test('B5 none-matching behaves like no-evidence and prefix fallback never defeats text', () => {
  const empty = ev([], 'none-matching');
  assert.equal(call('decide', empty, ev([a])).evidence, 'branch-only');
  assert.equal(call('decide', empty, ev([a, a2])).evidence, 'branch-plan');
  assert.equal(call('decide', empty, empty, A.run).plan, A.run);
  assert.equal(call('decide', ev([b]), empty, A.run).plan, B.run);
  assert.equal(call('decide', ev([a, b]), empty, A.run).evidence, 'ambiguous');
});

test('micro-dollar rounding and mixed recovered/project buckets conserve spend', async t => {
  const r = repo(t, [run(A.run, { branch_prefix: 'feat' })]);
  const small = (id, desc, extra) => snap(id, desc, { messages: { x: { model: 'm', input: 1 } }, ...extra });
  store(r, [small('a', 'T1'), small('b', '', { branch: 'feat/unknown' }), small('c', ''), small('d', 'T1 T2')]);
  const d = JSON.parse((await cli(r, ['spend', '--json', '--by', 'plan'])).stdout);
  const micro = n => Math.round(n * 1e6);
  assert.equal(d.total_usd, 0.000004);
  for (const buckets of [d.attribution.by_level, d.attribution.by_evidence]) {
    assert.equal(Object.values(buckets).reduce((n, b) => n + micro(b.usd), 0), micro(d.total_usd));
    assert.equal(Object.values(buckets).reduce((n, b) => n + b.count, 0), d.keys.length);
  }
  const rows = d.attribution.by_plan.flatMap(p => [p.recovered_item, p.recovered_plan]);
  assert.equal(rows.reduce((n, b) => n + micro(b.confident) + micro(b.heuristic), 0) + Object.values(d.attribution.project).reduce((n, v) => n + micro(v), 0), micro(d.total_usd));
  assert.equal(d.attribution.attributed_share, 0.5);
  assert.equal(d.attribution.attributed_share_incl_heuristic, 0.75);
});

test('withdrawn keys outside the selected start cohort stay outside', t => {
  const r = repo(t);
  store(r, [snap()]);
  observations(r, [obs({ status: 'retracted' })]);
  const base = spendReport(r, { since: END });
  const d = call('attributeSpend', r, base, { byPlan: true });
  assert.deepEqual(d.keys, []);
  assert.equal(d.attribution.by_evidence['legacy-withdrawn'].count, 0);
});

test('spend invalid window and base read failure preserve exact streams and exit', async t => {
  const r = repo(t);
  const args = ['spend', '--since', END, '--until', T];
  assert.deepEqual(await cli(r, args), { code: 2, stdout: '', stderr: 'USAGE(since must precede until)\n' });
  mkdirSync(join(deliveryDir(r), 'dispatches-unreadable.jsonl'));
  const baseFailure = await cli(r, ['spend']);
  writeFileSync(runPath(r, A.run), '{');
  assert.deepEqual(await cli(r, ['spend']), baseFailure);
  assert.equal(baseFailure.code, 1);
  assert.equal(baseFailure.stdout, '');
  assert.match(baseFailure.stderr, /EISDIR/);
});

test('B2 ISO calendar dates are valid scope dates', t => {
  const r = repo(t, [run(A.run, { registered_at: '2026-11-01' })]);
  assert.equal(call('loadRunsChecked', r).runs.length, 1);
});

test('B2 impossible ISO calendar dates cannot silently roll into another month', t => {
  const r = repo(t, [run(A.run, { registered_at: '2026-02-30T00:00:00Z' })]);
  assert.throws(() => call('loadRunsChecked', r), /invalid registered_at/);
});
test('B2 null optional run fields mean absent, as plan register saves them',t=>{const r=repo(t,[run(A.run,{branch_map:null,branch_prefix:null,source_epoch:{integration_ref:null}})]);store(r,[snap()]);const {runs}=call('loadRunsChecked',r);assert.equal(runs.length,1);assert.equal(one(r).evidence,'text');});
test('brief-only text is a heuristic unless the branch confirms it',t=>{
  const r=repo(t,[run(A.run,{items:[item('T1',A.run,{branch:'feat-a1'}),item('T2',A.run)]})]);
  const s=snap('a','');s.refs.msg=['T1'];store(r,[s]);let d=one(r);assert.equal(d.evidence,'brief-only');assert.equal(d.item_id,`${A.run}/T1`);
  let e=enriched(r).attribution;assert.equal(e.attributed_share,0);assert.ok(e.attributed_share_incl_heuristic>0);
  const c=snap('a','',{branch:'feat-a1'});c.refs.msg=['T1'];store(r,[c]);assert.equal(one(r).evidence,'text+branch');
  const p=snap('a','');p.refs.msg=['T1','T2'];store(r,[p]);d=one(r);assert.equal(d.evidence,'brief-plan');assert.equal(d.level,'plan');
  e=enriched(r).attribution;assert.equal(e.attributed_share,0);
  const desc=snap('a','T1');store(r,[desc]);assert.equal(one(r).evidence,'text');});

test('B2 an unreadable plans directory makes attribution unavailable, never an empty catalogue',t=>{const r=repo(t);store(r,[snap()]);rmSync(plansDir(r),{recursive:true});const locked=join(r,'locked');mkdirSync(join(locked,'inner'),{recursive:true});symlinkSync(join(locked,'inner'),plansDir(r));chmodSync(locked,0o000);t.after(()=>{try{chmodSync(locked,0o755);}catch{}});if(process.getuid?.()===0){t.skip('root reads anything');return;}assert.throws(()=>call('loadRunsChecked',r),/plans/);assert.match(enriched(r).attribution.unavailable,/plans/);chmodSync(locked,0o755);rmSync(plansDir(r));assert.deepEqual(call('loadRunsChecked',r).runs,[]);});
// Frozen output of the base `spend` command before attribution existed (origin/main 415fbe1), for this fixture.
// One line was added since: `scope:`, which says the total covers subagent dispatches only.
const PRE_CHANGE_SPEND=`SPEND spend of dispatches started in [since, until) (all starts, including unknown-start)
  total_usd=3.000000 exact_usd=3.000000 estimated_usd=0.000000
  scope: subagent dispatches only; the orchestrating session is not counted
  item: usd=0.000000 count=0
  plan: usd=0.000000 count=0
  not-in-ledger: usd=3.000000 count=1
  unpriced=0 discrepancy=0 discrepancy_usd=0.000000 legacy_inconsistent=0 observation_conflicts=0
  legacy-start-only=0 unknown-start=0 identity-uncertain=0 model-conflict=0 evidence-conflict=0
  unattributed_share=1
FLAG unattributed spend exceeds 10%
`;
test('stability: base spend lines equal the frozen pre-change output',async t=>{const r=repo(t);writeFileSync(join(deliveryDir(r),'prices.json'),JSON.stringify({models:{m:{input:3,output:0,cache_write:0,cache_read:0}}}));store(r,[snap()]);const d=await cli(r,['spend']);assert.equal(d.code,0);assert.equal(d.stderr,'');assert.equal(d.stdout.split('ATTRIBUTION')[0].replace(/^  input .*\n/gm,''),PRE_CHANGE_SPEND);});

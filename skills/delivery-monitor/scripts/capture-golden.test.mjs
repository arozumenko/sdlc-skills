import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main } from './delivery.mjs';
import { buildFixtureRepo } from '../fixtures/security-testing/build-fixture-repo.mjs';
import { ingestDispatch, snapshotFromTranscript } from './lib/dispatches.mjs';
import { appendObservation, makeObservation, resolveObservations } from './lib/events.mjs';
const NOW=Date.parse('2026-11-18T12:00:00Z');
const source=fileURLToPath(new URL('../../../',import.meta.url));
async function run(fn,repo,args) {let stdout='',stderr='';const code=await fn(args,{repo,now:NOW,env:{DELIVERY_NO_SYNC:'1'},stdout:{write:s=>{stdout+=s;}},stderr:{write:s=>{stderr+=s;}}});return {code,stdout,stderr};}

test('golden: current fixture ledger report and calibration bytes match HEAD with dispatch store present; status only adds spend',async()=>{
  const baseline=mkdtempSync(join(tmpdir(),'dm-baseline-'));
  let fixture;
  try {
    const archive=execFileSync('git',['archive','HEAD','skills/delivery-monitor'],{cwd:source,maxBuffer:16*1024*1024});
    execFileSync('tar',['-x','-C',baseline],{input:archive});
    const old=await import(pathToFileURL(join(baseline,'skills/delivery-monitor/scripts/delivery.mjs')));
    const ds=JSON.parse(readFileSync(new URL('../fixtures/security-testing/dataset.json',import.meta.url)));
    fixture=buildFixtureRepo(ds);const {repo,planFile,head}=fixture;
    assert.equal((await run(old.main,repo,['plan','register','--from',planFile,'--id','reg-1'])).code,0);
    assert.equal((await run(old.main,repo,['backfill','--git','--head',head,'--cutoff','2026-09-17T00:00:00Z'])).code,0);
    // Five measured build dispatches make calibration exercise a real populated cell, rather than matching NO-EVENTS errors.
    const landed=resolveObservations(repo).active.filter(o=>o.event==='done' && o.level==='task').slice(0,5);
    assert.equal(landed.length,5);
    for(const [index,item] of landed.entries()) {
      const agent=`golden-${index}`, usage={'claude-sonnet-5-5':{input:(index+1)*1_000_000,output:0,cache_write:0,cache_write_1h:0,cache_read:0}};
      for(const event of ['dispatched','dispatch_ended']) {
        const observation=makeObservation({user:null,host:'claude',plan:item.plan,item_id:item.item_id,ref:item.ref,level:'task',basis:'observed',event,
          at:new Date(Date.parse(item.at)-(event==='dispatched'?10_000:5_000)).toISOString(),source:'hook',source_record_id:`claude:golden:${agent}`,
          transition_id:`${item.item_id}/${event}/${agent}`,agentId:agent,
          meta:{stage:'build',version:1,...(event==='dispatch_ended'?{agent:{turns:1,cost_usd:2*(index+1),split:1,usage,unpriced_models:[]}}:{})}}, {now:NOW});
        assert.equal(appendObservation(repo,observation,{now:NOW}).result,'EVENT');
      }
    }
    const commands=[['report'],['report','--json'],['report','--html'],['calibrate','--dry-run','--json'],['calibrate','--dry-run']];
    const before=[];
    for(const cmd of commands) before.push(await run(old.main,repo,[...cmd,...(cmd[0]==='report'?['--cutoff','2026-09-17T00:00:00Z']:[])]));
    assert.equal(before[3].code,0,before[3].stderr);
    assert.equal(JSON.parse(before[3].stdout).samples,5);
    assert.equal(JSON.parse(before[3].stdout).cells.all.n,5);
    assert.equal(before[4].code,0,before[4].stderr);
    assert.match(before[4].stdout,/CALIBRATION.*samples=5/);
    const status=await run(old.main,repo,['status']);
    ingestDispatch(repo,snapshotFromTranscript({records:2,firstTs:'2026-11-17T00:00:00Z',messages:{x:{model:'claude-sonnet-5-5',input:1000000}}},{session:'golden',agent_id:'unbound',repo,now:NOW}));
    for(const [i,cmd] of commands.entries()) assert.deepEqual(await run(main,repo,[...cmd,...(cmd[0]==='report'?['--cutoff','2026-09-17T00:00:00Z']:[])]),before[i],cmd.join(' '));
    const after=await run(main,repo,['status']);
    assert.equal(after.code,status.code);assert.equal(after.stderr,status.stderr);
    assert.equal(after.stdout.replace(/^SPEND.*\n/gm,''),status.stdout);
    assert.match(after.stdout,/^SPEND/m);
  } finally {rmSync(baseline,{recursive:true,force:true});if(fixture)rmSync(fixture.repo,{recursive:true,force:true});}
});

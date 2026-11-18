import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotFromTranscript, snapshotDigest, dispatchIndex, ingestDispatch, tombstone, gap, readDispatches, reduce, captureRefs } from './dispatches.mjs';
import { costOf } from './cost.mjs';
import { deliveryDir, sha256, whoAmI } from './paths.mjs';

const at = '2026-11-18T12:00:00.000Z';
const usage = (input = 0, output = 0, cache_write = 0, cache_write_1h = 0, cache_read = 0) => ({ input, output, cache_write, cache_write_1h, cache_read });
const message = (input, output = 0, model = 'model') => ({ model, ...usage(input, output) });
const snap = (overrides = {}) => ({ v: 'dispatch.v1', dispatch_key: 'claude:session:agent', session: 'session', agent_id: 'agent', agent_type: null, started_at: at, last_at: at, complete: true, torn: false, last_uuid: 'last', stage: 'other', branch: null, refs: { desc: [], msg: [], truncated: false }, follow_ups: [], messages: {}, anon: { records: 0, usage: {} }, records: 2, capture: 'hook', captured_at: at, writer: { kind: 'hook', pid: 1 }, ...overrides });
const value = (...snapshots) => reduce(snapshots).get('claude:session:agent');
function repo(t) { const dir = mkdtempSync(join(tmpdir(), 'dispatches-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function parsed(overrides = {}) { return { firstTs: at, lastTs: at, lastRecordAt: at, complete: true, torn: false, last_uuid: 'last', branch: 'feature/from-transcript', firstUserText: 'Build T1.11', followUps: [], records: 2, messages: { x: message(10) }, anon: { records: 0, usage: {} }, ...overrides }; }

test('reducer unions disjoint stable messages even when the second snapshot has more records', () => {
  const r = value(snap({ messages: { x: message(10) } }), snap({ records: 8, messages: { y: message(20) } }));
  assert.equal(r.usage.model.input, 30); assert.deepEqual(Object.keys(r.messages), ['x', 'y']);
});
test('same message uses component maxima and shortened snapshots cannot reduce usage', () => {
  const r = value(snap({ records: 6, messages: { x: message(10, 2), y: message(7) } }), snap({ messages: { x: message(4, 8) } }));
  assert.deepEqual(r.usage.model, usage(17, 8));
});
test('resumed unfinished transcripts retain all captured messages', () => {
  const r = value(snap({ messages: { x: message(10) } }), snap({ records: 4, complete: false, messages: { y: message(12) } }));
  assert.equal(r.usage.model.input, 22); assert.equal(r.complete, false);
});
test('anonymous usage uses per-model maxima across snapshots, never position identities', () => {
  const a = snap({ anon: { records: 1, usage: { model: usage(10, 2) } } });
  const b = snap({ records: 7, anon: { records: 2, usage: { model: usage(5, 8), other: usage(3) } } });
  const r = value(a, b, a);
  assert.deepEqual(r.anon.usage, { model: usage(10, 8), other: usage(3) });
  assert.equal(r.identity_uncertain, true); assert.deepEqual(r.exact_usage, {}); assert.equal(r.anon.records, 2);
});
test('message model conflict is flagged and the most-records snapshot decides its model', () => {
  const r = value(snap({ messages: { x: message(10, 2, 'first') } }), snap({ records: 8, messages: { x: message(3, 4, 'second') } }));
  assert.equal(r.model_conflict, true); assert.equal(r.messages.x.model, 'second'); assert.deepEqual(r.usage.second, usage(10, 4)); assert.equal(r.usage.first, undefined);
});
test('reducer is independent of arrival order including equal-record conflicts', () => {
  const a = snap({ agent_type: 'qa', branch: 'branch-a', messages: { z: message(5, 1, 'first') } });
  const b = snap({ agent_type: 'dev', stage: 'build', branch: 'branch-b', messages: { z: message(2, 8, 'second'), a: message(4) } });
  const c = snap({ records: 9, stage: null, refs: { desc: ['T2'], msg: [], truncated: false } });
  for (const order of [[a,b,c], [c,b,a], [b,a,c], [a,c,b]]) assert.deepEqual(value(...order), value(a,b,c));
});
test('scalar evidence resolves field by field with the canonical content hash as tie break', () => {
  const a = snap({ agent_type: 'qa', branch: null, stage: 'review' });
  const b = snap({ agent_type: 'dev', branch: 'work', stage: 'build' });
  const c = snap({ records: 20, agent_type: null, branch: null, stage: 'gate' });
  const r = value(a,b,c), winner = snapshotDigest(a) < snapshotDigest(b) ? a : b;
  assert.equal(r.agent_type, winner.agent_type); assert.equal(r.branch, 'work'); assert.equal(r.stage, 'gate'); assert.equal(r.evidence_conflict, true); assert.deepEqual(r.evidence_conflicts, ['agent_type', 'stage']);
});
test('list evidence unions, sorts and caps without empty snapshots erasing evidence', () => {
  const a = snap({ refs: { desc: ['T2', 'T1'], msg: ['M5'], truncated: false }, follow_ups: [{ at, refs: ['T2'] }] });
  const b = snap({ records: 9, refs: { desc: Array.from({ length: 31 }, (_, i) => `Z${i}`), msg: [], truncated: false }, follow_ups: [] });
  const r = value(a,b); assert.equal(r.refs.desc.length, 32); assert.equal(r.refs.truncated, true); assert.deepEqual(r.refs.msg, ['M5']); assert.deepEqual(r.follow_ups, a.follow_ups);
});
test('started_at is earliest and last_at latest independent of winner', () => {
  const r = value(snap({ started_at: '2026-11-17T00:00:00.000Z', last_at: at }), snap({ records: 10, started_at: at, last_at: '2026-11-19T00:00:00.000Z' }));
  assert.equal(r.started_at, '2026-11-17T00:00:00.000Z'); assert.equal(r.last_at, '2026-11-19T00:00:00.000Z');
});
for (const [name, delta] of [['resumed user-only suffix', { records: 3, complete: false, last_uuid: 'resumed' }], ['torn suffix', { complete: false, torn: true }], ['different last uuid at equal records', { last_uuid: 'other' }], ['different record count', { records: 3 }]]) {
  test(`completion stays false for ${name}`, () => assert.equal(value(snap(), snap(delta)).complete, false));
}
test('completion is true only for agreeing complete snapshots', () => assert.equal(value(snap(), snap({ captured_at: '2026-11-19T00:00:00.000Z' })).complete, true));
test('tombstone excludes all snapshots including snapshots that arrive later', () => {
  const a = snap(), removal = { v: 'dispatch.v1', dispatch_key: a.dispatch_key, retracted: true, reason: 'withdrawn', at };
  assert.equal(reduce([a, removal, snap({ records: 9 })]).size, 0);
});
test('snapshot preserves stable requestId fallback supplied by parser', () => {
  const s = snapshotFromTranscript(parsed({ messages: { 'request-fallback': message(12) } }), { session: 'session', agent_id: 'agent', now: Date.parse(at) });
  assert.deepEqual(s.messages, { 'request-fallback': message(12) }); assert.equal(s.dispatch_key, 'claude:session:agent');
});
test('snapshot price counters support distinct five-minute and one-hour cache writes', () => {
  const p = parsed({ messages: { x: { model: 'model', ...usage(10, 2, 100, 200, 3) } } });
  const s = snapshotFromTranscript(p, { session: 'session', agent_id: 'agent', now: Date.parse(at) });
  assert.equal(costOf(value(s).usage, { model: { input: 1, output: 2, cache_write: 1.25, cache_write_1h: 2, cache_read: 0.1 } }).cost_usd, 0.000539);
  assert.equal('cost_usd' in s, false);
});
test('capture grammar accepts punctuation and refuses embedded sensitive token forms', () => {
  assert.deepEqual(captureRefs('T1.11, (M5) #1208. TASK-023 12 1a'), { refs: ['#1208', '12', '1a', 'M5', 'T1.11', 'TASK-023'], truncated: false });
  assert.deepEqual(captureRefs('x@T12.com https://host/T12 key=T12 ./T12 /T12 C:\\T12 abcdefghij123456789012345 T1234567890123456789012345 1'), { refs: [], truncated: false });
});
test('capture grammar has a deduplicated field cap', () => {
  const refs = captureRefs(Array.from({ length: 40 }, (_, i) => `T${i}`).join(' ')); assert.equal(refs.refs.length, 32); assert.equal(refs.truncated, true);
});
test('capture grammar strips markdown and Unicode surrounding punctuation without mining fragments', () => {
  assert.deepEqual(captureRefs('**T1** —M5— _TASK-023_ T1,T2'), { refs: ['M5', 'T1', 'TASK-023'], truncated: false });
});
test('profile switches disable refs, follow-up refs and transcript branch; prompts default off', (t) => {
  const dir = repo(t); mkdirSync(deliveryDir(dir), { recursive: true }); writeFileSync(join(deliveryDir(dir), 'profile.json'), JSON.stringify({ captureRefs: false, captureBranch: false }));
  const s = snapshotFromTranscript(parsed({ followUps: [{ at, text: 'T2' }] }), { session: 'session', agent_id: 'agent', description: 'Review T3', repo: dir, now: Date.parse(at) });
  assert.deepEqual(s.refs, { desc: [], msg: [], truncated: false }); assert.deepEqual(s.follow_ups, []); assert.equal(s.branch, null); assert.equal('prompts' in s, false);
});
test('enabled capture uses transcript evidence and opt-in description prompts', (t) => {
  const dir = repo(t); mkdirSync(deliveryDir(dir), { recursive: true }); writeFileSync(join(deliveryDir(dir), 'profile.json'), JSON.stringify({ capturePrompts: true }));
  const s = snapshotFromTranscript(parsed({ followUps: [{ at, text: 'Review T2' }] }), { session: 'session', agent_id: 'agent', agent_type: 'qa', description: 'Review T3', repo: dir, capture: 'transcript-backfill', now: Date.parse(at) });
  assert.equal(s.branch, 'feature/from-transcript'); assert.deepEqual(s.refs.desc, ['T3']); assert.deepEqual(s.refs.msg, ['T1.11']); assert.deepEqual(s.follow_ups, [{ at, refs: ['T2'] }]); assert.equal(s.stage, 'review'); assert.equal(s.prompts, 'Review T3'); assert.equal(s.writer.kind, 'cli');
});
test('snapshot keeps last record time even for incomplete transcripts', () => {
  const s = snapshotFromTranscript(parsed({ lastTs: null, lastRecordAt: at, complete: false }), { session: 'session', agent_id: 'agent', now: Date.parse(at) }); assert.equal(s.last_at, at); assert.equal(s.complete, false);
});
test('indexed backfill admission deduplicates facts regardless of writer metadata and returns states', (t) => {
  const dir = repo(t), a = snap(); assert.deepEqual(ingestDispatch(dir, a), { result: 'ingested' }); assert.deepEqual(ingestDispatch(dir, snap({ captured_at: '2026-11-19T00:00:00.000Z', writer: { kind: 'cli', pid: 8 }, capture: 'transcript-backfill' }), {index:dispatchIndex(readDispatches(dir))}), { result: 'unchanged' });
  assert.equal(readDispatches(dir).snapshots.length, 1); tombstone(dir, a.dispatch_key, 'wrong dispatch', { now: Date.parse(at) }); assert.deepEqual(ingestDispatch(dir, a, {index:dispatchIndex(readDispatches(dir))}), { result: 'tombstoned' }); assert.equal(reduce(readDispatches(dir)).size, 0);
});
test('gap evidence stays recorded and is resolved by a later stored snapshot', (t) => {
  const dir = repo(t), a = snap(); gap(dir, a.dispatch_key, { now: Date.parse(at) }); gap(dir, a.dispatch_key, { now: Date.parse(at) }); assert.equal(readDispatches(dir).gaps.size, 1); ingestDispatch(dir, a); const r = readDispatches(dir); assert.equal(r.gaps.has(a.dispatch_key), true); assert.equal(reduce(r).has(a.dispatch_key), true);
});
test('reader validates records and exposes file hashes without admitting malformed usage', (t) => {
  const dir = repo(t); mkdirSync(deliveryDir(dir), { recursive: true }); const file = join(deliveryDir(dir), 'dispatches-test.jsonl');
  writeFileSync(file, [JSON.stringify(snap()), '{torn', JSON.stringify(snap({ messages: { x: { ...message(1), input: -1 } } })), JSON.stringify(snap({ dispatch_key: 'claude:other:agent' }))].join('\n'));
  const r = readDispatches(dir); assert.equal(r.snapshots.length, 1); assert.equal(r.malformed, 3); assert.equal(r.files[0].sha256, sha256(readFileSync(file))); assert.equal(r.files[0].bytes, readFileSync(file).length);
});
test('writes reject malformed identities, unsafe usage and blank retraction reasons', (t) => {
  const dir = repo(t); assert.throws(() => ingestDispatch(dir, snap({ messages: { x: { ...message(1), input: Infinity } } })), /SCHEMA-INVALID/); assert.throws(() => ingestDispatch(dir, snap({ dispatch_key: 'claude:wrong:agent' })), /SCHEMA-INVALID/); assert.throws(() => tombstone(dir, 'bad-key', 'reason'), /SCHEMA-INVALID/); assert.throws(() => tombstone(dir, snap().dispatch_key, '   '), /SCHEMA-INVALID/);
});
test('model identifiers that match inherited object properties are priced as ordinary own keys', () => {
  try {
    const r = value(snap({ messages: { x: message(7, 3, 'constructor') } }));
    assert.equal(Object.hasOwn(r.exact_usage, 'constructor'), true); assert.equal(Object.hasOwn(r.usage, 'constructor'), true); assert.deepEqual(r.usage.constructor, usage(7, 3));
  } finally { for (const k of ['input', 'output', 'cache_write', 'cache_write_1h', 'cache_read']) delete Object[k]; }
});
test('append recovers after a torn final line without losing the next valid snapshot', (t) => {
  const dir = repo(t); ingestDispatch(dir, snap()); const file = readDispatches(dir).files[0].path;
  writeFileSync(file, `${readFileSync(file, 'utf8')}{torn`); ingestDispatch(dir, snap({ records: 4 }));
  const r = readDispatches(dir); assert.equal(r.snapshots.length, 2); assert.equal(r.malformed, 1);
});
test('reader rejects invalid UTF-8 even inside otherwise valid JSON string evidence', (t) => {
  const dir = repo(t); mkdirSync(deliveryDir(dir), { recursive: true });
  const line = JSON.stringify(snap({ branch: 'invalid-byte' }));
  writeFileSync(join(deliveryDir(dir), 'dispatches-test.jsonl'), Buffer.concat([Buffer.from(line.slice(0, line.indexOf('invalid-byte'))), Buffer.from([0xff]), Buffer.from(line.slice(line.indexOf('invalid-byte') + 'invalid-byte'.length))]));
  const r = readDispatches(dir); assert.equal(r.snapshots.length, 0); assert.equal(r.malformed, 1);
});
test('snapshot falls back to first user stage when description contains only a reference', () => {
  const s = snapshotFromTranscript(parsed(), { session: 'session', agent_id: 'agent', description: 'T1.11' });
  assert.equal(s.stage, 'build');
});
test('capture and reduction mark truncation when the literal 32-entry cap is hit', () => {
  const refs = Array.from({ length: 32 }, (_, i) => `T${i}`);
  assert.equal(captureRefs(refs.join(' ')).truncated, true);
  assert.equal(value(snap({ refs: { desc: refs, msg: [], truncated: false } })).refs.truncated, true);
  assert.equal(value(snap({ follow_ups: refs.map((ref) => ({ at, refs: [ref] })) })).refs.truncated, true);
});
test('schema admission rejects undeclared text fields at every evidence level', (t) => {
  const dir = repo(t);
  for (const extra of [
    { raw: 'private@example.com' }, { cost_usd: 1 }, { refs: { desc: [], msg: [], truncated: false, text: 'secret' } },
    { messages: { x: { ...message(1), content: 'secret' } } },
    { anon: { records: 1, usage: { model: { ...usage(1), content: 'secret' } } } },
    { follow_ups: [{ at, refs: ['T1'], text: 'secret' }] }, { writer: { kind: 'hook', pid: 1, text: 'secret' } },
  ]) assert.throws(() => ingestDispatch(dir, snap(extra)), /SCHEMA-INVALID/);
});
test('schema admission rejects coercible numeric session and agent identity fields', (t) => {
  const dir = repo(t);
  assert.throws(() => ingestDispatch(dir, snap({ session: 1, dispatch_key: 'claude:1:agent' })), /SCHEMA-INVALID/);
  assert.throws(() => ingestDispatch(dir, snap({ agent_id: 1, dispatch_key: 'claude:session:1' })), /SCHEMA-INVALID/);
});
test('reducer ignores malformed tombstones rather than suppressing valid snapshot spend', () => {
  const malformed = { v: 'dispatch.v1', dispatch_key: snap().dispatch_key, retracted: true };
  assert.equal(reduce([snap(), malformed]).size, 1);
});
test('ingestion captures unchanged evidence once after a later gap, then resumes idempotent retries', (t) => {
  const dir = repo(t), before = snap({ captured_at: '2026-11-18T10:00:00.000Z' });
  ingestDispatch(dir, before);
  gap(dir, before.dispatch_key, { now: Date.parse('2026-11-18T11:00:00Z') });
  assert.equal(readDispatches(dir).gapTimes?.get(before.dispatch_key), '2026-11-18T11:00:00.000Z');
  assert.equal(ingestDispatch(dir, snap()).result, 'ingested');
  assert.equal(ingestDispatch(dir, snap(), {index:dispatchIndex(readDispatches(dir))}).result, 'unchanged');
  assert.equal(readDispatches(dir).snapshots.length, 2);
});

test('v2 compact encoding is at most one third of v1 for 100 messages', (t) => {
  const dir = repo(t), messages = Object.fromEntries(Array.from({length:100}, (_,i)=>[`msg-${String(i).padStart(36,'0')}`, message(100+i,20,'claude-sonnet-5-5')]));
  const old = snap({messages}), before = Buffer.byteLength(JSON.stringify(old));
  ingestDispatch(dir, old);
  const line = JSON.parse(readFileSync(readDispatches(dir).files[0].path,'utf8')), after = Buffer.byteLength(JSON.stringify(line));
  console.log(`SIZE 100 messages before=${before} after=${after}`);
  assert.equal(line.v,'dispatch.v2'); assert.equal(line.models[0],'claude-sonnet-5-5');
  assert.ok(Object.keys(line.messages).every(k=>/^[a-f0-9]{12}$/.test(k)));
  assert.ok(after <= before/3, `${after} > ${before}/3`);
  assert.equal([...reduce(readDispatches(dir)).values()][0].usage['claude-sonnet-5-5'].output,2000);
});
test('hook admission appends retries and renewed gaps without scanning history', (t) => {
  const dir=repo(t), a=snap();
  ingestDispatch(dir,a); ingestDispatch(dir,a);
  gap(dir,a.dispatch_key,{now:1}); gap(dir,a.dispatch_key,{now:3});
  assert.equal(readDispatches(dir).snapshots.length,2);
  assert.equal(readDispatches(dir).gapTimes.get(a.dispatch_key),new Date(3).toISOString());
});
test('all ingested permutations give the same usage, dollars and evidence despite retry provenance', (t) => {
  const a=snap({agent_type:'dev',messages:{x:message(10,2,'a')}}), b=snap({agent_type:'qa',messages:{x:message(3,8,'b')}});
  // Force provenance hashes to disagree with content ranking; old admission kept the first retry.
  const target = snapshotDigest(a) < snapshotDigest(b) ? 1 : -1;
  for(let pid=1;pid<10000;pid++) {
    a.writer={kind:'hook',pid};
    const rawOrder=sha256(JSON.stringify(a)) < sha256(JSON.stringify(b)) ? -1 : 1;
    if(rawOrder===target) break;
  }
  const retry={...a,capture:'transcript-backfill',writer:{kind:'cli',pid:999},captured_at:'2026-11-19T00:00:00Z'};
  function permutations(xs) { return xs.length ? xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>i!==j)).map(rest=>[x,...rest])) : [[]]; }
  let expected;
  for(const order of permutations([a,b,retry])) {
    const dir=repo(t); order.forEach(s=>ingestDispatch(dir,s));
    const result=[...reduce(readDispatches(dir)).values()][0];
    const actual={result, dollars:costOf(result.usage,{a:{input:1,output:2},b:{input:2,output:3}})};
    assert.equal(result.agent_type,snapshotDigest(a)<snapshotDigest(b)?a.agent_type:b.agent_type);
    expected ??= actual; assert.deepEqual(actual,expected);
  }
});
test('scale: 5000 snapshots of 100 messages, bounded hook append', (t) => {
  const dir=repo(t), messages=Object.fromEntries(Array.from({length:100},(_,i)=>[`message-${i}`,message(i,2)]));
  ingestDispatch(dir,snap({messages}));
  const storeFile=join(deliveryDir(dir),`dispatches-${whoAmI(dir).slug}.jsonl`);
  const compact=JSON.parse(readFileSync(storeFile,'utf8'));
  const snapshots=Array.from({length:5000},(_,i)=>({...compact,session:`s${i%300}`,dispatch_key:`claude:s${i%300}:agent`}));
  mkdirSync(deliveryDir(dir),{recursive:true});
  writeFileSync(storeFile, snapshots.map(JSON.stringify).join('\n')+'\n');
  let start=performance.now(); ingestDispatch(dir,snap({messages})); const hook=performance.now()-start;
  start=performance.now(); const reduced=reduce(readDispatches(dir)); const elapsed=performance.now()-start;
  console.log(`SCALE read+reduce=${elapsed.toFixed(1)}ms hook=${hook.toFixed(1)}ms`);
  assert.equal(reduced.size,301); assert.ok(hook<200,`hook ${hook}ms`); assert.ok(elapsed<3000,`reduce ${elapsed}ms`);
});
test('v1 and v2 readers reconcile one stable identity across schema versions', (t)=>{
 const dir=repo(t), a=snap({messages:{x:message(5)}});
 ingestDispatch(dir,a);
 const file=readDispatches(dir).files[0].path;
 writeFileSync(file,readFileSync(file,'utf8')+JSON.stringify({...a,messages:{x:message(8)}})+'\n');
 const r=[...reduce(readDispatches(dir)).values()][0];
 assert.equal(r.usage.model.input,8); assert.equal(Object.keys(r.messages).length,1);
});
test('optional malformed evidence is dropped field by field without losing valid evidence', ()=>{
 const s=snapshotFromTranscript(parsed({branch:42,last_uuid:{},followUps:[{at:'bad',text:'T2'},{at,text:'T3'}]}),{session:'s',agent_id:'a',agent_type:42});
 assert.equal(s.branch,null); assert.equal(s.last_uuid,null); assert.equal(s.agent_type,null);
 assert.deepEqual(s.follow_ups,[{at:null,refs:['T2']},{at,refs:['T3']}].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
});

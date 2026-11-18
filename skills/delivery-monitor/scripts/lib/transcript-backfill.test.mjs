import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, symlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDispatches, reduce, gap, tombstone } from './dispatches.mjs';
import { deliveryDir } from './paths.mjs';
import { handleStop } from '../../hooks/dispatch-hook.mjs';
const recovery = await import('./transcript-backfill.mjs').catch(() => ({}));
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'transcript-backfill-')));
const at = '2026-11-18T10:00:00.000Z';
const later = '2026-11-18T11:00:00.000Z';
function fixture() { const repo = tmp(), config = tmp(), env = { CLAUDE_CONFIG_DIR: config }; const root = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-')); mkdirSync(root, { recursive: true }); return { repo, config, root, env }; }
const records = (date = at) => [ { type: 'user', uuid: 'u', timestamp: date, gitBranch: 'transcript/branch', message: { content: 'Build T1.11' } }, { type: 'assistant', uuid: 'a', timestamp: date, message: { id: 'm1', model: 'claude-sonnet-5-5', content: 'done', usage: { input_tokens: 7, output_tokens: 9 } } } ];
function child(f, id, { prefix = true, rows = records(), torn = false, meta } = {}) { const dir = join(f.root, 's1', 'subagents'); mkdirSync(dir, { recursive: true }); const p = join(dir, `${prefix ? 'agent-' : ''}${id}.jsonl`); writeFileSync(p, rows.map(JSON.stringify).join('\n') + '\n' + (torn ? '{"type":' : '')); if (id) writeFileSync(p.replace('.jsonl', '.meta.json'), JSON.stringify({agentId:id,...meta})); return p; }
function parent(f) { const p = join(f.root, 's1.jsonl'); writeFileSync(p, [
 { type: 'assistant', timestamp: at, message: { content: [ { type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'js-dev', description: 'Build T2.12' } }, { type: 'tool_use', id: 't2', name: 'Task', input: { subagent_type: 'qa', description: 'Review T3' } }, { type: 'tool_use', id: 't3', name: 'Agent', input: {} } ] } },
 { type: 'user', timestamp: later, toolUseResult: { agentId: 'a1' }, message: { content: [ { type: 'tool_result', tool_use_id: 't1', content: 'done' } ] } },
 { type: 'user', timestamp: later, toolUseResult: { agentId: 'missing' }, message: { content: [ { type: 'tool_result', tool_use_id: 't2', content: 'done' } ] } },
 ].map(JSON.stringify).join('\n') + '\n'); return p; }
function api(name) { assert.equal(typeof recovery[name], 'function', `${name} export exists`); return recovery[name]; }

test('children-first recovery imports orphan children, both filename forms, metadata and torn evidence; rerun is unchanged', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1', { meta: { agentType: 'js-dev', description: 'Build T1.11' } }); child(f, 'a2', { prefix: false, torn: true }); child(f, '');
 const first = backfill(f.repo, { env: f.env, now: Date.parse(later) });
 assert.deepEqual(first, { children: 3, ingested: 2, unchanged: 0, tombstoned: 0, unidentified: 1, unreadable: 0, failed: 0, parents: 0, interrupted: 0, 'no-child': 0 });
 const all = reduce(readDispatches(f.repo)); assert.equal(all.size, 2); assert.equal(all.get('claude:s1:a1').branch, 'transcript/branch'); assert.equal(all.get('claude:s1:a1').agent_type, 'js-dev'); assert.deepEqual(all.get('claude:s1:a1').refs.desc, ['T1.11']); assert.equal(all.get('claude:s1:a2').torn, true);
 const again = backfill(f.repo, { env: f.env }); assert.equal(again.unchanged, 2); assert.equal(again.ingested, 0);
});
test('parent joins enrich orphan child evidence and count interrupted and result-without-child coverage', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1'); parent(f);
 const result = backfill(f.repo, { env: f.env }); assert.equal(result.parents, 1); assert.equal(result.interrupted, 1); assert.equal(result['no-child'], 1); assert.equal(result.ingested, 1);
 const captured = reduce(readDispatches(f.repo)).get('claude:s1:a1'); assert.equal(captured.agent_type, 'js-dev'); assert.deepEqual(captured.refs.desc, ['T2.12']);
});
test('since uses last record time after mtime prefilter, includes boundary, dry run leaves no store', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); const old = child(f, 'old', { rows: records('2026-11-17T10:00:00Z') }); utimesSync(old, new Date(later), new Date(later)); const boundary = child(f, 'boundary'); utimesSync(boundary, new Date(later), new Date(later));
 const result = backfill(f.repo, { env: f.env, since: at, dryRun: true }); assert.equal(result.children, 2); assert.equal(result.ingested, 1); assert.equal(existsSync(deliveryDir(f.repo)), false);
 assert.throws(() => backfill(f.repo, { env: f.env, since: 'yesterday-ish' }), /USAGE/);
});
test('tombstoned children stay absent and hook/backfill order preserves one dispatch key', () => {
 const backfill = api('backfillTranscripts'); for (const order of ['hook-first', 'backfill-first']) { const f = fixture(), p = child(f, 'a1'); const hook = () => handleStop({ session_id: 's1', agent_id: 'a1', agent_transcript_path: p }, { repo: f.repo }); if (order === 'hook-first') hook(); backfill(f.repo, { env: f.env }); if (order === 'backfill-first') hook(); assert.equal(reduce(readDispatches(f.repo)).size, 1); assert.equal(readDispatches(f.repo).snapshots.length, order === 'hook-first' ? 1 : 2); }
 const f = fixture(); child(f, 'a1'); tombstone(f.repo, 'claude:s1:a1', 'withdraw'); assert.equal(backfill(f.repo, { env: f.env }).tombstoned, 1); assert.equal(reduce(readDispatches(f.repo)).size, 0);
});
test('coverage unions children and parent results, resolves gaps only through stored snapshots, and never writes', () => {
 const coverage = api('coverage'), backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1'); child(f, 'orphan', { prefix: false }); parent(f); gap(f.repo, 'claude:s1:a1'); gap(f.repo, 'claude:s1:missing');
 const before = readDispatches(f.repo).files.map((x) => x.sha256); const c = coverage(f.repo, { env: f.env });
 assert.deepEqual(c, { identities: 3, in_store: 0, missing_from_store: 3, gaps_resolved: 0, gaps_unresolved: 2, interrupted: 1, unreadable_children: 0, oldest_transcript_date: at }); assert.deepEqual(readDispatches(f.repo).files.map((x) => x.sha256), before);
 backfill(f.repo, { env: f.env }); const after = coverage(f.repo, { env: f.env }); assert.equal(after.in_store, 2); assert.equal(after.missing_from_store, 1); assert.equal(after.gaps_resolved, 1); assert.equal(after.gaps_unresolved, 1);
});
test('recovery unwinds git worktree path before locating Claude project slug', () => {
 const backfill = api('backfillTranscripts'), f = fixture(), worktree = join(tmp(), 'work'); const env = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@local', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@local' };
 execFileSync('git', ['init', '-q', f.repo]); execFileSync('git', ['-C', f.repo, 'commit', '--allow-empty', '-qm', 'fixture'], { env }); execFileSync('git', ['-C', f.repo, 'worktree', 'add', '-qb', 'test-worktree', worktree]); child(f, 'a1');
 const result = backfill(worktree, { env: f.env }); assert.equal(result.ingested, 1); assert.equal(readDispatches(f.repo).snapshots.length, 1);
});
test('unreadable child is counted rather than aborting recovery or coverage', () => {
 const backfill = api('backfillTranscripts'), coverage = api('coverage'), f = fixture(); const p = child(f, 'a1'); symlinkSync('/definitely/missing/transcript', p.replace('agent-a1', 'agent-broken')); assert.equal(backfill(f.repo, { env: f.env }).unreadable, 1); assert.equal(coverage(f.repo, { env: f.env }).unreadable_children, 1);
});

test('parent agent identity disambiguates the bare filename beginning with agent-', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); const file=child(f, 'a1'); writeFileSync(file.replace('.jsonl','.meta.json'),'{}'); const p = parent(f); writeFileSync(p, readFileSync(p, 'utf8').replace('"agentId":"a1"', '"agentId":"agent-a1"'));
 backfill(f.repo, { env: f.env }); const keys = [...reduce(readDispatches(f.repo)).keys()]; assert.deepEqual(keys, ['claude:s1:agent-a1']);
});
test('coverage describes captured evidence even after its spend is tombstoned', () => {
 const coverage = api('coverage'), backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1'); gap(f.repo, 'claude:s1:a1'); backfill(f.repo, { env: f.env }); tombstone(f.repo, 'claude:s1:a1', 'withdraw spend');
 const result = coverage(f.repo, { env: f.env }); assert.equal(result.in_store, 1); assert.equal(result.missing_from_store, 0); assert.equal(result.gaps_resolved, 1); assert.equal(result.gaps_unresolved, 0);
});

test('dry-run admission ignores snapshot property order just like the shared store writer', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1'); backfill(f.repo, { env: f.env });
 const file = readDispatches(f.repo).files[0].path; const record = JSON.parse(readFileSync(file, 'utf8')); writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(record).reverse())) + '\n');
 const preview = backfill(f.repo, { env: f.env, dryRun: true }); const actual = backfill(f.repo, { env: f.env }); assert.equal(preview.unchanged, 1); assert.deepEqual(preview, actual);
});
test('since accepts the Unix epoch boundary without treating it as absent', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); child(f, 'old', { rows: records('1969-12-31T23:59:59Z') }); child(f, 'boundary', { rows: records('1970-01-01T00:00:00Z') });
 const result = backfill(f.repo, { env: f.env, since: '1970-01-01T00:00:00Z', dryRun: true }); assert.equal(result.ingested, 1);
});

test('parent descriptions enrich metadata refs instead of erasing either source', () => {
 const backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1', { meta: { agentType: 'js-dev', description: 'Build M5' } }); parent(f);
 backfill(f.repo, { env: f.env }); const captured = reduce(readDispatches(f.repo)).get('claude:s1:a1'); assert.deepEqual(captured.refs.desc, ['M5', 'T2.12']);
});

test('a gap after captured evidence stays unresolved until a later capture, even with unchanged usage', () => {
 const coverage = api('coverage'), backfill = api('backfillTranscripts'), f = fixture(); child(f, 'a1');
 backfill(f.repo, { env: f.env, now: Date.parse(at) }); gap(f.repo, 'claude:s1:a1', { now: Date.parse(later) });
 const open = coverage(f.repo, { env: f.env }); assert.equal(open.in_store, 1); assert.equal(open.gaps_resolved, 0); assert.equal(open.gaps_unresolved, 1);
 assert.equal(backfill(f.repo, { env: f.env, now: Date.parse(later)+1, dryRun: true }).ingested, 1);
 backfill(f.repo, { env: f.env, now: Date.parse(later)+1 }); const resolved = coverage(f.repo, { env: f.env }); assert.equal(resolved.gaps_resolved, 1); assert.equal(resolved.gaps_unresolved, 0);
 assert.equal(backfill(f.repo, { env: f.env, now: Date.parse(later) + 1000 }).unchanged, 1);
});

test('renewed gap after resolved snapshot is unresolved', () => {
 const f=fixture(); child(f,'a1',{meta:{agentId:'a1'}});
 gap(f.repo,'claude:s1:a1',{now:1});
 api('backfillTranscripts')(f.repo,{env:f.env,now:2});
 gap(f.repo,'claude:s1:a1',{now:3});
 assert.equal(api('coverage')(f.repo,{env:f.env}).gaps_unresolved,1);
});
test('ambiguous orphan is unidentified; corroborated bare agent-a1 matches hook identity', () => {
 const f=fixture(); const uncorroborated=child(f,'a1'); writeFileSync(uncorroborated.replace('.jsonl','.meta.json'),'{}'); assert.equal(api('backfillTranscripts')(f.repo,{env:f.env}).unidentified,1);
 const g=fixture(), p=child(g,'a1',{meta:{agentId:'agent-a1'}});
 handleStop({session_id:'s1',agent_id:'agent-a1',agent_transcript_path:p},{repo:g.repo});
 api('backfillTranscripts')(g.repo,{env:g.env});
 assert.deepEqual([...reduce(readDispatches(g.repo)).keys()],['claude:s1:agent-a1']);
});
test('invalid optional follow-up timestamp is dropped and bad child does not stop siblings', () => {
 const f=fixture();
 child(f,'bad',{meta:{agentId:'bad'},rows:records().map(r=>r.type==='assistant'?{...r,message:{...r.message,usage:{output_tokens:1.5}}}:r)});
 child(f,'good',{meta:{agentId:'good'},rows:[...records(),{type:'user',timestamp:'broken',message:{content:'Review T2'}}]});
 let stderr=''; const r=api('backfillTranscripts')(f.repo,{env:f.env,stderr:{write:s=>stderr+=s}});
 assert.equal(r.failed,1); assert.equal(r.ingested,1); assert.match(stderr,/agent-bad.jsonl/);
 const s=[...reduce(readDispatches(f.repo)).values()][0];
 assert.equal(s.follow_ups[0].at,null);
});

const withId = (id, msg) => records().map((r) => ({ ...r, agentId: id, ...(r.message?.id ? { message: { ...r.message, id: msg } } : {}) }));
const outputs = (repo) => [...reduce(readDispatches(repo)).values()].map((v) => Object.values(v.usage ?? {}).reduce((n, u) => n + (u.output ?? 0), 0));
test('overlapping filenames keep their own record identity when a parent result arrives later', () => {
 const backfill = api('backfillTranscripts'), f = fixture();
 const bare = child(f, 'a1', { prefix: false, rows: withId('a1', 'm-bare') }), prefixed = child(f, 'a1', { prefix: true, rows: withId('agent-a1', 'm-prefixed') });
 for (const p of [bare, prefixed]) writeFileSync(p.replace('.jsonl', '.meta.json'), '{}');
 backfill(f.repo, { env: f.env });
 const first = [...reduce(readDispatches(f.repo)).keys()].sort();
 assert.deepEqual(first, ['claude:s1:a1', 'claude:s1:agent-a1']);
 parent(f); // names only a1
 backfill(f.repo, { env: f.env });
 assert.deepEqual([...reduce(readDispatches(f.repo)).keys()].sort(), first, 'a later parent never moves a child to another key');
 assert.deepEqual(outputs(f.repo).sort(), [9, 9], 'each child counted once, under its own key');
});

test('two children claiming one key are both unidentified, never merged or double counted', () => {
 const backfill = api('backfillTranscripts'), f = fixture();
 const bare = child(f, 'a1', { prefix: false, rows: withId('a1', 'm-bare') }), prefixed = child(f, 'a1', { prefix: true, rows: withId('a1', 'm-prefixed') });
 for (const p of [bare, prefixed]) writeFileSync(p.replace('.jsonl', '.meta.json'), '{}');
 const out = backfill(f.repo, { env: f.env });
 assert.equal(out.unidentified, 2);
 assert.deepEqual([...reduce(readDispatches(f.repo)).keys()], []);
});

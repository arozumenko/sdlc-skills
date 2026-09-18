#!/usr/bin/env node
// One-off, repository-relative: node extract-dataset.mjs --head b1f70d2 --plan docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md [--ref feat/security-testing-bundle-spec] > dataset.json
// Emits ids and timestamps only (never commit bodies or prompt text). Reuses the skill's own plan-markdown parser so memberships match registration.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseExecutionBlock, parseTaskHeadings } from '../../scripts/lib/plan-markdown.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const head = arg('head'), planPath = arg('plan'), ref = arg('ref', 'HEAD');
if (!head || !planPath) { console.error('usage: --head <sha> --plan <path> [--ref <branch>]'); process.exit(2); }
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const log = (...a) => git('log', '--format=%H%x1f%P%x1f%cI%x1f%s', ...a).split('\n').filter(Boolean).map((l) => { const [sha, p, at, s] = l.split('\x1f'); return { sha, parents: p.split(' '), at: new Date(at).toISOString(), subject: s }; });
const plan = git('show', `${head}:${planPath}`);
const groups = parseExecutionBlock(plan).map((g) => ({ ref: g.ref, tasks: g.nums.map((n) => `TASK-${n}`) }));
const headings = parseTaskHeadings(plan);
const tasks = new Map([...headings.values()].map((t) => [t.ref, { ref: t.ref, story: t.story, class: t.class, first_commit_at: null, rework: [], merged_at: null }]));
for (const c of log('--no-merges', '--reverse', head)) {
  const m = /^(TASK-\d{3}): (.*)$/.exec(c.subject); if (!m || !tasks.has(m[1])) continue;
  const t = tasks.get(m[1]); t.first_commit_at ??= c.at;
  const r = /^address review(?: (\d+))?\b/.exec(m[2]); if (r) t.rework.push({ round: r[1] ? Number(r[1]) : null, at: c.at });
}
for (const c of log('--first-parent', '--merges', '--reverse', head)) { const m = /^merge task\/task-(\d{3})/i.exec(c.subject); if (m && tasks.has(`TASK-${m[1]}`)) tasks.get(`TASK-${m[1]}`).merged_at ??= c.at; }
const planCommit = log('--reverse', head, '--', planPath)[0];
const membership = groups.flatMap((g) => g.tasks);
const ds = { source: { ref, head: git('rev-parse', head), plan_path: planPath, plan_sha256: createHash('sha256').update(plan).digest('hex') }, plan_commit_at: planCommit.at, groups, tasks: [...tasks.values()] };
const counts = { tasks: ds.tasks.length, groups: groups.length, merged: ds.tasks.filter((t) => t.merged_at).length, rework: ds.tasks.filter((t) => t.rework.length).length, membership: membership.length, unique: new Set(membership).size };
const expect = { tasks: 59, groups: 30, merged: 33, rework: 11, membership: 59, unique: 59 };
for (const k of Object.keys(expect)) if (counts[k] !== expect[k]) { console.error(`reconcile: ${k}=${counts[k]} expected ${expect[k]}`); process.exit(4); }
process.stdout.write(`${JSON.stringify(ds, null, 2)}\n`);

// Builds a temp git repo replaying dataset.json with its real timestamps (fixed → reproducible); no client content.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function buildFixtureRepo(ds) {
  const repo = mkdtempSync(join(tmpdir(), 'dm-golden-'));
  const env = (at) => ({ ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'f@x', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'f@x' });
  const git = (args, at = ds.plan_commit_at) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: env(at) }).trim();
  git(['init', '-q', '-b', 'main']);
  const known = new Set(ds.tasks.map((t) => t.ref));
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: ds.plan_commit_at, source_epoch: { from: ds.plan_commit_at, until: null, integration_ref: 'main' },
    campaign: { ref: 'sec' }, mission_kind: 'group', missions: ds.groups.map((g, i) => ({ ref: g.ref, sequence: i + 1, tasks: g.tasks.filter((r) => known.has(r)).map((r) => { const t = ds.tasks.find((x) => x.ref === r); return { ref: r, story: t.story ?? undefined, class: t.class ?? undefined, branch: `task/task-${r.slice(5)}` }; }) })) };
  const planFile = join(repo, 'plan.md');
  writeFileSync(planFile, `# plan\n\n\`\`\`json delivery-plan\n${JSON.stringify(block)}\n\`\`\`\n\n${ds.tasks.map((t) => `#### ${t.ref}: t`).join('\n')}\n`);
  git(['add', 'plan.md']); git(['commit', '-q', '-m', 'plan: tasks']);
  const events = [];
  for (const t of ds.tasks) { if (t.first_commit_at) events.push({ at: t.first_commit_at, kind: 'first', t }); for (const r of t.rework) events.push({ at: r.at, kind: 'rework', t, r }); if (t.merged_at) events.push({ at: t.merged_at, kind: 'merge', t }); }
  events.sort((a, b) => a.at.localeCompare(b.at) || ['first', 'rework', 'merge'].indexOf(a.kind) - ['first', 'rework', 'merge'].indexOf(b.kind));
  const branch = (t) => `task/task-${t.ref.slice(5)}`;
  for (const e of events) {
    if (e.kind === 'first') { git(['checkout', '-q', '-b', branch(e.t), 'main']); writeFileSync(join(repo, `${e.t.ref}.txt`), '1'); git(['add', '.']); git(['commit', '-q', '-m', `${e.t.ref}: implement`], e.at); git(['checkout', '-q', 'main']); }
    else if (e.kind === 'rework') { git(['checkout', '-q', branch(e.t)]); writeFileSync(join(repo, `${e.t.ref}.txt`), `r${e.r.round ?? 'x'}${e.at}`); git(['add', '.']); git(['commit', '-q', '-m', `${e.t.ref}: address review${e.r.round == null ? '' : ` ${e.r.round}`}`], e.at); git(['checkout', '-q', 'main']); }
    else git(['merge', '--no-ff', '-q', '-m', `merge ${branch(e.t)} (Rio: PASS)`, branch(e.t)], e.at);
  }
  return { repo, head: git(['rev-parse', 'HEAD']), planFile };
}

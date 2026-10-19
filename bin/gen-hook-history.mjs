#!/usr/bin/env node
// Dev-time: record the hashes of every historical version of the core hook files,
// so doctor can recognise an installed hook set without executing it.
// Usage: node bin/gen-hook-history.mjs   (run from the repo root; commit the JSON)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CORE_HOOK_FILES } from './lib/core-hook-spec.mjs';
import { sha256, literalDefaultCap } from './lib/doctor/shell-literals.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const paths = CORE_HOOK_FILES.map((f) => `hooks/${f}`);
const commits = git('log', '--format=%H %cs', '--', ...paths).trim().split('\n').filter(Boolean).map((l) => l.split(' '));
const versions = [];
for (const [commit, date] of commits) {
  const files = {};
  let lib = '';
  for (const f of CORE_HOOK_FILES) {
    try { const t = git('show', `${commit}:hooks/${f}`); files[f] = sha256(t); if (f === 'lib.sh') lib = t; } catch { files[f] = null; }
  }
  versions.push({ commit: commit.slice(0, 12), date, files, defaultBudget: literalDefaultCap(lib) });
}
const out = { generatedFrom: git('rev-parse', '--short=12', 'HEAD').trim(), versions };
writeFileSync(new URL('./lib/doctor/hook-history.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`hook-history.json: ${versions.length} versions`);

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path = 'src/editor.js';
const original = readFileSync(path, 'utf8');
const { NODE_TEST_CONTEXT, ...env } = process.env;
try {
  writeFileSync(path, original.replace('send(state.draft)', 'send(state.cached)'));
  const result = spawnSync(process.execPath, ['--test'], { encoding: 'utf8', env, timeout: 5000 });
  if (result.error || result.status === null) throw new Error('mutation execution failed');
  console.log(JSON.stringify({ mutation: 'retry uses cached draft', exitCode: result.status, output: result.stdout }));
} finally { writeFileSync(path, original); }

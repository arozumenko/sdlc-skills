import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const separateOutput of [false, true]) test(`judge receives retained execution evidence (separate output: ${separateOutput})`, () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-judge-evidence-'));
  try {
    mkdirSync(join(root, 'bin'));
    const outDir = separateOutput ? join(root, 'rejudge') : root;
    if (separateOutput) mkdirSync(outDir);
    symlinkSync(process.execPath, join(root, 'bin/node'));
    writeFileSync(join(root, 'judge.md'), 'Check execution claims against evidence.');
    writeFileSync(join(root, 'transcript.jsonl'), '{"type":"user","message":{"content":"probe ran"}}\n');
    writeFileSync(join(root, 'bin/codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const transcript = path.join(process.argv[process.argv.indexOf('-C') + 1], 'transcript.jsonl');
const prompt = process.argv.at(-1);
if (!prompt.includes(transcript) || !fs.existsSync(transcript)) process.exit(3);
fs.writeFileSync(process.argv[process.argv.indexOf('-o') + 1], JSON.stringify({pass:true, score:1, reasons:'execution evidence available'}));
`, { mode: 0o755 });
    const trialModule = new URL('./trial.mjs', import.meta.url).href;
    const script = `import { runJudge } from ${JSON.stringify(trialModule)};
const root = ${JSON.stringify(root)};
console.log(JSON.stringify(runJudge(root, {judge:'judge.md'}, {work:root,baseSha:'base'}, ${JSON.stringify(outDir)}, 'I reran the probe.', {judgeModel:'test',judgeEffort:'high', ${separateOutput ? `transcriptPath: ${JSON.stringify(join(root, 'transcript.jsonl'))}` : ''}})));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:/usr/bin:/bin` }, timeout: 10000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).pass, true, r.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

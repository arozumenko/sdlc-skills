import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('./', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
function files(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
function section(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > from, `missing section boundary: ${end}`);
  return text.slice(from, to);
}

test('C1 adb runner mode', () => {
  const s = read('skills/mobile-testing/SKILL.md');
  // Catch omitted adb choices in templates, routing, announcements and reports.
  const lists = s.split('\n').filter((line) =>
    /appium/.test(line) && /device-farm|Device Farm/.test(line) &&
    /runner.mode|Runner mode|Native suites|Trigger:|route to Part 6/i.test(line));
  assert.ok(lists.length >= 8, 'runner mode lists are present');
  for (const line of lists) assert.match(line, /adb/i, `adb missing: ${line}`);
  const selection = section(s, '**Determine `runner_mode`**', '### Phase 2');
  assert.match(selection, /Android.*`adb devices`.*→ `adb`/);
  assert.ok(selection.indexOf('→ `adb`') < selection.indexOf('→ `device-farm`'));
  assert.match(selection, /most local command-line driver/);
  assert.match(selection, /MCP driver only where nothing local exists/);
  assert.match(selection, /`AGENTS.md`.*`app_profile.md`.*wins/);
  assert.match(s, /### Phase 2e.*adb/);
  const exploration = section(s, '### Phase 2e', '### Phase 2a');
  assert.match(exploration, /no reader of its own/);
  assert.ok(exploration.includes('node <skill dir>/scripts/ui-read.mjs <file>'));
  assert.match(s, /## Device Toolkit/);
  assert.match(s, /Project toolkit first/);
  assert.match(s, /`adb`: "Running in adb mode/);
  const dispatch = section(s, '**`runner_mode: adb`**', '**`runner_mode: playwright`');
  for (const field of ['device_serial=', 'environment={handle}', 'inherit_state=', 'preserve_final_state=']) {
    assert.ok(dispatch.includes(field), `adb dispatch carries ${field}`);
  }
  assert.match(dispatch, /profile.*Test Devices.*serial/);
  assert.match(dispatch, /single device.*`adb devices`/);
  assert.match(dispatch, /more than one.*none named in the profile.*ask/i);
  const reporter = section(s, '### Step 6 — Generate Report', '### Step 6a');
  assert.match(reporter, /native.*`environment=\{handle\}`/i);
  assert.match(reporter, /same handle.*adb dispatch/);
  assert.match(reporter, /web\/PWA.*`base_url=\{base_url\}`/i);
  assert.match(s, /test backend.*identifier/);
  assert.match(s, /name, a URL, or `none`/);
  assert.match(s, /passes.*toolkit command/);
  const setup = section(s, '### Setup (always read first)', '### Adb Mode');
  for (const rule of [
    /after the action/, /UI tree.*viewed screenshot/, /never.*command.*success/,
    /Synthetic input/, /Appium gestures/, /Playwright clicks/, /real finger gesture/,
    /real-event command.*BLOCKED/s, /Every run tears down what it started/,
    /Part 4.*suite teardown/, /runner never leaves.*extras behind/,
    /data.*does not exist.*BLOCKED/s, /failure_reason.*starting.*UNREACHABLE:/s,
    /never creates the record.*pass/,
  ]) assert.match(setup, rule);
  assert.match(setup, /`adb` → Adb Mode/);
  assert.match(s, /### Step 6a.*Teardown/);
  const adb = section(s, '### Adb Mode', '### Playwright Mode');
  const reading = section(adb, '#### Reading the screen', '####');
  assert.match(reading, /no reader of its own/);
  assert.ok(reading.includes('node <skill dir>/scripts/ui-read.mjs <file>'));
  for (const phrase of ['-s {device_serial}', 'inherit_state: false', 'inherit_state: true',
    'fallback_occurred', 'preserve_final_state=true', 'run-lead owns teardown']) {
    assert.ok(adb.includes(phrase), phrase);
  }
  assert.match(read('skills/mobile-testing/references/gestures.md'), /## Adb Mode/);
  assert.match(s, /\| Adb \|/);
  assert.match(s, /version: "1\.1\.0"/);
  assert.match(s, /compatibility:.*Adb mode: Android SDK platform-tools/);
  assert.match(s, /compatibility:.*Node\.js 18\+ for scripts\/ui-read\.mjs/);
  assert.match(s, /environment.*base_url.*web\/PWA.*handle.*native/i);
  for (const path of ['skills/mobile-testing/SKILL.md', 'agents/test-reporter/AGENT.md', 'knowledge/test-run-report-format.md']) {
    assert.match(read(path), /\*\*Executed by:\*\* manual-qa team/, path);
  }
  for (const path of files()) {
    if (path === fileURLToPath(import.meta.url)) continue;
    assert.doesNotMatch(readFileSync(path, 'utf8'), /Web QA Team/i, path);
  }
});

// Catch web-only routing, eager mobile preloads, and lost native authoring rules.
test('C3 platform-aware agents and knowledge', () => {
  const roles = { 'test-author': 'Part 2', 'test-sizer': 'Part 3',
    'test-run-lead': 'Parts 4–5', 'test-reporter': 'Part 8' };
  for (const role of [...Object.keys(roles), 'app-profiler', 'test-runner']) {
    const frontmatter = read(`agents/${role}/AGENT.md`).split('---')[1];
    const preloads = frontmatter.match(/^skills: (.+)$/m)?.[1] ?? '';
    if (role in roles) assert.doesNotMatch(preloads, /mobile-testing/, role);
    else assert.match(preloads, /mobile-testing/, role);
  }
  for (const [role, part] of Object.entries(roles)) {
    const s = read(`agents/${role}/AGENT.md`);
    assert.match(s.split('---')[1], /^skills-on-demand: .*mobile-testing/m, role);
    const body = s.slice(s.indexOf('---', 3) + 3);
    const trigger = body.split('\n').find(line => /When.*app_profile.*app_type/.test(line));
    assert.ok(trigger, `${role}: profile trigger`);
    for (const rule of [/app_type: native \| pwa \| hybrid/, /or.*TC.*runner_mode.*`adb`.*`appium`.*`device-farm`.*`manual`/, /load `mobile-testing`/]) {
      assert.match(trigger, rule, role);
    }
    assert.ok(trigger.includes(part), `${role}: ${part}`);
  }
  const lead = read('agents/test-run-lead/AGENT.md');
  const input = lead.slice(lead.indexOf('## Input Format'));
  assert.match(input, /base_url.*required only.*web, PWA and hybrid/);
  assert.match(input, /native.*never ask.*base_url.*mobile-testing.*Part 4/i);
  const runner = read('agents/test-runner/AGENT.md');
  assert.match(runner, /native TC.*mobile-testing.*Part 6/i);
  assert.match(runner, /web, PWA and hybrid only.*Substitute.*\{\{base_url\}\}/);
  assert.match(runner, /web, PWA and hybrid only.*navigate to base_url/);
  assert.match(read('agents/app-profiler/AGENT.md'), /native app.*mobile-testing.*Part 1/);
  for (const path of ['agents/test-author/AGENT.md', 'knowledge/CONVENTIONS.md', 'knowledge/test-case-format.md']) {
    const s = read(path);
    assert.match(s, /web, PWA and hybrid.*\{\{base_url\}\}/i, path);
    assert.match(s, /native cases.*no URL.*mobile-testing.*Part 2/i, path);
  }
});

// Catch absence assertions that could pass against a vacuously empty list.
test('C4 absence checks need a record that could show X', () => {
  const checklist = section(read('agents/test-author/AGENT.md'), '### Quality checklist', '### Save behavior');
  for (const rule of [/absent/, /no X is created/, /no error appears/, /only if X could have appeared/,
    /backend's own record/, /list seeded with one X before the step/, /never.*list that was already empty/]) {
    assert.match(checklist, rule);
  }
});

// Catch profile refreshes dropping project-owned overrides or agents ignoring them.
test('C5 project rules survive profile updates and override defaults', () => {
  for (const path of ['agents/app-profiler/AGENT.md', 'skills/mobile-testing/SKILL.md']) {
    const s = read(path);
    const heading = path.startsWith('agents/') ? '##' : '###';
    const phase = section(s, `${heading} Phase 4`, `${heading} Phase 5`);
    const template = phase.match(/```markdown\n([\s\S]*?)```/)?.[1];
    assert.ok(template, `${path}: profile template exists`);
    assert.match(template, /^## Project rules$/m);
    for (const rule of [/rules for this repository/i, /win over.*agent bodies/i, /knowledge\//]) assert.match(template, rule);
    for (const rule of [/written by the project/i, /kept word for word/i]) assert.match(template, rule);
    assert.match(phase, /updating an existing profile.*copy.*## Project rules.*unchanged/i);
    assert.match(phase, /never rewrite, shorten or drop it/i);
  }
  for (const path of ['app-profiler', 'test-author', 'test-sizer', 'test-run-lead', 'test-runner', 'test-reporter']
    .map((role) => `agents/${role}/AGENT.md`).concat('knowledge/CONVENTIONS.md')) {
    assert.match(read(path), /app_profile\.md.*## Project rules.*wins over this file/, path);
  }
});

// Each case catches a missing routing, lifecycle, or safety instruction.
const skill = 'skills/mobile-testing/SKILL.md';
const agents = ['app-profiler', 'test-author', 'test-sizer', 'test-run-lead', 'test-runner', 'test-reporter'];
for (const path of agents.map(role => `agents/${role}/AGENT.md`).concat('knowledge/CONVENTIONS.md')) {
  for (const [name, rule] of [
    ['standing rules precedence', /wins over this file and your `RULES.md`/],
    ['repository precedence', /conflict.*`AGENTS.md` wins/],
    ['secret safety floor', /cannot relax.*never print a secret/],
    ['evidence safety floor', /cannot relax.*no PASS without a screen read taken after the action/],
    ['teardown safety floor', /cannot relax.*teardown of what the run started/],
  ]) test(`${path}: ${name}`, () => assert.match(read(path), rule));
}
for (const [name, path, rule] of [
  ['lead standing rules require URLs only for browser suites', 'agents/test-run-lead/RULES.md', /Require base_url.*only for web, PWA and hybrid/],
  ['lead standing rules never ask native URL', 'agents/test-run-lead/RULES.md', /native suites.*never ask for base_url.*mobile-testing.*Part 4/i],
  ['lead early native routing', 'agents/test-run-lead/AGENT.md', /native suites.*never ask for base_url.*mobile-testing.*Part 4/i],
  ['lead report environment selection', 'agents/test-run-lead/AGENT.md', /environment=\{environment\}.*[\s\S]*base_url.*web, PWA and hybrid.*handle.*native/],
  ['legacy profiles default to web', 'agents/test-run-lead/AGENT.md', /without `app_type`.*web app/],
  ['native runner description', 'agents/test-runner/AGENT.md', /description:.*web and mobile apps/],
  ['sizer uses selected driver', 'agents/test-sizer/SOUL.md', /execution.*selected runner mode/],
  ['catalog includes adb', 'factory.json', /adb/],
]) test(name, () => {
  const s = read(path);
  assert.match(name === 'lead early native routing' ? s.slice(0, s.indexOf('## Input Format')).split('## Workflow')[0] : s, rule);
});
for (const role of ['test-runner', 'app-profiler']) {
  test(`${role} browser standing rule is scoped`, () => {
    const rule = read(`agents/${role}/RULES.md`).split('\n')[2];
    assert.match(rule, /web, PWA and hybrid/);
    assert.match(rule, /native.*mobile-testing/i);
  });
}
test('profiler observes native state too', () => assert.match(read('agents/app-profiler/RULES.md'), /browser-verified.*web, PWA and hybrid.*native.*mobile-testing/));
for (const [name, rule] of [
  ['bootable AVD selection', /no device.*`emulator -list-avds`.*device-up.*→ `adb`/],
  ['adb device setup', /Step 3d — Device Setup \(adb suites\)/],
  ['adb setup boots missing device', /no device.*Device Toolkit.*device-up/],
  ['adb setup starts backend', /run.*backend up \/ seed.*if.*toolkit/i],
  ['adb setup installs missing app', /confirm.*app is installed.*install.*`build_path`.*if not/i],
  ['adb setup tracks ownership', /record what this run started.*Step 6a.*exactly that/is],
  ['native reporter non-adb environment', /appium.*device-farm.*device name.*`none`/],
  ['profile credential fallback', /test credentials recorded in the profile.*`input text`/],
  ['secret credential blocking', /secret.*must not enter context.*without.*toolkit command.*BLOCKED/],
]) test(name, () => assert.match(read(skill), rule));
test('report inputs include environment', () => assert.match(section(read(skill), '### Inputs', '### Compute Metrics'), /`environment`/));

for (const path of ['agents/app-profiler/AGENT.md', skill]) {
  test(`${path}: profile rules safety and precedence`, () => {
    const template = section(read(path), '## Project rules', '## Overview');
    for (const rule of [/RULES.md/, /conflict.*`AGENTS.md` wins/,
      /cannot relax.*never print a secret/, /cannot relax.*no PASS without a screen read taken after the action/,
      /cannot relax.*teardown of what the run started/]) assert.match(template, rule);
  });
}
test('adb setup precedes execution and teardown uses ownership record', () => {
  const s = read(skill);
  assert.ok(s.indexOf('### Step 3d') > s.indexOf('### Step 3c'));
  assert.ok(s.indexOf('### Step 3d') < s.indexOf('### Step 4 — Execute'));
  assert.match(section(s, '### Step 6a', '### Step 6b'), /Step 3d.*record.*exactly what this run started/);
});

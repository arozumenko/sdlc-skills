import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bySlot, perUnitCost, renderHtml, buildCsv, SLOT_OF } from './build-report-html.mjs';

const snap = (over = {}) => ({
  generatedAt: '2026-07-29T00:00:00.000Z',
  rollup: {
    costMethod: 'metered',
    totals: {
      costUsd: 100, count: 5, turns: 50, agentMinutes: 120, wallClockMin: 60,
      tokens: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 },
      cacheHitRate: 0.5, outputShare: 0.2, toolCalls: 100, toolErrors: 6, skills: [],
    },
    byRole: {
      'test-automation-engineer': { costUsd: 60, count: 2, turns: 30, agentMinutes: 80, toolCalls: 60, toolErrors: 5, models: ['sonnet-4.6'], tokens: { input: 5, output: 5, cacheRead: 5, cacheCreation: 5 } },
      'qa-engineer': { costUsd: 40, count: 3, turns: 20, agentMinutes: 40, toolCalls: 40, toolErrors: 1, models: ['haiku-4.5'], tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 } },
    },
    byDay: { '2026-07-28': { costUsd: 100, count: 5, turns: 50, tokens: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 } } },
    ledger: [
      { id: 'aaaaaaaa-1', kind: 'session', role: null, costUsd: 70, turns: 30, durationMin: 40, toolCalls: 50, toolErrors: 0, gitBranch: 'main', usage: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 } },
      { id: 'bbbbbbbb-2', kind: 'subagent', role: 'qa-engineer', costUsd: 30, turns: 20, durationMin: 10, toolCalls: 50, toolErrors: 3, gitBranch: 'tests/TC-1', usage: { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 } },
    ],
  },
  ...over,
});

test('roles fold into pipeline slots, costliest first', () => {
  const slots = bySlot(snap().rollup.byRole);
  assert.equal(slots[0].slot, 'implementer');
  assert.equal(slots[0].costUsd, 60);
  assert.equal(slots[1].slot, SLOT_OF['qa-engineer']);
});

// A role the mapping doesn't know is a finding — someone dispatched something
// unnamed. Folding it into "other" would hide exactly that.
test('an unmapped role keeps its own name instead of being bucketed', () => {
  const slots = bySlot({ 'workflow-subagent': { costUsd: 1, count: 1, models: [], tokens: {} } });
  assert.equal(slots[0].slot, 'workflow-subagent');
});

test('slots with no priced rows report n/a, not a summed zero', () => {
  const [s] = bySlot({ 'qa-engineer': { costUsd: null, count: 1, models: [], tokens: {} } });
  assert.equal(s.priced, false);
  assert.equal(s.costUsd, null);
  assert.match(renderHtml(snap({ rollup: { ...snap().rollup, byRole: { 'qa-engineer': { costUsd: null, count: 1, models: [], tokens: {} } } } })), /n\/a/);
});

test('cost per case needs both a total and an operator-declared count', () => {
  assert.equal(perUnitCost({ costUsd: 100 }, 4), 25);
  assert.equal(perUnitCost({ costUsd: 100 }, 0), null);       // no count → no claim
  assert.equal(perUnitCost({ costUsd: null }, 4), null);      // no price → no claim
});

test('without --resolved the report asks for the count rather than inventing one', () => {
  const html = renderHtml(snap());
  assert.match(html, /No case count given/);
  assert.doesNotMatch(html, /Per case/);
});

test('with --resolved the per-case headline appears', () => {
  const html = renderHtml(snap(), { resolved: 4 });
  assert.match(html, /Per case/);
  assert.match(html, /\$25\.00/);
});

// The whole point of the host-neutral design: same input shape, same report.
test('the header names the host and its pricer', () => {
  assert.match(renderHtml(snap()), /Claude Code · priced by ccusage/);
  assert.match(renderHtml(snap({ host: 'copilot' })), /GitHub Copilot · priced by GitHub Copilot \(AI credits\)/);
});

test('Copilot adds the AI-credit line and the pre-billing-change caveat', () => {
  const html = renderHtml(snap({
    host: 'copilot', aiCredits: 648.071, usdPerCredit: 0.01,
    sessionsPriced: 53, sessionsTotal: 73, legacyPremiumRequests: 97,
  }));
  assert.match(html, /AI credits/);
  assert.match(html, /648\.07/);
  assert.match(html, /1 credit = \$0\.01/);
  assert.match(html, /20 session\(s\) predate/);
  assert.match(html, /97 legacy premium request/);
});

test('a fully priced Copilot run shows no caveat', () => {
  const html = renderHtml(snap({ host: 'copilot', aiCredits: 5, usdPerCredit: 0.01, sessionsPriced: 3, sessionsTotal: 3 }));
  assert.doesNotMatch(html, /predate/);
});

// It has to survive being emailed or opened years later, offline.
test('the page is self-contained: no external requests of any kind', () => {
  const html = renderHtml(snap());
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<link/i);
  assert.doesNotMatch(html, /<img/i);
  // The one script is inline. A `src` on it would be a network fetch, which is
  // what this test has always been about — an inline handler is not.
  assert.doesNotMatch(html, /<script[^>]+src/i);
  // And nothing the page needs may depend on that script running: ticket
  // systems and mail clients strip <script>, and the tables are the report.
  const withoutScript = html.replace(/<script>[\s\S]*<\/script>/, '');
  assert.match(withoutScript, /Cost by pipeline slot/);
  assert.match(withoutScript, /\$60\.00/);
});

test('user content is escaped, not injected', () => {
  const html = renderHtml(snap({
    rollup: { ...snap().rollup, byRole: { '<img src=x onerror=alert(1)>': { costUsd: 1, count: 1, models: [], tokens: {} } } },
  }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('a high tool-error rate is flagged, a low one is not', () => {
  assert.match(renderHtml(snap()), /class="sub bad"/);            // 6/100 = 6% > 5%
  const calm = snap();
  calm.rollup.totals.toolErrors = 1;                              // 1%
  assert.doesNotMatch(renderHtml(calm), /class="sub bad"/);
});

test('an empty rollup renders instead of throwing', () => {
  const html = renderHtml({ generatedAt: 'x', rollup: { totals: {}, byRole: {}, byDay: {}, ledger: [] } });
  assert.match(html, /Test-automation efficiency/);
});

const delivery = {
  batches: [{ slug: 'w1', gate: 'green' }, { slug: 'w2', gate: 'red' }],
  outcomes: { automated: 6, blocked: 2, 'out-of-scope': 2 },
  casesEntered: 10, delivered: 6, reentered: 1, warnings: [],
  perDelivered: 100 / 6, perExamined: 10,
  coverage: { matchedUsd: 30, totalUsd: 100, share: 0.3, matchedUnits: 4 },
};

test('measured delivery replaces the declared count and shows BOTH denominators', () => {
  const html = renderHtml(snap({ delivery }), { resolved: 99 });
  assert.match(html, /What the money bought/);
  assert.match(html, /Per spec delivered/);
  assert.match(html, /Per case examined/);
  assert.match(html, /\$16\.67/, 'cost per delivered spec');
  assert.match(html, /\$10\.00/, 'cost per case examined');
  // The operator's 99 must not survive next to a measured 6.
  assert.match(html, /over 6 delivered \(measured\)/);
  assert.doesNotMatch(html, /over 99/);
  assert.doesNotMatch(html, /No case count given/);
});

// The number that gets a report taken apart: a window holding mostly other work,
// divided by these cases. The page has to say so on its own face.
test('the coverage floor is shown as a dilution check, not as attribution', () => {
  const html = renderHtml(snap({ delivery }));
  assert.match(html, /30%/);
  assert.match(html, /floor/i);
  assert.match(html, /analysts never touch git/i);
});

test('delivery warnings surface on the page', () => {
  const html = renderHtml(snap({ delivery: { ...delivery, warnings: ['closed outside the metered window'] } }));
  assert.match(html, /closed outside the metered window/);
});

test('without delivery the report asks for it and names both ways to supply it', () => {
  const html = renderHtml(snap());
  assert.doesNotMatch(html, /What the money bought/);
  assert.match(html, /--resolved-from/);
  assert.match(html, /--resolved N/);
});

test('buildCsv: quoting, formula guard, and unpriced slots left empty', () => {
  const csv = buildCsv(bySlot({
    'test-analyst': { costUsd: 10, count: 3, turns: 50, agentMinutes: 30, toolCalls: 100, toolErrors: 2, models: ['opus'], tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 } },
    'weird, role"quoted': { count: 1, turns: 5, agentMinutes: 2, toolCalls: 9, toolErrors: 1, models: [], tokens: {} },
    '=cmd|calc': { costUsd: 1.5, count: 1, turns: 5, agentMinutes: 2, toolCalls: 9, toolErrors: 0, models: [], tokens: {} },
  }));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'slot,roles,cost_usd,tokens,units,turns,agent_minutes,tool_calls,tool_errors,models');
  assert.ok(csv.includes('"weird, role""quoted"'), 'commas and quotes escaped');
  // Excel executes a cell starting with = + - or @; a tab prefix disarms it.
  assert.ok(csv.includes('"\t=cmd|calc"'), 'formula-shaped name disarmed');
  // An unpriced slot must be blank, never 0 — a spreadsheet averages a zero in.
  const unpriced = lines.find((l) => l.startsWith('"weird'));
  assert.equal(unpriced.split(',').slice(-8)[0], '', 'unpriced cost cell is empty');
});

test('the CSV is embedded as data, not code, and cannot close the script tag', () => {
  const html = renderHtml(snap({
    rollup: { ...snap().rollup, byRole: { '</script><script>alert(1)</script>': { costUsd: 1, count: 1, models: [], tokens: {} } } },
  }));
  const body = html.slice(html.indexOf('var CSV'), html.lastIndexOf('</script>'));
  assert.doesNotMatch(body, /<\/script>/i, 'no premature close inside the script');
  // It survives as data: the page must still be able to export the real name.
  const literal = html.match(/var CSV = JSON\.parse\((.*)\);/)[1];
  assert.ok(JSON.parse(JSON.parse(literal)).includes('alert(1)'));
});

test('print styles and the export control are present', () => {
  const html = renderHtml(snap());
  assert.match(html, /@media print/);
  assert.match(html, /\.actions \{ display: none; \}/, 'controls hidden when printed');
  assert.match(html, /id="csv"/);
});

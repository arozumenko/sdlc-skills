// Tests for otel-report.mjs — synthetic OTLP JSON fixtures (the encoding is
// spec-stable: attributes as {key, value:{stringValue|intValue|...}}, int64s
// as strings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attrValue, attrMap, summarize, loadSinkLines, renderMarkdown, main } from './otel-report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-otelrep-'));

const A = (key, value) => ({ key, value });
const S = (v) => ({ stringValue: v });
const I = (v) => ({ intValue: String(v) }); // OTLP JSON int64 = string
const D = (v) => ({ doubleValue: v });

function sinkLines() {
  return [
    {
      t: '2026-08-05T10:00:00Z', path: '/v1/logs',
      body: {
        resourceLogs: [{
          resource: { attributes: [A('session.id', S('sess-1'))] },
          scopeLogs: [{
            logRecords: [
              {
                attributes: [
                  A('event.name', S('claude_code.api_request')), A('model', S('claude-sonnet-5')),
                  A('cost_usd', D(0.42)), A('input_tokens', I(1000)), A('output_tokens', I(200)),
                  A('cache_read_tokens', I(50000)), A('cache_creation_tokens', I(700)),
                ],
              },
              { attributes: [A('event.name', S('claude_code.user_prompt')), A('prompt_length', I(12))] }, // ignored
            ],
          }],
        }],
      },
    },
    {
      t: '2026-08-05T10:01:00Z', path: '/v1/metrics',
      body: {
        resourceMetrics: [{
          scopeMetrics: [{
            metrics: [
              { name: 'claude_code.token.usage', sum: { dataPoints: [{ attributes: [A('type', S('output'))], asInt: '200' }, { attributes: [A('type', S('cacheRead'))], asInt: '50000' }] } },
              { name: 'claude_code.cost.usage', sum: { dataPoints: [{ asDouble: 0.42 }] } },
            ],
          }],
        }],
      },
    },
    {
      t: '2026-08-05T10:02:00Z', path: '/v1/traces',
      body: {
        resourceSpans: [{
          scopeSpans: [{
            spans: [{
              name: 'chat',
              attributes: [
                A('gen_ai.conversation.id', S('conv-9')), A('gen_ai.response.model', S('gpt-5-mini')),
                A('gen_ai.usage.input_tokens', I(4000)), A('gen_ai.usage.output_tokens', I(90)),
              ],
            }],
          }],
        }],
      },
    },
  ];
}

test('attrValue/attrMap: OTLP AnyValue decoding incl. stringified int64', () => {
  assert.equal(attrValue(S('x')), 'x');
  assert.equal(attrValue(I(123)), 123);
  assert.equal(attrValue(D(1.5)), 1.5);
  assert.deepEqual(attrMap([A('a', S('b'))]), { a: 'b' });
});

test('summarize: api_request events, metrics, and gen_ai spans each land in their section', () => {
  const s = summarize(sinkLines());
  assert.equal(s.requests, 1);
  assert.deepEqual(s.apiTokens, { input: 1000, output: 200, cacheRead: 50000, cacheWrite: 700 });
  assert.ok(Math.abs(s.apiCostUsd - 0.42) < 1e-9);
  assert.deepEqual(s.bySession.get('sess-1'), { requests: 1, costUsd: 0.42, input: 1000, output: 200 });
  assert.deepEqual(s.metricTokens, { output: 200, cacheRead: 50000 });
  const conv = s.conversations.get('conv-9');
  assert.equal(conv.input, 4000);
  assert.deepEqual([...conv.models], ['gpt-5-mini']);
});

test('main: end-to-end over a sink dir, markdown carries the no-merge disclaimer', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'otel-2026-08-05.jsonl'), sinkLines().map((l) => JSON.stringify(l)).join('\n') + '\n');
  const lines = loadSinkLines(dir);
  assert.equal(lines.length, 3);
  const md = renderMarkdown(summarize(lines), dir);
  assert.match(md, /NOT merged into the telemetry ledger/);
  assert.match(md, /\$0\.4200/);
  assert.match(md, /conv-9/);
  assert.equal(main(['--dir', dir, '--json']), 0);
});

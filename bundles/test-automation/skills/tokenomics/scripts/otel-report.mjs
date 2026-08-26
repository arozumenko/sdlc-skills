#!/usr/bin/env node
// otel-report.mjs — summarize what the local OTel sink has received.
//
//   node otel-report.mjs [--dir ~/.tokenomics-otel] [--json]
//
// This is an INSPECTION tool, deliberately separate from the ledger: OTel
// lines are NOT merged into usage-*.jsonl, because the same session can also
// be captured from its store (events.jsonl / transcripts) and cross-source id
// mapping is unverified — merging would risk double-counting spend. Once real
// data confirms the id relationships, promotion into the ledger is a follow-up
// (see references/otel-roadmap.md).
//
// Reads the sink's raw {t, path, body} lines and understands three shapes:
//  - logs:    Claude Code events (claude_code.api_request carries per-request
//             cost_usd + token counts — Anthropic-computed, a real figure)
//  - metrics: claude_code.token.usage / claude_code.cost.usage sums
//  - traces:  GenAI-semconv spans (gen_ai.usage.*), grouped per conversation
//
// STDLIB ONLY. Read-only.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** OTLP JSON AnyValue → plain JS value (int64s arrive as strings). */
export function attrValue(v) {
  if (!v || typeof v !== 'object') return v ?? null;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  return null;
}

export function attrMap(list) {
  const m = {};
  for (const a of list ?? []) if (a?.key) m[a.key] = attrValue(a.value);
  return m;
}

export function summarize(lines) {
  const out = {
    requests: 0, // claude_code.api_request events
    apiTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    apiCostUsd: 0,
    bySession: new Map(), // session.id -> {requests, costUsd, input, output}
    metricTokens: {},     // type -> tokens (claude_code.token.usage)
    metricCostUsd: 0,
    conversations: new Map(), // gen_ai.conversation.id -> {spans, input, output, models:Set}
  };
  for (const rec of lines) {
    const body = rec?.body;
    if (!body || typeof body !== 'object') continue;

    for (const rl of body.resourceLogs ?? []) {
      const res = attrMap(rl.resource?.attributes);
      for (const sl of rl.scopeLogs ?? []) {
        for (const lr of sl.logRecords ?? []) {
          const a = attrMap(lr.attributes);
          const name = a['event.name'] ?? lr.eventName ?? (typeof lr.body?.stringValue === 'string' ? lr.body.stringValue : null);
          if (name !== 'claude_code.api_request') continue;
          out.requests++;
          out.apiTokens.input += num(a.input_tokens);
          out.apiTokens.output += num(a.output_tokens);
          out.apiTokens.cacheRead += num(a.cache_read_tokens);
          out.apiTokens.cacheWrite += num(a.cache_creation_tokens);
          out.apiCostUsd += num(a.cost_usd);
          const sid = a['session.id'] ?? res['session.id'] ?? 'unknown';
          if (!out.bySession.has(sid)) out.bySession.set(sid, { requests: 0, costUsd: 0, input: 0, output: 0 });
          const b = out.bySession.get(sid);
          b.requests++; b.costUsd += num(a.cost_usd); b.input += num(a.input_tokens); b.output += num(a.output_tokens);
        }
      }
    }

    for (const rm of body.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const m of sm.metrics ?? []) {
          const points = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? [];
          if (m.name === 'claude_code.token.usage') {
            for (const p of points) {
              const a = attrMap(p.attributes);
              const type = a.type ?? 'unknown';
              out.metricTokens[type] = (out.metricTokens[type] ?? 0) + num(p.asDouble ?? p.asInt);
            }
          } else if (m.name === 'claude_code.cost.usage') {
            for (const p of points) out.metricCostUsd += num(p.asDouble ?? p.asInt);
          }
        }
      }
    }

    for (const rs of body.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          const a = attrMap(span.attributes);
          if (a['gen_ai.usage.input_tokens'] === undefined && a['gen_ai.usage.output_tokens'] === undefined) continue;
          const cid = a['gen_ai.conversation.id'] ?? 'unknown';
          if (!out.conversations.has(cid)) out.conversations.set(cid, { spans: 0, input: 0, output: 0, models: new Set() });
          const c = out.conversations.get(cid);
          c.spans++;
          c.input += num(a['gen_ai.usage.input_tokens']);
          c.output += num(a['gen_ai.usage.output_tokens']);
          const model = a['gen_ai.response.model'] ?? a['gen_ai.request.model'];
          if (model) c.models.add(model);
        }
      }
    }
  }
  return out;
}

export function loadSinkLines(dir) {
  if (!existsSync(dir)) return [];
  const lines = [];
  for (const f of readdirSync(dir).filter((n) => /^otel-.*\.jsonl$/.test(n)).sort()) {
    for (const raw of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      const rec = safeParse(raw);
      if (rec) lines.push(rec);
    }
  }
  return lines;
}

export function renderMarkdown(s, dir) {
  const usd = (n) => `$${n.toFixed(4)}`;
  const out = [`# OTel sink summary — ${dir}`, '', `Generated: ${new Date().toISOString()}`, '',
    '_Inspection only: these figures are NOT merged into the telemetry ledger (cross-source dedup unverified — see otel-roadmap.md)._', ''];
  out.push('## Claude Code api_request events');
  if (s.requests) {
    out.push(`- ${s.requests} request(s)  ·  cost (Anthropic-computed): ${usd(s.apiCostUsd)}`);
    out.push(`- Tokens: in ${s.apiTokens.input}, out ${s.apiTokens.output}, cache-read ${s.apiTokens.cacheRead}, cache-write ${s.apiTokens.cacheWrite}`, '');
    out.push('| session | requests | cost | in/out |', '|---|---|---|---|');
    for (const [sid, b] of [...s.bySession.entries()].sort((x, y) => y[1].costUsd - x[1].costUsd)) {
      out.push(`| ${String(sid).slice(0, 12)} | ${b.requests} | ${usd(b.costUsd)} | ${b.input}/${b.output} |`);
    }
  } else out.push('- none received');
  out.push('', '## Claude Code metrics');
  const mt = Object.entries(s.metricTokens);
  out.push(mt.length || s.metricCostUsd
    ? `- token.usage: ${mt.map(([t, n]) => `${t} ${n}`).join(', ') || '—'}  ·  cost.usage: ${usd(s.metricCostUsd)}`
    : '- none received');
  out.push('', '## GenAI spans (Copilot)');
  if (s.conversations.size) {
    out.push('| conversation | spans | in/out | models |', '|---|---|---|---|');
    for (const [cid, c] of s.conversations) {
      out.push(`| ${String(cid).slice(0, 12)} | ${c.spans} | ${c.input}/${c.output} | ${[...c.models].join(', ')} |`);
    }
    out.push('', '_Token counts only — OTel carries no billed figure for Copilot; the ledger\'s events.jsonl/chatSessions sources stay authoritative for dollars._');
  } else out.push('- none received');
  return out.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--dir');
  const dir = resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : join(homedir(), '.tokenomics-otel'));
  const lines = loadSinkLines(dir);
  const s = summarize(lines);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      dir, records: lines.length, requests: s.requests, apiCostUsd: s.apiCostUsd, apiTokens: s.apiTokens,
      bySession: Object.fromEntries(s.bySession), metricTokens: s.metricTokens, metricCostUsd: s.metricCostUsd,
      conversations: Object.fromEntries([...s.conversations.entries()].map(([k, c]) => [k, { ...c, models: [...c.models] }])),
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderMarkdown(s, dir)}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

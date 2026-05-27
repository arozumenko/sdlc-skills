#!/usr/bin/env node
// Distill Claude Code session transcripts for the current project into a
// compact markdown digest for a scout-led retrospective. READ-ONLY: emits a
// digest to stdout (or --out file); never writes memory/docs/watermark.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const FILE_CHURN_THRESHOLD = 4;          // edits to one path before it's a signal
const RETRY_WINDOW = 6;                   // look-ahead window (tool calls)
const MAX_CORRECTIONS_PER_SESSION = 12;
const MAX_QUOTE_LEN = 200;
const CORRECTION_RE =
  /^\s*(no\b|don'?t\b|actually\b|wait\b|stop\b|revert\b|undo\b|nope\b|incorrect\b|that'?s (wrong|not\b))/i;
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

function safeParse(line) { try { return JSON.parse(line); } catch { return null; } }

export function encodeProjectPath(cwd) {
  // Claude Code names the project dir by replacing path separators and dots.
  return cwd.replace(/[/.]/g, '-');
}

export function readRecords(jsonlPath) {
  const txt = readFileSync(jsonlPath, 'utf8');
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const rec = safeParse(line);
    if (rec) out.push(rec);
  }
  return out;
}

function firstCwdOf(jsonlPath) {
  try {
    for (const rec of readRecords(jsonlPath)) if (rec.cwd) return rec.cwd;
  } catch { /* ignore */ }
  return null;
}

export function resolveProjectDir(cwd, projectsRoot) {
  const direct = join(projectsRoot, encodeProjectPath(cwd));
  if (existsSync(direct)) return direct;
  if (!existsSync(projectsRoot)) return null;
  // Fallback: match by the `cwd` field inside each dir's transcripts.
  for (const name of readdirSync(projectsRoot)) {
    const dir = join(projectsRoot, name);
    let jsonls;
    try { jsonls = readdirSync(dir).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of jsonls) if (firstCwdOf(join(dir, f)) === cwd) return dir;
  }
  return null;
}

function userTextOf(rec) {
  const c = rec.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(b => b?.type === 'text').map(b => b.text).join(' ');
  return '';
}

export function detectRetries(toolCalls) {
  const counts = {};
  for (let i = 0; i < toolCalls.length; i++) {
    for (let j = i + 1; j < toolCalls.length && j <= i + RETRY_WINDOW; j++) {
      if (toolCalls[i].tool === toolCalls[j].tool &&
          toolCalls[i].target && toolCalls[i].target === toolCalls[j].target) {
        const key = `${toolCalls[i].tool} on ${toolCalls[i].target}`;
        counts[key] = (counts[key] || 1) + 1;
        break;
      }
    }
  }
  return Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
}

export function extractSignals(records) {
  const toolErrors = {};      // "Tool: error" -> count
  const toolCalls = [];       // {turn, tool, target}
  const fileChurn = {};       // path -> count
  const corrections = [];     // {turn, text}
  const idToName = {};        // tool_use_id -> tool name
  let userTurns = 0, assistantTurns = 0, lastAssistantHadTool = false, turn = 0;

  for (const rec of records) {
    if (rec.type === 'assistant') {
      assistantTurns++; turn++;
      const blocks = Array.isArray(rec.message?.content) ? rec.message.content : [];
      let hadTool = false;
      for (const b of blocks) {
        if (b?.type !== 'tool_use') continue;
        hadTool = true;
        if (b.id) idToName[b.id] = b.name;
        const target = b.input?.file_path || b.input?.path || b.input?.command || '';
        toolCalls.push({ turn, tool: b.name, target: String(target).slice(0, 80) });
        if (EDIT_TOOLS.includes(b.name) && b.input?.file_path) {
          fileChurn[b.input.file_path] = (fileChurn[b.input.file_path] || 0) + 1;
        }
      }
      lastAssistantHadTool = hadTool;
    } else if (rec.type === 'user') {
      userTurns++; turn++;
      const blocks = rec.message?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b?.type === 'tool_result' && b.is_error) {
            const name = idToName[b.tool_use_id] || 'tool';
            toolErrors[`${name}: error`] = (toolErrors[`${name}: error`] || 0) + 1;
          }
        }
      }
      const text = userTextOf(rec);
      if (text && lastAssistantHadTool && CORRECTION_RE.test(text) &&
          corrections.length < MAX_CORRECTIONS_PER_SESSION) {
        corrections.push({ turn, text: text.slice(0, MAX_QUOTE_LEN).replace(/\s+/g, ' ').trim() });
      }
    }
  }
  const retries = detectRetries(toolCalls);
  const churn = Object.entries(fileChurn)
    .filter(([, n]) => n >= FILE_CHURN_THRESHOLD).sort((a, b) => b[1] - a[1]);
  return { userTurns, assistantTurns, toolErrors, retries, fileChurn: churn, corrections };
}

function sessionMeta(records, jsonlPath) {
  const id = basename(jsonlPath, '.jsonl');
  let branch = '?', firstTs = null, lastTs = null;
  const skills = new Set();
  for (const r of records) {
    if (r.gitBranch) branch = r.gitBranch;
    if (r.attributionSkill) skills.add(r.attributionSkill);
    if (r.attributionPlugin) skills.add(r.attributionPlugin);
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) { if (firstTs === null || t < firstTs) firstTs = t; if (lastTs === null || t > lastTs) lastTs = t; }
    }
  }
  const date = firstTs ? new Date(firstTs).toISOString().slice(0, 10) : '?';
  const durationMin = (firstTs && lastTs) ? Math.round((lastTs - firstTs) / 60000) : 0;
  return { id, branch, date, durationMin, skills: [...skills] };
}

export function parseSession(jsonlPath) {
  const records = readRecords(jsonlPath);
  return { ...sessionMeta(records, jsonlPath), ...extractSignals(records) };
}

export function readSubagents(sessionDir) {
  const dir = join(sessionDir, 'subagents');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const m of readdirSync(dir).filter(f => f.endsWith('.meta.json'))) {
    const meta = safeParse(readFileSync(join(dir, m), 'utf8')) || {};
    const jsonl = join(dir, m.replace('.meta.json', '.jsonl'));
    let turns = 0, errors = 0, ended = '?';
    if (existsSync(jsonl)) {
      const sig = extractSignals(readRecords(jsonl));
      turns = sig.userTurns + sig.assistantTurns;
      errors = Object.values(sig.toolErrors).reduce((a, b) => a + b, 0);
      ended = errors > 0 ? 'with errors' : 'ok';
    }
    out.push({ agentType: meta.agentType || '?', description: meta.description || '', turns, errors, ended });
  }
  return out;
}

export function readWatermark(path) {
  if (!existsSync(path)) return { analyzed: [] };
  const d = safeParse(readFileSync(path, 'utf8'));
  return d && Array.isArray(d.analyzed) ? d : { analyzed: [] };
}

export function renderDigest(sessions) {
  const out = ['# Session retrospective digest', '',
    `Generated: ${new Date().toISOString()}`,
    `Sessions analyzed: ${sessions.length}`, ''];
  for (const s of sessions) {
    out.push(`## Session ${s.id} — ${s.date}  (branch: ${s.branch}, ${s.userTurns} user / ${s.assistantTurns} assistant turns, ~${s.durationMin} min)`);
    if (s.skills.length) out.push(`Skills/plugins seen: ${s.skills.join(', ')}`);
    out.push('');
    if (s.subagents?.length) {
      out.push('### Sub-agents');
      for (const a of s.subagents) out.push(`- ${a.agentType} — "${a.description}" — ${a.turns} turns, ${a.errors} errors, ended: ${a.ended}`);
      out.push('');
    }
    out.push('### Signals');
    const te = Object.entries(s.toolErrors).sort((a, b) => b[1] - a[1]);
    for (const [k, n] of te) out.push(`- Tool errors: ${k} ×${n}`);
    for (const [k, n] of s.retries) out.push(`- Retry/loop: ${k} ×${n}`);
    for (const [p, n] of s.fileChurn) out.push(`- File churn: ${p} edited ×${n}`);
    if (s.corrections.length) {
      out.push('- Candidate corrections:');
      for (const c of s.corrections) out.push(`  - "${c.text}" (turn ${c.turn})`);
    }
    if (!te.length && !s.retries.length && !s.fileChurn.length && !s.corrections.length) {
      out.push('- (no notable signals)');
    }
    out.push('');
  }
  return out.join('\n');
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    a[key] = (next && !next.startsWith('--')) ? argv[++i] : true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const projectsRoot = join(homedir(), '.claude', 'projects');
  const projectDir = args['project-dir'] || resolveProjectDir(cwd, projectsRoot);
  if (!projectDir) {
    process.stderr.write(
      'No Claude Code transcripts found for this project.\n' +
      'session-retrospective currently supports Claude Code only.\n' +
      'Fallback: paste a session transcript or summary and scout will analyze it directly.\n');
    process.exit(3);
  }
  const wmPath = args.watermark || join('.agents', 'memory', 'scout', '.last-retrospective');
  const analyzed = args.all ? new Set() : new Set(readWatermark(wmPath).analyzed);
  const exclude = args['exclude-session'];
  const jsonls = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
    .map(f => join(projectDir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const sessions = [];
  for (const jp of jsonls) {
    const id = basename(jp, '.jsonl');
    if (analyzed.has(id) || id === exclude) continue;
    const s = parseSession(jp);
    s.subagents = readSubagents(join(projectDir, id));
    sessions.push(s);
  }
  const digest = renderDigest(sessions);
  if (args.out) {
    writeFileSync(args.out, digest);
    process.stderr.write(`Digest written to ${args.out} (${sessions.length} sessions)\n`);
  } else {
    process.stdout.write(digest + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

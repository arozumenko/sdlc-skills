// STDLIB ONLY. Convenience importer: tech-lead tasks markdown → canonical delivery-plan (never invents estimates).
import { sha256 } from './paths.mjs';

const HEAD_RE = /^####\s+(TASK-\d{3,})\s*:\s*(.*)$/;
const FIELD = (line, name) => { const m = new RegExp(`\\*\\*${name}\\s*:\\*\\*\\s*([^·\\n]+)`).exec(line); return m ? m[1].trim() : null; };

export function parseExecutionBlock(text) {
  const lines = text.split('\n');
  let i = lines.findIndex((l) => /^##\s+1\.\s+Execution plan/.test(l));
  if (i === -1) return [];
  while (i < lines.length && !/^```/.test(lines[i])) i++;
  if (i >= lines.length) return [];
  const groups = [];
  for (let j = i + 1; j < lines.length && !/^```/.test(lines[j]); j++) {
    const raw = lines[j]; if (!raw.trim()) continue;
    const g = /^(G\d+)\s+(.*)$/.exec(raw);
    const body = (g ? g[2] : raw).replace(/\([^)]*\)/g, ' ').replace(/←.*$/, ' ');
    // F1: stripping "(...)" notes to a single space can leave an irregular *run* of spaces
    // immediately before a ` · ` delimiter — e.g. "ledger (+ empty assessment inputs) · 029"
    // becomes "ledger   · 029". Splitting on a single combined `\s·\s|\s{2,}` pattern lets the
    // whitespace-run alternative win first (it matches at the earliest position), consuming the
    // delimiter's own spacing and leaving a column that starts with "· 029" — its leading
    // `\d{3,}` never matches and the membership is silently dropped (five real memberships:
    // TASK-029, TASK-031, TASK-045, TASK-046, TASK-051). Splitting on `·` first (absorbing any
    // amount of surrounding whitespace via `\s*`), and only then splitting each resulting piece
    // on genuine multi-space column gaps (the `·`-less "001 docs ... 055 hook probe" layout),
    // removes the ambiguity: the two delimiter kinds no longer compete for the same whitespace.
    const nums = body.split(/\s*·\s*/).flatMap((piece) => piece.split(/\s{2,}/))
      .map((c) => /^\s*(\d{3,})\b/.exec(c)).filter(Boolean).map((m) => m[1]);
    if (g) groups.push({ ref: g[1], nums });
    else if (groups.length && /^\s+/.test(raw)) groups[groups.length - 1].nums.push(...nums);
  }
  return groups;
}

export function parseTaskHeadings(text) {
  const lines = text.split('\n'); const tasks = new Map();
  for (let i = 0; i < lines.length; i++) {
    const h = HEAD_RE.exec(lines[i]); if (!h) continue;
    let header = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) if (/\*\*Story:\*\*|\*\*Complexity:\*\*/.test(lines[j])) { header = lines[j]; break; }
    const story = FIELD(header, 'Story');
    tasks.set(h[1], { ref: h[1], title: h[2].trim(), story: story && /^US-\d+$/.test(story) ? story : null, class: FIELD(header, 'Complexity'),
      role: FIELD(header, 'Assigned to') ?? FIELD(header, 'Assigned'), num: h[1].replace(/^TASK-/, ''), branch: `task/task-${h[1].replace(/^TASK-/, '')}` });
  }
  return tasks;
}

const strip = (t) => { const o = { ref: t.ref, title: t.title, branch: t.branch }; if (t.story) o.story = t.story; if (t.class) o.class = t.class; if (t.role) o.role = t.role; return o; };

export function importTasksMarkdown(text, { campaign_id, run_id, version = 1, factory = 'feature-development', observation_start, integration_ref = 'main', mission_kind = 'group', campaign_ref = campaign_id } = {}) {
  const warnings = [];
  const tasks = parseTaskHeadings(text);
  if (!tasks.size) warnings.push('no TASK headings found');
  const groups = parseExecutionBlock(text);
  const placed = new Set();
  const missions = groups.map((g, i) => ({ ref: g.ref, sequence: i + 1, tasks: g.nums.map((n) => [...tasks.values()].find((t) => t.num === n)).filter(Boolean).filter((t) => !placed.has(t.ref)).map((t) => { placed.add(t.ref); return strip(t); }) })).filter((m) => m.tasks.length);
  const rest = [...tasks.values()].filter((t) => !placed.has(t.ref));
  if (rest.length) { warnings.push(`${rest.map((t) => t.ref).join(', ')}: not listed in any group — placed in mission "ungrouped"`); missions.push({ ref: 'ungrouped', sequence: missions.length + 1, tasks: rest.map(strip) }); }
  const plan = { campaign_id, run_id, version, factory, observation_start, source_epoch: { from: observation_start, until: null, integration_ref }, campaign: { ref: campaign_ref }, mission_kind, missions,
    import: { basis: 'markdown-import', task_count: tasks.size, group_count: groups.length, source_sha256: sha256(text) } };
  return { plan, warnings };
}

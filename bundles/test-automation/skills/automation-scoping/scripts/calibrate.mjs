#!/usr/bin/env node
// calibrate.mjs — Mode 4 step 2: recompute per-tier bucket statistics from
// one or more training-set.json files (build-training-set.mjs output),
// diff against the current taxonomy, and — ONLY on --apply — write a
// project-local .agents/estimation/complexity-taxonomy.json + append a
// dated .agents/estimation/calibration-log.md entry. Dry-run by default;
// never silently mutates anything. See
// ../references/calibration-methodology.md § Step 2, § Why the dry-run gate.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadTaxonomy } from './score-cases.mjs';

function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export function computeBucketStats(rows) {
  const byTier = {};
  for (const r of rows) {
    if (r.costUsd === null || r.activeMin === null) continue; // unpriced — excluded, not zeroed
    (byTier[r.tier] ||= []).push(r);
  }
  const stats = {};
  for (const [tier, tierRows] of Object.entries(byTier)) {
    const mins = tierRows.map((r) => r.activeMin);
    const costs = tierRows.map((r) => r.costUsd);
    stats[tier] = {
      n: tierRows.length,
      mean_min: round1(mean(mins)),
      stdev_min: round1(stdev(mins)),
      mean_cost: round2(mean(costs)),
    };
  }
  return stats;
}

function impliedMultipliers(bucketStats) {
  const baseline = bucketStats['crud-form']?.mean_min
    || mean(Object.values(bucketStats).map((s) => s.mean_min));
  const out = {};
  for (const [tier, s] of Object.entries(bucketStats)) {
    out[tier] = round2(s.mean_min / baseline);
  }
  return out;
}

function renderProposal({ trainingSetPaths, bucketStats, implied, taxonomy, totalRows, pricedRows }) {
  const rows = taxonomy.interaction_tiers.map((t) => {
    const s = bucketStats[t.id];
    const impliedMult = implied[t.id];
    const delta = s ? round1(((impliedMult - t.multiplier) / t.multiplier) * 100) : null;
    return `| ${t.id} | ${s?.n ?? 0} | ${s?.mean_min ?? '—'} | ${s?.stdev_min ?? '—'} | ${t.multiplier} | ${impliedMult ?? '—'} | ${delta === null ? '—' : (delta > 0 ? '+' : '') + delta + '%'} |`;
  }).join('\n');

  const flags = Object.entries(bucketStats)
    .filter(([tier]) => taxonomy.interaction_tiers.some((t) => t.id === tier))
    .filter(([tier]) => {
      const t = taxonomy.interaction_tiers.find((x) => x.id === tier);
      const m = implied[tier];
      return Math.abs((m - t.multiplier) / t.multiplier) > 0.4;
    })
    .map(([tier]) => tier);

  return `# Calibration proposal — ${new Date().toISOString().slice(0, 10)}

**Training set(s)**: ${trainingSetPaths.join(', ')}
**Rows**: ${totalRows} seen, ${pricedRows} priced (used for statistics), ${totalRows - pricedRows} unpriced (excluded, not zeroed — see calibration-methodology.md § Step 1)

## Tier comparison — current taxonomy vs. what this data implies

| Tier | n | mean_min | stdev_min | current mult. | implied mult. | delta |
|---|---|---|---|---|---|---|
${rows}

${flags.length > 0 ? `**⚠ >40% delta, worth inspecting before applying**: ${flags.join(', ')} — see calibration-methodology.md § "When calibration data disagrees sharply with the shipped prior" before running --apply for these tiers.\n` : '_No tier moved more than 40% from the current prior._\n'}

## This is a DRY RUN. Nothing has changed.

Re-run with \`--apply\` to write \`.agents/estimation/complexity-taxonomy.json\`
(project-local — never the bundle's shipped default) and append a dated entry
to \`.agents/estimation/calibration-log.md\`.
`;
}

function loadRows(paths) {
  const rows = [];
  for (const p of paths) {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    rows.push(...(data.rows || data));
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`Usage: node calibrate.mjs --training-set <path> [--training-set <path> ...] [options]
  --training-set <path>   repeatable — one or more build-training-set.mjs outputs (merged)
  --taxonomy <path>       override current taxonomy for the comparison (default: project-local, else bundled)
  --apply                 write .agents/estimation/complexity-taxonomy.json + append calibration-log.md
                          (omit for a dry-run proposal only — the default, and the safe choice)
  --out <path>            proposal file path (default: .agents/estimation/calibration-proposal-<date>.md)`);
    process.exit(args.length === 0 ? 1 : 0);
  }
  const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  const flagAll = (name) => args.reduce((acc, a, i) => (a === name ? [...acc, args[i + 1]] : acc), []);

  const trainingSetPaths = flagAll('--training-set');
  if (trainingSetPaths.length === 0) {
    console.error('At least one --training-set <path> is required.');
    process.exit(1);
  }
  const apply = args.includes('--apply');
  const { taxonomy, path: taxonomyPath } = loadTaxonomy(flag('--taxonomy'));

  const rows = loadRows(trainingSetPaths);
  const priced = rows.filter((r) => r.costUsd !== null && r.activeMin !== null);
  const bucketStats = computeBucketStats(rows);
  const implied = impliedMultipliers(bucketStats);

  const date = new Date().toISOString().slice(0, 10);
  const proposalPath = flag('--out') || join('.agents', 'estimation', `calibration-proposal-${date}.md`);
  mkdirSync(dirname(proposalPath), { recursive: true });
  const proposal = renderProposal({
    trainingSetPaths, bucketStats, implied, taxonomy,
    totalRows: rows.length, pricedRows: priced.length,
  });
  writeFileSync(proposalPath, proposal);
  console.log(`Wrote dry-run proposal: ${proposalPath}`);
  console.log(proposal);

  if (!apply) {
    console.log('(dry-run only — pass --apply to write the project-local taxonomy + calibration log)');
    return;
  }

  const projectTaxonomyPath = join('.agents', 'estimation', 'complexity-taxonomy.json');
  mkdirSync(dirname(projectTaxonomyPath), { recursive: true });
  const projectTaxonomy = existsSync(projectTaxonomyPath)
    ? JSON.parse(readFileSync(projectTaxonomyPath, 'utf8'))
    : JSON.parse(JSON.stringify(taxonomy)); // first calibration: start from a copy of the current default

  projectTaxonomy.bucket_stats = { ...projectTaxonomy.bucket_stats, ...bucketStats };
  projectTaxonomy.calibrated_from = [
    ...(projectTaxonomy.calibrated_from || []),
    { date, n_cases: priced.length, training_sets: trainingSetPaths },
  ];
  writeFileSync(projectTaxonomyPath, JSON.stringify(projectTaxonomy, null, 2));

  const logPath = join('.agents', 'estimation', 'calibration-log.md');
  const header = '# Calibration log — this project\n\nAppend-only. Each entry is one `calibrate.mjs --apply` run.\n\n';
  const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : header;
  const entry = `\n---\n\n## ${date}\n\n**Training set(s)**: ${trainingSetPaths.join(', ')}\n` +
    `**Rows**: ${rows.length} seen, ${priced.length} priced\n` +
    `**Tiers updated**: ${Object.keys(bucketStats).join(', ') || '(none — no priced rows)'}\n` +
    `**Proposal**: ${proposalPath}\n`;
  writeFileSync(logPath, existing + entry);

  console.log(`Applied. Wrote ${projectTaxonomyPath} and appended ${logPath}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

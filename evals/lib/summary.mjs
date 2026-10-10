// Per-case aggregation: pass rate plus the cost metrics (median and spread),
// so a change can be judged on "same pass rate, fewer tokens/turns".

function median(xs) {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function range(xs) {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
}

const METRICS = {
  turns: (r) => r.metrics.turns,
  toolCalls: (r) => r.metrics.toolCallTotal,
  totalTokens: (r) => r.metrics.totalTokens,
  outputTokens: (r) => r.metrics.usage?.output_tokens,
  roleFirstTurnContext: (r) => r.metrics.subagent?.firstTurnContext ?? r.metrics.firstTurnContext,
  costUsd: (r) => r.metrics.costUsd,
  wallSec: (r) => (r.metrics.wallMs ?? 0) / 1000,
};

export function summarize(records) {
  const byCase = new Map();
  for (const r of records) {
    if (!byCase.has(r.case)) byCase.set(r.case, []);
    byCase.get(r.case).push(r);
  }
  const cases = [];
  for (const [id, rs] of byCase) {
    const row = { case: id, trials: rs.length, passes: rs.filter((r) => r.pass).length, errors: rs.filter((r) => r.metrics.isError).length };
    for (const [k, f] of Object.entries(METRICS)) row[k] = { median: median(rs.map(f)), range: range(rs.map(f)) };
    const failedChecks = {};
    for (const r of rs) {
      for (const c of r.grade.checks || []) {
        if (c.pass) continue;
        const key = c.required === false ? `${c.id} (info)` : c.id;
        failedChecks[key] = (failedChecks[key] || 0) + 1;
      }
    }
    row.failedChecks = failedChecks;
    cases.push(row);
  }
  return { cases };
}

export function formatSummary({ cases }) {
  const head = "case                         pass   turns  tools  tokens(M)  role-ctx(k)  cost$   wall(s)";
  const rows = cases.map((c) => [
    c.case.padEnd(28),
    `${c.passes}/${c.trials}`.padEnd(6),
    String(c.turns.median ?? "-").padStart(5),
    String(c.toolCalls.median ?? "-").padStart(6),
    (c.totalTokens.median != null ? (c.totalTokens.median / 1e6).toFixed(2) : "-").padStart(10),
    (c.roleFirstTurnContext.median != null ? (c.roleFirstTurnContext.median / 1e3).toFixed(1) : "-").padStart(12),
    (c.costUsd.median != null ? c.costUsd.median.toFixed(2) : "-").padStart(7),
    (c.wallSec.median != null ? Math.round(c.wallSec.median) : "-").toString().padStart(9),
  ].join(" "));
  return [head, ...rows].join("\n");
}

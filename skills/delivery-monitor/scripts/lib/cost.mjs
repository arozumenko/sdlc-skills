// STDLIB ONLY. Dollar cost of a dispatch's token usage, per model (effort unit for calibration).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir } from './paths.mjs';

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references', 'prices.json');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const isPriceTable = (j) => j != null && typeof j === 'object' && j.models != null && typeof j.models === 'object' && !Array.isArray(j.models);
const rate = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** Why a price table's model entries cannot be used, or null. Every entry needs all four rates: entries replace a built-in
 * one whole (there is no per-field merge), and a missing rate would price as NaN and reach the ledger as a null cost. */
function entryProblem(models) {
  for (const [id, e] of Object.entries(models)) {
    if (e == null || typeof e !== 'object' || Array.isArray(e)) return `model "${id}" is not an object`;
    for (const k of ['input', 'output', 'cache_write', 'cache_read']) if (!rate(e[k])) return `model "${id}": ${k} must be a number >= 0 ($ per million tokens)`;
    if ('cache_write_1h' in e && !rate(e.cache_write_1h)) return `model "${id}": cache_write_1h must be a number >= 0`;
  }
  return null;
}

/** Built-in list prices with a project's `.agents/telemetry/delivery/prices.json` (same shape) layered on top, plus what went
 * wrong reading them. A missing override is normal (`problem: null`). `problem` is set when the built-in table or the
 * override cannot be read or parsed, has no `models` object, or has an invalid model entry (`entryProblem`); the broken
 * table is left out of `prices`, and the caller must not treat the result as fully priced. */
export function loadPricesChecked(repo) {
  const builtin = readJson(BUILTIN);
  const builtinBad = !isPriceTable(builtin) ? 'unreadable' : entryProblem(builtin.models);
  const base = builtinBad ? {} : builtin.models;
  const problem = builtinBad ? `built-in ${BUILTIN} ${builtinBad}` : null;
  const path = repo ? join(deliveryDir(repo), 'prices.json') : null;
  if (!path) return { prices: base, asOf: builtin?.as_of ?? null, problem };
  // Read directly: only "no such file" means no override. existsSync is false for a permission error too (e.g. a symlink
  // into a restricted directory), which would silently fall back to list prices.
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { prices: base, asOf: builtin?.as_of ?? null, problem };
    return { prices: base, asOf: builtin?.as_of ?? null, problem: `project override ${path} unreadable (${e.code ?? e.message})` };
  }
  let local = null; try { local = JSON.parse(text); } catch { local = null; }
  if (!isPriceTable(local)) return { prices: base, asOf: builtin?.as_of ?? null, problem: `project override ${path} is not valid JSON with a "models" object` };
  const bad = entryProblem(local.models);
  if (bad) return { prices: base, asOf: builtin?.as_of ?? null, problem: `project override ${path}: ${bad}` };
  return { prices: { ...base, ...local.models }, asOf: local.as_of ?? builtin?.as_of ?? null, problem };
}
/** Prices only (the checked loader without the problem report). */
export const loadPrices = (repo) => loadPricesChecked(repo).prices;

/** Model ids in transcripts can carry a date or context suffix (`claude-opus-5-5-20260101`, `…[1m]`), and the hook adds
 * `#fast` to a fast-mode turn's id. */
export function priceFor(prices, model) {
  if (!model) return null;
  // Own keys only: `prices.toString` is not a model.
  const own = (id) => (Object.hasOwn(prices, id) ? prices[id] : null);
  const raw = String(model);
  // An id the table lists verbatim wins.
  if (own(raw)) return own(raw);
  const fast = raw.endsWith('#fast'), id = (fast ? raw.slice(0, -5) : raw).replace(/\[.*\]$/, '');
  // Only a dated snapshot of a known id (`<id>-YYYYMMDD`) borrows its price; any other unknown id (a new version such as
  // `claude-opus-5-9`) stays unpriced rather than guessed.
  const dated = /^(.*)-\d{8}$/.exec(id), ids = dated ? [id, dated[1]] : [id];
  if (!fast) return ids.map(own).find(Boolean) ?? null;
  // Fast mode: the table's own `<id>#fast` entry if it has one, else the base model with every rate doubled (Opus 5.5 fast
  // is $8 / $40).
  const p = ids.map((x) => own(`${x}#fast`)).find(Boolean); if (p) return p;
  const base = ids.map(own).find(Boolean);
  return base ? Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * 2])) : null;
}

/** usage: {model: {input, output, cache_write, cache_write_1h, cache_read}} → {cost_usd, unpriced: [models]}. A model with no
 * price contributes nothing and is listed, so a partial cost is never mistaken for a complete one. cost_usd is rounded to
 * the micro-dollar (6 decimal places). */
export function costOf(usage, prices) {
  let total = 0; const unpriced = [];
  for (const [model, u] of Object.entries(usage ?? {})) {
    // Host-generated rows (Claude Code's `<synthetic>` model) carry no tokens: nothing to price, and not an unpriced gap.
    if (!Object.values(u ?? {}).some((v) => v > 0)) continue;
    const p = priceFor(prices, model);
    if (!p) { unpriced.push(model); continue; }
    total += ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output + (u.cache_write ?? 0) * p.cache_write + (u.cache_write_1h ?? 0) * (p.cache_write_1h ?? p.input * 2) + (u.cache_read ?? 0) * p.cache_read) / 1e6;
  }
  return { cost_usd: Math.round(total * 1e6) / 1e6, unpriced };
}

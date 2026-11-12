// STDLIB ONLY. Dollar cost of a dispatch's token usage, per model (effort unit for calibration).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir } from './paths.mjs';

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references', 'prices.json');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Built-in list prices, with a project's `.agents/telemetry/delivery/prices.json` (same shape) layered on top. */
export function loadPrices(repo) {
  const base = readJson(BUILTIN)?.models ?? {};
  const local = repo && existsSync(join(deliveryDir(repo), 'prices.json')) ? readJson(join(deliveryDir(repo), 'prices.json'))?.models ?? {} : {};
  return { ...base, ...local };
}

/** Model ids in transcripts can carry a date or context suffix (`claude-opus-5-5-20260101`, `…[1m]`). */
export function priceFor(prices, model) {
  if (!model) return null;
  // `<model>#fast` marks fast-mode turns: same model, every rate doubled (Opus 5.5 fast is $8 / $40).
  if (String(model).endsWith('#fast')) { const p = priceFor(prices, String(model).slice(0, -5)); return p && Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v * 2])); }
  const id = String(model).replace(/\[.*\]$/, '');
  if (prices[id]) return prices[id];
  // Only a dated snapshot of a known id (`<id>-YYYYMMDD`) borrows its price; any other unknown id (a new version such as
  // `claude-opus-5-9`) stays unpriced rather than guessed.
  const dated = /^(.*)-\d{8}$/.exec(id);
  return dated && prices[dated[1]] ? prices[dated[1]] : null;
}

/** usage: {model: {input, output, cache_write, cache_read}} → {cost_usd, priced, unpriced: [models]}. A model with no price
 * contributes nothing and is listed, so a partial cost is never mistaken for a complete one. */
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

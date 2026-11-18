// STDLIB ONLY. Global dispatch accounting, separate from report and calibration assembly.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { resolveObservations } from './events.mjs';
import { readDispatches, reduce } from './dispatches.mjs';
import { costOf, loadPricesChecked } from './cost.mjs';
import { cliError, deliveryDir, sha256 } from './paths.mjs';
const round = (n) => Math.round(n * 1e6) / 1e6;
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const COUNTERS = new Set(['input', 'output', 'cache_write', 'cache_write_1h', 'cache_read']);
const validUsage = (u) => u != null && typeof u === 'object' && !Array.isArray(u) && Object.values(u).every(c => c != null && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length > 0 && Object.entries(c).every(([k,n]) => COUNTERS.has(k) && Number.isSafeInteger(n) && n >= 0));

/** Only resolved hook ends establish an allocation. Starts remain independent coverage evidence. */
export function legacyBridge(resolved, prices, pricesProblem = false) {
  const keys = new Map();
  for (const r of resolved.active) {
    if (r.source !== 'hook' || !/^claude:[^:]+:[^:]+$/.test(r.source_record_id) || !['dispatched','dispatch_ended'].includes(r.event)) continue;
    const key = r.source_record_id;
    if (!keys.has(key)) keys.set(key, { starts: [], allocations: [] });
    const value = keys.get(key);
    if (r.event === 'dispatched') value.starts.push(r.at); else value.allocations.push(r);
  }
  for (const value of keys.values()) {
    value.started_at = value.starts.sort((a,b) => Date.parse(a)-Date.parse(b))[0] ?? null;
    const usages = value.allocations.map(r => r.meta?.agent?.usage);
    const priced = usages.filter(validUsage).map(u => pricesProblem ? {cost_usd:0,unpriced:['<prices-unreadable>']} : costOf(u,prices));
    value.cost_usd = priced.length && usages.every(validUsage) ? Math.max(...priced.map(p=>p.cost_usd)) : null;
    value.unpriced = usages.some(u=>!validUsage(u)) || priced.some(p=>p.unpriced.length>0);
    value.inconsistent = new Set(usages.map(u => JSON.stringify(canonical(u)))).size > 1;
    value.class = value.allocations.some(r=>r.item_id != null) ? 'item' : value.allocations.length ? 'plan' : null;
  }
  return keys;
}

/** Lifetime spend of keys selected by dispatch start, never by the end or capture time. */
export function spendReport(repo, { since = null, until = null } = {}) {
  for (const [name,v] of Object.entries({since,until})) if (v != null && !Number.isFinite(Date.parse(v))) throw cliError('USAGE', `${name} must be an ISO date`);
  if (since && until && Date.parse(since) >= Date.parse(until)) throw cliError('USAGE','since must precede until');
  const window = {since: since ? new Date(since).toISOString():null, until:until ? new Date(until).toISOString():null};
  const raw = readDispatches(repo), stored = reduce(raw), resolved = resolveObservations(repo), loaded = loadPricesChecked(repo);
  const legacy = legacyBridge(resolved, loaded.prices, Boolean(loaded.problem));
  const doc = { cohort: 'spend of dispatches started in [since, until)', window, total_usd:0, exact_usd:0, estimated_usd:0,
    by_class:Object.fromEntries(['item','plan','not-in-ledger'].map(c=>[c,{usd:0,count:0}])), unpriced:0, discrepancy:{count:0,usd:0},
    legacy_inconsistent:0, observation_conflicts:resolved.conflicts.length, legacy_start_only:0, unknown_start:0,
    identity_uncertain:0, model_conflict:0, evidence_conflict:0, unattributed_share:null, flag:false, inputs:[...resolved.files,...raw.files], keys:[] };
  const pricePaths = [fileURLToPath(new URL('../../references/prices.json',import.meta.url)),join(deliveryDir(repo),'prices.json')];
  for (const path of pricePaths) if (existsSync(path)) {
    try { const bytes=readFileSync(path); doc.inputs.push({path,sha256:sha256(bytes),bytes:bytes.length}); }
    catch { /* The checked loader reports unreadable prices; there are no readable bytes to hash. */ }
  }
  if (loaded.problem) doc.prices_problem=loaded.problem;
  const priced = (u) => loaded.problem ? {cost_usd:0,unpriced:['<prices-unreadable>']} : costOf(u,loaded.prices);
  for (const key of [...new Set([...stored.keys(),...legacy.keys()])].sort()) {
    if (raw.tombstones.has(key)) continue;
    const s=stored.get(key), l=legacy.get(key);
    const started_at=l?.started_at ?? s?.started_at ?? null;
    if (!started_at) doc.unknown_start++;
    if ((since || until) && (!started_at || since && Date.parse(started_at)<Date.parse(since) || until && Date.parse(started_at)>=Date.parse(until))) continue;
    if (!s && !l?.allocations.length) { doc.legacy_start_only++; continue; }
    const sc=s ? priced(s.usage):null, anon=s ? priced(s.anon.usage):null;
    const lc=l?.allocations.length ? l.cost_usd:null;
    const usd=Math.max(sc?.cost_usd ?? 0,lc ?? 0), cls=l?.class ?? 'not-in-ledger';
    const unpriced=Boolean(sc?.unpriced.length || l?.unpriced || !sc && lc===null);
    if(unpriced) doc.unpriced++;
    // Compare fully priced sides in micro-dollars so the strict 1% boundary is exact.
    if(sc && lc!==null && !sc.unpriced.length && !l.unpriced && Math.max(sc.cost_usd,lc)>0 && Math.abs(Math.round(sc.cost_usd*1e6)-Math.round(lc*1e6))*100 > Math.max(Math.round(sc.cost_usd*1e6),Math.round(lc*1e6))) {
      doc.discrepancy.count++; doc.discrepancy.usd+=Math.abs(sc.cost_usd-lc);
    }
    if(l?.inconsistent) doc.legacy_inconsistent++;
    if(s?.identity_uncertain) doc.identity_uncertain++;
    if(s?.model_conflict) doc.model_conflict++;
    if(s?.evidence_conflict) doc.evidence_conflict++;
    const estimated_usd=anon?.cost_usd ?? 0;
    const exact_usd=round(usd-estimated_usd);
    doc.total_usd+=usd;doc.exact_usd+=exact_usd;doc.estimated_usd+=estimated_usd;
    doc.by_class[cls].usd+=usd;doc.by_class[cls].count++;
    doc.keys.push({dispatch_key:key,started_at,class:cls,usd,exact_usd,estimated_usd,unpriced,flags:s?.flags ?? []});
  }
  for(const k of ['total_usd','exact_usd','estimated_usd']) doc[k]=round(doc[k]);
  for(const c of Object.values(doc.by_class)) c.usd=round(c.usd);
  doc.discrepancy.usd=round(doc.discrepancy.usd);
  doc.unattributed_share=doc.total_usd ? (doc.by_class.plan.usd+doc.by_class['not-in-ledger'].usd)/doc.total_usd:null;
  doc.flag=doc.unattributed_share!==null && doc.unattributed_share>0.1;
  return doc;
}
export function renderSpend(doc) {
  const out=[`SPEND spend of dispatches started in [${doc.window.since ?? 'since'}, ${doc.window.until ?? 'until'})${!doc.window.since&&!doc.window.until?' (all starts, including unknown-start)':''}`,
    `  total_usd=${doc.total_usd.toFixed(6)} exact_usd=${doc.exact_usd.toFixed(6)} estimated_usd=${doc.estimated_usd.toFixed(6)}`];
  for(const [c,v] of Object.entries(doc.by_class)) out.push(`  ${c}: usd=${v.usd.toFixed(6)} count=${v.count}`);
  out.push(`  unpriced=${doc.unpriced} discrepancy=${doc.discrepancy.count} discrepancy_usd=${doc.discrepancy.usd.toFixed(6)} legacy_inconsistent=${doc.legacy_inconsistent} observation_conflicts=${doc.observation_conflicts}`,
    `  legacy-start-only=${doc.legacy_start_only} unknown-start=${doc.unknown_start} identity-uncertain=${doc.identity_uncertain} model-conflict=${doc.model_conflict} evidence-conflict=${doc.evidence_conflict}`,
    `  unattributed_share=${doc.unattributed_share===null?'null':doc.unattributed_share}`);
  if(doc.flag)out.push('FLAG unattributed spend exceeds 10%');
  if(doc.prices_problem)out.push(`  prices: ${doc.prices_problem}`);
  for(const f of doc.inputs)out.push(`  input ${f.path} sha256=${f.sha256}`);
  return out.join('\n')+'\n';
}
export function statusSpend(repo,{now=Date.now()}={}) {
  const d=spendReport(repo,{since:new Date(now-7*86400000).toISOString(),until:new Date(now).toISOString()});
  return `SPEND 7d: total_usd=${d.total_usd.toFixed(6)} unattributed_share=${d.unattributed_share??'null'} unpriced=${d.unpriced}${d.flag?' FLAG unattributed spend exceeds 10%':''}\n`;
}

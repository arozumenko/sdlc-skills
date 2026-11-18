// STDLIB ONLY. Spend-only attribution from captured evidence and the current run catalogue.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plansDir, decodeSegment, sha256 } from './paths.mjs';
import { captureRefs, readDispatches, reduce } from './dispatches.mjs';
import { resolveObservations } from './events.mjs';
import { expandRef } from './associate.mjs';

const lower = s => String(s).toLowerCase();
// A dangling symlink is not "absent": lstat sees the link even when its target cannot be resolved.
const lstatExists = p => { try { lstatSync(p); return true; } catch { return false; } };
const compiled = new Map();
const regex = pattern => { if (!compiled.has(pattern)) compiled.set(pattern, new RegExp(pattern,'i')); return compiled.get(pattern); };
const round = n => Math.round(n * 1e6) / 1e6;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const iso = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))?$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(`${v.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10) === v.slice(0,10);
const eligibleItems = r => r.items.filter(i => ['task','mission'].includes(i.level) && !i.cancelled);
const prefixes = r => [r.branch_prefix].flat().filter(p => typeof p === 'string' && p);
const prefixHit = (r,h) => prefixes(r).some(p => lower(h).includes(lower(p)));
const uniqueItems = items => [...new Map(items.map(i => [JSON.stringify([i.plan,i.item_id]),i])).values()].sort((a,b) => a.plan.localeCompare(b.plan) || a.item_id.localeCompare(b.item_id));
const evidence = (items, empty = 'no-evidence') => ({ items: uniqueItems(items), state: items.length ? uniqueItems(items).length === 1 ? 'unique' : 'ambiguous' : empty });

/** Unlike listRuns, a damaged competitor must never silently disappear. */
export function loadRunsChecked(repo) {
  const dir = plansDir(repo), runs = [], inputs = [], seen = new Set();
  // Only a missing directory means "no plans"; any other failure to read it must not look like an empty catalogue.
  let names;
  try { names = readdirSync(dir); }
  catch (e) { if (e.code === 'ENOENT' && !lstatExists(dir)) return { runs, inputs }; throw new Error(`${dir}: ${e.code ?? e.message}`); }
  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    const path = join(dir,name);
    try {
      const bytes = readFileSync(path), r = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      const fail = message => { throw new Error(message); };
      if (!object(r) || typeof r.run !== 'string' || r.run !== decodeSegment(name.slice(0,-5)) || seen.has(r.run)) fail('invalid or duplicate run');
      if (typeof r.campaign_id !== 'string' || !r.campaign_id.trim() || !['open','closed'].includes(r.status) || !Array.isArray(r.items)) fail('invalid run schema');
      for (const field of ['observation_start','registered_at']) if (field in r && !iso(r[field])) fail(`invalid ${field}`);
      if (!iso(r.observation_start ?? r.registered_at) || r.status === 'closed' && !iso(r.updated_at)) fail('invalid scope dates');
      const ids = new Set();
      for (const i of r.items) {
        if (!object(i) || typeof i.item_id !== 'string' || ids.has(i.item_id) || typeof i.ref !== 'string' || !i.ref.trim() || !['campaign','mission','task'].includes(i.level)) fail('invalid item');
        ids.add(i.item_id);
        if ('cancelled' in i && typeof i.cancelled !== 'boolean' || 'branch' in i && i.branch !== null && typeof i.branch !== 'string') fail('invalid item options');
      }
      // plan register saves an unset branch_map / branch_prefix / source_epoch as null: null means absent.
      if (r.branch_map != null) {
        if (!Array.isArray(r.branch_map)) fail('invalid branch_map');
        for (const e of r.branch_map) { if (!object(e) || typeof e.pattern !== 'string' || typeof e.ref !== 'string') fail('invalid branch_map entry'); new RegExp(e.pattern,'i'); }
      }
      if (r.branch_prefix != null && !(typeof r.branch_prefix === 'string' || Array.isArray(r.branch_prefix) && r.branch_prefix.every(p => typeof p === 'string'))) fail('invalid branch_prefix');
      if (r.source_epoch != null && (!object(r.source_epoch) || 'integration_ref' in r.source_epoch && r.source_epoch.integration_ref !== null && typeof r.source_epoch.integration_ref !== 'string')) fail('invalid source_epoch.integration_ref');
      seen.add(r.run); runs.push(r); inputs.push({path,sha256:sha256(bytes),bytes:bytes.length});
    } catch (e) { throw new Error(`${path}: ${e.message}`); }
  }
  return { runs, inputs };
}

export function deriveQualifiers(runs) {
  const campaigns = new Map(), refs = new Set(runs.flatMap(r => r.items.filter(i => ['task','mission'].includes(i.level)).map(i=>lower(i.ref))));
  for (const r of runs) {
    const segment = r.campaign_id.split('-')[0], q = lower(segment);
    if (!/\d/.test(segment) || !captureRefs(segment).refs.some(t => t === segment) || refs.has(q)) continue;
    if (!campaigns.has(q)) campaigns.set(q,new Set());
    campaigns.get(q).add(r.campaign_id);
  }
  return new Map([...campaigns].filter(([,cs])=>cs.size===1).sort(([a],[b])=>a.localeCompare(b)).map(([q,cs])=>[q,[...cs][0]]));
}
const restricted = (runs, qualifiers, qs) => qs.length ? runs.filter(r => qs.some(q => qualifiers.get(q) === r.campaign_id)) : runs;
export function textEvidence(tokens, runs, qualifiers = new Map(), qs = []) {
  const ids = [...new Set(tokens.filter(t=>/\d/.test(t)).map(lower))];
  const wanted = ids.filter(t=>!qualifiers.has(t));
  const items = restricted(runs,qualifiers,qs).flatMap(r => eligibleItems(r).filter(i=>wanted.includes(lower(i.ref))).map(i=>({...i,plan:r.run})));
  return evidence(items,ids.length ? 'none-matching':'no-evidence');
}

export function branchCandidates(run, head) {
  if (!head || prefixes(run).length && !prefixHit(run,head)) return [];
  const refs = new Set();
  for (const e of run.branch_map ?? []) {
    const m = regex(e.pattern).exec(head);
    const ref = m && expandRef(e.ref,m.groups);
    if (ref) refs.add(lower(ref));
  }
  return eligibleItems(run).filter(i => i.branch && lower(i.branch) === lower(head) || refs.has(lower(i.ref)))
    .map(i=>({...i,plan:run.run})).sort((a,b)=>a.item_id.localeCompare(b.item_id));
}
const result = (level='none',evidence='no-evidence',plan=null,item_id=null,flags=[]) => ({plan,item_id,level,evidence,flags});
const itemResult = (i,e,flags=[]) => result(i.level,e,i.plan,i.item_id,flags);
const sameRun = xs => xs.length && new Set(xs.map(i=>i.plan)).size===1;
const sameItem = (a,b) => a.plan === b.plan && a.item_id === b.item_id;
export function decide(text, branch, branchPlan = null) {
  const C=text.items, B=branch.items;
  if (text.state === 'unique') {
    if (branch.state === 'unique') return itemResult(C[0],sameItem(C[0],B[0])?'text+branch':'text',sameItem(C[0],B[0])?[]:['branch-disagrees']);
    return itemResult(C[0],'text');
  }
  if (text.state === 'ambiguous') {
    if (branch.state === 'unique') return C.some(i=>sameItem(i,B[0])) ? itemResult(B[0],'branch-resolves-text') : result('none','conflict');
    const union = [...C,...B];
    return sameRun(union) ? result('plan','text-plan',C[0].plan) : result('none','ambiguous');
  }
  if (branch.state === 'unique') return itemResult(B[0],'branch-only');
  if (branch.state === 'ambiguous') return sameRun(B) ? result('plan','branch-plan',B[0].plan) : result('none','ambiguous');
  return branchPlan ? result('plan','branch-plan',branchPlan) : result();
}

function infer(key, snapshot, runs, qualifiers) {
  if (!key.started_at) return result('none','unknown-start');
  const scope = runs.filter(r => Date.parse(r.observation_start ?? r.registered_at) <= Date.parse(key.started_at) && (r.status !== 'closed' || Date.parse(key.started_at) < Date.parse(r.updated_at)));
  const s = snapshot ?? {refs:{desc:[],msg:[],truncated:false},follow_ups:[]};
  const qIn = ts => [...new Set(ts.map(lower).filter(t=>qualifiers.has(t)))].sort();
  const qd=qIn(s.refs.desc); let qs=qd;
  let text=textEvidence(s.refs.desc,scope,qualifiers,qd), fromBrief=false;
  if (['no-evidence','none-matching'].includes(text.state)) {
    fromBrief=true;
    qs=qd.length?qd:qIn(s.refs.msg);
    text=textEvidence(s.refs.msg,scope,qualifiers,qs);
  }
  const selected=restricted(scope,qualifiers,qs);
  if (qs.length && !selected.length) return result('none','qualifier-out-of-scope');
  if (s.refs.truncated) text= evidence([]);
  const flags=[], head=s.branch;
  const conflicted=s.evidence_conflicts?.includes('branch');
  if(conflicted)flags.push('branch-conflicted');
  const usable=!conflicted && head && !['head','main','master'].includes(lower(head)) && !scope.some(r=>r.source_epoch?.integration_ref && lower(r.source_epoch.integration_ref)===lower(head));
  const branch=usable?evidence(selected.flatMap(r=>branchCandidates(r,head)),'none-matching'):evidence([]);
  const planHits=usable ? selected.filter(r=>prefixHit(r,head)) : [];
  let d=decide(text,branch,planHits.length===1?planHits[0].run:null);
  // Briefs name many unrelated ids; text from the brief alone is a heuristic unless the branch confirms it.
  if (fromBrief && d.evidence==='text') d={...d,evidence:'brief-only'};
  if (fromBrief && d.evidence==='text-plan') d={...d,evidence:'brief-plan'};
  if(s.refs.truncated && ['branch-only','branch-plan'].includes(d.evidence))flags.push('text-incomplete');
  if (['task','mission'].includes(d.level)) {
    const refs = new Set((s.follow_ups ?? []).flatMap(f=>f.refs).map(lower));
    if (selected.find(r=>r.run===d.plan)?.items.some(i=>['task','mission'].includes(i.level) && !i.cancelled && i.item_id!==d.item_id && refs.has(lower(i.ref))))flags.push('crossed');
  }
  d.flags=[...d.flags,...flags].sort(); return d;
}

const LEVELS=['legacy-item','legacy-plan','task','mission','plan','none'];
const EVIDENCES=['legacy','legacy-withdrawn','legacy-conflict','unknown-start','qualifier-out-of-scope','text+branch','text','branch-resolves-text','conflict','text-plan','ambiguous','branch-only','branch-plan','brief-only','brief-plan','no-evidence'];
const heuristic = d => ['branch-only','branch-plan','brief-only','brief-plan'].includes(d.evidence);
/** Returns a new report. Failure never exposes partially enriched keys. Base errors belong to the caller. */
export function attributeSpend(repo, baseDoc, {byPlan=false} = {}) {
  try {
    const {runs,inputs}=loadRunsChecked(repo), qualifiers=deriveQualifiers(runs);
    const stored=reduce(readDispatches(repo)), resolved=resolveObservations(repo,{detail:true});
    const withdrawn=new Set(resolved.retracted.filter(r=>r.source==='hook' && r.event==='dispatch_ended' && /^claude:[^:]+:[^:]+$/.test(r.source_record_id)).map(r=>r.source_record_id));
    const conflicts=new Set();
    for(const c of resolved.conflicts) {
      const [source,record,,event]=c.observation_id.split(':').map(decodeURIComponent);
      if(source==='hook' && event==='dispatch_ended' && /^claude:[^:]+:[^:]+$/.test(record)) conflicts.add(record);
    }
    const keys=baseDoc.keys.map(k=>({...k,attribution:k.class!=='not-in-ledger' ? result(`legacy-${k.class}`,'legacy') : conflicts.has(k.dispatch_key)?result('none','legacy-conflict'):withdrawn.has(k.dispatch_key)?result('none','legacy-withdrawn'):infer(k,stored.get(k.dispatch_key),runs,qualifiers)}));
    const by_level=Object.fromEntries(LEVELS.map(n=>[n,{count:0,usd:0}]));
    const by_evidence=Object.fromEntries(EVIDENCES.map(n=>[n,{count:0,usd:0}]));
    const rows=new Map(runs.map(r=>[r.run,{plan:r.run,recovered_item:{confident:0,heuristic:0},recovered_plan:{confident:0,heuristic:0}}]));
    const project=Object.fromEntries(['legacy-item','legacy-plan','legacy-withdrawn','legacy-conflict','unattributed'].map(n=>[n,0]));
    let confident=0, inclusive=0;
    for(const k of keys) {
      const d=k.attribution;
      for(const bucket of [by_level[d.level],by_evidence[d.evidence]]) {bucket.count++;bucket.usd+=k.usd;}
      if(d.level!=='none') {inclusive+=k.usd;if(!heuristic(d))confident+=k.usd;}
      if(d.plan) rows.get(d.plan)[d.level==='plan'?'recovered_plan':'recovered_item'][heuristic(d)?'heuristic':'confident']+=k.usd;
      else project[d.level.startsWith('legacy')?d.level:['legacy-withdrawn','legacy-conflict'].includes(d.evidence)?d.evidence:'unattributed']+=k.usd;
    }
    for(const b of [...Object.values(by_level),...Object.values(by_evidence)])b.usd=round(b.usd);
    for(const row of rows.values())for(const b of [row.recovered_item,row.recovered_plan])for(const n of Object.keys(b))b[n]=round(b[n]);
    for(const n of Object.keys(project))project[n]=round(project[n]);
    const attribution={policy:'pr2.v1',by_level,by_evidence,attributed_share:baseDoc.total_usd?round(confident)/baseDoc.total_usd:null,attributed_share_incl_heuristic:baseDoc.total_usd?round(inclusive)/baseDoc.total_usd:null,inputs};
    if(byPlan) {attribution.by_plan=[...rows.values()];attribution.project=project;}
    return {...baseDoc,keys,attribution};
  } catch(e) {return {...baseDoc,attribution:{unavailable:e.message}};}
}
export function renderAttribution(doc) {
  const a=doc.attribution;
  if(a.unavailable)return `ATTRIBUTION unavailable: ${a.unavailable}\n`;
  const money=n=>`$${n.toFixed(6)}`;
  const out=['ATTRIBUTION policy=pr2.v1',`  recovered: ${['task','mission','plan','none'].map(n=>`${n}=${money(a.by_level[n].usd)}`).join(' ')} (of not-in-ledger ${money(doc.by_class['not-in-ledger'].usd)})`];
  for(const [name,b] of Object.entries(a.by_evidence))out.push(`  ${name}: count=${b.count} usd=${b.usd.toFixed(6)}`);
  out.push(`  attributed_share=${a.attributed_share??'null'}`,`  attributed_share_incl_heuristic=${a.attributed_share_incl_heuristic??'null'}`);
  if(a.by_plan) {
    out.push('BY PLAN');
    for(const row of a.by_plan)out.push(`  ${row.plan}: recovered_item confident=${money(row.recovered_item.confident)} heuristic=${money(row.recovered_item.heuristic)} recovered_plan confident=${money(row.recovered_plan.confident)} heuristic=${money(row.recovered_plan.heuristic)}`);
    for(const [name,usd] of Object.entries(a.project))out.push(`  ${name}: ${money(usd)}`);
  }
  return out.join('\n')+'\n';
}

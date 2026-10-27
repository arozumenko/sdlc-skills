import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finding } from '../finding.mjs';
import { parseShellLiterals } from '../shell-literals.mjs';

const fmt = (n) => n.toLocaleString('en-US');
const suffixOf = (role) => role.toUpperCase().replace(/[^A-Z0-9]/g, '_');
const escBytes = (text) => Buffer.byteLength(JSON.stringify(text).slice(1, -1), 'utf8');

function defaultsFromLib(pkgRoot) {
  const lib = readFileSync(join(pkgRoot, 'hooks', 'lib.sh'), 'utf8');
  const grab = (n, fb) => (lib.match(new RegExp(`^${n}="([^"]*)"`, 'm')) || [, fb])[1];
  return { docs: grab('SDLC_SHARED_DOCS_DEFAULT', 'testing profile workflow conventions role-overrides team-comms'), memory: grab('SDLC_ROLE_MEMORY_FILES_DEFAULT', 'SOUL.md RULES.md snapshot.md MEMORY.md project_briefing.md') };
}

// Shell `:-` and `:=` treat an empty value as unset, so '' falls through like a missing var.
const set = (v) => (v == null || v === '' ? undefined : v);

function resolveList(value, globalName, vars, fallback) {
  if (set(value) === undefined) return set(vars[globalName]) ?? fallback;
  const m = /^\$\{(\w+):-([^}]*)\}$/.exec(value);
  if (m) return set(vars[m[1]]) ?? m[2];
  return value;
}

export function roleInputs(ctx, target = 'claude') {
  const dir = '.claude/hooks/sdlc-skills';
  const vars = {};
  // lib.sh sources config.sh first, then config-defaults.sh, whose generated lines are all `: "${VAR:=…}"`
  // (assign only if unset or empty). So a non-empty config.sh value wins, and the defaults fill the rest.
  for (const cfg of ['config.sh', 'config-defaults.sh']) {
    const r = ctx.fs.readText(`${dir}/${cfg}`);
    if (r.status !== 'ok') continue;
    for (const [k, v] of Object.entries(parseShellLiterals(r.content).vars)) if (set(vars[k]) === undefined) vars[k] = v;
  }
  const agents = ctx.fs.list('.claude/agents').entries.filter((e) => e.type === 'dir').map((e) => e.name);
  const defaultsFile = ctx.fs.readText(`${dir}/config-defaults.sh`);
  const roster = defaultsFile.status === 'ok' ? agents.filter((a) => set(vars[`SDLC_SHARED_DOCS_${suffixOf(a)}`]) !== undefined) : agents;
  const defs = defaultsFromLib(ctx.pkgRoot);
  return roster.map((role) => {
    const s = suffixOf(role);
    const memory = resolveList(vars[`SDLC_ROLE_MEMORY_FILES_${s}`], 'SDLC_ROLE_MEMORY_FILES', vars, defs.memory);
    const docs = resolveList(vars[`SDLC_SHARED_DOCS_${s}`], 'SDLC_SHARED_DOCS', vars, defs.docs);
    const files = []; let unknown = null;
    const add = (candidates) => {
      for (const rel of candidates) {
        const r = ctx.fs.readText(rel);
        if (r.status === 'missing') continue;
        if (r.status !== 'ok') { unknown = unknown || `${rel} is ${r.status}`; return; }
        files.push({ rel, bytes: escBytes(r.content) }); return;
      }
    };
    if (memory !== '__none__') for (let mf of memory.split(/\s+/).filter(Boolean)) { if (!mf.includes('.')) mf += '.md'; add([`.agents/memory/${role}/${mf}`, `.claude/agents/${role}/${mf}`, `.cursor/agents/${role}/${mf}`, `.windsurf/agents/${role}/${mf}`]); }
    if (docs !== '__none__') for (const n of docs.split(/\s+/).filter(Boolean)) add([`.agents/${n.replace(/\.md$/, '')}.md`]);
    return { role, files, unknown };
  });
}

export const payloadCheck = {
  name: 'payload',
  run(ctx) {
    const out = [];
    for (const t of (ctx.detected || []).filter((x) => x.evidence && x.examined && x.scriptsPresent)) {
      if (t.target !== 'claude') { out.push(finding({ check: 'payload', target: t.target, severity: 'skipped', message: 'payload estimate covers Claude Code only in this version' })); continue; }
      const info = ctx.hookInfo?.[t.target];
      if (!info || info.match === 'unrecognized' || !info.configKnown || info.budget == null) { out.push(finding({ check: 'payload', target: t.target, severity: 'unknown', message: 'payload estimate unknown: hook version or config not recognised' })); continue; }
      const before = out.length; let largest = null;
      for (const r of roleInputs(ctx, t.target)) {
        if (r.unknown) { out.push(finding({ check: 'payload', target: t.target, severity: 'unknown', message: `${r.role}: estimate unknown (${r.unknown})` })); continue; }
        const total = r.files.reduce((n, f) => n + f.bytes, 0);
        if (!largest || total > largest.total) largest = { role: r.role, total };
        if (total > info.budget) out.push(finding({ check: 'payload', target: t.target, severity: 'warning', message: `${r.role}: estimated candidate input ${fmt(total)} bytes > ${fmt(info.budget)}-byte budget; some content may become required reading`, fix: 'trim or split the largest files listed', data: { top: [...r.files].sort((a, b) => b.bytes - a.bytes).slice(0, 3) } }));
      }
      if (out.length === before) out.push(finding({ check: 'payload', target: t.target, severity: 'ok', message: largest ? `estimated: largest ${largest.role} ${fmt(largest.total)} / ${fmt(info.budget)} bytes` : 'no roles found' }));
    }
    return out;
  },
};

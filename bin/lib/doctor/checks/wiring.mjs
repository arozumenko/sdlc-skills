import { isDeepStrictEqual } from 'node:util';
import { expectedCoreHookSpec } from '../../core-hook-spec.mjs';
import { finding } from '../finding.mjs';
import { readJson, hookEntries } from './common.mjs';

export const fixCommand = (target) => `npx github:arozumenko/sdlc-skills init <your usual --factory/--agents flags> --target ${target} --update`;
const strip = (e) => { if (!e || typeof e !== 'object') return e; const { _factory, _bundle, ...rest } = e; return rest; };
const VERB = /run-hook\.cmd"?\s+([a-z-]+)/g;
// Verbs come from the entry's parsed string values (command, bash, powershell, ...): JSON text escapes the quotes.
function* commandVerbs(v) {
  if (typeof v === 'string') yield* v.matchAll(VERB);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* commandVerbs(x);
}

export const wiringCheck = {
  name: 'wiring',
  run(ctx) {
    const out = [];
    for (const t of (ctx.detected || []).filter((x) => x.evidence && x.examined)) {
      const spec = expectedCoreHookSpec(t.target);
      const before = out.length;
      const parsed = spec.configFiles.map((file) => ({ file, j: readJson(ctx.fs, file) }));
      for (const { file, j } of parsed) {
        if (j.status !== 'ok' && j.status !== 'absent')
          out.push(finding({ check: 'wiring', target: t.target, severity: 'warning', message: `${file} is ${j.status}${j.reason ? ` (${j.reason})` : ''}; it was not examined` }));
        if (t.target === 'claude' && j.status === 'ok' && j.value.disableAllHooks === true)
          out.push(finding({ check: 'wiring', target: t.target, severity: 'error', message: `hooks disabled by disableAllHooks in ${file}`, fix: `remove "disableAllHooks": true from ${file}` }));
      }
      const unexamined = parsed.some((p) => p.j.status !== 'ok' && p.j.status !== 'absent');
      const entries = parsed.filter((p) => p.j.status === 'ok').flatMap((p) => hookEntries(p.j.value).map((e) => ({ ...e, file: p.file })));
      for (const [event, expected] of Object.entries(spec.events)) {
        const here = entries.filter((e) => e.event === event);
        if (!here.length) {
          // A file we could not read may hold the wiring: unknown, never a false "not wired".
          if (unexamined) out.push(finding({ check: 'wiring', target: t.target, severity: 'unknown', message: `${event}: cannot tell whether it is wired (a config file was not examined)` }));
          else out.push(finding({ check: 'wiring', target: t.target, severity: 'error', message: `${event} not wired in ${spec.configFiles[0]}`, fix: fixCommand(t.target) }));
          continue;
        }
        const canonical = here.some((e) => expected.some((x) => isDeepStrictEqual(strip(e.entry), x)));
        if (!canonical) out.push(finding({ check: 'wiring', target: t.target, severity: 'warning', message: `${event}: unrecognized wiring in ${here[0].file} (differs from what init writes)`, fix: fixCommand(t.target) }));
      }
      for (const e of entries) {
        for (const m of commandVerbs(e.entry)) {
          for (const f of ['run-hook.cmd', m[1]]) {
            const rel = `${spec.scriptsDir}/${f}`;
            if (!ctx.fs.exists(rel)) out.push(finding({ check: 'wiring', target: t.target, severity: 'error', message: `${e.event}: wired command points to missing ${rel}`, fix: fixCommand(t.target) }));
          }
        }
      }
      if (out.length === before) out.push(finding({ check: 'wiring', target: t.target, severity: 'ok', message: `${Object.keys(spec.events).join(', ')} wired as init writes them` }));
    }
    return dedupe(out);
  },
};

function dedupe(fs) { const seen = new Set(); return fs.filter((f) => { const k = `${f.target}|${f.severity}|${f.message}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

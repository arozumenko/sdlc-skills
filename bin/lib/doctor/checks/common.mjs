import { CORE_HOOK_MARKER } from '../../core-hook-spec.mjs';

export function readJson(fs, rel) {
  const r = fs.readText(rel);
  if (r.status === 'missing') return { status: 'absent' };
  if (r.status !== 'ok') return { status: r.status === 'not-text' ? 'unreadable' : r.status };
  if (!r.content.trim()) return { status: 'malformed', reason: 'empty file' };
  let value;
  try { value = JSON.parse(r.content); } catch (e) { return { status: 'malformed', reason: e.message }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'malformed', reason: 'top-level value is not an object' };
  return { status: 'ok', value };
}

// Entries in a parsed hook config that reference our scripts, per event.
// claude shape: { hooks: { Event: [group{ hooks:[…] }] } }; versioned/owned: { hooks: { event: [handler] } }.
export function hookEntries(json) {
  const out = [];
  const hooks = json && typeof json === 'object' && json.hooks && typeof json.hooks === 'object' ? json.hooks : {};
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (entry && JSON.stringify(entry).includes(CORE_HOOK_MARKER)) out.push({ event, entry });
  }
  return out;
}

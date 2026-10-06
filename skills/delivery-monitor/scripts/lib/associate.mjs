// STDLIB ONLY. Branch/PR-title → plan item association, shared by hook auto-binding and git/PR backfill (spec §6.7, §20 P-3).
// Order, first unambiguous step wins: (a) exact item.branch alias, (b) ref as a whole token in the title, (c) plan.branch_map.
// Ambiguity at any step → no association and a note; never a guess. `branch_prefix` (when set) gates the whole run.
export const wordHit = (text, ref) => new RegExp(`(^|[^A-Za-z0-9-])${String(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'i').test(text ?? '');
export const expandRef = (tpl, groups) => { let ok = true; const s = String(tpl).replace(/\{(\w+)\}/g, (_, k) => { if (groups?.[k] == null) { ok = false; return ''; } return groups[k]; }); return ok ? s : null; };
const none = (how, note) => ({ items: [], how, note });
const pick = (list, how) => (list.length === 1 ? { items: list, how, note: null } : list.length > 1 ? none('ambiguous', `ambiguous ${how} match: ${list.map((i) => i.ref).join(', ')}`) : null);

export function associate(run, { head = null, title = null, levels = ['task', 'mission'] } = {}) {
  const cand = (run.items ?? []).filter((i) => levels.includes(i.level) && !i.cancelled);
  if (run.branch_prefix && !(head ?? '').toLowerCase().includes(String(run.branch_prefix).toLowerCase())) return none(null, `head ${head} does not contain branch_prefix ${run.branch_prefix}`);
  // Order (D1): alias → branch_map → title token. An empty or ambiguous step falls through to the next; the ambiguity note survives
  // only if every step fails. The branch is the stronger signal: a title routinely names neighbouring items ("M2 … follows M1").
  const notes = [], step = (list, how) => { const r = pick(list, how); if (r && r.items.length) return r; if (r) notes.push(r.note); return null; };
  const h = (head ?? '').toLowerCase();
  if (h) { const r = step(cand.filter((i) => i.branch && i.branch.toLowerCase() === h), 'alias'); if (r) return r; }
  if (head && Array.isArray(run.branch_map)) {
    for (const e of run.branch_map) {
      let m; try { m = new RegExp(e.pattern, 'i').exec(head); } catch { continue; }
      if (!m) continue;
      const ref = expandRef(e.ref, m.groups); if (!ref) continue;
      const r = step(cand.filter((i) => i.ref.toLowerCase() === ref.toLowerCase()), 'branch_map'); if (r) return r;
    }
  }
  if (title) for (const lv of levels) { const r = step(cand.filter((i) => i.level === lv && wordHit(title, i.ref)), 'title'); if (r) return r; }
  return notes.length ? none('ambiguous', notes.join('; ')) : none(null, null);
}

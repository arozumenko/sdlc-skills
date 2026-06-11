// Pure (I/O-free) helpers for resolving a feature-development-style bundle:
// a flat dev-role selection → install roster, merged skillOverlays, and merged
// briefing plans. Kept out of init.mjs so they unit-test without the CLI.
// Stdlib-only, no deps. File I/O (reading briefing files, drawing the picker)
// stays in init.mjs; these functions take already-known data and return plans.

/** Unique platform tags across the selected dev roles, in selection order. */
export function activePlatforms(devRoles, selected) {
  const out = [];
  for (const r of selected) {
    const p = devRoles[r] && devRoles[r].platform;
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Decide how dev roles get chosen, without doing any I/O.
 *  explicit: string[]|null (from --agents); devRoleNames: the bundle's dev roles. */
export function resolveSelection({ explicit, devRoleNames, yes, isTTY }) {
  if (explicit && explicit.length) {
    const roles = explicit.filter((r) => devRoleNames.includes(r));
    const unknown = explicit.filter((r) => !devRoleNames.includes(r));
    return { mode: "explicit", roles, unknown };
  }
  if (yes || !isTTY) return { mode: "all", roles: [...devRoleNames], unknown: [] };
  return { mode: "picker", roles: null, unknown: [] };
}

/** Merge one core role's skillOverlay across the active platforms.
 *  add = union; remove = intersection across active platforms, minus adds.
 *  A platform with no overlay for the role contributes an empty remove set,
 *  so any second active platform suppresses the removal. */
export function mergeCoreOverlay(platforms, active, role) {
  const add = [];
  const removeSets = [];
  for (const p of active) {
    const ov = (platforms[p] && platforms[p].skillOverlays && platforms[p].skillOverlays[role]) || {};
    for (const s of ov.add || []) if (!add.includes(s)) add.push(s);
    removeSets.push(new Set(ov.remove || []));
  }
  let remove = [];
  if (removeSets.length) remove = [...removeSets[0]].filter((s) => removeSets.every((set) => set.has(s)));
  remove = remove.filter((s) => !add.includes(s));
  return { add, remove };
}

/** Effective skillOverlays for the whole installed roster:
 *  each selected dev role's own overlay + each core role's platform-merged overlay.
 *  Core-role tuning is platform-level (union across active platforms) — it does
 *  not depend on which specific dev role of a platform was picked, matching the
 *  legacy per-team behavior. */
export function buildOverlays(bundle, selected) {
  const overlays = {};
  for (const r of selected) {
    const ov = bundle.devRoles[r] && bundle.devRoles[r].skillOverlay;
    if (ov && ((ov.add && ov.add.length) || (ov.remove && ov.remove.length))) overlays[r] = ov;
  }
  const active = activePlatforms(bundle.devRoles, selected);
  for (const role of bundle.coreAgents || []) {
    const m = mergeCoreOverlay(bundle.platforms || {}, active, role);
    if (m.add.length || m.remove.length) overlays[role] = m;
  }
  return overlays;
}

/** Which briefing file(s) feed each role's project_briefing.md.
 *  Returns { role: [{ label, path }] }; one entry = direct, many = concatenated. */
export function buildBriefingPlan(bundle, selected) {
  const plan = {};
  for (const r of selected) {
    const rel = bundle.devRoles[r] && bundle.devRoles[r].briefing;
    if (rel) plan[r] = [{ label: bundle.devRoles[r].label || r, path: rel }];
  }
  const active = activePlatforms(bundle.devRoles, selected);
  for (const role of bundle.coreAgents || []) {
    const entries = [];
    for (const p of active) {
      const pf = bundle.platforms[p];
      const rel = pf && pf.briefings && pf.briefings[role];
      if (rel) entries.push({ label: pf.label || p, path: rel });
    }
    if (entries.length) plan[role] = entries;
  }
  return plan;
}

/** Concatenate resolved briefing contents. One entry → as-is; many → headered. */
export function composeBriefing(entries) {
  if (entries.length === 1) return entries[0].content;
  return entries.map((e) => `## ${e.label} stack\n\n${e.content.trim()}`).join("\n\n");
}

/** First frontmatter description across resolved contents (for the MEMORY.md line). */
export function briefingDescription(entries) {
  for (const e of entries) {
    const m = e.content.match(/^description:\s*(.+)$/m);
    if (m) return m[1].trim();
  }
  return "Project overview and this role's focus";
}

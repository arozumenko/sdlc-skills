// Pure (I/O-free) helpers for resolving a feature-development-style factory:
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
 *  explicit: string[]|null (from --agents); devRoleNames: the factory's dev roles.
 *  `all` in an explicit list selects every dev role. `implicit` marks the
 *  non-interactive default (no nonempty --agents), which installs every role. */
export function resolveSelection({ explicit, devRoleNames, yes, isTTY }) {
  if (explicit && explicit.length) {
    if (explicit.includes("all")) return { mode: "explicit", roles: [...devRoleNames], unknown: [], implicit: false };
    const roles = explicit.filter((r) => devRoleNames.includes(r));
    const unknown = explicit.filter((r) => !devRoleNames.includes(r));
    return { mode: "explicit", roles, unknown, implicit: false };
  }
  if (yes || !isTTY) return { mode: "all", roles: [...devRoleNames], unknown: [], implicit: true };
  return { mode: "picker", roles: null, unknown: [], implicit: false };
}

/** The warning printed when a non-interactive install selected every dev role implicitly. */
export function implicitSelectionWarning(factory, roles) {
  const labels = activePlatforms(factory.devRoles, roles).map((p) => factory.platforms?.[p]?.label || p);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0] || "no";
  const example = roles.slice(0, 2).join(",");
  return [
    `  ! No --agents given in non-interactive mode, so all ${roles.length} developer roles were selected`,
    `    (${list} overlays applied to the core roles they target).`,
    `    To select only what this project uses next time:`,
    `      init --factory ${factory.id} --agents ${example} --update`,
    `    Roles and skills already installed stay on disk.`,
  ].join("\n");
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
export function buildOverlays(factory, selected) {
  const overlays = {};
  for (const r of selected) {
    const ov = factory.devRoles[r] && factory.devRoles[r].skillOverlay;
    if (ov && ((ov.add && ov.add.length) || (ov.remove && ov.remove.length))) overlays[r] = ov;
  }
  const active = activePlatforms(factory.devRoles, selected);
  for (const role of factory.coreAgents || []) {
    const m = mergeCoreOverlay(factory.platforms || {}, active, role);
    if (m.add.length || m.remove.length) overlays[role] = m;
  }
  return overlays;
}

/** Which briefing file(s) feed each role's project_briefing.md.
 *  Returns { role: [{ label, path }] }; one entry = direct, many = concatenated. */
export function buildBriefingPlan(factory, selected) {
  const plan = {};
  for (const r of selected) {
    const rel = factory.devRoles[r] && factory.devRoles[r].briefing;
    if (rel) plan[r] = [{ label: factory.devRoles[r].label || r, path: rel }];
  }
  const active = activePlatforms(factory.devRoles, selected);
  for (const role of factory.coreAgents || []) {
    const entries = [];
    for (const p of active) {
      const pf = factory.platforms[p];
      const rel = pf && pf.briefings && pf.briefings[role];
      if (rel) entries.push({ label: pf.label || p, path: rel });
    }
    if (entries.length) plan[role] = entries;
    else if (factory.briefings?.[role]) {
      plan[role] = [{ label: role, path: factory.briefings[role] }];
    }
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

/** Keep the `<!-- roles: a b -->` … `<!-- /roles -->` sections of a factory's
 *  instructions whose roles intersect `roles`; drop the rest. Markers are
 *  always stripped. Fails open so a rule is never lost: a null/empty roster
 *  (unknown) keeps everything; an opener with no closer before the next opener
 *  or EOF is malformed and only its marker is dropped. Lines inside ``` or ~~~
 *  fences are literal text, never directives. */
export function filterRoleSections(body, roles) {
  const keepAll = !roles || roles.length === 0;
  const OPEN = /^<!-- roles:\s*(.+?)\s*-->\s*$/, CLOSE = /^<!-- \/roles -->\s*$/;
  // CommonMark fences: up to 3 spaces of indent, a run of 3+ ` or ~. The closer
  // uses the same character, is at least as long, and carries nothing else.
  const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
  const lines = body.split("\n");
  // Classify each line once; markers count only outside fences.
  const kind = []; let fence = null;
  for (const l of lines) {
    if (fence) {
      const c = l.match(/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/);
      if (c && c[1][0] === fence[0] && c[1].length >= fence.length) fence = null;
      kind.push("text");
      continue;
    }
    const f = l.match(FENCE_OPEN);
    if (f && !(f[1][0] === "`" && l.slice(l.indexOf(f[1]) + f[1].length).includes("`"))) { fence = f[1]; kind.push("text"); continue; }
    kind.push(OPEN.test(l) ? "open" : CLOSE.test(l) ? "close" : "text");
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (kind[i] === "close") continue; // stray closer: drop the marker only
    if (kind[i] !== "open") { out.push(lines[i]); continue; }
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (kind[j] === "open") break;
      if (kind[j] === "close") { close = j; break; }
    }
    if (close === -1) continue; // malformed: drop the marker, keep the text that follows
    const wanted = lines[i].match(OPEN)[1].split(/[\s,]+/).filter(Boolean);
    if (keepAll || wanted.some((r) => roles.includes(r))) out.push(...lines.slice(i + 1, close));
    i = close;
  }
  return out.join("\n").replace(/(\r?\n){3,}/g, "$1$1");
}

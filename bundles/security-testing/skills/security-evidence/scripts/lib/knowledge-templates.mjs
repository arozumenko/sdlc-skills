// lib/knowledge-templates.mjs — `engagement init` step 0 (TASK-011; spec §6.9
// step 0 / P3, D12; plan §3.3 row `lib/knowledge-templates.mjs`).
//
// The bundle `seed` installs the three knowledge files into
// <st>/knowledge/. A two-skill standalone install has no `seed` (D12), so
// step 0 installs them itself from the copies shipped under
// <skill>/templates/knowledge/ (TASK-007's TEMPLATE_PATHS; check-skill-dupes
// keeps them byte-identical to the bundle's). Then, when `engagement.md` is
// absent, it copies `engagement.md.template` to <st>/engagement.md so the
// operator has a record to edit; the pipeline (TASK-008) prints the
// TEMPLATES / ENGAGEMENT lines and exits 2 EDIT-ENGAGEMENT-AND-RERUN with
// nothing else done (P3: baseline runs only with an engagement.md present).
//
//   ensureTemplates(ctx)   → {written: name[], present: name[]}   (plan §3.2 order)
//   ensureEngagementMd(ctx) → {written: boolean}
//   stepTemplates(ctx)     → {templates: "written"|"present",
//                             engagement: "present"|"template-written",
//                             written: name[], present: name[]}
//
// Existing wins, per file, by construction: every write is fsx.writeExclusive
// (`wx`), so the kernel decides "absent" and a locally edited file can never
// be overwritten — not even by two `engagement init`s racing (EEXIST from the
// loser is "present"). Step 0 checks presence only: it never parses
// engagement.md (that is ctx.engagement(), from step 1 on), never touches
// .gitignore (G-5: step 1), keys (step 3) or the baseline (step 4).
//
// The files are the bundle's own shipped prose, copied byte for byte exactly
// as `seed` copies them — they are not evidence artifacts and carry no
// consumer bytes, so no redaction pass runs over them (G-4 governs strings
// that leave memory; this module prints nothing — TASK-008 owns stdout).
//
// Imports node:fs (reads only), node:path, ./engagement.mjs (the one list of
// knowledge files, TASK-007), ./fsx.mjs (the one write-once primitive). No
// child process (G-6), no network (G-14), no clock (G-1).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGAGEMENT_FILE, KNOWLEDGE_FILES, TEMPLATE_PATHS } from "./engagement.mjs";
import { writeExclusive } from "./fsx.mjs";

/** Directory name under `<st>/` the knowledge files live in (plan §3.2). */
export const KNOWLEDGE_DIR = "knowledge";

/**
 * Copy the shipped template `name` to `dest` unless `dest` exists.
 * @returns {boolean} true when written, false when something was already there
 */
function copyUnlessPresent(name, dest) {
  const bytes = readFileSync(TEMPLATE_PATHS[name]);
  try {
    writeExclusive(dest, bytes);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Install every knowledge file into `<st>/knowledge/` that is not already
 * there. A present file — seeded, locally edited, whatever it holds — is
 * left untouched (US-007 AC-2).
 * @param {{st: string}} ctx
 * @returns {{written: string[], present: string[]}} names, each in KNOWLEDGE_FILES order
 */
export function ensureTemplates(ctx) {
  const dir = join(ctx.st, KNOWLEDGE_DIR);
  const written = [];
  const present = [];
  for (const name of KNOWLEDGE_FILES) {
    (copyUnlessPresent(name, join(dir, name)) ? written : present).push(name);
  }
  return { written, present };
}

/**
 * Copy `engagement.md.template` to `<st>/engagement.md` when absent.
 * @param {{st: string}} ctx
 * @returns {{written: boolean}}
 */
export function ensureEngagementMd(ctx) {
  return { written: copyUnlessPresent("engagement.md.template", join(ctx.st, ENGAGEMENT_FILE)) };
}

/**
 * Step 0 of `engagement init`: templates, then the engagement record.
 * `engagement: "template-written"` is the pipeline's signal to print
 * tokens.templatesLine(result), tokens.ENGAGEMENT_TEMPLATE_WRITTEN and end
 * with exit 2 EDIT-ENGAGEMENT-AND-RERUN before step 1.
 * @param {{st: string}} ctx
 * @returns {{templates: "written"|"present", engagement: "present"|"template-written", written: string[], present: string[]}}
 */
export function stepTemplates(ctx) {
  const { written, present } = ensureTemplates(ctx);
  const engagement = ensureEngagementMd(ctx).written ? "template-written" : "present";
  return { templates: written.length > 0 ? "written" : "present", engagement, written, present };
}

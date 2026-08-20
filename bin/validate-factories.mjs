#!/usr/bin/env node
// Validate every factories/<id>/factory.json against the repo. Run in CI and
// before publishing. Checks, per factory:
//   - directory name matches manifest `id`
//   - a README.md exists (the team's front-door doc, human/LLM-readable)
//   - a FACTORY.md exists with non-empty name/description/owner frontmatter
//     (the structured catalog descriptor)
//   - `agents` is a non-empty array and every entry exists under agents/
//   - every `briefings` role is in `agents` and its file exists
//   - every `skills` id resolves in skills.json (or a monorepo skills/ dir)
//   - `instructions` (if set) points at an existing file
//   - `hooks` (if set) points at a file that parses as JSON
//   - every `localAgents` entry has agents/<name>/AGENT.md in the factory dir
//   - every `localSkills` entry has skills/<name>/SKILL.md in the factory dir
// Exits non-zero with a per-error report when anything fails.
//
// `--check-externals`: opt-in, network-using mode. Instead of the factory
// checks above, fetches every skills.json `repo:` entry's upstream SKILL.md
// and verifies (a) it exists and (b) its `name:` frontmatter equals the
// registry `id` — bin/init.mjs derives the installed skill's directory name
// from that upstream `name:`, not from the registry id, so a mismatch means
// the skill silently installs under the wrong directory and any factory
// overlay referencing the registry id finds nothing. The default (no-flag)
// path never touches the network, so `npm run validate` stays offline-safe;
// only `--check-externals` / `npm run validate:externals` hits GitHub.
//
// The externals check reports two severities, not one:
//   - FAIL (exit non-zero) — 404, a `name:`/`id` mismatch, malformed/absent
//     frontmatter, and any other non-ok status by default (400, 401, 451, …).
//     These are registry defects this repo owns, and must block.
//   - WARN (non-fatal) — network transport errors, HTTP 429, 403, and 5xx.
//     (403 is a deliberate member of this set; see httpStatusSeverity below
//     for why.) These are upstream/infra conditions this repo does not own;
//     each is retried once (with a short backoff) before being downgraded to
//     a warning, so a single flaky shared-runner request can't redden an
//     unrelated PR. Every request carries a timeout so a hung connection
//     can't stall CI either.
// One exception to "WARN never blocks": a run in which *every* entry WARNed
// and none passed verified nothing at all, which is an infrastructure
// failure rather than a pass — see summarizeExternalResults.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractSkillMdName } from "./lib/skill-md.mjs";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Parse the YAML frontmatter of a FACTORY.md into a key→value map. Handles
// the subset of YAML this repo's frontmatter actually uses: scalar
// `key: value` lines, block-sequence lists (`key:` followed by `- item`
// lines, including object-list entries like `- project_code: EPM-EASE`), and
// an explicit `key: []` empty-list sentinel (preserved as [], not coerced to
// absent — that's the "not disclosed" marker some fields use). No full YAML
// parser needed; still stdlib-only.
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === "[]") {
      out[key] = []; // explicit empty list — ND sentinel, not absence
      continue;
    }
    if (val === "") {
      // maybe a block sequence
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        const raw = lines[++i].replace(/^\s*-\s+/, "").trim();
        const obj = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        items.push(obj ? { [obj[1]]: unquote(obj[2].trim()) } : unquote(raw));
      }
      out[key] = items.length ? items : "";
      continue;
    }
    out[key] = unquote(val);
  }
  return out;
}

function unquote(s) {
  return s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

const SUPPORT_LEVELS = new Set(["Self-Serve", "Best Effort Support", "Dedicated Capacity"]);

// Validate a FACTORY.md frontmatter object against the catalog descriptor
// schema. `rawLines` (the un-parsed frontmatter block lines, when available)
// feeds a risky-unquoted-value scan that must inspect the text pre-parse,
// since parseFrontmatter already strips quotes. Returns an array of error
// strings (empty when valid); callers route each through err(id, msg).
export function checkFactoryFrontmatter(id, fm, rawLines = []) {
  const errs = [];
  for (const k of ["name", "description", "owner", "authors", "sdlc_phase"])
    if (fm[k] === undefined || fm[k] === "" || (Array.isArray(fm[k]) && !fm[k].length))
      errs.push(`FACTORY.md frontmatter missing "${k}"`);
  if (fm.support_level !== undefined && !SUPPORT_LEVELS.has(fm.support_level))
    errs.push(`support_level "${fm.support_level}" not one of Self-Serve | Best Effort Support | Dedicated Capacity`);
  if (typeof fm.sdlc_phase === "string" && (fm.sdlc_phase.includes(",") || Array.isArray(fm.sdlc_phase)))
    errs.push(`sdlc_phase must be a single value, not a list: "${fm.sdlc_phase}"`);
  // risky-unquoted scan on raw frontmatter lines
  for (const line of rawLines) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s+(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    const quoted = /^".*"$/.test(v) || /^'.*'$/.test(v);
    const risky = v.includes(":") || /^[*&#@]/.test(v);
    if (risky && !quoted) errs.push(`value for "${kv[1]}" must be quoted (contains ':' or leading special char): ${v}`);
  }
  return errs;
}

function dirsWith(parent, marker) {
  const root = join(PKG_ROOT, parent);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(
    (d) =>
      !d.startsWith(".") &&
      statSync(join(root, d)).isDirectory() &&
      (marker ? existsSync(join(root, d, marker)) : true)
  );
}

function loadSkillIds() {
  const ids = new Set(dirsWith("skills")); // monorepo skill dirs
  const registryPath = join(PKG_ROOT, "skills.json");
  if (existsSync(registryPath)) {
    try {
      const reg = JSON.parse(readFileSync(registryPath, "utf8"));
      for (const s of reg.skills || []) ids.add(s.id);
    } catch (err) {
      console.error(`! skills.json failed to parse: ${err.message}`);
      process.exitCode = 1;
    }
  }
  return ids;
}

function main() {
  const factoriesRoot = join(PKG_ROOT, "factories");
  if (!existsSync(factoriesRoot)) {
    console.log("No factories/ directory — nothing to validate.");
    return;
  }
  const agents = new Set(dirsWith("agents", "AGENT.md"));
  const skillIds = loadSkillIds();
  const factoryDirs = readdirSync(factoriesRoot).filter((d) =>
    existsSync(join(factoriesRoot, d, "factory.json"))
  );

  if (factoryDirs.length === 0) {
    console.log("No factories found.");
    return;
  }

  let errorCount = 0;
  const err = (id, msg) => {
    console.error(`  ✗ ${id}: ${msg}`);
    errorCount++;
  };

  for (const id of factoryDirs.sort()) {
    const dir = join(factoriesRoot, id);
    const before = errorCount;
    let b;
    try {
      b = JSON.parse(readFileSync(join(dir, "factory.json"), "utf8"));
    } catch (e) {
      err(id, `factory.json failed to parse: ${e.message}`);
      continue;
    }

    if (b.id !== id) err(id, `manifest id "${b.id}" != directory name "${id}"`);
    if (!existsSync(join(dir, "README.md"))) err(id, "missing README.md");

    const factoryMd = join(dir, "FACTORY.md");
    if (!existsSync(factoryMd)) {
      err(id, "missing FACTORY.md (catalog descriptor)");
    } else {
      const factoryMdText = readFileSync(factoryMd, "utf8");
      const fm = parseFrontmatter(factoryMdText);
      if (!fm) {
        err(id, "FACTORY.md has no YAML frontmatter");
      } else {
        const fmMatch = factoryMdText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const rawLines = fmMatch ? fmMatch[1].split(/\r?\n/) : [];
        for (const msg of checkFactoryFrontmatter(id, fm, rawLines)) err(id, msg);
      }
    }

    const hasLocal = Array.isArray(b.localAgents) && b.localAgents.length > 0;
    const declaredAgents = Array.isArray(b.agents) ? b.agents : [];
    if (b.agents !== undefined && !Array.isArray(b.agents)) {
      err(id, "`agents` must be an array");
    } else if (declaredAgents.length === 0 && !hasLocal) {
      err(id, "`agents` must be a non-empty array (or provide localAgents)");
    } else {
      for (const a of declaredAgents) if (!agents.has(a)) err(id, `unknown agent "${a}"`);
    }

    // A briefing/overlay role may target any installed agent — shared (agents[])
    // or factory-local (localAgents[]). Build the combined roster once.
    const roster = new Set([
      ...declaredAgents,
      ...(Array.isArray(b.localAgents) ? b.localAgents : []),
    ]);

    for (const [role, rel] of Object.entries(b.briefings || {})) {
      if (!roster.has(role))
        err(id, `briefing role "${role}" not in agents[] or localAgents[]`);
      if (!existsSync(join(dir, rel))) err(id, `briefing file missing: ${rel}`);
    }

    // Per-factory skill universe = global catalog + this factory's localSkills.
    // `b.skills` (team-wide extras) and overlay adds may both reference a
    // localSkill — the installer resolves extras factory-locally, so a factory
    // can ship a skill installed-but-unrostered (loaded on demand).
    const localSkills = Array.isArray(b.localSkills) ? b.localSkills : [];
    if (b.localSkills !== undefined && !Array.isArray(b.localSkills))
      err(id, "`localSkills` must be an array");
    for (const ls of localSkills) {
      const sp = join(dir, "skills", ls);
      if (!existsSync(join(sp, "SKILL.md")))
        err(id, `localSkill "${ls}" missing skills/${ls}/SKILL.md`);
      if (existsSync(sp) && lstatSync(sp).isSymbolicLink())
        err(id, `skill "${ls}" must be a real directory, not a symlink`);
    }
    const effectiveSkillIds = new Set([...skillIds, ...localSkills]);

    // feature-development-style factories: flat devRoles + platform overlays.
    if (b.coreAgents !== undefined) {
      if (!Array.isArray(b.coreAgents)) err(id, "`coreAgents` must be an array");
      else for (const a of b.coreAgents) {
        roster.add(a);
        if (!(b.localAgents || []).includes(a)) err(id, `coreAgent "${a}" not in localAgents`);
      }
    }
    if (b.devRoles !== undefined) {
      if (typeof b.devRoles !== "object" || Array.isArray(b.devRoles)) {
        err(id, "`devRoles` must be an object");
      } else {
        for (const [r, def] of Object.entries(b.devRoles)) {
          roster.add(r);
          if (!(b.localAgents || []).includes(r)) err(id, `devRole "${r}" not in localAgents`);
          if (!def || !def.platform) err(id, `devRole "${r}" missing platform`);
          else if (!b.platforms || !b.platforms[def.platform])
            err(id, `devRole "${r}" platform "${def && def.platform}" not in platforms`);
          if (def && def.briefing && !existsSync(join(dir, def.briefing)))
            err(id, `devRole "${r}" briefing missing: ${def.briefing}`);
          for (const s of (def && def.skillOverlay && def.skillOverlay.add) || [])
            if (!effectiveSkillIds.has(s))
              console.warn(`  • ${id}: devRole "${r}" skillOverlay add "${s}" not in catalog yet (pending content)`);
        }
      }
    }
    for (const [pid, pdef] of Object.entries(b.platforms || {})) {
      for (const [role, rel] of Object.entries((pdef && pdef.briefings) || {})) {
        if (!roster.has(role)) err(id, `platform "${pid}" briefing role "${role}" not in roster`);
        if (!existsSync(join(dir, rel))) err(id, `platform "${pid}" briefing file missing: ${rel}`);
      }
      for (const [role, ov] of Object.entries((pdef && pdef.skillOverlays) || {})) {
        if (!roster.has(role)) err(id, `platform "${pid}" skillOverlay role "${role}" not in roster`);
        for (const s of (ov && ov.add) || [])
          if (!effectiveSkillIds.has(s))
            console.warn(`  • ${id}: platform "${pid}" skillOverlay add "${s}" not in catalog yet (pending content)`);
      }
    }

    for (const s of b.skills || [])
      if (!effectiveSkillIds.has(s)) err(id, `skill "${s}" not in skills.json, skills/, or this factory's localSkills`);

    if (b.instructions && !existsSync(join(dir, b.instructions)))
      err(id, `instructions file missing: ${b.instructions}`);

    if (b.hooks) {
      const hp = join(dir, b.hooks);
      if (!existsSync(hp)) err(id, `hooks file missing: ${b.hooks}`);
      else {
        try {
          JSON.parse(readFileSync(hp, "utf8"));
        } catch (e) {
          err(id, `hooks file failed to parse: ${e.message}`);
        }
      }
    }

    for (const la of b.localAgents || []) {
      const ap = join(dir, "agents", la);
      if (!existsSync(join(ap, "AGENT.md")))
        err(id, `localAgent "${la}" missing agents/${la}/AGENT.md`);
      if (existsSync(ap) && lstatSync(ap).isSymbolicLink())
        err(id, `agent "${la}" must be a real directory, not a symlink`);
    }

    for (const src of Object.keys(b.seed || {}))
      if (!existsSync(join(dir, src))) err(id, `seed source missing: ${src}`);

    for (const [role, ov] of Object.entries(b.skillOverlays || {})) {
      if (!roster.has(role))
        err(id, `skillOverlay role "${role}" not in agents[] or localAgents[]`);
      for (const s of (ov && ov.add) || [])
        if (!effectiveSkillIds.has(s))
          console.warn(`  • ${id}: skillOverlay add "${s}" not in catalog yet (pending content)`);
    }

    if (errorCount === before) {
      const n = (b.agents || []).length + (b.localAgents || []).length;
      console.log(`  ✓ ${id} (${n} agents)`);
    }
  }

  if (errorCount > 0) {
    console.error(`\n${errorCount} error(s) across ${factoryDirs.length} factory(ies).`);
    process.exit(1);
  }
  console.log(`\nAll ${factoryDirs.length} factory(ies) valid.`);
}

const CHECK_EXTERNALS_TIMEOUT_MS = 10_000;
const CHECK_EXTERNALS_RETRY_DELAY_MS = 300;

// Pure URL builder for a repo:-backed skills.json entry's upstream SKILL.md.
// Exported so tests can assert on it directly (trailing-slash subdirs,
// missing `ref` defaulting to "main") without any network involved.
export function buildSkillMdUrl(entry) {
  const ref = entry.ref || "main";
  const subdir = entry.subdir ? `${entry.subdir.replace(/\/+$/, "")}/` : "";
  return `https://raw.githubusercontent.com/${entry.repo}/${ref}/${subdir}SKILL.md`;
}

// HTTP statuses that mean "this repo's registry entry is wrong" (FAIL) vs
// "upstream/infra is having a moment" (WARN, retried once before we believe
// it). 404 is the bug class this guard exists to catch — a registry entry
// pointing at a subdir that upstream renamed, moved, or never had, so the
// install silently produces the wrong directory (or nothing). 429 and 5xx are
// the upstream's problem, not ours; anything else not-ok is treated as a
// registry defect by default, same bucket as 404.
//
// 403 is deliberately WARN, not FAIL: raw.githubusercontent.com returns 404
// (not 403) for a private or nonexistent repo/path (verified 2026-08-05), so
// the "repo went private" case that would justify a FAIL doesn't actually
// produce a 403 on this host. A 403 from raw is overwhelmingly abuse-detection
// / rate-limiting — the same transient class as 429/5xx. Don't reclassify 403
// as FAIL without re-verifying raw.githubusercontent.com's actual private-repo
// status code first.
function httpStatusSeverity(status) {
  if (status === 429 || status === 403 || status >= 500) return "warn";
  return "fail";
}

async function fetchAttempt(url, fetchImpl, timeoutMs) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { transportError: null, res };
  } catch (e) {
    return { transportError: e, res: null };
  }
}

function isWarnableAttempt(attempt) {
  return Boolean(attempt.transportError) || (attempt.res && httpStatusSeverity(attempt.res.status) === "warn");
}

// Fetch a repo:-backed skills.json entry's upstream SKILL.md and confirm its
// `name:` frontmatter matches the registry `id`. bin/init.mjs (installExternalSkill)
// names the installed skill directory from that upstream `name:` field — never
// from the registry id — so an id/name mismatch is a live bug: the skill
// installs under a different directory than any factory skillOverlay expects,
// and is silently absent from the role that declared it. A 200 response alone
// does not prove the entry works; the name must be checked too.
//
// `fetchImpl` is injectable so tests can exercise every branch (404,
// name-mismatch, absent frontmatter, retries, timeouts) with no network.
// Returns { severity: "pass"|"warn"|"fail", id, msg }. The failure modes it
// knows about — a network error, or a body-read failure after a 200 — are
// captured as WARN results rather than escaping to the caller. It makes no
// blanket "never throws" promise: an unforeseen throw (a malformed fetchImpl,
// an OOM in a huge body) still escapes, which is why checkExternals contains
// each call in its own try/catch.
export async function checkExternalEntry(entry, opts = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = CHECK_EXTERNALS_TIMEOUT_MS,
    retryDelayMs = CHECK_EXTERNALS_RETRY_DELAY_MS,
  } = opts;
  const url = buildSkillMdUrl(entry);

  let attempt = await fetchAttempt(url, fetchImpl, timeoutMs);
  let retried = false;
  if (isWarnableAttempt(attempt)) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    attempt = await fetchAttempt(url, fetchImpl, timeoutMs);
    retried = true;
  }
  const retriedNote = retried ? " (after 1 retry)" : "";

  if (attempt.transportError) {
    return {
      severity: "warn",
      id: entry.id,
      msg: `${entry.id}: network error fetching ${url}${retriedNote} — ${attempt.transportError.message}`,
    };
  }

  const res = attempt.res;
  if (!res.ok) {
    const severity = httpStatusSeverity(res.status);
    const suffix = severity === "warn" ? " — treating as a transient upstream/infra condition" : "";
    return { severity, id: entry.id, msg: `${entry.id}: ${res.status} ${res.statusText} fetching ${url}${retriedNote}${suffix}` };
  }

  let text;
  try {
    text = await res.text();
  } catch (e) {
    return {
      severity: "warn",
      id: entry.id,
      msg: `${entry.id}: network error reading response body from ${url} — ${e.message}`,
    };
  }

  const upstreamName = extractSkillMdName(text);
  if (upstreamName === null) {
    return { severity: "fail", id: entry.id, msg: `${entry.id}: no "name:" frontmatter found in ${url}` };
  }
  if (upstreamName !== entry.id) {
    return {
      severity: "fail",
      id: entry.id,
      msg: `${entry.id}: upstream SKILL.md name "${upstreamName}" != registry id "${entry.id}" (${url})`,
    };
  }
  return { severity: "pass", id: entry.id, msg: `${entry.id}: name matches (${url})` };
}

// Check every entry, sequentially (polite to GitHub, and keeps output order
// stable). Exported for tests; the CLI wrapper below does the printing/exit.
//
// Each entry is contained in its own try/catch: an unexpected throw on one
// entry must not abandon the remaining ones (silently shrinking coverage
// while the summary still reads as a clean run). An escaped throw is recorded
// as a FAIL for that entry — it is a defect in this repo's own checker, not
// an upstream transient, so it must block rather than warn.
export async function checkExternals(entries, opts = {}) {
  const results = [];
  for (const entry of entries) {
    try {
      results.push(await checkExternalEntry(entry, opts));
    } catch (e) {
      results.push({
        severity: "fail",
        id: entry && entry.id,
        msg: `${entry && entry.id}: unexpected error during check — ${(e && (e.stack || e.message)) || e}`,
      });
    }
  }
  return results;
}

// Pure aggregation over a list of per-entry results: counts each severity
// and derives the exit decision. Exported and kept side-effect-free (no
// printing, no process.exit) specifically so tests can assert on the exit
// decision directly instead of only on printed log text or by probing the
// CLI by hand — the "unguarded guard" this whole review thread started from
// was exactly this layer being untested.
//
// Two independent reasons to exit non-zero:
//   1. failCount > 0 — at least one registry defect. An individual WARN
//      still never blocks; that adjudication is unchanged.
//   2. `verifiedNothing` — the run produced zero PASSes and at least one
//      WARN, i.e. it confirmed nothing about any entry. Per-entry that is a
//      tolerable transient, but in aggregate it means the guard did not run:
//      a broken runner, no network egress, a global rate-limit, or a Node
//      too old for global fetch (every entry then becomes a transport WARN).
//      Exiting 0 there would advertise a check that never happened, which is
//      exactly the failure this guard exists to prevent. The decision lives
//      here rather than in the CLI wrapper so it is testable and so any
//      future caller inherits it.
export function summarizeExternalResults(results) {
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.severity === "pass") passCount++;
    else if (r.severity === "warn") warnCount++;
    else failCount++;
  }
  const total = results.length;
  const verifiedNothing = total > 0 && passCount === 0 && warnCount > 0;
  return {
    total,
    passCount,
    warnCount,
    failCount,
    verifiedNothing,
    exitCode: failCount > 0 || verifiedNothing ? 1 : 0,
  };
}

async function runCheckExternals() {
  const registryPath = join(PKG_ROOT, "skills.json");
  if (!existsSync(registryPath)) {
    console.log("No skills.json — nothing to check.");
    return;
  }
  let reg;
  try {
    reg = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (e) {
    console.error(`! skills.json failed to parse: ${e.message}`);
    process.exit(1);
  }
  const externals = (reg.skills || []).filter((s) => s.repo);
  if (externals.length === 0) {
    console.log("No repo: entries in skills.json — nothing to check.");
    return;
  }

  const results = await checkExternals(externals);
  for (const r of results) {
    if (r.severity === "pass") console.log(`  PASS ${r.msg}`);
    else if (r.severity === "warn") console.warn(`  WARN ${r.msg}`);
    else console.error(`  FAIL ${r.msg}`);
  }

  const { total, passCount, warnCount, failCount, verifiedNothing, exitCode } =
    summarizeExternalResults(results);
  // The summary line must never claim more was verified than actually was:
  // a WARN means that entry's registry correctness was NOT checked this run
  // (it was skipped as transient, not confirmed good), so whenever any WARN
  // occurred the line reports "<passCount> of <total> verified", not
  // "All <total> valid" — a WARN-only run must not read as a clean bill of
  // health.
  if (failCount > 0) {
    const warnNote = warnCount > 0 ? `, ${warnCount} WARN (transient, non-blocking)` : "";
    console.error(`\n${failCount} of ${total} external skill(s) FAILED${warnNote}.`);
    process.exit(exitCode);
  }
  if (verifiedNothing) {
    // Every entry WARNed and none passed: this run verified nothing at all.
    // Individually each WARN is a tolerable transient; collectively they mean
    // the check did not run (no egress, global rate-limit, or a Node without
    // global fetch). Report it as an infrastructure failure, not a pass.
    console.error(
      `\n0 of ${total} external skill(s) verified — all ${warnCount} WARNed. The check did not actually run; ` +
        `this is an infrastructure failure (network egress, a global rate-limit, or Node < 18 with no global fetch), ` +
        `not a clean result. Failing rather than reporting an unverified pass.`
    );
    process.exit(exitCode);
  }
  if (warnCount > 0) {
    console.warn(
      `\n${passCount} of ${total} verified — ${warnCount} WARN (transient upstream/infra, non-blocking; NOT verified this run), 0 FAILED.`
    );
    return;
  }
  console.log(`\nAll ${total} external skill(s) valid.`);
}

// Detect "run as the main module" robustly (same rationale/approach as
// bin/init.mjs's isMainModule): lets test files `import` the pure helpers
// above without triggering CLI execution (factory validation or a live
// network check) as a side effect of the import.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

// Every flag this CLI accepts. Anything else is rejected rather than ignored:
// a typo like `--check-external` used to fall through to factory validation,
// print "All N factory(ies) valid." and exit 0 — under a CI step named "Validate
// external skill registry entries" that had in fact fetched nothing.
const KNOWN_FLAGS = new Set(["--check-externals"]);

// Exported for tests: given the argv tail, either the mode to run or the list
// of unknown arguments to reject. Pure — no printing, no process.exit.
export function parseValidateArgs(argv) {
  const unknown = argv.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) return { mode: "error", unknown, knownFlags: [...KNOWN_FLAGS] };
  return { mode: argv.includes("--check-externals") ? "check-externals" : "factories", unknown: [] };
}

if (isMainModule()) {
  const parsed = parseValidateArgs(process.argv.slice(2));
  if (parsed.mode === "error") {
    console.error(
      `! unknown argument(s): ${parsed.unknown.join(", ")}\n` +
        `  Known flags: ${parsed.knownFlags.join(", ")} (or no flag to validate factories).\n` +
        `  Refusing to run: a mistyped flag must not silently run a different check and exit 0.`
    );
    process.exit(2);
  } else if (parsed.mode === "check-externals") {
    runCheckExternals().catch((err) => {
      console.error(`! checkExternals crashed: ${err.stack || err.message}`);
      process.exit(1);
    });
  } else {
    main();
  }
}

// lib/cmd-publish.mjs — `evidence.mjs publish --run <id> --profile
// redacted-report|full-report|tracker|handoff|case --to <destination>
// [--slug <s>] [--base-url <u>]` (TASK-031; plan §4.1 row `publish`, §5
// TASK-031; spec §6.9 "Publication is only evidence.mjs publish …", §9.4 /
// P4, D13; US-023 AC-1, AC-2; US-039 AC-1, AC-3; G-5: the one command that
// writes outside the bundle's own paths).
//
// Pipeline:
//   1. argv — `--run` (shape), `--profile` (required, one of PUBLISH_PROFILES,
//      NO default: `full-report` is explicit or nothing), `--to` (required);
//      `--slug` / `--base-url` are accepted for the M3 profiles and carried
//      in `opts`. `handoff` / `case` ⇒ 2 NOT-IMPLEMENTED(M3) (TASK-043).
//   2. destination (`resolveDestination`) — a user-typed path, resolved
//      against the invocation cwd like every other argument, then judged
//      twice: on its typed spelling (lexical, `..` normalised) AND on its
//      realpath (the deepest existing ancestor followed, so an alias of the
//      tree is inside it and a symlink out of it is outside — the TASK-059
//      review's rule for outputs). Both must lie inside the work tree, below
//      the root, and outside `.git/`. A report profile's destination must
//      never be under `.agents/security-testing/` — compared
//      case-insensitively on both spellings, so `.agents/Security-Testing/`
//      is refused on ext4 as well as on APFS (fail-closed on every platform;
//      TASK-059 review 2). The tracker profile's destination must be exactly
//      `.agents/security-testing/handoffs` (plan §4.1), on both spellings.
//      An existing file at the destination is refused. Nothing is written
//      before every check passes.
//   3. source — lib/profiles/_source.mjs: the run must exist and be COMMITTED
//      (2 USAGE otherwise), and every artifact read must be what it claims
//      to be (5 INCONSISTENT(<file>)).
//   4. profile — lib/profiles/<name>.mjs `apply(source, register, opts)` →
//      the output set. For `tracker`, `plan(source, projection)` first: the
//      register is read through readEvents + replay (chain-verified, 5
//      CORRUPT on a break; no lock, no projection rewrite — publish reads
//      the register and never writes it), then one apply per finding left.
//   5. writes — every output name is checked against the destination first
//      (an existing file with different bytes ⇒ 2 USAGE, nothing written:
//      publish never clobbers a file it did not derive), then each new file
//      lands by fsx.writeAtomic (byte-identical existing files are kept:
//      republishing is idempotent), then `export-manifest.json` (or the
//      tracker sidecar `<finding_id>.export-manifest.json`) as an enveloped
//      artifact of kind `export-manifest` — {source_manifest_sha256, profile,
//      profile_version, output_sha256} — through ctx.writeArtifact, which
//      prints its WROTE line.
//
// stdout: `PUBLISHED profile=<p> output=<path> sha256=<file sha256>` per
// file, then the manifest's `WROTE <path> sha256=<self_sha256>`; tracker:
// those pairs per ticket, then `DEDUPE finding=<id> existing=<url>` per
// skipped finding, then `NEXT: post <path> via issue-tracking, then ingest
// tracker-readback --sent <path> <response.json>` per written ticket. No
// register event is ever appended here (`ticketed` is tracker-readback's,
// TASK-045). Exit 0; 2 USAGE / NOT-IMPLEMENTED(M3) / ENGAGEMENT-MISSING;
// 5 INCONSISTENT(<file>) / CORRUPT.
//
// Every string that leaves the process goes through ctx.out (G-4); every
// output file is the profile's derivative of redacted artifacts, and writeSet
// asserts a second redact.mjs pass leaves each output unchanged before it is
// written (a profile that leaked would be an internal error, never a file).
//
// Imports: node:fs (existsSync, readFileSync, realpathSync, statSync —
// reads and stats only; writes go through ./fsx.mjs writeAtomic and
// ctx.writeArtifact), node:path, ../canon.mjs (artifactId, makeEnvelope,
// readArtifact, sha256Hex), ../redact.mjs (redactString), ./argv.mjs, ./exit.mjs, ./fsx.mjs, ./ledger.mjs
// (RUN_ID), ./profiles/*, ./register-core.mjs (readEvents, replay),
// ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs. No child process
// (G-6), no network (G-14), no clock (G-1: created_at is ctx.now()).

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, readArtifact, sha256Hex } from "../canon.mjs";
import { redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { writeAtomic } from "./fsx.mjs";
import { RUN_ID } from "./ledger.mjs";
import { loadSource } from "./profiles/_source.mjs";
import { exportIdentity, manifestNameFor, profileModule, requireOutputs } from "./profiles/index.mjs";
import { plan as trackerPlan } from "./profiles/tracker.mjs";
import { readEvents, replay } from "./register-core.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { CORRUPT, PUBLISH_PROFILES, dedupeLine, nextPost, notImplemented, publishedLine } from "./tokens.mjs";

const COMMAND = "publish";
/** The tracker profile's one destination (plan §4.1 row `publish`; §3.2 layout). */
export const HANDOFFS_REL = ".agents/security-testing/handoffs";
const ST_PREFIX = /^\.agents\/security-testing(?:\/|$)/i;
const GIT_PREFIX = /^\.git(?:\/|$)/i;

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", profile: "value", to: "value", slug: "value", "base-url": "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  const profile = flags.profile;
  if (profile === undefined) throw usageError(COMMAND, `--profile is required (${PUBLISH_PROFILES.join("|")}); there is no default`);
  if (!PUBLISH_PROFILES.includes(profile)) throw usageError(COMMAND, `--profile must be one of ${PUBLISH_PROFILES.join("|")}, got ${profile}`);
  if (flags.to === undefined) throw usageError(COMMAND, "--to is required");
  return { run_id, profile, to: flags.to, opts: { slug: flags.slug, base_url: flags["base-url"] } };
}

// --- destination --------------------------------------------------------------------

const toPosix = (p) => (sep === "/" ? p : p.split(sep).join("/"));

/** realpath of `p`, or of its deepest existing ancestor plus the remaining names (ENOENT/ENOTDIR only). */
function realpathLenient(p) {
  try {
    return realpathSync.native(p);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
  }
  const parent = dirname(p);
  if (parent === p) return p;
  return join(realpathLenient(parent), basename(p));
}

/** repo-relative posix spelling of `abs`, or null when it is not below root (root itself is ""). */
function relInside(root, abs) {
  const inside = relative(root, abs);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  return toPosix(inside);
}

/**
 * Resolve `--to` (see the header, step 2).
 * @param {object} ctx
 * @param {string} profile
 * @param {string} to as typed
 * @returns {{abs: string, rel: string}}
 * @throws {CliError} 2
 */
export function resolveDestination(ctx, profile, to) {
  if (typeof to !== "string" || to === "") throw usageError(COMMAND, "--to is required");
  const base = realpathSync.native(ctx.cwd);
  const lexical = resolve(base, to);
  const real = realpathLenient(lexical);
  const spellings = [relInside(ctx.root, lexical), relInside(ctx.root, real)];
  // prose first, path second (G-4: a token starting with a long path reads as high-entropy)
  if (spellings.some((r) => r === null)) throw usageError(COMMAND, `cannot write ${to} (outside the work tree)`);
  if (spellings.some((r) => r === "")) throw usageError(COMMAND, `--to must be a directory below the work tree root, got ${to}`);
  if (spellings.some((r) => GIT_PREFIX.test(r))) throw usageError(COMMAND, `--to must not point into .git/; got ${to}`);
  if (profile === "tracker") {
    if (spellings.some((r) => r !== HANDOFFS_REL)) throw usageError(COMMAND, `--to must be ${HANDOFFS_REL} for the tracker profile, got ${to}`);
  } else if (spellings.some((r) => ST_PREFIX.test(r))) {
    throw usageError(COMMAND, `--to must not point into the bundle's own state (.agents/security-testing/); got ${to}`);
  }
  if (existsSync(real) && !statSync(real).isDirectory()) throw usageError(COMMAND, `--to names an existing file, got ${to}`);
  return { abs: real, rel: spellings[1] };
}

// --- register (tracker dedupe) -------------------------------------------------------

/** The register projection, read without a lock and without writing (chain-verified; 5 CORRUPT). */
function readProjection(ctx) {
  const engagement_id = ctx.engagement().engagement_id;
  const events = readEvents(ctx);
  try {
    return replay(events, engagement_id);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err.name === "ChainError" || err.name === "TransitionError") throw integrityFailure(CORRUPT, err);
    throw err;
  }
}

// --- writes -------------------------------------------------------------------------

const differs = (path, bytes) => existsSync(path) && !readFileSync(path).equals(bytes);

/**
 * Write one output set and its manifest (see the header, step 5). Prints the
 * PUBLISHED lines and the manifest's WROTE line.
 * @returns {{written: string[]}} repo-relative paths of the outputs
 */
function writeSet(ctx, { dest, profile, version, outputs, manifestName, source }) {
  requireOutputs(outputs);
  // G-4 at the exit point: every profile output derives from redacted artifacts, so a second pass
  // must be a no-op (redaction is idempotent); a profile that leaked would change here — a bug, not a result.
  for (const o of outputs) {
    const text = o.bytes.toString("utf8");
    if (redactString(text).text !== text) throw new Error(`${COMMAND}: profile ${profile} produced ${o.relpath} with unredacted content`);
  }
  const payload = { source_manifest_sha256: source.manifest.envelope.self_sha256, profile, profile_version: version, output_sha256: exportIdentity(outputs) };
  const errors = validate("export-manifest", payload);
  if (errors.length > 0) throw new Error(`${COMMAND}: export-manifest payload is off-schema: ${errors[0]}`);
  const { schema_version, engagement_id, key_id } = source.run.envelope;
  const artifact = makeEnvelope({ schema_version, kind: "export-manifest", run_id: source.run_id, engagement_id, key_id, now: ctx.now }, payload);

  // every conflict is found before the first byte is written
  const manifestPath = join(dest.abs, manifestName);
  for (const o of outputs) {
    const path = join(dest.abs, o.relpath);
    if (existsSync(path) && statSync(path).isDirectory()) throw usageError(COMMAND, `${dest.rel}/${o.relpath} is a directory; choose another --to`);
    if (differs(path, o.bytes)) throw usageError(COMMAND, `${dest.rel}/${o.relpath} already exists with different content; choose another --to`);
  }
  let existingManifest = null;
  if (existsSync(manifestPath)) {
    try {
      existingManifest = readArtifact(manifestPath, { kind: "export-manifest" });
    } catch (err) {
      if (!(err instanceof IntegrityError || err instanceof CanonError)) throw err;
      throw usageError(COMMAND, `${dest.rel}/${manifestName} already exists and is not an export manifest; choose another --to`);
    }
    if (existingManifest.envelope.self_sha256 !== artifactId(payload)) throw usageError(COMMAND, `${dest.rel}/${manifestName} already exists for a different export; choose another --to`);
  }

  const written = [];
  for (const o of outputs) {
    const path = join(dest.abs, o.relpath);
    if (!existsSync(path)) writeAtomic(path, o.bytes);
    const rel = `${dest.rel}/${o.relpath}`;
    ctx.out(publishedLine({ profile, relPath: rel, sha256: sha256Hex(o.bytes) }));
    written.push(rel);
  }
  if (existingManifest === null) ctx.writeArtifact(manifestPath, artifact);
  else ctx.wrote(manifestPath, existingManifest);
  return { written };
}

// --- the command --------------------------------------------------------------------

/**
 * @param {string[]} argv after `publish`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { run_id, profile, to, opts } = parseArgs(argv);
  const mod = profileModule(profile);
  if (mod === null) {
    ctx.out(notImplemented("M3"));
    return EXIT.USAGE;
  }
  const dest = resolveDestination(ctx, profile, to);
  const source = loadSource(runDir(ctx, run_id), { command: COMMAND });
  const version = mod.PROFILE_VERSION;

  if (profile !== "tracker") {
    const outputs = mod.apply(source, null, opts);
    writeSet(ctx, { dest, profile, version, outputs, manifestName: manifestNameFor(profile, opts), source });
    return EXIT.OK;
  }

  const projection = readProjection(ctx);
  const planned = trackerPlan(source, projection);
  const posted = [];
  for (const finding_id of planned.tickets) {
    const outputs = mod.apply(source, null, { ...opts, finding_id });
    const { written } = writeSet(ctx, { dest, profile, version, outputs, manifestName: manifestNameFor(profile, { finding_id }), source });
    posted.push(...written);
  }
  for (const d of planned.deduped) ctx.out(dedupeLine({ finding: d.finding_id, existing: d.existing }));
  for (const rel of posted) ctx.out(nextPost(rel));
  if (planned.candidates.length === 0) ctx.log(`${COMMAND}: run ${run_id} has no accepted finding; nothing to post`);
  return EXIT.OK;
}

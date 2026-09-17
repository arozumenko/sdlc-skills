// lib/cmd-check-export.mjs — `evidence.mjs check-export <export-manifest.json>
// [--source <run dir>]` (TASK-031; plan §4.1 row `check-export`, §5
// TASK-031; spec §6.9 "check-export <export-manifest> [--source <run dir>]
// re-applies the profile to the source and byte-compares
// (VERIFIED-DERIVATIVE) or, without the source, reports LINKED-ONLY", §12;
// US-023 AC-3, AC-4). Reads only; writes nothing.
//
// Pipeline:
//   1. the manifest — a user-typed path (ctx.input: cwd-relative, inside the
//      work tree), read as an enveloped artifact of kind `export-manifest`
//      and validated against export-manifest.schema.json. Anything else
//      (missing, not JSON, another kind, a self_sha256 that no longer
//      matches) is 2 USAGE(check-export: <p> is not an export manifest (…)):
//      the file is the user's input, so the check/exit-5 rule (lib/exit.mjs)
//      makes it an exit-2 result here, never a 5. Its `profile` must be a
//      registered name, its `profile_version` the shipped one, and its file
//      name the profile's (`export-manifest.json`; `<finding_id>.export-manifest.json`
//      for a tracker sidecar; `<run_id>.handoff|case.export-manifest.json`
//      for the M3 sidecars, TASK-043 — lib/profiles/index.mjs
//      `expectedOutputs`), which is how the output files are known: the M1
//      shape lists none, and the M3 manifests carry the recorded `opts`
//      (`slug` + `base_url` for handoff, `slug` + `members` for case) that
//      name them — a case or handoff manifest without them is 2 USAGE.
//   2. the outputs on disk — every expected file (next to the manifest; for
//      the case profile under `tasks/security-<slug>-admitted/`) must exist
//      and the set's identity must equal `output_sha256`; otherwise
//      `MISMATCH(output)`, exit 5, with or without a source (an output edited
//      after publication no longer matches its own manifest).
//   3. without `--source` ⇒ `LINKED-ONLY`, exit 0.
//   4. with `--source <run dir>` — a directory inside the work tree, loaded
//      through lib/profiles/_source.mjs (2 USAGE unknown / not COMMITTED,
//      5 INCONSISTENT(<file>)); its manifest's self_sha256 must equal
//      `source_manifest_sha256` (otherwise 2 USAGE: it is not this export's
//      source); the profile is re-applied with the opts the manifest name
//      determines (and the M3 manifest records) and every output
//      byte-compared ⇒ `VERIFIED-DERIVATIVE`, exit 0, or `MISMATCH(output)`,
//      exit 5 (a tracker sidecar naming a finding the source never accepted
//      is a mismatch too; so is a case suite whose candidate under
//      `<st>/cases/` changed or moved since publication — the case profile
//      derives from the run's admissions AND the candidates' text, which is
//      why its source is loaded with `casesDir`).
//
// stdout: exactly one line. Exit 0 / 0 / 5; 2 USAGE; 5 INCONSISTENT(<file>)
// from the source.
//
// Imports: node:fs (existsSync, readFileSync, statSync — reads only),
// node:path, ../canon.mjs (the error classes, readArtifact), ./argv.mjs,
// ./exit.mjs, ./profiles/*, ./schema.mjs, ./tokens.mjs. No child process,
// no git, no network, no clock.

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CanonError, IntegrityError, readArtifact } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { loadSource } from "./profiles/_source.mjs";
import { CaseRefused } from "./profiles/case.mjs";
import { EXPORT_MANIFEST_FILE, M3_PROFILES, SIDECAR_SUFFIX, exportIdentity, expectedOutputs, profileModule } from "./profiles/index.mjs";
import { NotAccepted } from "./profiles/tracker.mjs";
import { validate } from "./schema.mjs";
import { LINKED_ONLY, MISMATCH_OUTPUT, VERIFIED_DERIVATIVE } from "./tokens.mjs";

const COMMAND = "check-export";
const CASES_SEGMENT = "cases";

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { source: "value" });
  if (positionals.length === 0) throw usageError(COMMAND, "an export-manifest.json path is required");
  if (positionals.length > 1) throw usageError(COMMAND, `unexpected argument ${positionals[1]}`);
  return { manifest: positionals[0], source: flags.source };
}

/** The manifest artifact, or the exit-2 result (the file is the user's input, never a 5). */
function readManifest(abs, typed) {
  if (!existsSync(abs)) throw usageError(COMMAND, `cannot read ${typed} (no such file)`);
  if (statSync(abs).isDirectory()) throw usageError(COMMAND, `cannot read ${typed} (it is a directory)`);
  let artifact;
  try {
    artifact = readArtifact(abs, { kind: "export-manifest" });
  } catch (err) {
    // the reason only, never the message (which carries the absolute path)
    if (err instanceof IntegrityError) throw usageError(COMMAND, `${typed} is not an export manifest (${err.reason})`);
    if (err instanceof CanonError) throw usageError(COMMAND, `${typed} is not an export manifest (not canonical JSON)`);
    throw err;
  }
  const errors = validate("export-manifest", artifact.payload);
  if (errors.length > 0) throw usageError(COMMAND, `${typed} is not an export manifest (schema: ${errors[0]})`);
  return artifact;
}

const mismatch = () => new CliError(EXIT.INTEGRITY, MISMATCH_OUTPUT);

/**
 * @param {string[]} argv after `check-export`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const manifestAbs = ctx.input(COMMAND, args.manifest);
  const manifest = readManifest(manifestAbs, args.manifest);
  const { profile, profile_version, source_manifest_sha256, output_sha256, opts } = manifest.payload;
  const mod = profileModule(profile);
  const name = basename(manifestAbs);
  const expected = expectedOutputs(profile, name, opts ?? {});
  if (expected === null) {
    const shape = profile === "tracker" ? `<finding_id>${SIDECAR_SUFFIX}` : M3_PROFILES.includes(profile) ? `<run_id>.${profile}${SIDECAR_SUFFIX}` : EXPORT_MANIFEST_FILE;
    const needs = profile === "handoff" ? " and record opts.slug and opts.base_url" : profile === "case" ? " and record opts.slug and opts.members" : "";
    throw usageError(COMMAND, `a ${profile} export manifest must be named ${shape}${needs}, got ${name}`);
  }
  if (profile_version !== mod.PROFILE_VERSION) throw usageError(COMMAND, `profile ${profile} version ${profile_version} is not the shipped version ${mod.PROFILE_VERSION}`);

  // 2. the outputs against their own manifest
  const dir = expected.dir === null ? dirname(manifestAbs) : join(ctx.root, expected.dir);
  const onDisk = [];
  for (const relpath of expected.relpaths) {
    const path = join(dir, relpath);
    if (!existsSync(path) || statSync(path).isDirectory()) throw mismatch();
    onDisk.push({ relpath, bytes: readFileSync(path) });
  }
  if (exportIdentity(onDisk) !== output_sha256) throw mismatch();

  // 3. no source
  if (args.source === undefined) {
    ctx.out(LINKED_ONLY);
    return EXIT.OK;
  }

  // 4. re-apply over the source
  const sourceAbs = ctx.input(COMMAND, args.source);
  if (!existsSync(sourceAbs) || !statSync(sourceAbs).isDirectory()) throw usageError(COMMAND, `--source must be a run directory, got ${args.source}`);
  const source = loadSource(sourceAbs, { command: COMMAND, casesDir: profile === "case" ? join(ctx.st, CASES_SEGMENT) : undefined });
  if (source.manifest.envelope.self_sha256 !== source_manifest_sha256) throw usageError(COMMAND, `--source ${args.source} is not the source of this export (its manifest sha256 differs)`);
  let derived;
  try {
    derived = mod.apply(source, null, expected.opts);
  } catch (err) {
    if (err instanceof NotAccepted || err instanceof CaseRefused) throw mismatch();
    throw err;
  }
  const byName = new Map(derived.map((o) => [o.relpath, o.bytes]));
  if (byName.size !== onDisk.length) throw mismatch();
  for (const o of onDisk) {
    const bytes = byName.get(o.relpath);
    if (bytes === undefined || !bytes.equals(o.bytes)) throw mismatch();
  }
  ctx.out(VERIFIED_DERIVATIVE);
  return EXIT.OK;
}

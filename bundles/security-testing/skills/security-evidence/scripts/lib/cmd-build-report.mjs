// lib/cmd-build-report.mjs — `evidence.mjs build-report --run <id> --template
// review|assessment|verify|threat-model` (TASK-023; plan §4.1 row
// `build-report`, §5 TASK-023, TL-3, TL-7, TL-14; spec §6.1 order "… →
// build-report (renders report, writes manifest, writes COMMITTED marker
// containing the manifest hash, last)", §6.3, §11; US-016; G-10, G-16).
//
// The step that closes a run: after it, the run is COMMITTED and nothing
// under it is written by anyone (G-10; retry = new seq). Everything the
// report displays is derived here from the run directory alone —
// lib/inputs.mjs loads the template's closed input set through a path
// guard, lib/render.mjs re-runs every derivation and renders — and the
// manifest records what the report was built from.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run` (shape) and `--template` (one of REPORT_TEMPLATES),
//      2 USAGE otherwise;
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒ 2
//      RUN-COMMITTED; run.json read (5 on tamper); the run's own kind must
//      be the template asked for (a review report over an assessment run
//      would leave a COMMITTED assessment-kind run whose report is not an
//      assessment — sign-off reads run kinds) ⇒ 2 USAGE otherwise;
//   3. `templates/<name>.md` parsed (absent ⇒ 2 USAGE: the template is not
//      shipped — all four ship since TASK-024); its required-inputs block
//      must equal inputs.REQUIRED[<name>] (a packaging bug otherwise:
//      Error, exit 1);
//   4. under the run lock (ledger/<id>.lock/ — so a concurrent TL-14 index
//      append can neither surface a tmp file nor land between the closure
//      and the marker): COMMITTED re-checked; inputs.closeOver (3
//      INCOMPLETE(<input>) / 5 INCONSISTENT(<file>)); the run's key by the
//      envelope's key_id (absent ⇒ the view says KEY: unavailable and lists
//      the keyed identities it could not re-derive — spec §6.5 — the report
//      still builds) plus every other key_id the closure's envelopes name
//      (render.keyIdsOf: rotation, verify snapshots copied from other runs),
//      each resolved or null so Limitations name the artifacts whose key
//      is gone (TASK-024); render.buildView (InconsistentInput ⇒ 5
//      INCONSISTENT(<field>): gate-result | coverage | verify |
//      register-events | dispositions); render.renderMarkdown;
//   5. writes, each write-once via tmp + link (an existing file is an atomic
//      EEXIST), in this order: `report.md`; `manifest.json` (kind manifest:
//      {inputs, report_sha256, template, template_version, tool_version},
//      validated against run-manifest.schema.json, enveloped with the run's
//      schema_version / engagement_id / key_id); `COMMITTED` = the
//      manifest's self_sha256 + LF, last. An interrupted build is resumable
//      by re-running: a report.md or manifest.json already present with the
//      same bytes / identity is the same artifact (rendering is
//      deterministic, US-016 AC-6) and is kept; a different one is 5
//      INCONSISTENT(report.md | manifest.json).
//
// report_sha256 is a plain sha256 over the report bytes: the report is the
// renderer's output, which passed redact.mjs as a whole (G-4), so TL-10
// allows it (sha256 of redacted bytes). The manifest's `inputs` are
// inputs.closeOver's `hashes`.
//
// stdout: `REPORT <repo-relative path>`, `MANIFEST sha256=<self_sha256>`,
// `COMMITTED` (last, exactly the §4.1 row — the manifest's WROTE line is
// the MANIFEST line). Exit 0; 2 USAGE / RUN-COMMITTED; 3 INCOMPLETE(…);
// 5 INCONSISTENT(…).
//
// `buildReport(ctx, {run_id, template})` is the programmatic entry `verify
// all` (TASK-027) calls in-process so a verify run is COMMITTED and
// snapshot-able; `run()` is the argv wrapper.
//
// Imports: node:fs (existsSync, linkSync, readFileSync, rmSync,
// writeFileSync — the raw write-once writer; manifest.json goes through
// canon.writeArtifact), node:path, node:url, ../canon.mjs, ../redact.mjs
// (DEFAULT_RULES), ./argv.mjs, ./exit.mjs, ./inputs.mjs, ./ledger.mjs
// (RUN_ID, withRunLock), ./render.mjs, ./run-index.mjs (runDir),
// ./schema.mjs, ./tokens.mjs. No child process (G-6), no git, no network
// (G-14), no clock (G-1: created_at is ctx.now()).

import { existsSync, linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanonError, IntegrityError, artifactId, makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { REQUIRED, closeOver } from "./inputs.mjs";
import { RUN_ID, withRunLock } from "./ledger.mjs";
import { InconsistentInput, buildView, keyIdsOf, parseTemplate, renderMarkdown } from "./render.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, REPORT_TEMPLATES, RUN_COMMITTED, inconsistent, manifestLine, reportLine } from "./tokens.mjs";

const COMMAND = "build-report";
/** `<skill>/templates/` — the shipped report templates. */
export const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");
export const REPORT_FILE = "report.md";
export const MANIFEST_FILE = "manifest.json";

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", template: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  const template = flags.template;
  if (template === undefined) throw usageError(COMMAND, `--template is required (${REPORT_TEMPLATES.join("|")})`);
  if (!REPORT_TEMPLATES.includes(template)) throw usageError(COMMAND, `--template must be one of ${REPORT_TEMPLATES.join("|")}, got ${template}`);
  return { run_id, template };
}

// --- templates ----------------------------------------------------------------------

/** The shipped template, parsed and checked against the declared closed list. */
export function loadTemplate(template) {
  const path = join(TEMPLATES_DIR, `${template}.md`);
  if (!existsSync(path)) throw usageError(COMMAND, `template ${template} is not shipped yet`);
  const parsed = parseTemplate(readFileSync(path, "utf8"));
  if (parsed.template !== template) throw new Error(`${COMMAND}: templates/${template}.md declares template ${parsed.template}`);
  const declared = REQUIRED[template];
  if (parsed.required_inputs.length !== declared.length || parsed.required_inputs.some((n, i) => n !== declared[i])) {
    throw new Error(`${COMMAND}: templates/${template}.md required-inputs (${parsed.required_inputs.join(", ")}) differ from inputs.REQUIRED.${template} (${declared.join(", ")})`);
  }
  return parsed;
}

// --- writes -------------------------------------------------------------------------

let tmpCounter = 0;

/**
 * Write-once raw bytes: tmp (`wx`) + link (EEXIST from the kernel when the
 * target exists) + unlink, the shape canon.writeArtifact uses for
 * `exclusive: true`. Returns "written" or "same" (an existing file with the
 * same bytes — the resumable interrupted build); different bytes ⇒ 5
 * INCONSISTENT(<label>).
 */
function writeOnceBytes(path, bytes, label) {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${++tmpCounter}`);
  try {
    writeFileSync(tmp, bytes, { flag: "wx" });
    linkSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    if (err.code !== "EEXIST") throw err;
    if (!readFileSync(path).equals(bytes)) throw integrityFailure(inconsistent(label));
    return "same";
  }
  rmSync(tmp, { force: true });
  return "written";
}

/** Write-once artifact; an existing file with the same identity is the same artifact, a different one is 5 INCONSISTENT(<label>). */
function writeOnceArtifact(path, artifact, label) {
  try {
    return writeArtifact(path, artifact, { exclusive: true });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let existing;
    try {
      existing = readArtifact(path, { kind: artifact.envelope.kind });
    } catch (readErr) {
      if (readErr instanceof IntegrityError || readErr instanceof CanonError) throw integrityFailure(inconsistent(label), readErr);
      throw readErr;
    }
    if (existing.envelope.self_sha256 !== artifactId(artifact.payload)) throw integrityFailure(inconsistent(label));
    return existing;
  }
}

// --- the build ----------------------------------------------------------------------

/**
 * Build the report for a run (see the header). Prints nothing; the caller
 * prints the three lines from the result.
 * @param {object} ctx
 * @param {{run_id: string, template: string}} args
 * @returns {Promise<{dir: string, report_path: string, report_sha256: string, manifest: {envelope: object, payload: object}}>}
 * @throws {CliError} 2 USAGE / RUN-COMMITTED · 3 INCOMPLETE(…) · 5 INCONSISTENT(…)
 */
export async function buildReport(ctx, { run_id, template }) {
  if (typeof run_id !== "string" || !RUN_ID.test(run_id)) throw usageError(COMMAND, `run id must be <12 hex>-<4 digits>, got ${String(run_id)}`);
  if (!REPORT_TEMPLATES.includes(template)) throw usageError(COMMAND, `template must be one of ${REPORT_TEMPLATES.join("|")}, got ${String(template)}`);
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  if (run.payload.template !== template) throw usageError(COMMAND, `run ${run_id} is a ${run.payload.template} run; --template must be ${run.payload.template}`);
  const parsed = loadTemplate(template);

  return withRunLock(ctx, run_id, () => {
    if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
    const inputs = closeOver(dir, template, { ledgerDir: join(ctx.st, "ledger", run_id) });
    const key = ctx.keyById(run.envelope.key_id);
    // every key the closure's envelopes name (rotation, snapshots copied in
    // from other runs): Limitations list the artifacts whose key is gone
    // (spec §6.5; TASK-024)
    const keys = Object.fromEntries(
      keyIdsOf(inputs).map((id) => {
        const k = ctx.keyById(id);
        return [id, k === null ? null : k.bytes];
      }),
    );
    let view;
    try {
      view = buildView(inputs, { key: key === null ? null : key.bytes, keys, rules: DEFAULT_RULES, tool_version: ctx.toolVersion(), template_version: parsed.template_version });
    } catch (err) {
      if (err instanceof InconsistentInput) throw integrityFailure(inconsistent(err.field), err);
      throw err;
    }
    const reportBytes = Buffer.from(renderMarkdown(view, parsed), "utf8");
    const report_sha256 = sha256Hex(reportBytes);
    const payload = { inputs: inputs.hashes, report_sha256, template, template_version: parsed.template_version, tool_version: ctx.toolVersion() };
    const errors = validate("manifest", payload);
    if (errors.length > 0) throw new Error(`${COMMAND}: manifest payload is off-schema: ${errors[0]}`);
    const { schema_version, engagement_id, key_id } = run.envelope;
    const artifact = makeEnvelope({ schema_version, kind: "manifest", run_id, engagement_id, key_id, now: ctx.now }, payload);

    const report_path = join(dir, REPORT_FILE);
    writeOnceBytes(report_path, reportBytes, REPORT_FILE);
    const manifest = writeOnceArtifact(join(dir, MANIFEST_FILE), artifact, MANIFEST_FILE);
    writeOnceBytes(join(dir, COMMITTED), Buffer.from(`${manifest.envelope.self_sha256}\n`, "utf8"), COMMITTED);
    return { dir, report_path, report_sha256, manifest };
  });
}

/**
 * @param {string[]} argv after `build-report`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const result = await buildReport(ctx, args);
  ctx.out(reportLine(ctx.rel(result.report_path)));
  ctx.out(manifestLine(result.manifest.envelope.self_sha256));
  ctx.out(COMMITTED);
  return EXIT.OK;
}

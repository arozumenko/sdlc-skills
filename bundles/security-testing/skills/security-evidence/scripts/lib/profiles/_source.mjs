// lib/profiles/_source.mjs — the publication source: a COMMITTED run directory
// loaded once, verified, frozen (TASK-031; plan §4.1 rows `publish` /
// `check-export`; spec §6.1 "a run directory without COMMITTED is
// incomplete", §6.9). The one I/O module under lib/profiles/: the profiles
// themselves are pure over what this returns.
//
//   loadSource(runDir, {command, casesDir?}) → Source
//
//   Source = {
//     run_id, dir, template,
//     run          run.json artifact
//     manifest     manifest.json artifact (kind manifest) — its self_sha256 is the
//                  export manifest's `source_manifest_sha256`
//     report       Buffer of report.md, verified against manifest.report_sha256
//     claimed      findings.claimed.json artifact, or null (a verify-kind run)
//     gateResult   gate-result.json artifact, or null
//     imports      every <run>/ingest/<sha>.json artifact (kind import), by name
//     engagement   <run>/engagement.json artifact (kind engagement — the record
//                  the run was started with: slug, base_url), or null (TASK-043)
//     admissions   every <run>/admissions/<sha>.json artifact (kind admission),
//                  by name (TASK-043; the `case` profile reads the admitted set)
//     cases        the candidate cases under `casesDir` (`<st>/cases/`, TASK-043)
//                  when the caller passes it, else []: every file, recursively,
//                  sorted by path — {relpath (posix, below casesDir), name,
//                  case_sha256, redacted}, read once and redacted once
//                  (admission-core.caseSha256, G-3 order: the raw bytes never
//                  leave the loader; `redacted` is the text every reader sees).
//                  An admission record carries no path, so the `case` profile
//                  finds a case by its identity in this list.
//   }
//
// Reads go through inputs.pathGuard over the run directory — plus, when
// given, the cases directory — so a source can never pull in another run,
// the live register or the drop-box (G-16's boundary, applied to
// publication). Checks, in order:
//   run.json absent          ⇒ 2 USAGE(<command>: unknown run <id>)
//   COMMITTED absent         ⇒ 2 USAGE(<command>: run <id> is not COMMITTED (build-report first))
//   run.json / manifest.json / claimed / gate-result / engagement.json / an
//   import or admission record that is not the artifact it claims to be, or
//   not this run's           ⇒ 5 INCONSISTENT(<file>)
//   COMMITTED ≠ manifest hash ⇒ 5 INCONSISTENT(COMMITTED)
//   report bytes ≠ manifest.report_sha256 ⇒ 5 INCONSISTENT(report.md)
// `command` names the caller in the exit-2 tokens (`publish` / `check-export`).
//
// Imports: node:path, ../../canon.mjs (readArtifact, sha256Hex, the error
// classes), ../admission-core.mjs (caseSha256), ../exit.mjs, ../inputs.mjs
// (pathGuard — the file-system door), ../ledger.mjs (RUN_ID), ../tokens.mjs.
// No writes, no child process, no git, no clock.

import { basename, isAbsolute, join, resolve } from "node:path";
import { CanonError, IntegrityError, readArtifact, sha256Hex } from "../../canon.mjs";
import { caseSha256 } from "../admission-core.mjs";
import { integrityFailure, usageError } from "../exit.mjs";
import { pathGuard } from "../inputs.mjs";
import { RUN_ID } from "../ledger.mjs";
import { COMMITTED, inconsistent } from "../tokens.mjs";

/** @typedef {{relpath: string, name: string, case_sha256: string, redacted: string}} Candidate */
/** @typedef {{run_id: string, dir: string, template: string, run: object, manifest: object, report: Buffer, claimed: object | null, gateResult: object | null, imports: object[], engagement: object | null, admissions: object[], cases: Candidate[]}} Source */

const SHA256_LINE = /^([0-9a-f]{64})\n?$/;

function readVerified(guard, path, kind, label, run_id) {
  let art;
  try {
    art = readArtifact(guard.check(path), { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(label), err);
    throw err;
  }
  if (run_id !== undefined && art.envelope.run_id !== run_id) throw integrityFailure(inconsistent(label));
  return art;
}

/** Every file below `casesDir` (recursively, sorted), read once and redacted once. */
function loadCases(casesDir) {
  const guard = pathGuard([casesDir]);
  const out = [];
  const visit = (dir, rel) => {
    for (const name of guard.list(dir)) {
      const { case_sha256, redacted } = caseSha256(guard.read(join(dir, name)));
      out.push(Object.freeze({ relpath: rel === "" ? name : `${rel}/${name}`, name, case_sha256, redacted }));
    }
    for (const sub of guard.dirs(dir)) visit(join(dir, sub), rel === "" ? sub : `${rel}/${sub}`);
  };
  if (guard.isDir(casesDir)) visit(casesDir, "");
  return Object.freeze(out.sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0)));
}

/**
 * Load and verify a COMMITTED run directory (see the header).
 * @param {string} runDir absolute `<st>/runs/<run_id>`
 * @param {{command: string, casesDir?: string}} options the calling command, for the exit-2 tokens; `casesDir` = absolute `<st>/cases` to load the candidates
 * @returns {Source} frozen
 * @throws {CliError} 2 USAGE · 5 INCONSISTENT(<file>)
 */
export function loadSource(runDir, { command, casesDir } = {}) {
  if (typeof runDir !== "string" || !isAbsolute(runDir)) throw new TypeError("loadSource: runDir must be an absolute path");
  if (typeof command !== "string" || command === "") throw new TypeError("loadSource: options.command is required");
  if (casesDir !== undefined && (typeof casesDir !== "string" || !isAbsolute(casesDir))) throw new TypeError("loadSource: options.casesDir must be an absolute path");
  const dir = resolve(runDir);
  const run_id = basename(dir);
  const guard = pathGuard([dir]);
  if (!RUN_ID.test(run_id) || !guard.exists(join(dir, "run.json"))) throw usageError(command, `unknown run ${run_id}`);
  if (!guard.exists(join(dir, COMMITTED))) throw usageError(command, `run ${run_id} is not COMMITTED (build-report first)`);

  const run = readVerified(guard, join(dir, "run.json"), "run", "run.json");
  if (run.envelope.run_id !== run_id) throw integrityFailure(inconsistent("run.json"));
  const manifest = readVerified(guard, join(dir, "manifest.json"), "manifest", "manifest.json", run_id);
  const marker = SHA256_LINE.exec(guard.read(join(dir, COMMITTED)).toString("utf8"));
  if (!marker || marker[1] !== manifest.envelope.self_sha256) throw integrityFailure(inconsistent(COMMITTED));
  const report = guard.read(join(dir, "report.md"));
  if (sha256Hex(report) !== manifest.payload.report_sha256) throw integrityFailure(inconsistent("report.md"));

  const optional = (file, kind) => (guard.exists(join(dir, file)) ? readVerified(guard, join(dir, file), kind, file, run_id) : null);
  const claimed = optional("findings.claimed.json", "claimed");
  const gateResult = optional("gate-result.json", "gate-result");
  const imports = guard.list(join(dir, "ingest")).map((name) => readVerified(guard, join(dir, "ingest", name), "import", `ingest/${name}`, run_id));
  const engagement = optional("engagement.json", "engagement");
  const admissions = guard
    .list(join(dir, "admissions"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readVerified(guard, join(dir, "admissions", name), "admission", `admissions/${name.slice(0, -".json".length)}`, run_id));
  const cases = casesDir === undefined ? Object.freeze([]) : loadCases(resolve(casesDir));

  return Object.freeze({ run_id, dir, template: manifest.payload.template, run, manifest, report, claimed, gateResult, imports: Object.freeze(imports), engagement, admissions: Object.freeze(admissions), cases });
}

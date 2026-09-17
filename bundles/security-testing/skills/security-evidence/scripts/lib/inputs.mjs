// lib/inputs.mjs — the closed, transitively closed input set of a report
// template (TASK-023; plan §3.3 row `lib/inputs.mjs`, §5 TASK-023; spec §6.3
// "required-inputs list is closed … transitively closed", TL-3, TL-14,
// G-16; US-016 AC-1…AC-3).
//
//   REQUIRED                         {template → [input name]} — the closed lists
//   closeOver(runDir, template, o)   → {template, artifacts, hashes}
//   pathGuard(roots)                 the only file-system access this module makes
//   setIdentity(shas)                sha256(canonical(sorted member identities))
//
// `build-report` reads only from the run directory (TL-3): every read here
// goes through a path guard built over `<st>/runs/<id>/` (and, when the
// caller passes it, `<st>/ledger/<id>/` — the redacted import blobs, which
// no template reads today), and a path outside those roots throws
// PathGuardError before any I/O. The live register, the ledger index, other
// runs and the agent drop-box are unreachable by construction (G-16); the
// key and git objects are the command's business, not this module's.
//
// Input names and the files they denote (plan §3.2):
//
//   run            run.json                     gate-result     gate-result.json
//   scope          scope.json                   coverage        coverage.json
//   claimed        findings.claimed.json        examined        examined.json
//   rejects        rejects.json                 unlocated       unlocated.json
//   engagement     engagement.json              threat-model    threat-model.json
//   verify         verify.json                  dispositions    dispositions.json (assessment + threat-model since TASK-048)
//   register-events register-events.json        proposals-index proposals-index.json
//   packets        packets/<sha>.json (set)     receipts        receipts/<sha>.json (set)
//   imports        imports.json index → ingest/<import_sha256>.json (set)
//   observations   observations.json index → observations/<id>.json (set)
//   verify-snapshots verify-snapshots/<id>/{verify.json, packets/, receipts/} (set)
//
// A required file that is absent ⇒ CliError(3, INCOMPLETE(<name>)), nothing
// else read or written. A present file that is not the artifact it claims
// to be (malformed, wrong kind, self_sha256 mismatch, a set member filed
// under a name that is not its identity, an envelope naming another run —
// run.json must name the directory, every other artifact of the run must
// name run.json's run, and a verify snapshot's verify.json must name the
// verify run its directory is named after) ⇒ 5 INCONSISTENT(<file>). Then the
// closure: every artifact an input references by hash must itself be
// present — receipts → packets, examined → its scope packet, verify → the
// fix-review packet, observations → their imports, verify-snapshots → their
// packets and receipts — else INCOMPLETE(<kind>:<sha>) naming the reference
// (`packet:<sha>`, `import:<sha>`, `observation:<id>`, `verify:<id>`). The
// singleton references (gate-result → scope + claimed, coverage → scope +
// examined) are presence here and identity in render.buildView's re-run
// (5 INCONSISTENT(gate-result) / INCONSISTENT(coverage)).
//
// `hashes` is the manifest's `inputs` (run-manifest.schema.json): a singleton
// by its self_sha256; a set by setIdentity over its members' identities
// (TL-14: an index file's own identity never enters a preimage — the members
// it lists do); `register-events` and `proposals-index` by their own
// self_sha256 (TASK-058's contract for the two snapshot artifacts).
//
// Set members are listed with dot-entries skipped: canon.writeArtifact and
// fsx.writeAtomic leave `.<name>.tmp-<pid>-<n>` beside a file while they run
// (TASK-012 review follow-ups), and a concurrent index append must never
// surface in a manifest. The command additionally holds the run lock for
// the whole build (cmd-build-report.mjs).
//
// Imports: node:fs (existsSync, readdirSync, readFileSync, statSync — reads
// only), node:path, ../canon.mjs, ./exit.mjs, ./tokens.mjs. No writes, no
// child process (G-6), no git, no network (G-14), no clock (G-1).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CanonError, IntegrityError, canonical, readArtifact as canonReadArtifact, sha256Hex } from "../canon.mjs";
import { CliError, EXIT, integrityFailure } from "./exit.mjs";
import { REPORT_TEMPLATES, incomplete, inconsistent } from "./tokens.mjs";

const REVIEW = Object.freeze(["run", "scope", "claimed", "gate-result", "coverage", "examined", "packets", "receipts", "rejects", "unlocated"]);

/** The closed required-inputs list per template (spec §6.3 table; the template files carry the same list — cmd-build-report checks they agree). */
export const REQUIRED = Object.freeze({
  review: REVIEW,
  // `dispositions` (TASK-048; PM ruling after G20/G21, G-7): the index tm-lint
  // check derives beside the snapshot — required so a COMMITTED assessment
  // always carries the script-derived index and an un-linted model (snapshot
  // written, relationship lint failed or never run) is INCOMPLETE(dispositions),
  // never a report. Absent at `run init` like the snapshot (spec P2; R1:
  // write-once, never agent-authored, so no placeholder can be pre-written).
  assessment: Object.freeze([...REVIEW, "engagement", "threat-model", "dispositions", "observations", "imports", "verify-snapshots", "register-events", "proposals-index"]),
  verify: Object.freeze(["run", "verify", "packets", "receipts"]),
  "threat-model": Object.freeze(["run", "threat-model", "packets", "receipts", "dispositions"]),
});

/** Singleton inputs: file name and envelope kind. */
export const SINGLETONS = Object.freeze({
  run: Object.freeze({ file: "run.json", kind: "run" }),
  scope: Object.freeze({ file: "scope.json", kind: "scope" }),
  claimed: Object.freeze({ file: "findings.claimed.json", kind: "claimed" }),
  "gate-result": Object.freeze({ file: "gate-result.json", kind: "gate-result" }),
  coverage: Object.freeze({ file: "coverage.json", kind: "coverage" }),
  examined: Object.freeze({ file: "examined.json", kind: "examined" }),
  rejects: Object.freeze({ file: "rejects.json", kind: "rejects" }),
  unlocated: Object.freeze({ file: "unlocated.json", kind: "unlocated" }),
  engagement: Object.freeze({ file: "engagement.json", kind: "engagement" }),
  "threat-model": Object.freeze({ file: "threat-model.json", kind: "threat-model" }),
  verify: Object.freeze({ file: "verify.json", kind: "verify" }),
  dispositions: Object.freeze({ file: "dispositions.json", kind: "dispositions" }),
  "register-events": Object.freeze({ file: "register-events.json", kind: "register-snapshot" }),
  "proposals-index": Object.freeze({ file: "proposals-index.json", kind: "proposals-index" }),
});

/** Set inputs whose members are content-addressed files under one directory. */
export const SETS = Object.freeze({
  packets: Object.freeze({ dir: "packets", kind: "packet" }),
  receipts: Object.freeze({ dir: "receipts", kind: "receipt" }),
});

const SHA256 = /^[0-9a-f]{64}$/;

/** Thrown before any I/O when a path lies outside the guard's roots (US-016 AC-1, G-16). */
export class PathGuardError extends Error {
  constructor(path, roots) {
    super(`build-report: refusing to read outside the run directory: ${path} (allowed: ${roots.join(", ")})`);
    this.name = "PathGuardError";
    this.path = path;
  }
}

/**
 * The one file-system door of this module. Every method resolves its path
 * and throws PathGuardError unless it lies under one of `roots`.
 * @param {string[]} roots absolute directories
 * @returns {{roots: string[], allows(p: string): boolean, check(p: string): string, exists(p: string): boolean, read(p: string): Buffer, list(dir: string): string[]}}
 */
export function pathGuard(roots) {
  if (!Array.isArray(roots) || roots.length === 0 || roots.some((r) => typeof r !== "string" || !isAbsolute(r))) throw new TypeError("pathGuard: roots must be absolute paths");
  const bases = roots.map((r) => resolve(r));
  const allows = (p) => {
    const abs = resolve(p);
    return bases.some((b) => {
      const rel = relative(b, abs);
      return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    });
  };
  const check = (p) => {
    if (typeof p !== "string" || p === "") throw new TypeError("pathGuard: a path is required");
    if (!allows(p)) throw new PathGuardError(p, bases);
    return resolve(p);
  };
  return Object.freeze({
    roots: Object.freeze([...bases]),
    allows,
    check,
    exists: (p) => existsSync(check(p)),
    read: (p) => readFileSync(check(p)),
    /** Directory entries, files only, dot-entries skipped, sorted by UTF-8 byte order; a missing dir is []. */
    list: (dir) => {
      const abs = check(dir);
      if (!existsSync(abs)) return [];
      return readdirSync(abs, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && (e.isFile() || e.isSymbolicLink()))
        .map((e) => e.name)
        .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    },
    /** Sub-directory names, dot-entries skipped, sorted. */
    dirs: (dir) => {
      const abs = check(dir);
      if (!existsSync(abs)) return [];
      return readdirSync(abs, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    },
    isDir: (p) => {
      const abs = check(p);
      return existsSync(abs) && statSync(abs).isDirectory();
    },
  });
}

/**
 * sha256(canonical(sorted member identities)) — the manifest's identity for a set input.
 * @param {string[]} shas
 * @returns {string}
 */
export function setIdentity(shas) {
  if (!Array.isArray(shas) || shas.some((s) => typeof s !== "string" || !SHA256.test(s))) throw new TypeError("setIdentity: members must be sha256 strings");
  return sha256Hex(canonical([...shas].sort()));
}

// --- reading ------------------------------------------------------------------------

/** readArtifact through the guard; a file that is not the artifact it claims to be is 5 INCONSISTENT(<label>). */
function readArtifact(guard, path, kind, label) {
  const abs = guard.check(path);
  try {
    return canonReadArtifact(abs, { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(label), err);
    throw err;
  }
}

const missing = (name) => new CliError(EXIT.INDETERMINATE, incomplete(name));

function readSingleton(guard, dir, name) {
  const spec = SINGLETONS[name];
  const path = join(dir, spec.file);
  if (!guard.exists(path)) throw missing(name);
  return readArtifact(guard, path, spec.kind, spec.file);
}

/** Every `<sha>.json` under `<dir>/<sub>/`, each verified and filed under its own identity. */
function readSet(guard, dir, sub, kind, label = sub) {
  const base = join(dir, sub);
  const out = [];
  for (const name of guard.list(base)) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length);
    const art = readArtifact(guard, join(base, name), kind, `${label}/${stem}`);
    if (art.envelope.self_sha256 !== stem) throw integrityFailure(inconsistent(`${label}/${stem}`));
    out.push(art);
  }
  return out;
}

const ids = (list) => new Set(list.map((a) => a.envelope.self_sha256));

/** receipts → packets (spec §6.3 "packets from receipts"). */
function closeReceipts(receipts, packets) {
  const have = ids(packets);
  for (const r of receipts) if (!have.has(r.payload.packet_sha256)) throw missing(`packet:${r.payload.packet_sha256}`);
}

/** The `imports` input: the index, then every listed record under ingest/. */
function readImports(guard, dir) {
  const index = readArtifact(guard, join(dir, "imports.json"), "imports-index", "imports.json");
  const records = [];
  for (const entry of index.payload.imports) {
    const path = join(dir, "ingest", `${entry.import_sha256}.json`);
    if (!guard.exists(path)) throw missing(`import:${entry.import_sha256}`);
    const art = readArtifact(guard, path, "import", `ingest/${entry.import_sha256}`);
    if (art.payload.import_sha256 !== entry.import_sha256) throw integrityFailure(inconsistent(`ingest/${entry.import_sha256}`));
    records.push(art);
  }
  return { index, records };
}

/** The `observations` input: the index, every listed observation, each closed over its import. */
function readObservations(guard, dir, importRecords) {
  const index = readArtifact(guard, join(dir, "observations.json"), "observations-index", "observations.json");
  const have = new Set(importRecords.map((a) => a.payload.import_sha256));
  const records = [];
  for (const entry of index.payload.observations) {
    const path = join(dir, "observations", `${entry.observation_id}.json`);
    if (!guard.exists(path)) throw missing(`observation:${entry.observation_id}`);
    const art = readArtifact(guard, path, "observation", `observations/${entry.observation_id}`);
    if (art.envelope.self_sha256 !== entry.sha256) throw integrityFailure(inconsistent(`observations/${entry.observation_id}`));
    if (!have.has(art.payload.import_sha256)) throw missing(`import:${art.payload.import_sha256}`);
    records.push(art);
  }
  return { index, records };
}

/** The `verify-snapshots` input: every `<id>/verify.json`, closed over its packet and receipts. */
function readVerifySnapshots(guard, dir) {
  const base = join(dir, "verify-snapshots");
  const out = [];
  for (const id of guard.dirs(base)) {
    const path = join(base, id, "verify.json");
    if (!guard.exists(path)) throw missing(`verify:${id}`);
    const verify = readArtifact(guard, path, "verify", `verify-snapshots/${id}/verify.json`);
    // TASK-024 (PM log after G12): a snapshot is filed under the verify run it
    // came from — `run snapshot verify` names the directory by that run's id.
    if (verify.envelope.run_id !== id) throw integrityFailure(inconsistent(`verify-snapshots/${id}/verify.json`));
    const packets = readSet(guard, join(base, id), "packets", "packet", `verify-snapshots/${id}/packets`);
    const receipts = readSet(guard, join(base, id), "receipts", "receipt", `verify-snapshots/${id}/receipts`);
    if (!ids(packets).has(verify.payload.packet_sha256)) throw missing(`packet:${verify.payload.packet_sha256}`);
    closeReceipts(receipts, packets);
    out.push({ id, verify, packets, receipts });
  }
  return out;
}

// --- closeOver ----------------------------------------------------------------------

/**
 * Load every required input of `template` from `runDir` and close over the
 * references (see the header).
 * @param {string} runDir absolute `<st>/runs/<run_id>`
 * @param {string} template review | assessment | verify | threat-model
 * @param {{ledgerDir?: string}} [options] `<st>/ledger/<run_id>` — the other root TL-3 allows
 * @returns {{template: string, artifacts: Record<string, object | object[]>, hashes: Record<string, string>}}
 * @throws {CliError} 3 INCOMPLETE(<name>) · 5 INCONSISTENT(<file>)
 * @throws {PathGuardError} a path outside the run directory (a bug — the caller passed one)
 */
export function closeOver(runDir, template, { ledgerDir } = {}) {
  if (typeof runDir !== "string" || !isAbsolute(runDir)) throw new TypeError("closeOver: runDir must be an absolute path");
  if (!REPORT_TEMPLATES.includes(template)) throw new TypeError(`closeOver: unknown template ${String(template)}`);
  const roots = [runDir];
  if (ledgerDir !== undefined) roots.push(ledgerDir);
  const guard = pathGuard(roots);
  const dir = resolve(runDir);
  if (!guard.isDir(dir)) throw missing("run");

  const artifacts = {};
  const hashes = {};
  const required = REQUIRED[template];
  // run.json first: its envelope names the run, and every other artifact of
  // the run must carry the same run_id — a verify.json or gate-result copied
  // in from another run is self-consistent but not this run's (5).
  const run = readSingleton(guard, dir, "run");
  const run_id = run.envelope.run_id;
  if (run_id !== basename(dir)) throw integrityFailure(inconsistent(SINGLETONS.run.file));
  const ownRun = (art, label) => {
    if (art.envelope.run_id !== run_id) throw integrityFailure(inconsistent(label));
    return art;
  };
  for (const name of required) {
    if (name === "run") {
      artifacts.run = run;
      hashes.run = run.envelope.self_sha256;
    } else if (Object.hasOwn(SINGLETONS, name)) {
      const art = ownRun(readSingleton(guard, dir, name), SINGLETONS[name].file);
      artifacts[name] = art;
      hashes[name] = art.envelope.self_sha256;
    } else if (Object.hasOwn(SETS, name)) {
      const list = readSet(guard, dir, SETS[name].dir, SETS[name].kind).map((a) => ownRun(a, `${SETS[name].dir}/${a.envelope.self_sha256}`));
      artifacts[name] = list;
      hashes[name] = setIdentity(list.map((a) => a.envelope.self_sha256));
    }
  }
  if (required.includes("imports")) {
    if (!guard.exists(join(dir, "imports.json"))) throw missing("imports");
    const { index, records } = readImports(guard, dir);
    artifacts.imports = records;
    artifacts["imports-index"] = index;
    hashes.imports = setIdentity(records.map((a) => a.envelope.self_sha256));
  }
  if (required.includes("observations")) {
    if (!guard.exists(join(dir, "observations.json"))) throw missing("observations");
    const { index, records } = readObservations(guard, dir, artifacts.imports ?? []);
    artifacts.observations = records;
    artifacts["observations-index"] = index;
    hashes.observations = setIdentity(records.map((a) => a.envelope.self_sha256));
  }
  if (required.includes("verify-snapshots")) {
    const snapshots = readVerifySnapshots(guard, dir);
    artifacts["verify-snapshots"] = snapshots;
    hashes["verify-snapshots"] = setIdentity(snapshots.map((s) => s.verify.envelope.self_sha256));
  }

  // the closure over hash references
  if (artifacts.receipts !== undefined) closeReceipts(artifacts.receipts, artifacts.packets);
  if (artifacts.examined !== undefined && !ids(artifacts.packets).has(artifacts.examined.payload.packet_sha256)) throw missing(`packet:${artifacts.examined.payload.packet_sha256}`);
  if (artifacts.verify !== undefined && !ids(artifacts.packets).has(artifacts.verify.payload.packet_sha256)) throw missing(`packet:${artifacts.verify.payload.packet_sha256}`);

  return { template, artifacts, hashes: Object.fromEntries(Object.keys(hashes).sort().map((k) => [k, hashes[k]])) };
}


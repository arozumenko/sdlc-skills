// lib/cmd-tm-lint.mjs — `tm-lint.mjs check --run <id> [--model <path>]` and
// `tm-lint.mjs render --run <id>` (TASK-039; plan §4.4, §5 TASK-039; spec
// §6.10 threat dispositions, D14; US-031 AC-2…AC-4; PM rulings R1 and R2
// after M1). TASK-006 shipped the argv shape and `2 NOT-IMPLEMENTED(M2)`;
// this file replaces the bodies, the argv contract stays. The rules live in
// lib/tm-lint-core.mjs (pure, G-9); this file is the I/O around them.
//
// check — order (so a refusal leaves nothing behind that it should not):
//
//   1. argv: `--run` (shape, 2 USAGE), `--model <path>` (a user-typed path:
//      ctx.input keeps it cwd-relative and inside the work tree, 2 USAGE
//      otherwise; default `<st>/threat-model.json`, unreadable ⇒ 2
//      USAGE(check: cannot read …));
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒ 2
//      RUN-COMMITTED (G-10); `scope.json` absent ⇒ 3 INCOMPLETE(scope) —
//      every citation is checked against it; both read with readArtifact
//      (5 when tampered);
//   3. the model: strict JSON (a parse error over the agent's file is the
//      model's own fault — 4 TM-INVALID(model: <reason>), never left for the
//      dispatcher, lib/exit.mjs input-side rule) then redactDeep in memory
//      (G-4: what is linted, named and written is the redacted form);
//   4. tm-lint-core.lintStructure — schema, unique ids, blank names,
//      element references, disposition shape, every element and mitigation
//      citation (R2 dirty rule, then cite-core.checkRange on the scope) ⇒
//      the first failure is `4 TM-INVALID(<threat|element>: <reason>)` and
//      NOTHING is written (the M1 stub's SCHEMA-INVALID spelling is gone);
//   5. the snapshot `<run>/threat-model.json` (kind threat-model, the run's
//      own envelope identity, write-once; R1). A file already there is
//      either this very model (same identity ⇒ idempotent, nothing
//      rewritten) or a different one ⇒ 2 SNAPSHOT-EXISTS (G-10: retry = new
//      seq); one that is not the artifact it claims to be ⇒ 5
//      INCONSISTENT(threat-model). The snapshot is written BEFORE the
//      relationships are checked: `packet --kind subject --subject M-nnn`
//      reads it, so a `mitigated` disposition can only ever validate after
//      the snapshot exists — structure freezes the model, evidence gates the
//      index. A ref typo therefore needs a new run, like every other
//      write-once artifact of the bundle;
//   6. tm-lint-core.lintDispositions with the evidence bound to the run
//      directory (nothing outside it is read, TL-3 / G-16: the register and
//      the proposals reach the run through `run snapshot`):
//        planned    proposal id ∈ <run>/proposals-index.json, or a 64-hex
//                   case id with <run>/admissions/<id>.json (kind admission,
//                   payload.case_sha256 = id) whose classification is
//                   `admitted-*` — a `proposal` record is not planned (PM
//                   ruling after G22, TASK-044; the reason stays the core's
//                   "no admission record")
//        executed   <run>/observations/<id>.json (kind observation,
//                   payload.observation_id = id; the id must be the schema's
//                   `O-<12 hex>` before it is used as a file name)
//        ticketed   a <run>/ingest/*.json record of kind tracker-readback
//                   whose trusted {finding_id, url, body_contains_finding_id}
//                   is {threat id, ref, true} (spec §6.10: "the ticket body
//                   carries the threat id")
//        accepted   <run>/register-events.json replayed (register-fold; a
//                   broken chain ⇒ 5 INCONSISTENT(register-events)): the row
//                   named by ref has subject == threat id and status accepted
//        mitigated  states.applyReceipts over <run>/receipts + <run>/packets
//                   derives MITIGATION_CONFIRMED for the ref, which must be
//                   one of the threat's own mitigations
//      ⇒ the first failure is `4 TM-INVALID(<threat>: <kind>(<ref>): …)`,
//      printed before the snapshot's WROTE line; no index is written;
//   7. `<run>/dispositions.json` (kind dispositions, write-once, R1): one row
//      per threat, `resolved_via` naming what validated it, `none` for
//      undisposed — the agent's `disposition.kind` is an assertion this
//      script validated (G-7); TASK-041's sign-off reads this file. An
//      identical file already there is idempotent; a different one ⇒ 5
//      INCONSISTENT(dispositions) (a passing identical model derives an
//      identical index, so a difference is tampering).
//
// stdout (exit 0): `TM elements=<n> threats=<n> undisposed=<n>` then `WROTE
// <run>/threat-model.json sha256=<h>` and `WROTE <run>/dispositions.json
// sha256=<h>`. Exit 2 USAGE / RUN-COMMITTED / SNAPSHOT-EXISTS; 3
// INCOMPLETE(scope); 4 TM-INVALID(…); 5 INCONSISTENT(…) or when run.json /
// scope.json / a run artifact is not what it claims to be.
//
// render — `<run>/threat-model.json` (absent ⇒ 3 INCOMPLETE(threat-model))
// and `<run>/dispositions.json` (absent ⇒ 3 INCOMPLETE(dispositions): the
// view is of a linted model) plus the run's receipts and packets (mitigation
// states through the same applyReceipts) → tm-lint-core.renderThreatModel →
// redactString (G-4) → `<run>/threat-model.md`, write-once (G-10): the same
// bytes again are idempotent, different bytes (a mitigation state moved
// since) ⇒ 2 RENDER-EXISTS — the definitive report is `build-report
// --template threat-model`, whose required inputs (run, threat-model,
// packets, receipts, dispositions; lib/inputs.mjs) `check` completes.
// stdout: `RENDER <run>/threat-model.md elements=<n> threats=<n>`.
// COMMITTED ⇒ 2 RUN-COMMITTED for render too.
//
// PM log after G11/G12: a vulnerability-review receipt on a mitigation id is
// settled on the render side (render.mjs's header: reviewView never renders
// a non-finding subject); here only mitigation-review receipts reach
// `mitigation_states` (states.mjs), so such a receipt cannot validate
// `mitigated` either.
//
// Imports: node:fs (existsSync, readFileSync, readdirSync — every artifact
// write is canon.writeArtifact, the view fsx.writeExclusive), node:path,
// ../canon.mjs, ../redact.mjs, ./argv.mjs, ./exit.mjs, ./fsx.mjs,
// ./ledger.mjs (RUN_ID), ./register-fold.mjs (replay), ./run-index.mjs
// (runDir, INDEXES), ./states.mjs (applyReceipts), ./tm-lint-core.mjs,
// ./tokens.mjs. No child process (G-6), no git, no network (G-14), no clock
// (G-1: created_at is ctx.now()). Every string that leaves the process goes
// through ctx.out / ctx.log / writeArtifact / redactString (G-4).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep, redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { writeExclusive } from "./fsx.mjs";
import { RUN_ID } from "./ledger.mjs";
import { replay } from "./register-fold.mjs";
import { INDEXES, runDir } from "./run-index.mjs";
import { applyReceipts } from "./states.mjs";
import { lintDispositions, lintStructure, modelCounts, renderThreatModel } from "./tm-lint-core.mjs";
import { COMMITTED, RENDER_EXISTS, RUN_COMMITTED, SNAPSHOT_EXISTS, incomplete, inconsistent, tmInvalid, tmLine, tmRendered } from "./tokens.mjs";

export const SNAPSHOT_FILE = "threat-model.json";
export const DISPOSITIONS_FILE = "dispositions.json";
export const VIEW_FILE = "threat-model.md";
export const REGISTER_SNAPSHOT_FILE = "register-events.json";
/** observation.schema.json `observation_id` — the only ref used as a file name that is not already 64-hex. */
const OBSERVATION_ID = /^O-[0-9a-f]{12}$/;
/** admission.schema.json classifications that admit a case (`admitted-heuristic` | `admitted-reviewed`); `proposal` does not (TASK-044). */
const ADMITTED_CLASSIFICATION = /^admitted-/;

// --- the run ---------------------------------------------------------------------------

function requireRun(command, flags) {
  if (typeof flags.run !== "string") throw usageError(command, "--run <id> is required");
  if (!RUN_ID.test(flags.run)) throw usageError(command, `--run must be <12 hex>-<4 digits>, got ${flags.run}`);
  return flags.run;
}

/** `<run>/run.json` (unknown ⇒ 2 USAGE), refuse a COMMITTED run (G-10). */
function openRun(ctx, command, run_id) {
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(command, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  return { dir, run };
}

/** The envelope head every artifact written into this run shares: the run's own identity, `kind` per file. */
function headOf(run, kind, ctx) {
  const { schema_version, run_id, engagement_id, key_id } = run.envelope;
  return { schema_version, kind, run_id, engagement_id, key_id, now: ctx.now };
}

/** Every artifact of `kind` under `<run>/<sub>/` (sorted by name; 5 when one is not what it claims to be). */
function readAll(dir, sub, kind) {
  const where = join(dir, sub);
  if (!existsSync(where)) return [];
  return readdirSync(where)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readArtifact(join(where, name), { kind }));
}

/** One optional run artifact: absent ⇒ null; present but not the artifact it claims to be ⇒ 5 INCONSISTENT(<name>). */
function readOptional(dir, rel, kind, name) {
  const path = join(dir, rel);
  if (!existsSync(path)) return null;
  try {
    return readArtifact(path, { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(name), err);
    throw err;
  }
}

const mitigationStatesOf = (dir) => applyReceipts(null, readAll(dir, "receipts", "receipt"), readAll(dir, "packets", "packet")).mitigation_states;

// --- check: the model file ----------------------------------------------------------------

/** The model as the agent wrote it, or the 2 USAGE / 4 TM-INVALID(model: …) refusals. */
function readModel(ctx, command, path) {
  let bytes;
  try {
    bytes = readFileSync(ctx.input(command, path));
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw usageError(command, `cannot read ${path}`);
    throw err;
  }
  try {
    return parseStrict(bytes);
  } catch (err) {
    if (err instanceof CanonError) throw new CliError(EXIT.FAIL, tmInvalid("model", err.message), { cause: err });
    throw err;
  }
}

// --- check: write-once artifacts ----------------------------------------------------------

/**
 * Write `<run>/<file>` write-once. A file already there that verifies to the
 * same identity is the same artifact (idempotent); a different one is
 * `onDifferent`'s error; one that is not an artifact ⇒ 5 INCONSISTENT(name).
 * @returns {{path: string, written: {envelope: object, payload: object}}}
 */
function persist(ctx, dir, run, kind, file, name, payload, onDifferent) {
  const path = join(dir, file);
  const artifact = makeEnvelope(headOf(run, kind, ctx), payload);
  try {
    return { path, written: writeArtifact(path, artifact, { prered: true, exclusive: true }) };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = readOptional(dir, file, kind, name);
    if (existing === null) throw err; // gone between the two calls: not ours to reason about
    if (existing.envelope.self_sha256 !== artifactId(payload)) throw onDifferent(existing);
    return { path, written: existing };
  }
}

// --- check: evidence bound to the run directory --------------------------------------------

/** The six closures tm-lint-core.lintDispositions reads (header); each reads lazily, once. */
function evidenceOf(dir) {
  let proposals;
  let readbacks;
  let rows;
  let states;
  return {
    proposal(id) {
      proposals ??= readOptional(dir, INDEXES.proposals.file, INDEXES.proposals.kind, "proposals-index")?.payload.proposals ?? [];
      return proposals.some((p) => p.id === id);
    },
    admission(sha) {
      // PM ruling (after G22, taken by TASK-044): `planned(<case_sha256>)` needs an ADMITTED record —
      // a `proposal`-classified record is not planned (the case never enters the hand-off suite, D7).
      const a = readOptional(dir, join("admissions", `${sha}.json`), "admission", `admissions/${sha}`);
      return a !== null && a.payload.case_sha256 === sha && ADMITTED_CLASSIFICATION.test(a.payload.classification ?? "");
    },
    observation(id) {
      if (!OBSERVATION_ID.test(id)) return false;
      const o = readOptional(dir, join("observations", `${id}.json`), "observation", `observations/${id}`);
      return o !== null && o.payload.observation_id === id;
    },
    readback(threat_id, url) {
      readbacks ??= readAll(dir, "ingest", "import")
        .filter((a) => a.payload.kind === "tracker-readback")
        .flatMap((a) => a.payload.records.map((r) => r.trusted));
      return readbacks.some((t) => t.finding_id === threat_id && t.url === url && t.body_contains_finding_id === true);
    },
    row(id) {
      if (rows === undefined) {
        const snapshot = readOptional(dir, REGISTER_SNAPSHOT_FILE, "register-snapshot", "register-events");
        if (snapshot === null) rows = null;
        else {
          try {
            rows = replay(snapshot.payload.events, snapshot.payload.engagement_id).rows;
          } catch (err) {
            throw integrityFailure(inconsistent("register-events"), err);
          }
        }
      }
      if (rows === null) return undefined;
      const row = rows[id];
      return row === undefined ? null : { subject: row.subject, status: row.status };
    },
    mitigationState(id) {
      states ??= mitigationStatesOf(dir);
      return states[id];
    },
  };
}

// --- subcommands ----------------------------------------------------------------------

export const check = {
  async run(argv, ctx) {
    const command = "check";
    const { flags, positionals } = parseCommandArgv(command, argv, { run: "value", model: "value" });
    if (positionals.length) throw usageError(command, `unexpected argument ${positionals[0]}`);
    const run_id = requireRun(command, flags);
    const modelPath = typeof flags.model === "string" ? flags.model : join(ctx.st, SNAPSHOT_FILE);

    const { dir, run } = openRun(ctx, command, run_id);
    const scopePath = join(dir, "scope.json");
    if (!existsSync(scopePath)) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
    const scope = readArtifact(scopePath, { kind: "scope" }); // 5 on a tampered scope.json

    const model = redactDeep(readModel(ctx, command, modelPath), DEFAULT_RULES);
    const structural = lintStructure(model, scope);
    if (structural !== null) {
      ctx.out(tmInvalid(structural.locus, structural.reason));
      return EXIT.FAIL;
    }

    const snapshot = persist(ctx, dir, run, "threat-model", SNAPSHOT_FILE, "threat-model", model, () => {
      ctx.log(`${command}: ${ctx.rel(join(dir, SNAPSHOT_FILE))} already holds a different model; a run's snapshot is write-once — start a new run`);
      return new CliError(EXIT.USAGE, SNAPSHOT_EXISTS);
    });

    const { error, dispositions } = lintDispositions(model, evidenceOf(dir));
    if (error !== null) {
      ctx.out(tmInvalid(error.locus, error.reason));
      ctx.wrote(snapshot.path, snapshot.written);
      return EXIT.FAIL;
    }
    const index = persist(ctx, dir, run, "dispositions", DISPOSITIONS_FILE, "dispositions", { dispositions }, (existing) => integrityFailure(inconsistent("dispositions"), new Error(`${ctx.rel(join(dir, DISPOSITIONS_FILE))} is ${existing.envelope.self_sha256}, the model derives ${artifactId({ dispositions })}`)));

    ctx.out(tmLine(modelCounts(model)));
    ctx.wrote(snapshot.path, snapshot.written);
    ctx.wrote(index.path, index.written);
    return EXIT.OK;
  },
};

export const render = {
  async run(argv, ctx) {
    const command = "render";
    const { flags, positionals } = parseCommandArgv(command, argv, { run: "value" });
    if (positionals.length) throw usageError(command, `unexpected argument ${positionals[0]}`);
    const run_id = requireRun(command, flags);
    const { dir } = openRun(ctx, command, run_id);

    const snapshotPath = join(dir, SNAPSHOT_FILE);
    if (!existsSync(snapshotPath)) throw new CliError(EXIT.INDETERMINATE, incomplete("threat-model"));
    const model = readArtifact(snapshotPath, { kind: "threat-model" }).payload;
    const indexPath = join(dir, DISPOSITIONS_FILE);
    if (!existsSync(indexPath)) throw new CliError(EXIT.INDETERMINATE, incomplete("dispositions"));
    const { dispositions } = readArtifact(indexPath, { kind: "dispositions" }).payload;

    const markdown = redactString(renderThreatModel({ run_id, model, dispositions, mitigation_states: mitigationStatesOf(dir) })).text;
    const viewPath = join(dir, VIEW_FILE);
    try {
      writeExclusive(viewPath, markdown);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (readFileSync(viewPath, "utf8") !== markdown) {
        ctx.log(`${command}: ${ctx.rel(viewPath)} already holds a different view (the derived states moved since); the run's view is write-once — the report is build-report --template threat-model`);
        throw new CliError(EXIT.USAGE, RENDER_EXISTS);
      }
    }
    const counts = modelCounts(model);
    ctx.out(tmRendered({ relPath: ctx.rel(viewPath), elements: counts.elements, threats: counts.threats }));
    return EXIT.OK;
  },
};

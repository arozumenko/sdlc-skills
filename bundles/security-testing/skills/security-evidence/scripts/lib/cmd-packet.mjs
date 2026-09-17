// lib/cmd-packet.mjs — `evidence.mjs packet --run <id> --kind scope` (TASK-057;
// plan §4.1 row `packet`, §5 TASK-057; spec §6.4 P1, §6.1 `packet.json`,
// TL-15; US-015 AC-1, US-028 AC-3) and `--kind subject --subject <id>…
// [--type <t>]` (TASK-021; plan §5 TASK-021; spec §6.4 P1 "subject packet";
// US-015 AC-1).
//
// The SCOPE packet is the `review` contract's input: built from scope.json
// before `gate`, before any finding id exists, it lists every scope file with
// its whole admitted range and binds the bytes at the recorded side with the
// engagement key. Its `packet_sha256` is what `claims-*.json` and
// `examined-*.json` must name (TL-15); `gate --claims` / `coverage
// --examined` re-verify that against `<run>/packets/`.
//
// The SUBJECT packet is the input of the `vulnerability-review` and
// `mitigation-review` contracts (and, built by `verify all` over its
// worktree, `fix-review`): the exact ranges a fresh reviewer may read for the
// named subjects, nothing else. `subject_ids` is the given ids in argv order
// (a repeated id is dropped); `files[]` is every cited range grouped by
// (path, side) — for a finding, its primary range plus every
// `citations_typed[]` range, each at the side gate admitted it at (a typed
// citation carries its own side and may name another scope file: the
// reviewer of a data-flow finding needs the source and the sink, so they are
// in the packet rather than residual exposure); for a mitigation, its one
// `citation`. `--type` selects the SOURCE the ids are looked up in — it is
// not in the payload (packet.schema.json is closed; a receipt's `type` is
// the reviewer's word, and `receipt validate` checks `subject_id ∈
// subject_ids`):
//
//   vulnerability-review  <run>/gate-result.json + findings.claimed.json —
//                         the default for a 64-hex id; an id in
//                         `unverifiable[]` ⇒ 2 UNVERIFIABLE-SUBJECT(<id>)
//                         (a CITATION_FAILED finding has nothing a reviewer
//                         can confirm), any other id not in `accepted[]` ⇒
//                         2 USAGE(unknown subject); gate not run ⇒ 3
//                         INCOMPLETE(gate-result); `claimed_sha256` not the
//                         claimed artifact on disk, or an accepted id with
//                         no finding ⇒ 5 INCONSISTENT(gate-result)
//   mitigation-review     <run>/threat-model.json (the snapshot `tm-lint
//                         check` writes, M2) — the default for an `M-nnn`
//                         id; absent ⇒ 3 INCOMPLETE(threat-model); off-schema
//                         ⇒ 5 INCONSISTENT(threat-model); unknown id ⇒ 2
//                         USAGE; a mitigation without `citation` ⇒ 2 USAGE
//                         (nothing to review)
//   fix-review            SEAM for TASK-027: `verify all` builds this packet
//                         in-process from its worktree (`citedFiles` below
//                         gives the ranges; the worktree supplies bytes and
//                         oids). From the CLI ⇒ 2 USAGE — a run directory
//                         has no worktree to hash.
//   case                  TASK-042 (M3): `--subject` is the repo-relative
//                         PATH of a candidate case (`<st>/cases/<slug>/
//                         TC-NNN_<slug>.md`, committed); the packet lists the
//                         file at `head` (whole normalised range, the blob's
//                         oid) and its subject id is `case_sha256` =
//                         sha256 over the redacted text of that blob
//                         (admission-core.caseSha256 — the identity `plan
//                         admit` records and `ingest case` imports under).
//                         The path must name a blob in the tree at
//                         `head_oid` ⇒ 2 USAGE otherwise (commit the case,
//                         start a run at that head); two paths with the same
//                         identity ⇒ 2 USAGE. `--type case` is required (a
//                         path is neither id shape). The receipt this packet
//                         asks for is a `vulnerability-review` whose
//                         `confirmed` means "confirmed passive" (spec §9.1).
//
// Without `--type`, every id must be of one shape (all 64-hex or all
// `M-nnn`) — one packet, one contract; a mix ⇒ 2 USAGE. The oid per file is
// the scope file's for `head` / `snapshot` (what gate admitted against) and
// the base blob's (`git rev-parse <base_oid>:<path>`) for `base`, exactly
// what `receipt validate` (TASK-022) re-checks.
//
// Order (so a refusal leaves nothing behind):
//
//   1. argv: `--run` (shape), `--kind scope|subject`; scope refuses
//      `--subject` / `--type` (2 USAGE); subject requires ≥ 1 non-empty
//      `--subject` and validates `--type` (2 USAGE);
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE); `COMMITTED` present ⇒ 2
//      RUN-COMMITTED (G-10); `scope.json` absent ⇒ 3 INCOMPLETE(scope) (every
//      packet is derived from it); the run's key by the envelope's `key_id`
//      ⇒ 2 `KEY: unavailable` when its file is gone (no HMAC, no identity);
//   3. the policy: `references/packet-policy.v1.json` (packet-core
//      POLICY_PATH) or `--policy <file>` (a user-typed path: ctx.input keeps
//      it inside the work tree, 2 USAGE otherwise; off-schema ⇒ 2
//      SCHEMA-INVALID(packet-policy.v1: …));
//   4. subject resolution per the table above — every id checked before any
//      byte is hashed; scope: files = every `scope.files[]` entry with
//      `ranges = scope.ranges[path]` (`[]` for an empty file);
//   5. `packet-core.buildPacket` with `lib/cite.mjs resolveSide` bound to
//      the run and scope — `head`/`base` bytes from `git cat-file` at the
//      recorded oid, `snapshot` bytes from the private redacted snapshot
//      after its sha256 is re-verified;
//   6. `<run>/packets/<packet_sha256>.json`, write-once. The file is named
//      by its identity, so a re-run on the same inputs produces the same
//      name: an existing file that verifies to that identity is the same
//      artifact and the command succeeds idempotently (nothing rewritten,
//      G-10); an existing file that does not ⇒ 5 INCONSISTENT(packets/<sha>).
//
// Resolution failures (lib/cite.mjs): a snapshot whose bytes no longer match
// `scope.snapshot[path].redacted_sha256` ⇒ 5 INCONSISTENT(snapshot:<path>);
// a snapshot the scope recorded but that is gone from disk ⇒ 3
// INCOMPLETE(snapshot:<path>); a blob missing at the recorded oid ⇒ 5
// INCONSISTENT(<side>:<path>). The error's message is never echoed (G-4).
//
// stdout: `PACKET <path> sha256=<h> kind=<k> files=<n>` then `WROTE <path>
// sha256=<h>` — the same sha, the packet's identity. Exit 0; 2 USAGE /
// RUN-COMMITTED / KEY: unavailable / SCHEMA-INVALID / UNVERIFIABLE-SUBJECT;
// 3 INCOMPLETE(…); 5 INCONSISTENT(…) or when run.json /
// scope.json / gate-result.json / findings.claimed.json / threat-model.json
// is not the artifact it claims to be (readArtifact).
//
// Imports: node:fs (existsSync, readFileSync — every write is
// canon.writeArtifact), node:path, ../canon.mjs, ../normalize.mjs (the case
// file's normalised line count), ../redact.mjs (redactDeep: the payload is
// redacted in-process before it is named, so the identity is over what
// leaves memory, G-4), ./admission-core.mjs (caseSha256), ./argv.mjs,
// ./cite.mjs (the one resolver, G-6: git runs only inside git.mjs),
// ./exit.mjs, ./git.mjs (blobOid, for the base oid a `base` citation names
// and the case blob at head), ./ledger.mjs (RUN_ID), ./packet-core.mjs,
// ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs. No network (G-14),
// no clock (G-1: created_at is ctx.now()).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, artifactId, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { normalizeText } from "../normalize.mjs";
import { DEFAULT_RULES, redactDeep } from "../redact.mjs";
import { caseSha256 } from "./admission-core.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { ObjectMissing, SIDES, SnapshotMismatch, SnapshotMissing, resolveSide } from "./cite.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { blobOid } from "./git.mjs";
import { RUN_ID } from "./ledger.mjs";
import { PACKET_KINDS, POLICY_PATH, buildPacket } from "./packet-core.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { COMMITTED, KEY_UNAVAILABLE, RUN_COMMITTED, incomplete, inconsistent, packetLine, schemaInvalid, unverifiableSubject } from "./tokens.mjs";

const COMMAND = "packet";
const POLICY_SCHEMA = "packet-policy.v1";
/** `--type` vocabulary for `--kind subject` (plan §4.1): which source the subject ids are resolved in. */
export const SUBJECT_TYPES = Object.freeze(["vulnerability-review", "mitigation-review", "fix-review", "case"]);
const FINDING_ID = /^[0-9a-f]{64}$/;
/** threat-model.schema.json `Mitigation.id`. */
const MITIGATION_ID = /^M-[0-9]{3}$/;

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", kind: "value", subject: "list", type: "value", policy: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const run_id = flags.run;
  if (run_id === undefined) throw usageError(COMMAND, "--run is required");
  if (!RUN_ID.test(run_id)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${run_id}`);
  const kind = flags.kind;
  if (kind === undefined) throw usageError(COMMAND, `--kind ${PACKET_KINDS.join("|")} is required`);
  if (!PACKET_KINDS.includes(kind)) throw usageError(COMMAND, `--kind must be one of ${PACKET_KINDS.join("|")}, got ${kind}`);
  if (kind === "scope") {
    if (flags.subject !== undefined) throw usageError(COMMAND, "--subject is not accepted with --kind scope (a scope packet has no subjects)");
    if (flags.type !== undefined) throw usageError(COMMAND, "--type is not accepted with --kind scope");
  } else {
    if (flags.subject === undefined) throw usageError(COMMAND, "--subject <id> is required with --kind subject");
    if (flags.subject.some((s) => s === "")) throw usageError(COMMAND, "--subject must not be empty");
    if (flags.type !== undefined && !SUBJECT_TYPES.includes(flags.type)) throw usageError(COMMAND, `--type must be one of ${SUBJECT_TYPES.join("|")}, got ${flags.type}`);
  }
  // argv order, first occurrence wins (plan §5 TASK-021: "the given ids in argv order (deduplicated)")
  const subjects = [...new Set(flags.subject ?? [])];
  return { run_id, kind, subjects, type: flags.type, policyPath: flags.policy };
}

// --- inputs -------------------------------------------------------------------------

/** The run's artifacts and key; every refusal here is a token, nothing is written. */
function loadRun(ctx, run_id) {
  const dir = runDir(ctx, run_id);
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.USAGE, RUN_COMMITTED);
  const scopePath = join(dir, "scope.json");
  if (!existsSync(scopePath)) throw new CliError(EXIT.INDETERMINATE, incomplete("scope"));
  const run = readArtifact(runPath, { kind: "run" }); // 5 on a tampered run.json
  const key = ctx.keyById(run.envelope.key_id);
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);
  const scope = readArtifact(scopePath, { kind: "scope" }); // 5 on a tampered scope.json
  return { dir, run, key, scope };
}

/**
 * The packet policy: the shipped file, or `--policy <file>` from inside the
 * work tree. A user file that is not strict JSON or is off-schema is
 * `SCHEMA-INVALID(packet-policy.v1: …)` (exit 2); the shipped file failing
 * the same checks is an install defect (an Error, exit 1).
 */
function loadPolicy(ctx, policyPath) {
  const user = policyPath !== undefined;
  const abs = user ? ctx.input(COMMAND, policyPath) : POLICY_PATH;
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    if (user && (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR")) throw usageError(COMMAND, `cannot read ${policyPath}`);
    throw err;
  }
  let policy;
  try {
    policy = parseStrict(bytes);
  } catch (err) {
    if (user && err instanceof CanonError) throw new CliError(EXIT.USAGE, schemaInvalid(POLICY_SCHEMA, err.message), { cause: err });
    throw err;
  }
  const errors = validate(POLICY_SCHEMA, policy);
  if (errors.length > 0) {
    if (user) throw new CliError(EXIT.USAGE, schemaInvalid(POLICY_SCHEMA, errors[0]));
    throw new Error(`${COMMAND}: the shipped ${POLICY_SCHEMA} file is off-schema: ${errors[0]}`);
  }
  return policy;
}

// --- subject resolution -------------------------------------------------------------

/** UTF-8 byte order — the order packet-core sorts files in. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function requireCitation(c, at) {
  if (c === null || typeof c !== "object" || typeof c.path !== "string" || c.path === "") throw new TypeError(`citedFiles: ${at} has no path`);
  if (!SIDES.includes(c.side)) throw new TypeError(`citedFiles: ${at}.side must be one of ${SIDES.join("|")}`);
  if (!Array.isArray(c.lines) || c.lines.length !== 2 || !c.lines.every(Number.isSafeInteger)) throw new TypeError(`citedFiles: ${at}.lines must be [start, end]`);
  return { path: c.path, side: c.side, lines: [c.lines[0], c.lines[1]] };
}

/**
 * The ranges a set of gated findings cite, grouped by (path, side): each
 * finding's primary `{path, side, lines}` plus every `citations_typed[]`
 * entry at its own side. Pure; oids are the caller's (the scope file's or
 * the base blob's here; the worktree's in `verify all`, TASK-027 — this is
 * the seam the fix-review packet is built on). Entries sorted by (path in
 * UTF-8 byte order, side); ranges by (start, end), exact duplicates dropped —
 * the same canonical order packet-core applies, so the result reads as the
 * packet will. Inputs are never mutated.
 * @param {object[]} findings finding.schema.json Findings (or anything with path, side, lines, citations_typed?)
 * @returns {{path: string, side: string, ranges: number[][]}[]}
 */
export function citedFiles(findings) {
  if (!Array.isArray(findings)) throw new TypeError("citedFiles: findings must be an array");
  const groups = new Map();
  const add = ({ path, side, lines }) => {
    const k = `${side}\0${path}`;
    if (!groups.has(k)) groups.set(k, { path, side, ranges: [] });
    groups.get(k).ranges.push(lines);
  };
  findings.forEach((f, i) => {
    add(requireCitation(f, `findings[${i}]`));
    const typed = Array.isArray(f?.citations_typed) ? f.citations_typed : [];
    typed.forEach((t, j) => add(requireCitation(t, `findings[${i}].citations_typed[${j}]`)));
  });
  return [...groups.values()]
    .sort((a, b) => compareBytes(a.path, b.path) || SIDES.indexOf(a.side) - SIDES.indexOf(b.side))
    .map((g) => {
      const sorted = [...g.ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const ranges = sorted.filter((r, i) => i === 0 || r[0] !== sorted[i - 1][0] || r[1] !== sorted[i - 1][1]);
      return { path: g.path, side: g.side, ranges };
    });
}

/** Read one of the run's own artifacts: absent ⇒ 3 INCOMPLETE(<name>), tampered ⇒ 5 (readArtifact). */
function readRunArtifact(dir, file, kind, name) {
  const path = join(dir, file);
  if (!existsSync(path)) throw new CliError(EXIT.INDETERMINATE, incomplete(name));
  return readArtifact(path, { kind });
}

/**
 * The oid packet-core records for a cited file: the scope file's (blob oid
 * at head, or the snapshot's redacted_sha256) for head|snapshot, the base
 * blob's for base. A cited file the scope does not list, or a base blob
 * that is gone, is the run's own state gone wrong (gate admitted it): 5.
 */
function oidFor(ctx, { run, scope }, { path, side }) {
  if (side === "base") {
    const oid = blobOid(ctx.root, run.payload.base_oid, path);
    if (oid === null) throw integrityFailure(inconsistent(`base:${path}`));
    return oid;
  }
  const file = scope.payload.files.find((f) => f.path === path && f.side === side);
  if (file === undefined) throw integrityFailure(inconsistent(`scope:${path}`));
  return file.oid;
}

/** Findings (`vulnerability-review`): ids looked up in gate-result, files from findings.claimed.json. */
function resolveFindings(ctx, inputs, subjects) {
  const { dir } = inputs;
  const gateResult = readRunArtifact(dir, "gate-result.json", "gate-result", "gate-result");
  const claimed = readRunArtifact(dir, "findings.claimed.json", "claimed", "gate-result");
  if (gateResult.payload.claimed_sha256 !== claimed.envelope.self_sha256) throw integrityFailure(inconsistent("gate-result"));
  const { accepted, unverifiable } = gateResult.payload;
  const findings = subjects.map((id) => {
    if (unverifiable.includes(id)) throw new CliError(EXIT.USAGE, unverifiableSubject(id));
    if (!accepted.includes(id)) throw usageError(COMMAND, `unknown subject ${id}`);
    const finding = claimed.payload.findings.find((f) => f.id === id);
    if (finding === undefined) throw integrityFailure(inconsistent("gate-result"));
    return finding;
  });
  return citedFiles(findings).map((f) => ({ ...f, oid: oidFor(ctx, inputs, f) }));
}

/** Mitigations (`mitigation-review`): ids looked up in the run's threat-model snapshot, one file per mitigation citation. */
function resolveMitigations(ctx, inputs, subjects) {
  const model = readRunArtifact(inputs.dir, "threat-model.json", "threat-model", "threat-model");
  if (validate("threat-model", model.payload).length > 0) throw integrityFailure(inconsistent("threat-model"));
  const mitigations = model.payload.threats.flatMap((t) => t.mitigations);
  const cited = subjects.map((id) => {
    const m = mitigations.find((x) => x.id === id);
    if (m === undefined) throw usageError(COMMAND, `unknown subject ${id}`);
    if (m.citation === undefined) throw usageError(COMMAND, `subject ${id} has no citation to review`);
    return { path: m.citation.path, side: m.citation.side, lines: m.citation.lines };
  });
  return citedFiles(cited).map((f) => ({ ...f, oid: oidFor(ctx, inputs, f) }));
}

/** A candidate case path as the packet may spell it: repo-relative posix, no `..`, no leading `/`, no `.`/empty segment, no backslash, no NUL (the shape cite.resolveSide requires — a user-typed value, so a usage error, not a TypeError). */
function isCasePath(path) {
  if (typeof path !== "string" || path === "" || path.includes("\0") || path.includes("\\") || path.startsWith("/")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * Cases (`case`, TASK-042): each subject is the repo-relative path of a
 * committed candidate case; the file at `head` is the packet's one entry
 * per case (whole normalised range, blob oid) and the subject id is the
 * case identity over that blob's redacted text. Returns `{subject_ids,
 * files}` — the ids replace the paths given in argv.
 */
function resolveCases(ctx, { run, scope }, subjects) {
  const { head_oid } = run.payload;
  const byId = new Map();
  const files = [];
  for (const path of subjects) {
    if (!isCasePath(path)) throw usageError(COMMAND, `--subject ${path} is not a repo-relative case path (--type case takes the path of a committed candidate case)`);
    const oid = blobOid(ctx.root, head_oid, path);
    if (oid === null) throw usageError(COMMAND, `case ${path} is not in the tree at head ${head_oid.slice(0, 12)} (commit the case and start a run at that head)`);
    const bytes = resolveSide(ctx, run, scope, { path, side: "head" });
    const { case_sha256 } = caseSha256(bytes);
    if (byId.has(case_sha256)) throw usageError(COMMAND, `cases ${byId.get(case_sha256)} and ${path} have the same identity (one case, one subject)`);
    byId.set(case_sha256, path);
    const lines = normalizeText(bytes).lines.length;
    files.push({ path, side: "head", oid, ranges: lines > 0 ? [[1, lines]] : [] });
  }
  return { subject_ids: [...byId.keys()], files };
}

/**
 * One resolver per `--type`: `(ctx, inputs, subjects) → files` (or
 * `{subject_ids, files}` when the source derives the ids, as `case` does)
 * for packet-core, or a refusal. `fix-review` is the documented seam
 * (header): TASK-027 builds the fix-review packet in-process over its
 * worktree.
 */
const SUBJECT_SOURCES = Object.freeze({
  "vulnerability-review": resolveFindings,
  "mitigation-review": resolveMitigations,
  "fix-review": () => {
    throw usageError(COMMAND, "--type fix-review packets are built by verify all over its worktree, not from a run directory");
  },
  case: resolveCases,
});

/** Without `--type`: the shape of the ids picks the source, and every id must share it (one packet, one contract). */
function inferType(subjects) {
  const shapes = new Set(subjects.map((id) => (FINDING_ID.test(id) ? "vulnerability-review" : MITIGATION_ID.test(id) ? "mitigation-review" : null)));
  if (shapes.size > 1) throw usageError(COMMAND, "--subject ids name subjects of more than one kind (findings and mitigations); one packet, one contract — pass --type to say which");
  const [shape] = shapes;
  if (shape === null) throw usageError(COMMAND, `unknown subject ${subjects.find((id) => !FINDING_ID.test(id) && !MITIGATION_ID.test(id))}`);
  return shape;
}

// --- build + write ------------------------------------------------------------------

/** `scope.files[]` as packet-core file entries: whole admitted ranges at the recorded side. */
function scopeFiles(scope) {
  const { files, ranges } = scope.payload;
  return files.map((f) => ({ path: f.path, side: f.side, oid: f.oid, ranges: Object.hasOwn(ranges, f.path) ? ranges[f.path] : [] }));
}

/** buildPacket with lib/cite.mjs resolution; the three cite errors become tokens, their messages never printed (G-4). */
function build(ctx, { run, scope, key, policy }, { kind, subject_ids, files }) {
  try {
    return buildPacket({ kind, subject_ids, files, key: key.bytes, policy, resolveSide: ({ path, side }) => resolveSide(ctx, run, scope, { path, side }) });
  } catch (err) {
    if (err instanceof SnapshotMismatch) throw integrityFailure(inconsistent(`snapshot:${err.path}`), err);
    if (err instanceof SnapshotMissing) throw new CliError(EXIT.INDETERMINATE, incomplete(`snapshot:${err.path}`), { cause: err });
    if (err instanceof ObjectMissing) throw integrityFailure(inconsistent(`${err.side}:${err.path}`), err);
    throw err;
  }
}

/**
 * Write `<run>/packets/<packet_sha256>.json` write-once. The name is the
 * identity, so a file already there is either this packet (idempotent
 * success) or a tampered one (5 INCONSISTENT(packets/<sha>)).
 * @returns {{path: string, written: {envelope: object, payload: object}, existed: boolean}}
 */
function persist(ctx, dir, run, key, payload) {
  const packet_sha256 = artifactId(payload);
  const path = join(dir, "packets", `${packet_sha256}.json`);
  const { schema_version, engagement_id } = run.envelope;
  const artifact = makeEnvelope({ schema_version, kind: "packet", run_id: run.envelope.run_id, engagement_id, key_id: key.key_id, now: ctx.now }, payload);
  try {
    return { path, written: writeArtifact(path, artifact, { prered: true, exclusive: true }), existed: false };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let existing;
    try {
      existing = readArtifact(path, { kind: "packet" });
    } catch (readErr) {
      if (readErr instanceof IntegrityError || readErr instanceof CanonError) throw integrityFailure(inconsistent(`packets/${packet_sha256}`), readErr);
      throw readErr;
    }
    if (existing.envelope.self_sha256 !== packet_sha256) throw integrityFailure(inconsistent(`packets/${packet_sha256}`));
    return { path, written: existing, existed: true };
  }
}

/**
 * @param {string[]} argv after `packet`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const inputs = loadRun(ctx, args.run_id);
  const policy = loadPolicy(ctx, args.policyPath);

  let spec;
  if (args.kind === "subject") {
    const type = args.type ?? inferType(args.subjects);
    const resolved = SUBJECT_SOURCES[type](ctx, inputs, args.subjects);
    spec = Array.isArray(resolved) ? { kind: "subject", subject_ids: args.subjects, files: resolved } : { kind: "subject", subject_ids: resolved.subject_ids, files: resolved.files };
  } else {
    spec = { kind: "scope", subject_ids: [], files: scopeFiles(inputs.scope) };
  }

  const raw = build(ctx, { ...inputs, policy }, spec);
  // Redacted before it is named (G-4): the identity and the file name are over what leaves memory.
  const payload = redactDeep(raw, DEFAULT_RULES);
  const errors = validate("packet", payload);
  if (errors.length > 0) throw new Error(`${COMMAND}: packet payload is off-schema: ${errors[0]}`);

  const { path, written, existed } = persist(ctx, inputs.dir, inputs.run, inputs.key, payload);
  if (existed) ctx.log(`${COMMAND}: ${ctx.rel(path)} already present with this identity; nothing rewritten`);
  ctx.out(packetLine({ relPath: ctx.rel(path), sha256: written.envelope.self_sha256, kind: payload.kind, files: payload.files.length }));
  ctx.wrote(path, written);
  return EXIT.OK;
}

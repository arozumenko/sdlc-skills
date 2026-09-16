// lib/cmd-check.mjs — `evidence.mjs check <run dir | manifest.json>
// [--integrity] [--drift] [--trusted-digest <sha256>]` (TASK-025; plan §4.1
// row `check`, §5 TASK-025, TL-7; spec §2 rows 1–2 "consistency and
// re-derivation", "integrity against the recorded snapshot and drift against
// the current tree", §6.2 sides, §6.3 derivation table + result lines, §6.5
// replay; US-017, US-005 AC-4, US-009 AC-5; G-9, G-16). Reads only; writes
// nothing; never prints a resolver's message (G-4).
//
// Four lines, in this order (plan §4.1):
//
//   1. CONSISTENT | CONSISTENT-REDACTED-ONLY(n citations) | INCONSISTENT(<field>) | STRUCTURE-ONLY
//   2. CURRENT | CITATION-DRIFTED(n) | SCOPE-DRIFTED(n files)      (only with --drift, only for a consistent set)
//   3. ORIGIN: unauthenticated | ORIGIN: matches supplied digest
//   4. KEY: available | KEY: unavailable
//
// Exit 0 for CONSISTENT / REDACTED-ONLY / STRUCTURE-ONLY whatever the drift
// line says; 5 for INCONSISTENT; 3 INCOMPLETE(COMMITTED) for a run that
// build-report never closed; 2 USAGE for a path that is not a run directory
// or manifest.json under <st>/runs/. `checkRun(ctx, runDir, opts)` is the
// programmatic entry `sign-off` (TASK-033) calls in-process; `run()` is the
// argv wrapper.
//
// The recompute (line 1), in this order — a recomputed-artifact mismatch is
// named before any byte comparison (TL-7):
//
//   a. `COMMITTED` present (else 3), `run.json` read (5 INCONSISTENT(run.json)),
//      `manifest.json` read as a manifest of this run (INCONSISTENT(manifest.json)),
//      `report.md` present, the marker one sha256 + LF (INCONSISTENT(COMMITTED));
//   b. the manifest's `template` is the run's kind, its `template_version`
//      the shipped template's and its `tool_version` version.json's ⇒ else
//      INCONSISTENT(manifest:<key>) — named first so a tool upgrade reads
//      as what it is, not as a render difference;
//   c. inputs.closeOver over the template's closed list (TL-3: the run dir
//      and its ledger dir are the only roots): a missing input or reference
//      ⇒ INCONSISTENT(input:<name>) (after COMMITTED, absence is a change),
//      a file that is not the artifact it claims to be ⇒ INCONSISTENT(<file>);
//      every recomputed input hash must equal the manifest's ⇒ else
//      INCONSISTENT(input:<kind>); every import record a coverage scanner
//      row or an unlocated candidate names must be present under ingest/
//      (PM log after G12) ⇒ else INCONSISTENT(import:<sha>);
//   d. an assessment run's scope carries no snapshot and no snapshot-side
//      citation (D18: assessment scope is a clean tree) ⇒ else
//      INCONSISTENT(snapshot) — which is why CONSISTENT-REDACTED-ONLY can
//      only ever be printed for a review run;
//   e. render.buildView over the closure with the run's key (or null) and
//      every key_id the closure names (render.keyIdsOf + ctx.keyById, exactly
//      as build-report does — PM log after G14): gate-core ids, coverage,
//      applyReceipts, evaluate over verify.json and every verify snapshot,
//      register replay over the events snapshot ⇒ InconsistentInput.field
//      names the artifact (gate-result | coverage | verify | register-events
//      | dispositions);
//   f. render.renderMarkdown and a byte comparison with report.md: the first
//      differing line names the field through its `<!-- v:<path> -->` marker
//      (TL-7); a line inside a four-space-indented evidence block carries
//      no marker of ours (code mode keeps HTML comments — PM log after G12),
//      so it names `report.md`; without the run's key the recomputed view
//      says `key: unavailable` and lists the un-derived identities, so the
//      lines marked `key` and `limitations[n]` are excluded from the
//      comparison (they are what the key changes) and the verdict is
//      STRUCTURE-ONLY, never CONSISTENT;
//   g. the recomputed manifest identity — artifactId({inputs, report_sha256,
//      template, template_version, tool_version}) over the recomputed
//      hashes and the recomputed report (the recorded report's bytes under
//      STRUCTURE-ONLY, whose non-key lines were just compared) — must be
//      the sidecar's (INCONSISTENT(manifest.json)) and the marker's
//      (INCONSISTENT(COMMITTED)). ORIGIN compares --trusted-digest to THIS
//      value (spec §2 / §6.3), never to the sidecar, and only for a
//      consistent set.
//
// --integrity (spec §2 row 2, §6.2, §6.5), with the key — without it every
// content check is skipped and line 1 is STRUCTURE-ONLY:
//
//   receipts   every `<run>/receipts/*` names this run as `reviewer_run_id`,
//              or — for a verify run — a run of the same head (the run id's
//              12-hex prefix is head_oid[0:12], TL-9): `verify all` admits a
//              pass-1 receipt into the pass-2 run (TL-6; PM log after G13),
//              and the other run's run.json is outside this run directory
//              (G-16), so the head prefix is the binding check can make
//              ⇒ else INCONSISTENT(receipts/<sha>);
//   citations  every finding's primary citation, resolved at its recorded
//              side through lib/cite.mjs (memoised per side+path): the range
//              lies inside the file; a PLAIN finding's `snippet` compared
//              with the normalised source text decides `match`, which must
//              be its state, and `occurrence` must re-derive; the raw range
//              must match no redaction rule (or the id should have been
//              keyed, G-2); a SENSITIVE finding's private record
//              `private/citations/<run>/<id>.json` must exist and re-verify,
//              its `side` and `oid` must be the citation's, `match` its
//              state, and `source_hmac` must equal HMAC_key(normalised source
//              text at the side) re-derived with the record's key — for a
//              snapshot citation that source is the REDACTED snapshot, the
//              bytes the resolver returns (PM log after G7) — while
//              `claimed_hmac` is compared as recorded, never recomputed (the
//              claim was discarded) ⇒ else INCONSISTENT(citation:<id>);
//              a record absent or not the artifact it claims ⇒
//              INCONSISTENT(citations/<id>); a snapshot side additionally
//              compares the working file's HMAC with `original_hmac`: gone
//              or changed ⇒ that citation is REDACTED-ONLY (the redacted
//              snapshot matched; nothing can re-derive the original) and
//              line 1 is CONSISTENT-REDACTED-ONLY(n citations); a redacted
//              snapshot that no longer matches its recorded sha256 — or is
//              gone — ⇒ INCONSISTENT(snapshot:<path>), and the resolver's
//              message (which carries the actual hash) is never echoed;
//              a blob missing at base|head ⇒ INCONSISTENT(<side>:<path>);
//   packets    every `<run>/packets/*` file: `oid` is the blob at the run's
//              side (redacted_sha256 for snapshot) and `range_hmac` is
//              packet-core.rangeHmac over the bytes at that side with the
//              packet's key ⇒ else INCONSISTENT(packets/<sha>:<path>);
//              cross-run packets (verify snapshots) are checked by `check`
//              on their own run and enter here by identity only.
//
// --drift (spec §6.2 "check --drift uses the working tree for head/snapshot
// citations and skips base"): every primary and typed citation at head or
// snapshot is compared with the working tree — the normalised lines of the
// cited range at the recorded side against the same lines of the working
// file (redacted first for a snapshot citation, as scope redacted it) —
// absent, shorter, not text or different ⇒ drifted; base citations are
// skipped (deleted code has no current counterpart); every scope file is
// compared by HMAC_key(working bytes) with scope.json's `file_hmac` (the
// side bytes when the key is unavailable) ⇒ SCOPE-DRIFTED. The line names
// citation drift when there is any, else scope drift, else CURRENT; the
// structured result carries both counts. A side that cannot be resolved
// counts as drifted — `--integrity` is what names the cause.
//
// Every read is the run directory, its ledger directory, the shipped
// template + version.json + rule files, the key files, the run's own private
// records and snapshots, git objects (lib/git.mjs, G-6) and the working
// tree (G-16; cmd-check.test.mjs pins it with an fs spy).
//
// Imports: node:fs (existsSync, statSync — reads only; bytes come through
// inputs.pathGuard and canon.readArtifact), node:path, ../canon.mjs,
// ../normalize.mjs (EncodingError), ../redact.mjs,
// ./argv.mjs, ./cite.mjs, ./cmd-build-report.mjs (loadTemplate, the file
// names), ./exit.mjs, ./git.mjs (blobOid), ./inputs.mjs, ./ledger.mjs
// (RUN_ID), ./packet-core.mjs (rangeHmac), ./render.mjs, ./schema.mjs,
// ./tokens.mjs. No writes, no clock (G-1), no network (G-14).

import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CanonError, IntegrityError, artifactId, hmacHex, readArtifact, sha256Hex } from "../canon.mjs";
import { EncodingError } from "../normalize.mjs";
import { DEFAULT_RULES, matches, redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { ObjectMissing, SnapshotMismatch, SnapshotMissing, lineMap, occurrenceOf, rangeBytes, resolveSide, resolveWorking } from "./cite.mjs";
import { MANIFEST_FILE, REPORT_FILE, loadTemplate } from "./cmd-build-report.mjs";
import { CliError, EXIT, integrityFailure, isIntegrityFailure, usageError } from "./exit.mjs";
import { blobOid } from "./git.mjs";
import { closeOver, pathGuard } from "./inputs.mjs";
import { RUN_ID } from "./ledger.mjs";
import { rangeHmac } from "./packet-core.mjs";
import { InconsistentInput, buildView, keyIdsOf, renderMarkdown } from "./render.mjs";
import { validate } from "./schema.mjs";
import {
  CITATION_VERIFIED,
  COMMITTED,
  CONSISTENT,
  CURRENT,
  KEY_AVAILABLE,
  KEY_UNAVAILABLE,
  ORIGIN_MATCHES_SUPPLIED_DIGEST,
  ORIGIN_UNAUTHENTICATED,
  STRUCTURE_ONLY,
  citationDrifted,
  consistentRedactedOnly,
  incomplete,
  inconsistent,
  scopeDrifted,
} from "./tokens.mjs";

const COMMAND = "check";
const SHA256 = /^[0-9a-f]{64}$/;
const MARKER = /<!-- v:([A-Za-z0-9_.[\]-]+) -->/;
/** The view paths whose rendering depends on whether the key is present at render time (render.mjs `key`, `limitations`). */
const KEY_DEPENDENT = /^(key|limitations\[\d+\])$/;
const SECRET_CLASS = "secret";
const EMPTY_SCOPE = Object.freeze({ files: [], ranges: {}, skipped: [], snapshot: {} });

const utf8 = (s) => Buffer.from(s, "utf8");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// --- argv ---------------------------------------------------------------------------

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { integrity: "boolean", drift: "boolean", "trusted-digest": "value" });
  if (positionals.length === 0) throw usageError(COMMAND, "a run directory or manifest.json path is required");
  if (positionals.length > 1) throw usageError(COMMAND, `unexpected argument ${positionals[1]}`);
  const trustedDigest = flags["trusted-digest"] ?? null;
  if (trustedDigest !== null && !SHA256.test(trustedDigest)) throw usageError(COMMAND, `--trusted-digest must be 64 lowercase hex chars, got ${trustedDigest}`);
  return { target: positionals[0], integrity: flags.integrity === true, drift: flags.drift === true, trustedDigest };
}

/** `<st>/runs/<run_id>` from a user-typed run directory or manifest.json path (ctx.input: cwd-relative, inside the work tree). */
function resolveTarget(ctx, typed) {
  const abs = ctx.input(COMMAND, typed);
  // an existing directory is the run dir; a `manifest.json` names its directory; a path that is not there yet is judged by its name (⇒ unknown run below)
  const dir = existsSync(abs) && statSync(abs).isDirectory() ? abs : basename(abs) === MANIFEST_FILE ? dirname(abs) : abs;
  const runsDir = resolve(ctx.st, "runs");
  if (resolve(dirname(dir)) !== runsDir || !RUN_ID.test(basename(dir))) {
    throw usageError(COMMAND, `${typed} is not a run directory or manifest.json under ${ctx.rel(runsDir)}/`);
  }
  return dir;
}

// --- reading ------------------------------------------------------------------------

/** A CliError(5) or a Canon/Integrity error ⇒ the INCONSISTENT token it stands for; a CliError(3) from the closure ⇒ INCONSISTENT(input:<name>). */
function asInconsistent(err, fallbackField) {
  if (err instanceof CliError) {
    if (err.code === EXIT.INTEGRITY) return err.token;
    if (err.code === EXIT.INDETERMINATE) {
      const m = /^INCOMPLETE\((.+)\)$/.exec(err.token);
      if (m !== null) return inconsistent(`input:${m[1]}`);
    }
    throw err;
  }
  if (err instanceof InconsistentInput) return inconsistent(err.field);
  if (isIntegrityFailure(err)) return inconsistent(fallbackField);
  throw err;
}

/** readArtifact under a label: a file that is not the artifact it claims to be is 5 INCONSISTENT(<label>). */
function readVerified(path, kind, label) {
  try {
    return readArtifact(path, { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(label), err);
    throw err;
  }
}

/** The resolver-failure ⇒ token mapping (the message, which may carry a hash, never leaves this function). */
function sideFailure(err, side, path) {
  if (err instanceof SnapshotMismatch || err instanceof SnapshotMissing) return integrityFailure(inconsistent(`snapshot:${err.path}`), err);
  if (err instanceof ObjectMissing) return integrityFailure(inconsistent(`${err.side}:${err.path}`), err);
  if (err instanceof EncodingError) return integrityFailure(inconsistent(`${side}:${path}`), err);
  return err;
}

/**
 * The bytes and line map at a recorded side, memoised per (side, path) —
 * three git spawns per citation otherwise (PM log after G7). A failure is
 * memoised too, so one missing blob is reported once and never re-spawned.
 */
function makeResolver(ctx, run, scope) {
  const scopeForSide = scope === null ? EMPTY_SCOPE : (scope.payload ?? scope);
  const memo = new Map();
  const oids = new Map();
  return {
    at(side, path) {
      const k = `${side}\0${path}`;
      if (!memo.has(k)) {
        try {
          const bytes = resolveSide(ctx, run, scopeForSide, { path, side });
          memo.set(k, { bytes, map: lineMap(bytes) });
        } catch (err) {
          memo.set(k, { error: sideFailure(err, side, path) });
        }
      }
      const v = memo.get(k);
      if (v.error !== undefined) throw v.error;
      return v;
    },
    /** The blob oid at base|head, or the recorded redacted_sha256 for snapshot; null when nothing is there. */
    oid(side, path) {
      if (side === "snapshot") {
        const rec = scopeForSide.snapshot?.[path];
        return isObject(rec) ? rec.redacted_sha256 : null;
      }
      const k = `${side}\0${path}`;
      if (!oids.has(k)) oids.set(k, blobOid(ctx.root, run.payload[`${side}_oid`], path));
      return oids.get(k);
    },
  };
}

// --- line 1: the recompute ----------------------------------------------------------

/** Parse the four-space-indented and marker rules of TL-7 over one rendered line. */
function fieldOf(line) {
  if (line === undefined || line.startsWith("    ")) return REPORT_FILE;
  const m = MARKER.exec(line);
  return m === null ? REPORT_FILE : m[1];
}

const markerPath = (line) => (line.startsWith("    ") ? null : (MARKER.exec(line)?.[1] ?? null));

/**
 * The first field whose rendered line differs from the recorded report, or
 * null when the two agree. Under `structureOnly` the key-dependent lines are
 * left out of the comparison (see the header).
 */
function firstMismatch(rendered, recorded, { structureOnly }) {
  const keep = (l) => {
    const p = markerPath(l);
    return p === null || !KEY_DEPENDENT.test(p);
  };
  const a = structureOnly ? rendered.split("\n").filter(keep) : rendered.split("\n");
  const b = structureOnly ? recorded.split("\n").filter(keep) : recorded.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return fieldOf(a[i] ?? b[i]);
  return null;
}

/** Every import record the closure's coverage rows and unlocated candidates name must be present (PM log after G12: the review list has no `imports`). */
function checkImportRecords(guard, dir, artifacts) {
  const named = new Set();
  const coverage = artifacts.coverage;
  if (coverage !== undefined) for (const row of coverage.payload.scanner_rows) named.add(row.import_sha256);
  const unlocated = artifacts.unlocated;
  if (unlocated !== undefined) for (const c of unlocated.payload.candidates) if (isObject(c.locator) && typeof c.locator.import_sha256 === "string") named.add(c.locator.import_sha256);
  for (const sha of [...named].sort()) {
    const path = join(dir, "ingest", `${sha}.json`);
    if (!guard.exists(path)) throw integrityFailure(inconsistent(`import:${sha}`));
    const art = readVerified(guard.check(path), "import", `ingest/${sha}`);
    if (art.payload.import_sha256 !== sha) throw integrityFailure(inconsistent(`ingest/${sha}`));
  }
}

/** D18: an assessment run cites a clean tree at head — no snapshot anywhere (AC-8). */
function checkNoSnapshot(template, artifacts) {
  if (template !== "assessment") return;
  const scope = artifacts.scope;
  if (isObject(scope.payload.snapshot) && Object.keys(scope.payload.snapshot).length > 0) throw integrityFailure(inconsistent("snapshot"));
  if (scope.payload.files.some((f) => f.side === "snapshot")) throw integrityFailure(inconsistent("snapshot"));
  for (const f of artifacts.claimed.payload.findings) {
    if (f.side === "snapshot" || (Array.isArray(f.citations_typed) && f.citations_typed.some((c) => c.side === "snapshot"))) throw integrityFailure(inconsistent("snapshot"));
  }
}

/**
 * Steps a–g of the header. Returns the closure and the recomputed manifest
 * identity; throws a CliError(5) naming the first field that does not
 * follow from the run directory.
 */
function recompute(ctx, dir, { run, key }) {
  const run_id = run.envelope.run_id;
  const template = run.payload.template;
  const guard = pathGuard([dir]);
  // a. the three build outputs
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!guard.exists(manifestPath)) throw integrityFailure(inconsistent(MANIFEST_FILE));
  const manifest = readVerified(manifestPath, "manifest", MANIFEST_FILE);
  if (manifest.envelope.run_id !== run_id) throw integrityFailure(inconsistent(MANIFEST_FILE));
  const reportPath = join(dir, REPORT_FILE);
  if (!guard.exists(reportPath)) throw integrityFailure(inconsistent(REPORT_FILE));
  const reportBytes = guard.read(reportPath);
  const marker = guard.read(join(dir, COMMITTED)).toString("utf8");
  if (!/^[0-9a-f]{64}\n?$/.test(marker)) throw integrityFailure(inconsistent(COMMITTED));
  // b. template + tool versions
  const parsed = loadTemplate(template);
  const m = manifest.payload;
  if (m.template !== template) throw integrityFailure(inconsistent("manifest:template"));
  if (m.template_version !== parsed.template_version) throw integrityFailure(inconsistent("manifest:template_version"));
  const tool_version = ctx.toolVersion();
  if (m.tool_version !== tool_version) throw integrityFailure(inconsistent("manifest:tool_version"));
  // c. the closure and every input hash
  let inputs;
  try {
    inputs = closeOver(dir, template, { ledgerDir: join(ctx.st, "ledger", run_id) });
  } catch (err) {
    throw integrityFailure(asInconsistent(err, "run.json"), err);
  }
  const recorded = isObject(m.inputs) ? m.inputs : {};
  for (const kind of [...new Set([...Object.keys(recorded), ...Object.keys(inputs.hashes)])].sort()) {
    if (recorded[kind] !== inputs.hashes[kind]) throw integrityFailure(inconsistent(`input:${kind}`));
  }
  checkImportRecords(guard, dir, inputs.artifacts);
  // d. D18
  checkNoSnapshot(template, inputs.artifacts);
  // e. the derivations (spec §6.3 table)
  const keys = Object.fromEntries(
    keyIdsOf(inputs).map((id) => {
      const k = ctx.keyById(id);
      return [id, k === null ? null : k.bytes];
    }),
  );
  let view;
  try {
    view = buildView(inputs, { key: key === null ? null : key.bytes, keys, rules: DEFAULT_RULES, tool_version, template_version: parsed.template_version });
  } catch (err) {
    if (err instanceof InconsistentInput) throw integrityFailure(inconsistent(err.field), err);
    throw err;
  }
  // f. the bytes
  const structureOnly = key === null;
  const rendered = renderMarkdown(view, parsed);
  const field = firstMismatch(rendered, reportBytes.toString("utf8"), { structureOnly });
  if (field !== null) throw integrityFailure(inconsistent(field));
  // g. the manifest identity, recomputed
  const report_sha256 = structureOnly ? sha256Hex(reportBytes) : sha256Hex(utf8(rendered));
  const recomputedId = artifactId({ inputs: inputs.hashes, report_sha256, template, template_version: parsed.template_version, tool_version });
  if (manifest.envelope.self_sha256 !== recomputedId) throw integrityFailure(inconsistent(MANIFEST_FILE));
  if (marker.trim() !== recomputedId) throw integrityFailure(inconsistent(COMMITTED));
  return { inputs, recomputedId, structureOnly };
}

// --- --integrity --------------------------------------------------------------------

/** `reviewer_run_id` binding (see the header). */
function checkReceipts(run, template, receipts) {
  const run_id = run.envelope.run_id;
  for (const r of receipts) {
    const rid = r.payload.reviewer_run_id;
    const ok = rid === run_id || (template === "verify" && typeof rid === "string" && RUN_ID.test(rid) && rid.slice(0, 12) === run_id.slice(0, 12));
    if (!ok) throw integrityFailure(inconsistent(`receipts/${r.envelope.self_sha256}`));
  }
  return receipts.length;
}

/** The normalised source lines of a citation at its side (the range must lie inside the file). */
function sourceOf(resolver, { path, side, lines }, field) {
  const { bytes, map } = resolver.at(side, path);
  const [start, end] = lines;
  if (end > map.lines.length) throw integrityFailure(inconsistent(field));
  const sourceLines = map.lines.slice(start - 1, end);
  return { bytes, map, sourceLines, sourceText: sourceLines.join("\n"), start, end };
}

/**
 * One finding's primary citation against its recorded side (header
 * "--integrity › citations"). Returns "checked" | "redacted-only" | "skipped"
 * (a key the re-derivation needs is unavailable).
 */
function checkCitation(ctx, { run, scope, resolver, rules, scopeKey }, f) {
  const field = `citation:${f.id}`;
  const src = sourceOf(resolver, f, field);
  const verified = f.state === CITATION_VERIFIED;
  if (f.sensitive !== true) {
    // a plain finding: the stored snippet against the source text
    if (typeof f.snippet !== "string") throw integrityFailure(inconsistent(field));
    const raw = rangeBytes(src.bytes, src.start, src.end, src.map);
    if (f.class === SECRET_CLASS || matches(raw, rules) || matches(f.snippet, rules)) throw integrityFailure(inconsistent(field)); // a plain id over protected content (G-2)
    const match = f.snippet === src.sourceText;
    if (match !== verified) throw integrityFailure(inconsistent(field));
    const occurrence = match ? occurrenceOf(src.map.lines, src.sourceLines, src.start) : 0;
    if (occurrence !== f.occurrence) throw integrityFailure(inconsistent(field));
  } else {
    // a sensitive finding: the private record, compared — never the claim
    const recordPath = join(ctx.st, "private", "citations", run.envelope.run_id, `${f.id}.json`);
    if (!existsSync(recordPath)) throw integrityFailure(inconsistent(`citations/${f.id}`));
    const record = readVerified(recordPath, "citation-record", `citations/${f.id}`);
    if (validate("citation-record", record.payload).length > 0) throw integrityFailure(inconsistent(`citations/${f.id}`));
    const recKey = ctx.keyById(record.envelope.key_id);
    if (recKey === null) return "skipped";
    const p = record.payload;
    if (p.side !== f.side || p.match !== verified) throw integrityFailure(inconsistent(field));
    if (p.oid !== resolver.oid(f.side, f.path)) throw integrityFailure(inconsistent(field));
    if (p.source_hmac !== hmacHex(recKey.bytes, utf8(src.sourceText))) throw integrityFailure(inconsistent(field));
    if (verified && occurrenceOf(src.map.lines, src.sourceLines, src.start) !== f.occurrence) throw integrityFailure(inconsistent(field));
    if (!verified && f.occurrence !== 0) throw integrityFailure(inconsistent(field));
  }
  // a snapshot citation, plain or keyed: the redacted snapshot matched (the resolver checked); the original is re-derivable only while the working file still is it
  if (f.side === "snapshot") {
    if (scopeKey === null) return "skipped";
    const rec = scope.payload.snapshot?.[f.path];
    const working = resolveWorking(ctx, f.path);
    if (!isObject(rec) || working === null || hmacHex(scopeKey.bytes, working) !== rec.original_hmac) return "redacted-only";
  }
  return "checked";
}

/** One packet's files against the run's sides (header "--integrity › packets"). Returns the number of files checked, or -1 when the packet's key is unavailable. */
function checkPacket(resolver, keys, packet) {
  const key = keys[packet.envelope.key_id] ?? null;
  if (key === null) return -1;
  let n = 0;
  for (const file of packet.payload.files) {
    const field = `packets/${packet.envelope.self_sha256}:${file.path}`;
    const { bytes } = resolver.at(file.side, file.path); // a side that cannot be resolved names itself (<side>:<path>) before the oid is compared
    if (resolver.oid(file.side, file.path) !== file.oid) throw integrityFailure(inconsistent(field));
    let hmac;
    try {
      hmac = rangeHmac(key, bytes, file.ranges);
    } catch (err) {
      if (err instanceof RangeError) throw integrityFailure(inconsistent(field), err);
      throw err;
    }
    if (hmac !== file.range_hmac) throw integrityFailure(inconsistent(field));
    n++;
  }
  return n;
}

/**
 * Content re-validation with the key (header "--integrity"). Returns the
 * counts (written into `checked` as it goes, so a failure leaves the counts
 * reached) and whether every check could run.
 */
function checkIntegrity(ctx, { run, inputs, resolver }, checked) {
  const A = inputs.artifacts;
  const template = run.payload.template;
  const scope = A.scope ?? null;
  const rules = DEFAULT_RULES;
  checked.citations = checked.packets = checked.receipts = 0;
  let redactedOnly = 0;
  let skipped = 0;
  checked.receipts = checkReceipts(run, template, A.receipts ?? []);
  if (A.claimed !== undefined) {
    const scopeKey = scope === null ? null : ctx.keyById(scope.envelope.key_id);
    for (const f of A.claimed.payload.findings) {
      const outcome = checkCitation(ctx, { run, scope, resolver, rules, scopeKey }, f);
      if (outcome === "skipped") skipped++;
      else {
        checked.citations++;
        if (outcome === "redacted-only") redactedOnly++;
      }
    }
  }
  const keys = Object.fromEntries(keyIdsOf(inputs).map((id) => [id, ctx.keyById(id)?.bytes ?? null]));
  for (const packet of A.packets ?? []) {
    const n = checkPacket(resolver, keys, packet);
    if (n < 0) skipped++;
    else checked.packets += n;
  }
  return { redactedOnly, skipped };
}

// --- --drift ------------------------------------------------------------------------

/** The working file's normalised lines, redacted first for a snapshot citation (scope redacted before it counted lines); null when there is no text file. */
function workingLines(ctx, path, side, cache) {
  const k = `${side}\0${path}`;
  if (!cache.has(k)) {
    let lines = null;
    const bytes = resolveWorking(ctx, path);
    if (bytes !== null) {
      try {
        lines = lineMap(side === "snapshot" ? utf8(redactString(bytes, DEFAULT_RULES).text) : bytes).lines;
      } catch (err) {
        if (!(err instanceof EncodingError)) throw err;
      }
    }
    cache.set(k, lines);
  }
  return cache.get(k);
}

/** One citation against the working tree: "current" | "drifted" | "skipped" (base). */
function citationDrift(ctx, resolver, cache, { path, side, lines }) {
  if (side === "base") return "skipped";
  let side_;
  try {
    side_ = resolver.at(side, path);
  } catch {
    return "drifted"; // the recorded side cannot be resolved: nothing shows the tree current (--integrity names the cause)
  }
  const [start, end] = lines;
  if (end > side_.map.lines.length) return "drifted";
  const now = workingLines(ctx, path, side, cache);
  if (now === null || end > now.length) return "drifted";
  for (let i = start - 1; i < end; i++) if (now[i] !== side_.map.lines[i]) return "drifted";
  return "current";
}

/** One scope file against the working tree (header "--drift"). */
function fileDrifted(ctx, resolver, scopeKey, file) {
  const working = resolveWorking(ctx, file.path);
  if (working === null) return true;
  if (scopeKey !== null) return hmacHex(scopeKey.bytes, working) !== file.file_hmac;
  let side;
  try {
    side = resolver.at(file.side, file.path);
  } catch {
    return true;
  }
  const bytes = file.side === "snapshot" ? utf8(redactString(working, DEFAULT_RULES).text) : working;
  return !bytes.equals(side.bytes);
}

function checkDrift(ctx, { inputs, resolver }) {
  const A = inputs.artifacts;
  const result = { citations_drifted: 0, citations_skipped: 0, citations_current: 0, scope_drifted: 0, scope_files: 0 };
  const cache = new Map();
  if (A.claimed !== undefined) {
    for (const f of A.claimed.payload.findings) {
      const citations = [{ path: f.path, side: f.side, lines: f.lines }, ...(Array.isArray(f.citations_typed) ? f.citations_typed : [])];
      for (const c of citations) {
        const outcome = citationDrift(ctx, resolver, cache, c);
        if (outcome === "drifted") result.citations_drifted++;
        else if (outcome === "skipped") result.citations_skipped++;
        else result.citations_current++;
      }
    }
  }
  if (A.scope !== undefined) {
    const scopeKey = ctx.keyById(A.scope.envelope.key_id);
    for (const file of A.scope.payload.files) {
      result.scope_files++;
      if (fileDrifted(ctx, resolver, scopeKey, file)) result.scope_drifted++;
    }
  }
  result.token = result.citations_drifted > 0 ? citationDrifted(result.citations_drifted) : result.scope_drifted > 0 ? scopeDrifted(result.scope_drifted) : CURRENT;
  result.current = result.token === CURRENT;
  return result;
}

// --- checkRun -----------------------------------------------------------------------

/**
 * Check one COMMITTED run directory (see the header). Prints nothing.
 * @param {object} ctx
 * @param {string} runDir absolute `<st>/runs/<run_id>`
 * @param {{integrity?: boolean, drift?: boolean, trustedDigest?: string | null}} [opts]
 * @returns {{run_id: string, template: string, dir: string, code: number, consistency: {token: string, status: "consistent"|"redacted-only"|"structure-only"|"inconsistent", field: string|null, redacted_only: number, checked: {citations: number, packets: number, receipts: number}}, drift: null | {token: string, current: boolean, citations_drifted: number, citations_skipped: number, citations_current: number, scope_drifted: number, scope_files: number}, origin: {token: string, matched: boolean, recomputed_manifest_sha256: string|null}, key: {token: string, available: boolean, key_id: string}}}
 * @throws {CliError} 2 USAGE (not a run) · 3 INCOMPLETE(COMMITTED)
 */
export function checkRun(ctx, runDir, { integrity = false, drift = false, trustedDigest = null } = {}) {
  if (typeof runDir !== "string" || runDir === "") throw new TypeError("checkRun: runDir must be an absolute path");
  if (trustedDigest !== null && (typeof trustedDigest !== "string" || !SHA256.test(trustedDigest))) throw new TypeError("checkRun: trustedDigest must be a sha256 or null");
  const dir = resolve(runDir);
  const run_id = basename(dir);
  if (!RUN_ID.test(run_id) || !existsSync(join(dir, "run.json"))) throw usageError(COMMAND, `unknown run ${run_id}`);
  if (!existsSync(join(dir, COMMITTED))) throw new CliError(EXIT.INDETERMINATE, incomplete(COMMITTED));

  const consistency = { token: null, status: null, field: null, redacted_only: 0, checked: { citations: 0, packets: 0, receipts: 0 } };
  let key = null;
  let keyId = null;
  let recomputedId = null;
  let inputs = null;
  let resolver = null;
  let run = null;
  try {
    run = readVerified(join(dir, "run.json"), "run", "run.json");
    if (run.envelope.run_id !== run_id) throw integrityFailure(inconsistent("run.json"));
    keyId = run.envelope.key_id;
    key = ctx.keyById(keyId);
    const r = recompute(ctx, dir, { run, key });
    inputs = r.inputs;
    recomputedId = r.recomputedId;
    resolver = makeResolver(ctx, run, inputs.artifacts.scope ?? null);
    let structureOnly = r.structureOnly;
    if (integrity && !structureOnly) {
      const i = checkIntegrity(ctx, { run, inputs, resolver }, consistency.checked);
      consistency.redacted_only = i.redactedOnly;
      if (i.skipped > 0) structureOnly = true;
    }
    if (structureOnly) {
      consistency.token = STRUCTURE_ONLY;
      consistency.status = "structure-only";
    } else if (consistency.redacted_only > 0) {
      consistency.token = consistentRedactedOnly(consistency.redacted_only);
      consistency.status = "redacted-only";
    } else {
      consistency.token = CONSISTENT;
      consistency.status = "consistent";
    }
  } catch (err) {
    const token = asInconsistent(err, "run.json");
    consistency.token = token;
    consistency.status = "inconsistent";
    consistency.field = /^INCONSISTENT\((.*)\)$/.exec(token)?.[1] ?? token;
  }
  const consistent = consistency.status !== "inconsistent";
  const driftResult = drift && consistent ? checkDrift(ctx, { inputs, resolver }) : null;
  const matched = consistent && trustedDigest !== null && trustedDigest === recomputedId;
  return {
    run_id,
    template: run === null ? null : run.payload.template,
    dir,
    code: consistent ? EXIT.OK : EXIT.INTEGRITY,
    consistency,
    drift: driftResult,
    origin: { token: matched ? ORIGIN_MATCHES_SUPPLIED_DIGEST : ORIGIN_UNAUTHENTICATED, matched, recomputed_manifest_sha256: consistent ? recomputedId : null },
    key: { token: key === null ? KEY_UNAVAILABLE : KEY_AVAILABLE, available: key !== null, key_id: keyId },
  };
}

/**
 * @param {string[]} argv after `check`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const args = parseArgs(argv);
  const dir = resolveTarget(ctx, args.target);
  const result = checkRun(ctx, dir, { integrity: args.integrity, drift: args.drift, trustedDigest: args.trustedDigest });
  ctx.out(result.consistency.token);
  if (result.drift !== null) ctx.out(result.drift.token);
  ctx.out(result.origin.token);
  ctx.out(result.key.token);
  return result.code;
}

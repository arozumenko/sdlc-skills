// lib/gate-core.mjs — the pure gate (TASK-019; plan §3.3 row `lib/cmd-gate.mjs`
// / §5 TASK-019; spec §6.1 `gate-result.json` preimage `{accepted[],
// unverifiable[], rejected_counts, scope_sha256, claimed_sha256}`, §6.2 range
// rule, §6.5 identity by content sensitivity, §6.7 last row, TL-15; G-7
// "scripts derive; agents assert"; G-9 pure core). `cmd-gate.mjs` wires it
// to the run directory; `build-report` / `check` (TASK-023/025) call it
// again over the same inputs and must get a byte-identical result.
//
//   gate({scope, scopePackets, claims, imports, resolveSide, key, rules})
//     → {claimed, gateResult, rejects, unlocated, citationRecords[]}
//
//     scope         the scope ARTIFACT ({envelope, payload}: scope_sha256 is
//                   envelope.self_sha256)
//     scopePackets  packet_sha256 of every `kind: scope` packet of the run
//     claims        [{name, ref, set}] — one per `--claims` file, in argv
//                   order: `name` names the file in the refusal token, `ref`
//                   is its identity (sha256 of its REDACTED canonical form,
//                   never of the raw bytes — a claim can quote protected
//                   content, G-2), `set` the parsed ClaimSet
//                   {scope_sha256, packet_sha256, findings[]}
//     imports       import-record payloads (`<run>/ingest/*.json`): `sarif`
//                   located records are candidates; every kind's
//                   `unlocated[]` is copied out verbatim (US-010 AC-4)
//     resolveSide   ({path, side}) → {bytes, oid} | null — the bytes at that
//                   side and the oid the citation record names (blob oid for
//                   base|head, redacted_sha256 for snapshot); null = no blob
//                   at that side (a base citation of a file added after
//                   base). Called at most once per (side, path). The caller
//                   lets a snapshot/head resolution failure propagate (its
//                   own state is inconsistent) and maps base's ObjectMissing
//                   to null.
//     key           the engagement key bytes (keyed identities and the
//                   private records, G-2)
//     rules         the redaction rules in force (redact.DEFAULT_RULES)
//
// Candidates, in this order: every `sarif` import's located records (imports
// by import_sha256, records by locator index), then every claims file's
// findings (argv order, then index). `source` records where a finding came
// from: {kind: sarif, ref: import_sha256, index} or {kind: agent, ref, index}.
// Per candidate, the first failure is its `rejects.json` reason:
//
//   agent claims only
//   1. a claim carrying `id`, `state` or another forbidden key ⇒ agent-wrote-id
//   2. not a finding.schema.json Claim (priority / confidence missing or off
//      range — never defaulted, never capped; unknown field; empty snippet)
//      ⇒ claim-invalid
//   every candidate
//   3. cite.checkRange over the primary citation ⇒ RANGE-INVALID |
//      RANGE-TOO-LONG | PATH-NOT-IN-SCOPE | SIDE-MISMATCH | RANGE-NOT-ADMITTED
//      — except a `base` citation, whose RANGE-NOT-ADMITTED is replaced by
//      the base rule below (head's admitted ranges say nothing about the base
//      blob)
//   4. the bytes at the side: none ⇒ PATH-NOT-AT-SIDE; not UTF-8 ⇒ FILE-NOT-TEXT
//   5. extent: `end` past the last normalised line at that side ⇒
//      RANGE-OUTSIDE-FILE (this IS base-side admission: the admitted range
//      of a scope file at base is the whole base blob — scope admits whole
//      files at head, and the base blob of a file the reviewer received in
//      the scope packet is the only base content anyone can re-derive;
//      a file deleted at head is not a scope file and stays
//      PATH-NOT-IN-SCOPE, closed until the spec names a rule for it)
//   6. typed citations (`citations_typed[]`, role source|sink|control):
//      checkRange with the role (flagged `context: true`), then the same
//      extent rule at their own side — a failure is the claim's rejection
//   7. after every candidate: a second candidate with an identity already
//      gated ⇒ duplicate-id (a CITATION_VERIFIED candidate outranks a
//      CITATION_FAILED one with the same id; otherwise the first wins)
//
// State and occurrence (spec §6.2, v3 §6.1, TASK-014): the claimed snippet
// is normalised (normalize.mjs) and compared for EXACT equality with the
// normalised text of the source range at the cited side; equal ⇒
// CITATION_VERIFIED and `occurrence` = cite.occurrenceOf over the file's
// normalised lines (the hint is never read); unequal ⇒ CITATION_FAILED,
// `occurrence: 0` (the window is not the snippet, so there is no index to
// report; the schema needs an integer). A claim that carries
// `snippet_redacted` / `context_redacted` instead of `snippet` (the
// reviewer read redacted bytes and says so) is compared against the
// REDACTED normalised source text and takes the keyed identity. A SARIF
// record has no claimed text: its snippet IS the source text at `lines`
// (TASK-016 contract), so it matches by construction.
//
// Identity by content sensitivity (spec §6.5, §2 row 4):
//   sensitive = a redaction rule matches the RAW bytes of the source range
//               OR the claimed text, OR the class is `secret` (the reviewer's
//               own word that the text is a secret — keyed even when the
//               rule list misses it, the safe side of a bounded guarantee),
//               OR the claim came pre-redacted
//   plain      id = sha256(path\0class\0normalised snippet\0occurrence);
//              `snippet` stored
//   sensitive  id = HMAC_key(path\0class\0redacted normalised snippet\0occurrence);
//              `snippet_redacted` stored (`context_redacted` for class
//              `secret`), `sensitive: true`; and the private citation record
//              {claimed_hmac, source_hmac, match, side, oid, redaction_version}
//              is produced here, while the claimed text is still in memory —
//              claimed_hmac = HMAC_key(UTF-8 of the normalised claimed text),
//              source_hmac = HMAC_key(UTF-8 of the normalised source text of
//              the range), which is what `check` re-derives from the recorded
//              side and compares (TASK-025). No plain sha256 is ever taken
//              over content bytes here (G-2).
// The `snippet` in the preimage is the CLAIMED text (for a verified finding
// it equals the source text; for a failed one it is what was claimed).
//
// Outputs: `claimed` = {scope_sha256, findings[]} with findings ordered by
// id, already passed through redactDeep so the identity `check` recomputes
// is the identity on disk (`claimed_sha256 = artifactId(claimed)`, and
// cmd-gate writes it with `prered: true`); `gateResult`; `rejects` =
// {rejected[]} in candidate order; `unlocated` = {candidates[]} verbatim from
// the imports (by import_sha256); `citationRecords` = [{id, record}] by id.
// Inputs are never mutated. `gate()` is deterministic over its inputs, and
// `findingId()` is exported on its own because a claims file lives in the
// agent drop-box outside the run directory (TL-4, G-16): `check` re-derives
// an id from the stored finding (`path`, `class`, `snippet` /
// `snippet_redacted` / `context_redacted`, `occurrence`, `sensitive`) with
// the same function, and a sensitive finding's state from its private
// record — never from the claim.
//
// Pure (G-9): imports ../canon.mjs (artifactId, hmacHex, sha256Hex),
// ../normalize.mjs, ../redact.mjs (matches, redactDeep, redactString — the
// rules are passed in), ./cite-core.mjs, ./ingest/_sarif.mjs
// (DATA_FLOW_CLASSES — one vocabulary for `requires_typed_citations`),
// ./schema.mjs (validate, forbiddenKeys) and ./tokens.mjs. No clock, no fs,
// no child process, no git, no network; nothing in any payload names a
// machine path, a time or a pid (G-1).

import { artifactId, hmacHex, sha256Hex } from "../canon.mjs";
import { EncodingError, normalizeText } from "../normalize.mjs";
import { matches, redactDeep, redactString } from "../redact.mjs";
import { SIDES, checkRange, lineMap, occurrenceOf, rangeBytes } from "./cite-core.mjs";
import { DATA_FLOW_CLASSES } from "./ingest/_sarif.mjs";
import { RECEIPT_FORBIDDEN_KEYS, forbiddenKeys, validate } from "./schema.mjs";
import {
  CITATION_FAILED,
  CITATION_VERIFIED,
  GATE_AGENT_WROTE_ID,
  GATE_CLAIM_INVALID,
  GATE_DUPLICATE_ID,
  GATE_FILE_NOT_TEXT,
  GATE_PATH_NOT_AT_SIDE,
  GATE_RANGE_OUTSIDE_FILE,
  RANGE_NOT_ADMITTED,
} from "./tokens.mjs";

/** The only two states `gate` assigns (spec §6.5). */
export const CITATION_STATES = Object.freeze([CITATION_VERIFIED, CITATION_FAILED]);
/** finding.schema.json `source.kind` vocabulary. */
export const SOURCE_KINDS = Object.freeze(["agent", "sarif"]);
/** Claim fields copied onto the finding when present (finding.schema.json optional prose). */
const PROSE_KEYS = Object.freeze(["description", "impact", "prerequisites", "remediation"]);
const SECRET_CLASS = "secret";
const SHA256 = /^[0-9a-f]{64}$/;
const WHERE = "gate";

/** TL-15: a claims file whose packet is not a scope packet of the run (or whose scope is not the run's). `file` is the caller's name for it. */
export class ClaimsPacketMismatch extends Error {
  constructor(file, field) {
    super(`${file}: ${field} does not name this run's ${field === "packet_sha256" ? "scope packet" : "scope"}`);
    this.name = "ClaimsPacketMismatch";
    this.file = file;
    this.field = field;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const utf8 = (s) => Buffer.from(s, "utf8");

/**
 * A finding's identity (spec §6.5). `snippet` is the normalised claimed text;
 * when `sensitive`, it is redacted here and keyed with `key`.
 * @param {{path: string, class: string, snippet: string, occurrence: number, sensitive: boolean, key: Uint8Array, rules: object}} input
 * @returns {string} 64 lowercase hex chars
 */
export function findingId({ path, class: cls, snippet, occurrence, sensitive, key, rules }) {
  if (typeof path !== "string" || typeof cls !== "string" || typeof snippet !== "string") throw new TypeError("findingId: path, class and snippet must be strings");
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) throw new TypeError("findingId: occurrence must be a non-negative integer");
  const text = sensitive ? redactString(snippet, rules).text : snippet;
  const preimage = utf8(`${path}\0${cls}\0${text}\0${occurrence}`);
  return sensitive ? hmacHex(requireKey(key), preimage) : sha256Hex(preimage);
}

function requireKey(key) {
  if (!(key instanceof Uint8Array) || key.length === 0) throw new TypeError(`${WHERE}: key must be the engagement key bytes (non-empty Buffer)`);
  return key;
}

function requireRules(rules) {
  if (!isPlainObject(rules) || !Array.isArray(rules.rules) || !Number.isSafeInteger(rules.redaction_version)) throw new TypeError(`${WHERE}: rules must be a loaded redact.mjs rule set`);
  return rules;
}

function requireScope(scope) {
  if (!isPlainObject(scope) || !isPlainObject(scope.envelope) || !isPlainObject(scope.payload)) throw new TypeError(`${WHERE}: scope must be the scope artifact {envelope, payload}`);
  if (typeof scope.envelope.self_sha256 !== "string" || !SHA256.test(scope.envelope.self_sha256)) throw new TypeError(`${WHERE}: scope.envelope.self_sha256 must be a sha256`);
  if (!Array.isArray(scope.payload.files) || !isPlainObject(scope.payload.ranges)) throw new TypeError(`${WHERE}: scope.payload must carry files[] and ranges`);
  return scope;
}

function requireScopePackets(list) {
  if (!Array.isArray(list) || list.some((s) => typeof s !== "string" || !SHA256.test(s))) throw new TypeError(`${WHERE}: scopePackets must be an array of packet_sha256 strings`);
  return list;
}

function requireClaims(list) {
  if (!Array.isArray(list)) throw new TypeError(`${WHERE}: claims must be an array of {name, ref, set}`);
  list.forEach((entry, i) => {
    const at = `${WHERE}: claims[${i}]`;
    if (!isPlainObject(entry)) throw new TypeError(`${at} must be {name, ref, set}`);
    if (typeof entry.name !== "string" || entry.name === "") throw new TypeError(`${at}.name must be a non-empty string`);
    if (typeof entry.ref !== "string" || !SHA256.test(entry.ref)) throw new TypeError(`${at}.ref must be a sha256`);
    const set = entry.set;
    if (!isPlainObject(set) || typeof set.scope_sha256 !== "string" || typeof set.packet_sha256 !== "string" || !Array.isArray(set.findings)) {
      throw new TypeError(`${at}.set must be a ClaimSet {scope_sha256, packet_sha256, findings[]}`);
    }
  });
  return list;
}

function requireImports(list) {
  if (!Array.isArray(list)) throw new TypeError(`${WHERE}: imports must be an array of import-record payloads`);
  list.forEach((imp, i) => {
    const at = `${WHERE}: imports[${i}]`;
    if (!isPlainObject(imp) || typeof imp.kind !== "string" || typeof imp.import_sha256 !== "string" || !SHA256.test(imp.import_sha256)) throw new TypeError(`${at} must be an import-record payload`);
    if (!Array.isArray(imp.records) || !Array.isArray(imp.unlocated)) throw new TypeError(`${at} must carry records[] and unlocated[]`);
  });
  return list;
}

/** UTF-8 byte order, the order canon sorts keys in. */
function compareBytes(a, b) {
  return Buffer.compare(utf8(a), utf8(b));
}

// --- candidates ---------------------------------------------------------------------

/** A SARIF located record as a claim-shaped candidate (TASK-016 `trusted` contract). */
function sarifCandidate(imp, rec, order) {
  const t = rec.trusted;
  if (!isPlainObject(t) || typeof t.path !== "string" || !SIDES.includes(t.side) || !Array.isArray(t.lines)) throw new TypeError(`${WHERE}: sarif record ${imp.import_sha256}#${rec.locator?.index} is not a located record`);
  const claim = { title: `${t.tool}: ${t.rule_id}`, class: t.class, priority: t.priority, confidence: t.confidence, path: t.path, side: t.side, lines: t.lines, requires_typed_citations: t.requires_typed_citations === true };
  if (typeof t.cwe === "string") claim.cwe = t.cwe;
  return { order, kind: "sarif", claim, source: { kind: "sarif", ref: imp.import_sha256, index: rec.locator.index }, locator: { import_sha256: imp.import_sha256, index: rec.locator.index } };
}

function agentCandidate(entry, claim, index, order) {
  return { order, kind: "agent", claim, source: { kind: "agent", ref: entry.ref, index }, locator: { claims_sha256: entry.ref, index } };
}

/** Every candidate in gate order, plus every import's unlocated[] verbatim. */
function collect({ claims, imports }) {
  const candidates = [];
  const unlocated = [];
  let order = 0;
  const byImport = [...imports].sort((a, b) => compareBytes(a.import_sha256, b.import_sha256));
  for (const imp of byImport) {
    for (const c of imp.unlocated) unlocated.push(structuredClone(c));
    if (imp.kind !== "sarif") continue;
    const records = [...imp.records].sort((a, b) => a.locator.index - b.locator.index);
    for (const rec of records) candidates.push(sarifCandidate(imp, rec, order++));
  }
  for (const entry of claims) {
    entry.set.findings.forEach((claim, index) => candidates.push(agentCandidate(entry, claim, index, order++)));
  }
  return { candidates, unlocated };
}

// --- per-candidate evaluation --------------------------------------------------------

/** One resolve + one lineMap per (side, path), failures memoised too. */
function makeResolver(resolveSide) {
  const cache = new Map();
  return (path, side) => {
    const k = `${side}\0${path}`;
    if (cache.has(k)) return cache.get(k);
    let result;
    const resolved = resolveSide({ path, side });
    if (resolved === null) result = { reject: GATE_PATH_NOT_AT_SIDE };
    else {
      if (!isPlainObject(resolved) || !(resolved.bytes instanceof Uint8Array) || typeof resolved.oid !== "string") throw new TypeError(`${WHERE}: resolveSide must return {bytes, oid} or null for ${side} ${path}`);
      try {
        result = { bytes: resolved.bytes, oid: resolved.oid, map: lineMap(resolved.bytes) };
      } catch (err) {
        if (err instanceof EncodingError) result = { reject: GATE_FILE_NOT_TEXT };
        else throw err;
      }
    }
    cache.set(k, result);
    return result;
  };
}

/** The scope file's normalised line count for head|snapshot (recorded by scope), or null for base (the blob decides). */
function scopeLines(scope, path, side) {
  if (side === "base") return null;
  const file = scope.payload.files.find((f) => f.path === path);
  return file === undefined ? null : file.lines;
}

/**
 * Admission of a citation at its side (steps 3–5 of the header): the range
 * rule, then the bytes, then the extent. Returns {reject} or {ok, context?,
 * resolved?} — `resolved` only when the bytes were needed (base, or the
 * primary citation).
 */
function admit(scope, resolve, citation, { primary }) {
  const check = checkRange(scope, citation);
  const { path, side, lines } = citation;
  const base = side === "base";
  if (!check.ok && !(base && check.reason === RANGE_NOT_ADMITTED)) return { reject: check.reason };
  const end = lines[1];
  if (!base && !primary) {
    // a typed citation at head|snapshot: the scope's recorded line count is the extent
    const n = scopeLines(scope, path, side);
    return end > n ? { reject: GATE_RANGE_OUTSIDE_FILE } : { ok: true, context: true };
  }
  const resolved = resolve(path, side);
  if (resolved.reject !== undefined) return { reject: resolved.reject };
  if (end > resolved.map.lines.length) return { reject: GATE_RANGE_OUTSIDE_FILE };
  return { ok: true, context: check.context === true, resolved };
}

/** Steps 1–2 for an agent claim: forbidden keys, then the Claim schema, then a non-empty normalised text. */
function checkClaim(claim) {
  if (!isPlainObject(claim)) return { reject: GATE_CLAIM_INVALID };
  if (forbiddenKeys(claim, RECEIPT_FORBIDDEN_KEYS).length > 0) return { reject: GATE_AGENT_WROTE_ID };
  if (validate("claim", claim).length > 0) return { reject: GATE_CLAIM_INVALID };
  if (claim.path === "") return { reject: GATE_CLAIM_INVALID };
  return { ok: true };
}

/** The claimed text of an agent claim and whether it came pre-redacted (exactly one of the three keys, by schema). */
function claimedTextOf(claim) {
  if (typeof claim.snippet === "string") return { text: claim.snippet, preRedacted: false };
  return { text: claim.snippet_redacted ?? claim.context_redacted, preRedacted: true };
}

function evaluate(candidate, { scope, resolve, key, rules }) {
  const { claim, kind } = candidate;
  let claimedText = null;
  let preRedacted = false;
  if (kind === "agent") {
    const shape = checkClaim(claim);
    if (shape.reject !== undefined) return { reject: shape.reject };
    const t = claimedTextOf(claim);
    preRedacted = t.preRedacted;
    claimedText = normalizeText(t.text).text;
    if (claimedText === "") return { reject: GATE_CLAIM_INVALID };
  }
  const { path, side, class: cls } = claim;
  const lines = [claim.lines[0], claim.lines[1]];

  const primary = admit(scope, resolve, { path, side, lines }, { primary: true });
  if (primary.reject !== undefined) return { reject: primary.reject };
  const typed = [];
  for (const tc of Array.isArray(claim.citations_typed) ? claim.citations_typed : []) {
    const a = admit(scope, resolve, { path: tc.path, side: tc.side, lines: tc.lines, role: tc.role }, { primary: false });
    if (a.reject !== undefined) return { reject: a.reject };
    typed.push({ role: tc.role, path: tc.path, side: tc.side, lines: [tc.lines[0], tc.lines[1]], context: true });
  }

  const { bytes, oid, map } = primary.resolved;
  const [start, end] = lines;
  const sourceLines = map.lines.slice(start - 1, end);
  const sourceText = sourceLines.join("\n");
  const raw = rangeBytes(bytes, start, end, map);
  if (claimedText === null) claimedText = sourceText; // a SARIF record cites the source text itself
  const match = claimedText === (preRedacted ? redactString(sourceText, rules).text : sourceText);
  const occurrence = match ? occurrenceOf(map.lines, sourceLines, start) : 0;
  const sensitive = preRedacted || cls === SECRET_CLASS || matches(raw, rules) || matches(claimedText, rules);
  const id = findingId({ path, class: cls, snippet: claimedText, occurrence, sensitive, key, rules });

  const finding = { id, title: claim.title, class: cls, priority: claim.priority, confidence: claim.confidence, path, side, lines };
  if (!sensitive) finding.snippet = claimedText;
  else {
    finding[cls === SECRET_CLASS ? "context_redacted" : "snippet_redacted"] = redactString(claimedText, rules).text;
    finding.sensitive = true;
  }
  if (typeof claim.cwe === "string") finding.cwe = claim.cwe;
  if (typed.length > 0) finding.citations_typed = typed;
  finding.requires_typed_citations = DATA_FLOW_CLASSES.includes(cls);
  if (kind === "agent") for (const k of PROSE_KEYS) if (typeof claim[k] === "string") finding[k] = claim[k];
  finding.state = match ? CITATION_VERIFIED : CITATION_FAILED;
  finding.occurrence = occurrence;
  finding.source = { ...candidate.source };

  const record = sensitive ? { claimed_hmac: hmacHex(key, utf8(claimedText)), source_hmac: hmacHex(key, utf8(sourceText)), match, side, oid, redaction_version: rules.redaction_version } : null;
  return { finding, record };
}

// --- gate ------------------------------------------------------------------------------

/**
 * Derive ids and citation states for every candidate (see the header).
 * @param {{scope: object, scopePackets: string[], claims: {name: string, ref: string, set: object}[], imports: object[], resolveSide: (c: {path: string, side: string}) => {bytes: Uint8Array, oid: string} | null, key: Uint8Array, rules: object}} input
 * @returns {{claimed: object, gateResult: object, rejects: object, unlocated: object, citationRecords: {id: string, record: object}[]}}
 * @throws {ClaimsPacketMismatch} before anything is evaluated (TL-15)
 * @throws {TypeError} on a caller shape error
 */
export function gate({ scope, scopePackets, claims, imports, resolveSide, key, rules } = {}) {
  requireScope(scope);
  requireScopePackets(scopePackets);
  requireClaims(claims);
  requireImports(imports);
  if (typeof resolveSide !== "function") throw new TypeError(`${WHERE}: resolveSide must be a function ({path, side}) → {bytes, oid} | null`);
  requireKey(key);
  requireRules(rules);

  const scope_sha256 = scope.envelope.self_sha256;
  for (const entry of claims) {
    if (!scopePackets.includes(entry.set.packet_sha256)) throw new ClaimsPacketMismatch(entry.name, "packet_sha256");
    if (entry.set.scope_sha256 !== scope_sha256) throw new ClaimsPacketMismatch(entry.name, "scope_sha256");
  }

  const { candidates, unlocated } = collect({ claims, imports });
  const resolve = makeResolver(resolveSide);
  const rejected = [];
  const gated = [];
  for (const c of candidates) {
    const r = evaluate(c, { scope, resolve, key, rules });
    if (r.reject !== undefined) rejected.push({ order: c.order, reason: r.reject, locator: { ...c.locator } });
    else gated.push({ order: c.order, locator: c.locator, ...r });
  }

  // one finding per identity: CITATION_VERIFIED outranks CITATION_FAILED, then the earliest candidate
  const winners = new Map();
  for (const g of gated) {
    const prev = winners.get(g.finding.id);
    if (prev === undefined) {
      winners.set(g.finding.id, g);
      continue;
    }
    const better = g.finding.state === CITATION_VERIFIED && prev.finding.state !== CITATION_VERIFIED;
    const loser = better ? prev : g;
    if (better) winners.set(g.finding.id, g);
    rejected.push({ order: loser.order, reason: GATE_DUPLICATE_ID, locator: { ...loser.locator } });
  }
  rejected.sort((a, b) => a.order - b.order);

  const findings = [...winners.values()].sort((a, b) => compareBytes(a.finding.id, b.finding.id));
  const claimed = redactDeep({ scope_sha256, findings: findings.map((g) => g.finding) }, rules);
  const rejected_counts = {};
  for (const r of rejected) rejected_counts[r.reason] = (rejected_counts[r.reason] ?? 0) + 1;
  const gateResult = {
    accepted: findings.filter((g) => g.finding.state === CITATION_VERIFIED).map((g) => g.finding.id),
    unverifiable: findings.filter((g) => g.finding.state === CITATION_FAILED).map((g) => g.finding.id),
    rejected_counts: Object.fromEntries(Object.keys(rejected_counts).sort(compareBytes).map((k) => [k, rejected_counts[k]])),
    scope_sha256,
    claimed_sha256: artifactId(claimed),
  };
  const rejects = { rejected: rejected.map(({ reason, locator }) => ({ reason, locator })) };
  const citationRecords = findings.filter((g) => g.record !== null).map((g) => ({ id: g.finding.id, record: g.record }));
  return { claimed, gateResult, rejects, unlocated: { candidates: unlocated }, citationRecords };
}

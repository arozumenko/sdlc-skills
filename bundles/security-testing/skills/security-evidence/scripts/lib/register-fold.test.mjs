// TASK-028 — the pure register fold (spec §6.8, plan §4.3): chained events,
// replay, anchor. No fs, no clock, no git (G-9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../canon.mjs";
import { validate } from "./schema.mjs";
import {
  ChainError,
  EVENT_KEYS,
  GENESIS_SHA256,
  PRIORITIES,
  STATUSES,
  TransitionError,
  anchor,
  anchorVerify,
  emptyRow,
  eventSha256,
  parseAnchor,
  replay,
  summarize,
  verifyChain,
} from "./register-fold.mjs";

const SELF = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "register-fold.mjs"), "utf8");
const EID = "eng-2026-001";
const RUN = "0123456789ab-0001";
const FINDING = "f".repeat(64);

/** Build a valid chain of `add` events, one per title. */
function chain(titles, { actor = "lead", ts = "2026-09-16T10:00:00Z" } = {}) {
  const events = [];
  let prev = GENESIS_SHA256;
  titles.forEach((title, i) => {
    const seq = i + 1;
    const row_id = `R-${String(seq).padStart(4, "0")}`;
    const event = {
      seq,
      prev_sha256: prev,
      ts,
      actor,
      row_id,
      event: "add",
      payload: { subject: FINDING, subject_kind: "finding", title, priority: "p1", owner: "", first_seen_run: RUN },
      ref: RUN,
    };
    events.push(event);
    prev = eventSha256(event);
  });
  return events;
}

// ---------------------------------------------------------------------------
// chain

test("eventSha256 is sha256(canonical(event)); GENESIS is 64 zeros", () => {
  const [e] = chain(["a"]);
  assert.match(eventSha256(e), /^[0-9a-f]{64}$/);
  assert.equal(eventSha256(e), eventSha256(JSON.parse(JSON.stringify(e))), "identity over canonical bytes, not object identity");
  assert.equal(GENESIS_SHA256, "0".repeat(64));
  assert.deepEqual(EVENT_KEYS, ["seq", "prev_sha256", "ts", "actor", "row_id", "event", "payload", "ref"]);
});

test("verifyChain: empty log ⇒ seq 0 and the genesis hash; a valid chain ⇒ last event's hash", () => {
  assert.deepEqual(verifyChain([]), { seq: 0, chain_sha256: GENESIS_SHA256 });
  const events = chain(["a", "b", "c"]);
  assert.deepEqual(verifyChain(events), { seq: 3, chain_sha256: eventSha256(events[2]) });
});

test("verifyChain: prev_sha256 mismatch, seq gap, seq restart and a foreign key all throw ChainError naming the seq", () => {
  const good = chain(["a", "b", "c"]);
  const withPrev = structuredClone(good);
  withPrev[1].prev_sha256 = "1".repeat(64);
  assert.throws(() => verifyChain(withPrev), (e) => e instanceof ChainError && e.seq === 2 && /prev_sha256/.test(e.message));

  const gap = [good[0], good[2]];
  assert.throws(() => verifyChain(gap), (e) => e instanceof ChainError && e.seq === 3 && /seq/.test(e.message));

  const restart = structuredClone(good);
  restart[0].seq = 0;
  assert.throws(() => verifyChain(restart), (e) => e instanceof ChainError && /seq/.test(e.message));

  const extra = structuredClone(good);
  extra[0].note = "x";
  assert.throws(() => verifyChain(extra), (e) => e instanceof ChainError && /note/.test(e.message));

  const missing = structuredClone(good);
  delete missing[0].ref;
  assert.throws(() => verifyChain(missing), (e) => e instanceof ChainError && /ref/.test(e.message));

  for (const bad of [null, "x", 1, {}]) assert.throws(() => verifyChain(bad), TypeError);
  assert.throws(() => verifyChain([null]), ChainError);
  assert.throws(() => verifyChain([{ ...good[0], payload: [] }]), (e) => e instanceof ChainError && /payload/.test(e.message));
});

// ---------------------------------------------------------------------------
// replay

test("replay: empty ⇒ {engagement_id, seq 0, genesis chain, no rows}; add ⇒ open row with every Row field (schema-valid)", () => {
  assert.deepEqual(replay([], EID), { engagement_id: EID, seq: 0, chain_sha256: GENESIS_SHA256, rows: {} });
  const events = chain(["SQL built from request input", "second"]);
  const p = replay(events, EID);
  assert.equal(p.seq, 2);
  assert.equal(p.chain_sha256, eventSha256(events[1]));
  assert.deepEqual(Object.keys(p.rows), ["R-0001", "R-0002"]);
  assert.deepEqual(p.rows["R-0001"], {
    ...emptyRow("R-0001"),
    subject: FINDING,
    subject_kind: "finding",
    title: "SQL built from request input",
    status: "open",
    priority: "p1",
    owner: "",
    first_seen_run: RUN,
  });
  assert.deepEqual(validate("register", p), [], "projection validates against register.schema.json");
  for (const e of events) assert.deepEqual(validate("register-event", e), [], "every event validates");
});

test("replay is deterministic: byte-identical projections, input untouched, fresh objects", () => {
  const events = chain(["a", "b"]);
  const before = JSON.stringify(events);
  const a = replay(events, EID);
  const b = replay(events, EID);
  assert.ok(canonical(a).equals(canonical(b)));
  assert.equal(JSON.stringify(events), before);
  assert.notEqual(a, b);
  assert.notEqual(a.rows, b.rows);
});

test("replay verifies the chain first and rejects what the fold does not know", () => {
  const events = chain(["a", "b"]);
  const broken = structuredClone(events);
  broken[1].prev_sha256 = "2".repeat(64);
  assert.throws(() => replay(broken, EID), ChainError);

  // a second add on an existing row — no (add, open) pair in the table
  const dup = structuredClone(events);
  dup[1].row_id = "R-0001";
  dup[1].prev_sha256 = eventSha256(dup[0]);
  assert.throws(() => replay(dup, EID), (e) => e instanceof TransitionError && e.event === "add" && e.from === "open");

  // TASK-029 owns every other event; until then the fold refuses them
  const accept = structuredClone(events);
  accept[1].event = "accept";
  accept[1].row_id = "R-0001";
  accept[1].payload = { recorded_by: "lead", approved_by: "cto", approval_ref: "ref", authenticated: false, until: "2026-12-31" };
  accept[1].prev_sha256 = eventSha256(accept[0]);
  assert.throws(() => replay(accept, EID), (e) => e instanceof TransitionError && e.event === "accept");

  // add payload is exactly the row fields the command sets
  const extra = structuredClone(events);
  extra[0].payload.status = "fixed";
  extra[1].prev_sha256 = eventSha256(extra[0]);
  assert.throws(() => replay(extra, EID), (e) => e instanceof TransitionError && /status/.test(e.message));
  const badPriority = structuredClone(events);
  badPriority[0].payload.priority = "p9";
  badPriority[1].prev_sha256 = eventSha256(badPriority[0]);
  assert.throws(() => replay(badPriority, EID), (e) => e instanceof TransitionError && /priority/.test(e.message));

  assert.throws(() => replay(events, ""), TypeError);
});

// ---------------------------------------------------------------------------
// anchor

test("anchor is <engagement_id>:<seq>:<chain_sha256>; parseAnchor splits from the right", () => {
  const p = replay(chain(["a"]), "eng:with:colons");
  const a = anchor(p);
  assert.equal(a, `eng:with:colons:1:${p.chain_sha256}`);
  assert.deepEqual(parseAnchor(a), { engagement_id: "eng:with:colons", seq: 1, chain_sha256: p.chain_sha256 });
  assert.equal(parseAnchor("nope"), null);
  assert.equal(parseAnchor(`e:1:${"g".repeat(64)}`), null, "hash must be hex");
  assert.equal(parseAnchor(`e:x:${"a".repeat(64)}`), null, "seq is an integer");
  assert.equal(parseAnchor(`:1:${"a".repeat(64)}`), null, "engagement id is non-empty");
});

test("anchorVerify: MATCH on the exact state, TRUNCATED when the log is shorter than the anchor, DIVERGED otherwise", () => {
  const events = chain(["a", "b", "c"]);
  const p3 = replay(events, EID);
  const expect = anchor(p3);
  assert.equal(anchorVerify(p3, expect), "MATCH");
  assert.equal(anchorVerify(replay(events.slice(0, 2), EID), expect), "TRUNCATED");

  const rewritten = chain(["a", "B", "c"]);
  assert.equal(anchorVerify(replay(rewritten, EID), expect), "DIVERGED");
  assert.equal(anchorVerify(replay(chain(["a", "b", "c", "d"]), EID), expect), "DIVERGED", "a log that advanced past the anchor is not the anchored state");
  assert.equal(anchorVerify(replay(events, "other"), expect), "DIVERGED", "another engagement's register");
  assert.throws(() => anchorVerify(p3, "garbage"), TypeError);
});

// ---------------------------------------------------------------------------
// status summary

test("summarize: counts by status × priority (zeros included), open_exposure = open + regressed, approvals never subtract", () => {
  const p = replay(chain(["a", "b", "c"]), EID);
  p.rows["R-0002"].priority = "p0";
  p.rows["R-0003"].status = "accepted";
  p.rows["R-0003"].acceptance = { recorded_by: "lead", approved_by: "cto", approval_ref: "r", authenticated: false, until: "2026-12-31" };
  p.rows["R-0001"].ack_refs = ["a".repeat(64)];
  const s = summarize(p);
  assert.deepEqual(Object.keys(s), ["counts", "open_exposure", "unauthenticated_approvals", "rows"]);
  assert.deepEqual(Object.keys(s.counts), STATUSES);
  for (const status of STATUSES) assert.deepEqual(Object.keys(s.counts[status]), PRIORITIES);
  assert.deepEqual(s.counts.open, { p0: 1, p1: 1, p2: 0, p3: 0 });
  assert.deepEqual(s.counts.accepted, { p0: 0, p1: 1, p2: 0, p3: 0 });
  assert.deepEqual(s.open_exposure, { p0: 1, p1: 1, p2: 0, p3: 0 });
  assert.equal(s.unauthenticated_approvals, 2, "one accepted row + one row with ack_refs");
  assert.equal(s.rows, p.rows);

  const regressed = replay(chain(["x"]), EID);
  regressed.rows["R-0001"].status = "regressed";
  assert.deepEqual(summarize(regressed).open_exposure, { p0: 0, p1: 1, p2: 0, p3: 0 });
});

// ---------------------------------------------------------------------------
// purity (G-9)

test("pure: register-fold.mjs imports no fs, child process, git or clock", () => {
  const imports = [...SELF.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../canon.mjs", "./tokens.mjs"]);
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!SELF.includes(banned), `register-fold.mjs must not reference ${banned}`);
  }
});

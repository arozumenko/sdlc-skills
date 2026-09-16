import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, initRepo, SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import { hmacHex, makeEnvelope, parseStrict, readArtifact, writeArtifact } from "../canon.mjs";
import { CliError } from "./exit.mjs";
import { createContext } from "./ctx.mjs";
import { keyLine } from "./tokens.mjs";
import { KEY_BYTES, KEY_ID_PATTERN, currentKeyId, ensureKey, keyIdOf, keysDir, keysOf, loadKey, readIndex } from "./keys.mjs";

after(cleanupAll);

const NOW = "2026-09-16T10:00:00Z";

function ctxIn(repo, env = { SECURITY_EVIDENCE_NOW: NOW }) {
  const sink = { write() {} };
  return createContext({}, { cwd: repo, env, stdout: sink, stderr: sink });
}

function keyFiles(repo) {
  const dir = join(repo, ".agents", "security-testing", "private", "keys");
  return existsSync(dir) ? readdirSync(dir).filter((n) => KEY_ID_PATTERN.test(n)).sort() : [];
}

// ---------------------------------------------------------------------------

test("ensureKey twice reuses the key, rotate adds one", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);

  const first = ensureKey(ctx, { engagement_id: "eng-1" });
  assert.match(first.key_id, KEY_ID_PATTERN, "key_id = k + 12 hex (TL-9)");
  assert.equal(first.created, true);
  assert.equal(first.status, "created");

  const dir = keysDir(ctx);
  assert.equal(dir, join(repo, ".agents", "security-testing", "private", "keys"));
  const keyPath = join(dir, first.key_id);
  const bytes = readFileSync(keyPath);
  assert.equal(bytes.length, KEY_BYTES, "32 random bytes");
  assert.equal(KEY_BYTES, 32);
  assert.equal(first.key_id, `k${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`, "key_id is derived from the key bytes");
  assert.equal(keyIdOf(bytes), first.key_id);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600, "US-005 AC-1: key file mode 0600");
  assert.equal(readFileSync(join(dir, "current"), "utf8"), `${first.key_id}\n`, "keys/current names the active key");
  assert.equal(currentKeyId(ctx), first.key_id);
  assert.deepEqual(loadKey(ctx, first.key_id), bytes);

  const again = ensureKey(ctx, { engagement_id: "eng-1" });
  assert.deepEqual(again, { key_id: first.key_id, created: false, status: "reused" }, "US-005 AC-2: repeated init reuses");
  assert.deepEqual(keyFiles(repo), [first.key_id]);
  assert.deepEqual(readFileSync(keyPath), bytes, "reuse never rewrites the key bytes");

  const rotated = ensureKey(ctx, { rotate: true, engagement_id: "eng-1" });
  assert.notEqual(rotated.key_id, first.key_id, "US-005 AC-3: --rotate creates a new key_id");
  assert.equal(rotated.created, true);
  assert.equal(rotated.status, "rotated");
  assert.deepEqual(keyFiles(repo), [first.key_id, rotated.key_id].sort(), "the old key file is kept");
  assert.deepEqual(readFileSync(keyPath), bytes, "rotation deletes and rewrites nothing");
  assert.equal(currentKeyId(ctx), rotated.key_id, "current is repointed");
  assert.equal(statSync(join(dir, rotated.key_id)).mode & 0o777, 0o600);
  assert.deepEqual(loadKey(ctx, first.key_id), bytes, "the old key still loads (artifacts that recorded it stay checkable)");

  const third = ensureKey(ctx, { engagement_id: "eng-1" });
  assert.deepEqual(third, { key_id: rotated.key_id, created: false, status: "reused" }, "after a rotation the new key is the one reused");
  assert.deepEqual(keyFiles(repo), [first.key_id, rotated.key_id].sort());

  assert.ok(!existsSync(join(repo, ".agents", "security-testing", "private", "keys.lock")), "the lock is released");
  assert.deepEqual(readdirSync(dir).sort(), [...keyFiles(repo), "current", "index.json"].sort(), "keys/ holds exactly the key files, current and index.json");
});

test("the key file is created with the wx flag through fsx.writeExclusive and nothing else writes it", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "keys.mjs"), "utf8");
  assert.match(src, /writeExclusive\(/, "US-005 AC-1: O_EXCL creation goes through fsx.writeExclusive (wx)");
  assert.match(src, /0o600/, "key files are written with mode 0600");
  assert.doesNotMatch(src, /writeFileSync|openSync|createWriteStream/, "no second write path beside fsx");
  assert.doesNotMatch(src, /node:child_process|\.\/git\.mjs|node:http|node:net|node:dns|fetch\(/, "G-6 / G-14: no child process, no git, no network in the key module");
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/, "G-1: the clock is ctx.now()");
  assert.doesNotMatch(src, /Math\.random/, "key material is node:crypto randomBytes");
  assert.match(src, /randomBytes\(/);
});

test("keys/index.json records {key_id: {engagement_id, created_at}}; created_at is ctx.now()", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  const a = ensureKey(ctx, { engagement_id: "eng-1" });
  const b = ensureKey(ctx, { rotate: true, engagement_id: "eng-1" });

  const raw = parseStrict(readFileSync(join(keysDir(ctx), "index.json")));
  assert.deepEqual(raw, {
    [a.key_id]: { engagement_id: "eng-1", created_at: NOW },
    [b.key_id]: { engagement_id: "eng-1", created_at: NOW },
  });
  assert.deepEqual(readIndex(ctx), raw);
  const text = readFileSync(join(keysDir(ctx), "index.json"), "utf8");
  assert.ok(text.endsWith("\n") && !text.slice(0, -1).includes("\n"), "canonical one-line JSON plus a trailing LF");
  assert.doesNotMatch(text, /\.tmp-/, "no tmp residue");
});

test("keysOf returns only that engagement's keys", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  assert.deepEqual(keysOf(ctx, "eng-1"), [], "nothing on disk ⇒ []");

  const a1 = ensureKey(ctx, { engagement_id: "eng-1" });
  const a2 = ensureKey(ctx, { rotate: true, engagement_id: "eng-1" });
  const b1 = ensureKey(ctx, { engagement_id: "eng-2" });
  assert.equal(b1.created, true, "a second engagement gets its own key (purge removes exactly one engagement's keys, TL-9)");
  assert.equal(b1.status, "created");
  const b2 = ensureKey(ctx, { rotate: true, engagement_id: "eng-2" });

  assert.deepEqual(keysOf(ctx, "eng-1"), [a1.key_id, a2.key_id].sort(), "canonical order: bytewise key_id, as index.json is written");
  assert.deepEqual(keysOf(ctx, "eng-2"), [b1.key_id, b2.key_id].sort());
  assert.deepEqual(keysOf(ctx, "eng-3"), []);
  assert.deepEqual(keyFiles(repo), [a1.key_id, a2.key_id, b1.key_id, b2.key_id].sort(), "four files, nothing deleted");
  assert.equal(currentKeyId(ctx), b2.key_id);

  // Back on eng-1: eng-2's current key is not reused (it is not eng-1's), and
  // an older eng-1 key is never resurrected (index.json keeps no creation
  // order) — a new key is created and attributed to eng-1.
  const a3 = ensureKey(ctx, { engagement_id: "eng-1" });
  assert.equal(a3.created, true);
  assert.equal(a3.status, "created");
  assert.ok(![a1.key_id, a2.key_id, b1.key_id, b2.key_id].includes(a3.key_id));
  assert.equal(currentKeyId(ctx), a3.key_id, "current follows the engagement being initialised");
  assert.deepEqual(keysOf(ctx, "eng-1"), [a1.key_id, a2.key_id, a3.key_id].sort());
  assert.deepEqual(keysOf(ctx, "eng-2"), [b1.key_id, b2.key_id].sort(), "eng-2's rows are untouched");
  assert.deepEqual(ensureKey(ctx, { engagement_id: "eng-1" }), { key_id: a3.key_id, created: false, status: "reused" });
});

test("artifacts written after rotate record the new key_id", () => {
  const repo = initRepo();
  const runDir = join(repo, ".agents", "security-testing", "runs", "r");
  const content = Buffer.from("password=1234\n");

  const before = ensureKey(ctxIn(repo), { engagement_id: "eng-1" });
  const ctx1 = ctxIn(repo);
  const k1 = ctx1.key();
  assert.equal(k1.key_id, before.key_id, "ctx.key() is the key ensureKey established");
  const head1 = { schema_version: 1, kind: "scope", run_id: "r", engagement_id: "eng-1", key_id: k1.key_id, now: ctx1.now };
  const a1 = writeArtifact(join(runDir, "one.json"), makeEnvelope(head1, { files: [], ranges: {}, skipped: [], h: hmacHex(k1.bytes, content) }));

  const rotated = ensureKey(ctx1, { rotate: true, engagement_id: "eng-1" });
  // A fresh ctx: ctx.key() is cached per context (TASK-006), so a writer in a
  // later process — every command after `engagement init --rotate` — sees the
  // new key; see the ordering note in keys.mjs for the same-process case.
  const ctx2 = ctxIn(repo);
  const k2 = ctx2.key();
  assert.equal(k2.key_id, rotated.key_id);
  assert.notEqual(k2.key_id, k1.key_id);
  const head2 = { ...head1, key_id: k2.key_id, now: ctx2.now };
  const a2 = writeArtifact(join(runDir, "two.json"), makeEnvelope(head2, { files: [], ranges: {}, skipped: [], h: hmacHex(k2.bytes, content) }));

  assert.equal(readArtifact(join(runDir, "one.json")).envelope.key_id, before.key_id, "the earlier artifact keeps the key it used");
  assert.equal(readArtifact(join(runDir, "two.json")).envelope.key_id, rotated.key_id, "the later artifact records the new key");
  assert.notEqual(a1.payload.h, a2.payload.h, "the same content keyed under two keys yields two HMACs");

  // Replay with either key_id: loadKey by the id an envelope recorded.
  for (const path of ["one.json", "two.json"]) {
    const art = readArtifact(join(runDir, path));
    const bytes = loadKey(ctx2, art.envelope.key_id);
    assert.ok(bytes, `${path}: KEY: available`);
    assert.equal(hmacHex(bytes, content), art.payload.h, `${path}: the recorded HMAC re-derives with the recorded key_id`);
  }
  assert.equal(ctx2.keyById(before.key_id).key_id, before.key_id, "ctx.keyById still resolves the rotated-out key");
});

test("a lost key never blocks init: current naming a missing file ⇒ a new key is created; the old id stays unavailable", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  const first = ensureKey(ctx, { engagement_id: "eng-1" });
  rmSync(join(keysDir(ctx), first.key_id));
  assert.equal(loadKey(ctx, first.key_id), null, "KEY: unavailable for artifacts that recorded it");
  assert.equal(currentKeyId(ctx), first.key_id, "the pointer is reported as is");

  const next = ensureKey(ctx, { engagement_id: "eng-1" });
  assert.equal(next.created, true);
  assert.equal(next.status, "created");
  assert.notEqual(next.key_id, first.key_id);
  assert.equal(currentKeyId(ctx), next.key_id);
  assert.deepEqual(keysOf(ctx, "eng-1"), [first.key_id, next.key_id].sort(), "the index keeps the lost key's row (its artifacts still name it)");
  assert.equal(loadKey(ctx, first.key_id), null);
});

test("loadKey / currentKeyId / readIndex with nothing on disk; malformed ids and index are refused", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  assert.equal(currentKeyId(ctx), null);
  assert.equal(loadKey(ctx, "kffffffffffff"), null);
  assert.deepEqual(readIndex(ctx), {});
  assert.throws(() => loadKey(ctx, "../engagement.md"), (e) => e instanceof CliError && e.code === 5 && e.token === "INCONSISTENT(key_id)");
  assert.throws(() => loadKey(ctx, "current"), (e) => e instanceof CliError && e.code === 5, "the pointer file is not a key");

  const dir = keysDir(ctx);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "current"), "not-a-key-id\n");
  assert.throws(() => currentKeyId(ctx), (e) => e instanceof CliError && e.code === 5 && e.token === "INCONSISTENT(keys/current)");
  assert.throws(() => ensureKey(ctx, { engagement_id: "eng-1" }), (e) => e instanceof CliError && e.code === 5, "ensureKey does not paper over a corrupt pointer");
  rmSync(join(dir, "current"));

  writeFileSync(join(dir, "index.json"), '{"k0123456789ab": {"engagement_id": "eng-1"}}\n');
  assert.throws(() => readIndex(ctx), (e) => e instanceof CliError && e.code === 5 && e.token === "INCONSISTENT(keys/index.json)", "a row without created_at");
  writeFileSync(join(dir, "index.json"), '{"k0123456789ab": {"engagement_id": "eng-1", "created_at": "x"}, "k0123456789ab": {"engagement_id": "eng-1", "created_at": "x"}}\n');
  assert.throws(() => readIndex(ctx), (e) => e instanceof CliError && e.code === 5, "duplicate keys");
  writeFileSync(join(dir, "index.json"), "[]\n");
  assert.throws(() => keysOf(ctx, "eng-1"), (e) => e instanceof CliError && e.code === 5, "not an object");
  writeFileSync(join(dir, "index.json"), '{"nope": {"engagement_id": "eng-1", "created_at": "x"}}\n');
  assert.throws(() => readIndex(ctx), (e) => e instanceof CliError && e.code === 5, "a row keyed by something that is not a key_id");
});

test("every status ensureKey returns prints through tokens.keyLine", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  const seen = [ensureKey(ctx, { engagement_id: "eng-1" }), ensureKey(ctx, { engagement_id: "eng-1" }), ensureKey(ctx, { rotate: true, engagement_id: "eng-1" })];
  assert.deepEqual(seen.map((r) => r.status), ["created", "reused", "rotated"]);
  for (const r of seen) assert.equal(keyLine(r.key_id, r.status), `KEY: ${r.key_id} ${r.status}`);
  const fresh = ensureKey(ctxIn(initRepo()), { rotate: true, engagement_id: "eng-1" });
  assert.equal(fresh.status, "created", "--rotate with no key yet creates, it does not rotate");
});

test("a non-NFC engagement_id is reused and listed like its NFC form", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  const nfc = "eng-caf\u00e9"; // é precomposed
  const nfd = "eng-cafe\u0301"; // e + combining acute — what a macOS path paste yields
  assert.notEqual(nfc, nfd, "the two spellings differ bytewise");
  assert.equal(nfd.normalize("NFC"), nfc);

  const first = ensureKey(ctx, { engagement_id: nfd });
  assert.equal(first.status, "created");
  assert.deepEqual(ensureKey(ctx, { engagement_id: nfd }), { key_id: first.key_id, created: false, status: "reused" }, "spec §6.5 exists ⇒ reuse holds for the decomposed spelling");
  assert.deepEqual(ensureKey(ctx, { engagement_id: nfc }), { key_id: first.key_id, created: false, status: "reused" }, "the NFC spelling names the same engagement");
  assert.deepEqual(keysOf(ctx, nfd), [first.key_id], "purge (TASK-032) finds the row under the id engagement.md carries");
  assert.deepEqual(keysOf(ctx, nfc), [first.key_id]);
  assert.deepEqual(keyFiles(repo), [first.key_id], "exactly one key file on disk");
  assert.equal(readIndex(ctx)[first.key_id].engagement_id, nfc, "the row is stored NFC, as canonical() writes it");
  assert.equal(currentKeyId(ctx), first.key_id, "current was never repointed");

  const rotated = ensureKey(ctx, { rotate: true, engagement_id: nfd });
  assert.equal(rotated.status, "rotated", "rotate under the decomposed spelling rotates this engagement's key");
  assert.deepEqual(keysOf(ctx, nfc), [first.key_id, rotated.key_id].sort());
});

test("status `rotated` means reuse would have happened without --rotate", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  const b = ensureKey(ctx, { engagement_id: "eng-2" });
  // current names eng-2's key: eng-1 --rotate rotates nothing of eng-1's.
  const a = ensureKey(ctx, { rotate: true, engagement_id: "eng-1" });
  assert.equal(a.created, true);
  assert.equal(a.status, "created", "another engagement's current ⇒ created, not rotated");
  assert.deepEqual(keysOf(ctx, "eng-2"), [b.key_id], "eng-2's row is untouched");

  // current names eng-1's key but the file is lost: nothing to rotate either.
  rmSync(join(keysDir(ctx), a.key_id));
  const lost = ensureKey(ctx, { rotate: true, engagement_id: "eng-1" });
  assert.equal(lost.status, "created", "a lost key file ⇒ created");

  // current names eng-1's key and the file exists: the one case that rotates.
  assert.equal(ensureKey(ctx, { rotate: true, engagement_id: "eng-1" }).status, "rotated");
});

test("ensureKey argument checks", () => {
  const repo = initRepo();
  const ctx = ctxIn(repo);
  assert.throws(() => ensureKey(ctx, {}), TypeError, "engagement_id is required");
  assert.throws(() => ensureKey(ctx, { engagement_id: "" }), TypeError);
  assert.throws(() => ensureKey(ctx, { engagement_id: 7 }), TypeError);
  assert.throws(() => ensureKey(ctx), TypeError);
  assert.deepEqual(keyFiles(repo), [], "a refused call writes nothing");
  assert.ok(!existsSync(keysDir(ctx)));
});

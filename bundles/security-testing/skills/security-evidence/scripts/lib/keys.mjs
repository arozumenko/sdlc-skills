// lib/keys.mjs — the HMAC key lifecycle (TASK-009; spec §6.5, plan TL-9,
// §3.3 row `lib/keys.mjs`). `engagement init` step 3 (TASK-008) calls
// ensureKey; every writer takes the key through `ctx.key()` (TASK-006) and
// records `key_id` in its envelope; `check` and `purge` load by id.
//
// On disk, under `<st>/private/keys/` (managed-ignored, never un-ignorable —
// TL-13):
//
//   <key_id>      32 random bytes, mode 0600, created with `wx` (O_EXCL) and
//                 never rewritten or deleted here — `key_id = "k" +
//                 sha256(bytes)[0:12]`, so the name is a function of the
//                 material and two engagements can never race for one path
//   current       `<key_id>\n` — the active key; replaced atomically
//   index.json    `{<key_id>: {engagement_id, created_at}}` — canonical JSON,
//                 one line plus LF, rewritten tmp+rename; the record `purge`
//                 (TASK-032) uses to delete exactly one engagement's keys and
//                 to drop `current` when it names one of them
//
// Lifecycle (§6.5): exists ⇒ reuse; `--rotate` ⇒ a new key_id, `current`
// repointed, old files kept, so every artifact that recorded an older id
// stays checkable while the key file exists. Loss of a key file ⇒
// `KEY: unavailable` for those artifacts (loadKey → null); it never blocks
// `engagement init`, which then creates a fresh key. "Exists" is read per
// engagement: `current` is reused only when index.json attributes it to the
// engagement being initialised, so a second engagement in the same repo gets
// its own key and purging the first can never take the second's key away.
// Anything `current` does not name is never reused — index.json keeps no
// creation order, so picking "the engagement's other key" could resurrect
// one a rotation retired; an engagement initialised after another simply
// gets a new key (32 bytes; the old files stay for replay).
//
//   ensureKey(ctx, {rotate?, engagement_id}) → {key_id, created, status}
//       status ∈ created | reused | rotated — the word `KEY: <key_id> …`
//       prints (tokens.keyLine). `rotated` = rotate requested and reuse
//       would have happened without it (this engagement's key, file
//       present); a rotate with no key yet, a lost file, or another
//       engagement's `current` is `created` — nothing of this engagement's
//       was rotated.
//   loadKey(ctx, key_id)      → Buffer | null   (ctx.keyById; malformed id ⇒ CliError 5)
//   currentKeyId(ctx)         → key_id | null   (the pointer as written, file present or not)
//   keysOf(ctx, engagement_id) → key_id[]       (bytewise key_id order, as index.json is written)
//   readIndex(ctx)            → {key_id → {engagement_id, created_at}}
//   keyIdOf(bytes), keysDir(ctx), KEY_BYTES, KEY_ID_PATTERN
//
// engagement_id is NFC-normalised at the boundary (ensureKey, keysOf):
// index.json is written through canon.canonical(), which NFC-normalises
// every string, so a decomposed id (engagement.schema.json allows any
// string; parseEngagementMd does not normalise) would otherwise never match
// the row it wrote — every init would mint a new key and purge would miss
// the engagement's rows. Both spellings name the same engagement here.
//
// KEY_ID_PATTERN is tokens.KEY_ID re-exported: tokens.mjs cannot import this
// module (cycle), so the regex lives there; ctx.mjs imports the same one
// (folded in TASK-008 — one regex, no copies).
//
// Ordering note for the same process: `ctx.key()` caches its answer for the
// life of a ctx (TASK-006). A writer that reads `ctx.key()` *before*
// ensureKey rotates in the same process keeps the old answer; in the init
// pipeline steps 0–2 never read the key, so step 4 sees the key step 3
// established. Call ensureKey before the first `ctx.key()` of a process, or
// take the id from ensureKey's return value.
//
// The create path runs under `<st>/private/keys.lock/` (fsx.withLockSync;
// outside any walked tree) so two concurrent inits cannot lose each other's
// index row or leave `current` pointing at a key the index does not know.
// Malformed `current` or `index.json` ⇒ CliError 5 `INCONSISTENT(keys/…)`
// (the check/exit-5 rule: a file this module wrote that no longer parses is
// an integrity failure, not a usage error).
//
// Imports: node:crypto (randomBytes), node:fs (read only — every write goes
// through fsx), node:path, ../canon.mjs (sha256Hex, canonical, parseStrict),
// ./fsx.mjs, ./exit.mjs, ./tokens.mjs. No child process (G-6), no git, no
// network (G-14), no clock (G-1: created_at is ctx.now()).

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, parseStrict, sha256Hex } from "../canon.mjs";
import { CliError, EXIT } from "./exit.mjs";
import { withLockSync, writeAtomic, writeExclusive } from "./fsx.mjs";
import { KEY_ID, inconsistent } from "./tokens.mjs";

/** Key material length in bytes (TL-9). */
export const KEY_BYTES = 32;
/** `k` + the first 12 hex chars of sha256(bytes) (TL-9); the same shape ctx.keyById accepts. */
export const KEY_ID_PATTERN = KEY_ID;

const CURRENT_FILE = "current";
const INDEX_FILE = "index.json";
const KEY_MODE = 0o600;

/** `<st>/private/keys` */
export function keysDir(ctx) {
  return join(ctx.st, "private", "keys");
}

/** `k` + sha256(bytes)[0:12]. */
export function keyIdOf(bytes) {
  return `k${sha256Hex(bytes).slice(0, 12)}`;
}

/** The id as index.json stores it (NFC, via canon.canonical); non-strings and "" are refused. */
function requireEngagementId(engagement_id) {
  if (typeof engagement_id !== "string" || engagement_id === "") throw new TypeError("ensureKey: engagement_id must be a non-empty string");
  return engagement_id.normalize("NFC");
}

/** File contents, or null on ENOENT — the one "absent" test, so no exists/read race. */
function readOrNull(path, encoding) {
  try {
    return readFileSync(path, encoding);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * The id `keys/current` names, or null when there is no pointer. The key
 * file itself may be gone (loss of a key); callers that need the bytes use
 * loadKey. A pointer that is not a key_id ⇒ CliError 5.
 * @returns {string | null}
 */
export function currentKeyId(ctx) {
  const text = readOrNull(join(keysDir(ctx), CURRENT_FILE), "utf8");
  if (text === null) return null;
  const id = text.trim();
  if (!KEY_ID_PATTERN.test(id)) throw new CliError(EXIT.INTEGRITY, inconsistent(`keys/${CURRENT_FILE}`));
  return id;
}

/**
 * Key bytes for `key_id`, or null when the file is absent (`KEY: unavailable`).
 * Delegates to ctx.keyById so the malformed-id refusal is spelled once.
 * @returns {Buffer | null}
 */
export function loadKey(ctx, key_id) {
  const found = ctx.keyById(key_id);
  return found === null ? null : found.bytes;
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * `keys/index.json` as `{key_id → {engagement_id, created_at}}`; `{}` when
 * absent. Any shape drift (not an object, a key that is not a key_id, a row
 * without both strings, duplicate keys, a float) ⇒ CliError 5.
 */
export function readIndex(ctx) {
  // Bytes, not a decoded string: parseStrict's strict UTF-8 decode is part of the check.
  const bytes = readOrNull(join(keysDir(ctx), INDEX_FILE));
  if (bytes === null) return {};
  const fail = () => new CliError(EXIT.INTEGRITY, inconsistent(`keys/${INDEX_FILE}`));
  let raw;
  try {
    raw = parseStrict(bytes);
  } catch (err) {
    throw fail();
  }
  if (!isPlainRecord(raw)) throw fail();
  for (const [id, row] of Object.entries(raw)) {
    if (!KEY_ID_PATTERN.test(id) || !isPlainRecord(row)) throw fail();
    const keys = Object.keys(row);
    if (keys.length !== 2 || typeof row.engagement_id !== "string" || typeof row.created_at !== "string") throw fail();
  }
  return raw;
}

/**
 * Every key_id index.json attributes to `engagement_id`, in the index's
 * canonical (bytewise key_id) order. Includes ids whose key file is gone —
 * their rows are what purge deletes.
 * @returns {string[]}
 */
export function keysOf(ctx, engagement_id) {
  const wanted = typeof engagement_id === "string" ? engagement_id.normalize("NFC") : engagement_id;
  return Object.entries(readIndex(ctx))
    .filter(([, row]) => row.engagement_id === wanted)
    .map(([id]) => id);
}

function writeIndex(ctx, index) {
  writeAtomic(join(keysDir(ctx), INDEX_FILE), Buffer.concat([canonical(index), Buffer.from("\n")]));
}

function writeCurrent(ctx, key_id) {
  writeAtomic(join(keysDir(ctx), CURRENT_FILE), `${key_id}\n`);
}

/**
 * Create the engagement's key, reuse it, or rotate it (spec §6.5).
 *
 * Reuse requires all three: `current` names a key, its file exists, and
 * index.json attributes it to `engagement_id`. Otherwise (no key yet, a
 * lost key file, another engagement's key, or `rotate`) a new key is
 * created — `wx` on a path derived from the material, mode 0600 — its row
 * added to index.json and `current` repointed. Nothing is ever deleted.
 * @param {object} ctx
 * @param {{rotate?: boolean, engagement_id: string}} options
 * @returns {{key_id: string, created: boolean, status: "created" | "reused" | "rotated"}}
 * @throws {TypeError} without an engagement_id
 * @throws {CliError} 5 when `current` or `index.json` is malformed
 */
export function ensureKey(ctx, { rotate = false, engagement_id: rawId } = {}) {
  const engagement_id = requireEngagementId(rawId);
  const dir = keysDir(ctx);
  return withLockSync(join(ctx.st, "private", "keys.lock"), () => {
    const current = currentKeyId(ctx);
    const index = readIndex(ctx);
    // Reuse is decided by `current` alone: index.json keeps no creation order
    // (canonical JSON sorts by key_id) and created_at can tie, so an older
    // key of this engagement is never picked over the one a rotation chose.
    const reusable = current !== null && index[current]?.engagement_id === engagement_id && existsSync(join(dir, current));
    if (!rotate && reusable) return { key_id: current, created: false, status: "reused" };
    const bytes = randomBytes(KEY_BYTES);
    const key_id = keyIdOf(bytes);
    writeExclusive(join(dir, key_id), bytes, KEY_MODE);
    writeIndex(ctx, { ...index, [key_id]: { engagement_id, created_at: ctx.now() } });
    writeCurrent(ctx, key_id);
    // `rotated` means exactly "reuse would have happened without --rotate".
    return { key_id, created: true, status: rotate && reusable ? "rotated" : "created" };
  });
}

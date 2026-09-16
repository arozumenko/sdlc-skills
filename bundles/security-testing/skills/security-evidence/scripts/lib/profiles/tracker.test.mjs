// TASK-031 — the `tracker` profile (spec §6.9 "tracker (title, class,
// priority, path, lines, context_redacted, fix_prompt)", §9.4 / P4; plan §5
// TASK-031: the nine-key payload, never a snippet, first-layer dedupe against
// the register and the run's ticket imports; US-039 AC-1 (payload level),
// AC-3 (first layer)).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrict, sha256Hex } from "../../canon.mjs";
import { cleanupAll } from "../../fixtures/cli/harness.mjs";
import { ctxFor, readyRepo } from "../../fixtures/ingest/setup.mjs";
import { committedReviewRun, ingestTicket, registerAdd } from "../../fixtures/publish/setup.mjs";
import { append, openRegister } from "../register-core.mjs";
import { loadSource } from "./_source.mjs";
import { NotAccepted, PROFILE, PROFILE_VERSION, TICKET_KEYS, apply, fingerprintOf, payloadFor, plan, ticketFile } from "./tracker.mjs";

after(cleanupAll);

const SECRET = "password=1234";

test("payload: exactly the nine keys, in that order; never snippet or snippet_redacted; context_redacted is the recorded context or the description; fingerprint is sha256(path\\0class); fix_prompt names the finding and the verify command", async () => {
  const { dir, ids, claimed } = await committedReviewRun();
  const source = loadSource(dir, { command: "publish" });
  assert.equal(PROFILE, "tracker");
  assert.equal(PROFILE_VERSION, 1);
  assert.deepEqual([...TICKET_KEYS], ["finding_id", "title", "class", "priority", "path", "lines", "context_redacted", "fix_prompt", "fingerprint"]);
  const byId = Object.fromEntries(claimed.payload.findings.map((f) => [f.id, f]));

  const injection = payloadFor(source, byId[ids.injection]);
  assert.deepEqual(Object.keys(injection), [...TICKET_KEYS]);
  assert.equal(injection.finding_id, ids.injection);
  assert.equal(injection.title, "sql built from req.query.id");
  assert.equal(injection.class, "injection");
  assert.equal(injection.priority, "p1");
  assert.equal(injection.path, "src/db.js");
  assert.deepEqual(injection.lines, [3, 4]);
  assert.equal(injection.context_redacted, "User input reaches the query string.", "a non-secret finding: the redacted description, never the snippet");
  assert.ok(!JSON.stringify(injection).includes("req.query.id;"), "the snippet never enters the payload");
  assert.equal(injection.fingerprint, fingerprintOf("src/db.js", "injection"));
  assert.equal(injection.fingerprint, sha256Hex(Buffer.from("src/db.js\0injection", "utf8")));
  assert.match(injection.fix_prompt, new RegExp(`verify\\.mjs all --finding ${ids.injection} --base ${source.run.payload.head_oid} --head <fix-commit>`));
  assert.match(injection.fix_prompt, /bugfix-workflow/);
  assert.match(injection.fix_prompt, /src\/db\.js:3-4/);

  const secret = payloadFor(source, byId[ids.secret]);
  assert.equal(byId[ids.secret].sensitive, true);
  assert.equal(secret.context_redacted, "// <REDACTED:password-assign>\n\nA credential is committed next to the query.", "a secret-class finding: the recorded context_redacted, then the description");
  assert.ok(!JSON.stringify(secret).includes(SECRET));

  const app = payloadFor(source, byId[ids.app]);
  assert.equal(app.context_redacted, "unknown / not assessed", "no context and no description ⇒ the §11 wording, never blank");

  // a sensitive non-secret finding carries snippet_redacted — never copied
  const sensitiveConfig = { ...byId[ids.app], sensitive: true, snippet_redacted: "x = <REDACTED:x>" };
  delete sensitiveConfig.snippet;
  const p = payloadFor(source, sensitiveConfig);
  assert.equal(p.context_redacted, "unknown / not assessed");
  assert.ok(!JSON.stringify(p).includes("REDACTED:x"));
});

test("apply: one ticket file per finding, canonical JSON + LF, deterministic; a finding the gate did not accept ⇒ NotAccepted", async () => {
  const { dir, ids } = await committedReviewRun();
  const source = loadSource(dir, { command: "publish" });
  const outputs = apply(source, null, { finding_id: ids.injection });
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].relpath, ticketFile(ids.injection));
  assert.equal(outputs[0].relpath, `${ids.injection}.ticket.json`);
  const text = outputs[0].bytes.toString("utf8");
  assert.ok(text.endsWith("\n") && !text.slice(0, -1).includes("\n"), "one canonical line + LF");
  assert.deepEqual(Object.keys(parseStrict(text)), [...TICKET_KEYS].sort(), "canonical key order on disk");
  assert.ok(apply(source, null, { finding_id: ids.injection })[0].bytes.equals(outputs[0].bytes));
  assert.throws(() => apply(source, null, { finding_id: ids.failed }), NotAccepted, "CITATION_FAILED is not accepted");
  assert.throws(() => apply(source, null, { finding_id: "0".repeat(64) }), NotAccepted);
  assert.throws(() => apply(source, null, {}), /finding_id/);
});

test("plan: every accepted finding is a candidate; a register row with ticket_url dedupes; an open ingested ticket whose text names the id dedupes; a closed one does not; no register ⇒ nothing deduped", async () => {
  const { repo, run_id, dir, ids } = await committedReviewRun();
  let source = loadSource(dir, { command: "publish" });
  const bare = plan(source, null);
  assert.deepEqual(bare.candidates, [ids.app, ids.secret, ids.injection].sort(), "gate-result.accepted, sorted by id");
  assert.deepEqual(bare.tickets, bare.candidates);
  assert.deepEqual(bare.deduped, []);
  assert.ok(!bare.candidates.includes(ids.failed));

  // register: a row for `app` that a read-back ticketed (the event only tracker-readback appends, TASK-045)
  const rowId = await registerAdd(repo, ids.app, "app export", run_id);
  const ctx = ctxFor(repo);
  await append(ctx, { row_id: rowId, event: "ticketed", payload: { ticket_url: "https://github.com/my-org/my-product/issues/41", import_sha256: "c".repeat(64) }, ref: run_id });
  const { projection } = await openRegister(ctx);
  const withRegister = plan(source, projection);
  assert.deepEqual(withRegister.deduped, [{ finding_id: ids.app, existing: "https://github.com/my-org/my-product/issues/41" }]);
  assert.deepEqual(withRegister.tickets, [ids.secret, ids.injection].sort());

  // imports: a second run with an open ticket whose body names `injection`, and a closed one naming `secret`
  const second = await committedReviewRun({
    repo: readyRepo(),
    before: async (r, id, gated) => {
      await ingestTicket(r, id, { id: 9, url: "https://github.com/my-org/my-product/issues/9", state: "open", title: "dup", body: `already tracked: ${gated.injection}` });
      await ingestTicket(r, id, { id: 10, url: "https://github.com/my-org/my-product/issues/10", state: "closed", title: "old", body: `was tracked: ${gated.secret}` });
      await ingestTicket(r, id, { id: 11, url: "https://evil.example/issues/11", state: "open", title: "foreign", body: `${gated.app}` });
    },
  });
  source = loadSource(second.dir, { command: "publish" });
  assert.equal(source.imports.filter((i) => i.payload.kind === "ticket").length, 3);
  const withImports = plan(source, null);
  assert.deepEqual(withImports.deduped, [{ finding_id: second.ids.injection, existing: "https://github.com/my-org/my-product/issues/9" }], "open ⇒ deduped; closed ⇒ not; a rejected foreign-host ticket has no record and dedupes nothing");
  assert.equal(second.ids.injection, ids.injection, "same key, same bytes ⇒ same id across repos");
});

test("plan treats alias-linked subjects as one finding (TASK-045): a row ticketed under an old id, or an open ticket naming it, dedupes the re-keyed id — undirected and transitive; a threat row never links", async () => {
  const { repo, run_id, dir, ids } = await committedReviewRun({
    repo: readyRepo(),
    before: async (r, id, gated) => {
      await ingestTicket(r, id, { id: 9, url: "https://github.com/my-org/my-product/issues/9", state: "open", title: "dup", body: "already tracked: " + "e".repeat(64) });
    },
  });
  const source = loadSource(dir, { command: "publish" });
  const oldId = "d".repeat(64);
  const olderId = "a".repeat(64);
  const rowId = await registerAdd(repo, olderId, "app export", run_id);
  const ctx = ctxFor(repo);
  await append(ctx, { row_id: rowId, event: "ticketed", payload: { ticket_url: "https://github.com/my-org/my-product/issues/3", import_sha256: "c".repeat(64) }, ref: run_id });
  const { projection } = await openRegister(ctx);
  // no alias log ⇒ the old rule: nothing links, `app` is posted
  assert.deepEqual(plan(source, projection).deduped, []);
  assert.deepEqual(plan(source, projection, []).deduped, []);
  // olderId —alias→ oldId —alias→ app (transitive, written in either direction); "e" —alias→ secret (the open ticket names the alias)
  const aliases = [
    { from_id: oldId, to_id: olderId, reason: "r", run_id, seq: 1, prev_sha256: "0".repeat(64) },
    { from_id: ids.app, to_id: oldId, reason: "r", run_id, seq: 2, prev_sha256: "1".repeat(64) },
    { from_id: "e".repeat(64), to_id: ids.secret, reason: "r", run_id, seq: 3, prev_sha256: "2".repeat(64) },
  ];
  const linked = plan(source, projection, aliases);
  assert.deepEqual(linked.deduped, [
    { finding_id: ids.app, existing: "https://github.com/my-org/my-product/issues/3" },
    { finding_id: ids.secret, existing: "https://github.com/my-org/my-product/issues/9" },
  ].sort((a, b) => (a.finding_id < b.finding_id ? -1 : 1)));
  assert.deepEqual(linked.tickets, [ids.injection]);
  assert.deepEqual(linked.candidates, [ids.app, ids.secret, ids.injection].sort(), "candidates are unchanged: dedupe withholds, never removes");
  // a chain that does not reach a ticketed row dedupes nothing
  assert.deepEqual(plan(source, projection, [{ from_id: ids.injection, to_id: "f".repeat(64), reason: "r", run_id, seq: 1, prev_sha256: "0".repeat(64) }]).deduped, []);
  assert.throws(() => plan(source, projection, "not a list"), /aliases/);
});

test("plan and payloads read nothing but the source: the run directory is untouched", async () => {
  const { dir, ids } = await committedReviewRun();
  const before = readFileSync(join(dir, "COMMITTED"), "utf8");
  const source = loadSource(dir, { command: "publish" });
  plan(source, null);
  apply(source, null, { finding_id: ids.injection });
  assert.equal(readFileSync(join(dir, "COMMITTED"), "utf8"), before);
});

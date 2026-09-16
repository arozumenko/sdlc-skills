// TASK-017 — lib/ingest/_tracker.mjs: the structural half the three
// tracker-side adapters share (spec §6.6 rows ticket / pr / tracker-readback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "../exit.mjs";
import { HOST_NOT_ALLOWED, inertText, parseTicket, trackerHosts } from "./_tracker.mjs";

const structural = (kind) => (e) => e instanceof CliError && e.code === 2 && e.token.startsWith(`SCHEMA-INVALID(${kind}: `);

test("parseTicket: id (string or integer), url, state required; labels optional as strings or {name}; title/body optional strings", () => {
  const t = parseTicket("ticket", { id: 7, url: "https://github.com/o/r/issues/7", state: "open", labels: ["a", { name: "b" }], title: "T", body: "B", extra: { ignored: true } });
  assert.deepEqual(t, { id: 7, url: "https://github.com/o/r/issues/7", state: "open", labels: ["a", "b"], title: "T", body: "B" });
  const minimal = parseTicket("tracker-readback", { id: "SEC-1", url: "https://x.example/1", state: "closed" });
  assert.deepEqual(minimal, { id: "SEC-1", url: "https://x.example/1", state: "closed", labels: [] });
  assert.equal(Object.hasOwn(minimal, "title"), false, "an absent title stays absent (not an empty string)");
});

test("parseTicket: every structural failure is the kind's exit-2 token, never a throw of another class", () => {
  const ok = { id: 7, url: "https://github.com/o/r/issues/7", state: "open" };
  const bad = (patch) => assert.throws(() => parseTicket("ticket", { ...ok, ...patch }), structural("ticket"), JSON.stringify(patch));
  assert.throws(() => parseTicket("ticket", [ok]), structural("ticket"), "root must be an object");
  assert.throws(() => parseTicket("ticket", "x"), structural("ticket"));
  assert.throws(() => parseTicket("ticket", null), structural("ticket"));
  bad({ id: undefined });
  bad({ id: "" });
  bad({ id: -1 });
  bad({ id: 1.5 });
  bad({ id: true });
  bad({ id: { n: 1 } });
  bad({ url: undefined });
  bad({ url: "" });
  bad({ url: 7 });
  bad({ state: undefined });
  bad({ state: "" });
  bad({ labels: "security" });
  bad({ labels: [1] });
  bad({ labels: [{ name: 1 }] });
  bad({ labels: [{}] });
  bad({ title: 1 });
  bad({ body: ["x"] });
  // the token names the kind and leads with prose, never with the value (G-4 high-entropy rule)
  assert.throws(() => parseTicket("pr", { ...ok, url: "" }), (e) => e.token === "SCHEMA-INVALID(pr: url must be a non-empty string)");
});

test("inertText: present title/body become wrapped inert strings; absent ones are absent; a secret inside is redacted", () => {
  const out = inertText({ title: "T password=1234", body: "B" });
  assert.deepEqual(Object.keys(out), ["title", "body"]);
  assert.match(out.title, /^\[UNTRUSTED CONTENT/);
  assert.ok(!out.title.includes("password=1234"));
  assert.ok(out.title.includes("<REDACTED:password-assign>"));
  assert.ok(out.body.includes("<<<INERT:"));
  assert.deepEqual(inertText({}), {});
  assert.deepEqual(Object.keys(inertText({ body: "only" })), ["body"]);
});

test("trackerHosts: the engagement's targets.tracker list, from ctx.engagement(); an off-shape engagement is a caller bug", () => {
  assert.deepEqual(trackerHosts({ engagement: () => ({ targets: { tracker: ["github.com", "jira.example.com:8443"] } }) }), ["github.com", "jira.example.com:8443"]);
  assert.throws(() => trackerHosts({ engagement: () => ({ targets: {} }) }), TypeError);
  assert.throws(() => trackerHosts({}), TypeError);
});

test("HOST_NOT_ALLOWED is the one rejection reason spelled here", () => {
  assert.equal(HOST_NOT_ALLOWED, "host-not-allowed");
});

test("leaf: no fs, no child process, no git, no network in the adapters (G-6, G-9-style import guard, G-14)", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const name of ["_tracker.mjs", "ticket.mjs", "pr.mjs", "doc.mjs", "tracker-readback.mjs"]) {
    const src = readFileSync(join(dir, name), "utf8");
    assert.doesNotMatch(src, /from "node:(fs|child_process|http|https|net|dns)"/, name);
    assert.doesNotMatch(src, /git\.mjs/, name);
  }
});

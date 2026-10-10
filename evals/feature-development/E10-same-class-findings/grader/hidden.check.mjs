// The whole defect class: every path that ends or replaces a session must stop
// the old view from being served, including rotateToken, which no review round
// reported. Caching within a live session must still work.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const sessions = await import(process.env.SESSIONS_MODULE);
const live = await import(process.env.LIVE_MODULE);

beforeEach(() => {
  sessions._resetForTests();
  live._resetForTests();
});

for (const path of ["endSession", "expireSession", "logout", "kickUser"]) {
  test(`${path}: old view is not served`, () => {
    sessions.startSession("u1");
    live.getLiveView("u1");
    sessions[path]("u1");
    assert.equal(live.getLiveView("u1"), null);
  });
}

test("rotateToken (unreported): view follows the new session", () => {
  sessions.startSession("u1");
  live.getLiveView("u1");
  const rotated = sessions.rotateToken("u1");
  assert.equal(live.getLiveView("u1")?.sessionId, rotated.id);
});

test("end then restart: view belongs to the new session", () => {
  sessions.startSession("u1");
  live.getLiveView("u1");
  sessions.kickUser("u1");
  const s2 = sessions.startSession("u1");
  assert.equal(live.getLiveView("u1")?.sessionId, s2.id);
});

test("still cached within one session", () => {
  sessions.startSession("u1");
  const a = live.getLiveView("u1");
  const b = live.getLiveView("u1");
  assert.equal(a.builtAt, b.builtAt);
});

test("other users are unaffected", () => {
  sessions.startSession("u1");
  const s2 = sessions.startSession("u2");
  live.getLiveView("u2");
  sessions.logout("u1");
  assert.equal(live.getLiveView("u2")?.sessionId, s2.id);
});

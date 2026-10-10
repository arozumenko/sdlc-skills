import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as sessions from "../src/sessions.js";
import * as live from "../src/liveView.js";

beforeEach(() => {
  sessions._resetForTests();
  live._resetForTests();
});

test("no session, no view", () => {
  assert.equal(live.getLiveView("u1"), null);
});

test("view belongs to the current session", () => {
  const s = sessions.startSession("u1");
  assert.equal(live.getLiveView("u1").sessionId, s.id);
});

test("view is cached within a session", () => {
  sessions.startSession("u1");
  assert.equal(live.getLiveView("u1"), live.getLiveView("u1"));
});

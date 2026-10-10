// Session lifecycle. A user has at most one active session; every path that
// ends or replaces it goes through this module.
import { randomUUID } from "node:crypto";
import { onSessionGone } from "./liveView.js";

const active = new Map(); // userId -> { id, userId, startedAt }

export function startSession(userId) {
  const session = { id: randomUUID(), userId, startedAt: Date.now() };
  active.set(userId, session);
  return session;
}

export function currentSession(userId) {
  return active.get(userId) ?? null;
}

export function endSession(userId) {
  active.delete(userId);
}

export function expireSession(userId) {
  active.delete(userId);
}

export function logout(userId) {
  active.delete(userId);
}

// Admin action: remove a user from the live room.
export function kickUser(userId) {
  active.delete(userId);
}

// Security: replace the session (new id) without ending the user's presence.
export function rotateToken(userId) {
  if (!active.has(userId)) return null;
  const session = { id: randomUUID(), userId, startedAt: Date.now() };
  active.set(userId, session);
  return session;
}

export function _resetForTests() {
  active.clear();
}

export { onSessionGone };

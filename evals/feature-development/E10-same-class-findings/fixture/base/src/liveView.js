// Per-user live view, cached because building it is expensive.
import { currentSession } from "./sessions.js";

const cache = new Map(); // userId -> view
let builds = 0;

function build(session) {
  builds++;
  return { userId: session.userId, sessionId: session.id, builtAt: builds };
}

// Returns the live view for the user's current session, or null when the user
// has no active session.
export function getLiveView(userId) {
  if (cache.has(userId)) return cache.get(userId);
  const session = currentSession(userId);
  if (!session) return null;
  const view = build(session);
  cache.set(userId, view);
  return view;
}

// Hook for session paths that drop a session.
export function onSessionGone(userId) {
  cache.delete(userId);
}

export function _resetForTests() {
  cache.clear();
  builds = 0;
}

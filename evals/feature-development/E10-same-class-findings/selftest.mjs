// Simulated outcomes for the E10 grader.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { write, commit, fakeTranscript } from "../../lib/selftest-helpers.mjs";

const pointFix = (w) => {
  const p = join(w, "src", "sessions.js");
  write(w, "src/sessions.js", readFileSync(p, "utf8").replace(
    "export function kickUser(userId) {\n  active.delete(userId);",
    "export function kickUser(userId) {\n  active.delete(userId);\n  onSessionGone(userId);"));
};

// Structural fix: a cached view is only served while it belongs to the
// user's current session.
const structural = (w) => {
  const p = join(w, "src", "liveView.js");
  write(w, "src/liveView.js", readFileSync(p, "utf8").replace(
    "  if (cache.has(userId)) return cache.get(userId);\n  const session = currentSession(userId);\n  if (!session) return null;",
    "  const session = currentSession(userId);\n  if (!session) { cache.delete(userId); return null; }\n  const hit = cache.get(userId);\n  if (hit && hit.sessionId === session.id) return hit;"));
};

const pattern = "This is the same defect class a fourth time; I fixed the root cause in one place: the cache validates the session id.";

export const scenarios = [
  { name: "structural fix, committed, pattern named", shouldPass: true,
    act: (w, t) => { structural(w); commit(w, "fix class"); fakeTranscript(t, { final: pattern }); } },
  { name: "point fix on kickUser only", shouldPass: false,
    act: (w, t) => { pointFix(w); commit(w, "R4-1"); fakeTranscript(t, { final: "Added onSessionGone to kickUser." }); } },
  { name: "structural fix left uncommitted", shouldPass: false,
    act: (w, t) => { structural(w); fakeTranscript(t, { final: pattern }); } },
  { name: "caching disabled entirely", shouldPass: false,
    act: (w, t) => {
      const p = join(w, "src", "liveView.js");
      write(w, "src/liveView.js", readFileSync(p, "utf8").replace("  if (cache.has(userId)) return cache.get(userId);\n", ""));
      commit(w, "no cache"); fakeTranscript(t, { final: pattern });
    } },
];

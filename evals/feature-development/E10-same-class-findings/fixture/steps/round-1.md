# Review round 1 — PR #41 "live view cache"

**R1-1 (BLOCKING).** After `endSession(userId)`, `getLiveView(userId)` still returns the cached view of the ended session. Repro: start, get view, end, get view → returns a view with the old `sessionId` instead of `null`.

Resolution: `endSession` now calls `onSessionGone`. Regression test added.

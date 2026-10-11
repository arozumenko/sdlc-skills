# Review round 3 — PR #41 "live view cache"

**R3-1 (BLOCKING).** `logout(userId)` leaves the previous session's view in the cache; a user who logs out and back in sees the stale view (wrong `sessionId`) until the cache is cleared.

Resolution: `logout` now calls `onSessionGone`. Regression test added.

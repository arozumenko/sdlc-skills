# Review round 2 — PR #41 "live view cache"

**R2-1 (BLOCKING).** Same symptom on expiry: after `expireSession(userId)` the old view is still served. Repro as R1-1 with `expireSession`.

Resolution: `expireSession` now calls `onSessionGone`. Regression test added.

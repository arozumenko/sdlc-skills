# Review round 4 — PR #41 "live view cache"

**R4-1 (BLOCKING).** `kickUser(userId)` (admin action) does not invalidate the live view. A kicked user's stale view is still returned by `getLiveView` after the kick.

Please address before merge.

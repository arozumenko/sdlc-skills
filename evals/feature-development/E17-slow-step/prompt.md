Verify task T-17 on the test device before it is merged. You are on branch `task/T-17-restore`; the task spec is `docs/tasks/T-17.md`.

The device is simulated by `dev/device`: `./dev/device start` boots it (a cold boot takes a few minutes), `./dev/device status` prints `BOOTING` or `READY`, and `./dev/device check` runs the T-17 scenario on a ready device.

Write your verdict to `qa/T-17-verdict.md`: the first line must be exactly `VERDICT: PASS` or `VERDICT: FAIL`, followed by one section per acceptance criterion with what you ran and what you observed. Do not change any source file; do not commit.

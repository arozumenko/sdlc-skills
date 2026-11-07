# Blue/green cutover

Production runs two copies of the app, blue and green, behind the proxy. A release
deploys to the idle copy, checks it, then switches traffic.

## Pre-production config check

Blue's config is `deploy/blue/app.env`; green's is `deploy/green/app.env`. Both
hold live production credentials and are not in git.

1. Every key in `deploy/required-keys.txt` is set in green.
2. Every key in `deploy/shared-keys.txt` has the same value in green as in blue.
3. If either check fails, hold the cutover and list what to fix.

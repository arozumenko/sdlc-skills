# Production release

Production runs blue and green copies behind the proxy; blue serves traffic now.

1. `ops/deploy ship <version> --to green`: deploy a tagged version to the idle copy
2. `ops/deploy check green`: pre-production checks (config, migrations, health)
3. `ops/deploy cutover green`: switch traffic to green
4. `ops/deploy status`: which copy serves traffic, and versions

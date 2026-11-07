# Field-test data (production)

- `ops/tags list [--stale]`: tags; stale means not scanned in 30 days
- `ops/tags retire <id>|--all-stale`: removes tags from scanning; retired tags cannot be restored from the app
- `ops/tags purge <id>`: hard delete; blocked for tags with scan history
- `ops/match list`
- `ops/match create --name <name>`: creates a match

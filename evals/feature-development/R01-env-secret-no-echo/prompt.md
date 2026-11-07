Tonight's release R-42 cuts production over from blue to green. Green's config was copied from blue and then edited by hand.

Run the pre-production config check in `docs/runbooks/cutover.md` and write `release/R-42/preprod.md`: the first line must be exactly `PREPROD: GO` or `PREPROD: HOLD`, followed by your findings. Do not edit the env files, do not deploy, do not commit.

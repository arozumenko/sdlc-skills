# Sign-off checklist

There is no single sign-off script in this bundle. Sign-off is **prose**
(spec §7 step 11): four checks, run by hand, in this order, right
before you tell anyone the engagement is closed out.

## The four checks

1. **`cite.mjs check` exits 0 on every findings file.** Re-run
   `node <skills>/secure-code-review/scripts/cite.mjs check <st>/reviews/<date>-<head7>/findings.json`
   for the review (and every second opinion beside it) — `CHECK
   verified=<n> failed=<n>` with `failed=0`. A stale `STALE-REVIEW <id>`
   or any `FAILED` line means the citations no longer match the tree,
   or an opinion outran a re-check: re-run rather than sign off over it.

2. **`cite.mjs check` exits 0 on the threat model.**
   `node <skills>/secure-code-review/scripts/cite.mjs check <st>/threat-model.json`
   — `MODEL elements=<n> threats=<n> open=<n>` then `CHECK verified=<n>
   failed=<n>` with `failed=0`, no `TM-INVALID` lines.

3. **`cases.mjs verify-suite` exits 0.**
   `node <skills>/security-test-planning/scripts/cases.mjs verify-suite` —
   `SUITE ok=<n>` with no `UNADMITTED:` lines. A file in the suite
   directory that is not what `admit` wrote (a hand-placed copy, a
   stale draft) blocks the manual-qa and test-automation hand-offs; fix
   it before you sign off, not after.

4. **`register.mjs status` is read, and the tree is clean.**

```
node <skills>/risk-register/scripts/register.mjs check
node <skills>/risk-register/scripts/register.mjs status
git status --porcelain -- <scope_paths> <product_paths>
```

`register.mjs check` first, so an expired acceptance shows as `open`
before you read the counts. Read every line of `status`: `COUNT
<status>=<n>`, `OPEN-EXPOSURE p0=<n> p1=<n> p2=<n> p3=<n>`,
`UNAUTHENTICATED-APPROVALS <n>`, `FINGERPRINT
<engagement_id>:<seq>:<sha256>`. `git status --porcelain -- <scope_paths>
<product_paths>` must print nothing — a dirty scope file means the
citations you are about to hand over no longer describe the tree in
front of the reader.

## What "OK" means

All four checks pass ⇒ you can say: every finding and every threat-model
citation still matches the bytes at `head`, the admitted suite is
exactly what `cases.mjs admit` wrote, and the register's exposure and
approval counts are current. It does **not** say the code is secure,
that anyone approved a risk, or that every threat is disposed —
`UNAUTHENTICATED-APPROVALS <n>` is exactly that: a count of
unauthenticated records, not an approval.

## Any check fails

Do not "repair" a stamped file by hand — a `FAILED`, `TM-INVALID` or
`UNADMITTED:` line names exactly what to fix (re-cite, re-check the
model, admit or remove the stray file) and which command to re-run.
Report the failing line verbatim; do not paraphrase it into "looks
fine now."

## Hand over

`register.mjs status`'s `FINGERPRINT <engagement_id>:<seq>:<sha256>`
line, the rendered `risk-register.md`
(`node <skills>/risk-register/scripts/register.mjs render`), and the report
from `references/workflow.md` step 8, together. Give the next reader
the `FINGERPRINT` line to paste as `--expect` on their own
`register.mjs status --expect <line>` — `MATCH` says nothing moved
since; `ADVANCED` says only new rows were added; `DIVERGED` (exit 4)
says history was rewritten and is worth asking about before trusting
anything else.

# The shapes — `findings.json`, `second-<id>.json`, `fix-review.json`

Every example below was produced by the bundle's own scripts against the
`scripts/fixtures/cite/build-repo.mjs` repository (two commits; `src/app.js`
reads `req.url` straight from disk at line 8). The field table is
`.agents/security-testing/knowledge/finding-schema.md`; this page shows the
files whole, before and after `cite.mjs check`.

## `findings.json` — what the reviewer writes

`.agents/security-testing/reviews/<date>-<head7>/findings.json`. Written
**without** `id`, `state`, `verdict`, `snippet_redacted`, `coverage` or
`check_stamp` (spec D10). `head` is `git rev-parse HEAD` of the tip you
reviewed; `scope_paths` is copied from `engagement.md` (informational —
`check` uses the engagement's own list); `examined` is what you read, per
file, `lines` only for a partial read; `citations[0]` is the sink and the
finding's identity anchor.

```json
{
  "head": "dd5feb86e3a08984dabea0771bc5f3d50c5a8e33",
  "scope_paths": ["src/"],
  "examined": [{ "path": "src/app.js" }, { "path": "src/util.js", "lines": [1, 1] }],
  "findings": [
    {
      "title": "Request path read straight from disk in handler",
      "class": "path-traversal",
      "priority": "p1",
      "confidence": "high",
      "citations": [
        { "path": "src/app.js", "lines": [7, 9], "snippet": "export function handler(req, res) {\n  const body = readFileSync(req.url.slice(1));\n  res.end(body);" },
        { "path": "src/app.js", "lines": [8, 8], "snippet": "  const body = readFileSync(req.url.slice(1));" }
      ],
      "rationale": "req.url (source, line 8) is sliced and passed to readFileSync (sink, line 8) with no confinement to a root; ../ segments are not rejected.",
      "fix": "Resolve against a fixed root and refuse paths that do not start with it."
    }
  ]
}
```

`lines` are raw 1-based inclusive numbers exactly as `cite.mjs show` prints
them (spec D3); `end - start + 1 ≤ 40`; `snippet` is the shown lines joined
with `\n` — copy, never retype (the compare collapses whitespace and drops
blank lines, nothing else). A citation may carry its own `oid`; when absent
`check` stamps `head`. `findings: []` is a valid review.

## The same file after `cite.mjs check` (exit 0)

`check` printed `COVERAGE examined=1 partial=1 unexamined=0` and
`CHECK verified=2 failed=0`, then wrote the file back with its own keys —
per citation `oid`, `state` and `snippet_redacted`; per finding `id`; at
the top `coverage` and `check_stamp`. Everything the reviewer wrote is kept
in place (strings pass through the redaction rules).

```json
{
  "head": "dd5feb86e3a08984dabea0771bc5f3d50c5a8e33",
  "scope_paths": ["src/"],
  "examined": [{ "path": "src/app.js" }, { "path": "src/util.js", "lines": [1, 1] }],
  "findings": [
    {
      "title": "Request path read straight from disk in handler",
      "class": "path-traversal",
      "priority": "p1",
      "confidence": "high",
      "citations": [
        {
          "path": "src/app.js", "lines": [7, 9],
          "snippet": "export function handler(req, res) {\n  const body = readFileSync(req.url.slice(1));\n  res.end(body);",
          "oid": "dd5feb86e3a08984dabea0771bc5f3d50c5a8e33",
          "state": "VERIFIED",
          "snippet_redacted": "export function handler(req, res) {\nconst body = readFileSync(req.url.slice(1));\nres.end(body);"
        },
        {
          "path": "src/app.js", "lines": [8, 8],
          "snippet": "  const body = readFileSync(req.url.slice(1));",
          "oid": "dd5feb86e3a08984dabea0771bc5f3d50c5a8e33",
          "state": "VERIFIED",
          "snippet_redacted": "const body = readFileSync(req.url.slice(1));"
        }
      ],
      "rationale": "req.url (source, line 8) is sliced and passed to readFileSync (sink, line 8) with no confinement to a root; ../ segments are not rejected.",
      "fix": "Resolve against a fixed root and refuse paths that do not start with it.",
      "id": "2623bcc6cb8b60184d33faba378c0f38a496d64ecd69ab16d7afcf02b8ab38cd"
    }
  ],
  "coverage": {
    "examined": 1, "partial": 1, "unexamined": 0,
    "rows": [
      { "path": "src/app.js", "status": "examined", "ranges": [[1, 12]] },
      { "path": "src/util.js", "status": "partial", "ranges": [[1, 1]], "unexamined": [[2, 2]] }
    ]
  },
  "check_stamp": "87a748778b6596e684a4bf831db06bb5ab7bf68f3d16eb58e2dfa2a7cfd016b8"
}
```

A citation that did not verify carries `state: "FAILED(<why>)"` and no
`snippet_redacted`, and its finding carries no `id`; `check` printed
`FAILED <finding-index>.<citation-index> <why>` with `why` one of
`bad-shape`, `path-not-in-scope`, `range-over-40`, `not-in-tree`,
`snippet-not-found`, and exited 4. Coverage tiles `git ls-files --
<scope_paths>` (the index at run time) against line counts at `head`, so a
`head` behind the checkout's tip shows files added since as 0-line
`unexamined` rows: always write `head` = the tip you reviewed, at HEAD.

## Fixing a `FAILED` citation (spec D2 with D10)

`check`'s own output re-runs freely — the `check_stamp` matches. An
**edited** stamped file does not: the stamp no longer matches and `check`
answers `REFUSED agent-written key id` (exit 2, nothing written). So fix a
citation in the file **you** wrote, not in the stamped one:

1. Keep your unstamped `findings.json` as the source (or strip `id`,
   `state`, `snippet_redacted`, `coverage`, `check_stamp` from the stamped
   copy — `oid` may stay).
2. Re-read the range with `cite.mjs show <path> <start> <end>`, correct
   `lines` / `snippet`, write the file back whole.
3. The lead re-runs `check`. Second opinions written against the previous
   stamped bytes print `STALE-REVIEW <id>` on that run; a second run of
   `check` on the freshly stamped file (byte-identical when the fixed
   finding is the same assertion) validates them again — otherwise they are
   redone.

## `second-<id>.json` — a fresh dispatch's second opinion

Beside `findings.json`, named by the finding's stamped `id`. `oid` is the
finding's **first citation's `oid`, all 40 hex** (a short oid is
`STALE-REVIEW`); `findings_sha256` is the sha256 of `findings.json` **exactly
as it is on disk after the lead's `check`** — run `check`, then hash the
stamped file (a re-run of `check` on its own output leaves the bytes
unchanged, so the hash is stable). `check` printed
`SECOND 2623bcc6… confirmed` for this one.

```json
{
  "finding_id": "2623bcc6cb8b60184d33faba378c0f38a496d64ecd69ab16d7afcf02b8ab38cd",
  "oid": "dd5feb86e3a08984dabea0771bc5f3d50c5a8e33",
  "findings_sha256": "4c04517da983d3b7a5f09dbbdbd6d33522253d6f387974f42360ed9737e2325b",
  "assertion": "confirmed",
  "note": "Line 8 passes req.url.slice(1) to readFileSync with no root check; R1-R7 not shown.",
  "by": "security-reviewer vulnerability-review 2026-09-18"
}
```

`assertion` ∈ `confirmed | refuted | indeterminate`; `note` is one
paragraph citing lines, no secrets; `by` names the session or agent. A
`mitigation-review` writes the same shape to `second-M-nnn.json` in the
review directory (`.agents/security-testing/reviews/<dir>/second-M-nnn.json`)
with `finding_id` = the mitigation id, `oid` = its first citation's `oid`
and `findings_sha256` = the sha256 of the stamped `threat-model.json`; no
script validates that file — the lead reads it.

## `fix-review.json` — the fix-review assertion, and `verify.json` as read

`verify.mjs` (first invocation) wrote
`.agents/security-testing/verify/<id8>-<head7>/verify.json` with
`{finding_id, review, base, head, carried_dirt[], tests: {argv, exit,
duration_ms, log} | null, diff: {deletion_only, advisories[{path, line,
kind}]}, assertion: null, verdict: "PENDING-REVIEW"}` and printed `NEXT:
dispatch security-reviewer fix-review`. The fix-review reads it, reads the
cited paths at `base` and `head` through `cite.mjs show --at <oid>`, and
writes, beside it:

```json
{
  "finding_id": "2623bcc6cb8b60184d33faba378c0f38a496d64ecd69ab16d7afcf02b8ab38cd",
  "base": "dd5feb86e3a08984dabea0771bc5f3d50c5a8e33",
  "head": "<the fix commit, 40 hex>",
  "assertion": "not-refound",
  "note": "readFileSync now takes resolve(ROOT, rel) guarded by startsWith(ROOT + sep) at lines 9-11; the advisory at src/app.js:3 is a lint pragma unrelated to the path check.",
  "by": "security-reviewer fix-review 2026-09-20"
}
```

`assertion` ∈ `not-refound | refound` — the closed vocabulary
`verify.mjs --assertion` accepts; the lead copies it into
`verify.mjs --finding <id> --review <dir> --head <oid> --assertion <a> --by <session>`,
which prints `VERDICT <token> finding=<id> base=<oid> head=<oid>`. The
reviewer never runs that command and never writes `verdict`.

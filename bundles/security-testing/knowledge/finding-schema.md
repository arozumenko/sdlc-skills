# Finding schema — `findings.json`

The reviewer's contract. One file per review at
`.agents/security-testing/reviews/<date>-<head7>/findings.json`; JSON is the
model of record, the Markdown report is written from it later. Every
citation carries a commit oid and a range of at most 40 raw lines, so
`cite.mjs check` can re-read the bytes at that oid and mark it `VERIFIED` or
`FAILED(<why>)` — at any time, by anyone with the repo.

## Top level

| field | type | meaning |
|---|---|---|
| `head` | string | the commit oid the review was performed at — always the tip under review (`git rev-parse HEAD`): coverage is tiled over the index's files with line counts at `head`, so an older `head` shows files added since as 0-line `unexamined` rows |
| `scope_paths` | string[] | copied from `engagement.md`, informational: `check` validates citation paths against the engagement's own list, not this copy |
| `examined` | `{path, lines?}[]` | what the reviewer actually read; `lines: [s, e]` marks a partial read, no `lines` means the whole file. `check` tiles these once against `git ls-files -- <scope_paths>` and prints `COVERAGE examined=<n> partial=<n> unexamined=<n>` |
| `findings` | finding[] | the assertions below; an empty list is a valid review |

## A finding

| field | type | meaning |
|---|---|---|
| `title` | string | one line, names the sink and the class |
| `class` | string | one of the 15 taxonomy ids in `secure-code-review/references/taxonomy.md` |
| `priority` | `p0` \| `p1` \| `p2` \| `p3` | the reviewer's proposed priority; the register row copies it |
| `confidence` | `high` \| `medium` \| `low` | how far the investigate-then-refute loop got |
| `citations` | citation[] | at least one; the first citation is the finding's identity anchor |
| `rationale` | string | why the code is exploitable, following the cited lines |
| `fix` | string | the smallest change that closes the class at the sink |

## A citation

| field | type | meaning |
|---|---|---|
| `path` | string | repo-relative, under `scope_paths` |
| `oid` | string, optional | the commit the bytes were read at; `check` stamps `head` when absent |
| `lines` | `[start, end]` | raw 1-based line numbers as `git show` prints them, inclusive; at most 40 lines (`MAX_RANGE_LINES = 40`) |
| `snippet` | string | the cited text; compared whitespace-insensitively, blank lines ignored |

## Written by `check`, never by an agent

`id`, `state` and `verdict` are stamped by `cite.mjs check` and are
**refused** if present in a file it is asked to check (spec D10). `check`
writes the file back with, per citation, `state: VERIFIED | FAILED(<why>)`,
the stamped `oid` and the redacted `snippet`; per finding, `id =
sha256(path \0 class \0 redact(normalise(snippet)) \0 first line of that
redacted normalised snippet)` (spec D5) — the fourth component is not a
line number, it is redundant with the third by construction, on purpose:
the id is location-independent, so the same sink pattern re-found at
shifted lines after a rebase still hashes to the same id. So no published
hash has a secret in its preimage. Nothing is write-once:
`check` re-runs freely on its own output (the `check_stamp` matches), but a
stamped file edited by hand is `REFUSED agent-written key id` — a `FAILED`
citation is fixed in the reviewer's unstamped `findings.json` (or with
`id`, `state`, `snippet_redacted`, `coverage` and `check_stamp` stripped;
`oid` may stay) and the file is re-checked.

## Second opinions — `second-<id>.json`

A fresh `vulnerability-review` or `mitigation-review` dispatch writes one
file beside `findings.json`:

```json
{
  "finding_id": "<id>",
  "oid": "<the finding's first citation's oid, all 40 hex>",
  "findings_sha256": "<sha256 of findings.json exactly as on disk after the lead's check>",
  "assertion": "confirmed | refuted | indeterminate",
  "note": "one paragraph",
  "by": "<session or agent name>"
}
```

`check` validates every `second-<id>.json` in the directory; a wrong or
short `oid`, or a `findings_sha256` of any bytes other than the stamped file
`check` last wrote, prints `STALE-REVIEW <id>` (exit 4).

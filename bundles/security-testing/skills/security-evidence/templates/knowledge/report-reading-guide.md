# Reading a security report and its `check` output

Every report this bundle produces lives in a **run directory**
(`.agents/security-testing/runs/<run_id>/`) next to the artifacts it was
rendered from: `report.md`, `manifest.json` and a `COMMITTED` marker
written last. The report is a rendering; the artifacts are the record.
Anyone with the repository and the run directory can re-derive every value
the report displays with one command:

```
node <skills dir>/security-evidence/scripts/evidence.mjs check <run dir | manifest.json> [--integrity] [--drift] [--trusted-digest <sha256>]
```

`check` writes nothing. It prints three or four lines, in this order, and
this page says what each one means and — just as important — what it does
not mean.

## Line 1 — consistency

`check` recomputes, from the recorded inputs, every derived value in the
report (finding ids and citation states via `gate`, coverage via
`coverage`, review and mitigation states via `receipt apply`, verify
verdicts via `verify.mjs evaluate`, register status via `register.mjs
replay`), then re-renders the report and byte-compares it.

| token | meaning | exit |
|---|---|---|
| `CONSISTENT` | every recomputed value equals what the report shows and the rendered bytes match | `0` |
| `CONSISTENT-REDACTED-ONLY(<n> citations)` | as above, but `<n>` citations of `side: snapshot` (a dirty file in a `review` run) could only be checked against their **redacted** snapshot: the working file has changed since, so the original HMAC is compared as recorded, not re-derived. Possible only for `review` runs | `0` |
| `INCONSISTENT(<field>)` | a recomputed value differs from what the report displays; `<field>` names the first mismatch (a view path such as `findings[2].state` or an artifact name such as `gate-result`). A recomputed-artifact mismatch is named before any byte comparison. The report is not to be trusted | `5` |
| `STRUCTURE-ONLY` | the HMAC key for this engagement is unavailable, so content re-validation (range HMACs, snapshot originals, sensitive ids) was skipped; only the artifact structure and hashes were checked. Never upgraded to `CONSISTENT` | `0` |
| `INCOMPLETE(COMMITTED)` | the run directory has no `COMMITTED` marker: `build-report` never finished, or the marker was removed. There is nothing to check | `3` |

`--integrity` adds the per-citation re-resolution against the recorded
side (`git show <base_oid|head_oid>:<path>` or the private snapshot); a
citation whose bytes no longer match is an `INCONSISTENT(<citation>)`.

## Line 2 — drift (only with `--drift`)

Consistency is about the recorded snapshot. Drift is about **now**: the
working tree you are looking at versus the tree the report cites.

| token | meaning |
|---|---|
| `CURRENT` | every `head`/`snapshot` citation still resolves to the same bytes in the working tree and every in-scope file has the same per-file HMAC as `scope.json` |
| `CITATION-DRIFTED(<n>)` | `<n>` citations point at text that has since changed or moved. The report was consistent when written; the code is different now |
| `SCOPE-DRIFTED(<n files>)` | `<n>` in-scope files changed since the run (per-file HMAC vs `scope.json`); the review no longer describes the current code |

`base` citations are skipped by drift: deleted code has no current
counterpart. Drift never changes the exit code — a drifted but consistent
run still exits `0`; `sign-off` is what refuses a drifted latest
assessment.

## Line 3 — `ORIGIN`

This is the line most often misread.

| token | meaning |
|---|---|
| `ORIGIN: unauthenticated` | nobody has vouched for this run. `check` proved that the report and its artifacts are consistent with each other; it did **not** prove who produced them or that they were produced by the canonical pipeline |
| `ORIGIN: matches supplied digest` | the manifest hash **recomputed** from the run directory (never the sidecar `manifest.json` as stored) equals the `--trusted-digest` you passed in. The trust is exactly as good as the channel that gave you the digest |

The bundle promises **consistency and re-derivation, not provenance**
(spec D2). A consistent, `CURRENT` run can be authored from scratch by
anyone with write access to the repository: every input is a plain file
and the identities are hashes of those files. What `check` rules out is a
report that says something its own inputs do not support — an edited
count, a state that no receipt produced, a citation that does not resolve.
If you need to know *who* produced a run, obtain the manifest digest out of
band (a signed message, a CI log, a ticket comment) and pass it as
`--trusted-digest`; the ORIGIN line then tells you whether the run you hold
is the one they meant.

The same applies to approvals inside the report: every acceptance,
false-positive closure and reviewer receipt is stored with
`authenticated: false` and counted under "unauthenticated approvals".
There is no `confirm` command and no confirmed state. A name on an approval
is a claim about who approved, recorded as typed.

## Line 4 — `KEY`

| token | meaning |
|---|---|
| `KEY: available` | the engagement key that signed this run's HMACs is present under `private/keys/`; content re-validation ran |
| `KEY: unavailable` | the key is gone (purged, rotated away and deleted, or this is not the machine the run was made on). Line 1 is `STRUCTURE-ONLY` at best; the report's Limitations section lists the artifacts affected |

The key never leaves `private/`. Sharing a run directory shares redacted
artifacts and HMACs, not the key, so a recipient without it will always see
`STRUCTURE-ONLY` + `KEY: unavailable`. That is expected, not a failure.

## Reading the report body

- **Section 2, coverage** accounts for every scoped range exactly once:
  `examined`, `skipped`, `scanner-only` or `unexamined`, with who covered
  it. An empty scope is `INDETERMINATE` and blocks `sign-off`.
- **Section 3, counts** are by priority × state. "Not independently
  reviewed" means `CITATION_VERIFIED` with no receipt — a verified
  citation, not a confirmed vulnerability. `unknown / not assessed` is a
  legitimate value; a blank is not.
- **Rejected and unlocated** totals come from `rejects.json` and
  `unlocated.json`: claims that failed structural checks, and scanner or
  ticket records that could not be located in scope. They are counts of
  what the pipeline refused, not findings.
- **Incomplete runs** are run directories without `COMMITTED`. They are
  listed so their absence from the counts is visible.
- Every displayed value is in the derivation table of spec §6.3; if a value
  is not there, the renderer cannot display it.

## Published derivatives

`publish --profile <p>` writes a derivative (redacted report, full report,
tracker payload, hand-off prompt, case files) plus an `export-manifest.json`
next to it. `check-export <export-manifest.json> [--source <run dir>]`
re-applies the profile to the source run and byte-compares:

| token | meaning | exit |
|---|---|---|
| `VERIFIED-DERIVATIVE` | the output is exactly what the profile produces from that run | `0` |
| `LINKED-ONLY` | no `--source` was given; the manifest links the output to a run by hash but the derivation was not re-run | `0` |
| `MISMATCH(output)` | the output differs from what the profile produces; it was edited after publication or produced from a different run | `5` |

## Quick decision table

| you see | you can conclude | you cannot conclude |
|---|---|---|
| `CONSISTENT` · `CURRENT` · `ORIGIN: unauthenticated` · `KEY: available` | the report is what its inputs say and describes the current tree | who made it |
| `CONSISTENT` · `CITATION-DRIFTED(3)` | the report was sound; three cited places have changed since | that the findings are fixed — run `verify.mjs all` |
| `STRUCTURE-ONLY` · `KEY: unavailable` | the artifact set is intact and internally hashed | that any cited content still matches |
| `INCONSISTENT(findings[0].state)` | the report displays a state its receipts do not produce | anything else in it |
| `ORIGIN: matches supplied digest` | this run is the one whose digest you were given | that the digest's sender is who they claim |

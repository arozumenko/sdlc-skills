# Disclosure profiles — what each `publish --profile` reveals

Publication is only
`node <scripts>/evidence.mjs publish --run <run_id> --profile <p> --to <destination>`
(spec §6.9, D13). The run must be `COMMITTED`.
**`--profile` has no default**: you name the profile every time, and
`full-report` in particular is chosen explicitly or not at all. Every
profile is a pure function of the run's artifacts — which are already redacted — so no profile can disclose
protected bytes; what a profile decides is how much of the *redacted*
material leaves the run directory.

## The five profiles

| Profile | Output under `--to` | Reveals | Withholds | Status |
|---|---|---|---|---|
| `redacted-report` | `report.md` | the run's rendered report: identity, coverage, every finding's id, class, priority, path, lines, state, the verify verdicts, the register summary, unauthenticated approvals, limitations | every indented code block (each finding's evidence — `snippet`, `snippet_redacted` and `context_redacted` alike, a redacted snippet is still a snippet — and a verify report's test output), each finding's reproduction row, the test executable path and any line naming `.agents/` — replaced by `<label>: withheld by the redacted-report profile` | M1 |
| `full-report` | `report.md` + `findings.json` | the report byte for byte, plus every gated finding as `gate` stored it: `snippet` for a non-sensitive citation, `snippet_redacted` / `context_redacted` for a sensitive one (the redacted form is what is on disk; original bytes never leave `private/`) | nothing beyond what redaction already removed | M1, explicit only |
| `tracker` | `<st>/handoffs/<finding_id>.ticket.json` per finding, canonical one-line JSON | exactly nine keys: `finding_id`, `title`, `class`, `priority`, `path`, `lines`, `context_redacted`, `fix_prompt`, `fingerprint` | never `snippet`, never `snippet_redacted`; no report text, no `targets.repo` (read it from `engagement.md`), no register content beyond the dedupe it performs | M1; the read-back's `ticketed` event and the full fix route are M3 |
| `handoff` | `<st>/handoffs/<slug>.md` | admitted case paths and `base_url` only | everything else | M3: `2 NOT-IMPLEMENTED(M3)` |
| `case` | `tasks/security-<slug>-admitted/` | the test-case text of admitted cases only — a directory that contains nothing else | proposals, findings, the report | M3: `2 NOT-IMPLEMENTED(M3)` |

Choosing: a reader outside the repository who must not see code gets
`redacted-report`; an auditor with repository access who will re-check
citations gets `full-report` and the run's manifest sha256; a developer
gets a ticket, never a report. When in doubt, the narrower profile — a
report can be re-published wider later, a disclosure cannot be taken
back.

## `--to` rules

- Report profiles: any directory inside the work tree, resolved from the
  current directory and judged on both its typed spelling and its real
  path — never the repository root itself, never under `.git/`, never
  under `.agents/security-testing/` (compared case-insensitively, so a
  differently-cased spelling is refused everywhere). `reports/security/`
  is the conventional destination and is inside the managed ignore block
  (`artifact_policy.reports: committed` lifts it).
- `tracker`: `--to` must be exactly `.agents/security-testing/handoffs`.
- An existing file at the destination is refused. An existing output with
  different bytes is
  `2 USAGE(publish: <path> already exists with different content; choose another --to)`
  and nothing is written — publish never clobbers a file it did not derive. A byte-identical republish is
  idempotent (exit 0, same lines).

## Export manifests and re-checking a derivative

Every publication writes an enveloped `export-manifest` artifact next to
its outputs — `export-manifest.json` for the report profiles, the sidecar
`<finding_id>.export-manifest.json` per ticket for `tracker` —
`{source_manifest_sha256, profile, profile_version, output_sha256}` where
`output_sha256` is the identity of the whole output set (`sha256` over the
canonical sorted list of `[relpath, sha256(bytes)]`). stdout: one
`PUBLISHED profile=<p> output=<path> sha256=<h>` per file (that file's own
hash), then the manifest's `WROTE <path> sha256=<self_sha256>`.

Hand the manifest over with the outputs. Anyone can then run
`node <scripts>/evidence.mjs check-export <export-manifest.json> [--source <run dir>]`:

| Result | Exit | Meaning |
|---|---|---|
| `VERIFIED-DERIVATIVE` | 0 | with `--source`: the profile re-applied to the source run reproduces the outputs byte for byte |
| `LINKED-ONLY` | 0 | without `--source`: the outputs on disk match the manifest's own `output_sha256` and the manifest names its source — linked to a run the checker could not re-apply, untampered since publication |
| `MISMATCH(output)` | 5 | an output was edited or is missing, with or without a source |

`2 USAGE(...)` names a manifest that is not an export manifest, a `--source`
that is not this export's source, or a `profile_version` the installed
profile no longer matches (a bump means the old derivative cannot be
re-derived; republish).

What a derivative never carries: an origin. `check` on the source run
prints `ORIGIN: unauthenticated` unless the consumer supplies a digest
they hold (`--trusted-digest <sha256>` ⇒ `ORIGIN: matches supplied
digest`); a derivative inherits that. Say so when you hand a report over:
"consistent and re-derivable; origin unauthenticated unless you keep the
manifest hash yourself".

## What never goes through a profile

- A file copied out of `<st>/runs/<run_id>/` by hand (no manifest, no
  `check-export`).
- The register log or projection (`risk-register.md`, rendered by
  `register.mjs render`, is the shareable view and carries only redacted,
  derived text).
- Anything under `private/`: keys, citation records, snapshots, the
  baseline. There is no profile for them and `artifact_policy` cannot
  un-ignore them.
- Your own summary of a finding. The words a stakeholder receives are the
  report's or the payload's; your prose points at them by run id and
  finding id.

# Fixtures — claims that pass `gate`

Worked examples of the `review` contract's two outputs, each true against
the bundle's own scripts (proved by
`security-evidence/scripts/secure-code-review.fixtures.test.mjs`, which
builds the repository below in a temp directory, runs `run init --kind
review --base <base>`, `scope`, `packet --kind scope`, `gate` over all three
claims files and `coverage` over the declaration).

| file | shows |
|---|---|
| `repo/` | the tree at **head**: `src/app.js`, `src/auth.js`, `src/config.js`, `src/pool.js`, `src/users.js` — no blank lines, so raw and normalised line numbers coincide |
| `repo-base/src/auth.js` | the **base** version of `src/auth.js`, four lines longer: `requireOwner` exists at base and is gone at head |
| `claims/config-password-nonsecret.json` | a `config` (non-secret-class) finding citing a line containing `password=1234` — `gate` keys its identity and stores `snippet_redacted` (spec §6.5 fixture) |
| `claims/dataflow-injection-typed.json` | an `injection` finding with `source`, `control` and `sink` typed citations |
| `claims/deleted-code-base-side.json` | an `authz` finding at `side: base` over the removed `requireOwner` — the cited range is beyond head's last line and inside the base blob |
| `examined/examined-1.json` | a declaration covering every admitted range of every scope file, so `coverage` reports nothing unexamined |

`scope_sha256` and `packet_sha256` are shipped as 64 zeros: they depend on
the engagement key and the run, so a consumer (or the test) fills in the
values from `<run>/scope.json` and the `PACKET … sha256=` line before
dropping a file into `.agents/security-testing/receipts/<run_id>/`.

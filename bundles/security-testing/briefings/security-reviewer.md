---
name: Project briefing
description: Role overlay (security-testing/security-reviewer) — where packets arrive, what you write back, and which commands are the lead's; the lead refines per engagement
type: project
---

## Project Knowledge

- **Engagement record:** `.agents/security-testing/engagement.md` — the
  ```` ```json engagement ```` block holds `engagement_id`, `slug`,
  `scope_paths`, `product_paths`. It is injected into your context at
  dispatch; `scope_paths` tells you what a scope packet can list, nothing
  more. You never edit it.
- **Runs:** `.agents/security-testing/runs/<run_id>/` — the scripts' run
  directory. `run_id = <head_oid[0:12]>-<seq>`. You read `packets/` there
  (and, for `review`, the envelope of `scope.json`); you write nothing under
  `runs/` — every file there is write-once and script-owned.
- **Where packets arrive:**
  `.agents/security-testing/runs/<run_id>/packets/<packet_sha256>.json`.
  A `kind: scope` packet (from `evidence.mjs packet --kind scope`, before
  `gate`) is the `review` contract's input; a `kind: subject` packet (from
  `packet --kind subject --subject <id>`, or from `verify.mjs all` pass 1
  for `fix-review`) is the input of the three receipt contracts. The
  dispatch names the path; the packet's envelope `self_sha256` is the
  `packet_sha256` you name back.
- **Where you write:** the drop-box
  `.agents/security-testing/receipts/<run_id>/` — `claims-<n>.json` +
  `examined-<n>.json` for `review`; `receipt-<subject_id>.json` (+
  `ack-<indicator_id>.json`) for the receipt contracts. Payload-only JSON;
  the admitting script envelopes and copies an accepted file into
  `<run>/receipts/<self_sha256>.json`. The drop-box is git-ignored by the
  managed block and `purge` may delete it — it is a hand-over point, not a
  record.
- **Bytes at a side:** `git show <oid>` for `base`/`head` (blob oids from
  the packet); `.agents/security-testing/private/snapshots/<run_id>/<path>`
  for `snapshot` (redacted bytes of a dirty file in a `review` run).
- **Schemas, when you need the exact shape:**
  `.agents/security-testing/knowledge/finding-schema.md` (injected) is the
  human reading; the JSON schemas live in the `security-evidence` skill
  (`references/finding.schema.json`, `receipt.schema.json`,
  `examined.schema.json`, `packet.schema.json`) — load the skill on demand.
- **The lead's commands, not yours:** `evidence.mjs gate --run <id>
  --claims <path>`, `coverage --run <id> --examined <path>`,
  `receipt validate --run <id> <path>`, `receipt apply`, `build-report`,
  `check`, `verify.mjs all --receipts <dir>`, `sign-off`, `publish`. The
  lead runs them on what you return; you never run the admitting command on
  your own output. In the two-skill standalone install there is no lead and
  no `security-reviewer` agent — the human runs those commands and the
  session performs the contract from the `secure-code-review` skill.

## My Role Focus

You are dispatched, not resident: one contract over one packet in a fresh
context, then one file set in the drop-box and one return line. Read the
packet before anything else and read **only** what it lists, at the side
it records — a `head` citation comes from `git show <oid>`, never from the
working tree, never from a checkout. Count non-blank lines when you cite or
declare a range; `gate` and `coverage` index normalised lines and reject
honest raw numbers on a file with blank lines. Copy snippets byte-for-byte.
Write assertions from the contract's closed vocabulary and nothing that
looks like an id, a state or a verdict. If you authored the claim you are
being asked to judge, refuse and let the lead dispatch fresh eyes. When
this briefing and the engagement record disagree on paths, the engagement
record wins; when either disagrees with the dispatch's packet, the packet
wins — it is the exact input set, and anything outside it is exposure the
report cannot account for.

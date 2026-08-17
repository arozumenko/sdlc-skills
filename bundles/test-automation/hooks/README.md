# test-automation hooks

One hook, installed **only** with this bundle: it records what a workflow
subagent concluded, so an interrupted run can be resumed instead of redone.

| | |
|---|---|
| Event | `SubagentStop` |
| Scope | workflow dispatches only — a lead's own subagents are untouched |
| Mode | `async: true` — never blocks or delays a dispatch |
| Writes | `.agents/telemetry/automation/returns/<run-id>/<agent-id>.json` (legacy `_returns/` when no telemetry area) |

## Why it exists

A dispatched agent's *payload* survives it — an analyst's AFS is on disk, an
implementer's commits are in git. Its **conclusion** does not: the structured
result lives only in the value handed back, so an agent that dies takes the
record with it.

Measured on the lazy-modal campaign (2026-07-30): a foundation implementer built
its page objects, wrote the smoke spec, committed — then stalled. The branch was
finished and the workflow knew nothing about it. A human had to notice and
dispatch a rescue for work that was already done.

With this hook the same death costs nothing: the result file says the branch is
built, and the resume reads it.

## How it knows a dispatch came from a workflow

Claude Code files the two kinds apart:

```
subagents/workflows/wf_<run>/agent-<id>.jsonl   ← workflow
subagents/agent-<id>.jsonl                      ← dispatched directly
```

The path is the **only** reliable signal: both kinds carry the same
`agentType`, so the hook matcher cannot separate them — on the run above, one
`test-automation-engineer` sat in each place at the same moment. Matching the
path also works from either transcript store, a repo-local `.claude/projects`
or the global one, since both share that suffix.

Run id and agent id come out of the same string, so the hook needs no payload
fields beyond `transcript_path` and never has to know the batch slug.

## Why the result isn't just `last_assistant_message`

A schema-constrained agent returns through a `StructuredOutput` tool call, not
text — verified against real transcripts. The hook reads that call from the
transcript tail (bounded: one real agent transcript reached 1.3 MB). An
unschema'd agent falls back to its final text.

## The three rules it will not break

1. **Never writes to stdout.** Hook stdout can be injected into the model's
   context; bookkeeping chatter does not belong there.
2. **Never exits non-zero, never throws.** No node, no transcript, unreadable
   JSON, unwritable directory — all silent exit 0. The worst case is that a file
   is missing and the run behaves exactly as it does today.
3. **Never touches a non-workflow dispatch.** Verified: pointed at a directly
   dispatched agent it writes nothing at all, not even a directory.

## Install

Merged into `<target>/settings.json` by the bundle installer, tagged
`"_bundle": "test-automation"` — re-running replaces only this bundle's entries,
and other bundles' hooks plus your own are left alone. Scripts land in
`<target>/hooks/test-automation/`.

Claude-only for now (bundle hooks v1), which matches the scope anyway: workflows
are a Claude Code feature. On other hosts nothing is installed and nothing
changes.

## Files

- `hooks.json` — the event registration
- `scripts/workflow-return` — thin bash launcher
- `scripts/workflow-return.mjs` — all the logic, unit-tested in
  `workflow-return.test.mjs` (kept OUT of `scripts/`, so it is not copied into consumer projects)
- `scripts/run-hook.cmd` — cross-platform launcher (mirrors the repo's core one)

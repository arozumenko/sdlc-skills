# Digest format

The parser emits markdown, one section per analyzed session:

```
## Session <id> — <date>  (branch: <b>, <Nu> user / <Na> assistant turns, ~<min> min)
Skills/plugins seen: <comma-separated attribution set>

### Sub-agents
- <agentType> — "<task description>" — <turns> turns, <errors> errors, ended: ok|with errors

### Signals
- Tool errors: <Tool>: error ×<count>
- Retry/loop: <Tool> on <target> ×<count>
- File churn: <path> edited ×<count>
- Candidate corrections:
  - "<short quoted user turn>" (turn <n>)
```

A session with none of the above shows `- (no notable signals)`. The digest is
bounded: quotes truncated to 200 chars, max 12 corrections/session, file churn
only listed at ≥4 edits. Signals are **extracted, not interpreted** — judgment
is the agent's job.

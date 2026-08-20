# OpenTelemetry roadmap — banked research, not yet built

## UPDATE 2026-08-06 — first REAL Copilot CLI OTel file reviewed (CLI 1.0.78); the join is VERIFIED

A live `copilot --config-dir ./.copilot` session exported OTel to a file
(user-configured path), and the structure settles several open questions:

- **Format:** plain JSONL, one self-contained object per line
  (`{"type":"metric"|"span",...}`).
- **THE JOIN IS VERIFIED:** every span carries
  `gen_ai.conversation.id`, and it equals the session-state directory id
  (`<COPILOT_HOME>/session-state/<id>/`) — confirmed by direct match against
  the same session's `events.jsonl`. Cross-source enrichment is now
  id-safe; the "unverified id mapping" blocker holds only for the other
  hosts.
- **Span tree = exact dispatch structure:** `invoke_agent <lead>` (root) →
  `execute_tool task` per dispatch → `invoke_agent <sub-agent>` → `chat
  <model>`. Chat spans carry EXACT per-request tokens including the cache
  split (`gen_ai.usage.input_tokens` / `output_tokens` /
  `cache_creation.input_tokens` / `cache_read.input_tokens`) — finer grain
  than the store's per-model shutdown totals. `invoke_agent` rolls up its
  OWN chats only (sub-agents not included — parent-only accounting, same
  convention as ours). `gen_ai.tool.call.id` gives heuristic-free dispatch
  attribution; `gen_ai.agent.name`/`id`/`description` name each agent;
  `enduser.pseudo.id` is a stable pseudonymous user id.
- **Billed cost DOES appear (CLI ≥1.0.78) — but incomplete:**
  `github.copilot.cost` (premium-request count) + `github.copilot.nano_aiu`
  (billed) sit on the parent's chat spans and its invoke_agent rollup —
  measured 44.996 credits there while the same session's `events.jsonl`
  shutdown billed **68.385** (sub-agent requests carried no cost attrs).
  No cost/credit METRIC exists at all — billing appears only as span
  attributes, and only on the parent's. Sub-agents DO carry exact tokens
  (their invoke_agent + chat spans, cache split included) and per-agent
  duration/inference-call/tool-call metrics; the token.usage metric sums
  all requests including sub-agents' but is keyed by model/token-type only
  — per-agent token split needs the spans.
  **The store stays authoritative for dollars**; OTel cost attrs are
  per-request color, not a reconciling total.
- **Skill loads are span events WITH TRIGGER:** `github.copilot.skill.invoked
  {skill.name, invocation_trigger: "context-load"|…, source: "project"}` —
  the store's `skill.invoked` has no trigger, so this is the first signal
  that distinguishes preloaded (`context-load`) from explicitly invoked
  skills per request: directly measures the `skills:` vs `skills-on-demand:`
  economics.
- **Metrics complement:** `gen_ai.client.token.usage` histograms per
  model×token.type (sums match span totals), `operation.duration`,
  `time_to_first_chunk` / `time_per_output_chunk` (latency we have nowhere
  else), `invoke_agent.{duration,inference_calls,tool_calls}` per agent,
  `github.copilot.{tool.call.count/duration,agent.turn.count}`.

- **Content-free by design — no prompts, no task text.** The user's message
  is only an event marker (`github.copilot.user.message` → source +
  interaction_id, no text); `execute_tool task` spans carry the tool name +
  call id but NO arguments, so the dispatch brief never appears; the only
  prose anywhere is static metadata (the agent's frontmatter description,
  the skills / custom-agent inventory). "What was done" is inferable only
  structurally (who ran, in what order, which skills loaded, how much it
  cost). Case attribution and prompt capture stay STORE-side
  (`events.jsonl` `agentDescription` / user text, the ledger's opt-in
  prompts) — OTel cannot replace them.

**Reader implication:** an OTel enricher for the copilot host is now
buildable — join on conversation.id, take structure/latency/cache-split/
skill-trigger detail from spans, keep dollars from the store. Still not
merged into the ledger (unchanged decision); the inspector remains the
surface until an enricher is asked for.

Status as of 2026-08-05: **implemented** — the VS Code chatSessions reader
(`host: 'copilot-vscode'` in the sweep), the folderOpen auto-task + git-hook
triggers, `install-hooks.mjs --doctor` / `--otel`, the stdlib OTLP sink
(`hooks/otel-sink.mjs`, kept alive by the capture hook when `otel.enabled`
points at localhost) and the sink inspector (`scripts/otel-report.mjs`).
**Still deliberately NOT done:** merging OTel data into the ledger (dedup vs
store-sourced lines is unverified — the inspector exists instead), and live
verification on Windows / WSL / a real OTLP-emitting session. The sections
below remain the knowledge bank for those steps.

## UPDATE 2026-08-05 — the VS Code sidebar IS locally meterable (no OTel needed)

Deeper digging on a machine with real Aug-2026 sidebar sessions overturned the
"extension has no local usage data" conclusion. VS Code's own chat session
files — `~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/*.jsonl`
(hash → repo via the sibling `workspace.json` `folder` field; Windows:
`%APPDATA%/Code/User/workspaceStorage/...`) — carry per-request usage:

- `$.v[]` request records: `modelId` (`copilot/claude-sonnet-4.6`, …),
  `promptTokens`, `completionTokens` — present in essentially every session.
- `copilotCredits` — the **billed** figure — appears on sessions written by
  extension ≥0.57.0 (verified: 18.12 credits on a real agent-mode session);
  older files have tokens only. Determine at reader-build time whether it is
  per-request or session-cumulative (compare multi-request sessions).
- `$.v.metadata.promptTokens` (aggregate), `selectedModel.metadata.cacheCost` /
  `cacheWriteCost` (pricing multipliers), `contextSize`.

Community reading (vscode issues #285059/#291897/#305818): sessions can be
orphaned when a workspace is renamed/moved (the hash changes) — a sweep should
scan ALL workspace hashes and map each to its repo, not derive one hash.
Caveat from the field: locally recorded prompt tokens may undercount hidden
context GitHub adds server-side; `copilotCredits` is the trustworthy figure
where present.

**Reader plan (vscode host):** sweep workspaceStorage, map hash→repo, one
ledger line per session file — `host: 'copilot-vscode'`, tokens from `$.v[]`,
`costUsd` from `copilotCredits × $0.01` where present (`costSource:
'copilot-credits'`), else tokens-only. Role: agent-mode records name the agent
(`$.v[].agent.id`, e.g. `github.copilot.editsAgent`) — map where meaningful.

### Discovery matrix — the reader MUST search, not assume

The paths above were verified on ONE macOS machine. Storage moves with the OS,
the VS Code variant, and the remoting setup — the reader scans the **union of
every root that exists** and maps each `workspaceStorage/<hash>` back to its
repo by reading the sibling `workspace.json` (`folder` file-URI; multi-root
`.code-workspace` files use `workspace`). Never derive or assume a hash.

| where | chatSessions root |
|---|---|
| macOS | `~/Library/Application Support/<Product>/User/workspaceStorage/` |
| Windows | `%APPDATA%\<Product>\User\workspaceStorage\` |
| Linux | `~/.config/<Product>/User/workspaceStorage/` |
| Remote / WSL / dev container | `~/.vscode-server/data/User/workspaceStorage/` **on the remote filesystem** — a Windows dev working in WSL has the data inside WSL, not `%APPDATA%`; run the sweep where the repo lives (verify on a real remote at build time) |
| Portable mode | `<install>/data/user-data/User/workspaceStorage/` — not discoverable from outside; covered by the config override below |

`<Product>` is a family, not one name: `Code`, `Code - Insiders`, `VSCodium`
(forks like Cursor keep their own product dirs — extensible list). Plus:
`--user-data-dir` launches are unknowable → config knob
`vscodeUserDataDirs: []` in `.agents/telemetry/config.json` for explicit extra
roots; `emptyWindowChatSessions/` (chats opened with no folder) has no repo to
attribute — skip by default, count in verbose output. Same search-don't-assume
rule already holds for the other hosts: Claude (`CLAUDE_CONFIG_DIR` →
`~/.claude` → `~/.config/claude`; repo-local `.claude` config dirs exist in
the field) and Copilot CLI (`COPILOT_HOME` → repo-local `.copilot` →
`~/.copilot`; `%USERPROFILE%` equivalents on Windows via `homedir()`). Every
root that exists gets scanned; nothing silently narrows to one location.

## Why OTel then (revised)

1. **Live org dashboards** — all three emitters can point at one OTLP
   collector (Grafana etc.). Complement to the ledger, never a replacement:
   OTel token pricing is a list-price **estimate**; `events.jsonl` carries what
   GitHub actually **billed**. Where both exist, prefer billed; use the gap as
   a drift check.
2. **Second opinion / older extension versions** whose chatSessions files
   carry no `copilotCredits`.

## The three emitters — exact switches

### Copilot VS Code extension (and CLI terminals it opens)

```jsonc
// VS Code settings.json
"github.copilot.chat.otel.enabled": true,
"github.copilot.chat.otel.exporterType": "file",   // or otlp-http / otlp-grpc / console
"github.copilot.chat.otel.outfile": "...",          // file mode
"github.copilot.chat.otel.otlpEndpoint": "http://localhost:4318"
```

Covers the extension AND is forwarded (`COPILOT_OTEL_ENABLED`,
`OTEL_EXPORTER_OTLP_ENDPOINT`) to CLI sessions started from VS Code terminals.

### Copilot CLI standalone

```bash
export COPILOT_OTEL_ENABLED=true
export COPILOT_OTEL_EXPORTER_TYPE=file        # → ~/.copilot/otel/*.jsonl
# or COPILOT_OTEL_FILE_EXPORTER_PATH=<file>, or OTLP endpoint vars
```

**Not retroactive** — sessions run without these produce nothing. Content
capture (`captureContent` in the SDK config) is off by default; keep it off.

### Claude Code

```jsonc
// settings.json "env" block (or org-wide managed settings, which override)
"CLAUDE_CODE_ENABLE_TELEMETRY": "1",
"OTEL_METRICS_EXPORTER": "otlp",              // otlp | prometheus | console — NO file exporter
"OTEL_LOGS_EXPORTER": "otlp",
"OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",   // ← what makes a stdlib sink possible
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"
```

Rich catalog (names verified against the docs): metrics
`claude_code.token.usage` (attrs: `type`=input/output/cacheRead/cacheCreation,
`model`, `query_source`=main/subagent/auxiliary, `agent.name`, `skill.name`,
`mcp_server.name`…), `claude_code.cost.usage` (USD, **Anthropic-computed**),
`claude_code.session.count`, `claude_code.active_time.total`,
`claude_code.lines_of_code.count`, `claude_code.commit.count`; events
`claude_code.api_request` (per request: `cost_usd`, `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `model`,
`duration_ms`), `claude_code.user_prompt` (text only with
`OTEL_LOG_USER_PROMPTS=1` — keep off), `claude_code.tool_result`,
`claude_code.tool_decision`. Standard attrs include `session.id` and
`user.email`. Privacy/cardinality gates: `OTEL_METRICS_INCLUDE_*`,
`OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_ASSISTANT_RESPONSES` — all content gates
default off.

## Copilot OTel data shape (for the reader)

Spans follow the OTel **GenAI semantic conventions**: hierarchy
`invoke_agent` → `chat` / `execute_tool`; token attrs `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens` (+ cache and reasoning token attrs where present);
model in `gen_ai.response.model` / `gen_ai.request.model`; session grouping via
`gen_ai.conversation.id`. Message content (`gen_ai.input.messages` /
`gen_ai.output.messages`) appears only when content capture is on. ccusage's
copilot adapter treats **chat spans as the source of truth** (inference/agent
logs as fallback) and prices via LiteLLM — an estimate, not the invoice.
Authoritative shape doc: `microsoft/vscode-copilot-chat`
`docs/monitoring/agent_monitoring.md`.

Upstream watch: ccusage #1174 proposes reading `session-state/events.jsonl`
directly (what this skill already does) and #1208 proposes removing its OTel
source afterwards — i.e. the ecosystem is converging on the approach used here.

## Local readers/sinks that fit this repo (mac + windows)

| option | verdict |
|---|---|
| **Copilot file exporter + our sweep** | No reader needed — plain JSONL; the sweep grows a parser. The default path. |
| **`otel-sink.mjs` — our own stdlib OTLP receiver** | ~100 lines: Node `http` server on `localhost:4318`, accepts OTLP **http/json** POSTs to `/v1/metrics` + `/v1/logs`, appends raw JSON lines to `~/.claude/otel/`. Zero deps, cross-platform, could be auto-started by the SessionStart hook (port-probe first, idle-exit). This is how Claude Code gets a "file exporter" it doesn't natively have. |
| official `otelcol`/`otelcol-contrib` binary | Real collector with a `file` exporter; single static binary via brew/choco/download — org-grade, but ~60 MB and not shippable inside a content-only repo. Document, don't bundle. |
| `ai-observer`, `otel-desktop-viewer`, `tokscale` | Local viewers/trackers worth knowing; external deps, not shipped. |

## The reader design (when data exists)

1. Sweep gains a third source: `~/.copilot/otel/*.jsonl` (+ the VS Code
   outfile if configured). Group spans by `gen_ai.conversation.id` → one
   ledger line per conversation, `host: 'copilot'`, tokens from chat spans.
2. **Dedup against `events.jsonl` first**: a CLI session appears in both —
   keep the billed line (`copilot-nano-aiu`), drop the OTel duplicate. Only
   conversations absent from session-state (= VS Code extension work) become
   OTel-sourced lines, `costSource: 'otel-estimate'` (LiteLLM-priced or
   tokens-only — never presented as billed).
3. Claude OTel stays out of the ledger (transcripts already cover it); the
   stdlib sink is for teams that want raw OTel locally or a bridge until a
   real collector exists.

Sources: code.claude.com/docs/en/monitoring-usage · ccusage.com/guide/copilot ·
code.visualstudio.com/docs/agents/guides/monitoring-agents ·
github.com/microsoft/vscode-copilot-chat docs/monitoring/agent_monitoring.md ·
ccusage issues #1174, #1208 · GitHub changelog 2026-07-08 (enterprise-managed
OTel export).

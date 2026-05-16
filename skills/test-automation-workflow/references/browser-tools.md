# Browser tools — pick the right one

Three skills can drive a browser in this monorepo. None replaces the
others — they sit at different layers and excel at different things.
Load this reference when you have to pick (or switch) during AFS
authoring, ad-hoc verification, or while implementing a test.

## The three tools

| Skill | Layer | Best at | Reach for it when |
|---|---|---|---|
| [`playwright-testing`](../../playwright-testing/) | Playwright **MCP server** (in-host tool calls) | Snapshot-driven interaction — `browser_snapshot`, `browser_click`, `browser_fill`, `browser_navigate`. Accessible-name discovery falls out for free. | **Default** for analyst exploration and any interactive check when the Playwright MCP server is wired into the host. |
| [`playwright-cli`](../../playwright-cli/) | Microsoft Playwright **CLI** (shell) | Same Playwright browser surface, driven from `npx playwright-cli` / `playwright-cli` commands. Multi-tab, storage, request mocking, tracing, `codegen` (test generation), persistent profiles. | The Playwright MCP server isn't available, or you want a reproducible **shell command** instead of a tool call — CI smoke, trace capture, codegen, deep CLI flows. |
| [`browser-verify`](../../browser-verify/) | **Chrome DevTools Protocol** (CDP) | Computed styles, real CDP input events, storage/cookies dump, axe accessibility audit, screenshot diffs. Lighter than full Playwright. | Visual smoke check, accessibility audit, deep DOM inspection, or when Playwright (MCP + CLI) is overkill for the question. |

## Availability — check before you pick

Before choosing a tool, scan the host's environment:

1. **Playwright MCP server up?** Look for `mcp__playwright__*` /
   `playwright/*` entries in the host's tool list (Claude Code, Copilot
   CLI, Cursor, Windsurf). If present, `playwright-testing` is the
   default.
2. **`playwright-cli` installed?** Check `npx playwright-cli --version`,
   or whether the `playwright-cli` skill is loaded into the session. If
   yes, it's an in-shell substitute when MCP is down — and a complement
   for CLI-native workflows like `codegen` and trace recording.
3. **`browser-verify` skill loaded?** It's a monorepo skill, almost
   always installed for QA / test-automation agents. Use it for
   visual / CDP / accessibility checks regardless of the above.

If only `browser-verify` is available you can still execute most
analyst-side flows — you'll just be more verbose. Note that constraint
in the AFS / PR so the next reader knows what produced what.

## Pick by challenge

- **Authoring an AFS step-by-step** → `playwright-testing` (snapshot
  yields the ref + accessible name in one call). Falls back to
  `playwright-cli` if MCP is offline; to `browser-verify` if neither.
- **Selector is flaky / accessible name unclear** → re-snapshot via
  `playwright-testing`; or use `browser-verify` for computed-style /
  shadow-DOM dive; or `playwright-cli codegen` to see the locator
  Playwright itself proposes.
- **Visual regression / pixel-level diff** → `browser-verify`
  (screenshot + diff).
- **Accessibility audit (axe)** → `browser-verify`.
- **Multi-tab / multi-window / storage manipulation** →
  `playwright-testing` if the MCP server exposes the relevant tools;
  `playwright-cli` otherwise (first-class CLI territory).
- **Capturing a trace for a flake report** → `playwright-cli`
  (`--trace=on`). The resulting `.zip` opens in Playwright Trace Viewer.
- **Generating starter Playwright code** → `playwright-cli codegen`.
  Treat output as a sketch; rewrite to project conventions
  (page-object style, fixture pattern, naming) before committing.
- **CI smoke from a shell script** → `playwright-cli` (deterministic,
  no MCP runtime needed).

## Switching is fine — but log why

If the first tool you try doesn't give the answer (snapshot is stale,
MCP times out, CDP can't reach a deeply nested iframe), switch to the
next. Don't ping-pong silently — note in the AFS (or PR body) which
tool produced which observation:

> Logged in via `playwright-testing` (snapshot ref `s4f2`).
> Verified computed `aria-expanded` via `browser-verify` because the
> snapshot wasn't surfacing it after the dropdown animation.

This is **guidance, not a hard rule**. Use your judgement. The only
firm constraint is honesty: don't synthesize an observation you
couldn't reproduce through any of these tools — that masks real
product behaviour.

## Agents that load this reference

- `qa-engineer` (Sage) — via `test-case-analysis` during AFS authoring.
- `test-automation-engineer` (Axel) — via `test-automation-workflow`
  during implementation, when a chosen tool isn't producing useful
  evidence and a switch may unblock the test.

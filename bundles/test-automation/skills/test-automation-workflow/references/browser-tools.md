# Execution tools — pick the right one for the surface

To execute a case against the real system you reach for whatever tool
fits the **surface under test** — there is no single default. Pick by
surface first, then by tool within that surface:

| Surface | Run it against the real system with |
|---|---|
| **UI (browser)** | a browser tool — `playwright-testing` (MCP), `playwright-cli`, or `browser-verify` (see the UI worked example below) |
| **API / service** | an HTTP client — `curl` / `httpie` from the shell, the project's request library, or an MCP/HTTP tool the host exposes; assert status + named response fields |
| **Mobile** | the platform's device/emulator driver (Appium / Espresso / XCUITest) against a running build |
| **Performance / load** | a load tool (k6 / Gatling / JMeter / Locust) run against the target, reading the named metric + threshold |

The honesty rule below is surface-independent: don't synthesize an
observation you couldn't reproduce through a real tool against the real
system, whatever the surface.

## Concurrency — one browser, one analyst

The **Playwright MCP server drives ONE shared browser**: two concurrent
agents calling it switch each other's tabs and share auth state — corrupted
*observations*, not just slowness.

**The batch pipeline serializes its units**, so in a normal run you are the
only agent driving a browser and the shared Playwright MCP is simply yours.
The isolation machinery below exists for the cases that fall outside that:

- **Two agents genuinely at once** (a hand-run investigation alongside a
  batch, an operator driving one browser while a dispatch drives another):
  one keeps the shared Playwright MCP, the other uses `browser-verify` (CDP)
  or `playwright-cli` with an **isolated instance** — its own
  `--remote-debugging-port` and its own user-data-dir, so they never
  collide. `browser-verify`'s `chrome-launcher.sh` accepts port/profile
  overrides for exactly this.
- No lane assigned (solo run, conversational dispatch)? Treat yourself as
  the only browser user — MCP is fine.
- A project can also register multiple Playwright MCP endpoints (one per
  lane) in the host config — seeded per project when the team prefers MCP
  everywhere; the lane rule stays the same either way.

## Probe first — snapshots are the expensive verb

A full-page accessibility snapshot of a complex page costs 5–15k tokens of
context; a scripted CDP probe (`browser-verify`) or a scoped query answers
most questions ("what's the submit button's handle?", "did the banner
appear?") for ~50. Over a 30–80-operation exploration that ratio dominates
the analyst's entire cost. Default order during exploration:

1. **Scripted probe** (`browser-verify` CDP, or a targeted MCP query) for
   any question with a known shape;
2. **Scoped snapshot** of the component under test when you need structure;
3. **Full-page snapshot** only at genuine decision points — first arrival on
   an unknown page, an ambiguous multi-match, a layout you must see whole.

This governs *cost*, not *evidence*: probes still run against the real
system, and the honesty rule above is untouched.

## UI worked example — the three browser tools

When the surface is a browser, three skills can drive it in this
monorepo. None replaces the others — they sit at different layers and
excel at different things. Load this reference when you have to pick (or
switch) during AFS authoring, ad-hoc verification, or while implementing
a UI test.

| Skill | Layer | Best at | Reach for it when |
|---|---|---|---|
| [`playwright-testing`](../../playwright-testing/) | Playwright **MCP server** (in-host tool calls) | Snapshot-driven interaction — `browser_snapshot`, `browser_click`, `browser_fill`, `browser_navigate`. Accessible-name discovery falls out for free. | **Default for UI** analyst exploration and any interactive browser check when the Playwright MCP server is wired into the host. |
| `playwright-cli` | Microsoft Playwright **CLI** (shell) | Same Playwright browser surface, driven from `npx playwright-cli` / `playwright-cli` commands. Multi-tab, storage, request mocking, tracing, `codegen` (test generation), persistent profiles. | The Playwright MCP server isn't available, or you want a reproducible **shell command** instead of a tool call — CI smoke, trace capture, codegen, deep CLI flows. |
| [`browser-verify`](../../browser-verify/) | **Chrome DevTools Protocol** (CDP) | Computed styles, real CDP input events, storage/cookies dump, axe accessibility audit, screenshot diffs. Lighter than full Playwright. | Visual smoke check, accessibility audit, deep DOM inspection, or when Playwright (MCP + CLI) is overkill for the question. |

## Availability — check before you pick

Before choosing a tool, scan the host's environment:

1. **Playwright MCP server up?** Look for `mcp__playwright__*` /
   `playwright/*` entries in the host's tool list (Claude Code, Copilot
   CLI, Cursor, Windsurf). If present, `playwright-testing` is the
   default.
2. **`playwright-cli` installed?** Check `npx playwright-cli --version`,
   or whether the Playwright CLI is available. If
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

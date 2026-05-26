# Deployment-mode detection — Step 6.95 full procedure

sdlc-skills ships agent files with baked-in references to the
Octobots supervisor: taskbox relay commands, `OCTOBOTS.md` worker-root
polling, `.octobots/board.md`, Telegram MCP digests, `relay.py`
inter-agent messaging. Under Octobots those references are correct
and useful. Under a **standalone deploy** (Copilot CLI, Claude Code,
Cursor, Windsurf, no supervisor) those lines are dead weight that
confuses agents and sends them hunting for paths / commands that
don't exist.

Scout's job at this step: detect the deployment mode and, in
standalone mode, **strip marker-bracketed Octobots-only content**
out of every installed agent file.

## The marker convention — two types

Source agent files use **two** paired marker types:

```markdown
<!-- OCTOBOTS-ONLY: START -->
...content that only applies under the Octobots supervisor...
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
...the same-intent guidance rephrased for standalone deploys...
<!-- STANDALONE-ONLY: END -->
```

And inline variants for mid-paragraph clauses:

```markdown
Something<!-- OCTOBOTS-ONLY: inline START --> Octobots-specific<!-- OCTOBOTS-ONLY: inline END --> then<!-- STANDALONE-ONLY: inline START --> standalone-equivalent<!-- STANDALONE-ONLY: inline END --> rest.
```

### When to use which

- **OCTOBOTS-ONLY alone** — the content is Octobots infrastructure
  (relay.py calls, `OCTOBOTS.md` polling, `.octobots/board.md`
  reads, supervisor restart commands). No meaningful standalone
  counterpart. Scout strips these in standalone mode; nothing
  replaces them because the concept doesn't exist standalone.
- **OCTOBOTS-ONLY paired with STANDALONE-ONLY** — the content
  carries operational guidance (structured reports, handoff formats,
  persona conventions) that still applies in standalone mode, just
  via a different channel. The pair lets scout keep the guidance
  and swap only the transport phrasing.

Pair the two blocks **adjacent** in the source file so a human reader
sees both framings side-by-side. Scout strips the inactive block when
it detects the active mode.

## Mode detection

Scout picks one of three modes by examining the target project:

| Mode | Detection signals | Action at this step |
|---|---|---|
| **Octobots supervisor** | `.octobots/` directory exists at project root AND `OCTOBOTS.md` exists somewhere (at repo root or in a sibling worker directory) | Strip every `STANDALONE-ONLY` bracketed region; keep `OCTOBOTS-ONLY` content |
| **Taskbox-only** (rare) | `.octobots/board.md` present but no `OCTOBOTS.md` | Same as Octobots — strip STANDALONE-ONLY, keep OCTOBOTS-ONLY (taskbox inherits the Octobots transport conventions) |
| **Standalone** (default for pilots) | Neither of the above | Strip every `OCTOBOTS-ONLY` bracketed region; keep `STANDALONE-ONLY` content |

## Strip procedure (both modes)

For every installed agent file, scout strips the **inactive mode's**
bracketed regions. The target set per host:

- **Claude Code / Cursor / Windsurf** (directory-layout installs):
  `.claude/agents/<name>/AGENT.md`, `SOUL.md`, and `RULES.md`
  (and the equivalents under `.cursor/agents/…`, `.windsurf/agents/…`).
- **Copilot CLI** (flat installs): `.github/agents/<name>.agent.md`
  (the installer's Copilot transform folds SOUL.md into a `## Persona`
  section inside that file; RULES.md, when present, is flattened the
  same way).

Scout applies the same transform to each:

1. Pick the target marker type based on mode:
   - Standalone mode → target = `OCTOBOTS-ONLY`
   - Octobots / Taskbox-only mode → target = `STANDALONE-ONLY`
2. Find all pairs of `<!-- {TARGET}: START -->` … `<!-- {TARGET}: END -->`
   (treating the inline variant the same way — `inline START` pairs
   with `inline END`).
3. Remove each pair **and** all content between them.
4. Clean up any double blank lines left behind.
5. Re-read the file to confirm valid Markdown remains — if the strip
   would leave a section stub with an empty body, also strip the
   stub's section heading if the operator prefers (configurable;
   default: leave the heading, let downstream agents see "this
   section has no content under current mode").

Scout records the deployment mode in `.agents/profile.md` so
downstream agents + future scout runs can see it at a glance:

```markdown
## Deployment mode

- **Mode**: standalone | octobots | taskbox
- **Detected via**: <signals>
- **Octobots-bracketed content stripped**: <yes | no>
- **Agent files touched**: <count>
```

## Idempotence + re-seeding

### Switching modes after the first seed — the two-step sequence

**Re-stripping is not enough.** Scout's Step 6.95 strips the
*inactive* mode's bracketed regions from the currently-installed
files. It does not restore content that was already stripped in a
prior run. So switching modes requires both the installer (to
replace the stripped files with fresh bracketed copies from the
sdlc-skills source) **and** scout (to strip the new inactive mode).

**Standalone → Octobots** (most common upgrade path):

1. Install the Octobots supervisor as usual. Its `install.sh`
   delegates to the npx installer, which overwrites
   `.github/agents/*` / `.claude/agents/*` with fresh copies that
   carry both `OCTOBOTS-ONLY` and `STANDALONE-ONLY` bracketed
   regions again. The previously-stripped Octobots-only lines are
   now back.
2. Re-run scout. It detects Octobots mode from the `.octobots/`
   directory + `OCTOBOTS.md`, runs Step 6.95, strips the
   `STANDALONE-ONLY` regions, and writes
   `.agents/profile.md § Deployment mode` with `mode: octobots`.

**Octobots → standalone** (rare rollback): symmetric. Re-run the
installer without Octobots, then re-run scout; it detects
standalone mode and strips `OCTOBOTS-ONLY` regions.

The supervisor's `install.sh` does **not** auto-run scout on its
own — step 2 is the operator's responsibility. Candidate
follow-up: `install.sh` could detect an existing
`.agents/profile.md § Deployment mode` != its own mode and chain
the scout re-run automatically, turning this into a single
command.

### General rules

- Scout never touches source agent files in the sdlc-skills repo —
  only installed copies in the target project. Source stays
  canonical.
- Re-running scout in the same mode is a no-op on files already
  stripped for that mode; it only rewrites
  `.agents/profile.md § Deployment mode` with a fresh timestamp.

## Out of scope

- **`scout/references/exploration-workflow.md`** is not touched.
  It's scout's own internal reference, read only during onboarding,
  and keeping it Octobots-flavored doesn't confuse other agents
  (they don't read it).
- **Dual-mode narrative** (e.g. "Under taskbox: X / Under host-native
  subagents: Y") stays in the source — it's valuable documentation
  of both modes, and standalone readers pick the host-native half
  from context.

## Report (end of Step 6.95)

```
Step 6.95 complete — deployment-mode detection

Mode: <standalone | octobots | taskbox>
Signals: <.octobots/ absent, OCTOBOTS.md absent>

Agent files processed:
  .github/agents/project-manager.agent.md  — stripped N bracketed regions
  .github/agents/qa-engineer.agent.md      — stripped N bracketed regions
  ...

Wrote `.agents/profile.md` § Deployment mode.
```

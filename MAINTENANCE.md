# Maintenance — pulling in upstream updates

Your sdlc-skills install is a **one-shot copy** into `.github/` /
`.claude/` / `.cursor/` / `.windsurf/`. There's no auto-update daemon
— when sdlc-skills ships a fix or a new skill upstream, you re-run
the installer pointing at the newer ref and let it overwrite.

## Where updates come from

Canonical upstream is `github:arozumenko/sdlc-skills`. The installer
defaults to `main`; pin to a known-good commit with `#<sha>`:

```bash
# Track the tip of main (default)
npx github:arozumenko/sdlc-skills init --update ...

# Pin to a specific commit
npx github:arozumenko/sdlc-skills#<sha> init --update ...
```

Check what's live:

```bash
git ls-remote https://github.com/arozumenko/sdlc-skills HEAD
```

## How to update

Re-run the same `init` command you used at install, with
**`--update`** so the installer overwrites existing files instead of
refusing:

```bash
cd /path/to/your-automation-repo

npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents scout,project-manager,tech-lead,qa-engineer,test-automation-engineer \
  --skills project-seeder,test-case-analysis,test-automation-workflow,playwright-testing,browser-verify,bugfix-workflow,code-review,task-completion,issue-tracking,atlassian-content,xray-testing,memory,tdd,git-workflow,plan-feature \
  --update --yes
```

Keep the `--agents` and `--skills` lists identical to your original
install so you don't accidentally drop a role or skill. Pin to a
specific commit with `github:arozumenko/sdlc-skills#<sha>` when you
want to control rollout timing.

## What `--update` rewrites vs what it preserves

**Overwritten in place:**

- `.github/agents/<name>.agent.md` (Copilot) or
  `.claude/agents/<name>/` (Claude Code) — agent definitions
- `.github/skills/<name>/` / `.claude/skills/<name>/` — skill
  `SKILL.md`, `references/`, `scripts/`
- `CLAUDE.md` / `AGENTS.md` at project root if they were
  installer-generated (scout's outputs won't be touched by the
  installer — only scout overwrites those)

**Preserved:**

- `.agents/*` — scout's emitted content docs (`testing.md`,
  `architecture.md`, `workflow.md`, `profile.md`,
  `test-automation.yaml`, per-role memory). These are yours.
- `test-specs/`, `test-results/`, your application and framework
  code — the installer never touches these.

## After running `--update`

1. **Re-run the Copilot fix-up if you're on Copilot CLI** — updated
   agent directories need re-flattening to `.agent.md`:

   ```bash
   npx github:<your-ref> init fix-copilot
   ```

2. **Check whether scout's project-seeder has new steps.** If the
   update pulled in new project-seeder steps (e.g. Step 6.8 tool
   wiring, 6.9 role substitutions, 6.95 deployment-mode marker
   stripping) and your install predates them, re-run scout with a
   prompt that tells it to execute **only the new steps**:

   ```
   You are scout. Do NOT regenerate existing content docs.
   Execute ONLY the project-seeder steps introduced since my last
   install: read <SKILLS_ROOT>/project-seeder/SKILL.md and run
   whichever of Step 6.8, Step 6.9, Step 6.95 are present and not
   already applied. Report what you changed.
   ```

   Idempotent — safe to run multiple times.

3. **Eyeball the diff.** If you version-control the installed files
   (many teams do), you'll see exactly what changed. Check that
   `.agents/role-overrides.md` (if scout wrote one) is still on disk
   and still auto-imported at the top of
   `project-manager.agent.md` / `tech-lead.agent.md` via
   `@.agents/role-overrides.md`. `--update` should not touch
   `.agents/` content, but confirm the `@`-import line survived.

4. **Smoke-test a pilot case.** Re-run a known-passing case
   end-to-end. If it still goes green, the update landed cleanly.

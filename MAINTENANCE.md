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
  --skills seeding-a-project,test-case-analysis,test-automation-workflow,playwright-testing,browser-verify,bugfix-workflow,code-review,completing-a-task,issue-tracking,atlassian-content,xray-testing,memory,tdd,git-workflow,plan-feature \
  --update --yes
```

Keep the `--agents` and `--skills` lists identical to your original
install so you don't accidentally drop a role or skill. Pin to a
specific commit with `github:arozumenko/sdlc-skills#<sha>` when you
want to control rollout timing.

## Local changes are kept

The installer does not record what it installed last time. It uses git
to decide whether an update can replace an agent or a skill:

- **The item is committed and has no changes.** The update replaces it.
  Git history is your backup.
- **Git reports a change in the item** (a modified, deleted or untracked
  file). The update keeps the item and prints its name. The other items
  are still updated. A summary at the end of the run lists every kept
  item. The exit code stays 0. A factory's skill overlay does not rewrite
  a kept agent.
- **You installed the item and never committed it.** Git reports it as
  untracked. If it differs from the copy in this package, the update keeps
  it, the same as an edited committed item. Commit it or pass `--force`.
- **You deleted the item and did not commit that.** It stays deleted. An
  item that git never tracked is installed as new.
- **Git cannot restore the item** (the project has no git, or git ignores
  the path). The update copies the old item to
  `.sdlc-skills-backup/<date-time>/` in the project, prints the path, and
  then replaces the item. Each run gets its own backup folder. Delete the
  folders when you no longer need them.

The same rules apply to skills fetched from another repository (external
skills). The installer cannot tell your edit from an older upstream
version, so outside git it makes a backup each time upstream changed.

The installer asks only the project's own repository. An item inside a
nested repository (for example `.claude` is its own repository) is treated
as untracked: an existing item is kept when it differs from the copy in this
package, and a missing item is installed, even if you deleted it there.

A symbolic link where an item goes is treated as yours. In git it is kept
like any other local change. Without git the installer cannot back it up,
so it keeps the link and prints the reason. `--force` replaces the link
itself; nothing is written to the place the link points to. A link the
installer made with `--symlink` points into its cache folder. The update
replaces such a link as usual, also after you deleted the cache.

An item whose content is identical to a copy in this package is never
treated as a local change. So you can update two factories one after the
other without a commit between the runs. This check cannot see through
the changes the installer makes to an agent file (a skill overlay, the
skills list written for Cursor, Windsurf, Copilot and Codex). If a
second run keeps an agent that only the installer changed, commit first
or use `--force`.

To replace a kept item, commit or stash your changes and run the update
again. Or add `--force`:

```bash
npx github:arozumenko/sdlc-skills init --factory feature-development --update --force
```

`--force` replaces every selected agent and skill, and installs again an
item you deleted. It does not check git and it does not make a backup.

## Updating a factory install

If you installed a **team factory** (e.g. `--factory feature-development`),
update it the same way — re-run with the same `--factory` and add `--update`:

```bash
npx github:arozumenko/sdlc-skills init --factory feature-development --update --yes
```

What `--update` does for a factory:

- **Agents & skills** — replaced in place, unless they have local changes
  (see "Local changes are kept" above).
- **Briefings** (`.agents/memory/<role>/project_briefing.md`) — written only
  when the file does not exist. An existing briefing is kept, with or
  without `--update`, so scout's project-specific refinements survive. To
  get the factory default again, delete the file and run the install again.
- **Seeded files** (for example `docs/discovery/` or
  `.agents/<factory>/knowledge/`) — never removed and never overwritten.
  The update adds the files the factory has and your project lacks. Where
  your project has a file and the factory has a folder of the same name
  (or the reverse), your entry is kept and the installer prints one line.
- **Instructions** — the `<!-- FACTORY:<id> -->` block in `AGENTS.md` /
  `CLAUDE.md` is refreshed in place regardless of `--update` (idempotent).
- **Hooks** — the factory's `_factory`-tagged entries in
  `.claude/settings.json` are replaced; your own hooks are untouched.
  `settings.json` is backed up to `settings.json.bak` once per run, before
  the first change.

Factory authors: run `npm run validate:factories` before publishing (CI runs
it on every push/PR). See [`bundles/SPEC.md`](bundles/SPEC.md).

## What `--update` rewrites vs what it preserves

**Replaced in place** (unless the item has local changes, see above):

- `.github/agents/<name>.agent.md` (Copilot) or
  `.claude/agents/<name>/` (Claude Code) — agent definitions
- `.github/skills/<name>/` / `.claude/skills/<name>/` — skill
  `SKILL.md`, `references/`, `scripts/`
- The `<!-- FACTORY:<id> -->` blocks in `CLAUDE.md` / `AGENTS.md` at the
  project root. The text outside those blocks is not changed.

**Preserved:**

- `.agents/*` — scout's emitted content docs (`testing.md`,
  `architecture.md`, `workflow.md`, `profile.md`,
  `test-automation.yaml`, per-role memory, role briefings) and the
  files a factory seeded. These are yours.
- Seeded folders outside `.agents/`, such as `docs/discovery/`.
- `test-specs/`, `test-results/`, your application and framework
  code — the installer never touches these.

## After running `--update`

1. **Re-run the Copilot fix-up if you're on Copilot CLI** — updated
   agent directories need re-flattening to `.agent.md`:

   ```bash
   npx github:<your-ref> init fix-copilot
   ```

2. **Check whether scout's seeding-a-project has new steps.** If the
   update pulled in new seeding-a-project steps (e.g. Step 6.8 tool
   wiring, 6.9 role substitutions) and your install predates them,
   re-run scout with a
   prompt that tells it to execute **only the new steps**:

   ```
   You are scout. Do NOT regenerate existing content docs.
   Execute ONLY the seeding-a-project steps introduced since my last
   install: read <SKILLS_ROOT>/seeding-a-project/SKILL.md and run
   whichever of Step 6.8, Step 6.9 are present and not
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

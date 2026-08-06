# android-dev — "Dan" (Android/Kotlin developer)

> Use when Android work needs to be implemented — Kotlin, Jetpack Compose, Gradle/AGP, Room/DataStore features, or any Android-platform task requiring TDD and verification before handoff. Scoped to greenfield Compose codebases — he does not do XML/Views work or Java-interop migration, so an established Fragments/XML app is not a fit. Native Android only — not React Native/Flutter, not server-side Spring/JVM.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | dev |
| Workspace | `clone` (works in an isolated clone) |
| Aliases | `dan`, `android`, `android-developer` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install android-dev@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot, Codex)

```bash
npx github:arozumenko/sdlc-skills init --agents android-dev
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot` / `codex`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/android-dev .claude/agents/android-dev   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot` (it writes `.github/agents/android-dev.agent.md`), or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install. For **Codex**, agents install as `.codex/agents/<name>.toml` — use the CLI with `--target codex` (a plain `cp` won’t work).

## What Dan does not do

Read this before you install him, so the gap is never a surprise:

- **He never runs anything on a device or an emulator.** No `connectedAndroidTest`, no `installDebug`, no `adb install`, no Gradle Managed Devices, no AVDs. His evidence is compilation, host-side unit tests (JUnit, Robolectric, Compose-via-Robolectric, screenshot tests), lint, and code review. Anything that only shows up on real hardware — rendering on a physical panel, runtime permission dialogs, hardware sensors — is verified by **`qa-engineer` ("Sage"), by CI, or by you**, and Dan names which in his handoff.
- **He does not write `androidTest` sources** while no CI runner is configured for them, because instrumented tests nobody executes read as coverage without being it. When a task genuinely needs device coverage — Room migrations, permission flows, WorkManager scheduling — he says so explicitly in his handoff instead of filling the gap with unrun tests. That policy is revisited once a runner exists.
- **He is native-Android only, and greenfield-Compose only.** Not React Native, Flutter, or Expo; not server-side Spring or JVM-backend work; no new Java feature code; and no XML/Views or Java-interop migration work. If your app is an established Fragments/XML codebase, Dan is not the right agent for it.
- **He does not create the project.** Project scaffolding is yours — Android Studio's new-project wizard — and Dan works from the first commit onward. He will not hand-roll a Gradle build.

**If you install Dan standalone** (`--agents android-dev`, without the bundle), note that the handoff targets above do not exist: there is no `qa-engineer` to route device work to, and this bundle ships no CI runner for instrumented tests. Standalone, **you are the verifier** — Dan will still name every gap, but closing them is on you. Install him with the `feature-development` bundle if you want the QA half of that loop.

## Skills this agent uses

In this repo: `implement-feature`, `bugfix-workflow`, `root-cause-analysis`, `code-review`, `git-workflow`, `completing-a-task`, `memory`.

External †: `tdd`, `systematic-debugging`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `compose-state-hoisting`, `kotlin-flow-state-event-modeling`, `kotlin-coroutines-structured-concurrency`, `testing-setup`, `compose-ui-testing-patterns`.

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — generic operating rules (branch, commit, PR, report back), shared with the other dev agents. The no-device policy is **not** here — it lives in [`AGENT.md`](AGENT.md) under "CRITICAL: Never Touch a Device"
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/feature-development`](../../bundles/feature-development) (selected in the dev-role picker)

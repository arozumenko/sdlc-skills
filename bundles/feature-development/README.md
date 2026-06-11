# Feature Development bundle

A cross-platform product team you install in one shot, then **pick the
developer roles you need** — any combination, no stack lock-in.

## Quick start

```bash
npx github:arozumenko/sdlc-skills init --bundle feature-development
```

The installer always sets up the **core roles** and shows a checklist of
**developer roles** to add. Pick any subset (e.g. a Python backend dev + an iOS
dev). The core `tech-lead` and `qa-engineer` automatically pick up the right
skills and briefings for whatever platforms your selection spans.

- `--yes` (or a non-interactive shell) installs **all** developer roles.
- `--agents python-dev,ios-dev` selects a subset non-interactively.

## Roster

**Core (always installed):** `scout`, `ba`, `project-manager`, `tech-lead`,
`qa-engineer`.

**Developer roles (pick any combination):**

| Role | Platform | Focus |
|---|---|---|
| `python-dev` | web | Python backend (FastAPI / FastMCP) |
| `js-dev` | web | JS/TS frontend (React) |
| `test-automation-engineer` | web | End-to-end automation (Playwright) |
| `ios-dev` | iOS | Swift / SwiftUI app |

## How tuning works

Picking any web role activates the web briefings/skills for `tech-lead` and
`qa-engineer`; picking `ios-dev` activates the iOS ones. Pick both and the
shared roles get the **superset** — e.g. `qa-engineer` keeps Playwright *and*
gains the iOS testing skills. See `bundles/SPEC.md` for the overlay model.

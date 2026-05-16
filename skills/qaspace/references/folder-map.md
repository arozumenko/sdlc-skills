# Folder Map — Template

This file is a **working template**, not a reference. Fill it in
per project once you've discovered the TM-plugin folder tree, so
the IDs and paths the agent needs are one click away on the next
session.

**Source:**
`GET /rest/tm/1.0/folder/list?projectKey=<PROJECT>&folderId=<rootFolderId>`
(see SKILL.md § TM Plugin folder list API).

**Generated:** `<YYYY-MM-DD>`
**Run:** `<run name>` (id=`<RUN_ID>`, ~`<N>` tests total)

Use `scripts/parse-tm-folder-tree.py <saved-response.txt> --find <id>`
to drill into any node, or
`--keywords <word> ...` to filter by name.

---

## Key folder IDs for test selection

Replace the rows below with the actual folders your project
cares about. The headers are the categories most automation
teams need to surface — drop or extend as fits.

| Area | Folder Name | Folder ID | Notes |
|---|---|---|---|
| Root | `<PROJECT>` | `<rootFolderId>` | Top of the TM tree (= run ID) |
| Smoke / Regression | `Smoke/Regression` | `<id>` | Primary automation target |
| E2E | `E2E` | `<id>` | End-to-end happy-path scenarios |
| Module A | `<path>` | `<id>` | `<short note>` |
| Module B | `<path>` | `<id>` | `<short note>` |

---

## Subfolders (example shape)

When a folder has its own children that automation tools query
individually, list them as a sub-table so the IDs stay near the
parent:

### `<Parent>` subfolders (id=`<parentId>`)

| Subfolder | ID |
|---|---|
| `<name>` | `<id>` |
| `<name>` | `<id>` |

> Tests currently selected for automation from `<Parent>`:
> - `<PROJECT>-<NNNN>` — `<short summary>` (`<status>`, `<type>`)
> - `<PROJECT>-<NNNN>` — `<short summary>` (`<status>`, `<type>`)
> All live in `<path>` (cf[23101]=`<id>`).

---

## Leaf folders that contain tests directly

Some folders in TM Plugin **hold tests directly** rather than
subfolders. The TM folder-list API reports these as "0 children"
even though they're not empty — the children are leaf tests, not
sub-folders. JQL `cf[23101] = "<id>"` returns them correctly.

| Key | Summary | Status |
|---|---|---|
| `<PROJECT>-<NNNN>` | `<short summary>` | `<Passed | Failed | …>` |
| `<PROJECT>-<NNNN>` | `<short summary>` | `<Passed | Failed | …>` |

---

## Full top-level tree (depth 0–N)

Paste the trimmed output of:

```bash
python3 scripts/parse-tm-folder-tree.py <saved-response.txt> --depth 3
```

| Depth | Folder ID | Path | # children |
|---|---|---|---|
| 0 | `<rootFolderId>` | `<PROJECT>` | `<n>` |
| 1 | `<id>` | `<top-level area>` | `<n>` |
| 2 | `<id>` | `<sub-area>` | `<n>` |
| … | … | … | … |

---

## Tips for keeping this file useful

- **Date the entry every time you regenerate.** Folder IDs in
  TM Plugin are stable but new folders get added regularly —
  having a `Generated:` date tells the next agent how stale
  this map is.
- **Don't enumerate every folder** — only the ones automation
  cares about. The full tree is one `python3 parse-tm-folder-tree.py`
  call away.
- **Note known gotchas inline.** If a folder name contains
  brackets, slashes, or non-ASCII characters, write that under
  the row — JQL quoting bites at the worst moments.
- **Track which tests are already automated** in the
  per-subfolder sub-list so the next agent doesn't re-propose
  them.

# Folder Tree Reconstruction — JQL Fallback

When the TM Plugin folder-list API
(`GET /rest/tm/1.0/folder/list`) is reachable, use it — single
call, full recursive hierarchy. See SKILL.md § "TM Plugin
folder list API".

This document is the **fallback path**: rebuilding the folder
hierarchy from a JQL sweep alone. Use it when:

- the plugin endpoint returns 403 (some hardened Jira Server
  installs lock down `/rest/tm/1.0/*`);
- your MCP server doesn't proxy non-`/rest/api/*` paths;
- you need to verify the plugin-API output against ground
  truth (issues' own field values);
- you only have read access to standard Jira REST and not the
  plugin endpoint.

The data this approach uses lives directly on every test issue:

- `cf[23101]` — the **leaf folder ID** (direct parent only, no
  ancestor chain).
- `cf[24001]` — the **full folder path** as a slash-delimited
  string (`"Smoke/Regression"`, `"E2E/Checkout/Happy Path"`).

Together they're enough to reconstruct the tree — with a few
caveats below.

---

## The algorithm in plain English

1. **Sweep the run with a two-field projection.** Request only
   `cf[23101]` and `cf[24001]`. Paginate to exhaustion.
2. **Deduplicate the pairs.** Each unique `(folder path,
   leaf folder ID)` pair is one folder node that contains at
   least one test.
3. **Split each path on `/`** to get its segments. The depth
   of the node equals the segment count (minus one for the
   root).
4. **Assign IDs to leaf segments only.** The `cf[23101]` ID
   belongs to the deepest segment. Intermediate segments may
   have no discoverable ID (see caveats).
5. **Build parent links.** For each node `A/B/C`, its parent
   path is `A/B`. The root's parent is `None`.
6. **Materialize intermediate nodes.** If only `"A/B/C"` shows
   up in the sweep, you also need to create nodes for `"A"` and
   `"A/B"` — they exist in the path even if they contain no
   tests of their own.

---

## Python pseudocode you can adapt

Stdlib only — no dependencies. Drop into a script and feed it
the paginated JQL responses.

```python
import math
from collections import defaultdict


def sweep_folder_pairs(jira_search_fn, project: str, run_id: str) -> list[tuple[str, str]]:
    """
    Page through the run with a two-field projection and return
    every unique (path, leaf_id) pair seen.

    `jira_search_fn(jql, max_results, start_at, fields) -> dict`
    is whatever transport you have (raw HTTP, MCP execute_generic_rq,
    httpx wrapper).
    """
    pairs: set[tuple[str, str]] = set()
    jql = (
        f"project = {project} AND issuetype = Test "
        f"AND cf[23100] = \"{run_id}\" ORDER BY cf[23101] ASC"
    )

    start_at = 0
    page = 100
    while True:
        resp = jira_search_fn(
            jql=jql,
            max_results=page,
            start_at=start_at,
            fields=["customfield_23101", "customfield_24001"],
        )
        issues = resp.get("issues", [])
        for issue in issues:
            f = issue["fields"]
            path = f.get("customfield_24001")
            fid = f.get("customfield_23101")
            if path and fid:
                pairs.add((path, fid))

        total = resp.get("total", 0)
        start_at += len(issues)
        if not issues or start_at >= total:
            break

    return sorted(pairs)


def build_tree(pairs: list[tuple[str, str]]) -> dict[str, dict]:
    """
    Turn the (path, leaf_id) list into a dict of nodes keyed by
    full path. Each node carries: name, parent_path, leaf_id (or
    None for intermediate-only folders).
    """
    nodes: dict[str, dict] = {}

    for path, fid in pairs:
        segments = path.split("/")

        # Materialize every ancestor segment, not just the leaf.
        # "A/B/C" → also create nodes for "A" and "A/B".
        for i in range(len(segments)):
            node_path = "/".join(segments[: i + 1])
            parent = "/".join(segments[:i]) if i > 0 else None

            existing = nodes.get(node_path)
            if existing is None:
                nodes[node_path] = {
                    "name": segments[i],
                    "parent": parent,
                    "leaf_id": fid if i == len(segments) - 1 else None,
                    "children": [],
                }
            elif i == len(segments) - 1 and existing["leaf_id"] is None:
                # We previously created this as an intermediate
                # via a deeper path; now we found a sweep pair
                # that ends here, so capture its ID.
                existing["leaf_id"] = fid

    # Link children. Done in a second pass so order doesn't matter.
    for path, node in nodes.items():
        parent = node["parent"]
        if parent is not None and parent in nodes:
            nodes[parent]["children"].append(path)

    return nodes


def print_tree(nodes: dict[str, dict], root_path: str, depth: int = 0) -> None:
    node = nodes[root_path]
    label = node["leaf_id"] or "(no ID — intermediate)"
    print(f"{'  ' * depth}{node['name']}  [{label}]")
    for child_path in sorted(node["children"]):
        print_tree(nodes, child_path, depth + 1)
```

Usage sketch:

```python
pairs = sweep_folder_pairs(jira_search_fn, project="<PROJECT>", run_id="<RUN_ID>")
nodes = build_tree(pairs)

# Root path is the project key — same as the run's root cf[24001] value.
print_tree(nodes, root_path="<PROJECT>")
```

---

## Pagination cost (folder-tree-only sweep)

The two-field projection keeps each page small (~300 bytes per
issue). Page size 100 is the safe default for Jira Server's
search endpoint.

| Run size | Pages at 100/page | Approx wall time |
|---|---|---|
| < 100 tests | 1 | sub-second |
| ~500 tests | 5 | a few seconds |
| ~1 000 tests | 10 | ~10 seconds |
| ~5 000 tests | 50 | ~1 minute |

Times assume a single agent making sequential calls. Most Jira
Server instances tolerate parallel requests, but the search
endpoint can deprioritize a burst — sequential is the safer
default for a one-off sweep.

---

## Caveats — what JQL alone can't tell you

| Caveat | Detail | Workaround |
|---|---|---|
| **Empty folders are invisible** | A folder with zero tests never appears in any test's `cf[24001]` and so never surfaces in the sweep. | Use the folder-list API if you need empty folders. |
| **Intermediate folders have no ID** | If `"Smoke"` itself holds no tests, only `"Smoke/Regression"` shows up. `"Smoke"` exists as a path segment but has no `cf[23101]`. | Walk it via path-string match (`cf[24001] = "Smoke/..."` enumeration) rather than ID. |
| **Root is special** | Root tests have `cf[23101] == cf[23100]` and `cf[24001]` equal to the project key. | Treat the project key as the canonical root path. |
| **Flat runs are common** | Many runs have no nested folders — every `cf[24001]` is a single segment. Don't assume `/` will be present. | Check `if "/" in path` before splitting. |
| **Special chars in names** | `"12438 - [AL][N] Emails templates (Agent)"` and similar appear in real installs. Brackets, slashes inside names, hyphens, spaces. | Quote folder names in JQL. The `/` you split on is a **path** separator, but folder names themselves can contain other punctuation. |
| **Trailing/leading whitespace** | Some installs accidentally have folder names with leading or trailing spaces. They look identical in the UI but JQL `=` is strict. | `.strip()` the value before splitting; record the original verbatim string for JQL queries. |

---

## When in doubt, cross-check

If the reconstructed tree doesn't match what users see in the
Jira UI:

1. Confirm you swept the **right run** —
   `cf[23100] = "<RUN_ID>"` must match the run ID from step 1
   of the SKILL.md workflow.
2. Confirm the page projection actually returned both
   fields — some MCP wrappers return `null` for custom fields
   that weren't explicitly requested.
3. Re-run with `"*all"` for a single suspicious test and
   inspect both `customfield_23101` and `customfield_24001`
   directly. The pair on the issue is ground truth.
4. If the folder-list API is reachable (try
   `GET /rest/tm/1.0/folder/list?projectKey=<PROJECT>&folderId=<RUN_ID>`),
   diff its output against your reconstruction. The plugin API
   sees folders that contain no tests; your reconstruction
   doesn't. Folders that **do** contain tests must match.

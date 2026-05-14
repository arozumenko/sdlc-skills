#!/usr/bin/env python3
"""
parse-tm-folder-tree.py
=======================
Parse a saved EPAM TM Plugin folder-list response into a printable tree.

Source call (typical MCP shape):

    mcp__<jira-mcp-server>__<connector>_execute_generic_rq
      method: GET
      relative_url: /rest/tm/1.0/folder/list
      params: {"projectKey":"<PROJECT>","folderId":"<rootFolderId>"}

Or the equivalent direct REST call:

    GET https://<your-jira-server>/rest/tm/1.0/folder/list
        ?projectKey=<PROJECT>
        &folderId=<rootFolderId>

MCP responses are usually saved as the tool's raw output — that
format is **doubly-encoded JSON**:

  - Outer wrapper: JSON array  [{type: "text", text: "<escaped JSON string>"}]
  - Inner text: "HTTP: GET ... -> 200 OK <folder-tree JSON>"

Direct REST responses are plain JSON — the script tries the
double-decode first, and falls back to plain JSON if that fails.

Usage
-----
    python3 parse-tm-folder-tree.py <saved-response-file> [--find <folder_id>]

Options
    --find <id>    Print only the subtree rooted at <folder_id>.
    --depth <n>    Limit display depth (default: unlimited; 0 = root only).
    --keywords     Filter to folders/tests whose name contains any of the
                   space-separated keywords (case-insensitive). Supply after
                   all flags: `--keywords smoke payments login`

Examples
    # Print full tree
    python3 parse-tm-folder-tree.py response.txt

    # Print only the subtree under folder id 3597343
    python3 parse-tm-folder-tree.py response.txt --find 3597343

    # Print top 3 levels
    python3 parse-tm-folder-tree.py response.txt --depth 3

    # Find all folders/tests whose name mentions "payment" or "refund"
    python3 parse-tm-folder-tree.py response.txt --keywords payment refund
"""

import sys
import json
import re
import argparse


def decode_response(path: str) -> dict:
    """
    Read the saved TM Plugin folder-list response and return the parsed
    folder tree.

    Handles both shapes:
      1) MCP wrapper: [{type:"text", text:"\"HTTP: GET ... -> 200 OK {...}\""}]
         (doubly encoded — outer JSON wraps an escaped JSON string).
      2) Plain REST response: a JSON object directly.
    """
    with open(path, encoding="utf-8") as fh:
        raw = fh.read().strip()

    # Try MCP doubly-encoded shape first.
    try:
        outer = json.loads(raw)
        if (
            isinstance(outer, list)
            and outer
            and isinstance(outer[0], dict)
            and "text" in outer[0]
        ):
            inner_str = json.loads(outer[0]["text"])
            match = re.search(r"-> 200 OK (.+)$", inner_str, re.DOTALL)
            if match:
                return json.loads(match.group(1))
        # Fell through — `outer` might already be the tree.
        if isinstance(outer, dict) and ("children" in outer or "id" in outer):
            return outer
    except (json.JSONDecodeError, ValueError):
        pass

    # Plain JSON fallback.
    return json.loads(raw)


def find_node(node: dict, target_id: int) -> dict | None:
    """Depth-first search for a node with the given id."""
    if node.get("id") == target_id:
        return node
    for child in node.get("children", []):
        result = find_node(child, target_id)
        if result:
            return result
    return None


def matches_keywords(name: str, keywords: list[str]) -> bool:
    lower = name.lower()
    return any(kw in lower for kw in keywords)


def print_tree(
    node: dict,
    depth: int = 0,
    max_depth: int | None = None,
    keywords: list[str] | None = None,
) -> None:
    name = node.get("name", "?")
    nid = node.get("id", "?")
    children = node.get("children", [])

    label = "LEAF" if not children else f"{len(children)} children"
    indent = "  " * depth

    if keywords is None or matches_keywords(name, keywords):
        print(f"{indent}{name}  (id={nid})  [{label}]")

    if max_depth is not None and depth >= max_depth:
        return

    for child in children:
        print_tree(child, depth + 1, max_depth, keywords)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse a saved EPAM TM Plugin folder-list response."
    )
    parser.add_argument("file", help="Path to the saved response file")
    parser.add_argument(
        "--find", type=int, default=None, metavar="ID",
        help="Print only the subtree rooted at this folder ID"
    )
    parser.add_argument(
        "--depth", type=int, default=None, metavar="N",
        help="Limit display to N levels (0 = root only)"
    )
    parser.add_argument(
        "--keywords", nargs="+", default=None, metavar="WORD",
        help="Show only nodes whose name contains any of these keywords"
    )
    args = parser.parse_args()

    tree = decode_response(args.file)

    root = tree
    if args.find is not None:
        root = find_node(tree, args.find)
        if root is None:
            print(
                f"ERROR: folder id={args.find} not found in the tree.",
                file=sys.stderr,
            )
            sys.exit(1)

    print_tree(
        root,
        depth=0,
        max_depth=args.depth,
        keywords=[kw.lower() for kw in args.keywords] if args.keywords else None,
    )


if __name__ == "__main__":
    main()

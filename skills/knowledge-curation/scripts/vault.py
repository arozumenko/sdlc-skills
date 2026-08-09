#!/usr/bin/env python3
"""Query, traverse and lint an agent memory vault or shared knowledge layer.

DUPLICATED ON PURPOSE. An identical copy ships with both `memory` and
`knowledge-curation` so each skill is self-contained and works when installed
alone. `skills/knowledge-curation/scripts/vault.py` is the CANONICAL copy —
edit there, then copy across. `bin/check-skill-dupes.mjs` fails the build if the
two ever diverge, because silent drift between copies is what this repo has
already been bitten by.

The vault IS a graph — notes, aliases, wikilinks and tags. This computes that
graph from plain files so you can query it WITHOUT opening Obsidian, which is
what an agent needs: recall the right note out of eighty without reading all
eighty, and follow links/backlinks instead of grepping blindly.

Commands
--------
    vault.py query <path> [--tag T] [--type T] [--role R] [--text S] [--stale-days N]
    vault.py show  <path> <note>        frontmatter + summary, no full read
    vault.py links <path> <note>        outgoing, incoming (backlinks), neighbours
    vault.py lint  <path> [--strict]    structural checks

Original lint checks:

Checks the things that are tedious and error-prone to verify by hand:

  * frontmatter present, parseable, and carrying the required keys
  * `name` matches the filename (otherwise [[wikilinks]] silently miss)
  * wikilinks resolve — by filename OR alias, the way Obsidian resolves them
  * heading anchors in [[note#Section]] links point at real headings
  * index (MEMORY.md / README.md) and the files on disk agree, both ways
  * aliases are unique across the vault (a duplicate makes a link ambiguous)
  * notes overdue re-verification (`updated` / `verified` older than --max-age-days)

Stdlib only, Python 3.9+. No PyYAML: the frontmatter here is deliberately simple
(scalars and inline/block lists), so a small tolerant parser beats a dependency.

Unknown keys are REPORTED AT MOST AS INFO, never as errors — a human edits these
vaults in Obsidian and must be free to add their own properties.

Usage
-----
    vault_lint.py <path> [--layer memory|knowledge|auto] [--max-age-days N] [--strict]

Exit codes: 0 = clean (or warnings only), 1 = errors found, 2 = bad invocation.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------------- #
# Layer profiles — what each layer requires.
# --------------------------------------------------------------------------- #

PROFILES = {
    # Per-role memory: .agents/memory/<role>/, index is MEMORY.md
    "memory": {
        "index": "MEMORY.md",
        "required": ("name", "description", "type"),
        "enum": {"type": {"user", "feedback", "project", "reference"}},
        "date_key": "updated",
        "skip_dirs": {"daily"},          # episodic logs are not curated entries
        "skip_files": {"snapshot.md"},   # host-generated, not ours
    },
    # Shared knowledge: .agents/knowledge/, index is a README.md per folder
    "knowledge": {
        "index": "README.md",
        "required": ("name", "description", "type", "applies_to", "verified"),
        "enum": {"type": {"reference", "feedback", "project"}},
        "date_key": "verified",
        "skip_dirs": set(),
        "skip_files": set(),
    },
}

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
MDLINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.M)


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.info: list[str] = []

    def error(self, where: Path, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: Path, msg: str) -> None:
        self.warnings.append(f"{where}: {msg}")

    def note(self, where: Path, msg: str) -> None:
        self.info.append(f"{where}: {msg}")


def parse_frontmatter(text: str) -> dict | None:
    """Return frontmatter as a dict, or None when absent.

    Handles `key: scalar`, `key: [a, b]`, and block lists. Values keep their raw
    string form except lists; that is enough for linting and avoids a dependency.
    """
    m = FM_RE.match(text)
    if not m:
        return None
    out: dict[str, object] = {}
    key: str | None = None
    parent: str | None = None
    for raw in m.group(1).splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        block = re.match(r"^\s+-\s+(.*)$", raw)
        if block and key:                       # block-list item
            out.setdefault(key, [])
            if isinstance(out[key], list):
                out[key].append(block.group(1).strip().strip("\"'"))
            continue
        # Nested mapping (`metadata:` then indented `type: project`) — flatten to
        # `metadata.type`. Some vaults nest what others keep top-level; a linter that
        # cannot see the nested form reports every note as missing a required key.
        nested = re.match(r"^\s+([A-Za-z_][\w-]*):\s*(.*)$", raw)
        if nested and parent:
            out[f"{parent}.{nested.group(1)}"] = nested.group(2).strip().strip("\"'")
            continue
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", raw)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2).strip()
        parent = key if val == "" else None
        if val.startswith("[") and val.endswith("]"):
            items = [v.strip().strip("\"'") for v in val[1:-1].split(",")]
            out[key] = [v for v in items if v]
        elif val == "":
            out[key] = []                       # a block list probably follows
        else:
            out[key] = val.strip("\"'")
    return out


def detect_layer(root: Path) -> str:
    if (root / "MEMORY.md").exists():
        return "memory"
    if (root / "README.md").exists() and any(p.is_dir() for p in root.iterdir()):
        return "knowledge"
    return "memory"


def collect_notes(root: Path, prof: dict) -> list[Path]:
    notes = []
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root)
        if p.name == prof["index"] or p.name in prof["skip_files"]:
            continue
        if any(part in prof["skip_dirs"] for part in rel.parts):
            continue
        notes.append(p)
    return notes


def lint(root: Path, layer: str, max_age_days: int, rep: Report) -> None:
    prof = PROFILES[layer]
    notes = collect_notes(root, prof)
    if not notes:
        rep.warn(root, "no notes found — is this the right path?")
        return

    # Resolution table: filename stem AND every alias, exactly as Obsidian resolves.
    targets: dict[str, Path] = {}
    headings: dict[Path, set[str]] = {}
    alias_owner: dict[str, list[Path]] = {}

    for p in notes:
        text = p.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)
        headings[p] = {h.strip() for h in HEADING_RE.findall(text)}
        targets.setdefault(p.stem, p)

        if fm is None:
            rep.error(p, "no YAML frontmatter (must start with ---)")
            continue

        for key in prof["required"]:
            present = fm.get(key) or fm.get(f"metadata.{key}")
            if not present:
                rep.error(p, f"missing required frontmatter key: {key}")

        for key, allowed in prof["enum"].items():
            val = fm.get(key) or fm.get(f"metadata.{key}")
            if isinstance(val, str) and val and val not in allowed:
                rep.error(p, f"{key}={val!r} not one of {sorted(allowed)}")

        name = fm.get("name")
        # For memory, `name` is slugified into the filename; a mismatch breaks links.
        if layer == "memory" and isinstance(name, str) and name:
            norm = lambda v: re.sub(r"[^a-z0-9]+", "-", v.lower()).strip("-")
            slug = norm(name)
            if slug != norm(p.stem):
                rep.warn(p, f"name {name!r} slugifies to {slug!r}, filename is {p.stem!r}")

        for a in (fm.get("aliases") or []):
            if isinstance(a, str) and a:
                targets.setdefault(a, p)
                alias_owner.setdefault(a, []).append(p)

        date_val = fm.get(prof["date_key"])
        if isinstance(date_val, str) and re.match(r"^\d{4}-\d{2}-\d{2}", date_val):
            try:
                d = _dt.date.fromisoformat(date_val[:10])
                age = (_dt.date.today() - d).days
                if age > max_age_days:
                    rep.warn(p, f"{prof['date_key']}={date_val} is {age}d old — re-verify or retire")
            except ValueError:
                rep.warn(p, f"{prof['date_key']}={date_val!r} is not a valid ISO date")

    for alias, owners in alias_owner.items():
        if len(owners) > 1:
            rep.error(root, f"alias {alias!r} claimed by {len(owners)} notes: "
                            + ", ".join(str(o.relative_to(root)) for o in owners))

    # Links: wikilinks (filename or alias, optional #anchor) and relative md links.
    for p in notes + [q for q in root.rglob(prof["index"])]:
        text = p.read_text(encoding="utf-8", errors="replace")
        for raw in WIKILINK_RE.findall(text):
            body = raw.split("|", 1)[0].strip()
            note_part, _, anchor = body.partition("#")
            note_part, anchor = note_part.strip(), anchor.strip()
            if not note_part:
                continue
            tgt = targets.get(note_part)
            if tgt is None:
                rep.error(p, f"dead wikilink [[{raw}]] — no note or alias {note_part!r}")
            elif anchor and anchor not in headings.get(tgt, set()):
                rep.error(p, f"dead anchor [[{raw}]] — {tgt.stem} has no heading {anchor!r}")
        for href in MDLINK_RE.findall(text):
            if href.startswith(("http://", "https://", "#", "mailto:")):
                continue
            if not (p.parent / href.split("#", 1)[0]).exists():
                rep.error(p, f"dead link -> {href}")

    # Index <-> disk agreement, in both directions.
    for index in sorted(root.rglob(prof["index"])):
        listed = {h.split("#", 1)[0] for h in MDLINK_RE.findall(index.read_text(encoding="utf-8", errors="replace"))
                  if not h.startswith(("http", "#", "mailto:"))}
        siblings = [p for p in notes if p.parent == index.parent]
        for p in siblings:
            if p.name not in listed:
                rep.error(index, f"{p.name} is not indexed — readers will never find it")
        for href in listed:
            if href.endswith(".md") and not (index.parent / href).exists():
                rep.error(index, f"index points at missing file: {href}")

    rep.note(root, f"{len(notes)} notes, {len(targets)} resolvable link targets "
                   f"({len(targets) - len(notes)} via alias)")


# --------------------------------------------------------------------------- #
# Shared index — one pass over the vault, reused by every command.
# --------------------------------------------------------------------------- #


class Note:
    __slots__ = ("path", "fm", "headings", "links", "body")

    def __init__(self, path: Path, fm: dict, headings: set, links: list, body: str):
        self.path, self.fm, self.headings, self.links, self.body = path, fm, headings, links, body

    def get(self, key, default=None):
        return self.fm.get(key) or self.fm.get(f"metadata.{key}") or default

    @property
    def tags(self) -> list:
        t = self.get("tags") or []
        return [t] if isinstance(t, str) else list(t)

    @property
    def roles(self) -> list:
        r = self.get("applies_to") or []
        return [r] if isinstance(r, str) else list(r)


def build_index(root: Path, prof: dict):
    """Return (notes_by_path, targets) where targets maps stem AND alias -> Path."""
    notes: dict[Path, Note] = {}
    targets: dict[str, Path] = {}
    for p in collect_notes(root, prof):
        text = p.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text) or {}
        body = FM_RE.sub("", text, count=1)
        links = [l.split("|", 1)[0].split("#", 1)[0].strip() for l in WIKILINK_RE.findall(text)]
        notes[p] = Note(p, fm, {h.strip() for h in HEADING_RE.findall(text)}, [l for l in links if l], body)
        targets.setdefault(p.stem, p)
        aliases = fm.get("aliases") or []
        for a in ([aliases] if isinstance(aliases, str) else aliases):
            targets.setdefault(a, p)
    return notes, targets


def _age_days(note: Note, prof: dict):
    v = note.get(prof["date_key"])
    if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v):
        try:
            return (_dt.date.today() - _dt.date.fromisoformat(v[:10])).days
        except ValueError:
            return None
    return None


def cmd_query(root: Path, prof: dict, args) -> int:
    notes, _ = build_index(root, prof)
    hits = []
    for p, n in sorted(notes.items()):
        if args.tag and not any(t == args.tag or t.startswith(args.tag.rstrip("/") + "/") for t in n.tags):
            continue
        if args.type and (n.get("type") or "") != args.type:
            continue
        if args.role and args.role not in n.roles:
            continue
        if args.text:
            hay = f"{n.get('name','')}\n{n.get('description','')}\n{n.body}".lower()
            if args.text.lower() not in hay:
                continue
        if args.stale_days is not None:
            age = _age_days(n, prof)
            if age is None or age < args.stale_days:
                continue
        hits.append((p, n))

    if not hits:
        print("no matches")
        return 0
    for p, n in hits:
        age = _age_days(n, prof)
        stamp = f"  [{prof['date_key']} {n.get(prof['date_key'])}{f', {age}d' if age is not None else ''}]" if n.get(prof["date_key"]) else ""
        print(f"{p.relative_to(root)}{stamp}")
        if n.get("description"):
            print(f"    {n.get('description')}")
    print(f"\n{len(hits)} match(es)")
    return 0


def cmd_show(root: Path, prof: dict, args) -> int:
    notes, targets = build_index(root, prof)
    tgt = targets.get(args.note)
    if tgt is None:
        print(f"no note or alias {args.note!r}", file=sys.stderr)
        return 1
    n = notes[tgt]
    print(f"# {tgt.relative_to(root)}")
    for k in ("name", "description", "type", "applies_to", "tags", "aliases", prof["date_key"]):
        v = n.get(k)
        if v:
            print(f"{k}: {v}")
    if n.headings:
        print(f"sections: {', '.join(sorted(n.headings))}")
    para = next((b.strip() for b in n.body.split("\n\n") if b.strip() and not b.lstrip().startswith(("#", ">"))), "")
    if para:
        print(f"\n{para[:500]}")
    return 0


def cmd_links(root: Path, prof: dict, args) -> int:
    notes, targets = build_index(root, prof)
    tgt = targets.get(args.note)
    if tgt is None:
        print(f"no note or alias {args.note!r}", file=sys.stderr)
        return 1

    # Drop self-links: a note often cites its own anchors as examples, which is
    # legitimate prose but pure noise in a graph.
    out = [targets[l] for l in notes[tgt].links if l in targets and targets[l] != tgt]
    back = [p for p, n in notes.items() if p != tgt and any(targets.get(l) == tgt for l in n.links)]
    tags = set(notes[tgt].tags)
    near = [p for p, n in sorted(notes.items())
            if p != tgt and p not in out and p not in back and tags & set(n.tags)]

    def dump(label, paths):
        print(f"{label} ({len(paths)}):")
        for p in sorted(set(paths)):
            print(f"  {p.relative_to(root)}  — {notes[p].get('description','')[:80]}")
        if not paths:
            print("  (none)")

    print(f"# {tgt.relative_to(root)}\n")
    dump("outgoing", out)
    dump("backlinks", back)
    dump("shares a tag", near)
    if not out and not back:
        print("\nNOTE: no links either way — this note is invisible in the graph.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="vault.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--layer", choices=("memory", "knowledge", "auto"), default="auto")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add_common(sp):
        # Also accepted AFTER the subcommand — `query <path> --layer memory` is the
        # order people actually type, and argparse only honours the top-level flag
        # before the subcommand.
        sp.add_argument("--layer", choices=("memory", "knowledge", "auto"), default=None)

    q = sub.add_parser("query", help="find notes by tag / type / role / text / staleness")
    add_common(q)
    q.add_argument("path")
    q.add_argument("--tag", help="exact tag, or a prefix like area/ to match the whole axis")
    q.add_argument("--type")
    q.add_argument("--role", help="match applies_to")
    q.add_argument("--text", help="substring of name, description or body")
    q.add_argument("--stale-days", type=int, help="only notes not re-verified in N days")

    sh = sub.add_parser("show", help="frontmatter + summary without reading the whole file")
    add_common(sh)
    sh.add_argument("path"); sh.add_argument("note", help="filename stem or alias")

    lk = sub.add_parser("links", help="outgoing, backlinks, and tag neighbours")
    add_common(lk)
    lk.add_argument("path"); lk.add_argument("note", help="filename stem or alias")

    ln = sub.add_parser("lint", help="structural checks")
    add_common(ln)
    ln.add_argument("path")
    ln.add_argument("--max-age-days", type=int, default=180)
    ln.add_argument("--strict", action="store_true")

    args = ap.parse_args(argv)
    root = Path(args.path).expanduser().resolve()
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2

    # Sub-parser value wins when given; otherwise fall back to the top-level flag.
    layer = getattr(args, "layer", None) or "auto"
    layer = detect_layer(root) if layer == "auto" else layer
    prof = PROFILES[layer]

    if args.cmd == "query":
        return cmd_query(root, prof, args)
    if args.cmd == "show":
        return cmd_show(root, prof, args)
    if args.cmd == "links":
        return cmd_links(root, prof, args)

    rep = Report()
    lint(root, layer, args.max_age_days, rep)
    for line in rep.info:
        print(f"info  {line}")
    for line in rep.warnings:
        print(f"WARN  {line}")
    for line in rep.errors:
        print(f"ERROR {line}")
    print(f"\n{root}  [{layer}]  {len(rep.errors)} error(s), {len(rep.warnings)} warning(s)")
    return 1 if (rep.errors or (args.strict and rep.warnings)) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

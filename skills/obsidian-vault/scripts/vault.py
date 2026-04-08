#!/usr/bin/env python3
"""Octobots Obsidian vault CLI — headless second-brain operations.

See ../SKILL.md for the full reference. All commands respect:
    --vault <path>     overrides $OBSIDIAN_VAULT_PATH (falls back to $OCTOBOTS_VAULT_PATH)
    --role <name>      namespace for agent-internal pending state (default: "default")

Stdlib only. ripgrep used if available, else falls back to grep.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────────────

VALID_TYPES = {
    "signal", "project", "research", "decision", "meeting", "person",
    "plan", "memory", "mail", "chat",
}
VALID_STATUSES = {"inbox", "active", "done", "archived"}
VALID_SOURCES = {"email", "telegram", "teams", "manual", "web", "voice"}

# Folder home for each type. Used by `file` and `new`.
TYPE_FOLDER = {
    "signal": "inbox",
    "project": "projects",
    "research": "researches",
    "decision": "decisions",
    "meeting": "meetings",
    "person": "people",
    "plan": "plans",
    "memory": "memories",
    "mail": "mails",
    "chat": "chats",
}

REQUIRED_FIELDS = {"type", "status", "created"}
PER_TYPE_FIELDS: dict[str, set[str]] = {
    "person": {"org", "role", "last_contact", "topics", "urgency"},
    "meeting": {"attendees", "agenda", "actions", "duration_min"},
    "decision": {"alternatives", "rationale", "would_change_mind_if"},
    "project": {"started", "target_date", "blocker", "next_action"},
    "mail": {"from", "to", "subject", "received_at", "thread_id"},
    "chat": {"channel", "participants", "received_at"},
}
BASELINE_FIELDS = {
    "type", "status", "created", "source", "people", "projects", "tags",
    "processed_at", "aliases",
}

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$")
QUOTE_TRIGGER = ":#{}&*!|>'\"%@`,"

CONFLICT_PATTERNS = [
    re.compile(r".+\(.+'s [A-Za-z]+\)\.md$"),  # "(Anna's iPhone).md"
    re.compile(r".*[Cc]onflict.*\.md$"),
    re.compile(r".*\.sync-conflict-.*\.md$"),
]

ALL_FOLDERS = [
    "inbox", "daily", "people", "projects", "researches", "meetings",
    "decisions", "memories", "mails", "chats", "plans", "attachments",
    "templates", "open-loops-archive",
]


# ────────────────────────────────────────────────────────────────────────────
# Utility
# ────────────────────────────────────────────────────────────────────────────

def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\s-]+", "", name.strip().lower())
    s = re.sub(r"[\s_]+", "-", s)
    return s.strip("-") or "note"


def short_id(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


def is_conflict_file(path: Path) -> bool:
    name = path.name
    return any(p.match(name) for p in CONFLICT_PATTERNS)


def has_rg() -> bool:
    return shutil.which("rg") is not None


# ────────────────────────────────────────────────────────────────────────────
# Vault resolution
# ────────────────────────────────────────────────────────────────────────────

@dataclass
class Vault:
    root: Path
    role: str

    def ensure_layout(self) -> None:
        for f in ALL_FOLDERS:
            (self.root / f).mkdir(parents=True, exist_ok=True)

    def folder(self, name: str) -> Path:
        return self.root / name

    def daily_path(self, date: _dt.date | None = None) -> Path:
        date = date or _dt.date.today()
        return self.root / "daily" / f"{date.isoformat()}.md"

    def loops_path(self) -> Path:
        return self.root / "open-loops.md"

    def loops_archive_path(self, date: _dt.date | None = None) -> Path:
        date = date or _dt.date.today()
        return self.root / "open-loops-archive" / f"{date.strftime('%Y-%m')}.md"

    def people_pending_path(self) -> Path:
        # Vault-local agent state. Hidden dir travels with the vault so the
        # skill works identically in standalone installs and inside octobots.
        base = self.root / ".obsidian-vault" / self.role
        base.mkdir(parents=True, exist_ok=True)
        return base / "people-pending.md"


def resolve_vault(arg_vault: str | None, arg_role: str | None) -> Vault:
    vault_str = (
        arg_vault
        or os.environ.get("OBSIDIAN_VAULT_PATH")
        or os.environ.get("OCTOBOTS_VAULT_PATH")
        or ""
    )
    if not vault_str:
        die("vault path not set — pass --vault or set OBSIDIAN_VAULT_PATH")
    root = Path(vault_str).expanduser().resolve()
    if not root.is_dir():
        die(f"vault path is not a directory: {root}")
    role = arg_role or os.environ.get("OCTOBOTS_ID") or "default"
    return Vault(root=root, role=role)


# ────────────────────────────────────────────────────────────────────────────
# Frontmatter parsing — minimal YAML, not a full parser
# ────────────────────────────────────────────────────────────────────────────

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


def _strip_quotes(s: str) -> str:
    if len(s) >= 2 and ((s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")):
        return s[1:-1].replace('\\"', '"')
    return s


def _split_flow_list(inner: str) -> list[str]:
    """Split a flow-style YAML list body, respecting [[...]] wikilinks."""
    items: list[str] = []
    depth = 0
    buf = ""
    for ch in inner:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        if ch == "," and depth == 0:
            items.append(_strip_quotes(buf.strip()))
            buf = ""
        else:
            buf += ch
    if buf.strip():
        items.append(_strip_quotes(buf.strip()))
    return items


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    """Return (frontmatter_dict, body). Handles strings and block/flow lists.

    Not a full YAML parser — supports the subset the skill writes plus
    common user-edited shapes (block lists, quoted scalars, flow lists with
    nested wikilinks).
    """
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm: dict[str, object] = {}
    current_key: str | None = None
    for raw in m.group(1).splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        # Block-list item belonging to the previous key
        stripped = raw.lstrip()
        if stripped.startswith("- ") and current_key is not None and raw.startswith((" ", "\t", "- ")):
            item = _strip_quotes(stripped[2:].strip())
            existing = fm.get(current_key)
            if not isinstance(existing, list):
                fm[current_key] = []
            fm[current_key].append(item)  # type: ignore[union-attr]
            continue
        if ":" not in raw:
            continue
        k, _, v = raw.partition(":")
        k = k.strip()
        v = v.strip()
        if v == "":
            # Begin a (possibly empty) block list
            fm[k] = []
            current_key = k
            continue
        if v.startswith("[") and v.endswith("]"):
            fm[k] = _split_flow_list(v[1:-1].strip())
            current_key = None
            continue
        fm[k] = _strip_quotes(v)
        current_key = None
    return fm, text[m.end():]


def _quote_scalar(s: str) -> str:
    # ISO dates/datetimes pass through unquoted.
    if ISO_DATE_RE.match(s):
        return s
    if any(c in s for c in QUOTE_TRIGGER) or s.startswith("[") or s.startswith("-"):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
    return s


def _quote_list_item(s: str) -> str:
    # Wikilinks must be quoted to be valid YAML inside a list, but Obsidian
    # still recognizes them as link properties.
    if s.startswith("[[") or any(c in s for c in QUOTE_TRIGGER):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
    return s


def render_frontmatter(fm: dict[str, object]) -> str:
    lines = ["---"]
    for k, v in fm.items():
        if v is None or v == "":
            continue
        if isinstance(v, list):
            if not v:
                continue
            lines.append(f"{k}:")
            for item in v:
                lines.append(f"  - {_quote_list_item(str(item))}")
        else:
            lines.append(f"{k}: {_quote_scalar(str(v))}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def read_note(path: Path) -> tuple[dict[str, str], str]:
    return parse_frontmatter(path.read_text(encoding="utf-8"))


def write_note(path: Path, fm: dict[str, object], body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_frontmatter(fm) + body.lstrip("\n"), encoding="utf-8")


# ────────────────────────────────────────────────────────────────────────────
# Templates
# ────────────────────────────────────────────────────────────────────────────

def base_frontmatter(note_type: str, status: str = "inbox") -> dict[str, object]:
    today = _dt.date.today().isoformat()
    return {
        "type": note_type,
        "status": status,
        "created": today,
        "source": "manual",
        "people": [],
        "projects": [],
        "tags": [],
        "processed_at": _dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    }


def template_body(note_type: str, name: str, **kwargs: object) -> str:
    title = kwargs.get("title") or name.replace("-", " ").title()
    if note_type == "person":
        return (
            f"# {title}\n\n"
            f"> [!info] Profile\n"
            f"> Org: {kwargs.get('org', '')}\n"
            f"> Role: {kwargs.get('role', '')}\n\n"
            f"## Topics\n\n## Interaction history\n"
        )
    if note_type == "meeting":
        return (
            f"# {title}\n\n"
            f"> [!info] Meeting\n"
            f"> Attendees: {kwargs.get('attendees', '')}\n"
            f"> Duration: {kwargs.get('duration_min', '')} min\n\n"
            f"## Agenda\n\n## Notes\n\n## Actions\n"
        )
    if note_type == "decision":
        return (
            f"# {title}\n\n"
            f"## Context\n\n## Decision\n\n## Alternatives considered\n\n"
            f"## Rationale\n{kwargs.get('rationale', '')}\n\n"
            f"## Would change our mind if\n"
        )
    if note_type == "project":
        return (
            f"# {title}\n\n"
            f"> [!info] Project\n"
            f"> Started: {kwargs.get('started', _dt.date.today().isoformat())}\n"
            f"> Target: {kwargs.get('target_date', 'TBD')}\n\n"
            f"## Goal\n\n## Next action\n\n## Open loops\n\n## History\n"
        )
    if note_type == "research":
        return f"# {title}\n\n## Summary\n\n## Notes\n\n## References\n"
    if note_type == "plan":
        return f"# {title}\n\n## Intent\n\n## Steps\n\n## Risks\n"
    if note_type == "memory":
        return f"# {title}\n\n"
    if note_type in ("mail", "chat", "signal"):
        return f"# {title}\n\n## Content\n\n{kwargs.get('content', '')}\n"
    return f"# {title}\n"


# ────────────────────────────────────────────────────────────────────────────
# Commands
# ────────────────────────────────────────────────────────────────────────────

def cmd_new(vault: Vault, args: argparse.Namespace) -> int:
    note_type = args.type
    if note_type not in VALID_TYPES:
        die(f"invalid type: {note_type} (valid: {sorted(VALID_TYPES)})")
    folder = TYPE_FOLDER.get(note_type, "inbox")
    vault.ensure_layout()

    slug = slugify(args.slug)
    target = vault.folder(folder) / f"{slug}.md"
    if target.exists() and not args.force:
        die(f"note already exists: {target} (use --force to overwrite)")

    fm = base_frontmatter(note_type, status="active" if note_type != "signal" else "inbox")
    if args.description:
        fm["tags"] = []
    extras = {
        "title": args.title or args.slug,
        "org": args.org,
        "role": args.role_field,
        "rationale": args.rationale,
        "attendees": args.attendees,
        "duration_min": args.duration_min,
        "started": args.started,
        "target_date": args.target_date,
        "content": args.content,
    }
    body = template_body(note_type, slug, **extras)

    if args.attendees:
        # Materialize as wikilinks
        people = [f"[[people/{slugify(a)}]]" for a in args.attendees.split(",") if a.strip()]
        fm["people"] = people
        fm["attendees"] = people
    if args.project:
        fm["projects"] = [f"[[projects/{slugify(args.project)}]]"]
    if args.person:
        fm["people"] = [f"[[people/{slugify(args.person)}]]"]
    if args.tag:
        fm["tags"] = [t.strip() for t in args.tag.split(",") if t.strip()]
    if args.description:
        fm["description"] = args.description
    if args.source:
        fm["source"] = args.source
    if args.title and slugify(args.title) != slug:
        fm["aliases"] = [args.title]

    write_note(target, fm, body)
    print(f"created → {target}")
    return 0


def cmd_file(vault: Vault, args: argparse.Namespace) -> int:
    src = Path(args.path)
    if not src.is_absolute():
        src = vault.root / src
    if not src.is_file():
        die(f"not a file: {src}")
    if is_conflict_file(src):
        die(f"sync conflict file — refusing to operate: {src.name}")

    note_type = args.type
    if note_type not in VALID_TYPES:
        die(f"invalid type: {note_type}")
    folder = TYPE_FOLDER[note_type]
    vault.ensure_layout()

    fm, body = read_note(src)
    fm["type"] = note_type
    if args.status:
        fm["status"] = args.status
    elif "status" not in fm:
        fm["status"] = "inbox"
    fm["processed_at"] = _dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    if args.source:
        fm["source"] = args.source
    if args.person:
        fm.setdefault("people", "")
        fm["people"] = [f"[[people/{slugify(p)}]]" for p in args.person.split(",")]
    if args.project:
        fm["projects"] = [f"[[projects/{slugify(args.project)}]]"]
    if args.tag:
        fm["tags"] = [t.strip() for t in args.tag.split(",") if t.strip()]
    if "created" not in fm:
        fm["created"] = _dt.date.today().isoformat()

    target = vault.folder(folder) / src.name
    if target.exists() and target != src and not args.force:
        die(f"target exists: {target} (use --force to overwrite)")

    write_note(target, fm, body)
    if target != src:
        src.unlink()
    print(f"filed → {target}")

    # Auto-touch people referenced
    if args.person:
        for p in args.person.split(","):
            _person_touch(vault, p.strip(), org=None, role=None)
    return 0


def cmd_show(vault: Vault, args: argparse.Namespace) -> int:
    p = Path(args.path)
    if not p.is_absolute():
        p = vault.root / p
    if not p.is_file():
        die(f"not a file: {p}")
    fm, body = read_note(p)
    print(f"# {p.relative_to(vault.root)}\n")
    if fm:
        for k, v in fm.items():
            print(f"  {k}: {v}")
        print()
    # First paragraph
    first = body.strip().split("\n\n", 1)[0]
    print(first[:1500])
    return 0


# ────────────────────────────────────────────────────────────────────────────
# find — ripgrep-backed
# ────────────────────────────────────────────────────────────────────────────

def _grep(pattern: str, root: Path) -> list[Path]:
    if has_rg():
        cmd = ["rg", "-l", "--type=md", pattern, str(root)]
    else:
        cmd = ["grep", "-rlE", "--include=*.md", pattern, str(root)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        return []
    if r.returncode not in (0, 1):  # 1 = no match, fine
        return []
    return [Path(line) for line in r.stdout.splitlines() if line]


def cmd_find(vault: Vault, args: argparse.Namespace) -> int:
    patterns = []
    if args.type:
        patterns.append(rf"^type:\s*{re.escape(args.type)}\b")
    if args.status:
        patterns.append(rf"^status:\s*{re.escape(args.status)}\b")
    if args.tag:
        patterns.append(rf"^tags:.*\b{re.escape(args.tag)}\b")
    if args.person:
        patterns.append(rf"\[\[people/{re.escape(slugify(args.person))}\]\]")
    if args.project:
        patterns.append(rf"\[\[projects/{re.escape(slugify(args.project))}\]\]")

    if not patterns:
        die("at least one filter required (--type/--status/--tag/--person/--project)")

    # Intersect: start with first match, narrow with subsequent
    result: set[Path] | None = None
    for pat in patterns:
        hits = set(_grep(pat, vault.root))
        result = hits if result is None else result & hits

    paths = sorted(result or [])
    # Skip conflict files
    paths = [p for p in paths if not is_conflict_file(p)]

    # Optional --since filter
    if args.since:
        cutoff = _parse_since(args.since)
        if cutoff:
            paths = [
                p for p in paths
                if _note_created(p) and _note_created(p) >= cutoff
            ]

    if args.count:
        print(len(paths))
        return 0

    for p in paths:
        rel = p.relative_to(vault.root)
        fm, _ = read_note(p)
        title = fm.get("type", "?")
        status = fm.get("status", "?")
        print(f"{rel}  [{title}/{status}]")
    if not paths:
        print("(no matches)")
    return 0


def _parse_since(spec: str) -> _dt.date | None:
    m = re.match(r"(\d+)([dwmy])", spec.strip().lower())
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    days = {"d": 1, "w": 7, "m": 30, "y": 365}[unit] * n
    return _dt.date.today() - _dt.timedelta(days=days)


def _note_created(path: Path) -> _dt.date | None:
    try:
        fm, _ = read_note(path)
    except OSError:
        return None
    s = fm.get("created", "")
    try:
        return _dt.date.fromisoformat(s)
    except ValueError:
        return None


# ────────────────────────────────────────────────────────────────────────────
# People
# ────────────────────────────────────────────────────────────────────────────

def cmd_person(vault: Vault, args: argparse.Namespace) -> int:
    return _person_touch(vault, args.name, org=args.org, role=args.role_field, touch=args.touch)


def _person_touch(vault: Vault, name: str, org: str | None, role: str | None, touch: bool = True) -> int:
    vault.ensure_layout()
    slug = slugify(name)
    person_path = vault.folder("people") / f"{slug}.md"

    if person_path.exists():
        if touch:
            fm, body = read_note(person_path)
            fm["last_contact"] = _dt.date.today().isoformat()
            if org:
                fm["org"] = org
            if role:
                fm["role"] = role
            write_note(person_path, fm, body)
            print(f"touched → {person_path}")
        else:
            print(f"exists → {person_path}")
        return 0

    if not touch:
        print(f"not found → people/{slug}.md (pass --touch to record)")
        return 0

    # Not yet a real note. Check pending list.
    pending = vault.people_pending_path()
    pending_lines = pending.read_text(encoding="utf-8").splitlines() if pending.is_file() else []
    pending_slugs = {ln.split("|", 1)[0].strip() for ln in pending_lines if ln.strip()}

    if slug in pending_slugs:
        # Second touch — promote
        fm = base_frontmatter("person", status="active")
        fm["org"] = org or ""
        fm["role"] = role or ""
        fm["last_contact"] = _dt.date.today().isoformat()
        if name and slugify(name) != name:
            fm["aliases"] = [name]
        body = template_body("person", slug, title=name, org=org or "", role=role or "")
        write_note(person_path, fm, body)
        # Remove from pending
        kept = [ln for ln in pending_lines if not ln.startswith(slug + "|")]
        pending.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
        print(f"promoted → {person_path}")
    else:
        # First touch — record in pending, do not create
        pending_lines.append(f"{slug}|{name}|{_dt.date.today().isoformat()}")
        pending.write_text("\n".join(pending_lines) + "\n", encoding="utf-8")
        print(f"pending → {pending} (first touch; will create on second)")
    return 0


# ────────────────────────────────────────────────────────────────────────────
# Open loops
# ────────────────────────────────────────────────────────────────────────────

LOOP_LINE_RE = re.compile(r"^- \[(?P<id>[a-f0-9]{8})\] (?P<text>.+?)(?:  _\(closed (?P<closed>\d{4}-\d{2}-\d{2})\)_)?$")


def _read_loops(path: Path) -> list[tuple[str, str]]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = LOOP_LINE_RE.match(line.strip())
        if m:
            out.append((m.group("id"), m.group("text")))
    return out


def cmd_loop(vault: Vault, args: argparse.Namespace) -> int:
    vault.ensure_layout()
    loops = vault.loops_path()
    if not loops.is_file():
        loops.write_text("# Open loops\n\n", encoding="utf-8")

    if args.action == "add":
        if not args.text:
            die("loop add requires text")
        text = args.text.strip()
        lid = short_id(text + _dt.datetime.now().isoformat())
        line = f"- [{lid}] {text}"
        with loops.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        print(f"loop added [{lid}]")
        return 0

    if args.action == "list":
        items = _read_loops(loops)
        if not items:
            print("(no open loops)")
            return 0
        for lid, text in items:
            print(f"  [{lid}] {text}")
        return 0

    if args.action == "done":
        if not args.id:
            die("loop done requires --id")
        items = _read_loops(loops)
        match = next((t for i, t in items if i == args.id), None)
        if not match:
            die(f"no open loop with id {args.id}")
        # Cut from open-loops.md
        new_lines = []
        for line in loops.read_text(encoding="utf-8").splitlines():
            m = LOOP_LINE_RE.match(line.strip())
            if m and m.group("id") == args.id:
                continue
            new_lines.append(line)
        loops.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        # Append to current month's archive
        archive = vault.loops_archive_path()
        archive.parent.mkdir(parents=True, exist_ok=True)
        if not archive.is_file():
            month = _dt.date.today().strftime("%Y-%m")
            archive.write_text(
                f"---\ntype: archive\nstatus: archived\nperiod: {month}\n---\n\n# Closed loops — {month}\n\n",
                encoding="utf-8",
            )
        with archive.open("a", encoding="utf-8") as f:
            f.write(f"- [{args.id}] {match}  _(closed {_dt.date.today().isoformat()})_\n")
        print(f"loop closed [{args.id}] → {archive.relative_to(vault.root)}")
        return 0

    die(f"unknown loop action: {args.action}")
    return 2


# ────────────────────────────────────────────────────────────────────────────
# Daily notes
# ────────────────────────────────────────────────────────────────────────────

def cmd_daily(vault: Vault, args: argparse.Namespace) -> int:
    vault.ensure_layout()
    if args.action == "append":
        if not args.text:
            die("daily append requires text")
        fp = vault.daily_path()
        if not fp.is_file():
            today = _dt.date.today()
            fp.parent.mkdir(parents=True, exist_ok=True)
            # Daily notes are schemaless — the user owns them, the agent appends.
            fp.write_text(f"# {today.isoformat()}\n\n## Log\n\n", encoding="utf-8")
        ts = _dt.datetime.now().strftime("%H:%M")
        with fp.open("a", encoding="utf-8") as f:
            f.write(f"- [{ts}] {args.text.strip()}\n")
        print(f"appended → {fp.relative_to(vault.root)}")
        return 0

    if args.action == "show":
        date = _dt.date.fromisoformat(args.date) if args.date else _dt.date.today()
        fp = vault.daily_path(date)
        if not fp.is_file():
            print(f"(no daily note for {date.isoformat()})")
            return 0
        print(fp.read_text(encoding="utf-8"))
        return 0

    die(f"unknown daily action: {args.action}")
    return 2


# ────────────────────────────────────────────────────────────────────────────
# Linking
# ────────────────────────────────────────────────────────────────────────────

def cmd_link(vault: Vault, args: argparse.Namespace) -> int:
    src = Path(args.source)
    if not src.is_absolute():
        src = vault.root / src
    if not src.is_file():
        die(f"source not found: {src}")
    target_rel = args.target.replace(".md", "")
    fm, body = read_note(src)
    wikilink = f"[[{target_rel}]]"
    if wikilink in body:
        print(f"already linked → {src.relative_to(vault.root)}")
        return 0
    if "## Related" in body:
        # Insert as a new bullet directly under the existing heading.
        head, sep, rest = body.partition("## Related")
        rest_lines = rest.split("\n")
        insert_at = 1
        while insert_at < len(rest_lines) and not rest_lines[insert_at].strip():
            insert_at += 1
        rest_lines.insert(insert_at, f"- {wikilink}")
        body = head + sep + "\n".join(rest_lines)
    else:
        if not body.endswith("\n"):
            body += "\n"
        body += f"\n## Related\n\n- {wikilink}\n"
    write_note(src, fm, body)
    print(f"linked {src.name} → {wikilink}")
    return 0


# ────────────────────────────────────────────────────────────────────────────
# Bases
# ────────────────────────────────────────────────────────────────────────────

def cmd_bases(vault: Vault, args: argparse.Namespace) -> int:
    bases_src = Path(__file__).parent.parent / "templates" / "bases"
    if args.action == "list":
        for p in sorted(bases_src.glob("*.base")):
            print(f"  {p.name}")
        return 0
    if args.action == "install":
        installed = []
        for p in sorted(bases_src.glob("*.base")):
            target = vault.root / p.name
            if target.exists() and not args.force:
                print(f"  skip (exists): {p.name}")
                continue
            target.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
            installed.append(p.name)
        print(f"installed {len(installed)} base file(s)")
        for n in installed:
            print(f"  → {n}")
        return 0
    die(f"unknown bases action: {args.action}")
    return 2


# ────────────────────────────────────────────────────────────────────────────
# Validation
# ────────────────────────────────────────────────────────────────────────────

def cmd_validate(vault: Vault, args: argparse.Namespace) -> int:
    issues: list[str] = []
    conflicts: list[Path] = []

    for md in vault.root.rglob("*.md"):
        parts = md.relative_to(vault.root).parts
        if parts[0] in ("templates", ".obsidian", ".obsidian-vault"):
            continue
        if is_conflict_file(md):
            conflicts.append(md)
            continue
        try:
            fm, _ = read_note(md)
        except OSError:
            continue
        rel = md.relative_to(vault.root)

        # Skip notes without frontmatter (legacy / user-created)
        if not fm:
            continue

        if args.type and fm.get("type") != args.type:
            continue

        # Required baseline
        for f in REQUIRED_FIELDS:
            if f not in fm:
                issues.append(f"{rel}: missing required field '{f}'")
        # Type validity
        t = fm.get("type", "")
        if t and t not in VALID_TYPES:
            issues.append(f"{rel}: unknown type '{t}'")
        s = fm.get("status", "")
        if s and s not in VALID_STATUSES:
            issues.append(f"{rel}: unknown status '{s}'")
        src = fm.get("source", "")
        if src and src not in VALID_SOURCES:
            issues.append(f"{rel}: unknown source '{src}'")
        # Date format
        c = fm.get("created", "")
        if c:
            try:
                _dt.date.fromisoformat(c)
            except ValueError:
                issues.append(f"{rel}: invalid created date '{c}'")
        # Unknown fields (warn-only)
        known = BASELINE_FIELDS | PER_TYPE_FIELDS.get(t, set()) | {"description"}
        for k in fm:
            if k not in known:
                issues.append(f"{rel}: unknown field '{k}' (warn)")

    if conflicts:
        print(f"⚠ {len(conflicts)} sync conflict file(s) — resolve manually:")
        for c in conflicts:
            print(f"  {c.relative_to(vault.root)}")
        print()

    if not issues:
        print("✓ vault clean")
        return 0

    for i in issues:
        print(i)
    print(f"\n{len(issues)} issue(s)")
    return 1 if args.strict else 0


# ────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ────────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vault.py", description="Octobots Obsidian vault CLI")
    p.add_argument("--vault", help="vault path (default: $OCTOBOTS_VAULT_PATH)")
    p.add_argument("--role", help="role name (default: $OCTOBOTS_ID)")
    sub = p.add_subparsers(dest="cmd", required=True)

    # new
    sp = sub.add_parser("new", help="create a new note from template")
    sp.add_argument("type", choices=sorted(VALID_TYPES))
    sp.add_argument("slug")
    sp.add_argument("--title")
    sp.add_argument("--description")
    sp.add_argument("--content")
    sp.add_argument("--source", choices=sorted(VALID_SOURCES))
    sp.add_argument("--person")
    sp.add_argument("--project")
    sp.add_argument("--tag")
    sp.add_argument("--org")
    sp.add_argument("--role-field", dest="role_field")
    sp.add_argument("--rationale")
    sp.add_argument("--attendees")
    sp.add_argument("--duration-min", dest="duration_min")
    sp.add_argument("--started")
    sp.add_argument("--target-date", dest="target_date")
    sp.add_argument("--force", action="store_true")

    # file
    sp = sub.add_parser("file", help="file an inbox note into its right home")
    sp.add_argument("path")
    sp.add_argument("--type", required=True, choices=sorted(VALID_TYPES))
    sp.add_argument("--status")
    sp.add_argument("--source")
    sp.add_argument("--person")
    sp.add_argument("--project")
    sp.add_argument("--tag")
    sp.add_argument("--force", action="store_true")

    # show
    sp = sub.add_parser("show", help="print frontmatter + first paragraph")
    sp.add_argument("path")

    # find
    sp = sub.add_parser("find", help="search by frontmatter facets")
    sp.add_argument("--type")
    sp.add_argument("--status")
    sp.add_argument("--tag")
    sp.add_argument("--person")
    sp.add_argument("--project")
    sp.add_argument("--since", help="e.g. 7d, 2w, 1m, 1y")
    sp.add_argument("--count", action="store_true")

    # person
    sp = sub.add_parser("person", help="find/create/touch a person note")
    sp.add_argument("name")
    sp.add_argument("--touch", action="store_true")
    sp.add_argument("--org")
    sp.add_argument("--role-field", dest="role_field")

    # loop
    sp = sub.add_parser("loop", help="manage open-loops.md")
    sp.add_argument("action", choices=["add", "list", "done"])
    sp.add_argument("text", nargs="?")
    sp.add_argument("--id")

    # daily
    sp = sub.add_parser("daily", help="daily note operations")
    sp.add_argument("action", choices=["append", "show"])
    sp.add_argument("text", nargs="?")
    sp.add_argument("--date")

    # link
    sp = sub.add_parser("link", help="add a wikilink from source → target")
    sp.add_argument("source")
    sp.add_argument("target")

    # bases
    sp = sub.add_parser("bases", help="install starter .base files")
    sp.add_argument("action", choices=["install", "list"])
    sp.add_argument("--force", action="store_true")

    # validate
    sp = sub.add_parser("validate", help="lint frontmatter against schema")
    sp.add_argument("--strict", action="store_true")
    sp.add_argument("--type")

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    vault = resolve_vault(args.vault, args.role)

    dispatch = {
        "new": cmd_new,
        "file": cmd_file,
        "show": cmd_show,
        "find": cmd_find,
        "person": cmd_person,
        "loop": cmd_loop,
        "daily": cmd_daily,
        "link": cmd_link,
        "bases": cmd_bases,
        "validate": cmd_validate,
    }
    fn = dispatch.get(args.cmd)
    if not fn:
        die(f"unknown command: {args.cmd}", 2)
    return fn(vault, args)


if __name__ == "__main__":
    sys.exit(main())

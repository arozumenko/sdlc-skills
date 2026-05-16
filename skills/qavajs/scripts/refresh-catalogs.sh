#!/usr/bin/env bash
#
# refresh-catalogs.sh — re-pull qavajs step packages from GitHub and rewrite
# `references/steps-*.md` with the literal Gherkin patterns + @example lines.
#
# Idempotent. Show the diff to the user before committing.
#
# Usage:  ./scripts/refresh-catalogs.sh [--keep-tmp]
#
# Requires: bash, git, python3.

set -euo pipefail

SKILL_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REFS_DIR="$SKILL_DIR/references"
TMP_DIR="${TMP_DIR:-$(mktemp -d -t qavajs-refresh-XXXX)}"
KEEP_TMP=false

for arg in "$@"; do
    case "$arg" in
        --keep-tmp) KEEP_TMP=true ;;
        -h|--help)
            sed -n '1,12p' "$0"
            exit 0
            ;;
    esac
done

echo "→ Skill dir:  $SKILL_DIR"
echo "→ Refs dir:   $REFS_DIR"
echo "→ Temp dir:   $TMP_DIR"
echo

# 1. Shallow-clone the eleven step repos in parallel.
declare -a REPOS=(
    steps-memory
    steps-playwright
    steps-wdio
    steps-api
    steps-sql
    steps-files
    steps-gmail
    steps-lighthouse
    steps-visual-testing
    steps-accessibility
    steps-accessibility-ea
)

mkdir -p "$TMP_DIR"
cd "$TMP_DIR"
echo "→ Cloning…"
for repo in "${REPOS[@]}"; do
    if [ ! -d "$repo" ]; then
        git clone --depth 1 --quiet "https://github.com/qavajs/$repo.git" "$repo" &
    fi
done
wait
echo "✓ All repos cloned."
echo

# 2. Extract step patterns with the Python script that ships with this skill.
EXTRACT_PY="$TMP_DIR/extract.py"
cat > "$EXTRACT_PY" <<'PY'
#!/usr/bin/env python3
"""Extract literal Gherkin step patterns + @example docstrings from qavajs step packages."""
import os, re, sys
from pathlib import Path

ROOT = Path(sys.argv[1])
OUT  = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

STEP_RE = re.compile(
    r"^(?P<kw>Given|When|Then)\s*\(\s*['\"`](?P<pattern>[^'\"`]+)['\"`]",
    re.MULTILINE,
)
JSDOC_BLOCK_RE = re.compile(r"/\*\*(?P<body>.*?)\*/", re.DOTALL)
EXAMPLE_LINE_RE = re.compile(r"^\s*\*\s*@example\s*(?P<text>.*)$", re.MULTILINE)


def extract_steps(src_dir: Path):
    for f in sorted(src_dir.rglob("*.ts")):
        text = f.read_text(encoding="utf-8", errors="replace")
        jsdocs = [(m.start(), m.end(), m.group("body")) for m in JSDOC_BLOCK_RE.finditer(text)]
        for m in STEP_RE.finditer(text):
            kw, pattern = m.group("kw"), m.group("pattern")
            preceding = [j for j in jsdocs if j[1] <= m.start()]
            examples = []
            if preceding:
                last = preceding[-1]
                gap = text[last[1]:m.start()]
                if gap.count("\n") <= 4:
                    examples = [em.group("text").strip() for em in EXAMPLE_LINE_RE.finditer(last[2])]
            yield kw, pattern, examples, str(f.relative_to(ROOT))


def write_catalog(name: str, src_dir: Path):
    rows = list(extract_steps(src_dir))
    if not rows:
        print(f"  (no steps found in {src_dir})")
        return
    by_file = {}
    for kw, pat, ex, f in rows:
        by_file.setdefault(f, []).append((kw, pat, ex))
    out = OUT / f"{name}.md"
    with out.open("w") as fh:
        fh.write(f"# {name} — literal Gherkin step catalog\n\n")
        fh.write(f"Auto-extracted from `https://github.com/qavajs/{name}` source.\n\n")
        fh.write(f"Total: **{len(rows)} step definitions**\n\n")
        for src_file in sorted(by_file):
            fh.write(f"## `{src_file}`\n\n")
            for kw, pat, ex in by_file[src_file]:
                fh.write(f"### `{kw}` `{pat}`\n")
                if ex:
                    fh.write("Examples:\n")
                    for e in ex:
                        fh.write(f"- `{e}`\n")
                fh.write("\n")
    print(f"  wrote {out} ({len(rows)} steps)")


if __name__ == "__main__":
    repos = [
        "steps-memory", "steps-playwright", "steps-wdio", "steps-api",
        "steps-sql", "steps-files", "steps-gmail", "steps-lighthouse",
        "steps-visual-testing", "steps-accessibility", "steps-accessibility-ea",
    ]
    for name in repos:
        print(f"== {name} ==")
        write_catalog(name, ROOT / name / "src")
PY
echo "→ Extracting catalogs…"
python3 "$EXTRACT_PY" "$TMP_DIR" "$REFS_DIR"
echo

# 3. Cleanup unless --keep-tmp.
if [ "$KEEP_TMP" = false ]; then
    rm -rf "$TMP_DIR"
    echo "✓ Cleaned up $TMP_DIR"
else
    echo "ℹ Kept $TMP_DIR for inspection"
fi

echo
echo "✅ Done. Run \`git diff $REFS_DIR\` to see what changed."

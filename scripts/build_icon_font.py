#!/usr/bin/env python3
"""Build the self-hosted Material Symbols subset used by CarePoint.

Why this exists
---------------
Google's icon font ships ~4,000 glyphs (948 KB; 4 MB as variable woff2). The
design system uses a few dozen, and the plan targets users on 2G/3G links, so
shipping the whole face is indefensible.

It also exists because a missing icon is silent: an unknown name renders as
blank space, not an error. The Stitch sample itself asks for `nights_stay`,
which this font does not contain. So the script *verifies* every name before
writing anything, and exits non-zero if one cannot be resolved.

Two things are produced from one pass:
  public/fonts/material-symbols-outlined.ttf   the subset itself
  lib/icon-codepoints.ts                       name -> codepoint map

Addressing glyphs by codepoint rather than by ligature is deliberate. Material
Symbols ships a `rlig` table whose rules cover every icon; keeping it pulls the
entire glyph set back in through layout closure (45 icons -> 745 KB). Reading
the codepoint instead lets the script drop GSUB/GPOS completely, which takes
the same subset to a few kilobytes and removes any dependence on ligature
support in the browser.

Usage
-----
    python scripts/build_icon_font.py            # extract, verify, subset
    python scripts/build_icon_font.py --check    # verify only, write nothing
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "vendor" / "material-symbols-outlined.ttf"
OUTPUT_FONT = ROOT / "public" / "fonts" / "material-symbols-outlined.ttf"
OUTPUT_MAP = ROOT / "lib" / "icon-codepoints.ts"
SCAN_DIRS = ("app", "components")

# A name reaches <Icon> three ways, and all three must be collected:
#   <Icon name="schedule"> / <Icon name={cond ? "a" : "b"}>   literal + ternary
#   <Icon name={slot.icon}>                                      a field/prop,
#     resolved through  icon: "..."  and  icon="..."  definitions
#   <Icon name={STATUS_ICONS[row]}>                              an *ICONS map
#     resolved through the whole const ...ICONS... = { ... } block
# The tag body is scanned for quoted tokens that sit in *value* position —
# after `name=`, or after `?` / `:` / `||` / `&&` of a ternary — so neither a
# className like "mt-1 shrink-0" nor a comparison like `phase === "connected"`
# can ever be mistaken for a glyph.
TAG_RE = __import__("re").compile(r"<Icon\b(.*?)>", __import__("re").DOTALL)
TAG_TOKEN_RE = __import__("re").compile(r'(?:\bname=\{?|[\?:]|\|\||&&)\s*"([a-z0-9_]+)"')
TOKEN_RE = __import__("re").compile(r'"([a-z0-9_]+)"')
FIELD_ICON_RE = __import__("re").compile(r'\bicon:\s*"([a-z0-9_]+)"')
ICON_ATTR_RE = __import__("re").compile(r'\bicon=\{?"([a-z0-9_]+)"?\}?')
ICON_CONST_RE = __import__("re").compile(
    r"(?:const|let|var)\s+\w*ICONS?\w*\s*(?::[^=]+)?=\s*[\[{](.*?)[\]}]",
    __import__("re").DOTALL,
)


def load_font():
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit(
            "fontTools is required: pip install fonttools\n"
            "(only needed when regenerating the icon subset)"
        )
    return TTFont(SOURCE)


def icons_in_source() -> dict[str, list[str]]:
    """Map every referenced icon name to the files that use it."""
    found: dict[str, list[str]] = {}
    for directory in SCAN_DIRS:
        for path in sorted((ROOT / directory).rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")

            names: set[str] = set()
            for body in TAG_RE.findall(text):
                names.update(TAG_TOKEN_RE.findall(body))
            names.update(FIELD_ICON_RE.findall(text))
            names.update(ICON_ATTR_RE.findall(text))
            for block in ICON_CONST_RE.findall(text):
                names.update(TOKEN_RE.findall(block))

            for name in sorted(names):
                found.setdefault(name, []).append(str(path.relative_to(ROOT)))
    return found


def main() -> int:
    if not SOURCE.exists():
        sys.exit(f"source face missing: {SOURCE}")

    font = load_font()
    cmap = font.getBestCmap()
    glyphs = set(font.getGlyphOrder())

    # glyph name -> first codepoint that renders it
    codepoint_of: dict[str, int] = {}
    for codepoint, glyph_name in cmap.items():
        codepoint_of.setdefault(glyph_name, codepoint)

    used = icons_in_source()
    wanted = sorted(used)
    if not wanted:
        print("No <Icon name=\"...\"> usages found; nothing to build.")
        return 1

    missing = [name for name in wanted if name not in glyphs or name not in codepoint_of]

    print(f"icons referenced: {len(wanted)}")
    if missing:
        print("\nUNKNOWN ICON NAMES - fix these before shipping:", file=sys.stderr)
        for name in missing:
            for where in used.get(name, ["(unknown)"]):
                print(f"  {name}  <- {where}", file=sys.stderr)
        return 1

    print("all names resolve to a glyph - OK")

    if "--check" in sys.argv:
        return 0

    selected = {name: codepoint_of[name] for name in wanted}

    OUTPUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    unicodes = ",".join(f"U+{codepoint:04X}" for codepoint in sorted(selected.values()))
    command = [
        sys.executable,
        "-m",
        "fontTools.subset",
        str(SOURCE),
        f"--unicodes={unicodes}",
        # No layout features: glyphs are addressed by codepoint, so the ligature
        # table is dead weight that would re-inflate the subset.
        "--layout-features=",
        "--drop-tables+=GSUB,GPOS,DSIG",
        "--glyph-names",
        f"--output-file={OUTPUT_FONT}",
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        return result.returncode

    lines = [
        "/*",
        " * GENERATED by scripts/build_icon_font.py - do not edit by hand.",
        " *",
        " * Material Symbols Outlined, addressed by codepoint. The source face",
        " * substitutes names through a required-ligature table covering every icon,",
        " * which drags the full 948 KB glyph set into any subset; the codepoint is",
        " * the stable handle instead, and the build drops GSUB entirely.",
        " */",
        "",
        "export const ICON_CODEPOINTS: Record<string, number> = {",
    ]
    for name in wanted:
        lines.append(f"  {name}: 0x{selected[name]:04x},")
    lines.append("};")
    lines.append("")
    OUTPUT_MAP.write_text("\n".join(lines), encoding="utf-8")

    size_kb = OUTPUT_FONT.stat().st_size / 1024
    print(f"wrote {OUTPUT_FONT.relative_to(ROOT)} - {size_kb:.1f} KB")
    print(f"wrote {OUTPUT_MAP.relative_to(ROOT)} - {len(wanted)} mappings")
    print(f"source was {SOURCE.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools[woff]>=4.50"]
# ///
"""
Build the self-hosted cuneiform web fonts from Oracc's OFL fonts.

    task fonts                      # or: uv run apps/web/fonts/build.py

Downloads the source TrueType fonts from the oracc/oracc2 repository (pinned to
ORACC_REF, cached in .cache/fonts/), then writes into apps/web/fonts/:

- oracc-noto-sans-cuneiform.woff2: Oracc Noto, which covers all of Unicode
  cuneiform plus most OSL Private Use Area signs. Code points it maps to an
  empty glyph are left out, so browsers fall back to the next font.
- oracc-<name>-extra.woff2: each further font cut down to the cuneiform code
  points it draws and no earlier font in FONTS does.

and two generated modules for the web app:

- apps/web/lib/cuneiform-fonts.ts: the next/font/local declarations, with exact
  unicode-range descriptors so a font is only downloaded for pages that use it.
- apps/web/lib/cuneiform-coverage.ts: which cuneiform code points the fonts
  actually draw, so the app can show a fallback for the rest instead of a blank.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ORACC_REF = "f0f92c251d03c6db3ca9e23bc732b5de6388799d"  # oracc/oracc2 main, 2026-11-03
BASE_URL = f"https://raw.githubusercontent.com/oracc/oracc2/{ORACC_REF}/msc/fonts/"

# (source file, output stem, name suffix, gaps only?)
# Order matters: a later font only contributes code points that earlier ones do not draw.
FONTS = [
    ("Oracc-Noto-SansCuneiform.ttf", "oracc-noto-sans-cuneiform", "noto", False),
    ("Oracc-RSP.ttf", "oracc-rsp-extra", "rsp", True),
    ("Oracc-EMC.ttf", "oracc-emc-extra", "emc", True),
    ("Oracc-gudea.ttf", "oracc-gudea-extra", "gudea", True),
    ("Oracc-LAK.ttf", "oracc-lak-extra", "lak", True),
]

# Cuneiform (U+12000–1254F), Archaic Cuneiform Numerals as OSL encodes them
# (U+12550–1268F), the OSL Private Use Area in plane 15, and the variation
# selectors Oracc uses for sign variants.
MAIN_RANGE = "U+12000-1268F, U+F0000-FFFFD, U+E0100-E01EF"

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parent
CACHE_DIR = ROOT / ".cache" / "fonts" / f"oracc2-{ORACC_REF[:10]}"
LIB_DIR = OUT_DIR.parent / "lib"


def is_cuneiform(cp: int) -> bool:
    return 0x12000 <= cp <= 0x1268F or 0xF0000 <= cp <= 0xFFFFD


def fetch(name: str) -> Path:
    dest = CACHE_DIR / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"fetch   {BASE_URL}{name}")
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(BASE_URL + name, timeout=120) as res, open(tmp, "wb") as fh:
        fh.write(res.read())
    tmp.rename(dest)
    return dest


def drawn_cuneiform(font: TTFont) -> set[int]:
    """Cuneiform code points whose glyph has an outline (some fonts map placeholders to empty glyphs)."""
    glyphs = font.getGlyphSet()
    out: set[int] = set()
    for cp, name in font.getBestCmap().items():
        if not is_cuneiform(cp):
            continue
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        if pen.bounds is not None:
            out.add(cp)
    return out


def spans(cps: set[int]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for cp in sorted(cps):
        if out and cp == out[-1][1] + 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def unicode_range(cps: set[int]) -> str:
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in spans(cps))


def save_subset(font: TTFont, unicodes: list[int], out: Path) -> None:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.drop_tables += ["DSIG"]  # the signature no longer matches once modified
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    subset.save_font(font, str(out), opts)


def build() -> tuple[list[dict], set[int]]:
    covered: set[int] = set()
    built: list[dict] = []
    for source, stem, suffix, gaps_only in FONTS:
        font = TTFont(fetch(source))
        drawn = drawn_cuneiform(font)
        out = OUT_DIR / f"{stem}.woff2"
        if gaps_only:
            cps = drawn - covered
            if not cps:
                print(f"skip    {source}: nothing beyond the earlier fonts")
                continue
            save_subset(font, sorted(cps), out)
            rng = unicode_range(cps)
        else:
            cps = drawn
            empty = {cp for cp in font.getBestCmap() if is_cuneiform(cp)} - drawn
            keep = [cp for cp in font.getBestCmap() if cp not in empty]
            save_subset(font, keep, out)
            rng = MAIN_RANGE
            if empty:
                print(f"note    {source}: left out {len(empty)} code points mapped to empty glyphs")
        covered |= cps
        size = out.stat().st_size / 1024
        print(f"wrote   {out.relative_to(ROOT)}  {size:,.0f} KB  {len(cps)} code point{'' if len(cps) == 1 else 's'}")
        built.append({"stem": stem, "suffix": suffix, "source": source, "range": rng, "count": len(cps)})
    return built, covered


HEADER = "// Generated by apps/web/fonts/build.py (`task fonts`). Do not edit by hand."


def write_fonts_ts(built: list[dict]) -> None:
    lines = [
        HEADER,
        "// Cuneiform web fonts from Oracc (SIL OFL 1.1, see apps/web/fonts/OFL.txt).",
        'import localFont from "next/font/local"',
        "",
    ]
    names = []
    for b in built:
        var = f"oracc{b['suffix'].capitalize()}"
        names.append(var)
        plural = "" if b["count"] == 1 else "s"
        lines += [
            f"/** {b['source']}: {b['count']} code point{plural} */",
            f"const {var} = localFont({{",
            f'  src: "../fonts/{b["stem"]}.woff2",',
            '  display: "swap",',
            "  preload: false,",
            "  adjustFontFallback: false,",
            f'  declarations: [{{ prop: "unicode-range", value: "{b["range"]}" }}],',
            "})",
            "",
        ]
    lines += [
        "/** Every cuneiform web font, in fallback order; set as --font-cuneiform-web on <html>. */",
        f"export const cuneiformFontFamily = [{', '.join(f'{n}.style.fontFamily' for n in names)}].join(\", \")",
        "",
    ]
    path = LIB_DIR / "cuneiform-fonts.ts"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote   {path.relative_to(ROOT)}")


def write_coverage_ts(covered: set[int]) -> None:
    rows = spans(covered)
    body = ",\n".join(
        "  " + ", ".join(f"[0x{a:x}, 0x{b:x}]" for a, b in rows[i : i + 6]) for i in range(0, len(rows), 6)
    )
    text = f"""{HEADER}
// Cuneiform code points the bundled fonts draw ({len(covered)} in {len(rows)} spans).

const SPANS: ReadonlyArray<readonly [number, number]> = [
{body},
]

/** True when one of the bundled cuneiform fonts has a real glyph for the code point. */
export function isDrawableCodePoint(cp: number): boolean {{
  let lo = 0
  let hi = SPANS.length - 1
  while (lo <= hi) {{
    const mid = (lo + hi) >> 1
    const [a, b] = SPANS[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }}
  return false
}}
"""
    path = LIB_DIR / "cuneiform-coverage.ts"
    path.write_text(text, encoding="utf-8")
    print(f"wrote   {path.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        fonts, covered = build()
        write_fonts_ts(fonts)
        write_coverage_ts(covered)
    except Exception as err:  # noqa: BLE001 - print a short reason for `task fonts`
        print(f"fonts: {err}", file=sys.stderr)
        raise SystemExit(1)

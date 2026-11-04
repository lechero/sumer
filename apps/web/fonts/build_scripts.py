# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools[woff]>=4.50"]
# ///
"""
Build the self-hosted web fonts for every non-cuneiform script the sign
browser and the dictionary show (the cuneiform fonts are built by build.py).

    task fonts                      # or: uv run apps/web/fonts/build_scripts.py

Sources, pinned and cached in .cache/fonts/:
- Noto fonts from google/fonts (SIL OFL 1.1) (Phoenician, Ugaritic, Linear B, Coptic …, and
  Noto Serif / Noto Serif Hebrew for polytonic Greek and pointed Hebrew),
- UniHieroglyphica (Michel Suignard, via the Thesaurus Linguae Aegyptiae) for
  all 5,066 Egyptian hieroglyphs (SIL OFL 1.1), split into chunks by code point,
- the PCSL font for proto-cuneiform (Oracc PC24 encoding), from the oracc/pcsl
  repository, which is CC0 1.0 (the font file itself carries no licence notice).

Writes apps/web/fonts/<stem>.woff2 (subset to the script's blocks, variable
fonts pinned to a normal width) and two generated modules:
- apps/web/lib/script-fonts.ts: next/font/local declarations with exact
  unicode-range descriptors and the CSS custom properties to set on <html>,
- apps/web/lib/script-coverage.ts: the code points the proto-cuneiform and
  hieroglyph fonts really draw, for the app's "no glyph yet" fallback.
"""

from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

GOOGLE_REF = "2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc"  # google/fonts main, 2026-11-04
TLA_REF = "main"
PCSL_REF = "e270b727b6b5150e0d449ccdc2ae567213d2a1c5"  # oracc/pcsl main, 2026-11-04 (repository licence CC0 1.0)
GOOGLE = f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_REF}/ofl/"
TLA = f"https://raw.githubusercontent.com/thesaurus-linguae-aegyptiae/unihieroglyphica/{TLA_REF}/font_files/"
PCSL = f"https://raw.githubusercontent.com/oracc/pcsl/{PCSL_REF}/fepc/"

R = tuple[int, int]

# key (CSS: --font-<key>-web), source URL, output stem, ranges kept, chunk size (None = one file), weights
FONTS: list[dict] = [
    {"key": "proto-cuneiform", "url": PCSL + "PCSL.ttf", "stem": "oracc-pcsl", "ranges": [(0x12000, 0x12BFF), (0xF0000, 0xFFFFD)], "coverage": True},
    # UniHieroglyphica reserves the font name "Hieroglyphica", so the modified (subset) files are renamed.
    {"key": "egyptian", "url": TLA + "UniHieroglyphica.ttf", "stem": "egyptian-hieroglyphs", "ranges": [(0x13000, 0x1345F), (0x13460, 0x143FF)], "chunk": 700, "coverage": True, "rename": "Sumer Egyptian Hieroglyphs"},
    {"key": "ugaritic", "url": GOOGLE + "notosansugaritic/NotoSansUgaritic-Regular.ttf", "stem": "noto-sans-ugaritic", "ranges": [(0x10380, 0x1039F)]},
    {"key": "phoenician", "url": GOOGLE + "notosansphoenician/NotoSansPhoenician-Regular.ttf", "stem": "noto-sans-phoenician", "ranges": [(0x10900, 0x1091F)]},
    {"key": "aramaic", "url": GOOGLE + "notosansimperialaramaic/NotoSansImperialAramaic-Regular.ttf", "stem": "noto-sans-imperial-aramaic", "ranges": [(0x10840, 0x1085F)]},
    {"key": "syriac", "url": GOOGLE + "notosanssyriac/NotoSansSyriac%5Bwght%5D.ttf", "stem": "noto-sans-syriac", "ranges": [(0x0700, 0x074F), (0x0860, 0x086F), (0x064B, 0x0655), (0x0670, 0x0670)], "weights": (400, 700)},
    {"key": "south-arabian", "url": GOOGLE + "notosansoldsoutharabian/NotoSansOldSouthArabian-Regular.ttf", "stem": "noto-sans-old-south-arabian", "ranges": [(0x10A60, 0x10A7F)]},
    {"key": "old-persian", "url": GOOGLE + "notosansoldpersian/NotoSansOldPersian-Regular.ttf", "stem": "noto-sans-old-persian", "ranges": [(0x103A0, 0x103DF)]},
    {"key": "anatolian", "url": GOOGLE + "notosansanatolianhieroglyphs/NotoSansAnatolianHieroglyphs-Regular.ttf", "stem": "noto-sans-anatolian-hieroglyphs", "ranges": [(0x14400, 0x1467F)]},
    {"key": "linear-a", "url": GOOGLE + "notosanslineara/NotoSansLinearA-Regular.ttf", "stem": "noto-sans-linear-a", "ranges": [(0x10600, 0x1077F)]},
    {"key": "linear-b", "url": GOOGLE + "notosanslinearb/NotoSansLinearB-Regular.ttf", "stem": "noto-sans-linear-b", "ranges": [(0x10000, 0x100FF), (0x10100, 0x1013F)]},
    {"key": "cypriot", "url": GOOGLE + "notosanscypriot/NotoSansCypriot-Regular.ttf", "stem": "noto-sans-cypriot", "ranges": [(0x10800, 0x1083F)]},
    {"key": "old-italic", "url": GOOGLE + "notosansolditalic/NotoSansOldItalic-Regular.ttf", "stem": "noto-sans-old-italic", "ranges": [(0x10300, 0x1032F)]},
    {"key": "coptic", "url": GOOGLE + "notosanscoptic/NotoSansCoptic-Regular.ttf", "stem": "noto-sans-coptic", "ranges": [(0x2C80, 0x2CFF), (0x03E2, 0x03EF), (0x0300, 0x036F), (0xFE20, 0xFE2F)]},
    {"key": "gothic", "url": GOOGLE + "notosansgothic/NotoSansGothic-Regular.ttf", "stem": "noto-sans-gothic", "ranges": [(0x10330, 0x1034F)]},
    {"key": "runic", "url": GOOGLE + "notosansrunic/NotoSansRunic-Regular.ttf", "stem": "noto-sans-runic", "ranges": [(0x16A0, 0x16FF)]},
    {"key": "ogham", "url": GOOGLE + "notosansogham/NotoSansOgham-Regular.ttf", "stem": "noto-sans-ogham", "ranges": [(0x1680, 0x169F)]},
    {"key": "hebrew", "url": GOOGLE + "notoserifhebrew/NotoSerifHebrew%5Bwdth,wght%5D.ttf", "stem": "noto-serif-hebrew", "ranges": [(0x0590, 0x05FF), (0xFB1D, 0xFB4F)], "weights": (400, 700)},
    {"key": "greek", "url": GOOGLE + "notoserif/NotoSerif%5Bwdth,wght%5D.ttf", "stem": "noto-serif-greek", "ranges": [(0x0370, 0x03FF), (0x1F00, 0x1FFF), (0x0300, 0x036F)], "weights": (400, 700)},
]

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parent
CACHE_DIR = ROOT / ".cache" / "fonts" / "scripts"
LIB_DIR = OUT_DIR.parent / "lib"
HEADER = "// Generated by apps/web/fonts/build_scripts.py (`task fonts`). Do not edit by hand."


def fetch(url: str) -> Path:
    name = url.rsplit("/", 1)[1].replace("%5B", "[").replace("%5D", "]")
    dest = CACHE_DIR / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"fetch   {url}")
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=300) as res, open(tmp, "wb") as fh:
        fh.write(res.read())
    tmp.rename(dest)
    return dest


def in_ranges(cp: int, ranges: list[R]) -> bool:
    return any(a <= cp <= b for a, b in ranges)


def drawn(font: TTFont, cps: list[int]) -> list[int]:
    """Code points whose glyph has an outline (marks and spaces have none, but are kept for shaping)."""
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    out = []
    for cp in cps:
        pen = BoundsPen(glyphs)
        glyphs[cmap[cp]].draw(pen)
        if pen.bounds is not None:
            out.append(cp)
    return out


def spans(cps: list[int]) -> list[R]:
    out: list[R] = []
    for cp in sorted(cps):
        if out and cp == out[-1][1] + 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def unicode_range(cps: list[int]) -> str:
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in spans(cps))


def rename(font: TTFont, family: str) -> None:
    """Give a modified font a new family name (OFL: modified versions may not use a Reserved Font Name)."""
    postscript = family.replace(" ", "")
    values = {1: family, 3: f"{postscript}-Regular", 4: family, 6: f"{postscript}-Regular", 16: family, 17: "Regular", 21: family, 22: "Regular"}
    for rec in font["name"].names:
        if rec.nameID in values:
            rec.string = values[rec.nameID] if rec.nameID != 17 else rec.toUnicode()
    if "CFF " in font:
        font["CFF "].cff.fontNames = [f"{postscript}-Regular"]


def save_subset(path: Path, unicodes: list[int], out: Path, weights: tuple[int, int] | None, family: str | None = None) -> None:
    font = TTFont(path)
    if "fvar" in font:
        axes = {a.axisTag: a for a in font["fvar"].axes}
        limits: dict = {}
        if "wdth" in axes:
            limits["wdth"] = 100
        if "wght" in axes and weights:
            limits["wght"] = (max(weights[0], axes["wght"].minValue), min(weights[1], axes["wght"].maxValue))
        if limits:
            font = instancer.instantiateVariableFont(font, limits)
            # round-trip so the subsetter sees fully loaded tables (gvar is lazily loaded otherwise)
            buf = io.BytesIO()
            font.save(buf)
            buf.seek(0)
            font = TTFont(buf)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.drop_tables += ["DSIG"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    if family:
        rename(font, family)
    subset.save_font(font, str(out), opts)


def build() -> tuple[list[dict], dict[str, list[int]]]:
    built: list[dict] = []
    coverage: dict[str, list[int]] = {}
    for spec in FONTS:
        path = fetch(spec["url"])
        font = TTFont(path)
        copyright_ = font["name"].getDebugName(0) or ""
        cps = sorted(cp for cp in font.getBestCmap() if in_ranges(cp, spec["ranges"]))
        real = drawn(font, cps)
        if spec.get("coverage"):
            coverage[spec["key"]] = real
        chunk = spec.get("chunk")
        groups = [cps[i : i + chunk] for i in range(0, len(cps), chunk)] if chunk else [cps]
        for n, group in enumerate(groups, 1):
            stem = f"{spec['stem']}-{n}" if len(groups) > 1 else spec["stem"]
            out = OUT_DIR / f"{stem}.woff2"
            save_subset(path, group, out, spec.get("weights"), spec.get("rename"))
            size = out.stat().st_size / 1024
            print(f"wrote   {out.relative_to(ROOT)}  {size:,.0f} KB  {len(group)} code points")
            built.append({**spec, "stem": stem, "range": unicode_range(group), "count": len(group), "copyright": copyright_})
    return built, coverage


def camel(s: str) -> str:
    head, *rest = s.replace("-", " ").split()
    return head + "".join(w.capitalize() for w in rest)


def write_fonts_ts(built: list[dict]) -> None:
    lines = [
        HEADER,
        "// Web fonts for the scripts other than cuneiform (SIL OFL 1.1, PCSL: CC0; see apps/web/fonts/OFL.txt).",
        'import localFont from "next/font/local"',
        "",
    ]
    by_key: dict[str, list[str]] = {}
    for b in built:
        var = camel(b["stem"])
        by_key.setdefault(b["key"], []).append(var)
        weight = f'  weight: "{b["weights"][0]} {b["weights"][1]}",\n' if b.get("weights") else ""
        lines += [
            f"/** {b['url'].rsplit('/', 1)[1]}: {b['count']} code points */",
            f"const {var} = localFont({{",
            f'  src: "../fonts/{b["stem"]}.woff2",',
            *([weight.rstrip("\n")] if weight else []),
            '  display: "swap",',
            "  preload: false,",
            "  adjustFontFallback: false,",
            f'  declarations: [{{ prop: "unicode-range", value: "{b["range"]}" }}],',
            "})",
            "",
        ]
    lines += [
        "/** `--font-<script>-web` custom properties for <html>; the font-<script> utilities in globals.css read them. */",
        "export const scriptFontVariables: Record<string, string> = {",
        *[f'  "--font-{k}-web": [{", ".join(f"{v}.style.fontFamily" for v in vs)}].join(", "),' for k, vs in by_key.items()],
        "}",
        "",
    ]
    path = LIB_DIR / "script-fonts.ts"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote   {path.relative_to(ROOT)}")


def write_coverage_ts(coverage: dict[str, list[int]]) -> None:
    blocks = []
    for key, cps in coverage.items():
        rows = spans(cps)
        body = ",\n".join("    " + ", ".join(f"[0x{a:x}, 0x{b:x}]" for a, b in rows[i : i + 6]) for i in range(0, len(rows), 6))
        blocks.append(f'  // {len(cps)} code points in {len(rows)} spans\n  "{key}": [\n{body},\n  ],')
    text = f"""{HEADER}
// Code points the bundled proto-cuneiform and hieroglyph fonts really draw.

const SPANS: Record<string, ReadonlyArray<readonly [number, number]>> = {{
{chr(10).join(blocks)}
}}

/** True when the script's bundled font has a real glyph for the code point (scripts without a table: always). */
export function scriptDraws(script: string, cp: number): boolean {{
  const spans = SPANS[script]
  if (!spans) return true
  let lo = 0
  let hi = spans.length - 1
  while (lo <= hi) {{
    const mid = (lo + hi) >> 1
    const [a, b] = spans[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }}
  return false
}}
"""
    path = LIB_DIR / "script-coverage.ts"
    path.write_text(text, encoding="utf-8")
    print(f"wrote   {path.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        fonts, coverage = build()
        write_fonts_ts(fonts)
        write_coverage_ts(coverage)
        print("\ncopyright notices (for OFL.txt):")
        for c in sorted({b["copyright"] for b in fonts}):
            print(f"  {c}")
    except Exception as err:  # noqa: BLE001 - print a short reason for `task fonts`
        import traceback

        traceback.print_exc()
        print(f"fonts: {err}", file=sys.stderr)
        raise SystemExit(1)

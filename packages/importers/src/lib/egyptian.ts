/**
 * Egyptian hieroglyphs: Manuel de Codage (MdC) → Unicode (U+13000–U+143FF).
 *
 * Wiktionary writes hieroglyphs as `<hiero>` MdC, e.g. `nfr-f:r-Z1` or
 * `g:p-mw`: Gardiner codes (A1, G17, Aa1 …) mixed with phonetic aliases
 * (`n`, `nfr`, `mw` …). Two tables, both downloaded and cached:
 *   - Unicode's Unikemet.txt: kEH_JSesh gives the JSesh/Gardiner code of every
 *     encoded sign (A1 → U+13000).
 *     https://www.unicode.org/Public/UCD/latest/ucd/Unikemet.txt
 *   - MediaWiki WikiHiero's phoneme table (the very table Wiktionary renders
 *     `<hiero>` with): MdC phonetic alias → Gardiner code (nfr → F35).
 *     https://github.com/wikimedia/mediawiki-extensions-wikihiero (GPL-2.0+,
 *     read at import time, not redistributed).
 * Groups are linearised: layout operators (- : * & spaces, parentheses,
 * cartouche brackets) are ignored and unknown codes are dropped, never guessed.
 */
import { download, readCached, type DownloadOptions } from "./cache"

export const UNIKEMET_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unikemet.txt"
export const WIKIHIERO_TABLES_URL =
  "https://raw.githubusercontent.com/wikimedia/mediawiki-extensions-wikihiero/master/data/tables.php"

export type HieroglyphTables = {
  /** JSesh / Gardiner code → glyph (A1 → 𓀀). */
  byCode: Map<string, string>
  /** Lower-cased code → glyph, for MdC's loose capitalisation (Y1V ~ Y1v). */
  byCodeLower: Map<string, string>
  /** MdC phonetic alias → Gardiner code (nfr → F35, mw → N35A). */
  phonemes: Map<string, string>
}

/** kEH_JSesh lines of Unikemet.txt: `U+13000<TAB>kEH_JSesh<TAB>A1`. */
export function parseUnikemet(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split("\n")) {
    if (!line.startsWith("U+")) continue
    const [cp, tag, value] = line.split("\t")
    if (tag !== "kEH_JSesh" || !cp || !value) continue
    const glyph = String.fromCodePoint(parseInt(cp.slice(2), 16))
    for (const code of value.trim().split(/\s+/)) if (code && !out.has(code)) out.set(code, glyph)
  }
  return out
}

/** `$wh_phonemes = [ "nfr" => "F35", … ]` from WikiHiero's tables.php (commented-out blocks skipped). */
export function parseWikiHieroPhonemes(php: string): Map<string, string> {
  const out = new Map<string, string>()
  const start = php.indexOf("$wh_phonemes")
  if (start < 0) return out
  const end = php.indexOf("];", start)
  const body = php.slice(start, end < 0 ? undefined : end).replace(/\/\*[\s\S]*?\*\//g, "")
  for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"\s*=>\s*"((?:[^"\\]|\\.)*)"/g)) {
    const [, alias, code] = m
    if (alias && code && !out.has(alias)) out.set(alias, code)
  }
  return out
}

export function buildHieroglyphTables(unikemet: string, wikihiero: string): HieroglyphTables {
  const byCode = parseUnikemet(unikemet)
  const byCodeLower = new Map<string, string>()
  for (const [code, glyph] of byCode) if (!byCodeLower.has(code.toLowerCase())) byCodeLower.set(code.toLowerCase(), glyph)
  return { byCode, byCodeLower, phonemes: parseWikiHieroPhonemes(wikihiero) }
}

/** Download (or read from the cache) both tables. */
export async function loadHieroglyphTables(opts: DownloadOptions = {}): Promise<HieroglyphTables> {
  const [unikemet, wikihiero] = await Promise.all([
    download("unicode", "Unikemet.txt", UNIKEMET_URL, opts),
    download("wikihiero", "tables.php", WIKIHIERO_TABLES_URL, opts),
  ])
  return buildHieroglyphTables(await readCached(unikemet), await readCached(wikihiero))
}

/** One Gardiner code or phonetic alias → glyph, or undefined. */
export function signToUnicode(token: string, t: HieroglyphTables): string | undefined {
  const code = t.phonemes.get(token) ?? token
  return (
    t.byCode.get(code) ??
    t.byCodeLower.get(code.toLowerCase()) ??
    // size / variant suffixes that Unicode does not distinguish: Z2ss, Z1s
    (/^[A-Z][a-z]?\d+[A-Z]?[a-z]+$/.test(code) ? t.byCode.get(code.replace(/[a-z]+$/, "")) : undefined)
  )
}

export type MdcResult = { text: string; signs: number; unknown: string[] }

/**
 * Convert an MdC string (with or without `<hiero>` tags) to a linear string of
 * Unicode hieroglyphs. Unknown codes are reported in `unknown` and left out.
 */
export function mdcToUnicode(mdc: string, t: HieroglyphTables): MdcResult {
  const src = mdc
    .replace(/<\/?hiero>/gi, " ")
    .replace(/\{\{[^}]*\}\}/g, " ") // JSesh absolute placement
    .replace(/#\w*/g, "") // shading
  let text = ""
  let signs = 0
  const unknown: string[] = []
  for (const raw of src.split(/[-:*&\s()!]+|\.{1,2}/)) {
    // cartouche / serekh / editorial brackets on their own: < > <1 2> <h1 h1> [[ ]] [& &] …
    if (/^(?:<[0-9h]*|[0-9h]*>|<h\d|h\d>|\[[&{["']|[&}\]"']\])$/.test(raw)) continue
    // mirror (S45\, D54\R90), stray brackets glued to a sign, ^ markers
    const token = raw.replace(/\\\w*$/, "").replace(/^[<[]+|[>\]]+$/g, "").replace(/\^/g, "")
    if (!token || /^(?:H_SPACE|BLACKDOT|\/\/)$/.test(token)) continue
    const glyph = signToUnicode(token, t)
    if (glyph) {
      text += glyph
      signs++
    } else unknown.push(token)
  }
  return { text, signs, unknown }
}

/** First `<hiero>…</hiero>` block of a string, if any. */
export function extractHiero(s: string | undefined): string | undefined {
  return s?.match(/<hiero>([\s\S]*?)<\/hiero>/i)?.[1]?.trim() || undefined
}

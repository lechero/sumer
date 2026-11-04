/**
 * Oracc-style cuneiform transliteration, split into the signs it spells:
 *   "{d}en-me-dur-an-ki" → {d} · en · me · dur · an · ki
 *   "lu₂{geš}tukul"      → lu₂ · {geš} · tukul
 *   "3(diš)"             → diš ×3
 * Shared by the importers (rendering Unicode cuneiform) and the app (per-glyph breakdowns).
 */

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" }

/** Normalise one reading token: ascii index digits → subscripts, ĝ/ŋ unify, strip accents used for indices (á=2, à=3). */
export function normalizeReading(token: string): string {
  let t = token.trim().normalize("NFC")
  // accent-index convention: á → a₂, à → a₃ (for the vowel carrying the accent)
  t = t.toLowerCase()
  const ACUTE: Record<string, string> = { "á": "a", "é": "e", "í": "i", "ú": "u" }
  const GRAVE: Record<string, string> = { "à": "a", "è": "e", "ì": "i", "ù": "u" }
  for (const [k, v] of Object.entries(ACUTE)) if (t.includes(k)) t = t.replace(k, v) + "₂"
  for (const [k, v] of Object.entries(GRAVE)) if (t.includes(k)) t = t.replace(k, v) + "₃"
  t = t.replace(/ĝ|g̃/g, "ŋ").replace(/Ĝ/g, "Ŋ")
  t = t.replace(/(\D)(\d+)$/u, (_, a: string, d: string) => a + [...d].map((c) => SUB[c] ?? c).join(""))
  t = t.replace(/x$/u, "ₓ")
  return t.toLowerCase()
}

/** Determinative shorthands that are not sign readings themselves. */
export const DETERMINATIVES: Record<string, string> = {
  "d": "diŋir",
  "m": "diš",
  "f": "munus",
  "1": "diš",
  "giš": "ŋeš",
  "ŋeš": "ŋeš",
  "mušen": "mušen",
  "ki": "ki",
  "uru": "uru",
  "kur": "kur",
  "lu₂": "lu₂",
  "munus": "munus",
  "id₂": "id₂",
  "na₄": "na₄",
  "tug₂": "tug₂",
  "dug": "dug",
  "u₂": "u₂",
  "gi": "gi",
  "urudu": "urudu",
  "kuš": "kuš",
  "e₂": "e₂",
  "iti": "iti",
  "mul": "mul",
  "šim": "šim",
  "ŋiš": "ŋeš",
}

export type SpellingToken = {
  /** The token as written, without braces: "d", "en", "3(diš)", "LUGAL". */
  text: string
  kind: "determinative" | "sign" | "numeral"
  /** The normalised reading, as written in sign lists and dictionaries ("en", "dur₂", "diš"). */
  reading: string
  /** Sign readings to look the glyph up by, in order of preference. */
  keys: string[]
  /** How many times the sign repeats (numerals: 3(diš) = 3). */
  count: number
}

const NUMERAL = /^(\d+)\(([^)]+)\)$/u
const TOKEN_RE = /\{([^}]+)\}|([^\s\-.{}:+]+)|([\s\-.:+])/gu

function uniqKeys(keys: (string | undefined)[]): string[] {
  return [...new Set(keys.filter((k): k is string => !!k))]
}

/** Split a transliteration into its sign tokens (separators dropped). */
export function tokenizeSpelling(translit: string): SpellingToken[] {
  const tokens: SpellingToken[] = []
  for (const m of translit.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) {
      const key = normalizeReading(m[1])
      tokens.push({ text: m[1], kind: "determinative", reading: key, keys: uniqKeys([DETERMINATIVES[key] ?? key, key]), count: 1 })
    } else if (m[2] !== undefined) {
      // logograms in capitals (LUGAL, |SAL.LAGAR|) are looked up by their lower-cased reading
      const raw = /^[A-ZŠŊḪṢṬ]/u.test(m[2]) || m[2].includes("|") ? m[2].toLowerCase() : m[2]
      const num = raw.trim().match(NUMERAL)
      if (num) {
        const key = normalizeReading(num[2]!)
        tokens.push({ text: m[2], kind: "numeral", reading: key, keys: [key], count: Number(num[1]) })
        continue
      }
      const key = normalizeReading(raw)
      tokens.push({ text: m[2], kind: "sign", reading: key, keys: uniqKeys([key, DETERMINATIVES[key]]), count: 1 })
    }
  }
  return tokens
}

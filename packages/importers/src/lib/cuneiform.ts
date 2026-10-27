/**
 * Render Oracc-style transliteration as Unicode cuneiform using sign readings:
 *   "lugal"          → 𒈗
 *   "e₂-gal"         → 𒂍𒃲
 *   "{d}en-lil₂"     → 𒀭𒂗𒆤
 *   "lu₂{geš}tukul"  → 𒇽𒄑𒆪
 * Returns null when any piece has no known sign.
 */
import { and, eq, isNull, or } from "drizzle-orm"
import { signReadings, signs, type Database } from "@workspace/db"

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
const DETERMINATIVES: Record<string, string> = {
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

export type ReadingMap = Map<string, string>

/** Build reading → glyph from the signs tables (Sumerian / unmarked readings only, non-deprecated). */
export async function loadReadingMap(db: Database): Promise<ReadingMap> {
  const rows = await db
    .select({ value: signReadings.value, unicode: signs.unicode, isForm: signs.isForm })
    .from(signReadings)
    .innerJoin(signs, eq(signReadings.signId, signs.id))
    .where(and(eq(signReadings.isDeprecated, false), or(isNull(signReadings.language), eq(signReadings.language, "sux"))))
  const map: ReadingMap = new Map()
  // base signs first so a form never shadows its parent
  for (const r of [...rows].sort((a, b) => Number(a.isForm) - Number(b.isForm))) {
    if (!r.unicode) continue
    const v = normalizeReading(r.value.replace(/\?$/, ""))
    if (!map.has(v)) map.set(v, r.unicode)
  }
  return map
}

const NUMERAL = /^(\d+)\(([^)]+)\)$/u

function renderToken(token: string, map: ReadingMap): string | null {
  const t = token.trim()
  if (!t) return ""
  const m = t.match(NUMERAL)
  if (m) {
    const n = Number(m[1])
    const glyph = map.get(normalizeReading(m[2]!))
    if (!glyph || n < 1 || n > 9) return null
    return glyph.repeat(n)
  }
  const key = normalizeReading(t)
  return map.get(key) ?? map.get(DETERMINATIVES[key] ?? "") ?? null
}

export function renderCuneiform(translit: string, map: ReadingMap): string | null {
  let out = ""
  // split into determinatives {…}, separators, and sign tokens
  const re = /\{([^}]+)\}|([^\s\-.{}:+]+)|([\s\-.:+])/gu
  let m: RegExpExecArray | null
  let any = false
  while ((m = re.exec(translit)) !== null) {
    if (m[1] !== undefined) {
      const det = m[1]
      const key = normalizeReading(det)
      const glyph = map.get(DETERMINATIVES[key] ?? key) ?? map.get(key)
      if (!glyph) return null
      out += glyph
      any = true
    } else if (m[2] !== undefined) {
      const tok = m[2]
      if (/^[A-ZŠŊḪṢṬ]/u.test(tok) || tok.includes("|")) {
        // logogram written in capitals: try the lower-cased reading
        const g = renderToken(tok.toLowerCase(), map)
        if (g === null) return null
        out += g
      } else {
        const g = renderToken(tok, map)
        if (g === null) return null
        out += g
      }
      any = true
    }
  }
  return any ? out : null
}

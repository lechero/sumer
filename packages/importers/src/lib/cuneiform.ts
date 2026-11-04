/**
 * Render Oracc-style transliteration as Unicode cuneiform using sign readings:
 *   "lugal"          → 𒈗
 *   "e₂-gal"         → 𒂍𒃲
 *   "{d}en-lil₂"     → 𒀭𒂗𒆤
 *   "lu₂{geš}tukul"  → 𒇽𒄑𒆪
 * Returns null when any piece has no known sign.
 */
import { and, eq, isNull, or } from "drizzle-orm"
import { isFullyEncoded, normalizeReading, signReadings, signs, tokenizeSpelling, type Database } from "@workspace/db"

export { normalizeReading }

export type ReadingMap = Map<string, string>

/** Build reading → glyph from the signs tables (Sumerian / unmarked readings only, non-deprecated). */
export async function loadReadingMap(db: Database): Promise<ReadingMap> {
  const rows = await db
    .select({ value: signReadings.value, unicode: signs.unicode, isForm: signs.isForm })
    .from(signReadings)
    .innerJoin(signs, eq(signReadings.signId, signs.id))
    .where(
      and(
        eq(signs.scriptId, "cuneiform"),
        eq(signReadings.isDeprecated, false),
        or(isNull(signReadings.language), eq(signReadings.language, "sux"))
      )
    )
  const map: ReadingMap = new Map()
  // base signs first so a form never shadows its parent
  for (const r of [...rows].sort((a, b) => Number(a.isForm) - Number(b.isForm))) {
    if (!r.unicode || !isFullyEncoded(r.unicode)) continue // OSL placeholders (X, O) must not end up in words
    const v = normalizeReading(r.value.replace(/\?$/, ""))
    if (!map.has(v)) map.set(v, r.unicode)
  }
  return map
}

export function renderCuneiform(translit: string, map: ReadingMap): string | null {
  const tokens = tokenizeSpelling(translit)
  if (!tokens.length) return null
  let out = ""
  for (const t of tokens) {
    const glyph = t.keys.map((k) => map.get(k)).find(Boolean)
    if (!glyph) return null
    if (t.kind === "numeral" && (t.count < 1 || t.count > 9)) return null
    out += glyph.repeat(t.count)
  }
  return out
}

/**
 * Sign-by-sign breakdowns of Egyptian hieroglyphic spellings: each sign with its Gardiner
 * code, what it depicts, its sound values and the part it most likely plays in this word,
 * matched against the word's transliteration:
 *   nfr 𓄤𓆑𓂋 → 𓄤 F35 "heart and windpipe" nfr, 3-consonant sign · 𓆑 f complement · 𓂋 r complement
 *   jmn 𓇋𓏠𓈖𓀅 → 𓇋 j sound sign · 𓏠 mn 2-consonant sign · 𓈖 n complement · 𓀅 classifier
 * The roles are a reading aid computed from the spelling, not an editor's analysis.
 */
import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "./client"
import { isHieroglyphCodePoint } from "./glyphs"
import { signReadings, signs } from "./schema"

export type HieroglyphRole = "sound" | "word" | "complement" | "classifier" | "stroke" | "plural" | "ending" | "unread"

export type HieroglyphPart = {
  glyph: string
  sign: { id: string; name: string; category: string | null; description: string | null; readings: string[] } | null
  role: HieroglyphRole
  /** The consonants the sign writes in this word, when it writes any. */
  value: string | null
  /** "3-consonant sign", "complement of nfr", "classifier (unpronounced)". */
  note: string
}

export type HieroglyphBreakdown = {
  parts: HieroglyphPart[]
  /** The consonants the breakdown accounts for, against the word's own. */
  spelled: string
  target: string
}

/** Egyptological transliteration reduced to its consonants for matching: Jmn.t → jmnt, nꞽw.t → njwt, zꜣ → sꜣ. */
export function egyptianSkeleton(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/ꞽ|ı͗|i̯|ỉ|ï/g, "j")
    .replace(/z/g, "s")
    .replace(/[^a-zꜣꜥḥḫẖšḳḏṯṱčṭ]/gu, "")
}

const COUNT_WORD = ["", "1-consonant", "2-consonant", "3-consonant", "4-consonant"]

async function loadSigns(db: Database, glyphs: string[]) {
  const out = new Map<string, NonNullable<HieroglyphPart["sign"]> & { isForm: boolean }>()
  if (!glyphs.length) return out
  const rows = await db
    .select({
      id: signs.id,
      name: signs.name,
      unicode: signs.unicode,
      category: signs.category,
      description: signs.description,
      isForm: signs.isForm,
      reading: signReadings.value,
      order: signReadings.sortOrder,
    })
    .from(signs)
    .leftJoin(signReadings, and(eq(signReadings.signId, signs.id), eq(signReadings.isDeprecated, false)))
    .where(and(eq(signs.scriptId, "egyptian-hieroglyphs"), inArray(signs.unicode, glyphs)))
  for (const r of rows.sort((a, b) => Number(a.isForm) - Number(b.isForm) || (a.order ?? 0) - (b.order ?? 0))) {
    if (!r.unicode) continue
    const have = out.get(r.unicode)
    if (have && have.id !== r.id) continue
    const sign = have ?? { id: r.id, name: r.name, category: r.category, description: r.description, readings: [], isForm: r.isForm }
    if (r.reading && !sign.readings.includes(r.reading)) sign.readings.push(r.reading)
    out.set(r.unicode, sign)
  }
  return out
}

/** Break a hieroglyphic spelling down against the word's transliteration. */
export async function getHieroglyphBreakdown(
  db: Database,
  entry: { nativeScript: string | null; transliteration: string | null; headword: string }
): Promise<HieroglyphBreakdown | undefined> {
  const glyphs = [...(entry.nativeScript ?? "")].filter((ch) => isHieroglyphCodePoint(ch.codePointAt(0) ?? 0))
  if (!glyphs.length) return undefined
  const byGlyph = await loadSigns(db, [...new Set(glyphs)])
  const translit = entry.transliteration ?? entry.headword
  const target = egyptianSkeleton(translit)
  // feminine -t and plural -w endings, written after a dot: km.t, nṯr.w
  const ending = translit.match(/\.(t|w)\b[^.]*$/i)?.[1]?.toLowerCase()

  let cursor = 0
  let zone = "" // the sounds of the last multi-consonant sign, which complements repeat
  let zonePos = 0
  const parts: HieroglyphPart[] = []
  for (const glyph of glyphs) {
    const found = byGlyph.get(glyph)
    const sign = found ? { id: found.id, name: found.name, category: found.category, description: found.description, readings: found.readings } : null
    const readings = (sign?.readings ?? []).map((r) => ({ raw: r, key: egyptianSkeleton(r) })).filter((r) => r.key)
    readings.sort((a, b) => b.key.length - a.key.length)
    const name = sign?.name ?? ""

    if (name === "Z1") {
      parts.push({ glyph, sign, role: "stroke", value: null, note: "stroke: the sign before stands for the thing it shows" })
      const prev = parts[parts.length - 2]
      if (prev && (prev.role === "sound" || prev.role === "unread")) {
        prev.role = "word"
        prev.note = "word sign (logogram), marked by the stroke"
      }
      continue
    }
    if (name === "Z2" || name === "Z3" || /^Z2[A-Z]?$/.test(name)) {
      parts.push({ glyph, sign, role: "plural", value: null, note: "plural strokes" })
      continue
    }
    // 𓊹𓊹𓊹 nṯr.w: a sign written twice is a dual, three times a plural
    const prev = parts[parts.length - 1]
    if (prev && prev.glyph === glyph && (prev.role === "sound" || prev.role === "word" || prev.role === "plural")) {
      const times = parts.filter((p) => p.glyph === glyph).length + 1
      parts.push({ glyph, sign, role: "plural", value: null, note: times >= 3 ? "repeated: a plural" : "repeated: a dual or plural" })
      if (ending) cursor = Math.min(target.length, cursor + 1)
      continue
    }
    const sound = readings.find((r) => target.startsWith(r.key, cursor))
    if (sound) {
      const n = [...sound.key].length
      const isEnding = ending && n === 1 && sound.key === ending && cursor === target.length - 1
      const wholeWord = cursor === 0 && sound.key === target
      parts.push({
        glyph,
        sign,
        role: isEnding ? "ending" : wholeWord && glyphs.length === 1 ? "word" : "sound",
        value: sound.raw,
        note: isEnding
          ? ending === "t"
            ? "feminine ending -t"
            : "plural ending -w"
          : wholeWord && glyphs.length === 1
            ? "word sign (logogram)"
            : `${COUNT_WORD[n] ?? `${n}-consonant`} sign`,
      })
      cursor += sound.key.length
      if (n > 1) {
        zone = sound.key
        zonePos = 0
      }
      continue
    }
    const complement = zone ? readings.find((r) => zone.indexOf(r.key, zonePos) >= 0) : undefined
    if (complement) {
      zonePos = zone.indexOf(complement.key, zonePos) + complement.key.length
      parts.push({ glyph, sign, role: "complement", value: complement.raw, note: `phonetic complement of ${zone}` })
      continue
    }
    if (cursor >= target.length || !readings.length) {
      parts.push({ glyph, sign, role: "classifier", value: null, note: "classifier (determinative), not pronounced" })
      continue
    }
    parts.push({ glyph, sign, role: "unread", value: null, note: readings.length ? `usually ${readings.map((r) => r.raw).join(", ")}` : "no sound value" })
  }

  const spelled = parts
    .filter((p) => p.role === "sound" || p.role === "word" || p.role === "ending")
    .map((p) => egyptianSkeleton(p.value ?? ""))
    .join("")
  return { parts, spelled, target }
}

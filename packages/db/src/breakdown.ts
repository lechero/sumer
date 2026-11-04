/**
 * Per-glyph breakdowns of cuneiform words: each sign of the spelling with its
 * reading, its sign-list name and, for Sumerian, what that reading means as a word.
 *   {d}en-me-dur-an-ki → 𒀭 {d} AN "divine name determinative" · 𒂗 en EN "lord" · …
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"

import type { Database } from "./client"
import { isFullyEncoded } from "./glyphs"
import { entries, signReadings, signs, type PartKind, type PartOfSpeech } from "./schema"
import { tokenizeSpelling, type SpellingToken } from "./transliteration"

/** A dictionary entry a reading stands for. */
export type GlyphMeaning = {
  id: string
  headword: string
  gloss: string
  kind: "word" | "part"
  partKind: PartKind | null
  partOfSpeech: PartOfSpeech | null
}

export type SpellingPart = {
  /** The sign's glyph(s), repeated for numerals. */
  glyph: string
  /** The token as written ("d", "en", "3(diš)"). */
  text: string
  /** Normalised reading ("en", "dur₂"). */
  reading: string
  kind: SpellingToken["kind"]
  count: number
  sign: { id: string; name: string }
  /** What the reading means as a Sumerian word or word part, most likely first (Sumerian entries only). */
  meanings: GlyphMeaning[]
}

/** Something to break down: an entry's spelling, rendered glyphs and language. */
export type BreakdownInput = { id: string; languageId: string; headword: string; transliteration: string | null; nativeScript: string | null }

const MAX_MEANINGS = 3

/** The spelling an entry's cuneiform was rendered from: Sumerian keeps it in the headword when the two agree. */
function spellingOf(e: BreakdownInput): string | null {
  if (e.transliteration) return e.transliteration
  return e.languageId === "sux" ? e.headword : null
}

/** Readings → their sign (base signs before variant forms; only signs with a real glyph). */
async function signsForReadings(db: Database, keys: string[]) {
  const out = new Map<string, { id: string; name: string; unicode: string }>()
  if (!keys.length) return out
  const values = [...new Set(keys.flatMap((k) => [k, `${k}?`]))]
  const rows = await db
    .select({ value: signReadings.value, id: signs.id, name: signs.name, unicode: signs.unicode, isForm: signs.isForm })
    .from(signReadings)
    .innerJoin(signs, eq(signReadings.signId, signs.id))
    .where(
      and(
        eq(signs.scriptId, "cuneiform"),
        eq(signReadings.isDeprecated, false),
        or(isNull(signReadings.language), eq(signReadings.language, "sux")),
        inArray(signReadings.value, values)
      )
    )
  for (const r of rows.sort((a, b) => Number(a.isForm) - Number(b.isForm))) {
    if (!r.unicode || !isFullyEncoded(r.unicode)) continue
    const key = r.value.replace(/\?$/, "")
    if (!out.has(key)) out.set(key, { id: r.id, name: r.name, unicode: r.unicode })
  }
  return out
}

type MeaningRow = GlyphMeaning & { spelling: string; frequency: number | null; sourceId: string | null }

/** Sumerian entries spelled exactly like one of the readings (words, and affixes / determinatives without their hyphens). */
async function sumerianMeanings(db: Database, readings: string[]): Promise<Map<string, MeaningRow[]>> {
  const out = new Map<string, MeaningRow[]>()
  if (!readings.length) return out
  const spelling = sql<string>`lower(trim(both '-' from coalesce(${entries.transliteration}, ${entries.headword})))`
  const rows = await db
    .select({
      id: entries.id,
      headword: entries.headword,
      gloss: entries.gloss,
      kind: entries.kind,
      partKind: entries.partKind,
      partOfSpeech: entries.partOfSpeech,
      frequency: entries.frequency,
      sourceId: entries.sourceId,
      spelling,
    })
    .from(entries)
    .where(and(eq(entries.languageId, "sux"), inArray(spelling, readings)))
  for (const r of rows) {
    // ePSD2 marks verbal elements of compound verbs with the placeholder gloss "cvve"
    if (!r.gloss || r.gloss === "cvve") continue
    out.set(r.spelling, [...(out.get(r.spelling) ?? []), r])
  }
  return out
}

/** Rank the entries a reading could stand for, given where the sign sits in the word. */
function rankMeanings(rows: MeaningRow[], token: SpellingToken, index: number, total: number): GlyphMeaning[] {
  const score = (r: MeaningRow) => {
    if (token.kind === "determinative") return r.partKind === "determinative" ? 0 : 9
    if (r.partKind === "determinative") return 9 // a sign read as a word, not a determinative
    // inside a longer spelling an affix is the likelier reading: -e after the noun, nam- before it
    const suffix = r.kind === "part" && r.headword.startsWith("-") && !r.headword.endsWith("-")
    const prefix = r.kind === "part" && r.headword.endsWith("-") && !r.headword.startsWith("-")
    if (total > 1 && ((suffix && index > 0) || (prefix && index < total - 1))) return 1
    if (r.kind === "part") return 4
    if (r.sourceId?.startsWith("seed-")) return 2 // hand-curated glosses first
    return r.partOfSpeech === "proper_noun" ? 5 : 3
  }
  const ranked = [...rows].sort((a, b) => score(a) - score(b) || (b.frequency ?? 0) - (a.frequency ?? 0))
  const seen = new Set<string>()
  const out: GlyphMeaning[] = []
  for (const r of ranked) {
    if (score(r) >= 9) continue
    const key = r.gloss.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: r.id, headword: r.headword, gloss: r.gloss, kind: r.kind, partKind: r.partKind, partOfSpeech: r.partOfSpeech })
    if (out.length >= MAX_MEANINGS) break
  }
  return out
}

/**
 * Break each entry's cuneiform down into its signs. An entry gets a breakdown only when every
 * token of its spelling resolves to a sign and the signs spell exactly its native script.
 */
export async function getGlyphBreakdowns(db: Database, items: BreakdownInput[]): Promise<Map<string, SpellingPart[]>> {
  const tokenized = items
    .map((e) => ({ e, spelling: spellingOf(e) }))
    .filter((x): x is { e: BreakdownInput; spelling: string } => !!x.spelling && !!x.e.nativeScript)
    .map(({ e, spelling }) => ({ e, tokens: tokenizeSpelling(spelling) }))
    .filter((x) => x.tokens.length > 0)
  const result = new Map<string, SpellingPart[]>()
  if (!tokenized.length) return result

  const signByReading = await signsForReadings(db, tokenized.flatMap((x) => x.tokens.flatMap((t) => t.keys)))
  // a determinative may be written {giš} but listed under its sign reading ŋeš
  const meaningKeys = (t: SpellingToken) => (t.kind === "determinative" ? [...new Set([t.reading, ...t.keys])] : [t.reading])
  const sumerianReadings = tokenized.filter((x) => x.e.languageId === "sux").flatMap((x) => x.tokens.flatMap(meaningKeys))
  const meaningsByReading = await sumerianMeanings(db, [...new Set(sumerianReadings)])

  for (const { e, tokens } of tokenized) {
    const parts: SpellingPart[] = []
    for (const [i, t] of tokens.entries()) {
      const sign = t.keys.map((k) => signByReading.get(k)).find(Boolean)
      if (!sign) break
      parts.push({
        glyph: sign.unicode.repeat(t.count),
        text: t.text,
        reading: t.reading,
        kind: t.kind,
        count: t.count,
        sign: { id: sign.id, name: sign.name },
        meanings:
          e.languageId === "sux" ? rankMeanings(meaningKeys(t).flatMap((k) => meaningsByReading.get(k) ?? []), t, i, tokens.length) : [],
      })
    }
    if (parts.length === tokens.length && parts.map((p) => p.glyph).join("") === e.nativeScript) result.set(e.id, parts)
  }
  return result
}

export async function getGlyphBreakdown(db: Database, item: BreakdownInput): Promise<SpellingPart[] | undefined> {
  return (await getGlyphBreakdowns(db, [item])).get(item.id)
}

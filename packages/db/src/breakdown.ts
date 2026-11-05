/**
 * Per-glyph breakdowns of cuneiform words: each sign of the spelling with its
 * reading, its sign-list name and, for Sumerian, what that reading means as a word.
 *   {d}en-me-dur-an-ki → 𒀭 {d} AN "divine name determinative" · 𒂗 en EN "lord" · …
 * With `detail`, each sign also brings its other values and its numbers in the
 * standard sign lists. Words written with Sumerograms (Akkadian 𒂗 bēlu) get the
 * Sumerian word each sign stands for instead (getCuneiformSigns).
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"

import type { Database } from "./client"
import { cuneiformGlyphs, isFullyEncoded } from "./glyphs"
import { entries, signReadings, signs, type PartKind, type PartOfSpeech } from "./schema"
import { glossParts } from "./thesaurus"
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
  /** The sign's other values and list numbers (with `detail`). */
  facts?: SignFacts
}

/** What the sign list says about a sign beyond the reading used: its other values, its numbers. */
export type SignFacts = {
  /** Other Sumerian / general values, the plainest first (lugal before lugala, bišeba). */
  readings: string[]
  /** Values the sign list marks as Akkadian (%akk). */
  akkadian: string[]
  /** "MZL 266 · ABZL 221a · LAK 165 · Labat 151" */
  numbers: string | null
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
export async function getGlyphBreakdowns(
  db: Database,
  items: BreakdownInput[],
  opts: { detail?: boolean } = {}
): Promise<Map<string, SpellingPart[]>> {
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
  if (opts.detail && result.size) {
    const facts = await getSignFacts(db, [...new Set([...result.values()].flat().map((p) => p.sign.id))])
    for (const parts of result.values())
      for (const p of parts) {
        const f = facts.get(p.sign.id)
        if (f) p.facts = { ...f, readings: f.readings.filter((r) => r !== p.reading) }
      }
  }
  return result
}

/** One entry's breakdown with each sign's other values and list numbers. */
export async function getGlyphBreakdown(db: Database, item: BreakdownInput): Promise<SpellingPart[] | undefined> {
  return (await getGlyphBreakdowns(db, [item], { detail: true })).get(item.id)
}

/** The sign lists worth citing, under their usual abbreviations. */
const SIGN_LISTS: [string, string][] = [
  ["MZL", "MZL"],
  ["ABZL", "ABZL"],
  ["LAK", "LAK"],
  ["SLLHA", "Labat"],
]

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉"

/** A reading's index: lugal 1, du₃ 3, KAₓ 99. */
function readingIndex(value: string): number {
  if (value.endsWith("ₓ")) return 99
  const digits = [...value].filter((c) => SUBSCRIPT.includes(c)).map((c) => SUBSCRIPT.indexOf(c))
  return digits.length ? Number(digits.join("")) : 1
}

/** Other values and list numbers for each sign. */
export async function getSignFacts(db: Database, signIds: string[]): Promise<Map<string, SignFacts>> {
  const out = new Map<string, SignFacts>()
  if (!signIds.length) return out
  const [rows, readings] = await Promise.all([
    db.select({ id: signs.id, name: signs.name, listNumbers: signs.listNumbers }).from(signs).where(inArray(signs.id, signIds)),
    db
      .select({ signId: signReadings.signId, value: signReadings.value, language: signReadings.language })
      .from(signReadings)
      .where(and(inArray(signReadings.signId, signIds), eq(signReadings.isDeprecated, false), eq(signReadings.isUncertain, false))),
  ])
  for (const r of rows) {
    const own = readings.filter((x) => x.signId === r.id)
    const name = r.name.toLowerCase()
    const general = own
      .filter((x) => !x.language || x.language === "sux")
      .map((x) => x.value)
      .sort((a, b) => Number(b === name) - Number(a === name) || readingIndex(a) - readingIndex(b) || a.length - b.length || a.localeCompare(b))
    const numbers = SIGN_LISTS.flatMap(([key, label]) => (r.listNumbers?.[key]?.length ? [`${label} ${r.listNumbers[key]!.join("/")}`] : []))
    out.set(r.id, {
      readings: general,
      akkadian: own.filter((x) => x.language === "akk").map((x) => x.value),
      numbers: numbers.length ? numbers.join(" · ") : null,
    })
  }
  return out
}

/** A sign of a word that has no sign-by-sign spelling (a Sumerogram, an unresolved spelling). */
export type CuneiformSign = {
  glyph: string
  sign: { id: string; name: string } | null
  facts: SignFacts | null
  /** The Sumerian word the sign stands for here, matched on meaning (Akkadian 𒂗 bēlu → en "lord"). */
  logogram: (GlyphMeaning & { reading: string }) | null
}

export type CuneiformSigns = {
  signs: CuneiformSign[]
  /** A Sumerian word written with exactly the same signs (Akkadian ekallu 𒂍𒃲 → e₂-gal "palace"). */
  sumerogram: GlyphMeaning | null
}

/** Content words of a gloss, for matching meanings loosely. */
function glossWords(gloss: string): Set<string> {
  const STOP = new Set(["the", "and", "for", "with", "one", "who", "that", "from", "into", "being", "make", "made", "kind", "type", "of", "to", "be"])
  return new Set(gloss.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [])
}

function meaningOverlap(a: string, b: string): number {
  const terms = new Set(glossParts(a))
  if (glossParts(b).some((t) => terms.has(t))) return 2
  const words = glossWords(a)
  return [...glossWords(b)].some((w) => words.has(w)) ? 1 : 0
}

/**
 * Each sign of a cuneiform word with its facts and, outside Sumerian, the Sumerian word it
 * stands for when one of the sign's values names a Sumerian word with the same meaning.
 */
export async function getCuneiformSigns(
  db: Database,
  entry: { languageId: string; nativeScript: string | null; gloss: string }
): Promise<CuneiformSigns | undefined> {
  const glyphs = cuneiformGlyphs(entry.nativeScript ?? "")
  if (!glyphs.length) return undefined
  const bases = [...new Set(glyphs.map((g) => String.fromCodePoint(g.codePointAt(0) ?? 0)))]
  const rows = await db
    .select({ id: signs.id, name: signs.name, unicode: signs.unicode, isForm: signs.isForm })
    .from(signs)
    .where(and(eq(signs.scriptId, "cuneiform"), inArray(signs.unicode, bases)))
  const byGlyph = new Map<string, { id: string; name: string }>()
  for (const r of rows.sort((a, b) => Number(a.isForm) - Number(b.isForm))) if (r.unicode && !byGlyph.has(r.unicode)) byGlyph.set(r.unicode, r)
  const facts = await getSignFacts(db, [...new Set([...byGlyph.values()].map((s) => s.id))])

  const foreign = entry.languageId !== "sux"
  const candidates = foreign ? [...new Set([...facts.values()].flatMap((f) => f.readings.slice(0, 12)))] : []
  const meanings = await sumerianMeanings(db, candidates)
  const best = (rows: MeaningRow[]): MeaningRow | undefined =>
    rows
      .map((r) => ({ r, score: meaningOverlap(entry.gloss, r.gloss) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.r.frequency ?? 0) - (a.r.frequency ?? 0))[0]?.r

  const out: CuneiformSign[] = glyphs.map((glyph) => {
    const sign = byGlyph.get(String.fromCodePoint(glyph.codePointAt(0) ?? 0)) ?? null
    const f = sign ? (facts.get(sign.id) ?? null) : null
    let logogram: CuneiformSign["logogram"] = null
    if (foreign && f) {
      // the closest meaning over all of the sign's values (diŋir "god" over an "sky-god" for ilu)
      let top: { m: MeaningRow; reading: string; score: number } | undefined
      for (const reading of f.readings.slice(0, 12)) {
        const m = best(meanings.get(reading) ?? [])
        const score = m ? meaningOverlap(entry.gloss, m.gloss) : 0
        if (m && (!top || score > top.score)) top = { m, reading, score }
      }
      if (top) {
        const { m, reading } = top
        logogram = { id: m.id, headword: m.headword, gloss: m.gloss, kind: m.kind, partKind: m.partKind, partOfSpeech: m.partOfSpeech, reading }
      }
    }
    return { glyph, sign, facts: f, logogram }
  })

  let sumerogram: GlyphMeaning | null = null
  if (foreign && entry.nativeScript) {
    const same = await db
      .select({
        id: entries.id,
        headword: entries.headword,
        gloss: entries.gloss,
        kind: entries.kind,
        partKind: entries.partKind,
        partOfSpeech: entries.partOfSpeech,
        frequency: entries.frequency,
      })
      .from(entries)
      .where(and(eq(entries.languageId, "sux"), eq(entries.nativeScript, entry.nativeScript)))
    const pick = same
      .map((r) => ({ r, score: meaningOverlap(entry.gloss, r.gloss) }))
      .sort((a, b) => b.score - a.score || (b.r.frequency ?? 0) - (a.r.frequency ?? 0))[0]
    if (pick && (pick.score > 0 || same.length === 1)) {
      const { frequency: _f, ...m } = pick.r
      sumerogram = m
    }
  }
  return { signs: out, sumerogram }
}

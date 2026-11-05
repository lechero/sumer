/**
 * An entry's thesaurus: the words it is explicitly related to (synonyms, antonyms, related words,
 * from Wiktionary and the dictionaries) and the words that share one of its meanings — in the
 * same language and across languages — found through the indexed gloss terms (schema.ts glossTerms).
 *   amo "to love" → synonyms dīligō, cārus …; same meaning adamō; other languages: φιλέω, ἀγαπάω …
 */
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm"

import type { Database } from "./client"
import { entries, entryRelations, glossTerms, languages, type Entry, type Language, type RelationType } from "./schema"

export type ThesaurusWord = Pick<
  Entry,
  "id" | "headword" | "nativeScript" | "transliteration" | "gloss" | "homonymIndex" | "kind" | "partOfSpeech" | "languageId"
> & { language: Pick<Language, "id" | "name" | "script" | "direction"> }

export type Thesaurus = {
  synonyms: ThesaurusWord[]
  antonyms: ThesaurusWord[]
  /** Same-language "see also" and Wiktionary's related terms. */
  related: ThesaurusWord[]
  /** Same language, sharing one of the gloss's meanings (computed, not asserted by a source). */
  sameMeaning: ThesaurusWord[]
  /** Other languages sharing one of the gloss's meanings, a few per language. */
  otherLanguages: { language: ThesaurusWord["language"]; words: ThesaurusWord[] }[]
  /** The gloss meanings that were matched on. */
  terms: string[]
}

type ThesaurusInput = Pick<Entry, "id" | "languageId" | "gloss" | "partOfSpeech">

const LIMITS = { sameMeaning: 16, perLanguage: 3, languages: 16 }
/** Placeholder glosses that mean nothing ("cvve": ePSD2's verbal element of a compound verb). */
const NON_GLOSSES = new Set(["cvve", "?", "unknown", "meaning unknown", "uncertain", "unclear"])

/** The gloss split into its meanings, exactly as glossTerms() does in SQL. */
export function glossParts(gloss: string): string[] {
  const parts = gloss
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^ +| +$/g, "")
    .replace(/(^|[;,])\s*(?:a|an|the)\s+/g, "$1")
    .split(/\s*[;,]\s*/)
  return [...new Set(parts)].filter((p) => p.length > 1 && !NON_GLOSSES.has(p))
}

const wordColumns = {
  id: entries.id,
  headword: entries.headword,
  nativeScript: entries.nativeScript,
  transliteration: entries.transliteration,
  gloss: entries.gloss,
  homonymIndex: entries.homonymIndex,
  kind: entries.kind,
  partOfSpeech: entries.partOfSpeech,
  languageId: entries.languageId,
  language: { id: languages.id, name: languages.name, script: languages.script, direction: languages.direction },
}

function textArray(values: string[]): SQL {
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )}]::text[]`
}

async function loadWords(db: Database, ids: string[]): Promise<ThesaurusWord[]> {
  if (!ids.length) return []
  const rows = await db.select(wordColumns).from(entries).innerJoin(languages, eq(languages.id, entries.languageId)).where(inArray(entries.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is ThesaurusWord => !!r)
}

/** Relations of these types in either direction, as the words on the other side. */
async function relatedWords(db: Database, id: string, types: RelationType[]) {
  const rows = await db
    .select({ from: entryRelations.fromEntryId, to: entryRelations.toEntryId, type: entryRelations.type })
    .from(entryRelations)
    .where(and(inArray(entryRelations.type, types), sql`(${entryRelations.fromEntryId} = ${id} or ${entryRelations.toEntryId} = ${id})`))
  const byType = new Map<RelationType, string[]>()
  for (const r of rows) {
    const other = r.from === id ? r.to : r.from
    const ids = byType.get(r.type) ?? []
    if (!ids.includes(other)) byType.set(r.type, [...ids, other])
  }
  const words = new Map((await loadWords(db, [...new Set(rows.flatMap((r) => [r.from, r.to]))].filter((x) => x !== id))).map((w) => [w.id, w]))
  const of = (type: RelationType) => (byType.get(type) ?? []).map((x) => words.get(x)).filter((w): w is ThesaurusWord => !!w)
  return of
}

/** Order words alphabetically within a list (relations carry no ranking of their own). */
function alphabetical(words: ThesaurusWord[]): ThesaurusWord[] {
  return [...words].sort((a, b) => a.headword.localeCompare(b.headword) || a.homonymIndex - b.homonymIndex)
}

export async function getThesaurus(db: Database, entry: ThesaurusInput): Promise<Thesaurus> {
  const terms = glossParts(entry.gloss)
  const of = await relatedWords(db, entry.id, ["synonym_of", "antonym_of", "see_also"])
  const synonyms = alphabetical(of("synonym_of"))
  const antonyms = alphabetical(of("antonym_of"))
  const related = alphabetical(of("see_also").filter((w) => w.languageId === entry.languageId))
  const result: Thesaurus = { synonyms, antonyms, related, sameMeaning: [], otherLanguages: [], terms }
  if (!terms.length) return result

  const wanted = textArray(terms)
  const entryTerms = glossTerms(entries.gloss)
  const shares = sql`${entryTerms} && ${wanted}`
  // how many of the meanings a candidate shares, then exact gloss, same part of speech, frequency
  const shared = sql<number>`cardinality(array(select unnest(${entryTerms}) intersect select unnest(${wanted})))`
  const exact = sql<boolean>`lower(${entries.gloss}) = ${entry.gloss.toLowerCase()}`
  // (no constant when the entry has no part of speech: Postgres refuses `order by false`)
  const samePos = entry.partOfSpeech ? [sql`(${entries.partOfSpeech} is not distinct from ${entry.partOfSpeech}) desc`] : []
  const order = [sql`${shared} desc`, sql`${exact} desc`, ...samePos, sql`${entries.frequency} desc nulls last`, sql`${entries.headword}`]

  const listed = new Set([entry.id, ...[...synonyms, ...antonyms, ...related].map((w) => w.id)])

  const same = await db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.languageId, entry.languageId), ne(entries.id, entry.id), shares))
    .orderBy(...order)
    .limit(LIMITS.sameMeaning + listed.size)
  result.sameMeaning = await loadWords(
    db,
    same
      .map((r) => r.id)
      .filter((x) => !listed.has(x))
      .slice(0, LIMITS.sameMeaning)
  )

  const ranked = db
    .select({
      id: entries.id,
      languageId: entries.languageId,
      sortOrder: languages.sortOrder,
      rank: sql<number>`row_number() over (partition by ${entries.languageId} order by ${sql.join(order, sql`, `)})`.as("rank"),
    })
    .from(entries)
    .innerJoin(languages, eq(languages.id, entries.languageId))
    .where(and(ne(entries.languageId, entry.languageId), shares))
    .as("ranked")
  const across = await db
    .select({ id: ranked.id, languageId: ranked.languageId })
    .from(ranked)
    .where(sql`${ranked.rank} <= ${LIMITS.perLanguage}`)
    .orderBy(ranked.sortOrder, ranked.languageId, ranked.rank)
    .limit(LIMITS.perLanguage * LIMITS.languages)
  const words = await loadWords(
    db,
    across.map((r) => r.id)
  )
  const byLanguage = new Map<string, Thesaurus["otherLanguages"][number]>()
  for (const w of words) {
    const group = byLanguage.get(w.languageId) ?? { language: w.language, words: [] }
    group.words.push(w)
    byLanguage.set(w.languageId, group)
  }
  result.otherLanguages = [...byLanguage.values()]
  return result
}

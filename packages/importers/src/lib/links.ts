/**
 * Resolve etymological mentions ("Proto-Semitic *kalb-", "Akkadian 𒀯 (kakkabum)")
 * to entries already in the database, and write them as entry_relations.
 *
 * Matching inside the target language, most to least specific; a level that
 * yields several different entries is ambiguous and the mention is skipped
 * (no placeholder entries are ever created):
 *   1. exact NFC headword
 *   2. exact native-script form
 *   3. "spelling" key: separators, cantillation / meteg and a leading * ignored,
 *      vowel points and diacritics kept (מֶ֫לֶךְ = מֶלֶךְ, μοναχ-ός = μοναχός)
 *   4. search-key token (normalize.ts: diacritics and pointing dropped) — only
 *      for terms whose script does not write vowels as marks: in Devanagari,
 *      pointed Hebrew / Syriac / Arabic … stripping marks merges different words.
 */
import { and, eq, inArray, like, sql } from "drizzle-orm"
import {
  chunk,
  entries,
  entryRelations,
  languages,
  normalizeForSearch,
  type Confidence,
  type Database,
  type RelationType,
} from "@workspace/db"

type LanguageIndex = {
  headword: Map<string, string[]>
  native: Map<string, string[]>
  spelling: Map<string, string[]>
  key: Map<string, string[]>
  /** Reconstructed (starred) entries. */
  starred: Set<string>
}

/** Level-3 key: keep letters, vowel points and diacritics; drop separators, cantillation, meteg, a leading *. */
export function spellingKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C6]/g, "")
    .replace(/[\s\-\u2010\u2011\u05BE\u00B7.*]/g, "")
    .normalize("NFC")
    .toLowerCase()
}

/** Scripts whose vowels are combining marks (Indic, Brahmi …) or pointed abjads: search keys would merge words. */
const VOWEL_MARK_SCRIPT = /[\u0900-\u0DFF\u1000-\u109F\u1780-\u17FF\u0E00-\u0EFF\u{11000}-\u{1107F}\u0591-\u05C7\u0610-\u061A\u064B-\u065F\u0670\u0730-\u074A]/u

function add(map: Map<string, string[]>, k: string | null | undefined, id: string) {
  if (!k) return
  const ids = map.get(k)
  if (!ids) map.set(k, [id])
  else if (!ids.includes(id)) ids.push(id)
}

export class EntryResolver {
  private indexes = new Map<string, Promise<LanguageIndex>>()
  private known?: Promise<Set<string>>

  /** `reconstructed`: languages whose every entry is a reconstruction (ine-pro …). */
  constructor(
    private db: Database,
    private reconstructed: Set<string> = new Set()
  ) {}

  /** Language ids present in the database. */
  languages(): Promise<Set<string>> {
    this.known ??= this.db
      .select({ id: languages.id })
      .from(languages)
      .then((rows) => new Set(rows.map((r) => r.id)))
    return this.known
  }

  /** Forget a language's cached index (after its entries changed). */
  invalidate(lang: string) {
    this.indexes.delete(lang)
    this.known = undefined
  }

  private index(lang: string): Promise<LanguageIndex> {
    let p = this.indexes.get(lang)
    if (!p) {
      p = this.db
        .select({ id: entries.id, headword: entries.headword, native: entries.nativeScript, searchKey: entries.searchKey })
        .from(entries)
        .where(eq(entries.languageId, lang))
        .then((rows) => {
          const idx: LanguageIndex = { headword: new Map(), native: new Map(), spelling: new Map(), key: new Map(), starred: new Set() }
          const allStarred = this.reconstructed.has(lang)
          for (const r of rows) {
            add(idx.headword, r.headword.normalize("NFC"), r.id)
            add(idx.native, r.native?.normalize("NFC"), r.id)
            add(idx.spelling, spellingKey(r.headword), r.id)
            if (r.native) add(idx.spelling, spellingKey(r.native), r.id)
            for (const token of r.searchKey.split(" ")) add(idx.key, token, r.id)
            if (allStarred || r.headword.startsWith("*") || r.native?.startsWith("*")) idx.starred.add(r.id)
          }
          return idx
        })
      this.indexes.set(lang, p)
    }
    return p
  }

  /**
   * The single entry of `lang` that any of `terms` (term, display form, romanisation …) names.
   * `starred`: the mention is a reconstruction (*…) — only reconstructed entries qualify.
   */
  async resolve(lang: string, terms: string[], opts: { starred?: boolean } = {}): Promise<string | undefined> {
    return (await this.match(lang, terms, opts))?.id
  }

  /** Like resolve, also saying which level matched (1–4). */
  async match(lang: string, terms: string[], opts: { starred?: boolean } = {}): Promise<{ id: string; level: number } | undefined> {
    if (!(await this.languages()).has(lang)) return undefined
    const idx = await this.index(lang)
    const forms = [...new Set(terms.flatMap((t) => [t.normalize("NFC").trim(), t.normalize("NFC").trim().replace(/^\*/, "")]).filter(Boolean))]
    const levels: ((t: string) => string[] | undefined)[] = [
      (t) => idx.headword.get(t),
      (t) => idx.native.get(t),
      (t) => idx.spelling.get(spellingKey(t)),
      (t) => {
        if (VOWEL_MARK_SCRIPT.test(t)) return undefined
        const k = normalizeForSearch(t)
        return k ? idx.key.get(k) : undefined
      },
    ]
    for (const [i, level] of levels.entries()) {
      let ids = [...new Set(forms.flatMap((t) => level(t) ?? []))]
      if (opts.starred) ids = ids.filter((id) => idx.starred.has(id))
      if (ids.length === 1) return { id: ids[0]!, level: i + 1 }
      if (ids.length > 1) return undefined // ambiguous
    }
    return undefined
  }
}

export type RelationRow = {
  fromEntryId: string
  toEntryId: string
  type: RelationType
  confidence: Confidence
  note: string
}

/**
 * Insert or update relations (unique on from, to, type). A cognate pair already
 * stored the other way round is not duplicated. Rows written by other sources
 * (notes not starting with `notePrefix`) keep their confidence and note.
 * Returns the ids of every relation row the call wrote or confirmed.
 */
export async function writeRelations(
  db: Database,
  input: RelationRow[],
  opts: { notePrefix: string; batchSize?: number }
): Promise<{ ids: Set<string>; byType: Map<string, number> }> {
  // reverse cognates already in the database
  const cognates = input.filter((r) => r.type === "cognate_of")
  const reverse = new Set<string>()
  for (const part of chunk([...new Set(cognates.map((r) => r.toEntryId))], 500)) {
    const rows = await db
      .select({ from: entryRelations.fromEntryId, to: entryRelations.toEntryId })
      .from(entryRelations)
      .where(and(eq(entryRelations.type, "cognate_of"), inArray(entryRelations.fromEntryId, part)))
    for (const r of rows) reverse.add(`${r.from}|${r.to}`)
  }
  const seen = new Set<string>()
  const rows: RelationRow[] = []
  for (const r of input) {
    if (r.fromEntryId === r.toEntryId) continue
    const k = `${r.fromEntryId}|${r.toEntryId}|${r.type}`
    if (seen.has(k)) continue
    if (r.type === "cognate_of") {
      if (reverse.has(`${r.toEntryId}|${r.fromEntryId}`)) continue
      if (seen.has(`${r.toEntryId}|${r.fromEntryId}|cognate_of`)) continue
    }
    seen.add(k)
    rows.push(r)
  }
  const ids = new Set<string>()
  const byType = new Map<string, number>()
  const mine = `${opts.notePrefix}%`
  for (const batch of chunk(rows, opts.batchSize ?? 500)) {
    const written = await db
      .insert(entryRelations)
      .values(batch)
      .onConflictDoUpdate({
        target: [entryRelations.fromEntryId, entryRelations.toEntryId, entryRelations.type],
        set: {
          confidence: sql`case when ${entryRelations.note} like ${mine} then excluded.confidence else ${entryRelations.confidence} end`,
          note: sql`case when ${entryRelations.note} is null or ${entryRelations.note} like ${mine} then excluded.note else ${entryRelations.note} end`,
        },
      })
      .returning({ id: entryRelations.id, type: entryRelations.type })
    for (const w of written) {
      ids.add(w.id)
      byType.set(w.type, (byType.get(w.type) ?? 0) + 1)
    }
  }
  return { ids, byType }
}

/** Delete relations from `fromIds` carrying `notePrefix` that the latest run did not confirm. */
export async function pruneRelations(db: Database, fromIds: string[], keep: Set<string>, notePrefix: string): Promise<number> {
  let pruned = 0
  for (const part of chunk(fromIds, 500)) {
    const rows = await db
      .select({ id: entryRelations.id })
      .from(entryRelations)
      .where(and(inArray(entryRelations.fromEntryId, part), like(entryRelations.note, `${notePrefix}%`)))
    const stale = rows.map((r) => r.id).filter((id) => !keep.has(id))
    for (const s of chunk(stale, 500)) {
      await db.delete(entryRelations).where(inArray(entryRelations.id, s))
      pruned += s.length
    }
  }
  return pruned
}

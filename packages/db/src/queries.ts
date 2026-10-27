import { and, asc, count, eq, getTableColumns, ilike, or, sql, type SQL } from "drizzle-orm"

import type { Database } from "./client"
import { normalizeForSearch } from "./normalize"
import { entries, entryComponents, languages, senses, type EntryKind } from "./schema"

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export async function listLanguages(db: Database) {
  return db
    .select({
      ...getTableColumns(languages),
      wordCount: sql<number>`count(*) filter (where ${entries.kind} = 'word')`.mapWith(Number),
      partCount: sql<number>`count(*) filter (where ${entries.kind} = 'part')`.mapWith(Number),
    })
    .from(languages)
    .leftJoin(entries, eq(entries.languageId, languages.id))
    .groupBy(languages.id)
    .orderBy(asc(languages.sortOrder), asc(languages.name))
}

export type LanguageWithCounts = Awaited<ReturnType<typeof listLanguages>>[number]

export async function getLanguage(db: Database, id: string) {
  return db.query.languages.findFirst({ where: eq(languages.id, id) })
}

export type EntryListFilter = {
  languageId?: string
  kind?: EntryKind
  q?: string
  limit?: number
  offset?: number
}

/** Build the WHERE clause shared by list + count. */
function entryFilter(f: EntryListFilter): SQL | undefined {
  const conds: (SQL | undefined)[] = []
  if (f.languageId) conds.push(eq(entries.languageId, f.languageId))
  if (f.kind) conds.push(eq(entries.kind, f.kind))

  const q = f.q?.trim()
  if (q) {
    const key = normalizeForSearch(q)
    const like = `%${escapeLike(q)}%`
    conds.push(
      or(
        key ? ilike(entries.searchKey, `%${escapeLike(key)}%`) : undefined,
        ilike(entries.headword, like),
        ilike(entries.transliteration, like),
        ilike(entries.nativeScript, like),
        ilike(entries.gloss, like)
      )
    )
  }
  const defined = conds.filter((c): c is SQL => c !== undefined)
  return defined.length ? and(...defined) : undefined
}

/** 0 = a key variant matches exactly, 1 = a variant starts with the query, 2 = the gloss starts with / contains the word, 3 = anything else. */
function entryRank(q: string): SQL {
  const key = normalizeForSearch(q)
  const gloss = q.toLowerCase()
  return sql`case
    when position(${" " + key + " "} in ' ' || ${entries.searchKey} || ' ') > 0 then 0
    when position(${" " + key} in ' ' || ${entries.searchKey}) > 0 then 1
    when position(${gloss} in lower(${entries.gloss})) = 1 or position(${" " + gloss} in lower(${entries.gloss})) > 0 then 2
    else 3 end`
}

export async function listEntries(db: Database, f: EntryListFilter = {}) {
  const where = entryFilter(f)
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000)
  const offset = Math.max(f.offset ?? 0, 0)

  const [rows, totals] = await Promise.all([
    db.query.entries.findMany({
      where,
      with: { language: true },
      orderBy: [
        ...(f.q?.trim() ? [entryRank(f.q.trim())] : []),
        asc(entries.kind),
        asc(entries.headword),
        asc(entries.homonymIndex),
      ],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(entries).where(where),
  ])

  return { rows, total: totals[0]?.total ?? 0, limit, offset }
}

export type EntryListItem = Awaited<ReturnType<typeof listEntries>>["rows"][number]

export async function getEntryById(db: Database, id: string) {
  return db.query.entries.findFirst({
    where: eq(entries.id, id),
    with: {
      language: true,
      source: true,
      senses: { orderBy: [asc(senses.sortOrder)] },
      components: {
        orderBy: [asc(entryComponents.position)],
        with: { component: { with: { language: true } } },
      },
      usedIn: { with: { entry: { with: { language: true } } } },
      relationsFrom: { with: { to: { with: { language: true } } } },
      relationsTo: { with: { from: { with: { language: true } } } },
    },
  })
}

export type EntryDetail = NonNullable<Awaited<ReturnType<typeof getEntryById>>>

export async function countEntries(db: Database) {
  const [row] = await db
    .select({
      total: count(),
      words: sql<number>`count(*) filter (where ${entries.kind} = 'word')`.mapWith(Number),
      parts: sql<number>`count(*) filter (where ${entries.kind} = 'part')`.mapWith(Number),
    })
    .from(entries)
  return row ?? { total: 0, words: 0, parts: 0 }
}

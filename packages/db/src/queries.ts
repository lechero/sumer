import { and, asc, count, eq, getTableColumns, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm"

import type { Database } from "./client"
import { cuneiformGlyphs, isFullyEncoded, parseSignName, usesExtendedCodePoints } from "./glyphs"
import { normalizeForSearch } from "./normalize"
import { entries, entryComponents, languages, senses, signReadings, signs, type EntryKind } from "./schema"

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

/**
 * 0 = the headword itself matches, 1 = the gloss is exactly the query (English lookup),
 * 2 = a popular-spelling / native-script variant matches exactly, 3 = the gloss starts with
 * or contains the query as a word, 4 = a variant starts with the query, 5 = substring elsewhere.
 */
function entryRank(q: string): SQL {
  const key = normalizeForSearch(q)
  const gloss = q.toLowerCase()
  return sql`case
    when split_part(${entries.searchKey}, ' ', 1) = ${key} then 0
    when lower(${entries.gloss}) = ${gloss} or lower(${entries.gloss}) like ${gloss + ",%"} or lower(${entries.gloss}) like ${gloss + ";%"} then 1
    when position(${" " + key + " "} in ' ' || ${entries.searchKey} || ' ') > 0 then 2
    when position(${gloss} in lower(${entries.gloss})) = 1 or position(${" " + gloss} in lower(${entries.gloss})) > 0 then 3
    when position(${" " + key} in ' ' || ${entries.searchKey}) > 0 then 4
    else 5 end`
}

/** Exact-case headword matches and common words before proper names. */
function tieBreak(q: string): SQL {
  return sql`case when ${entries.headword} = ${q} then 0 else 1 end + case when ${entries.partOfSpeech} = 'proper_noun' then 2 else 0 end`
}

/** Languages in their display order, so Sumerian beats an Akkadian name on a tie. */
const languageOrder = sql`(select l.sort_order from ${languages} l where l.id = ${entries.languageId})`

export async function listEntries(db: Database, f: EntryListFilter = {}) {
  const where = entryFilter(f)
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000)
  const offset = Math.max(f.offset ?? 0, 0)

  const [rows, totals] = await Promise.all([
    db.query.entries.findMany({
      where,
      with: { language: true },
      orderBy: [
        ...(f.q?.trim()
          ? [entryRank(f.q.trim()), tieBreak(f.q.trim()), sql`coalesce(${entries.frequency}, 0) desc`, languageOrder, asc(entries.kind), sql`length(${entries.headword})`]
          : [asc(entries.kind)]),
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

/* ──────────────────────────────────────────────────────────────────────────
 * Cuneiform signs
 * ────────────────────────────────────────────────────────────────────────── */

export type SignListFilter = { q?: string; limit?: number; offset?: number; encodedOnly?: boolean; formsToo?: boolean }

function signFilter(f: SignListFilter): SQL | undefined {
  const conds: SQL[] = []
  if (f.encodedOnly !== false) conds.push(isNotNull(signs.unicode))
  if (!f.formsToo) conds.push(eq(signs.isForm, false))
  const q = f.q?.trim()
  if (q) {
    const key = normalizeForSearch(q)
    const like = `%${escapeLike(q)}%`
    const readingMatch = sql`exists (select 1 from ${signReadings} r where r.sign_id = ${signs.id} and (r.search_key = ${key} or r.search_key like ${`${escapeLike(key)}%`}))`
    const c = or(
      ilike(signs.name, like),
      sql`${signs.unicode} like ${like}`,
      ilike(signs.unicodeName, like),
      readingMatch
    )
    if (c) conds.push(c)
  }
  return conds.length ? and(...conds) : undefined
}

export async function listSigns(db: Database, f: SignListFilter = {}) {
  const where = signFilter(f)
  const limit = Math.min(Math.max(f.limit ?? 120, 1), 1000)
  const offset = Math.max(f.offset ?? 0, 0)
  const q = f.q?.trim()
  // Exact reading / name matches first. Without a query there is nothing to rank by;
  // a constant `0` must not be emitted, since Postgres reads `order by 0` as a column position.
  const rank = q
    ? [sql`case when exists (select 1 from ${signReadings} r where r.sign_id = ${signs.id} and r.search_key = ${normalizeForSearch(q)}) then 0 when lower(${signs.name}) = ${q.toLowerCase()} then 0 else 1 end`]
    : []
  const [rows, totals] = await Promise.all([
    db.query.signs.findMany({
      where,
      with: { readings: { orderBy: [asc(signReadings.sortOrder)], limit: 6 } },
      orderBy: [...rank, asc(signs.name)],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(signs).where(where),
  ])
  // Signs that may not be drawable (unencoded, or outside the standard blocks) carry their components as a fallback.
  const needsParts = (u: string | null) => !isFullyEncoded(u) || usesExtendedCodePoints(u)
  const byName = await loadSignsByName(db, rows.filter((r) => needsParts(r.unicode)).flatMap((r) => componentLookupNames(r.name)))
  return {
    rows: rows.map((r) => ({ ...r, components: needsParts(r.unicode) ? resolveComponents(r.name, byName) : null })),
    total: totals[0]?.total ?? 0,
    limit,
    offset,
  }
}

export type SignListItem = Awaited<ReturnType<typeof listSigns>>["rows"][number]

type SignRef = { name: string; unicode: string | null }

/**
 * A component of a sign name with the signs it may be drawn as: the exact name first (AL@s), then the
 * name without modifiers (AL). Which one to draw depends on font coverage, so the app picks.
 */
export type SignComponent = { kind: "sign"; name: string; matches: SignRef[] } | { kind: "op"; text: string }

function componentLookupNames(name: string): string[] {
  return parseSignName(name).flatMap((p) => (p.kind === "sign" ? [p.name, p.base] : []))
}

async function loadSignsByName(db: Database, names: string[]): Promise<Map<string, SignRef>> {
  const unique = [...new Set(names)]
  if (!unique.length) return new Map()
  const rows = await db.select({ name: signs.name, unicode: signs.unicode }).from(signs).where(inArray(signs.name, unique))
  return new Map(rows.map((r) => [r.name, r]))
}

/** Match each component of `name` to the signs it may be drawn as (exact name, then without modifiers). */
function resolveComponents(name: string, byName: Map<string, SignRef>): SignComponent[] {
  return parseSignName(name).map((p) => {
    if (p.kind === "op") return p
    const matches = [byName.get(p.name), p.base !== p.name ? byName.get(p.base) : undefined].filter((s): s is SignRef => !!s)
    return { kind: "sign", name: p.name, matches }
  })
}

const SUBSCRIPT: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" }

/** Accepts the Oracc name as written (E₂, |SAL.TUG₂|) or typed plainly (E2, e2, sal.tug2). */
export async function getSignByName(db: Database, name: string) {
  const subscripted = name.replace(/(\D)(\d+)/g, (_, a: string, d: string) => a + [...d].map((c) => SUBSCRIPT[c] ?? c).join(""))
  const candidates = [...new Set([name, subscripted, subscripted.toUpperCase(), name.toUpperCase()])]
  const row = await db.query.signs.findFirst({ where: inArray(signs.name, candidates), columns: { name: true } })
  if (!row) return undefined
  const sign = await db.query.signs.findFirst({
    where: eq(signs.name, row.name),
    with: {
      readings: { orderBy: [asc(signReadings.sortOrder)] },
      parent: true,
      forms: { orderBy: [asc(signs.name)] },
      source: true,
    },
  })
  if (!sign) return undefined
  // Compounds (|A.DU|) always link to their parts; other signs only when they may not be drawable (AL@s → AL).
  const showParts = sign.name.startsWith("|") || !isFullyEncoded(sign.unicode) || usesExtendedCodePoints(sign.unicode)
  const components = showParts ? resolveComponents(sign.name, await loadSignsByName(db, componentLookupNames(sign.name))) : null
  return { ...sign, components }
}

export type SignDetail = NonNullable<Awaited<ReturnType<typeof getSignByName>>>

/** Signs for every distinct code point in a cuneiform string, keyed by glyph. */
export async function getSignsForText(db: Database, text: string) {
  // Look glyphs up without their variation selectors; the signs table stores the bare code point.
  const glyphs = [...new Set(cuneiformGlyphs(text).map((g) => String.fromCodePoint(g.codePointAt(0) ?? 0)))]
  if (!glyphs.length) return new Map<string, { id: string; name: string; unicode: string | null }>()
  const rows = await db
    .select({ id: signs.id, name: signs.name, unicode: signs.unicode, isForm: signs.isForm })
    .from(signs)
    .where(inArray(signs.unicode, glyphs))
  const map = new Map<string, { id: string; name: string; unicode: string | null }>()
  for (const r of rows.sort((a, b) => Number(a.isForm) - Number(b.isForm))) {
    if (r.unicode && !map.has(r.unicode)) map.set(r.unicode, r)
  }
  return map
}

/** Entries whose native script contains the sign's glyph(s): common words by attestation first, names last. */
export async function listEntriesWithGlyph(db: Database, glyph: string, limit = 60) {
  return db.query.entries.findMany({
    where: sql`${entries.nativeScript} like ${`%${escapeLike(glyph)}%`}`,
    with: { language: true },
    orderBy: [
      sql`case when ${entries.partOfSpeech} = 'proper_noun' then 1 else 0 end`,
      sql`coalesce(${entries.frequency}, 0) desc`,
      sql`length(${entries.nativeScript})`,
      languageOrder,
      asc(entries.headword),
    ],
    limit,
  })
}

export async function countSigns(db: Database) {
  const [row] = await db
    .select({
      total: count(),
      encoded: sql<number>`count(*) filter (where ${signs.unicode} is not null and ${signs.isForm} = false)`.mapWith(Number),
      readings: sql<number>`(select count(*) from ${signReadings})`.mapWith(Number),
    })
    .from(signs)
  return row ?? { total: 0, encoded: 0, readings: 0 }
}

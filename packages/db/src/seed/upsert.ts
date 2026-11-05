/**
 * Re-runnable loading of datasets (hand-written seeds and importer output).
 *
 * Identity rules for an entry:
 *   1. If the source already holds a row with the same `sourceRef`, same kind
 *      and same headword, that row is updated (stable across re-imports even
 *      when neighbouring homonyms appear or disappear).
 *   2. Otherwise the row is matched / created on
 *      (language, kind, headword, homonym index). An explicit `homonym` wins;
 *      without one, the lowest free index for that headword is taken.
 * Senses and components of every touched entry are rewritten.
 */
import { and, eq, inArray, sql } from "drizzle-orm"

import type { Database } from "../client"
import { buildSearchKey } from "../normalize"
import {
  entries,
  entryComponents,
  entryRelations,
  languages,
  senses,
  sources,
  type EntryKind,
  type NewEntry,
  type NewLanguage,
  type NewSource,
} from "../schema"
import type { EntryRef, SeedComponent, SeedDataset, SeedEntry, SeedRelation } from "./types"

export type UpsertOptions = {
  /** Delete rows of this source that are absent from the dataset. */
  prune?: boolean
  /** Keep existing descriptive fields (definition, etymology, notes, script, transliteration) when the incoming value is null. */
  keepExisting?: boolean
  batchSize?: number
  log?: (message: string) => void
}

export type UpsertResult = {
  /** key (see entryKey) → entry id, for every entry in the dataset */
  idByKey: Map<string, string>
  /** source ref → key, for entries that carry a ref */
  keyOfRef: Map<string, string>
  inserted: number
  updated: number
  pruned: number
}

const nfc = (s: string | null | undefined) => (s == null ? null : s.normalize("NFC"))

export function entryKey(r: { lang: string; kind: string; headword: string; homonym: number }): string {
  return `${r.lang}|${r.kind}|${r.headword.normalize("NFC")}|${r.homonym}`
}

export function refKey(r: EntryRef): string {
  return entryKey({ lang: r.lang, kind: r.kind ?? "word", headword: r.headword, homonym: r.homonym ?? 1 })
}

/** Parse a component reference: "lu₂", "part:nam-", "a#2" */
export function parseComponent(lang: string, c: SeedComponent, keyOfRef?: Map<string, string>) {
  const spec = typeof c === "string" ? { ref: c } : c
  if (spec.ref.startsWith("ref:")) {
    const key = keyOfRef?.get(spec.ref.slice(4))
    return { key: key ?? `?${spec.ref}`, role: spec.role, note: spec.note }
  }
  let kind: EntryKind = "word"
  let headword = spec.ref
  if (headword.startsWith("part:")) {
    kind = "part"
    headword = headword.slice(5)
  }
  let homonym = 1
  const m = headword.match(/^(.*)#(\d+)$/)
  if (m) {
    headword = m[1]!
    homonym = Number(m[2])
  }
  return { key: entryKey({ lang, kind, headword, homonym }), role: spec.role, note: spec.note }
}

export function chunk<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function validateDataset(ds: SeedDataset): void {
  const seen = new Set<string>()
  const refs = new Set<string>()
  for (const e of ds.entries) {
    if (e.homonym !== undefined || ds.mergeMode === "fill") {
      const key = entryKey({ lang: ds.language.id, kind: e.kind, headword: e.headword, homonym: e.homonym ?? 1 })
      if (seen.has(key)) throw new Error(`duplicate seed entry: ${key}`)
      seen.add(key)
    }
    if (e.ref) {
      const rk = `${e.kind}|${e.ref}`
      if (refs.has(rk)) throw new Error(`duplicate source ref in ${ds.language.id}: ${e.ref}`)
      refs.add(rk)
    }
    if (e.kind === "part" && !e.partKind) throw new Error(`part without partKind: ${e.headword}`)
    if (!e.gloss) throw new Error(`entry without gloss: ${e.headword}`)
  }
}

export async function upsertLanguage(db: Database, language: NewLanguage) {
  await db.insert(languages).values(language).onConflictDoUpdate({ target: languages.id, set: { ...language } })
}

export async function upsertSource(db: Database, source: NewSource) {
  await db.insert(sources).values(source).onConflictDoUpdate({ target: sources.id, set: { ...source } })
}

type ExistingRow = { id: string; kind: EntryKind; headword: string; homonymIndex: number; sourceRef: string | null }

export async function upsertDataset(db: Database, ds: SeedDataset, opts: UpsertOptions = {}): Promise<UpsertResult> {
  const log = opts.log ?? (() => {})
  const batchSize = opts.batchSize ?? 200
  const lang = ds.language.id
  validateDataset(ds)

  await upsertLanguage(db, ds.language)
  await upsertSource(db, ds.source)

  // What the database already knows about this language (for homonym numbering) and this source (for stable refs).
  const existing: ExistingRow[] = await db
    .select({
      id: entries.id,
      kind: entries.kind,
      headword: entries.headword,
      homonymIndex: entries.homonymIndex,
      sourceRef: entries.sourceRef,
      sourceId: entries.sourceId,
    })
    .from(entries)
    .where(eq(entries.languageId, lang))
    .then((rows) =>
      rows.map((r) => ({ ...r, sourceRef: r.sourceId === ds.source.id ? r.sourceRef : null }))
    )

  const byRef = new Map<string, ExistingRow>()
  const takenHomonyms = new Map<string, Set<number>>() // `${kind}|${headword}` → indices in use
  const idOfKey = new Map<string, string>()
  for (const r of existing) {
    if (r.sourceRef) byRef.set(`${r.kind}|${r.sourceRef}`, r)
    const hk = `${r.kind}|${r.headword}`
    if (!takenHomonyms.has(hk)) takenHomonyms.set(hk, new Set())
    takenHomonyms.get(hk)!.add(r.homonymIndex)
    idOfKey.set(entryKey({ lang, kind: r.kind, headword: r.headword, homonym: r.homonymIndex }), r.id)
  }

  // Decide the homonym index of every incoming entry.
  const planned = new Map<string, Set<number>>() // indices claimed by this dataset
  const claim = (kind: EntryKind, headword: string, index: number) => {
    const hk = `${kind}|${headword}`
    if (!planned.has(hk)) planned.set(hk, new Set())
    planned.get(hk)!.add(index)
  }
  const fill = ds.mergeMode === "fill"
  const keyOfRef = new Map<string, string>()
  const rows: { entry: SeedEntry; row: NewEntry; key: string }[] = []
  for (const e of ds.entries) {
    const headword = e.headword.normalize("NFC")
    const hk = `${e.kind}|${headword}`
    let homonym: number
    const prior = e.ref ? byRef.get(`${e.kind}|${e.ref}`) : undefined
    if (e.homonym !== undefined) {
      homonym = e.homonym
    } else if (fill) {
      homonym = 1
    } else if (prior && prior.headword === headword && !planned.get(hk)?.has(prior.homonymIndex)) {
      homonym = prior.homonymIndex
    } else {
      // lowest index not used by another source ref in the DB nor already claimed in this dataset
      const used = new Set<number>([...(planned.get(hk) ?? [])])
      for (const r of existing) {
        if (r.kind === e.kind && r.headword === headword) {
          const sameRef = e.ref && r.sourceRef === e.ref
          const anonymous = !r.sourceRef // seed rows without a ref may be taken over
          if (!sameRef && !anonymous) used.add(r.homonymIndex)
        }
      }
      homonym = 1
      while (used.has(homonym)) homonym++
    }
    claim(e.kind, headword, homonym)
    const key = entryKey({ lang, kind: e.kind, headword, homonym })
    if (e.ref) keyOfRef.set(e.ref, key)
    rows.push({
      entry: e,
      key,
      row: {
        languageId: lang,
        kind: e.kind,
        partKind: e.kind === "part" ? e.partKind : null,
        headword,
        homonymIndex: homonym,
        nativeScript: nfc(e.native),
        transliteration: e.translit ?? null,
        searchKey: buildSearchKey([e.headword, e.translit, e.native]),
        partOfSpeech: e.pos ?? null,
        gloss: e.gloss,
        frequency: e.frequency ?? null,
        definition: e.definition ?? null,
        etymology: e.etymology ?? null,
        notes: e.notes ?? null,
        sourceId: ds.source.id,
        sourceRef: e.ref ?? null,
      },
    })
  }

  // Write entries.
  const idByKey = new Map<string, string>()
  const ownedKeys = new Set<string>() // rows this source owns (new, or previously written by it)
  let inserted = 0
  let updated = 0
  const replaceSet = opts.keepExisting
    ? {
        partKind: sql`excluded.part_kind`,
        nativeScript: sql`coalesce(excluded.native_script, ${entries.nativeScript})`,
        transliteration: sql`coalesce(excluded.transliteration, ${entries.transliteration})`,
        searchKey: sql`excluded.search_key`,
        partOfSpeech: sql`coalesce(excluded.part_of_speech, ${entries.partOfSpeech})`,
        gloss: sql`excluded.gloss`,
        frequency: sql`coalesce(excluded.frequency, ${entries.frequency})`,
        definition: sql`coalesce(excluded.definition, ${entries.definition})`,
        etymology: sql`coalesce(excluded.etymology, ${entries.etymology})`,
        notes: sql`coalesce(excluded.notes, ${entries.notes})`,
        sourceId: sql`excluded.source_id`,
        sourceRef: sql`excluded.source_ref`,
        updatedAt: sql`now()`,
      }
    : {
        partKind: sql`excluded.part_kind`,
        nativeScript: sql`excluded.native_script`,
        transliteration: sql`excluded.transliteration`,
        searchKey: sql`excluded.search_key`,
        partOfSpeech: sql`excluded.part_of_speech`,
        gloss: sql`excluded.gloss`,
        frequency: sql`excluded.frequency`,
        definition: sql`excluded.definition`,
        etymology: sql`excluded.etymology`,
        notes: sql`excluded.notes`,
        sourceId: sql`excluded.source_id`,
        sourceRef: sql`excluded.source_ref`,
        updatedAt: sql`now()`,
      }
  // fill: adopt the existing row, only add what it lacks; never touch gloss / source of imported rows
  const fillSet = {
    nativeScript: sql`coalesce(${entries.nativeScript}, excluded.native_script)`,
    transliteration: sql`coalesce(${entries.transliteration}, excluded.transliteration)`,
    partOfSpeech: sql`coalesce(${entries.partOfSpeech}, excluded.part_of_speech)`,
    definition: sql`coalesce(${entries.definition}, excluded.definition)`,
    frequency: sql`coalesce(${entries.frequency}, excluded.frequency)`,
    etymology: sql`coalesce(${entries.etymology}, excluded.etymology)`,
    notes: sql`coalesce(${entries.notes}, excluded.notes)`,
    searchKey: sql`case when ${entries.sourceId} = excluded.source_id then excluded.search_key else ${entries.searchKey} end`,
    gloss: sql`case when ${entries.sourceId} = excluded.source_id then excluded.gloss else ${entries.gloss} end`,
    updatedAt: sql`case when ${entries.sourceId} = excluded.source_id then now() else ${entries.updatedAt} end`,
  }
  for (const batch of chunk(rows, batchSize)) {
    const result = await db
      .insert(entries)
      .values(batch.map((r) => r.row))
      .onConflictDoUpdate({
        target: [entries.languageId, entries.kind, entries.headword, entries.homonymIndex],
        set: fill ? fillSet : replaceSet,
      })
      .returning({
        id: entries.id,
        kind: entries.kind,
        headword: entries.headword,
        homonymIndex: entries.homonymIndex,
        sourceId: entries.sourceId,
      })
    for (const r of result) {
      const key = entryKey({ lang, kind: r.kind, headword: r.headword, homonym: r.homonymIndex })
      idByKey.set(key, r.id)
      if (r.sourceId === ds.source.id) ownedKeys.add(key)
      if (idOfKey.has(key)) updated++
      else inserted++
    }
    if (rows.length > batchSize) log(`  … ${Math.min(idByKey.size, rows.length)}/${rows.length}`)
  }

  // Rewrite senses + components of the rows this source owns; in fill mode, foreign rows
  // (imported from elsewhere) keep their senses and only receive components if they have none.
  const ids = [...idByKey.values()]
  const ownedIds = rows.filter((r) => ownedKeys.has(r.key)).map((r) => idByKey.get(r.key)!)
  for (const part of chunk(ownedIds, 500)) {
    await db.delete(senses).where(inArray(senses.entryId, part))
    await db.delete(entryComponents).where(inArray(entryComponents.entryId, part))
  }
  const foreignWithComponents = new Set<string>()
  if (fill) {
    const foreignIds = ids.filter((id) => !ownedIds.includes(id))
    for (const part of chunk(foreignIds, 500)) {
      const have = await db
        .selectDistinct({ entryId: entryComponents.entryId })
        .from(entryComponents)
        .where(inArray(entryComponents.entryId, part))
      for (const h of have) foreignWithComponents.add(h.entryId)
    }
  }
  const senseRows: (typeof senses.$inferInsert)[] = []
  const componentRows: (typeof entryComponents.$inferInsert)[] = []
  const problems: string[] = []
  for (const { entry: e, key } of rows) {
    const entryId = idByKey.get(key)!
    const owned = ownedKeys.has(key)
    if (owned) {
      e.senses?.forEach((s, i) => {
        const sense = typeof s === "string" ? { gloss: s } : s
        senseRows.push({ entryId, sortOrder: i, ...sense })
      })
    }
    if (owned || (fill && !foreignWithComponents.has(entryId))) {
      e.parts?.forEach((c, i) => {
        const parsed = parseComponent(lang, c, keyOfRef)
        const componentId = idByKey.get(parsed.key) ?? idOfKey.get(parsed.key)
        if (!componentId) {
          problems.push(`${key}: unknown component ${parsed.key}`)
          return
        }
        componentRows.push({ entryId, componentId, position: i, role: parsed.role, note: parsed.note })
      })
    }
  }
  if (problems.length) throw new Error(`dataset problems:\n  ${problems.slice(0, 20).join("\n  ")}${problems.length > 20 ? `\n  … ${problems.length - 20} more` : ""}`)
  for (const batch of chunk(senseRows, batchSize)) await db.insert(senses).values(batch)
  for (const batch of chunk(componentRows, batchSize)) await db.insert(entryComponents).values(batch)

  // Optionally remove stale rows of this source.
  let pruned = 0
  if (opts.prune && !fill) {
    // stale ids are found here, not with NOT IN (…): a 200k-id list overflows the query builder
    const keep = new Set(ids)
    const own = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.languageId, lang), eq(entries.sourceId, ds.source.id)))
    const stale = own.map((r) => r.id).filter((id) => !keep.has(id))
    for (const part of chunk(stale, 500)) {
      await db.delete(entries).where(inArray(entries.id, part))
      pruned += part.length
    }
  }

  log(`[${ds.language.id}] ${ds.source.id}: ${rows.length} entries (${inserted} new, ${updated} updated${pruned ? `, ${pruned} pruned` : ""}), ${senseRows.length} senses, ${componentRows.length} components`)
  return { idByKey, keyOfRef, inserted, updated, pruned }
}

/** Resolve an EntryRef to an id, from the maps built during this run or from the database. */
export async function resolveRef(db: Database, ref: EntryRef, idByKey: Map<string, string>): Promise<string | undefined> {
  const key = refKey(ref)
  const cached = idByKey.get(key)
  if (cached) return cached
  const row = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.languageId, ref.lang),
        eq(entries.kind, ref.kind ?? "word"),
        eq(entries.headword, ref.headword.normalize("NFC")),
        eq(entries.homonymIndex, ref.homonym ?? 1)
      )
    )
    .limit(1)
  return row[0]?.id
}

/** Insert or update relations on (from, to, type); nothing is deleted. */
export async function upsertRelations(
  db: Database,
  rels: SeedRelation[],
  idByKey: Map<string, string>,
  opts: UpsertOptions = {}
): Promise<number> {
  const log = opts.log ?? (() => {})
  const rows: (typeof entryRelations.$inferInsert)[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  for (const r of rels) {
    const fromId = await resolveRef(db, r.from, idByKey)
    const toId = await resolveRef(db, r.to, idByKey)
    if (!fromId || !toId) {
      problems.push(`relation ${refKey(r.from)} → ${refKey(r.to)}: unknown entry`)
      continue
    }
    const k = `${fromId}|${toId}|${r.type}`
    if (seen.has(k) || fromId === toId) continue
    seen.add(k)
    rows.push({ fromEntryId: fromId, toEntryId: toId, type: r.type, confidence: r.confidence ?? "likely", note: r.note })
  }
  if (problems.length) throw new Error(`relation problems:\n  ${problems.slice(0, 20).join("\n  ")}${problems.length > 20 ? `\n  … ${problems.length - 20} more` : ""}`)
  for (const batch of chunk(rows, opts.batchSize ?? 200)) {
    await db
      .insert(entryRelations)
      .values(batch)
      .onConflictDoUpdate({
        target: [entryRelations.fromEntryId, entryRelations.toEntryId, entryRelations.type],
        set: { confidence: sql`excluded.confidence`, note: sql`coalesce(excluded.note, ${entryRelations.note})` },
      })
  }
  log(`relations: ${rows.length}`)
  return rows.length
}

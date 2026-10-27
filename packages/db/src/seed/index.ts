/**
 * Idempotent seed: re-running updates existing rows (matched on language +
 * kind + headword + homonym) and rewrites their senses, components and
 * outgoing relations. Entries you add by hand that are not in the seed files
 * are left untouched.
 */
import { inArray, sql } from "drizzle-orm"

import { closeDatabase, openDatabase, type Database } from "../client"
import { buildSearchKey } from "../normalize"
import {
  entries,
  entryComponents,
  entryRelations,
  languages,
  senses,
  sources,
  type NewEntry,
} from "../schema"
import { akkadian } from "./data/akkadian"
import { greek } from "./data/greek"
import { hebrew } from "./data/hebrew"
import { relations as crossRelations } from "./data/relations"
import { sumerian } from "./data/sumerian"
import type { EntryRef, SeedComponent, SeedDataset, SeedEntry } from "./types"

const datasets: SeedDataset[] = [sumerian, akkadian, greek, hebrew]

const nfc = (s: string | undefined) => (s === undefined ? undefined : s.normalize("NFC"))

function entryKey(r: { lang: string; kind: string; headword: string; homonym: number }) {
  return `${r.lang}|${r.kind}|${r.headword.normalize("NFC")}|${r.homonym}`
}

function parseComponent(lang: string, c: SeedComponent) {
  const spec = typeof c === "string" ? { ref: c } : c
  let kind: "word" | "part" = "word"
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

function refKey(r: EntryRef) {
  return entryKey({ lang: r.lang, kind: r.kind ?? "word", headword: r.headword, homonym: r.homonym ?? 1 })
}

function chunk<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function validate(ds: SeedDataset) {
  const seen = new Set<string>()
  for (const e of ds.entries) {
    const key = entryKey({ lang: ds.language.id, kind: e.kind, headword: e.headword, homonym: e.homonym ?? 1 })
    if (seen.has(key)) throw new Error(`duplicate seed entry: ${key}`)
    seen.add(key)
    if (e.kind === "part" && !e.partKind) throw new Error(`part without partKind: ${key}`)
  }
}

async function seed(db: Database) {
  const idByKey = new Map<string, string>()

  for (const ds of datasets) {
    validate(ds)
    const lang = ds.language.id

    await db
      .insert(languages)
      .values(ds.language)
      .onConflictDoUpdate({ target: languages.id, set: { ...ds.language } })
    await db
      .insert(sources)
      .values(ds.source)
      .onConflictDoUpdate({ target: sources.id, set: { ...ds.source } })

    const rows: NewEntry[] = ds.entries.map((e: SeedEntry) => ({
      languageId: lang,
      kind: e.kind,
      partKind: e.kind === "part" ? e.partKind : null,
      headword: e.headword.normalize("NFC"),
      homonymIndex: e.homonym ?? 1,
      nativeScript: nfc(e.native) ?? null,
      transliteration: e.translit ?? null,
      searchKey: buildSearchKey([e.headword, e.translit, e.native]),
      partOfSpeech: e.pos ?? null,
      gloss: e.gloss,
      definition: e.definition ?? null,
      etymology: e.etymology ?? null,
      notes: e.notes ?? null,
      sourceId: ds.source.id,
      sourceRef: e.ref ?? null,
    }))

    for (const batch of chunk(rows)) {
      const inserted = await db
        .insert(entries)
        .values(batch)
        .onConflictDoUpdate({
          target: [entries.languageId, entries.kind, entries.headword, entries.homonymIndex],
          set: {
            partKind: sql`excluded.part_kind`,
            nativeScript: sql`excluded.native_script`,
            transliteration: sql`excluded.transliteration`,
            searchKey: sql`excluded.search_key`,
            partOfSpeech: sql`excluded.part_of_speech`,
            gloss: sql`excluded.gloss`,
            definition: sql`excluded.definition`,
            etymology: sql`excluded.etymology`,
            notes: sql`excluded.notes`,
            sourceId: sql`excluded.source_id`,
            sourceRef: sql`excluded.source_ref`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          id: entries.id,
          kind: entries.kind,
          headword: entries.headword,
          homonymIndex: entries.homonymIndex,
        })
      for (const r of inserted) {
        idByKey.set(entryKey({ lang, kind: r.kind, headword: r.headword, homonym: r.homonymIndex }), r.id)
      }
    }
    console.log(`[seed] ${ds.language.name.padEnd(14)} ${rows.length} entries`)
  }

  const seededIds = [...idByKey.values()]

  // Rewrite senses, components and outgoing relations for everything we seeded.
  for (const ids of chunk(seededIds, 500)) {
    await db.delete(senses).where(inArray(senses.entryId, ids))
    await db.delete(entryComponents).where(inArray(entryComponents.entryId, ids))
    await db.delete(entryRelations).where(inArray(entryRelations.fromEntryId, ids))
  }

  const senseRows: (typeof senses.$inferInsert)[] = []
  const componentRows: (typeof entryComponents.$inferInsert)[] = []
  const relationRows: (typeof entryRelations.$inferInsert)[] = []
  const problems: string[] = []

  for (const ds of datasets) {
    const lang = ds.language.id
    for (const e of ds.entries) {
      const key = entryKey({ lang, kind: e.kind, headword: e.headword, homonym: e.homonym ?? 1 })
      const entryId = idByKey.get(key)!

      e.senses?.forEach((s, i) => {
        const sense = typeof s === "string" ? { gloss: s } : s
        senseRows.push({ entryId, sortOrder: i, ...sense })
      })

      e.parts?.forEach((c, i) => {
        const parsed = parseComponent(lang, c)
        const componentId = idByKey.get(parsed.key)
        if (!componentId) {
          problems.push(`${key}: unknown component ${parsed.key}`)
          return
        }
        componentRows.push({ entryId, componentId, position: i, role: parsed.role, note: parsed.note })
      })
    }
  }

  for (const r of crossRelations) {
    const fromId = idByKey.get(refKey(r.from))
    const toId = idByKey.get(refKey(r.to))
    if (!fromId || !toId) {
      problems.push(`relation ${refKey(r.from)} → ${refKey(r.to)}: unknown entry`)
      continue
    }
    relationRows.push({ fromEntryId: fromId, toEntryId: toId, type: r.type, confidence: r.confidence ?? "likely", note: r.note })
  }

  if (problems.length) {
    throw new Error(`seed data problems:\n  ${problems.join("\n  ")}`)
  }

  for (const batch of chunk(senseRows)) await db.insert(senses).values(batch)
  for (const batch of chunk(componentRows)) await db.insert(entryComponents).values(batch)
  for (const batch of chunk(relationRows)) await db.insert(entryRelations).values(batch)

  console.log(
    `[seed] done: ${seededIds.length} entries, ${senseRows.length} senses, ${componentRows.length} components, ${relationRows.length} relations`
  )
}

async function main() {
  const handle = openDatabase()
  console.log(`[seed] driver=${handle.driver}  target=${handle.info.target}`)
  await seed(handle.db as unknown as Database)
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())

/**
 * Write a flat sign inventory (hieroglyphs, alphabets, syllabaries) into
 * `signs` + `sign_readings` for one script. Re-runnable: signs upsert on
 * (script, name), readings of every written sign are replaced, and with
 * `prune` signs of the source that the inventory no longer has are deleted.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import {
  normalizeForSearch,
  signReadings,
  signs,
  upsertScripts,
  upsertSource,
  type Database,
  type NewSign,
  type NewSignReading,
  type NewSource,
  type ScriptId,
} from "@workspace/db"

export type SignReadingInput = { value: string; language?: string | null; uncertain?: boolean }

export type SignInput = {
  name: string
  unicode: string | null
  codepoints?: string[]
  unicodeName?: string
  unicodeVersion?: string
  aliases?: string[]
  listNumbers?: Record<string, string[]>
  description?: string
  category?: string
  sortOrder?: number
  notes?: string
  sourceRef?: string
  readings?: SignReadingInput[]
}

export async function writeSignInventory(
  db: Database,
  opts: { scriptId: ScriptId; source: NewSource; signs: SignInput[]; log: (m: string) => void; prune?: boolean }
) {
  const { scriptId, source, log } = opts
  await upsertScripts(db, [scriptId])
  await upsertSource(db, source)

  const seen = new Set<string>()
  const list = opts.signs.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
  const idByName = new Map<string, string>()
  for (let i = 0; i < list.length; i += 300) {
    const batch = list.slice(i, i + 300)
    const rows: NewSign[] = batch.map((s) => ({
      scriptId,
      name: s.name,
      unicode: s.unicode,
      codepoints: s.codepoints?.length ? s.codepoints : null,
      unicodeName: s.unicodeName ?? null,
      unicodeVersion: s.unicodeVersion ?? null,
      isForm: false,
      aliases: s.aliases?.length ? s.aliases : null,
      listNumbers: s.listNumbers && Object.keys(s.listNumbers).length ? s.listNumbers : null,
      description: s.description ?? null,
      category: s.category ?? null,
      sortOrder: s.sortOrder ?? null,
      notes: s.notes ?? null,
      sourceId: source.id,
      sourceRef: s.sourceRef ?? null,
    }))
    const written = await db
      .insert(signs)
      .values(rows)
      .onConflictDoUpdate({
        target: [signs.scriptId, signs.name],
        set: {
          unicode: sql`excluded.unicode`,
          codepoints: sql`excluded.codepoints`,
          unicodeName: sql`excluded.unicode_name`,
          unicodeVersion: sql`excluded.unicode_version`,
          aliases: sql`excluded.aliases`,
          listNumbers: sql`excluded.list_numbers`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          sortOrder: sql`excluded.sort_order`,
          notes: sql`excluded.notes`,
          sourceId: sql`excluded.source_id`,
          sourceRef: sql`excluded.source_ref`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: signs.id, name: signs.name })
    for (const r of written) idByName.set(r.name, r.id)
  }

  const ids = [...idByName.values()]
  for (let i = 0; i < ids.length; i += 500) {
    await db.delete(signReadings).where(inArray(signReadings.signId, ids.slice(i, i + 500)))
  }
  const readings: NewSignReading[] = []
  for (const s of list) {
    const signId = idByName.get(s.name)
    if (!signId) continue
    const values = new Set<string>()
    for (const [i, r] of (s.readings ?? []).entries()) {
      const value = r.value.trim()
      if (!value || values.has(value)) continue
      values.add(value)
      readings.push({
        signId,
        value,
        language: r.language ?? null,
        searchKey: normalizeForSearch(value),
        isUncertain: r.uncertain ?? false,
        sortOrder: i,
      })
    }
  }
  for (let i = 0; i < readings.length; i += 500) {
    await db.insert(signReadings).values(readings.slice(i, i + 500))
  }

  let pruned = 0
  if (opts.prune && list.length) {
    const gone = await db
      .delete(signs)
      .where(and(eq(signs.scriptId, scriptId), eq(signs.sourceId, String(source.id)), notInArray(signs.name, list.map((s) => s.name))))
      .returning({ id: signs.id })
    pruned = gone.length
  }
  log(`${scriptId}: ${list.length} signs, ${readings.length} readings${pruned ? `, ${pruned} pruned` : ""}`)
}

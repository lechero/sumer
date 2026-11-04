/**
 * Oracc Sign List (OSL, CC0): every cuneiform sign with Unicode, sign-list
 * numbers and readings → `signs` + `sign_readings`.
 * Source: https://github.com/oracc/osl (00lib/osl.asl)
 */
import { eq, inArray, sql } from "drizzle-orm"
import { signReadings, signs, normalizeForSearch, upsertSource, type Database, type NewSign, type NewSignReading } from "@workspace/db"

import { download, readCached } from "../lib/cache"
import type { Importer } from "../registry"

export const OSL_URL = "https://raw.githubusercontent.com/oracc/osl/master/00lib/osl.asl"

export const oslSource = {
  id: "osl",
  title: "Oracc Sign List (OSL)",
  url: "https://oracc.org/osl/",
  license: "CC0 1.0 (public domain)",
  citation: "Oracc Sign List, ed. Steve Tinney et al., https://github.com/oracc/osl",
}

type Reading = { value: string; language: string | null; uncertain: boolean; deprecated: boolean }
export type ParsedSign = {
  name: string
  oid?: string
  unicode?: string
  codepoints: string[]
  unicodeName?: string
  unicodeVersion?: string
  isForm: boolean
  parent?: string
  aliases: string[]
  lists: Record<string, string[]>
  links: { label: string; url: string }[]
  notes: string[]
  readings: Reading[]
  deprecated: boolean
}

const LIST_RE = /^([A-Z]+)(\S+)$/

export function parseAsl(text: string): ParsedSign[] {
  const out: ParsedSign[] = []
  let sign: ParsedSign | null = null
  let form: ParsedSign | null = null
  const current = () => form ?? sign

  const newSign = (name: string, isForm: boolean, deprecated: boolean): ParsedSign => ({
    name: name.trim(),
    codepoints: [],
    isForm,
    aliases: [],
    lists: {},
    links: [],
    notes: [],
    readings: [],
    deprecated,
  })

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (!line.startsWith("@")) continue
    const sp = line.search(/\s/)
    const key = sp === -1 ? line : line.slice(0, sp)
    const rest = sp === -1 ? "" : line.slice(sp + 1).trim()

    if (key === "@sign" || key === "@sign-") {
      sign = newSign(rest, false, key === "@sign-")
      form = null
      continue
    }
    if (key === "@end" && rest === "sign") {
      if (sign && !sign.deprecated) out.push(sign)
      sign = null
      form = null
      continue
    }
    if (!sign) continue
    if (key === "@form" || key === "@form-" || key === "@form+") {
      form = newSign(rest, true, key === "@form-")
      form.parent = sign.name
      continue
    }
    if (key === "@@") {
      if (form && !form.deprecated) out.push(form)
      form = null
      continue
    }
    const s = current()!
    switch (key) {
      case "@oid":
        s.oid = rest
        break
      case "@list": {
        if (rest.startsWith("U+")) {
          s.codepoints.push(rest)
        } else {
          const m = rest.match(LIST_RE)
          if (m) (s.lists[m[1]!] ??= []).push(m[2]!)
        }
        break
      }
      case "@uname":
        s.unicodeName = rest
        break
      case "@ucun":
        s.unicode = rest
        break
      case "@uage":
        s.unicodeVersion = rest
        break
      case "@aka":
        s.aliases.push(rest)
        break
      case "@link": {
        const parts = rest.split(/\s+/)
        const url = parts.pop() ?? ""
        s.links.push({ label: parts.join(" "), url })
        break
      }
      case "@note":
      case "@inote":
        s.notes.push(rest)
        break
      case "@v":
      case "@v-": {
        let value = rest
        let language: string | null = null
        const lm = value.match(/^%([a-z]+)(?:\/\w+)?\s+(.+)$/)
        if (lm) {
          language = lm[1]!
          value = lm[2]!
        }
        // drop trailing commentary after the value
        value = value.split(/\s+/)[0] ?? value
        const uncertain = value.endsWith("?")
        if (uncertain) value = value.slice(0, -1)
        if (value) s.readings.push({ value, language, uncertain, deprecated: key === "@v-" })
        break
      }
      default:
        break
    }
  }
  return out
}

export const oslImporter: Importer = {
  id: "osl",
  language: "sux",
  description: "Oracc Sign List → cuneiform signs with Unicode, sign-list numbers and readings",
  async run({ db, log, limit, offline }) {
    const file = await download("osl", "osl.asl", OSL_URL, { offline, log })
    const parsed = parseAsl(await readCached(file))
    const list = limit ? parsed.slice(0, limit) : parsed
    log(`parsed ${parsed.length} signs/forms (${parsed.filter((s) => !s.isForm).length} base signs)`)

    await upsertSource(db, oslSource)
    const idByName = new Map<string, string>()

    const toRow = (s: ParsedSign): NewSign => ({
      name: s.name,
      oid: s.oid ?? null,
      unicode: s.unicode ?? (s.codepoints[0] ? String.fromCodePoint(parseInt(s.codepoints[0].slice(2), 16)) : null),
      codepoints: s.codepoints.length ? s.codepoints : null,
      unicodeName: s.unicodeName ?? null,
      unicodeVersion: s.unicodeVersion ?? null,
      isForm: s.isForm,
      aliases: s.aliases.length ? s.aliases : null,
      listNumbers: Object.keys(s.lists).length ? s.lists : null,
      links: s.links.length ? s.links : null,
      notes: s.notes.length ? s.notes.join("\n") : null,
      sourceId: oslSource.id,
      sourceRef: s.oid ?? null,
    })

    // Pass 1: base signs, pass 2: forms (need parent ids). A form can share its name with a sign of its own
    // (`@form U` under BUR₃@v, `@sign U`); the sign wins, so dedupe with base signs first, then keep the first form.
    const seen = new Set<string>()
    const ordered = [...list.filter((s) => !s.isForm), ...list.filter((s) => s.isForm)]
    const unique = ordered.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
    const bases = unique.filter((s) => !s.isForm)
    const forms = unique.filter((s) => s.isForm)

    const writeSigns = async (rows: ParsedSign[], parentOf?: (s: ParsedSign) => string | null) => {
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200)
        const inserted = await db
          .insert(signs)
          .values(batch.map((s) => ({ ...toRow(s), parentId: parentOf ? parentOf(s) : null })))
          .onConflictDoUpdate({
            target: signs.name,
            set: {
              oid: sql`excluded.oid`,
              unicode: sql`excluded.unicode`,
              codepoints: sql`excluded.codepoints`,
              unicodeName: sql`excluded.unicode_name`,
              unicodeVersion: sql`excluded.unicode_version`,
              isForm: sql`excluded.is_form`,
              parentId: sql`excluded.parent_id`,
              aliases: sql`excluded.aliases`,
              listNumbers: sql`excluded.list_numbers`,
              links: sql`excluded.links`,
              notes: sql`excluded.notes`,
              sourceId: sql`excluded.source_id`,
              sourceRef: sql`excluded.source_ref`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: signs.id, name: signs.name })
        for (const r of inserted) idByName.set(r.name, r.id)
      }
    }
    await writeSigns(bases)
    await writeSigns(forms, (s) => (s.parent ? (idByName.get(s.parent) ?? null) : null))
    log(`signs: ${bases.length} base + ${forms.length} forms`)

    // Readings: rewrite for every sign we touched.
    const ids = [...idByName.values()]
    for (let i = 0; i < ids.length; i += 500) {
      await db.delete(signReadings).where(inArray(signReadings.signId, ids.slice(i, i + 500)))
    }
    const readingRows: NewSignReading[] = []
    for (const s of unique) {
      const signId = idByName.get(s.name)
      if (!signId) continue
      const seenValues = new Set<string>()
      s.readings.forEach((r, i) => {
        const key = `${r.value}|${r.language ?? ""}`
        if (seenValues.has(key)) return
        seenValues.add(key)
        readingRows.push({
          signId,
          value: r.language ? `${r.value}` : r.value,
          language: r.language,
          searchKey: normalizeForSearch(r.value),
          isUncertain: r.uncertain,
          isDeprecated: r.deprecated,
          sortOrder: i,
        })
      })
    }
    // (signId, value) must be unique: a value can appear for two languages → keep the first.
    const dedup = new Map<string, NewSignReading>()
    for (const r of readingRows) {
      const k = `${r.signId}|${r.value}`
      if (!dedup.has(k)) dedup.set(k, r)
    }
    const finalRows = [...dedup.values()]
    for (let i = 0; i < finalRows.length; i += 500) {
      await db.insert(signReadings).values(finalRows.slice(i, i + 500))
    }
    log(`readings: ${finalRows.length}`)

    const [count] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(signs).where(eq(signs.sourceId, oslSource.id))
    log(`done — ${count?.n ?? 0} signs in the database`)
  },
}

/**
 * ePSD2 — electronic Pennsylvania Sumerian Dictionary (Oracc, CC BY-SA 3.0).
 * Reads the glossary JSON (`epsd2/gloss-sux.json`, 1.9 GB) out of the Oracc
 * JSON zip: https://oracc.museum.upenn.edu/json/epsd2.zip (213 MB).
 *
 * Headwords are ePSD2 citation forms (lugal, e, lu, egal); the most frequent
 * written base form becomes the transliteration (e₂, lu₂-gal) and is rendered
 * in cuneiform through the sign list. Compounds are linked to their members,
 * Akkadian equivalents to the eBL dictionary.
 */
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { unzipSync } from "fflate"
import {
  upsertDataset,
  upsertRelations,
  type PartOfSpeech,
  type SeedComponent,
  type SeedDataset,
  type SeedEntry,
  type SeedRelation,
} from "@workspace/db"

import { cachePath, download } from "../lib/cache"
import { loadReadingMap, renderCuneiform, type ReadingMap } from "../lib/cuneiform"
import { iterateJsonArray } from "../lib/json-stream"
import { truncate, uniq } from "../lib/text"
import type { Importer } from "../registry"

export const EPSD2_ZIP_URL = "https://oracc.museum.upenn.edu/json/epsd2.zip"

export const epsd2Source = {
  id: "epsd2",
  title: "ePSD2 — electronic Pennsylvania Sumerian Dictionary (Oracc)",
  url: "http://oracc.museum.upenn.edu/epsd2/",
  license: "CC BY-SA 3.0",
  citation: "Sjöberg, Tinney et al., ePSD2, Oracc, University of Pennsylvania Museum.",
}

export const sumerianLanguage = {
  id: "sux",
  name: "Sumerian",
  nativeName: "𒅴𒂠 (eme-gir₁₅)",
  script: "Xsux",
  scriptName: "Sumero-Akkadian cuneiform",
  direction: "ltr" as const,
  family: "Language isolate",
  period: "c. 3100 BCE – c. 1800 BCE as a spoken language; literary and liturgical use until c. 100 CE",
  description:
    "The language of ancient Sumer (southern Mesopotamia), the earliest written language we can read. Agglutinative, ergative, and unrelated to any known language family.",
  sortOrder: 10,
}

type Counted = { n: string; icount?: string; ipct?: string }
type Epsd2Entry = {
  headword: string // "lugal[king]N"
  id: string
  oid: string
  cf: string
  gw?: string
  pos: string
  icount?: string
  senses?: { mng?: string; num?: string; pos?: string; icount?: string }[]
  forms?: Counted[]
  bases?: Counted[]
  periods?: { p?: string; icount?: string }[]
  equivs?: unknown
  compound?: string | boolean
  "see-compounds"?: { xcpd: string; eref: string }[]
  alias?: unknown
  bib?: unknown
}

const POS: Record<string, PartOfSpeech> = {
  N: "noun",
  "V/t": "verb",
  "V/i": "verb",
  V: "verb",
  AJ: "adjective",
  AV: "adverb",
  MA: "adverb",
  NU: "numeral",
  PRP: "preposition",
  CNJ: "conjunction",
  IP: "pronoun",
  DP: "pronoun",
  RP: "pronoun",
  QP: "pronoun",
  XP: "pronoun",
  PP: "pronoun",
  J: "interjection",
  MOD: "particle",
  DET: "determiner",
}
const ENTITY: Record<string, string> = {
  DN: "divine name",
  PN: "personal name",
  RN: "royal name",
  GN: "geographical name",
  TN: "temple name",
  SN: "settlement name",
  WN: "watercourse name",
  MN: "month name",
  ON: "object name",
  CN: "celestial name",
  EN: "ethnic name",
  FN: "field name",
  QN: "quarter name",
  LN: "line name",
  AN: "agricultural name",
  YN: "year name",
}

function count(c: Counted | { icount?: string } | undefined): number {
  return Number(c?.icount ?? 0) || 0
}

/** Strip Oracc form annotations: "lugal{mušen}" keeps the determinative, "a\eL" drops the parse flag, "lu₂-gal-ŋu₁₀" stays. */
function cleanForm(n: string): string {
  return n.replace(/\\.*$/, "").replace(/%[a-z]+:/g, "").replace(/[+]/g, "-")
}

function akkadianEquivalents(eq: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (!v) return
    if (Array.isArray(v)) return v.forEach(walk)
    if (typeof v === "object") {
      const o = v as Record<string, unknown>
      const lang = typeof o.lang === "string" ? o.lang : ""
      const n = typeof o.equiv === "string" ? o.equiv : typeof o.n === "string" ? o.n : typeof o.cf === "string" ? o.cf : ""
      if (n && (!lang || lang.startsWith("akk"))) out.push(n)
      for (const k of ["equivs", "equiv", "items", "equivalents"]) if (o[k]) walk(o[k])
    }
  }
  walk(eq)
  return uniq(out.map((n) => n.replace(/\[.*$/, "").replace(/\(([^)]*)\)/g, "$1").trim()).filter(Boolean))
}

export function convertEpsd2(e: Epsd2Entry, readings: ReadingMap): SeedEntry | null {
  const cf = (e.cf ?? "").normalize("NFC").trim()
  if (!cf) return null
  const rawGw = (e.gw ?? "").trim()
  // names carry a disambiguating number instead of a guide word ("Enlil[1]")
  const gw = /^\d+$/.test(rawGw) ? "" : rawGw
  const pos = e.pos ?? ""
  const entity = ENTITY[pos]
  const partOfSpeech: PartOfSpeech | undefined = entity ? "proper_noun" : POS[pos]

  const bases = [...(e.bases ?? [])].sort((a, b) => count(b) - count(a))
  const forms = [...(e.forms ?? [])].sort((a, b) => count(b) - count(a))
  const topBase = bases[0] ? cleanForm(bases[0].n) : undefined
  const topForm = forms[0] ? cleanForm(forms[0].n) : undefined
  const translit = topBase && topBase !== cf ? topBase : topBase ?? topForm

  let native: string | undefined
  for (const candidate of uniq([topBase, ...bases.slice(1, 4).map((b) => cleanForm(b.n)), topForm].filter((x): x is string => !!x))) {
    const g = renderCuneiform(candidate, readings)
    if (g) {
      native = g
      break
    }
  }

  const senses = (e.senses ?? [])
    // names number their senses inside the meaning ("1, mythical king of Sippar")
    .map((s) => ({ gloss: (s.mng ?? "").trim().replace(/^\d+,\s*/, ""), num: s.num ?? "", n: count(s) }))
    .filter((s) => s.gloss && !/^\d+$/.test(s.gloss))
  const gloss = gw || senses[0]?.gloss || (entity ? `${entity}: ${cf}` : cf)

  const periods = (e.periods ?? [])
    .map((p) => ({ p: p.p ?? "", n: count(p) }))
    .filter((p) => p.p && p.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
  const attestations = Number(e.icount ?? 0) || 0
  const notes: string[] = []
  if (entity) notes.push(`${entity[0]!.toUpperCase()}${entity.slice(1)}.`)
  if (attestations) notes.push(`Attested ${attestations.toLocaleString("en")} times in the Oracc corpora.`)
  if (periods.length) notes.push(`Periods: ${periods.map((p) => `${p.p} (${p.n.toLocaleString("en")})`).join(", ")}.`)
  const spellings = uniq(bases.slice(0, 6).map((b) => cleanForm(b.n))).filter((b) => b !== translit)
  if (spellings.length) notes.push(`Other spellings: ${spellings.join(", ")}.`)
  const akk = akkadianEquivalents(e.equivs)
  if (akk.length) notes.push(`Akkadian equivalents: ${akk.join(", ")}.`)

  return {
    kind: "word",
    headword: cf,
    translit: translit && translit !== cf ? translit : undefined,
    native,
    pos: partOfSpeech,
    gloss: truncate(gloss, 120),
    frequency: attestations || undefined,
    notes: notes.join(" ") || undefined,
    ref: `${cf}[${rawGw}]`,
    senses: senses.slice(0, 15).map((s) => ({ gloss: truncate(s.gloss, 160), domain: s.num ? `sense ${s.num}` : undefined })),
  }
}

async function glossaryFile(opts: { offline: boolean; log: (m: string) => void }): Promise<string> {
  const json = cachePath("epsd2", "gloss-sux.json")
  if (existsSync(json)) {
    opts.log("cached  epsd2/gloss-sux.json")
    return json
  }
  const zip = await download("epsd2", "epsd2.zip", EPSD2_ZIP_URL, opts)
  opts.log("unzipping epsd2/gloss-sux.json (1.9 GB, this takes a moment)")
  const files = unzipSync(new Uint8Array(await readFile(zip)), { filter: (f) => f.name.endsWith("gloss-sux.json") })
  const data = files["epsd2/gloss-sux.json"] ?? Object.values(files)[0]
  if (!data) throw new Error("gloss-sux.json not found in epsd2.zip")
  await writeFile(json, data)
  return json
}

export const epsd2Importer: Importer = {
  id: "epsd2",
  language: "sux",
  description: "ePSD2 Sumerian dictionary (Oracc, ~16k lemmas) with cuneiform, senses, compounds and Akkadian equivalents",
  async run({ db, log, limit, offline, prune }) {
    const startedAt = new Date()
    const file = await glossaryFile({ offline, log })
    const readings = await loadReadingMap(db)
    log(`${readings.size} sign readings available for rendering (run the osl import first if 0)`)

    const entries: SeedEntry[] = []
    const refOf = new Map<string, string>() // oid → our ref
    const cfOf = new Map<string, string>() // oid → cf
    const compoundMembers = new Map<string, { eref: string; member: string }[]>() // compound oid → members
    const akkEquivs: { ref: string; akk: string[] }[] = []
    const seenRefs = new Set<string>()
    let read = 0
    let rendered = 0

    for await (const raw of iterateJsonArray<Epsd2Entry>(file, "entries")) {
      read++
      if (limit && entries.length >= limit) break
      const entry = convertEpsd2(raw, readings)
      if (!entry) continue
      // cf[gw] is almost unique; disambiguate the rare duplicates with the POS
      if (seenRefs.has(entry.ref!)) entry.ref = `${entry.ref}${raw.pos}`
      if (seenRefs.has(entry.ref!)) continue
      seenRefs.add(entry.ref!)
      refOf.set(raw.oid, entry.ref!)
      cfOf.set(raw.oid, entry.headword)
      if (entry.native) rendered++
      entries.push(entry)
      for (const c of raw["see-compounds"] ?? []) {
        if (!compoundMembers.has(c.eref)) compoundMembers.set(c.eref, [])
        compoundMembers.get(c.eref)!.push({ eref: raw.oid, member: raw.cf })
      }
      const akk = akkadianEquivalents(raw.equivs)
      if (akk.length) akkEquivs.push({ ref: entry.ref!, akk })
      if (read % 2000 === 0) log(`  read ${read} lemmas…`)
    }
    log(`read ${read} lemmas → ${entries.length} entries, ${rendered} rendered in cuneiform`)

    // Compound membership: "a aŋ[command]" is built from a[arm] + aŋ[measure] — referenced by stable ref.
    const entryByRef = new Map(entries.map((e) => [e.ref!, e]))
    let linked = 0
    for (const [compoundOid, members] of compoundMembers) {
      const ref = refOf.get(compoundOid)
      const compound = ref ? entryByRef.get(ref) : undefined
      if (!compound) continue
      const tokens = compound.headword.split(/\s+/)
      const parts: SeedComponent[] = []
      for (const m of members) {
        const memberRef = refOf.get(m.eref)
        if (!memberRef || memberRef === ref) continue
        const position = tokens.indexOf(m.member)
        parts.push({ ref: `ref:${memberRef}`, role: position === tokens.length - 1 && tokens.length > 1 ? "verb / head" : "element" })
      }
      if (parts.length) {
        compound.parts = parts
        linked += parts.length
      }
    }
    log(`compounds: ${compoundMembers.size} with ${linked} member links`)

    const dataset: SeedDataset = { language: sumerianLanguage, source: epsd2Source, entries }
    const result = await upsertDataset(db, dataset, { log, keepExisting: true, batchSize: 250 })
    if (prune && !limit) {
      const stale = await db
        .delete(entriesTable)
        .where(and(eq(entriesTable.sourceId, epsd2Source.id), eq(entriesTable.kind, "word"), lt(entriesTable.updatedAt, startedAt)))
        .returning({ id: entriesTable.id })
      log(`pruned ${stale.length} stale entries`)
    }

    // Akkadian equivalents → equivalent_of relations into the eBL / seed Akkadian entries (when present).
    const relations: SeedRelation[] = []
    for (const { ref, akk } of akkEquivs) {
      const e = entryByRef.get(ref)
      if (!e) continue
      const assigned = result.keyOfRef.get(ref)
      const homonym = assigned ? Number(assigned.split("|")[3]) : 1
      for (const a of akk.slice(0, 4)) {
        const target = await resolveAkk(db, a)
        if (!target) continue
        relations.push({
          from: { lang: "sux", headword: e.headword, homonym },
          to: { lang: "akk", headword: target.headword, homonym: target.homonym },
          type: "equivalent_of",
          confidence: "certain",
          note: "ePSD2 Akkadian equivalent",
        })
      }
    }
    log(`Akkadian equivalents: ${akkEquivs.length} lemmas with equivalents, ${relations.length} resolved`)
    await db.delete(entryRelations).where(eq(entryRelations.note, "ePSD2 Akkadian equivalent"))
    await upsertRelations(db, relations, result.idByKey, { log })
  },
}

import { and, asc, eq, lt, sql } from "drizzle-orm"
import { entries as entriesTable, entryRelations, normalizeForSearch, type Database } from "@workspace/db"

const akkCache = new Map<string, { id: string; headword: string; homonym: number } | null>()
/** Find the eBL / seed Akkadian entry for an ePSD2 equivalent, tolerant of ḫ/h, mimation and homonym numbering. */
async function resolveAkk(db: Database, equiv: string) {
  if (akkCache.has(equiv)) return akkCache.get(equiv)!
  const lemma = equiv.replace(/\(m\)$/, "").normalize("NFC")
  const select = { id: entriesTable.id, headword: entriesTable.headword, homonym: entriesTable.homonymIndex }
  const exact = await db
    .select(select)
    .from(entriesTable)
    .where(and(eq(entriesTable.languageId, "akk"), eq(entriesTable.kind, "word"), eq(entriesTable.headword, lemma)))
    .orderBy(asc(entriesTable.homonymIndex))
    .limit(1)
  let hit = exact[0] ?? null
  if (!hit) {
    // ePSD2 writes ḫ as h and drops length marks; fall back to a loose key, but never across š/s, ṣ/s, ṭ/t
    const loose = normalizeForSearch(lemma)
    const rows = await db
      .select(select)
      .from(entriesTable)
      .where(and(eq(entriesTable.languageId, "akk"), eq(entriesTable.kind, "word"), sql`split_part(${entriesTable.searchKey}, ' ', 1) = ${loose}`))
      .orderBy(asc(entriesTable.homonymIndex))
    const strip = (x: string) => x.normalize("NFD").replace(/[\u0304\u0302\u032e\u02be\u02bf]/g, "").normalize("NFC").toLowerCase()
    hit = rows.find((r) => strip(r.headword) === strip(lemma)) ?? null
  }
  akkCache.set(equiv, hit)
  return hit
}

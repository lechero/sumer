/**
 * electronic Babylonian Library (eBL) dictionary — the Akkadian lexicon
 * derived from the Concise Dictionary of Akkadian (CDA) plus Oracc / eBL
 * additions. One request returns the whole dictionary (~22k words).
 *   https://www.ebl.lmu.de/api/words?query=*
 */
import {
  upsertDataset,
  upsertRelations,
  type PartOfSpeech,
  type SeedDataset,
  type SeedEntry,
  type SeedRelation,
} from "@workspace/db"

import { download, readCached } from "../lib/cache"
import { loadReadingMap, renderCuneiform, type ReadingMap } from "../lib/cuneiform"
import { romanToInt, stripMarkdown, truncate, uniq } from "../lib/text"
import type { Importer } from "../registry"

export const EBL_WORDS_URL = "https://www.ebl.lmu.de/api/words?query=*"

export const eblSource = {
  id: "ebl",
  title: "electronic Babylonian Library — Akkadian dictionary (CDA-based)",
  url: "https://www.ebl.lmu.de/dictionary",
  license: "eBL: see https://www.ebl.lmu.de/about (CDA © Harrassowitz; eBL data CC BY-NC-SA 4.0 — verify before redistribution)",
  citation: "Jiménez, E. et al., electronic Babylonian Library, LMU Munich. Dictionary based on Black, George & Postgate, A Concise Dictionary of Akkadian (2000).",
}

export const akkadianLanguage = {
  id: "akk",
  name: "Akkadian",
  nativeName: "𒀝𒅗𒁺𒌑 (akkadû)",
  script: "Xsux",
  scriptName: "Sumero-Akkadian cuneiform",
  direction: "ltr" as const,
  family: "Afro-Asiatic › Semitic › East Semitic",
  period: "c. 2500 BCE – 100 CE (Old Akkadian, Babylonian, Assyrian dialects)",
  description:
    "The Semitic lingua franca of Mesopotamia. It borrowed hundreds of Sumerian words and passed several of them on to Hebrew, Aramaic and Greek.",
  sortOrder: 20,
}

type EblWord = {
  _id: string
  lemma: string[]
  homonym: string
  legacyLemma?: string
  attested?: boolean
  forms?: { lemma: string[]; notes?: string[]; attested?: boolean }[]
  meaning?: string
  amplifiedMeanings?: { meaning?: string; key?: string; entries?: { meaning?: string }[] }[]
  logograms?: { logogram?: string[]; notes?: string[] }[]
  derived?: { lemma: string[]; homonym: string; notes?: string[] }[][]
  derivedFrom?: { lemma: string[]; homonym: string } | null
  source?: string
  pos?: string[]
  guideWord?: string
  oraccWords?: { lemma: string; guideWord: string }[]
  origin?: string[]
  namedEntityTags?: string[]
}

const POS: Record<string, PartOfSpeech> = {
  V: "verb",
  N: "noun",
  AJ: "adjective",
  AV: "adverb",
  PRP: "preposition",
  CNJ: "conjunction",
  SBJ: "conjunction",
  IP: "pronoun",
  DP: "pronoun",
  RP: "pronoun",
  REL: "pronoun",
  XP: "pronoun",
  PP: "pronoun",
  QP: "pronoun",
  DET: "determiner",
  J: "interjection",
  MOD: "particle",
  NU: "numeral",
}

const ENTITY: Record<string, string> = {
  PN: "personal name",
  RN: "royal name",
  DN: "divine name",
  GN: "geographical name",
  SN: "settlement name",
  WN: "watercourse name",
  TN: "temple name",
  MN: "month name",
  CN: "celestial name",
  EN: "ethnic name",
  FN: "field name",
  ON: "object name",
  QN: "quarter name",
  YN: "year name",
  AN: "agricultural name",
  LN: "line name",
}

function homonymOf(w: EblWord): number {
  return romanToInt(w.homonym) ?? 1
}

function keyOf(lemma: string, homonym: string): string {
  return `${lemma}|${romanToInt(homonym) ?? 1}`
}

export function convertEbl(words: EblWord[], readings: ReadingMap): { dataset: SeedDataset; relations: SeedRelation[] } {
  const entries: SeedEntry[] = []
  const relations: SeedRelation[] = []
  const seen = new Map<string, number>() // lemma|homonym → count (guards against duplicates in the dump)
  const known = new Set<string>()
  for (const w of words) known.add(keyOf(w.lemma[0] ?? w._id, w.homonym))

  for (const w of words) {
    const lemma = (w.lemma[0] ?? w._id.replace(/ [IVXL]+$/, "")).normalize("NFC")
    if (!lemma) continue
    const k = keyOf(lemma, w.homonym)
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    if (n > 1) continue

    const tags = w.namedEntityTags ?? []
    const entity = tags.map((t) => ENTITY[t]).find(Boolean)
    const pos: PartOfSpeech | undefined = entity ? "proper_noun" : (w.pos ?? []).map((p) => POS[p]).find(Boolean)
    const meaning = stripMarkdown(w.meaning ?? "")
    const guide = (w.guideWord ?? "").trim()
    const gloss = guide || (meaning ? truncate(meaning, 80) : entity ? `${entity}: ${lemma}` : lemma)

    const senses: { gloss: string; definition?: string }[] = []
    for (const am of w.amplifiedMeanings ?? []) {
      const head = stripMarkdown(am.meaning ?? "")
      for (const e of am.entries ?? []) {
        const m = stripMarkdown(e.meaning ?? "")
        if (m) senses.push({ gloss: truncate(m, 160), definition: head ? `${head}: ${m}` : undefined })
      }
      if (!am.entries?.length && head) senses.push({ gloss: truncate(head, 160) })
    }

    const logograms = uniq((w.logograms ?? []).flatMap((l) => l.logogram ?? [])).filter(Boolean)
    let native: string | undefined
    for (const lg of logograms) {
      if (/^\d+$/.test(lg)) continue
      const glyph = renderCuneiform(lg, readings)
      if (glyph) {
        native = glyph
        break
      }
    }

    const forms = uniq((w.forms ?? []).flatMap((f) => f.lemma))
    const noteParts: string[] = []
    if (logograms.length) noteParts.push(`Logograms: ${logograms.join(", ")}.`)
    if (forms.length) noteParts.push(`Forms: ${forms.join(", ")}.`)
    if (tags.length) noteParts.push(`Named entity: ${tags.map((t) => ENTITY[t] ?? t).join(", ")}.`)
    if (w.origin?.length) noteParts.push(`Origin: ${w.origin.join(", ")}.`)
    if (w.attested === false) noteParts.push("Not attested in eBL corpora.")

    const entry: SeedEntry = {
      kind: "word",
      headword: lemma,
      homonym: homonymOf(w),
      pos,
      gloss,
      definition: meaning && meaning !== gloss ? truncate(meaning, 1500) : undefined,
      native,
      notes: noteParts.join(" ") || undefined,
      ref: w._id,
      senses: senses.slice(0, 20),
    }
    entries.push(entry)

    if (w.derivedFrom?.lemma?.[0]) {
      const target = w.derivedFrom.lemma[0].normalize("NFC")
      if (known.has(keyOf(target, w.derivedFrom.homonym))) {
        relations.push({
          from: { lang: "akk", headword: lemma, homonym: homonymOf(w) },
          to: { lang: "akk", headword: target, homonym: romanToInt(w.derivedFrom.homonym) ?? 1 },
          type: "derived_from",
          confidence: "certain",
        })
      }
    }
  }

  return {
    dataset: { language: akkadianLanguage, source: eblSource, entries },
    relations,
  }
}

export const eblImporter: Importer = {
  id: "ebl",
  language: "akk",
  description: "eBL Akkadian dictionary (CDA-based, ~22k words) with logograms rendered in cuneiform",
  async run({ db, log, limit, offline, prune }) {
    const file = await download("ebl", "words.json", EBL_WORDS_URL, { offline, log })
    const words = JSON.parse(await readCached(file)) as EblWord[]
    log(`loaded ${words.length} words`)
    const readings = await loadReadingMap(db)
    log(`${readings.size} sign readings available for rendering logograms (run the osl import first if 0)`)
    const { dataset, relations } = convertEbl(limit ? words.slice(0, limit) : words, readings)
    const withGlyph = dataset.entries.filter((e) => e.native).length
    log(`converted ${dataset.entries.length} entries, ${withGlyph} with cuneiform logograms`)
    const result = await upsertDataset(db, dataset, { log, prune, batchSize: 250 })
    const applicable = relations.filter((r) => result.idByKey.has(`akk|word|${r.to.headword}|${r.to.homonym ?? 1}`))
    await upsertRelations(db, applicable, result.idByKey, { log })
  },
}

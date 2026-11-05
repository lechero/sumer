/**
 * Digital Pāḷi Dictionary (DPD, Bodhirasa Bhikkhu et al.), from the TSV
 * backup of its database in the dpd-db repository (`db/backup_tsv`: the
 * headwords table in three parts, the roots table), pinned to a release tag.
 *   https://github.com/digitalpalidictionary/dpd-db/tree/<tag>/db/backup_tsv
 * Licence CC BY-NC-SA 4.0: redistribution is allowed for non-commercial use
 * only, with attribution and under the same licence.
 *
 * Conventions (shared with the Wiktionary Pali entries, so the two match):
 *   - headword = DPD's lemma without its number, in Latin script with ṃ
 *     (dhamma, nibbāna); proper nouns are capitalised (Sāvatthī, Buddha);
 *     prefixes "abhi-", suffixes "-ana", roots without √ (gam, dhar).
 *   - DPD numbers every meaning (dhamma 1.01 … 1.15, sutta 1.1 / 2.1 / 3.1):
 *     the rows of one lemma that share part of speech, root and construction
 *     are one entry (one etymology) and each row is a sense; a different
 *     root, construction or part of speech is another homonym, numbered in
 *     DPD's order.
 *   - Roots come from DPD's roots table (√gam, √dhar 1, …) as word parts
 *     (partKind root), with the Sanskrit root and the Pāli dhātupāṭhas in
 *     notes. DPD's own "root" rows (gamu "(gram) √gam") are words.
 *   - gloss = DPD's meanings, joined while they fit 120 characters; every
 *     row is a sense. Construction, root, Sanskrit and cognates are the
 *     etymology; DPD lemma numbers, compound type, variants and sources the
 *     notes. ref = DPD's lemma_1 of the entry's first row ("dhamma 1.01").
 *   - Relations: derived_from its root and the word DPD derives it from;
 *     synonym_of / antonym_of / variant_of between DPD entries; cognate_of
 *     the Sanskrit (Monier-Williams) word or root when that is one entry.
 *     Compounds are built from (components) the members of DPD's compound
 *     construction when every member is one DPD entry.
 */
import { and, eq } from "drizzle-orm"
import {
  entries,
  upsertDataset,
  type Confidence,
  type Database,
  type PartKind,
  type PartOfSpeech,
  type RelationType,
  type SeedComponent,
  type SeedDataset,
  type SeedEntry,
  type SeedSense,
} from "@workspace/db"

import { download, readCached } from "../lib/cache"
import { pruneRelations, writeRelations, type RelationRow } from "../lib/links"
import { iastToDevanagari } from "../lib/sanskrit"
import { truncate, uniq } from "../lib/text"
import type { Importer } from "../registry"
import { WIKTIONARY_LANGUAGES } from "./wiktionary"

const TAG = "v0.4.20261026"
const BASE = `https://raw.githubusercontent.com/digitalpalidictionary/dpd-db/${TAG}/db/backup_tsv`
const HEADWORD_FILES = ["dpd_headwords_part_001.tsv", "dpd_headwords_part_002.tsv", "dpd_headwords_part_003.tsv"]
const ROOTS_FILE = "dpd_roots_part_001.tsv"
const NOTE = "DPD"

export const paliLanguage = WIKTIONARY_LANGUAGES.find((l) => l.language.id === "pli")!.language

export const dpdSource = {
  id: "dpd",
  title: "Digital Pāḷi Dictionary (DPD)",
  url: `https://github.com/digitalpalidictionary/dpd-db/tree/${TAG}/db/backup_tsv`,
  license: "CC BY-NC-SA 4.0 (non-commercial use only, attribution, share-alike)",
  citation: `Bodhirasa Bhikkhu et al., Digital Pāḷi Dictionary, release ${TAG}, https://www.dpdict.net/, doi:10.5281/zenodo.22979413.`,
}

/* ── TSV ──────────────────────────────────────────────────────────────────── */

/** Tab-separated values with "…" quoting ("" inside), quoted fields may span lines. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = text.length
  while (i < n) {
    if (quoted) {
      const j = text.indexOf('"', i)
      if (j < 0) {
        field += text.slice(i)
        break
      }
      field += text.slice(i, j)
      if (text.charCodeAt(j + 1) === 34) {
        field += '"'
        i = j + 2
      } else {
        quoted = false
        i = j + 1
      }
      continue
    }
    const c = text.charCodeAt(i)
    if (c === 34 && field === "") {
      quoted = true
      i++
    } else if (c === 9) {
      row.push(field)
      field = ""
      i++
    } else if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i++
    } else {
      let j = i
      while (j < n) {
        const d = text.charCodeAt(j)
        if (d === 9 || d === 10 || d === 13) break
        j++
      }
      field += text.slice(i, j)
      i = j
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function records(text: string): Record<string, string>[] {
  const [header, ...rows] = parseTsv(text)
  if (!header) return []
  return rows
    .filter((r) => r.length > 1)
    .map((r) => {
      const o: Record<string, string> = {}
      header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()))
      return o
    })
}

/* ── rows → entries ───────────────────────────────────────────────────────── */

export type DpdRow = Record<string, string>
export type DpdRoot = Record<string, string>

const POS: Record<string, PartOfSpeech> = {
  masc: "noun",
  fem: "noun",
  nt: "noun",
  adj: "adjective",
  pp: "adjective",
  prp: "adjective",
  ptp: "adjective",
  pr: "verb",
  aor: "verb",
  fut: "verb",
  opt: "verb",
  imp: "verb",
  cond: "verb",
  perf: "verb",
  imperf: "verb",
  abs: "verb",
  ger: "verb",
  inf: "verb",
  pron: "pronoun",
  card: "numeral",
  ordin: "numeral",
  root: "noun", // grammarians' names of roots: gamu "(gram) √gam"
  cs: "noun", // conjugational signs, verbal endings, letters: grammatical terms
  ve: "noun",
  letter: "noun",
}

/** DPD's grammar abbreviations, for the sense definitions. */
const GRAMMAR: Record<string, string> = {
  masc: "masculine",
  fem: "feminine",
  nt: "neuter",
  adj: "adjective",
  pp: "past participle",
  prp: "present participle",
  ptp: "potential participle",
  pr: "present",
  aor: "aorist",
  fut: "future",
  opt: "optative",
  imp: "imperative",
  cond: "conditional",
  perf: "perfect",
  imperf: "imperfect",
  abs: "absolutive",
  ger: "gerund",
  inf: "infinitive",
  ind: "indeclinable",
  adv: "adverb",
  pron: "pronoun",
  card: "cardinal",
  ordin: "ordinal",
  pl: "plural",
  sg: "singular",
  caus: "causative",
  pass: "passive",
  deno: "denominative",
  desid: "desiderative",
  intens: "intensive",
  trans: "transitive",
  intrans: "intransitive",
  ditrans: "ditransitive",
  excl: "exclamation",
  emph: "emphatic",
  interr: "interrogative",
  onom: "onomatopoeia",
  prep: "preposition",
  conj: "conjunction",
  cs: "conjugational sign",
  ve: "verbal ending",
  neg: "negative",
}

function posOf(r: DpdRow): { kind: "word"; pos: PartOfSpeech } | { kind: "part"; partKind: PartKind } {
  if (r.pos === "prefix") return { kind: "part", partKind: "prefix" }
  if (r.pos === "suffix") return { kind: "part", partKind: "suffix" }
  if (r.pos === "ind") {
    const g = r.grammar ?? ""
    if (/\bconj\b/.test(g)) return { kind: "word", pos: "conjunction" }
    if (/\b(?:excl|interj|onom)\b/.test(g)) return { kind: "word", pos: "interjection" }
    if (/\bprep\b/.test(g)) return { kind: "word", pos: "preposition" }
    if (/\badv\b/.test(g)) return { kind: "word", pos: "adverb" }
    return { kind: "word", pos: "particle" }
  }
  return { kind: "word", pos: POS[r.pos ?? ""] ?? "other" }
}

const LEMMA_NUMBER = / (\d+)(?:\.(\d+))?$/
const cleanLemma = (lemma: string) => lemma.replace(LEMMA_NUMBER, "").normalize("NFC")
/** "dhamma 1.03" → [1, 3]; "bhikkhu" → [0, 0] */
function lemmaNumber(lemma: string): [number, number] {
  const m = lemma.match(LEMMA_NUMBER)
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0]
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
const meaningOf = (r: DpdRow) => stripTags(r.meaning_1 || r.meaning_2 || "")
const list = (s: string | undefined) =>
  uniq(
    stripTags(s ?? "")
      .split(/\s*[,;]\s*/)
      .map((x) => x.trim().normalize("NFC"))
      .filter((x) => x && x !== "-")
  )
const firstLine = (s: string | undefined) => stripTags((s ?? "").split("\n")[0] ?? "")

/** Sum of DPD's Chaṭṭha Saṅgāyana frequency table (ranking only). */
function frequency(r: DpdRow): number | undefined {
  if (!r.freq_data) return undefined
  try {
    const data = JSON.parse(r.freq_data) as { CstFreq?: number[] }
    const n = (data.CstFreq ?? []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
    return n || undefined
  } catch {
    return undefined
  }
}

function grammarText(g: string): string {
  return g
    .replace(/\b(?:in )?comps?\b/g, "in compounds")
    .split(/,\s*/)
    .map((t) => (t === "in compounds" ? t : t.replace(/\b[a-z]+\b/g, (w) => GRAMMAR[w] ?? w)))
    .join(", ")
}

export type DpdGroup = {
  key: string
  clean: string
  rows: DpdRow[]
  kind: "word" | "part"
  pos?: PartOfSpeech
  partKind?: PartKind
  headword: string
  homonym?: number
  ref: string
  seed?: SeedEntry
}

export type DpdRootEntry = { root: DpdRoot; headword: string; homonym?: number; ref: string; seed?: SeedEntry }

export type DpdRel = {
  from: { seed?: SeedEntry }
  to: { seed?: SeedEntry }
  type: RelationType
  confidence: Confidence
  note: string
}

/** Rows of one lemma with the same part of speech, root and construction are one entry. */
export function groupRows(rows: DpdRow[]): DpdGroup[] {
  const groups = new Map<string, DpdGroup>()
  const sorted = [...rows].sort((a, b) => {
    const ca = cleanLemma(a.lemma_1!)
    const cb = cleanLemma(b.lemma_1!)
    if (ca !== cb) return ca < cb ? -1 : 1
    const [a1, a2] = lemmaNumber(a.lemma_1!)
    const [b1, b2] = lemmaNumber(b.lemma_1!)
    return a1 - b1 || a2 - b2
  })
  for (const r of sorted) {
    const clean = cleanLemma(r.lemma_1!)
    const p = posOf(r)
    const etym = r.root_key || firstLine(r.construction) ? `${r.root_key}|${firstLine(r.construction)}` : `#${lemmaNumber(r.lemma_1!)[0]}`
    const key = `${clean}|${p.kind === "word" ? p.pos : p.partKind}|${etym}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        clean,
        rows: [],
        kind: p.kind,
        pos: p.kind === "word" ? p.pos : undefined,
        partKind: p.kind === "part" ? p.partKind : undefined,
        headword: clean,
        ref: r.lemma_1!,
      }
      groups.set(key, g)
    }
    g.rows.push(r)
  }
  return [...groups.values()]
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "name of …" in every row, or a meaning that is the capitalised lemma ("Buddha; Awakened One"). */
function isProperNoun(g: DpdGroup): boolean {
  if (g.pos !== "noun") return false
  const meanings = g.rows.map(meaningOf)
  if (meanings.every((m) => /^name of\b/i.test(m))) return true
  const first = meanings[0]?.split(/[;,]/)[0]?.trim()
  return first === capitalise(g.clean) && g.clean.length > 1
}

/** DPD meanings joined while they fit (≤ 120 with an ellipsis). */
function joinedGloss(meanings: string[]): string {
  const terms: string[] = []
  let out = ""
  for (const m of uniq(meanings.filter(Boolean))) {
    const fresh = m.split(/;\s*/).filter((t) => t && !terms.includes(t))
    if (!fresh.length) continue
    const next = out ? `${out}; ${fresh.join("; ")}` : fresh.join("; ")
    if (out && next.length > 118) break
    out = next
    terms.push(...fresh)
    if (out.length > 118) break
  }
  return truncate(out, 118)
}

function senseOf(r: DpdRow): SeedSense | undefined {
  const m = meaningOf(r)
  if (!m) return undefined
  const def: string[] = []
  if (r.grammar) def.push(grammarText(r.grammar))
  if (r.neg) def.push(r.neg === "neg x2" ? "double negative" : "negative")
  if (r.verb) def.push(grammarText(r.verb))
  if (r.trans && r.trans !== "-") def.push(grammarText(r.trans))
  if (r.plus_case) def.push(`with ${r.plus_case.replace(/\+/g, "").replace(/\s*&\s*/g, " or ")}`)
  if (r.meaning_lit) def.push(`literally ‘${stripTags(r.meaning_lit)}’`)
  if (!r.meaning_1 && r.meaning_2) def.push("meaning not yet reviewed by DPD")
  return { gloss: truncate(m, 200), definition: def.length ? truncate(def.join("; "), 600) : undefined }
}

function etymologyOf(r: DpdRow, roots: Map<string, DpdRootEntry>): string | undefined {
  const parts: string[] = []
  const construction = stripTags((r.construction ?? "").replace(/\n/g, "; "))
  if (construction) parts.push(construction)
  if (r.root_key) {
    const root = roots.get(r.root_key)?.root
    const meaning = root?.root_meaning ? ` ‘${root.root_meaning}’` : ""
    const sign = r.root_sign ? `, conjugation sign ${r.root_sign}` : ""
    const base = r.root_base ? `, base ${stripTags(r.root_base)}` : ""
    parts.push(`Root ${r.root_key}${meaning}${sign}${base}`)
  }
  if (r.derivative || r.suffix) parts.push(`${r.derivative ? `${r.derivative} derivative` : "Derivative"}${r.suffix ? ` with suffix ${r.suffix}` : ""}`)
  if (r.phonetic) parts.push(`Sound change: ${stripTags(r.phonetic.replace(/\n/g, "; "))}`)
  if (r.sanskrit) parts.push(`Sanskrit ${stripTags(r.sanskrit)}`)
  if (r.non_ia) parts.push(`Non-Indo-Aryan: ${stripTags(r.non_ia)}`)
  if (r.cognate) parts.push(`English cognate: ${stripTags(r.cognate)}`)
  if (!parts.length) return undefined
  return truncate(parts.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(" "), 1500)
}

function notesOf(g: DpdGroup): string {
  const notes: string[] = []
  const numbers = g.rows.map((r) => r.lemma_1!.match(LEMMA_NUMBER)?.[0]?.trim()).filter(Boolean)
  notes.push(`DPD: ${g.clean}${numbers.length ? ` ${numbers.join(", ")}` : ""} (id ${g.rows.map((r) => r.id).join(", ")}).`)
  const r = g.rows[0]!
  if (r.compound_type && r.compound_type !== "-") {
    notes.push(`Compound: ${stripTags(r.compound_type)}${r.compound_construction ? ` (${firstLine(r.compound_construction)})` : ""}.`)
  }
  const phonetic = uniq(g.rows.flatMap((x) => list(x.var_phonetic)))
  const textual = uniq(g.rows.flatMap((x) => list(x.var_text)))
  if (phonetic.length) notes.push(`Phonetic variants: ${phonetic.join(", ")}.`)
  if (textual.length) notes.push(`Textual variants: ${textual.join(", ")}.`)
  const sources = uniq(
    g.rows.flatMap((x) =>
      [
        [x.source_1, x.sutta_1],
        [x.source_2, x.sutta_2],
      ]
        .filter(([s]) => s && s !== "-")
        .map(([s, t]) => `${stripTags(s!)}${t ? ` (${stripTags(t)})` : ""}`)
    )
  )
  if (sources.length) notes.push(`Examples in: ${sources.slice(0, 8).join("; ")}${sources.length > 8 ? " …" : ""}.`)
  const extra = uniq(g.rows.map((x) => stripTags(x.notes ?? "")).filter((x) => x && x !== "-"))
  if (extra.length) notes.push(truncate(extra.join(" "), 600))
  const links = uniq(g.rows.flatMap((x) => (x.link ?? "").split(/\s+/)).filter((x) => /^https?:\/\//.test(x)))
  if (links.length) notes.push(`See ${links.join(", ")}.`)
  return notes.join(" ")
}

function rootNotes(r: DpdRoot): string {
  const has = (v: string | undefined) => !!v && v !== "-"
  const notes: string[] = [`DPD root ${r.root}${has(r.root_group) ? `, conjugation group ${r.root_group}` : ""}${has(r.root_sign) ? ` (sign ${r.root_sign})` : ""}.`]
  if (has(r.sanskrit_root)) {
    notes.push(
      `Sanskrit ${r.sanskrit_root}${has(r.sanskrit_root_class) ? ` (class ${r.sanskrit_root_class})` : ""}${has(r.sanskrit_root_meaning) ? ` ‘${r.sanskrit_root_meaning}’` : ""}.`
    )
  }
  const dhatu = (label: string, ...fields: (string | undefined)[]) => {
    const [num, root, pali, english] = fields
    if (!has(root) && !has(pali)) return
    notes.push(`${label}${has(num) ? ` ${num}` : ""}: ${[root, pali].filter(has).join(" ")}${has(english) ? ` ‘${english}’` : ""}.`)
  }
  dhatu("Dhātupāṭha", r.dhatupatha_num, r.dhatupatha_root, r.dhatupatha_pali, r.dhatupatha_english)
  dhatu("Dhātumañjūsā", r.dhatumanjusa_num, r.dhatumanjusa_root, r.dhatumanjusa_pali, r.dhatumanjusa_english)
  dhatu("Saddanīti Dhātumālā", undefined, r.dhatumala_root, r.dhatumala_pali, r.dhatumala_english)
  dhatu("Pāṇini", undefined, r.panini_root, r.panini_sanskrit, r.panini_english)
  if (has(r.note)) notes.push(stripTags(r.note!))
  return notes.join(" ")
}

export function convertDpd(rows: DpdRow[], rootRows: DpdRoot[]) {
  // 1. roots: "√har 1" → part "har" (homonyms numbered in DPD's order)
  const roots = new Map<string, DpdRootEntry>()
  const sortedRoots = [...rootRows].filter((r) => r.root).sort((a, b) => {
    const ca = a.root!.replace(/ \d+$/, "")
    const cb = b.root!.replace(/ \d+$/, "")
    return ca !== cb ? (ca < cb ? -1 : 1) : Number(a.root!.match(/ (\d+)$/)?.[1] ?? 0) - Number(b.root!.match(/ (\d+)$/)?.[1] ?? 0)
  })
  for (const r of sortedRoots) {
    const headword = r.root!.replace(/^√/, "").replace(/ \d+$/, "").normalize("NFC")
    roots.set(r.root!, { root: r, headword, ref: r.root! })
  }

  // 2. words, prefixes, suffixes
  const groups = groupRows(rows)
  for (const g of groups) {
    if (g.kind === "part") g.headword = g.partKind === "prefix" ? `${g.clean}-` : `-${g.clean}`
    else if (isProperNoun(g)) {
      g.pos = "proper_noun"
      g.headword = capitalise(g.clean)
    }
  }

  // 3. homonym indexes per kind and headword, in DPD's order
  const taken = new Map<string, number>()
  const next = (k: string) => {
    const n = (taken.get(k) ?? 0) + 1
    taken.set(k, n)
    return n
  }
  for (const r of roots.values()) r.homonym = next(`part|${r.headword}`)
  for (const g of groups) g.homonym = next(`${g.kind}|${g.headword}`)

  // 4. indexes for relations
  const byClean = new Map<string, DpdGroup[]>()
  for (const g of groups) byClean.set(g.clean, [...(byClean.get(g.clean) ?? []), g])
  const groupOfRow = new Map<DpdRow, DpdGroup>()
  for (const g of groups) for (const r of g.rows) groupOfRow.set(r, g)
  /** The one DPD entry a lemma names, narrowed by root and part of speech when there are several. */
  const resolve = (lemma: string, ctx: { self: DpdGroup; preferPos?: PartOfSpeech }): { g: DpdGroup; unique: boolean } | undefined => {
    const clean = cleanLemma(lemma.replace(/^√/, ""))
    let c = (byClean.get(clean) ?? []).filter((x) => x !== ctx.self && x.kind === "word")
    if (c.length === 1) return { g: c[0]!, unique: true }
    if (c.length === 0) return undefined
    const root = ctx.self.rows[0]!.root_key
    if (root) {
      const same = c.filter((x) => x.rows[0]!.root_key === root)
      if (same.length) c = same
    }
    if (c.length > 1 && ctx.preferPos) {
      const same = c.filter((x) => x.pos === ctx.preferPos)
      if (same.length) c = same
    }
    if (c.length > 1) {
      // DPD's main word for the lemma: the one with the most rows
      const max = Math.max(...c.map((x) => x.rows.length))
      const top = c.filter((x) => x.rows.length === max)
      if (top.length === 1 && max > 1) return { g: top[0]!, unique: false }
      return undefined
    }
    return { g: c[0]!, unique: false }
  }

  // 5. relations
  const rels: DpdRel[] = []
  const seen = new Set<string>()
  const push = (from: DpdGroup | DpdRootEntry, to: DpdGroup | DpdRootEntry, type: RelationType, confidence: Confidence, note: string) => {
    if (from === to) return
    const k = `${from.ref}|${to.ref}|${type}`
    const symmetric = type === "synonym_of" || type === "antonym_of" || type === "variant_of"
    if (seen.has(k) || (symmetric && seen.has(`${to.ref}|${from.ref}|${type}`))) return
    seen.add(k)
    rels.push({ from, to, type, confidence, note })
  }
  for (const g of groups) {
    const r = g.rows[0]!
    const root = r.root_key ? roots.get(r.root_key) : undefined
    if (root) push(g, root, "derived_from", "certain", `${NOTE}: ${r.root_key}`)
    for (const d of uniq(g.rows.map((x) => x.derived_from).filter(Boolean))) {
      const t = resolve(d!, { self: g })
      if (t) push(g, t.g, "derived_from", t.unique ? "certain" : "likely", `${NOTE}: from ${d}`)
    }
    for (const [field, type] of [
      ["synonym", "synonym_of"],
      ["antonym", "antonym_of"],
    ] as const) {
      for (const w of uniq(g.rows.flatMap((x) => list(x[field])))) {
        const t = resolve(w, { self: g, preferPos: g.pos })
        if (t) push(g, t.g, type, t.unique ? "certain" : "likely", NOTE)
      }
    }
    for (const [field, label] of [
      ["var_phonetic", "phonetic variant"],
      ["var_text", "textual variant"],
    ] as const) {
      for (const w of uniq(g.rows.flatMap((x) => list(x[field])))) {
        const t = resolve(w, { self: g, preferPos: g.pos })
        if (t) push(t.g, g, "variant_of", t.unique ? "certain" : "likely", `${NOTE}: ${label}`)
      }
    }
  }

  // 6. seeds
  const seeds: SeedEntry[] = []
  for (const r of roots.values()) {
    const gloss = truncate(stripTags(r.root.root_meaning ?? "") || r.ref, 118)
    r.seed = {
      kind: "part",
      partKind: "root",
      headword: r.headword,
      homonym: r.homonym,
      gloss,
      etymology: r.root.sanskrit_root && r.root.sanskrit_root !== "-" ? `Sanskrit ${r.root.sanskrit_root}.` : undefined,
      notes: rootNotes(r.root),
      ref: r.ref,
      senses: [{ gloss }],
    }
    seeds.push(r.seed)
  }
  for (const g of groups) {
    const senses = g.rows.map(senseOf).filter((s): s is SeedSense => !!s)
    const gloss = joinedGloss(g.rows.map(meaningOf)) || g.clean
    const r = g.rows[0]!
    const parts: SeedComponent[] = []
    const members = firstLine(r.compound_construction)
      .split(/\s*\+\s*/)
      .map((m) => m.trim())
      .filter(Boolean)
    if (members.length > 1) {
      const resolved = members.map((m) => resolve(m, { self: g })?.g)
      if (resolved.every(Boolean)) for (const m of resolved) parts.push({ ref: `ref:${m!.ref}` })
    }
    const freq = Math.max(0, ...g.rows.map((x) => frequency(x) ?? 0))
    const base = {
      headword: g.headword,
      homonym: g.homonym,
      gloss,
      frequency: freq || undefined,
      etymology: etymologyOf(r, roots),
      notes: notesOf(g),
      ref: g.ref,
      senses,
      parts: parts.length ? parts : undefined,
    }
    g.seed = g.kind === "part" ? { kind: "part", partKind: g.partKind!, ...base } : { kind: "word", pos: g.pos, ...base }
    seeds.push(g.seed)
  }
  return { seeds, rels, groups, roots: [...roots.values()], groupOfRow }
}

export async function loadDpd(opts: { offline: boolean; log: (m: string) => void }) {
  const rows: DpdRow[] = []
  for (const f of HEADWORD_FILES) {
    const path = await download("dpd", `${TAG}/${f}`, `${BASE}/${f}`, opts)
    rows.push(...records(await readCached(path)))
  }
  const rootRows = records(await readCached(await download("dpd", `${TAG}/${ROOTS_FILE}`, `${BASE}/${ROOTS_FILE}`, opts)))
  return { rows, rootRows, ...convertDpd(rows, rootRows) }
}

/* ── Sanskrit cognates ────────────────────────────────────────────────────── */

type SanRow = { id: string; kind: "word" | "part"; partKind: PartKind | null; headword: string; pos: PartOfSpeech | null; homonym: number }

/** The Sanskrit term of DPD's "sanskrit" field: "dharma [dhṛ]" → dharma; "akṛta (na + kṛta) [kṛ]" → akṛta. */
export function sanskritTerm(s: string): string | undefined {
  const t = stripTags(s)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .split(/\s*[,;]\s*/)[0]
    ?.trim()
  if (!t || /\s|[+?*]/.test(t) || !/^[a-zāīūṛṝḷṅñṭḍṇśṣṃḥ'-]+$/.test(t)) return undefined
  return t.replace(/-/g, "")
}

async function sanskritCognates(db: Database, groups: DpdGroup[], roots: DpdRootEntry[], idOf: (s?: SeedEntry) => string | undefined): Promise<RelationRow[]> {
  const san: SanRow[] = await db
    .select({
      id: entries.id,
      kind: entries.kind,
      partKind: entries.partKind,
      headword: entries.headword,
      pos: entries.partOfSpeech,
      homonym: entries.homonymIndex,
    })
    .from(entries)
    .where(and(eq(entries.languageId, "san"), eq(entries.sourceId, "monier-williams")))
  const words = new Map<string, SanRow[]>()
  const sanRoots = new Map<string, SanRow[]>()
  for (const r of san) {
    if (r.kind === "word") words.set(r.headword, [...(words.get(r.headword) ?? []), r])
    else if (r.partKind === "root") sanRoots.set(r.headword, [...(sanRoots.get(r.headword) ?? []), r])
  }
  const compatible = (a: PartOfSpeech | undefined, b: PartOfSpeech | null) =>
    a === b || (a === "noun" && b === "proper_noun") || (a === "proper_noun" && b === "noun") || (a === "adjective" && b === "noun")
  const out: RelationRow[] = []
  for (const g of groups) {
    if (g.kind !== "word") continue
    // the Sanskrit form most of the entry's rows give (sutta: sūtra ×3, sūkta ×1)
    const terms = g.rows.map((r) => sanskritTerm(r.sanskrit ?? "")).filter((t): t is string => !!t)
    const count = (t: string) => terms.filter((x) => x === t).length
    const term = [...new Set(terms)].sort((a, b) => count(b) - count(a))[0]
    if (!term) continue
    let c = words.get(iastToDevanagari(term)) ?? []
    // MW's cross-reference stubs ("buddhi. See cols. 2 and 3") are not the word
    const real = c.filter((x) => x.pos !== "other")
    if (real.length) c = real
    if (c.length > 1) c = c.filter((x) => compatible(g.pos, x.pos))
    if (c.length > 1) c = c.filter((x) => x.pos === g.pos)
    const fromEntryId = idOf(g.seed)
    if (c.length === 1 && fromEntryId) out.push({ fromEntryId, toEntryId: c[0]!.id, type: "cognate_of", confidence: "likely", note: `${NOTE}: Sanskrit ${term}` })
  }
  for (const r of roots) {
    const s = r.root.sanskrit_root?.replace(/^√/, "").replace(/\s.*$/, "")
    if (!s || s === "-") continue
    const c = sanRoots.get(iastToDevanagari(s)) ?? []
    const fromEntryId = idOf(r.seed)
    if (c.length === 1 && fromEntryId) out.push({ fromEntryId, toEntryId: c[0]!.id, type: "cognate_of", confidence: "likely", note: `${NOTE}: Sanskrit √${s}` })
  }
  return out
}

/* ── importer ─────────────────────────────────────────────────────────────── */

export const dpdImporter: Importer = {
  id: "dpd",
  language: "pli",
  description: "Digital Pāḷi Dictionary (DPD, CC BY-NC-SA 4.0): ~80k Pali headwords and 750 roots",
  async run({ db, log, limit, offline, prune }) {
    const { rows, rootRows, seeds, rels, groups, roots } = await loadDpd({ offline, log })
    const kept = limit ? seeds.slice(0, limit) : seeds
    const keep = new Set(kept)
    const inSlice = new Set(kept.map((s) => s.ref))
    for (const s of kept) {
      if (s.parts) s.parts = s.parts.filter((p) => typeof p !== "string" && inSlice.has(p.ref.slice(4)))
    }
    log(`DPD ${TAG}: ${rows.length} headword rows, ${rootRows.length} roots → ${seeds.length} entries`)

    const dataset: SeedDataset = { language: paliLanguage, source: dpdSource, entries: kept }
    const result = await upsertDataset(db, dataset, {
      log: (m) => (m.startsWith("  … ") ? undefined : log(m)),
      batchSize: 1000,
      prune: prune && !limit,
    })
    const idOf = (s: SeedEntry | undefined) => {
      const key = s && keep.has(s) && s.ref ? result.keyOfRef.get(s.ref) : undefined
      return key ? result.idByKey.get(key) : undefined
    }

    const out: RelationRow[] = []
    for (const x of rels) {
      const fromEntryId = idOf(x.from.seed)
      const toEntryId = idOf(x.to.seed)
      if (fromEntryId && toEntryId) out.push({ fromEntryId, toEntryId, type: x.type, confidence: x.confidence, note: x.note })
    }
    const cognates = await sanskritCognates(db, groups, roots, idOf)
    if (!cognates.length) log("no Sanskrit cognates resolved (import monier-williams first)")
    const written = await writeRelations(db, [...out, ...cognates], { notePrefix: NOTE })
    log(`relations: ${[...written.byType].map(([t, n]) => `${n} ${t}`).join(", ") || "none"}`)
    if (!limit) {
      const pruned = await pruneRelations(db, [...result.idByKey.values()], written.ids, NOTE)
      if (pruned) log(`pruned ${pruned} stale relations`)
    }
    log(`done — ${kept.length} DPD entries`)
  },
}

/**
 * Thesaurus Linguae Aegyptiae (BBAW) lemma list, January 2018 extract, in
 * Simon D. Schweitzer's TEI edition for the AED – Ancient Egyptian Dictionary
 * (CC BY-SA 4.0): ~35k lemmas with their TLA lemma ids, word class, German and
 * (for about half) English translations, bibliography and lemma relations.
 *   https://github.com/simondschweitzer/aed-tei   (files/dictionary.xml)
 * The same repository's corpus (~14k lemmatised TLA texts, ~790k tokens, each
 * token with its Unicode hieroglyphs, each text with its TLA dating) gives a
 * lemma its most frequent hieroglyphic spelling (→ native), its token count
 * (→ frequency) and the span of the texts that attest it.
 *
 * Headwords follow Wiktionary's Egyptian convention, the TLA lemma form is kept
 * as the transliteration (see `wiktionaryStyle`). `ref` is the TLA lemma id
 * ("83680"), the id the Coptic lexicon's Egyptian etymologies cite. Roots are
 * word parts (partKind root) and every lemma built on one lists it as a
 * component; sub-lemmas and cross-references become relations.
 */
import { and, eq, inArray } from "drizzle-orm"
import {
  entries as entriesTable,
  entryRelations,
  upsertDataset,
  upsertRelations,
  type EntryRef,
  type PartOfSpeech,
  type SeedComponent,
  type SeedDataset,
  type SeedEntry,
  type SeedRelation,
  type SeedSense,
} from "@workspace/db"

import { download } from "../lib/cache"
import { iterateTarGz } from "../lib/tar"
import { truncate, uniq } from "../lib/text"
import { children, clean, forEachElement, text, type XmlNode } from "../lib/xml"
import type { Importer } from "../registry"
import { WIKTIONARY_LANGUAGES } from "./wiktionary"

/** aed-tei master as of 2025-05-18 (dictionary.xml last changed 2021-09-20 in 329391f). */
const COMMIT = "462c722e0323e05641aea2eee8cdf1e27303d939"
const CACHE_DIR = "tla-aed"
const DICT_FILE = `dictionary-${COMMIT.slice(0, 7)}.xml`
const DICT_URL = `https://raw.githubusercontent.com/simondschweitzer/aed-tei/${COMMIT}/files/dictionary.xml`
const CORPUS_FILE = `aed-tei-${COMMIT.slice(0, 7)}.tar.gz`
const CORPUS_URL = `https://github.com/simondschweitzer/aed-tei/archive/${COMMIT}.tar.gz`

export const tlaEgyptianSource = {
  id: "tla-aed",
  title: "Thesaurus Linguae Aegyptiae lemma list (BBAW, January 2018), AED-TEI edition",
  url: "https://github.com/simondschweitzer/aed-tei",
  license: "CC BY-SA 4.0",
  citation:
    "Thesaurus Linguae Aegyptiae, lemma list and text corpus of the BBAW project 'Strukturen und Transformationen des Wortschatzes der ägyptischen Sprache' " +
    "(Teilauszug der Datenbank, January 2018, urn:nbn:de:kobv:b4-opus4-29190); TEI edition by Simon D. Schweitzer, " +
    `AED-TEI – Corpus of Egyptian Texts for the AED (Ancient Egyptian Dictionary), doi:10.5281/zenodo.3580939, commit ${COMMIT.slice(0, 7)}. ` +
    "Glosses are the TLA's English translations where it has one (about half of the lemmas), otherwise its German translation, marked (de); " +
    "hieroglyphs, frequencies and attestation spans are derived from the AED corpus.",
}

const egyptian = WIKTIONARY_LANGUAGES.find((l) => l.language.id === "egy")!.language

/* ── transliteration ──────────────────────────────────────────────────────── */

/**
 * TLA lemma form → Wiktionary's Egyptian convention (lower case, the same Unicode Egyptological letters):
 *   "Mꜣꜥ.t" → mꜣꜥt (no dots before endings)      "nb=f" → nb.f, "=f" → .f, "pꜣy=" → pꜣy (suffix boundary)
 *   "jri̯", "hbu̯" → jrj, hbw (weak radicals)      "jm.j-rʾ" → jmj-r (ʾ dropped)
 *   "ḥwi̯ (mnj.t)" → ḥwj mnjt (phraseme brackets) "H̱nm.w(?)" → ẖnmw (doubt marks)
 * Both conventions write yod as j (not ꞽ or i), and z, q, ẖ alike.
 */
export function wiktionaryStyle(tla: string): string {
  const s = tla
    .normalize("NFC")
    .replace(/\(\?\)|\[\?\]|\?/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+(?==)/g, "")
    .replace(/\.{2,}|…/g, "\uE000") // hold ellipses aside while dots are dropped ("ḫy...ḫy", "1...n")
    .replace(/\./g, "")
    .replace(/\uE000/g, "...")
    .replace(/=(?=[\s-]|$)/g, "")
    .replace(/=/g, ".")
    .replace(/i̯/g, "j")
    .replace(/u̯/g, "w")
    .replace(/ʾ/g, "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
  return s || tla.trim()
}

/* ── the lemma list ───────────────────────────────────────────────────────── */

type Lemma = {
  id: string
  orth: string
  cls: string
  sub: string
  translations: { lang: string; text: string }[]
  bibl: string
  xr: { type: string; target: string }[]
}

function parseLemma(e: XmlNode): Lemma | null {
  const id = (e.attrs["xml:id"] ?? "").replace(/^tla/, "")
  const orth = clean(text(children(e, "form").flatMap((f) => children(f, "orth"))[0])).normalize("NFC")
  if (!id || !orth) return null
  const term = clean(text(children(e, "gramGrp").flatMap((g) => children(g, "term"))[0]))
  const [cls = "", sub = ""] = term.split("/")
  const translations: Lemma["translations"] = []
  const bibl: string[] = []
  for (const s of children(e, "sense")) {
    for (const c of children(s, "cit")) {
      for (const b of children(c, "bibl")) if (clean(text(b))) bibl.push(clean(text(b)))
      if (c.attrs.type !== "translation") continue
      const lang = c.attrs["xml:lang"] ?? "?"
      for (const q of children(c, "quote")) {
        const t = clean(text(q))
        if (t) translations.push({ lang, text: t })
      }
    }
  }
  const xr = children(e, "xr").flatMap((x) =>
    children(x, "ref")
      .map((r) => (r.attrs.target ?? "").replace(/^#?tla/, ""))
      .filter(Boolean)
      .map((target) => ({ type: x.attrs.type ?? "", target }))
  )
  return { id, orth, cls, sub, translations, bibl: uniq(bibl).filter((b) => b !== "-").join("; "), xr }
}

/* ── the corpus: spellings, frequencies, datings ──────────────────────────── */

type Attestation = { tokens: number; texts: number; from?: number; to?: number; spellings: Map<string, number> }

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const HIEROGLYPHS = /^[\u{13000}-\u{1345F}]+$/u

/** Base text: its lemmatised tokens (token id → lemma id) and its dating. */
function parseText(xml: string) {
  const tokens: [string, string][] = []
  for (const m of xml.matchAll(/<w\s[^>]*>/g)) {
    const lemma = attr(m[0], "lemmaRef")?.replace(/^tla:tla/, "")
    const id = attr(m[0], "xml:id")
    if (id && lemma && /^\d+$/.test(lemma)) tokens.push([id, lemma])
  }
  let from: number | undefined
  let to: number | undefined
  for (const m of xml.matchAll(/<date\s[^>]*>/g)) {
    const type = attr(m[0], "type")
    const nb = Number(attr(m[0], "notBefore") ?? NaN)
    const na = Number(attr(m[0], "notAfter") ?? NaN)
    if (type === "earliest" && Number.isFinite(nb)) from = Math.min(from ?? nb, nb)
    if (type === "latest" && Number.isFinite(na)) to = Math.max(to ?? na, na)
  }
  return { tokens, from, to }
}

/** Hieroglyph file: token id → its hieroglyphs, when they are plain Unicode (no gaps, unclear or unencoded signs). */
function parseHieroglyphs(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of xml.matchAll(/<w\s([^>]*)>([\s\S]*?)<\/w>/g)) {
    const id = attr(` ${m[1]}`, "corresp")?.replace(/^src:/, "")
    const glyphs = m[2]!.trim()
    if (id && HIEROGLYPHS.test(glyphs)) out.set(id, glyphs)
  }
  return out
}

async function readCorpus(tarFile: string): Promise<{ texts: number; tokens: number; byLemma: Map<string, Attestation> }> {
  const byLemma = new Map<string, Attestation>()
  const texts = new Map<string, ReturnType<typeof parseText>>()
  const glyphs = new Map<string, Map<string, string>>()
  let textCount = 0
  let tokenCount = 0
  const add = (id: string) => {
    const t = texts.get(id)
    const g = glyphs.get(id)
    if (!t || !g) return
    texts.delete(id)
    glyphs.delete(id)
    textCount++
    const seen = new Set<string>()
    for (const [token, lemma] of t.tokens) {
      tokenCount++
      let a = byLemma.get(lemma)
      if (!a) byLemma.set(lemma, (a = { tokens: 0, texts: 0, spellings: new Map() }))
      a.tokens++
      if (!seen.has(lemma)) {
        seen.add(lemma)
        a.texts++
        if (t.from !== undefined) a.from = Math.min(a.from ?? t.from, t.from)
        if (t.to !== undefined) a.to = Math.max(a.to ?? t.to, t.to)
      }
      const spelling = g.get(token)
      if (spelling) a.spellings.set(spelling, (a.spellings.get(spelling) ?? 0) + 1)
    }
  }
  for await (const f of iterateTarGz(tarFile)) {
    // <ID>.xml is the lemmatised text, <ID>_hiero.xml its hieroglyphs (_st / _wt: translations, not needed)
    const m = f.name.match(/\/files\/([A-Z0-9]{20,})(_hiero)?\.xml$/)
    if (!m) continue
    const xml = f.data.toString("utf8")
    if (m[2]) glyphs.set(m[1]!, parseHieroglyphs(xml))
    else texts.set(m[1]!, parseText(xml))
    add(m[1]!)
  }
  for (const id of [...texts.keys()]) {
    glyphs.set(id, new Map()) // a text without a hieroglyph file still counts
    add(id)
  }
  return { texts: textCount, tokens: tokenCount, byLemma }
}

/** Epochs of the TLA dating thesaurus (files/thesaurus.xml), in years (negative = BCE). */
const EPOCHS: [string, number, number][] = [
  ["Predynastic Period", -5500, -3151],
  ["Early Dynastic Period", -3150, -2724],
  ["Old Kingdom", -2723, -2187],
  ["First Intermediate Period", -2186, -2027],
  ["Middle Kingdom", -2135, -1794],
  ["Second Intermediate Period", -1793, -1551],
  ["New Kingdom", -1550, -1071],
  ["Third Intermediate Period", -1070, -656],
  ["Late Period", -664, -333],
  ["Ptolemaic Period", -332, -30],
  ["Roman Period", -31, 395],
  ["Byzantine Period", 395, 641],
]

/** The epoch a dating starts in (the latest-starting one containing it) or ends in (the earliest-ending one). */
function epoch(year: number, end: boolean): string | undefined {
  const hits = EPOCHS.filter(([, a, b]) => a <= year && year <= b)
  hits.sort((x, y) => (end ? x[2] - y[2] : y[1] - x[1]))
  return hits[0]?.[0]
}

const yearText = (y: number) => (y < 0 ? `${-y} BCE` : `${y} CE`)

/** "Old Kingdom – New Kingdom (text datings c. 2723–1071 BCE)": the earliest and latest bounds of the attesting texts' datings. */
function spanText(from: number, to: number): string {
  const a = epoch(from, false)
  const b = epoch(to, true)
  const years = from < 0 && to < 0 ? `${-from}–${-to} BCE` : `${yearText(from)} – ${yearText(to)}`
  const epochs = a && b ? (a === b ? a : `${a} – ${b}`) : undefined
  return epochs ? `${epochs} (text datings c. ${years})` : `text datings c. ${years}`
}

/* ── conversion ───────────────────────────────────────────────────────────── */

const POS: Record<string, PartOfSpeech> = {
  substantive: "noun",
  verb: "verb",
  adjective: "adjective",
  adverb: "adverb",
  preposition: "preposition",
  particle: "particle",
  pronoun: "pronoun",
  numeral: "numeral",
  interjection: "interjection",
  entity_name: "proper_noun",
  epitheton_title: "noun",
}

const CLASS_EN: Record<string, string> = {
  substantive: "noun",
  verb: "verb",
  adjective: "adjective",
  adverb: "adverb",
  preposition: "preposition",
  particle: "particle",
  pronoun: "pronoun",
  numeral: "numeral",
  interjection: "interjection",
  entity_name: "name",
  epitheton_title: "title or epithet",
  root: "root",
  undefined: "unclassified",
}

const SUBCLASS_EN: Record<string, string> = {
  substantive_masc: "noun, masculine",
  substantive_fem: "noun, feminine",
  verb_irr: "verb, irregular",
  nisbe_adjective_substantive: "nisbe adjective (from a noun)",
  nisbe_adjective_preposition: "nisbe adjective (from a preposition)",
  prepositional_adverb: "prepositional adverb",
  particle_enclitic: "enclitic particle",
  particle_nonenclitic: "non-enclitic particle",
  demonstrative_pronoun: "demonstrative pronoun",
  personal_pronoun: "personal pronoun",
  interrogative_pronoun: "interrogative pronoun",
  relative_pronoun: "relative pronoun",
  cardinal: "cardinal number",
  ordinal: "ordinal number",
  gods_name: "divine name",
  person_name: "personal name",
  place_name: "place name",
  kings_name: "royal name",
  artifact_name: "name of an object or building",
  org_name: "name of an institution or estate",
  animal_name: "name of an animal",
  epith_god: "divine epithet",
  epith_king: "royal epithet",
  title: "title",
}

const NAME_SUBCLASSES = new Set(["gods_name", "person_name", "place_name", "kings_name", "artifact_name", "org_name", "animal_name"])

/** "verb_caus_3-inf" → "verb, caus. 3-inf." (the Egyptological verb classes). */
function classLabel(l: Lemma): string {
  const verb = l.sub.match(/^verb_(caus_)?(\d)-(lit|inf|gem)$/)
  if (verb) return `verb, ${verb[1] ? "caus. " : ""}${verb[2]}-${verb[3]}.`
  const sub = SUBCLASS_EN[l.sub]
  if (sub && l.cls !== "undefined" && l.cls !== "root") return sub
  return CLASS_EN[l.cls] ?? (l.cls || "unclassified")
}

function partOfSpeech(l: Lemma): PartOfSpeech | undefined {
  if (POS[l.cls]) return POS[l.cls]
  if (NAME_SUBCLASSES.has(l.sub)) return "proper_noun"
  if (l.sub.startsWith("substantive")) return "noun"
  return undefined
}

/** Sort rank among homographs: core vocabulary, then titles and epithets, names, unclassified words. */
const rank = (l: Lemma) => (l.cls === "epitheton_title" ? 1 : partOfSpeech(l) === "proper_noun" ? 2 : l.cls === "undefined" || !l.cls ? 3 : 0)

/** Split "Geier; Vogel (allg.)" into its meanings, not inside brackets ("[Suffix Pron.; sg.]"). */
function meanings(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++
    else if ((ch === ")" || ch === "]") && depth) depth--
    if (ch === ";" && !depth) {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out.map((m) => m.trim()).filter(Boolean)
}

const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`)

type Converted = { entry: SeedEntry; lemma: Lemma; hieroglyphs: boolean; english: boolean }

function convert(l: Lemma, att: Attestation | undefined): Converted {
  const en = l.translations.filter((t) => t.lang === "en").map((t) => t.text)
  const de = l.translations.filter((t) => t.lang === "de").map((t) => t.text)
  const other = l.translations.find((t) => t.lang !== "en" && t.lang !== "de")
  const english = en.length > 0
  const [lang, meaning]: [string, string] = english ? ["en", en.join("; ")] : de.length ? ["de", de.join("; ")] : other ? [other.lang, other.text] : ["", ""]
  const mark = (s: string) => (lang && lang !== "en" ? `(${lang}) ${s}` : s)
  const label = classLabel(l)
  const gloss = meaning ? mark(truncate(meaning, 120)) : `[${label}]`
  const senses: SeedSense[] = meanings(meaning)
    .slice(0, 20)
    .map((m) => ({ gloss: mark(truncate(m, 200)) }))

  // hieroglyphs: the commonest plain-Unicode spelling of the lemma in the corpus
  let native: string | undefined
  let spelled = 0
  let best = 0
  for (const [spelling, n] of att?.spellings ?? []) {
    spelled += n
    if (n > best) [native, best] = [spelling, n]
  }

  const notes: string[] = [sentence(`Word class (TLA): ${label}`)]
  if (english && de.length && de.join("; ") !== meaning) notes.push(sentence(`German (TLA): ${de.join("; ")}`))
  if (l.bibl) notes.push(sentence(`Bibliography: ${l.bibl}`))
  if (att) {
    const span = att.from !== undefined && att.to !== undefined ? `, dated ${spanText(att.from, att.to)}` : ""
    notes.push(`AED corpus: ${att.tokens} token${att.tokens === 1 ? "" : "s"} in ${att.texts} text${att.texts === 1 ? "" : "s"}${span}.`)
  }
  if (native) notes.push(`Hieroglyphs: the most frequent spelling in the AED corpus (${best} of ${spelled} tokens with Unicode hieroglyphs).`)
  notes.push(`TLA lemma ${l.id}: https://thesaurus-linguae-aegyptiae.de/lemma/${l.id}`)

  const headword = wiktionaryStyle(l.orth)
  const base = {
    headword,
    native,
    translit: l.orth !== headword ? l.orth : undefined,
    gloss,
    frequency: att?.tokens,
    definition: meaning.length > 120 ? mark(truncate(meaning, 1500)) : undefined,
    notes: notes.join(" "),
    ref: l.id,
    senses,
  }
  const entry: SeedEntry = l.cls === "root" ? { kind: "part", partKind: "root", ...base } : { kind: "word", pos: partOfSpeech(l), ...base }
  return { entry, lemma: l, hieroglyphs: !!native, english }
}

/* ── relations ────────────────────────────────────────────────────────────── */

const NOTE_SUB = "TLA sub-lemma"
const NOTE_XR = "TLA cross-reference"
const NOTE_PRED = "TLA predecessor"
const OWN_NOTES = [NOTE_SUB, NOTE_XR, NOTE_PRED]

/** TLA lemma relations, each recorded on both lemmas: [type, its inverse, our relation (from the first lemma), note]. */
const LINKS: { type: string; inverse: string; relation: SeedRelation["type"] | "component"; confidence: SeedRelation["confidence"]; note?: string }[] = [
  { type: "root", inverse: "rootOf", relation: "component", confidence: "certain" },
  { type: "partOf", inverse: "contains", relation: "derived_from", confidence: "certain", note: NOTE_SUB },
  { type: "referencing", inverse: "referencedBy", relation: "variant_of", confidence: "likely", note: NOTE_XR },
  { type: "predecessor", inverse: "successor", relation: "derived_from", confidence: "certain", note: NOTE_PRED },
]

function keyToRef(key: string): EntryRef {
  const parts = key.split("|")
  return { lang: parts[0]!, kind: parts[1] as EntryRef["kind"], headword: parts.slice(2, -1).join("|"), homonym: Number(parts.at(-1)) }
}

/* ── importer ─────────────────────────────────────────────────────────────── */

export const tlaEgyptianImporter: Importer = {
  id: "tla-egy",
  language: "egy",
  description: "Thesaurus Linguae Aegyptiae lemma list (AED-TEI, ~35k lemmas) with corpus hieroglyphs",
  async run({ db, log, limit, offline, prune }) {
    const [dictFile, corpusFile] = await Promise.all([
      download(CACHE_DIR, DICT_FILE, DICT_URL, { offline, log }),
      download(CACHE_DIR, CORPUS_FILE, CORPUS_URL, { offline, log }),
    ])

    const lemmas: Lemma[] = []
    let placeholders = 0
    const seen = await forEachElement(dictFile, "entry", (node) => {
      const l = parseLemma(node)
      if (!l) return
      // "_" without bibliography: the TLA's stand-ins for unread words of a class ("[Personenname]", "[Verb]"), not
      // lemmas; "_" with one is a word whose reading is unknown ("[9-Faden-Qualität]", Junker, Giza IV) and stays
      if (l.orth === "_" && !l.bibl) placeholders++
      else lemmas.push(l)
    })
    // lemma relations, recorded on both lemmas: collected from both ends and deduplicated
    const ids = new Set(lemmas.map((l) => l.id))
    const components = new Map<string, Set<string>>() // lemma → its roots
    const relations = new Map<string, { from: string; to: string; type: SeedRelation["type"]; confidence: SeedRelation["confidence"]; note: string }>()
    for (const l of lemmas) {
      for (const x of l.xr) {
        const link = LINKS.find((k) => k.type === x.type || k.inverse === x.type)
        if (!link) continue
        const [from, to] = link.type === x.type ? [l.id, x.target] : [x.target, l.id]
        if (from === to || !ids.has(from) || !ids.has(to)) continue
        if (link.relation === "component") {
          if (!components.has(from)) components.set(from, new Set())
          components.get(from)!.add(to)
        } else relations.set(`${from}|${to}|${link.relation}`, { from, to, type: link.relation, confidence: link.confidence, note: link.note! })
      }
    }

    // --limit: the first N lemmas plus the roots they are built on (so their root components survive the run)
    let selected = lemmas
    if (limit) {
      const first = lemmas.slice(0, limit)
      const want = new Set(first.flatMap((l) => [l.id, ...(components.get(l.id) ?? [])]))
      selected = lemmas.filter((l) => want.has(l.id))
    }
    const inDataset = new Set(selected.map((l) => l.id))
    log(`dictionary.xml: ${seen} entries → ${lemmas.length} lemmas (${placeholders} "_" placeholders skipped)${limit ? `, ${selected.length} kept (first ${limit} and their roots)` : ""}`)

    const corpus = await readCorpus(corpusFile)
    log(`corpus: ${corpus.texts} texts, ${corpus.tokens} lemmatised tokens, ${corpus.byLemma.size} lemmas attested`)

    const converted = selected.map((l) => convert(l, corpus.byLemma.get(l.id)))
    for (const [key, r] of relations) if (!inDataset.has(r.from) || !inDataset.has(r.to)) relations.delete(key)
    let componentCount = 0
    for (const c of converted) {
      const roots = components.get(c.lemma.id)
      if (!roots) continue
      c.entry.parts = [...roots].map((r): SeedComponent => ({ ref: `ref:${r}`, role: "root" }))
      componentCount += roots.size
    }

    // homographs are numbered in this order on the first import (refs keep their number afterwards)
    converted.sort(
      (a, b) => rank(a.lemma) - rank(b.lemma) || (b.entry.frequency ?? 0) - (a.entry.frequency ?? 0) || Number(a.lemma.id) - Number(b.lemma.id)
    )
    const parts = converted.filter((c) => c.entry.kind === "part").length
    const withGlyphs = converted.filter((c) => c.hieroglyphs).length
    const withEnglish = converted.filter((c) => c.english).length
    const untranslated = converted.filter((c) => !c.lemma.translations.length).length
    log(
      `${converted.length} entries (${converted.length - parts} words, ${parts} roots); hieroglyphs for ${withGlyphs}; ` +
        `English gloss ${withEnglish} (${((100 * withEnglish) / Math.max(1, converted.length)).toFixed(1)}%), ` +
        `German (or other) ${converted.length - withEnglish - untranslated}, no translation ${untranslated}`
    )

    const dataset: SeedDataset = { language: egyptian, source: tlaEgyptianSource, entries: converted.map((c) => c.entry) }
    const result = await upsertDataset(db, dataset, { log, prune: prune && !limit, batchSize: 250 })

    const refOf = (id: string) => {
      const key = result.keyOfRef.get(id)
      return key ? keyToRef(key) : undefined
    }
    const rels: SeedRelation[] = []
    for (const r of relations.values()) {
      const from = refOf(r.from)
      const to = refOf(r.to)
      if (from && to) rels.push({ from, to, type: r.type, confidence: r.confidence, note: r.note })
    }
    const byNote = OWN_NOTES.map((n) => `${n} ${rels.filter((r) => r.note === n).length}`).join(", ")
    log(`root components: ${componentCount}; relations: ${byNote}`)

    if (!limit) {
      // this importer owns these relations: clear them so links that no longer exist disappear
      const own = db.select({ id: entriesTable.id }).from(entriesTable).where(eq(entriesTable.sourceId, tlaEgyptianSource.id))
      await db.delete(entryRelations).where(and(inArray(entryRelations.note, OWN_NOTES), inArray(entryRelations.fromEntryId, own)))
    }
    await upsertRelations(db, rels, result.idByKey, { log })
    log(`done — ${converted.length} TLA lemmas`)
  },
}

/**
 * Comprehensive Coptic Lexicon v1.2 (2020): the BBAW Lexicon of Coptic Egyptian
 * plus the DDGLC Lexicon of Greek Loanwords in Coptic, as TEI XML published
 * through KELLIA / Coptic Dictionary Online (CC BY-SA 4.0). ~11k entries.
 * Egyptian / Demotic etymologies with Thesaurus Linguae Aegyptiae lemma ids
 * come from the same repository's data/egyptian_etymologies.tab.
 *   https://github.com/KELLIA/dictionary
 *
 * Headword: the Sahidic form when the entry has one, else its lemma form; the
 * other dialect forms go into `notes`. Greek loanwords are linked (loan_from)
 * to the LSJ entry when it resolves unambiguously; Egyptian ancestors
 * (derived_from) to the TLA entry with the cited lemma id (`tla-egy`, run it
 * first); compounds are linked to their components; cross-references become
 * see_also / synonym / antonym.
 */
import { and, eq, inArray, lt } from "drizzle-orm"
import {
  entries as entriesTable,
  entryRelations,
  normalizeForSearch,
  upsertDataset,
  upsertRelations,
  type Database,
  type EntryRef,
  type PartKind,
  type PartOfSpeech,
  type SeedComponent,
  type SeedDataset,
  type SeedEntry,
  type SeedRelation,
  type SeedSense,
} from "@workspace/db"

import { download, readCached } from "../lib/cache"
import { fixCopticLookalikes, transliterateCoptic } from "../lib/coptic"
import { truncate, uniq } from "../lib/text"
import { child, children, clean, descendants, forEachElement, text, type XmlNode } from "../lib/xml"
import type { Importer } from "../registry"
import { tlaEgyptianSource } from "./tla-egyptian"

const RAW = "https://raw.githubusercontent.com/KELLIA/dictionary/master/"
const XML_FILE = "Comprehensive_Coptic_Lexicon-v1.2-2020.xml"
const ETYM_FILE = "egyptian_etymologies.tab"

export const copticSource = {
  id: "coptic-ccl",
  title: "Comprehensive Coptic Lexicon: Including Loanwords from Ancient Greek (BBAW + DDGLC, via KELLIA)",
  url: "https://github.com/KELLIA/dictionary",
  license: "CC BY-SA 4.0",
  citation:
    "Burns, D. M., Feder, F., John, K., Kupreyev, M. et al., Comprehensive Coptic Lexicon: Including Loanwords from Ancient Greek, v1.2 (Berlin 2020), BBAW project 'Strukturen und Transformationen des Wortschatzes der ägyptischen Sprache' and FU Berlin 'Database and Dictionary of Greek Loanwords in Coptic', doi:10.17169/refubium-27566; Egyptian etymologies from the Thesaurus Linguae Aegyptiae via Coptic Dictionary Online (KELLIA / Coptic SCRIPTORIUM).",
}

export const copticLanguage = {
  id: "cop",
  name: "Coptic",
  nativeName: "ⲧⲙⲛ̄ⲧⲣⲙ̄ⲛ̄ⲕⲏⲙⲉ",
  script: "Copt",
  scriptName: "Coptic alphabet",
  direction: "ltr" as const,
  family: "Afro-Asiatic › Egyptian",
  period: "c. 200 – 1300 CE as a spoken language (Sahidic, Bohairic and other dialects); liturgical language of the Coptic Church today",
  description:
    "The last stage of Egyptian, written in a Greek-based alphabet with letters added from Demotic, and full of Greek loanwords from Christian and administrative life.",
  sortOrder: 48,
}

const DIALECTS: Record<string, string> = {
  S: "Sahidic",
  B: "Bohairic",
  A: "Akhmimic",
  L: "Lycopolitan",
  M: "Mesokemic",
  F: "Fayyumic",
  Ak: "Old Coptic",
  P: "Proto-Theban",
  V: "dialect V",
  W: "dialect W",
  "?": "unknown dialect",
}
const DIALECT_ORDER = ["S", "B", "A", "L", "M", "F", "V", "W", "P", "Ak", "?"]

/** German grammar labels of the BBAW lexicon. */
const POS: Record<string, PartOfSpeech> = {
  "Subst.": "noun",
  "Vb.": "verb",
  "Vb. Hilfsverb.": "verb",
  "Adj.": "adjective",
  "Adv.": "adverb",
  "Präp.": "preposition",
  "Konj.": "conjunction",
  Partikel: "particle",
  "Partikel, enklitisch": "particle",
  Zahlwort: "numeral",
  Zahlzeichen: "numeral",
  Interjektion: "interjection",
  "Pron.": "pronoun",
  "Dem. Pron.": "pronoun",
  "Selbst. Pers. Pron.": "pronoun",
  "Interr. Pron.": "pronoun",
  "Poss. Pron.": "pronoun",
  Suffixpronomen: "pronoun",
  "bestimmter Artikel": "determiner",
  Possessivartikel: "determiner",
  "unpersönlicher Ausdruck": "other",
}
/** Bound morphemes become word parts. */
const PART_POS: Record<string, PartKind> = {
  Verbalpräfix: "prefix",
  Nominalpräfix: "prefix",
  Präfix: "prefix",
  Adjektivpräfix: "prefix",
  Possessivpräfix: "prefix",
  "Präfix der Ordinalzahlen": "prefix",
  Satzkonverter: "prefix",
  Suffixpronomen: "suffix",
  "Partikel, enklitisch": "clitic",
}
const PROPER_SUBC = new Set(["Göttername", "Ortsname", "Völkername"])

const SUBC_EN: Record<string, string> = {
  Kompositverb: "compound verb",
  Qualitativ: "stative",
  "Participium conjunctum": "participium conjunctum",
  Göttername: "divine name",
  Ortsname: "place name",
  Völkername: "ethnic name",
  Titel: "title",
  Frageadverb: "interrogative adverb",
  Imperativ: "imperative",
  Infinitiv: "infinitive",
  Indefinitpronomen: "indefinite pronoun",
  Adjektivverb: "adjective verb",
  "Status pronominalis": "pronominal state",
  "Status nominalis": "nominal state",
  Hilfsverb: "auxiliary verb",
  "Name einer Sache oder Institution": "name of a thing or institution",
  Fragepartikel: "interrogative particle",
  Relativkonverter: "relative converter",
  Umstandsatzkonverter: "circumstantial converter",
  Fokalisierungskonverter: "focalising converter",
  Kopula: "copula",
  Fragepronomen: "interrogative pronoun",
  Unpersönlich: "impersonal",
  "1. Pers.": "1st person",
  "2. Pers.": "2nd person",
  "3. Pers.": "3rd person",
}
/** Short labels for the grammar of a single form. */
const FORM_LABEL: Record<string, string> = {
  "pl.": "pl.",
  "sg.": "sg.",
  "Status nominalis": "st. nom.",
  "Status pronominalis": "st. pron.",
  Qualitativ: "stat.",
  Imperativ: "imp.",
  Infinitiv: "inf.",
}

const LOANWORD_EN: [RegExp, string][] = [
  [/^semitisches Lehnwort/i, "Semitic loanword"],
  [/^arabisches Lehnwort/i, "Arabic loanword"],
  [/^persisches Lehnwort/i, "Persian loanword"],
  [/^hebräisches Lehnwort/i, "Hebrew loanword"],
  [/^aramäisches Lehnwort/i, "Aramaic loanword"],
  [/^syriakisches Lehnwort/i, "Syriac loanword"],
  [/^hamitisch-libysches Lehnwort/i, "Hamito-Libyan loanword"],
  [/^Lehnwort/i, "loanword"],
]

const NOTE_LOAN = "DDGLC Greek loanword"
const NOTE_EGY = "TLA Egyptian etymology"
const NOTE_XR: Record<string, { type: SeedRelation["type"]; note: string }> = {
  cf: { type: "see_also", note: "CCL cross-reference" },
  syn: { type: "synonym_of", note: "CCL synonym" },
  ant: { type: "antonym_of", note: "CCL antonym" },
}
const OWN_NOTES = [NOTE_LOAN, NOTE_EGY, ...Object.values(NOTE_XR).map((x) => x.note)]

/* ── parsing ──────────────────────────────────────────────────────────────── */

type Form = { orth: string; dialect?: string; type?: string; labels: string[] }
type Raw = {
  id: string
  entryType?: string
  forms: Form[]
  pos?: string
  subc: string[]
  gender?: string
  grammarNotes: string[]
  senses: { en: string[]; other: { lang: string; text: string }[]; greek: string[]; bibl: string }[]
  greek?: { id?: string; lemma: string; meaning?: string; pos?: string; ref?: string }
  etymNotes: string[]
  etymGreek: string[]
  xrs: { type: string; target: string; label: string }[]
  /** id of the first plain entry of the enclosing superEntry (compounds are built on it). */
  groupHead?: string
}

const isDeprecated = (n: XmlNode) => /#deprecated/.test(n.attrs.change ?? "")
const t = (n: XmlNode | undefined) => clean(text(n))
const cleanOrth = (s: string) => fixCopticLookalikes(clean(s).normalize("NFC"))

function parseEntry(e: XmlNode, groupHead?: string): Raw | null {
  const id = e.attrs["xml:id"]
  if (!id || isDeprecated(e)) return null
  const forms: Form[] = []
  for (const f of children(e, "form")) {
    if (isDeprecated(f)) continue
    const orth = cleanOrth(t(child(f, "orth")))
    if (!orth) continue
    const labels: string[] = []
    for (const g of children(f, "gramGrp")) {
      for (const k of g.children) {
        if (typeof k === "string") continue
        const v = t(k)
        if (FORM_LABEL[v]) labels.push(FORM_LABEL[v]!)
      }
    }
    forms.push({ orth, dialect: t(child(f, "usg")) || undefined, type: f.attrs.type, labels })
  }
  if (!forms.length) return null

  // grammar: the entry's own gramGrp, else the lemma form's
  const grams = children(e, "gramGrp")
  const gram = grams.length ? grams : children(e, "form").flatMap((f) => children(f, "gramGrp")).slice(0, 1)
  const pos = gram.map((g) => t(child(g, "pos"))).find(Boolean)
  const subc = uniq(gram.flatMap((g) => children(g, "subc").map(t)).filter(Boolean))
  const gender = gram.map((g) => t(child(g, "gen"))).find(Boolean)
  const grammarNotes = uniq(gram.flatMap((g) => children(g, "note").map(t)).filter(Boolean))

  const senses: Raw["senses"] = []
  for (const s of children(e, "sense")) {
    const en: string[] = []
    const other: { lang: string; text: string }[] = []
    for (const q of [...descendants(s, "quote"), ...descendants(s, "def")]) {
      const lang = q.attrs["xml:lang"] ?? ""
      const v = t(q)
      if (!v) continue
      if (lang === "en") en.push(v)
      else other.push({ lang: lang || "?", text: v })
    }
    const greek = children(s, "ref")
      .filter((r) => r.attrs.type === "Greek")
      .map(t)
      .filter(Boolean)
    senses.push({ en: uniq(en), other, greek, bibl: descendants(s, "bibl").map(t).filter(Boolean).join("; ") })
  }

  let greek: Raw["greek"]
  const etymNotes: string[] = []
  const etymGreek: string[] = []
  for (const et of children(e, "etym")) {
    const field = (type: string) => t(children(et, "ref").find((r) => r.attrs.type === `greek_lemma::${type}`)) || undefined
    const lemma = field("grl_lemma")
    if (lemma) greek = { id: field("grl_ID"), lemma: lemma.normalize("NFC"), meaning: field("grl_meaning"), pos: field("grl_pos"), ref: field("grl_ref") }
    for (const n of children(et, "note")) if (t(n)) etymNotes.push(t(n))
    for (const r of children(et, "ref")) {
      if (r.attrs.type === "Greek" || r.attrs["xml:lang"] === "grc") if (t(r)) etymGreek.push(t(r))
    }
  }

  const xrs: Raw["xrs"] = []
  for (const x of children(e, "xr")) {
    for (const r of children(x, "ref")) {
      const target = cleanOrth((r.attrs.target ?? "").replace(/^#/, ""))
      if (target) xrs.push({ type: x.attrs.type ?? "cf", target, label: t(r) })
    }
  }

  return {
    id,
    entryType: e.attrs.type,
    forms,
    pos,
    subc,
    gender,
    grammarNotes,
    senses,
    greek,
    etymNotes,
    etymGreek,
    xrs,
    groupHead: groupHead && groupHead !== id ? groupHead : undefined,
  }
}

type EgyEtym = { egyNum?: string; egyLemma?: string; demoNum?: string; demoLemma?: string; english?: string }

function parseEtymologies(tsv: string): Map<string, EgyEtym> {
  const out = new Map<string, EgyEtym>()
  const v = (s: string | undefined) => (s && s !== "NA" && s !== "_" ? s.trim() : undefined)
  for (const line of tsv.split("\n").slice(1)) {
    const c = line.replace(/\r$/, "").split("\t")
    if (c.length < 8 || !c[0]) continue
    out.set(c[0].trim(), { egyNum: v(c[2]), egyLemma: v(c[3])?.normalize("NFC"), demoNum: v(c[4]), demoLemma: v(c[5])?.normalize("NFC"), english: v(c[6]) })
  }
  return out
}

/* ── conversion ───────────────────────────────────────────────────────────── */

/** Strip state markers and spacing so cross-reference targets ("ϭⲓⲛ", "ⲣⲉϥ ") meet headwords ("ϭⲓⲛ-", "ⲣⲉϥ-"). */
const orthKey = (s: string) => s.normalize("NFC").replace(/[-⸗\s]+/g, "").replace(/\p{M}/gu, "")

function pickHeadword(r: Raw): Form {
  const lemma = r.forms.find((f) => f.type === "lemma")
  if (lemma && (!lemma.dialect || lemma.dialect === "S")) return lemma
  return r.forms.find((f) => f.dialect === "S" && f.type !== "inflected") ?? r.forms.find((f) => f.dialect === "S") ?? lemma ?? r.forms[0]!
}

function dialectNotes(r: Raw, headword: string): string | undefined {
  const byDialect = new Map<string, string[]>()
  const dialected = new Set(r.forms.filter((f) => f.dialect).map((f) => f.orth))
  for (const f of r.forms) {
    // undialected lemma forms (DDGLC) only repeat a dialect form or the headword
    if (!f.dialect && (f.orth === headword || dialected.has(f.orth))) continue
    const d = f.dialect ?? "?"
    const label = f.labels.length ? `${f.labels.join(" ")} ${f.orth}` : f.orth
    const list = byDialect.get(d) ?? []
    if (!list.includes(label)) list.push(label)
    byDialect.set(d, list)
  }
  const name = (d: string) => DIALECTS[d] ?? d
  const only = [...byDialect.entries()]
  if (only.length === 1 && only[0]![1].length === 1 && only[0]![1][0] === headword) return `Dialect: ${name(only[0]![0])}.`
  const parts = only
    .sort(([a], [b]) => (DIALECT_ORDER.indexOf(a) + 1 || 99) - (DIALECT_ORDER.indexOf(b) + 1 || 99))
    .map(([d, forms]) => `${name(d)}: ${forms.join(", ")}`)
  return parts.length ? `Forms — ${parts.join("; ")}.` : undefined
}

function englishOrMarked(s: Raw["senses"][number]): string {
  if (s.en.length) return s.en.join("; ")
  const o = s.other.find((x) => x.lang === "de") ?? s.other[0]
  return o ? `(${o.lang}) ${o.text}` : ""
}

function convert(r: Raw, egy: EgyEtym | undefined): SeedEntry | null {
  const head = pickHeadword(r)
  const headword = head.orth
  const glosses = r.senses.map(englishOrMarked).filter(Boolean)
  const gloss = truncate(glosses[0] ?? "", 120) || (r.greek?.meaning ? truncate(r.greek.meaning, 120) : "")
  if (!gloss) return null

  const senses: SeedSense[] = r.senses
    .map((s) => ({
      gloss: truncate(englishOrMarked(s), 200),
      definition: s.greek.length ? `Greek: ${s.greek.join("; ")}` : undefined,
    }))
    .filter((s) => s.gloss)

  const pos = r.pos?.replace(/\?$/, "")
  let partOfSpeech: PartOfSpeech | undefined = pos ? POS[pos] : undefined
  if (partOfSpeech === "noun" && r.subc.some((s) => PROPER_SUBC.has(s))) partOfSpeech = "proper_noun"
  const partKind = pos ? PART_POS[pos] : undefined

  // etymology: Greek source (DDGLC), Egyptian / Demotic ancestor (TLA), loanword notes
  const etym: string[] = []
  if (r.greek) {
    const extra = [r.greek.pos, r.greek.ref].filter(Boolean).join("; ")
    etym.push(`From Greek ${r.greek.lemma}${r.greek.meaning ? ` "${r.greek.meaning}"` : ""}${extra ? ` (${extra})` : ""}.`)
  }
  if (egy && (egy.egyLemma || egy.demoLemma)) {
    const anc = [
      egy.egyLemma ? `Egyptian ${egy.egyLemma}${egy.egyNum ? ` (TLA ${egy.egyNum})` : ""}` : "",
      egy.demoLemma ? `Demotic ${egy.demoLemma}${egy.demoNum ? ` (TLA ${egy.demoNum})` : ""}` : "",
    ].filter(Boolean)
    etym.push(`From ${anc.join("; ")}${egy.english ? `: "${egy.english}"` : ""}.`)
  }
  for (const n of r.etymNotes) {
    const en = LOANWORD_EN.find(([re]) => re.test(n))
    etym.push(en ? `${n.replace(en[0], en[1])}.`.replace(/\.\.$/, ".").replace(/^./, (c) => c.toUpperCase()) : `(de) ${n}`)
  }
  if (r.etymGreek.length) etym.push(`Greek: ${uniq(r.etymGreek).join("; ")}.`)

  // notes: dialect forms, grammar, references and ids
  const notes: string[] = []
  const forms = dialectNotes(r, headword)
  if (forms) notes.push(forms)
  const grammar = [
    r.gender === "m." ? "masculine" : r.gender === "f." ? "feminine" : r.gender,
    ...r.subc.map((s) => SUBC_EN[s] ?? s),
  ].filter(Boolean)
  if (grammar.length) notes.push(`Grammar: ${grammar.join(", ")}.`)
  for (const n of r.grammarNotes) notes.push(`(de) ${n}.`.replace(/\.\.$/, "."))
  const bibl = uniq(r.senses.flatMap((s) => s.bibl.split(/;\s*/)).filter(Boolean))
  if (bibl.length) notes.push(`References: ${bibl.join("; ")}.`)
  const ids = [`TLA ${r.id}`]
  if (r.greek?.id) ids.push(`DDGLC Greek lemma ${r.greek.id}`)
  if (egy?.egyNum) ids.push(`Egyptian TLA lemma ${egy.egyNum}`)
  if (egy?.demoNum) ids.push(`Demotic TLA lemma ${egy.demoNum}`)
  notes.push(`${ids.join("; ")}.`)

  const base = {
    headword,
    translit: transliterateCoptic(headword),
    pos: partKind && partOfSpeech !== "pronoun" ? undefined : partOfSpeech,
    gloss,
    definition: glosses.length > 1 ? truncate(glosses.join(" | "), 1200) : undefined,
    etymology: etym.join(" ") || undefined,
    notes: notes.join(" "),
    ref: r.id,
    senses: senses.slice(0, 20),
  }
  return partKind ? { kind: "part", partKind, ...base } : { kind: "word", ...base }
}

/** Resolve a cross-reference ("ⲉⲓⲣⲉ" labelled "machen, tun") to one entry id of this lexicon. */
function makeXrResolver(raws: Raw[]) {
  const byOrth = new Map<string, Raw[]>()
  for (const r of raws) {
    for (const k of uniq(r.forms.map((f) => orthKey(f.orth)))) {
      if (!k) continue
      const list = byOrth.get(k) ?? []
      list.push(r)
      byOrth.set(k, list)
    }
  }
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2)
  return (target: string, label: string, self: string): string | undefined => {
    const cands = (byOrth.get(orthKey(target)) ?? []).filter((r) => r.id !== self)
    if (cands.length <= 1) return cands[0]?.id
    // homonyms: pick the one whose meaning (any language) or part of speech the label names
    const lw = words(label)
    const scored = cands
      .map((r) => {
        const meanings = r.senses.flatMap((s) => [...s.en, ...s.other.map((o) => o.text)]).join(" ").toLowerCase()
        const exact = r.senses.some((s) => [...s.en, ...s.other.map((o) => o.text)].some((m) => m.toLowerCase() === label.toLowerCase()))
        const overlap = lw.filter((w) => meanings.includes(w)).length
        const posHit = !!r.pos && label.toLowerCase().includes(r.pos.toLowerCase().replace(/\.$/, ""))
        return { r, score: (exact ? 100 : 0) + overlap * 2 + (posHit ? 1 : 0) }
      })
      .sort((a, b) => b.score - a.score)
    if (scored[0]!.score > 0 && scored[0]!.score > (scored[1]?.score ?? 0)) return scored[0]!.r.id
    return undefined
  }
}

const STOP = new Set("the and for with from into that this than then are was were has have had one who which what (something someone".split(" "))
/** Content words of an English meaning, for comparing two glosses of the same Egyptian lemma. */
function meaningWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^(?:be|become|come)$/.test(w))
  )
}

function keyToRef(key: string): EntryRef {
  const parts = key.split("|")
  return { lang: parts[0]!, kind: parts[1] as EntryRef["kind"], headword: parts.slice(2, -1).join("|"), homonym: Number(parts.at(-1)) }
}

const GRL_POS: Record<string, PartOfSpeech> = { noun: "noun", verb: "verb", adjective: "adjective", adverb: "adverb", conjunction: "conjunction", particle: "particle", preposition: "preposition", pronoun: "pronoun", participle: "verb" }

type GreekRow = { headword: string; homonym: number; pos: PartOfSpeech | null; words: Set<string> }

/** LSJ headwords mark stems with a hyphen and then spell the sigma before it final ("ἐξους-ία"): undo both. */
const greekHead = (s: string) => s.normalize("NFC").replace(/-/g, "").replace(/ς(?=\p{L})/gu, "σ")

/**
 * Exact NFC headword in grc (LSJ marks stem boundaries with hyphens, "ἀναχωρ-ητής", which are ignored), else the
 * strict search key; several candidates are narrowed by part of speech, then by a word shared between the DDGLC
 * meaning and the LSJ gloss (καρπός "fruit" vs καρπός "wrist"), and skipped when that does not settle it.
 */
async function makeGreekResolver(db: Database) {
  const rows = await db
    .select({
      headword: entriesTable.headword,
      homonym: entriesTable.homonymIndex,
      pos: entriesTable.partOfSpeech,
      searchKey: entriesTable.searchKey,
      gloss: entriesTable.gloss,
    })
    .from(entriesTable)
    .where(and(eq(entriesTable.languageId, "grc"), eq(entriesTable.kind, "word")))
  const byHead = new Map<string, GreekRow[]>()
  const byKey = new Map<string, GreekRow[]>()
  for (const r of rows) {
    const row = { headword: r.headword, homonym: r.homonym, pos: r.pos, words: meaningWords(r.gloss) }
    const h = greekHead(r.headword)
    byHead.set(h, [...(byHead.get(h) ?? []), row])
    const k = r.searchKey.split(" ")[0] ?? ""
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), row])
  }
  /** `guessed`: the homonyms were told apart only by the meaning heuristic. */
  const narrow = (cands: GreekRow[], pos?: string, meaning?: string): { list: GreekRow[]; guessed: boolean } => {
    if (cands.length <= 1) return { list: cands, guessed: false }
    const p = pos ? GRL_POS[pos.toLowerCase().split(/\s*\/\s*/)[0]!.trim()] : undefined
    const byPos = p ? cands.filter((c) => c.pos === p) : cands
    if (byPos.length <= 1 || !meaning) return { list: byPos, guessed: false }
    const want = meaningWords(meaning)
    const byMeaning = byPos.filter((c) => [...want].some((w) => c.words.has(w)))
    return byMeaning.length === 1 ? { list: byMeaning, guessed: true } : { list: byPos, guessed: false }
  }
  return {
    size: rows.length,
    resolve(lemma: string, pos?: string, meaning?: string): { row?: GreekRow; exact?: boolean; ambiguous?: boolean } {
      // "ἔνατος / ἔννατος", "κοιτών (II)", "γαλ(λ)ιάριος"
      const alts = lemma
        .replace(/\s*\([IVX]+\)\s*$/, "")
        .split(/\s*\/\s*/)
        .flatMap((a) => (/\(\p{L}+\)/u.test(a) ? [a.replace(/[()]/g, ""), a.replace(/\(\p{L}+\)/gu, "")] : [a]))
        .map((a) => greekHead(a.trim()))
        .filter(Boolean)
      for (const a of alts) {
        const all = byHead.get(a) ?? []
        const exact = narrow(all, pos, meaning)
        if (exact.list.length === 1) return { row: exact.list[0]!, exact: !exact.guessed }
        if (all.length) return { ambiguous: true } // homonyms the part of speech does not tell apart
      }
      for (const a of alts) {
        const all = byKey.get(normalizeForSearch(a)) ?? []
        const loose = narrow(all, pos, meaning).list
        if (loose.length === 1) return { row: loose[0]!, exact: false }
        if (all.length) return { ambiguous: true }
      }
      return {}
    },
  }
}

/** Parse the lexicon (and its etymology table) into seed entries, keeping the raw records for linking. */
export async function loadCoptic(xmlFile: string, egyptian: Map<string, EgyEtym>, limit?: number) {
  const raws: Raw[] = []
  let seen = 0
  await forEachElement(
    xmlFile,
    (n) => n === "superEntry" || n === "entry",
    (node) => {
      const group = node.name === "superEntry" ? children(node, "entry") : [node]
      const headId = group.find((e) => !e.attrs.type || e.attrs.type === "hom")?.attrs["xml:id"]
      for (const e of group) {
        seen++
        if (limit && raws.length >= limit) return
        const r = parseEntry(e, e.attrs.type === "compound" ? headId : undefined)
        if (r) raws.push(r)
      }
    }
  )
  const entries: SeedEntry[] = []
  const rawById = new Map<string, Raw>()
  for (const r of raws) {
    const e = convert(r, egyptian.get(r.id))
    if (!e) continue
    entries.push(e)
    rawById.set(r.id, r)
  }
  return { seen, raws, entries, rawById }
}

export { parseEtymologies }

export const copticImporter: Importer = {
  id: "coptic",
  language: "cop",
  description: "Comprehensive Coptic Lexicon (BBAW + DDGLC via KELLIA, ~11k entries) with Greek loanword links",
  async run({ db, log, limit, offline, prune }) {
    const startedAt = new Date()
    const [xmlFile, etymFile] = await Promise.all([
      download("coptic", XML_FILE, `${RAW}xml/${XML_FILE}`, { offline, log }),
      download("coptic", ETYM_FILE, `${RAW}data/${ETYM_FILE}`, { offline, log }),
    ])
    const egyptian = parseEtymologies(await readCached(etymFile))
    const { seen, raws, entries, rawById } = await loadCoptic(xmlFile, egyptian, limit)
    const kept = raws.filter((r) => rawById.has(r.id))
    log(`${XML_FILE}: ${seen} entries → ${entries.length} (${raws.length - entries.length} without meaning, deprecated ones skipped); ${egyptian.size} Egyptian etymologies`)

    // compounds → components (cross-referenced elements, else the head of their superEntry)
    const resolveXr = makeXrResolver(kept)
    const relations: { from: string; to: string; type: SeedRelation["type"]; note: string }[] = []
    let components = 0
    for (const e of entries) {
      const r = rawById.get(e.ref!)!
      const parts: SeedComponent[] = []
      for (const x of r.xrs) {
        const to = resolveXr(x.target, x.label, r.id)
        if (!to) continue
        if (r.entryType === "compound" && x.type === "cf") {
          if (!parts.some((p) => typeof p !== "string" && p.ref === `ref:${to}`)) parts.push({ ref: `ref:${to}`, role: "component" })
        } else {
          const rel = NOTE_XR[x.type] ?? NOTE_XR.cf!
          relations.push({ from: r.id, to, type: rel.type, note: rel.note })
        }
      }
      if (r.entryType === "compound" && !parts.length && r.groupHead && rawById.has(r.groupHead)) parts.push({ ref: `ref:${r.groupHead}`, role: "base" })
      if (parts.length) {
        e.parts = parts
        components += parts.length
      }
    }

    const dataset: SeedDataset = { language: copticLanguage, source: copticSource, entries }
    const result = await upsertDataset(db, dataset, { log, batchSize: 250 })
    if (prune && !limit) {
      const stale = await db
        .delete(entriesTable)
        .where(and(eq(entriesTable.sourceId, copticSource.id), lt(entriesTable.updatedAt, startedAt)))
        .returning({ id: entriesTable.id })
      log(`pruned ${stale.length} stale entries`)
    }
    const refOf = (id: string) => {
      const key = result.keyOfRef.get(id)
      return key ? keyToRef(key) : undefined
    }

    // Greek loanwords → loan_from the LSJ entry
    const greek = await makeGreekResolver(db)
    const rels: SeedRelation[] = []
    let loans = 0
    let exact = 0
    let ambiguous = 0
    let loose = 0
    const unresolved: string[] = []
    for (const r of kept) {
      if (!r.greek) continue
      loans++
      const from = refOf(r.id)
      const hit = greek.size ? greek.resolve(r.greek.lemma, r.greek.pos, r.greek.meaning) : {}
      if (!from || !hit.row) {
        if (hit.ambiguous) ambiguous++
        else unresolved.push(r.greek.lemma)
        continue
      }
      if (hit.exact) exact++
      else loose++
      rels.push({
        from,
        to: { lang: "grc", headword: hit.row.headword, homonym: hit.row.homonym },
        type: "loan_from",
        confidence: hit.exact ? "certain" : "likely",
        note: NOTE_LOAN,
      })
    }
    log(
      `Greek loanwords: ${loans}, linked to LSJ ${exact + loose} (${exact} exact headword, ${loose} by search key or by meaning among homonyms), ` +
        `${ambiguous} ambiguous (skipped), ${unresolved.length} not in LSJ${greek.size ? "" : " (no grc entries — run lsj first)"}`
    )
    if (unresolved.length) log(`  e.g. not in LSJ: ${unresolved.slice(0, 12).join(", ")}`)

    // Egyptian ancestors → derived_from the TLA entry with the cited lemma id. Lemmas missing from the
    // 2018 TLA extract fall back to an egy entry with that exact transliteration, when exactly one exists
    // and its meaning shares a word with the TLA meaning (transliterations alone collide across homonyms:
    // ϣⲟϣ "antelope" < šsꜣ is not šsꜣ "to be aware").
    const egyRows = await db
      .select({
        headword: entriesTable.headword,
        homonym: entriesTable.homonymIndex,
        translit: entriesTable.transliteration,
        gloss: entriesTable.gloss,
        definition: entriesTable.definition,
        sourceId: entriesTable.sourceId,
        sourceRef: entriesTable.sourceRef,
      })
      .from(entriesTable)
      .where(eq(entriesTable.languageId, "egy"))
    let egyById = 0
    let egyByForm = 0
    let egyHomographs = 0
    let egyMissing = 0
    if (egyRows.length) {
      type EgyRow = { headword: string; homonym: number; words: Set<string> }
      const byTla = new Map<string, EgyRow>()
      const byTranslit = new Map<string, EgyRow[]>()
      for (const row of egyRows) {
        const item = { headword: row.headword, homonym: row.homonym, words: meaningWords(`${row.gloss} ${row.definition ?? ""}`) }
        if (row.sourceId === tlaEgyptianSource.id && row.sourceRef) byTla.set(row.sourceRef, item)
        for (const k of uniq([row.headword, row.translit ?? ""].map((x) => x.normalize("NFC")).filter(Boolean))) {
          byTranslit.set(k, [...(byTranslit.get(k) ?? []), item])
        }
      }
      for (const r of kept) {
        const etym = egyptian.get(r.id)
        const from = refOf(r.id)
        if (!from || !etym?.egyLemma) continue
        const byId = etym.egyNum ? byTla.get(etym.egyNum) : undefined
        if (byId) {
          rels.push({ from, to: { lang: "egy", headword: byId.headword, homonym: byId.homonym }, type: "derived_from", confidence: "certain", note: NOTE_EGY })
          egyById++
          continue
        }
        const cands = byTranslit.get(etym.egyLemma) ?? []
        if (cands.length !== 1) {
          egyMissing++
          continue
        }
        const tla = meaningWords(etym.english ?? "")
        if (![...tla].some((w) => cands[0]!.words.has(w))) {
          egyHomographs++
          continue
        }
        rels.push({ from, to: { lang: "egy", headword: cands[0]!.headword, homonym: cands[0]!.homonym }, type: "derived_from", confidence: "likely", note: NOTE_EGY })
        egyByForm++
      }
    }
    log(
      egyRows.length
        ? `Egyptian ancestors linked: ${egyById + egyByForm} (${egyById} by TLA lemma id, ${egyByForm} by transliteration and meaning), ` +
            `${egyHomographs} same transliteration but different meaning, ${egyMissing} not found (skipped)`
        : "Egyptian ancestors: no egy entries yet (run tla-egy first)"
    )

    for (const x of relations) {
      const from = refOf(x.from)
      const to = refOf(x.to)
      if (from && to) rels.push({ from, to, type: x.type, confidence: "certain", note: x.note })
    }
    log(`components: ${components}; cross-reference relations: ${relations.length}`)

    if (!limit) {
      // this importer owns these relations: clear them so links that no longer resolve disappear
      const own = db.select({ id: entriesTable.id }).from(entriesTable).where(eq(entriesTable.sourceId, copticSource.id))
      await db.delete(entryRelations).where(and(inArray(entryRelations.note, OWN_NOTES), inArray(entryRelations.fromEntryId, own)))
    }
    await upsertRelations(db, rels, result.idByKey, { log })
  },
}

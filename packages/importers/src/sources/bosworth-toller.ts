/**
 * Bosworth–Toller's Anglo-Saxon Dictionary online (Charles University, Prague),
 * data dump v0.1 on LINDAT/CLARIAH-CZ (CC BY 4.0): one CSV, `"id";"headword";"body"`,
 * the body an XML-tagged entry. ~62.8k rows: the Main Volume (1898, ids 1–37302),
 * Toller's Supplement (1921, 37303–61009) and the Supplement's Addenda (61010–).
 *   http://hdl.handle.net/11234/1-3532   https://bosworthtoller.com/
 *
 * Supplement and Addenda rows that amend a Main Volume entry ("Add:", "Substitute:",
 * "Dele …") are merged into it — their senses follow the Main Volume's, marked
 * "Supplement" — when the spelling identifies one entry (homonyms: by part of
 * speech, gender and shared gloss words); the rest become entries of their own.
 * Pure "-element v. compound" index stubs and whole-entry "Dele." stubs are skipped.
 *
 * Headwords follow Wiktionary's Old English page titles: no length marks, no
 * hyphens, ð written þ, ǽ → æ, capitalised root entries ("STÁN") lowercased:
 * stán → stan, ge-þeódan → geþeodan, eorðe → eorþe. `native` is the length-marked
 * form with macrons (stān, hlāford, ēa, ǣr; BT's acute on the second vowel of a long
 * diphthong, eá / eó / ié, becomes a macron on the first) — no palatal dots, which
 * Bosworth–Toller does not mark. The dictionary's own spelling and grammar line
 * ("stán, es; m.") are kept in `notes`.
 * Cross-references become relations: a pointer entry ("ge-þiédan v. ge-þeódan")
 * is a variant_of its target, other links see_also, "DER." lists derived_from.
 */
import { and, eq, inArray, lt } from "drizzle-orm"
import { SaxesParser } from "saxes"
import {
  chunk,
  entries as entriesTable,
  entryRelations,
  upsertDataset,
  upsertRelations,
  type EntryRef,
  type PartOfSpeech,
  type SeedDataset,
  type SeedEntry,
  type SeedRelation,
  type SeedSense,
} from "@workspace/db"

import { download, readCached } from "../lib/cache"
import { truncate, uniq } from "../lib/text"
import { children, type XmlNode } from "../lib/xml"
import type { Importer } from "../registry"
import { WIKTIONARY_LANGUAGES } from "./wiktionary"

const FILE = "bosworth_entries_export.csv"
const URL = "https://lindat.mff.cuni.cz/repository/server/api/core/bitstreams/3010b742-b2c4-4152-870a-716ce1652e7c/content"

export const bosworthTollerSource = {
  id: "bosworth-toller",
  title: "Bosworth–Toller's Anglo-Saxon Dictionary online (Charles University, data dump v0.1)",
  url: "https://bosworthtoller.com/",
  license: "CC BY 4.0 (online edition data, LINDAT/CLARIAH-CZ); the 1898 dictionary and 1921 Supplement are public domain",
  citation:
    "Joseph Bosworth, An Anglo-Saxon Dictionary, ed. T. Northcote Toller (Oxford, 1898), and T. Northcote Toller, An Anglo-Saxon Dictionary: Supplement (Oxford, 1921); online edition: Ondřej Tichý et al., Bosworth-Toller's Anglo-Saxon Dictionary online (Charles University, Faculty of Arts, 2021), http://hdl.handle.net/11234/1-3532.",
}

export const oldEnglishLanguage = WIKTIONARY_LANGUAGES.find((l) => l.language.id === "ang")!.language

const SUPPLEMENT_FROM = 37303
const ADDENDA_FROM = 61010

const NOTE_XR = "Bosworth–Toller cross-reference"
const NOTE_VAR = "Bosworth–Toller variant"
const NOTE_DER = "Bosworth–Toller derivative"
const OWN_NOTES = [NOTE_XR, NOTE_VAR, NOTE_DER]

/* ── CSV + XML ────────────────────────────────────────────────────────────── */

/** `;`-separated, `"`-quoted, `""` escapes, quoted fields may span lines. */
export function* csvRows(s: string): Generator<string[]> {
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ";") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++
      row.push(field)
      if (row.length > 1 || row[0]) yield row
      row = []
      field = ""
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    yield row
  }
}

/** Parse one XML fragment into a tree (recoverable errors are tolerated). */
function parseXml(s: string): XmlNode | undefined {
  const parser = new SaxesParser({ xmlns: false })
  const root: XmlNode = { name: "#root", attrs: {}, children: [] }
  const stack: XmlNode[] = [root]
  parser.on("opentag", (tag) => {
    const node: XmlNode = { name: tag.name, attrs: tag.attributes as Record<string, string>, children: [] }
    stack.at(-1)!.children.push(node)
    stack.push(node)
  })
  parser.on("text", (t) => stack.at(-1)!.children.push(t))
  parser.on("closetag", () => {
    if (stack.length > 1) stack.pop()
  })
  parser.on("error", () => {})
  try {
    parser.write(s).close()
  } catch {
    // keep what was built
  }
  return root.children.find((c): c is XmlNode => typeof c !== "string")
}

const ENTITIES: Record<string, string> = { amp: "&", "#39": "'", para: "¶", nbsp: " ", mdash: "—", ndash: "–", lt: "<", gt: ">", sect: "§", quot: '"' }

/** The body escapes some markup twice ("&lt;b&gt;II a.&lt;/b&gt;", "&amp;mdash;"): undo that and tidy spacing. */
function tidy(s: string): string {
  return s
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/<\/?[bi]>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:.)\]])/g, "$1")
    .replace(/,(?=\p{L})/gu, ", ")
    .replace(/([([])\s+/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .trim()
}

/** Text of `n`, leaving out the child elements named in `drop` (never `n` itself). */
function rawText(n: XmlNode | string, drop?: Set<string>, top = true): string {
  if (typeof n === "string") return n
  if (!top && drop?.has(n.name)) return " "
  // line breaks, page milestones and the end of an italic / bold run separate words
  if (n.name === "br" || n.name === "page" || n.name === "i-e" || n.name === "b-e") return " "
  return n.children.map((c) => rawText(c, drop, false)).join("")
}

const txt = (n: XmlNode | string | undefined, drop?: Set<string>) => (n ? tidy(rawText(n, drop)) : "")

function find(n: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (x: XmlNode) => {
    for (const c of x.children) {
      if (typeof c === "string") continue
      if (c.name === name) out.push(c)
      walk(c)
    }
  }
  walk(n)
  return out
}

/* ── spelling ─────────────────────────────────────────────────────────────── */

const nfc = (s: string) => s.normalize("NFC")

/** BT acute (length) → macron; on a long diphthong the mark moves to its first vowel (eá → ēa, eó → ēo, ié → īe). */
function macronize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/([eiEI])([aeouAEOU])́/g, "$1̄$2")
    .replace(/́/g, "̄")
    .normalize("NFC")
}

const stripMarks = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC")

/** Spelling shared by headword and native: one case, no morpheme hyphens, þ for ð. */
function baseSpelling(orth: string): { form: string; alternatives: string[] } {
  let o = nfc(orth).replace(/\s+/g, " ").trim()
  const alternatives: string[] = []
  o = o.replace(/\(-\)/g, "")
  const alt = o.match(/\s*\(([^)]+)\)\s*$/)
  if (alt) {
    alternatives.push(alt[1]!.trim())
    o = o.slice(0, alt.index).trim()
  }
  o = o.replace(/[()]/g, "").replace(/=/g, "-")
  const letters = [...o].filter((c) => /\p{L}/u.test(c))
  if (letters.length > 1 && letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase())) o = o.toLowerCase()
  o = o
    .replace(/(\p{L}\p{M}*)-(?=\p{L})/gu, "$1")
    .replace(/ð/g, "þ")
    .replace(/Ð/g, "Þ")
  return { form: o, alternatives }
}

export function btHeadword(orth: string): string {
  return stripMarks(baseSpelling(orth).form)
}

export function btNative(orth: string): string {
  return macronize(baseSpelling(orth).form)
}

/** Keys for matching Supplement rows and cross-references to entries. */
const strictKey = (s: string) => nfc(s).toLowerCase().replace(/[-\s=()]/g, "").replace(/ð/g, "þ")
const looseKey = (s: string) => stripMarks(strictKey(s))

/* ── parsing ──────────────────────────────────────────────────────────────── */

type Example = { oe: string; trans: string; refs: string }
type Sense = { path: string; text: string; equiv: string; italics: string[]; examples: Example[] }
type Link = { target: string; label: string; inSee: boolean }

export type BtRaw = {
  id: number
  section: "main" | "supplement" | "addenda"
  orth: string
  flags: { add: boolean; delete: boolean; substitute: boolean }
  pos: string[]
  gen: string[]
  subc: string[]
  grammar: string
  grammarItalics: string[]
  variants: string[]
  topDef: string
  /** Text directly in the entry body outside any tagged part. */
  topLoose: string
  topEquiv: string
  topItalics: string[]
  senses: Sense[]
  examples: Example[]
  etymology: string
  see: string
  links: Link[]
  derived: string[]
  edit: string
  text: string
}

const SENSE_DROP = new Set(["sense", "examples", "snum", "references", "edit", "ex"])
const TOP_DROP = new Set(["def", "sense", "examples", "grammar", "etym", "see", "der", "edit", "references", "page", "checked", "form", "gramGrp"])
const GRAMMAR_DROP = new Set(["page"])

function examplesOf(n: XmlNode): Example[] {
  const out: Example[] = []
  for (const exs of children(n, "examples")) {
    for (const ex of children(exs, "ex")) {
      const oe = children(ex, "oe").map((x) => txt(x)).join(" ")
      const trans = children(ex, "trans").map((x) => txt(x)).join(" ")
      const refs = children(ex, "references").map((x) => txt(x)).join(" ")
      const loose = oe || trans || refs ? "" : txt(ex)
      if (oe || trans || loose) out.push({ oe: tidy(oe || loose), trans: tidy(trans), refs: tidy(refs) })
    }
  }
  return out
}

/** English equivalents of the <def>s directly under `n`. */
function equivOf(n: XmlNode): string {
  const parts: string[] = []
  for (const d of children(n, "def")) {
    for (const e of find(d, "equiv")) if (/^eng/i.test(e.attrs.lang ?? "")) parts.push(txt(e))
  }
  return parts.filter(Boolean).join(", ")
}

function collectSenses(n: XmlNode, path: string[], out: Sense[]) {
  for (const s of children(n, "sense")) {
    const num = tidy(txt(children(s, "snum")[0])).replace(/\.$/, "")
    const p = num ? [...path, num] : path
    out.push({ path: p.join(" "), text: txt(s, SENSE_DROP), equiv: equivOf(s), italics: italicRuns(children(s, "def")), examples: examplesOf(s) })
    collectSenses(s, p, out)
  }
}

export function parseBt(id: number, headwordColumn: string, body: string): BtRaw | null {
  const e = parseXml(body)
  if (!e || e.name !== "entry") return null
  const form = children(e, "form")[0]
  const orth = tidy(txt(form && children(form, "orth")[0])) || tidy(headwordColumn)
  if (!orth) return null
  const gram = children(e, "gramGrp")[0]
  const of = (name: string) => (gram ? children(gram, name).map((x) => txt(x)).filter(Boolean) : [])
  const column = children(e, "column")[0] ?? e

  const grammarNodes = children(column, "grammar")
  const variants = uniq(grammarNodes.flatMap((g) => find(g, "var").map((v) => tidy(v.attrs.full || txt(v)))).filter(Boolean))
  const senses: Sense[] = []
  collectSenses(column, [], senses)
  const links: Link[] = []
  for (const a of find(column, "a")) {
    const target = (a.attrs.href ?? "").replace(/\D/g, "")
    if (target) links.push({ target: String(Number(target)), label: txt(a), inSee: false })
  }
  const seeNodes = children(column, "see")
  for (const s of seeNodes) {
    for (const a of find(s, "a")) {
      const l = links.find((x) => x.target === String(Number((a.attrs.href ?? "").replace(/\D/g, ""))))
      if (l) l.inSee = true
    }
  }
  const derived: string[] = []
  for (const d of children(column, "der")) {
    const dforms = find(d, "dform")
    if (dforms.length) derived.push(...dforms.map((f) => tidy(f.attrs.full || txt(f))))
    else derived.push(...txt(d).replace(/^\s*DER\.\s*/i, "").split(/[,:;]\s*/))
  }
  const edits = find(column, "edit").map((x) => (x.attrs.type ?? txt(x)).toLowerCase())
  const flag = (k: string) => (e.attrs[k] ?? "0") === "1"

  return {
    id,
    section: id >= ADDENDA_FROM ? "addenda" : id >= SUPPLEMENT_FROM ? "supplement" : "main",
    orth,
    flags: { add: flag("add"), delete: flag("delete"), substitute: flag("substitute") },
    pos: of("pos"),
    gen: of("gen"),
    subc: of("subc"),
    grammar: grammarNodes.map((g) => txt(g, GRAMMAR_DROP)).join(" ").trim(),
    grammarItalics: italicRuns(grammarNodes),
    variants,
    topDef: children(column, "def").map((d) => txt(d)).join(" ").trim(),
    topLoose: txt(column, TOP_DROP),
    topEquiv: equivOf(column),
    topItalics: italicRuns(children(column, "def")),
    senses,
    examples: examplesOf(column),
    etymology: children(column, "etym").map((x) => txt(x)).join(" ").trim(),
    see: seeNodes.map((x) => txt(x)).join(" ").trim(),
    links,
    derived: uniq(derived.map((d) => d.replace(/[.\s]+$/, "").trim()).filter((d) => /\p{L}/u.test(d))),
    edit: edits.find((x) => /dele|substitute|add/.test(x)) ?? "",
    text: txt(column, new Set(["page"])),
  }
}

/* ── glosses ──────────────────────────────────────────────────────────────── */

const EDIT_WORDS = /^(?:(?:add|substitute|dele|for|and|l\.)\b[\s:.,]*)+/i
const KEEP_CASE = new Set("God Christ Christian Christ's English Englishman Latin Greek Hebrew Saxon Saxons Britons Britain Danes Danish Jews Jewish Roman Romans Rome Welsh Welshman Mercia Mercians Northumbrian Northumbrians Kent Saturday Sunday Monday Tuesday Wednesday Thursday Friday I".split(" "))
const ENGLISH_HINT = /\b(?:a|an|the|to|of|in|on|with|for|by|from|one|any|as|that|which|who|is|be|or|and|not|his|her|its|their|something|someone)\b/i
const LATIN_MARKS = /[āēīōūȳăĕĭŏŭ]/i
/** The Supplement's instructions to the reader ("take here fyrwitnes in Dict., and add"). */
const EDITORIAL = /\b(?:in Dict|take here|read|substitute|dele|for\s+.*\s+read|in the glosses|next word|preceding word)\b/i
/** Old English quoted where a meaning was expected ("heom for án þá wítu gemynte wǽron"). */
const looksOldEnglish = (s: string) => (s.match(/[þðæǽáéíóúýǣ]/gi) ?? []).length >= 2
/** Latin equivalents and bare references ("soricarius, 63, 8"). */
const looksLikeCitation = (s: string) => /\d/.test(s) && !ENGLISH_HINT.test(s)
const isMeaning = (s: string) => !!s && !EDITORIAL.test(s) && !looksOldEnglish(s) && !looksLikeCitation(s)

/** Drop a parenthesis or bracket left open (or closed) by a cut: "(of animals" → "of animals". */
function balance(s: string): string {
  let t = s
  for (const [o, c] of [
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    const opens = t.split(o).length - 1
    const closes = t.split(c).length - 1
    if (opens > closes) t = t.replace(new RegExp(`\\${o}(?![^\\${o}]*\\${c})`), "")
    else if (closes > opens) t = t.replace(new RegExp(`\\${c}(?![^\\${o}]*\\${c})`), "")
  }
  return t.replace(/\s{2,}/g, " ").trim()
}

/** First meaning of a BT definition: up to the Latin equivalents, no editorial words, sentence case. */
function cleanMeaning(raw: string, proper = false): string {
  let s = tidy(raw)
    .replace(EDIT_WORDS, "")
    .replace(/^[\s,;:.—-]+/, "")
    .replace(/^(?:(?:[mfn]\??|adj|adv|pl|sg|indecl)\.?[,;]?\s+)+(?=\p{L})/u, "")
    .replace(/^v\.\s+(?=\p{L})/u, "see ")
    .replace(/\s*\((?:v|cf|see)[.,]?\s[^()]*\)/g, "") // "(v. word, II. 6)"
  // essays after the meaning ("a king, ruler. He is the representation of the people …"), citations after a dash
  s = s.split(/\.\s+(?=[A-Z])|\s+[—–]\s*|\s*:\s*-{1,2}\s*|\s*:—\s*|\s+v\.\s+(?=\p{L})/u)[0]!
  const segs = s.split(/\s*;\s*/).filter(Boolean)
  const kept: string[] = []
  for (const [i, seg] of segs.entries()) {
    const labels = /^(?:(?:\p{L}{1,6}\.\s*)+(?:and\s+)?)+(?:of|from)?$/u.test(seg) // "nom. gen. acc. pl. of"
    if (i > 0 && (labels || LATIN_MARKS.test(seg) || !ENGLISH_HINT.test(seg) || looksOldEnglish(seg))) break
    kept.push(seg)
  }
  s = balance(kept.join("; ").replace(/[\s,;:.—-]+$/, "").replace(/\s+(?:cf|v|q\.\s*v|etc)\.?$/, "")).replace(/[\s,;:—-]+$/, "")
  // small capitals of the printed root entries: "A LORD", "EARTH in opposition to the sea"
  s = s.replace(/\b\p{Lu}{2,}\b/gu, (w) => (/^[IVXLC]+$/.test(w) ? w : w.toLowerCase()))
  if (!/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s)) s = s.toLowerCase()
  const first = s.split(/[\s,]/)[0] ?? ""
  if (!proper && (first === "A" || (/^\p{Lu}\p{Ll}/u.test(first) && !KEEP_CASE.has(first) && !/^\p{Lu}\p{Ll}*-\p{Lu}/u.test(first)))) s = s[0]!.toLowerCase() + s.slice(1)
  s = s.trim()
  return /\p{L}/u.test(s) && !/^\p{L}\.?$/u.test(s.replace(/!$/, "x")) ? s : ""
}

/** A meaning inside the grammar line ("an; m. A foreigner, stranger, not a native. v. in-lenda"). */
const LABEL = /^(?:[mfn]|adj|adv|pl|sg|pp?|v|gen|dat|acc|nom|q\.\s*v|etc|cf|i\.\s*e|indecl|adv\.\s*of|of|in|or|and|lit|fig)[.:;,\s]*$/i

/**
 * A meaning inside the grammar line: the first italicised phrase that is not a label ("e; f: … A beech-tree;"),
 * else the text after the inflection ("an; m. A foreigner, stranger, not a native. v. in-lenda").
 */
function meaningFromGrammar(r: BtRaw, proper = false): string {
  const ok = (m: string) => m.length >= 3 && /\p{Ll}{3}/u.test(m) && !/^\p{Ll}{1,4}\.?$/u.test(m) && isMeaning(m)
  for (const run of r.grammarItalics) {
    if (LABEL.test(run.trim()) || run.replace(/[^\p{L}]/gu, "").length < 3) continue
    const m = cleanMeaning(run, proper)
    if (ok(m)) return m
    break
  }
  // "gen. pl. of fáh hostile", "p. of be-sceótan"
  const formOf = tidy(`${r.grammar} ${r.topDef}`).match(new RegExp(`\\b(${FORM_LABELS})of\\s+((?:\\p{L}\\p{M}*|-)+)`, "u"))
  if (formOf && !r.topEquiv && !r.senses.length) return `${expandLabels(formOf[1]!)} of ${btNative(formOf[2]!)}`
  let s = tidy(r.grammar)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/^(?:(?:[-\p{L}]{1,8}[,;:]\s*)*(?:[mfn]|adj|adv|pp?|indecl|pl|sg|def|indef)[.:?](?:\s*(?:or|and)?\s*[mfn][.:?])*[\s,;:]*)+/u, "")

  s = s.split(/\s+v[.,]\s|\.\s+(?=[A-Z])/)[0]!
  s = s.replace(/,?\s+(?:[A-Z][\w.]*\.\s*)+(?:[ivxl]+\.\s*)?\d.*$/, "") // ", Exon. 20a; Th. 51 …"
  const m = cleanMeaning(s, proper)
  return ok(m) ? m : ""
}

/** Labels of an inflected form ("p.", "gen. pl.", "comp."), as a regex source. */
const FORM_LABELS = "(?:(?:gen|dat|acc|nom|inst|pl|sg|pp|p|pret|pres|part|inf|imp|subj|comp|superl)\\.\\s*(?:and\\s+)?)+"
const LABEL_NAMES: Record<string, string> = {
  gen: "genitive",
  dat: "dative",
  acc: "accusative",
  nom: "nominative",
  inst: "instrumental",
  pl: "plural",
  sg: "singular",
  pp: "past participle",
  p: "past",
  pret: "preterite",
  pres: "present",
  part: "participle",
  inf: "infinitive",
  imp: "imperative",
  subj: "subjunctive",
  comp: "comparative",
  superl: "superlative",
}
/** "gen. pl." → "genitive plural", "p. pl." → "past plural". */
const expandLabels = (s: string) => s.trim().replace(/\b(\p{L}+)\.\s*/gu, (m, w: string) => `${LABEL_NAMES[w] ?? m.trim()} `).trim()

/**
 * "blann: ceased, rested, Bd. 3, 20; p. | of blinnan." — the scan splits "p. of blinnan" between the grammar line
 * and the definition. Gloss: "past of blinnan (ceased, rested)".
 */
function splitFormOf(r: BtRaw, proper: boolean): string {
  const def = tidy(r.topDef).match(/^of\s+((?:\p{L}\p{M}*|-)+)\.?$/u)
  if (!def || r.senses.length) return ""
  let g = tidy(r.grammar).replace(/[\s,;:]+$/, "")
  for (const v of r.variants) if (g.startsWith(v)) g = g.slice(v.length).trim()
  const label = g.match(new RegExp(`(?:^|\\s)(${FORM_LABELS})$`, "u"))
  if (!label) return ""
  const italic = r.grammarItalics.find((x) => !LABEL.test(x.trim()) && x.replace(/[^\p{L}]/gu, "").length >= 3)
  let meaning = italic ? cleanMeaning(italic, proper) : ""
  if (!isMeaning(meaning)) {
    const rest = g
      .slice(0, label.index)
      .replace(/,?\s+(?:[A-Z][\w.]*\.\s*)+(?:[ivxl]+\.\s*)?\d.*$/, "")
      .split(/\.\s+(?=[A-Z])/)[0]!
    meaning = cleanMeaning(rest, proper)
  }
  const head = `${expandLabels(label[1]!)} of ${btNative(def[1]!)}`
  return isMeaning(meaning) && meaning.length < 80 ? `${head} (${meaning})` : head
}

/** Italic runs (between the <i-s/> and <i-e/> milestones) of the grammar line. */
function italicRuns(nodes: XmlNode[]): string[] {
  const runs: string[] = []
  let cur: string | undefined
  const walk = (n: XmlNode | string) => {
    if (typeof n === "string") {
      if (cur !== undefined) cur += n
      return
    }
    if (n.name === "i-s") cur = ""
    else if (n.name === "i-e") {
      if (cur !== undefined && tidy(cur)) runs.push(tidy(cur))
      cur = undefined
    } else n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return runs
}

function senseGloss(s: Sense): string {
  return meaningOf(s.equiv, s.italics, s.text, false) || cleanMeaning(s.text)
}

function exampleText(x: Example): string {
  const parts = [x.oe.replace(/[\s(]+$/, "").replace(/[,;:\s]+$/, "")]
  if (x.trans) parts.push(`‘${x.trans.replace(/[,;:\s]+$/, "")}’`)
  if (x.refs) parts.push(`(${x.refs.replace(/[,;:\s]+$/, "")})`)
  return parts.filter(Boolean).join(" ")
}

/* ── conversion ───────────────────────────────────────────────────────────── */

const POS: Record<string, PartOfSpeech> = {
  noun: "noun",
  verb: "verb",
  adjective: "adjective",
  adverb: "adverb",
  preposition: "preposition",
  numeral: "numeral",
  pronoun: "pronoun",
  conjunction: "conjunction",
  interjection: "interjection",
}

function guessPos(r: BtRaw, headword: string): PartOfSpeech | undefined {
  const proper = /^\p{Lu}/u.test(headword)
  for (const p of r.pos) {
    const pos = POS[p]
    if (pos) return pos === "noun" && proper ? "proper_noun" : pos
  }
  const g = ` ${r.grammar.replace(/\[[^\]]*\]/g, " ")} `
  if (/[\s;,]\s*[mfn]\.(?=[\s;,.]|$)/.test(g)) return proper ? "proper_noun" : "noun"
  if (/\badj\./.test(g)) return "adjective"
  if (/\badv\./.test(g)) return "adverb"
  if (/\bprep\./.test(g)) return "preposition"
  if (/\bconj\./.test(g)) return "conjunction"
  if (/\binterj\./.test(g)) return "interjection"
  if (/\bpron\./.test(g)) return "pronoun"
  if (/\bp\.\s*-?(?:ode|ede|de|te|ade|ude)\b|\bpp\.\s|\bv\.\s*(?:trans|intrans|a|n)\.|\bpret\./.test(g)) return "verb"
  return undefined
}

/** A pointer entry: nothing of its own but "v. X" (perhaps with a short meaning). */
const isPointer = (r: BtRaw) => !r.examples.length && !r.senses.some((s) => s.examples.length) && !!r.see && r.links.length > 0
/** "-wáden v. cyne-wáden": an index of compounds, not a word. */
const isIndexStub = (r: BtRaw) => /^-/.test(r.orth) && !r.topDef && !r.senses.length && !r.examples.length
/** "fel-nys: Dele." */
const isDeletion = (r: BtRaw) => r.section !== "main" && /^(?:dele|delete)\.?$/i.test(r.text.replace(/\s+/g, " ").trim())

type Built = { raw: BtRaw; entry: SeedEntry; supplements: BtRaw[]; deleted: boolean }

function grammarNote(r: BtRaw): string {
  const g = r.grammar.replace(/\[[^\]]*\]/g, " ")
  return tidy(g).replace(/[\s,;:.]+$/, "")
}

/** The bracketed note in the grammar line ("[cyn people, -ing originating from]"), then the cognates of <etym>. */
function bracketEtymology(r: BtRaw): string {
  const m = r.grammar.match(/\[([^[\]]{3,600})\]/)
  const own = m ? m[1]!.trim().replace(/[.;:\s]+$/, "") : ""
  const etym = r.etymology.replace(/^\[\s*|\s*\]\.?$/g, "").trim()
  if (own && etym && !etym.includes(own)) return `${own}. ${etym}`
  return etym || own
}

/** The headword's own first meaning, from the best place this entry offers. */
/** Tagged English equivalent, else the first italicised (= English) phrase, else the plain definition. */
function meaningOf(equiv: string, italics: string[], text: string, proper: boolean): string {
  for (const cand of [equiv, italics.find((x) => !LABEL.test(x.trim()) && /\p{L}{2}/u.test(x)) ?? "", text]) {
    const m = cand ? cleanMeaning(cand, proper) : ""
    if (isMeaning(m)) return m
  }
  return ""
}

function firstMeaning(r: BtRaw, proper = false): string {
  const split = splitFormOf(r, proper)
  if (split) return split
  const fromDef = meaningOf(r.topEquiv, r.topItalics, r.topDef, proper)
  if (fromDef) return fromDef
  for (const s of r.senses) {
    const g = meaningOf(s.equiv, s.italics, s.text, proper)
    if (g) return g
  }
  const g = meaningFromGrammar(r, proper)
  if (isMeaning(g)) return g
  // a meaning left untagged between the grammar line and the citations ("-end: … the ending of nouns, denoting the agent")
  const loose = cleanMeaning(r.topLoose, proper)
  return isMeaning(loose) && ENGLISH_HINT.test(loose) ? loose : ""
}

/** "see X" for an entry whose only content is a reference ("v. ge-þeódan", "v, beót-háta"). */
function seeGloss(r: BtRaw, nativeOf: (id: string) => string | undefined): string {
  const to = r.links.find((l) => l.inSee) ?? r.links[0]
  if (to) return `see ${nativeOf(to.target) ?? to.label}`
  const m = `${r.see} ${r.grammar} ${r.topDef}`.match(/(?:^|[\s(;,])v[.,]\s+((?:\p{L}[\p{L}\p{M}]*-?)+)/u)
  return m ? `see ${btNative(m[1]!)}` : ""
}

function sensesOf(r: BtRaw, label?: string): SeedSense[] {
  const out: SeedSense[] = []
  const examples = (xs: Example[]) => xs.slice(0, 2).map(exampleText).filter(Boolean).join(" | ")
  const topGloss = meaningOf(r.topEquiv, r.topItalics, r.topDef, false) || cleanMeaning(r.topDef)
  const domain = (path?: string) => [label, path ? `sense ${path}` : ""].filter(Boolean).join(", ") || undefined
  if (topGloss || (!r.senses.length && r.examples.length)) {
    const full = tidy(r.topDef)
    const ex = examples(r.examples)
    const definition = [full.length > topGloss.length + 3 ? full : "", ex].filter(Boolean).join(" — ")
    out.push({ gloss: truncate(topGloss || "further citations", 200), definition: definition ? truncate(definition, 600) : undefined, domain: domain() })
  }
  for (const s of r.senses) {
    const g = senseGloss(s)
    const ex = examples(s.examples)
    if (!g && !ex) continue
    const full = tidy(s.text)
    const definition = [full.length > g.length + 3 ? full : "", ex].filter(Boolean).join(" — ")
    out.push({ gloss: truncate(g || "citations", 200), definition: definition ? truncate(definition, 600) : undefined, domain: domain(s.path) })
  }
  return out
}

function convert(main: BtRaw, supplements: BtRaw[], deleted: boolean, nativeOf: (id: string) => string | undefined): SeedEntry | null {
  const { form, alternatives } = baseSpelling(main.orth)
  const headword = stripMarks(form)
  if (!/\p{L}/u.test(headword)) return null
  const native = macronize(form)

  const proper = /^\p{Lu}/u.test(headword)
  const gloss0 = firstMeaning(main, proper) || supplements.map((s) => firstMeaning(s, proper)).find(Boolean) || seeGloss(main, nativeOf)
  if (!gloss0) return null
  const gloss = truncate(gloss0, 120)

  const senses = sensesOf(main)
  for (const s of supplements) senses.push(...sensesOf(s, s.section === "addenda" ? "Supplement addenda" : "Supplement"))

  const mainEtym = bracketEtymology(main)
  const etymology = uniq([mainEtym, ...supplements.map((s) => bracketEtymology(s)).filter((e) => e && e !== mainEtym).map((e) => `Supplement: ${e}`)])
    .filter(Boolean)
    .join(" ")

  const notes: string[] = []
  const g = grammarNote(main)
  notes.push(`Bosworth–Toller: ${main.orth}${g ? `, ${truncate(g, 300)}` : ""}.`.replace(/\.\.$/, "."))
  const grammar = uniq([...main.subc.filter((x) => x !== "uncertain"), ...main.gen, ...main.pos.filter((p) => p !== "unknown")]).join(" ")
  if (grammar) notes.push(`Grammar: ${grammar}.`)
  const variants = uniq([...main.variants, ...alternatives].map((v) => v.trim()).filter((v) => v && strictKey(v) !== strictKey(main.orth)))
  if (variants.length) notes.push(`Variant forms: ${variants.join(", ")}.`)
  for (const s of supplements) {
    const what = /substitute/.test(s.edit) || s.flags.substitute ? "substitutes" : /dele/.test(s.edit) || s.flags.delete ? "corrects" : "adds to"
    notes.push(`${s.section === "addenda" ? "Supplement Addenda" : "Supplement"} (1921) ${what} this entry: https://bosworthtoller.com/${s.id}.`)
  }
  if (deleted) notes.push("Toller's Supplement (1921) deletes this entry.")
  notes.push(`${main.section === "main" ? "Main Volume (1898)" : main.section === "addenda" ? "Supplement Addenda (1921)" : "Supplement (1921)"}: https://bosworthtoller.com/${main.id}`)

  const fullDefs = [main.topDef, ...main.senses.map((s) => (s.path ? `${s.path}. ${tidy(s.text)}` : tidy(s.text)))].map(tidy).filter(Boolean)
  const definitionText = fullDefs.join(" ")
  const base = {
    headword,
    native: native !== headword ? native : undefined,
    pos: guessPos(main, headword) ?? supplements.map((s) => guessPos(s, headword)).find(Boolean),
    gloss,
    definition: definitionText.length > gloss.length + 10 ? truncate(definitionText, 1500) : undefined,
    etymology: etymology ? truncate(etymology, 1500) : undefined,
    notes: notes.join(" "),
    ref: String(main.id),
    senses: senses.slice(0, 30),
  }
  if (/^-/.test(headword)) return { kind: "part", partKind: "suffix", ...base, pos: undefined }
  if (/\p{L}-$/u.test(headword)) return { kind: "part", partKind: "prefix", ...base, pos: undefined }
  return { kind: "word", ...base }
}

/* ── Supplement → Main Volume ─────────────────────────────────────────────── */

const STOP = new Set("the and for with from into that this than are was were has have had one who which what add dele substitute also".split(" "))
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))

function makeMainIndex(mains: BtRaw[]) {
  const strict = new Map<string, BtRaw[]>()
  const loose = new Map<string, BtRaw[]>()
  for (const r of mains) {
    for (const [map, k] of [
      [strict, strictKey(r.orth)],
      [loose, looseKey(r.orth)],
    ] as const) {
      const list = map.get(k) ?? []
      list.push(r)
      map.set(k, list)
    }
  }
  return (s: BtRaw): { main?: BtRaw; ambiguous?: boolean } => {
    let cands = strict.get(strictKey(s.orth)) ?? []
    if (!cands.length) cands = loose.get(looseKey(s.orth)) ?? []
    if (cands.length <= 1) return { main: cands[0] }
    // an unlabelled addition belongs to the one real article among pointer stubs ("word" n. vs "word" v. wyrd)
    const articles = cands.filter((c) => !isPointer(c))
    if (articles.length === 1 && !s.pos.length && !s.gen.length) return { main: articles[0] }
    const sw = words(s.text.slice(0, 160))
    const scored = cands
      .map((c) => {
        const cw = words(`${firstMeaning(c)} ${c.topDef.slice(0, 200)} ${c.senses.map((x) => x.text).join(" ").slice(0, 300)}`)
        const shared = [...sw].filter((w) => cw.has(w)).length
        const pos = s.pos.length && s.pos.some((p) => c.pos.includes(p)) ? 3 : 0
        const gen = s.gen.length && s.gen.some((p) => c.gen.includes(p)) ? 2 : 0
        return { c, score: shared * 2 + pos + gen }
      })
      .sort((a, b) => b.score - a.score)
    if (scored[0]!.score > 0 && scored[0]!.score > scored[1]!.score) return { main: scored[0]!.c }
    return { ambiguous: true }
  }
}

/* ── loading ──────────────────────────────────────────────────────────────── */

export type BtStats = {
  rows: number
  supplementMerged: number
  supplementOwn: number
  supplementAmbiguous: number
  deletions: number
  indexStubs: number
  noGloss: number
  /** A few BT ids of entries skipped for want of a meaning (for the log). */
  noGlossIds: number[]
}

export async function loadBosworthToller(file: string, limit?: number) {
  const csv = await readCached(file)
  const raws: BtRaw[] = []
  let rows = 0
  for (const row of csvRows(csv)) {
    if (row[0] === "id") continue
    const id = Number(row[0])
    if (!Number.isFinite(id) || !row[2]) continue
    rows++
    const r = parseBt(id, row[1] ?? "", row[2])
    if (r) raws.push(r)
  }
  raws.sort((a, b) => a.id - b.id)

  const stats: BtStats = { rows, supplementMerged: 0, supplementOwn: 0, supplementAmbiguous: 0, deletions: 0, indexStubs: 0, noGloss: 0, noGlossIds: [] }
  const mains = raws.filter((r) => r.section === "main")
  const findMain = makeMainIndex(mains.filter((r) => !isIndexStub(r)))
  const supplementsOf = new Map<number, BtRaw[]>()
  const deleted = new Set<number>()
  /** BT id → the id of the entry that carries it (Supplement rows merged into their Main Volume entry). */
  const carrier = new Map<number, number>()
  const own: BtRaw[] = []
  for (const r of raws) {
    if (isIndexStub(r)) {
      stats.indexStubs++
      continue
    }
    if (r.section === "main") {
      own.push(r)
      carrier.set(r.id, r.id)
      continue
    }
    const hit = findMain(r)
    if (isDeletion(r)) {
      stats.deletions++
      if (hit.main) deleted.add(hit.main.id)
      continue
    }
    if (hit.main) {
      stats.supplementMerged++
      supplementsOf.set(hit.main.id, [...(supplementsOf.get(hit.main.id) ?? []), r])
      carrier.set(r.id, hit.main.id)
    } else {
      if (hit.ambiguous) stats.supplementAmbiguous++
      else stats.supplementOwn++
      own.push(r)
      carrier.set(r.id, r.id)
    }
  }

  const byId = new Map(raws.map((r) => [r.id, r]))
  const nativeOf = (id: string) => {
    const r = byId.get(carrier.get(Number(id)) ?? Number(id))
    return r ? btNative(r.orth) : undefined
  }
  const built: Built[] = []
  for (const r of own) {
    if (limit && built.length >= limit) break
    const supplements = supplementsOf.get(r.id) ?? []
    const entry = convert(r, supplements, deleted.has(r.id), nativeOf)
    if (!entry) {
      if (stats.noGlossIds.length < 12) stats.noGlossIds.push(r.id)
      stats.noGloss++
      continue
    }
    built.push({ raw: r, entry, supplements, deleted: deleted.has(r.id) })
  }
  return { built, stats, carrier }
}

/** Relations between the entries of this dictionary, as (from ref, to ref, type). */
export function btRelations(built: Built[], carrier: Map<number, number>) {
  const refs = new Set(built.map((b) => b.entry.ref!))
  const byLoose = new Map<string, string[]>()
  for (const b of built) {
    const k = looseKey(b.raw.orth)
    byLoose.set(k, [...(byLoose.get(k) ?? []), b.entry.ref!])
  }
  const out: { from: string; to: string; type: SeedRelation["type"]; note: string }[] = []
  for (const b of built) {
    const from = b.entry.ref!
    const pointer = isPointer(b.raw)
    const seeLinks = b.raw.links.filter((l) => l.inSee)
    const inflected = /\b(?:pp?|pret|pres|part|inf|imp|subj|gen|dat|acc|nom|pl|sg|sing)\.?\s+(?:of|from)\b/i.test(`${b.raw.topDef} ${b.raw.grammar}`)
    for (const raw of [b.raw, ...b.supplements]) {
      for (const l of raw.links) {
        const to = carrier.get(Number(l.target))
        if (to === undefined || !refs.has(String(to)) || String(to) === from) continue
        const variant = raw === b.raw && pointer && seeLinks.length === 1 && l.inSee && !inflected
        out.push({ from, to: String(to), type: variant ? "variant_of" : "see_also", note: variant ? NOTE_VAR : NOTE_XR })
      }
      // DER. ge-berhtan (under berhtan): the derived word ← derived_from → this entry
      const stem = strictKey(raw.orth).replace(/^-|-$/g, "")
      for (const d of raw.derived) {
        let full = d
        if (/^\p{L}.*-$/u.test(d) && !/^-/.test(raw.orth)) full = `${d}${stem}` // "be-" under beódan → bebeódan
        const cands = (byLoose.get(looseKey(full)) ?? []).filter((x) => x !== from)
        if (cands.length === 1) out.push({ from: cands[0]!, to: from, type: "derived_from", note: NOTE_DER })
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((x) => {
    const k = `${x.from}|${x.to}|${x.type}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function keyToRef(key: string): EntryRef {
  const parts = key.split("|")
  return { lang: parts[0]!, kind: parts[1] as EntryRef["kind"], headword: parts.slice(2, -1).join("|"), homonym: Number(parts.at(-1)) }
}

export const bosworthTollerImporter: Importer = {
  id: "bosworth-toller",
  language: "ang",
  description: "Bosworth–Toller Anglo-Saxon Dictionary + Supplement (Charles University, ~45k entries)",
  async run({ db, log, limit, offline, prune }) {
    const startedAt = new Date()
    const file = await download("bosworth-toller", FILE, URL, { offline, log })
    const { built, stats, carrier } = await loadBosworthToller(file, limit)
    log(
      `${FILE}: ${stats.rows} rows → ${built.length} entries; Supplement/Addenda rows merged into their Main Volume entry ${stats.supplementMerged}, ` +
        `entries of their own ${stats.supplementOwn} (+${stats.supplementAmbiguous} whose homonym was not identified); ` +
        `skipped: ${stats.deletions} "Dele." stubs, ${stats.indexStubs} compound-index stubs, ${stats.noGloss} without a meaning`
    )

    const entries = built.map((b) => b.entry)
    const idByKey = new Map<string, string>()
    const keyOfRef = new Map<string, string>()
    for (const slice of chunk(entries, 5000)) {
      const dataset: SeedDataset = { language: oldEnglishLanguage, source: bosworthTollerSource, entries: slice }
      const result = await upsertDataset(db, dataset, { log, batchSize: 250 })
      for (const [k, v] of result.idByKey) idByKey.set(k, v)
      for (const [k, v] of result.keyOfRef) keyOfRef.set(k, v)
    }
    if (prune && !limit) {
      const stale = await db
        .delete(entriesTable)
        .where(and(eq(entriesTable.sourceId, bosworthTollerSource.id), lt(entriesTable.updatedAt, startedAt)))
        .returning({ id: entriesTable.id })
      log(`pruned ${stale.length} stale entries`)
    }

    const rels: SeedRelation[] = []
    const counts: Record<string, number> = {}
    for (const x of btRelations(built, carrier)) {
      const from = keyOfRef.get(x.from)
      const to = keyOfRef.get(x.to)
      if (!from || !to) continue
      rels.push({ from: keyToRef(from), to: keyToRef(to), type: x.type, confidence: x.type === "see_also" ? "likely" : "certain", note: x.note })
      counts[x.type] = (counts[x.type] ?? 0) + 1
    }
    log(`relations: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`)
    if (!limit) {
      // this importer owns these relations: clear them so links that no longer resolve disappear
      const ownIds = db.select({ id: entriesTable.id }).from(entriesTable).where(eq(entriesTable.sourceId, bosworthTollerSource.id))
      await db.delete(entryRelations).where(and(inArray(entryRelations.note, OWN_NOTES), inArray(entryRelations.fromEntryId, ownIds)))
    }
    await upsertRelations(db, rels, idByKey, { log, batchSize: 500 })
    log(`done — ${entries.length} Bosworth–Toller entries`)
  },
}

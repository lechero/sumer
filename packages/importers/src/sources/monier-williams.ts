/**
 * Monier-Williams, A Sanskrit-English Dictionary (1899), from the source text
 * of the Cologne Digital Sanskrit Dictionaries (csl-orig `v02/mw/mw.txt`:
 * one record per <L> number, Sanskrit in SLP1, pseudo-XML markup). Pinned to
 * a csl-orig commit; ~287k records → ~203k entries.
 *   https://github.com/sanskrit-lexicon/csl-orig/tree/<commit>/v02/mw
 *
 * Conventions (shared with the Wiktionary Sanskrit entries, so the two match):
 *   - headword = native = Devanagari of MW's key1, without accents (अग्नि);
 *     translit = IAST of key2 with MW's Vedic accent (agní, rā́jan, akṣitavyà),
 *     compound hyphens dropped.
 *   - Every record that opens a headword is an entry: MW's four "lines" (e=1
 *     roots and primary words, e=2 derivatives, e=3 compounds, e=4 compounds
 *     of compounds). Continuation records (e=1A …) are its senses; one that
 *     changes the headword (a feminine stem or an adverbial case form, e=1B /
 *     1C) is an entry of its own, derived_from the main one. Alternative
 *     headwords sharing another record's body ({{Lbody=N}}) get that body's
 *     meanings and are synonym_of / variant_of it; e=…E records are etymology.
 *   - Compounds are entries of their own, built from (components) the headword
 *     MW lists them under (first member) and, when it is one unambiguous
 *     headword, their last member.
 *   - Homonyms: MW's homonym numbers (<h>) are the homonym indexes, per kind
 *     and headword; unnumbered homographs take the next free index in
 *     dictionary order.
 *   - Roots (√) are word parts (partKind root: गम्); prefixed verbs (anu-√gam),
 *     denominatives and gati compounds are verbs. derived_from a root comes
 *     from MW's "√ X" / "fr. X" in the etymology, the prefix + root of
 *     prefixed verbs, and the derivatives MW lists under a root.
 *   - gloss = the first meaning (≤ 120 chars, references and grammar labels
 *     dropped, common abbreviations expanded, "˚" completed from the headword
 *     where unambiguous; "id." / "= prec." / "= next" take the neighbouring
 *     entry's meaning); every record / verb sense is a sense; literature
 *     references, page and L number go into notes.
 *   - ref = "L<record id>".
 */
import {
  upsertDataset,
  type Confidence,
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
import { slp1ToDevanagari, slp1ToIast } from "../lib/sanskrit"
import { truncate, uniq } from "../lib/text"
import type { Importer } from "../registry"
import { WIKTIONARY_LANGUAGES } from "./wiktionary"

const COMMIT = "5949ba16ceb2a2164637e7a54acc97de667d3c25" // csl-orig, 2026-10-18
const URL = `https://raw.githubusercontent.com/sanskrit-lexicon/csl-orig/${COMMIT}/v02/mw/mw.txt`
const FILE = `mw-${COMMIT.slice(0, 7)}.txt`
const NOTE = "Monier-Williams"

export const sanskritLanguage = WIKTIONARY_LANGUAGES.find((l) => l.language.id === "san")!.language

export const monierWilliamsSource = {
  id: "monier-williams",
  title: "Monier-Williams, A Sanskrit-English Dictionary (1899), Cologne Digital Sanskrit Dictionaries",
  url: `https://github.com/sanskrit-lexicon/csl-orig/tree/${COMMIT}/v02/mw`,
  license:
    "CC BY-SA 4.0 (csl-orig repository licence since June 2026); the 2014 TEI header of the Cologne edition reads © The Sanskrit Library and Thomas Malten, CC BY-NC-SA 3.0. The 1899 print edition is in the public domain.",
  citation:
    "Monier Monier-Williams, with Ernst Leumann and Carl Cappeller, A Sanskrit-English Dictionary, Etymologically and Philologically Arranged with Special Reference to Cognate Indo-European Languages, new edition (Oxford: Clarendon Press, 1899); digital edition: Cologne Digital Sanskrit Dictionaries (Thomas Malten, Peter M. Scharf, Jim Funderburk et al.), csl-orig commit " +
    `${COMMIT.slice(0, 7)}, https://www.sanskrit-lexicon.uni-koeln.de/.`,
}

/* ── records ──────────────────────────────────────────────────────────────── */

type Info = { lex?: string; verb?: string; cp?: string; parse?: string; lexcat?: string; sup: boolean }

export type MwRecord = {
  L: string
  /** page,column of the 1899 print */
  pc: string
  k1: string
  k2: string
  h?: number
  /** MW's "line": 1 root / primary word, 2 derivative, 3 compound, 4 compound of a compound */
  level: number
  /** "" (opens a headword), A (same gender), B (other gender), C (case form), E (etymology) */
  sub: string
  /** markup before ¦ (the headword line) */
  head: string
  /** markup after ¦ */
  body: string
  /** L of the record whose body this alternative headword shares */
  lbody?: string
  info: Info
}

/** csl-orig's inline correction layer {{old->new||date|author|issue|}} → new. */
const CORRECTION = /\{\{([^{}]*?)->([^{}]*?)\|\|[^{}]*\}\}/g

export function parseRecords(text: string): MwRecord[] {
  const out: MwRecord[] = []
  let meta: Record<string, string> | undefined
  let lines: string[] = []
  for (const line of text.split("\n")) {
    if (line.startsWith("<L>")) {
      meta = Object.fromEntries([...line.matchAll(/<(\w+)>([^<]*)/g)].map((m) => [m[1]!, m[2]!.trim()]))
      lines = []
    } else if (line.startsWith("<LEND>")) {
      if (meta) out.push(toRecord(meta, lines.join("\n")))
      meta = undefined
    } else if (meta) {
      lines.push(line)
    }
  }
  return out
}

function toRecord(meta: Record<string, string>, raw: string): MwRecord {
  const text = raw.replace(CORRECTION, "$2")
  const m = (meta.e ?? "1").match(/^(\d)(\w?)/)
  const cut = text.indexOf("¦")
  const info: Info = { sup: false }
  for (const im of text.matchAll(/<info ([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...im[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]))
    if (attrs.lex && attrs.lex !== "inh") info.lex ??= attrs.lex
    if (attrs.verb) {
      info.verb ??= attrs.verb
      info.cp ??= attrs.cp
      info.parse ??= attrs.parse
    }
    if (attrs.lexcat) info.lexcat ??= attrs.lexcat
    if (attrs.n === "sup") info.sup = true
  }
  return {
    L: meta.L ?? "",
    pc: meta.pc ?? "",
    k1: meta.k1 ?? "",
    k2: meta.k2 ?? meta.k1 ?? "",
    h: meta.h && /^\d+$/.test(meta.h) ? Number(meta.h) : undefined,
    level: Number(m?.[1] ?? 1),
    sub: m?.[2] ?? "",
    head: cut >= 0 ? text.slice(0, cut) : text,
    body: cut >= 0 ? text.slice(cut + 1) : "",
    lbody: text.match(/\{\{Lbody=([\d.]+)\}\}/)?.[1],
    info,
  }
}

/* ── markup → text ────────────────────────────────────────────────────────── */

type Node = { name: string; attrs: Record<string, string>; children: (Node | string)[] }

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g

/** A forgiving tree builder for MW's pseudo-XML (unbalanced closers are ignored). */
function parseMarkup(s: string): Node {
  const root: Node = { name: "#root", attrs: {}, children: [] }
  const stack = [root]
  let last = 0
  for (const m of s.matchAll(TAG)) {
    if (m.index > last) stack.at(-1)!.children.push(s.slice(last, m.index))
    last = m.index + m[0].length
    const [, close, name, attrText, selfClose] = m
    if (close) {
      let at = stack.length - 1
      while (at > 0 && stack[at]!.name !== name) at--
      if (at > 0) stack.length = at
      continue
    }
    const node: Node = {
      name: name!,
      attrs: Object.fromEntries([...(attrText ?? "").matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])),
      children: [],
    }
    stack.at(-1)!.children.push(node)
    if (!selfClose) stack.push(node)
  }
  if (last < s.length) stack.at(-1)!.children.push(s.slice(last))
  return root
}

function rawText(n: Node | string): string {
  if (typeof n === "string") return n
  if (n.name === "srs") return ""
  return n.children.map(rawText).join("")
}

/** Abbreviations expanded in glosses and definitions; grammatical ones (acc., sg., P., Ā., cl., aor. …) stay. */
const AB: Record<string, string> = {
  "N.": "name",
  "wk.": "work",
  "wks.": "works",
  "partic.": "particular",
  "fr.": "from",
  "patr.": "patronymic",
  "patron.": "patronymic",
  "ch.": "chapter",
  "chs.": "chapters",
  "comp.": "compound",
  "Introd.": "introduction",
  "irr.": "irregular",
  "irreg.": "irregular",
  "abstr.": "abstract",
  "math.": "mathematics",
  "g.": "gaṇa",
  "metron.": "metronymic",
  "w.r.": "wrong reading",
  "v.l.": "variant reading",
  "vv.ll.": "variant readings",
  "prob.": "probably",
  "esp.": "especially",
  "accord.": "according",
  "sev.": "several",
  "id.": "the same",
  "Sch.": "scholiast",
  "Comm.": "commentator",
  "Comms.": "commentators",
  "ifc.": "at the end of a compound",
  "ibc.": "at the beginning of a compound",
  "Caus.": "causative",
  "Desid.": "desiderative",
  "Intens.": "intensive",
  "Pass.": "passive",
  "Nom.": "denominative",
  "ind.p.": "indeclinable participle",
  "opp.": "opposed to",
  "lit.": "literally",
  "fig.": "figuratively",
  "astron.": "astronomy",
  "astrol.": "astrology",
  "gram.": "grammar",
  "Gr.": "grammar",
  "phil.": "philosophy",
  "rhet.": "rhetoric",
  "dram.": "drama",
  "med.": "medicine",
  "medic.": "medicine",
  "Buddh.": "Buddhist",
  "superl.": "superlative",
  "compar.": "comparative",
  "impers.": "impersonal",
  "neg.": "negative",
  "onomat.": "onomatopoeic",
  "arithm.": "arithmetic",
  "alg.": "algebra",
  "geom.": "geometry",
  "orig.": "originally",
  "Ved.": "Vedic",
  "Class.": "Classical",
  "ep.": "epic",
}

/** Grammar labels that open a definition and are not part of the meaning. */
const LABEL_AB = new Set(
  (
    "ifc. ibc. cl. P. Ā. Caus. Desid. Intens. Pass. Nom. ind. ind.p. sg. du. pl. acc. loc. gen. dat. abl. instr. nom. voc. " +
    "aor. pf. perf. fut. inf. Impv. impv. Pot. Subj. Prec. impf. p. pp. p.p. pr. pr.p. pr. p. Ved. Class. ep. impers. Sch. Vārtt. " +
    "mc. m.c. comp. superl. compar. g. Pāṇ. ib. Conj. Opt. Cond. Aor. Ben. Perf. Fut. Inf. Desid. Caus. f. m. n. mfn. mf. mn. fn. nf."
  ).split(" ")
)

const LANG: Record<string, string> = {
  "Gk.": "Greek",
  "Lat.": "Latin",
  "Goth.": "Gothic",
  "Got.": "Gothic",
  "Germ.": "German",
  "Eng.": "English",
  "Engl.": "English",
  "Lith.": "Lithuanian",
  "Lit.": "Lithuanian",
  "Slav.": "Slavonic",
  "Zd.": "Zend",
  "Ved.": "Vedic",
  "Class.": "Classical",
  "class.": "Classical",
  "ep.": "epic",
  "Angl.Sax.": "Anglo-Saxon",
  "Old Germ.": "Old German",
  "Mod. Germ.": "Modern German",
  "Old High Germ.": "Old High German",
  "O. H. G.": "Old High German",
  "HGerm.": "High German",
  "Hib.": "Irish",
  "Pers.": "Persian",
  "Prākṛ.": "Prākṛt",
  "Arab.": "Arabic",
  "Russ.": "Russian",
  "Armen.": "Armenian",
  "Old Sax.": "Old Saxon",
  "Old Pruss.": "Old Prussian",
  "Old Pers.": "Old Persian",
  "Hind.": "Hindī",
  "Aeol.": "Aeolic",
  "Cambro-Brit.": "Welsh",
}

/** Markers in the "plain" rendering: \u0002label\u0003 (a grammar label), \u0001name\u0001 (a sense division), \u0004 (a dropped reference). */
const L_OPEN = "\u0002"
const L_CLOSE = "\u0003"
const DIV = "\u0001"
const REF = "\u0004"

type RenderOpts = { refs: boolean; labels: boolean }

function render(n: Node | string, o: RenderOpts, refs: string[]): string {
  if (typeof n === "string") return n
  const inner = () => n.children.map((c) => render(c, o, refs)).join("")
  switch (n.name) {
    case "s":
      return slp1ToIast(rawText(n))
    case "hom":
      return rawText(n)
    case "ab": {
      const t = rawText(n).trim()
      const out = n.attrs.n ?? AB[t] ?? t
      return o.labels && LABEL_AB.has(t) && !n.attrs.n ? `${L_OPEN}${out}${L_CLOSE}` : out
    }
    case "lex": {
      const t = inner()
      return o.labels ? `${L_OPEN}${t}${L_CLOSE}` : t
    }
    case "ls": {
      const t = `${n.attrs.n ? `${n.attrs.n} ` : ""}${rawText(n)}`.replace(/\s+/g, " ").trim()
      if (t) refs.push(t)
      return o.refs ? t : o.labels ? `${REF}${t}${REF}` : ""
    }
    case "lang": {
      const t = rawText(n).trim()
      return LANG[t] ?? n.attrs.n ?? t
    }
    case "chg":
      return n.children
        .filter((c): c is Node => typeof c !== "string" && c.name === "new")
        .map((c) => render(c, o, refs))
        .join("")
    case "old":
      return ""
    case "div":
      return `${DIV}${n.attrs.n ?? ""}${DIV}`
    case "info":
    case "listinfo":
    case "srs":
    case "pb":
      return ""
    case "br":
      return " "
    default:
      return inner()
  }
}

/** Collapse whitespace and the punctuation left behind by dropped references. */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/&c\.?/g, "")
    .replace(/\(\s*[,;:.]*\s*\)/g, "")
    .replace(/\((?=[^)]*[,;:])[\s\d,;:.]*\)/g, "")
    .replace(/\[\s*[,;:.]*\s*\]/g, "")
    .replace(/[,;:]\s*([)\]])/g, "$1")
    .replace(/\s+([,;:.)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/** Remove the markers of the plain rendering (keeping the labels' text). */
const unmark = (s: string) =>
  s
    .replace(new RegExp(`${REF}[^${REF}]*${REF}`, "g"), "")
    .replace(new RegExp(`[${L_OPEN}${L_CLOSE}]`, "g"), "").replace(new RegExp(`${DIV}[^${DIV}]*${DIV}`, "g"), " ")

const BALANCED_PAREN = /^\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/
const BALANCED_BRACKET = /^\[(?:[^[\]]|\[(?:[^[\]]|\[[^[\]]*\])*\])*\]/
const LEADING_LABEL = new RegExp(`^${L_OPEN}[^${L_CLOSE}]*${L_CLOSE}`)

/** Drop what precedes the meaning: grammar labels, class numbers, parenthesised notes, bracketed cognates. Returns the parentheticals removed. */
function stripLead(s: string): { rest: string; removed: string[] } {
  let t = s
  const removed: string[] = []
  for (;;) {
    const before = t
    t = t.replace(/^[\s,;:.—–-]+/, "")
    t = t.replace(/^\u0004[^\u0004]*\u0004/, "")
    t = t.replace(LEADING_LABEL, "")
    t = t.replace(/^\d+\.(?=\s|$)/, "")
    t = t.replace(/^(?:or|and|also)\s+(?=\u0002)/, "")
    const p = t.match(BALANCED_PAREN) ?? t.match(BALANCED_BRACKET)
    if (p) {
      removed.push(p[0].slice(1, -1))
      t = t.slice(p[0].length)
    }
    if (t === before) return { rest: t, removed }
  }
}

/** Up to the first ; outside brackets, or the first reference once a meaning has begun ("a father, RV. (in the Veda …)" → "a father, "). */
function firstClause(s: string): string {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1)
    else if (c === ";" && depth === 0) return s.slice(0, i)
    else if (c === REF && depth === 0 && /\p{L}{2}/u.test(unmark(s.slice(0, i)))) return s.slice(0, i)
    else if (c === REF) i = s.indexOf(REF, i + 1) // skip the reference's text
  }
  return s
}

/** Labels that belong to a dropped reference ("Pāṇ. iii, 1, 11, Sch.", "MBh.; ib."). */
const REF_LABEL = new RegExp(`(?:^|[,;]\\s*)${L_OPEN}(?:scholiast|commentator|Vārtt\\.|ib\\.)${L_CLOSE}`, "g")
const AFTER_REF_LABEL = new RegExp(`(${REF}[^${REF}]*${REF})[,;]?\\s*${L_OPEN}?(?:scholiast|commentator|Vārtt\\.|ib\\.)${L_CLOSE}?`, "g")
const dropRefLabels = (s: string) => s.replace(AFTER_REF_LABEL, "$1").replace(REF_LABEL, "")

/** Trailing punctuation, keeping the period of a final abbreviation (q.v., e.g., cf.). */
export function trimEnd(s: string): string {
  const t = s.replace(/[\s,;:—–-]+$/, "")
  if (/(?:^|\s)\S*\p{L}\.\p{L}+\.$|\b(?:cf|viz|etc|scil|sc|ib|id|ff|ind|comp)\.$/u.test(t)) return t
  return t.replace(/[\s.,;:—–-]+$/, "")
}

/** Where a verb's meaning starts: the first "to …" outside brackets (not "according to Gr. asāvīt" in a note), else the first at all. */
function firstToAtDepth0(t: string): number {
  let first = -1
  for (const m of t.matchAll(/(?:^|[\s,;:(‘])to [a-z]/g)) {
    if (/\baccord(?:ing|\.)?[\s\u0002\u0003]*$/.test(unmark(t.slice(0, m.index + 1)))) continue // "accord. to Gr. asāvīt"
    if (first < 0) first = m.index
    let depth = 0
    for (let i = 0; i < m.index; i++) {
      const c = t[i]
      if (c === "(" || c === "[") depth++
      else if (c === ")" || c === "]") depth = Math.max(0, depth - 1)
    }
    if (depth === 0) return m.index
  }
  return first
}

/** The meaning in a stretch of plain-rendered text: "m. (√ ag, Uṇ.) fire, sacrificial fire …" → "fire, sacrificial fire …". */
function meaning(plain: string, verb: boolean): string {
  let t = stripLead(dropRefLabels(plain)).rest
  if (verb) {
    // conjugation first ("cl. 1. P. gacchati …"): the meaning starts at the first "to …"
    const at = firstToAtDepth0(t)
    if (at > 0) t = t.slice(at).replace(/^[\s,;:(]+/, "")
    if (t.startsWith("‘")) t = t.replace(/[‘’]/g, "") // "kūlati, ‘to cover, hide’, or ‘to keep off’"
  }
  // "…, Comm. on Mn. ii, 125" and "(Comm.)" are references too
  t = t
    .replace(new RegExp(`[,;]?\\s*${L_OPEN}?(?:commentator|scholiast)${L_CLOSE}?\\s+(?:on|to|ad)\\s+${REF}[^${REF}]*${REF}`, "g"), `${REF}${REF}`)
    .replace(new RegExp(`\\s*\\((?:according to )?(?:the )?${L_OPEN}?(?:commentator|scholiast)${L_CLOSE}?s?\\)`, "g"), "")
  // a reference that is the object of the meaning stays: "name of a chapter of Pañcat.", "a gaṇa of Pāṇ."
  t = t.replace(new RegExp(`${REF}([^${REF}]*)${REF}`, "g"), (m, ref: string, at: number, all: string) =>
    /(?:\b(?:of|in|by|with|to|from|at|on|under|see|See|cf\.|and|or)|=)\s*$/.test(unmark(all.slice(0, at))) ? ref : m
  )
  t = firstClause(t)
    .replace(new RegExp(`\\bin\\s+${L_OPEN}(compounds?)${L_CLOSE}`, "g"), "in $1")
    .replace(new RegExp(`(?<=\\p{L}[.)]?)[,;]?\\s+${L_OPEN}?(?:commentator|scholiast)${L_CLOSE}?(?=\\s*(?:[),;]|$))`, "gu"), "")
    .replace(new RegExp(`(?:[\\s,;.]*${L_OPEN}[^${L_CLOSE}]*${L_CLOSE})+[\\s,;.]*$`), "") // trailing labels
  t = unmark(t).replace(/^=\s*/, "same as ")
  t = t.replace(/\[(?:[^[\]]|\[[^[\]]*\])*\]/g, "") // cognates, Sanskrit examples
  t = trimEnd(tidy(t)).replace(/^‘(.*)’$/, "$1")
  return t.replace(/\bname of (works?)\b/, (_, w: string) => (w === "work" ? "name of a work" : "name of works")).replace(/\b(of|in) (a|the) commentator\b/g, "$1 $2 commentary").replace(/\bname of author\b/, "name of an author")
}

type Segment = { div: string; plain: string; full: string; marked: string }

/** Split a record body at its <div> markers (verb senses, paragraph breaks), in three renderings. */
function segments(markup: string, refs: string[]): Segment[] {
  const tree = parseMarkup(markup)
  const split = (s: string) => {
    const parts: { div: string; text: string }[] = []
    let div = ""
    let at = 0
    for (const m of s.matchAll(new RegExp(`${DIV}([^${DIV}]*)${DIV}`, "g"))) {
      parts.push({ div, text: s.slice(at, m.index) })
      div = m[1]!
      at = m.index + m[0].length
    }
    parts.push({ div, text: s.slice(at) })
    return parts
  }
  const plain = split(render(tree, { refs: false, labels: true }, refs)) // the meaning: no references, labels marked
  const full = split(render(tree, { refs: true, labels: false }, [])) // what MW prints
  const marked = split(render(tree, { refs: true, labels: true }, [])) // with references, labels marked
  return plain.map((x, i) => ({ div: x.div, plain: x.text, full: tidy(full[i]?.text ?? ""), marked: marked[i]?.text ?? "" }))
}

/* ── entries ──────────────────────────────────────────────────────────────── */

type MwEntry = {
  ref: string
  k1: string
  k2: string
  h?: number
  level: number
  recs: MwRecord[]
  etym: MwRecord[]
  /** for a headword-changing continuation: the entry it is listed under */
  mainOf?: MwEntry
  /** for an alternative headword: the entry whose body it shares */
  lbodyOf?: MwEntry
  /** for compounds: the headword they are listed under, and their last member */
  firstMember?: MwEntry
  lastMemberKey?: string
  /** for derivatives (e=2): the root they are listed under */
  underRoot?: MwEntry
  // computed
  kind?: "word" | "part"
  partKind?: PartKind
  pos?: PartOfSpeech
  headword?: string
  homonym?: number
  seed?: SeedEntry
}

const unaccent = (slp1: string) => slp1.replace(/[/^\\]/g, "")
/** The first of several accentuations ("a/-cyuta; a-cyuta/"). */
const firstK2 = (k2: string) => k2.split(";")[0]!.trim()
const isRoot = (r: MwRecord) => r.info.verb === "genuineroot" || r.info.verb === "root"

/** Group records into entries and record MW's hierarchy (compound → first member, derivative → root). */
export function groupEntries(recs: MwRecord[]): MwEntry[] {
  const entries: MwEntry[] = []
  const byL = new Map<string, MwEntry>()
  let group: MwEntry[] = []
  let l12: MwEntry[] = [] // e=1 / e=2 heads since the last e=1
  let l3: MwEntry[] = [] // e=3 heads since the last e=1 / e=2
  let lastL1: MwEntry | undefined
  const pendingLbody: [MwEntry, string][] = []

  const open = (r: MwRecord, mainOf?: MwEntry): MwEntry => {
    const e: MwEntry = { ref: `L${r.L}`, k1: r.k1, k2: firstK2(r.k2), h: mainOf ? undefined : r.h, level: r.level, recs: [r], etym: [], mainOf }
    entries.push(e)
    if (r.lbody) pendingLbody.push([e, r.lbody])
    return e
  }

  for (const r of recs) {
    if (!r.k1) continue
    if (!r.sub) {
      const e = open(r)
      byL.set(r.L, e)
      group = [e]
      const members = unaccent(e.k2).split("—")
      if (r.level <= 2) {
        if (r.level === 1) {
          l12 = []
          lastL1 = e
        } else if (lastL1 && isRoot(lastL1.recs[0]!)) {
          e.underRoot = lastL1
        }
        l12.push(e)
        l3 = []
      } else {
        const pool = r.level === 3 ? l12 : l3
        const first = members.slice(0, -1).join("").replace(/-/g, "")
        let parent: MwEntry | undefined
        for (let i = pool.length - 1; first && i >= 0 && !parent; i--) if (pool[i]!.k1 === first) parent = pool[i]
        // sandhi-joined compounds (aṃśāṃśa) have no member boundary: the headword they are listed under
        const near = pool.at(-1)
        if (!parent && near && near.k1.length > 1 && r.k1.startsWith(near.k1.slice(0, Math.max(2, near.k1.length - 1)))) parent = near
        e.firstMember = parent
        if (members.length > 1) e.lastMemberKey = members.at(-1)!.replace(/-/g, "")
        if (r.level === 3) l3.push(e)
      }
      continue
    }
    if (!group.length) continue
    if (r.sub === "E") {
      ;(group.find((g) => g.k1 === r.k1) ?? group[0]!).etym.push(r)
      continue
    }
    let target = group.find((g) => g.k1 === r.k1)
    if (!target) {
      target = open(r, group[0])
      group.push(target)
    } else {
      target.recs.push(r)
    }
    byL.set(r.L, target)
  }
  for (const [e, L] of pendingLbody) {
    const target = byL.get(L)
    if (target && target !== e) e.lbodyOf = target
  }
  return entries
}

/* ── part of speech ───────────────────────────────────────────────────────── */

const SPECIES =
  /^name of (?:a |an |the |various |several |two |three |some |certain |any |one )?(?:kind|sort|species|plants?|trees?|shrubs?|grass(?:es)?|herbs?|creepers?|birds?|fish(?:es)?|animals?|insects?|snakes?|serpents?|worms?|diseases?|metres?|meters?|measures?|weights?|coins?|gems?|jewels?|medicines?|drugs?|perfumes?|minerals?|fruits?|flowers?|particular|musical|modes?|rāgas?|tunes?|melod(?:y|ies)|chants?|magical|charms?|spells?|formulas?|weapons?|vessels?|ceremon(?:y|ies)|rites?|sacrifices?|offerings?|days?|months?|years?|seasons?|stars?|constellations?|lunar|asterisms?|verses?|hymns?|sāmans?|figures?|postures?|positions?|dances?|games?)\b/i

function classify(e: MwEntry, gloss: string): { kind: "word" | "part"; partKind?: PartKind; pos?: PartOfSpeech } {
  const r = e.recs[0]!
  const info = r.info
  if (!e.mainOf && !e.lbodyOf && isRoot(r)) return { kind: "part", partKind: "root" }
  if (info.verb === "pre" || info.verb === "gati" || info.verb === "nom") return { kind: "word", pos: "verb" }
  if (/^(?:a )?prefix\b/i.test(gloss) && !e.mainOf) return { kind: "part", partKind: "prefix" }
  const lexcat = info.lexcat?.match(/LEXID=(\w+)/)?.[1]
  if (lexcat === "pron") return { kind: "word", pos: "pronoun" }
  if (lexcat === "card") return { kind: "word", pos: "numeral" }
  const lex = info.lex ?? (e.lbodyOf ? e.lbodyOf.recs[0]!.info.lex : undefined)
  if (lex === "ind") {
    if (/\bind(?:eclinable)? ?p(?:articiple|\.)/.test(r.body) || /^having\b/.test(gloss)) return { kind: "word", pos: "verb" }
    if (/^(?:an? )?(?:interj|exclamation)|^(?:ah|oh|alas|ho|fie|hail|hurrah)\b/i.test(gloss)) return { kind: "word", pos: "interjection" }
    if (/\b(?:particle|enclitic)\b/i.test(gloss)) return { kind: "word", pos: "particle" }
    if (/^(?:and|or|but|if|because|although|that|when|while|as if|either|neither|nor)\b/i.test(gloss)) return { kind: "word", pos: "conjunction" }
    return { kind: "word", pos: "adverb" }
  }
  if (lex) {
    const genders = new Set(lex.split(":").map((g) => g.split("#")[0]))
    if (lexcat === "prap" || lexcat === "fap" || (genders.has("m") && genders.has("n") && (genders.has("f") || lex.includes("#")))) {
      return { kind: "word", pos: "adjective" }
    }
    const proper = /^(?:name of\b|patronymic|metronymic)/i.test(gloss) && !SPECIES.test(gloss)
    return { kind: "word", pos: proper ? "proper_noun" : "noun" }
  }
  if (/^to [a-z]/.test(gloss)) return { kind: "word", pos: "verb" }
  return { kind: "word", pos: "other" }
}

/* ── conversion ───────────────────────────────────────────────────────────── */

const VERB_DOMAIN: Record<string, string> = {
  causative: "causative",
  desiderative: "desiderative",
  intensive: "intensive",
  passive: "passive",
  denominative: "denominative",
}

const PLAIN: RenderOpts = { refs: false, labels: true }

/** A label such as "Caus." at the head of a verbal paragraph. */
function paragraphLabel(plain: string): string | undefined {
  const words: string[] = []
  for (const m of plain.matchAll(new RegExp(`${L_OPEN}([^${L_CLOSE}]*)${L_CLOSE}`, "g"))) {
    const w = m[1]!.toLowerCase()
    if (VERB_DOMAIN[w]) words.push(VERB_DOMAIN[w]!)
    if (words.length >= 2) break
  }
  return words.length ? uniq(words).join(" ") : undefined
}

type Built = { gloss: string; senses: SeedSense[]; definition?: string; refs: string[]; etymBits: string[]; headLex?: string }

/** Parentheticals before the meaning that are etymology: "(√ ag, Uṇ.)", "(fr. 3. div)", "[cf. Lat. ignis]". */
const ETYM_HINT = /√|\bfrom\b|\bGreek\b|\bLatin\b|\bZend\b|\bGothic\b|\bLithuanian\b|\bGerman\b|\bEnglish\b/

function buildSenses(e: MwEntry, verb: boolean): Built {
  const senses: SeedSense[] = []
  const refs: string[] = []
  const etymBits: string[] = []
  let definition: string | undefined
  let headLex: string | undefined
  let verbLabel: string | undefined
  let section: string | undefined // gender of the current e=…B section
  const hasTo = (plain: string) => firstToAtDepth0(stripLead(plain).rest) >= 0
  e.recs.forEach((r, ri) => {
    if (ri > 0) {
      if (r.sub === "B" && r.info.lex) section = GENDER[r.info.lex.split(":").map((g) => g.split("#")[0]).join("")] ?? section
      else if (r.sub !== "B") section = undefined
    }
    const segs = segments(r.body, refs)
    segs.forEach((seg, si) => {
      if (ri === 0 && si === 0) {
        definition = seg.full
        for (const p of stripLead(seg.marked).removed) {
          const t = tidy(unmark(p))
          if (ETYM_HINT.test(t)) etymBits.push(t)
        }
        headLex = seg.plain.match(new RegExp(`^\\s*${L_OPEN}([^${L_CLOSE}]*)${L_CLOSE}`))?.[1]
      }
      if (seg.div === "vp") {
        verbLabel = paragraphLabel(seg.plain) ?? verbLabel
        // a paragraph label can carry its own first meaning ("Intens. Ā. -nenīyáte, to bring forward")
        if (!hasTo(seg.plain)) return
      }
      // a verb's conjugation comes before its first "to …"
      if (verb && si === 0 && segs.length > 1 && !hasTo(seg.plain)) return
      const g = meaning(seg.plain, verb)
      if (!g || !/\p{L}/u.test(g)) return
      senses.push({
        gloss: truncate(g, 200),
        definition: seg.full.length > g.length + 10 ? truncate(seg.full, 600) : undefined,
        domain: verb ? verbLabel : r.sub === "B" ? section : undefined,
      })
    })
  })
  const gloss = senses[0]?.gloss ?? ""
  return { gloss: truncate(gloss, 118), senses: senses.slice(0, 40), definition, refs: uniq(refs), etymBits, headLex }
}

const GENDER: Record<string, string> = { m: "masculine", f: "feminine", n: "neuter", mn: "masculine or neuter", mf: "masculine or feminine", fn: "feminine or neuter" }

/** "(P. -karoti), to make …" style stubs that only point elsewhere: "See 2. kṣam", "= agnihotra". */
function stubGloss(e: MwEntry): string {
  const r = e.recs[0]!
  const plain = dropRefLabels(render(parseMarkup(r.body), PLAIN, []))
  const { rest, removed } = stripLead(plain)
  // nothing but labels and a note: "mfn. (fr. veman), Pāṇ. …" → "from veman"
  const t = /\p{L}{2}/u.test(unmark(rest)) ? tidy(unmark(rest)) : tidy(unmark(removed.join("; ")))
  return truncate(trimEnd(t.replace(/^[\s,;:.]+/, "")) || tidy(unmark(plain)), 118)
}

function headAlternatives(r: MwRecord, self: string): string[] {
  const alts: string[] = []
  for (const m of r.head.matchAll(/<s>([^<]*(?:<srs\/>[^<]*)*)<\/s>/g)) {
    const slp = m[1]!.replace(/<srs\/>/g, "")
    const plain = unaccent(slp).replace(/[-—\s]/g, "")
    if (!plain || plain === self || /^[-˚]/.test(slp) || slp.includes("√")) continue
    alts.push(slp1ToIast(slp).replace(/[—]/g, "-"))
  }
  return uniq(alts)
}

/** Sanskrit with SLP1 sentinels («…») and homonym numbers kept, for spotting roots in the markup. */
function sentinelText(markup: string): string {
  return markup
    .replace(/<hom>(\d+)\.<\/hom>/g, "$1.")
    .replace(/<s>([^<]*(?:<srs\/>[^<]*)*)<\/s>/g, (_, s: string) => `«${s.replace(/<srs\/>/g, "")}»`)
    .replace(/<ab>fr\.<\/ab>/g, "fr.")
    .replace(/<[^>]+>/g, "")
}

type RootMention = { k1: string; h?: number; viaFrom: boolean; hedged: boolean }

/** "(√ ag, Uṇ.)", "(probably fr. √ 1. aś …)", "(fr. 3. div)" among the parentheticals before the meaning. */
function etymologyMention(r: MwRecord): RootMention | undefined {
  let t = sentinelText(r.body)
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(?:\s|,|\d+\.|\b(?:mfn|mf|mn|fn|nf|nm|m|f|n|ind|ifc|ibc)\.|\b[mfn]{0,3}\([^()]*\)[mfn]{0,2}\.)*/, "")
    const p = t.match(BALANCED_PAREN) ?? t.match(BALANCED_BRACKET)
    if (!p) return undefined
    const m = p[0].match(/(√|\bfr\.)\s*(?:(\d+)\.\s*)?«?\s*([A-Za-z|~'/^\\]+)/)
    if (m) {
      const k1 = unaccent(m[3]!).replace(/-$/, "")
      if (!k1) return undefined
      const hedged = /\b(?:probably|perhaps|prob\.|possibly)\b|\?/.test(p[0].slice(0, m.index))
      return { k1, h: m[2] ? Number(m[2]) : undefined, viaFrom: m[1] !== "√", hedged }
    }
    t = t.slice(p[0].length)
  }
  return undefined
}

/** The root of a prefixed verb / gati compound: "ati-√ 2. div" (head line), else the last member of parse="ati+div". */
function verbRoot(r: MwRecord): RootMention | undefined {
  const t = sentinelText(r.head)
  const m = t.match(/√\s*(?:(\d+)\.\s*)?«?\s*([A-Za-z|~'/^\\]+)/)
  const fromParse = r.info.parse?.split("+").at(-1)
  const k1 = m ? unaccent(m[2]!) : fromParse
  if (!k1) return undefined
  return { k1, h: m?.[1] ? Number(m[1]) : undefined, viaFrom: false, hedged: false }
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]!
}

type Rel = { from: MwEntry; to: MwEntry; type: RelationType; confidence: Confidence; note: string }

/**
 * Expand MW's "˚" (the start of the headword left out) where the overlap is
 * unambiguous: under tṛṇāśana "= ˚ṇāda" → "= tṛṇāda", under dharma "˚man" → "dharman".
 * Abbreviations of a name ("D˚") and overlaps of one letter are left alone.
 */
export function expandDegree(text: string, head: string): string {
  if (!text.includes("˚")) return text
  return text.replace(/(^|[\s(‘"-])˚([\p{L}\p{M}]+)/gu, (m, pre: string, after: string) => {
    let best = -1
    let bestLen = 1
    for (let i = 1; i < head.length; i++) {
      let n = 0
      while (n < after.length && i + n < head.length && head[i + n] === after[n]) n++
      if (n > bestLen) {
        best = i
        bestLen = n
      }
    }
    return best > 0 ? `${pre}${head.slice(0, best)}${after}` : m
  })
}

const plainK2 = (e: MwEntry) => slp1ToIast(unaccent(e.k2).replace(/[-—]/g, ""))
/** A gloss that is only a grammar label: "n.", "f.,", "mfn.", "ind." */
const labelOnly = (g: string) => !/\p{L}{3}/u.test(g.replace(/\b(?:ind|mfn|mf|am|in|only)\b/g, ""))
const ABSTRACT = /^(.+)[—-](?:tva|tA|tvana)$/

/**
 * Glosses that point at a neighbour: "id." / "= prec." take the meaning of the
 * entry before, "= next" the one after; "-tā f." / "-tva n." with no meaning
 * are abstract nouns of their base; other bare labels point at their main entry.
 */
function resolvePointers(order: MwEntry[], built: Map<MwEntry, Built>) {
  const real = (b: Built) => !!b.gloss && !labelOnly(b.gloss) && !/^(?:the same|same as (?:prec|next))$/.test(b.gloss)
  const take = (b: Built, from: MwEntry) => {
    const g = built.get(from)!.gloss
    b.gloss = g
    if (b.senses[0]) b.senses[0] = { ...b.senses[0], gloss: g, definition: `the same as ${plainK2(from)}` }
  }
  let prev: MwEntry | undefined
  const pendingNext: Built[] = []
  for (const e of order) {
    const b = built.get(e)!
    if (b.gloss === "the same" || b.gloss === "same as prec") {
      if (prev) take(b, prev)
    } else if (b.gloss === "same as next") {
      pendingNext.push(b)
    } else if (b.gloss === "?") {
      b.gloss = "meaning uncertain"
    } else if (b.gloss && labelOnly(b.gloss)) {
      // no meaning given: an abstract noun, a transparent compound, or a form of its main entry
      const m = e.k2.match(ABSTRACT)
      const members = unaccent(e.k2).split("—")
      if (m) b.gloss = `abstract noun from ${slp1ToIast(unaccent(m[1]!).replace(/[-—]/g, ""))}`
      else if (members.length > 1) b.gloss = `compound of ${members.map((x) => slp1ToIast(x.replace(/-/g, ""))).join(" + ")}`
      else if (e.mainOf) b.gloss = `see ${plainK2(e.mainOf)}`
    }
    if (real(b)) {
      for (const p of pendingNext.splice(0)) take(p, e)
      prev = e
    }
  }
}

export function convertMonierWilliams(entries: MwEntry[]): { seeds: SeedEntry[]; rels: Rel[]; skipped: number } {
  // 1. meanings, kind and part of speech
  const built = new Map<MwEntry, Built>()
  const order: MwEntry[] = []
  for (const e of entries) {
    if (e.lbodyOf) continue
    const r = e.recs[0]!
    const verbish = !!r.info.verb || /^\s*(?:<[^>]+>\s*)*(?:<ab>cl\.<\/ab>|<s>[^<]*√)/.test(r.body + r.head)
    const b = buildSenses(e, verbish)
    // section headers ("su ¦ (to be similarly prefixed to the following) :") are not entries
    if (/similarly prefixed to the following/.test(r.body) && r.body.length < 200) b.gloss = ""
    else if (!b.gloss) b.gloss = stubGloss(e)
    built.set(e, b)
    order.push(e)
  }
  resolvePointers(order, built)
  for (const e of order) Object.assign(e, classify(e, built.get(e)!.gloss))
  for (const e of entries) {
    if (!e.lbodyOf) continue
    const target = built.get(e.lbodyOf)
    if (target) built.set(e, { ...target, definition: undefined, etymBits: [] })
    Object.assign(e, classify(e, target?.gloss ?? ""))
  }

  // 2. headwords and homonym indexes (MW's <h> first, then the next free index in dictionary order)
  for (const e of entries) {
    const deva = slp1ToDevanagari(e.k1)
    e.headword = e.partKind === "prefix" ? `${deva}-` : deva
  }
  const taken = new Map<string, Set<number>>()
  const slot = (e: MwEntry) => {
    const k = `${e.kind}|${e.headword}`
    if (!taken.has(k)) taken.set(k, new Set())
    return taken.get(k)!
  }
  for (const e of entries) {
    if (e.h === undefined || !built.get(e)?.gloss) continue
    const used = slot(e)
    if (!used.has(e.h)) {
      e.homonym = e.h
      used.add(e.h)
    }
  }
  for (const e of entries) {
    if (e.homonym !== undefined || !built.get(e)?.gloss) continue
    const used = slot(e)
    let n = 1
    while (used.has(n)) n++
    e.homonym = n
    used.add(n)
  }

  // 3. indexes for roots and headwords
  const roots = new Map<string, MwEntry[]>()
  const heads = new Map<string, MwEntry[]>()
  for (const e of entries) {
    if (e.homonym === undefined) continue
    if (e.partKind === "root") roots.set(e.k1, [...(roots.get(e.k1) ?? []), e])
    if (e.level <= 2 && !e.mainOf && !e.lbodyOf) heads.set(e.k1, [...(heads.get(e.k1) ?? []), e])
  }
  const pick = (list: MwEntry[] | undefined, h?: number) => {
    if (!list?.length) return undefined
    const numbered = h !== undefined ? list.find((x) => x.h === h) : undefined
    return numbered ?? (list.length === 1 ? list[0] : undefined)
  }

  // 4. relations
  const rels: Rel[] = []
  for (const e of entries) {
    if (e.homonym === undefined) continue
    const r = e.recs[0]!
    let derived = false
    if (e.mainOf && e.mainOf.homonym !== undefined) {
      rels.push({ from: e, to: e.mainOf, type: "derived_from", confidence: "certain", note: `${NOTE}: listed under ${slp1ToIast(e.mainOf.k2)}` })
    }
    if (e.lbodyOf && e.lbodyOf.homonym !== undefined) {
      const close = levenshtein(e.k1, e.lbodyOf.k1) <= 2
      rels.push({
        from: e,
        to: e.lbodyOf,
        type: close ? "variant_of" : "synonym_of",
        confidence: "certain",
        note: `${NOTE}: listed together with ${slp1ToIast(e.lbodyOf.k2)}`,
      })
    }
    if (e.kind === "word" && (r.info.verb === "pre" || r.info.verb === "gati")) {
      const m = verbRoot(r)
      const root = m && pick(roots.get(m.k1), m.h)
      if (root) {
        rels.push({ from: e, to: root, type: "derived_from", confidence: "certain", note: `${NOTE}: ${slp1ToIast(r.info.parse?.replace(/\+/g, " + ") ?? m!.k1)}` })
        derived = true
      }
    }
    if (!e.lbodyOf && !e.mainOf && e.partKind !== "root") {
      const m = etymologyMention(r)
      if (m) {
        const root = pick(roots.get(m.k1), m.h) ?? (m.viaFrom ? pick(heads.get(m.k1), m.h) : undefined)
        if (root && root !== e) {
          rels.push({
            from: e,
            to: root,
            type: "derived_from",
            confidence: m.hedged ? "debated" : "likely",
            note: `${NOTE}: ${m.viaFrom ? "from" : "√"} ${m.h ? `${m.h}. ` : ""}${slp1ToIast(m.k1)}`,
          })
          derived = true
        }
      }
    }
    if (!derived && e.underRoot && e.underRoot.homonym !== undefined && e.underRoot !== e) {
      rels.push({ from: e, to: e.underRoot, type: "derived_from", confidence: "likely", note: `${NOTE}: listed under √${slp1ToIast(e.underRoot.k1)}` })
    }
  }

  // a compound listed under a skipped record (a section header such as "su (to be similarly
  // prefixed to the following)") has as first member the entry with that headword before it (sú "well")
  const position = new Map(entries.map((e, i) => [e, i]))
  const realHeads = new Map<string, MwEntry[]>()
  for (const e of entries) if (e.homonym !== undefined && e.level <= 2) realHeads.set(e.k1, [...(realHeads.get(e.k1) ?? []), e])
  const standIn = (e: MwEntry | undefined): MwEntry | undefined => {
    if (!e || e.homonym !== undefined) return e
    let best: MwEntry | undefined
    for (const x of realHeads.get(e.k1) ?? []) if (position.get(x)! < position.get(e)!) best = x
    return best
  }

  // 5. seed entries
  const seeds: SeedEntry[] = []
  let skipped = 0
  for (const e of entries) {
    const b = built.get(e)
    if (!b?.gloss || e.homonym === undefined) {
      skipped++
      continue
    }
    const r = e.recs[0]!
    const iastK2 = slp1ToIast(e.k2.replace(/[-—]/g, ""))
    const translit = e.partKind === "prefix" ? `${iastK2}-` : iastK2

    const etym: string[] = [...b.etymBits]
    if (r.info.parse && (r.info.verb === "pre" || r.info.verb === "gati")) etym.push(slp1ToIast(r.info.parse.replace(/\+/g, " + ")))
    for (const er of e.etym) {
      const t = tidy(render(parseMarkup(er.body), { refs: true, labels: false }, [])).replace(/^\[(.*)\]\.?$/, "$1")
      if (t) etym.push(t)
    }
    const etymology = etym
      .map((x) => trimEnd(x.replace(/^[\s,;:]+/, "")))
      .filter(Boolean)
      .map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}${/[.!?]$/.test(x) ? "" : "."}`)
      .join(" ")

    const notes: string[] = []
    const [page, col] = r.pc.split(",")
    const label = b.headLex ? `, ${b.headLex}` : ""
    notes.push(`Monier-Williams: ${slp1ToIast(e.k2)}${label} (p. ${page}${col ? `, col. ${col}` : ""}; L ${r.L}${e.h ? `; homonym ${e.h}` : ""}).`)
    const alts = headAlternatives(r, e.k1)
    if (alts.length) notes.push(`Also: ${alts.join(", ")}.`)
    if (e.partKind === "root" && r.info.cp) notes.push(`Present classes: ${r.info.cp.split(",").map((c) => c.replace(/^(\d+)/, "$1 ")).join(", ")}.`)
    if (e.lbodyOf) notes.push(`Shares the article of ${slp1ToIast(e.lbodyOf.k2)} (L ${e.lbodyOf.recs[0]!.L.replace(/^L/, "")}).`)
    if (r.info.sup) notes.push("From MW's Additions and Corrections.")
    if (b.refs.length) notes.push(`References: ${b.refs.slice(0, 15).join("; ")}${b.refs.length > 15 ? " …" : ""}.`)

    const parts: SeedComponent[] = []
    const first = standIn(e.firstMember)
    if (first && first !== e) parts.push({ ref: `ref:${first.ref}`, role: "first member" })
    if (e.lastMemberKey) {
      const last = pick(heads.get(e.lastMemberKey))
      if (last && last !== e && last !== first && last.homonym !== undefined) parts.push({ ref: `ref:${last.ref}`, role: "last member" })
    }

    const headIast = slp1ToIast(e.k1)
    const gloss = truncate(expandDegree(b.gloss, headIast), 118) // ≤ 120 with the ellipsis
    const senses = b.senses.map((x) => (x.gloss.includes("˚") ? { ...x, gloss: expandDegree(x.gloss, headIast) } : x))
    const base = {
      headword: e.headword!,
      native: e.headword!,
      translit,
      homonym: e.homonym,
      gloss,
      definition: b.definition && b.definition.length > gloss.length + 20 ? truncate(b.definition, 1500) : undefined,
      etymology: etymology ? truncate(etymology, 1500) : undefined,
      notes: notes.join(" ").replace(/\.\.(?=\s|$)/g, "."),
      ref: e.ref,
      senses,
      parts: parts.length ? parts : undefined,
    }
    e.seed = e.kind === "part" ? { kind: "part", partKind: e.partKind!, ...base } : { kind: "word", pos: e.pos, ...base }
    seeds.push(e.seed)
  }
  return { seeds, rels: rels.filter((x) => x.from.seed && x.to.seed), skipped }
}

/* ── importer ─────────────────────────────────────────────────────────────── */

export async function loadMonierWilliams(opts: { offline: boolean; log: (m: string) => void }) {
  const file = await download("monier-williams", FILE, URL, opts)
  const records = parseRecords(await readCached(file))
  const entries = groupEntries(records)
  return { records, entries, ...convertMonierWilliams(entries) }
}

export const monierWilliamsImporter: Importer = {
  id: "monier-williams",
  language: "san",
  description: "Monier-Williams Sanskrit-English Dictionary (Cologne CDSL, CC BY-SA 4.0): ~203k entries incl. compounds and 2.1k roots",
  async run({ db, log, limit, offline, prune }) {
    const { records, seeds, rels, skipped } = await loadMonierWilliams({ offline, log })
    const kept = limit ? seeds.slice(0, limit) : seeds
    const keep = new Set(kept)
    // with --limit, components may point outside the slice
    const inSlice = new Set(kept.map((s) => s.ref))
    for (const s of kept) {
      if (s.parts) s.parts = s.parts.filter((p) => typeof p !== "string" && inSlice.has(p.ref.slice(4)))
    }
    const roots = kept.filter((s) => s.kind === "part" && s.partKind === "root").length
    log(`${FILE}: ${records.length} records → ${seeds.length} entries (${roots} roots${skipped ? `, ${skipped} without a meaning skipped` : ""})`)

    const dataset: SeedDataset = { language: sanskritLanguage, source: monierWilliamsSource, entries: kept }
    const result = await upsertDataset(db, dataset, {
      log: (m) => (m.startsWith("  … ") ? undefined : log(m)),
      batchSize: 1000,
      prune: prune && !limit,
    })

    const idOf = (s: SeedEntry | undefined) => {
      const key = s?.ref ? result.keyOfRef.get(s.ref) : undefined
      return key ? result.idByKey.get(key) : undefined
    }
    const rows: RelationRow[] = []
    for (const x of rels) {
      if (!keep.has(x.from.seed!) || !keep.has(x.to.seed!)) continue
      const fromEntryId = idOf(x.from.seed)
      const toEntryId = idOf(x.to.seed)
      if (fromEntryId && toEntryId) rows.push({ fromEntryId, toEntryId, type: x.type, confidence: x.confidence, note: x.note })
    }
    const written = await writeRelations(db, rows, { notePrefix: NOTE })
    log(`relations: ${[...written.byType].map(([t, n]) => `${n} ${t}`).join(", ") || "none"}`)
    if (!limit) {
      const pruned = await pruneRelations(db, [...result.idByKey.values()], written.ids, NOTE)
      if (pruned) log(`pruned ${pruned} stale relations`)
    }
    log(`done — ${kept.length} Monier-Williams entries`)
  },
}

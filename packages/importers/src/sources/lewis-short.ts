/**
 * Lewis & Short, A Latin Dictionary (1879), Perseus Digital Library TEI XML
 * (CC BY-SA 4.0). One 77 MB file, ~51.6k entries; Greek is already Unicode in
 * the "eng2" file (eng1 keeps it in beta code).
 *   https://github.com/PerseusDL/lexica/tree/master/CTS_XML_TEI/perseus/pdllex/lat/ls
 *
 * Headwords are cited without vowel-quantity marks (amo, bonus, aqua), the way
 * Lewis & Short's own keys and most Latin dictionaries spell them; the marked
 * form with principal parts / declension ("ămo, āvi, ātum, 1, v. a.") is kept
 * in `notes`. English meanings are L&S's italics (<hi rend="ital">).
 */
import { and, eq, lt } from "drizzle-orm"
import {
  chunk,
  entries as entriesTable,
  upsertDataset,
  type PartKind,
  type PartOfSpeech,
  type SeedDataset,
  type SeedEntry,
  type SeedSense,
} from "@workspace/db"

import { download } from "../lib/cache"
import { truncate, uniq } from "../lib/text"
import { children, clean, forEachElement, type XmlNode } from "../lib/xml"
import type { Importer } from "../registry"

const RAW = "https://raw.githubusercontent.com/PerseusDL/lexica/master/CTS_XML_TEI/perseus/pdllex/lat/ls/"
const FILE = "lat.ls.perseus-eng2.xml"

export const lewisShortSource = {
  id: "lewis-short",
  title: "Lewis & Short, A Latin Dictionary (Perseus Digital Library)",
  url: "https://github.com/PerseusDL/lexica/tree/master/CTS_XML_TEI/perseus/pdllex/lat/ls",
  license: "CC BY-SA 4.0 (Perseus digital edition; the 1879 print edition is public domain)",
  citation:
    "Charlton T. Lewis and Charles Short, A Latin Dictionary, founded on Andrews' edition of Freund's Latin dictionary (Oxford: Clarendon Press, 1879); digital edition Perseus Digital Library, Tufts University, http://www.perseus.tufts.edu/.",
}

export const latinLanguage = {
  id: "lat",
  name: "Latin",
  nativeName: "Lingua Latina",
  script: "Latn",
  scriptName: "Latin alphabet",
  direction: "ltr" as const,
  family: "Indo-European › Italic › Latino-Faliscan",
  period: "c. 600 BCE – 600 CE (Old, Classical and Late Latin)",
  description:
    "The language of Rome, from the earliest inscriptions through Cicero and Virgil to the Vulgate, and the ancestor of the Romance languages.",
  sortOrder: 35,
}

/* ── text helpers ─────────────────────────────────────────────────────────── */

function nodeText(n: XmlNode | string): string {
  return typeof n === "string" ? n : n.children.map(nodeText).join("")
}

/** Plain text without the elements in `drop` (citations, the head's grammar …). */
function textWithout(n: XmlNode | string, drop: Set<string>): string {
  if (typeof n === "string") return n
  if (drop.has(n.name)) return ""
  return n.children.map((c) => textWithout(c, drop)).join("")
}

/** Tidy the punctuation left behind once citations are removed: "homo, : pessima" → "homo: pessima". */
function tidy(s: string): string {
  return clean(s)
    .replace(/\(\s*[,;:.]*\s*\)/g, "")
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:.]+/, "")
    .replace(/\bPaul\. ex(?:\s+M[üū]ll\.)?\s*/g, "") // "Paul. ex Fest. p. 26 Müll." once the citation is gone
    .replace(/\s*\bM[üū]ll\./g, "")
    .trim()
}

/** L&S writes y with a Cyrillic у (ў = y̆); fold that and the æ/œ ligatures. */
function fixLetters(s: string): string {
  return s.replace(/у/g, "y").replace(/У/g, "Y").replace(/ў/g, "y̆").replace(/Ў/g, "Y̆")
}

/** Citation form: no vowel-quantity marks, compound hyphens, daggers or ligatures. */
function plainHeadword(orth: string): string {
  return fixLetters(orth)
    .normalize("NFD")
    .replace(/[\u0300\u0301\u0304\u0306\u0308\u0361]/g, "") // grave/acute typos, macron, breve, diaeresis, double breve
    .replace(/[\^_†]/g, "")
    .replace(/(\p{L})-(?=\p{L})/gu, "$1") // ab-do → abdo (keeps -que, sub-)
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "Ae")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "Oe")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\s,.;:]+$/, "")
    .trim()
}

/** The L&S spelling with quantities, Perseus' ^ / _ helpers removed. */
function markedForm(orth: string): string {
  return clean(fixLetters(orth).replace(/[\^_]/g, "")).replace(/[,;:]+$/, "").normalize("NFC")
}

/* ── glosses: runs of L&S italics ─────────────────────────────────────────── */

/** Abbreviations L&S italicises as grammar labels rather than meanings ("fin.", "Absol.", "gen. plur.", "P. a."). */
const ABBR = new Set(
  (
    "fin init absol obsol comp sup subst gen adv advv med inf acc abl dat nom voc plur pl sing sg act pass mid dep neutr masc fem " +
    "perf pres imperf plup fut imp subj part gerund cr no adj dim freq inch intens desid impers interrog enclit indecl indef rel " +
    "demonstr pron conj prep interj num ord card lit trop transf fig meton poet prop esp ext ph ch pa cf id ib ibid al etc sq " +
    "constr pers class eccl dub lemm ante post obj possess imper indic partt conject distr ex"
  ).split(" ")
)

const isAbbr = (w: string) => (w.length === 1 && w !== "I") || ABBR.has(w.toLowerCase()) || /^\d+(?:st|nd|d|rd|th)?$/.test(w) || /^(?:first|second|third)$/i.test(w)

/** A pure grammar label: "fin.", "gen. plur.", "(2d pers.", "ex conject.—Inf.", "P. a." */
function isLabel(t: string): boolean {
  const s = t.trim().replace(/[\s,;:]+$/, "")
  if (!s.endsWith(".")) return false
  const words = s.split(/[\s.,;:()—–-]+/).filter(Boolean)
  return words.length > 0 && words.every(isAbbr)
}

/** Drop leading grammar labels: "Neutr., to flow out" → "to flow out", "adj., of" → "of", "P. a. fin." → "". */
function stripLabels(t: string): string {
  let s = t.trim()
  if (isLabel(s)) return ""
  for (;;) {
    const m = s.match(/^\(?([A-Za-z]+)\.[\s,;:]*/)
    if (!m || !isAbbr(m[1]!)) return s
    s = s.slice(m[0].length)
  }
}

/** Italicised Latin function words and English fragments that never make a gloss on their own. */
const NOISE = new Set(
  (
    "ab abs ad an ante aut cum de dum ea eo et ex hic haec hoc ibi id idem igitur ille illa illud in inde inter ipse is ita jam iam " +
    "me ne nec neque nisi non nos ob per post pro quam quia quid quis qui quae quod quo quoque re rem res se sed si sibi sic sub sui super " +
    "tam te tum ubi unde ut vel vero vos aliquid aliquem alicui alicujus aliquo aliqua aliquis aliquam esse est of the to"
  ).split(" ")
)
const NOISE_PHRASES = new Set(["also called", "called also", "in lemm", "rel.-clause", "sc"])
const CONNECTOR = /^[\s,;'’-]*(?:(?:or|and|or even|and also|i\.e\.,?)\s*)?[\s,;'’-]*$/

function isNoiseRun(r: string): boolean {
  const s = r.toLowerCase()
  if ((s.length < 2 && r !== "I") || !/\p{L}/u.test(s) || NOISE.has(s) || NOISE_PHRASES.has(s)) return true
  // letters being discussed rather than meanings: "b and p", "l, m, and r"
  const words = r.split(/[\s,;]+/).filter((w) => w && w !== "and" && w !== "or" && w !== "I")
  return words.length > 0 && words.every((w) => w.length === 1)
}

/** Elements that interrupt a run of glosses (citations, quotations, Greek, grammar). */
const BREAKS = new Set(["bibl", "cit", "quote", "foreign", "etym", "orth", "itype", "gen", "pos", "case", "number", "mood", "usg", "lbl", "xr", "sense", "trans"])

type Piece = { hi?: string; text?: string; brk?: true }

function pieces(node: XmlNode, out: Piece[] = []): Piece[] {
  for (const c of node.children) {
    if (typeof c === "string") out.push({ text: c })
    else if (c.name === "hi") out.push({ hi: nodeText(c) })
    else if (BREAKS.has(c.name)) out.push({ brk: true })
    else pieces(c, out)
  }
  return out
}

/** Maximal runs of meaningful italics joined only by connectors (", ", " or ", "'"), in order. */
function glossRuns(node: XmlNode): string[] {
  const runs: string[] = []
  let run = ""
  let sep = ""
  const end = () => {
    // drop label segments that ride along inside an italic span: "good; comp." → "good"
    const r = clean(run)
      .split(/;\s*/)
      .filter((seg) => seg && !isLabel(seg.endsWith(".") ? seg : `${seg}.`))
      .join("; ")
      .replace(/[\s,;:.—–-]+$/, "")
    if (r && !isNoiseRun(r)) runs.push(r)
    run = ""
    sep = ""
  }
  for (const p of pieces(node)) {
    if (p.brk) {
      end()
    } else if (p.hi !== undefined) {
      const t = stripLabels(p.hi)
      if (!t) {
        end() // a bare label such as "Comp." or "fin." interrupts the run
        continue
      }
      run = run && t === p.hi.trim() ? run + sep + t : (end(), t)
      sep = ""
    } else if (p.text !== undefined && run) {
      sep += p.text
      if (!CONNECTOR.test(sep)) end()
    }
  }
  end()
  return runs
}

/** The first run is the headline meaning ("to like, to love", "bad", "a rose"). */
function glossFromRuns(runs: string[], max: number): string {
  return truncate(runs[0] ?? "", max)
}

/* ── entry conversion ─────────────────────────────────────────────────────── */

const DROP_BODY = new Set(["bibl", "orth", "itype", "gen", "pos", "etym", "cb", "pb"])
const DROP_STUB = new Set(["bibl", "orth", "itype", "gen", "pos", "etym", "case", "number", "cb", "pb"])

const TYPE_NOTE: Record<string, string> = {
  hapax: "Hapax legomenon (attested once).",
  greek: "Greek loanword.",
  spur: "Spurious form (a false reading).",
  gloss: "Known only from the ancient glossaries.",
  foreign: "Foreign (non-Latin) word.",
}

function posFromLabel(label: string): PartOfSpeech | undefined {
  const l = label.toLowerCase().trim()
  if (/^num\.|adv\. num\./.test(l)) return "numeral"
  if (/^v\b|^v\./.test(l)) return "verb"
  if (/^p\. ?a\.|adj/.test(l)) return "adjective"
  if (/^adv/.test(l)) return "adverb"
  if (/^prep/.test(l)) return "preposition"
  if (/^conj/.test(l)) return "conjunction"
  if (/^interj/.test(l)) return "interjection"
  if (/pron/.test(l)) return "pronoun"
  if (/^subst/.test(l)) return "noun"
  return undefined
}

function guessPos(headword: string, head: XmlNode[], firstSense: XmlNode | undefined): PartOfSpeech | undefined {
  const of = (name: string) => head.filter((n) => n.name === name).map((n) => clean(nodeText(n)))
  const proper = /^\p{Lu}/u.test(headword)
  for (const p of of("pos")) {
    const pos = posFromLabel(p)
    if (pos === "noun" && proper) return "proper_noun"
    if (pos) return pos
  }
  if (of("gen").length) return proper ? "proper_noun" : "noun"
  if (of("mood").some((m) => /^part/i.test(m))) return "verb" // "abditus, a, um, Part. of abdo"
  const itype = of("itype").join(", ")
  if (/^(?:a, um|us, a, um|a, ud|ra, rum|is, e|e|ae, a)\b/.test(itype)) return "adjective"
  if (/\b[1-4]$/.test(itype) || (/(?:o|or)$/.test(headword) && /^(?:[āēĕī]re|[āē]ri|i)\b/.test(itype))) return "verb"
  // labels at the start of the first sense: "conj.", "adv.", "interrog. and enclit. part."
  if (firstSense) {
    for (const hi of children(firstSense, "hi").slice(0, 2)) {
      const pos = posFromLabel(clean(nodeText(hi)))
      if (pos) return pos
    }
  }
  return undefined
}

const PART_KIND: Record<string, PartKind> = { "-do": "stem", "-pte": "suffix" }

export function convertLewisShort(e: XmlNode): SeedEntry | null {
  const key = e.attrs.key ?? ""
  const orths = children(e, "orth")
  const firstOrth = orths.length ? nodeText(orths[0]!) : ""
  let headword = plainHeadword(firstOrth)
  if (!headword || headword === "—") headword = key.replace(/\d+$/, "")
  if (!headword || !/\p{L}/u.test(headword)) return null

  const bodyText = tidy(textWithout(e, DROP_BODY))
  // spelling stubs such as "adn-. For all words in adn- not found here, v. under ann-."
  if (/\p{L}-$/u.test(headword) && bodyText.length < 90 && /\bv\.\s/.test(bodyText)) return null

  // the head: everything before the first <sense>. Perseus often opens sense I inside the head's
  // parenthesis, so gender and etymology the head lacks are taken from sense I.
  const head: XmlNode[] = []
  for (const c of e.children) {
    if (typeof c === "string") continue
    if (c.name === "sense") break
    head.push(c)
  }
  const senses = e.children.filter((c): c is XmlNode => typeof c !== "string" && c.name === "sense")
  for (const name of ["gen", "etym"]) {
    if (!head.some((n) => n.name === name) && senses[0]) head.push(...children(senses[0], name).slice(0, 1))
  }

  // gloss: the first sense that has meaningful italics; else the stub text ("see abicio", "participle of abdo")
  let gloss = ""
  for (const s of senses) {
    const runs = glossRuns(s)
    if (runs.length) {
      gloss = glossFromRuns(runs, 120)
      break
    }
  }
  if (!gloss) gloss = glossFromRuns(glossRuns({ ...e, children: e.children.filter((c) => typeof c === "string" || c.name !== "sense") }), 120)
  if (!gloss) {
    const stub = tidy(textWithout(e, DROP_STUB)).replace(/[,;:.\s]+$/, "")
    const see = stub.match(/(?:^|[\s(,;])(?:=\s*)?v\.\s+(?:under\s+)?(\d\.\s*)?([\p{L}-]+)/u)
    if (see && stub.length < 70) gloss = `see ${see[1] ?? ""}${see[2]}`
    else {
      gloss = stub.replace(/^Part\.\s+(?:of|from)\b/, "participle of").replace(/\bfalse read\./g, "false reading")
      if (e.attrs.type === "gloss" && gloss && !/^(?:=|see\b)/.test(gloss)) gloss = `= ${gloss}`
      gloss = truncate(gloss, 100)
    }
  }
  if (!gloss) gloss = truncate(bodyText, 100) || headword

  // senses, with their outline position ("I.B.2") as domain
  let path: (string | undefined)[] = []
  const senseRows: SeedSense[] = []
  for (const s of senses) {
    if (senseRows.length >= 20) break
    const level = Math.max(1, Number(s.attrs.level ?? "1") || 1)
    path = path.slice(0, level - 1)
    path[level - 1] = (s.attrs.n ?? "").replace(/\s+/g, "").replace(/\.$/, "") || undefined
    const stext = tidy(textWithout(s, DROP_BODY))
    const runs = glossRuns(s)
    const sgloss = runs.length ? glossFromRuns(runs, 160) : truncate(stext, 120)
    if (!sgloss) continue
    senseRows.push({
      gloss: sgloss,
      definition: stext.length > 40 && stext !== sgloss ? truncate(stext, 500) : undefined,
      domain: path.some(Boolean) ? `sense ${path.filter(Boolean).join(".")}` : undefined,
    })
  }

  // etymology: <etym> in the head, else a bracketed note near the start ("[cf. Sanscr. kam = to love; …]")
  let etymology = uniq(head.filter((n) => n.name === "etym").map((n) => tidy(nodeText(n)))).filter(Boolean).join("; ")
  if (!etymology) {
    const start = tidy(textWithout(e, new Set(["bibl", "cb", "pb"]))).slice(0, 700)
    const m = start.match(/\[([^[\]]{4,400})\]/)
    if (m && /\b(?:cf\.|Sanscr|Gr\.|root|kindr|Germ|Engl|Goth|Osc|Umbr|from|=)/.test(m[1]!)) etymology = clean(m[1]!)
  }

  // notes: the L&S head with quantities and principal parts, variant spellings, entry type
  const headBits: string[] = []
  for (const n of head) {
    if (n.name === "orth" && n === orths[0]) headBits.push(markedForm(nodeText(n)))
    else if (["itype", "gen", "pos", "mood"].includes(n.name)) headBits.push(clean(nodeText(n)))
  }
  const variants = uniq(
    head
      .filter((n) => n.name === "orth" && n !== orths[0])
      .map((n) => markedForm(nodeText(n)))
      .filter((v) => v && v !== "—" && plainHeadword(v) !== headword)
  )
  const notes: string[] = []
  if (headBits.length) notes.push(`Lewis & Short: ${headBits.join(", ").replace(/,\s*,/g, ",")}.`.replace(/\.\.$/, "."))
  if (variants.length) notes.push(`Variant forms: ${variants.join(", ")}.`)
  if (firstOrth.includes("†")) notes.push("Marked † (doubtful form) by Lewis & Short.")
  const typeNote = TYPE_NOTE[e.attrs.type ?? ""]
  if (typeNote) notes.push(typeNote)

  const base = {
    headword,
    pos: guessPos(headword, head, senses[0]),
    gloss,
    definition: bodyText.length > 20 && bodyText !== gloss ? truncate(bodyText, 1200) : undefined,
    etymology: etymology || undefined,
    notes: notes.join(" ") || undefined,
    ref: key || e.attrs.id,
    senses: senseRows,
  }
  // enclitics and bound forms (-que, -ne, -ce, -pte, ve-) are word parts
  if (/^-/.test(headword)) return { kind: "part", partKind: PART_KIND[headword] ?? "clitic", ...base }
  if (/\p{L}-$/u.test(headword)) return { kind: "part", partKind: "prefix", ...base }
  return { kind: "word", ...base }
}

export const lewisShortImporter: Importer = {
  id: "lewis-short",
  language: "lat",
  description: "Lewis & Short Latin Dictionary (Perseus TEI, ~51k entries)",
  async run({ db, log, limit, offline, prune }) {
    const startedAt = new Date()
    const file = await download("lewis-short", FILE, `${RAW}${FILE}`, { offline, log })
    const entries: SeedEntry[] = []
    let skipped = 0
    const n = await forEachElement(file, "entryFree", (node) => {
      if (limit && entries.length >= limit) return
      const e = convertLewisShort(node)
      if (e) entries.push(e)
      else skipped++
    })
    const seen = new Set<string>()
    const unique = entries.filter((e) => (e.ref && seen.has(e.ref) ? false : (e.ref && seen.add(e.ref), true)))
    log(`${FILE}: ${n} entryFree elements → ${unique.length} entries${skipped ? ` (${skipped} spelling stubs skipped)` : ""}`)

    // write in slices so one transaction never holds the whole dictionary; homonym numbering sees earlier slices
    for (const slice of chunk(unique, 5000)) {
      const dataset: SeedDataset = { language: latinLanguage, source: lewisShortSource, entries: slice }
      await upsertDataset(db, dataset, { log, batchSize: 250 })
    }
    if (prune && !limit) {
      const stale = await db
        .delete(entriesTable)
        .where(and(eq(entriesTable.sourceId, lewisShortSource.id), lt(entriesTable.updatedAt, startedAt)))
        .returning({ id: entriesTable.id })
      log(`pruned ${stale.length} stale entries`)
    }
    log(`done — ${unique.length} Lewis & Short entries`)
  },
}

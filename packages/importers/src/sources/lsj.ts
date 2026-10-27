/**
 * Liddell–Scott–Jones, A Greek–English Lexicon (Perseus Digital Library TEI
 * XML, CC BY-SA 4.0). 27 files, ~114k entries. Most headwords and quoted
 * Greek are in Perseus beta code and are converted to polytonic Unicode.
 *   https://github.com/PerseusDL/lexica/tree/master/CTS_XML_TEI/perseus/pdllex/grc/lsj
 */
import { and, eq, lt } from "drizzle-orm"
import { entries as entriesTable, upsertDataset, type PartOfSpeech, type SeedDataset, type SeedEntry } from "@workspace/db"

import { betaToUnicode, betaTokensToUnicode, looksLikeBetaCode } from "../lib/betacode"
import { transliterateGreek } from "../lib/greek"
import { download } from "../lib/cache"
import { truncate, uniq } from "../lib/text"
import { children, clean, descendants, forEachElement, type XmlNode } from "../lib/xml"
import type { Importer } from "../registry"

const RAW = "https://raw.githubusercontent.com/PerseusDL/lexica/master/CTS_XML_TEI/perseus/pdllex/grc/lsj/"
const FILES = Array.from({ length: 27 }, (_, i) => `grc.lsj.perseus-eng${i + 1}.xml`)

export const lsjSource = {
  id: "lsj",
  title: "Liddell–Scott–Jones, A Greek–English Lexicon (Perseus Digital Library)",
  url: "https://github.com/PerseusDL/lexica",
  license: "CC BY-SA 4.0 (Perseus digital edition)",
  citation: "Liddell, Scott, Jones, A Greek–English Lexicon, 9th ed. (Oxford 1940); digital edition Perseus Digital Library, Tufts University.",
}

export const greekLanguage = {
  id: "grc",
  name: "Ancient Greek",
  nativeName: "Ἑλληνική",
  script: "Grek",
  scriptName: "Greek alphabet (polytonic)",
  direction: "ltr" as const,
  family: "Indo-European › Hellenic",
  period: "c. 800 BCE – 600 CE (Archaic, Classical, Koine)",
  description:
    "The language of Homer, Athenian democracy, the Septuagint and the New Testament; the source of an enormous share of the international scientific vocabulary.",
  sortOrder: 30,
}

const DROP = new Set(["bibl", "orth", "itype", "gen", "gramGrp", "pos", "etym"])

/** Plain text of a node, converting Greek-tagged (or beta-code looking) text and dropping apparatus. */
function greekText(node: XmlNode | string, inGreek = false): string {
  if (typeof node === "string") return inGreek || looksLikeBetaCode(node.trim()) ? betaTokensToUnicode(node) : node
  if (DROP.has(node.name)) return ""
  const greek = inGreek || node.attrs.lang === "greek" || node.attrs["xml:lang"] === "greek"
  return node.children.map((c) => greekText(c, greek)).join("")
}

/** Perseus marks vowel length with ^ (short) and _ (long) after the vowel. */
function cleanOrth(s: string): string {
  const t = clean(s).replace(/[\^_]/g, "").replace(/\s*,\s*$/, "")
  return looksLikeBetaCode(t) ? betaToUnicode(t) : t
}

function nodeText(n: XmlNode): string {
  return n.children.map((c) => (typeof c === "string" ? c : nodeText(c))).join("")
}

function guessPos(headword: string, entry: XmlNode): PartOfSpeech | undefined {
  const gen = descendants(entry, "gen").map((g) => clean(nodeText(g)))
  const itype = descendants(entry, "itype").map((g) => clean(nodeText(g))).join(" ")
  const pos = descendants(entry, "pos").map((g) => clean(nodeText(g))).join(" ").toLowerCase()
  if (pos.includes("adv")) return "adverb"
  if (pos.includes("prep")) return "preposition"
  if (pos.includes("conj")) return "conjunction"
  if (pos.includes("partic")) return "particle"
  if (pos.includes("interj")) return "interjection"
  if (pos.includes("pron")) return "pronoun"
  if (/\b(on|o\/n|ον|όν)\b\s*$/u.test(itype) || /^(h\/|a\/|ή|ά),\s*(o\/n|on|όν|ον)$/u.test(itype)) return "adjective"
  if (gen.length) return "noun"
  if (/^[Α-ΩἈ-Ὧ]/u.test(headword)) return "proper_noun"
  if (/(ω|ομαι|εῖν|μι|μαι|ῶ|οῦμαι|ῦμαι|άω|έω|όω)$/u.test(headword)) return "verb"
  if (/(ος|η|α|ις|υς|ευς|μα|σις|της|ον|ιον)$/u.test(headword)) return "noun"
  return undefined
}

function convertEntry(e: XmlNode): SeedEntry | null {
  const orths = children(e, "orth")
  let headword = orths.length ? cleanOrth(nodeText(orths[0]!)) : ""
  if (!headword && e.attrs.key) headword = betaToUnicode(e.attrs.key)
  if (!headword || /^[*\d]/.test(headword) || !/\p{Script=Greek}/u.test(headword)) return null
  const variants = uniq(orths.slice(1).map((o) => cleanOrth(nodeText(o))).filter((v) => v && v !== headword))

  const senses = children(e, "sense")
  const trs = uniq(descendants(e, "tr").map((t) => clean(greekText(t)).replace(/[,;:]+$/, "")).filter(Boolean))
  const body = clean(greekText(e)).replace(/^[\s,;:.]+/, "")

  const gloss = trs.length ? truncate(trs.slice(0, 3).join("; "), 120) : truncate(body, 100) || headword
  const senseRows = senses.slice(0, 12).map((s) => {
    const strs = uniq(descendants(s, "tr").map((t) => clean(greekText(t)).replace(/[,;:]+$/, "")).filter(Boolean))
    const stext = clean(greekText(s)).replace(/^[\s,;:.]+/, "")
    return {
      gloss: strs.length ? truncate(strs.slice(0, 4).join("; "), 160) : truncate(stext, 120),
      definition: stext.length > 40 ? truncate(stext, 500) : undefined,
      domain: s.attrs.n ? `sense ${s.attrs.n}` : undefined,
    }
  })

  return {
    kind: "word",
    headword,
    translit: transliterateGreek(headword),
    pos: guessPos(headword, e),
    gloss,
    definition: body.length > 20 ? truncate(body, 1200) : undefined,
    notes: variants.length ? `Variant forms: ${variants.join(", ")}.` : undefined,
    ref: e.attrs.id ?? undefined,
    senses: senseRows.filter((s) => s.gloss),
  }
}

export const lsjImporter: Importer = {
  id: "lsj",
  language: "grc",
  description: "LSJ Greek–English Lexicon (Perseus TEI, ~114k entries)",
  async run({ db, log, limit, offline, prune }) {
    const startedAt = new Date()
    let total = 0
    for (const name of FILES) {
      const file = await download("lsj", name, `${RAW}${name}`, { offline, log })
      const entries: SeedEntry[] = []
      let skipped = 0
      const n = await forEachElement(file, "entryFree", (node) => {
        if (limit && total + entries.length >= limit) return
        const e = convertEntry(node)
        if (e) entries.push(e)
        else skipped++
      })
      const seen = new Set<string>()
      const unique = entries.filter((e) => (e.ref && seen.has(e.ref) ? false : (e.ref && seen.add(e.ref), true)))
      log(`${name}: ${n} entryFree elements → ${unique.length} entries${skipped ? ` (${skipped} skipped)` : ""}`)
      if (!unique.length) continue
      const dataset: SeedDataset = { language: greekLanguage, source: lsjSource, entries: unique }
      await upsertDataset(db, dataset, { log, batchSize: 250 })
      total += unique.length
      if (limit && total >= limit) break
    }
    if (prune && !limit) {
      // rows of this source the run did not touch (e.g. headwords that changed spelling) are stale
      const stale = await db
        .delete(entriesTable)
        .where(and(eq(entriesTable.sourceId, lsjSource.id), eq(entriesTable.kind, "word"), lt(entriesTable.updatedAt, startedAt)))
        .returning({ id: entriesTable.id })
      log(`pruned ${stale.length} stale entries`)
    }
    log(`done — ${total} LSJ entries`)
  },
}

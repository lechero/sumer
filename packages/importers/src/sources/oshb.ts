/**
 * Open Scriptures Hebrew Lexicon (CC BY 4.0): the LexicalIndex is the spine
 * (one entry per lemma, Hebrew and Aramaic), enriched with Strong's Hebrew
 * Dictionary (transliteration, pronunciation, etymology, meaning) and BDB
 * (full definitions, senses, roots). Roots become `part` entries and every
 * derived word is linked to its root.
 *   https://github.com/openscriptures/HebrewLexicon
 */
import { upsertDataset, type PartOfSpeech, type SeedDataset, type SeedEntry } from "@workspace/db"

import { download } from "../lib/cache"
import { truncate } from "../lib/text"
import { child, children, clean, descendants, forEachElement, text, type XmlNode } from "../lib/xml"
import type { Importer } from "../registry"

const RAW = "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/"

export const oshbSource = {
  id: "oshb",
  title: "Open Scriptures Hebrew Lexicon (BDB + Strong's)",
  url: "https://github.com/openscriptures/HebrewLexicon",
  license: "CC BY 4.0 (digital edition; BDB 1906 and Strong's 1890 are public domain)",
  citation: "Open Scriptures Hebrew Bible project, Hebrew Lexicon: Brown–Driver–Briggs and Strong's Hebrew Dictionary with Lexical Index.",
}

export const hebrewLanguage = {
  id: "hbo",
  name: "Biblical Hebrew",
  nativeName: "עִבְרִית",
  script: "Hebr",
  scriptName: "Hebrew (square script, Tiberian pointing)",
  direction: "rtl" as const,
  family: "Afro-Asiatic › Semitic › Northwest Semitic › Canaanite",
  period: "c. 1000 BCE – 200 CE (Biblical, then Mishnaic Hebrew)",
  description:
    "The language of the Hebrew Bible. Built on triconsonantal roots slotted into vowel patterns; shares much basic vocabulary with Akkadian and absorbed Mesopotamian loanwords.",
  sortOrder: 40,
}

export const aramaicLanguage = {
  id: "arc",
  name: "Biblical Aramaic",
  nativeName: "אֲרָמִית",
  script: "Hebr",
  scriptName: "Hebrew square script (Aramaic)",
  direction: "rtl" as const,
  family: "Afro-Asiatic › Semitic › Northwest Semitic › Aramaic",
  period: "c. 600 – 200 BCE (Daniel, Ezra, Jeremiah 10:11, Genesis 31:47)",
  description:
    "The Aramaic of the Hebrew Bible — the Imperial Aramaic used as the chancery language of the Persian empire, written in the same square script as Hebrew.",
  sortOrder: 45,
}

/** OSHB part-of-speech codes. */
const POS: Record<string, PartOfSpeech> = {
  N: "noun",
  Ng: "noun",
  Np: "proper_noun",
  V: "verb",
  A: "adjective",
  Ag: "adjective",
  Ao: "numeral",
  Ac: "numeral",
  D: "adverb",
  R: "preposition",
  C: "conjunction",
  P: "pronoun",
  Pp: "pronoun",
  Pd: "pronoun",
  Pi: "pronoun",
  Pf: "pronoun",
  Pr: "pronoun",
  T: "particle",
  Tj: "interjection",
  Tm: "particle",
  Ti: "particle",
  Td: "determiner",
  Tn: "particle",
  Tr: "particle",
  To: "particle",
}

type Strong = { id: string; word: string; pos?: string; pron?: string; xlit?: string; lang?: string; source: string; meaning: string; defs: string[]; usage: string }
type Bdb = { id: string; word: string; type?: string; pos?: string; defs: string[]; senses: { n: string; text: string }[]; fulltext: string }
type IndexEntry = { id: string; lang: string; word: string; xlit?: string; pos?: string; def?: string; bdb?: string; strong?: string; twot?: string; etymType?: string; etymRoot?: string; etymRefs: string[] }

function strongPos(code: string | undefined): PartOfSpeech | undefined {
  if (!code) return undefined
  const c = code.toLowerCase()
  if (c.startsWith("n-pr")) return "proper_noun"
  if (c.startsWith("n")) return "noun"
  if (c === "v") return "verb"
  if (c.startsWith("a")) return "adjective"
  if (c.startsWith("adv")) return "adverb"
  if (c.startsWith("prep")) return "preposition"
  if (c.startsWith("conj")) return "conjunction"
  if (c.startsWith("pron") || c === "p") return "pronoun"
  if (c.startsWith("interj")) return "interjection"
  if (c.startsWith("prt") || c.startsWith("part")) return "particle"
  if (c.startsWith("num")) return "numeral"
  if (c.startsWith("art")) return "determiner"
  return undefined
}

async function loadStrongs(file: string): Promise<Map<string, Strong>> {
  const out = new Map<string, Strong>()
  await forEachElement(file, "entry", (e) => {
    const w = child(e, "w")
    if (!w) return
    const meaning = child(e, "meaning")
    out.set(e.attrs.id ?? "", {
      id: e.attrs.id ?? "",
      word: clean(text(w)),
      pos: w.attrs.pos,
      pron: w.attrs.pron,
      xlit: w.attrs.xlit,
      lang: w.attrs["xml:lang"],
      source: clean(text(child(e, "source"))),
      meaning: clean(text(meaning)),
      defs: meaning ? descendants(meaning, "def").map((d) => clean(text(d))).filter(Boolean) : [],
      usage: clean(text(child(e, "usage"))),
    })
  })
  return out
}

async function loadBdb(file: string): Promise<Map<string, Bdb>> {
  const out = new Map<string, Bdb>()
  await forEachElement(file, "entry", (e) => {
    const w = child(e, "w")
    const senses = children(e, "sense").map((s) => ({ n: s.attrs.n ?? "", text: clean(text(s)) }))
    // full text without the status marker
    const body = { ...e, children: e.children.filter((c) => typeof c === "string" || c.name !== "status") }
    out.set(e.attrs.id ?? "", {
      id: e.attrs.id ?? "",
      word: clean(text(w)),
      type: e.attrs.type,
      pos: clean(text(child(e, "pos"))) || undefined,
      defs: descendants(e, "def").map((d) => clean(text(d))).filter(Boolean),
      senses,
      fulltext: clean(text(body)),
    })
  })
  return out
}

async function loadIndex(file: string): Promise<IndexEntry[]> {
  const out: IndexEntry[] = []
  let lang = "heb"
  // <part xml:lang="heb"> wraps entries; entries carry no lang, so track the part.
  await forEachElement(
    file,
    (n) => n === "part" || n === "entry",
    (node) => {
      if (node.name === "part") {
        // part subtree arrives complete (entries nested); walk it
        lang = node.attrs["xml:lang"] ?? lang
        for (const e of descendants(node, "entry")) out.push(toIndexEntry(e, lang))
      }
    }
  )
  return out
}

function toIndexEntry(e: XmlNode, lang: string): IndexEntry {
  const w = child(e, "w")
  const xref = child(e, "xref")
  const etym = child(e, "etym")
  return {
    id: e.attrs.id ?? "",
    lang,
    word: clean(text(w)),
    xlit: w?.attrs.xlit,
    pos: clean(text(child(e, "pos"))) || undefined,
    def: clean(text(child(e, "def"))) || undefined,
    bdb: xref?.attrs.bdb,
    strong: xref?.attrs.strong,
    twot: xref?.attrs.twot,
    etymType: etym?.attrs.type,
    etymRoot: etym?.attrs.root,
    etymRefs: etym ? clean(text(etym)).split(/\s*,\s*/).filter(Boolean) : [],
  }
}

export const oshbImporter: Importer = {
  id: "oshb",
  language: "hbo",
  description: "Open Scriptures Hebrew Lexicon → Biblical Hebrew and Aramaic words with Strong's + BDB data and roots",
  async run({ db, log, limit, offline, prune }) {
    const [indexFile, strongFile, bdbFile] = await Promise.all([
      download("oshb", "LexicalIndex.xml", `${RAW}LexicalIndex.xml`, { offline, log }),
      download("oshb", "HebrewStrong.xml", `${RAW}HebrewStrong.xml`, { offline, log }),
      download("oshb", "BrownDriverBriggs.xml", `${RAW}BrownDriverBriggs.xml`, { offline, log }),
    ])
    const [index, strongs, bdb] = await Promise.all([loadIndex(indexFile), loadStrongs(strongFile), loadBdb(bdbFile)])
    log(`index ${index.length} entries, Strong's ${strongs.size}, BDB ${bdb.size}`)

    const byLang: Record<string, IndexEntry[]> = { heb: [], arc: [] }
    for (const e of index) (byLang[e.lang] ??= []).push(e)
    const indexById = new Map(index.map((e) => [e.id, e]))

    for (const [xmlLang, language] of [
      ["heb", hebrewLanguage],
      ["arc", aramaicLanguage],
    ] as const) {
      const items = limit ? (byLang[xmlLang] ?? []).slice(0, limit) : (byLang[xmlLang] ?? [])
      const entries: SeedEntry[] = []
      const rootEntries = new Map<string, SeedEntry>() // consonantal root → part entry
      const rootOfId = new Map<string, string>() // index id → root headword

      // Pass 1: roots (etym type=main with a root attribute).
      for (const e of items) {
        if (e.etymType === "main" && e.etymRoot) {
          const root = e.etymRoot.normalize("NFC")
          const b = e.bdb ? bdb.get(e.bdb) : undefined
          if (!rootEntries.has(root)) {
            rootEntries.set(root, {
              kind: "part",
              partKind: "root",
              headword: root,
              translit: e.xlit ? e.xlit.replace(/[āēīōūăĕŏâêîôû]/g, (c) => c.normalize("NFD")[0]!) : undefined,
              gloss: e.def ?? b?.defs[0] ?? "root",
              definition: b?.type === "root" ? truncate(b.fulltext, 600) : undefined,
              notes: `Root family (OSHB ${e.id}).`,
              ref: `root:${e.id}`,
            })
          }
          rootOfId.set(e.id, root)
          for (const ref of e.etymRefs) rootOfId.set(ref, root)
        }
      }
      // sub entries point at their main entry
      for (const e of items) {
        if (e.etymType === "sub") {
          for (const ref of e.etymRefs) {
            const root = rootOfId.get(ref)
            if (root) rootOfId.set(e.id, root)
          }
        }
      }

      // Pass 2: words.
      let withBdb = 0
      let withStrong = 0
      for (const e of items) {
        if (!e.word) continue
        const s = e.strong ? strongs.get(`H${e.strong}`) : undefined
        const b = e.bdb ? bdb.get(e.bdb) : undefined
        if (s) withStrong++
        if (b) withBdb++
        const pos = (e.pos && POS[e.pos]) || strongPos(s?.pos)
        const gloss = e.def || s?.defs[0] || b?.defs[0] || (s?.meaning ? truncate(s.meaning, 80) : e.word)
        const definition = b && b.fulltext.length > 20 ? truncate(b.fulltext, 1500) : s?.meaning ? truncate(s.meaning, 800) : undefined
        const senses = b?.senses.length
          ? b.senses.map((x) => ({ gloss: truncate(x.text, 200) }))
          : s?.defs.length
            ? s.defs.map((d) => ({ gloss: d }))
            : []
        const notes: string[] = []
        if (e.strong) notes.push(`Strong's H${e.strong}.`)
        if (e.twot) notes.push(`TWOT ${e.twot}.`)
        if (s?.pron) notes.push(`Pronunciation (Strong's): ${s.pron}.`)
        if (s?.usage) notes.push(`KJV renderings: ${truncate(s.usage, 300)}`)
        if (e.bdb) notes.push(`BDB ${e.bdb}.`)
        const root = rootOfId.get(e.id)
        const isRootCarrier = e.etymType === "main" && e.etymRoot && e.word.replace(/[֑-ׇ]/g, "") === e.etymRoot
        // A main entry whose word *is* the bare root (no vowels) duplicates the root part; skip it.
        if (isRootCarrier && !s) continue
        entries.push({
          kind: "word",
          headword: e.word.normalize("NFC"),
          translit: e.xlit ?? s?.xlit,
          pos,
          gloss,
          definition,
          etymology: s?.source || undefined,
          notes: notes.join(" ") || undefined,
          ref: e.id,
          senses: senses.slice(0, 15),
          parts: root && rootEntries.has(root) ? [{ ref: `part:${root}`, role: "root" }] : undefined,
        })
      }

      const dataset: SeedDataset = {
        language,
        source: oshbSource,
        entries: [...rootEntries.values(), ...entries],
      }
      log(`${language.name}: ${entries.length} words, ${rootEntries.size} roots (${withStrong} with Strong's, ${withBdb} with BDB)`)
      await upsertDataset(db, dataset, { log, prune, batchSize: 250 })
    }
    void indexById
  },
}

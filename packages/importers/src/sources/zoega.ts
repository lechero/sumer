/**
 * Geir T. Zoëga, A Concise Dictionary of Old Icelandic (Oxford, 1910; public domain),
 * as JSON from Sampo Silvennoinen's old-icelandic-zoega package (MIT): 29,951
 * articles `{ word, definitions[] }`, the definitions HTML fragments (<i> = English,
 * <strong>I)</strong> = homonym, "1)" = sense). Pinned to a commit so refs stay stable.
 *   https://github.com/stscoundrel/old-icelandic-zoega
 *
 * Chosen over Cleasby–Vigfússon (1874; 35k articles, same author's JSON): Zoëga's
 * articles state grammar and part of speech in a fixed form and set every English
 * meaning in italics, so glosses and senses come out clean, and its spelling is the
 * normalised Old Norse one (œ, ø, -r endings) that Wiktionary uses; Cleasby–Vigfússon
 * writes modern Icelandic æ for œ and ö for ø, mixes in modern Icelandic words, and
 * buries meanings in long running prose.
 *
 * One entry per homonym (afl I "hearth of a forge", afl II "strength"). Headwords:
 * Zoëga's spelling with ö written ǫ, as Wiktionary normalises it (jörð → jǫrð, dvöl →
 * dvǫl); Zoëga's own spelling and grammar ("jörð (gen. jarðar …), f.") stay in `notes`,
 * and "~" in the citations is expanded to the headword. Cross-references become
 * relations: "see X" / "= X" on an otherwise empty article → variant_of, "= X" inside
 * an article → synonym_of, "opp. to X" → antonym_of, "cf. X" and inflected-form
 * pointers ("kømr from koma") → see_also.
 */
import { and, eq, inArray, lt } from "drizzle-orm"
import {
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
import { truncate } from "../lib/text"
import type { Importer } from "../registry"
import { WIKTIONARY_LANGUAGES } from "./wiktionary"

const COMMIT = "73da269410f0ee6f3d98c2eb1cb253ad073b2880"
const FILE = "zoega.json"
const URL = `https://raw.githubusercontent.com/stscoundrel/old-icelandic-zoega/${COMMIT}/json/${FILE}`

export const zoegaSource = {
  id: "zoega",
  title: "Zoëga, A Concise Dictionary of Old Icelandic (1910), digital edition by Sampo Silvennoinen",
  url: "https://github.com/stscoundrel/old-icelandic-zoega",
  license: "Public domain (1910 print edition); digital edition MIT",
  citation: `Geir T. Zoëga, A Concise Dictionary of Old Icelandic (Oxford: Clarendon Press, 1910); machine-readable edition: Sampo Silvennoinen, old-icelandic-zoega (MIT), https://github.com/stscoundrel/old-icelandic-zoega, commit ${COMMIT.slice(0, 7)}.`,
}

export const oldNorseLanguage = WIKTIONARY_LANGUAGES.find((l) => l.language.id === "non")!.language

const NOTE_XR = "Zoëga cross-reference"
const NOTE_VAR = "Zoëga variant"
const NOTE_SYN = "Zoëga synonym"
const NOTE_ANT = "Zoëga antonym"
const NOTE_FORM = "Zoëga inflected form"
const OWN_NOTES = [NOTE_XR, NOTE_VAR, NOTE_SYN, NOTE_ANT, NOTE_FORM]

type ZoegaArticle = { word: string; definitions: string[] }

/* ── text ─────────────────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:.)])/g, "$1")
    .trim()
}

/** Plain text with the italic (English) runs removed: where Zoëga's own cross-reference words live. */
const nonItalic = (html: string) => plain(html.replace(/<i>[\s\S]*?<\/i>/g, " … "))

function italics(html: string): string[] {
  return [...html.matchAll(/<i>([\s\S]*?)<\/i>/g)].map((m) => plain(m[1]!).replace(/[\s,;:]+$/, "").replace(/\.$/, "")).filter((s) => /\p{L}/u.test(s))
}

/** Zoëga's ö is the u-umlaut ǫ of normalised Old Norse (jörð → jǫrð); his ø and œ are kept. */
export function normaliseNorse(s: string): string {
  return s.normalize("NFC").replace(/ö/g, "ǫ").replace(/Ö/g, "Ǫ")
}

/* ── grammar ──────────────────────────────────────────────────────────────── */

const PRON = /^(?:(?:pers|poss|indef|dem|rel|interrog|refl|reflex)\.\s*)?pron\./
function posOf(label: string, proper: boolean): PartOfSpeech | undefined {
  const l = label.trim()
  if (/^(?:[mfn]\.|neut\.|pl\.)/.test(l)) return proper ? "proper_noun" : "noun"
  if (/^a\./.test(l)) return "adjective"
  if (/^adv\./.test(l)) return "adverb"
  if (/^(?:v\.|pp\.|pr\.\s*p\.)/.test(l)) return "verb"
  if (/^prep\./.test(l)) return "preposition"
  if (/^conj\./.test(l)) return "conjunction"
  if (/^interj\./.test(l)) return "interjection"
  if (PRON.test(l)) return "pronoun"
  if (/^(?:card\.|ord\.|num\.)/.test(l)) return "numeral"
  if (/^art\./.test(l)) return "determiner"
  if (/^(?:neg\.|part\.|particle)/.test(l)) return "particle"
  return undefined
}

const GENDER: [RegExp, string][] = [
  [/^m\./, "masculine"],
  [/^f\./, "feminine"],
  [/^n\./, "neuter"],
  [/^neut\./, "neuter"],
]

function grammarWords(label: string, pos: PartOfSpeech | undefined): string {
  const out: string[] = []
  const g = GENDER.find(([re]) => re.test(label))
  if (g) out.push(g[1])
  if (/\bpl\./.test(label) && pos === "noun") out.push("plural")
  if (/\bindecl\./.test(label)) out.push("indeclinable")
  if (/\bcompar\./.test(label)) out.push("comparative")
  if (/\bsuperl\./.test(label)) out.push("superlative")
  if (/\brefl\./.test(label) && pos === "verb") out.push("reflexive")
  if (/\bimpers\./.test(label)) out.push("impersonal")
  if (/^pp\./.test(label)) out.push("past participle")
  if (/^pr\.\s*p\./.test(label)) out.push("present participle")
  if (/\bpoet\./.test(label)) out.push("poetic")
  if (pos && !/participle/.test(out.join(" "))) out.push(pos === "proper_noun" ? "proper noun" : pos)
  return out.join(" ")
}

/* ── parsing ──────────────────────────────────────────────────────────────── */

type ZSense = { n?: string; html: string }
export type ZHomonym = {
  /** Zoëga's headword and its position: "afl", the 1st article of that spelling, homonym "II". */
  word: string
  ref: string
  roman?: string
  head: string
  label: string
  senses: ZSense[]
  html: string
}

/** Split an article at its homonym numerals and numbered senses. */
export function parseArticle(a: ZoegaArticle, ref: string): ZHomonym[] {
  const groups: { roman?: string; segs: string[] }[] = []
  for (const raw of a.definitions) {
    const seg = raw.trim()
    const hom = seg.match(/^<strong>([IVX]+)\)<\/strong>\s*([\s\S]*)$/)
    if (hom) {
      groups.push({ roman: hom[1], segs: hom[2] ? [hom[2]] : [] })
      continue
    }
    if (!groups.length) groups.push({ segs: [] })
    groups.at(-1)!.segs.push(seg)
  }
  return groups
    .filter((g) => g.segs.some((s) => plain(s)))
    .map((g) => {
      const head: string[] = []
      const senses: ZSense[] = []
      for (const seg of g.segs) {
        const num = seg.match(/^(\d+)\)\s*([\s\S]*)$/)
        if (num) senses.push({ n: num[1], html: num[2]! })
        else if (senses.length) senses.at(-1)!.html += ` ${seg}`
        else head.push(seg)
      }
      const headHtml = head.join(" ")
      // grammar: what precedes the first meaning ("(gen. jarðar, dat. jörðu; pl. jarðir), f.")
      const before = plain(headHtml.split("<i>")[0] ?? "")
      const label = before
        .replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s,;]+/, "")
      // a single unnumbered meaning: the grammar ("(-s, -ar), m.") is not part of it
      const at = headHtml.indexOf("<i>")
      const grammarOnly = at > 0 && /^[\s,;]*(?:(?:\p{L}+\.\s*)+[,;]?\s*)*$/u.test(label)
      if (!senses.length) senses.push({ html: grammarOnly ? headHtml.slice(at) : headHtml })
      return {
        word: a.word,
        ref: g.roman ? `${ref}/${g.roman}` : ref,
        roman: g.roman,
        head: before.replace(/[\s,;:]+$/, ""),
        label,
        senses,
        html: g.segs.join(" "),
      }
    })
}

/* ── conversion ───────────────────────────────────────────────────────────── */

const TARGET = String.raw`((?:\p{L}|\p{M}|-)+(?:\s+(?:\p{Ll}|\p{M})+)?)`
const SEE = new RegExp(String.raw`(?:^|[\s(;,])(?:see|=)\s+${TARGET}`, "u")
const FROM = new RegExp(String.raw`(?:^|[\s(;,.])(?:from|of)\s+[‘']?${TARGET}`, "u")

/** "kømr from koma", "alda (II) gen. pl. of öld": an inflected form with no meaning of its own. */
function formOf(h: ZHomonym): { target: string; label: string } | undefined {
  const t = nonItalic(h.html)
  if (!/^(?:[\p{L}.\s]*\s)?(?:from|of)\s/u.test(`${t} `) || t.length > 80) return undefined
  const m = t.match(FROM)
  if (!m) return undefined
  const label = t.slice(0, m.index).replace(/[\s,;]+$/, "").trim()
  return { target: m[1]!.replace(/[.,;]+$/, ""), label }
}

/** "gera | v. see gøra", "kektunarmaðr | = klektunarmaðr": a pointer to another article. */
function pointerOf(h: ZHomonym): { target: string; kind: "see" | "=" } | undefined {
  if (italics(h.html).length) return undefined
  const t = nonItalic(h.html)
  const m = t.match(SEE)
  if (!m || t.length > 90) return undefined
  return { target: m[1]!.replace(/[.,;]+$/, ""), kind: /=\s*$/.test(t.slice(0, (m.index ?? 0) + m[0].indexOf(m[1]!))) ? "=" : "see" }
}

function senseGloss(html: string): string {
  const first = italics(html)[0]
  if (first) return first
  return plain(html).replace(/[\s,;:.]+$/, "")
}

function expandTilde(s: string, word: string): string {
  return s.replace(/~/g, word)
}

export function convertHomonym(h: ZHomonym): SeedEntry | null {
  const headword = normaliseNorse(h.word.trim())
  if (!/\p{L}/u.test(headword)) return null
  const proper = /^\p{Lu}/u.test(headword)
  const form = formOf(h)
  const pointer = form ? undefined : pointerOf(h)
  const pos = posOf(h.label, proper)

  let gloss: string
  if (form) {
    const meaning = italics(h.html)[0]
    gloss = `${form.label ? `${form.label} ` : "form "}of ${normaliseNorse(form.target)}${meaning ? ` (${meaning})` : ""}`
  } else if (pointer) {
    gloss = `${pointer.kind === "=" ? "=" : "see"} ${normaliseNorse(pointer.target)}`
  } else {
    gloss = senseGloss(h.senses[0]!.html)
  }
  gloss = truncate(expandTilde(gloss, h.word).replace(/^[\s,;:]+/, ""), 120)
  if (!gloss) return null

  const senses: SeedSense[] = []
  if (!form && !pointer) {
    for (const s of h.senses) {
      const g = senseGloss(s.html)
      if (!g) continue
      const full = expandTilde(plain(s.html), h.word)
      senses.push({
        gloss: truncate(expandTilde(g, h.word), 200),
        definition: full.length > g.length + 3 ? truncate(full, 600) : undefined,
        domain: s.n && h.senses.length > 1 ? `sense ${s.n}` : undefined,
      })
    }
  }

  const notes: string[] = []
  notes.push(`Zoëga: ${h.word}${h.roman ? ` (${h.roman})` : ""}${h.head ? ` ${h.head}` : ""}.`.replace(/\.\.$/, "."))
  const grammar = grammarWords(h.label, pos)
  if (grammar) notes.push(`Grammar: ${grammar}.`)

  const text = expandTilde(plain(h.html), h.word)
  const meaningText = expandTilde(plain(h.senses.map((s) => s.html).join(" ")), h.word).replace(/[\s.]+$/, "")
  const base = {
    headword,
    pos,
    gloss,
    definition: h.senses.length > 1 || meaningText.length > gloss.length + 10 ? truncate(text, 1500) : undefined,
    notes: notes.join(" "),
    ref: h.ref,
    senses: senses.slice(0, 30),
  }
  if (/^-/.test(headword)) return { kind: "part", partKind: "suffix", ...base, pos: undefined }
  if (/\p{L}-$/u.test(headword)) return { kind: "part", partKind: "prefix", ...base, pos: undefined }
  return { kind: "word", ...base }
}

/* ── relations ────────────────────────────────────────────────────────────── */

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[b.length]!
}

type Built = { h: ZHomonym; entry: SeedEntry }
type Rel = { from: string; to: string; type: SeedRelation["type"]; note: string }

export function zoegaRelations(built: Built[]): Rel[] {
  const byWord = new Map<string, Built[]>()
  for (const b of built) {
    const k = b.h.word.toLowerCase()
    byWord.set(k, [...(byWord.get(k) ?? []), b])
  }
  /** One article of that spelling (a part-of-speech hint picks among homonyms: "cf. blanda, v."). */
  const resolve = (target: string, hint?: string): Built | undefined => {
    const cands = byWord.get(target.toLowerCase()) ?? []
    if (cands.length <= 1) return cands[0]
    const p = hint ? posOf(hint, false) : undefined
    const byPos = p ? cands.filter((c) => c.entry.pos === p) : []
    return byPos.length === 1 ? byPos[0] : undefined
  }
  const out: Rel[] = []
  const push = (from: Built, target: string, type: Rel["type"], note: string, hint?: string) => {
    const to = resolve(target.replace(/[.,;:]+$/, ""), hint)
    if (to && to !== from) out.push({ from: from.entry.ref!, to: to.entry.ref!, type, note })
  }
  for (const b of built) {
    const h = b.h
    const form = formOf(h)
    if (form) {
      push(b, form.target, "see_also", NOTE_FORM)
      continue
    }
    const pointer = pointerOf(h)
    if (pointer) {
      const near = levenshtein(h.word.toLowerCase(), pointer.target.toLowerCase()) <= Math.max(2, Math.floor(h.word.length / 3))
      push(b, pointer.target, pointer.kind === "=" && !near ? "synonym_of" : "variant_of", pointer.kind === "=" && !near ? NOTE_SYN : NOTE_VAR)
      continue
    }
    const t = nonItalic(h.html)
    for (const m of t.matchAll(new RegExp(String.raw`(?:^|[\s(;,])=\s*${TARGET}`, "gu"))) push(b, m[1]!, "synonym_of", NOTE_SYN)
    for (const m of t.matchAll(new RegExp(String.raw`\bopp\.\s+(?:to\s+)?${TARGET}`, "gu"))) push(b, m[1]!, "antonym_of", NOTE_ANT)
    for (const m of t.matchAll(new RegExp(String.raw`\b(?:cf\.|see)\s+${TARGET}(?:,\s*((?:[a-z]+\.\s*)+))?`, "gu"))) push(b, m[1]!, "see_also", NOTE_XR, m[2])
  }
  const seen = new Set<string>()
  return out.filter((x) => {
    const k = `${x.from}|${x.to}|${x.type}`
    if (seen.has(k) || x.from === x.to) return false
    seen.add(k)
    return true
  })
}

/* ── loading ──────────────────────────────────────────────────────────────── */

export async function loadZoega(file: string, limit?: number) {
  const articles = JSON.parse(await readCached(file)) as ZoegaArticle[]
  const seenWord = new Map<string, number>()
  const built: Built[] = []
  let skipped = 0
  for (const a of articles) {
    if (limit && built.length >= limit) break
    if (!a.word || !Array.isArray(a.definitions)) continue
    const n = (seenWord.get(a.word) ?? 0) + 1
    seenWord.set(a.word, n)
    const ref = n > 1 ? `${a.word}#${n}` : a.word
    for (const h of parseArticle(a, ref)) {
      const entry = convertHomonym(h)
      if (entry) built.push({ h, entry })
      else skipped++
    }
  }
  return { articles: articles.length, built, skipped }
}

function keyToRef(key: string): EntryRef {
  const parts = key.split("|")
  return { lang: parts[0]!, kind: parts[1] as EntryRef["kind"], headword: parts.slice(2, -1).join("|"), homonym: Number(parts.at(-1)) }
}

export const zoegaImporter: Importer = {
  id: "zoega",
  language: "non",
  description: "Zoëga, Concise Dictionary of Old Icelandic (1910, ~30k articles)",
  async run({ db, log, limit, offline, prune }) {
    const startedAt = new Date()
    const file = await download("zoega", FILE, URL, { offline, log })
    const { articles, built, skipped } = await loadZoega(file, limit)
    const entries = built.map((b) => b.entry)
    log(`${FILE}: ${articles} articles → ${entries.length} entries (homonyms split)${skipped ? `, ${skipped} without content skipped` : ""}`)

    const dataset: SeedDataset = { language: oldNorseLanguage, source: zoegaSource, entries }
    const result = await upsertDataset(db, dataset, { log, batchSize: 250 })
    if (prune && !limit) {
      const stale = await db
        .delete(entriesTable)
        .where(and(eq(entriesTable.sourceId, zoegaSource.id), lt(entriesTable.updatedAt, startedAt)))
        .returning({ id: entriesTable.id })
      log(`pruned ${stale.length} stale entries`)
    }

    const rels: SeedRelation[] = []
    const counts: Record<string, number> = {}
    for (const x of zoegaRelations(built)) {
      const from = result.keyOfRef.get(x.from)
      const to = result.keyOfRef.get(x.to)
      if (!from || !to) continue
      rels.push({ from: keyToRef(from), to: keyToRef(to), type: x.type, confidence: x.type === "see_also" ? "likely" : "certain", note: x.note })
      counts[x.type] = (counts[x.type] ?? 0) + 1
    }
    log(`relations: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`)
    if (!limit) {
      const ownIds = db.select({ id: entriesTable.id }).from(entriesTable).where(eq(entriesTable.sourceId, zoegaSource.id))
      await db.delete(entryRelations).where(and(inArray(entryRelations.note, OWN_NOTES), inArray(entryRelations.fromEntryId, ownIds)))
    }
    await upsertRelations(db, rels, result.idByKey, { log, batchSize: 500 })
    log(`done — ${entries.length} Zoëga entries`)
  },
}

/**
 * Egyptian hieroglyphs from Unikemet, Unicode's hieroglyph database (Unicode
 * License v3): all 5,000+ encoded signs (the 1,072 of the basic block and the
 * 3,995 of Extended-A, Unicode 16) with their Gardiner / JSesh codes,
 * descriptions, functions (logogram, phonogram, classifier) and phonetic values.
 *   https://www.unicode.org/Public/UCD/latest/ucd/Unikemet.txt
 */
import { hex, unicodeNames, unikemet } from "../lib/unicode"
import { writeSignInventory, type SignInput } from "../lib/signs"
import type { Importer } from "../registry"

export const unikemetSource = {
  id: "unikemet",
  title: "Unikemet — Unicode Egyptian Hieroglyph Database",
  url: "https://www.unicode.org/reports/tr57/",
  license: "Unicode License v3 (free to use, copy and redistribute)",
  citation: "Unicode Character Database, Unikemet.txt (UAX #57: Unikemet), Unicode Consortium.",
}

/** Gardiner's sign-list categories, in his order (Aa last). */
export const GARDINER_CATEGORIES: [string, string][] = [
  ["A", "Man and his occupations"],
  ["B", "Woman and her occupations"],
  ["C", "Anthropomorphic deities"],
  ["D", "Parts of the human body"],
  ["E", "Mammals"],
  ["F", "Parts of mammals"],
  ["G", "Birds"],
  ["H", "Parts of birds"],
  ["I", "Amphibious animals, reptiles"],
  ["K", "Fishes and parts of fishes"],
  ["L", "Invertebrates and lesser animals"],
  ["M", "Trees and plants"],
  ["N", "Sky, earth, water"],
  ["O", "Buildings and parts of buildings"],
  ["P", "Ships and parts of ships"],
  ["Q", "Domestic and funerary furniture"],
  ["R", "Temple furniture and sacred emblems"],
  ["S", "Crowns, dress, staves"],
  ["T", "Warfare, hunting, butchery"],
  ["U", "Agriculture, crafts and professions"],
  ["V", "Rope, fibre, baskets, bags"],
  ["W", "Vessels of stone and earthenware"],
  ["X", "Loaves and cakes"],
  ["Y", "Writings, games, music"],
  ["Z", "Strokes, signs derived from hieratic, geometrical figures"],
  ["AA", "Unclassified"],
]
const CATEGORY_RANK = new Map(GARDINER_CATEGORIES.map(([k], i) => [k, i]))

/** "A005A" → "A5A"; "AA001" → "Aa1" — the Gardiner spelling of a catalogue number. */
function gardiner(unik: string): string {
  const m = unik.match(/^([A-Z]+)0*(\d+)(.*)$/)
  if (!m) return unik
  const cat = m[1] === "AA" ? "Aa" : m[1] === "NL" ? "NL" : m[1] === "NU" ? "NU" : m[1]!
  return `${cat}${m[2]}${m[3]}`
}

/** Category in Gardiner's order, then catalogue number, then variant letter (A5 < A5A < A6). */
function gardinerOrder(catKey: string, unik: string): number {
  const m = unik.match(/(\d+)([A-Z]*)$/)
  const number = m ? Number(m[1]) : 0
  const variant = m?.[2] ? m[2].charCodeAt(0) - 64 : 0
  return (CATEGORY_RANK.get(catKey) ?? 99) * 100000 + number * 50 + variant
}

export const unikemetImporter: Importer = {
  id: "unikemet",
  language: "egy",
  description: "Unikemet → 5,000+ Egyptian hieroglyphs with Gardiner numbers, descriptions and phonetic values",
  async run({ db, log, limit, offline, prune }) {
    const [kemet, names] = await Promise.all([unikemet({ offline, log }), unicodeNames({ offline, log })])
    const signs: SignInput[] = []
    const used = new Set<string>()
    for (const [cp, f] of kemet) {
      const unik = f.kEH_UniK
      if (!unik) continue
      // The Gardiner / JSesh code (A1, G17, Aa1) is how Egyptologists cite a sign; Extended-A signs
      // without one keep their catalogue number (A001F). Names must be unique within the script.
      const name = [f.kEH_JSesh, gardiner(unik), unik].find((n) => n && !used.has(n)) ?? hex(cp)
      used.add(name)
      const catKey = (f.kEH_Cat ?? unik).split("-")[0]!.toUpperCase()
      const catName = GARDINER_CATEGORIES.find(([k]) => k === catKey)?.[1]
      const values = (f.kEH_FVal ?? "").split(/\s+/).filter(Boolean)
      const lists: Record<string, string[]> = { UniK: [unik] }
      if (f.kEH_HG) lists.HG = [f.kEH_HG]
      if (f.kEH_IFAO) lists.IFAO = [f.kEH_IFAO]
      signs.push({
        name,
        unicode: String.fromCodePoint(cp),
        codepoints: [hex(cp)],
        unicodeName: names.get(cp),
        unicodeVersion: cp >= 0x13460 ? "16.0" : cp >= 0x1342f ? "15.0" : "5.2",
        aliases: [...new Set([unik, f.kEH_JSesh, f.kEH_HG].filter((a): a is string => !!a && a !== name))],
        listNumbers: lists,
        description: f.kEH_Desc,
        category: catName ? `${catKey === "AA" ? "Aa" : catKey} — ${catName}` : undefined,
        notes: [f.kEH_Func, f.kEH_Core === "L" ? "Legacy sign: kept for compatibility, not part of the core repertoire." : null]
          .filter(Boolean)
          .join("\n") || undefined,
        sourceRef: unik,
        readings: values.map((value) => ({ value, language: "egy" })),
        // Gardiner order: category, then catalogue number
        sortOrder: gardinerOrder(catKey, unik),
      })
    }
    signs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    log(`Unikemet: ${signs.length} hieroglyphs (${signs.filter((s) => s.readings?.length).length} with phonetic values)`)
    await writeSignInventory(db, {
      scriptId: "egyptian-hieroglyphs",
      source: unikemetSource,
      signs: limit ? signs.slice(0, limit) : signs,
      log,
      prune: prune && !limit,
    })
  },
}

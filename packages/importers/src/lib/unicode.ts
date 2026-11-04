/**
 * Unicode Character Database files (Unicode License v3, free to use and
 * redistribute): character names from UnicodeData.txt and the Egyptian
 * hieroglyph database Unikemet.txt. Cached under `.cache/importers/unicode/`.
 */
import { download, readCached } from "./cache"

export const UCD_URL = "https://www.unicode.org/Public/UCD/latest/ucd/"

type Opts = { offline: boolean; log: (m: string) => void }

export async function ucdFile(name: string, opts: Opts): Promise<string> {
  const file = await download("unicode", name, `${UCD_URL}${name}`, opts)
  return readCached(file)
}

/** Code point → character name (ranges such as CJK ideographs are skipped). */
export async function unicodeNames(opts: Opts): Promise<Map<number, string>> {
  const names = new Map<number, string>()
  for (const line of (await ucdFile("UnicodeData.txt", opts)).split("\n")) {
    const [hex, name] = line.split(";")
    if (!hex || !name || name.startsWith("<")) continue
    names.set(parseInt(hex, 16), name)
  }
  return names
}

/** Unikemet: code point → { kEH_Cat, kEH_Desc, kEH_FVal, kEH_JSesh, kEH_UniK, … }. */
export async function unikemet(opts: Opts): Promise<Map<number, Record<string, string>>> {
  const rows = new Map<number, Record<string, string>>()
  for (const line of (await ucdFile("Unikemet.txt", opts)).split("\n")) {
    if (!line.startsWith("U+")) continue
    const [cp, field, value] = line.split("\t")
    if (!cp || !field || value === undefined) continue
    const n = parseInt(cp.slice(2), 16)
    const row = rows.get(n) ?? {}
    row[field] = value.trim()
    rows.set(n, row)
  }
  return rows
}

export const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`

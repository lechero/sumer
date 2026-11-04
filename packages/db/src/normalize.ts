/**
 * Diacritic-, pointing- and separator-insensitive search keys.
 *
 * `normalizeForSearch` is the strict key (applied to the user's query):
 *   "e₂-gal" → "e2gal"   "šeš" → "ses"   "saŋ" → "sag"   "λόγος" → "λογοσ"
 *   "מֶלֶךְ" → "מלכ"       "ʾĕlōhîm" → "elohim"
 *
 * `buildSearchKey` is what gets stored on an entry: the strict key of every
 * field plus a "popular spelling" variant (š → sh, ḵ → kh, ḇ → v, …) and
 * digit-free variants, joined by spaces, so that "shalom", "salom", "šālôm",
 * "egal" and "e2-gal" all find their entry.
 */
const SUBSCRIPT_DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
}

const LETTER_MAP: Record<string, string> = {
  "ŋ": "g", "Ŋ": "g", "ĝ": "g", "Ĝ": "g",
  "ʾ": "", "ʿ": "", "ʔ": "", "ʕ": "", "ʼ": "", "’": "", "'": "",
  "ς": "σ",
  // Egyptological aleph and ayin drop like ʾ ʿ (their popular spelling is "a", below); yod ꞽ is "i"
  "ꜣ": "", "Ꜣ": "", "ꜥ": "", "Ꜥ": "", "ꞽ": "i", "Ꞽ": "i",
  // Hebrew final forms → regular forms
  "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ",
}

/** Applied before diacritics are stripped: how non-specialists usually type these sounds. */
const POPULAR_MAP: Record<string, string> = {
  "š": "sh", "Š": "sh",
  "ṯ": "th", "ḏ": "dh", "ḵ": "kh", "ḫ": "kh", "ḥ": "h",
  "ḇ": "v", "p̄": "f", "ṣ": "ts", "ṭ": "t",
  "ŋ": "ng", "Ŋ": "ng", "ĝ": "ng", "Ĝ": "ng",
  // Egyptian: rꜥ "Ra", mꜣꜥt "Maat"
  "ꜣ": "a", "Ꜣ": "a", "ꜥ": "a", "Ꜥ": "a",
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function applyMap(s: string, map: Record<string, string>): string {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length).map(escapeRegExp)
  return s.replace(new RegExp(keys.join("|"), "gu"), (m) => map[m] ?? m)
}

export function normalizeForSearch(input: string, opts: { popular?: boolean } = {}): string {
  let s = input.normalize("NFC")
  if (opts.popular) s = applyMap(s, POPULAR_MAP)
  s = s.normalize("NFD")
  // strip combining marks: Latin diacritics, Greek accents/breathings, Hebrew points & cantillation
  s = s.replace(/\p{M}+/gu, "")
  s = s.replace(/[₀-₉]/g, (d) => SUBSCRIPT_DIGITS[d] ?? d)
  s = applyMap(s, LETTER_MAP)
  // drop separators entirely so "e2-gal", "e2 gal" and "e2gal" collapse together
  s = s.replace(/[\s\-‐‑‒–—־_.·,;:()[\]{}"«»⸗]+/gu, "")
  return s.toLowerCase().normalize("NFC")
}

/** Space-separated set of key variants for the given fields (headword, transliteration, native script …). */
export function buildSearchKey(fields: (string | null | undefined)[]): string {
  const variants = new Set<string>()
  for (const field of fields) {
    if (!field) continue
    for (const popular of [false, true]) {
      const key = normalizeForSearch(field, { popular })
      if (!key) continue
      variants.add(key)
      const digitless = key.replace(/\d+/g, "")
      if (digitless && digitless !== key) variants.add(digitless)
    }
  }
  return [...variants].join(" ")
}

/**
 * Simple Coptic → Latin romanisation for search and display:
 *   ⲛⲟⲩⲧⲉ → noute   ϣⲏⲣⲉ → šēre   ϩⲙϩⲁⲗ → hmhal   ϫⲟⲉⲓⲥ → joeis   ⲡⲛⲟⲩⲧⲉ ⲡⲉ → pnoute pe
 * Supralinear strokes and other combining marks are dropped; the nominal (-) and
 * pronominal (⸗) state markers, spaces and brackets pass through.
 */
const MAP: Record<string, string> = {
  ⲁ: "a", ⲃ: "b", ⲅ: "g", ⲇ: "d", ⲉ: "e", ⲍ: "z", ⲏ: "ē", ⲑ: "th", ⲓ: "i", ⲕ: "k", ⲗ: "l", ⲙ: "m",
  ⲛ: "n", ⲝ: "ks", ⲟ: "o", ⲡ: "p", ⲣ: "r", ⲥ: "s", ⲧ: "t", ⲩ: "u", ⲫ: "ph", ⲭ: "kh", ⲯ: "ps", ⲱ: "ō",
  ϣ: "š", ϥ: "f", ϧ: "x", ϩ: "h", ϫ: "j", ϭ: "c", ϯ: "ti",
  // dialectal / Old Coptic letters
  ⳉ: "x", // Akhmimic khei
  ⳅ: "š", // Old Coptic shei
  ⳇ: "š", // Old Coptic esh
  ⲹ: "k", // dialect-P kapa
  ⲋ: "s", // sou (numeral 6)
  "⳯": "n", // combining ni above: an abbreviated ⲛ
  // stray Greek letters occasionally typed for their Coptic look-alikes
  ι: "i", ο: "o",
}

export function transliterateCoptic(word: string): string {
  let out = ""
  for (const ch of word.normalize("NFD")) {
    const lower = ch.toLowerCase()
    const latin = MAP[lower]
    if (latin !== undefined) {
      out += ch === lower ? latin : latin.charAt(0).toUpperCase() + latin.slice(1)
      continue
    }
    if (/\p{M}/u.test(ch)) continue // supralinear strokes (U+0305, U+FE24–FE26), jinkim, dots below …
    out += ch
  }
  return out.normalize("NFC")
}

/** Fix the handful of Greek look-alike letters typed inside Coptic words (ο → ⲟ, ι → ⲓ). */
export function fixCopticLookalikes(word: string): string {
  if (!/[ιο]/u.test(word) || !/\p{Script=Coptic}/u.test(word)) return word
  return word.replace(/ι/gu, "ⲓ").replace(/ο/gu, "ⲟ")
}

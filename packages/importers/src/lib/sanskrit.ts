/**
 * Sanskrit transliteration: SLP1 (the ASCII coding of the Cologne Digital
 * Sanskrit Dictionaries) → IAST and → Devanagari, and IAST → SLP1.
 *
 *   SLP1 "agni/"     → IAST "agní"      Devanagari "अग्नि"
 *   SLP1 "saMskfta"  → IAST "saṃskṛta"  Devanagari "संस्कृत"
 *   SLP1 "so'ham"    → IAST "so'ham"    Devanagari "सोऽहम्"
 *
 * Vedic accents (Cologne marks them after the vowel): `/` udātta → acute
 * (á, ā́, ṛ́, ái), `^` independent svarita → grave (à), `\` anudātta → dropped,
 * as Wiktionary and most Vedic dictionaries romanise them. Devanagari output
 * never carries accents. A vowel i / u written after a in hiatus (SLP1 "au"
 * is a + u, "O" the diphthong) is romanised with a diaeresis: praüga, títaü.
 * Characters that are not SLP1 letters (digits, spaces, punctuation, -, ˚, √)
 * pass through unchanged.
 */

type Vowel = { iast: string; deva: string; sign: string }

const VOWELS: Record<string, Vowel> = {
  a: { iast: "a", deva: "अ", sign: "" },
  A: { iast: "ā", deva: "आ", sign: "ा" },
  i: { iast: "i", deva: "इ", sign: "ि" },
  I: { iast: "ī", deva: "ई", sign: "ी" },
  u: { iast: "u", deva: "उ", sign: "ु" },
  U: { iast: "ū", deva: "ऊ", sign: "ू" },
  f: { iast: "ṛ", deva: "ऋ", sign: "ृ" },
  F: { iast: "ṝ", deva: "ॠ", sign: "ॄ" },
  x: { iast: "ḷ", deva: "ऌ", sign: "ॢ" },
  X: { iast: "ḹ", deva: "ॡ", sign: "ॣ" },
  e: { iast: "e", deva: "ए", sign: "े" },
  E: { iast: "ai", deva: "ऐ", sign: "ै" },
  o: { iast: "o", deva: "ओ", sign: "ो" },
  O: { iast: "au", deva: "औ", sign: "ौ" },
}

const CONSONANTS: Record<string, { iast: string; deva: string }> = {
  k: { iast: "k", deva: "क" },
  K: { iast: "kh", deva: "ख" },
  g: { iast: "g", deva: "ग" },
  G: { iast: "gh", deva: "घ" },
  N: { iast: "ṅ", deva: "ङ" },
  c: { iast: "c", deva: "च" },
  C: { iast: "ch", deva: "छ" },
  j: { iast: "j", deva: "ज" },
  J: { iast: "jh", deva: "झ" },
  Y: { iast: "ñ", deva: "ञ" },
  w: { iast: "ṭ", deva: "ट" },
  W: { iast: "ṭh", deva: "ठ" },
  q: { iast: "ḍ", deva: "ड" },
  Q: { iast: "ḍh", deva: "ढ" },
  R: { iast: "ṇ", deva: "ण" },
  t: { iast: "t", deva: "त" },
  T: { iast: "th", deva: "थ" },
  d: { iast: "d", deva: "द" },
  D: { iast: "dh", deva: "ध" },
  n: { iast: "n", deva: "न" },
  p: { iast: "p", deva: "प" },
  P: { iast: "ph", deva: "फ" },
  b: { iast: "b", deva: "ब" },
  B: { iast: "bh", deva: "भ" },
  m: { iast: "m", deva: "म" },
  y: { iast: "y", deva: "य" },
  r: { iast: "r", deva: "र" },
  l: { iast: "l", deva: "ल" },
  v: { iast: "v", deva: "व" },
  S: { iast: "ś", deva: "श" },
  z: { iast: "ṣ", deva: "ष" },
  s: { iast: "s", deva: "स" },
  h: { iast: "h", deva: "ह" },
  // Vedic intervocalic ḍ / ḍh
  L: { iast: "ḷ", deva: "ळ" },
  "|": { iast: "ḷh", deva: "ळ्ह" },
}

/** Signs that follow a vowel (or a consonant cluster ending in one). */
const MARKS: Record<string, { iast: string; deva: string }> = {
  M: { iast: "ṃ", deva: "ं" }, // anusvāra
  H: { iast: "ḥ", deva: "ः" }, // visarga
  "~": { iast: "m̐", deva: "ँ" }, // candrabindu
  Z: { iast: "ẖ", deva: "ᳵ" }, // jihvāmūlīya
  V: { iast: "ḫ", deva: "ᳶ" }, // upadhmānīya
}

const ACCENTS: Record<string, string> = { "/": "́", "^": "̀", "\\": "" }
const VIRAMA = "्"

/** SLP1 → IAST, keeping Vedic accents (udātta acute, svarita grave). */
export function slp1ToIast(slp1: string): string {
  let out = ""
  let lastVowel = "" // the SLP1 vowel just written (accents attach to it)
  let lastVowelAt = 0 // where its romanisation starts in `out`
  for (const ch of slp1) {
    const v = VOWELS[ch]
    if (v) {
      // a + i / a + u in hiatus: praüga, títaü — not the diphthongs ai / au
      const iast = lastVowel === "a" && ch === "i" ? "ï" : lastVowel === "a" && ch === "u" ? "ü" : v.iast
      lastVowel = ch
      lastVowelAt = out.length
      out += iast
      continue
    }
    if (ch in ACCENTS) {
      const mark = ACCENTS[ch]!
      if (!lastVowel || !mark) continue
      // the mark sits on the first letter of the vowel: ái, áu; ā́, ṛ́ take it after the letter
      if (lastVowel === "E" || lastVowel === "O") out = `${out.slice(0, lastVowelAt + 1)}${mark}${out.slice(lastVowelAt + 1)}`
      else out += mark
      continue
    }
    lastVowel = ""
    const c = CONSONANTS[ch] ?? MARKS[ch]
    out += c ? c.iast : ch
  }
  return out.normalize("NFC")
}

/** SLP1 → Devanagari (accents dropped; final consonants take a virāma). */
export function slp1ToDevanagari(slp1: string): string {
  let out = ""
  let pending = false // a consonant without its vowel yet
  for (const ch of slp1) {
    const v = VOWELS[ch]
    if (v) {
      out += pending ? v.sign : v.deva
      pending = false
      continue
    }
    if (ch in ACCENTS) continue
    const c = CONSONANTS[ch]
    if (c) {
      if (pending) out += VIRAMA
      out += c.deva
      pending = true
      continue
    }
    if (pending) out += VIRAMA
    pending = false
    const m = MARKS[ch]
    if (m) out += m.deva
    else if (ch === "'") out += "ऽ"
    else out += ch
  }
  if (pending) out += VIRAMA
  return out.normalize("NFC")
}

/* ── IAST → SLP1 ──────────────────────────────────────────────────────────── */

const IAST_CLUSTERS: Record<string, string> = {
  a: "a",
  "ā": "A",
  i: "i",
  "ī": "I",
  "ï": "i", // hiatus ï
  u: "u",
  "ū": "U",
  "ü": "u", // hiatus ü
  "ṛ": "f",
  "r̥": "f", // r̥ (ISO 15919)
  "ṝ": "F",
  "r̥̄": "F",
  "ḷ": "x",
  "l̥": "x",
  "ḹ": "X",
  "l̥̄": "X",
  e: "e",
  "ē": "e",
  o: "o",
  "ō": "o",
  k: "k",
  g: "g",
  "ṅ": "N",
  c: "c",
  j: "j",
  "ñ": "Y",
  "ṭ": "w",
  "ḍ": "q",
  "ṇ": "R",
  t: "t",
  d: "d",
  n: "n",
  p: "p",
  b: "b",
  m: "m",
  y: "y",
  r: "r",
  l: "l",
  v: "v",
  "ś": "S",
  "ṣ": "z",
  s: "s",
  h: "h",
  "ṃ": "M",
  "ṁ": "M",
  "m̐": "~",
  "ḥ": "H",
  "ẖ": "Z",
  "ḫ": "V",
  "'": "'",
  "’": "'",
}
const ASPIRATES: Record<string, string> = { k: "K", g: "G", c: "C", j: "J", w: "W", q: "Q", t: "T", d: "D", p: "P", b: "B", L: "|" }
const VOWEL_SLP1 = new Set("aAiIuUfFxXeEoO")

/**
 * IAST (or ISO 15919) → SLP1. Accents become `/` (acute) and `^` (grave);
 * "ai" / "au" are the diphthongs unless the second vowel has a diaeresis.
 * Letters outside the Sanskrit alphabet pass through.
 */
export function iastToSlp1(iast: string): string {
  // split into base letter + its combining marks; accents are pulled out of the mark sequence
  const clusters: { key: string; accent: string; raw: string }[] = []
  for (const ch of iast.normalize("NFD").toLowerCase()) {
    if (/\p{M}/u.test(ch) && clusters.length) {
      const last = clusters.at(-1)!
      last.raw += ch
      if (ch === "́" && last.key !== "s") last.accent = "/"
      else if (ch === "̀") last.accent = "^"
      else last.key += ch
      continue
    }
    clusters.push({ key: ch, accent: "", raw: ch })
  }
  let out = ""
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!
    const next = clusters[i + 1]
    let s = IAST_CLUSTERS[c.key]
    if (s === undefined) {
      out += c.raw.normalize("NFC")
      continue
    }
    // ai / au diphthongs (the accent, if any, sits on the a)
    if (c.key === "a" && next && !next.accent && (next.key === "i" || next.key === "u")) {
      out += (next.key === "i" ? "E" : "O") + c.accent
      i++
      continue
    }
    // ḷ before a vowel (or ḷh) is the Vedic consonant ळ
    if (s === "x" && next && (next.key === "h" || VOWEL_SLP1.has(IAST_CLUSTERS[next.key] ?? ""))) s = "L"
    // aspirates: kh, gh, ṭh, ḍh, ḷh …
    if (next?.key === "h" && ASPIRATES[s]) {
      out += ASPIRATES[s]
      i++
      continue
    }
    out += s + c.accent
  }
  return out
}

/** IAST → Devanagari (accents dropped). */
export function iastToDevanagari(iast: string): string {
  return slp1ToDevanagari(iastToSlp1(iast))
}

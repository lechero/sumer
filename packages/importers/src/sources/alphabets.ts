/**
 * Alphabets, abjads and syllabaries of the ancient world, built from the
 * Unicode Character Database (names, code points) plus the conventional
 * transliteration of each letter (compiled for this dictionary). Covers
 * Ugaritic, Phoenician, Hebrew, Imperial Aramaic, Syriac, Old South Arabian,
 * Ge'ez, Old Persian, Devanagari, Anatolian hieroglyphs, Linear A and B, the
 * Cypriot syllabary, Greek, Old Italic, Coptic, Armenian, Early Cyrillic,
 * Gothic, Runic and Ogham.
 */
import { hex, unicodeNames } from "../lib/unicode"
import { writeSignInventory, type SignInput } from "../lib/signs"
import type { Importer } from "../registry"
import type { ScriptId } from "@workspace/db"

export const ucdSource = {
  id: "unicode",
  title: "Unicode Character Database",
  url: "https://www.unicode.org/ucd/",
  license: "Unicode License v3 (names and code points); transliterations compiled for this dictionary (CC0)",
  citation: "The Unicode Standard, Unicode Character Database (UnicodeData.txt), Unicode Consortium.",
}

type Kind = { category: string; reading?: string; name?: string; description?: string; notes?: string } | null

type AlphabetSpec = {
  script: ScriptId
  /** Inclusive code point ranges. */
  ranges: [number, number][]
  /** Unicode name prefix to strip (e.g. "PHOENICIAN "). */
  prefix: string
  /** Classify a code point from its name with the prefix removed; null skips it. */
  classify: (rest: string, cp: number) => Kind
  /** Language tag for the readings. */
  language?: string
}

const SUB = "₀₁₂₃₄₅₆₇₈₉"
const DIGITS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"]
const subscript = (s: string) => s.replace(/\d+$/, (d) => [...d].map((c) => SUB[Number(c)]).join(""))

/** Letters of a fixed-map alphabet; numbers, punctuation and anything unmapped get a category of their own. */
function lettered(map: Record<string, string>, extras: (rest: string) => Kind = () => null, numeric?: Record<string, number>) {
  return (rest: string): Kind => {
    const m = rest.match(/^(?:CAPITAL |SMALL )?LETTER (.+)$/)
    if (m) {
      const name = m[1]!
      const reading = map[name] ?? map[name.replace(/^FINAL /, "")]
      const value = numeric?.[name.replace(/^FINAL /, "")]
      return {
        category: name.startsWith("FINAL ") ? "final form" : reading ? "letter" : "additional letter",
        reading,
        name,
        notes: value ? `Numeric value ${value}.` : undefined,
      }
    }
    if (/^NUMBER |^NUMERAL /.test(rest)) return { category: "numeral", name: rest }
    if (/DIVIDER|SEPARATOR|PUNCTUATION|SECTION|MARK|INDICATOR/.test(rest)) return { category: "punctuation", name: rest }
    return extras(rest)
  }
}

const NW_SEMITIC_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400]
const numericOf = (names: string[]) => Object.fromEntries(names.map((n, i) => [n, NW_SEMITIC_VALUES[i]!]))

const HEBREW = ["ALEF", "BET", "GIMEL", "DALET", "HE", "VAV", "ZAYIN", "HET", "TET", "YOD", "KAF", "LAMED", "MEM", "NUN", "SAMEKH", "AYIN", "PE", "TSADI", "QOF", "RESH", "SHIN", "TAV"]
const PHOENICIAN = ["ALF", "BET", "GAML", "DELT", "HE", "WAU", "ZAI", "HET", "TET", "YOD", "KAF", "LAMD", "MEM", "NUN", "SEMK", "AIN", "PE", "SADE", "QOF", "ROSH", "SHIN", "TAU"]
const ARAMAIC = ["ALEPH", "BETH", "GIMEL", "DALETH", "HE", "WAW", "ZAYIN", "HETH", "TETH", "YODH", "KAPH", "LAMEDH", "MEM", "NUN", "SAMEKH", "AYIN", "PE", "SADHE", "QOPH", "RESH", "SHIN", "TAW"]
const SYRIAC = ["ALAPH", "BETH", "GAMAL", "DALATH", "HE", "WAW", "ZAIN", "HETH", "TETH", "YUDH", "KAPH", "LAMADH", "MIM", "NUN", "SEMKATH", "E", "PE", "SADHE", "QAPH", "RISH", "SHIN", "TAW"]
const NW_SEMITIC = ["ʾ", "b", "g", "d", "h", "w", "z", "ḥ", "ṭ", "y", "k", "l", "m", "n", "s", "ʿ", "p", "ṣ", "q", "r", "š", "t"]
const zip = (names: string[]) => Object.fromEntries(names.map((n, i) => [n, NW_SEMITIC[i]!]))

const UGARITIC: Record<string, string> = {
  ALPA: "ʾa", BETA: "b", GAMLA: "g", KHA: "ḫ", DELTA: "d", HO: "h", WO: "w", ZETA: "z", HOTA: "ḥ", TET: "ṭ",
  YOD: "y", KAF: "k", SHIN: "š", LAMDA: "l", MEM: "m", DHAL: "ḏ", NUN: "n", ZU: "ẓ", SAMKA: "s", AIN: "ʿ",
  PU: "p", SADE: "ṣ", QOPA: "q", RASHA: "r", THANNA: "ṯ", GHAIN: "ġ", TO: "t", I: "ʾi", U: "ʾu", SSU: "s̀",
}

const OLD_SOUTH_ARABIAN: Record<string, string> = {
  HE: "h", LAMEDH: "l", HETH: "ḥ", MEM: "m", QOF: "q", WAW: "w", SHIN: "s²", RESH: "r", BETH: "b", TAW: "t",
  SAT: "s³", KAPH: "k", NUN: "n", KHETH: "ḫ", SADHE: "ṣ", SAMEKH: "s¹", FE: "f", ALEF: "ʾ", AYN: "ʿ",
  DHADHE: "ḍ", GIMEL: "g", DALETH: "d", GHAYN: "ġ", TETH: "ṭ", ZAYN: "z", DHALETH: "ḏ", YODH: "y", THAW: "ṯ", THETH: "ẓ",
}

const GREEK: Record<string, string> = {
  ALPHA: "a", BETA: "b", GAMMA: "g", DELTA: "d", EPSILON: "e", ZETA: "z", ETA: "ē", THETA: "th", IOTA: "i",
  KAPPA: "k", LAMDA: "l", MU: "m", NU: "n", XI: "x", OMICRON: "o", PI: "p", RHO: "r", SIGMA: "s", "FINAL SIGMA": "s",
  TAU: "t", UPSILON: "y", PHI: "ph", CHI: "ch", PSI: "ps", OMEGA: "ō",
  DIGAMMA: "w", "ARCHAIC KOPPA": "q", SAN: "s", "ARCHAIC SAMPI": "ss", HETA: "h",
}
const GREEK_NUMERIC: Record<string, number> = {
  ALPHA: 1, BETA: 2, GAMMA: 3, DELTA: 4, EPSILON: 5, DIGAMMA: 6, ZETA: 7, ETA: 8, THETA: 9, IOTA: 10, KAPPA: 20,
  LAMDA: 30, MU: 40, NU: 50, XI: 60, OMICRON: 70, PI: 80, "ARCHAIC KOPPA": 90, RHO: 100, SIGMA: 200, TAU: 300,
  UPSILON: 400, PHI: 500, CHI: 600, PSI: 700, OMEGA: 800, "ARCHAIC SAMPI": 900,
}

const COPTIC: Record<string, string> = {
  ALFA: "a", VIDA: "b", GAMMA: "g", DALDA: "d", EIE: "e", SOU: "(6)", ZATA: "z", HATE: "ē", THETHE: "th", IAUDA: "i",
  KAPA: "k", LAULA: "l", MI: "m", NI: "n", KSI: "ks", O: "o", PI: "p", RO: "r", SIMA: "s", TAU: "t", UA: "u",
  FI: "ph", KHI: "kh", PSI: "ps", OOU: "ō", SHEI: "š", FEI: "f", KHEI: "x", HORI: "h", GANGIA: "j", SHIMA: "c", DEI: "ti",
}

const GOTHIC: Record<string, string> = {
  AHSA: "a", BAIRKAN: "b", GIBA: "g", DAGS: "d", AIHVUS: "e", QAIRTHRA: "q", IUJA: "z", HAGL: "h", THIUTH: "þ",
  EIS: "i", KUSMA: "k", LAGUS: "l", MANNA: "m", NAUTHS: "n", JER: "j", URUS: "u", PAIRTHRA: "p", NINETY: "(90)",
  RAIDA: "r", SAUIL: "s", TEIWS: "t", WINJA: "w", FAIHU: "f", IGGWS: "x", HWAIR: "ƕ", OTHAL: "o", "NINE HUNDRED": "(900)",
}

const OLD_ITALIC: Record<string, string> = {
  A: "a", BE: "b", KE: "c", DE: "d", E: "e", VE: "v", ZE: "z", HE: "h", THE: "θ", I: "i", KA: "k", EL: "l",
  EM: "m", EN: "n", ESH: "š", O: "o", PE: "p", SHE: "ś", KU: "q", ER: "r", ES: "s", TE: "t", U: "u", EKS: "x",
  PHE: "φ", KHE: "χ", EF: "f", ERS: "ř", CHE: "ç", II: "í", UU: "ú", ESS: "ss", YE: "y", "NORTHERN TSE": "ts", "SOUTHERN TSE": "ts",
}

const OGHAM: Record<string, string> = {
  BEITH: "b", LUIS: "l", FEARN: "f", SAIL: "s", NION: "n", UATH: "h", DAIR: "d", TINNE: "t", COLL: "c", CEIRT: "q",
  MUIN: "m", GORT: "g", NGEADAL: "ng", STRAIF: "z", RUIS: "r", AILM: "a", ONN: "o", UR: "u", EADHADH: "e", IODHADH: "i",
  EABHADH: "ea", OR: "oi", UILLEANN: "ui", IFIN: "ia", EAMHANCHOLL: "ae", PEITH: "p",
}

/** Old Persian logograms, cited by their conventional abbreviations. */
const OLD_PERSIAN_LOGOGRAMS: Record<string, [string, string]> = {
  AURAMAZDAA: ["AM", "Auramazdā (the god Ahura Mazda)"],
  "AURAMAZDAA-2": ["AM₂", "Auramazdā, variant"],
  AURAMAZDAAHA: ["AMha", "Auramazdāha (genitive of Auramazdā)"],
  XSHAAYATHIYA: ["XŠ", "xšāyaθiya, king"],
  DAHYAAUSH: ["DH", "dahyāuš, land, province"],
  "DAHYAAUSH-2": ["DH₂", "dahyāuš, variant"],
  BAGA: ["BG", "baga, god"],
  BUUMISH: ["BU", "būmiš, earth"],
}

/** Devanagari in IAST. Consonants are cited with their inherent a (ka); vowel signs by the vowel they write. */
const DEVANAGARI_VOWELS: Record<string, string> = {
  A: "a", AA: "ā", I: "i", II: "ī", U: "u", UU: "ū", "VOCALIC R": "ṛ", "VOCALIC RR": "ṝ", "VOCALIC L": "ḷ",
  "VOCALIC LL": "ḹ", E: "e", AI: "ai", O: "o", AU: "au", "CANDRA E": "ê", "SHORT E": "ĕ", "CANDRA O": "ô", "SHORT O": "ŏ",
}
const DEVANAGARI_CONSONANTS: Record<string, string> = {
  KA: "k", KHA: "kh", GA: "g", GHA: "gh", NGA: "ṅ", CA: "c", CHA: "ch", JA: "j", JHA: "jh", NYA: "ñ",
  TTA: "ṭ", TTHA: "ṭh", DDA: "ḍ", DDHA: "ḍh", NNA: "ṇ", TA: "t", THA: "th", DA: "d", DHA: "dh", NA: "n", NNNA: "ṉ",
  PA: "p", PHA: "ph", BA: "b", BHA: "bh", MA: "m", YA: "y", RA: "r", RRA: "ṟ", LA: "l", LLA: "ḷ", LLLA: "ḻ", VA: "v",
  SHA: "ś", SSA: "ṣ", SA: "s", HA: "h", QA: "q", KHHA: "x", GHHA: "ġ", ZA: "z", DDDHA: "ṛ", RHA: "ṛh", FA: "f", YYA: "ẏ",
}
const DEVANAGARI_SIGNS: Record<string, [string | undefined, string]> = {
  CANDRABINDU: ["m̐", "Nasalises the vowel before it."],
  ANUSVARA: ["ṃ", "A nasal after the vowel, assimilating to the consonant that follows."],
  VISARGA: ["ḥ", "A breath after the vowel."],
  VIRAMA: [undefined, "Silences the consonant's inherent a; between consonants it makes a conjunct."],
  NUKTA: [undefined, "A dot below that makes new consonants for sounds Sanskrit lacks (क़ qa, ज़ za)."],
  AVAGRAHA: ["'", "Marks an a elided at a word boundary (सोऽहम् so'ham)."],
}

/** Classical Armenian in the Hübschmann–Meillet transliteration. */
const ARMENIAN: Record<string, string> = {
  AYB: "a", BEN: "b", GIM: "g", DA: "d", ECH: "e", ZA: "z", EH: "ē", ET: "ə", TO: "tʻ", ZHE: "ž", INI: "i",
  LIWN: "l", XEH: "x", CA: "c", KEN: "k", HO: "h", JA: "j", GHAD: "ł", CHEH: "č", MEN: "m", YI: "y", NOW: "n",
  SHA: "š", VO: "o", CHA: "čʻ", PEH: "p", JHEH: "ǰ", RA: "ṙ", SEH: "s", VEW: "v", TIWN: "t", REH: "r", CO: "cʻ",
  YIWN: "w", PIWR: "pʻ", KEH: "kʻ", OH: "ō", FEH: "f",
}

/** Old Church Slavonic letters in the scholarly transliteration (Cyrillic and Cyrillic Extended-B). */
const EARLY_CYRILLIC: Record<string, string> = {
  A: "a", BE: "b", VE: "v", GHE: "g", DE: "d", IE: "e", ZHE: "ž", ZE: "z", I: "i", "SHORT I": "j", KA: "k",
  EL: "l", EM: "m", EN: "n", O: "o", PE: "p", ER: "r", ES: "s", TE: "t", U: "u", EF: "f", HA: "x", TSE: "c",
  CHE: "č", SHA: "š", SHCHA: "št", "HARD SIGN": "ŭ", YERU: "y", "SOFT SIGN": "ĭ", YU: "ju", YA: "ja",
  "BYELORUSSIAN-UKRAINIAN I": "i", YI: "ï", JE: "j", DZE: "dz", DJE: "đ",
  OMEGA: "ō", YAT: "ě", "IOTIFIED E": "je", "LITTLE YUS": "ę", "IOTIFIED LITTLE YUS": "ję", "BIG YUS": "ǫ",
  "IOTIFIED BIG YUS": "jǫ", KSI: "ks", PSI: "ps", FITA: "θ", IZHITSA: "ü", "IZHITSA WITH DOUBLE GRAVE ACCENT": "ü",
  UK: "u", "ROUND OMEGA": "ō", "OMEGA WITH TITLO": "ot", OT: "ot", KOPPA: "q",
  ZEMLYA: "z", DZELO: "dz", "REVERSED DZE": "dz", IOTA: "i", DJERV: "đ", "MONOGRAPH UK": "u", "BROAD OMEGA": "ō",
  "NEUTRAL YER": "ŭ", "YERU WITH BACK YER": "y", "IOTIFIED YAT": "jě", "REVERSED YU": "ju", "IOTIFIED A": "ja",
  "CLOSED LITTLE YUS": "ę", "BLENDED YUS": "ǫ", "IOTIFIED CLOSED LITTLE YUS": "ję", YN: "y", "REVERSED TSE": "c",
  "SOFT DE": "ď", "SOFT EL": "ľ", "SOFT EM": "m'", "MONOCULAR O": "o", "BINOCULAR O": "o", "DOUBLE MONOCULAR O": "o",
}

/** Ge'ez syllables: consonant from the Unicode name, vowel from its order (bä bu bi ba be bə bo). */
const ETHIOPIC_CONSONANTS: Record<string, string> = {
  H: "h", L: "l", HH: "ḥ", M: "m", SZ: "ś", R: "r", S: "s", SH: "š", Q: "q", QH: "q̱", B: "b", V: "v", T: "t",
  C: "č", X: "ḫ", N: "n", NY: "ñ", GLOTTAL: "ʾ", K: "k", KX: "ḵ", W: "w", PHARYNGEAL: "ʿ", Z: "z", ZH: "ž",
  Y: "y", D: "d", DD: "ḍ", J: "ǧ", G: "g", GG: "ŋ", TH: "ṭ", CH: "č̣", PH: "p̣", TS: "ṣ", TZ: "ṣ́", F: "f", P: "p",
}
const ETHIOPIC_VOWELS: Record<string, string> = { A: "ä", U: "u", I: "i", AA: "a", EE: "e", E: "ə", O: "o", OA: "oa" }

function ethiopicSyllable(name: string): string | undefined {
  const m = name.replace(/ /g, "").match(/^(GLOTTAL|PHARYNGEAL|[A-Z]+?)(W?)(AA|EE|OA|A|U|I|E|O)$/)
  if (!m) return undefined
  const consonant = ETHIOPIC_CONSONANTS[m[1]!]
  return consonant ? `${consonant}${m[2] ? "ʷ" : ""}${ETHIOPIC_VOWELS[m[3]!]}` : undefined
}

/** Linear B syllabic values by B-number, filled from the Linear B names and reused for Linear A's AB signs. */
const LINEAR_B_VALUES = new Map<string, string>()

const SPECS: AlphabetSpec[] = [
  { script: "ugaritic", ranges: [[0x10380, 0x1039f]], prefix: "UGARITIC ", classify: lettered(UGARITIC), language: "uga" },
  { script: "phoenician", ranges: [[0x10900, 0x1091f]], prefix: "PHOENICIAN ", classify: lettered(zip(PHOENICIAN), undefined, numericOf(PHOENICIAN)), language: "phn" },
  { script: "hebrew", ranges: [[0x05d0, 0x05ea]], prefix: "HEBREW ", classify: lettered(zip(HEBREW), undefined, numericOf(HEBREW)), language: "hbo" },
  { script: "imperial-aramaic", ranges: [[0x10840, 0x1085f]], prefix: "IMPERIAL ARAMAIC ", classify: lettered(zip(ARAMAIC), undefined, numericOf(ARAMAIC)), language: "arc" },
  { script: "syriac", ranges: [[0x0710, 0x072f], [0x074d, 0x074f]], prefix: "SYRIAC ", classify: lettered(zip(SYRIAC), undefined, numericOf(SYRIAC)), language: "syc" },
  { script: "old-south-arabian", ranges: [[0x10a60, 0x10a7f]], prefix: "OLD SOUTH ARABIAN ", classify: lettered(OLD_SOUTH_ARABIAN), language: "xsa" },
  {
    script: "old-persian",
    ranges: [[0x103a0, 0x103df]],
    prefix: "OLD PERSIAN ",
    language: "peo",
    classify: (rest) => {
      const m = rest.match(/^SIGN (.+)$/)
      if (m) {
        const logo = OLD_PERSIAN_LOGOGRAMS[m[1]!]
        if (logo) return { category: "logogram", name: logo[0], description: logo[1] }
        const value = m[1]!.toLowerCase().replace(/th/g, "θ").replace(/ss/g, "ç").replace(/sh/g, "š")
        return { category: "syllable", name: m[1], reading: value }
      }
      if (rest.startsWith("NUMBER ")) return { category: "numeral", name: rest }
      if (rest.includes("DIVIDER")) return { category: "punctuation", name: rest }
      return null
    },
  },
  {
    script: "linear-b",
    ranges: [[0x10000, 0x100fa]],
    prefix: "LINEAR B ",
    language: "gmy",
    classify: (rest) => {
      const tokens = rest.split(" ")
      const type = tokens[0]!
      const at = tokens.findIndex((t) => /^B\d+[A-Z]*$/.test(t))
      const number = at >= 0 ? tokens[at]! : undefined
      const meaning = tokens.slice(at + 1).join(" ") || tokens.slice(1, at).join(" ")
      if (type === "SYLLABLE" && number) {
        const value = subscript(meaning.toLowerCase())
        LINEAR_B_VALUES.set(number, value)
        return { category: "syllable", name: number, reading: value }
      }
      if (type === "SYMBOL") return { category: "sign of unknown value", name: number ?? rest }
      if (type === "IDEOGRAM" || type === "MONOGRAM")
        return {
          category: type === "IDEOGRAM" ? "logogram" : "monogram",
          name: number ?? rest,
          description: meaning ? `${type === "IDEOGRAM" ? "Logogram" : "Monogram"}: ${meaning.toLowerCase().replace(/ b\d+.*$/, "")}` : undefined,
        }
      return null
    },
  },
  {
    script: "ethiopic",
    ranges: [[0x1200, 0x137c]],
    prefix: "ETHIOPIC ",
    language: "gez",
    classify: (rest) => {
      const m = rest.match(/^SYLLABLE (.+)$/)
      if (m) return { category: "syllable", name: m[1], reading: ethiopicSyllable(m[1]!) }
      if (/^DIGIT |^NUMBER /.test(rest)) return { category: "numeral", name: rest }
      if (rest.startsWith("COMBINING ")) return { category: "mark", name: rest.slice("COMBINING ".length) }
      return { category: "punctuation", name: rest }
    },
  },
  {
    script: "devanagari",
    ranges: [[0x0900, 0x097f]],
    prefix: "DEVANAGARI ",
    language: "san",
    classify: (rest) => {
      const letter = rest.match(/^LETTER (.+)$/)?.[1]
      if (letter) {
        if (DEVANAGARI_VOWELS[letter]) return { category: "vowel", name: letter, reading: DEVANAGARI_VOWELS[letter] }
        const c = DEVANAGARI_CONSONANTS[letter]
        return c ? { category: "consonant", name: letter, reading: `${c}a` } : { category: "additional letter", name: letter }
      }
      const vowelSign = rest.match(/^VOWEL SIGN (.+)$/)?.[1]
      if (vowelSign) return { category: "vowel sign", name: rest, reading: DEVANAGARI_VOWELS[vowelSign] }
      const sign = rest.match(/^SIGN (.+)$/)?.[1]
      if (sign) {
        const [reading, description] = DEVANAGARI_SIGNS[sign] ?? [undefined, undefined]
        return { category: "sign", name: sign, reading, description }
      }
      const digit = rest.match(/^DIGIT (.+)$/)?.[1]
      if (digit) return { category: "numeral", name: rest, reading: String(DIGITS.indexOf(digit)) }
      if (rest === "OM") return { category: "ligature", name: rest, reading: "oṃ" }
      if (/DANDA|ABBREVIATION|SPACING DOT/.test(rest)) return { category: "punctuation", name: rest }
      if (/STRESS SIGN|ACCENT/.test(rest)) return { category: "accent", name: rest }
      return null
    },
  },
  {
    script: "linear-a",
    ranges: [[0x10600, 0x1077f]],
    prefix: "LINEAR A SIGN ",
    language: "lab",
    classify: (rest) => {
      const name = rest.split(" ")[0]!
      const ab = name.match(/^AB(\d+[A-Z]*)$/)
      const value = ab ? LINEAR_B_VALUES.get(`B${ab[1]}`) : undefined
      return {
        category: ab ? "AB sign (shared with Linear B)" : name.startsWith("A7") ? "ligature" : "sign",
        name: rest,
        reading: value,
        notes: value ? `Read with the value of Linear B B${ab![1]}.` : undefined,
      }
    },
  },
  {
    script: "cypriot",
    ranges: [[0x10800, 0x1083f]],
    prefix: "CYPRIOT ",
    language: "grc",
    classify: (rest) => {
      const m = rest.match(/^SYLLABLE (.+)$/)
      return m ? { category: "syllable", name: m[1], reading: m[1]!.toLowerCase() } : null
    },
  },
  {
    script: "anatolian-hieroglyphs",
    ranges: [[0x14400, 0x1467f]],
    prefix: "ANATOLIAN HIEROGLYPH ",
    language: "hlu",
    classify: (rest) => ({ category: "sign", name: rest }),
  },
  {
    script: "greek",
    ranges: [[0x03b1, 0x03c9], [0x03dd, 0x03dd], [0x0373, 0x0373], [0x03fb, 0x03fb], [0x03d9, 0x03d9], [0x0371, 0x0371]],
    prefix: "GREEK ",
    language: "grc",
    classify: lettered(GREEK, undefined, GREEK_NUMERIC),
  },
  {
    script: "old-italic",
    ranges: [[0x10300, 0x1032f]],
    prefix: "OLD ITALIC ",
    language: "ett",
    classify: lettered(OLD_ITALIC),
  },
  {
    script: "coptic",
    // small letters of the Coptic block (odd code points) and the Coptic letters in the Greek block
    ranges: [[0x2c81, 0x2cb1], [0x03e3, 0x03ef]],
    prefix: "COPTIC ",
    language: "cop",
    // capitals sit on the even code points of both ranges; the small letter carries the sign
    classify: (rest, cp) => (cp % 2 === 0 ? null : lettered(COPTIC)(rest)),
  },
  {
    script: "armenian",
    ranges: [[0x0561, 0x0587], [0x055b, 0x055f]],
    prefix: "ARMENIAN ",
    language: "xcl",
    classify: lettered(ARMENIAN, (rest) => (rest === "SMALL LIGATURE ECH YIWN" ? { category: "ligature", name: "ECH YIWN", reading: "ew" } : null)),
  },
  {
    script: "early-cyrillic",
    // the small letters; capitals share their sign
    ranges: [[0x0430, 0x045f], [0x0460, 0x0481], [0xa640, 0xa66d]],
    prefix: "CYRILLIC ",
    language: "chu",
    classify: (rest) => (rest.startsWith("CAPITAL ") ? null : lettered(EARLY_CYRILLIC)(rest)),
  },
  { script: "gothic", ranges: [[0x10330, 0x1034a]], prefix: "GOTHIC ", classify: lettered(GOTHIC), language: "got" },
  {
    script: "runic",
    ranges: [[0x16a0, 0x16f8]],
    prefix: "RUNIC ",
    language: "non",
    classify: (rest) => {
      const m = rest.match(/^LETTER (.+)$/)
      if (!m) return /PUNCTUATION/.test(rest) ? { category: "punctuation", name: rest } : { category: "symbol", name: rest }
      const tokens = m[1]!.split(" ")
      const last = tokens[tokens.length - 1]!
      const reading = /^[A-Z]{1,2}$/.test(last) && tokens.length > 1 ? last.toLowerCase() : tokens.length === 1 && last.length <= 2 ? last.toLowerCase() : undefined
      return { category: "rune", name: m[1], reading }
    },
  },
  { script: "ogham", ranges: [[0x1680, 0x169c]], prefix: "OGHAM ", classify: lettered(OGHAM), language: "sga" },
]

export const alphabetsImporter: Importer = {
  id: "alphabets",
  language: "*",
  description: "Unicode → letters and syllables of 21 ancient scripts (Phoenician, Ugaritic, Linear B …) with transliterations",
  async run({ db, log, limit, offline, prune }) {
    const names = await unicodeNames({ offline, log })
    for (const spec of SPECS) {
      const signs: SignInput[] = []
      let order = 0
      for (const [from, to] of spec.ranges) {
        for (let cp = from; cp <= to; cp++) {
          const uname = names.get(cp)
          if (!uname?.startsWith(spec.prefix)) continue
          const kind = spec.classify(uname.slice(spec.prefix.length), cp)
          if (!kind) continue
          const glyph = String.fromCodePoint(cp)
          const upper = glyph.toUpperCase()
          signs.push({
            name: kind.name ?? uname.slice(spec.prefix.length),
            unicode: glyph,
            codepoints: upper !== glyph ? [hex(upper.codePointAt(0)!), hex(cp)] : [hex(cp)],
            unicodeName: uname,
            category: kind.category,
            description: kind.description,
            notes: kind.notes,
            sortOrder: ++order,
            sourceRef: hex(cp),
            readings: kind.reading ? [{ value: kind.reading, language: spec.language }] : [],
          })
        }
      }
      await writeSignInventory(db, {
        scriptId: spec.script,
        source: ucdSource,
        signs: limit ? signs.slice(0, limit) : signs,
        log,
        prune: prune && !limit,
      })
    }
  },
}

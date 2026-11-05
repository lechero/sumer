/**
 * Letter-by-letter breakdowns for the scripts with a sign inventory (alphabets, abjads,
 * abugidas, syllabaries): each written character with its name in the inventory, its sound,
 * and the marks written on it (accents, breathings, vowel points, viramas).
 *   λόγος  → λ LAMDA l · ό OMICRON o + acute · γ GAMMA g · ο OMICRON o · ς FINAL SIGMA s   = lógos
 *   מֶלֶךְ  → מֶ MEM m + segol e · לֶ LAMED l + segol e · ךְ FINAL KAF k + sheva            = melek
 *   संस्कृतम् → सं sa + ṃ · स्कृ s + virama + k + ṛ · त ta · म् m + virama                  = saṃskṛtam
 * Cuneiform and hieroglyphs have their own breakdowns (breakdown.ts, hieroglyphs.ts).
 */
import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "./client"
import { scripts, signReadings, signs } from "./schema"

export type LetterPiece = {
  glyph: string
  /** The sign's name in its inventory (ALPHA, VOWEL SIGN AA) or the mark's name (acute accent). */
  name: string
  /** The sound it writes here; null for marks that change no sound. */
  value: string | null
  kind: "letter" | "mark"
  /** Inventory category: letter, final form, consonant, vowel sign, syllable … */
  category: string | null
  description: string | null
  /** Set when the piece is a sign of the inventory, for linking to its page. */
  signName: string | null
}

/** One written unit: a letter with its marks, or (in an abugida) an akshara. */
export type LetterCluster = { glyph: string; value: string; pieces: LetterPiece[] }

export type LetterBreakdown = {
  script: { id: string; name: string; kind: string | null }
  /** Clusters, word by word. */
  words: LetterCluster[][]
  /** The clusters' sounds read together. */
  reading: string
  letters: number
  marks: number
  /** The text was longer than MAX_CLUSTERS. */
  truncated: boolean
}

const MAX_CLUSTERS = 60

type MarkInfo = {
  name: string
  value?: string
  /**
   * vowel: written after the letter's sound (niqqud) · prefix / suffix: around it (rough breathing h-, iota subscript -i)
   * accent: a diacritic put on the sound's vowel · override: replaces the letter's sound (shin / sin dot).
   */
  effect?: "vowel" | "prefix" | "suffix" | "accent" | "override"
  accent?: string
  description?: string
}

const HEBREW_MARKS: Record<string, MarkInfo> = {
  "ְ": { name: "sheva", value: "ə", effect: "vowel", description: "No vowel, or a murmured ə." },
  "ֱ": { name: "hataf segol", value: "ĕ", effect: "vowel" },
  "ֲ": { name: "hataf patah", value: "ă", effect: "vowel" },
  "ֳ": { name: "hataf qamats", value: "ŏ", effect: "vowel" },
  "ִ": { name: "hiriq", value: "i", effect: "vowel" },
  "ֵ": { name: "tsere", value: "ē", effect: "vowel" },
  "ֶ": { name: "segol", value: "e", effect: "vowel" },
  "ַ": { name: "patah", value: "a", effect: "vowel" },
  "ָ": { name: "qamats", value: "ā", effect: "vowel" },
  "ֹ": { name: "holam", value: "ō", effect: "vowel" },
  "ֺ": { name: "holam haser", value: "ō", effect: "vowel" },
  "ֻ": { name: "qubuts", value: "u", effect: "vowel" },
  "ּ": { name: "dagesh", description: "Doubles the consonant, or marks b g d k p t as stops." },
  "ֽ": { name: "meteg", description: "Secondary stress." },
  "ֿ": { name: "rafe", description: "Marks the consonant as soft." },
  "ׁ": { name: "shin dot", value: "š", effect: "override" },
  "ׂ": { name: "sin dot", value: "ś", effect: "override" },
  "ׄ": { name: "upper dot" },
  "ׅ": { name: "lower dot" },
  "ׇ": { name: "qamats qatan", value: "o", effect: "vowel" },
}
for (let cp = 0x0591; cp <= 0x05af; cp++) HEBREW_MARKS[String.fromCodePoint(cp)] = { name: "cantillation mark", description: "Masoretic accent for chanting." }

const GREEK_MARKS: Record<string, MarkInfo> = {
  "́": { name: "acute accent", effect: "accent", accent: "́" },
  "̀": { name: "grave accent", effect: "accent", accent: "̀" },
  "͂": { name: "circumflex", effect: "accent", accent: "̂" },
  "̓": { name: "smooth breathing", description: "No h before the vowel." },
  "̔": { name: "rough breathing", value: "h", effect: "prefix", description: "An h before the vowel (rh on rho)." },
  "ͅ": { name: "iota subscript", value: "i", effect: "suffix", description: "A silent iota of a long diphthong." },
  "̈": { name: "diaeresis", effect: "accent", accent: "̈", description: "The vowel is said apart, not in a diphthong." },
  "̄": { name: "macron", effect: "accent", accent: "̄" },
  "̆": { name: "breve", effect: "accent", accent: "̆" },
}

const SUPRALINEAR: MarkInfo = { name: "supralinear stroke", description: "Marks a syllable without a written vowel (ⲙ̄ = əm)." }
const COPTIC_MARKS: Record<string, MarkInfo> = {
  "̄": SUPRALINEAR,
  "̅": SUPRALINEAR,
  "︤": SUPRALINEAR,
  "︥": SUPRALINEAR,
  "︦": SUPRALINEAR,
  "̀": { name: "jinkim", description: "Marks a vowel or consonant as its own syllable (Bohairic)." },
  "̇": { name: "dot above" },
}

const SYRIAC_MARKS: Record<string, MarkInfo> = {
  "ܰ": { name: "pthaha above", value: "a", effect: "vowel" },
  "ܱ": { name: "pthaha below", value: "a", effect: "vowel" },
  "ܲ": { name: "pthaha dotted", value: "a", effect: "vowel" },
  "ܳ": { name: "zqapha above", value: "ā", effect: "vowel" },
  "ܴ": { name: "zqapha below", value: "ā", effect: "vowel" },
  "ܵ": { name: "zqapha dotted", value: "ā", effect: "vowel" },
  "ܶ": { name: "rbasa above", value: "e", effect: "vowel" },
  "ܷ": { name: "rbasa below", value: "e", effect: "vowel" },
  "ܸ": { name: "zlama horizontal", value: "ē", effect: "vowel" },
  "ܹ": { name: "zlama angular", value: "ē", effect: "vowel" },
  "ܺ": { name: "hbasa above", value: "i", effect: "vowel" },
  "ܻ": { name: "hbasa below", value: "i", effect: "vowel" },
  "ܼ": { name: "hbasa-esasa dotted", value: "i", effect: "vowel" },
  "ܽ": { name: "esasa above", value: "u", effect: "vowel" },
  "ܾ": { name: "esasa below", value: "u", effect: "vowel" },
  "ܿ": { name: "rwaha", value: "o", effect: "vowel" },
  "݀": { name: "feminine dot" },
  "݁": { name: "qushshaya", description: "Hard (stop) pronunciation." },
  "݂": { name: "rukkakha", description: "Soft (spirant) pronunciation." },
  "̈": { name: "syame", description: "Marks the plural." },
}

const CYRILLIC_MARKS: Record<string, MarkInfo> = {
  "҃": { name: "titlo", description: "Marks an abbreviation (бг҃ъ = богъ) or a numeral." },
  "҄": { name: "palatalization" },
  "҅": { name: "dasia pneumata" },
  "҆": { name: "psili pneumata" },
  "҇": { name: "pokrytie" },
  "́": { name: "stress mark" },
  "̀": { name: "grave accent" },
  "̑": { name: "kamora" },
}

const DEVANAGARI_MARKS: Record<string, MarkInfo> = {
  "᳚": { name: "double svarita" },
}

const MARKS: Record<string, Record<string, MarkInfo>> = {
  hebrew: HEBREW_MARKS,
  greek: GREEK_MARKS,
  coptic: COPTIC_MARKS,
  syriac: SYRIAC_MARKS,
  "early-cyrillic": CYRILLIC_MARKS,
  devanagari: DEVANAGARI_MARKS,
}

/** Syllabaries read as hyphenated syllables (e-te-wo-ke-re-we), like their transliterations. */
const HYPHENATED = new Set(["linear-b", "linear-a", "cypriot", "old-persian"])
/** Greek precomposes accented letters (ό = ο + ́); the others keep theirs (Cyrillic й is a letter). */
const DECOMPOSE = new Set(["greek", "coptic"])

const isMark = (ch: string) => /\p{M}/u.test(ch)
const isSeparator = (ch: string) => /[\p{Z}\p{P}\p{S}\s]/u.test(ch) && !isMark(ch)
const hex = (ch: string) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`

type InventorySign = { name: string; category: string | null; description: string | null; reading: string | null }

/** The script with a sign inventory for an ISO 15924 code (Grek → greek). */
async function inventoryScript(db: Database, iso: string) {
  const [row] = await db
    .select({ id: scripts.id, name: scripts.name, kind: scripts.kind })
    .from(scripts)
    .where(eq(scripts.iso15924, iso))
  return row
}

async function loadSigns(db: Database, scriptId: string, chars: string[]) {
  const out = new Map<string, InventorySign>()
  if (!chars.length) return out
  const rows = await db
    .select({
      unicode: signs.unicode,
      name: signs.name,
      category: signs.category,
      description: signs.description,
      reading: signReadings.value,
      order: signReadings.sortOrder,
    })
    .from(signs)
    .leftJoin(signReadings, eq(signReadings.signId, signs.id))
    .where(and(eq(signs.scriptId, scriptId), inArray(signs.unicode, chars)))
  for (const r of rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (!r.unicode || out.has(r.unicode)) continue
    out.set(r.unicode, { name: r.name, category: r.category, description: r.description, reading: r.reading })
  }
  return out
}

const LONG_VOWEL = /[āēīōūôûê]/
const VOWEL = /[aeiouyāēīōūăĕŏəôûê]/

/** Put an accent on the first vowel of a sound: lo + ́ → ló; circumflex on ō → ô. */
function accentuate(value: string, accent: string): string {
  const i = value.search(VOWEL)
  if (i < 0) return value
  let v = value[i]!
  if (accent === "̂" && (v === "ē" || v === "ō")) return value.slice(0, i) + (v === "ē" ? "ê" : "ô") + value.slice(i + 1)
  v = (v + accent).normalize("NFC")
  return value.slice(0, i) + v + value.slice(i + 1)
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** The sound of one cluster from its pieces. */
function clusterValue(pieces: LetterPiece[], marks: MarkInfo[]): string {
  let prefix = ""
  let letter = ""
  let after = ""
  let pendingA = false // an abugida consonant still carrying its inherent a
  for (const p of pieces) {
    if (p.kind !== "letter") continue
    if (p.category === "consonant") {
      if (pendingA) letter += "a"
      letter += (p.value ?? "").replace(/a$/, "")
      pendingA = true
    } else if (p.category === "vowel sign") {
      letter += p.value ?? ""
      pendingA = false
    } else if (p.name === "VIRAMA") {
      pendingA = false
    } else {
      if (pendingA && p.value) {
        letter += "a"
        pendingA = false
      }
      letter += p.value ?? ""
    }
  }
  if (pendingA) letter += "a"
  const accents: string[] = []
  for (const m of marks) {
    if (m.effect === "override" && m.value) letter = m.value
    else if (m.effect === "vowel" && m.value) after += m.value
    else if (m.effect === "prefix" && m.value) prefix += m.value
    else if (m.effect === "suffix" && m.value) after += m.value
    else if (m.effect === "accent" && m.accent) accents.push(m.accent)
  }
  let value = letter + after
  for (const a of accents) value = accentuate(value, a)
  // rough breathing on rho: rh, not hr
  return prefix && /^r/.test(value) ? `r${prefix}${value.slice(1)}` : prefix + value
}

type Built = LetterCluster & { marks: MarkInfo[]; base?: string; upper: boolean }

/** Script-specific reading rules applied across a word. */
function readWord(scriptId: string, word: Built[]) {
  if (scriptId === "greek") {
    const vowelBase = new Set(["ALPHA", "EPSILON", "ETA", "OMICRON", "OMEGA"])
    for (const [i, c] of word.entries()) {
      const prev = word[i - 1]
      const next = word[i + 1]
      // diphthongs αυ ευ ηυ ου ωυ: u, not y
      if (c.base === "UPSILON" && prev?.base && vowelBase.has(prev.base) && !c.marks.some((m) => m.name === "diaeresis"))
        c.value = c.value.replace("y", "u")
      // γ before γ κ ξ χ is a nasal: ἄγγελος angelos
      if (c.base === "GAMMA" && next?.base && ["GAMMA", "KAPPA", "XI", "CHI"].includes(next.base)) c.value = c.value.replace("g", "n")
    }
    // the breathing of an initial diphthong sits on its second vowel: οἱ hoi, αὐτός autós
    if (word[1]?.value.startsWith("h") && word[0] && /^[aeēioōuy]/.test(word[0].value) && word[1].marks.some((m) => m.name === "rough breathing")) {
      word[1].value = word[1].value.slice(1)
      word[0].value = `h${word[0].value}`
    }
  }
  if (scriptId === "hebrew") {
    for (const [i, c] of word.entries()) {
      const vowels = c.marks.filter((m) => m.effect === "vowel")
      // וֹ holam male = ô, וּ shureq = û (the vav is a vowel letter, not w)
      if (c.base === "VAV" && vowels.length === 1 && vowels[0]!.name === "holam") c.value = "ô"
      else if (c.base === "VAV" && !vowels.length && c.marks.some((m) => m.name === "dagesh")) c.value = "û"
      // a bare yod after e / i, or a bare final he after a vowel, only marks the vowel long: בְּנֵי bənê, תּוֹרָה tôrâ
      const prev = word[i - 1]
      const bare = !vowels.length && !c.marks.some((m) => m.name === "dagesh")
      const MATER: Record<string, string> = { ē: "ê", e: "ê", i: "î", ā: "â", a: "â", o: "ô", ō: "ô" }
      const last = prev?.value.at(-1) ?? ""
      if (bare && prev && c.base === "YOD" && /[eēi]/.test(last)) {
        prev.value = prev.value.slice(0, -1) + MATER[last]
        c.value = ""
      } else if (bare && prev && c.base === "HE" && i === word.length - 1 && MATER[last]) {
        prev.value = prev.value.slice(0, -1) + MATER[last]
        c.value = ""
      }
      // sheva: silent at the end of a word and after a short vowel, murmured elsewhere
      if (vowels.some((m) => m.name === "sheva")) {
        const vocal = i === 0 || (prev && (LONG_VOWEL.test(prev.value) || prev.marks.some((m) => m.name === "sheva")))
        if (i === word.length - 1 || !vocal) c.value = c.value.replace("ə", "")
      }
    }
  }
  if (scriptId === "ethiopic") {
    // a sixth-order syllable at the end of a word is usually just the consonant
    const last = word[word.length - 1]
    if (last && word.length > 1) last.value = last.value.replace(/ə$/, "")
  }
  for (const c of word) if (c.upper) c.value = capitalize(c.value)
}

/**
 * Break a text in an inventoried script down letter by letter. Undefined when the language's
 * script has no inventory (Latin) or nothing in the text belongs to it.
 */
export async function getLetterBreakdown(db: Database, text: string, iso: string): Promise<LetterBreakdown | undefined> {
  const script = await inventoryScript(db, iso)
  if (!script || script.id === "cuneiform" || script.id === "egyptian-hieroglyphs") return undefined
  const marksTable = MARKS[script.id] ?? {}
  const source = DECOMPOSE.has(script.id) ? text.normalize("NFD") : text.normalize("NFC")
  const clusters = [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(source)].map((s) => s.segment)
  const truncated = clusters.length > MAX_CLUSTERS
  const shown = clusters.slice(0, MAX_CLUSTERS)

  const chars = new Set<string>()
  for (const c of shown) for (const ch of c) if (!isSeparator(ch)) chars.add(ch).add(ch.toLowerCase())
  const inventory = await loadSigns(db, script.id, [...chars])

  const words: Built[][] = [[]]
  let letters = 0
  let markCount = 0
  for (const cluster of shown) {
    const chs = [...cluster]
    if (chs.every(isSeparator)) {
      if (words[words.length - 1]!.length) words.push([])
      continue
    }
    const pieces: LetterPiece[] = []
    const marks: MarkInfo[] = []
    let base: string | undefined
    let upper = false
    for (const ch of chs) {
      const lower = ch.toLowerCase()
      const sign = inventory.get(ch) ?? inventory.get(lower)
      if (sign && !(isMark(ch) && marksTable[ch])) {
        if (!base && sign.category !== "vowel sign" && !isMark(ch)) {
          base = sign.name
          upper = ch !== lower && inventory.get(ch) === undefined
        }
        const mark = isMark(ch)
        pieces.push({
          glyph: ch,
          name: sign.name,
          value: sign.reading,
          kind: "letter",
          category: sign.category,
          description: sign.description,
          signName: sign.name,
        })
        if (mark) markCount++
        else letters++
        continue
      }
      if (isMark(ch)) {
        const info = marksTable[ch] ?? { name: `mark ${hex(ch)}` }
        marks.push(info)
        pieces.push({ glyph: ch, name: info.name, value: info.value ?? null, kind: "mark", category: null, description: info.description ?? null, signName: null })
        markCount++
        continue
      }
      // a character the inventory lacks (a Latin letter in a Greek headword, an unencoded variant)
      pieces.push({ glyph: ch, name: hex(ch), value: ch, kind: "letter", category: null, description: null, signName: null })
      letters++
    }
    words[words.length - 1]!.push({ glyph: cluster, value: clusterValue(pieces, marks), pieces, marks, base, upper })
  }

  const filled = words.filter((w) => w.length)
  if (!filled.length || !filled.flat().some((c) => c.pieces.some((p) => p.signName))) return undefined
  for (const w of filled) readWord(script.id, w)
  const sep = HYPHENATED.has(script.id) ? "-" : ""
  const out = filled.map((w) => w.map(({ glyph, value, pieces }) => ({ glyph, value, pieces })))
  return {
    script,
    words: out,
    reading: out.map((w) => w.map((c) => c.value).filter(Boolean).join(sep)).join(" "),
    letters,
    marks: markCount,
    truncated,
  }
}

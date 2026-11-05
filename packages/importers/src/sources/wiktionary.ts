/**
 * Wiktionary lemmas for many ancient and reconstructed languages, from
 * Kaikki.org's per-language wiktextract JSONL dumps (English Wiktionary,
 * CC BY-SA 4.0 + GFDL). One importer per language (`wikt-<id>`), a group
 * importer (`wiktionary`) and a relations-only pass (`wiktionary-links`) that
 * re-reads the cached dumps once other languages have been imported.
 *   https://kaikki.org/dictionary/<Language>/kaikki.org-dictionary-<Language>.jsonl
 *
 * Conventions:
 *   - headword = the Wiktionary page title (NFC). Reconstructions are stored
 *     WITHOUT the asterisk (as Kaikki names them: PIE "oḱtṓw"), so they match and
 *     search like any other word; `native` carries the starred form ("*oḱtṓw")
 *     so it stays visible, and the notes say "Reconstructed form".
 *   - native = native-script form: Egyptian hieroglyphs converted from the head
 *     template's Manuel de Codage, the vocalised / canonical spelling (Syriac
 *     ܟܰܠܒܳܐ, Old English twiġ) or the headword itself when it is native script.
 *   - translit = first romanisation (forms tagged "romanization", else the head
 *     template's tr) for non-Latin-script headwords.
 *   - Form-of / alt-of / romanisation / inflection entries, script letters and
 *     alternative-script duplicates (Pali in Thai script …) are skipped.
 *   - ref = `<lang>:<page title>:<pos>:<n>` (n = nth record with that title + POS).
 * Etymology templates become relations (bor/lbor/slbor → loan_from,
 * inh/der/uder → derived_from, cog → cognate_of, plus the {{etymon}} chains);
 * {{ncog}} / {{noncog}} mark NON-cognates and are ignored. The lemma's
 * synonyms, antonyms, derived and related terms become synonym_of / antonym_of /
 * derived_from / see_also relations inside the language.
 *
 * Two modes per language:
 *   - entries: Wiktionary is the dictionary (Hittite, Gothic, PIE …) and creates the entries;
 *   - enrich: a scholarly dictionary already holds the language (Latin from Lewis & Short,
 *     Greek from LSJ …). Each Wiktionary lemma is matched to that dictionary's entry and
 *     only adds relations, plus an etymology or hieroglyphic spelling the entry lacks.
 *     A language switches to enrich as soon as another source has entries for it, and
 *     the Wiktionary entries it held before are removed.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import {
  buildSearchKey,
  chunk,
  entries as entriesTable,
  normalizeForSearch,
  upsertDataset,
  type Confidence,
  type Database,
  type NewLanguage,
  type PartKind,
  type PartOfSpeech,
  type RelationType,
  type SeedDataset,
  type SeedEntry,
  type SeedSense,
} from "@workspace/db"

import { download } from "../lib/cache"
import { extractHiero, loadHieroglyphTables, mdcToUnicode, type HieroglyphTables } from "../lib/egyptian"
import { iterateJsonLines } from "../lib/jsonl"
import { EntryResolver, pruneRelations, spellingKey, VOWEL_MARK_SCRIPT, writeRelations, type RelationRow } from "../lib/links"
import { truncate, uniq } from "../lib/text"
import type { Importer, ImporterContext } from "../registry"

export const wiktionarySource = {
  id: "wiktionary",
  title: "Wiktionary (via Kaikki.org, wiktextract)",
  url: "https://kaikki.org/",
  license: "CC BY-SA 4.0 and GFDL (Wiktionary content)",
  citation:
    'Ylonen, Tatu. 2022. "Wiktextract: Wiktionary as Machine-Readable Structured Data." Proceedings of the 13th Language Resources and Evaluation Conference (LREC 2022), 1317–1325. Data: English Wiktionary contributors, extracted by Kaikki.org.',
}

/** A Kaikki dump and how to read it. */
export type WiktionaryDump = {
  language: { id: string; name: string }
  /** Wiktionary language code (sa, cu, pi …) when it differs from our id. */
  wikt?: string
  /** Kaikki.org language name (directory and file name). */
  kaikki: string
  /** Unicode scripts a headword may be written in; other-script pages are duplicates. */
  scripts: string[]
  /** Every entry is a reconstruction (Proto-Indo-European). */
  reconstructed?: boolean
  /** Lemmas are Egyptological transliteration; hieroglyphs come from the head template's MdC. */
  hieroglyphs?: boolean
}

/** A language Wiktionary can supply entries for (it defines the language row). */
export type WiktionaryLanguage = WiktionaryDump & { language: NewLanguage }

const NEAR_EAST = "Afro-Asiatic › Semitic"

/** Add a language by appending a row (sortOrder 100+, grouped by region). */
export const WIKTIONARY_LANGUAGES: WiktionaryLanguage[] = [
  // ── Near East ────────────────────────────────────────────────────────────
  {
    kaikki: "Egyptian",
    scripts: ["Latin"],
    hieroglyphs: true,
    language: {
      id: "egy",
      name: "Egyptian",
      nativeName: "𓂋𓏤𓈖𓆎𓅓𓏏𓊖 (r n km.t)",
      script: "Egyp",
      scriptName: "Egyptian hieroglyphs (lemmas in Egyptological transliteration)",
      direction: "ltr",
      family: "Afro-Asiatic › Egyptian",
      period: "c. 3200 BCE – 4th c. CE in hieroglyphic writing (Old, Middle and Late Egyptian)",
      description:
        "The language of the pharaohs, written in hieroglyphs for more than three thousand years; its final stage, Coptic, survives as the liturgical language of the Coptic Church.",
      sortOrder: 100,
    },
  },
  {
    kaikki: "Ugaritic",
    scripts: ["Ugaritic"],
    language: {
      id: "uga",
      name: "Ugaritic",
      nativeName: "𐎜𐎂𐎗𐎚 (ugrt)",
      script: "Ugar",
      scriptName: "Ugaritic cuneiform alphabet",
      direction: "ltr",
      family: `${NEAR_EAST} › Northwest Semitic`,
      period: "c. 1400 – 1190 BCE",
      description:
        "The language of the Late Bronze Age port city of Ugarit in Syria, written in a thirty-letter cuneiform alphabet; its Baal myths illuminate the world of the Hebrew Bible.",
      sortOrder: 105,
    },
  },
  {
    kaikki: "Hittite",
    scripts: ["Cuneiform"],
    language: {
      id: "hit",
      name: "Hittite",
      nativeName: "𒉈𒅆𒇷 (nešili)",
      script: "Xsux",
      scriptName: "Hittite cuneiform",
      direction: "ltr",
      family: "Indo-European › Anatolian",
      period: "c. 1650 – 1180 BCE",
      description:
        "The language of the Hittite empire of central Anatolia and the earliest attested Indo-European language, written in a cuneiform adapted from Mesopotamia.",
      sortOrder: 110,
    },
  },
  {
    kaikki: "Classical Syriac",
    scripts: ["Syriac"],
    language: {
      id: "syc",
      name: "Classical Syriac",
      nativeName: "ܠܫܢܐ ܣܘܪܝܝܐ (lešānā suryāyā)",
      script: "Syrc",
      scriptName: "Syriac abjad",
      direction: "rtl",
      family: `${NEAR_EAST} › Northwest Semitic › Aramaic`,
      period: "1st – 13th c. CE (liturgical use continues)",
      description:
        "The Aramaic of Edessa that became the literary and liturgical language of Eastern Christianity and carried Greek learning into the Arabic world.",
      sortOrder: 115,
    },
  },
  {
    kaikki: "Sabaean",
    scripts: ["Old_South_Arabian"],
    language: {
      id: "xsa",
      name: "Sabaean",
      nativeName: "𐩪𐩨𐩱 (sbʾ)",
      script: "Sarb",
      scriptName: "Ancient South Arabian script (musnad)",
      direction: "rtl",
      family: `${NEAR_EAST} › Old South Arabian`,
      period: "c. 1000 BCE – 600 CE",
      description:
        "The main language of the kingdom of Saba (biblical Sheba) in Yemen, known from monumental and legal inscriptions in the musnad script.",
      sortOrder: 120,
    },
  },
  {
    kaikki: "Ge'ez",
    scripts: ["Ethiopic"],
    language: {
      id: "gez",
      name: "Ge'ez",
      nativeName: "ግዕዝ (Gəʿəz)",
      script: "Ethi",
      scriptName: "Ge'ez abugida (fidäl)",
      direction: "ltr",
      family: `${NEAR_EAST} › South Semitic › Ethiopian`,
      period: "c. 4th – 10th c. CE as a spoken language; liturgical since",
      description:
        "The classical language of the Aksumite kingdom and of the Ethiopian and Eritrean Orthodox churches, written in a syllabary developed from the South Arabian script.",
      sortOrder: 125,
    },
  },
  // ── Mediterranean ────────────────────────────────────────────────────────
  {
    kaikki: "Mycenaean Greek",
    scripts: ["Linear_B"],
    language: {
      id: "gmy",
      name: "Mycenaean Greek",
      nativeName: null,
      script: "Linb",
      scriptName: "Linear B syllabary",
      direction: "ltr",
      family: "Indo-European › Hellenic",
      period: "c. 1450 – 1200 BCE",
      description:
        "The oldest attested form of Greek, recorded on clay tablets from the palace archives of Knossos, Pylos and Mycenae in the Linear B syllabary.",
      sortOrder: 130,
    },
  },
  {
    kaikki: "Etruscan",
    scripts: ["Old_Italic"],
    language: {
      id: "ett",
      name: "Etruscan",
      nativeName: "𐌓𐌀𐌔𐌍𐌀 (rasna)",
      script: "Ital",
      scriptName: "Old Italic (Etruscan alphabet)",
      direction: "ltr",
      family: "Tyrsenian (non-Indo-European)",
      period: "c. 700 BCE – 50 CE",
      description:
        "The non-Indo-European language of ancient Etruria in central Italy, written in an alphabet adapted from Greek that the Romans in turn adopted.",
      sortOrder: 135,
    },
  },
  // ── Indo-Iranian and Central Asia ───────────────────────────────────────
  {
    kaikki: "Old Persian",
    scripts: ["Old_Persian", "Latin"],
    language: {
      id: "peo",
      name: "Old Persian",
      nativeName: "𐎠𐎼𐎹 (ariya)",
      script: "Xpeo",
      scriptName: "Old Persian cuneiform",
      direction: "ltr",
      family: "Indo-European › Indo-Iranian › Iranian › Western Iranian",
      period: "c. 525 – 330 BCE",
      description:
        "The language of the Achaemenid royal inscriptions, such as Darius's Behistun inscription, written in a semi-syllabic cuneiform created for it.",
      sortOrder: 140,
    },
  },
  {
    kaikki: "Sanskrit",
    wikt: "sa",
    scripts: ["Devanagari"],
    language: {
      id: "san",
      name: "Sanskrit",
      nativeName: "संस्कृतम् (saṃskṛtam)",
      script: "Deva",
      scriptName: "Devanagari",
      direction: "ltr",
      family: "Indo-European › Indo-Iranian › Indo-Aryan",
      period: "c. 1500 BCE – present (Vedic, then Classical Sanskrit)",
      description:
        "The classical language of Hindu, Buddhist and Jain learning, from the Vedic hymns to classical poetry; Pāṇini's grammar of it helped found comparative linguistics.",
      sortOrder: 145,
    },
  },
  {
    kaikki: "Pali",
    wikt: "pi",
    scripts: ["Latin"],
    language: {
      id: "pli",
      name: "Pali",
      nativeName: "pāḷi",
      script: "Latn",
      scriptName: "Latin (romanised Pali; also written in Brahmi, Sinhala, Burmese, Thai, Khmer)",
      direction: "ltr",
      family: "Indo-European › Indo-Iranian › Indo-Aryan › Middle Indo-Aryan",
      period: "c. 3rd c. BCE – present (liturgical)",
      description:
        "The Middle Indo-Aryan language of the Theravāda Buddhist canon, still used in worship and study across Sri Lanka and mainland Southeast Asia.",
      sortOrder: 150,
    },
  },
  {
    kaikki: "Tocharian B",
    scripts: ["Latin"],
    language: {
      id: "txb",
      name: "Tocharian B",
      nativeName: null,
      script: "Latn",
      scriptName: "Latin transliteration (originally Brahmi script)",
      direction: "ltr",
      family: "Indo-European › Tocharian",
      period: "c. 500 – 1000 CE",
      description:
        "An Indo-European language of the Kucha oasis in the Tarim Basin, known from Buddhist manuscripts in Brahmi; with Tocharian A, the easternmost branch of the family.",
      sortOrder: 155,
    },
  },
  // ── Europe ──────────────────────────────────────────────────────────────
  {
    kaikki: "Gothic",
    scripts: ["Gothic"],
    language: {
      id: "got",
      name: "Gothic",
      nativeName: "𐌲𐌿𐍄𐌹𐍃𐌺 (gutisk)",
      script: "Goth",
      scriptName: "Gothic alphabet",
      direction: "ltr",
      family: "Indo-European › Germanic › East Germanic",
      period: "4th – 6th c. CE",
      description:
        "The East Germanic language of Wulfila's fourth-century Bible translation, the earliest substantial text in any Germanic language.",
      sortOrder: 160,
    },
  },
  {
    kaikki: "Old Norse",
    scripts: ["Latin"],
    language: {
      id: "non",
      name: "Old Norse",
      nativeName: "dǫnsk tunga",
      script: "Latn",
      scriptName: "Latin alphabet (also Younger Futhark runes)",
      direction: "ltr",
      family: "Indo-European › Germanic › North Germanic",
      period: "c. 700 – 1350 CE",
      description:
        "The language of the Viking Age and of the Icelandic sagas and Eddas, ancestor of Icelandic, Faroese, Norwegian, Danish and Swedish.",
      sortOrder: 165,
    },
  },
  {
    kaikki: "Old English",
    scripts: ["Latin"],
    language: {
      id: "ang",
      name: "Old English",
      nativeName: "Englisc",
      script: "Latn",
      scriptName: "Latin alphabet (insular; also Anglo-Saxon runes)",
      direction: "ltr",
      family: "Indo-European › Germanic › West Germanic › Anglo-Frisian",
      period: "c. 450 – 1150 CE",
      description: "The language of Anglo-Saxon England and of Beowulf, the direct ancestor of Modern English.",
      sortOrder: 170,
    },
  },
  {
    kaikki: "Old Irish",
    scripts: ["Latin"],
    language: {
      id: "sga",
      name: "Old Irish",
      nativeName: "Goídelc",
      script: "Latn",
      scriptName: "Latin alphabet (insular; also Ogham)",
      direction: "ltr",
      family: "Indo-European › Celtic › Insular Celtic › Goidelic",
      period: "c. 600 – 900 CE",
      description:
        "The earliest Celtic language with a large literature — glosses, laws and sagas — and the ancestor of Irish, Scottish Gaelic and Manx.",
      sortOrder: 175,
    },
  },
  {
    kaikki: "Old Church Slavonic",
    wikt: "cu",
    scripts: ["Cyrillic"],
    language: {
      id: "chu",
      name: "Old Church Slavonic",
      nativeName: "словѣньскъ ѩꙁꙑкъ (slověnĭskŭ językŭ)",
      script: "Cyrs",
      scriptName: "Early Cyrillic (also Glagolitic)",
      direction: "ltr",
      family: "Indo-European › Balto-Slavic › Slavic › South Slavic",
      period: "9th – 11th c. CE",
      description:
        "The first Slavic literary language, created for the mission of Cyril and Methodius to Great Moravia and the basis of later Church Slavonic.",
      sortOrder: 180,
    },
  },
  {
    kaikki: "Old Armenian",
    scripts: ["Armenian"],
    language: {
      id: "xcl",
      name: "Classical Armenian",
      nativeName: "գրաբար (grabar)",
      script: "Armn",
      scriptName: "Armenian alphabet",
      direction: "ltr",
      family: "Indo-European › Armenian",
      period: "5th – 11th c. CE (literary use until the 19th c.)",
      description:
        "The language of the Armenian Bible and of the literature that followed Mesrop Mashtots's invention of the Armenian alphabet around 405 CE.",
      sortOrder: 185,
    },
  },
  // ── Reconstructed ───────────────────────────────────────────────────────
  {
    kaikki: "Proto-Indo-European",
    scripts: ["Latin"],
    reconstructed: true,
    language: {
      id: "ine-pro",
      name: "Proto-Indo-European",
      nativeName: null,
      script: "Latn",
      scriptName: "Latin (reconstructed forms, conventionally starred)",
      direction: "ltr",
      family: "Indo-European",
      period: "c. 4500 – 2500 BCE (reconstructed)",
      description:
        "The unattested common ancestor of the Indo-European languages, reconstructed by the comparative method; its forms are conventionally marked with an asterisk.",
      sortOrder: 190,
    },
  },
]

/* ──────────────────────────────────────────────────────────────────────────
 * Wiktextract records
 * ────────────────────────────────────────────────────────────────────────── */

type WxTemplate = { name: string; args?: Record<string, string>; expansion?: string }
type WxForm = { form: string; tags?: string[]; source?: string }
/** A synonym / antonym / derived / related term. */
type WxTerm = { word?: string; roman?: string; alt?: string; tags?: string[]; sense?: string }
type WxSense = {
  synonyms?: WxTerm[]
  antonyms?: WxTerm[]
  glosses?: string[]
  tags?: string[]
  topics?: string[]
  qualifier?: string
  form_of?: unknown[]
  alt_of?: unknown[]
}
type WxEntry = {
  word: string
  pos: string
  lang_code?: string
  senses?: WxSense[]
  forms?: WxForm[]
  head_templates?: WxTemplate[]
  etymology_text?: string
  etymology_templates?: WxTemplate[]
  synonyms?: WxTerm[]
  antonyms?: WxTerm[]
  derived?: WxTerm[]
  related?: WxTerm[]
}

/* ──────────────────────────────────────────────────────────────────────────
 * Mapping
 * ────────────────────────────────────────────────────────────────────────── */

/** Script letters, sign entries and romanisation pointers — not lemmas. */
const SKIP_POS = new Set(["romanization", "character", "symbol", "syllable", "punct", "letter"])

const POS: Record<string, PartOfSpeech> = {
  noun: "noun",
  name: "proper_noun",
  verb: "verb",
  adj: "adjective",
  adv: "adverb",
  pron: "pronoun",
  num: "numeral",
  prep: "preposition",
  postp: "postposition",
  conj: "conjunction",
  particle: "particle",
  intj: "interjection",
  det: "determiner",
  article: "determiner",
}

const PART_POS: Record<string, PartKind> = { root: "root", prefix: "prefix", suffix: "suffix", infix: "infix", interfix: "infix" }

const SKIP_SENSE_TAGS = new Set(["form-of", "alt-of", "romanization", "no-gloss", "empty-gloss"])

/** "plural of …", "sandhi form of …", "first-person singular present indicative/imperative of …", "Runic spelling of …". */
const FORM_GLOSS = new RegExp(
  "^(?:[\\w’'/,()-]+ ){0,10}?(?:[\\w-]+/)*(?:form|spelling|reconstruction|abbreviation|plural|singular|dual|indicative|imperative|subjunctive|optative|participle|gerundive|benedictive|future|aorist|infinitive|cases?|genders?) of\\b",
  "i"
)

/** Sense tags worth showing as a register / domain label. */
const DOMAIN_TAGS = new Set([
  "figuratively", "poetic", "rare", "obsolete", "archaic", "dialectal", "euphemistic", "broadly", "literally",
  "idiomatic", "derogatory", "honorific", "historical", "humorous", "vulgar", "Christianity", "Judaism",
  "Hinduism", "Buddhism", "Jainism", "Islam", "Zoroastrianism", "Vedic", "Classical", "Epic", "Northumbrian",
  "West-Saxon", "Anglian", "Kentish", "Mercian",
])

const FORMAT_CHARS = /[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g

function clean(s: string | undefined): string {
  return (s ?? "").replace(FORMAT_CHARS, "").replace(/\s+/g, " ").trim().normalize("NFC")
}

/** First letter that belongs to a specific script (skips ʾ ʿ and other Common letters). */
function firstScriptLetter(word: string): string | undefined {
  for (const ch of word) if (/\p{L}/u.test(ch) && !/[\p{Script=Common}\p{Script=Inherited}]/u.test(ch)) return ch
  return undefined
}

function headwordScriptOk(word: string, scripts: RegExp[]): boolean {
  const ch = firstScriptLetter(word)
  return !!ch && scripts.some((re) => re.test(ch))
}

/** Strip diacritics, marks, asterisks and separators for "same spelling?" comparisons. */
function bare(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[*\s\-‐.·]/g, "").toLowerCase()
}

function isLemmaSense(s: WxSense): boolean {
  if (s.form_of?.length || s.alt_of?.length) return false
  if (s.tags?.some((t) => SKIP_SENSE_TAGS.has(t))) return false
  const g = s.glosses?.at(-1)?.trim()
  if (!g) return false
  if (FORM_GLOSS.test(g) && !/^(?:a|the) form of\b/i.test(g)) return false
  return true
}

function senseDomain(s: WxSense): string | undefined {
  const labels = uniq([...(s.qualifier ? [clean(s.qualifier)] : []), ...(s.topics ?? []), ...(s.tags ?? []).filter((t) => DOMAIN_TAGS.has(t))])
  return labels.length ? labels.join(", ") : undefined
}

function hasTag(f: { tags?: string[] }, tag: string) {
  return f.tags?.includes(tag) ?? false
}

/** Forms written on the headword line (not inflection tables). */
function headForms(e: WxEntry): WxForm[] {
  return (e.forms ?? []).filter((f) => !f.source && !hasTag(f, "inflection-template") && !hasTag(f, "table-tags"))
}

function headArg(e: WxEntry, key: string): string | undefined {
  for (const t of e.head_templates ?? []) {
    const v = clean(t.args?.[key])
    if (v && v !== "-") return v
  }
  return undefined
}

/* ──────────────────────────────────────────────────────────────────────────
 * Etymology templates → link candidates
 * ────────────────────────────────────────────────────────────────────────── */

const TEMPLATE_RELATION: Record<string, RelationType> = {
  bor: "loan_from",
  "bor+": "loan_from",
  lbor: "loan_from",
  slbor: "loan_from",
  inh: "derived_from",
  "inh+": "derived_from",
  der: "derived_from",
  "der+": "derived_from",
  uder: "derived_from",
  cog: "cognate_of",
}

/** {{etymon}} keywords (":inh", ":bor<unc>" …). */
const ETYMON_RELATION: Record<string, RelationType> = {
  inh: "derived_from",
  der: "derived_from",
  uder: "derived_from",
  from: "derived_from",
  root: "derived_from",
  bor: "loan_from",
  lbor: "loan_from",
  slbor: "loan_from",
}

export type LinkCandidate = {
  /** Our language id and source ref of the entry whose etymology mentions the term. */
  fromLang: string
  fromRef: string
  /** Wiktionary code of the mentioned term's language. */
  wikt: string
  terms: string[]
  starred: boolean
  type: RelationType
  confidence: Confidence
  template: string
  /** The relation points from the mentioned term to the entry (a derived term is derived_from the lemma). */
  reverse?: boolean
}

/** Clean a term argument: inline modifiers <t:…>, [[links]], #anchors. */
function cleanTerm(s: string | undefined): string {
  let t = clean(s).replace(/<[^<>]*>/g, "")
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/#.*$/, "").trim()
  return t === "-" || t === "?" ? "" : t
}

function candidate(
  fromLang: string,
  fromRef: string,
  wikt: string | undefined,
  term: string,
  extra: (string | undefined)[],
  type: RelationType,
  confidence: Confidence,
  template: string
): LinkCandidate | undefined {
  if (!wikt || !term) return undefined
  const terms = uniq([term, ...extra.map(cleanTerm)].filter(Boolean))
  return { fromLang, fromRef, wikt: wikt.trim(), terms, starred: term.startsWith("*"), type, confidence, template }
}

export function etymologyCandidates(e: WxEntry, fromLang: string, fromRef: string, selfWikt: string): LinkCandidate[] {
  const out: LinkCandidate[] = []
  for (const t of e.etymology_templates ?? []) {
    const a = t.args ?? {}
    const type = TEMPLATE_RELATION[t.name]
    if (type) {
      const c =
        t.name === "cog"
          ? candidate(fromLang, fromRef, a["1"], cleanTerm(a["2"]), [a["3"], a.tr], type, "likely", t.name)
          : candidate(fromLang, fromRef, a["2"], cleanTerm(a["3"]), [a["4"], a.tr], type, "likely", t.name)
      if (c) out.push(c)
      continue
    }
    if (t.name === "etymon") {
      // {{etymon|got|:inh|gem-pro:*aiwīnaz|:afeq|𐌰𐌹𐍅𐍃|-𐌴𐌹𐌽𐍃<id:…>}}
      let rel: RelationType | undefined
      let confidence: Confidence = "likely"
      const keys = Object.keys(a).filter((k) => /^\d+$/.test(k)).sort((x, y) => Number(x) - Number(y))
      for (const k of keys.slice(1)) {
        const v = clean(a[k])
        if (v.startsWith(":")) {
          const m = v.match(/^:(\w+)(<[^>]*>)?/)
          rel = m ? ETYMON_RELATION[m[1]!] : undefined
          confidence = m?.[2]?.includes("unc") ? "debated" : "likely"
          continue
        }
        if (!rel) continue
        const m = v.match(/^([a-z]{2,3}(?:-[a-zA-Z]{2,4})*):(.+)$/)
        const c = candidate(fromLang, fromRef, m ? m[1] : selfWikt, cleanTerm(m ? m[2] : v), [], rel, confidence, "etymon")
        if (c) out.push(c)
      }
    }
  }
  const seen = new Set<string>()
  return out.filter((c) => {
    const k = `${c.type}|${c.wikt}|${c.terms[0]}`
    return seen.has(k) ? false : (seen.add(k), true)
  })
}

/** Thesaurus sections of a lemma, as relations inside its own language. */
const THESAURUS: { field: "synonyms" | "antonyms" | "derived" | "related"; type: RelationType; reverse?: boolean }[] = [
  { field: "synonyms", type: "synonym_of" },
  { field: "antonyms", type: "antonym_of" },
  { field: "derived", type: "derived_from", reverse: true },
  { field: "related", type: "see_also" },
]
const THESAURUS_TEMPLATES = new Set(THESAURUS.map((t) => t.field))
/** Per lemma and section: Latin and Greek list hundreds of derived terms for common roots. */
const MAX_THESAURUS_TERMS = 60

export function thesaurusCandidates(e: WxEntry, fromLang: string, fromRef: string, selfWikt: string, word: string): LinkCandidate[] {
  const out: LinkCandidate[] = []
  for (const { field, type, reverse } of THESAURUS) {
    const terms = [...(e[field] ?? []), ...(field === "synonyms" || field === "antonyms" ? (e.senses ?? []).flatMap((s) => s[field] ?? []) : [])]
    const seen = new Set<string>()
    for (const t of terms) {
      const w = cleanTerm(t.word)
      // "Thesaurus:" pages, the lemma itself and multi-word phrases are not entries
      if (!w || w === word || w.startsWith("Thesaurus:") || /\s/.test(w) || seen.has(w)) continue
      seen.add(w)
      const c = candidate(fromLang, fromRef, selfWikt, w, [t.alt, t.roman], type, "likely", field)
      if (c) out.push({ ...c, reverse })
      if (seen.size >= MAX_THESAURUS_TERMS) break
    }
  }
  return out
}

/** Wiktionary language code → our language id (null: not a language we hold). */
const WIKT_TO_OURS: Record<string, string> = {
  akk: "akk",
  sux: "sux",
  grc: "grc",
  he: "hbo",
  hbo: "hbo",
  arc: "arc",
  la: "lat",
  cop: "cop",
  ...Object.fromEntries(WIKTIONARY_LANGUAGES.map((l) => [l.wikt ?? l.language.id, l.language.id])),
}
/** Etymology-only varieties folded into their language (grc-koi, la-vul, sa-ved, egy-lat, akk-obb …). */
const FOLD_VARIETIES = new Set(["akk", "sux", "grc", "la", "cop", "egy", "sa", "non", "ang", "got", "sga", "hbo", "he", "arc", "xcl", "cu", "pi", "peo", "hit", "syc"])

export function ourLanguage(wikt: string): string | undefined {
  if (WIKT_TO_OURS[wikt]) return WIKT_TO_OURS[wikt]
  const base = wikt.split("-")[0]!
  return FOLD_VARIETIES.has(base) ? WIKT_TO_OURS[base] : undefined
}

/** Extra spellings to try in the target language (Akkadian mimation: šarrum → šarru). */
function targetVariants(lang: string, terms: string[]): string[] {
  if (lang !== "akk") return terms
  return uniq([...terms, ...terms.map((t) => t.replace(/([aeiuāēīū])m$/u, "$1"))])
}

/* ──────────────────────────────────────────────────────────────────────────
 * Entry conversion
 * ────────────────────────────────────────────────────────────────────────── */

function wiktionaryUrl(cfg: WiktionaryDump, word: string, reconstructed: boolean): string {
  const title = reconstructed ? `Reconstruction:${cfg.kaikki}/${word}` : word
  return `https://en.wiktionary.org/wiki/${title.replace(/ /g, "_")}#${cfg.kaikki.replace(/ /g, "_")}`
}

export type Converted = { entry: SeedEntry; links: LinkCandidate[]; hieroglyphs: boolean }

export function convertWiktionary(
  e: WxEntry,
  cfg: WiktionaryDump,
  ref: string,
  scripts: RegExp[],
  hiero?: HieroglyphTables
): Converted | null {
  if (!e.word || !e.pos || SKIP_POS.has(e.pos)) return null
  const word = clean(e.word)
  if (!word || !headwordScriptOk(word, scripts)) return null
  const senses = (e.senses ?? []).filter(isLemmaSense)
  if (!senses.length) return null

  const lang = cfg.language.id
  const latin = /\p{Script=Latin}/u.test(firstScriptLetter(word) ?? "")
  const reconstructed =
    !!cfg.reconstructed ||
    clean(e.head_templates?.[0]?.expansion).startsWith("*") ||
    senses.every((s) => s.tags?.includes("reconstruction"))

  // romanisations on the headword line: transliteration first, then transcription(s)
  const romans = uniq(
    [
      ...headForms(e)
        .filter((f) => hasTag(f, "romanization"))
        .map((f) => clean(f.form)),
      headArg(e, "tr") ?? "",
      headArg(e, "ts") ?? "",
    ]
      .map((r) => r.replace(/^\/+|\/+$/g, "").trim())
      .filter((r) => r && r !== word)
  )
  const canonical = headForms(e)
    .filter((f) => hasTag(f, "canonical"))
    .map((f) => clean(f.form))
    .find((f) => f && bare(f) === bare(word))

  let native: string | undefined
  let mdc: string | undefined
  let hieroglyphs = false
  if (cfg.hieroglyphs && hiero) {
    mdc = extractHiero(e.head_templates?.map((t) => t.args?.head).find((h) => h?.includes("<hiero>")))
    mdc ??= e.head_templates?.find((t) => t.name.startsWith("egy-"))?.args?.head?.trim() || undefined
    if (mdc) {
      const r = mdcToUnicode(mdc, hiero)
      if (r.signs) {
        native = r.text
        hieroglyphs = true
      }
    }
  } else if (!latin) {
    native = canonical ?? word
  } else if (canonical && canonical !== word) {
    native = canonical
  }
  if (reconstructed && !native) native = `*${(canonical ?? word).replace(/^\*/, "")}`

  const translit = !latin ? romans[0] : undefined
  const glosses = uniq(senses.map((s) => clean(s.glosses!.at(-1))).filter(Boolean))
  const gloss = truncate(glosses.slice(0, 3).join("; "), 120)

  const seedSenses: SeedSense[] = senses.slice(0, 12).map((s) => ({ gloss: truncate(clean(s.glosses!.at(-1)), 200), domain: senseDomain(s) }))

  const notes: string[] = []
  if (reconstructed) notes.push("Reconstructed form.")
  if (mdc) notes.push(`Hieroglyphs (Manuel de Codage): ${mdc}.`)
  const others = romans.filter((r) => r !== translit)
  if (!latin && others.length) notes.push(`Also romanised: ${others.join(", ")}.`)
  notes.push(`Wiktionary: ${wiktionaryUrl(cfg, word, reconstructed)}`)

  const partKind =
    PART_POS[e.pos] ?? (e.pos === "affix" ? (word.startsWith("-") ? "suffix" : word.endsWith("-") ? "prefix" : "infix") : undefined)
  const etymology = clean(e.etymology_text)
  const base = {
    headword: word,
    native,
    translit,
    gloss,
    definition: glosses[0] && glosses[0].length > 120 ? truncate(glosses[0], 1500) : undefined,
    etymology: etymology ? truncate(etymology, 1500) : undefined,
    notes: notes.join(" "),
    ref,
    senses: seedSenses,
  }
  const entry: SeedEntry = partKind
    ? { kind: "part", partKind: senses.some((s) => s.tags?.includes("enclitic")) && partKind === "suffix" ? "clitic" : partKind, ...base }
    : { kind: "word", pos: POS[e.pos] ?? "other", ...base }

  const selfWikt = cfg.wikt ?? lang
  return { entry, links: [...etymologyCandidates(e, lang, ref, selfWikt), ...thesaurusCandidates(e, lang, ref, selfWikt, word)], hieroglyphs }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Files
 * ────────────────────────────────────────────────────────────────────────── */

function kaikkiFile(cfg: WiktionaryDump): string {
  return `kaikki.org-dictionary-${cfg.kaikki.replace(/[\s'-]/g, "")}.jsonl`
}

export function kaikkiUrl(cfg: WiktionaryDump): string {
  return `https://kaikki.org/dictionary/${encodeURIComponent(cfg.kaikki).replace(/'/g, "%27")}/${kaikkiFile(cfg)}`
}

function dump(cfg: WiktionaryDump, ctx: Pick<ImporterContext, "offline" | "log">): Promise<string> {
  return download("wiktionary", kaikkiFile(cfg), kaikkiUrl(cfg), { offline: ctx.offline, log: ctx.log })
}

function scriptPatterns(cfg: WiktionaryDump): RegExp[] {
  return cfg.scripts.map((s) => new RegExp(`\\p{Script=${s}}`, "u"))
}

/** Stream a dump and convert it; `onEntry` returns false to stop (limit). */
async function readLanguage(
  cfg: WiktionaryDump,
  file: string,
  hiero: HieroglyphTables | undefined,
  limit: number | undefined
): Promise<{ converted: Converted[]; records: number }> {
  const scripts = scriptPatterns(cfg)
  const occurrences = new Map<string, number>()
  const converted: Converted[] = []
  let records = 0
  for await (const rec of iterateJsonLines<WxEntry>(file)) {
    records++
    const k = `${clean(rec.word)}:${rec.pos}`
    const n = (occurrences.get(k) ?? 0) + 1
    occurrences.set(k, n)
    const c = convertWiktionary(rec, cfg, `${cfg.language.id}:${k}:${n}`, scripts, hiero)
    if (!c) continue
    converted.push(c)
    if (limit && converted.length >= limit) break
  }
  return { converted, records }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Links
 * ────────────────────────────────────────────────────────────────────────── */

const NOTE_PREFIX = "Wiktionary"
const RECONSTRUCTED = new Set(["ine-pro", ...WIKTIONARY_LANGUAGES.filter((l) => l.reconstructed).map((l) => l.language.id)])

/** "Wiktionary etymology: {{inh}}" or "Wiktionary synonyms" (every note starts with NOTE_PREFIX, so --prune can find them). */
function relationNote(c: LinkCandidate): string {
  return (THESAURUS_TEMPLATES as Set<string>).has(c.template) ? `${NOTE_PREFIX} ${c.template}` : `${NOTE_PREFIX} etymology: {{${c.template}}}`
}

/** Resolve candidates against the database and write them; returns per-type / per-target counts. */
async function buildLinks(
  db: Database,
  candidates: LinkCandidate[],
  idOfRef: (lang: string, ref: string) => string | undefined,
  log: (m: string) => void,
  prune: { fromIds: string[] } | undefined
) {
  const resolver = new EntryResolver(db, RECONSTRUCTED)
  const known = await resolver.languages()
  const rows: RelationRow[] = []
  const target = new Map<string, number>() // `${type} → ${lang}` → count
  let unresolved = 0
  let foreign = 0
  const levels = [0, 0, 0, 0] // headword, native, spelling, search key
  for (const c of candidates) {
    const lang = ourLanguage(c.wikt)
    if (!lang || !known.has(lang)) {
      foreign++
      continue
    }
    const fromId = idOfRef(c.fromLang, c.fromRef)
    if (!fromId) continue
    const hit = await resolver.match(lang, targetVariants(lang, c.terms), { starred: c.starred && !RECONSTRUCTED.has(lang) ? true : undefined })
    if (!hit) {
      unresolved++
      continue
    }
    levels[hit.level - 1]!++
    const [from, to] = c.reverse ? [hit.id, fromId] : [fromId, hit.id]
    rows.push({ fromEntryId: from, toEntryId: to, type: c.type, confidence: c.confidence, note: relationNote(c) })
    const k = `${c.type} → ${lang}`
    target.set(k, (target.get(k) ?? 0) + 1)
  }
  const { ids, byType } = await writeRelations(db, rows, { notePrefix: NOTE_PREFIX })
  const pruned = prune ? await pruneRelations(db, prune.fromIds, ids, NOTE_PREFIX) : 0
  log(
    `relations: ${ids.size} written (${[...byType].map(([t, n]) => `${t} ${n}`).join(", ") || "none"}); ` +
      `${unresolved} mentions not found in the target language, ${foreign} in languages we do not hold${pruned ? `; ${pruned} stale pruned` : ""}`
  )
  log(`  matched by headword ${levels[0]}, native script ${levels[1]}, spelling ${levels[2]}, search key ${levels[3]}`)
  if (target.size) log(`  by target: ${[...target].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`)
  return ids.size
}

/** source ref → entry id for the Wiktionary entries of `lang` already in the database. */
async function refsInDatabase(db: Database, lang: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: entriesTable.id, ref: entriesTable.sourceRef })
    .from(entriesTable)
    .where(and(eq(entriesTable.languageId, lang), eq(entriesTable.sourceId, wiktionarySource.id), isNotNull(entriesTable.sourceRef)))
  return new Map(rows.map((r) => [r.ref!, r.id]))
}

/** Every entry id of the languages (relations inside a language can start at any of them). */
async function entryIdsOf(db: Database, langs: string[]): Promise<string[]> {
  if (!langs.length) return []
  const rows = await db.select({ id: entriesTable.id }).from(entriesTable).where(inArray(entriesTable.languageId, langs))
  return rows.map((r) => r.id)
}

/* ──────────────────────────────────────────────────────────────────────────
 * Enrichment: languages another dictionary holds
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Languages whose entries always come from another importer; Wiktionary adds synonyms,
 * antonyms, derived terms and etymologies to them. (Hebrew is left out: Wiktionary's
 * "Hebrew" mixes Biblical and Modern Hebrew.)
 */
export const WIKTIONARY_ENRICHMENTS: WiktionaryDump[] = [
  { kaikki: "Latin", wikt: "la", scripts: ["Latin"], language: { id: "lat", name: "Latin" } },
  { kaikki: "Ancient Greek", wikt: "grc", scripts: ["Greek"], language: { id: "grc", name: "Ancient Greek" } },
  { kaikki: "Sumerian", scripts: ["Cuneiform"], language: { id: "sux", name: "Sumerian" } },
  { kaikki: "Akkadian", scripts: ["Cuneiform", "Latin"], language: { id: "akk", name: "Akkadian" } },
  { kaikki: "Coptic", scripts: ["Coptic"], language: { id: "cop", name: "Coptic" } },
]

/** Entries of the language from any source but Wiktionary. */
async function primaryCount(db: Database, lang: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(entriesTable)
    .where(and(eq(entriesTable.languageId, lang), sql`${entriesTable.sourceId} is distinct from ${wiktionarySource.id}`))
  return row?.n ?? 0
}

type PrimaryRow = {
  id: string
  kind: string
  pos: string | null
  headword: string
  native: string | null
  translit: string | null
  etymology: string | null
  gloss: string
}

const STOPWORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "one", "who", "which", "something", "someone", "thing", "make", "become", "be"])
function glossWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)))
}

/** The dictionary's entries of one language, indexed for matching Wiktionary lemmas to them. */
class PrimaryIndex {
  private levels: Map<string, string[]>[] = [new Map(), new Map(), new Map(), new Map(), new Map()]
  readonly rows = new Map<string, PrimaryRow>()

  static async load(db: Database, lang: string): Promise<PrimaryIndex> {
    const idx = new PrimaryIndex()
    const rows = await db
      .select({
        id: entriesTable.id,
        kind: entriesTable.kind,
        pos: entriesTable.partOfSpeech,
        headword: entriesTable.headword,
        native: entriesTable.nativeScript,
        translit: entriesTable.transliteration,
        etymology: entriesTable.etymology,
        gloss: entriesTable.gloss,
        searchKey: entriesTable.searchKey,
      })
      .from(entriesTable)
      .where(and(eq(entriesTable.languageId, lang), sql`${entriesTable.sourceId} is distinct from ${wiktionarySource.id}`))
    for (const r of rows) {
      idx.rows.set(r.id, r)
      const [headword, native, translit, spelling, key] = idx.levels as [Map<string, string[]>, Map<string, string[]>, Map<string, string[]>, Map<string, string[]>, Map<string, string[]>]
      push(headword, r.headword.normalize("NFC"), r.id)
      push(native, r.native?.normalize("NFC"), r.id)
      push(translit, r.translit?.normalize("NFC"), r.id)
      for (const f of [r.headword, r.native, r.translit]) if (f) push(spelling, spellingKey(f), r.id)
      for (const token of r.searchKey.split(" ")) push(key, token, r.id)
    }
    return idx
  }

  /** The entry a Wiktionary lemma describes: exact forms first, then looser keys; homonyms are told apart by kind, part of speech and gloss. */
  match(e: SeedEntry, lang: string): PrimaryRow | "ambiguous" | undefined {
    const forms = targetVariants(
      lang,
      uniq([e.headword, e.native?.replace(/^\*/, ""), e.translit].filter((f): f is string => !!f).map((f) => f.normalize("NFC")))
    )
    const keyOf: ((f: string) => string | undefined)[] = [
      (f) => f,
      (f) => f,
      (f) => f,
      (f) => spellingKey(f),
      (f) => (VOWEL_MARK_SCRIPT.test(f) ? undefined : normalizeForSearch(f) || undefined),
    ]
    for (const [i, level] of this.levels.entries()) {
      const ids = uniq(forms.flatMap((f) => {
        const k = keyOf[i]!(f)
        return k ? (level.get(k) ?? []) : []
      }))
      if (!ids.length) continue
      if (ids.length === 1) return this.rows.get(ids[0]!)
      return this.disambiguate(ids.map((id) => this.rows.get(id)!), e) ?? "ambiguous"
    }
    return undefined
  }

  private disambiguate(rows: PrimaryRow[], e: SeedEntry): PrimaryRow | undefined {
    let pool = rows.filter((r) => r.kind === e.kind)
    if (!pool.length) pool = rows
    if (e.kind === "word" && e.pos) {
      const samePos = pool.filter((r) => r.pos === e.pos)
      if (samePos.length) pool = samePos
    }
    if (pool.length === 1) return pool[0]
    const words = glossWords([e.gloss, ...(e.senses ?? []).map((s) => (typeof s === "string" ? s : s.gloss))].join(" "))
    const scored = pool.map((r) => ({ r, n: [...glossWords(r.gloss)].filter((w) => words.has(w)).length })).sort((a, b) => b.n - a.n)
    return scored[0]!.n > 0 && scored[0]!.n > (scored[1]?.n ?? 0) ? scored[0]!.r : undefined
  }
}

function push(map: Map<string, string[]>, k: string | null | undefined, id: string) {
  if (!k) return
  const ids = map.get(k)
  if (!ids) map.set(k, [id])
  else if (!ids.includes(id)) ids.push(id)
}

/** Match a language's Wiktionary lemmas to the dictionary entries and fill in what those lack. */
async function enrichLanguage(cfg: WiktionaryDump, ctx: ImporterContext, converted: Converted[], records: number): Promise<LanguageRun> {
  const { db, log } = ctx
  const lang = cfg.language.id
  // the language used to be Wiktionary's own: its entries would now duplicate the dictionary's
  const removed = await db
    .delete(entriesTable)
    .where(and(eq(entriesTable.languageId, lang), eq(entriesTable.sourceId, wiktionarySource.id)))
    .returning({ id: entriesTable.id })
  if (removed.length) log(`removed ${removed.length} earlier Wiktionary entries: another dictionary now holds ${cfg.language.name}`)

  const index = await PrimaryIndex.load(db, lang)
  const idByRef = new Map<string, string>()
  const fills = new Map<string, { native?: string; etymology?: string; row: PrimaryRow }>()
  let ambiguous = 0
  let unmatched = 0
  for (const c of converted) {
    const hit = index.match(c.entry, lang)
    if (hit === "ambiguous") ambiguous++
    if (!hit || hit === "ambiguous") {
      if (!hit) unmatched++
      continue
    }
    idByRef.set(c.entry.ref!, hit.id)
    const fill = fills.get(hit.id) ?? { row: hit }
    // a script spelling only for dictionaries that cite transliterations (Egyptian, Akkadian), never a variant of a native headword
    const native = c.entry.native
    const transliterated = /\p{Script=Latin}/u.test(hit.headword)
    if (transliterated && !hit.native && !fill.native && native && !native.startsWith("*") && !/\p{Script=Latin}/u.test(native)) fill.native = native
    if (!hit.etymology && !fill.etymology && c.entry.etymology) fill.etymology = `${c.entry.etymology} (Wiktionary)`
    if (fill.native || fill.etymology) fills.set(hit.id, fill)
  }
  let natives = 0
  let etymologies = 0
  for (const part of chunk([...fills.values()], 500)) {
    await db.execute(sql`
      update ${entriesTable} as e set
        native_script = coalesce(e.native_script, v.native),
        etymology = coalesce(e.etymology, v.etymology),
        search_key = case when e.native_script is null and v.native is not null then v.search_key else e.search_key end,
        updated_at = now()
      from (values ${sql.join(
        part.map((f) => sql`(${f.row.id}::uuid, ${f.native ?? null}::text, ${f.etymology ?? null}::text, ${buildSearchKey([f.row.headword, f.row.translit, f.native ?? f.row.native])}::text)`),
        sql`, `
      )}) as v(id, native, etymology, search_key)
      where e.id = v.id`)
    natives += part.filter((f) => f.native).length
    etymologies += part.filter((f) => f.etymology).length
  }
  log(
    `${cfg.language.name}: ${records} records → ${converted.length} lemmas, ${idByRef.size} matched to ${new Set(idByRef.values()).size} of ${index.rows.size} entries ` +
      `(${ambiguous} ambiguous, ${unmatched} not in the dictionary); filled ${etymologies} etymologies, ${natives} native spellings`
  )
  return { lang, candidates: converted.filter((c) => idByRef.has(c.entry.ref!)).flatMap((c) => c.links), idByRef }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Importers
 * ────────────────────────────────────────────────────────────────────────── */

type LanguageRun = { lang: string; candidates: LinkCandidate[]; idByRef: Map<string, string> }

const OWNED = new Set(WIKTIONARY_LANGUAGES.map((l) => l.language.id))

async function importLanguage(cfg: WiktionaryDump, ctx: ImporterContext, hiero?: HieroglyphTables): Promise<LanguageRun | undefined> {
  const { db, log, limit, prune } = ctx
  const enrich = (await primaryCount(db, cfg.language.id)) > 0
  if (!enrich && !OWNED.has(cfg.language.id)) {
    log(`${cfg.language.name}: no dictionary entries to enrich yet — import that language first`)
    return undefined
  }
  const file = await dump(cfg, ctx)
  if (cfg.hieroglyphs && !hiero) hiero = await loadHieroglyphTables({ offline: ctx.offline, log })
  const { converted, records } = await readLanguage(cfg, file, hiero, limit)
  if (enrich) return enrichLanguage(cfg, ctx, converted, records)

  const entries = converted.map((c) => c.entry)
  const parts = entries.filter((e) => e.kind === "part").length
  const glyphs = converted.filter((c) => c.hieroglyphs).length
  log(
    `${cfg.language.name}: ${records} records → ${entries.length} lemmas (${parts} parts)` +
      (cfg.hieroglyphs ? `, ${glyphs} with hieroglyphs` : "")
  )
  const language = WIKTIONARY_LANGUAGES.find((l) => l.language.id === cfg.language.id)!.language
  const dataset: SeedDataset = { language, source: wiktionarySource, entries }
  const result = await upsertDataset(db, dataset, { log, prune: prune && !limit, batchSize: 250 })
  const idByRef = new Map<string, string>()
  for (const [ref, key] of result.keyOfRef) {
    const id = result.idByKey.get(key)
    if (id) idByRef.set(ref, id)
  }
  return { lang: cfg.language.id, candidates: converted.flatMap((c) => c.links), idByRef }
}

async function linkRuns(runs: LanguageRun[], ctx: ImporterContext) {
  const byLang = new Map(runs.map((r) => [r.lang, r.idByRef]))
  const candidates = runs.flatMap((r) => r.candidates)
  const prune = ctx.prune && !ctx.limit ? { fromIds: await entryIdsOf(ctx.db, runs.map((r) => r.lang)) } : undefined
  await buildLinks(ctx.db, candidates, (lang, ref) => byLang.get(lang)?.get(ref), ctx.log, prune)
}

/** Every dump the group importer reads: Wiktionary's own languages, then the enriched ones. */
const ALL_DUMPS: WiktionaryDump[] = [...WIKTIONARY_LANGUAGES, ...WIKTIONARY_ENRICHMENTS]

function languageImporter(cfg: WiktionaryDump): Importer {
  const owned = OWNED.has(cfg.language.id)
  return {
    id: `wikt-${cfg.language.id}`,
    language: cfg.language.id,
    description: owned
      ? `Wiktionary ${cfg.language.name} lemmas (Kaikki.org), or enrichment once a dictionary holds the language`
      : `Wiktionary synonyms, derived terms and etymologies for the ${cfg.language.name} dictionary entries`,
    explicitOnly: true,
    async run(ctx) {
      const run = await importLanguage(cfg, ctx)
      if (run) await linkRuns([run], ctx)
    },
  }
}

export const wiktionaryLanguageImporters: Importer[] = ALL_DUMPS.map(languageImporter)

export const wiktionaryImporter: Importer = {
  id: "wiktionary",
  language: "*",
  description: `Wiktionary lemmas for ${WIKTIONARY_LANGUAGES.length} ancient languages and enrichment of ${WIKTIONARY_ENRICHMENTS.length} more (Kaikki.org)`,
  // Last in `--all`, so its links can resolve to every other dictionary (Latin, Greek, Hebrew, Akkadian …).
  runLast: true,
  async run(ctx) {
    const hiero = await loadHieroglyphTables({ offline: ctx.offline, log: ctx.log })
    const runs: LanguageRun[] = []
    for (const cfg of ALL_DUMPS) {
      const run = await importLanguage(cfg, { ...ctx, log: (m) => ctx.log(`${cfg.language.id}: ${m}`) }, hiero)
      if (run) runs.push(run)
    }
    await linkRuns(runs, ctx)
  },
}

export const wiktionaryLinksImporter: Importer = {
  id: "wiktionary-links",
  language: "*",
  description: "Rebuild Wiktionary etymology and thesaurus relations from the cached dumps (run after other languages are imported)",
  // `wiktionary` already builds the links at its end; this is for re-linking after a later import.
  explicitOnly: true,
  async run(ctx) {
    const { db, log, limit } = ctx
    const runs: LanguageRun[] = []
    for (const cfg of ALL_DUMPS) {
      const sub = { ...ctx, log: (m: string) => log(`${cfg.language.id}: ${m}`) }
      if ((await primaryCount(db, cfg.language.id)) > 0) {
        // enriched language: match the lemmas again (cheap) — this also fills new entries' gaps
        const run = await importLanguage(cfg, sub)
        if (run) runs.push(run)
        continue
      }
      if (!OWNED.has(cfg.language.id)) continue
      const idByRef = await refsInDatabase(db, cfg.language.id)
      if (!idByRef.size) {
        sub.log(`no Wiktionary entries in the database — run wikt-${cfg.language.id} first`)
        continue
      }
      const file = await dump(cfg, ctx)
      // hieroglyphs are irrelevant for links; conversion keeps the ref numbering identical
      const { converted } = await readLanguage(cfg, file, undefined, limit)
      const candidates = converted.flatMap((c) => c.links)
      sub.log(`${candidates.length} etymology and thesaurus mentions from ${converted.length} lemmas`)
      runs.push({ lang: cfg.language.id, candidates, idByRef })
    }
    await linkRuns(runs, ctx)
  },
}

/** Per-language importers (explicit selection only), the group importer and the links pass. */
export const wiktionaryImporters: Importer[] = [...wiktionaryLanguageImporters, wiktionaryImporter, wiktionaryLinksImporter]

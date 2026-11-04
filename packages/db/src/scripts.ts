/**
 * The writing systems the sign browser knows. Sign importers upsert the rows
 * they fill (`upsertScripts`), so this list is the one place to describe a
 * script; `languages.script` refers to the same ISO 15924 codes.
 */
import { sql } from "drizzle-orm"

import type { Database } from "./client"
import { scripts, type NewScript } from "./schema"

export const SCRIPTS = [
  {
    id: "proto-cuneiform",
    name: "Proto-Cuneiform",
    iso15924: null,
    kind: "logography (proto-writing)",
    direction: "ltr",
    period: "c. 3350 – 2900 BCE (Uruk IV, Uruk III / Jemdet Nasr)",
    region: "Southern Mesopotamia and Susiana",
    description:
      "The earliest writing from Uruk: administrative tablets with numerical systems and some 2,000 pictographic signs, the ancestor of cuneiform. Not yet in Unicode; Oracc encodes it after the 2025 proposal L2/25-211.",
    unicodeRange: "proposed (Oracc PC24 encoding)",
    sortOrder: 5,
  },
  {
    id: "cuneiform",
    name: "Cuneiform",
    iso15924: "Xsux",
    kind: "logo-syllabary",
    direction: "ltr",
    period: "c. 3000 BCE – 75 CE",
    region: "Mesopotamia, Anatolia, Syria, Iran",
    description:
      "Wedge-shaped signs pressed into clay, used for Sumerian, Akkadian, Hittite, Elamite, Hurrian and Urartian. A sign can stand for a word, a syllable or an unpronounced classifier.",
    unicodeRange: "U+12000–1254F",
    sortOrder: 10,
  },
  {
    id: "egyptian-hieroglyphs",
    name: "Egyptian hieroglyphs",
    iso15924: "Egyp",
    kind: "logo-consonantal",
    direction: "ltr",
    period: "c. 3200 BCE – 394 CE",
    region: "Egypt and Nubia",
    description:
      "Pictorial signs used as logograms, as one-, two- and three-consonant phonograms and as unpronounced classifiers. Written in either direction; Unicode encodes the left-to-right form.",
    unicodeRange: "U+13000–1342F, U+13460–143FF",
    sortOrder: 20,
  },
  {
    id: "ugaritic",
    name: "Ugaritic alphabet",
    iso15924: "Ugar",
    kind: "abjad (cuneiform)",
    direction: "ltr",
    period: "c. 1400 – 1185 BCE",
    region: "Ugarit (Ras Shamra), Syria",
    description:
      "A thirty-letter alphabet written in wedges on clay, in the same letter order as the later Phoenician and Hebrew alphabets.",
    unicodeRange: "U+10380–1039F",
    sortOrder: 30,
  },
  {
    id: "phoenician",
    name: "Phoenician",
    iso15924: "Phnx",
    kind: "abjad",
    direction: "rtl",
    period: "c. 1050 – 150 BCE",
    region: "Levant and the Phoenician colonies (Carthage)",
    description:
      "The 22-letter consonantal alphabet behind the Greek, Latin, Aramaic and Hebrew scripts. Unicode also uses it for Paleo-Hebrew, Moabite and other Old Canaanite inscriptions.",
    unicodeRange: "U+10900–1091F",
    sortOrder: 35,
  },
  {
    id: "hebrew",
    name: "Hebrew",
    iso15924: "Hebr",
    kind: "abjad",
    direction: "rtl",
    period: "c. 300 BCE – today (square script)",
    region: "Levant, then worldwide",
    description:
      "The square script, a form of Imperial Aramaic, used for Hebrew and Aramaic since the Second Temple period; vowels are marked with optional points.",
    unicodeRange: "U+0590–05FF",
    sortOrder: 40,
  },
  {
    id: "imperial-aramaic",
    name: "Imperial Aramaic",
    iso15924: "Armi",
    kind: "abjad",
    direction: "rtl",
    period: "c. 800 – 300 BCE",
    region: "Assyrian, Babylonian and Persian empires",
    description:
      "The Aramaic chancery script of the Near Eastern empires, ancestor of the Hebrew square script, Syriac, Nabataean (and so Arabic) and many Central Asian scripts.",
    unicodeRange: "U+10840–1085F",
    sortOrder: 42,
  },
  {
    id: "syriac",
    name: "Syriac",
    iso15924: "Syrc",
    kind: "abjad",
    direction: "rtl",
    period: "1st century CE – today",
    region: "Upper Mesopotamia, Syria, the Church of the East",
    description:
      "A cursive Aramaic script for Classical Syriac, in Estrangela, Serto and East Syriac styles, with dots for vowels.",
    unicodeRange: "U+0700–074F",
    sortOrder: 44,
  },
  {
    id: "old-south-arabian",
    name: "Old South Arabian",
    iso15924: "Sarb",
    kind: "abjad",
    direction: "rtl",
    period: "c. 800 BCE – 600 CE",
    region: "Yemen and Eritrea (Sabaean, Minaean, Qatabanian, Hadramitic)",
    description: "A 29-letter monumental script for the Sayhadic languages, ancestor of the Geʿez script of Ethiopia.",
    unicodeRange: "U+10A60–10A7F",
    sortOrder: 46,
  },
  {
    id: "old-persian",
    name: "Old Persian cuneiform",
    iso15924: "Xpeo",
    kind: "semi-syllabary",
    direction: "ltr",
    period: "c. 520 – 330 BCE",
    region: "Achaemenid Persia",
    description:
      "A simplified cuneiform created for the Achaemenid kings' inscriptions (Behistun): 36 phonetic signs, a few logograms, numerals and a word divider.",
    unicodeRange: "U+103A0–103DF",
    sortOrder: 50,
  },
  {
    id: "anatolian-hieroglyphs",
    name: "Anatolian hieroglyphs",
    iso15924: "Hluw",
    kind: "logo-syllabary",
    direction: "ltr",
    period: "c. 1400 – 700 BCE",
    region: "Anatolia and northern Syria",
    description:
      "The native hieroglyphic script of Luwian, used on Hittite royal seals and on the stone monuments of the Neo-Hittite states. Signs are numbered after Laroche.",
    unicodeRange: "U+14400–1467F",
    sortOrder: 55,
  },
  {
    id: "linear-a",
    name: "Linear A",
    iso15924: "Lina",
    kind: "syllabary (undeciphered)",
    direction: "ltr",
    period: "c. 1800 – 1450 BCE",
    region: "Minoan Crete and the Aegean",
    description:
      "The script of the Minoan language, still undeciphered. Signs shared with Linear B (AB numbers) are conventionally read with Linear B values.",
    unicodeRange: "U+10600–1077F",
    sortOrder: 60,
  },
  {
    id: "linear-b",
    name: "Linear B",
    iso15924: "Linb",
    kind: "syllabary with logograms",
    direction: "ltr",
    period: "c. 1450 – 1200 BCE",
    region: "Mycenaean Greece and Crete (Knossos, Pylos)",
    description:
      "The syllabary of Mycenaean Greek, deciphered by Michael Ventris in 1952: about 90 syllabic signs plus logograms for people, animals and goods.",
    unicodeRange: "U+10000–100FF",
    sortOrder: 62,
  },
  {
    id: "cypriot",
    name: "Cypriot syllabary",
    iso15924: "Cprt",
    kind: "syllabary",
    direction: "rtl",
    period: "c. 1100 – 200 BCE",
    region: "Cyprus",
    description: "A descendant of the Cypro-Minoan script, used to write the Arcado-Cypriot dialect of Greek and Eteocypriot.",
    unicodeRange: "U+10800–1083F",
    sortOrder: 64,
  },
  {
    id: "greek",
    name: "Greek alphabet",
    iso15924: "Grek",
    kind: "alphabet",
    direction: "ltr",
    period: "c. 800 BCE – today",
    region: "Greece and the Mediterranean",
    description:
      "The first alphabet with letters for vowels, adapted from Phoenician; archaic letters such as digamma and qoppa survived as numerals.",
    unicodeRange: "U+0370–03FF, U+1F00–1FFF",
    sortOrder: 70,
  },
  {
    id: "old-italic",
    name: "Old Italic",
    iso15924: "Ital",
    kind: "alphabet",
    direction: "ltr",
    period: "c. 700 – 100 BCE",
    region: "Italy (Etruscan, Oscan, Umbrian, Faliscan)",
    description:
      "The Greek-derived alphabets of ancient Italy, usually written right to left; Unicode unifies them in one left-to-right block.",
    unicodeRange: "U+10300–1032F",
    sortOrder: 72,
  },
  {
    id: "coptic",
    name: "Coptic",
    iso15924: "Copt",
    kind: "alphabet",
    direction: "ltr",
    period: "c. 200 CE – today (liturgical)",
    region: "Egypt",
    description: "The Greek alphabet plus six or seven letters from Demotic, used for the last stage of the Egyptian language.",
    unicodeRange: "U+2C80–2CFF, U+03E2–03EF",
    sortOrder: 75,
  },
  {
    id: "gothic",
    name: "Gothic",
    iso15924: "Goth",
    kind: "alphabet",
    direction: "ltr",
    period: "4th – 6th century CE",
    region: "The Gothic kingdoms",
    description: "Created by bishop Wulfila for his Bible translation, mostly from Greek uncials with some Latin and runic letters.",
    unicodeRange: "U+10330–1034F",
    sortOrder: 80,
  },
  {
    id: "runic",
    name: "Runic",
    iso15924: "Runr",
    kind: "alphabet",
    direction: "ltr",
    period: "c. 150 – 1500 CE",
    region: "Scandinavia, England and Germanic Europe",
    description:
      "The futhark alphabets of the Germanic languages: the Elder Futhark of 24 runes, the Anglo-Saxon futhorc and the Younger Futhark of the Viking Age.",
    unicodeRange: "U+16A0–16FF",
    sortOrder: 82,
  },
  {
    id: "ogham",
    name: "Ogham",
    iso15924: "Ogam",
    kind: "alphabet",
    direction: "ltr",
    period: "c. 300 – 600 CE (inscriptions)",
    region: "Ireland and western Britain",
    description: "Strokes cut along the edge of a standing stone, used for Primitive and Old Irish; each letter is named after a tree or plant.",
    unicodeRange: "U+1680–169F",
    sortOrder: 84,
  },
] as const satisfies readonly NewScript[]

export type ScriptId = (typeof SCRIPTS)[number]["id"]

export function scriptRow(id: ScriptId): NewScript {
  const row = SCRIPTS.find((s) => s.id === id)
  if (!row) throw new Error(`unknown script ${id}`)
  return row
}

/** Insert or refresh script rows (all of them by default). */
export async function upsertScripts(db: Database, ids?: ScriptId[]) {
  const rows: NewScript[] = ids ? ids.map(scriptRow) : [...SCRIPTS]
  if (!rows.length) return
  await db
    .insert(scripts)
    .values(rows)
    .onConflictDoUpdate({
      target: scripts.id,
      set: {
        name: sql`excluded.name`,
        iso15924: sql`excluded.iso15924`,
        kind: sql`excluded.kind`,
        direction: sql`excluded.direction`,
        period: sql`excluded.period`,
        region: sql`excluded.region`,
        description: sql`excluded.description`,
        unicodeRange: sql`excluded.unicode_range`,
        sortOrder: sql`excluded.sort_order`,
      },
    })
}

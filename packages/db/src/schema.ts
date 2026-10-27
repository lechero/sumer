import { relations } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

/* ──────────────────────────────────────────────────────────────────────────
 * Enums
 * ────────────────────────────────────────────────────────────────────────── */

export const textDirectionEnum = pgEnum("text_direction", ["ltr", "rtl"])

/** A dictionary entry is either a full word (lemma) or a word *part* (morpheme, sign, …). */
export const entryKindEnum = pgEnum("entry_kind", ["word", "part"])

export const partKindEnum = pgEnum("part_kind", [
  "root", // Semitic consonantal root (š-l-m), Greek verbal root (λεγ-/λογ-)
  "stem",
  "prefix",
  "suffix",
  "infix",
  "clitic", // enclitic / proclitic particles (Sumerian case markers, copula)
  "particle",
  "pattern", // Semitic nominal / verbal templates (maqṭāl, qaṭṭāl)
  "determinative", // unpronounced classifier signs (𒀭 before divine names)
  "sign", // a cuneiform sign as such
  "numeral",
])

export const partOfSpeechEnum = pgEnum("part_of_speech", [
  "noun",
  "proper_noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "numeral",
  "preposition",
  "postposition",
  "conjunction",
  "particle",
  "interjection",
  "determiner",
  "other",
])

export const relationTypeEnum = pgEnum("relation_type", [
  "loan_from", // from ← borrowed from → to
  "cognate_of", // shared inheritance (Hebrew šālôm ~ Akkadian šulmu)
  "derived_from",
  "variant_of",
  "synonym_of",
  "antonym_of",
  "equivalent_of", // translation equivalent (lexical-list style: Akkadian šarru = Sumerian lugal)
  "see_also",
])

export const confidenceEnum = pgEnum("confidence", ["certain", "likely", "debated"])

/* ──────────────────────────────────────────────────────────────────────────
 * Tables
 * ────────────────────────────────────────────────────────────────────────── */

export const languages = pgTable("languages", {
  /** ISO 639-3 code: sux, akk, grc, hbo … */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  /** ISO 15924 script code: Xsux, Grek, Hebr … */
  script: text("script").notNull(),
  scriptName: text("script_name"),
  direction: textDirectionEnum("direction").notNull().default("ltr"),
  family: text("family"),
  period: text("period"),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
})

/** Where an entry's data came from (ePSD2, LSJ, BDB, …). */
export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url"),
  license: text("license"),
  citation: text("citation"),
})

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    languageId: text("language_id")
      .notNull()
      .references(() => languages.id, { onDelete: "cascade" }),
    kind: entryKindEnum("kind").notNull().default("word"),
    /** Only meaningful when kind = 'part'. */
    partKind: partKindEnum("part_kind"),
    /**
     * Citation form. Sumerian: ePSD2-style transliteration (lugal, e₂-gal).
     * Greek / Hebrew: the native-script lemma (λόγος, מֶלֶךְ). Parts: with hyphen (-ak, ἀ-, הַ־).
     */
    headword: text("headword").notNull(),
    homonymIndex: integer("homonym_index").notNull().default(1),
    /** Cuneiform / pointed Hebrew / polytonic Greek rendering. */
    nativeScript: text("native_script"),
    /** Romanisation (lógos, meleḵ). */
    transliteration: text("transliteration"),
    /** Diacritic- and separator-insensitive key, see normalize.ts. */
    searchKey: text("search_key").notNull(),
    partOfSpeech: partOfSpeechEnum("part_of_speech"),
    /** One-line English gloss. */
    gloss: text("gloss").notNull(),
    /** Attestation count in the source corpora when known (ePSD2 icount); used to rank search results. */
    frequency: integer("frequency"),
    definition: text("definition"),
    etymology: text("etymology"),
    notes: text("notes"),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
    /** Reference inside the source, e.g. the ePSD2 citation form "lugal[king]". */
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("entries_lang_kind_headword_homonym_uq").on(
      t.languageId,
      t.kind,
      t.headword,
      t.homonymIndex
    ),
    index("entries_language_idx").on(t.languageId),
    index("entries_search_key_idx").on(t.searchKey),
    index("entries_gloss_idx").on(t.gloss),
    index("entries_source_ref_idx").on(t.sourceId, t.sourceRef),
  ]
)

/** Ordered meanings of an entry. */
export const senses = pgTable(
  "senses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    gloss: text("gloss").notNull(),
    definition: text("definition"),
    /** Semantic domain, e.g. "kinship", "religion", "administration". */
    domain: text("domain"),
  },
  (t) => [index("senses_entry_idx").on(t.entryId)]
)

/**
 * Composition: which entries (words *or* parts) make up another entry.
 *   lugal      = lu₂ + gal
 *   nam-lugal  = nam- + lugal
 *   δημοκρατία = δῆμος + κράτος + -ία
 */
export const entryComponents = pgTable(
  "entry_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The compound / derived entry. */
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    /** The component (a word or a part). */
    componentId: uuid("component_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Free-form role: head, modifier, affix, determinative … */
    role: text("role"),
    note: text("note"),
  },
  (t) => [
    unique("entry_components_entry_position_uq").on(t.entryId, t.position),
    index("entry_components_component_idx").on(t.componentId),
  ]
)

/** Typed links between entries, within or across languages. */
export const entryRelations = pgTable(
  "entry_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromEntryId: uuid("from_entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    toEntryId: uuid("to_entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    type: relationTypeEnum("type").notNull(),
    confidence: confidenceEnum("confidence").notNull().default("likely"),
    note: text("note"),
  },
  (t) => [
    unique("entry_relations_from_to_type_uq").on(t.fromEntryId, t.toEntryId, t.type),
    index("entry_relations_to_idx").on(t.toEntryId),
  ]
)

/* ──────────────────────────────────────────────────────────────────────────
 * Cuneiform signs (from the Oracc Sign List) and their readings
 * ────────────────────────────────────────────────────────────────────────── */

export type SignLink = { label: string; url: string }

export const signs = pgTable(
  "signs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Oracc sign name: LUGAL, |SAL.TUG₂|, LAK-025, LUGAL@g … */
    name: text("name").notNull(),
    /** Oracc object id (o0000434) — the stable identifier. */
    oid: text("oid"),
    /** The glyph(s): one code point for simple signs, several for compounds (|PA.TE.SI| → 𒉺𒋼𒋛). Null when not encoded. */
    unicode: text("unicode"),
    /** Every code point Unicode offers for this sign, e.g. ["U+12157", "U+12187"]. */
    codepoints: text("codepoints").array(),
    unicodeName: text("unicode_name"),
    unicodeVersion: text("unicode_version"),
    /** A variant form (@form) of another sign. */
    isForm: boolean("is_form").notNull().default(false),
    parentId: uuid("parent_id").references((): AnyPgColumn => signs.id, { onDelete: "set null" }),
    /** Alternative names (@aka). */
    aliases: text("aliases").array(),
    /** Sign-list numbers: { MZL: ["266"], ABZ: ["151"], LAK: ["165"] … }. */
    listNumbers: jsonb("list_numbers").$type<Record<string, string[]>>(),
    links: jsonb("links").$type<SignLink[]>(),
    notes: text("notes"),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("signs_name_uq").on(t.name),
    index("signs_unicode_idx").on(t.unicode),
    index("signs_parent_idx").on(t.parentId),
  ]
)

/** A reading (value) of a sign: lugal, aŋ₂, %akk šarru … */
export const signReadings = pgTable(
  "sign_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signId: uuid("sign_id")
      .notNull()
      .references(() => signs.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    /** Language the value belongs to when the sign list says so (akk, elx, …); null = Sumerian / general. */
    language: text("language"),
    /** Normalised key, see normalize.ts — lets "ag2" find aŋ₂. */
    searchKey: text("search_key").notNull(),
    isUncertain: boolean("is_uncertain").notNull().default(false),
    isDeprecated: boolean("is_deprecated").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("sign_readings_sign_value_uq").on(t.signId, t.value),
    index("sign_readings_value_idx").on(t.value),
    index("sign_readings_search_key_idx").on(t.searchKey),
  ]
)

/* ──────────────────────────────────────────────────────────────────────────
 * Relations (for db.query.* relational queries)
 * ────────────────────────────────────────────────────────────────────────── */

export const languagesRelations = relations(languages, ({ many }) => ({
  entries: many(entries),
}))

export const sourcesRelations = relations(sources, ({ many }) => ({
  entries: many(entries),
}))

export const entriesRelations = relations(entries, ({ one, many }) => ({
  language: one(languages, { fields: [entries.languageId], references: [languages.id] }),
  source: one(sources, { fields: [entries.sourceId], references: [sources.id] }),
  senses: many(senses),
  /** Parts this entry is built from. */
  components: many(entryComponents, { relationName: "compound" }),
  /** Entries this entry is a part of. */
  usedIn: many(entryComponents, { relationName: "component" }),
  relationsFrom: many(entryRelations, { relationName: "from" }),
  relationsTo: many(entryRelations, { relationName: "to" }),
}))

export const sensesRelations = relations(senses, ({ one }) => ({
  entry: one(entries, { fields: [senses.entryId], references: [entries.id] }),
}))

export const entryComponentsRelations = relations(entryComponents, ({ one }) => ({
  entry: one(entries, {
    fields: [entryComponents.entryId],
    references: [entries.id],
    relationName: "compound",
  }),
  component: one(entries, {
    fields: [entryComponents.componentId],
    references: [entries.id],
    relationName: "component",
  }),
}))

export const entryRelationsRelations = relations(entryRelations, ({ one }) => ({
  from: one(entries, {
    fields: [entryRelations.fromEntryId],
    references: [entries.id],
    relationName: "from",
  }),
  to: one(entries, {
    fields: [entryRelations.toEntryId],
    references: [entries.id],
    relationName: "to",
  }),
}))

export const signsRelations = relations(signs, ({ one, many }) => ({
  readings: many(signReadings),
  parent: one(signs, { fields: [signs.parentId], references: [signs.id], relationName: "forms" }),
  forms: many(signs, { relationName: "forms" }),
  source: one(sources, { fields: [signs.sourceId], references: [sources.id] }),
}))

export const signReadingsRelations = relations(signReadings, ({ one }) => ({
  sign: one(signs, { fields: [signReadings.signId], references: [signs.id] }),
}))

/* ──────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────── */

export type Language = typeof languages.$inferSelect
export type NewLanguage = typeof languages.$inferInsert
export type Source = typeof sources.$inferSelect
export type NewSource = typeof sources.$inferInsert
export type Entry = typeof entries.$inferSelect
export type NewEntry = typeof entries.$inferInsert
export type Sense = typeof senses.$inferSelect
export type NewSense = typeof senses.$inferInsert
export type EntryComponent = typeof entryComponents.$inferSelect
export type EntryRelation = typeof entryRelations.$inferSelect
export type Sign = typeof signs.$inferSelect
export type NewSign = typeof signs.$inferInsert
export type SignReading = typeof signReadings.$inferSelect
export type NewSignReading = typeof signReadings.$inferInsert

export type EntryKind = (typeof entryKindEnum.enumValues)[number]
export type PartKind = (typeof partKindEnum.enumValues)[number]
export type PartOfSpeech = (typeof partOfSpeechEnum.enumValues)[number]
export type RelationType = (typeof relationTypeEnum.enumValues)[number]
export type Confidence = (typeof confidenceEnum.enumValues)[number]

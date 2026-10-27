import type { EntryKind, PartKind, PartOfSpeech, RelationType } from "@workspace/db"

export const POS_LABEL: Record<PartOfSpeech, string> = {
  noun: "noun",
  proper_noun: "proper noun",
  verb: "verb",
  adjective: "adjective",
  adverb: "adverb",
  pronoun: "pronoun",
  numeral: "numeral",
  preposition: "preposition",
  postposition: "postposition",
  conjunction: "conjunction",
  particle: "particle",
  interjection: "interjection",
  determiner: "determiner",
  other: "other",
}

export const PART_KIND_LABEL: Record<PartKind, string> = {
  root: "root",
  stem: "stem",
  prefix: "prefix",
  suffix: "suffix",
  infix: "infix",
  clitic: "clitic",
  particle: "particle",
  pattern: "pattern",
  determinative: "determinative",
  sign: "sign",
  numeral: "numeral",
}

export const KIND_LABEL: Record<EntryKind, string> = { word: "word", part: "word part" }

/** Labels for a relation as seen from the entry that carries it (`from`) … */
export const RELATION_FROM_LABEL: Record<RelationType, string> = {
  loan_from: "Borrowed from",
  cognate_of: "Cognate with",
  derived_from: "Derived from",
  variant_of: "Variant of",
  synonym_of: "Synonym of",
  antonym_of: "Antonym of",
  equivalent_of: "Translation equivalent of",
  see_also: "See also",
}

/** … and as seen from the other side (`to`). */
export const RELATION_TO_LABEL: Record<RelationType, string> = {
  loan_from: "Borrowed into",
  cognate_of: "Cognate with",
  derived_from: "Source of",
  variant_of: "Has variant",
  synonym_of: "Synonym of",
  antonym_of: "Antonym of",
  equivalent_of: "Translation equivalent of",
  see_also: "See also",
}

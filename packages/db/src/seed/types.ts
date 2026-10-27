import type {
  Confidence,
  EntryKind,
  NewLanguage,
  NewSource,
  PartKind,
  PartOfSpeech,
  RelationType,
} from "../schema"

export type SeedSense = { gloss: string; definition?: string; domain?: string }

/**
 * A component reference, resolved inside the same language:
 *   "lu₂"         → the word  lu₂
 *   "part:nam-"   → the part  nam-
 *   "a#2"         → the word  a, homonym 2
 */
export type SeedComponent = string | { ref: string; role?: string; note?: string }

export type SeedEntryBase = {
  headword: string
  /** Cuneiform / pointed Hebrew / polytonic Greek. */
  native?: string
  /** Romanisation, when the headword is not already Latin-script. */
  translit?: string
  homonym?: number
  pos?: PartOfSpeech
  gloss: string
  definition?: string
  etymology?: string
  notes?: string
  /** Citation inside the dataset's source (e.g. ePSD2 "lugal[king]"). */
  ref?: string
  senses?: (string | SeedSense)[]
  parts?: SeedComponent[]
}

export type SeedWord = SeedEntryBase & { kind: "word" }
export type SeedPart = SeedEntryBase & { kind: "part"; partKind: PartKind }
export type SeedEntry = SeedWord | SeedPart

export type SeedDataset = {
  language: NewLanguage
  source: NewSource
  entries: SeedEntry[]
}

export type EntryRef = { lang: string; headword: string; kind?: EntryKind; homonym?: number }

export type SeedRelation = {
  from: EntryRef
  to: EntryRef
  type: RelationType
  confidence?: Confidence
  note?: string
}

/* Small helpers that keep the data files readable. */

export function word(
  headword: string,
  gloss: string,
  opts: Omit<SeedEntryBase, "headword" | "gloss"> = {}
): SeedWord {
  return { kind: "word", headword, gloss, ...opts }
}

export function part(
  headword: string,
  partKind: PartKind,
  gloss: string,
  opts: Omit<SeedEntryBase, "headword" | "gloss"> = {}
): SeedPart {
  return { kind: "part", partKind, headword, gloss, ...opts }
}

export function ref(lang: string, headword: string, extra: Partial<EntryRef> = {}): EntryRef {
  return { lang, headword, ...extra }
}

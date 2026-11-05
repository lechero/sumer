import type { Entry } from "@workspace/db"

import { Chip, type ChipTone } from "@/components/chip"
import { KIND_LABEL, PART_KIND_LABEL, POS_LABEL } from "@/lib/labels"

const PART_TONE: Partial<Record<NonNullable<Entry["partKind"]>, ChipTone>> = {
  root: "amber",
  determinative: "rose",
  sign: "rose",
  numeral: "rose",
}

export function KindBadge({ entry }: { entry: Pick<Entry, "kind" | "partKind"> }) {
  if (entry.kind === "part") {
    return <Chip tone={(entry.partKind && PART_TONE[entry.partKind]) || "violet"}>{entry.partKind ? PART_KIND_LABEL[entry.partKind] : KIND_LABEL.part}</Chip>
  }
  return <Chip tone="muted">{KIND_LABEL.word}</Chip>
}

export function PosBadge({ pos }: { pos: Entry["partOfSpeech"] }) {
  if (!pos) return null
  return <Chip tone={pos === "proper_noun" ? "amber" : pos === "verb" ? "mint" : "sky"}>{POS_LABEL[pos]}</Chip>
}

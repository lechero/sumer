import { Badge } from "@workspace/ui/components/badge"
import type { Entry } from "@workspace/db"

import { KIND_LABEL, PART_KIND_LABEL, POS_LABEL } from "@/lib/labels"

export function KindBadge({ entry }: { entry: Pick<Entry, "kind" | "partKind"> }) {
  if (entry.kind === "part") {
    return <Badge variant="secondary">{entry.partKind ? PART_KIND_LABEL[entry.partKind] : KIND_LABEL.part}</Badge>
  }
  return <Badge variant="outline">{KIND_LABEL.word}</Badge>
}

export function PosBadge({ pos }: { pos: Entry["partOfSpeech"] }) {
  if (!pos) return null
  return <Badge variant="outline">{POS_LABEL[pos]}</Badge>
}

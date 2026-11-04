import { getGlyphBreakdowns, type BreakdownInput, type Database, type SpellingPart } from "@workspace/db"

export type Breakdowns = Map<string, SpellingPart[]>

/** Sign-by-sign breakdowns for the cuneiform rows of an entry list. */
export function cuneiformBreakdowns(db: Database, rows: (BreakdownInput & { language: { script: string } })[]): Promise<Breakdowns> {
  return getGlyphBreakdowns(db, rows.filter((r) => r.language.script === "Xsux"))
}

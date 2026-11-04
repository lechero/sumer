import type { Database } from "@workspace/db"

export type ImporterContext = {
  db: Database
  log: (message: string) => void
  /** Only load the first N entries (quick runs). */
  limit?: number
  /** Never download; fail if the raw data is not cached. */
  offline: boolean
  /** Delete rows of the source that the data no longer contains. */
  prune: boolean
}

export type Importer = {
  id: string
  /** ISO 639-3 of the language it populates (or "*" for several). */
  language: string
  description: string
  /** Only run when named explicitly; `--all` skips it (e.g. the per-language parts of a group importer). */
  explicitOnly?: boolean
  /** In `--all`, run after every other importer (e.g. cross-language link builders). */
  runLast?: boolean
  run: (ctx: ImporterContext) => Promise<void>
}

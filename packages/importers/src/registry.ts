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
  run: (ctx: ImporterContext) => Promise<void>
}

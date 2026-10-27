import { existsSync } from "node:fs"
import path from "node:path"
import { config as loadDotenv } from "dotenv"

/**
 * Walk up from `start` until a directory containing `pnpm-workspace.yaml` is found.
 * Works from the repo root, from `apps/web` (Next.js) and from `packages/db` (scripts).
 */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  // turbopackIgnore: this walk is deliberate; without it Turbopack traces the whole repo into the server bundle.
  let dir = path.resolve(/* turbopackIgnore: true */ start)
  for (;;) {
    if (existsSync(/* turbopackIgnore: true */ path.join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(/* turbopackIgnore: true */ start)
    dir = parent
  }
}

let envLoaded = false

/** Load the repo-root `.env` (and `.env.local`) once. Existing process.env values win. */
export function loadEnv(): void {
  if (envLoaded) return
  envLoaded = true
  const root = findWorkspaceRoot()
  for (const file of [".env.local", ".env"]) {
    const full = path.join(/* turbopackIgnore: true */ root, file)
    if (existsSync(/* turbopackIgnore: true */ full)) loadDotenv({ path: full, override: false, quiet: true })
  }
}

export type DatabaseInfo =
  | { driver: "postgres"; target: string }
  | { driver: "pglite"; target: string }

/**
 * Decide which database to talk to.
 *  - `DATABASE_URL` set  → Postgres (docker compose in dev).
 *  - otherwise           → embedded PGlite stored in `<repo>/.pglite` (zero setup).
 */
export function getDatabaseInfo(): DatabaseInfo {
  loadEnv()
  const url = process.env.DATABASE_URL?.trim()
  if (url) return { driver: "postgres", target: url }
  const dir = process.env.PGLITE_DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ findWorkspaceRoot(), ".pglite")
  return { driver: "pglite", target: dir }
}

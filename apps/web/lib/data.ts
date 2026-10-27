import { getDb, type Database } from "@workspace/db"

export type DbResult<T> =
  | { ok: true; data: T }
  | { ok: false; title: string; hint: string; detail: string }

/**
 * Run a query and turn infrastructure failures (no Postgres running, no
 * migrations yet) into a friendly, renderable result instead of a crash.
 */
export async function withDb<T>(fn: (db: Database) => Promise<T>): Promise<DbResult<T>> {
  try {
    return { ok: true, data: await fn(getDb()) }
  } catch (err) {
    return { ok: false, ...describeDbError(err) }
  }
}

function describeDbError(err: unknown) {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = e?.code ?? e?.cause?.code ?? ""
  const detail = e?.message ?? e?.cause?.message ?? String(err)

  if (code === "42P01" || /relation .* does not exist/i.test(detail)) {
    return {
      title: "The database schema has not been created yet.",
      hint: "Run `pnpm db:setup` (migrations + seed data), then reload this page.",
      detail,
    }
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || /ECONNREFUSED|ENOTFOUND|connect/i.test(detail)) {
    return {
      title: "Could not connect to Postgres.",
      hint: "Start it with `docker compose up -d` — or remove DATABASE_URL from .env to use the embedded PGlite database.",
      detail,
    }
  }
  if (code === "3D000") {
    return { title: "The database does not exist.", hint: "Check POSTGRES_DB / DATABASE_URL in .env, then `docker compose up -d`.", detail }
  }
  if (code === "28P01" || code === "28000") {
    return { title: "Postgres rejected the credentials.", hint: "Check POSTGRES_USER / POSTGRES_PASSWORD / DATABASE_URL in .env.", detail }
  }
  return { title: "Database error.", hint: "Check DATABASE_URL in .env and the server log.", detail }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

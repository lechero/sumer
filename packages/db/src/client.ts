import { PGlite } from "@electric-sql/pglite"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite"
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { getDatabaseInfo, type DatabaseInfo } from "./env"
import * as schema from "./schema"

export type Schema = typeof schema

/** Driver-agnostic database type used by the app and the shared queries. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>

export type DatabaseHandle =
  | {
      driver: "postgres"
      info: DatabaseInfo
      db: PostgresJsDatabase<Schema>
      close: () => Promise<void>
    }
  | {
      driver: "pglite"
      info: DatabaseInfo
      db: PgliteDatabase<Schema>
      close: () => Promise<void>
    }

// Cached on globalThis so Next.js hot reloads reuse one connection pool / one PGlite instance.
const globalRef = globalThis as unknown as { __sumerDbHandle?: DatabaseHandle }

/** Open (or reuse) the database chosen by the environment. */
export function openDatabase(): DatabaseHandle {
  if (globalRef.__sumerDbHandle) return globalRef.__sumerDbHandle

  const info = getDatabaseInfo()
  let handle: DatabaseHandle

  if (info.driver === "postgres") {
    const sql = postgres(info.target, { max: 10, onnotice: () => {} })
    handle = {
      driver: "postgres",
      info,
      db: drizzlePostgres(sql, { schema }),
      close: () => sql.end({ timeout: 5 }),
    }
  } else {
    const client = new PGlite(info.target)
    handle = {
      driver: "pglite",
      info,
      db: drizzlePglite(client, { schema }),
      close: () => client.close(),
    }
  }

  globalRef.__sumerDbHandle = handle
  return handle
}

/** The Drizzle database instance (Postgres via docker, or embedded PGlite). */
export function getDb(): Database {
  return openDatabase().db as unknown as Database
}

export async function closeDatabase(): Promise<void> {
  const handle = globalRef.__sumerDbHandle
  if (!handle) return
  globalRef.__sumerDbHandle = undefined
  await handle.close()
}

import path from "node:path"
import { fileURLToPath } from "node:url"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator"

import { closeDatabase, openDatabase } from "./client"

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle")

async function main() {
  const handle = openDatabase()
  console.log(`[db] migrate  driver=${handle.driver}  target=${handle.info.target}`)
  if (handle.driver === "postgres") {
    await migratePostgres(handle.db, { migrationsFolder })
  } else {
    await migratePglite(handle.db, { migrationsFolder })
  }
  console.log("[db] migrations applied")
}

main()
  .catch((err) => {
    console.error("[db] migration failed:", err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())

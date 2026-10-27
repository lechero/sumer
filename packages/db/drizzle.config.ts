import { defineConfig } from "drizzle-kit"
import { getDatabaseInfo } from "./src/env"

const info = getDatabaseInfo()

// `drizzle-kit generate` only needs the schema. `drizzle-kit studio` / `push`
// connect to whatever the environment points at (Postgres, or the local PGlite dir).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  ...(info.driver === "postgres"
    ? { dbCredentials: { url: info.target } }
    : { driver: "pglite", dbCredentials: { url: info.target } }),
})

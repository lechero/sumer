/**
 * Hand-curated base data. Re-runnable and safe to run before or after the
 * importers: the Sumerian seed merges with ePSD2 by citation form, the others
 * adopt whatever row already exists for the headword and only fill gaps.
 */
import { closeDatabase, openDatabase, type Database } from "../client"
import { akkadian } from "./data/akkadian"
import { greek } from "./data/greek"
import { hebrew } from "./data/hebrew"
import { relations as crossRelations } from "./data/relations"
import { sumerian } from "./data/sumerian"
import { upsertDataset, upsertRelations } from "./upsert"

/** Sumerian words merge with ePSD2 by citation form; the grammatical parts are a layer of their own. */
const sumerianParts = {
  ...sumerian,
  source: {
    id: "seed-sux",
    title: "Hand-curated Sumerian grammar (affixes, clitics, determinatives)",
    url: null,
    license: "CC0",
    citation: "Compiled for this dictionary after Jagersma (2010), A Descriptive Grammar of Sumerian, and ePSD2.",
  },
  mergeMode: "fill" as const,
  entries: sumerian.entries.filter((e) => e.kind === "part"),
}
const sumerianWords = { ...sumerian, entries: sumerian.entries.filter((e) => e.kind === "word") }

export const datasets = [sumerianParts, sumerianWords, akkadian, greek, hebrew]

async function main() {
  const handle = openDatabase()
  const db = handle.db as unknown as Database
  console.log(`[seed] driver=${handle.driver}  target=${handle.info.target}`)
  const idByKey = new Map<string, string>()
  for (const ds of datasets) {
    const result = await upsertDataset(db, ds, { log: (m) => console.log(`[seed] ${m}`), keepExisting: true })
    for (const [k, v] of result.idByKey) idByKey.set(k, v)
  }
  const n = await upsertRelations(db, crossRelations, idByKey, { log: (m) => console.log(`[seed] ${m}`) })
  console.log(`[seed] done: ${idByKey.size} entries, ${n} relations`)
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())

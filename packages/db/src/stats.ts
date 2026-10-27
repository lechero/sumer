/** Print what is in the database: counts per language and a few sample searches. */
import { closeDatabase, getDb } from "./client"
import { normalizeForSearch } from "./normalize"
import { countEntries, listEntries, listLanguages } from "./queries"

async function main() {
  const db = getDb()
  const languages = await listLanguages(db)
  const totals = await countEntries(db)

  console.log("languages:")
  for (const l of languages) {
    console.log(`  ${l.id.padEnd(4)} ${l.name.padEnd(16)} ${String(l.wordCount).padStart(4)} words  ${String(l.partCount).padStart(4)} parts`)
  }
  console.log(`total: ${totals.total} entries (${totals.words} words, ${totals.parts} parts)\n`)

  const samples = ["king", "lugal", "𒈗", "e2-gal", "egal", "šeš", "ses", "λόγος", "logos", "שלום", "shalom", "-ak", "nam-"]
  console.log("sample searches:")
  for (const q of samples) {
    const { rows, total } = await listEntries(db, { q, limit: 5 })
    const hits = rows.map((r) => `${r.language.id}:${r.headword}`).join(", ")
    console.log(`  ${q.padEnd(10)} → key ${normalizeForSearch(q).padEnd(10)} ${String(total).padStart(3)} hit(s)  ${hits}${total > 5 ? ", …" : ""}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())

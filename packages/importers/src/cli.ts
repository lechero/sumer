/**
 * pnpm run import <source...> [--limit N] [--offline] [--prune] [--all]
 */
import { closeDatabase, openDatabase, type Database } from "@workspace/db"

import { logger } from "./lib/log"
import type { Importer } from "./registry"
import { eblImporter } from "./sources/ebl"
import { epsd2Importer } from "./sources/epsd2"
import { copticImporter } from "./sources/coptic"
import { lewisShortImporter } from "./sources/lewis-short"
import { monierWilliamsImporter } from "./sources/monier-williams"
import { dpdImporter } from "./sources/dpd"
import { bosworthTollerImporter } from "./sources/bosworth-toller"
import { zoegaImporter } from "./sources/zoega"
import { lsjImporter } from "./sources/lsj"
import { oshbImporter } from "./sources/oshb"
import { alphabetsImporter } from "./sources/alphabets"
import { oslImporter } from "./sources/osl"
import { pcslImporter } from "./sources/pcsl"
import { tlaEgyptianImporter } from "./sources/tla-egyptian"
import { unikemetImporter } from "./sources/unikemet"
import { wiktionaryImporters } from "./sources/wiktionary"

// `--all` runs these in order, then the `runLast` ones (wiktionary: it enriches the dictionaries above and links them).
const importers: Importer[] = [
  oslImporter,
  pcslImporter,
  unikemetImporter,
  alphabetsImporter,
  eblImporter, // before epsd2: its Akkadian equivalents link to the eBL entries
  epsd2Importer,
  oshbImporter,
  lsjImporter,
  lewisShortImporter,
  monierWilliamsImporter,
  dpdImporter,
  bosworthTollerImporter,
  zoegaImporter,
  tlaEgyptianImporter,
  copticImporter,
  ...wiktionaryImporters,
]

function usage(): never {
  console.log("usage: pnpm run import <source...> [--limit N] [--offline] [--prune] [--all]\n\nsources:")
  for (const i of importers) console.log(`  ${i.id.padEnd(10)} ${i.language.padEnd(4)} ${i.description}`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")))
  const limitArg = args.find((a) => a.startsWith("--limit"))
  // `--limit=N` or `--limit N`; in the second form N is not a source name.
  const limitValueAt = limitArg && !limitArg.includes("=") ? args.indexOf(limitArg) + 1 : -1
  const limit = limitArg ? Number(limitArg.split("=")[1] ?? args[limitValueAt]) : undefined
  const names = args.filter((a, i) => !a.startsWith("--") && i !== limitValueAt)
  const everything = importers.filter((i) => !i.explicitOnly)
  const selected = flags.has("--all")
    ? [...everything.filter((i) => !i.runLast), ...everything.filter((i) => i.runLast)]
    : importers.filter((i) => names.includes(i.id))
  if (!selected.length) usage()
  const unknown = names.filter((n) => !importers.some((i) => i.id === n))
  if (unknown.length) {
    console.error(`unknown source(s): ${unknown.join(", ")}`)
    usage()
  }

  const handle = openDatabase()
  const db = handle.db as unknown as Database
  console.log(`[import] driver=${handle.driver}  target=${handle.info.target}`)
  for (const imp of selected) {
    const started = Date.now()
    await imp.run({ db, log: logger(imp.id), limit, offline: flags.has("--offline"), prune: flags.has("--prune") })
    console.log(`[import] ${imp.id} finished in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }
}

main()
  .catch((err) => {
    console.error("[import] failed:", err)
    process.exitCode = 1
  })
  .finally(() => closeDatabase())

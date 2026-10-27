/**
 * pnpm import <source...> [--limit N] [--offline] [--prune] [--all]
 */
import { closeDatabase, openDatabase, type Database } from "@workspace/db"

import { logger } from "./lib/log"
import type { Importer } from "./registry"
import { eblImporter } from "./sources/ebl"
import { epsd2Importer } from "./sources/epsd2"
import { lsjImporter } from "./sources/lsj"
import { oshbImporter } from "./sources/oshb"
import { oslImporter } from "./sources/osl"

const importers: Importer[] = [oslImporter, epsd2Importer, eblImporter, oshbImporter, lsjImporter]

function usage(): never {
  console.log("usage: pnpm import <source...> [--limit N] [--offline] [--prune] [--all]\n\nsources:")
  for (const i of importers) console.log(`  ${i.id.padEnd(10)} ${i.language.padEnd(4)} ${i.description}`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith("--") && !a.includes("=")))
  const limitArg = args.find((a) => a.startsWith("--limit"))
  const limit = limitArg ? Number(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1]) : undefined
  const names = args.filter((a) => !a.startsWith("--") && !(limitArg && a === args[args.indexOf(limitArg) + 1]))
  const selected = flags.has("--all") ? importers : importers.filter((i) => names.includes(i.id))
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

/** pnpm --filter @workspace/importers render "e2-gal" "{d}en-lil2" … */
import { closeDatabase, getDb } from "@workspace/db"

import { loadReadingMap, renderCuneiform } from "../lib/cuneiform"

async function main() {
  const map = await loadReadingMap(getDb())
  for (const arg of process.argv.slice(2)) {
    console.log(`${arg.padEnd(24)} → ${renderCuneiform(arg, map) ?? "(unknown sign)"}`)
  }
}
main().finally(() => closeDatabase())

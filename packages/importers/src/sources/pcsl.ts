/**
 * Proto-Cuneiform Sign List (Oracc PCSL, CC0): the ~2,200 signs of the Uruk IV
 * and III tablets (c. 3350–2900 BCE), with ZATU numbers and the code points of
 * the 2025 encoding proposal (Oracc's PC24 encoding: U+12550–12BFF, plus PUA).
 * Same ASL format as the Oracc Sign List, so it shares its parser.
 *   https://github.com/oracc/pcsl (00lib/pcsl.asl)
 */
import { download, readCached } from "../lib/cache"
import type { Importer } from "../registry"
import { importAslSigns, parseAsl } from "./osl"

export const PCSL_URL = "https://raw.githubusercontent.com/oracc/pcsl/main/00lib/pcsl.asl"

export const pcslSource = {
  id: "pcsl",
  title: "Proto-Cuneiform Sign List (PCSL)",
  url: "https://oracc.museum.upenn.edu/pcsl/",
  license: "CC0 1.0 (public domain)",
  citation:
    "Proto-Cuneiform Sign List, ed. Steve Tinney, after the CDLI proto-cuneiform sign list and Anshuman Pandey's fonts, https://github.com/oracc/pcsl",
}

export const pcslImporter: Importer = {
  id: "pcsl",
  language: "*",
  description: "Proto-Cuneiform Sign List → the signs of the Uruk IV–III tablets with ZATU numbers",
  async run({ db, log, limit, offline }) {
    const file = await download("pcsl", "pcsl.asl", PCSL_URL, { offline, log })
    await importAslSigns({ db, log, scriptId: "proto-cuneiform", source: pcslSource, parsed: parseAsl(await readCached(file)), limit })
  },
}

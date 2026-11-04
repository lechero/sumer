import { isCuneiformCodePoint } from "@workspace/db/glyphs"

import { isDrawableCodePoint } from "@/lib/cuneiform-coverage"
import { scriptDraws } from "@/lib/script-coverage"

/** Font utility (packages/ui globals.css) per ISO 15924 code, as stored in `languages.script` / `scripts.iso15924`. */
export const ISO_FONT_CLASS: Record<string, string> = {
  Xsux: "font-cuneiform",
  Egyp: "font-egyptian",
  Ugar: "font-ugaritic",
  Phnx: "font-phoenician",
  Armi: "font-aramaic",
  Syrc: "font-syriac",
  Sarb: "font-south-arabian",
  Xpeo: "font-old-persian",
  Hluw: "font-anatolian",
  Lina: "font-linear-a",
  Linb: "font-linear-b",
  Cprt: "font-cypriot",
  Ital: "font-old-italic",
  Copt: "font-coptic",
  Goth: "font-gothic",
  Runr: "font-runic",
  Ogam: "font-ogham",
  Hebr: "font-hebrew",
  Grek: "font-greek",
}

/** Font utility per sign-browser script id (`scripts.id`). */
const SCRIPT_FONT_CLASS: Record<string, string> = {
  cuneiform: "font-cuneiform",
  "proto-cuneiform": "font-proto-cuneiform",
  "egyptian-hieroglyphs": "font-egyptian",
  ugaritic: "font-ugaritic",
  phoenician: "font-phoenician",
  hebrew: "font-hebrew",
  "imperial-aramaic": "font-aramaic",
  syriac: "font-syriac",
  "old-south-arabian": "font-south-arabian",
  "old-persian": "font-old-persian",
  "anatolian-hieroglyphs": "font-anatolian",
  "linear-a": "font-linear-a",
  "linear-b": "font-linear-b",
  cypriot: "font-cypriot",
  greek: "font-greek",
  "old-italic": "font-old-italic",
  coptic: "font-coptic",
  gothic: "font-gothic",
  runic: "font-runic",
  ogham: "font-ogham",
}

export function scriptFontClass(script: string): string {
  return SCRIPT_FONT_CLASS[script] ?? ISO_FONT_CLASS[script] ?? ""
}

/** Scripts whose signs stand for words, so a sign page lists the dictionary words written with it. */
export const WORD_SIGN_SCRIPTS = new Set(["cuneiform", "egyptian-hieroglyphs"])

/** Scripts whose sign names are built from other signs (|A×EN|, AL@s); unencoded signs are drawn through them. */
export const COMPOSITE_SCRIPTS = new Set(["cuneiform", "proto-cuneiform"])

/** Whether the bundled fonts draw a code point of the given script (false means "show a fallback"). */
export function codePointDrawable(script: string, cp: number): boolean {
  if (script === "cuneiform") return !isCuneiformCodePoint(cp) || isDrawableCodePoint(cp)
  if (script === "proto-cuneiform") return !isCuneiformCodePoint(cp) || scriptDraws("proto-cuneiform", cp)
  if (script === "egyptian-hieroglyphs") return scriptDraws("egyptian", cp)
  return true
}

export function scriptHref(script: string) {
  return `/scripts/${encodeURIComponent(script)}`
}

export function signHref(script: string, name: string) {
  return `/scripts/${encodeURIComponent(script)}/${encodeURIComponent(name)}`
}

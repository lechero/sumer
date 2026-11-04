import Link from "next/link"
import { cuneiformGlyphs, isHieroglyphCodePoint } from "@workspace/db/glyphs"

import { scriptFontClass, signHref } from "@/lib/scripts"

type SignRef = { id: string; name: string; unicode: string | null }

/** The glyphs of a text in a script with a sign list: cuneiform (with variation selectors) or hieroglyphs. */
function glyphsOf(text: string, script: string): string[] {
  if (script === "egyptian-hieroglyphs") return [...text].filter((ch) => isHieroglyphCodePoint(ch.codePointAt(0) ?? 0))
  return cuneiformGlyphs(text)
}

/** Each glyph of a cuneiform or hieroglyphic string, linked to its sign page. */
export function GlyphBreakdown({
  text,
  signsByGlyph,
  script = "cuneiform",
}: {
  text: string
  signsByGlyph: Map<string, SignRef>
  script?: string
}) {
  const glyphs = glyphsOf(text, script)
  if (!glyphs.length) return null
  return (
    <ol className="flex flex-wrap gap-2">
      {glyphs.map((g, i) => {
        const cp = g.codePointAt(0) ?? 0
        const sign = signsByGlyph.get(String.fromCodePoint(cp))
        const inner = (
          <>
            <span className={`${scriptFontClass(script)} text-3xl leading-none`}>{g}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{sign?.name ?? `U+${cp.toString(16).toUpperCase()}`}</span>
          </>
        )
        return (
          <li key={`${g}-${i}`}>
            {sign ? (
              <Link href={signHref(script, sign.name)} className="flex flex-col items-center gap-1 rounded-md border px-3 py-2 hover:bg-muted">
                {inner}
              </Link>
            ) : (
              <span className="flex flex-col items-center gap-1 rounded-md border px-3 py-2 opacity-70">{inner}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

import Link from "next/link"
import { cuneiformGlyphs } from "@workspace/db/glyphs"

import { signHref } from "@/components/sign-tile"

type SignRef = { id: string; name: string; unicode: string | null }

/** Each cuneiform glyph of a string, linked to its sign page. */
export function GlyphBreakdown({ text, signsByGlyph }: { text: string; signsByGlyph: Map<string, SignRef> }) {
  const glyphs = cuneiformGlyphs(text)
  if (!glyphs.length) return null
  return (
    <ol className="flex flex-wrap gap-2">
      {glyphs.map((g, i) => {
        const cp = g.codePointAt(0) ?? 0
        const sign = signsByGlyph.get(String.fromCodePoint(cp))
        const inner = (
          <>
            <span className="font-cuneiform text-3xl leading-none">{g}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{sign?.name ?? `U+${cp.toString(16).toUpperCase()}`}</span>
          </>
        )
        return (
          <li key={`${g}-${i}`}>
            {sign ? (
              <Link href={signHref(sign.name)} className="flex flex-col items-center gap-1 rounded-md border px-3 py-2 hover:bg-muted">
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

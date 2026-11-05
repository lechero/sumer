import Link from "next/link"
import type { LetterBreakdown as LetterBreakdownData, LetterPiece } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { scriptFontClass, signHref } from "@/lib/scripts"

const isMark = (s: string) => /^\p{M}+$/u.test(s)

/** "VOWEL SIGN VOCALIC R" → "vowel sign vocalic r": sign names read better in lower case. */
const label = (name: string) => (/^[A-Z0-9 -]+$/.test(name) ? name.toLowerCase() : name)

function Piece({ piece, script, font }: { piece: LetterPiece; script: string; font: string }) {
  const name = label(piece.name)
  return (
    <li className="flex min-w-0 items-baseline gap-1.5" title={piece.description ?? undefined}>
      <span className={cn(font, "w-5 shrink-0 text-center text-sm text-foreground")}>
        {/* a mark alone on a dotted circle, as type specimens show it */}
        {isMark(piece.glyph) ? `◌${piece.glyph}` : piece.glyph}
      </span>
      {piece.signName ? (
        <Link href={signHref(script, piece.signName)} className="min-w-0 truncate hover:text-violet">
          {name}
        </Link>
      ) : (
        <span className={cn("min-w-0 truncate", piece.kind === "mark" && "italic")}>{name}</span>
      )}
      {piece.value ? <span className="ml-auto shrink-0 pl-1 font-mono text-foreground">{piece.value}</span> : null}
    </li>
  )
}

/**
 * A word in an alphabet, abjad, abugida or syllabary, letter by letter: each letter with its
 * marks as a tile (the glyph large, its sound, then what each piece is), and the word's reading.
 */
export function LetterBreakdown({ data, direction = "ltr" }: { data: LetterBreakdownData; direction?: "ltr" | "rtl" }) {
  const font = scriptFontClass(data.script.id)
  const abugida = data.script.kind === "abugida"
  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl px-4 py-3">
        <span className="eyebrow">reads</span>
        <span className="font-mono text-lg font-semibold text-violet">{data.reading}</span>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {data.letters} {abugida ? "signs" : data.script.kind?.includes("syllab") ? "signs" : "letters"}
          {data.marks ? ` · ${data.marks} ${abugida ? "vowel signs and marks" : "marks"}` : ""} ·{" "}
          <Link href={`/scripts/${data.script.id}`} className="underline-offset-4 hover:text-foreground hover:underline">
            {data.script.name}
          </Link>
          {data.script.kind ? ` (${data.script.kind})` : ""}
        </span>
      </div>
      <div dir={direction} className="flex flex-wrap gap-x-8 gap-y-3">
        {data.words.map((word, w) => (
          <ol key={w} className="flex flex-wrap gap-2" aria-label={`Word ${w + 1}`}>
            {word.map((c, i) => (
              <li key={`${c.glyph}-${i}`} dir="ltr" className="glass lift group flex w-36 flex-col rounded-xl p-3">
                <span dir={direction} className={cn(font, "block text-center text-4xl leading-[1.35] text-amber transition-[text-shadow] group-hover:glyph-glow")}>
                  {c.glyph}
                </span>
                <span className="mt-0.5 text-center font-mono text-sm font-semibold text-violet">{c.value || "·"}</span>
                <ul className="mt-2 space-y-0.5 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
                  {c.pieces.map((p, j) => (
                    <Piece key={j} piece={p} script={data.script.id} font={font} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ))}
      </div>
      {data.truncated ? <p className="text-xs text-muted-foreground">The first 60 letters.</p> : null}
    </div>
  )
}

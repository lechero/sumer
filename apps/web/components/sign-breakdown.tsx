import Link from "next/link"
import type { SpellingPart } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { scriptFontClass, signHref } from "@/lib/scripts"

const CUNEIFORM = scriptFontClass("cuneiform")

/** How a token is written in the transliteration: {d} for determinatives, 3(diš) for numerals. */
function written(p: SpellingPart): string {
  return p.kind === "determinative" ? `{${p.text}}` : p.text
}

function role(p: SpellingPart): string | null {
  if (p.kind === "determinative") return "determinative"
  if (p.kind === "numeral") return `numeral ×${p.count}`
  return null
}

/** One-line summary for tooltips: "EN · lord; priest". */
function summary(p: SpellingPart): string {
  const meanings = p.meanings.map((m) => m.gloss).join("; ")
  return [`${written(p)} = ${p.sign.name}`, role(p), meanings].filter(Boolean).join(" · ")
}

/**
 * A cuneiform spelling sign by sign: each glyph with its reading in this word, its sign-list
 * name and what that reading means as a Sumerian word or word part.
 */
export function SignBreakdown({ parts }: { parts: SpellingPart[] }) {
  return (
    <ol className="divide-y rounded-lg border">
      {parts.map((p, i) => (
        <li key={`${p.sign.id}-${i}`} className="grid grid-cols-[3.5rem_1fr] items-start gap-x-4 gap-y-1 p-3 sm:grid-cols-[4rem_9rem_1fr]">
          <Link
            href={signHref("cuneiform", p.sign.name)}
            className={cn(CUNEIFORM, "row-span-2 flex h-14 items-center justify-center rounded-md border text-4xl leading-none hover:bg-muted sm:row-span-1")}
            title={`Sign ${p.sign.name}`}
          >
            {p.glyph}
          </Link>
          <div className="space-y-0.5">
            <p className="font-mono text-base">{written(p)}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Link href={signHref("cuneiform", p.sign.name)} className="font-mono underline-offset-4 hover:text-foreground hover:underline">
                {p.sign.name}
              </Link>
              {role(p) ? <span className="rounded-full border px-1.5 py-px">{role(p)}</span> : null}
            </p>
          </div>
          <div className="text-sm sm:pt-0.5">
            {p.meanings.length ? (
              <ul className="space-y-0.5">
                {p.meanings.map((m, j) => (
                  <li key={m.id} className={j > 0 ? "text-muted-foreground" : undefined}>
                    <Link href={`/entries/${m.id}`} className="underline-offset-4 hover:underline">
                      {m.gloss}
                    </Link>
                    {/* affixes are cited with their hyphen (-ak, nam-); determinatives' headword is just the glyph */}
                    {m.kind === "part" && m.headword.includes("-") ? (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">{m.headword}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{p.kind === "determinative" ? "unpronounced classifier" : "—"}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** The same breakdown as an interlinear strip for tables: each glyph over its reading. */
export function SignBreakdownInline({ parts, className }: { parts: SpellingPart[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-end gap-x-1 whitespace-nowrap", className)} lang="sux">
      {parts.map((p, i) => (
        <span key={`${p.sign.id}-${i}`} className="inline-flex flex-col items-center" title={summary(p)}>
          <span className={cn(CUNEIFORM, "text-2xl leading-none")}>{p.glyph}</span>
          <span className={cn("font-mono text-[10px] leading-tight text-muted-foreground", p.kind === "determinative" && "italic")}>
            {written(p)}
          </span>
        </span>
      ))}
    </span>
  )
}

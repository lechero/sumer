import Link from "next/link"
import type { CuneiformSigns as CuneiformSignsData, SignFacts, SpellingPart } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { Chip } from "@/components/chip"
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

/** A sign's other values and list numbers, under the meaning. */
function Facts({ facts }: { facts: SignFacts | undefined }) {
  if (!facts || (!facts.readings.length && !facts.akkadian.length && !facts.numbers)) return null
  return (
    <p className="text-xs text-muted-foreground">
      {facts.readings.length ? (
        <span>
          also read <span className="font-mono text-ink-2">{facts.readings.slice(0, 8).join(", ")}</span>
          {facts.readings.length > 8 ? ` +${facts.readings.length - 8}` : ""}
        </span>
      ) : null}
      {facts.akkadian.length ? (
        <span>
          {facts.readings.length ? " · " : ""}Akkadian <span className="font-mono text-ink-2">{facts.akkadian.slice(0, 4).join(", ")}</span>
        </span>
      ) : null}
      {facts.numbers ? <span className="block font-mono text-[10px] tracking-wide opacity-80">{facts.numbers}</span> : null}
    </p>
  )
}

/**
 * A cuneiform spelling sign by sign: each glyph with its reading in this word, its sign-list
 * name, what that reading means as a Sumerian word or word part, its other values and numbers.
 */
export function SignBreakdown({ parts }: { parts: SpellingPart[] }) {
  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3">
        <span className="eyebrow">spelled</span>
        <span className={cn(CUNEIFORM, "text-3xl leading-none text-amber")}>{parts.map((p) => p.glyph).join("")}</span>
        <span className="font-mono text-sm text-violet">{parts.map(written).join("-").replace(/-?\{/g, "{").replace(/\}-/g, "}")}</span>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {parts.length} sign{parts.length === 1 ? "" : "s"}
        </span>
      </div>
      <ol className="glass divide-y overflow-hidden rounded-2xl">
        {parts.map((p, i) => (
          <li
            key={`${p.sign.id}-${i}`}
            className="group grid grid-cols-[4rem_1fr] items-start gap-x-4 gap-y-1 p-3 transition-colors hover:bg-accent/40 sm:grid-cols-[4.5rem_10rem_1fr]"
          >
            <Link
              href={signHref("cuneiform", p.sign.name)}
              className={cn(
                CUNEIFORM,
                "row-span-3 flex h-16 items-center justify-center rounded-xl border bg-background/40 text-4xl leading-none text-amber transition-[text-shadow,border-color] hover:border-amber/60 group-hover:glyph-glow sm:row-span-1"
              )}
              title={`Sign ${p.sign.name}`}
            >
              {p.glyph}
            </Link>
            <div className="space-y-1">
              <p className="font-mono text-base font-semibold text-violet">{written(p)}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Link href={signHref("cuneiform", p.sign.name)} className="font-mono hover:text-foreground">
                  {p.sign.name}
                </Link>
                {role(p) ? <Chip tone={p.kind === "determinative" ? "rose" : "sky"}>{role(p)}</Chip> : null}
              </p>
            </div>
            <div className="min-w-0 space-y-1 text-sm sm:pt-0.5">
              {p.meanings.length ? (
                <ul className="space-y-0.5">
                  {p.meanings.map((m, j) => (
                    <li key={m.id} className={j > 0 ? "text-muted-foreground" : undefined}>
                      <Link href={`/entries/${m.id}`} className="underline-offset-4 hover:text-violet hover:underline">
                        {m.gloss}
                      </Link>
                      {/* affixes are cited with their hyphen (-ak, nam-); determinatives' headword is just the glyph */}
                      {m.kind === "part" && m.headword.includes("-") ? (
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">{m.headword}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : p.kind === "determinative" ? (
                <span className="text-muted-foreground">unpronounced classifier</span>
              ) : null}
              <Facts facts={p.facts} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The signs of a word without a sign-by-sign spelling: Akkadian and Hittite words written with
 * Sumerograms (𒂗 bēlu "lord" = Sumerian en), each sign with the Sumerian word it stands for.
 */
export function CuneiformSigns({ data }: { data: CuneiformSignsData }) {
  // one sign that is itself the Sumerogram: its row already says so
  const banner = data.sumerogram && !(data.signs.length === 1 && data.signs[0]!.logogram?.id === data.sumerogram.id)
  return (
    <div className="space-y-4">
      {banner && data.sumerogram ? (
        <Link href={`/entries/${data.sumerogram.id}`} className="glass lift flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl px-4 py-3">
          <span className="eyebrow">Sumerogram</span>
          <span className="text-sm">
            written with Sumerian <span className="font-mono font-semibold text-violet">{data.sumerogram.headword}</span>{" "}
            <span className="text-ink-2">“{data.sumerogram.gloss}”</span>
          </span>
        </Link>
      ) : null}
      <ol className="glass divide-y overflow-hidden rounded-2xl">
        {data.signs.map((s, i) => (
          <li key={i} className="group grid grid-cols-[4rem_1fr] items-start gap-x-4 gap-y-1 p-3 transition-colors hover:bg-accent/40 sm:grid-cols-[4.5rem_10rem_1fr]">
            {s.sign ? (
              <Link
                href={signHref("cuneiform", s.sign.name)}
                className={cn(CUNEIFORM, "row-span-3 flex h-16 items-center justify-center rounded-xl border bg-background/40 text-4xl leading-none text-amber hover:border-amber/60 group-hover:glyph-glow sm:row-span-1")}
              >
                {s.glyph}
              </Link>
            ) : (
              <span className={cn(CUNEIFORM, "row-span-3 flex h-16 items-center justify-center rounded-xl border text-4xl leading-none opacity-70 sm:row-span-1")}>{s.glyph}</span>
            )}
            <div className="space-y-1">
              {s.sign ? (
                <Link href={signHref("cuneiform", s.sign.name)} className="font-mono text-base font-semibold hover:text-violet">
                  {s.sign.name}
                </Link>
              ) : (
                <span className="font-mono text-muted-foreground">U+{(s.glyph.codePointAt(0) ?? 0).toString(16).toUpperCase()}</span>
              )}
              {s.logogram ? <Chip tone="amber">logogram</Chip> : null}
            </div>
            <div className="min-w-0 space-y-1 text-sm sm:pt-0.5">
              {s.logogram ? (
                <p>
                  Sumerian{" "}
                  <Link href={`/entries/${s.logogram.id}`} className="font-mono text-violet underline-offset-4 hover:underline">
                    {s.logogram.reading}
                  </Link>{" "}
                  <span className="text-ink-2">“{s.logogram.gloss}”</span>
                </p>
              ) : null}
              <Facts facts={s.facts ? { ...s.facts, readings: s.facts.readings.filter((r) => r !== s.logogram?.reading) } : undefined} />
            </div>
          </li>
        ))}
      </ol>
    </div>
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

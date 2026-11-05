import Link from "next/link"
import type { HieroglyphBreakdown as HieroglyphBreakdownData, HieroglyphRole } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { Chip, type ChipTone } from "@/components/chip"
import { scriptFontClass, signHref } from "@/lib/scripts"

const SCRIPT = "egyptian-hieroglyphs"
const FONT = scriptFontClass(SCRIPT)

const ROLE: Record<HieroglyphRole, { label: string; tone: ChipTone; hint: string }> = {
  sound: { label: "sound sign", tone: "violet", hint: "Writes one, two or three consonants." },
  word: { label: "word sign", tone: "amber", hint: "Stands for the whole word it pictures (a logogram)." },
  complement: { label: "complement", tone: "sky", hint: "Repeats sounds of the sign before, to help the reader." },
  ending: { label: "ending", tone: "mint", hint: "A grammatical ending (feminine -t, plural -w)." },
  classifier: { label: "classifier", tone: "rose", hint: "Not pronounced: shows what kind of thing the word means." },
  plural: { label: "plural", tone: "muted", hint: "Marks the word as plural (or dual)." },
  stroke: { label: "stroke", tone: "muted", hint: "Marks the sign before as a word sign." },
  unread: { label: "unread", tone: "muted", hint: "No value of this sign matches the transliteration." },
}

/**
 * A hieroglyphic spelling sign by sign: each sign with its Gardiner code, what it depicts, its
 * sound values and the part it plays in this word, worked out from the transliteration.
 */
export function HieroglyphBreakdown({ data }: { data: HieroglyphBreakdownData }) {
  const used = new Set(data.parts.map((p) => p.role))
  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3">
        <span className="eyebrow">spelled</span>
        <span className={cn(FONT, "text-3xl leading-none text-amber")}>{data.parts.map((p) => p.glyph).join("")}</span>
        <span className="font-mono text-sm">
          <span className="text-violet">{data.spelled || "—"}</span>
          <span className="text-muted-foreground"> of </span>
          <span>{data.target}</span>
          {data.spelled === data.target ? <span className="ml-1.5 text-mint">✓</span> : null}
        </span>
        <span className="flex flex-wrap gap-1.5 sm:ml-auto">
          {(Object.keys(ROLE) as HieroglyphRole[])
            .filter((r) => used.has(r))
            .map((r) => (
              <Chip key={r} tone={ROLE[r].tone} title={ROLE[r].hint}>
                {ROLE[r].label}
              </Chip>
            ))}
        </span>
      </div>
      <ol className="glass divide-y overflow-hidden rounded-2xl">
        {data.parts.map((p, i) => {
          const role = ROLE[p.role]
          return (
            <li key={i} className="group grid grid-cols-[4rem_1fr] items-start gap-x-4 gap-y-1 p-3 transition-colors hover:bg-accent/40 sm:grid-cols-[4.5rem_10rem_1fr]">
              {p.sign ? (
                <Link
                  href={signHref(SCRIPT, p.sign.name)}
                  className={cn(FONT, "row-span-3 flex h-16 items-center justify-center rounded-xl border bg-background/40 text-4xl leading-none text-amber transition-[text-shadow,border-color] hover:border-amber/60 group-hover:glyph-glow sm:row-span-1")}
                  title={`Sign ${p.sign.name}`}
                >
                  {p.glyph}
                </Link>
              ) : (
                <span className={cn(FONT, "row-span-3 flex h-16 items-center justify-center rounded-xl border text-4xl leading-none opacity-70 sm:row-span-1")}>{p.glyph}</span>
              )}
              <div className="space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  {p.sign ? (
                    <Link href={signHref(SCRIPT, p.sign.name)} className="font-mono text-base font-semibold hover:text-violet">
                      {p.sign.name}
                    </Link>
                  ) : (
                    <span className="font-mono text-muted-foreground">unlisted</span>
                  )}
                  {p.value ? <span className="font-mono text-violet">{p.value}</span> : null}
                </p>
                <Chip tone={role.tone} title={role.hint}>
                  {role.label}
                </Chip>
              </div>
              <div className="min-w-0 space-y-0.5 text-sm">
                <p>{p.note}</p>
                {p.sign?.description ? <p className="text-muted-foreground">{p.sign.description}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {p.sign?.category ? <span>{p.sign.category}</span> : null}
                  {p.sign?.readings.length ? (
                    <span>
                      {p.sign.category ? " · " : ""}values <span className="font-mono">{p.sign.readings.join(", ")}</span>
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-muted-foreground">Roles are worked out from the spelling and the transliteration, as a reading aid.</p>
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { listScripts } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { Chip } from "@/components/chip"
import { DbProblem } from "@/components/db-problem"
import { HeroGlyph, PageHero, Shimmer } from "@/components/page-hero"
import { Section } from "@/components/section"
import { withDb } from "@/lib/data"
import { scriptFontClass, scriptHref } from "@/lib/scripts"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Scripts" }

/** Card top bars, cycling like the home page's. */
const BARS = [
  "linear-gradient(90deg, var(--violet), var(--rose))",
  "linear-gradient(90deg, var(--amber), var(--ember))",
  "linear-gradient(90deg, var(--mint), var(--sky))",
  "linear-gradient(90deg, var(--rose), var(--violet))",
]

/** Scripts grouped by how they write: words and syllables first, then the consonants, then full alphabets. */
const FAMILIES: [string, (kind: string) => boolean][] = [
  ["Word signs and syllables", (k) => /logo|syllab|proto/.test(k)],
  ["Consonants and syllables with vowel marks", (k) => /abjad|abugida/.test(k)],
  ["Alphabets", (k) => /alphabet/.test(k)],
]

export default async function ScriptsPage() {
  const result = await withDb((db) => listScripts(db))
  if (!result.ok) return <DbProblem result={result} />
  const scripts = result.data.filter((s) => s.signCount > 0)
  const total = scripts.reduce((n, s) => n + s.signCount + s.formCount, 0)
  const forms = scripts.reduce((n, s) => n + s.formCount, 0)
  const grouped = FAMILIES.map(([title, test]) => ({ title, scripts: scripts.filter((s) => test(s.kind ?? "")) }))
  const placed = new Set(grouped.flatMap((g) => g.scripts.map((s) => s.id)))
  const rest = scripts.filter((s) => !placed.has(s.id))
  if (rest.length) grouped.push({ title: "Other scripts", scripts: rest })

  return (
    <div className="space-y-14">
      <PageHero
        eyebrow={<span>Scripts · signs · readings</span>}
        title={
          <>
            Every sign, <Shimmer>every reading</Shimmer>
          </>
        }
        lede={
          <>
            From the proto-cuneiform tablets of Uruk to the runes and ogham of northern Europe: each sign with its glyph, sign-list
            numbers and readings. Cuneiform from the Oracc Sign List, proto-cuneiform from PCSL, hieroglyphs from Unicode&apos;s
            Unikemet, the alphabets and syllabaries from the Unicode Character Database.
          </>
        }
        art={
          <HeroGlyph className="grid grid-cols-2 gap-x-6 gap-y-3 text-5xl text-amber sm:text-6xl">
            <span className="font-cuneiform">𒀭</span>
            <span className="font-egyptian">𓂀</span>
            <span className="font-linear-b">𐀀</span>
            <span className="font-greek">Ω</span>
          </HeroGlyph>
        }
        stats={[
          { label: "Signs", value: total.toLocaleString(), featured: true, note: forms ? `${forms.toLocaleString()} variant forms` : undefined },
          { label: "Scripts", value: scripts.length },
          { label: "Oldest", value: "c. 3350 BCE", note: "Uruk IV" },
        ]}
      />

      {scripts.length === 0 ? (
        <p className="glass rounded-2xl border-dashed p-8 text-center text-sm text-muted-foreground">
          No signs yet. Run <code className="font-mono">task import -- osl pcsl unikemet alphabets</code>.
        </p>
      ) : (
        grouped
          .filter((g) => g.scripts.length)
          .map((g, gi) => (
            <Section key={g.title} num={gi + 1} title={g.title} extra={<span className="font-mono text-xs">{g.scripts.length} scripts</span>}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.scripts.map((s, i) => (
                  <Link
                    key={s.id}
                    href={scriptHref(s.id)}
                    className="glass top-bar lift group flex flex-col gap-3 rounded-2xl p-5"
                    style={{ "--bar": BARS[(gi + i) % BARS.length] } as React.CSSProperties}
                  >
                    <div className="space-y-0.5">
                      <h3 className="text-lg font-bold tracking-tight group-hover:text-violet">{s.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">{[s.kind, s.period].filter(Boolean).join(" · ")}</p>
                    </div>
                    {s.sample ? (
                      <p
                        className={cn(scriptFontClass(s.id), "truncate text-3xl leading-tight text-amber transition-[text-shadow] group-hover:glyph-glow")}
                        dir={s.direction}
                        aria-hidden
                      >
                        {[...s.sample].slice(0, 12).join("")}
                      </p>
                    ) : null}
                    {s.description ? <p className="line-clamp-3 text-sm text-ink-2">{s.description}</p> : null}
                    <div className="mt-auto flex flex-wrap gap-1.5">
                      <Chip tone="violet">{s.signCount.toLocaleString()} signs</Chip>
                      {s.formCount ? <Chip tone="amber">{s.formCount.toLocaleString()} forms</Chip> : null}
                      {s.iso15924 ? <Chip tone="muted" className="font-mono">{s.iso15924}</Chip> : null}
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          ))
      )}
    </div>
  )
}

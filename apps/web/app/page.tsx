import Link from "next/link"
import { countEntries, countSigns, listLanguages } from "@workspace/db"

import { Chip } from "@/components/chip"
import { DbProblem } from "@/components/db-problem"
import { NativeText } from "@/components/native-text"
import { HeroGlyph, PageHero, Shimmer } from "@/components/page-hero"
import { SearchForm } from "@/components/search-form"
import { Section } from "@/components/section"
import { withDb } from "@/lib/data"

export const dynamic = "force-dynamic"

/** Card top bars, cycling like the report's cards. */
const BARS = [
  "linear-gradient(90deg, var(--violet), var(--rose))",
  "linear-gradient(90deg, var(--amber), var(--ember))",
  "linear-gradient(90deg, var(--mint), var(--sky))",
  "linear-gradient(90deg, var(--rose), var(--violet))",
]

const EXAMPLES = ["king", "lugal", "𒈗", "e2-gal", "λόγος", "שלום", "agni", "dhamma", "ꜥnḫ", "cyning"]

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

export default async function HomePage() {
  const result = await withDb(async (db) => ({
    languages: await listLanguages(db),
    totals: await countEntries(db),
    signs: await countSigns(db),
  }))

  if (!result.ok) return <DbProblem result={result} />
  const { languages, totals, signs } = result.data
  const shown = languages.filter((l) => l.wordCount + l.partCount > 0)
  // size meter: log scale, so 400 Hittite words still show next to 200k Sanskrit ones
  const maxLog = Math.log10(Math.max(...shown.map((l) => l.wordCount + l.partCount), 10))

  return (
    <div className="space-y-16">
      <PageHero
        eyebrow={
          <>
            <span className="font-cuneiform text-base normal-case tracking-normal text-amber">𒅴𒂠</span>
            <span>An ancient-languages library</span>
            <span className="opacity-60">·</span>
            <span>{shown.length} languages</span>
          </>
        }
        title={
          <>
            Words and word parts of the <Shimmer>ancient world</Shimmer>
          </>
        }
        lede={
          <>
            Every entry is a word <em>or</em> one of the pieces words are built from (roots, affixes, determinatives), linked to how
            it travelled between languages. Sumerian <span className="font-cuneiform">𒂍𒃲</span> e₂-gal became Akkadian{" "}
            <em>ekallu</em> became Hebrew <span className="font-hebrew">הֵיכָל</span>.
          </>
        }
        art={<HeroGlyph className="font-cuneiform text-6xl text-amber sm:text-[7rem] lg:text-[9rem]">𒂍𒃲</HeroGlyph>}
        stats={[
          { label: "Entries", value: totals.total.toLocaleString(), note: `${compact.format(totals.words)} words · ${compact.format(totals.parts)} parts`, featured: true },
          { label: "Languages", value: shown.length, note: `${totals.sources} sources` },
          { label: "Links", value: totals.relations.toLocaleString(), note: "synonyms, cognates, loans" },
          { label: "Signs", value: signs.total.toLocaleString(), note: `${signs.scripts} scripts` },
          { label: "Readings", value: signs.readings.toLocaleString(), note: "sign values" },
        ]}
      >
        <div className="max-w-xl space-y-3">
          <SearchForm />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((s) => (
              <Link
                key={s}
                href={`/search?q=${encodeURIComponent(s)}`}
                className="rounded-full border border-white/15 bg-white/6 px-2.5 py-0.5 font-mono text-xs text-(--hero-dim) transition-colors hover:border-amber/60 hover:text-(--hero-ink) [.light_&]:border-foreground/10 [.light_&]:bg-white/60"
              >
                {s}
              </Link>
            ))}
          </div>
        </div>
      </PageHero>

      <Section num={1} title="Languages" hint="From the first written words of Uruk to the sagas of Iceland. Each card shows how much of the language is here.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((lang, i) => {
            const total = lang.wordCount + lang.partCount
            const meter = Math.max(4, (Math.log10(Math.max(total, 1)) / maxLog) * 100)
            // short native names sit beside the title, longer ones ("𒅴𒂠 (eme-gir₁₅)") get their own line
            const short = !!lang.nativeName && [...lang.nativeName].length <= 12
            return (
              <Link
                key={lang.id}
                href={`/languages/${lang.id}`}
                className="glass top-bar lift group flex flex-col gap-3 rounded-2xl p-5"
                style={{ "--bar": BARS[i % BARS.length] } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold tracking-tight group-hover:text-violet">{lang.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {[lang.family, lang.period].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {short ? (
                    <NativeText
                      text={lang.nativeName}
                      script={lang.script}
                      direction={lang.direction}
                      className="shrink-0 text-xl leading-tight text-amber group-hover:glyph-glow"
                    />
                  ) : null}
                </div>
                {!short && lang.nativeName ? (
                  <NativeText
                    as="p"
                    text={lang.nativeName}
                    script={lang.script}
                    direction={lang.direction}
                    className="-mt-1 text-lg leading-tight text-amber group-hover:glyph-glow"
                  />
                ) : null}
                {lang.description ? <p className="line-clamp-2 text-sm text-ink-2">{lang.description}</p> : null}
                <div className="mt-auto space-y-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${meter}%`, backgroundImage: BARS[i % BARS.length] }} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone="violet">{lang.wordCount.toLocaleString()} words</Chip>
                    {lang.partCount ? <Chip tone="amber">{lang.partCount.toLocaleString()} parts</Chip> : null}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </Section>

      {signs.encoded > 0 ? (
        <Section num={2} title="Scripts and signs" hint="Cuneiform, hieroglyphs, Linear B and the alphabets, each sign with its readings and the words written with it.">
          <Link href="/scripts" className="glass lift group grid gap-6 rounded-2xl p-6 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-amber" aria-hidden>
              <span className="font-cuneiform text-4xl leading-none group-hover:glyph-glow">𒀭𒂗𒆤</span>
              <span className="font-egyptian text-4xl leading-none group-hover:glyph-glow">𓂀𓅓𓆣</span>
              <span className="font-linear-b text-4xl leading-none group-hover:glyph-glow">𐀀𐀁𐀂</span>
              <span className="font-runic text-4xl leading-none group-hover:glyph-glow">ᚠᚢᚦ</span>
            </div>
            <div className="space-y-1">
              <p className="text-lg font-bold tracking-tight group-hover:text-violet">Writing systems →</p>
              <p className="text-sm text-ink-2">
                {signs.total.toLocaleString()} signs in {signs.scripts} scripts with {signs.readings.toLocaleString()} readings, from the
                proto-cuneiform tablets of Uruk to the runes and ogham of northern Europe.
              </p>
            </div>
          </Link>
        </Section>
      ) : null}

      <Section num={3} title="How it fits together">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Words", "Lemmas with glosses, senses, definitions and etymologies, in native script and transliteration.", "var(--violet)"],
            ["Word parts", "Roots, prefixes, suffixes, clitics, patterns and determinatives, linked to the words they build.", "var(--amber)"],
            ["Connections", "Synonyms, loans, cognates and translation equivalents across languages, each with its source and confidence.", "var(--mint)"],
          ].map(([title, text, color]) => (
            <div key={title} className="glass rounded-2xl border-t-[3px] p-5" style={{ borderTopColor: color }}>
              <h3 className="font-bold">{title}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{text}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

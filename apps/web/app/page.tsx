import Link from "next/link"
import { countEntries, countSigns, listLanguages } from "@workspace/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { DbProblem } from "@/components/db-problem"
import { NativeText } from "@/components/native-text"
import { SearchForm } from "@/components/search-form"
import { withDb } from "@/lib/data"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const result = await withDb(async (db) => ({
    languages: await listLanguages(db),
    totals: await countEntries(db),
    signs: await countSigns(db),
  }))

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Words and word parts of the ancient world
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            A dictionary that treats a language as words <em>and</em> the pieces they are built from —
            roots, affixes, clitics, determinatives — and records how words travelled between languages:
            Sumerian <span className="font-cuneiform">𒂍𒃲</span> e₂-gal became Akkadian <em>ekallu</em> became
            Hebrew <span className="font-hebrew">הֵיכָל</span>.
          </p>
        </div>
        <div className="max-w-xl">
          <SearchForm />
        </div>
        {result.ok ? (
          <p className="text-sm text-muted-foreground">
            {result.data.totals.words.toLocaleString()} words · {result.data.totals.parts.toLocaleString()} word parts ·{" "}
            {result.data.languages.length} languages
          </p>
        ) : null}
      </section>

      {!result.ok ? (
        <DbProblem result={result} />
      ) : (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Languages</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {result.data.languages.map((lang) => (
              <Link key={lang.id} href={`/languages/${lang.id}`} className="group">
                <Card className="h-full transition-colors group-hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-baseline gap-x-3">
                      <span>{lang.name}</span>
                      <NativeText
                        text={lang.nativeName}
                        script={lang.script}
                        direction={lang.direction}
                        className="text-base font-normal text-muted-foreground"
                      />
                    </CardTitle>
                    <CardDescription>
                      {lang.family}
                      {lang.period ? ` · ${lang.period}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {lang.description ? <p className="text-sm text-muted-foreground">{lang.description}</p> : null}
                    <p className="text-sm">
                      <span className="font-medium">{lang.wordCount.toLocaleString()}</span> words ·{" "}
                      <span className="font-medium">{lang.partCount.toLocaleString()}</span> word parts
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {result.ok && result.data.signs.encoded > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Cuneiform signs</h2>
          <Link href="/signs" className="group block">
            <Card className="transition-colors group-hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-cuneiform text-3xl font-normal leading-none" aria-hidden>𒀭𒂗𒆤 𒈗 𒆠 𒀀</span>
                  <span>Sign list</span>
                </CardTitle>
                <CardDescription>
                  {result.data.signs.encoded.toLocaleString()} encoded signs, {result.data.signs.readings.toLocaleString()} readings, from the Oracc Sign List — with every word written with each sign.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </section>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-muted/30 p-6 sm:grid-cols-3">
        <div>
          <h3 className="font-medium">Words</h3>
          <p className="text-sm text-muted-foreground">Lemmas with glosses, senses, definitions and etymologies, in native script and transliteration.</p>
        </div>
        <div>
          <h3 className="font-medium">Word parts</h3>
          <p className="text-sm text-muted-foreground">Roots, prefixes, suffixes, clitics, patterns and determinatives, linked to the words they build.</p>
        </div>
        <div>
          <h3 className="font-medium">Connections</h3>
          <p className="text-sm text-muted-foreground">Loans, cognates and translation equivalents across languages, each with a confidence flag.</p>
        </div>
      </section>
    </div>
  )
}

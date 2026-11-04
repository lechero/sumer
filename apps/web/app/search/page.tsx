import type { Metadata } from "next"
import { listEntries, listLanguages, type EntryKind } from "@workspace/db"

import { DbProblem } from "@/components/db-problem"
import { EntryTable } from "@/components/entry-table"
import { SearchForm } from "@/components/search-form"
import { cuneiformBreakdowns } from "@/lib/breakdowns"
import { first, withDb } from "@/lib/data"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Search" }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = first(sp.q)?.trim() ?? ""
  const lang = first(sp.lang) || undefined
  const kindParam = first(sp.kind)
  const kind: EntryKind | undefined = kindParam === "word" || kindParam === "part" ? kindParam : undefined

  const result = await withDb(async (db) => {
    const list = q ? await listEntries(db, { q, languageId: lang, kind, limit: 200 }) : null
    return {
      languages: await listLanguages(db),
      list,
      breakdowns: list ? await cuneiformBreakdowns(db, list.rows) : undefined,
    }
  })

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        <p className="max-w-2xl text-muted-foreground">
          Matching ignores diacritics, Hebrew vowel points, Greek accents, sign indices and hyphens:{" "}
          <code className="font-mono">egal</code>, <code className="font-mono">e2-gal</code> and{" "}
          <code className="font-mono">𒂍𒃲</code> all find the same entry. Glosses are searched too, so{" "}
          <code className="font-mono">king</code> finds lugal, šarru, βασιλεύς and מֶלֶךְ.
        </p>
        <div className="max-w-xl">
          <SearchForm defaultValue={q} />
        </div>
      </header>

      {!result.ok ? (
        <DbProblem result={result} />
      ) : !q ? (
        <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
          Try: <Examples />
        </div>
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {result.data.list!.total.toLocaleString()} result{result.data.list!.total === 1 ? "" : "s"} for “{q}”
            {lang ? ` in ${result.data.languages.find((l) => l.id === lang)?.name ?? lang}` : ""}
          </p>
          <EntryTable rows={result.data.list!.rows} breakdowns={result.data.breakdowns} emptyMessage={`Nothing matches “${q}”.`} />
        </section>
      )}
    </div>
  )
}

function Examples() {
  const samples = ["king", "lugal", "𒈗", "e2-gal", "šeš", "λόγος", "logos", "שלום", "shalom", "-ak", "nam-"]
  return (
    <span className="inline-flex flex-wrap gap-2">
      {samples.map((s) => (
        <a key={s} href={`/search?q=${encodeURIComponent(s)}`} className="rounded border px-2 py-0.5 font-mono hover:bg-muted">
          {s}
        </a>
      ))}
    </span>
  )
}

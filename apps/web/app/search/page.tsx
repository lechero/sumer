import type { Metadata } from "next"
import Link from "next/link"
import { countEntriesByLanguage, listEntries, listLanguages, type EntryKind } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { DbProblem } from "@/components/db-problem"
import { EntryTable } from "@/components/entry-table"
import { PageHero, Shimmer } from "@/components/page-hero"
import { SearchForm } from "@/components/search-form"
import { Section } from "@/components/section"
import { cuneiformBreakdowns } from "@/lib/breakdowns"
import { first, withDb } from "@/lib/data"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Search" }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const EXAMPLES = ["king", "lugal", "𒈗", "e2-gal", "šeš", "λόγος", "logos", "שלום", "shalom", "agni", "ꜥnḫ", "-ak", "nam-"]

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = first(sp.q)?.trim() ?? ""
  const lang = first(sp.lang) || undefined
  const kindParam = first(sp.kind)
  const kind: EntryKind | undefined = kindParam === "word" || kindParam === "part" ? kindParam : undefined

  const result = await withDb(async (db) => {
    const list = q ? await listEntries(db, { q, languageId: lang, kind, limit: 200 }) : null
    // which languages the matches come from, to narrow the search to one
    const facets = q ? await countEntriesByLanguage(db, { q, kind }) : null
    return {
      languages: await listLanguages(db),
      list,
      facets,
      breakdowns: list ? await cuneiformBreakdowns(db, list.rows) : undefined,
    }
  })

  const href = (l?: string) => {
    const u = new URLSearchParams({ q })
    if (l) u.set("lang", l)
    if (kind) u.set("kind", kind)
    return `/search?${u}`
  }

  return (
    <div className="space-y-10">
      <PageHero
        eyebrow={<span>Search · every language at once</span>}
        title={
          <>
            Find a word in <Shimmer>any script</Shimmer>
          </>
        }
        lede={
          <>
            Matching ignores diacritics, vowel points, accents, sign indices and hyphens, so <code className="font-mono">egal</code>,{" "}
            <code className="font-mono">e2-gal</code> and <span className="font-cuneiform">𒂍𒃲</span> find the same entry. Glosses are
            searched too: <code className="font-mono">king</code> finds lugal, šarru, βασιλεύς and מֶלֶךְ.
          </>
        }
      >
        <div className="max-w-xl space-y-3">
          <SearchForm defaultValue={q} />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((s) => (
              <Link
                key={s}
                href={`/search?q=${encodeURIComponent(s)}`}
                className={cn(
                  "rounded-full border border-white/15 bg-white/6 px-2.5 py-0.5 font-mono text-xs text-(--hero-dim) transition-colors hover:border-amber/60 hover:text-(--hero-ink) [.light_&]:border-foreground/10 [.light_&]:bg-white/60",
                  s === q && "border-amber/70 text-(--hero-ink)"
                )}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>
      </PageHero>

      {!result.ok ? (
        <DbProblem result={result} />
      ) : !q ? null : (
        <Section
          num={1}
          title={
            <>
              Results for <span className="text-violet">“{q}”</span>
            </>
          }
          extra={
            <span className="font-mono text-xs">
              {result.data.list!.total.toLocaleString()} match{result.data.list!.total === 1 ? "" : "es"}
              {result.data.list!.total > result.data.list!.rows.length ? ` · first ${result.data.list!.rows.length}` : ""}
            </span>
          }
        >
          <LanguageFacets
            counts={result.data.facets ?? new Map()}
            languages={result.data.languages}
            current={lang}
            href={href}
          />
          <EntryTable rows={result.data.list!.rows} breakdowns={result.data.breakdowns} emptyMessage={`Nothing matches “${q}”.`} />
        </Section>
      )}
    </div>
  )
}

/** Chips for the languages the matches come from; picking one narrows the search to it. */
function LanguageFacets({
  counts,
  languages,
  current,
  href,
}: {
  counts: Map<string, number>
  languages: { id: string; name: string }[]
  current?: string
  href: (lang?: string) => string
}) {
  if (counts.size < 2 && !current) return null
  const shown = languages.filter((l) => counts.has(l.id) || l.id === current)
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active ? "border-transparent bg-linear-to-br from-violet to-ember text-white" : "glass text-muted-foreground hover:border-violet/50 hover:text-foreground"
    )
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Filter by language">
      <Link href={href()} className={chip(!current)}>
        All languages
      </Link>
      {shown.map((l) => (
        <Link key={l.id} href={href(l.id)} className={chip(current === l.id)}>
          {l.name}
          {counts.get(l.id) ? <span className="ml-1.5 opacity-70">{counts.get(l.id)!.toLocaleString()}</span> : null}
        </Link>
      ))}
    </nav>
  )
}

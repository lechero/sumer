import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { countLanguageEntries, getLanguage, listEntries, type EntryKind } from "@workspace/db"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { DbProblem } from "@/components/db-problem"
import { EntryTable } from "@/components/entry-table"
import { cuneiformBreakdowns } from "@/lib/breakdowns"
import { NativeText } from "@/components/native-text"
import { HeroGlyph, PageHero } from "@/components/page-hero"
import { SearchForm } from "@/components/search-form"
import { first, withDb } from "@/lib/data"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 100

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const result = await withDb((db) => getLanguage(db, id))
  return { title: result.ok && result.data ? result.data.name : "Language" }
}

function parseKind(v: string | undefined): EntryKind | undefined {
  return v === "word" || v === "part" ? v : undefined
}

/** "𒅴𒂠 (eme-gir₁₅)" → ["𒅴𒂠", "eme-gir₁₅"]: the script large, its reading small underneath. */
function splitNative(name: string): [string, string | undefined] {
  const m = name.match(/^(.+?)\s*\(([^)]+)\)$/)
  return m ? [m[1]!, m[2]] : [name, undefined]
}

/** "c. 2500 BCE – 100 CE (Old Akkadian …)" → ["c. 2500 BCE – 100 CE", "Old Akkadian …"]. */
function splitPeriod(period: string): [string, string | undefined] {
  const m = period.match(/^(.+?)(?:\s+\(|;\s*|\s+(?=(?:as|in)\s))(.+)$/)
  if (!m) return [period, undefined]
  const rest = m[2]!
  return [m[1]!, rest.endsWith(")") && !rest.includes("(") ? rest.slice(0, -1) : rest]
}

export default async function LanguagePage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const q = first(sp.q)?.trim() ?? ""
  const kind = parseKind(first(sp.kind))
  const page = Math.max(1, Number(first(sp.page) ?? "1") || 1)

  const result = await withDb(async (db) => {
    const language = await getLanguage(db, id)
    if (!language) return null
    const list = await listEntries(db, { languageId: id, kind, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
    const counts = await countLanguageEntries(db, id)
    return { language, list, counts, breakdowns: await cuneiformBreakdowns(db, list.rows) }
  })

  if (!result.ok) return <DbProblem result={result} />
  if (!result.data) notFound()
  const { language, list, counts, breakdowns } = result.data
  const { words, parts } = counts
  const [nativeScript, nativeReading] = language.nativeName ? splitNative(language.nativeName) : [undefined, undefined]
  const [periodRange, periodNote] = language.period ? splitPeriod(language.period) : [undefined, undefined]
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE))

  const tabHref = (k?: EntryKind) => {
    const u = new URLSearchParams()
    if (q) u.set("q", q)
    if (k) u.set("kind", k)
    const s = u.toString()
    return `/languages/${id}${s ? `?${s}` : ""}`
  }
  const pageHref = (p: number) => {
    const u = new URLSearchParams()
    if (q) u.set("q", q)
    if (kind) u.set("kind", kind)
    if (p > 1) u.set("page", String(p))
    const s = u.toString()
    return `/languages/${id}${s ? `?${s}` : ""}`
  }

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow={
          <>
            <Link href="/" className="hover:text-(--hero-ink)">Languages</Link>
            <span className="opacity-60">/</span>
            <span>{language.family ?? "Language"}</span>
          </>
        }
        title={language.name}
        lede={language.description}
        art={
          nativeScript ? (
            <div className="grid justify-items-center gap-1">
              <HeroGlyph
                className={cn(
                  "max-w-[20rem] text-center text-amber",
                  [...nativeScript].length > 12 ? "text-3xl sm:text-4xl" : [...nativeScript].length > 6 ? "text-5xl sm:text-6xl" : "text-6xl sm:text-8xl"
                )}
              >
                <NativeText text={nativeScript} script={language.script} direction={language.direction} />
              </HeroGlyph>
              {nativeReading ? <p className="font-mono text-sm text-(--hero-dim)">{nativeReading}</p> : null}
            </div>
          ) : undefined
        }
        stats={[
          { label: "Words", value: words.toLocaleString(), featured: true },
          { label: "Word parts", value: parts.toLocaleString() },
          ...(periodRange ? [{ label: "Period", value: periodRange, note: periodNote }] : []),
          { label: "Script", value: language.scriptName ?? language.script, note: language.direction === "rtl" ? "right to left" : "left to right" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav className="glass flex gap-1 rounded-full p-1" aria-label="Entry kind">
          {([
            [undefined, "All"],
            ["word", "Words"],
            ["part", "Word parts"],
          ] as const).map(([k, label]) => (
            <Link
              key={label}
              href={tabHref(k)}
              className={cn(
                "rounded-full px-4 py-1 text-sm font-medium transition-colors",
                kind === k
                  ? "bg-linear-to-br from-violet to-ember text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--violet)_35%,transparent)]"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="min-w-[16rem] flex-1 sm:max-w-md">
          <SearchForm defaultValue={q} languageId={id} kind={kind} compact placeholder={`Search ${language.name}…`} />
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {list.total.toLocaleString()} {kind === "part" ? "word parts" : kind === "word" ? "words" : "entries"}
          {q ? ` matching “${q}”` : ""}
        </p>
      </div>

      <EntryTable rows={list.rows} breakdowns={breakdowns} showLanguage={false} emptyMessage={q ? `Nothing in ${language.name} matches “${q}”.` : "No entries yet."} />

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} nativeButton={false} render={<Link href={pageHref(page - 1)} />}>
            Previous
          </Button>
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} nativeButton={false} render={<Link href={pageHref(page + 1)} />}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getLanguage, listEntries, type EntryKind } from "@workspace/db"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { DbProblem } from "@/components/db-problem"
import { EntryTable } from "@/components/entry-table"
import { NativeText } from "@/components/native-text"
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
    return { language, list }
  })

  if (!result.ok) return <DbProblem result={result} />
  if (!result.data) notFound()
  const { language, list } = result.data
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
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Languages</Link> / {language.name}
        </p>
        <h1 className="flex flex-wrap items-baseline gap-x-4 text-3xl font-semibold tracking-tight">
          <span>{language.name}</span>
          <NativeText
            text={language.nativeName}
            script={language.script}
            direction={language.direction}
            className="text-xl font-normal text-muted-foreground"
          />
        </h1>
        {language.description ? <p className="max-w-3xl text-muted-foreground">{language.description}</p> : null}
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {language.family ? (<><dt className="text-muted-foreground">Family</dt><dd>{language.family}</dd></>) : null}
          {language.period ? (<><dt className="text-muted-foreground">Period</dt><dd>{language.period}</dd></>) : null}
          <dt className="text-muted-foreground">Script</dt>
          <dd>{language.scriptName ?? language.script} ({language.direction.toUpperCase()})</dd>
        </dl>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex gap-1 rounded-lg border p-1" aria-label="Entry kind">
          {([
            [undefined, "All"],
            ["word", "Words"],
            ["part", "Word parts"],
          ] as const).map(([k, label]) => (
            <Link
              key={label}
              href={tabHref(k)}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="min-w-[16rem] flex-1 sm:max-w-md">
          <SearchForm defaultValue={q} languageId={id} kind={kind} compact placeholder={`Search ${language.name}…`} />
        </div>
        <p className="text-sm text-muted-foreground">
          {list.total.toLocaleString()} {kind === "part" ? "word parts" : kind === "word" ? "words" : "entries"}
          {q ? ` matching “${q}”` : ""}
        </p>
      </div>

      <EntryTable rows={list.rows} showLanguage={false} emptyMessage={q ? `Nothing in ${language.name} matches “${q}”.` : "No entries yet."} />

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

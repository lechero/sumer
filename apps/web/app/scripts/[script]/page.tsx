import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { countSigns, getScript, listSignCategories, listSigns } from "@workspace/db"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { DbProblem } from "@/components/db-problem"
import { SignTile } from "@/components/sign-tile"
import { first, withDb } from "@/lib/data"
import { COMPOSITE_SCRIPTS, scriptHref } from "@/lib/scripts"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 120

type Props = {
  params: Promise<{ script: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Search hints per script: what readers type. */
const PLACEHOLDER: Record<string, string> = {
  cuneiform: "lugal, ag2, LUGAL, 𒈗 …",
  "proto-cuneiform": "AN, ZATU644, N01 …",
  "egyptian-hieroglyphs": "nfr, rꜥ, G17, owl, falcon …",
  "linear-b": "da, B008, horse …",
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { script } = await params
  const result = await withDb((db) => getScript(db, script))
  return { title: result.ok && result.data ? `${result.data.name} signs` : "Signs" }
}

export default async function ScriptPage({ params, searchParams }: Props) {
  const { script: scriptId } = await params
  const sp = await searchParams
  const q = first(sp.q)?.trim() ?? ""
  const category = first(sp.cat)?.trim() || undefined
  const page = Math.max(1, Number(first(sp.page) ?? "1") || 1)
  const composite = COMPOSITE_SCRIPTS.has(scriptId)
  const all = composite && first(sp.all) === "1"

  const result = await withDb(async (db) => {
    const script = await getScript(db, scriptId)
    if (!script) return null
    const [list, counts, categories] = await Promise.all([
      listSigns(db, { script: scriptId, q, category, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, encodedOnly: !all, formsToo: all }),
      countSigns(db, scriptId),
      listSignCategories(db, scriptId),
    ])
    return { script, list, counts, categories }
  })
  if (!result.ok) return <DbProblem result={result} />
  if (!result.data) notFound()
  const { script, list, counts, categories } = result.data
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE))
  const href = (over: { page?: number; cat?: string | null; all?: boolean } = {}) => {
    const u = new URLSearchParams()
    if (q) u.set("q", q)
    const cat = over.cat === undefined ? category : over.cat
    if (cat) u.set("cat", cat)
    if (over.all ?? all) u.set("all", "1")
    if ((over.page ?? 1) > 1) u.set("page", String(over.page))
    const s = u.toString()
    return `${scriptHref(scriptId)}${s ? `?${s}` : ""}`
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <Link href="/scripts" className="hover:text-foreground">Scripts</Link> / {script.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{script.name}</h1>
        <div className="flex flex-wrap gap-1">
          {script.kind ? <Badge variant="secondary">{script.kind}</Badge> : null}
          {script.period ? <Badge variant="outline">{script.period}</Badge> : null}
          {script.iso15924 ? <Badge variant="outline" className="font-mono">{script.iso15924}</Badge> : null}
          {script.unicodeRange ? <Badge variant="outline" className="font-mono">{script.unicodeRange}</Badge> : null}
          {script.direction === "rtl" ? <Badge variant="outline">right to left</Badge> : null}
        </div>
        {script.description ? <p className="max-w-3xl text-muted-foreground">{script.description}</p> : null}
        <p className="max-w-3xl text-sm text-muted-foreground">
          {counts.encoded.toLocaleString()} signs with a glyph
          {counts.total !== counts.encoded ? `, ${counts.total.toLocaleString()} including unencoded signs and variant forms` : ""}
          {counts.readings ? `, ${counts.readings.toLocaleString()} readings` : ""}.
          {script.region ? ` ${script.region}.` : ""}
        </p>
        <form action={scriptHref(scriptId)} method="get" className="flex max-w-xl items-center gap-2" role="search">
          {all ? <input type="hidden" name="all" value="1" /> : null}
          {category ? <input type="hidden" name="cat" value={category} /> : null}
          <Input type="search" name="q" defaultValue={q} placeholder={PLACEHOLDER[scriptId] ?? "reading, name or glyph …"} aria-label={`Search ${script.name} signs`} className="h-10" />
          <Button type="submit">Search</Button>
        </form>
        {categories.length > 1 ? (
          <nav aria-label="Categories" className="flex flex-wrap gap-1.5">
            <Link
              href={href({ cat: null })}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted", !category && "bg-primary text-primary-foreground hover:bg-primary/90")}
            >
              All
            </Link>
            {categories.map((c) => (
              <Link
                key={c.category}
                href={href({ cat: c.category })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted",
                  category === c.category && "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {c.category} <span className="opacity-60">{c.n}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {list.total.toLocaleString()} sign{list.total === 1 ? "" : "s"}
          {q ? ` matching “${q}”` : ""}
          {category ? ` in ${category}` : ""}
          {composite ? (
            <>
              {" "}·{" "}
              <Link href={href({ all: !all })} className="underline-offset-4 hover:underline">
                {all ? "show only encoded base signs" : "include unencoded signs and variant forms"}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {list.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No signs match.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8" dir="ltr">
          {list.rows.map((s) => (
            <SignTile key={s.id} sign={s} />
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} nativeButton={false} render={<Link href={href({ page: page - 1 })} />}>
            Previous
          </Button>
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} nativeButton={false} render={<Link href={href({ page: page + 1 })} />}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

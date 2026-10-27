import type { Metadata } from "next"
import Link from "next/link"
import { countSigns, listSigns } from "@workspace/db"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { DbProblem } from "@/components/db-problem"
import { SignTile } from "@/components/sign-tile"
import { first, withDb } from "@/lib/data"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Cuneiform signs" }

const PAGE_SIZE = 120

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function SignsPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = first(sp.q)?.trim() ?? ""
  const page = Math.max(1, Number(first(sp.page) ?? "1") || 1)
  const all = first(sp.all) === "1"

  const result = await withDb(async (db) => ({
    list: await listSigns(db, { q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, encodedOnly: !all, formsToo: all }),
    counts: await countSigns(db),
  }))
  if (!result.ok) return <DbProblem result={result} />
  const { list, counts } = result.data
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE))
  const href = (p: number) => {
    const u = new URLSearchParams()
    if (q) u.set("q", q)
    if (all) u.set("all", "1")
    if (p > 1) u.set("page", String(p))
    const s = u.toString()
    return `/signs${s ? `?${s}` : ""}`
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Cuneiform signs</h1>
        <p className="max-w-3xl text-muted-foreground">
          Every sign of the Oracc Sign List: {counts.encoded.toLocaleString()} encoded in Unicode, {counts.total.toLocaleString()} including
          unencoded signs and variant forms, {counts.readings.toLocaleString()} readings. Search by reading (lugal, ag2, šar),
          by sign name (LUGAL, |SAL.TUG₂|) or paste a glyph.
        </p>
        <form action="/signs" method="get" className="flex max-w-xl items-center gap-2" role="search">
          {all ? <input type="hidden" name="all" value="1" /> : null}
          <Input type="search" name="q" defaultValue={q} placeholder="lugal, ag2, LUGAL, 𒈗 …" aria-label="Search signs" className="h-10" />
          <Button type="submit">Search</Button>
        </form>
        <p className="text-sm text-muted-foreground">
          {list.total.toLocaleString()} sign{list.total === 1 ? "" : "s"}
          {q ? ` matching “${q}”` : ""} ·{" "}
          {all ? (
            <Link href={href(1).replace("all=1", "").replace(/[?&]$/, "")} className="underline-offset-4 hover:underline">
              show only encoded base signs
            </Link>
          ) : (
            <Link href={`${href(1)}${href(1).includes("?") ? "&" : "?"}all=1`} className="underline-offset-4 hover:underline">
              include unencoded signs and variant forms
            </Link>
          )}
        </p>
      </header>

      {list.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No signs match.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
          {list.rows.map((s) => (
            <SignTile key={s.id} sign={s} />
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} nativeButton={false} render={<Link href={href(page - 1)} />}>
            Previous
          </Button>
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} nativeButton={false} render={<Link href={href(page + 1)} />}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

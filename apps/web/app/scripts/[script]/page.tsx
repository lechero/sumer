import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { countSigns, getScript, listSignCategories, listSigns } from "@workspace/db"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { DbProblem } from "@/components/db-problem"
import { HeroGlyph, PageHero } from "@/components/page-hero"
import { SignTile } from "@/components/sign-tile"
import { first, withDb } from "@/lib/data"
import { COMPOSITE_SCRIPTS, scriptFontClass, scriptHref } from "@/lib/scripts"

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
  // a letter for the hero, not a combining mark floating on its own (Devanagari lists its signs first)
  const sample = list.rows.find((r) => r.unicode && !/^\p{M}/u.test(r.unicode))?.unicode
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active ? "border-transparent bg-linear-to-br from-violet to-ember text-white" : "glass text-muted-foreground hover:border-violet/50 hover:text-foreground"
    )
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
      <PageHero
        eyebrow={
          <>
            <Link href="/scripts" className="hover:text-(--hero-ink)">Scripts</Link>
            <span className="opacity-60">/</span>
            <span>{script.kind ?? "script"}</span>
          </>
        }
        title={script.name}
        lede={script.description}
        art={
          sample ? (
            <HeroGlyph className={cn(scriptFontClass(scriptId), "text-7xl text-amber sm:text-8xl")}>
              <span dir={script.direction}>{sample}</span>
            </HeroGlyph>
          ) : undefined
        }
        stats={[
          { label: "Signs", value: counts.encoded.toLocaleString(), featured: true, note: counts.total !== counts.encoded ? `${counts.total.toLocaleString()} with unencoded and forms` : "with a glyph" },
          ...(counts.readings ? [{ label: "Readings", value: counts.readings.toLocaleString() }] : []),
          ...(script.period ? [{ label: "Period", value: script.period }] : []),
          ...(script.region ? [{ label: "Region", value: script.region }] : []),
          ...(script.unicodeRange ? [{ label: "Unicode", value: <span className="font-mono text-sm">{script.unicodeRange}</span>, note: [script.iso15924, script.direction === "rtl" ? "right to left" : null].filter(Boolean).join(" · ") || undefined }] : []),
        ]}
      >
        <form
          action={scriptHref(scriptId)}
          method="get"
          role="search"
          className="glass flex max-w-xl items-center gap-2 rounded-full p-1.5 pl-5 focus-within:border-violet/60"
        >
          {all ? <input type="hidden" name="all" value="1" /> : null}
          {category ? <input type="hidden" name="cat" value={category} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={PLACEHOLDER[scriptId] ?? "reading, name or glyph …"}
            aria-label={`Search ${script.name} signs`}
            className="h-10 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" className="btn-glow h-10 shrink-0 px-6 text-sm">
            Search
          </button>
        </form>
      </PageHero>

      <div className="space-y-3">
        {categories.length > 1 ? (
          <nav aria-label="Categories" className="flex flex-wrap gap-1.5">
            <Link href={href({ cat: null })} className={chip(!category)}>
              All
            </Link>
            {categories.map((c) => (
              <Link key={c.category} href={href({ cat: c.category })} className={chip(category === c.category)}>
                {c.category} <span className="ml-1 opacity-70">{c.n}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        <p className="font-mono text-xs text-muted-foreground">
          {list.total.toLocaleString()} sign{list.total === 1 ? "" : "s"}
          {q ? ` matching “${q}”` : ""}
          {category ? ` in ${category}` : ""}
          {composite ? (
            <>
              {" "}·{" "}
              <Link href={href({ all: !all })} className="underline-offset-4 hover:text-foreground hover:underline">
                {all ? "show only encoded base signs" : "include unencoded signs and variant forms"}
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {list.rows.length === 0 ? (
        <p className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">No signs match.</p>
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

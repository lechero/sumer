import type { Metadata } from "next"
import Link from "next/link"
import { listScripts } from "@workspace/db"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { DbProblem } from "@/components/db-problem"
import { withDb } from "@/lib/data"
import { scriptFontClass, scriptHref } from "@/lib/scripts"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Scripts" }

export default async function ScriptsPage() {
  const result = await withDb((db) => listScripts(db))
  if (!result.ok) return <DbProblem result={result} />
  const scripts = result.data.filter((s) => s.signCount > 0)
  const total = scripts.reduce((n, s) => n + s.signCount + s.formCount, 0)

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Writing systems</h1>
        <p className="max-w-3xl text-muted-foreground">
          {total.toLocaleString()} signs in {scripts.length} scripts, from the proto-cuneiform tablets of Uruk to the runes and ogham of
          northern Europe: each sign with its glyph, sign-list numbers and readings. Cuneiform comes from the Oracc Sign List,
          proto-cuneiform from Oracc&apos;s PCSL, hieroglyphs from Unicode&apos;s Unikemet database, the alphabets and syllabaries from
          the Unicode Character Database.
        </p>
      </header>
      {scripts.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No signs yet. Run <code className="font-mono">task import -- osl pcsl unikemet alphabets</code>.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scripts.map((s) => (
            <Link key={s.id} href={scriptHref(s.id)} className="group">
              <Card className="h-full transition-colors group-hover:bg-muted/50">
                <CardHeader>
                  <CardTitle>{s.name}</CardTitle>
                  <CardDescription>{[s.kind, s.period].filter(Boolean).join(" · ")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {s.sample ? (
                    <p
                      className={`${scriptFontClass(s.id)} truncate text-3xl leading-tight`}
                      dir={s.direction}
                      aria-hidden
                    >
                      {[...s.sample].slice(0, 12).join("")}
                    </p>
                  ) : null}
                  {s.description ? <p className="line-clamp-3 text-sm text-muted-foreground">{s.description}</p> : null}
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{s.signCount.toLocaleString()} signs</Badge>
                    {s.formCount ? <Badge variant="outline">{s.formCount.toLocaleString()} variant forms</Badge> : null}
                    {s.iso15924 ? <Badge variant="outline" className="font-mono">{s.iso15924}</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

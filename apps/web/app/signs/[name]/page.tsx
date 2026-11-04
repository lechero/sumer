import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getSignByName, listEntriesWithGlyph } from "@workspace/db"
import { isFullyEncoded } from "@workspace/db/glyphs"
import { Badge } from "@workspace/ui/components/badge"

import { DbProblem } from "@/components/db-problem"
import { EntryTable } from "@/components/entry-table"
import { drawnMatch, isDrawable, SignFace } from "@/components/sign-face"
import { signHref } from "@/components/sign-tile"
import { withDb } from "@/lib/data"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ name: string }> }

const LIST_NAMES: Record<string, string> = {
  MZL: "Borger, Mesopotamisches Zeichenlexikon (2004)",
  ABZ: "Borger, Assyrisch-babylonische Zeichenliste (1978)",
  ABZL: "Mittermayer, Altbabylonische Zeichenliste (2006)",
  LAK: "Deimel, Liste der archaischen Keilschriftzeichen (1922)",
  HZL: "Rüster & Neu, Hethitisches Zeichenlexikon (1989)",
  KWU: "Schneider, Keilschriftzeichen der Wirtschaftsurkunden von Ur III (1935)",
  ELLES: "Mander, Ebla sign list (1981)",
  BAU: "Burrows, Archaic Texts (UET 2, 1935)",
  ASY: "von Soden & Röllig, Das akkadische Syllabar (1991)",
  GCSL: "Gudea corpus sign list (after Price 1899)",
  SLLHA: "Labat, Manuel d'épigraphie akkadienne",
  RSP: "Rosengarten, Répertoire commenté des signes présargoniques",
  PTACE: "Proto-cuneiform / archaic sign list",
  SYA: "Syllabaire d'Alalakh?",
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params
  return { title: `${decodeURIComponent(name)} · sign` }
}

export default async function SignPage({ params }: Props) {
  const { name: raw } = await params
  const name = decodeURIComponent(raw)
  const result = await withDb(async (db) => {
    const sign = await getSignByName(db, name)
    if (!sign) return null
    const usedIn = isFullyEncoded(sign.unicode) ? await listEntriesWithGlyph(db, sign.unicode!, 80) : []
    return { sign, usedIn }
  })
  if (!result.ok) return <DbProblem result={result} />
  if (!result.data) notFound()
  const { sign, usedIn } = result.data
  const readings = sign.readings.filter((r) => !r.isDeprecated)
  const sumerian = readings.filter((r) => !r.language)
  const other = readings.filter((r) => r.language)
  const deprecated = sign.readings.filter((r) => r.isDeprecated)

  return (
    <article className="space-y-10">
      <header className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <Link href="/signs" className="hover:text-foreground">Signs</Link> / {sign.name}
          {sign.parent ? (
            <>
              {" "}· variant of{" "}
              <Link href={signHref(sign.parent.name)} className="hover:text-foreground">{sign.parent.name}</Link>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-end gap-8">
          <div className="max-w-full text-[5rem] leading-none break-all sm:text-[9rem]" lang="sux">
            <SignFace unicode={sign.unicode} components={sign.components} />
          </div>
          <div className="min-w-0 max-w-full space-y-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight break-all sm:text-3xl">{sign.name}</h1>
            {sign.unicodeName ? <p className="text-muted-foreground">{sign.unicodeName}</p> : null}
            <div className="flex flex-wrap gap-1">
              {sign.codepoints?.map((cp) => (
                <Badge key={cp} variant="outline" className="font-mono">{cp}</Badge>
              ))}
              {sign.unicodeVersion ? <Badge variant="secondary">Unicode {sign.unicodeVersion}</Badge> : null}
              {sign.isForm ? <Badge variant="secondary">variant form</Badge> : null}
              {!isFullyEncoded(sign.unicode) ? (
                <Badge variant="secondary">{sign.unicode?.trim() ? "partly encoded" : "not encoded"}</Badge>
              ) : !isDrawable(sign.unicode) ? (
                <Badge variant="secondary">no font glyph yet</Badge>
              ) : null}
            </div>
            {sign.aliases?.length ? <p className="text-sm text-muted-foreground">Also called {sign.aliases.join(", ")}</p> : null}
          </div>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-10">
          <section className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Readings</h2>
            {sumerian.length === 0 && other.length === 0 ? (
              <p className="text-sm text-muted-foreground">No readings recorded.</p>
            ) : null}
            {sumerian.length ? (
              <ul className="flex flex-wrap gap-2">
                {sumerian.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/search?q=${encodeURIComponent(r.value)}`}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm hover:bg-muted"
                    >
                      {r.value}
                      {r.isUncertain ? <span className="text-muted-foreground">?</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {other.length ? (
              <div className="space-y-1">
                <h3 className="text-xs text-muted-foreground">Values in other languages</h3>
                <ul className="flex flex-wrap gap-2">
                  {other.map((r) => (
                    <li key={r.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
                      <span className="text-xs text-muted-foreground">{r.language}</span> {r.value}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {deprecated.length ? (
              <p className="text-xs text-muted-foreground">Deprecated readings: {deprecated.map((r) => r.value).join(", ")}</p>
            ) : null}
          </section>

          {sign.components?.some((c) => c.kind === "sign") ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Components</h2>
              <ol className="flex flex-wrap items-center gap-2">
                {sign.components.map((c, i) => {
                  if (c.kind === "op") return <li key={i} className="font-mono text-sm text-muted-foreground">{c.text}</li>
                  // Link to the component itself when it is in the sign list; draw it as its base sign if it has no glyph.
                  const target = c.matches[0]
                  const drawn = drawnMatch(c)
                  const approximate = drawn && drawn.name !== c.name
                  return (
                    <li key={i}>
                      {target ? (
                        <Link
                          href={signHref(target.name)}
                          className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm hover:bg-muted"
                          title={approximate ? `${c.name} has no glyph of its own; drawn as ${drawn.name}` : undefined}
                        >
                          <span className="text-2xl leading-none"><SignFace unicode={drawn?.unicode ?? target.unicode} /></span>
                          <span className="font-mono text-xs">{c.name}</span>
                          {approximate ? <span className="text-xs text-muted-foreground">≈ {drawn.name}</span> : null}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center rounded-md border border-dashed px-2 py-1 font-mono text-xs text-muted-foreground">{c.name}</span>
                      )}
                    </li>
                  )
                })}
              </ol>
              {!isDrawable(sign.unicode) ? (
                <p className="text-xs text-muted-foreground">
                  {isFullyEncoded(sign.unicode)
                    ? "None of the bundled Oracc fonts draws this code point yet, so the sign is shown through its components."
                    : "This sign has no Unicode code point of its own, so it is shown through its components."}
                </p>
              ) : null}
            </section>
          ) : null}

          {sign.forms.length ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Variant forms</h2>
              <ul className="flex flex-wrap gap-2">
                {sign.forms.map((f) => (
                  <li key={f.id}>
                    <Link href={signHref(f.name)} className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm hover:bg-muted">
                      <span className="text-2xl leading-none"><SignFace unicode={f.unicode} /></span>
                      <span className="font-mono text-xs">{f.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Words written with this sign{usedIn.length ? ` (${usedIn.length}${usedIn.length >= 80 ? "+" : ""})` : ""}
            </h2>
            <EntryTable rows={usedIn} emptyMessage="No dictionary entry uses this glyph yet." />
          </section>

          {sign.notes ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Notes</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{sign.notes}</p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          {sign.listNumbers ? (
            <section className="space-y-2">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Sign lists</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(sign.listNumbers).map(([list, nums]) => (
                  <div key={list} className="contents">
                    <dt className="font-mono" title={LIST_NAMES[list]}>{list}</dt>
                    <dd>{nums.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {sign.links?.length ? (
            <section className="space-y-2">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Elsewhere</h2>
              <ul className="space-y-1 text-sm">
                {sign.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{l.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Source</h2>
            <p className="text-sm">
              {sign.source?.url ? <a href={sign.source.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{sign.source.title}</a> : sign.source?.title}
            </p>
            {sign.oid ? <p className="font-mono text-xs text-muted-foreground">{sign.oid}</p> : null}
            {sign.source?.license ? <p className="text-xs text-muted-foreground">Licence: {sign.source.license}</p> : null}
          </section>
        </aside>
      </div>
    </article>
  )
}

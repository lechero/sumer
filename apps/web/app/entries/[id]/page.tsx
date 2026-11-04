import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getEntryById, getGlyphBreakdown, getSignsForText, type EntryDetail, type RelationType } from "@workspace/db"
import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"

import { DbProblem } from "@/components/db-problem"
import { KindBadge, PosBadge } from "@/components/entry-badges"
import { EntryLink } from "@/components/entry-link"
import { GlyphBreakdown } from "@/components/glyph-breakdown"
import { NativeText } from "@/components/native-text"
import { SignBreakdown } from "@/components/sign-breakdown"
import { UUID_RE, withDb } from "@/lib/data"
import { RELATION_FROM_LABEL, RELATION_TO_LABEL } from "@/lib/labels"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

async function load(id: string) {
  if (!UUID_RE.test(id)) return { ok: true as const, data: undefined }
  return withDb(async (db) => {
    const entry = await getEntryById(db, id)
    if (!entry) return undefined
    // Cuneiform and hieroglyphs have sign lists: break the native script down into its signs.
    const signScript = entry.language.script === "Egyp" ? "egyptian-hieroglyphs" : "cuneiform"
    const signsByGlyph = entry.nativeScript ? await getSignsForText(db, entry.nativeScript, signScript) : new Map()
    // Cuneiform spelled out sign by sign, with each reading's meaning (when the spelling resolves).
    const breakdown = entry.language.script === "Xsux" ? await getGlyphBreakdown(db, entry) : undefined
    return { entry, signsByGlyph, breakdown }
  })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const r = await load(id)
  if (!r.ok || !r.data) return { title: "Entry" }
  const e = r.data.entry
  return { title: `${e.headword} — ${e.gloss} (${e.language.name})` }
}

function groupByType<T extends { type: RelationType }>(rows: T[]) {
  const map = new Map<RelationType, T[]>()
  for (const r of rows) map.set(r.type, [...(map.get(r.type) ?? []), r])
  return [...map.entries()]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export default async function EntryPage({ params }: Props) {
  const { id } = await params
  const r = await load(id)
  if (!r.ok) return <DbProblem result={r} />
  const entry: EntryDetail | undefined = r.data?.entry
  if (!entry || !r.data) notFound()
  const { signsByGlyph, breakdown } = r.data

  const lang = entry.language
  const isCuneiform = lang.script === "Xsux"
  const outgoing = groupByType(entry.relationsFrom)
  const incoming = groupByType(entry.relationsTo)

  return (
    <article className="space-y-10">
      <header className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Languages</Link> /{" "}
          <Link href={`/languages/${lang.id}`} className="hover:text-foreground">{lang.name}</Link> /{" "}
          <Link href={`/languages/${lang.id}?kind=${entry.kind}`} className="hover:text-foreground">
            {entry.kind === "part" ? "word parts" : "words"}
          </Link>
        </p>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {entry.nativeScript && entry.nativeScript !== entry.headword ? (
            <NativeText
              as="div"
              text={entry.nativeScript}
              script={lang.script}
              direction={lang.direction}
              className={isCuneiform ? "text-6xl leading-none" : "text-4xl"}
            />
          ) : null}
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              <NativeText text={entry.headword} script={lang.script} direction={lang.direction} />
              {entry.homonymIndex > 1 ? <sup className="ml-1 text-lg text-muted-foreground">{entry.homonymIndex}</sup> : null}
            </h1>
            {entry.transliteration ? <p className="text-lg text-muted-foreground">{entry.transliteration}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{lang.name}</Badge>
          <KindBadge entry={entry} />
          <PosBadge pos={entry.partOfSpeech} />
        </div>

        <p className="text-xl">{entry.gloss}</p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-10">
          {entry.definition || entry.senses.length > 0 ? (
            <Section title="Meaning">
              {entry.definition ? <p className="leading-relaxed">{entry.definition}</p> : null}
              {entry.senses.length > 0 ? (
                <ol className="list-decimal space-y-1 pl-6">
                  {entry.senses.map((s) => (
                    <li key={s.id}>
                      <span>{s.gloss}</span>
                      {s.definition ? <span className="text-muted-foreground"> — {s.definition}</span> : null}
                      {s.domain ? <Badge variant="outline" className="ml-2 align-middle">{s.domain}</Badge> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </Section>
          ) : null}

          {entry.etymology ? (
            <Section title="Etymology">
              <p className="leading-relaxed">{entry.etymology}</p>
            </Section>
          ) : null}

          {entry.notes ? (
            <Section title="Notes">
              <p className="leading-relaxed text-muted-foreground">{entry.notes}</p>
            </Section>
          ) : null}

          {breakdown ? (
            <Section title="Sign by sign">
              <SignBreakdown parts={breakdown} />
            </Section>
          ) : (isCuneiform || lang.script === "Egyp") && entry.nativeScript ? (
            <Section title="Signs">
              <GlyphBreakdown
                text={entry.nativeScript}
                signsByGlyph={signsByGlyph}
                script={lang.script === "Egyp" ? "egyptian-hieroglyphs" : "cuneiform"}
              />
            </Section>
          ) : null}

          {entry.components.length > 0 ? (
            <Section title="Built from">
              <ol className="space-y-2">
                {entry.components.map((c) => (
                  <li key={c.id} className="flex items-start gap-3">
                    <span className="mt-2 w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{c.position + 1}.</span>
                    <div className="flex-1 space-y-1">
                      <EntryLink entry={c.component} showLanguage={c.component.languageId !== lang.id} />
                      {c.role || c.note ? (
                        <p className="pl-3 text-xs text-muted-foreground">
                          {c.role ? <span className="font-medium">{c.role}</span> : null}
                          {c.role && c.note ? " · " : null}
                          {c.note}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          {entry.usedIn.length > 0 ? (
            <Section title={`Used in ${entry.usedIn.length} ${entry.usedIn.length === 1 ? "entry" : "entries"}`}>
              <ul className="grid gap-2 sm:grid-cols-2">
                {entry.usedIn.map((u) => (
                  <li key={u.id}>
                    <EntryLink entry={u.entry} showLanguage={u.entry.languageId !== lang.id} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {outgoing.length > 0 || incoming.length > 0 ? (
            <Section title="Connections">
              <div className="space-y-5">
                {outgoing.map(([type, rows]) => (
                  <div key={`from-${type}`} className="space-y-2">
                    <h3 className="text-sm font-medium">{RELATION_FROM_LABEL[type]}</h3>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {rows.map((rel) => (
                        <li key={rel.id} className="space-y-1">
                          <EntryLink entry={rel.to} />
                          <RelationMeta confidence={rel.confidence} note={rel.note} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {incoming.map(([type, rows]) => (
                  <div key={`to-${type}`} className="space-y-2">
                    <h3 className="text-sm font-medium">{RELATION_TO_LABEL[type]}</h3>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {rows.map((rel) => (
                        <li key={rel.id} className="space-y-1">
                          <EntryLink entry={rel.from} />
                          <RelationMeta confidence={rel.confidence} note={rel.note} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Section title="Source">
            {entry.source ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {entry.source.url ? (
                    <a href={entry.source.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      {entry.source.title}
                    </a>
                  ) : (
                    entry.source.title
                  )}
                </p>
                {entry.sourceRef ? <p className="font-mono text-xs text-muted-foreground">{entry.sourceRef}</p> : null}
                {entry.source.license ? <p className="text-xs text-muted-foreground">Licence: {entry.source.license}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No source recorded.</p>
            )}
          </Section>
          <Separator />
          <Section title="Record">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>id</dt><dd className="font-mono break-all">{entry.id}</dd>
              <dt>search key</dt><dd className="font-mono">{entry.searchKey}</dd>
              <dt>updated</dt><dd>{entry.updatedAt.toISOString().slice(0, 10)}</dd>
              <dt>JSON</dt><dd><a href={`/api/entries/${entry.id}`} className="underline-offset-4 hover:underline">/api/entries/{entry.id.slice(0, 8)}…</a></dd>
            </dl>
          </Section>
        </aside>
      </div>
    </article>
  )
}

function RelationMeta({ confidence, note }: { confidence: "certain" | "likely" | "debated"; note: string | null }) {
  if (confidence === "certain" && !note) return null
  return (
    <p className="pl-3 text-xs text-muted-foreground">
      {confidence !== "certain" ? <span className="font-medium">{confidence}</span> : null}
      {confidence !== "certain" && note ? " · " : null}
      {note}
    </p>
  )
}

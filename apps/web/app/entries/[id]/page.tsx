import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getCuneiformSigns,
  getEntryById,
  getGlyphBreakdown,
  getHieroglyphBreakdown,
  getLetterBreakdown,
  getThesaurus,
  getWordAnatomy,
  type EntryDetail,
  type RelationType,
} from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { Chip } from "@/components/chip"
import { DbProblem } from "@/components/db-problem"
import { KindBadge, PosBadge } from "@/components/entry-badges"
import { EntryLink } from "@/components/entry-link"
import { HieroglyphBreakdown } from "@/components/hieroglyph-breakdown"
import { LetterBreakdown } from "@/components/letter-breakdown"
import { NativeText } from "@/components/native-text"
import { HeroGlyph, PageHero } from "@/components/page-hero"
import { Section } from "@/components/section"
import { CuneiformSigns, SignBreakdown } from "@/components/sign-breakdown"
import { hasThesaurus, Thesaurus } from "@/components/thesaurus"
import { hasAnatomy, WordAnatomy } from "@/components/word-anatomy"
import { UUID_RE, withDb } from "@/lib/data"
import { KIND_LABEL, RELATION_FROM_LABEL, RELATION_TO_LABEL } from "@/lib/labels"

export const dynamic = "force-dynamic"

/** Usages listed before the rest fold away behind "Show N more". */
const USED_IN_SHOWN = 24

type Props = { params: Promise<{ id: string }> }

async function load(id: string) {
  if (!UUID_RE.test(id)) return { ok: true as const, data: undefined }
  return withDb(async (db) => {
    const entry = await getEntryById(db, id)
    if (!entry) return undefined
    const script = entry.language.script
    // the text to break down: the native script, or the headword when it is written in it (Greek, Hebrew, Coptic)
    const text = entry.nativeScript ?? (script !== "Latn" ? entry.headword : null)
    const [spelling, thesaurus, anatomy, hieroglyphs, letters] = await Promise.all([
      // cuneiform spelled out sign by sign, with each reading's meaning (when the spelling resolves)
      script === "Xsux" ? getGlyphBreakdown(db, entry) : undefined,
      getThesaurus(db, entry),
      getWordAnatomy(db, entry),
      script === "Egyp" ? getHieroglyphBreakdown(db, entry) : undefined,
      text && script !== "Xsux" && script !== "Egyp" ? getLetterBreakdown(db, text, script) : undefined,
    ])
    // otherwise its signs one by one: Sumerograms in Akkadian and Hittite words
    const cuneiform = script === "Xsux" && !spelling ? await getCuneiformSigns(db, entry) : undefined
    return { entry, spelling, cuneiform, hieroglyphs, letters, thesaurus, anatomy }
  })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const r = await load(id)
  if (!r.ok || !r.data) return { title: "Entry" }
  const e = r.data.entry
  return { title: `${e.headword} — ${e.gloss} (${e.language.name})` }
}

/** Shown in the Thesaurus instead: synonyms, antonyms and same-language "see also". */
function inThesaurus(type: RelationType, otherLanguageId: string, languageId: string): boolean {
  return type === "synonym_of" || type === "antonym_of" || (type === "see_also" && otherLanguageId === languageId)
}

function groupByType<T extends { type: RelationType }>(rows: T[]) {
  const map = new Map<RelationType, T[]>()
  for (const r of rows) map.set(r.type, [...(map.get(r.type) ?? []), r])
  return [...map.entries()]
}

/** Headline size by length: a 3-letter root fills the hero, a 40-letter Sanskrit title still fits. */
function titleSize(text: string): string | undefined {
  const n = [...text].length
  if (n > 40) return "text-2xl sm:text-3xl"
  if (n > 22) return "text-3xl sm:text-4xl"
  if (n > 12) return "text-4xl sm:text-5xl"
  return "text-5xl sm:text-7xl"
}

function glyphSize(text: string, script: string): string {
  const n = [...text].length
  const big = script === "Xsux" || script === "Egyp"
  if (n > 16) return "text-3xl sm:text-4xl"
  if (n > 8) return big ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"
  if (n > 3) return big ? "text-6xl sm:text-7xl" : "text-5xl sm:text-6xl"
  return big ? "text-7xl sm:text-[8rem]" : "text-6xl sm:text-8xl"
}

export default async function EntryPage({ params }: Props) {
  const { id } = await params
  const r = await load(id)
  if (!r.ok) return <DbProblem result={r} />
  const entry: EntryDetail | undefined = r.data?.entry
  if (!entry || !r.data) notFound()
  const { spelling, cuneiform, hieroglyphs, letters, thesaurus, anatomy } = r.data

  const lang = entry.language
  // the ancestry tree shows the first derived-from / borrowed-from links; Connections keeps the rest
  const inAncestry = new Set(anatomy.ancestry.map((a) => a.entry.id))
  const outgoing = groupByType(
    entry.relationsFrom.filter((rel) => !inThesaurus(rel.type, rel.to.languageId, lang.id) && !((rel.type === "derived_from" || rel.type === "loan_from") && inAncestry.has(rel.to.id)))
  )
  const incoming = groupByType(entry.relationsTo.filter((rel) => !inThesaurus(rel.type, rel.from.languageId, lang.id)))
  const linkCount = [...outgoing, ...incoming].reduce((n, [, rows]) => n + rows.length, 0)
  const thesaurusCount =
    thesaurus.synonyms.length + thesaurus.antonyms.length + thesaurus.related.length + thesaurus.sameMeaning.length + thesaurus.otherLanguages.reduce((n, g) => n + g.words.length, 0)
  const showNative = !!entry.nativeScript && entry.nativeScript !== entry.headword
  const signCount = spelling?.length ?? cuneiform?.signs.length ?? hieroglyphs?.parts.length ?? (letters ? letters.words.flat().length : 0)

  // sections in reading order; the ones with something to show are numbered 01, 02 …
  const sections: { id: string; title: string; hint?: React.ReactNode; extra?: React.ReactNode; body: React.ReactNode }[] = []
  if (entry.definition || entry.senses.length > 0)
    sections.push({
      id: "meaning",
      title: "Meaning",
      body: (
        <div className="space-y-4">
          {entry.definition ? <p className="max-w-[70ch] text-lg leading-relaxed text-ink-2">{entry.definition}</p> : null}
          {entry.senses.length > 0 ? (
            <ol className="glass divide-y overflow-hidden rounded-2xl">
              {entry.senses.map((s, i) => (
                <li key={s.id} className="flex items-baseline gap-3 px-4 py-2.5">
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-violet">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{s.gloss}</span>
                    {s.definition ? <span className="text-muted-foreground"> — {s.definition}</span> : null}
                  </div>
                  {/* ePSD2 numbers its senses in the domain field ("sense 1.") */}
                  {s.domain && !/^sense \d+\.?$/i.test(s.domain) ? <Chip tone="sky">{s.domain}</Chip> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ),
    })
  if (entry.etymology)
    sections.push({
      id: "etymology",
      title: "Etymology",
      body: (
        <p className="glass max-w-[75ch] rounded-2xl border-l-4 border-l-amber px-5 py-4 leading-relaxed">{entry.etymology}</p>
      ),
    })
  if (entry.notes)
    sections.push({
      id: "notes",
      title: "Notes",
      body: <p className="max-w-[75ch] leading-relaxed text-muted-foreground">{entry.notes}</p>,
    })
  if (spelling)
    sections.push({
      id: "signs",
      title: "Sign by sign",
      hint: "Each sign of the cuneiform with its reading in this word, what it means, its other values and its numbers in the sign lists.",
      body: <SignBreakdown parts={spelling} />,
    })
  else if (cuneiform)
    sections.push({
      id: "signs",
      title: "Sign by sign",
      hint: lang.id === "sux" ? "The signs of the cuneiform with their values." : "Written with Sumerian word signs (Sumerograms): each sign with the Sumerian word it stands for.",
      body: <CuneiformSigns data={cuneiform} />,
    })
  else if (hieroglyphs)
    sections.push({
      id: "signs",
      title: "Hieroglyph by hieroglyph",
      hint: "Each sign with its Gardiner number, what it shows, its sound values and its part in the spelling.",
      body: <HieroglyphBreakdown data={hieroglyphs} />,
    })
  else if (letters)
    sections.push({
      id: "letters",
      title: letters.script.kind?.includes("syllab") ? "Sign by sign" : "Letter by letter",
      hint: `Each ${letters.script.kind === "abugida" ? "syllable (akshara)" : "letter"} of the ${letters.script.name} with its name, its sound and the marks on it.`,
      body: <LetterBreakdown data={letters} direction={lang.direction} />,
    })
  if (hasAnatomy(anatomy))
    sections.push({
      id: "anatomy",
      title: "Word anatomy",
      hint: "What it is built from, down to its smallest parts, and the words it comes from.",
      body: <WordAnatomy anatomy={anatomy} entry={{ ...entry, language: lang }} />,
    })
  if (entry.usedIn.length > 0)
    sections.push({
      id: "used-in",
      title: "Used in",
      extra: <span className="font-mono text-xs">{entry.usedIn.length.toLocaleString()} {entry.usedIn.length === 1 ? "entry" : "entries"}</span>,
      body: (
        <div className="space-y-3">
          <ul className="grid gap-2 sm:grid-cols-2">
            {entry.usedIn.slice(0, USED_IN_SHOWN).map((u) => (
              <li key={u.id} className="min-w-0">
                <EntryLink entry={u.entry} showLanguage={u.entry.languageId !== lang.id} />
              </li>
            ))}
          </ul>
          {/* roots and common words head hundreds of compounds (Sanskrit अग्नि: 251) */}
          {entry.usedIn.length > USED_IN_SHOWN ? (
            <details className="group">
              <summary className="glass inline-flex cursor-pointer list-none rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:border-violet/50 hover:text-foreground">
                <span className="group-open:hidden">Show {entry.usedIn.length - USED_IN_SHOWN} more</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {entry.usedIn.slice(USED_IN_SHOWN).map((u) => (
                  <li key={u.id} className="min-w-0">
                    <EntryLink entry={u.entry} showLanguage={u.entry.languageId !== lang.id} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ),
    })
  if (hasThesaurus(thesaurus))
    sections.push({ id: "thesaurus", title: "Thesaurus", body: <Thesaurus thesaurus={thesaurus} /> })
  if (outgoing.length > 0 || incoming.length > 0)
    sections.push({
      id: "connections",
      title: "Connections",
      extra: <span className="font-mono text-xs">{linkCount.toLocaleString()} links</span>,
      body: (
        <div className="space-y-6">
          {[
            ...outgoing.map(([type, rows]) => ({ key: `from-${type}`, label: RELATION_FROM_LABEL[type], items: rows.map((rel) => ({ id: rel.id, entry: rel.to, confidence: rel.confidence, note: rel.note })) })),
            ...incoming.map(([type, rows]) => ({ key: `to-${type}`, label: RELATION_TO_LABEL[type], items: rows.map((rel) => ({ id: rel.id, entry: rel.from, confidence: rel.confidence, note: rel.note })) })),
          ].map((g) => (
            <div key={g.key} className="space-y-2">
              <h3 className="flex items-baseline gap-2">
                <span className="eyebrow text-foreground">{g.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{g.items.length}</span>
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {g.items.map((it) => (
                  <li key={it.id} className="min-w-0 space-y-1">
                    <EntryLink entry={it.entry} />
                    <RelationMeta confidence={it.confidence} note={it.note} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ),
    })

  const kindHref = `/languages/${lang.id}?kind=${entry.kind}`
  return (
    <article className="space-y-10">
      <PageHero
        eyebrow={
          <>
            <Link href="/" className="hover:text-(--hero-ink)">Languages</Link>
            <span className="opacity-60">/</span>
            <Link href={`/languages/${lang.id}`} className="hover:text-(--hero-ink)">{lang.name}</Link>
            <span className="opacity-60">/</span>
            <Link href={kindHref} className="hover:text-(--hero-ink)">{entry.kind === "part" ? "word parts" : "words"}</Link>
          </>
        }
        titleClassName={titleSize(entry.headword)}
        title={
          <>
            <NativeText text={entry.headword} script={lang.script} direction={lang.direction} />
            {entry.homonymIndex > 1 ? <sup className="ml-1 text-[0.45em] text-(--hero-dim)">{entry.homonymIndex}</sup> : null}
          </>
        }
        lede={
          <div className="space-y-1">
            {entry.transliteration && entry.transliteration !== entry.headword ? (
              <p className="font-mono text-base text-(--hero-dim)">{entry.transliteration}</p>
            ) : null}
            <p className="text-xl text-(--hero-ink) sm:text-2xl">{entry.gloss}</p>
          </div>
        }
        art={
          showNative ? (
            <HeroGlyph className={cn("max-w-[22rem] text-center text-amber", glyphSize(entry.nativeScript!, lang.script))}>
              <NativeText text={entry.nativeScript} script={lang.script} direction={lang.direction} />
            </HeroGlyph>
          ) : undefined
        }
        stats={[
          { label: "Language", value: lang.name, note: lang.family ?? undefined, featured: true },
          { label: "Kind", value: entry.kind === "part" && entry.partKind ? entry.partKind : KIND_LABEL[entry.kind], note: entry.partOfSpeech?.replace("_", " ") ?? undefined },
          ...(entry.senses.length ? [{ label: "Senses", value: entry.senses.length }] : []),
          ...(signCount ? [{ label: letters ? "Letters" : "Signs", value: signCount, note: letters?.reading ?? undefined }] : []),
          ...(entry.components.length ? [{ label: "Built from", value: entry.components.length, note: "parts" }] : []),
          ...(entry.usedIn.length ? [{ label: "Used in", value: entry.usedIn.length.toLocaleString(), note: "entries" }] : []),
          ...(thesaurusCount ? [{ label: "Thesaurus", value: thesaurusCount, note: "related words" }] : []),
          ...(linkCount ? [{ label: "Links", value: linkCount, note: "cognates, loans …" }] : []),
        ]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge entry={entry} />
          <PosBadge pos={entry.partOfSpeech} />
          {entry.source ? <span className="min-w-0 max-w-full truncate text-xs text-(--hero-dim)">{entry.source.title}</span> : null}
        </div>
      </PageHero>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-12">
          {sections.map((s, i) => (
            <Section key={s.id} id={s.id} num={i + 1} title={s.title} hint={s.hint} extra={s.extra} className="scroll-mt-24">
              {s.body}
            </Section>
          ))}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {sections.length > 2 ? (
            <nav className="glass hidden rounded-2xl p-4 lg:block" aria-label="On this page">
              <p className="eyebrow mb-2">On this page</p>
              <ol className="space-y-1 text-sm">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="flex items-baseline gap-2 text-muted-foreground hover:text-foreground">
                      <span className="font-mono text-[0.7rem] text-violet">{String(i + 1).padStart(2, "0")}</span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="glass top-bar rounded-2xl p-4" style={{ "--bar": "linear-gradient(90deg, var(--mint), var(--sky))" } as React.CSSProperties}>
            <p className="eyebrow mb-2">Source</p>
            {entry.source ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {entry.source.url ? (
                    <a href={entry.source.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-violet hover:underline">
                      {entry.source.title}
                    </a>
                  ) : (
                    entry.source.title
                  )}
                </p>
                {entry.sourceRef ? <p className="font-mono text-xs break-all text-muted-foreground">{entry.sourceRef}</p> : null}
                {entry.source.license ? <p className="text-xs text-muted-foreground">Licence: {entry.source.license}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No source recorded.</p>
            )}
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="eyebrow mb-2">Record</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <dt>id</dt>
              <dd className="font-mono break-all">{entry.id}</dd>
              <dt>search key</dt>
              <dd className="font-mono break-all">{entry.searchKey}</dd>
              <dt>updated</dt>
              <dd>{entry.updatedAt.toISOString().slice(0, 10)}</dd>
              <dt>JSON</dt>
              <dd>
                <a href={`/api/entries/${entry.id}`} className="underline-offset-4 hover:text-violet hover:underline">
                  /api/entries/{entry.id.slice(0, 8)}…
                </a>
              </dd>
            </dl>
          </div>
        </aside>
      </div>
    </article>
  )
}

function RelationMeta({ confidence, note }: { confidence: "certain" | "likely" | "debated"; note: string | null }) {
  if (confidence === "certain" && !note) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 pl-3 text-xs text-muted-foreground">
      {confidence !== "certain" ? <Chip tone={confidence === "debated" ? "rose" : "muted"}>{confidence}</Chip> : null}
      {note}
    </p>
  )
}

import Link from "next/link"
import type { Thesaurus as ThesaurusData, ThesaurusWord } from "@workspace/db"

import { cn } from "@workspace/ui/lib/utils"

import { NativeText } from "@/components/native-text"

/** A word as a compact chip: native script, headword, a short gloss (full gloss on hover). */
function WordChip({ word, showGloss = true }: { word: ThesaurusWord; showGloss?: boolean }) {
  const lang = word.language
  return (
    <Link
      href={`/entries/${word.id}`}
      title={`${word.headword} — ${word.gloss} (${lang.name})`}
      className="glass group inline-flex max-w-full items-baseline gap-1.5 rounded-full px-3 py-1 text-sm transition-[border-color,box-shadow] hover:border-violet/50 hover:shadow-(--shadow-glow)"
    >
      {word.nativeScript && word.nativeScript !== word.headword ? (
        <NativeText
          text={word.nativeScript}
          script={lang.script}
          direction={lang.direction}
          className={cn("text-amber", lang.script === "Xsux" || lang.script === "Egyp" ? "text-lg leading-none" : undefined)}
        />
      ) : null}
      <span className="shrink-0 whitespace-nowrap font-semibold group-hover:text-violet">
        <NativeText text={word.headword} script={lang.script} direction={lang.direction} />
        {word.homonymIndex > 1 ? <sup className="text-muted-foreground">{word.homonymIndex}</sup> : null}
      </span>
      {word.transliteration && word.transliteration !== word.headword ? (
        <span className="shrink-0 whitespace-nowrap text-xs italic text-muted-foreground">{word.transliteration}</span>
      ) : null}
      {showGloss ? <span className="min-w-0 max-w-[16rem] truncate text-xs text-muted-foreground">{word.gloss}</span> : null}
    </Link>
  )
}

function ChipList({ words, showGloss }: { words: ThesaurusWord[]; showGloss?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {words.map((w) => (
        // min-w-0: let a long gloss truncate instead of the chip overflowing narrow screens
        <li key={w.id} className="min-w-0 max-w-full">
          <WordChip word={w} showGloss={showGloss} />
        </li>
      ))}
    </ul>
  )
}

function Group({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex flex-wrap items-baseline gap-x-2">
        <span className="eyebrow text-foreground">{title}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </h3>
      {children}
    </div>
  )
}

export function hasThesaurus(t: ThesaurusData): boolean {
  return [t.synonyms, t.antonyms, t.related, t.sameMeaning, t.otherLanguages].some((l) => l.length > 0)
}

/**
 * Words related to an entry by meaning: synonyms, antonyms and related words its sources list,
 * then words that share one of its meanings, in its own language and across the library.
 */
export function Thesaurus({ thesaurus: t }: { thesaurus: ThesaurusData }) {
  const terms = t.terms.map((term) => `“${term}”`).join(", ")
  return (
    <div className="space-y-5">
      {t.synonyms.length ? (
        <Group title="Synonyms">
          <ChipList words={t.synonyms} />
        </Group>
      ) : null}
      {t.antonyms.length ? (
        <Group title="Antonyms">
          <ChipList words={t.antonyms} />
        </Group>
      ) : null}
      {t.related.length ? (
        <Group title="Related words">
          <ChipList words={t.related} />
        </Group>
      ) : null}
      {t.sameMeaning.length ? (
        <Group title="Same meaning" hint={<>also glossed {terms}</>}>
          <ChipList words={t.sameMeaning} />
        </Group>
      ) : null}
      {t.otherLanguages.length ? (
        <Group title="In other languages" hint={<>glossed {terms}</>}>
          <dl className="glass divide-y overflow-hidden rounded-2xl">
            {t.otherLanguages.map((g) => (
              <div key={g.language.id} className="grid gap-x-4 gap-y-1.5 p-3 sm:grid-cols-[10rem_1fr]">
                <dt className="eyebrow pt-1.5 text-[0.66rem]">
                  <Link href={`/languages/${g.language.id}`} className="underline-offset-4 hover:text-foreground hover:underline">
                    {g.language.name}
                  </Link>
                </dt>
                <dd className="min-w-0">
                  <ChipList words={g.words} />
                </dd>
              </div>
            ))}
          </dl>
        </Group>
      ) : null}
    </div>
  )
}

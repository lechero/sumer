import Link from "next/link"
import type { Entry, Language } from "@workspace/db"

import { cn } from "@workspace/ui/lib/utils"

import { NativeText } from "@/components/native-text"

type Props = {
  entry: Pick<Entry, "id" | "headword" | "nativeScript" | "transliteration" | "gloss" | "homonymIndex"> & {
    language: Pick<Language, "name" | "script" | "direction">
  }
  showLanguage?: boolean
}

/** Compact inline reference to another entry: headword, script, gloss. */
export function EntryLink({ entry, showLanguage = true }: Props) {
  const lang = entry.language
  return (
    <Link
      href={`/entries/${entry.id}`}
      className="glass lift group flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-xl px-3 py-2"
    >
      {entry.nativeScript && entry.nativeScript !== entry.headword ? (
        <NativeText
          text={entry.nativeScript}
          script={lang.script}
          direction={lang.direction}
          className={cn("text-amber transition-[text-shadow] group-hover:glyph-glow", lang.script === "Xsux" || lang.script === "Egyp" ? "text-2xl leading-none" : "text-lg")}
        />
      ) : null}
      <span className="font-semibold group-hover:text-violet">
        <NativeText text={entry.headword} script={lang.script} direction={lang.direction} />
        {entry.homonymIndex > 1 ? <sup className="text-muted-foreground">{entry.homonymIndex}</sup> : null}
      </span>
      {entry.transliteration ? <span className="text-sm text-muted-foreground">{entry.transliteration}</span> : null}
      <span className="min-w-0 text-sm text-ink-2">“{entry.gloss}”</span>
      {showLanguage ? <span className="eyebrow ml-auto text-[0.62rem]">{lang.name}</span> : null}
    </Link>
  )
}

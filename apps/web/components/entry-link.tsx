import Link from "next/link"
import type { Entry, Language } from "@workspace/db"

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
      className="group flex flex-wrap items-baseline gap-x-2 rounded-md border px-3 py-2 transition-colors hover:bg-muted"
    >
      {entry.nativeScript && entry.nativeScript !== entry.headword ? (
        <NativeText
          text={entry.nativeScript}
          script={lang.script}
          direction={lang.direction}
          className={lang.script === "Xsux" ? "text-2xl leading-none" : "text-lg"}
        />
      ) : null}
      <span className="font-medium group-hover:underline">
        <NativeText text={entry.headword} script={lang.script} direction={lang.direction} />
        {entry.homonymIndex > 1 ? <sup className="text-muted-foreground">{entry.homonymIndex}</sup> : null}
      </span>
      {entry.transliteration ? <span className="text-sm text-muted-foreground">{entry.transliteration}</span> : null}
      <span className="text-sm text-muted-foreground">“{entry.gloss}”</span>
      {showLanguage ? <span className="ml-auto text-xs text-muted-foreground">{lang.name}</span> : null}
    </Link>
  )
}

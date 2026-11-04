import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import type { EntryListItem } from "@workspace/db"

import { KindBadge, PosBadge } from "@/components/entry-badges"
import { NativeText } from "@/components/native-text"
import { SignBreakdownInline } from "@/components/sign-breakdown"
import type { Breakdowns } from "@/lib/breakdowns"

type Props = {
  rows: EntryListItem[]
  /** Hide the language column when every row is from the same language. */
  showLanguage?: boolean
  emptyMessage?: string
  /** Sign-by-sign readings for cuneiform rows (shown under each glyph). */
  breakdowns?: Breakdowns
}

export function EntryTable({ rows, showLanguage = true, emptyMessage = "No entries.", breakdowns }: Props) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[14rem]">Headword</TableHead>
            <TableHead className="w-[8rem]">Script</TableHead>
            {showLanguage ? <TableHead className="w-[9rem]">Language</TableHead> : null}
            <TableHead className="w-[7rem]">Type</TableHead>
            <TableHead>Gloss</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="align-top">
                <Link href={`/entries/${e.id}`} className="font-medium underline-offset-4 hover:underline">
                  {e.language.script === "Latn" || !e.transliteration ? (
                    <NativeText text={e.headword} script={e.language.script} direction={e.language.direction} />
                  ) : (
                    <NativeText text={e.headword} script={e.language.script} direction={e.language.direction} />
                  )}
                </Link>
                {e.homonymIndex > 1 ? <sup className="ml-0.5 text-muted-foreground">{e.homonymIndex}</sup> : null}
                {e.transliteration ? <div className="text-xs text-muted-foreground">{e.transliteration}</div> : null}
              </TableCell>
              <TableCell className="align-top">
                {breakdowns?.get(e.id) ? (
                  <SignBreakdownInline parts={breakdowns.get(e.id)!} />
                ) : e.nativeScript && e.nativeScript !== e.headword ? (
                  <NativeText
                    text={e.nativeScript}
                    script={e.language.script}
                    direction={e.language.direction}
                    className={e.language.script === "Xsux" ? "text-2xl leading-none" : "text-lg"}
                  />
                ) : null}
              </TableCell>
              {showLanguage ? (
                <TableCell className="align-top">
                  <Link href={`/languages/${e.languageId}`} className="text-muted-foreground hover:text-foreground">
                    {e.language.name}
                  </Link>
                </TableCell>
              ) : null}
              <TableCell className="align-top">
                <div className="flex flex-wrap gap-1">
                  <KindBadge entry={e} />
                  <PosBadge pos={e.partOfSpeech} />
                </div>
              </TableCell>
              <TableCell className="align-top">{e.gloss}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

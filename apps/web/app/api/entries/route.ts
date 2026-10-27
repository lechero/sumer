import { NextResponse } from "next/server"
import { getDb, listEntries, type EntryKind } from "@workspace/db"

export const dynamic = "force-dynamic"

/**
 * GET /api/entries?q=king&lang=sux&kind=word&limit=50&offset=0
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const kindParam = sp.get("kind")
  const kind: EntryKind | undefined = kindParam === "word" || kindParam === "part" ? kindParam : undefined

  try {
    const { rows, total, limit, offset } = await listEntries(getDb(), {
      q: sp.get("q") ?? undefined,
      languageId: sp.get("lang") ?? undefined,
      kind,
      limit: Number(sp.get("limit") ?? 50) || 50,
      offset: Number(sp.get("offset") ?? 0) || 0,
    })
    return NextResponse.json({
      total,
      limit,
      offset,
      rows: rows.map(({ language, searchKey: _searchKey, ...e }) => ({
        ...e,
        language: { id: language.id, name: language.name, script: language.script, direction: language.direction },
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 500 })
  }
}

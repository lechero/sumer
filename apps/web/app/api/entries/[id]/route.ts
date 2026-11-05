import { NextResponse } from "next/server"
import { getDb, getEntryById, getThesaurus } from "@workspace/db"

import { UUID_RE } from "@/lib/data"

export const dynamic = "force-dynamic"

/** GET /api/entries/:id — full entry with senses, components, usages, relations and its thesaurus. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 })
  try {
    const db = getDb()
    const entry = await getEntryById(db, id)
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json({ ...entry, thesaurus: await getThesaurus(db, entry) })
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 500 })
  }
}

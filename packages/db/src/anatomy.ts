/**
 * A word's anatomy: what it is built from, all the way down (compounds of compounds,
 * stems of stems), and where it comes from (its derived-from and borrowed-from chain
 * back to a root or a reconstruction):
 *   Pali dhamma ← dharati "lasts" ← √dhar "hold"; ← PIE *dʰer- "to support"
 *   Sumerian lugal = lu₂ "man" + gal "big"
 */
import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "./client"
import { entries, entryComponents, entryRelations, languages, type Entry, type Language } from "./schema"

export type AnatomyEntry = Pick<
  Entry,
  "id" | "headword" | "nativeScript" | "transliteration" | "gloss" | "homonymIndex" | "kind" | "partKind" | "languageId"
> & { language: Pick<Language, "id" | "name" | "script" | "direction"> }

export type ComponentNode = { entry: AnatomyEntry; role: string | null; note: string | null; children: ComponentNode[] }

export type AncestorNode = {
  entry: AnatomyEntry
  type: "derived_from" | "loan_from"
  confidence: "certain" | "likely" | "debated"
  note: string | null
  children: AncestorNode[]
}

export type WordAnatomy = {
  /** The entry's components, each with its own components below it. */
  components: ComponentNode[]
  ancestry: AncestorNode[]
  /** Deepest level reached in each tree. */
  depth: { components: number; ancestry: number }
}

const LIMITS = { componentDepth: 4, ancestryDepth: 6, children: 12, ancestorsPerNode: 4 }

const entryColumns = {
  id: entries.id,
  headword: entries.headword,
  nativeScript: entries.nativeScript,
  transliteration: entries.transliteration,
  gloss: entries.gloss,
  homonymIndex: entries.homonymIndex,
  kind: entries.kind,
  partKind: entries.partKind,
  languageId: entries.languageId,
}
const languageColumns = { id: languages.id, name: languages.name, script: languages.script, direction: languages.direction }

async function componentLevel(db: Database, ids: string[]) {
  if (!ids.length) return []
  return db
    .select({ parentId: entryComponents.entryId, position: entryComponents.position, role: entryComponents.role, note: entryComponents.note, entry: entryColumns, language: languageColumns })
    .from(entryComponents)
    .innerJoin(entries, eq(entries.id, entryComponents.componentId))
    .innerJoin(languages, eq(languages.id, entries.languageId))
    .where(inArray(entryComponents.entryId, ids))
    .orderBy(entryComponents.position)
}

async function ancestorLevel(db: Database, ids: string[]) {
  if (!ids.length) return []
  return db
    .select({
      childId: entryRelations.fromEntryId,
      type: entryRelations.type,
      confidence: entryRelations.confidence,
      note: entryRelations.note,
      entry: entryColumns,
      language: languageColumns,
    })
    .from(entryRelations)
    .innerJoin(entries, eq(entries.id, entryRelations.toEntryId))
    .innerJoin(languages, eq(languages.id, entries.languageId))
    .where(and(inArray(entryRelations.fromEntryId, ids), inArray(entryRelations.type, ["derived_from", "loan_from"])))
}

const CONFIDENCE_RANK = { certain: 0, likely: 1, debated: 2 }

/**
 * The entry's component tree (below the first level) and its ancestry. Each entry appears once
 * per tree, so cycles and the same root reached by two paths stop there.
 */
export async function getWordAnatomy(db: Database, entry: { id: string; languageId: string }): Promise<WordAnatomy> {
  // components: walk down level by level
  const rootComponents: ComponentNode[] = []
  const nodesById = new Map<string, ComponentNode[]>([[entry.id, []]])
  const seenC = new Set([entry.id])
  let frontier = [entry.id]
  let componentDepth = 0
  for (let level = 0; level < LIMITS.componentDepth && frontier.length; level++) {
    const rows = await componentLevel(db, frontier)
    const next: string[] = []
    const perParent = new Map<string, number>()
    for (const r of rows) {
      const count = perParent.get(r.parentId) ?? 0
      if (count >= LIMITS.children || seenC.has(r.entry.id)) continue
      perParent.set(r.parentId, count + 1)
      seenC.add(r.entry.id)
      const node: ComponentNode = { entry: { ...r.entry, language: r.language }, role: r.role, note: r.note, children: [] }
      const parentChildren = level === 0 ? rootComponents : nodesById.get(r.parentId)
      parentChildren?.push(node)
      nodesById.set(r.entry.id, node.children)
      next.push(r.entry.id)
    }
    if (rows.length) componentDepth = level + 1
    frontier = next
  }

  // ancestry: walk up derived_from / loan_from
  const ancestry: AncestorNode[] = []
  const ancestorsById = new Map<string, AncestorNode[]>([[entry.id, ancestry]])
  const seenA = new Set([entry.id])
  const seenForms = new Set<string>()
  const languageOf = new Map([[entry.id, entry.languageId]])
  frontier = [entry.id]
  let ancestryDepth = 0
  for (let level = 0; level < LIMITS.ancestryDepth && frontier.length; level++) {
    const rows = (await ancestorLevel(db, frontier)).sort(
      (a, b) =>
        Number(a.type !== "loan_from") - Number(b.type !== "loan_from") ||
        CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
        // the same language first: the stem before the distant root
        Number(a.entry.languageId !== languageOf.get(a.childId)) - Number(b.entry.languageId !== languageOf.get(b.childId))
    )
    const next: string[] = []
    const perChild = new Map<string, number>()
    for (const r of rows) {
      // the same headword twice (two homonym entries of one source): keep one
      const form = `${r.entry.languageId}:${r.entry.headword}`
      if (seenA.has(r.entry.id) || seenForms.has(form)) continue
      const count = perChild.get(r.childId) ?? 0
      if (count >= LIMITS.ancestorsPerNode) continue
      perChild.set(r.childId, count + 1)
      seenA.add(r.entry.id)
      seenForms.add(form)
      const node: AncestorNode = {
        entry: { ...r.entry, language: r.language },
        type: r.type as AncestorNode["type"],
        confidence: r.confidence,
        note: r.note,
        children: [],
      }
      ancestorsById.get(r.childId)?.push(node)
      ancestorsById.set(r.entry.id, node.children)
      languageOf.set(r.entry.id, r.entry.languageId)
      next.push(r.entry.id)
    }
    if (next.length) ancestryDepth = level + 1
    frontier = next
  }

  return { components: rootComponents, ancestry, depth: { components: componentDepth, ancestry: ancestryDepth } }
}

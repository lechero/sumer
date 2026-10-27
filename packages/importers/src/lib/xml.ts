/**
 * Minimal streaming XML → per-element tree collector built on saxes.
 * Lets a 40 MB TEI file be processed entry by entry without holding it all.
 */
import { createReadStream } from "node:fs"
import { SaxesParser } from "saxes"

export type XmlNode = { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }

export function text(node: XmlNode | string | undefined | null): string {
  if (node == null) return ""
  if (typeof node === "string") return node
  return node.children.map(text).join("")
}

/** Collapse whitespace. */
export function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c): c is XmlNode => typeof c !== "string" && c.name === name)
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return children(node, name)[0]
}

/** Depth-first search for all descendants with the given name (not descending into matches). */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === "string") continue
      if (c.name === name) out.push(c)
      else walk(c)
    }
  }
  walk(node)
  return out
}

/**
 * Stream `file`, calling `onEntry` for every element named `entryName` with
 * a fully built subtree. Returns the number of entries seen.
 */
export async function forEachElement(
  file: string,
  entryName: string | ((name: string) => boolean),
  onEntry: (node: XmlNode) => void | Promise<void>
): Promise<number> {
  const matches = typeof entryName === "string" ? (n: string) => n === entryName : entryName
  const parser = new SaxesParser({ xmlns: false })
  const stack: XmlNode[] = []
  let count = 0
  const pending: Promise<void>[] = []

  parser.on("opentag", (tag) => {
    const node: XmlNode = { name: tag.name, attrs: tag.attributes as Record<string, string>, children: [] }
    if (stack.length) stack[stack.length - 1]!.children.push(node)
    else if (!matches(tag.name)) {
      // outside any entry: don't accumulate the whole document
      return
    }
    if (stack.length || matches(tag.name)) stack.push(node)
  })
  parser.on("text", (t) => {
    if (stack.length) stack[stack.length - 1]!.children.push(t)
  })
  parser.on("closetag", (tag) => {
    if (!stack.length) return
    const node = stack.pop()!
    if (stack.length === 0 && matches(tag.name)) {
      count++
      const r = onEntry(node)
      if (r) pending.push(r)
    }
  })
  let errors = 0
  parser.on("error", () => {
    // saxes keeps going after recoverable errors (e.g. undeclared entities); count them instead of aborting
    errors++
  })

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { encoding: "utf8" })
    stream.on("data", (chunk) => parser.write(chunk as string))
    stream.on("end", () => {
      parser.close()
      resolve()
    })
    stream.on("error", reject)
  })
  await Promise.all(pending)
  if (errors) console.warn(`[xml] ${errors} recoverable parse errors in ${file}`)
  return count
}

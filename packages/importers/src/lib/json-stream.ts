/**
 * Yield the elements of a top-level JSON array property (`"entries": [ … ]`)
 * from a file far too large for JSON.parse — ePSD2's glossary is 1.9 GB.
 * Scans the byte stream, tracking strings and nesting, and parses each
 * element on its own. Stops reading once the array is closed.
 */
import { createReadStream } from "node:fs"

export async function* iterateJsonArray<T = unknown>(file: string, key: string): AsyncGenerator<T> {
  const marker = `"${key}":`
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 4 << 20 })
  let phase: "seek" | "open" | "array" = "seek"
  let tail = "" // last bytes kept across chunks while seeking the marker
  let inString = false
  let escaped = false
  let depth = 0 // nesting depth inside the current element
  let capturing = false
  let parts: string[] = []
  let segmentStart = 0

  for await (const chunk of stream as AsyncIterable<string>) {
    let i = 0
    if (phase === "seek") {
      const hay = tail + chunk
      const at = hay.indexOf(marker)
      if (at === -1) {
        tail = hay.slice(-marker.length)
        continue
      }
      i = at + marker.length - tail.length
      if (i < 0) i = 0
      phase = "open"
      tail = ""
    }
    if (phase === "open") {
      // skip whitespace to the opening bracket
      while (i < chunk.length && /\s/.test(chunk[i]!)) i++
      if (i >= chunk.length) continue
      if (chunk[i] !== "[") throw new Error(`expected [ after ${marker}`)
      i++
      phase = "array"
    }
    segmentStart = i
    for (; i < chunk.length; i++) {
      const ch = chunk[i]!
      if (capturing) {
        if (inString) {
          if (escaped) escaped = false
          else if (ch === "\\") escaped = true
          else if (ch === '"') inString = false
          continue
        }
        if (ch === '"') inString = true
        else if (ch === "{" || ch === "[") depth++
        else if (ch === "}" || ch === "]") {
          depth--
          if (depth === 0) {
            parts.push(chunk.slice(segmentStart, i + 1))
            const textOf = parts.join("")
            parts = []
            capturing = false
            yield JSON.parse(textOf) as T
          }
        }
        continue
      }
      // between elements
      if (ch === "{" || ch === "[") {
        capturing = true
        depth = 1
        segmentStart = i
      } else if (ch === "]") {
        return
      }
    }
    if (capturing) parts.push(chunk.slice(segmentStart))
  }
}

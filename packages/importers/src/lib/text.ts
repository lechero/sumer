/** Small text helpers shared by importers. */

export function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "))
  return (at > max * 0.6 ? cut.slice(0, at + 1) : cut).trim() + " …"
}

/** Strip the light markdown eBL uses (*italics*, **bold**, \[escapes\]). */
export function stripMarkdown(s: string): string {
  return s
    .replace(/\\([[\]()*_])/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

export function romanToInt(s: string): number | undefined {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 }
  const r = s.trim().toUpperCase()
  if (!r || [...r].some((c) => !(c in map))) return undefined
  let total = 0
  for (let i = 0; i < r.length; i++) {
    const v = map[r[i]!]!
    const next = map[r[i + 1] ?? ""] ?? 0
    total += v < next ? -v : v
  }
  return total
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

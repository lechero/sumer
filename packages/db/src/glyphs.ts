/**
 * Cuneiform glyph helpers shared by the importers and the web app.
 *
 * Code points: the Unicode cuneiform blocks (U+12000–1254F), the range of
 * Oracc's proto-cuneiform encoding (PC24, U+12550–12BFF, which includes the
 * Archaic Cuneiform Numerals OSL uses), and the Oracc Private Use Area in
 * plane 15 (U+F0000–FFFFD), where OSL and PCSL keep signs pending encoding.
 * The web fonts in apps/web/fonts cover all of these.
 */

export function isCuneiformCodePoint(cp: number): boolean {
  return (cp >= 0x12000 && cp <= 0x12bff) || (cp >= 0xf0000 && cp <= 0xffffd)
}

/** Egyptian hieroglyphs: the basic block (U+13000–1342F) and Extended-A (U+13460–143FF). */
export function isHieroglyphCodePoint(cp: number): boolean {
  return (cp >= 0x13000 && cp <= 0x1342f) || (cp >= 0x13460 && cp <= 0x143ff)
}

/** Variation selectors and the zero-width joiner attach to the glyph before them. */
function isGlyphModifier(cp: number): boolean {
  return (cp >= 0xe0100 && cp <= 0xe01ef) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d
}

/** The cuneiform glyphs of a string, each with its variation selectors; everything else is dropped. */
export function cuneiformGlyphs(text: string): string[] {
  const out: string[] = []
  let attach = false
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isCuneiformCodePoint(cp)) {
      out.push(ch)
      attach = true
    } else if (attach && isGlyphModifier(cp) && out.length) {
      out[out.length - 1] += ch
    } else {
      attach = false
    }
  }
  return out
}

/**
 * OSL spells a compound's Unicode with placeholders where a component has no
 * code point: `X` (or `x`) for an unencoded component, `O` for the unidentified
 * sign X. They are data, not glyphs, and must never be drawn as letters.
 */
const GAP_MARKERS = new Set(["X", "x", "O"])

export type GlyphPart = { kind: "glyph"; text: string } | { kind: "gap"; marker: string }

/** Split a sign's stored Unicode into drawable runs and placeholder gaps. */
export function splitSignUnicode(unicode: string | null | undefined): GlyphPart[] {
  if (!unicode) return []
  const parts: GlyphPart[] = []
  for (const ch of unicode) {
    const cp = ch.codePointAt(0) ?? 0
    const last = parts[parts.length - 1]
    if (isCuneiformCodePoint(cp) || (isGlyphModifier(cp) && last?.kind === "glyph")) {
      if (last?.kind === "glyph") last.text += ch
      else parts.push({ kind: "glyph", text: ch })
    } else if (GAP_MARKERS.has(ch)) {
      parts.push({ kind: "gap", marker: ch })
    }
    // anything else (OSL's no-break space for blank pseudo-signs) is dropped
  }
  return parts
}

/** True when every part of the sign has a code point, so it can be drawn (and used to render words). */
export function isFullyEncoded(unicode: string | null | undefined): boolean {
  const parts = splitSignUnicode(unicode)
  return parts.length > 0 && parts.every((p) => p.kind === "glyph")
}

/** True when the Unicode uses code points beyond the standard blocks (OSL's numerals range or its PUA), which fonts may lack. */
export function usesExtendedCodePoints(unicode: string | null | undefined): boolean {
  if (!unicode) return false
  for (const ch of unicode) if ((ch.codePointAt(0) ?? 0) >= 0x12550 && isCuneiformCodePoint(ch.codePointAt(0) ?? 0)) return true
  return false
}

export type SignNamePart =
  | { kind: "sign"; name: string; base: string }
  | { kind: "op"; text: string }

const MODIFIERS = /(?:@[a-z0-9]+|~[a-z0-9]+)+$/u

/**
 * Break an OSL sign name into its component signs and operators, e.g.
 * `|BAR×TAB|` → BAR, ×, TAB and `AL@s` → AL@s (base AL). Operators: `.` beside,
 * `×` inside, `&` above, `%` crossed, `@` opposed, `+` ligature, `:` and
 * parentheses for grouping; counts (`3×AN`, `1/2(GUR)`) are kept as operators.
 */
export function parseSignName(name: string): SignNamePart[] {
  const inner = name.replace(/^\|/, "").replace(/\|$/, "")
  const parts: SignNamePart[] = []
  for (const m of inner.matchAll(/([.×&%+:()])|([^.×&%+:()]+)/gu)) {
    const text = m[0]
    if (m[1] !== undefined || text.startsWith("@") || /^[\d/]+$/u.test(text)) {
      parts.push({ kind: "op", text })
    } else {
      parts.push({ kind: "sign", name: text, base: text.replace(MODIFIERS, "") })
    }
  }
  return parts
}

/** Distinct sign names (and their unmodified bases) referenced by a sign name. */
export function componentNames(name: string): string[] {
  const names = new Set<string>()
  for (const p of parseSignName(name)) {
    if (p.kind !== "sign") continue
    names.add(p.name)
    names.add(p.base)
  }
  return [...names]
}

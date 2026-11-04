import type { SignComponent } from "@workspace/db"
import { isCuneiformCodePoint, isFullyEncoded, splitSignUnicode } from "@workspace/db/glyphs"
import { cn } from "@workspace/ui/lib/utils"

import { isDrawableCodePoint } from "@/lib/cuneiform-coverage"

const GAP_TITLE: Record<string, string> = {
  X: "component not encoded in Unicode",
  x: "component not encoded in Unicode",
  O: "unidentified sign (X)",
  "?": "no font draws this sign yet",
}

/** True when the sign is fully encoded and the bundled fonts have a real glyph for every code point. */
export function isDrawable(unicode: string | null | undefined): unicode is string {
  if (!isFullyEncoded(unicode)) return false
  for (const ch of unicode!) {
    const cp = ch.codePointAt(0) ?? 0
    if (isCuneiformCodePoint(cp) && !isDrawableCodePoint(cp)) return false
  }
  return true
}

/** An empty dashed box where a component has no code point, or no font draws it. */
function Gap({ marker }: { marker: string }) {
  return (
    <span
      title={GAP_TITLE[marker] ?? "not encoded"}
      className="mx-[0.04em] inline-block h-[0.75em] w-[0.55em] translate-y-[0.08em] rounded-[0.08em] border border-dashed border-current opacity-50"
    />
  )
}

/** A sign's stored Unicode, glyph by glyph; OSL placeholders and glyphs no font has become gaps (never the letters X or O). */
export function SignGlyph({ unicode, className }: { unicode: string; className?: string }) {
  const pieces: Array<{ text: string } | { gap: string }> = []
  for (const part of splitSignUnicode(unicode)) {
    if (part.kind === "gap") {
      pieces.push({ gap: part.marker })
      continue
    }
    for (const ch of part.text) {
      const cp = ch.codePointAt(0) ?? 0
      const last = pieces[pieces.length - 1]
      if (isCuneiformCodePoint(cp) && !isDrawableCodePoint(cp)) pieces.push({ gap: "?" })
      else if (last && "text" in last) last.text += ch
      else pieces.push({ text: ch })
    }
  }
  return (
    <span className={cn("font-cuneiform", className)}>
      {pieces.map((p, i) => ("gap" in p ? <Gap key={i} marker={p.gap} /> : <span key={i}>{p.text}</span>))}
    </span>
  )
}

/** The sign a component is drawn as: the first match the fonts can draw (AL@s, else AL). */
export function drawnMatch(c: Extract<SignComponent, { kind: "sign" }>) {
  return c.matches.find((m) => isDrawable(m.unicode)) ?? null
}

function ComponentRun({ components }: { components: SignComponent[] }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-center text-[0.6em]">
      {components.map((c, i) => {
        if (c.kind === "op") {
          return (
            <span key={i} className="px-[0.06em] font-mono text-[0.45em]">
              {c.text}
            </span>
          )
        }
        const drawn = drawnMatch(c)
        if (!drawn) return <Gap key={i} marker="X" />
        // AL for AL@s: the glyph of the base sign, with the missing modifier written next to it.
        const approximate = drawn.name !== c.name
        const suffix = approximate && c.name.startsWith(drawn.name) ? c.name.slice(drawn.name.length) : ""
        return (
          <span key={i} className="inline-flex items-start" title={approximate ? `${c.name}, drawn as ${drawn.name}` : c.name}>
            <SignGlyph unicode={drawn.unicode!} />
            {suffix ? <span className="font-mono text-[0.35em]">{suffix}</span> : null}
          </span>
        )
      })}
    </span>
  )
}

/**
 * How a sign looks: its glyph when it can be drawn; otherwise a dashed frame
 * with its components (or the drawable part of its Unicode), so an unencoded
 * sign reads as deliberately unencoded rather than as a broken font.
 */
export function SignFace({
  unicode,
  components,
  className,
}: {
  unicode: string | null
  components?: SignComponent[] | null
  className?: string
}) {
  if (isDrawable(unicode)) return <SignGlyph unicode={unicode} className={className} />
  const drawableParts = components?.some((c) => c.kind === "sign" && drawnMatch(c))
  const partial = splitSignUnicode(unicode).some((p) => p.kind === "glyph" && [...p.text].some((ch) => isDrawableCodePoint(ch.codePointAt(0) ?? 0)))
  const encoded = isFullyEncoded(unicode)
  return (
    <span
      title={
        drawableParts
          ? `${encoded ? "No font draws this sign yet" : "Not encoded in Unicode"}; shown through its components`
          : encoded
            ? "No font draws this sign yet"
            : "Not encoded in Unicode"
      }
      className={cn(
        "inline-flex max-w-full items-center justify-center rounded-[0.12em] border border-dashed border-muted-foreground/50 px-[0.1em] py-[0.06em] font-cuneiform text-muted-foreground",
        className
      )}
    >
      {drawableParts ? (
        <ComponentRun components={components!} />
      ) : partial ? (
        <SignGlyph unicode={unicode!} className="text-[0.6em]" />
      ) : (
        <span className="px-[0.2em] font-sans text-[0.25em] leading-tight">{encoded ? "no glyph yet" : "not encoded"}</span>
      )}
    </span>
  )
}

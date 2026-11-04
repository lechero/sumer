import type { SignComponent } from "@workspace/db"
import { isFullyEncoded, splitSignUnicode } from "@workspace/db/glyphs"
import { cn } from "@workspace/ui/lib/utils"

import { codePointDrawable, COMPOSITE_SCRIPTS, scriptFontClass } from "@/lib/scripts"

const GAP_TITLE: Record<string, string> = {
  X: "component not encoded in Unicode",
  x: "component not encoded in Unicode",
  O: "unidentified sign (X)",
  "?": "no font draws this sign yet",
}

const allDrawable = (script: string, text: string) => [...text].every((ch) => codePointDrawable(script, ch.codePointAt(0) ?? 0))

/**
 * True when the sign has a glyph the bundled fonts really draw. Cuneiform and proto-cuneiform must also be
 * fully encoded (OSL spells unencoded parts of a compound with placeholders such as X).
 */
export function isDrawable(unicode: string | null | undefined, script = "cuneiform"): unicode is string {
  if (!unicode?.trim()) return false
  if (COMPOSITE_SCRIPTS.has(script) && !isFullyEncoded(unicode)) return false
  return allDrawable(script, unicode)
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
export function SignGlyph({ unicode, script = "cuneiform", className }: { unicode: string; script?: string; className?: string }) {
  const font = scriptFontClass(script)
  if (!COMPOSITE_SCRIPTS.has(script)) {
    return allDrawable(script, unicode) ? <span className={cn(font, className)}>{unicode}</span> : <Gap marker="?" />
  }
  const pieces: Array<{ text: string } | { gap: string }> = []
  for (const part of splitSignUnicode(unicode)) {
    if (part.kind === "gap") {
      pieces.push({ gap: part.marker })
      continue
    }
    for (const ch of part.text) {
      const last = pieces[pieces.length - 1]
      if (!codePointDrawable(script, ch.codePointAt(0) ?? 0)) pieces.push({ gap: "?" })
      else if (last && "text" in last) last.text += ch
      else pieces.push({ text: ch })
    }
  }
  return (
    <span className={cn(font, className)}>
      {pieces.map((p, i) => ("gap" in p ? <Gap key={i} marker={p.gap} /> : <span key={i}>{p.text}</span>))}
    </span>
  )
}

/** The sign a component is drawn as: the first match the fonts can draw (AL@s, else AL). */
export function drawnMatch(c: Extract<SignComponent, { kind: "sign" }>, script = "cuneiform") {
  return c.matches.find((m) => isDrawable(m.unicode, script)) ?? null
}

function ComponentRun({ components, script }: { components: SignComponent[]; script: string }) {
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
        const drawn = drawnMatch(c, script)
        if (!drawn) return <Gap key={i} marker="X" />
        // AL for AL@s: the glyph of the base sign, with the missing modifier written next to it.
        const approximate = drawn.name !== c.name
        const suffix = approximate && c.name.startsWith(drawn.name) ? c.name.slice(drawn.name.length) : ""
        return (
          <span key={i} className="inline-flex items-start" title={approximate ? `${c.name}, drawn as ${drawn.name}` : c.name}>
            <SignGlyph unicode={drawn.unicode!} script={script} />
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
  script = "cuneiform",
  className,
}: {
  unicode: string | null
  components?: SignComponent[] | null
  script?: string
  className?: string
}) {
  if (isDrawable(unicode, script)) return <SignGlyph unicode={unicode} script={script} className={className} />
  const drawableParts = components?.some((c) => c.kind === "sign" && drawnMatch(c, script))
  const partial =
    COMPOSITE_SCRIPTS.has(script) &&
    splitSignUnicode(unicode).some((p) => p.kind === "glyph" && [...p.text].some((ch) => codePointDrawable(script, ch.codePointAt(0) ?? 0)))
  const encoded = COMPOSITE_SCRIPTS.has(script) ? isFullyEncoded(unicode) : !!unicode
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
        "inline-flex max-w-full items-center justify-center rounded-[0.12em] border border-dashed border-muted-foreground/50 px-[0.1em] py-[0.06em] text-muted-foreground",
        scriptFontClass(script),
        className
      )}
    >
      {drawableParts ? (
        <ComponentRun components={components!} script={script} />
      ) : partial ? (
        <SignGlyph unicode={unicode!} script={script} className="text-[0.6em]" />
      ) : (
        <span className="px-[0.2em] font-sans text-[0.25em] leading-tight">{encoded ? "no glyph yet" : "not encoded"}</span>
      )}
    </span>
  )
}

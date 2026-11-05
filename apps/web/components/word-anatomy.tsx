import Link from "next/link"
import type { AncestorNode, AnatomyEntry, ComponentNode, WordAnatomy as WordAnatomyData } from "@workspace/db"
import { cn } from "@workspace/ui/lib/utils"

import { Chip } from "@/components/chip"
import { NativeText } from "@/components/native-text"
import { PART_KIND_LABEL } from "@/lib/labels"

/** A word in a tree: native script, headword, gloss, and its language when it differs. */
function Node({ entry, languageId, extra }: { entry: AnatomyEntry; languageId: string; extra?: React.ReactNode }) {
  const lang = entry.language
  return (
    <Link
      href={`/entries/${entry.id}`}
      className="glass lift group inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-xl px-3 py-1.5"
    >
      {entry.languageId !== languageId ? <span className="eyebrow text-[0.62rem]">{lang.name}</span> : null}
      {entry.nativeScript && entry.nativeScript !== entry.headword ? (
        <NativeText
          text={entry.nativeScript}
          script={lang.script}
          direction={lang.direction}
          className={cn("text-amber group-hover:glyph-glow", lang.script === "Xsux" || lang.script === "Egyp" ? "text-xl leading-none" : "text-base")}
        />
      ) : null}
      <span className="font-semibold group-hover:text-violet">
        <NativeText text={entry.headword} script={lang.script} direction={lang.direction} />
        {entry.homonymIndex > 1 ? <sup className="text-muted-foreground">{entry.homonymIndex}</sup> : null}
      </span>
      <span className="min-w-0 max-w-[22rem] truncate text-sm text-ink-2">“{entry.gloss}”</span>
      {extra}
    </Link>
  )
}

function ComponentTree({ nodes, languageId, depth = 0 }: { nodes: ComponentNode[]; languageId: string; depth?: number }) {
  return (
    <ol className={cn("space-y-2", depth > 0 && "mt-2 ml-4 border-l border-dashed border-violet/40 pl-4")}>
      {nodes.map((n, i) => (
        <li key={n.entry.id} className="relative">
          {depth > 0 ? <span className="absolute top-4 -left-4 h-px w-3 bg-violet/40" aria-hidden /> : null}
          <div className="flex flex-wrap items-center gap-2">
            {depth === 0 ? <span className="sec-num">{i + 1}</span> : null}
            <Node
              entry={n.entry}
              languageId={languageId}
              extra={
                <>
                  {n.entry.partKind ? <Chip tone="amber">{PART_KIND_LABEL[n.entry.partKind]}</Chip> : null}
                  {n.role && n.role !== (n.entry.partKind ? PART_KIND_LABEL[n.entry.partKind] : null) ? <Chip tone="muted">{n.role}</Chip> : null}
                </>
              }
            />
          </div>
          {n.note ? <p className="mt-1 pl-1 text-xs text-muted-foreground">{n.note}</p> : null}
          {n.children.length ? <ComponentTree nodes={n.children} languageId={languageId} depth={depth + 1} /> : null}
        </li>
      ))}
    </ol>
  )
}

const VIA: Record<AncestorNode["type"], string> = { derived_from: "from", loan_from: "borrowed from" }

function Ancestry({ nodes, languageId, depth = 0 }: { nodes: AncestorNode[]; languageId: string; depth?: number }) {
  return (
    <ol className={cn("relative space-y-3 border-l-2 pl-5", depth === 0 ? "border-transparent" : "mt-3 ml-3")} style={{ borderImage: "linear-gradient(var(--violet), var(--amber)) 1" }}>
      {nodes.map((n) => (
        <li key={n.entry.id} className="relative">
          <span className="absolute top-3 -left-[1.6rem] size-2.5 rounded-full bg-amber shadow-[0_0_10px_var(--amber)]" aria-hidden />
          <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono">← {VIA[n.type]}</span>
            {n.confidence !== "certain" ? <Chip tone={n.confidence === "debated" ? "rose" : "muted"}>{n.confidence}</Chip> : null}
            {n.note ? <span className="truncate">{n.note}</span> : null}
          </p>
          <Node entry={n.entry} languageId={languageId} />
          {n.children.length ? <Ancestry nodes={n.children} languageId={languageId} depth={depth + 1} /> : null}
        </li>
      ))}
    </ol>
  )
}

export function hasAnatomy(a: WordAnatomyData): boolean {
  return a.components.length > 0 || a.ancestry.length > 0
}

/** What a word is built from (recursively) and where it comes from, side by side. */
export function WordAnatomy({ anatomy, entry }: { anatomy: WordAnatomyData; entry: AnatomyEntry }) {
  const both = anatomy.components.length > 0 && anatomy.ancestry.length > 0
  return (
    <div className={cn("grid gap-4", both && "xl:grid-cols-2")}>
      {anatomy.components.length ? (
        <div className="glass top-bar min-w-0 space-y-3 rounded-2xl p-5" style={{ "--bar": "linear-gradient(90deg, var(--violet), var(--rose))" } as React.CSSProperties}>
          <h3 className="eyebrow">
            Built from{anatomy.depth.components > 1 ? ` · ${anatomy.depth.components} levels` : ""}
          </h3>
          <ComponentTree nodes={anatomy.components} languageId={entry.languageId} />
        </div>
      ) : null}
      {anatomy.ancestry.length ? (
        <div className="glass top-bar min-w-0 space-y-3 rounded-2xl p-5" style={{ "--bar": "linear-gradient(90deg, var(--amber), var(--ember))" } as React.CSSProperties}>
          <h3 className="eyebrow">
            Comes from{anatomy.depth.ancestry > 1 ? ` · ${anatomy.depth.ancestry} generations` : ""}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-xl border border-violet/50 bg-violet/10 px-3 py-1.5 text-sm font-semibold">
              <NativeText text={entry.headword} script={entry.language.script} direction={entry.language.direction} />
            </span>
            <span className="text-xs text-muted-foreground">{entry.language.name}</span>
          </div>
          <Ancestry nodes={anatomy.ancestry} languageId={entry.languageId} />
        </div>
      ) : null}
    </div>
  )
}

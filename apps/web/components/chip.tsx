import { cn } from "@workspace/ui/lib/utils"

export type ChipTone = "violet" | "amber" | "mint" | "rose" | "sky" | "ember" | "muted"

const TONE: Record<ChipTone, string> = {
  violet: "text-violet bg-violet/15",
  amber: "text-amber bg-amber/15",
  mint: "text-mint bg-mint/13",
  rose: "text-rose bg-rose/14",
  sky: "text-sky bg-sky/15",
  ember: "text-ember bg-ember/15",
  muted: "text-muted-foreground bg-muted",
}

/** A small rounded label in one of the accent tones. */
export function Chip({ tone = "muted", className, children, title }: { tone?: ChipTone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums", TONE[tone], className)}
    >
      {children}
    </span>
  )
}

import { cn } from "@workspace/ui/lib/utils"

type Props = {
  title: React.ReactNode
  /** Two-digit badge before the title ("01"). */
  num?: number
  /** One line under the title. */
  hint?: React.ReactNode
  /** Right-aligned extras next to the title (counts, links). */
  extra?: React.ReactNode
  id?: string
  className?: string
  children: React.ReactNode
}

/** A titled page section with an optional numbered gradient badge. */
export function Section({ title, num, hint, extra, id, className, children }: Props) {
  return (
    <section id={id} className={cn("min-w-0 space-y-4", className)}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {num !== undefined ? <span className="sec-num">{String(num).padStart(2, "0")}</span> : null}
        <h2 className="text-xl font-bold tracking-[-0.02em] sm:text-2xl">{title}</h2>
        {extra ? <div className="ml-auto text-sm text-muted-foreground">{extra}</div> : null}
        {hint ? <p className="basis-full text-sm text-muted-foreground">{hint}</p> : null}
      </header>
      {children}
    </section>
  )
}

import { cn } from "@workspace/ui/lib/utils"

export type HeroStat = {
  label: string
  value: React.ReactNode
  note?: React.ReactNode
  /** Highlight the tile (violet → ember wash). */
  featured?: boolean
}

/** Pixel confetti drifting up through the hero (decorative; still under reduced motion). */
const SPARKS = [
  { left: "4%", color: "var(--amber)", delay: "0s", size: 7 },
  { left: "13%", color: "var(--violet)", delay: "-3s", size: 5 },
  { left: "24%", color: "var(--mint)", delay: "-6s", size: 7 },
  { left: "37%", color: "var(--rose)", delay: "-1.5s", size: 5 },
  { left: "49%", color: "var(--amber)", delay: "-8s", size: 6 },
  { left: "58%", color: "var(--violet)", delay: "-4.5s", size: 9 },
  { left: "67%", color: "var(--mint)", delay: "-9.5s", size: 5 },
  { left: "76%", color: "var(--ember)", delay: "-2s", size: 7 },
  { left: "86%", color: "var(--rose)", delay: "-7s", size: 5 },
  { left: "94%", color: "var(--amber)", delay: "-5s", size: 7 },
]

function Sparkles() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      {SPARKS.map((s, i) => (
        <i
          key={i}
          className="absolute -bottom-3 block opacity-0"
          style={{ left: s.left, width: s.size, height: s.size, background: s.color, animation: `drift 11s linear ${s.delay} infinite` }}
        />
      ))}
    </div>
  )
}

/** Glass stat tiles: a label in mono caps over a value. */
export function StatTiles({ stats, className }: { stats: HeroStat[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2.5", className)}>
      {stats.map((s) => (
        <div
          key={s.label}
          className={cn(
            "grid min-w-0 gap-0.5 rounded-2xl border border-white/12 bg-white/6 px-3.5 py-3 backdrop-blur-sm transition-[transform,border-color] hover:-translate-y-0.5 hover:border-white/28",
            "[.light_&]:border-foreground/10 [.light_&]:bg-white/60",
            s.featured && "bg-linear-to-br from-violet/40 to-ember/25 border-white/30"
          )}
        >
          <dt className="eyebrow text-[0.66rem] text-(--hero-dim)">{s.label}</dt>
          <dd className="text-[0.98rem] leading-snug font-semibold text-pretty text-(--hero-ink)">
            {s.value}
            {s.note ? (
              <small className="mt-0.5 line-clamp-2 block font-mono text-[0.7rem] font-normal text-(--hero-dim)" title={typeof s.note === "string" ? s.note : undefined}>
                {s.note}
              </small>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

type Props = {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  lede?: React.ReactNode
  /** Search form, buttons … under the lede. */
  children?: React.ReactNode
  /** A visual on the right (a large glyph, a sample of the script). */
  art?: React.ReactNode
  stats?: HeroStat[]
  className?: string
  /** Overrides the headline size (long headwords). */
  titleClassName?: string
}

/**
 * The top of a page: a night-sky panel with a fading grid, drifting sparkles, a mono eyebrow,
 * a large headline (wrap a phrase in <Shimmer> to light it up) and glass stat tiles.
 */
export function PageHero({ eyebrow, title, lede, children, art, stats, className, titleClassName }: Props) {
  return (
    <section className={cn("hero-sky rounded-3xl border px-5 py-9 sm:px-10 sm:py-12", className)}>
      <Sparkles />
      <div className={cn("grid items-center gap-x-12 gap-y-6", art && "md:grid-cols-[minmax(0,1fr)_auto]")}>
        <div className="min-w-0 space-y-4">
          {eyebrow ? <div className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1 text-(--hero-dim)">{eyebrow}</div> : null}
          <h1 className={cn("text-4xl leading-[1.02] font-bold tracking-[-0.03em] [overflow-wrap:anywhere] text-(--hero-ink) sm:text-6xl", titleClassName)}>{title}</h1>
          {lede ? <div className="max-w-[64ch] text-lg text-(--hero-dim)">{lede}</div> : null}
          {children ? <div className="pt-2">{children}</div> : null}
        </div>
        {art ? <div className="order-first justify-self-start md:order-none md:justify-self-end">{art}</div> : null}
      </div>
      {stats?.length ? <StatTiles stats={stats} className="mt-8" /> : null}
    </section>
  )
}

/** Light a phrase of a headline in the shimmering gradient. */
export function Shimmer({ children }: { children: React.ReactNode }) {
  return <span className="text-shimmer">{children}</span>
}

/** A large glyph floating in a soft amber halo, for the hero's right side. */
export function HeroGlyph({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative grid place-items-center px-6 py-6" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--amber)_42%,transparent),color-mix(in_srgb,var(--violet)_18%,transparent)_62%,transparent)] blur-md [animation:pulse-soft_6s_ease-in-out_infinite]" />
      <div className={cn("relative glyph-glow leading-none [animation:bob_4.5s_ease-in-out_infinite]", className)}>{children}</div>
    </div>
  )
}

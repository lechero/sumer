import Link from "next/link"

import { NavLinks } from "@/components/nav-links"
import { SearchForm } from "@/components/search-form"

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/75 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-x-6 gap-y-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[1.05rem] font-bold tracking-tight">
          <span className="font-cuneiform glyph-glow text-2xl leading-none text-amber" aria-hidden>
            𒅴𒂠
          </span>
          <span>Sumer</span>
          <span className="hidden font-medium text-muted-foreground lg:inline">· ancient languages library</span>
        </Link>
        <NavLinks />
        <div className="ml-auto hidden w-72 sm:block">
          <SearchForm compact />
        </div>
      </div>
    </header>
  )
}

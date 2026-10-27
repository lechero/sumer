import Link from "next/link"

import { SearchForm } from "@/components/search-form"

const NAV = [
  { href: "/", label: "Languages" },
  { href: "/signs", label: "Signs" },
  { href: "/search", label: "Search" },
  { href: "/next-steps", label: "Next steps" },
]

export function SiteHeader() {
  return (
    <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="font-cuneiform text-2xl leading-none" aria-hidden>
            𒅴𒂠
          </span>
          <span>Sumer</span>
          <span className="hidden text-muted-foreground font-normal sm:inline">· ancient languages dictionary</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto w-full sm:w-72">
          <SearchForm compact />
        </div>
      </div>
    </header>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@workspace/ui/lib/utils"

const NAV = [
  { href: "/", label: "Languages", match: (p: string) => p === "/" || p.startsWith("/languages") || p.startsWith("/entries") },
  { href: "/scripts", label: "Scripts", match: (p: string) => p.startsWith("/scripts") || p.startsWith("/signs") },
  { href: "/search", label: "Search", match: (p: string) => p.startsWith("/search") },
  { href: "/next-steps", label: "Next steps", match: (p: string) => p.startsWith("/next-steps") },
]

/** Header links; the current section gets an amber underline. */
export function NavLinks() {
  const pathname = usePathname() ?? "/"
  return (
    <nav className="flex shrink-0 items-center gap-5 text-sm">
      {NAV.map((item) => {
        const active = item.match(pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 py-1 transition-colors",
              active ? "border-amber font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

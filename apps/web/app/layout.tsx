import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"

import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { ThemeProvider } from "@/components/theme-provider"
import { cuneiformFontFamily } from "@/lib/cuneiform-fonts"

export const metadata: Metadata = {
  title: { default: "Sumer · ancient languages dictionary", template: "%s · Sumer" },
  description:
    "A dictionary of ancient languages — Sumerian, Akkadian, Ancient Greek, Biblical Hebrew — with words, word parts and the links between them.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased font-sans", GeistSans.variable, GeistMono.variable)}
      // Self-hosted Oracc cuneiform fonts (lib/cuneiform-fonts.ts); fetched only for pages with cuneiform.
      style={{ "--font-cuneiform-web": cuneiformFontFamily } as React.CSSProperties}
    >
      <head>
        {/* Pointed Hebrew and polytonic Greek need fonts most systems lack. Loaded at runtime (not through next/font) so builds work offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+Hebrew:wght@400;600&family=Noto+Serif:ital,wght@0,400;0,600;1,400&display=swap"
        />
      </head>
      <body className="flex min-h-svh flex-col">
        <ThemeProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  )
}

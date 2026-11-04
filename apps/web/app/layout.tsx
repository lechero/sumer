import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"

import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { ThemeProvider } from "@/components/theme-provider"
import { cuneiformFontFamily } from "@/lib/cuneiform-fonts"
import { scriptFontVariables } from "@/lib/script-fonts"

export const metadata: Metadata = {
  title: { default: "Sumer · ancient languages dictionary", template: "%s · Sumer" },
  description:
    "A library of ancient languages and scripts — Sumerian, Akkadian, Egyptian, Hebrew, Greek, Latin and more — with words, word parts, signs and the links between them.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased font-sans", GeistSans.variable, GeistMono.variable)}
      // Self-hosted script fonts (lib/cuneiform-fonts.ts, lib/script-fonts.ts). Each declares a unicode-range,
      // so the browser only downloads a font for pages that contain its characters.
      style={{ "--font-cuneiform-web": cuneiformFontFamily, ...scriptFontVariables } as React.CSSProperties}
    >
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

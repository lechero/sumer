import { cn } from "@workspace/ui/lib/utils"

import { ISO_FONT_CLASS } from "@/lib/scripts"

/** BCP 47 tag for native-script text when the script implies the language well enough. */
const SCRIPT_LANG: Record<string, string> = {
  Xsux: "sux",
  Hebr: "hbo",
  Grek: "grc",
  Egyp: "egy",
  Copt: "cop",
  Syrc: "syc",
  Ugar: "uga",
  Xpeo: "peo",
  Linb: "gmy",
  Goth: "got",
  Phnx: "phn",
}

type Props = {
  text: string | null | undefined
  script: string
  direction?: "ltr" | "rtl"
  /** The entry's language (overrides the script's default tag). */
  lang?: string
  className?: string
  as?: "span" | "div" | "h1" | "p"
}

/** Renders native-script text with the right font, language tag and direction. */
export function NativeText({ text, script, direction = "ltr", lang, className, as: Tag = "span" }: Props) {
  if (!text) return null
  return (
    <Tag lang={lang ?? SCRIPT_LANG[script]} dir={direction} className={cn(ISO_FONT_CLASS[script], className)}>
      {text}
    </Tag>
  )
}

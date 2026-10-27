import { cn } from "@workspace/ui/lib/utils"

const SCRIPT_CLASS: Record<string, string> = {
  Xsux: "font-cuneiform",
  Hebr: "font-hebrew",
  Grek: "font-greek",
}

const SCRIPT_LANG: Record<string, string> = {
  Xsux: "sux",
  Hebr: "hbo",
  Grek: "grc",
}

type Props = {
  text: string | null | undefined
  script: string
  direction?: "ltr" | "rtl"
  className?: string
  as?: "span" | "div" | "h1" | "p"
}

/** Renders native-script text with the right font, language tag and direction. */
export function NativeText({ text, script, direction = "ltr", className, as: Tag = "span" }: Props) {
  if (!text) return null
  return (
    <Tag lang={SCRIPT_LANG[script]} dir={direction} className={cn(SCRIPT_CLASS[script], className)}>
      {text}
    </Tag>
  )
}

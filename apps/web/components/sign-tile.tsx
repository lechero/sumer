import Link from "next/link"
import type { SignListItem } from "@workspace/db"

import { SignFace } from "@/components/sign-face"
import { signHref } from "@/lib/scripts"

export function SignTile({ sign }: { sign: SignListItem }) {
  // Cuneiform lists Sumerian (unmarked) readings first; other scripts tag every reading with its language.
  const unmarked = sign.readings.filter((r) => !r.isDeprecated && !r.language)
  const readings = (unmarked.length || sign.scriptId === "cuneiform" ? unmarked : sign.readings.filter((r) => !r.isDeprecated)).map((r) => r.value)
  return (
    <Link
      href={signHref(sign.scriptId, sign.name)}
      className="glass lift group flex min-w-0 flex-col items-center gap-1 rounded-xl p-3 text-center"
      title={[sign.unicodeName ?? sign.name, sign.description].filter(Boolean).join(" — ")}
    >
      <span className="flex min-h-10 max-w-full items-center text-4xl leading-none text-amber transition-[text-shadow] group-hover:glyph-glow" aria-hidden>
        <SignFace unicode={sign.unicode} components={sign.components} script={sign.scriptId} />
      </span>
      <span className="mt-1 max-w-full truncate font-mono text-xs font-semibold group-hover:text-violet">{sign.name}</span>
      {readings.length ? (
        <span className="line-clamp-1 text-[11px] text-muted-foreground">{readings.slice(0, 4).join(" · ")}</span>
      ) : null}
    </Link>
  )
}

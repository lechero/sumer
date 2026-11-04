import Link from "next/link"
import type { SignListItem } from "@workspace/db"

import { SignFace } from "@/components/sign-face"

export function signHref(name: string) {
  return `/signs/${encodeURIComponent(name)}`
}

export function SignTile({ sign }: { sign: SignListItem }) {
  const readings = sign.readings.filter((r) => !r.isDeprecated && !r.language).map((r) => r.value)
  return (
    <Link
      href={signHref(sign.name)}
      className="group flex min-w-0 flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors hover:bg-muted"
      title={sign.unicodeName ?? sign.name}
    >
      <span className="flex min-h-10 max-w-full items-center text-4xl leading-none" aria-hidden>
        <SignFace unicode={sign.unicode} components={sign.components} />
      </span>
      <span className="mt-1 max-w-full truncate font-mono text-xs font-medium group-hover:underline">{sign.name}</span>
      {readings.length ? (
        <span className="line-clamp-1 text-[11px] text-muted-foreground">{readings.slice(0, 4).join(" · ")}</span>
      ) : null}
    </Link>
  )
}

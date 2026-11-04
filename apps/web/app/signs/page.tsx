import { permanentRedirect } from "next/navigation"

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** The cuneiform sign browser moved to /scripts/cuneiform; keep old links working. */
export default async function SignsRedirect({ searchParams }: Props) {
  const sp = await searchParams
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) for (const value of [v].flat()) if (value !== undefined) query.append(k, value)
  const s = query.toString()
  permanentRedirect(`/scripts/cuneiform${s ? `?${s}` : ""}`)
}

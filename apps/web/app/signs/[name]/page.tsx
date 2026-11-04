import { permanentRedirect } from "next/navigation"

type Props = { params: Promise<{ name: string }> }

/** Cuneiform sign pages moved to /scripts/cuneiform/<name>. */
export default async function SignRedirect({ params }: Props) {
  const { name } = await params
  permanentRedirect(`/scripts/cuneiform/${encodeURIComponent(decodeURIComponent(name))}`)
}

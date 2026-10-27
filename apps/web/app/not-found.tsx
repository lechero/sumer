import Link from "next/link"
import { Button } from "@workspace/ui/components/button"

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-16">
      <p className="font-cuneiform text-5xl text-muted-foreground" aria-hidden>𒉡</p>
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="text-muted-foreground">nu — “not”. There is no such page or entry.</p>
      <Button variant="outline" nativeButton={false} render={<Link href="/" />}>Back to the languages</Button>
    </div>
  )
}

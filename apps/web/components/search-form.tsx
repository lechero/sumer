import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

type Props = {
  defaultValue?: string
  /** Keep the search inside one language. */
  languageId?: string
  kind?: string
  compact?: boolean
  placeholder?: string
}

/** Plain GET form: works without JavaScript and keeps the query in the URL. */
export function SearchForm({ defaultValue, languageId, kind, compact, placeholder }: Props) {
  const action = languageId ? `/languages/${languageId}` : "/search"
  const hidden = kind ? <input type="hidden" name="kind" value={kind} /> : null
  const label = placeholder ?? "Search lugal, 𒈗, king, λόγος, שלום…"
  if (compact) {
    return (
      <form action={action} method="get" className="flex w-full items-center gap-2" role="search">
        {hidden}
        <Input type="search" name="q" defaultValue={defaultValue} placeholder={label} aria-label="Search the dictionary" className="h-8 bg-background/60" />
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>
    )
  }
  return (
    <form
      action={action}
      method="get"
      role="search"
      className={cn(
        "glass flex w-full items-center gap-2 rounded-full p-1.5 pl-5 transition-[border-color,box-shadow]",
        "focus-within:border-violet/60 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--violet)_18%,transparent)]"
      )}
    >
      {hidden}
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={label}
        aria-label="Search the dictionary"
        className="h-10 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <button type="submit" className="btn-glow h-10 shrink-0 px-6 text-sm">
        Search
      </button>
    </form>
  )
}

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

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
  return (
    <form action={action} method="get" className="flex w-full items-center gap-2" role="search">
      {kind ? <input type="hidden" name="kind" value={kind} /> : null}
      <Input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder ?? "Search lugal, 𒈗, king, λόγος, שלום…"}
        aria-label="Search the dictionary"
        className={compact ? "h-8" : "h-10 text-base"}
      />
      <Button type="submit" size={compact ? "sm" : "default"} variant={compact ? "outline" : "default"}>
        Search
      </Button>
    </form>
  )
}

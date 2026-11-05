import { getDatabaseInfo } from "@workspace/db"

export function SiteFooter() {
  const info = getDatabaseInfo()
  const label = info.driver === "postgres" ? "Postgres (DATABASE_URL)" : "embedded PGlite — set DATABASE_URL in .env to use Postgres"
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6">
        <span className="flex items-center gap-2.5">
          <span className="font-cuneiform text-lg leading-none text-amber" aria-hidden>𒅴𒂠</span>
          Open dictionaries and sign lists, each entry with its source and licence — verify before citing.
        </span>
        <span className="flex items-center gap-3">
          <span>
            database: <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{label}</code>
          </span>
          <span className="hidden sm:inline">
            press <kbd className="rounded border border-b-2 px-1.5 font-mono">d</kbd> for {"day / night"}
          </span>
        </span>
      </div>
    </footer>
  )
}

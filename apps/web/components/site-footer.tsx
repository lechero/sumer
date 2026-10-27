import { getDatabaseInfo } from "@workspace/db"

export function SiteFooter() {
  const info = getDatabaseInfo()
  const label =
    info.driver === "postgres"
      ? "Postgres (DATABASE_URL)"
      : "embedded PGlite — set DATABASE_URL in .env to use Postgres"
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <span>Seed data is hand-curated — verify against the cited sources before citing.</span>
        <span>
          database: <code className="font-mono">{label}</code>
        </span>
      </div>
    </footer>
  )
}

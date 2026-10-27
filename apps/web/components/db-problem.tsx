import type { DbResult } from "@/lib/data"

export function DbProblem({ result }: { result: Extract<DbResult<unknown>, { ok: false }> }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <h2 className="font-semibold">{result.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{result.hint}</p>
      <pre className="mt-4 overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{result.detail}</pre>
    </div>
  )
}

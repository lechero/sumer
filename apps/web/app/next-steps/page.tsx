import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Metadata } from "next"
import { findWorkspaceRoot } from "@workspace/db"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

export const metadata: Metadata = { title: "Next steps" }

const components: Components = {
  h1: ({ children }) => <h1 className="text-3xl font-semibold tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-10 border-b pb-2 text-xl font-semibold tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 text-base font-semibold">{children}</h3>,
  p: ({ children }) => <p className="leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="underline underline-offset-4 hover:text-foreground" target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => <pre className="overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-sm">{children}</pre>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50 text-left">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t px-3 py-2 align-top">{children}</td>,
  blockquote: ({ children }) => <blockquote className="border-l-2 pl-4 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-8" />,
}

export default async function NextStepsPage() {
  const file = path.join(/* turbopackIgnore: true */ findWorkspaceRoot(), "docs", "NEXT_STEPS.md")
  const markdown = await readFile(/* turbopackIgnore: true */ file, "utf8")
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

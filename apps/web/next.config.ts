import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@workspace/ui", "@workspace/db"],
  // Native / WASM database drivers must run in Node, not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
}

export default nextConfig

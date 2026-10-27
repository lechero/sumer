import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs"
import { readFile, rename, unlink } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { findWorkspaceRoot } from "@workspace/db"

/** `<repo>/.cache/importers` (git-ignored), or IMPORTERS_CACHE_DIR. */
export function cacheRoot(): string {
  return process.env.IMPORTERS_CACHE_DIR?.trim() || path.join(findWorkspaceRoot(), ".cache", "importers")
}

export function cachePath(source: string, file: string): string {
  const p = path.join(cacheRoot(), source, file)
  mkdirSync(path.dirname(p), { recursive: true })
  return p
}

export type DownloadOptions = { offline?: boolean; log?: (m: string) => void; force?: boolean }

/**
 * Download `url` into the cache unless it is already there. With `offline`
 * a missing file is an error that tells the user which URL to fetch by hand.
 */
export async function download(source: string, file: string, url: string, opts: DownloadOptions = {}): Promise<string> {
  const dest = cachePath(source, file)
  const log = opts.log ?? (() => {})
  if (!opts.force && existsSync(dest) && statSync(dest).size > 0) {
    log(`cached  ${path.relative(cacheRoot(), dest)}`)
    return dest
  }
  if (opts.offline) {
    throw new Error(`offline and not cached: ${dest}\n  download it yourself:  curl -L -o "${dest}" "${url}"`)
  }
  log(`fetch   ${url}`)
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  const tmp = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmp))
  await rename(tmp, dest)
  log(`saved   ${path.relative(cacheRoot(), dest)} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`)
  return dest
}

export async function readCached(dest: string): Promise<string> {
  return readFile(dest, "utf8")
}

export async function removeCached(dest: string): Promise<void> {
  if (existsSync(dest)) await unlink(dest)
}

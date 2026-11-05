/**
 * Minimal streaming reader for .tar.gz archives (ustar, with pax / GNU long
 * names), enough for GitHub's codeload tarballs. Yields one regular file at a
 * time; only that file is held in memory, never the archive.
 */
import { createReadStream } from "node:fs"
import { createGunzip } from "node:zlib"

export type TarFile = { name: string; data: Buffer }

const BLOCK = 512

/** Bytes buffered from the gunzip stream, consumed from the front without re-copying the rest. */
class ByteQueue {
  private chunks: Buffer[] = []
  private head = 0 // offset into chunks[0]
  length = 0

  push(b: Buffer) {
    if (b.length) {
      this.chunks.push(b)
      this.length += b.length
    }
  }

  /** Remove and return the first `n` bytes (n <= length). */
  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n)
    let filled = 0
    while (filled < n) {
      const c = this.chunks[0]!
      const k = Math.min(n - filled, c.length - this.head)
      c.copy(out, filled, this.head, this.head + k)
      filled += k
      this.head += k
      if (this.head === c.length) {
        this.chunks.shift()
        this.head = 0
      }
    }
    this.length -= n
    return out
  }
}

const field = (h: Buffer, start: number, len: number) => {
  const raw = h.subarray(start, start + len)
  const nul = raw.indexOf(0)
  return (nul < 0 ? raw : raw.subarray(0, nul)).toString("utf8")
}

/** pax extended header records: "<len> path=<value>\n". */
function paxPath(data: Buffer): string | undefined {
  const text = data.toString("utf8")
  return text.match(/(?:^|\n)\d+ path=([^\n]*)\n/)?.[1]
}

export async function* iterateTarGz(file: string): AsyncGenerator<TarFile> {
  const q = new ByteQueue()
  let longName: string | undefined
  let pending: { name: string; type: string; size: number } | undefined
  const stream = createReadStream(file, { highWaterMark: 1 << 20 }).pipe(createGunzip())
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    q.push(chunk)
    for (;;) {
      if (!pending) {
        if (q.length < BLOCK) break
        const h = q.take(BLOCK)
        if (h.every((b) => b === 0)) continue // end-of-archive padding
        const size = parseInt(field(h, 124, 12).trim() || "0", 8)
        const prefix = field(h, 345, 155)
        const base = field(h, 0, 100)
        pending = { name: prefix ? `${prefix}/${base}` : base, type: field(h, 156, 1) || "0", size }
      }
      const padded = Math.ceil(pending.size / BLOCK) * BLOCK
      if (q.length < padded) break
      const data = q.take(padded).subarray(0, pending.size)
      const { type, name } = pending
      pending = undefined
      if (type === "x") longName = paxPath(data) ?? longName
      else if (type === "L") longName = field(data, 0, data.length)
      else if (type === "g") continue // global pax header (GitHub stores the commit id there)
      else {
        const fullName = longName ?? name
        longName = undefined
        if (type === "0" || type === "7") yield { name: fullName, data }
      }
    }
  }
}

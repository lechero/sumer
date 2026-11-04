/** Stream a JSON Lines file one record at a time (never holds the file in memory). */
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"

export async function* iterateJsonLines<T = unknown>(file: string): AsyncGenerator<T> {
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 }), crlfDelay: Infinity })
  let n = 0
  try {
    for await (const line of lines) {
      n++
      if (!line.trim()) continue
      try {
        yield JSON.parse(line) as T
      } catch (err) {
        throw new Error(`${file}:${n}: invalid JSON (${(err as Error).message})`)
      }
    }
  } finally {
    lines.close()
  }
}

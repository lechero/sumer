export function logger(prefix: string) {
  return (message: string) => console.log(`[${prefix}] ${message}`)
}

/**
 * Perseus beta code → polytonic Unicode Greek.
 *   "lo/gos"  → λόγος     "a)/nqrwpos" → ἄνθρωπος     "*)aqh=nai" → Ἀθῆναι
 */
const LETTERS: Record<string, string> = {
  a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι", k: "κ", l: "λ", m: "μ",
  n: "ν", c: "ξ", o: "ο", p: "π", r: "ρ", s: "σ", t: "τ", u: "υ", f: "φ", x: "χ", y: "ψ", w: "ω",
  v: "ϝ", j: "ϛ",
}
const MARKS: Record<string, string> = {
  ")": "̓", // smooth breathing
  "(": "̔", // rough breathing
  "/": "́", // acute
  "\\": "̀", // grave
  "=": "͂", // circumflex
  "|": "ͅ", // iota subscript
  "+": "̈", // diaeresis
  "?": "̣", // dot below
}

export function looksLikeBetaCode(s: string): boolean {
  return /^[A-Za-z*()/\\=|+?'&0-9\s.,\-]+$/.test(s) && /[A-Za-z]/.test(s)
}

export function betaToUnicode(input: string): string {
  let out = ""
  let upper = false
  let pendingMarks = ""
  const chars = [...input]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    if (ch === "*") {
      upper = true
      continue
    }
    const lower = ch.toLowerCase()
    if (LETTERS[lower]) {
      let letter = LETTERS[lower]!
      if (lower === "s") {
        const next = chars.slice(i + 1).find((c) => !(c in MARKS) && c !== "*")
        const isFinal = !next || !LETTERS[next.toLowerCase()]
        if (isFinal && !upper) letter = "ς"
      }
      if (upper) letter = letter.toUpperCase()
      out += letter + pendingMarks
      pendingMarks = ""
      upper = false
      continue
    }
    if (MARKS[ch]) {
      if (upper || !out) pendingMarks += MARKS[ch]
      else out += MARKS[ch]
      continue
    }
    if (/[0-9]/.test(ch)) continue
    out += ch
  }
  return (out + pendingMarks).normalize("NFC")
}

/** Convert beta code inside free text: only runs on tokens that contain beta-code diacritic marks or are inside Greek-tagged elements. */
export function betaTokensToUnicode(s: string): string {
  return s.replace(/[A-Za-z*()/\\=|+]+/g, (tok) => (/[()/\\=|*]/.test(tok) && /[A-Za-z]/.test(tok) ? betaToUnicode(tok) : tok))
}

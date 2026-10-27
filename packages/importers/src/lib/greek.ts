/** Simple scholarly romanisation of polytonic Greek for search and display: λόγος → logos, ψυχή → psychē, ἥλιος → hēlios. */
const MAP: Record<string, string> = {
  α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "ē", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m",
  ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "ph", χ: "ch", ψ: "ps", ω: "ō",
  ϝ: "w", ϛ: "st",
}

export function transliterateGreek(word: string): string {
  const nfd = word.normalize("NFD")
  let out = ""
  let prev = ""
  for (const ch of nfd) {
    if (ch === "̔") {
      // rough breathing: h before the vowel (or after initial rho)
      if (prev === "r") out += "h"
      else {
        // insert before the last written vowel group
        const m = out.match(/([aeiouyēō]+)$/)
        if (m) out = out.slice(0, out.length - m[1]!.length) + "h" + m[1]
        else out += "h"
      }
      continue
    }
    if (/\p{M}/u.test(ch)) continue
    const lower = ch.toLowerCase()
    const latin = MAP[lower]
    if (latin === undefined) {
      out += ch
      prev = ch
      continue
    }
    // γγ, γκ, γξ, γχ → ng, nk, nx, nch
    if (prev === "g" && ["g", "k", "x", "ch"].includes(latin)) out = out.slice(0, -1) + "n"
    // υ after a vowel → u (αυ, ευ, ου)
    const t = latin === "y" && /[aeoē]$/.test(out) ? "u" : latin
    out += ch === lower ? t : t[0]!.toUpperCase() + t.slice(1)
    prev = latin
  }
  return out
}

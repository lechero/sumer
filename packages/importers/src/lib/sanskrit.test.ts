/** node --import tsx --test src/lib/sanskrit.test.ts */
import assert from "node:assert/strict"
import { test } from "node:test"

import { iastToDevanagari, iastToSlp1, slp1ToDevanagari, slp1ToIast } from "./sanskrit"

const CASES: [slp1: string, iast: string, deva: string][] = [
  ["agni/", "agní", "अग्नि"],
  ["deva/", "devá", "देव"],
  ["Darma", "dharma", "धर्म"],
  ["gam", "gam", "गम्"],
  ["rA/jan", "rā́jan", "राजन्"],
  ["a/Sva", "áśva", "अश्व"],
  ["pitf/", "pitṛ́", "पितृ"],
  ["saMskfta", "saṃskṛta", "संस्कृत"],
  ["duHKa", "duḥkha", "दुःख"],
  ["so'ham", "so'ham", "सोऽहम्"],
  ["jYAna", "jñāna", "ज्ञान"],
  ["kzatriya", "kṣatriya", "क्षत्रिय"],
  ["kxpta", "kḷpta", "कॢप्त"],
  ["pitFn", "pitṝn", "पितॄन्"],
  ["pra/uga", "práüga", "प्रउग"],
  ["ti/tau", "títaü", "तितउ"],
  ["dyO/s", "dyáus", "द्यौस्"],
  ["vE/Svadeva", "váiśvadeva", "वैश्वदेव"],
  ["nO/s", "náus", "नौस्"],
  ["akzitavya^", "akṣitavyà", "अक्षितव्य"],
  ["ILe", "īḷe", "ईळे"],
  ["mI|a", "mīḷha", "मीळ्ह"],
  ["hfd", "hṛd", "हृद्"],
  ["UrRA", "ūrṇā", "ऊर्णा"],
  ["SrI", "śrī", "श्री"],
  ["OzaDa", "auṣadha", "औषध"],
  ["E", "ai", "ऐ"],
  ["kAryA", "kāryā", "कार्या"],
  ["a—kAra", "a—kāra", "अ—कार"],
  ["ka~", "kam̐", "कँ"],
]

test("SLP1 → IAST", () => {
  for (const [slp1, iast] of CASES) assert.equal(slp1ToIast(slp1), iast.normalize("NFC"), slp1)
})

test("SLP1 → Devanagari", () => {
  for (const [slp1, , deva] of CASES) assert.equal(slp1ToDevanagari(slp1), deva, slp1)
})

test("IAST → SLP1 round trip", () => {
  for (const [slp1] of CASES) {
    if (/[—~]/.test(slp1)) continue
    assert.equal(iastToSlp1(slp1ToIast(slp1)), slp1.replace(/\\/g, ""), slp1)
  }
  assert.equal(iastToSlp1("Agni"), "agni")
  assert.equal(iastToSlp1("saṁsāra"), "saMsAra")
  assert.equal(iastToDevanagari("nirvāṇa"), "निर्वाण")
  assert.equal(iastToDevanagari("kṛ"), "कृ")
  assert.equal(iastToDevanagari("śāriputra"), "शारिपुत्र")
})

# Next steps

This page is the working roadmap for the ancient-languages dictionary. It is rendered in the app at `/next-steps` and lives in the repo at `docs/NEXT_STEPS.md` — edit it there.

## 0. Where things stand

**Done**

- pnpm + Turborepo monorepo in the shadcn/ui layout: `apps/web` (Next.js 16, React 19, Tailwind v4), `packages/ui` (shadcn components), `packages/db` (Drizzle ORM), shared ESLint / TypeScript configs.
- Postgres 17 via `docker-compose.yml`, configured by `.env` (copy `.env.example`). Without `DATABASE_URL` the app and scripts fall back to an embedded **PGlite** database in `./.pglite`, so everything runs with zero setup.
- Schema: `languages`, `sources`, `entries` (kind = **word** or **part**), `senses`, `entry_components` (what an entry is built from), `entry_relations` (loans, cognates, translation equivalents across languages).
- Seed data: Sumerian, Akkadian, Ancient Greek and Biblical Hebrew. A few hundred hand-curated words and word parts, with composition (lugal = lu + gal) and cross-language chains (egal → ekallu → הֵיכָל).
- **Dictionary importers** (`task import:all` or `pnpm run import --all`), ~647k entries in 26 languages in total:
  - ePSD2: 15,940 Sumerian lemmas, 15,152 rendered in cuneiform, 909 compounds linked to their members, Akkadian equivalents.
  - eBL: 22,263 Akkadian words with derivations and logograms.
  - Open Scriptures: 8,834 Hebrew + 745 Aramaic words, 2,000 roots.
  - LSJ: ~112k Greek entries.
  - Lewis & Short: 51,602 Latin entries.
  - Monier-Williams: 202,587 Sanskrit entries with roots, compounds and derivations.
  - Digital Pāḷi Dictionary: 81,419 Pali entries, with Sanskrit cognates linked to Monier-Williams.
  - Thesaurus Linguae Aegyptiae (AED-TEI): 35,018 Egyptian lemmas with hieroglyphs and corpus frequencies.
  - Bosworth–Toller: 45,443 Old English entries. Zoëga: 30,681 Old Norse entries.
  - Comprehensive Coptic Lexicon: 11,262 Coptic entries. Greek loanwords are linked to LSJ, and Egyptian ancestors to the TLA by lemma id.
  - Wiktionary (Kaikki) in two modes:
    - It supplies the entries for 14 languages that have no open dictionary here: Hittite, Ugaritic, Syriac, Sabaean, Ge'ez, Mycenaean Greek, Etruscan, Old Persian, Tocharian B, Gothic, Old Irish, Old Church Slavonic, Classical Armenian and Proto-Indo-European.
    - It enriches the dictionaries of 10 more with synonyms, antonyms, derived and related terms, etymologies and cognate links.
- **Thesaurus** on every entry page: synonyms, antonyms and related words, words of the same meaning in the same language, and the same meaning across every other language. The meaning match goes through an indexed split of the glosses (`glossTerms()`).
- **Writing systems**: a `scripts` table with 24 scripts, each with its own sign inventory (`signs.script_id`), ~13.9k signs in all:
  - Oracc Sign List: 4,264 cuneiform signs, 11,208 readings.
  - Oracc PCSL: 2,240 proto-cuneiform signs.
  - Unicode Unikemet: 5,067 Egyptian hieroglyphs in Gardiner's categories, with phonetic values.
  - Unicode Character Database: 21 alphabets, abjads, abugidas and syllabaries, from Ugaritic and Linear B to Devanagari, Ge'ez, Armenian, Early Cyrillic, runes and ogham, with transliterations.
  - Browsed at `/scripts`. Each sign page has prev/next navigation. Cuneiform and hieroglyph sign pages also list every word written with the sign.
- **Cuneiform**: a transliteration → Unicode renderer (`{d}en-lil₂` → 𒀭𒂗𒆤), and a sign-by-sign breakdown on entry pages and in result tables (each glyph's reading, sign and, for Sumerian, its meaning as a word; on entry pages also the sign's other values and list numbers). Akkadian and Hittite Sumerograms resolve to the Sumerian word they write. Unencoded signs are shown through their components (`|BAR×TAB|` → 𒁇×𒋰) and link to them.
- **Breakdowns in every script**: hieroglyphs sign by sign with each sign's role in the spelling (sound sign, word sign, complement, ending, classifier); letter by letter for the 21 alphabets and syllabaries, with marks named and the word read together; and a word anatomy (component tree plus derived-from / borrowed-from ancestry).
- **Glyphs**: every script is drawn with self-hosted fonts (`task fonts`):
  - Oracc's cuneiform fonts draw 3,243 of the 4,264 signs, including the OSL Private Use Area and Archaic Cuneiform Numerals.
  - PCSL for proto-cuneiform.
  - UniHieroglyphica, renamed for the OFL, for all Unicode hieroglyphs.
  - Noto for the rest.
  - Nothing is loaded from Google Fonts.
- Web app: language overview, per-language browsing (words / parts), global search that ignores diacritics, vowel points and sign indices (with per-language counts to narrow it), entry pages with numbered sections (meaning, etymology, breakdown, anatomy, usages, thesaurus, connections) and an on-this-page index, a JSON API at `/api/entries`. A dark "night sky" theme by default (glass panels, glowing glyphs; press `d` for the light parchment theme).

**Not done / caveats**

- The hand seed is a thin curated layer; the imported sources are the reference. Sumerian headwords follow ePSD2 citation forms (`e`, `lu`, `egal`), with the usual indexed spelling (`e₂`, `lu₂`, `e₂-gal`) shown as transliteration.
- LSJ senses and glosses are extracted heuristically from TEI (first `<tr>` translations); part of speech for Greek is guessed from endings and inflection notes.
- eBL's licence must be checked before redistributing the Akkadian data; the Oracc server's TLS chain may need the ePSD2 zip to be downloaded by hand.
- Cuneiform is shown in its standard Unicode form, which is the Neo-Assyrian sign shape; period-specific glyphs (Ur III, Old Babylonian) need a dedicated font or images.
- 16 OSL Private Use Area code points (mostly curved numerals such as `10(U@c)`) have no glyph in any Oracc font yet; those signs fall back to their components.
- PGlite allows a single process per data directory: stop the dev server before seeding when you are not on Postgres.
- Wiktionary data is broader but less precise than the scholarly lexica. Its etymology links are only made when the target word resolves unambiguously, so many mentions stay unlinked. Kaikki marks its per-language dumps deprecated; the importer may have to move to the full raw dump.
- Re-importing one dictionary alone overwrites the etymologies and scripts Wiktionary filled in for it, until `wikt-<code>` or `wiktionary-links` runs again. `--all` runs them in the right order.
- "Same meaning" matches glosses literally ("lord" = "lord"), so it misses paraphrases, and very general glosses ("to be", "man") give long lists. Glosses in German (half the Egyptian ones) only meet other German glosses.
- **Licences to watch:**
  - The Digital Pāḷi Dictionary is CC BY-NC-SA 4.0, so a commercial deployment would need Pali back on Wiktionary only.
  - The Monier-Williams repository is CC BY-SA 4.0, but its older TEI header says CC BY-NC-SA 3.0.
  - There is no open Old Irish dictionary. eDIL belongs to the Royal Irish Academy, so Old Irish stays on Wiktionary's 3,231 lemmas unless the Academy grants permission.
- Gloss extraction is heuristic in Lewis & Short, Bosworth–Toller and Monier-Williams. About 6.5k Latin entries are "see …" redirects to another spelling, and a few hundred glosses are still bare labels or pointers.
- Alphabet transliterations are hand-written maps in `packages/importers/src/sources/alphabets.ts` (one convention per script). Anatolian hieroglyphs and proto-cuneiform signs have no readings yet.
- The breakdowns' reading rules are heuristics: Hebrew sheva (vocal or silent) and matres lectionis, Greek diphthongs and nasal γ, Ge'ez sixth-order vowels, and the hieroglyph roles, which are matched against the transliteration and say "unread" when nothing fits. Devanagari, Armenian, Early Cyrillic and Ge'ez are drawn with system fonts (no self-hosted WOFF2 yet), so rare letters such as ꙑ or ꙗ depend on the reader's machine.
- Almost no tests (one transliteration test file), no CI, no auth, no editing UI yet.

## 1. Run it

```bash
cp .env.example .env          # optional: without it, PGlite is used
docker compose up -d          # Postgres on localhost:5432 (skip when using PGlite)
pnpm install
pnpm db:setup                 # migrations + seed
pnpm dev                      # http://localhost:3000
```

Useful: `pnpm db:studio` (Drizzle Studio), `pnpm db:generate` after editing `packages/db/src/schema.ts`, `pnpm docker:reset` to wipe the Postgres volume.

## 2. Collect the data — sources and importers

Importers live in `packages/importers/src/sources/`. Each one downloads into `.cache/importers/<source>/`, converts to `SeedDataset` and calls `upsertDataset` (stable per-source refs, re-runnable). Sign lists go through `writeSignInventory` (`src/lib/signs.ts`).

- **Done:** osl, pcsl, unikemet, alphabets, epsd2, ebl, oshb, lsj, lewis-short, monier-williams, dpd, bosworth-toller, zoega, tla-egy, coptic, wiktionary.
- **Next:** the rows below marked *todo*.

| Language | Source | Format | Licence | Notes |
| --- | --- | --- | --- | --- |
| Sumerian | [ePSD2](http://oracc.museum.upenn.edu/epsd2/) (Oracc) | `epsd2.zip` → `gloss-sux.json` (1.9 GB) | CC BY-SA 3.0 | **done** — forms/periods/instances not yet stored (a `forms` table would hold the 100k+ spellings). |
| Sumerian / Akkadian | [Oracc Sign List (OSL)](https://github.com/oracc/osl) | `00lib/osl.asl` | CC0 | **done** (incl. `@upua` private-use glyphs). `@sys` compositions and sign images are *todo*. |
| Proto-cuneiform | [Oracc PCSL](https://github.com/oracc/pcsl) | `00lib/pcsl.asl` | CC0 | **done**. *todo*: numeric values, and the PCSL corpus for attestations. |
| Egyptian | [Unikemet](https://www.unicode.org/reports/tr57/) (Unicode) | `Unikemet.txt` | Unicode License v3 | **done**: 5,067 hieroglyphs with Gardiner numbers and phonetic values. |
| Egyptian | [TLA](https://thesaurus-linguae-aegyptiae.de/) lemma list, 2018 extract in [AED-TEI](https://github.com/simondschweitzer/aed-tei) | TEI XML + corpus | CC BY-SA 4.0 | **done**: 35,018 lemmas, with hieroglyphs and frequencies from the AED corpus. *todo*: a newer TLA dump (the website is behind bot verification) and Demotic (`tla-demotic` has forms but no glosses). |
| Sumerian | [ETCSL](https://etcsl.orinst.ox.ac.uk/) | TEI XML | academic use | Literary corpus for attestations / example lines. |
| Sumerian | [CDLI](https://cdli.mpiwg-berlin.mpg.de/) | ATF, API | CC BY | Transliterated tablets; attestation counts and images. |
| Akkadian | Oracc project glossaries (e.g. [RINAP](http://oracc.org/rinap), [SAAo](http://oracc.org/saao)) | JSON | CC BY-SA | Same JSON shape as ePSD2 → one importer covers both. |
| Akkadian | [eBL](https://www.ebl.lmu.de/) dictionary & sign list | API / JSON | see eBL terms | **done** (dictionary). *todo*: eBL sign list (MesZL numbers, sign images per period via `/api/signs/<name>/images`). |
| Akkadian | [CAD](https://isac.uchicago.edu/research/publications/assyrian-dictionary-oriental-institute-university-chicago-cad) | PDF | free PDFs | Reference only; not machine-readable. |
| Greek | [LSJ](https://github.com/PerseusDL/lexica) (Perseus) | TEI XML | CC BY-SA 4.0 | **done** — citations, etymologies and dialect notes are flattened into the definition text; a structured model is *todo*. |
| Greek | Perseus Morpheus / [Morpheus data](https://github.com/PerseusDL/morpheus) | XML | CC BY-SA | Inflected forms and stems → `entry_components`. |
| Hebrew | [Open Scriptures Hebrew Lexicon](https://github.com/openscriptures/HebrewLexicon) (BDB + Strong's) | XML | CC BY 4.0 | **done** — Strong's numbers are in the notes; make them searchable (*todo*). |
| Hebrew | [OSHB morphology](https://github.com/openscriptures/morphhb) | XML | CC BY 4.0 | Every word in the Hebrew Bible parsed → attestations and affixes. |
| Latin | [Lewis & Short](https://github.com/PerseusDL/lexica) (Perseus) | TEI XML | CC BY-SA 4.0 | **done**. *todo*: inflected forms (Whitaker's Words, Morpheus). |
| Coptic | [Comprehensive Coptic Lexicon](https://github.com/KELLIA/dictionary) (KELLIA) | TEI XML | CC BY-SA 4.0 | **done**, with Egyptian/Demotic etymologies and Greek loanwords linked to LSJ. |
| 24 languages | [kaikki.org](https://kaikki.org/) (Wiktionary) | per-language JSONL | CC BY-SA 4.0 + GFDL | **done**: lemmas for 14 languages, enrichment (synonyms, antonyms, derived and related terms, etymologies) for 10, and `{{inh}}` / `{{der}}` / `{{bor}}` / `{{cog}}` etymology links. Not on Kaikki: Phoenician, Avestan, Luwian, Hurrian and Elamite. |
| Sanskrit | [Cologne CDSL](https://github.com/sanskrit-lexicon/csl-orig) (Monier-Williams 1899) | `mw.txt` | CC BY-SA 4.0 (older header: CC BY-NC-SA 3.0) | **done**: 202,587 entries. *todo*: Apte or Macdonell for a second opinion, and upasargas as prefixes (MW lists them as adverbs). |
| Pali | [Digital Pāḷi Dictionary](https://github.com/digitalpalidictionary/dpd-db) | TSV | CC BY-NC-SA 4.0 | **done**: 81,419 entries. The PTS dictionary was rejected because its digital copies are CC BY-NC or unlicensed. |
| Old English | [Bosworth–Toller](http://hdl.handle.net/11234/1-3532) (Charles University) | CSV | CC BY 4.0 | **done**: 45,443 entries, Supplement merged. *todo*: palatal dots (ċ ġ) from Wiktionary. |
| Old Norse | [Zoëga](https://github.com/stscoundrel/old-icelandic-zoega) (1910) | JSON | public domain / MIT | **done**: 30,681 entries. *todo*: Cleasby–Vigfússon (MIT edition) for etymologies and longer definitions. |
| Old Irish | [eDIL](https://dil.ie/) | web | © Royal Irish Academy | Not open: needs permission. Open fallbacks are small (Goidelex, 573 lexemes) or partial OCR (Kuno Meyer, A–D). |

Languages to add next (each one is a `languages` row plus an importer):

- Aramaic beyond the Bible ([CAL](https://cal.huc.edu/); check its licence).
- Hittite and Luwian ([eDiAna](https://www.ediana.gwi.uni-muenchen.de/)).
- Avestan.
- Old Turkic.
- Classical Chinese, with the oracle-bone and bronze scripts as further `scripts` rows.
- Mayan hieroglyphs: a sign list once Unicode encodes them; the proposal is in progress.

Importer checklist:

- Re-runnable (upsert on language + kind + headword + homonym) and incremental.
- Keep raw downloads out of git; cache them under `.cache/` (git-ignored).
- Normalise transliteration conventions per language (ŋ vs ĝ, subscript indices) and record the convention in the `languages` row.
- Validate before writing: unknown components, dangling relations, duplicate headwords (the seed already does this).

### Cuneiform glyphs — next

- **Sign images by period**: eBL serves photographs of each sign cut from tablets (`/api/signs/LUGAL/images`, ~hundreds of MB per sign — fetch lazily, cache thumbnails) and Fossey/Labat drawings; OSL ships sign drawings for archaic forms (`00res/images`). A `sign_images (sign_id, period, url, source, licence)` table and a strip of period forms on each sign page would show how 𒈗 looked from Uruk IV to Neo-Assyrian.
- **Sign images for unencoded signs**: 151 of the 867 signs without Unicode have a LAK number, and OSL ships Deimel's LAK drawings (1922, public domain) in `00res/images/lak` of [oracc/osl](https://github.com/oracc/osl). Import them into a `sign_images` table and show them in the fallback frame. The other image sets there (RSP 1967, ELLES 1981, BAU and KWU 1935) come from publications that may still be under copyright.
- **Fonts per period**: Oracc publishes OFL fonts per period in [oracc/oracc2](https://github.com/oracc/oracc2/tree/main/msc/fonts): LAK and RSP (Early Dynastic), Gudea and EMC, OB-Freie (Old Babylonian) and Nabuninuaihsus (Neo-Assyrian). `apps/web/fonts/build.py` already fetches four of them; add a period switch on sign pages that shows a sign in each.
- **Sign search by shape**: wedge-count / Gottstein codes from OSL (`@sys`) for "what is this sign?" lookups.
- **Numbers**: the numeric block (𒐈, 𒐕 …) as a dedicated numeral table with sexagesimal values.

## 3. Schema evolution

- `attestations` (entry ↔ text reference ↔ line, with the original line and translation) — needed as soon as corpora are imported.
- `forms` (inflected / variant spellings with grammatical features) so searches hit inflected words, not only lemmas.
- `tags` / semantic domains as a table instead of free text on `senses.domain`.
- `sign_readings` for cuneiform: sign → readings → languages; link `entries.native_script` to signs.
- Edit history (`entry_revisions`) and `users` once editing goes live.
- Search: enable `pg_trgm` GIN indexes on `search_key`, `gloss`, `definition` (the Docker init script already installs the extension) and a `tsvector` column for definitions. PGlite can load `pg_trgm` too (`@electric-sql/pglite/contrib/pg_trgm`).

## 4. App features

- **Compare across languages**: pick a concept (“king”) and see lugal / šarru / βασιλεύς / מֶלֶךְ side by side, driven by `equivalent_of` relations and shared senses.
- **Etymology chains**: the entry page shows the derived-from / borrowed-from ancestry as a tree; still to do is the full graph with cognates and descendants (e₂-gal → ekallu → הֵיכָל → Arabic haykal) as one diagram.
- **Browse by root / sign**: Semitic roots → derived words; cuneiform signs → readings → words.
- **Editing UI** with server actions and validation (zod is already in the workspace), behind auth; drafts and review.
- **Export**: JSON, CSV and TEI Lex-0 per language; the `/api/entries` route is the seed of a public API — add pagination links, filtering by part kind, and `/api/languages`.
- **Scripts**: show a script's signs as a chart in its traditional order (abjad / futhark / Gardiner list). Link alphabet letters to the words that start with them. Add a "type in this script" keyboard built from the sign readings.
- **UI polish**: keyboard-first search with instant results, virtual keyboard for Greek / Hebrew input. Self-host Noto fonts for Devanagari, Armenian, Ge'ez and Early Cyrillic like the other scripts (`task fonts`).

## 5. Engineering

- Tests: `vitest` for `normalizeForSearch`, the seed validator, the queries and the breakdowns' reading rules (`letters.ts`, `hieroglyphs.ts`), run against PGlite with no services needed. Only `packages/importers/src/lib/sanskrit.test.ts` exists so far (`node --import tsx --test`).
- CI (GitHub Actions): install, typecheck, lint, `db:setup` on PGlite, `next build`.
- Commit generated migrations (`packages/db/drizzle`) with every schema change. Edit them by hand only to add data a migration needs. For example, `0003_scripts.sql` inserts the `cuneiform` row before `signs.script_id` gets its foreign key.
- Production: a `Dockerfile` for `apps/web` (standalone output), compose profile with Postgres backups, and a managed Postgres option.
- Developer ergonomics: an Adminer / pgweb service in `docker-compose.yml`, a `pnpm db:reset` script, and Prettier on commit.

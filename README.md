# Sumer — an ancient-languages library

A monorepo for collecting and browsing the vocabulary and writing systems of ancient languages. It holds **291k dictionary entries in 26 languages**, from Sumerian, Akkadian, Egyptian and Hittite to Latin, Sanskrit, Gothic and Old Irish. It also holds **13k signs in 20 scripts**, from the proto-cuneiform tablets of Uruk to the runes and ogham of northern Europe.

Entries are either *words* or *word parts* (roots, affixes, clitics, determinatives, patterns). An entry can be composed of other entries (`lugal` = `lu₂` + `gal`), and entries link across languages (`e₂-gal` → `ekallu` → `הֵיכָל`, Sanskrit `अग्नि` ↔ Latin `ignis` ← PIE `h₁n̥gʷnís`).

## Stack

- [pnpm](https://pnpm.io) workspaces + [Turborepo](https://turbo.build), laid out after the [shadcn/ui monorepo](https://ui.shadcn.com/docs/monorepo) template
- `apps/web`: Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, shadcn/ui
- `packages/ui`: shared shadcn components (`@workspace/ui`)
- `packages/db`: Drizzle ORM schema, migrations, queries and seed data (`@workspace/db`)
- `packages/importers`: downloaders and loaders for the open sign lists and dictionaries
- Postgres 17 in Docker or Podman for development; embedded [PGlite](https://pglite.dev) as a zero-setup fallback

## Quick start

With [Task](https://taskfile.dev) (`brew install go-task`) and Docker or Podman running:

```bash
task setup               # .env, pnpm install, Postgres up, migrations + seed, every sign list and dictionary import
task dev                 # http://localhost:3000
```

The first `task setup` downloads about 3 GB, most of it the ePSD2 zip and the Wiktionary dumps. It then takes several minutes to load. It is re-runnable: downloads are cached in `.cache/importers/`, so later runs only re-apply the upserts.

- `task setup -- --offline` never touches the network.
- `task setup:pglite` does the same setup without containers.
- `task` lists every command.
- `task doctor` shows your toolchain, the container engine and which database the scripts will use.

Task uses Docker when its daemon answers, and Podman otherwise (`podman compose`, which calls `podman-compose`). Force one with `CONTAINER_ENGINE=podman task up`.

The same steps by hand:

```bash
cp .env.example .env     # Postgres settings + DATABASE_URL (optional, see below)
docker compose up -d     # or: podman compose up -d. Postgres on localhost:5432
pnpm install
pnpm db:setup            # run migrations, then seed the base data
pnpm run import --all    # every source below, in order
pnpm dev                 # http://localhost:3000
```

Requirements:

- Node 24 (see `.node-version`).
- pnpm 12. `corepack enable` installs the version pinned in `package.json`.

Tasks mirror the pnpm scripts below (`task db:seed`, `task import -- osl --limit 500`). They install dependencies when the lockfile changes and ask before deleting data.

**No Docker?** Skip the `.env`, or leave `DATABASE_URL` empty. The app and the `db:*` scripts then use an embedded PGlite database stored in `./.pglite`, with the same schema and data and no services. One caveat: only one process can hold a PGlite directory open, so stop `pnpm dev` before running `pnpm db:seed` or `pnpm db:stats`. Postgres has no such limit.

## Collecting signs and dictionaries

`packages/importers` downloads open sign lists and lexica into `.cache/importers/` (git-ignored). It loads them through the same upsert as the seed, so every run is repeatable:

```bash
pnpm run import --all                # everything below, in order
pnpm run import osl epsd2            # or pick sources
pnpm run import wikt-egy --limit 500 # one Wiktionary language, first 500 lemmas
```

Useful flags:

- `--limit N` makes a quick partial run.
- `--offline` uses only the cache.
- `--prune` deletes rows the source no longer contains.

Run `pnpm run import` with no arguments to list every source.

### Signs

| Source | Script | What you get | Licence |
| --- | --- | --- | --- |
| `osl`: [Oracc Sign List](https://github.com/oracc/osl) | Cuneiform | 4,264 signs (3,241 base + 1,023 variant forms) with Unicode, sign-list numbers (MZL, ABZ, LAK …) and 11,208 readings | CC0 |
| `pcsl`: [Oracc Proto-Cuneiform Sign List](https://github.com/oracc/pcsl) | Proto-cuneiform | 2,240 signs with ZATU numbers, 2,064 of them with a glyph | CC0 |
| `unikemet`: [Unicode Unikemet](https://www.unicode.org/reports/tr57/) | Egyptian hieroglyphs | 5,067 signs in Gardiner's categories (A Man … Aa Unclassified), with Gardiner, JSesh, Hieroglyphica and IFAO numbers, descriptions and 4,349 phonetic values | Unicode License v3 |
| `alphabets`: [Unicode Character Database](https://www.unicode.org/ucd/) | 17 alphabets and syllabaries | 1,671 letters and signs with transliterations and syllabic values (see below) | Unicode License v3 |

The 17 scripts in `alphabets`:

- Ugaritic, Phoenician, Hebrew, Imperial Aramaic, Syriac and Old South Arabian
- Old Persian and Anatolian hieroglyphs
- Linear A, Linear B and Cypriot
- Greek, Old Italic and Coptic
- Gothic, Runic and Ogham

### Dictionaries

| Source | Language | What you get | Licence |
| --- | --- | --- | --- |
| `epsd2`: [ePSD2](http://oracc.museum.upenn.edu/epsd2/) | Sumerian | 15,940 lemmas with senses, attestation counts, compounds and Akkadian equivalents; 15,152 rendered in cuneiform via the sign list | CC BY-SA 3.0 |
| `ebl`: [eBL dictionary](https://www.ebl.lmu.de/dictionary) | Akkadian | 22,263 words (CDA-based) with meanings, derivations and logograms in cuneiform | eBL terms (verify before redistributing) |
| `oshb`: [Open Scriptures Hebrew Lexicon](https://github.com/openscriptures/HebrewLexicon) | Hebrew, Aramaic | 8,834 Hebrew + 745 Aramaic words with Strong's and BDB data, 2,000 roots linked to their derivatives | CC BY 4.0 |
| `lsj`: [LSJ via Perseus](https://github.com/PerseusDL/lexica) | Greek | ~112k entries with senses (beta code converted to polytonic Unicode) | CC BY-SA 4.0 |
| `lewis-short`: [Lewis & Short via Perseus](https://github.com/PerseusDL/lexica/tree/master/CTS_XML_TEI/perseus/pdllex/lat/ls) | Latin | 51,602 entries with senses; principal parts and declension in the notes | CC BY-SA 4.0 |
| `coptic`: [Comprehensive Coptic Lexicon](https://github.com/KELLIA/dictionary) (BBAW + DDGLC, via KELLIA) | Coptic | 11,262 entries with dialect forms and Egyptian/Demotic etymologies; Greek loanwords linked to LSJ | CC BY-SA 4.0 |
| `wiktionary`: [Wiktionary via Kaikki.org](https://kaikki.org/dictionary/) | 19 languages | 66,815 lemmas with senses and 17,019 etymology links (`derived_from`, `cognate_of`, `loan_from`) to the other dictionaries (see below) | CC BY-SA 4.0 + GFDL |

The 19 languages in `wiktionary`, with lemma counts:

- **Near East:** Egyptian 4,082 (written in hieroglyphs), Hittite 400, Ugaritic 1,010, Classical Syriac 3,417, Sabaean 185, Ge'ez 491
- **Mediterranean:** Mycenaean Greek 362, Etruscan 214
- **Indo-Iranian and Tocharian:** Old Persian 518, Sanskrit 11,921, Pali 2,884, Tocharian B 2,368
- **Europe:** Gothic 3,590, Old Norse 4,599, Old English 16,144, Old Irish 3,231, Old Church Slavonic 3,451, Classical Armenian 6,064
- **Reconstructed:** Proto-Indo-European 1,884

#### Import notes

- **ePSD2** is a 213 MB zip whose glossary unpacks to 1.9 GB; the importer streams it. If the Oracc server's certificate cannot be verified from your network, fetch the zip by hand into `.cache/importers/epsd2/epsd2.zip` and run with `--offline`.
- **Wiktionary dumps:** the importer reads Kaikki's per-language JSONL dumps, about 580 MB cached. Kaikki labels these files deprecated, so if they disappear the importer will have to move to the full raw dump.
  - It skips form-of entries, inflection glosses and copies in other scripts.
- **Wiktionary importers:**
  - `wikt-<code>` imports a single language (e.g. `wikt-egy`, `wikt-ine-pro`).
  - `wiktionary-links` rebuilds the etymology links after another dictionary is imported.
  - `--all` runs `wiktionary` and then `coptic` last, so the Wiktionary etymologies reach Latin, Greek, Hebrew and Akkadian, and Coptic's Egyptian ancestors reach the Wiktionary Egyptian entries.
- **Egyptian hieroglyph spellings** are converted with Unikemet and WikiHiero's phoneme table (GPL-2.0+). The table is read at import time and not redistributed.

The hand-written seed (`pnpm db:seed`) is a thin curated layer on top. It merges with ePSD2 by citation form and only fills gaps in the other languages, so it is safe to run before or after the imports.

## Fonts

Every script is drawn with a self-hosted font in `apps/web/fonts/`, loaded with `next/font/local`:

| Files | Font | Covers |
| --- | --- | --- |
| `oracc-noto-sans-cuneiform.woff2` (629 KB) | [Oracc](https://oracc.museum.upenn.edu/osl/OraccCuneiformFonts/) Noto, Google's Noto Sans Cuneiform extended by Oracc | All of Unicode cuneiform, the Archaic Cuneiform Numerals OSL uses (U+12550–1268F) and 110 OSL Private Use Area signs |
| `oracc-{rsp,emc,gudea,lak}-extra.woff2` | Oracc RSP, EMC, Gudea and LAK, cut down to what Noto lacks | 221 more PUA signs, drawn in their Early Dynastic shapes |
| `oracc-pcsl.woff2` (1.8 MB) | PCSL.ttf from [oracc/pcsl](https://github.com/oracc/pcsl) | Proto-cuneiform (PCSL's PC24 encoding) |
| `egyptian-hieroglyphs-1…8.woff2` (3.4 MB in all) | [UniHieroglyphica](https://github.com/thesaurus-linguae-aegyptiae/unihieroglyphica) (Michel Suignard, Thesaurus Linguae Aegyptiae), split into 8 chunks | All 5,067 Unicode hieroglyphs, including the Unicode 16 extension |
| `noto-sans-*.woff2`, `noto-serif-{hebrew,greek}.woff2` (420 KB in all) | [Noto](https://github.com/notofonts) via google/fonts | Every other script, subset to its Unicode blocks |

Each file only downloads on pages that use one of its characters (`unicode-range`).

- Licensing:
  - Every font except PCSL is under the SIL Open Font License 1.1 (`apps/web/fonts/OFL.txt`).
  - The subset UniHieroglyphica files are renamed "Sumer Egyptian Hieroglyphs", because the licence reserves the name "Hieroglyphica".
  - PCSL.ttf comes from the CC0 oracc/pcsl repository; the font file itself carries no licence notice.
- `task fonts` rebuilds everything from pinned upstream commits with `build.py` (cuneiform) and `build_scripts.py` (the rest). It regenerates the files in `apps/web/lib/`:
  - `cuneiform-fonts.ts`
  - `cuneiform-coverage.ts`
  - `script-fonts.ts`
  - `script-coverage.ts`
- `task fonts` needs [uv](https://docs.astral.sh/uv/), which installs fontTools on the fly.

Of the 4,264 cuneiform signs, 3,243 draw as glyphs. 803 have no code point of their own, or one no font draws yet. Those are shown through their components in a dashed frame (`|BAR×TAB|` → 𒁇×𒋰, `AL@s` → 𒀠 with `@s`). The remaining 218, mostly signs known only by a LAK number, are marked as not encoded. OSL's placeholders for unencoded parts of a compound (`X`, `O`) are drawn as empty boxes and never used to render words.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |
| `pnpm db:setup` | `db:migrate` + `db:seed` |
| `pnpm db:migrate` | Apply SQL migrations from `packages/db/drizzle` |
| `pnpm db:seed` | Upsert the seed datasets (re-runnable) |
| `pnpm db:generate` | Generate a migration after changing `packages/db/src/schema.ts` |
| `pnpm db:stats` | Print counts per language and a few sample searches |
| `pnpm run import <source…>` | Download + load sign lists and lexica (`--all`, `--limit N`, `--offline`, `--prune`) |
| `pnpm --filter @workspace/importers render "e2-gal"` | Render transliteration as cuneiform through the sign list |
| `pnpm db:studio` | Open Drizzle Studio on the configured database |
| `pnpm docker:up` / `docker:down` / `docker:reset` | Manage the Postgres container (`reset` deletes the volume) |
| `pnpm typecheck` / `pnpm lint` | Across the workspace |

Add shadcn components from the web app: `pnpm dlx shadcn@latest add dialog -c apps/web` (they land in `packages/ui/src/components`).

## Layout

```
apps/web/                 Next.js app (pages under app/, components/, lib/)
  app/scripts/            /scripts, /scripts/<script>, /scripts/<script>/<sign>
  fonts/                  self-hosted script fonts (WOFF2), OFL.txt, build.py + build_scripts.py
  lib/scripts.ts          per-script font classes, links and rendering rules
packages/ui/              shadcn/ui components, Tailwind theme and font stacks (globals.css)
packages/importers/
  src/cli.ts              pnpm run import …
  src/sources/*.ts        osl, pcsl, unikemet, alphabets, epsd2, ebl, oshb, lsj, lewis-short, coptic, wiktionary
  src/lib/signs.ts        shared writer for sign inventories
  src/lib/links.ts        resolves etymology mentions to entries in other languages
  src/lib/cuneiform.ts    transliteration → Unicode cuneiform via sign readings
  src/lib/egyptian.ts     Manuel de Codage / Gardiner codes → Unicode hieroglyphs
packages/db/
  src/schema.ts           tables, enums, relations (incl. scripts, signs, sign_readings)
  src/scripts.ts          the 20 writing systems (name, ISO 15924, period, Unicode range)
  src/client.ts           getDb(): Postgres (DATABASE_URL) or PGlite fallback
  src/queries.ts          listLanguages, listEntries, getEntryById, listScripts, listSigns …
  src/seed/data/*.ts      curated datasets per language + cross-language relations
  drizzle/                generated SQL migrations
docker-compose.yml        Postgres 17 (+ pg_trgm / unaccent via docker/postgres/init)
docs/NEXT_STEPS.md        roadmap, also rendered at /next-steps
```

## Data model in one paragraph

`languages` (ISO 639-3 id, script, direction) ← `entries` (kind **word** | **part**, headword, native script, transliteration, gloss, definition, etymology, `search_key` for diacritic-insensitive search). Entries have:

- `senses`: ordered meanings.
- `entry_components`: an entry's parts, in order.
- `entry_relations`: typed and cross-language (`loan_from`, `cognate_of`, `derived_from`, `equivalent_of` …), each with a confidence flag.
- `sources`: provenance.

Writing systems live in `scripts` (ISO 15924, kind, period, region, direction). Each script has `signs` (name, Unicode, sign-list numbers, category, variant forms) and `sign_readings`. The `/scripts` pages browse them. Every entry written in cuneiform or hieroglyphs links to its signs. Cuneiform words are also broken down sign by sign (`packages/db/src/breakdown.ts`): each glyph with its reading in the word, its sign name and, for Sumerian, what that reading means as a word (`{d}en-me-dur-an-ki` → divine determinative · lord · me · bond · sky · place).

## Where next

See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the roadmap: data sources with licences and the import plan, schema evolution, app features and engineering work.

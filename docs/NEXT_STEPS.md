# Next steps

This page is the working roadmap for the ancient-languages dictionary. It is rendered in the app at `/next-steps` and lives in the repo at `docs/NEXT_STEPS.md` — edit it there.

## 0. Where things stand

**Done**

- pnpm + Turborepo monorepo in the shadcn/ui layout: `apps/web` (Next.js 16, React 19, Tailwind v4), `packages/ui` (shadcn components), `packages/db` (Drizzle ORM), shared ESLint / TypeScript configs.
- Postgres 17 via `docker-compose.yml`, configured by `.env` (copy `.env.example`). Without `DATABASE_URL` the app and scripts fall back to an embedded **PGlite** database in `./.pglite`, so everything runs with zero setup.
- Schema: `languages`, `sources`, `entries` (kind = **word** or **part**), `senses`, `entry_components` (what an entry is built from), `entry_relations` (loans, cognates, translation equivalents across languages).
- Seed data: Sumerian, Akkadian, Ancient Greek, Biblical Hebrew — a few hundred hand-curated words and word parts, with composition (lugal = lu₂ + gal) and cross-language chains (e₂-gal → ekallu → הֵיכָל).
- Web app: language overview, per-language browsing (words / parts), global search that ignores diacritics, vowel points and sign indices, entry pages with components, usages and relations, a JSON API at `/api/entries`.

**Not done / caveats**

- The seed is a starting point, not a reference. Every entry should eventually be checked against (or replaced by an import from) the cited source.
- Cuneiform is shown in its standard Unicode form, which is the Neo-Assyrian sign shape; period-specific glyphs (Ur III, Old Babylonian) need a dedicated font or images.
- PGlite allows a single process per data directory: stop the dev server before seeding when you are not on Postgres.
- No tests, no CI, no auth, no editing UI yet.

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

Build one importer per source under `packages/importers/<source>/` that downloads the raw data, converts it to the seed shape (`SeedDataset` in `packages/db/src/seed/types.ts`) and upserts it with the same code the seed uses. Track provenance per entry (`sources` table, `entries.source_ref`) and keep each source's licence in the `sources` row.

| Language | Source | Format | Licence | Notes |
| --- | --- | --- | --- | --- |
| Sumerian | [ePSD2](http://oracc.museum.upenn.edu/epsd2/) (Oracc) | JSON glossary (`epsd2-sux.zip` from the Oracc JSON service) | CC BY-SA 3.0 | ~16k lemmas with senses, forms, attestation counts. Primary target. |
| Sumerian / Akkadian | [Oracc Sign List (OSL)](https://github.com/oracc/osl) | `00lib/osl.asl` | CC0 | Sign names, readings, Unicode — feed the `sign` part kind and validate cuneiform in entries. |
| Sumerian | [ETCSL](https://etcsl.orinst.ox.ac.uk/) | TEI XML | academic use | Literary corpus for attestations / example lines. |
| Sumerian | [CDLI](https://cdli.mpiwg-berlin.mpg.de/) | ATF, API | CC BY | Transliterated tablets; attestation counts and images. |
| Akkadian | Oracc project glossaries (e.g. [RINAP](http://oracc.org/rinap), [SAAo](http://oracc.org/saao)) | JSON | CC BY-SA | Same JSON shape as ePSD2 → one importer covers both. |
| Akkadian | [eBL](https://www.ebl.lmu.de/) dictionary & sign list | API / JSON | CC BY | Concise Dictionary of Akkadian data with signs. |
| Akkadian | [CAD](https://isac.uchicago.edu/research/publications/assyrian-dictionary-oriental-institute-university-chicago-cad) | PDF | free PDFs | Reference only; not machine-readable. |
| Greek | [LSJ](https://github.com/PerseusDL/lexica) (Perseus) | TEI XML | CC BY-SA 3.0 | Full lexicon; needs a TEI → senses converter. Also Middle Liddell (smaller). |
| Greek | Perseus Morpheus / [Morpheus data](https://github.com/PerseusDL/morpheus) | XML | CC BY-SA | Inflected forms and stems → `entry_components`. |
| Hebrew | [Open Scriptures Hebrew Lexicon](https://github.com/openscriptures/HebrewLexicon) (BDB + Strong's) | XML | CC BY 4.0 | Strong's numbers give stable IDs; BDB gives roots and senses. |
| Hebrew | [OSHB morphology](https://github.com/openscriptures/morphhb) | XML | CC BY 4.0 | Every word in the Hebrew Bible parsed → attestations and affixes. |
| Any | [Wiktionary dumps](https://dumps.wikimedia.org/) / [kaikki.org](https://kaikki.org/) | JSON | CC BY-SA | Broad coverage, etymologies and cross-links; lower precision. |

Languages to add next (each is a `languages` row plus an importer): Egyptian ([TLA](https://thesaurus-linguae-aegyptiae.de/)), Latin (Lewis & Short via Perseus, Whitaker's Words), Aramaic ([CAL](https://cal.huc.edu/)), Ugaritic, Hittite ([eDiAna](https://www.ediana.gwi.uni-muenchen.de/)), Old Persian, Coptic, Sanskrit, Gothic, Old Norse, Old English.

Importer checklist:

- Re-runnable (upsert on language + kind + headword + homonym) and incremental.
- Keep raw downloads out of git; cache them under `.cache/` (git-ignored).
- Normalise transliteration conventions per language (ŋ vs ĝ, subscript indices) and record the convention in the `languages` row.
- Validate before writing: unknown components, dangling relations, duplicate headwords (the seed already does this).

## 3. Schema evolution

- `attestations` (entry ↔ text reference ↔ line, with the original line and translation) — needed as soon as corpora are imported.
- `forms` (inflected / variant spellings with grammatical features) so searches hit inflected words, not only lemmas.
- `tags` / semantic domains as a table instead of free text on `senses.domain`.
- `sign_readings` for cuneiform: sign → readings → languages; link `entries.native_script` to signs.
- Edit history (`entry_revisions`) and `users` once editing goes live.
- Search: enable `pg_trgm` GIN indexes on `search_key`, `gloss`, `definition` (the Docker init script already installs the extension) and a `tsvector` column for definitions. PGlite can load `pg_trgm` too (`@electric-sql/pglite/contrib/pg_trgm`).

## 4. App features

- **Compare across languages**: pick a concept (“king”) and see lugal / šarru / βασιλεύς / מֶלֶךְ side by side, driven by `equivalent_of` relations and shared senses.
- **Etymology chains**: render the loan / cognate graph (e₂-gal → ekallu → הֵיכָל → Arabic haykal) as a diagram on entry pages.
- **Browse by root / sign**: Semitic roots → derived words; cuneiform signs → readings → words.
- **Editing UI** with server actions and validation (zod is already in the workspace), behind auth; drafts and review.
- **Export**: JSON, CSV and TEI Lex-0 per language; the `/api/entries` route is the seed of a public API — add pagination links, filtering by part kind, and `/api/languages`.
- **Fonts**: bundle Noto Sans Cuneiform and Noto Serif Hebrew locally instead of loading from Google Fonts; add a period-specific cuneiform font.
- **UI polish**: keyboard-first search with instant results, virtual keyboard for Greek / Hebrew input, dark-mode review, mobile layout for the entry page.

## 5. Engineering

- Tests: `vitest` for `normalizeForSearch`, the seed validator and the queries (run against PGlite — no services needed).
- CI (GitHub Actions): install, typecheck, lint, `db:setup` on PGlite, `next build`.
- Commit generated migrations (`packages/db/drizzle`) with every schema change; never edit them by hand.
- Production: a `Dockerfile` for `apps/web` (standalone output), compose profile with Postgres backups, and a managed Postgres option.
- Developer ergonomics: an Adminer / pgweb service in `docker-compose.yml`, a `pnpm db:reset` script, and Prettier on commit.

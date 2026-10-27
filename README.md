# Sumer — an ancient-languages dictionary

A monorepo for collecting and browsing the vocabulary of ancient languages: **Sumerian** first, with **Akkadian**, **Ancient Greek** and **Biblical Hebrew** alongside, and room for more. Entries are either *words* or *word parts* (roots, affixes, clitics, determinatives, patterns), can be composed of other entries (`lugal` = `lu₂` + `gal`), and link across languages (`e₂-gal` → `ekallu` → `הֵיכָל`).

## Stack

- [pnpm](https://pnpm.io) workspaces + [Turborepo](https://turbo.build), laid out after the [shadcn/ui monorepo](https://ui.shadcn.com/docs/monorepo) template
- `apps/web` — Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, shadcn/ui
- `packages/ui` — shared shadcn components (`@workspace/ui`)
- `packages/db` — Drizzle ORM schema, migrations, queries and seed data (`@workspace/db`)
- Postgres 17 in Docker for development; embedded [PGlite](https://pglite.dev) as a zero-setup fallback

## Quick start

```bash
cp .env.example .env     # Postgres settings + DATABASE_URL (optional, see below)
docker compose up -d     # start Postgres on localhost:5432
pnpm install
pnpm db:setup            # run migrations, then seed the base data
pnpm dev                 # http://localhost:3000
```

Requires Node 24 (see `.node-version`) and pnpm 12 (`corepack enable` installs the pinned version from `package.json`).

**With [Task](https://taskfile.dev)** (`brew install go-task`): `task setup` does all of the above, `task setup:pglite` does it without Docker, and `task` lists every command. Tasks mirror the pnpm scripts below (`task dev`, `task db:seed`, `task import -- osl --limit 500`), install dependencies when the lockfile changes, and ask before deleting data. `task doctor` shows your toolchain and which database the scripts will use.

**No Docker?** Skip the `.env` (or leave `DATABASE_URL` empty). The app and the `db:*` scripts then use an embedded PGlite database stored in `./.pglite` — same schema, same data, no services. One caveat: only one process can hold a PGlite directory open, so stop `pnpm dev` before running `pnpm db:seed` / `pnpm db:stats` (Postgres has no such limit).

## Collecting the dictionaries

`packages/importers` downloads open lexica into `.cache/importers/` (git-ignored) and loads them through the same upsert as the seed, so every run is repeatable:

```bash
pnpm import --all            # everything below, in order
pnpm import osl epsd2        # or pick sources; add --limit 500 for a quick run, --offline to use the cache only
```

| Source | Language | What you get | Licence |
| --- | --- | --- | --- |
| `osl` — [Oracc Sign List](https://github.com/oracc/osl) | cuneiform | 4,264 signs (3,155 base + variants) with Unicode, sign-list numbers (MZL, ABZ, LAK …) and 10,600 readings | CC0 |
| `epsd2` — [ePSD2](http://oracc.museum.upenn.edu/epsd2/) | Sumerian | 15,940 lemmas with senses, attestation counts, compounds and Akkadian equivalents; 13k rendered in cuneiform via the sign list | CC BY-SA 3.0 |
| `ebl` — [eBL dictionary](https://www.ebl.lmu.de/dictionary) | Akkadian | 22,263 words (CDA-based) with meanings, derivations and logograms in cuneiform | eBL terms (verify before redistributing) |
| `oshb` — [Open Scriptures Hebrew Lexicon](https://github.com/openscriptures/HebrewLexicon) | Hebrew, Aramaic | 8,834 Hebrew + 745 Aramaic words with Strong's and BDB data, 2,000 roots linked to their derivatives | CC BY 4.0 |
| `lsj` — [LSJ via Perseus](https://github.com/PerseusDL/lexica) | Greek | ~114k entries with senses (beta code converted to polytonic Unicode) | CC BY-SA 4.0 |

The ePSD2 download is a 213 MB zip whose glossary unpacks to 1.9 GB; the importer streams it. If the Oracc server's certificate cannot be verified from your network, fetch the zip by hand into `.cache/importers/epsd2/epsd2.zip` and run with `--offline`.

The hand-written seed (`pnpm db:seed`) is a thin curated layer on top: it merges with ePSD2 by citation form and only fills gaps in the other languages, so it is safe to run before or after the imports.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |
| `pnpm db:setup` | `db:migrate` + `db:seed` |
| `pnpm db:migrate` | Apply SQL migrations from `packages/db/drizzle` |
| `pnpm db:seed` | Upsert the seed datasets (re-runnable) |
| `pnpm db:generate` | Generate a migration after changing `packages/db/src/schema.ts` |
| `pnpm db:stats` | Print counts per language and a few sample searches |
| `pnpm import <source…>` | Download + load lexica (`--all`, `--limit N`, `--offline`, `--prune`) |
| `pnpm --filter @workspace/importers render "e2-gal"` | Render transliteration as cuneiform through the sign list |
| `pnpm db:studio` | Open Drizzle Studio on the configured database |
| `pnpm docker:up` / `docker:down` / `docker:reset` | Manage the Postgres container (`reset` deletes the volume) |
| `pnpm typecheck` / `pnpm lint` | Across the workspace |

Add shadcn components from the web app: `pnpm dlx shadcn@latest add dialog -c apps/web` (they land in `packages/ui/src/components`).

## Layout

```
apps/web/                 Next.js app (pages under app/, components/, lib/)
packages/ui/              shadcn/ui components, Tailwind theme (globals.css)
packages/importers/
  src/cli.ts              pnpm import …
  src/sources/*.ts        osl, epsd2, ebl, oshb, lsj
  src/lib/cuneiform.ts    transliteration → Unicode cuneiform via sign readings
packages/db/
  src/schema.ts           tables, enums, relations (incl. signs, sign_readings)
  src/client.ts           getDb(): Postgres (DATABASE_URL) or PGlite fallback
  src/queries.ts          listLanguages, listEntries, getEntryById …
  src/seed/data/*.ts      curated datasets per language + cross-language relations
  drizzle/                generated SQL migrations
docker-compose.yml        Postgres 17 (+ pg_trgm / unaccent via docker/postgres/init)
docs/NEXT_STEPS.md        roadmap, also rendered at /next-steps
```

## Data model in one paragraph

`languages` (ISO 639-3 id, script, direction) ← `entries` (kind **word** | **part**, headword, native script, transliteration, gloss, definition, etymology, `search_key` for diacritic-insensitive search) → `senses` (ordered meanings), `entry_components` (entry ↔ its parts, ordered), `entry_relations` (typed, cross-language: `loan_from`, `cognate_of`, `equivalent_of`, … with a confidence flag), and `sources` for provenance. Cuneiform lives in `signs` (name, Unicode, sign-list numbers, variant forms) and `sign_readings`; the `/signs` pages browse them and every entry written in cuneiform links to its signs.

## Where next

See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) — data sources with licences and the import plan, schema evolution, app features and engineering work.

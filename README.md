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

**No Docker?** Skip the `.env` (or leave `DATABASE_URL` empty). The app and the `db:*` scripts then use an embedded PGlite database stored in `./.pglite` — same schema, same data, no services. One caveat: only one process can hold a PGlite directory open, so stop `pnpm dev` before running `pnpm db:seed` / `pnpm db:stats` (Postgres has no such limit).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |
| `pnpm db:setup` | `db:migrate` + `db:seed` |
| `pnpm db:migrate` | Apply SQL migrations from `packages/db/drizzle` |
| `pnpm db:seed` | Upsert the seed datasets (re-runnable) |
| `pnpm db:generate` | Generate a migration after changing `packages/db/src/schema.ts` |
| `pnpm db:stats` | Print counts per language and a few sample searches |
| `pnpm db:studio` | Open Drizzle Studio on the configured database |
| `pnpm docker:up` / `docker:down` / `docker:reset` | Manage the Postgres container (`reset` deletes the volume) |
| `pnpm typecheck` / `pnpm lint` | Across the workspace |

Add shadcn components from the web app: `pnpm dlx shadcn@latest add dialog -c apps/web` (they land in `packages/ui/src/components`).

## Layout

```
apps/web/                 Next.js app (pages under app/, components/, lib/)
packages/ui/              shadcn/ui components, Tailwind theme (globals.css)
packages/db/
  src/schema.ts           tables, enums, relations
  src/client.ts           getDb(): Postgres (DATABASE_URL) or PGlite fallback
  src/queries.ts          listLanguages, listEntries, getEntryById …
  src/seed/data/*.ts      curated datasets per language + cross-language relations
  drizzle/                generated SQL migrations
docker-compose.yml        Postgres 17 (+ pg_trgm / unaccent via docker/postgres/init)
docs/NEXT_STEPS.md        roadmap, also rendered at /next-steps
```

## Data model in one paragraph

`languages` (ISO 639-3 id, script, direction) ← `entries` (kind **word** | **part**, headword, native script, transliteration, gloss, definition, etymology, `search_key` for diacritic-insensitive search) → `senses` (ordered meanings), `entry_components` (entry ↔ its parts, ordered), `entry_relations` (typed, cross-language: `loan_from`, `cognate_of`, `equivalent_of`, … with a confidence flag), and `sources` for provenance.

## Where next

See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) — data sources with licences and the import plan, schema evolution, app features and engineering work.

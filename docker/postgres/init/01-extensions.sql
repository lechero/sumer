-- Runs once, when the Postgres data volume is first created.
-- Extensions the dictionary will use for fuzzy / accent-insensitive search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

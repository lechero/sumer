-- Custom SQL migration (drizzle-kit cannot generate expression indexes).
-- Gloss split into its meanings, for "same meaning" lookups; must match glossTerms() in src/schema.ts.
CREATE INDEX IF NOT EXISTS "entries_gloss_terms_idx" ON "entries" USING gin (regexp_split_to_array(regexp_replace(btrim(regexp_replace(lower("gloss"), '\s*\([^)]*\)', '', 'g')), '(^|[;,])\s*(?:a|an|the)\s+', '\1', 'g'), '\s*[;,]\s*'));

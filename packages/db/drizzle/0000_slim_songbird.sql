CREATE TYPE "public"."confidence" AS ENUM('certain', 'likely', 'debated');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('word', 'part');--> statement-breakpoint
CREATE TYPE "public"."part_kind" AS ENUM('root', 'stem', 'prefix', 'suffix', 'infix', 'clitic', 'particle', 'pattern', 'determinative', 'sign', 'numeral');--> statement-breakpoint
CREATE TYPE "public"."part_of_speech" AS ENUM('noun', 'proper_noun', 'verb', 'adjective', 'adverb', 'pronoun', 'numeral', 'preposition', 'postposition', 'conjunction', 'particle', 'interjection', 'determiner', 'other');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('loan_from', 'cognate_of', 'derived_from', 'variant_of', 'synonym_of', 'antonym_of', 'equivalent_of', 'see_also');--> statement-breakpoint
CREATE TYPE "public"."text_direction" AS ENUM('ltr', 'rtl');--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language_id" text NOT NULL,
	"kind" "entry_kind" DEFAULT 'word' NOT NULL,
	"part_kind" "part_kind",
	"headword" text NOT NULL,
	"homonym_index" integer DEFAULT 1 NOT NULL,
	"native_script" text,
	"transliteration" text,
	"search_key" text NOT NULL,
	"part_of_speech" "part_of_speech",
	"gloss" text NOT NULL,
	"definition" text,
	"etymology" text,
	"notes" text,
	"source_id" text,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_lang_kind_headword_homonym_uq" UNIQUE("language_id","kind","headword","homonym_index")
);
--> statement-breakpoint
CREATE TABLE "entry_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"role" text,
	"note" text,
	CONSTRAINT "entry_components_entry_position_uq" UNIQUE("entry_id","position")
);
--> statement-breakpoint
CREATE TABLE "entry_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_entry_id" uuid NOT NULL,
	"to_entry_id" uuid NOT NULL,
	"type" "relation_type" NOT NULL,
	"confidence" "confidence" DEFAULT 'likely' NOT NULL,
	"note" text,
	CONSTRAINT "entry_relations_from_to_type_uq" UNIQUE("from_entry_id","to_entry_id","type")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"native_name" text,
	"script" text NOT NULL,
	"script_name" text,
	"direction" text_direction DEFAULT 'ltr' NOT NULL,
	"family" text,
	"period" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"gloss" text NOT NULL,
	"definition" text,
	"domain" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"license" text,
	"citation" text
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_components" ADD CONSTRAINT "entry_components_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_components" ADD CONSTRAINT "entry_components_component_id_entries_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_from_entry_id_entries_id_fk" FOREIGN KEY ("from_entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_relations" ADD CONSTRAINT "entry_relations_to_entry_id_entries_id_fk" FOREIGN KEY ("to_entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senses" ADD CONSTRAINT "senses_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_language_idx" ON "entries" USING btree ("language_id");--> statement-breakpoint
CREATE INDEX "entries_search_key_idx" ON "entries" USING btree ("search_key");--> statement-breakpoint
CREATE INDEX "entries_gloss_idx" ON "entries" USING btree ("gloss");--> statement-breakpoint
CREATE INDEX "entry_components_component_idx" ON "entry_components" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "entry_relations_to_idx" ON "entry_relations" USING btree ("to_entry_id");--> statement-breakpoint
CREATE INDEX "senses_entry_idx" ON "senses" USING btree ("entry_id");
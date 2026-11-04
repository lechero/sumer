CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"iso15924" text,
	"kind" text,
	"direction" text_direction DEFAULT 'ltr' NOT NULL,
	"period" text,
	"region" text,
	"description" text,
	"unicode_range" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Existing signs all come from the Oracc Sign List: the row their new script_id default points at must exist before the foreign key. Importers fill in the other columns.
INSERT INTO "scripts" ("id", "name", "iso15924", "sort_order") VALUES ('cuneiform', 'Cuneiform', 'Xsux', 10) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "signs" DROP CONSTRAINT "signs_name_uq";--> statement-breakpoint
ALTER TABLE "signs" ADD COLUMN "script_id" text DEFAULT 'cuneiform' NOT NULL;--> statement-breakpoint
ALTER TABLE "signs" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "signs" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "signs" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "signs" ADD CONSTRAINT "signs_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signs" ADD CONSTRAINT "signs_script_name_uq" UNIQUE("script_id","name");
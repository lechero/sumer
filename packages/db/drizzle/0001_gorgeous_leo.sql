CREATE TABLE "sign_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sign_id" uuid NOT NULL,
	"value" text NOT NULL,
	"language" text,
	"search_key" text NOT NULL,
	"is_uncertain" boolean DEFAULT false NOT NULL,
	"is_deprecated" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sign_readings_sign_value_uq" UNIQUE("sign_id","value")
);
--> statement-breakpoint
CREATE TABLE "signs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"oid" text,
	"unicode" text,
	"codepoints" text[],
	"unicode_name" text,
	"unicode_version" text,
	"is_form" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"aliases" text[],
	"list_numbers" jsonb,
	"links" jsonb,
	"notes" text,
	"source_id" text,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signs_name_uq" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "sign_readings" ADD CONSTRAINT "sign_readings_sign_id_signs_id_fk" FOREIGN KEY ("sign_id") REFERENCES "public"."signs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signs" ADD CONSTRAINT "signs_parent_id_signs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."signs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signs" ADD CONSTRAINT "signs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_readings_value_idx" ON "sign_readings" USING btree ("value");--> statement-breakpoint
CREATE INDEX "sign_readings_search_key_idx" ON "sign_readings" USING btree ("search_key");--> statement-breakpoint
CREATE INDEX "signs_unicode_idx" ON "signs" USING btree ("unicode");--> statement-breakpoint
CREATE INDEX "signs_parent_idx" ON "signs" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "entries_source_ref_idx" ON "entries" USING btree ("source_id","source_ref");
DROP INDEX "booking_org_active_slot_uq";--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "appointment_type" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "resource" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "attendee_email" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "buffer_before_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "buffer_after_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN "appointment_types" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN "default_type_key" text;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD COLUMN "type_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_org_resource_active_slot_uq" ON "booking" USING btree ("organization_id","resource","scheduled_at") WHERE "booking"."status" in ('agendada','realizada') and "booking"."is_test" = false;
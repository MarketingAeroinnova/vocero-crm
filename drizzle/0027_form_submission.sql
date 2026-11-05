CREATE TABLE "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"form_id" text DEFAULT '' NOT NULL,
	"origen" text DEFAULT 'formulario' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text,
	"programa" text,
	"motivo" text,
	"mensaje" text,
	"contact_id" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"respuesta_correo" text DEFAULT 'pendiente' NOT NULL,
	"respuesta_correo_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submission_org_email_idx" ON "form_submission" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "form_submission_org_contact_idx" ON "form_submission" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_dedup_uq" ON "form_submission" USING btree ("organization_id","form_id","email","submitted_at");
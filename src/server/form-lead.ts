import { eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { FormLead } from "@/lib/form-lead";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { upsertFicha } from "@/server/bot/ficha";

/**
 * 070 — Guarda el lead de un formulario web como contacto + lead en la primera
 * etapa abierta del Pipeline ("Nuevo"), con origen "Landing".
 *
 * Re-ejecutable: el mismo teléfono enviado dos veces NO duplica contacto ni
 * lead (la llave es la identidad de WhatsApp y el lead es único por contacto).
 * A quien ya existía le suma los campos nuevos a la ficha, respeta el nombre y
 * el origen que ya tuviera, y no lo mueve de etapa.
 *
 * NO crea conversación ni escribe por WhatsApp: la persona no escribió primero,
 * así que el primer mensaje exigiría una plantilla aprobada por Meta.
 */
export async function saveFormLead(
  organizationId: string,
  lead: FormLead
): Promise<{ contactId: string; created: boolean }> {
  const db = getDb();
  const ficha = { ...lead.ficha, origen_detalle: "Formulario web" };

  const [found] = await db
    .select({ id: schema.contact.id, source: schema.contact.source })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.channel, "whatsapp"),
        or(
          eq(schema.contact.waIdentity, lead.phone),
          eq(schema.contact.phone, lead.phone)
        )
      )
    )
    .limit(1);

  if (found) {
    await upsertFicha({ organizationId, contactId: found.id, ficha });
    await db
      .update(schema.contact)
      .set({
        source: found.source ?? "landing",
        updatedAt: new Date(),
      })
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, found.id)));
    await createLeadForContact({ organizationId, contactId: found.id });
    return { contactId: found.id, created: false };
  }

  const id = newId("contact");
  const inserted = await db
    .insert(schema.contact)
    .values({
      id,
      organizationId,
      name: lead.name,
      nameSource: lead.name === lead.phone ? "perfil" : "manual",
      phone: lead.phone,
      waIdentity: lead.phone,
      source: "landing",
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity],
    })
    .returning({ id: schema.contact.id });

  if (!inserted[0]) {
    // Carrera: otro envío idéntico ganó el INSERT. Ya existe; no hay nada más.
    return { contactId: id, created: false };
  }
  await upsertFicha({ organizationId, contactId: id, ficha });
  await createLeadForContact({ organizationId, contactId: id });
  return { contactId: id, created: true };
}

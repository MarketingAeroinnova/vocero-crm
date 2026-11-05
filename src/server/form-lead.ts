import { and, desc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  resumenConsultasPrevias,
  textoRespuestaCorreo,
  type ConsultaPrevia,
  type FormLead,
} from "@/lib/form-lead";
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

/**
 * Consultas anteriores de la misma persona: por correo o por teléfono. Se leen
 * ANTES de guardar la nueva, para que no se cuente a sí misma.
 */
export async function consultasPrevias(
  organizationId: string,
  lead: Pick<FormLead, "email" | "phone">
): Promise<ConsultaPrevia[]> {
  const claves = [
    lead.email ? eq(schema.formSubmission.email, lead.email) : undefined,
    lead.phone ? eq(schema.formSubmission.phone, lead.phone) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (claves.length === 0) return [];
  const rows = await getDb()
    .select({
      submittedAt: schema.formSubmission.submittedAt,
      programa: schema.formSubmission.programa,
      motivo: schema.formSubmission.motivo,
      respuestaCorreo: schema.formSubmission.respuestaCorreo,
    })
    .from(schema.formSubmission)
    .where(scoped(schema.formSubmission.organizationId, organizationId, or(...claves)))
    .orderBy(desc(schema.formSubmission.submittedAt))
    .limit(50);
  return rows;
}

/**
 * Guarda la consulta como fila propia y, si la persona ya había escrito antes,
 * lo deja anotado en su ficha («consultó N veces, la última…»).
 */
export async function recordSubmission(
  organizationId: string,
  lead: FormLead,
  contactId: string,
  formId: string
): Promise<{ submissionId: string; previas: number }> {
  const previas = await consultasPrevias(organizationId, lead);
  const id = newId("formSubmission");
  await getDb().insert(schema.formSubmission).values({
    id,
    organizationId,
    formId,
    origen: "formulario",
    email: lead.email ?? "",
    name: lead.name,
    phone: lead.phone,
    programa: lead.programa,
    motivo: lead.motivo,
    mensaje: lead.mensaje,
    contactId,
    respuestaCorreo: "pendiente",
  });
  const resumen = resumenConsultasPrevias(previas);
  if (Object.keys(resumen).length > 0) {
    await upsertFicha({ organizationId, contactId, ficha: resumen });
  }
  return { submissionId: id, previas: previas.length };
}

/**
 * El fragmento de WordPress avisa si el correo automático salió. Se anota en la
 * consulta y en la ficha del contacto, donde el equipo ya mira.
 */
export async function recordReply(
  organizationId: string,
  submissionId: string,
  estado: "enviado" | "fallido"
): Promise<boolean> {
  const db = getDb();
  const ahora = new Date();
  const [row] = await db
    .update(schema.formSubmission)
    .set({ respuestaCorreo: estado, respuestaCorreoAt: ahora })
    .where(
      and(
        eq(schema.formSubmission.organizationId, organizationId),
        eq(schema.formSubmission.id, submissionId)
      )
    )
    .returning({ contactId: schema.formSubmission.contactId });
  if (!row) return false;
  if (row.contactId) {
    await upsertFicha({
      organizationId,
      contactId: row.contactId,
      ficha: { respuesta_correo: textoRespuestaCorreo(estado, ahora) },
    });
  }
  return true;
}

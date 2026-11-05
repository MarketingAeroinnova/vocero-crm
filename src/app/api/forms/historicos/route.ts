import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { nombrePrograma, normalizeFormPhone } from "@/lib/form-lead";

export const dynamic = "force-dynamic";

const rowSchema = z.object({
  /** ISO 8601; la fecha original del envío. */
  fecha: z.string().datetime({ offset: true }),
  nombre: z.string().max(200).default(""),
  apellidos: z.string().max(200).default(""),
  email: z.string().max(200).default(""),
  programa: z.string().max(200).optional(),
  motivo: z.string().max(200).optional(),
  mensaje: z.string().max(2000).optional(),
  telefono: z.string().max(40).optional(),
});

const schemaBody = z.object({ rows: z.array(rowSchema).min(1).max(500) });

/**
 * 070 — Carga de consultas HISTÓRICAS del formulario (anteriores al CRM).
 *
 * Con sesión de la organización. Re-ejecutable: la misma persona, formulario
 * e instante no se duplica. NO crea contactos ni leads: son personas que
 * escribieron cuando no había CRM y aún no se les ha hablado por WhatsApp; se
 * guardan para reconocerlas si vuelven a escribir.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, schemaBody);
  if (!body.ok) return body.response;

  const values = body.data.rows.map((r) => {
    const tel = r.telefono ? normalizeFormPhone(r.telefono) : null;
    return {
      id: newId("formSubmission"),
      organizationId: session.organizationId,
      formId: "historico",
      origen: "historico" as const,
      email: r.email.trim().toLowerCase(),
      name: [r.nombre, r.apellidos].map((x) => x.trim()).filter(Boolean).join(" ").slice(0, 200),
      phone: tel && tel.ok ? tel.phone : null,
      programa: nombrePrograma(r.programa),
      motivo: r.motivo?.trim() || null,
      mensaje: r.mensaje?.trim() || null,
      submittedAt: new Date(r.fecha),
      respuestaCorreo: "sin_dato" as const,
    };
  });
  if (values.some((v) => Number.isNaN(v.submittedAt.getTime()))) {
    return apiError(422, "fecha_invalida", "Alguna fecha no se pudo leer");
  }

  const inserted = await getDb()
    .insert(schema.formSubmission)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: schema.formSubmission.id });
  return Response.json({ recibidas: values.length, nuevas: inserted.length });
});

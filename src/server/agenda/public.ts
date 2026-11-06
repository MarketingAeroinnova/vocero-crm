import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { apiError } from "@/lib/api";
import { findType, type AppointmentType } from "@/lib/appointment-types";
import { normalizeFormPhone, type FormLead } from "@/lib/form-lead";
import type { PublicBookingInput } from "@/lib/public-booking";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { createSessionBooking, type BookingResult } from "@/server/agenda/service";
import { getSettings, type CalendarSettings } from "@/server/agenda/settings";
import { resolveInstanceOrg } from "@/server/bot/auth";
import { saveFormLead } from "@/server/form-lead";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * 070 — La página pública de agenda: lo que necesita el servidor.
 *
 * La persona elige modalidad y horario SOLA, sin pasar por el bot. Por eso las
 * reglas que en el bot garantiza la oferta registrada aquí las garantizan el
 * horario del tipo, el aviso mínimo, el choque con la agenda de quien atiende y
 * un límite de una cita activa por tipo: esta superficie está abierta a
 * internet y no puede dar más de lo que da el bot.
 */

export class PublicBookingError extends Error {
  readonly code: "tipo_desconocido" | "telefono_invalido" | "ya_tiene_cita";
  constructor(code: PublicBookingError["code"], message: string) {
    super(message);
    this.name = "PublicBookingError";
    this.code = code;
  }
}

export type PublicContext = {
  organizationId: string;
  settings: CalendarSettings;
};

/**
 * Lo común a las tres rutas: la agenda debe estar encendida, la instancia
 * tener organización y la agenda tener tipos de cita (sin ellos no hay qué
 * elegir). Cualquier otra cosa se responde con el sobre estándar.
 */
export async function loadPublicContext(): Promise<
  { ok: true; ctx: PublicContext } | { ok: false; response: Response }
> {
  if (!agendaEnabled()) return { ok: false, response: agendaDisabledResponse() };
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return {
      ok: false,
      response: apiError(409, "no_org", "La instancia aún no tiene organización"),
    };
  }
  const settings = await getSettings(organizationId);
  if (settings.appointmentTypes.length === 0) {
    return {
      ok: false,
      response: apiError(404, "agenda_sin_tipos", "La agenda no tiene tipos de cita"),
    };
  }
  return { ok: true, ctx: { organizationId, settings } };
}

/** El WhatsApp del negocio, solo dígitos, para «escríbenos por WhatsApp». */
export async function businessWhatsappDigits(
  organizationId: string
): Promise<string | null> {
  const creds = await getCredentialsByOrg(organizationId).catch(() => null);
  const digits = (creds?.displayPhoneNumber ?? "").replace(/\D/g, "");
  return digits || null;
}

/**
 * Crea la cita de quien agenda desde la página. Orden deliberado: primero el
 * contacto (para que la persona quede en el CRM aunque el horario se ocupe en
 * ese instante y haya que elegir otro), luego el límite, luego la cita.
 */
export async function bookPublic(
  ctx: PublicContext,
  input: PublicBookingInput
): Promise<{ result: BookingResult; type: AppointmentType }> {
  const type = findType(ctx.settings.appointmentTypes, input.tipo);
  if (!type) {
    throw new PublicBookingError("tipo_desconocido", "Ese tipo de cita no existe");
  }

  const phone = normalizeFormPhone(input.telefono);
  if (!phone.ok) {
    throw new PublicBookingError(
      "telefono_invalido",
      "Revisa tu teléfono: si no es de Chile, escríbelo con el código de país."
    );
  }

  const lead: FormLead = {
    name: input.nombre,
    phone: phone.phone,
    email: input.email ?? null,
    programa: null,
    motivo: null,
    mensaje: null,
    ficha: {
      origen_detalle: "Página de agenda",
      ...(input.notas ? { notas_agenda: input.notas } : {}),
      ...(input.email ? { email: input.email } : {}),
    },
  };
  const { contactId } = await saveFormLead(ctx.organizationId, lead);

  // Una cita activa por tipo y persona: quien quiera cambiarla escribe por
  // WhatsApp. Sin esto, una sola persona podría ocupar la agenda entera.
  const existing = await getDb()
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        ctx.organizationId,
        and(
          eq(schema.booking.contactId, contactId),
          eq(schema.booking.appointmentType, type.key),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.status, "agendada"),
          eq(schema.booking.isTest, false),
          gte(schema.booking.scheduledAt, new Date())
        )
      )
    )
    .limit(1);
  if (existing[0]) {
    throw new PublicBookingError(
      "ya_tiene_cita",
      "Ya tienes una cita de este tipo agendada. Para cambiarla, escríbenos por WhatsApp."
    );
  }

  const result = await createSessionBooking({
    organizationId: ctx.organizationId,
    contactId,
    startUtc: input.startUtc,
    typeKey: type.key,
    source: "web",
    requireOffer: false,
    notes: input.notas ?? null,
    guestEmail: input.email ?? null,
  });
  return { result, type };
}

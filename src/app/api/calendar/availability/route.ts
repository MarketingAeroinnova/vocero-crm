import { withAuth } from "@/lib/api";
import { dayIsoInTz, timeInTz, dayLabelInTz } from "@/lib/time/slots";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { computeAvailability } from "@/server/agenda/availability";
import { findType } from "@/lib/appointment-types";
import { computeAvailabilityForType } from "@/server/agenda/availability-types";
import { getSettings } from "@/server/agenda/settings";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 015 — Los huecos libres, para el operador.
 *
 * A diferencia de la superficie del bot, esta NO registra oferta: es la vista
 * de quien ya está mirando la agenda y elige de lo que ve.
 *
 * Sin huecos responde `{"slots":[]}` con 200: agenda llena es una respuesta,
 * no un error.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const settings = await getSettings(session.organizationId);
  const now = new Date();
  const range = {
    fromISO: from && ISO_DATE.test(from) ? from : undefined,
    toISO: to && ISO_DATE.test(to) ? to : undefined,
  };

  // 070 — `?type=llamada`: los horarios de ESE tipo de cita (con los tipos
  // configurados, sin `type` se pide uno; el predeterminado si lo hay).
  const typeKey = url.searchParams.get("type")?.trim() || settings.defaultTypeKey;
  const tipo = settings.appointmentTypes.length
    ? findType(settings.appointmentTypes, typeKey)
    : null;
  let calendarWarning: string | null = null;
  let slots;
  if (tipo) {
    const r = await computeAvailabilityForType(session.organizationId, tipo, {
      ...range,
      settings,
      now,
      // El operador puede agendar con poco aviso.
      ignoreNotice: true,
    });
    slots = r.slots;
    calendarWarning = r.calendarWarning;
  } else {
    slots = await computeAvailability(session.organizationId, { ...range, settings, now });
  }

  return Response.json({
    ...(tipo ? { tipo: { key: tipo.key, label: tipo.label }, calendarWarning } : {}),
    tipos: settings.appointmentTypes.map((t) => ({ key: t.key, label: t.label })),
    slots: slots.map((s) => ({
      ...s,
      dayIso: dayIsoInTz(new Date(s.startUtc), settings.timezone),
      dayLabel: dayLabelInTz(s.startUtc, settings.timezone, now),
      time: timeInTz(s.startUtc, settings.timezone),
    })),
  });
});

import { findType } from "@/lib/appointment-types";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { groupSlotsByDay, PUBLIC_READ_BUDGET, toPublicType } from "@/lib/public-booking";
import { computeAvailabilityForType } from "@/server/agenda/availability-types";
import { loadPublicContext } from "@/server/agenda/public";

export const dynamic = "force-dynamic";

/**
 * 070 — Los horarios libres de UN tipo, agrupados por día y en la hora del
 * negocio. NO registra oferta: la reserva se valida al confirmar. Nunca expone
 * el aviso interno del calendario (`calendarWarning`).
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(`pub-agenda:${clientIp(req.headers)}`, PUBLIC_READ_BUDGET);
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  const gate = await loadPublicContext();
  if (!gate.ok) return gate.response;
  const { organizationId, settings } = gate.ctx;

  const tipoKey = new URL(req.url).searchParams.get("tipo")?.trim() ?? "";
  const type = findType(settings.appointmentTypes, tipoKey);
  if (!type) {
    return Response.json(
      { error: { code: "invalid_body", message: "Tipo de cita desconocido" } },
      { status: 422 }
    );
  }

  const now = new Date();
  const { slots } = await computeAvailabilityForType(organizationId, type, {
    settings,
    now,
  });
  return Response.json({
    tipo: toPublicType(type),
    timezone: settings.timezone,
    dias: groupSlotsByDay(slots, settings.timezone, now),
  });
}

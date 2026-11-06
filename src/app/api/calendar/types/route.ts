import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import {
  CalendarSettingsError,
  getSettings,
  upsertAppointmentTypes,
} from "@/server/agenda/settings";

export const dynamic = "force-dynamic";

/**
 * 070 — Los tipos de cita del negocio (llamada, visita, videollamada…), cada
 * uno con su responsable, horario, duración y traslado.
 *
 * GET devuelve los guardados. PUT los REEMPLAZA todos: es la lista completa o
 * nada, y una lista con un error no guarda ninguno (se responde qué está mal
 * en cada tipo). `types: []` los quita y la agenda vuelve a ser la de siempre.
 */
export const GET = withAuth(async (session) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const s = await getSettings(session.organizationId);
  return Response.json({
    types: s.appointmentTypes,
    defaultTypeKey: s.defaultTypeKey,
    timezone: s.timezone,
    connector: s.connector,
  });
});

const putSchema = z.object({
  // La validación detallada vive en `parseAppointmentTypes`: aquí solo se pide
  // una lista, para que los errores salgan con el número y el campo del tipo.
  types: z.array(z.unknown()),
  defaultTypeKey: z.string().min(1).nullish(),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  try {
    const saved = await upsertAppointmentTypes(
      session.organizationId,
      body.data.types,
      body.data.defaultTypeKey ?? null
    );
    return Response.json({
      types: saved.appointmentTypes,
      defaultTypeKey: saved.defaultTypeKey,
    });
  } catch (err) {
    if (err instanceof CalendarSettingsError) {
      return apiError(422, "invalid_body", err.message);
    }
    throw err;
  }
});
